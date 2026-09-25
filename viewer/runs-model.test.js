/*
 * Unit tests for runs-model.js: the runs-and-steps model behind the Steps
 * level (contracts C1 to C4). The model is pure, so these drive it directly;
 * the rendered view and the verbs that call it are pinned end to end by
 * e2e/runs-smoke.js on the demo session.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const RM = require("./runs-model.js");

const T = (s) => "2026-05-14T09:" + s + "Z";

function step(id, caseId, start, end, extra) {
  return Object.assign({
    step_id: id, case_id: caseId, name: "Step " + id, state: "auto_suggested",
    time_range: { start: T(start), end: T(end) },
    evidence: { interaction_event_ids: [id + "-e1"] },
  }, extra || {});
}

/* Three runs (a nested case is not a run), listed out of order on purpose. */
const STATS = {
  case_stats: [
    { case_id: "c2", label: "Order 2", parent_case_id: null, start_ts: T("02:00"), end_ts: T("03:00"), wall_clock_ms: 60000 },
    { case_id: "c1", label: "Run 1", parent_case_id: null, start_ts: T("00:00"), end_ts: T("01:00"), wall_clock_ms: 60000 },
    { case_id: "c1a", label: "Inner", parent_case_id: "c1", start_ts: T("00:10"), end_ts: T("00:20") },
    { case_id: "c3", label: "", parent_case_id: null, start_ts: T("04:00"), end_ts: null },
  ],
  meta: { draft_summary: { runs: 3, steps_per_run: [3, 2, 0] } },
};

function steps() {
  return [
    step("a3", "c1", "00:40", "00:50"),
    step("a1", "c1", "00:00", "00:10"),
    step("a2", "c1", "00:20", "00:30", { state: "hidden" }),
    step("b1", "c2", "02:00", "02:10", { state: "edited" }),
    step("b2", "c2", "02:20", "02:30", { state: "confirmed" }),
    step("x1", null, "01:20", "01:30"),
    step("x2", "stale-case", "03:20", "03:30"),
  ];
}

/* ---- buildRuns ------------------------------------------------------------ */

test("buildRuns: top-level cases only, in start order, numbered, with their steps in time order", () => {
  const m = RM.buildRuns(STATS, steps());
  // AD-29: a run's title is what a person reads, "Transaction N".
  assert.deepEqual(m.runs.map((r) => [r.caseId, r.ordinal, r.title]),
    [["c1", 1, "Transaction 1"], ["c2", 2, "Transaction 2"], ["c3", 3, "Transaction 3"]]);
  assert.deepEqual(m.runs[0].members.map((s) => s.step_id), ["a1", "a2", "a3"]);
  assert.deepEqual(m.runs[0].visible.map((s) => s.step_id), ["a1", "a3"]);
  assert.equal(m.runs[0].hiddenCount, 1);
  assert.equal(m.runs[1].durationMs, 60000);
  assert.equal(m.runs[2].endMs, null, "a run left open has no end");
});

test("buildRuns: a marker label that only numbers the run (Run N from the capture app, or Transaction N) is not shown", () => {
  const m = RM.buildRuns(STATS, steps());
  assert.equal(m.runs[0].label, "", "\"Run 1\" only numbers transaction 1");
  assert.equal(m.runs[1].label, "Order 2");
  const relabel = (c1, c2) => ({ case_stats: STATS.case_stats.map((c) =>
    c.case_id === "c1" ? Object.assign({}, c, { label: c1 }) : c.case_id === "c2" ? Object.assign({}, c, { label: c2 }) : c) });
  const n = RM.buildRuns(relabel("Transaction 1", "Run 5"), steps());
  assert.deepEqual([n.runs[0].label, n.runs[1].label], ["", ""], "the title's own words, or another run number, say nothing more");
  assert.equal(RM.buildRuns(relabel("Order 1", "Run 2 retry"), steps()).runs[1].label, "Run 2 retry", "a label with words of its own stays");
  assert.deepEqual(["Run 1", "transaction 12", "Transaction #3", "Order #10900", "Runway 5", "", null].map(RM.numberOnlyLabel),
    [true, true, true, false, false, false, false]);
});

