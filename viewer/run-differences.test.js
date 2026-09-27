/*
 * Unit tests for run-differences.js: the differences review's algorithm, the
 * viewer half of the one normalization/pdd_export.py writes into the PDD's
 * section 4.1.
 *
 * The seam guard is shared/run-differences-golden.json: this file and
 * normalization/test/test_run_differences_golden.py assert the same cases
 * (the alignment keys after folding, and the difference lines), so the Steps
 * level and the PDD cannot drift apart without one of the two going red.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const RD = require("./run-differences.js");
const RM = require("./runs-model.js");

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "run-differences-golden.json"), "utf-8"));

/* ---- the shared golden -------------------------------------------------------- */

test("golden: the fixture covers every kind of difference and every kind of key", () => {
  assert.equal(GOLDEN.version, 1);
  // Six cases, two since the stretches left out of the analysis joined the
  // rule (lane CC), five since Steps and the PDD share it whole (lane FX1).
  assert.ok(GOLDEN.cases.length >= 8 && GOLDEN.cases.length <= 16, "8 to 16 cases");
  const lines = GOLDEN.cases.flatMap((c) => c.expected);
  const keys = GOLDEN.cases.flatMap((c) => c.run_keys);
  for (const prefix of ["Extra step: ", "Skipped: ", "Different order: ", "Not done: ", "Repeated: ",
    "Part of this run was left out of the analysis ("]) {
    assert.ok(lines.some((l) => l.startsWith(prefix)), "a case expects a line starting " + JSON.stringify(prefix));
  }
  for (const prefix of ["draft:", "merge:", "label:"]) {
    assert.ok(keys.some((k) => k.startsWith(prefix)), "a case expects a key starting " + JSON.stringify(prefix));
  }
  assert.ok(GOLDEN.cases.some((c) => c.expected.length === 0), "a case expects no differences");
});

/* A case's options: its stretches left out (cut to its run's span) and when
   the recording started; none for a case without excluded ranges. */
function caseOpts(c) {
  if (!c.excluded_ranges) return undefined;
  const span = { startMs: Date.parse(c.run_span.start), endMs: c.run_span.end ? Date.parse(c.run_span.end) : null };
  return { leftOut: RD.leftOutStretches(c.excluded_ranges, span), originMs: Date.parse(c.origin) };
}

/* A list of steps in the order of a transaction, as the Steps level has it
   (runs-model byStart: steps that start at one moment keep their list order). */
const inOrder = (steps) => steps.slice().sort(RM.byStart);

for (const c of GOLDEN.cases) {
  test("golden: " + c.name, () => {
    const pattern = inOrder(c.pattern), run = inOrder(c.run);
    assert.deepEqual(RD.collapseToReference(pattern, run).map(RD.alignKey), c.run_keys, "alignment keys after folding");
    const diffs = RD.differences(pattern, run, caseOpts(c));
    assert.deepEqual(diffs.map((d) => d.text), c.expected, "difference lines");
    if ("count" in c) assert.equal(RD.differenceCount(diffs), c.count, "the differences counted");
  });
}

/* 2.0.1: the rows carry the differences: every line of a golden case is a
   row's mark or a greyed row, with the same text, and nothing else is. */
for (const c of GOLDEN.cases) {
  test("golden rows: " + c.name, () => {
    const pattern = inOrder(c.pattern), run = inOrder(c.run).map((s, i) => Object.assign({ step_id: "r" + i }, s));
    const opts = caseOpts(c);
    const { marks, ghosts } = RD.rowMarks(pattern, run, opts);
    const said = new Set([...marks.values()].map((m) => m.text).concat(ghosts.map((g) => g.text)));
    const want = new Set(RD.differences(pattern, run, opts).filter((d) => d.kind !== "left_out").map((d) => d.text));
    assert.deepEqual([...said].sort(), [...want].sort());
    for (const id of marks.keys()) assert.ok(run.some((s) => s.step_id === id), "a mark stands on a row of the run");
    for (const g of ghosts) assert.ok(g.after === null || run.some((s) => s.step_id === g.after), "a greyed row follows a row of the run");
  });
}

