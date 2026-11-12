"use strict";

/*
 * Lane FX2 (validation pass 2, F1): whether an edited copy of the process
 * map was made from the steps as they are now (asis-freshness.js). The
 * signature of the maps the steps draw changes with what the step map
 * draws, and with nothing else; a copy that kept it is older than the steps
 * as soon as they draw another map, before any analysis; a copy made before
 * the signature was kept falls back to the process of the step map's file.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("./asis-freshness.js");
const RM = require("./reference-maps.js");

const t = (min) => new Date(Date.UTC(2026, 4, 17, 9, min)).toISOString();

function step(id, caseId, min, extra) {
  return Object.assign({
    step_id: id, case_id: caseId, state: "auto_suggested", name: "Step " + id,
    draft_key: "app|screen|Button:" + id,
    time_range: { start: t(min), end: t(min + 1) },
    evidence: { interaction_event_ids: ["e-" + id], screenshot_refs: [] },
    flags: { waste: false },
  }, extra || {});
}

/* Two transactions of three drafted steps. */
function project() {
  return {
    sessionFolder: null,
    stats: { case_stats: [
      { case_id: "c1", start_ts: t(0), end_ts: t(10) },
      { case_id: "c2", start_ts: t(20), end_ts: t(30) },
    ] },
    annotations: {
      steps: [step("a", "c1", 1), step("b", "c1", 3), step("c", "c1", 5),
        step("a2", "c2", 21, { draft_key: "app|screen|Button:a", name: "Step a" }),
        step("b2", "c2", 23, { draft_key: "app|screen|Button:b", name: "Step b" }),
        step("c2", "c2", 25, { draft_key: "app|screen|Button:c", name: "Step c" })],
      document: { title: "Order intake", trigger: "An order email", result: "A sales order" },
    },
  };
}

const sig = (p) => F.stepsMapSignature(p.annotations, p.stats);
const find = (p, id) => p.annotations.steps.find((s) => s.step_id === id);

test("the signature is the same for the same steps, and a rename changes it at once (no analysis needed)", () => {
  const p = project();
  const before = sig(p);
  assert.equal(sig(project()), before, "the same steps, the same signature");
  assert.match(before, /^[0-9a-f]{64}$/);
  find(p, "b").name = "Check the order";
  assert.notEqual(sig(p), before);
});

test("what the map does not draw changes nothing: confirming, a description, a screenshot, the reference transaction, the document's other fields", () => {
  const p = project();
  const before = sig(p);
  for (const s of p.annotations.steps) s.state = "confirmed";
  find(p, "a").description = "Look the customer up by their number.";
  find(p, "a").evidence.screenshot_refs = ["screenshots/shot_01.png"];
  p.annotations.pattern_run = { case_id: "c2", confirmed_at: t(40) };
  p.annotations.document.purpose = "Why the process is done";
  p.annotations.analyst_screenshots = [{ id: "s1", file: "s1.png", step_id: "a", at: t(1) }];
  assert.equal(sig(p), before);
});

test("what the step map draws changes it: a flow, a condition, a note, a file, a system, the waste flag, the automation's choice, Done by, a hidden step, the Trigger and the Result", () => {
  const cases = {
    link: (p) => { find(p, "c").links = [{ to: "a", when: "a price is missing" }]; },
    condition: (p) => { find(p, "b").only_when = "the customer is new"; },
    note: (p) => { p.annotations.analyst_notes = [{ id: "n1", text: "Ask the SAP team", step_id: "a" }]; },
    file: (p) => { p.annotations.attachments = [{ id: "f1", file: "form.pdf", label: "Order form", step_id: "b" }]; },
    system: (p) => { find(p, "a").system = "SAP"; },
    waste: (p) => { find(p, "b").flags.waste = true; },
    automation: (p) => { find(p, "a").automation = "automated"; },
    person: (p) => { find(p, "a").automation = "person"; },
    doneBy: (p) => { find(p, "c").done_by = "Finance clerk"; },
    hidden: (p) => { find(p, "c2").state = "hidden"; },
    trigger: (p) => { p.annotations.document.trigger = "A phone call"; },
    result: (p) => { p.annotations.document.result = "The order is saved"; },
  };
  const base = sig(project());
  for (const [name, change] of Object.entries(cases)) {
    const p = project();
    change(p);
    assert.notEqual(sig(p), base, name + " changes the signature");
  }
  // A note on a moment (no step) is on no box.
  const p = project();
  p.annotations.analyst_notes = [{ id: "n2", text: "The phone rang", step_id: null, at: t(2) }];
  assert.equal(sig(p), base);
  // C25: "Not decided yet" and an empty Done by draw nothing, so a copy made
  // before C25 keeps its signature.
  const q = project();
  find(q, "a").automation = "undecided";
  find(q, "c").done_by = "  ";
  assert.equal(sig(q), base);
  // Two choices that draw different kinds of task differ.
  const auto = project(), person = project();
  find(auto, "a").automation = "automated";
  find(person, "a").automation = "person";
  assert.notEqual(sig(auto), sig(person));
});

