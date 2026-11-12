"use strict";

/* pane-lists.js: what the Timeline's pane lists (lane PANE). */

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pane-lists.js");
const RunsModel = require("./runs-model.js");

const T0 = Date.parse("2026-11-10T09:00:00Z");
const iso = (s) => new Date(T0 + s * 1000).toISOString();
function step(id, caseId, a, b, extra) {
  return Object.assign({ step_id: id, case_id: caseId, name: "Name " + id, description: "Does " + id, state: "edited",
    time_range: a == null ? null : { start: iso(a), end: iso(b) } }, extra || {});
}
function stats(cases) {
  return { case_stats: cases.map(([id, a, b, implicit]) => ({ case_id: id, start_ts: iso(a), end_ts: b == null ? null : iso(b), implicit: !!implicit })) };
}

test("a recording's list: the reference transaction first, then the others in their order, then the steps outside", () => {
  const steps = [
    step("a1", "c1", 0, 10), step("a2", "c1", 10, 20),
    step("b1", "c2", 30, 40), step("b2", "c2", 40, 50, { state: "hidden" }),
    step("x", null, 100, 110),
  ];
  const model = RunsModel.buildRuns(stats([["c1", 0, 25], ["c2", 25, 60]]), steps);
  const g = P.stepGroups(model, "c2", null);
  assert.deepEqual(g.map((x) => x.key), ["c2", "c1", "__outside__"]);
  assert.equal(g[0].isRef, true);
  assert.equal(g[1].isRef, false);
  assert.deepEqual(g[0].steps.map((s) => s.step_id), ["b1"], "a hidden step is not listed");
  assert.deepEqual(P.listedSteps(g).map((s) => s.step_id), ["b1", "a1", "a2", "x"]);
});

test("the order of the process: a placed step comes after its anchor, a step without a time after the timed ones", () => {
  const steps = [
    step("s1", "c1", 0, 10), step("s2", "c1", 10, 20), step("s3", "c1", 20, 30, { placed_after: "s1" }),
    step("u1", "c1", null, null, { order: 1, state: "manually_authored" }),
  ];
  const model = RunsModel.buildRuns(stats([["c1", 0, null, true]]), steps);
  const g = P.stepGroups(model, "c1", "c1");
  assert.equal(g.length, 1, "one transaction no marker starts: one list");
  assert.equal(g[0].key, null);
  assert.deepEqual(g[0].steps.map((s) => s.step_id), ["s1", "s3", "s2", "u1"]);
});

test("a project of one marked transaction is grouped; one implicit one is not", () => {
  const model = RunsModel.buildRuns(stats([["c1", 0, 30]]), [step("s1", "c1", 0, 10)]);
  assert.equal(P.transactionsMarked(model.runs, null), true);
  assert.equal(P.stepGroups(model, "c1", null)[0].isRef, false, "one transaction is the reference among nothing");
  assert.equal(P.transactionsMarked(model.runs, "c1"), false);
  assert.deepEqual(P.stepGroups({ runs: [], outside: [] }, null, null), []);
});

test("no name yet: Step N, an empty name, or a draft's name", () => {
  assert.equal(P.noNameYet(step("a", "c", 0, 1, { name: "Step 3" })), true);
  assert.equal(P.noNameYet(step("a", "c", 0, 1, { name: "  " })), true);
  assert.equal(P.noNameYet(step("a", "c", 0, 1, { name: "Open the order", state: "auto_suggested" })), true);
  assert.equal(P.noNameYet(step("a", "c", 0, 1, { name: "Open the order", state: "confirmed" })), false);
  assert.equal(P.noNameYet(step("a", "c", 0, 1, { name: "Step 3a", state: "edited" })), false);
});

test("no description yet: none, or only the recorder's narration", () => {
  assert.equal(P.noDescriptionYet(step("a", "c", 0, 1, { description: "" }), false), true);
  assert.equal(P.noDescriptionYet(step("a", "c", 0, 1, { description: "Clicked Save" }), true), true);
  assert.equal(P.noDescriptionYet(step("a", "c", 0, 1, { description: "Saves the order" }), false), false);
});

