"use strict";
/*
 * readiness.js (lane B-V2): what a reader of the next version will miss. The
 * rule is pure: the steps of the reference transaction at every level, the
 * lookups the view passes in (screenshots, systems, the recorder's
 * narration, the document's status, the As-Is map), and an ordered list of
 * entries with their texts and where each leads.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const RunsModel = require("./runs-model.js");
const R = require("./readiness.js");

const t = (min) => new Date(Date.UTC(2026, 4, 17, 9, min)).toISOString();

/* A step with everything the PDD prints: a name of its own, a description,
   confirmed. Pictures and systems come from the lookups below. */
function step(id, caseId, min, over) {
  return Object.assign({
    step_id: id, case_id: caseId, state: "confirmed", name: "Do " + id, description: "Describe " + id,
    time_range: { start: t(min), end: t(min + 1) },
  }, over || {});
}

const STATS = { meta: {}, case_stats: [
  { case_id: "c1", start_ts: t(0), end_ts: t(10) },
  { case_id: "c2", start_ts: t(20), end_ts: t(30) },
] };

const FULL_DOC = { missing: [], firstEmpty: null };

/* Lookups that call every step written: a picture, a system, its own description. */
function lookups(over) {
  return Object.assign({ shotCount: () => 1, systemOf: () => "SAP", isNarration: () => false,
    document: FULL_DOC, asIsStale: false }, over || {});
}

function miss(steps, look, anno) {
  const annotations = Object.assign({ steps }, anno || {});
  const runs = RunsModel.buildRuns(STATS, steps).runs;
  return R.missing({ annotations, runs }, lookups(look));
}

const keys = (list) => list.map((e) => e.key);

test("a project with nothing missing has no entry", () => {
  assert.deepEqual(miss([step("a", "c1", 1), step("b", "c1", 3)]), []);
});

test("drafts: plural and singular, the step a draft leads to the first of them", () => {
  const two = miss([step("a", "c1", 1, { state: "auto_suggested" }), step("b", "c1", 3, { state: "auto_matched" }),
    step("c", "c1", 5)]);
  assert.deepEqual(two, [{ key: "drafts", count: 2, text: "2 steps are still drafts.",
    lead: { kind: "step", stepId: "a" } }]);
  const one = miss([step("a", "c1", 1), step("b", "c1", 3, { state: "auto_suggested" })]);
  assert.equal(one[0].text, "1 step is still a draft.");
  assert.deepEqual(one[0].lead, { kind: "step", stepId: "b" });
});

test("names: a step named as + Step names it, or with no name, has no name of its own", () => {
  const list = miss([step("a", "c1", 1, { name: "Step 2" }), step("b", "c1", 3, { name: "  " }), step("c", "c1", 5)]);
  assert.deepEqual(list, [{ key: "names", count: 2, text: "2 steps have no name of their own: Step 2, Unnamed step.",
    lead: { kind: "step", stepId: "a" } }]);
  const one = miss([step("a", "c1", 1), step("b", "c1", 3, { name: "Step 3" })]);
  assert.equal(one[0].text, "1 step has no name of its own: Step 3.");
  // "Step 3b" is a name of its own: only the pattern + Step gives counts.
  assert.deepEqual(miss([step("a", "c1", 1, { name: "Step 3b" })]), []);
  assert.equal(R.NUMBERED_STEP.test("Step 12"), true);
});

test("descriptions: empty after trimming, or only the recorder's narration", () => {
  const list = miss([step("a", "c1", 1, { description: " " }), step("b", "c1", 3, { description: "Clicked OK." }),
    step("c", "c1", 5), step("d", "c1", 7, { description: undefined })],
  { isNarration: (s) => s.description === "Clicked OK." });
  assert.deepEqual(list, [{ key: "descriptions", count: 3, text: "3 steps have no description: Do a, Do b, Do d.",
    lead: { kind: "step", stepId: "a" } }]);
  assert.equal(miss([step("a", "c1", 1, { description: "" })])[0].text, "1 step has no description: Do a.");
});

test("the names: the first three, then and N more", () => {
  const steps = ["a", "b", "c", "d", "e"].map((id, i) => step(id, "c1", 1 + i, { description: "" }));
  assert.equal(miss(steps)[0].text, "5 steps have no description: Do a, Do b, Do c and 2 more.");
  assert.equal(miss(steps.slice(0, 4))[0].text, "4 steps have no description: Do a, Do b, Do c and 1 more.");
  assert.equal(miss(steps.slice(0, 3))[0].text, "3 steps have no description: Do a, Do b, Do c.");
});

test("pictures: a step that shows no screenshot (the step pane's count)", () => {
  const list = miss([step("a", "c1", 1), step("b", "c1", 3), step("c", "c1", 5)], { shotCount: (s) => (s.step_id === "b" ? 2 : 0) });
  assert.deepEqual(list, [{ key: "pictures", count: 2, text: "2 steps have no picture: Do a, Do c.",
    lead: { kind: "step", stepId: "a" } }]);
  assert.equal(miss([step("a", "c1", 1)], { shotCount: () => 0 })[0].text, "1 step has no picture: Do a.");
});

test("systems: a step done in no system the app knows", () => {
  const list = miss([step("a", "c1", 1), step("b", "c1", 3)], { systemOf: (s) => (s.step_id === "a" ? "" : "SAP") });
  assert.deepEqual(list, [{ key: "systems", count: 1, text: "1 step has no system: Do a.", lead: { kind: "step", stepId: "a" } }]);
  assert.equal(miss([step("a", "c1", 1), step("b", "c1", 3)], { systemOf: () => " " })[0].text, "2 steps have no system: Do a, Do b.");
});