test("buildRuns: a step with no case, or a case that is not a run, is outside runs (two of them)", () => {
  const m = RM.buildRuns(STATS, steps());
  assert.deepEqual(m.outside.map((s) => s.step_id), ["x1", "x2"]);
});

test("buildRuns: without case_stats the runs come from the steps' case ids", () => {
  const m = RM.buildRuns(null, steps());
  assert.deepEqual(m.runs.map((r) => r.caseId), ["c1", "c2", "stale-case"]);
  assert.deepEqual(m.outside.map((s) => s.step_id), ["x1"]);
});

test("buildRuns: zero, one and many steps", () => {
  assert.deepEqual(RM.buildRuns(STATS, []).runs.map((r) => r.members.length), [0, 0, 0]);
  assert.deepEqual(RM.buildRuns(null, []), { runs: [], outside: [] });
  const one = RM.buildRuns(STATS, [step("a1", "c1", "00:00", "00:10")]);
  assert.deepEqual(one.runs.map((r) => r.members.length), [1, 0, 0]);
});

/* ---- status and chips ------------------------------------------------------ */

test("runStatus: Draft while a visible step is a draft; Confirmed when every visible step is an analyst state", () => {
  assert.equal(RM.runStatus([{ state: "auto_suggested" }, { state: "edited" }]), "draft");
  assert.equal(RM.runStatus([{ state: "auto_matched" }]), "draft", "the legacy auto state is a draft");
  assert.equal(RM.runStatus([{ state: "confirmed" }, { state: "edited" }, { state: "manually_authored" }]), "confirmed");
  assert.equal(RM.runStatus([{ state: "confirmed" }, { state: "hidden" }]), "confirmed", "hidden steps do not count");
  assert.equal(RM.runStatus([{ state: "hidden" }, { state: "hidden" }]), "empty");
  assert.equal(RM.runStatus([]), "empty");
  assert.equal(RM.STATUS_LABELS.draft, "Draft");
});

test("stepChip: Draft, Confirmed, Edited, Added, Hidden", () => {
  assert.deepEqual(["auto_suggested", "confirmed", "edited", "manually_authored", "hidden", "auto_matched"]
    .map((s) => RM.stepChip(s).label), ["Draft", "Confirmed", "Edited", "Added", "Hidden", "Draft"]);
});

/* ---- containment and groups ------------------------------------------------ */

test("runForRange: the run that holds the start (C9 as lane FX1 amended it); an open run spans to the end", () => {
  const { runs } = RM.buildRuns(STATS, steps());
  const at = (a, b) => { const r = RM.runForRange(runs, Date.parse(T(a)), Date.parse(T(b))); return r && r.caseId; };
  assert.equal(at("00:05", "00:06"), "c1");
  assert.equal(at("03:00", "03:01"), "c2", "the end is inclusive");
  assert.equal(at("01:10", "01:20"), null, "between runs");
  assert.equal(at("00:50", "01:10"), "c1", "across a run's end: the run it started in");
  assert.equal(at("09:00", "09:30"), "c3", "an open run");
  assert.equal(RM.runForRange(runs, NaN), null, "no start: no run");
});

test("groupSteps and nextInGroup: the next row stays in the run and skips hidden steps unless they show", () => {
  const m = RM.buildRuns(STATS, steps());
  assert.deepEqual(RM.groupSteps(m, "c1", false).map((s) => s.step_id), ["a1", "a3"]);
  assert.deepEqual(RM.groupSteps(m, "c1", true).map((s) => s.step_id), ["a1", "a2", "a3"]);
  assert.deepEqual(RM.groupSteps(m, RM.OUTSIDE, false).map((s) => s.step_id), ["x1", "x2"]);
  assert.equal(RM.nextInGroup(m, "a1", false).step_id, "a3");
  assert.equal(RM.nextInGroup(m, "a1", true).step_id, "a2");
  assert.equal(RM.nextInGroup(m, "a3", false), null, "the last step of run 1 has no next (never run 2's first)");
  assert.equal(RM.nextInGroup(m, "x1", false).step_id, "x2");
  assert.equal(RM.groupKeyOf({ case_id: "stale-case" }, m.runs), RM.OUTSIDE);
});