test("a row's line: the system or No system yet, then what it lacks", () => {
  const s = step("a", "c", 0, 1, { name: "Step 2", description: "" });
  assert.equal(P.metaLine(s, "", false), "No system yet · no name yet · no description yet");
  assert.equal(P.metaLine(step("b", "c", 0, 1), "SAP", false), "SAP");
  const row = P.stepRow(s, 1, { systemOf: () => "SAP", startText: () => "6:20", isOpen: () => true }, { hasVideo: true });
  assert.deepEqual(row, { id: "a", num: 2, name: "Step 2", meta: "SAP · no name yet · no description yet", draft: false,
    when: "6:20 · open", startsHere: false });
  assert.equal(P.stepRow(step("d", "c", 0, 1, { state: "auto_suggested" }), 0, {}, {}).draft, true);
});

test("when a row starts: its start, open, or no time yet", () => {
  assert.equal(P.whenText(step("a", "c", 380, 400), "6:20", false), "6:20");
  assert.equal(P.whenText(step("a", "c", 380, 400), "6:20", true), "6:20 · open");
  assert.equal(P.whenText(step("a", "c", null, null), "", false), "no time yet");
});

test("Starts here: a step without a time and no recorded action, with a video, not read only", () => {
  const untimed = step("u", "c", null, null, { state: "manually_authored" });
  assert.equal(P.offersStartsHere(untimed, { hasVideo: true }), true);
  assert.equal(P.offersStartsHere(untimed, { hasVideo: false }), false, "no video: nothing to take the moment from");
  assert.equal(P.offersStartsHere(untimed, { hasVideo: true, readOnly: true }), false);
  assert.equal(P.offersStartsHere(step("t", "c", 0, 1), { hasVideo: true }), false, "a step with a time");
  const recorded = step("r", "c", null, null, { evidence: { interaction_event_ids: ["e1"] } });
  assert.equal(P.offersStartsHere(recorded, { hasVideo: true }), false, "a recorded step's time is its actions'");
  assert.equal(P.offersStartsHere(Object.assign({}, untimed, { state: "hidden" }), { hasVideo: true }), false);
});

test("the hint line, word for word", () => {
  assert.equal(P.stepsHint({ hasVideo: true, total: 3, untimed: 2 }),
    "2 steps have no time yet. Go to the moment a step starts in the video, then click Starts here on that step.");
  assert.equal(P.stepsHint({ hasVideo: true, total: 3, untimed: 1 }),
    "1 step has no time yet. Go to the moment a step starts in the video, then click Starts here on that step.");
  assert.equal(P.stepsHint({ hasVideo: true, total: 0 }),
    "No steps yet. Play the video and click Add step where each step starts, or paste your notes.");
  assert.equal(P.stepsHint({ hasVideo: false, total: 0 }),
    "No steps yet. Add step adds one, and Paste notes... adds one for each line of your notes.");
  assert.equal(P.stepsHint({ hasVideo: false, total: 2, untimed: 2 }), "", "no video: nothing to give a moment from");
  assert.equal(P.stepsHint({ hasVideo: true, total: 2, untimed: 0 }), "");
  assert.equal(P.untimedCount([step("a", "c", null, null), step("b", "c", 0, 1)]), 1);
});

test("the acts above the list, and none read only", () => {
  assert.deepEqual(P.listActs({ hasVideo: false, recorded: false }), { pasteNotes: true, addStep: true, confirm: false, undoConfirm: false });
  assert.deepEqual(P.listActs({ hasVideo: true, recorded: false }), { pasteNotes: true, addStep: false, confirm: false, undoConfirm: false });
  assert.deepEqual(P.listActs({ recorded: true, canConfirm: true, canUndoConfirm: false }),
    { pasteNotes: true, addStep: false, confirm: true, undoConfirm: false });
  assert.deepEqual(P.listActs({ readOnly: true, recorded: true, canConfirm: true, canUndoConfirm: true }),
    { pasteNotes: false, addStep: false, confirm: false, undoConfirm: false });
  assert.deepEqual(P.listActs({ readOnly: true, hasVideo: false, recorded: false }),
    { pasteNotes: false, addStep: false, confirm: false, undoConfirm: false });
});