test("conditions: a link whose condition is empty is a decision that does not say when", () => {
  const list = miss([
    step("a", "c1", 1, { links: [{ to: "end", when: "" }] }),
    step("b", "c1", 3, { links: [{ to: "a", when: "the stock is short" }] }),
    step("c", "c1", 5, { links: [{ to: "a", when: "  " }, { to: "end", when: "cancelled" }] }),
  ]);
  assert.deepEqual(list, [{ key: "conditions", count: 2, text: "2 decisions do not say when: Do a, Do c.",
    lead: { kind: "step", stepId: "a" } }]);
  assert.equal(miss([step("a", "c1", 1, { links: [{ to: "end" }] })])[0].text, "1 decision does not say when: Do a.");
  // A link without a target is no link (step-flow.js links), so it asks nothing.
  assert.deepEqual(miss([step("a", "c1", 1, { links: [{ to: "", when: "" }] })]), []);
});

test("document: every empty field by name, no and N more, leading to the first empty field", () => {
  const doc = { missing: ["Purpose", "Scope", "Trigger", "Result", "Key contacts"], firstEmpty: "purpose" };
  assert.deepEqual(miss([step("a", "c1", 1)], { document: doc }), [{ key: "document", count: 5,
    text: "5 document fields are empty: Purpose, Scope, Trigger, Result, Key contacts.", lead: { kind: "document", field: "purpose" } }]);
  assert.equal(miss([step("a", "c1", 1)], { document: { missing: ["Result"], firstEmpty: "result" } })[0].text,
    "1 document field is empty: Result.");
});

test("asis: one entry while the As-Is map is older than the steps, leading to the Map", () => {
  assert.deepEqual(miss([step("a", "c1", 1)], { asIsStale: true }),
    [{ key: "asis", count: 1, text: "The As-Is map was made before the steps changed.", lead: { kind: "map" } }]);
});

test("the entries come in their order, and a draft is counted under every lack it has", () => {
  const list = miss([
    step("a", "c1", 1, { state: "auto_suggested", name: "Step 1", description: "", links: [{ to: "end", when: "" }] }),
  ], { shotCount: () => 0, systemOf: () => "", document: { missing: ["Purpose"], firstEmpty: "purpose" }, asIsStale: true });
  assert.deepEqual(keys(list), R.KEYS);
  assert.deepEqual(keys(list), ["drafts", "names", "descriptions", "pictures", "systems", "conditions", "document", "asis"]);
  assert.ok(list.filter((e) => e.lead.kind === "step").every((e) => e.lead.stepId === "a" && e.count === 1));
});

test("the steps of a sub-process are looked at, after their parent, in process order", () => {
  const parent = step("p", "c1", 1, { sub_steps: [
    step("s2", "c1", 3, { description: "" }),
    step("s1", "c1", 2, { description: "", sub_steps: [step("ss", "c1", 2, { description: "" })] }),
  ] });
  const list = miss([parent, step("q", "c1", 5, { description: "" })]);
  assert.deepEqual(list, [{ key: "descriptions", count: 4, text: "4 steps have no description: Do s1, Do ss, Do s2 and 1 more.",
    lead: { kind: "step", stepId: "s1" } }]);
});

test("hidden steps are not looked at: at the main level, and a hidden sub-step or a hidden parent with its sub-steps", () => {
  const steps = [
    step("a", "c1", 1),
    step("h", "c1", 2, { state: "hidden", description: "", sub_steps: [step("hs", "c1", 2, { description: "" })] }),
    step("p", "c1", 3, { sub_steps: [step("s1", "c1", 3), step("s2", "c1", 4, { state: "hidden", description: "" })] }),
  ];
  assert.deepEqual(miss(steps), []);
});

test("only the reference transaction is looked at: the other transactions' steps ask nothing", () => {
  const steps = [step("a", "c1", 1), step("b", "c2", 21, { description: "", state: "auto_suggested" })];
  assert.deepEqual(miss(steps), []);
  // With transaction 2 as the reference, it is its steps that are read.
  const other = miss(steps, {}, { pattern_run: { case_id: "c2" } });
  assert.deepEqual(keys(other), ["drafts", "descriptions"]);
  assert.equal(other[1].text, "1 step has no description: Do b.");
});

test("a sub-process that only groups steps is not asked for a picture or a system; one opened from a recorded step is", () => {
  const steps = [
    step("g", "c1", 1, { group: true, sub_steps: [step("m", "c1", 1)] }),
    step("o", "c1", 3, { sub_steps: [step("n", "c1", 3)] }),
  ];
  const list = miss(steps, { shotCount: (s) => (["m", "n"].includes(s.step_id) ? 1 : 0),
    systemOf: (s) => (["m", "n"].includes(s.step_id) ? "SAP" : "") });
  assert.deepEqual(list.map((e) => [e.key, e.text]), [
    ["pictures", "1 step has no picture: Do o."],
    ["systems", "1 step has no system: Do o."],
  ]);
  // A group is still asked for its name and its description: the PDD prints both.
  const unnamed = miss([step("g", "c1", 1, { group: true, name: "", description: "", sub_steps: [step("m", "c1", 1)] })]);
  assert.deepEqual(keys(unnamed), ["names", "descriptions"]);
});

test("no reference transaction (no steps yet): only the document and the As-Is map can be missing", () => {
  const list = R.missing({ annotations: { steps: [] }, runs: [] },
    lookups({ document: { missing: ["Title"], firstEmpty: "title" } }));
  assert.deepEqual(keys(list), ["document"]);
});

test("the Overview's line and the dialog's lead", () => {
  assert.equal(R.overviewLine([{}]), "A reader of the next version will miss 1 thing");
  assert.equal(R.overviewLine([{}, {}, {}]), "A reader of the next version will miss 3 things");
  assert.equal(R.dialogLead(2), "A reader of version 2 will miss:");
});