test("2.0.1: a skipped step is placed after the step before it in the reference; a repeated step is marked from its second time", () => {
  const ref = [{ name: "A", draft_key: "a" }, { name: "B", draft_key: "b" }, { name: "C", draft_key: "c" }];
  const run = [{ step_id: "1", name: "A", draft_key: "a" }, { step_id: "2", name: "C", draft_key: "c" },
    { step_id: "3", name: "C", draft_key: "c" }, { step_id: "4", name: "X", draft_key: "x" }];
  const { marks, ghosts } = RD.rowMarks(ref, run);
  assert.deepEqual(ghosts.map((g) => [g.after, g.kind, g.name]), [["1", "skipped", "B"]]);
  assert.equal(marks.get("2"), undefined, "the first C is the reference's C");
  assert.equal(marks.get("3").kind, "repeated");
  assert.equal(marks.get("4").kind, "extra");
  assert.equal(RD.rowMarks([{ name: "A", draft_key: "a" }], [{ step_id: "1", name: "B", draft_key: "b" }]).ghosts[0].after, null,
    "a reference step with nothing done before it goes first");
});

/* Lane FX1: the default reference transaction, the PDD's rule
   (pdd_export._Session._pick_pattern). */
for (const c of GOLDEN.reference_cases) {
  test("golden reference: " + c.name, () => {
    const stats = { case_stats: c.runs.map((r) => ({ case_id: r.case_id, label: null, parent_case_id: null,
      start_ts: r.start, end_ts: null })) };
    const steps = c.runs.flatMap((r) => r.steps.map((st, i) => ({ step_id: r.case_id + "-" + i, case_id: r.case_id,
      name: "Step " + i, state: st.state, time_range: null, order: i + 1 })));
    const anno = c.pattern_run ? { steps, pattern_run: { case_id: c.pattern_run } } : { steps };
    const got = RM.patternRun(anno, RM.buildRuns(stats, steps).runs).run;
    assert.equal(got ? got.caseId : null, c.expected);
  });
}

test("the lines that are said about the comparison are not differences: the left-out line and a Not done line", () => {
  const ref = [{ name: "Find", draft_key: "f" }, { name: "Send", draft_key: "s", only_when: "asked" }];
  const diffs = RD.differences(ref, [{ name: "Find", draft_key: "f" }, { name: "Log", draft_key: "l" }],
    { leftOut: [{ startMs: at("09:00:00"), endMs: at("09:00:05") }], originMs: at("08:59:00") });
  assert.deepEqual(diffs.map((d) => [d.kind, RD.isDifference(d)]),
    [["left_out", false], ["extra", true], ["not_done", false]]);
  assert.equal(RD.differenceCount(diffs), 1);
  assert.equal(diffs[2].text, "Not done: Send (only when asked).");
});

/* ---- the stretches left out of the analysis ------------------------------------------ */

const at = (hms) => Date.parse("2026-05-14T" + hms + "Z");

test("leftOutStretches: each range cut to the run's span, in time order, overlapping ones joined; outside, unreadable or no span: none", () => {
  const span = { startMs: at("09:01:00"), endMs: at("09:03:00") };
  const R = (a, b) => ({ start: "2026-05-14T" + a + "Z", end: "2026-05-14T" + b + "Z" });
  assert.deepEqual(RD.leftOutStretches([R("09:02:00", "09:02:30"), R("09:00:30", "09:01:10"), R("09:02:20", "09:04:00")], span),
    [{ startMs: at("09:01:00"), endMs: at("09:01:10") }, { startMs: at("09:02:00"), endMs: at("09:03:00") }]);
  assert.deepEqual(RD.leftOutStretches([R("08:00:00", "08:10:00"), R("09:03:00", "09:04:00")], span), [], "outside, or only touching the end");
  assert.deepEqual(RD.leftOutStretches([{ start: "x", end: "y" }, { start: "2026-05-14T09:02:00Z" }, R("09:02:30", "09:02:00")], span), []);
  assert.deepEqual(RD.leftOutStretches([R("09:02:00", "09:02:30")], { startMs: NaN, endMs: null }), [], "no span start: nothing placed");
  assert.deepEqual(RD.leftOutStretches([R("09:02:00", "09:09:30")], { startMs: at("09:01:00"), endMs: null }),
    [{ startMs: at("09:02:00"), endMs: at("09:09:30") }], "a run left open reaches to the end");
  // A hand-edited range without a zone is read as UTC, as the pipeline reads it.
  assert.deepEqual(RD.leftOutStretches([{ start: "2026-05-14T09:02:00", end: "2026-05-14T09:02:30" }], span),
    [{ startMs: at("09:02:00"), endMs: at("09:02:30") }]);
});