/* ---- the pattern run (C3) --------------------------------------------------- */

test("patternRun: the default is the first run with a step; a stored case_id wins; a stale one falls back", () => {
  const emptyFirst = { case_stats: STATS.case_stats, meta: STATS.meta };
  const m = RM.buildRuns(emptyFirst, steps().filter((s) => s.case_id !== "c1"));
  assert.equal(RM.patternRun({}, m.runs).run.caseId, "c2", "run 1 has no step: run 2 is the default");
  assert.equal(RM.patternRun({}, m.runs).record, null, "the default is computed, not stored");
  const m2 = RM.buildRuns(STATS, steps());
  const anno = { pattern_run: { case_id: "c2", confirmed_at: null, draft_fixes: RM.emptyFixes() } };
  assert.equal(RM.patternRun(anno, m2.runs).run.caseId, "c2");
  assert.equal(RM.patternRun({ pattern_run: { case_id: "gone" } }, m2.runs).run.caseId, "c1");
  // Lane FX1: a run whose every step is hidden is passed over, as the PDD does.
  const hiddenFirst = steps().map((s) => (s.case_id === "c1" ? Object.assign({}, s, { state: "hidden" }) : s));
  assert.equal(RM.patternRun({}, RM.buildRuns(STATS, hiddenFirst).runs).run.caseId, "c2");
});

test("byStart: steps that start at one moment keep their list order (lane FX1), whatever their ids", () => {
  const at = { start: T("00:10"), end: T("00:10") };
  const list = [{ step_id: "z", time_range: at }, { step_id: "a", time_range: at }, { step_id: "m", time_range: { start: T("00:05") } }];
  assert.deepEqual(list.slice().sort(RM.byStart).map((s) => s.step_id), ["m", "z", "a"]);
  const { runs } = RM.buildRuns(STATS, [{ step_id: "z", case_id: "c1", time_range: at, state: "auto_suggested" },
    { step_id: "a", case_id: "c1", time_range: at, state: "auto_suggested" }]);
  assert.deepEqual(runs.find((r) => r.caseId === "c1").members.map((s) => s.step_id), ["z", "a"]);
});

test("recordFix: counts only on the unconfirmed pattern run, creates the record on the first fix", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  assert.equal(RM.recordFix(anno, runs, "c2", "merge"), false, "run 2 is not the pattern");
  assert.equal(anno.pattern_run, undefined, "nothing is written for a run that is not the pattern");
  assert.equal(RM.recordFix(anno, runs, "c1", "merge"), true);
  assert.deepEqual(anno.pattern_run, {
    case_id: "c1", confirmed_at: null,
    draft_fixes: { merge: 1, split: 0, add: 0, drop: 0 },
    drafted_steps: 3,
  });
  RM.recordFix(anno, runs, "c1", "split");
  RM.recordFix(anno, runs, "c1", "drop");
  RM.recordFix(anno, runs, "c1", "drop");
  RM.recordFix(anno, runs, "c1", "drop", -1);
  assert.deepEqual(anno.pattern_run.draft_fixes, { merge: 1, split: 1, add: 0, drop: 1 });
  assert.equal(RM.recordFix(anno, runs, "c1", "rename"), false, "a rename is not a boundary fix");
});

test("recordFix: an inverse never goes below zero and never creates the record", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  assert.equal(RM.recordFix(anno, runs, "c1", "add", -1), false);
  assert.equal(anno.pattern_run, undefined);
  RM.recordFix(anno, runs, "c1", "add");
  RM.recordFix(anno, runs, "c1", "add", -1);
  assert.equal(RM.recordFix(anno, runs, "c1", "add", -1), false);
  assert.equal(anno.pattern_run.draft_fixes.add, 0);
});

test("recordFix: nothing is counted once the pattern run is confirmed", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  RM.recordFix(anno, runs, "c1", "merge");
  RM.confirmRun(anno, runs, "c1", "2026-09-23T10:00:00.000Z");
  assert.equal(RM.recordFix(anno, runs, "c1", "merge"), false);
  assert.equal(anno.pattern_run.draft_fixes.merge, 1);
});