test("C19: a sub-process's map counts too: a sub-step renamed changes it", () => {
  const p = project();
  find(p, "b").sub_steps = [step("s1", "c1", 3, { draft_key: undefined, action_key: "app|screen|enter:f", name: "Enter F" })];
  const before = sig(p);
  find(p, "b").sub_steps[0].name = "Type the order number";
  assert.notEqual(sig(p), before);
});

test("copyStale: a copy that kept the signature is older than the steps once they draw another map", () => {
  const p = project();
  const entry = RM.buildEntry({ file: "derived_maps/x.bpmn", source: { level: "step" }, forked_from_steps: sig(p) });
  assert.equal(F.copyStale(p, entry), false);
  find(p, "a").name = "Look up the customer";
  assert.equal(F.copyStale(p, entry), true);
  find(p, "a").name = "Step a";
  assert.equal(F.copyStale(p, entry), false, "a rename taken back is no change");
});

test("copyStale: a copy made before the signature was kept compares the step map's file, as the edited maps did", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-asis-fresh-"));
  const xml = (name) => '<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
    '<process id="p"><startEvent id="s"/><task id="t" name="' + name + '"/><endEvent id="e"/>' +
    '<sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="e"/></process></definitions>';
  const src = path.join(folder, "process_map_step.bpmn");
  fs.writeFileSync(src, xml("Step a"));
  const marks = RM.sourceMarks(src);
  const p = Object.assign(project(), { sessionFolder: folder });
  const old = RM.buildEntry({ file: "derived_maps/x.bpmn", source: { level: "step" }, forked_from_sig: marks.sig });
  assert.equal(F.copyStale(p, old), false);
  find(p, "a").name = "Renamed, not analyzed yet";
  assert.equal(F.copyStale(p, old), false, "an old copy sees the change once the steps are analyzed");
  fs.writeFileSync(src, xml("Renamed, not analyzed yet"));
  assert.equal(F.copyStale(p, old), true);
  assert.equal(F.copyStale(p, RM.buildEntry({ file: "f", source: { level: "activity" }, forked_from_sig: "x" })), false,
    "a copy of another map claims no drift");
});

test("chosenAsIsStale: only the As-Is copy the PDD prints, with its file on disk", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-asis-fresh-"));
  const p = Object.assign(project(), { sessionFolder: folder });
  const e = RM.buildEntry({ map_id: "rm_1", file: "derived_maps/rm_1.bpmn", source: { level: "step" }, forked_from_steps: sig(p) });
  RM.upsert(p.annotations, e);
  RM.setRole(p.annotations, "rm_1", "as_is");
  find(p, "a").name = "Look up the customer";
  assert.equal(F.chosenAsIsStale(p), false, "its file is not on disk: no As-Is map is printed from it");
  RM.writeBpmn(folder, e, "<definitions/>");
  assert.equal(F.chosenAsIsStale(p), true);
  RM.setRole(p.annotations, "rm_1", null);
  assert.equal(F.chosenAsIsStale(p), false, "a copy that fills no PDD role is not the As-Is map");
});
