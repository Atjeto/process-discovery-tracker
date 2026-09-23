"use strict";
/*
 * Contract C12 on the Overview (RP-10): a pipeline stage that failed is named
 * in analysis.json stage_errors and its output key is null. The Overview must
 * say the check could not run; it must never render that as a measured
 * negative (a zero, "Nothing stood out").
 *
 * Fixture sessions go through overviewHtml, the same pure builder
 * renderOverviewLevel writes into the page. Each failure fixture has a
 * control that ran and measured the "negative" honestly, so the tests prove
 * the two states render differently (not merely that a string exists).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { overviewHtml, mapLockHtml, STAGE_NOT_RUN, NO_RUNS_MARKED } = require("./views/overview-view.js");

const CQ = { mode: "markers", case_count: 4, coverage: 0.9, tier2_unlocked: true };
const FACTS = {
  active_ms: 120000, session_span_ms: 180000, idle_ms: 5000, app_switches: 12, switches_per_hour: 30,
  longest_focus_ms: 40000, rekey_count: 2, repeated_sequence_count: 3,
  top_apps: [{ app: "Excel", share: 0.5 }], app_time_source: "focus",
};
const ZERO_FACTS = Object.assign({}, FACTS, {
  active_ms: 0, idle_ms: 0, app_switches: 0, switches_per_hour: 0, longest_focus_ms: 0,
  rekey_count: 0, repeated_sequence_count: 0,
});
const FINDING = { id: "f1", detector: "screen_time_sink", tier: 1, claim: "Most time went to Excel", evidence: { share: 0.5 } };
// What the pipeline writes beside the findings (F2): the findings the PDD can print and prints by default.
const PDD = { eligible: ["f1"], default: ["f1"] };
const STATS = {
  meta: { worker_id: "w1", normalization_run_at: "2026-05-17T10:00:00Z" },
  case_stats: [{ case_id: "c1", start_ts: "2026-05-17T09:00:00Z", end_ts: "2026-05-17T09:05:00Z" }],
};

const html = (analysis, anno) => overviewHtml({ analysis, annotations: anno || {}, stats: STATS });

test("a failed facts stage says the facts could not be measured, never a zero", () => {
  const out = html({ case_quality: CQ, facts: null, findings: [FINDING],
    stage_errors: [{ stage: "facts", error: "KeyError: 'duration_ms'" }] });
  assert.ok(out.includes(STAGE_NOT_RUN + ": the measured facts"), "the facts gap is said");
  assert.ok(out.includes("are missing, not zero."));
  assert.ok(out.includes("Technical detail: KeyError: &#39;duration_ms&#39;"), "the reason is shown, escaped");
  assert.ok(!out.includes("No idle time was measured"), "no idle-time gap is claimed from a failed stage");
});

test("control: facts that ran and measured zeros carry no could-not-run note", () => {
  const out = html({ case_quality: CQ, facts: ZERO_FACTS, findings: [FINDING], pdd_findings: PDD });
  assert.ok(!out.includes(STAGE_NOT_RUN));
  // P1.4: the "To say more" box is gone, so a measured zero is not restated there either.
  assert.ok(!out.includes("To say more") && !out.includes("No idle time was measured"));
  assert.ok(out.includes("Most time went to Excel"), "the finding is shown");
});

test("a failed findings stage says the check could not run, never 'Nothing stood out'", () => {
  const out = html({ case_quality: CQ, facts: FACTS, findings: null,
    stage_errors: [{ stage: "findings", error: "not run: depends on failed stage(s) motifs" }] });
  assert.ok(out.includes(STAGE_NOT_RUN + ", so it cannot say whether anything stood out."));
  assert.ok(!/Nothing stood out/i.test(out));
  assert.ok(out.includes("Technical detail: not run: depends on failed stage(s) motifs"));
});

test("control: findings that ran and found nothing still say 'Nothing stood out'", () => {
  const out = html({ case_quality: CQ, facts: FACTS, findings: [] });
  assert.ok(/Nothing stood out/.test(out));
  assert.ok(!out.includes(STAGE_NOT_RUN));
});

test("a failed run check is said on the Overview, not read as 'not analyzed'", () => {
  const out = html({ case_quality: null, facts: FACTS, findings: [FINDING], pdd_findings: PDD,
    stage_errors: [{ stage: "case_quality", error: "TypeError: bad marker" }] });
  assert.ok(out.includes("The run check could not run on this recording"));
  assert.ok(out.includes("Technical detail: TypeError: bad marker"));
  assert.ok(!out.includes("No analysis yet"));
  assert.ok(out.includes("Most time went to Excel"), "the findings that did run are still shown");
  const never = overviewHtml({ analysis: { meta: {} }, annotations: {} });
  assert.ok(never.includes("No analysis yet"), "control: an analysis without the blocks is 'not analyzed yet'");
});

/* ---- The Map level's lock message (item 2 fix) --------------------------- */

test("the map lock says what actually happened: not analyzed, older analysis, or a failed run check", () => {
  const lead = "The process map is not shown because it draws how the runs flow.";
  const none = mapLockHtml(null);
  assert.ok(none.startsWith(lead) && none.includes("has not been analyzed yet"), none);
  const failed = mapLockHtml({ case_quality: null, stage_errors: [{ stage: "case_quality", error: "TypeError: x" }] });
  assert.ok(failed.includes("The run check could not run on this recording"), failed);
  assert.ok(!failed.includes("not been analyzed"), "a failed check is not 'not analyzed yet'");
  assert.ok(failed.includes("Technical detail: TypeError: x"));
  const older = mapLockHtml({ meta: {} });
  assert.ok(older.includes("analyzed by an older version") && !older.includes("not been analyzed"), older);
});

test("the map lock names the missing runs and offers the mark-runs verb; unlocked means no lock", () => {
  const noRuns = mapLockHtml({ case_quality: { mode: "unsegmented", case_count: 0, coverage: 0, tier2_unlocked: false } });
  assert.ok(noRuns.includes(NO_RUNS_MARKED));
  assert.ok(noRuns.includes('data-map-cta="mark-runs"'), "the lock carries the mark-runs button");
  const one = mapLockHtml({ case_quality: { mode: "markers", case_count: 1, coverage: 1, tier2_unlocked: false } });
  assert.ok(one.includes("Only one run is marked"), one);
  const thin = mapLockHtml({ case_quality: { mode: "markers", case_count: 3, coverage: 0.5, tier2_unlocked: false } });
  assert.ok(thin.includes("cover only 50% of the recording"), thin);
  assert.equal(mapLockHtml({ case_quality: CQ }), null);
});