test("usePattern: another run becomes the pattern with fresh counters; choosing the pattern again keeps them", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  RM.recordFix(anno, runs, "c1", "merge");
  RM.usePattern(anno, runs, "c1");
  assert.equal(anno.pattern_run.draft_fixes.merge, 1, "the current pattern keeps its count");
  RM.usePattern(anno, runs, "c2");
  assert.deepEqual(anno.pattern_run, {
    case_id: "c2", confirmed_at: null, draft_fixes: RM.emptyFixes(), drafted_steps: 2,
  });
  assert.equal(RM.usePattern(anno, runs, "nope"), null);
});

test("confirmRun: the run's drafts become confirmed, nothing else changes; the pattern gets confirmed_at", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  const r = RM.confirmRun(anno, runs, "c1", "2026-09-23T10:00:00.000Z");
  assert.deepEqual(r, { converted: 2, patternConfirmed: true });
  const st = Object.fromEntries(anno.steps.map((s) => [s.step_id, s.state]));
  assert.deepEqual(st, { a3: "confirmed", a1: "confirmed", a2: "hidden", b1: "edited", b2: "confirmed",
    x1: "auto_suggested", x2: "auto_suggested" });
  assert.equal(anno.pattern_run.confirmed_at, "2026-09-23T10:00:00.000Z");
  RM.confirmRun(anno, runs, "c1", "2026-09-24T00:00:00.000Z");
  assert.equal(anno.pattern_run.confirmed_at, "2026-09-23T10:00:00.000Z", "confirming again keeps the first time");
});

test("confirmRun on a run that is not the pattern leaves pattern_run alone", () => {
  const anno = { steps: steps().concat([step("b3", "c2", "02:40", "02:50")]) };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  const r = RM.confirmRun(anno, runs, "c2", "2026-09-23T10:00:00.000Z");
  assert.deepEqual(r, { converted: 1, patternConfirmed: false });
  assert.equal(anno.pattern_run, undefined);
});

/* ---- the probe line --------------------------------------------------------- */

test("probeLine: N from the analysis, the four counts, the run named by its number only", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  RM.recordFix(anno, runs, "c1", "merge");
  const p = RM.probeLine(STATS, runs, runs[0], anno.pattern_run);
  assert.equal(p.text, "Transaction 1: 3 drafted steps, 1 boundary fix (merge 1, split 0, add 0, hide 0)");
  assert.equal(p.source, "analysis");
  RM.recordFix(anno, runs, "c1", "drop");
  assert.equal(RM.probeLine(STATS, runs, runs[0], anno.pattern_run).text,
    "Transaction 1: 3 drafted steps, 2 boundary fixes (merge 1, split 0, add 0, hide 1)");
});

test("probeLine: without draft_summary it falls back to the count stored when the run became the pattern", () => {
  const anno = { steps: steps() };
  const noSummary = { case_stats: STATS.case_stats, meta: {} };
  const { runs } = RM.buildRuns(noSummary, anno.steps);
  RM.usePattern(anno, runs, "c2");
  const p = RM.probeLine(noSummary, runs, runs[1], anno.pattern_run);
  assert.equal(p.source, "designation");
  assert.equal(p.text, "Transaction 2: 2 drafted steps, 0 boundary fixes (merge 0, split 0, add 0, hide 0)");
  const none = RM.probeLine(noSummary, runs, runs[1], { draft_fixes: {} });
  assert.equal(none.text, "Transaction 2: drafted steps not recorded, 0 boundary fixes (merge 0, split 0, add 0, hide 0)");
});

test("probeLine: a draft_summary for a different set of runs is not trusted", () => {
  const stale = { case_stats: STATS.case_stats, meta: { draft_summary: { runs: 2, steps_per_run: [9, 9] } } };
  const { runs } = RM.buildRuns(stale, steps());
  const p = RM.probeLine(stale, runs, runs[0], { drafted_steps: 4, draft_fixes: {} });
  assert.equal(p.drafted, 4);
  assert.equal(p.source, "designation");
});

