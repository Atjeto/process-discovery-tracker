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
  assert.deepEqual(m.runs.map((r) => [r.caseId, r.ordinal, r.title]),
    [["c1", 1, "Run 1"], ["c2", 2, "Run 2"], ["c3", 3, "Run 3"]]);
  assert.deepEqual(m.runs[0].members.map((s) => s.step_id), ["a1", "a2", "a3"]);
  assert.deepEqual(m.runs[0].visible.map((s) => s.step_id), ["a1", "a3"]);
  assert.equal(m.runs[0].hiddenCount, 1);
  assert.equal(m.runs[1].durationMs, 60000);
  assert.equal(m.runs[2].endMs, null, "a run left open has no end");
});

test("buildRuns: a marker label that only repeats the run number is not shown twice", () => {
  const m = RM.buildRuns(STATS, steps());
  assert.equal(m.runs[0].label, "", "\"Run 1\" is the title already");
  assert.equal(m.runs[1].label, "Order 2");
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

test("runForRange: the run whose span holds the range; an open run spans to the end", () => {
  const { runs } = RM.buildRuns(STATS, steps());
  const at = (a, b) => { const r = RM.runForRange(runs, Date.parse(T(a)), Date.parse(T(b))); return r && r.caseId; };
  assert.equal(at("00:05", "00:06"), "c1");
  assert.equal(at("02:59", "03:00"), "c2", "the end is inclusive");
  assert.equal(at("01:10", "01:20"), null, "between runs");
  assert.equal(at("00:50", "01:10"), null, "crossing a run's end");
  assert.equal(at("09:00", "09:30"), "c3", "an open run");
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
  assert.equal(p.text, "Run 1: 3 drafted steps, 1 boundary fix (merge 1, split 0, add 0, drop 0)");
  assert.equal(p.source, "analysis");
  RM.recordFix(anno, runs, "c1", "drop");
  assert.equal(RM.probeLine(STATS, runs, runs[0], anno.pattern_run).text,
    "Run 1: 3 drafted steps, 2 boundary fixes (merge 1, split 0, add 0, drop 1)");
});

test("probeLine: without draft_summary it falls back to the count stored when the run became the pattern", () => {
  const anno = { steps: steps() };
  const noSummary = { case_stats: STATS.case_stats, meta: {} };
  const { runs } = RM.buildRuns(noSummary, anno.steps);
  RM.usePattern(anno, runs, "c2");
  const p = RM.probeLine(noSummary, runs, runs[1], anno.pattern_run);
  assert.equal(p.source, "designation");
  assert.equal(p.text, "Run 2: 2 drafted steps, 0 boundary fixes (merge 0, split 0, add 0, drop 0)");
  const none = RM.probeLine(noSummary, runs, runs[1], { draft_fixes: {} });
  assert.equal(none.text, "Run 2: drafted steps not recorded, 0 boundary fixes (merge 0, split 0, add 0, drop 0)");
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

test("stepApp: the process name of the first interaction, lowercased, without .exe", () => {
  const inter = { "a-e1": { data: { process_name: "Chrome.EXE" } }, "b-e1": { data: {} }, "b-e2": { data: { process_name: "saplogon" } } };
  assert.equal(RM.stepApp({ evidence: { interaction_event_ids: ["a-e1"] } }, inter), "chrome");
  assert.equal(RM.stepApp({ evidence: { interaction_event_ids: ["b-e1", "b-e2"] } }, inter), "saplogon");
  assert.equal(RM.stepApp({ evidence: { interaction_event_ids: [] } }, inter), "");
  assert.equal(RM.stepApp({}, inter), "");
});

test("nameSuggestions: same-app remembered names first (newest first), then the session's names, no duplicates", () => {
  const inter = { "s-e1": { data: { process_name: "chrome.exe" } } };
  const target = step("s", "c1", "00:00", "00:10", { evidence: { interaction_event_ids: ["s-e1"] } });
  const remembered = {
    [KEY]: { name: "Save the case", updated_at: "2026-09-20T10:00:00.000Z" },
    "chrome|Other | screen|(visit)": { name: "Browse the queue", updated_at: "2026-09-21T10:00:00.000Z" },
    "chromium|Look alike|Button:x": { name: "Not this app", updated_at: "2026-09-22T10:00:00.000Z" },
    "excel|Book|Button:save": { name: "Save workbook", updated_at: "2026-09-22T10:00:00.000Z" },
  };
  const list = [
    target,
    step("d1", "c1", "00:20", "00:30", { name: "Draft name" }),
    step("e1", "c2", "02:00", "02:10", { name: "Given name", state: "edited" }),
    step("e2", "c2", "02:20", "02:30", { name: "save the case", state: "manually_authored" }),
    step("h1", "c2", "02:40", "02:50", { name: "Hidden name", state: "hidden" }),
  ];
  const got = RM.nameSuggestions(list, target, remembered, inter);
  assert.deepEqual(got, ["Browse the queue", "Save the case", "Given name", "Step s", "Draft name"]);
});

test("dropDraftIdentity: a merged or split step loses draft_key, name_source and end_reason", () => {
  const s = { step_id: "m", draft_key: KEY, name_source: "draft", end_reason: "commit", name: "Kept" };
  RM.dropDraftIdentity(s);
  assert.deepEqual(s, { step_id: "m", name: "Kept" });
});