test("leftOutText: once per run, the times since the recording started; none when the start is not known or a time falls before it", () => {
  const s = [{ startMs: at("09:01:10"), endMs: at("09:01:45") }];
  assert.equal(RD.leftOutText(s, at("09:00:00"), "transaction"), "Part of this transaction was left out of the analysis (1:10 to 1:45).");
  assert.equal(RD.leftOutText(s, NaN, "transaction"), "Part of this transaction was left out of the analysis.");
  assert.equal(RD.leftOutText(s, at("09:05:00")), "Part of this run was left out of the analysis.");
  assert.equal(RD.leftOutText([], at("09:00:00")), "");
  const three = [{ startMs: at("09:00:10"), endMs: at("09:00:20") }, { startMs: at("09:30:00"), endMs: at("09:31:00") },
    { startMs: at("10:00:00"), endMs: at("10:00:05") }];
  assert.equal(RD.leftOutText(three, at("09:00:00"), "transaction"),
    "Part of this transaction was left out of the analysis (0:10 to 0:20, 30:00 to 31:00 and 1:00:00 to 1:00:05).");
});

test("differences with a stretch left out: the line leads, is no difference, and a step outside the stretch is still skipped", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Check", { draft_key: "c" }), P("Save", { draft_key: "s" }), P("Send", { draft_key: "e" })];
  const T = (a, b) => ({ start: "2026-05-14T" + a + "Z", end: "2026-05-14T" + b + "Z" });
  const run = [P("Find", { draft_key: "f", time_range: T("09:01:00", "09:01:05") }),
    P("Save", { draft_key: "s", time_range: T("09:02:00", "09:02:05") })];
  const leftOut = [{ startMs: at("09:01:10"), endMs: at("09:01:50") }];
  const d = RD.differences(ref, run, { leftOut, originMs: at("09:00:00"), reference: RD.REFERENCE_RUN, unit: RD.RUN_UNIT });
  assert.deepEqual(d.map((x) => x.kind), ["left_out", "skipped"]);
  assert.equal(d[0].text, "Part of this transaction was left out of the analysis (1:10 to 1:50).");
  assert.equal(d[1].text, "Skipped: Send (step 4 of the reference transaction).", "Check falls in the stretch, Send does not");
  assert.equal(RD.differenceCount(d), 1, "the left-out line is not counted as a difference");
  // Without the stretch, Check reads as skipped (the control).
  assert.deepEqual(RD.differences(ref, run).map((x) => x.kind), ["skipped", "skipped"]);
});

test("differences with a stretch left out: a folded unit starts with its first member", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Merged", { draft_keys: ["a", "b"] }), P("Check", { draft_key: "c" }), P("Save", { draft_key: "s" })];
  const T = (a, b) => ({ start: "2026-05-14T" + a + "Z", end: "2026-05-14T" + b + "Z" });
  const run = [P("Find", { draft_key: "f", time_range: T("09:01:00", "09:01:05") }),
    P("A", { draft_key: "a", time_range: T("09:01:10", "09:01:15") }), P("B", { draft_key: "b", time_range: T("09:01:20", "09:01:25") }),
    P("Save", { draft_key: "s", time_range: T("09:03:00", "09:03:05") })];
  const units = RD.collapseToReference(ref, run);
  assert.equal(units[1].members.length, 2, "the folded unit keeps its members");
  const d = RD.differences(ref, run, { leftOut: [{ startMs: at("09:02:00"), endMs: at("09:02:30") }], originMs: at("09:00:00") });
  assert.deepEqual(d.map((x) => x.text), ["Part of this run was left out of the analysis (2:00 to 2:30)."], "Check falls between the merge and Save");
});

/* ---- the key rule ---------------------------------------------------------------- */

test("alignKey: a draft_key wins, then draft_keys, then the label of the name", () => {
  assert.equal(RD.alignKey({ draft_key: "a|s|c", draft_keys: ["x", "y"], name: "N" }), "draft:a|s|c");
  assert.equal(RD.alignKey({ draft_keys: ["x|1", "y|2"], name: "N" }), 'merge:["x|1","y|2"]');
  assert.equal(RD.alignKey({ draft_keys: ["x", ""], name: "Look up" }), "label:Look up", "a malformed list is no identity");
  assert.equal(RD.alignKey({ draft_keys: [], name: "Look up" }), "label:Look up");
  assert.equal(RD.alignKey({ name: "Order form: Enter 7 in Quantity" }), "label:Order form: Enter Quantity");
  assert.equal(RD.alignKey({}), "label:");
});

test("stepKeys: a draft's key, a merge's keys, none for a step without draft identity", () => {
  assert.deepEqual(RD.stepKeys({ draft_key: "a" }), ["a"]);
  assert.deepEqual(RD.stepKeys({ draft_keys: ["a", "b"] }), ["a", "b"]);
  assert.equal(RD.stepKeys({ name: "Added" }), null);
  assert.equal(RD.stepKeys(null), null);
});

/* ---- folding -------------------------------------------------------------------------- */