/* ---- names (C4) ---------------------------------------------------------------- */

/* The draft_key's screen part contains "|" on purpose: the key is compared
   whole, never split. */
const KEY = "chrome|Case | Queue view|Button:save";

test("propagateName: every other still-draft step with the same key takes the name (two of them)", () => {
  const renamed = step("r1", "c1", "00:00", "00:10", { draft_key: KEY, state: "edited" });
  const list = [
    renamed,
    step("r2", "c2", "02:00", "02:10", { draft_key: KEY, name_source: "draft" }),
    step("r3", "c3", "04:00", "04:10", { draft_key: KEY, name_source: "draft" }),
    step("e1", "c2", "02:20", "02:30", { draft_key: KEY, state: "edited", name: "Kept" }),
    step("c9", "c2", "02:40", "02:50", { draft_key: KEY, state: "confirmed", name: "Also kept" }),
    step("h1", "c2", "02:50", "02:55", { draft_key: KEY, state: "hidden", name: "Hidden kept" }),
    step("o1", "c2", "02:55", "02:58", { draft_key: "chrome|Case |Other", name: "Other key" }),
  ];
  assert.equal(RM.propagateName(list, renamed, "  Save the case  "), 2);
  const by = Object.fromEntries(list.map((s) => [s.step_id, s]));
  for (const id of ["r2", "r3"]) {
    assert.equal(by[id].name, "Save the case");
    assert.equal(by[id].state, "auto_suggested", "a propagated name leaves the step a draft");
    assert.equal(by[id].name_source, "remembered");
    assert.equal(by[id].process_label, "Save the case");
  }
  assert.deepEqual(["e1", "c9", "h1", "o1"].map((id) => by[id].name), ["Kept", "Also kept", "Hidden kept", "Other key"]);
});

test("propagateName: a step without a draft_key, or a blank name, changes nothing", () => {
  const list = [step("a", "c1", "00:00", "00:01"), step("b", "c2", "02:00", "02:01", { draft_key: KEY })];
  assert.equal(RM.propagateName(list, list[0], "X"), 0);
  assert.equal(RM.propagateName(list, { step_id: "z", draft_key: KEY }, "   "), 0);
  assert.equal(list[1].name, "Step b");
});

test("nameSuggestions: the names used in the project, the names the analyst gave first, no duplicates, no hidden step's", () => {
  const list = [
    step("s", "c1", "00:00", "00:10"),
    step("d1", "c1", "00:20", "00:30", { name: "Draft name" }),
    step("e1", "c2", "02:00", "02:10", { name: "Given name", state: "edited" }),
    step("e2", "c2", "02:20", "02:30", { name: "draft NAME", state: "manually_authored" }),
    step("h1", "c2", "02:40", "02:50", { name: "Hidden name", state: "hidden" }),
  ];
  assert.deepEqual(RM.nameSuggestions(list), ["Given name", "draft NAME", "Step s"]);
  assert.deepEqual(RM.nameSuggestions(null), []);
});

test("dropDraftIdentity: a merged or split step loses draft_key, draft_keys, name_source and end_reason", () => {
  const s = { step_id: "m", draft_key: KEY, name_source: "draft", end_reason: "commit", name: "Kept" };
  RM.dropDraftIdentity(s);
  assert.deepEqual(s, { step_id: "m", name: "Kept" });
  const half = { step_id: "h", draft_keys: ["a", "b"], name: "Half" };
  RM.dropDraftIdentity(half);
  assert.deepEqual(half, { step_id: "h", name: "Half" }, "a split half of a merge is no merge of drafts");
  const named = { step_id: "n", draft_key: KEY, library_activity: "sales-create-order", name: "Create order (split 1)" };
  RM.dropDraftIdentity(named);
  assert.deepEqual(named, { step_id: "n", name: "Create order (split 1)" }, "C21: a split or merged step is not named from the library any more");
});

/* ---- Reopen run (item 4) ------------------------------------------------------------ */