test("Previous and Next: the steps before and after, none at the ends", () => {
  const list = [step("a", "c", 0, 1), step("b", "c", 1, 2), step("c", "c", 2, 3)];
  assert.deepEqual(P.neighbours(list, "a"), { index: 0, count: 3, prevId: null, nextId: "b" });
  assert.deepEqual(P.neighbours(list, "b"), { index: 1, count: 3, prevId: "a", nextId: "c" });
  assert.deepEqual(P.neighbours(list, "c"), { index: 2, count: 3, prevId: "b", nextId: null });
  assert.equal(P.neighbours(list, "z"), null);
  assert.deepEqual(P.neighbours([list[0]], "a"), { index: 0, count: 1, prevId: null, nextId: null });
});

test("the step at a moment of the clock", () => {
  const list = [step("a", "c", 0, 10), step("u", "c", null, null), step("b", "c", 10, 20)];
  assert.equal(P.stepAt(list, T0 + 5000).step_id, "a");
  assert.equal(P.stepAt(list, T0 + 10000).step_id, "b", "a step's end is the next one's start");
  assert.equal(P.stepAt(list, T0 + 30000), null);
  assert.equal(P.stepAt(list, NaN), null);
});

test("notes in the order of the clock, on a step or at a moment", () => {
  const steps = { s: step("s", "c", 20, 30, { name: "Check the stock" }) };
  const notes = [
    { id: "n1", text: "later", at: iso(50), step_id: null },
    { id: "n2", text: "on the step", at: null, step_id: "s" },
    { id: "n3", text: "first", at: iso(5), step_id: null },
    { id: "n4", text: "nowhere", at: null, step_id: "gone" },
    { id: "n5", text: "   ", at: iso(1) },
  ];
  const rows = P.noteRows(notes, (id) => steps[id] || null);
  assert.deepEqual(rows.map((r) => r.id), ["n3", "n2", "n1", "n4"]);
  assert.equal(rows[1].where, "On the step: Check the stock");
  assert.equal(rows[1].ms, T0 + 20000, "a note on a step has its step's moment");
  assert.equal(rows[0].where, "At a moment, on no step");
});

test("files on a step or on the whole project", () => {
  const steps = { s: step("s", "c", 0, 1, { name: "Send the mail" }) };
  const rows = P.fileRows([{ id: "f1", file: "attachments/a.pdf", label: "Order form", step_id: "s" },
    { id: "f2", file: "attachments/b.xlsx", label: "", step_id: null }], (id) => steps[id] || null);
  assert.deepEqual(rows.map((r) => [r.name, r.where, r.stepId]),
    [["Order form", "On the step: Send the mail", "s"], ["attachments/b.xlsx", "On the whole project", null]]);
  assert.deepEqual(rows.map((r) => r.fromSme), [false, false]);
});

test("the Files tab: a file the SME added says so first (C24)", () => {
  const rows = P.fileRows([{ id: "f1", file: "Order 10900.msg", label: "Order 10900.msg", step_id: null, from: "sme" },
    { id: "f2", file: "mine.pdf", label: "Mine", step_id: null, from: "analyst" }], () => null);
  assert.deepEqual(rows.map((r) => [r.where, r.fromSme]),
    [["From the SME · On the whole project", true], ["On the whole project", false]]);
});

test("a tab's label counts what it lists", () => {
  assert.equal(P.tabLabel("Steps", 5), "Steps (5)");
  assert.equal(P.tabLabel("Transcript"), "Transcript");
});