const P = (name, extra) => Object.assign({ name }, extra);

test("fold: a run's own merge of the first keys plus the next draft spells a merged step of three (flattened)", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Check, create, print", { draft_keys: ["c", "k", "p"] })];
  const run = [P("Find", { draft_key: "f" }), P("Check + Create", { draft_keys: ["c", "k"] }), P("Print", { draft_key: "p" })];
  const units = RD.collapseToReference(ref, run);
  assert.deepEqual(units.map(RD.alignKey), ["draft:f", 'merge:["c","k","p"]']);
  assert.equal(units[1].name, "Check, create, print", "the unit reads as the reference step");
  assert.deepEqual(RD.differences(ref, run), []);
});

test("fold: where two merged steps match at one position the one with more keys wins; among equals the first", () => {
  const two = P("Two", { draft_keys: ["a", "b"] });
  const three = P("Three", { draft_keys: ["a", "b", "c"] });
  const twin = P("Twin", { draft_keys: ["a", "b"] });
  const run = [P("A", { draft_key: "a" }), P("B", { draft_key: "b" }), P("C", { draft_key: "c" })];
  assert.deepEqual(RD.collapseToReference([two, three], run).map((u) => u.name), ["Three"]);
  assert.deepEqual(RD.collapseToReference([twin, two], run.slice(0, 2)).map((u) => u.name), ["Twin"]);
});

test("fold: one step is never folded, a step with no draft identity breaks a stretch, other steps stay as they are", () => {
  const ref = [P("Merged", { draft_keys: ["a", "b"] })];
  const own = P("Own merge", { draft_keys: ["a", "b"] });
  assert.equal(RD.collapseToReference(ref, [own])[0], own, "a single step keeps its own name");
  const broken = [P("A", { draft_key: "a" }), P("Added"), P("B", { draft_key: "b" })];
  assert.deepEqual(RD.collapseToReference(ref, broken), broken);
  assert.deepEqual(RD.collapseToReference([], broken), broken);
  const partial = [P("A", { draft_key: "a" })];
  assert.deepEqual(RD.collapseToReference(ref, partial), partial, "a stretch that stops short is not folded");
});

test("fold: without the fold, the two drafts would read as extra steps and the merge as skipped (the control)", () => {
  const ref = [P("Merged", { draft_keys: ["a", "b"] })];
  const run = [P("A", { draft_key: "a" }), P("B", { draft_key: "b" })];
  assert.deepEqual(RD.differences(ref, run), [], "folded: no difference");
  // What the same lists give when the run is aligned step by step.
  const unfolded = RD.firstOccurrences(run).map((x) => x.key);
  assert.deepEqual(unfolded, ["draft:a", "draft:b"]);
  assert.ok(!unfolded.includes(RD.alignKey(ref[0])));
});

/* ---- the lines ----------------------------------------------------------------------- */

test("differences: the Steps level's words (AD-29) name a run a transaction; the defaults stay the PDD's", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" }), P("Send", { draft_key: "e" })];
  const run = [P("Log", { draft_key: "l" }), P("Save", { draft_key: "s" }), P("Find", { draft_key: "f" })];
  const words = { reference: RD.REFERENCE_RUN, unit: RD.RUN_UNIT };
  assert.deepEqual(RD.differences(ref, run, words).map((x) => x.text), [
    "Extra step: Log (at the start of the transaction).",
    "Different order: Find (in this transaction after Save).",
    "Skipped: Send (step 3 of the reference transaction).",
  ]);
  assert.deepEqual(RD.differences(ref, run).map((x) => x.text), [
    "Extra step: Log (at the start of the run).",
    "Different order: Find (in this run after Save).",
    "Skipped: Send (step 3 of the pattern run).",
  ], "without the words: the shared golden's and the PDD's lines");
});

test("differences: a step done again reads Repeated at its first time, once; an empty run skips every step", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" })];
  const run = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" }), P("Find again", { draft_key: "f" })];
  assert.deepEqual(RD.differences(ref, run).map((d) => [d.kind, d.text]),
    [["repeated", "Repeated: Find, 2 times."]], "lane FX1: rework is a difference, in Steps as in the PDD");
  assert.deepEqual(RD.differences(run, run), [], "done as often as in the reference: no line");
  assert.deepEqual(RD.differences(ref, []).map((d) => d.text),
    ["Skipped: Find (step 1 of the pattern run).", "Skipped: Save (step 2 of the pattern run)."]);
  assert.deepEqual(RD.differences([], [P("  ")]).map((d) => d.text), ["Extra step: (unnamed step) (at the start of the run)."]);
});