test("reopenRun: confirmed steps are drafts again, edited and added ones keep their state; the pattern loses confirmed_at, not its counts", () => {
  const anno = { steps: steps().concat([
    step("a4", "c1", "00:52", "00:55", { state: "manually_authored" }),
    step("a5", "c1", "00:56", "00:58", { state: "hidden", _prev_state: "auto_suggested" }),
    step("a6", "c1", "00:58", "00:59"),
  ]) };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  RM.recordFix(anno, runs, "c1", "merge");
  anno.steps.find((s) => s.step_id === "a3").state = "edited";
  RM.confirmRun(anno, runs, "c1", "2026-09-23T10:00:00.000Z");
  anno.steps.find((s) => s.step_id === "a1").state = "hidden";
  anno.steps.find((s) => s.step_id === "a1")._prev_state = "confirmed";
  const before = JSON.stringify(anno.pattern_run.draft_fixes);
  const { runs: runs2 } = RM.buildRuns(STATS, anno.steps);
  assert.equal(RM.canReopen(runs2[0], anno.pattern_run, true), true);
  const r = RM.reopenRun(anno, runs2, "c1");
  assert.deepEqual(r, { reopened: 1, patternReopened: true });
  const by = Object.fromEntries(anno.steps.map((s) => [s.step_id, s]));
  assert.equal(by.a6.state, "auto_suggested", "the confirmed draft is a draft again");
  assert.equal(by.a5.state, "hidden");
  assert.equal(by.a1._prev_state, "auto_suggested", "a hidden confirmed step unhides as a draft");
  assert.equal(by.a3.state, "edited");
  assert.equal(by.a4.state, "manually_authored");
  assert.equal(by.a2.state, "hidden");
  assert.equal(anno.pattern_run.confirmed_at, null);
  assert.equal(JSON.stringify(anno.pattern_run.draft_fixes), before, "the draft-fix counts are kept");
  assert.equal(RM.recordFix(anno, runs2, "c1", "split"), true, "the reopened pattern counts fixes again");
});

test("reopenRun on another run turns its confirmed steps back and leaves pattern_run alone; canReopen needs confirmed steps", () => {
  const anno = { steps: steps() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  assert.equal(RM.canReopen(runs[1], null, false), true, "run 2 reads Confirmed and has a confirmed step");
  const r = RM.reopenRun(anno, runs, "c2");
  assert.deepEqual(r, { reopened: 1, patternReopened: false });
  assert.equal(anno.steps.find((s) => s.step_id === "b2").state, "auto_suggested");
  assert.equal(anno.steps.find((s) => s.step_id === "b1").state, "edited");
  assert.equal(anno.pattern_run, undefined);
  const edited = RM.buildRuns(STATS, [step("e", "c2", "02:00", "02:10", { state: "edited" })]).runs[1];
  assert.equal(RM.canReopen(edited, null, false), false, "nothing confirmed to turn back");
  assert.equal(RM.canReopen(runs[0], { confirmed_at: null }, true), false, "an unconfirmed pattern run");
});

/* ---- carried boundary fixes (item 2) and merged draft keys (item 1) --------------- */

const K = { find: "crm|Orders|Button:find", check: "sap|va01|MenuItem:check", create: "sap|va01|Button:create",
  note: "notepad|Mappings|(visit)", send: "mail|Compose|Button:send" };

test("mergedDraftKeys: the members' keys in order, a merged member's keys flattened; none with a member added by hand", () => {
  assert.deepEqual(RM.mergedDraftKeys([{ draft_key: K.check }, { draft_key: K.create }]), [K.check, K.create]);
  assert.deepEqual(RM.mergedDraftKeys([{ draft_keys: [K.find, K.check] }, { draft_key: K.create }]), [K.find, K.check, K.create]);
  assert.equal(RM.mergedDraftKeys([{ draft_key: K.check }, { name: "Added" }]), null);
  assert.equal(RM.mergedDraftKeys([]), null);
});

function carryFixture() {
  const d = (id, c, s, key, extra) => step(id, c, s, s.replace(/:(\d\d)$/, (m, x) => ":" + String(Number(x) + 5).padStart(2, "0")), Object.assign({ draft_key: key }, extra || {}));
  return [
    d("p1", "c1", "00:00", K.find), d("p2", "c1", "00:10", K.check), d("p3", "c1", "00:20", K.create), d("p4", "c1", "00:30", K.send),
    // Run 2 does the pair twice around a Notepad visit: two stretches.
    d("r1", "c2", "02:00", K.check), d("r2", "c2", "02:10", K.create), d("r3", "c2", "02:20", K.note),
    d("r4", "c2", "02:30", K.check), d("r5", "c2", "02:40", K.create),
    // Run 3: the analyst renamed the check (edited): not still a draft, no carry; a hidden
    // step between two drafts does not break a stretch (the list does not show it).
    d("s1", "c3", "04:00", K.check, { state: "edited", name: "Checked by hand" }), d("s2", "c3", "04:10", K.create),
    d("s3", "c3", "04:20", K.check), d("s4", "c3", "04:30", K.find, { state: "hidden" }), d("s5", "c3", "04:40", K.create),
  ];
}

test("carriedMerges: every other run's stretches of still-drafts that read the merged keys, never the pattern run", () => {
  const model = RM.buildRuns(STATS, carryFixture());
  const got = RM.carriedMerges(model, "c1", [K.check, K.create]);
  assert.deepEqual(got.map((g) => [g.caseId, g.steps.map((s) => s.step_id)]),
    [["c2", ["r1", "r2"]], ["c2", ["r4", "r5"]], ["c3", ["s3", "s5"]]]);
  assert.equal(RM.runCount(got), 2);
  assert.deepEqual(RM.carriedMerges(model, "c1", [K.check]), [], "a single key is no merge");
  assert.deepEqual(RM.carriedMerges(model, "c1", [K.check, K.note]), [], "the keys are read in order");
  assert.deepEqual(RM.carriedMerges(model, "c1", [K.note, K.check]).map((g) => g.steps.map((s) => s.step_id)), [["r3", "r4"]]);
  assert.deepEqual(RM.carriedMerges(model, "c1", [K.check, K.create, K.note]).map((g) => g.steps.map((s) => s.step_id)),
    [["r1", "r2", "r3"]]);
});

test("sameKeyDraftsElsewhere and hideSteps: the other runs' visible drafts with the key, hidden with their state kept", () => {
  const model = RM.buildRuns(STATS, carryFixture());
  const got = RM.sameKeyDraftsElsewhere(model, "c2", K.check);
  assert.deepEqual(got.map((s) => s.step_id), ["p2", "s3"], "not run 2's own, not the edited one");
  RM.hideSteps(got);
  assert.deepEqual(got.map((s) => [s.state, s._prev_state]), [["hidden", "auto_suggested"], ["hidden", "auto_suggested"]]);
  assert.deepEqual(RM.sameKeyDraftsElsewhere(model, "c2", ""), []);
});

/* ---- Sub-processes (contract C19): every level of a transaction ----------- */

/* Run c1 with a sub-process: a1 opened (two drafted sub-steps, one of which
   is itself opened), a hidden step with a draft under it. */
function nested() {
  const list = steps();
  const a1 = list.find((s) => s.step_id === "a1");
  a1.state = "edited";
  a1.sub_steps = [
    step("s1", "c1", "00:01", "00:02", { action_key: "chrome|Order|enter:qty", name: "Enter Quantity" }),
    step("s2", "c1", "00:03", "00:04", { state: "edited", sub_steps: [step("q1", "c1", "00:03", "00:04", { action_key: "chrome|Order|click:ok" })] }),
  ];
  const a2 = list.find((s) => s.step_id === "a2");
  a2.sub_steps = [step("h1", "c1", "00:21", "00:22")];
  return list;
}

test("C19 runStatus, holdsDraft and patternConfirmed: a transaction reads confirmed only when no visible level holds a draft", () => {
  const list = nested();
  const { runs } = RM.buildRuns(STATS, list);
  const c1 = runs.find((r) => r.caseId === "c1");
  list.find((s) => s.step_id === "a3").state = "confirmed";
  assert.equal(RM.runStatus(c1.members), "draft", "the sub-steps are drafts");
  assert.equal(RM.holdsDraft(c1.members), true);
  for (const id of ["s1", "q1"]) RM.visibleTree(list).find((s) => s.step_id === id).state = "confirmed";
  assert.equal(RM.runStatus(c1.members), "confirmed", "the draft under a hidden step does not count");
  assert.equal(RM.holdsDraft(c1.members), false);
  assert.ok(!RM.visibleTree(list).some((s) => s.step_id === "h1"), "a hidden step's sub-steps are not visible");
  const rec = { case_id: "c1", confirmed_at: "2026-09-24T10:00:00Z" };
  assert.equal(RM.patternConfirmed(rec, c1), true);
  RM.visibleTree(list).find((s) => s.step_id === "q1").state = "auto_suggested";
  assert.equal(RM.patternConfirmed(rec, c1), false, "a draft at any level: it reads Draft again");
  assert.equal(RM.patternConfirmed({ case_id: "c1", confirmed_at: null }, c1), false);
  // The main level reads its record, as before sub-processes.
  RM.visibleTree(list).find((s) => s.step_id === "q1").state = "confirmed";
  list.find((s) => s.step_id === "a3").state = "auto_suggested";
  assert.equal(RM.patternConfirmed(rec, c1), true, "a draft at the main level leaves the record as it reads");
});

test("C19 confirmRun and reopenRun cascade to every level of the transaction", () => {
  const anno = { steps: nested() };
  const { runs } = RM.buildRuns(STATS, anno.steps);
  const r = RM.confirmRun(anno, runs, "c1", "2026-09-24T10:00:00Z");
  const all = () => {
    const out = {};
    const walk = (l) => { for (const s of l) { out[s.step_id] = s.state; if (s.sub_steps) walk(s.sub_steps); } };
    walk(anno.steps);
    return out;
  };
  assert.equal(r.converted, 4, "a3, s1, q1 and the draft under the hidden step, nothing of the other runs");
  const st = all();
  assert.deepEqual([st.a1, st.a3, st.s1, st.s2, st.q1, st.h1, st.a2], ["edited", "confirmed", "confirmed", "edited", "confirmed", "confirmed", "hidden"]);
  assert.equal(st.x1, "auto_suggested");
  assert.equal(RM.runStatus(runs.find((x) => x.caseId === "c1").members), "confirmed");
  const back = RM.reopenRun(anno, runs, "c1");
  assert.equal(back.reopened, 4);
  const st2 = all();
  assert.deepEqual([st2.a3, st2.s1, st2.s2, st2.q1, st2.h1], ["auto_suggested", "auto_suggested", "edited", "auto_suggested", "auto_suggested"]);
});

test("C19 dropDraftIdentity: a merged or split sub-step is no longer one drafted action", () => {
  const s = RM.dropDraftIdentity({ action_key: "a|b|enter:c", name_source: "action" });
  assert.equal(s.action_key, undefined);
  assert.equal(s.name_source, undefined);
});


test("propagateMergedName: a merged step's new name reaches the same merge elsewhere that kept the old name", () => {
  const RM = require("./runs-model.js");
  const keys = ["chrome|Salesforce|Button:search", "chrome|Salesforce|Button:open"];
  const a = { step_id: "a", state: "edited", name: "Search + Open", draft_keys: keys.slice() };
  const b = { step_id: "b", state: "edited", name: "Search + Open", draft_keys: keys.slice() };
  const c = { step_id: "c", state: "edited", name: "Named by hand", draft_keys: keys.slice() };
  const d = { step_id: "d", state: "edited", name: "Search + Open", draft_keys: [keys[1], keys[0]] };
  const steps = [a, b, c, d];
  a.name = "Find the customer";
  const n = RM.propagateMergedName(steps, a, "Search + Open", "Find the customer");
  assert.strictEqual(n, 1);
  assert.strictEqual(b.name, "Find the customer");
  assert.strictEqual(c.name, "Named by hand");
  assert.strictEqual(d.name, "Search + Open");
});
