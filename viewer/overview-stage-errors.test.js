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
const { overviewHtml, mapLockHtml, mapEmptyText, waitingSentence, STAGE_NOT_RUN, NO_RUNS_MARKED, NO_STEPS_YET } =
  require("./views/overview-view.js");

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
const FINDING = { id: "f1", detector: "rekey_transfer", tier: 1, claim: "1 value was typed into more than one app.",
  evidence: { rekey_count: 1, values: [] } };
const STATS = {
  meta: { worker_id: "w1", normalization_run_at: "2026-05-17T10:00:00Z" },
  case_stats: [{ case_id: "c1", start_ts: "2026-05-17T09:00:00Z", end_ts: "2026-05-17T09:05:00Z" }],
};

const html = (analysis, anno) => overviewHtml({ analysis, annotations: anno || {}, stats: STATS });

test("the facts are no longer shown on the Overview, so a failed facts stage claims nothing there", () => {
  const out = html({ case_quality: CQ, facts: null, findings: [FINDING],
    stage_errors: [{ stage: "facts", error: "KeyError: 'duration_ms'" }] });
  assert.ok(!out.includes("the measured facts") && !out.includes("No idle time was measured"));
  const control = html({ case_quality: CQ, facts: ZERO_FACTS, findings: [FINDING] });
  assert.ok(!control.includes(STAGE_NOT_RUN), "control: nothing could-not-run when the checks ran");
  assert.ok(!control.includes("To say more"));
});

/* The PDD's sections 5 and 6 as analysis.json carries them (lane CC): no
   field entry, no transaction marked, one system without a time. */
const NO_ENTRIES = { heading: "Data", note: "No field entries were recorded in the steps of this process.",
  header: ["Field", "System and screen", "Step", "Example value", "Re-keyed"], rows: [], rekeyed: [] };
const TIMES = { heading: "Applications and time",
  per_transaction: { heading: "Time per transaction", note: "One transaction (not marked), so there is no time per transaction.",
    header: ["Transaction", "Steps", "Active time", "Elapsed time"], rows: [], after: null },
  per_application: { heading: "Time in each application", note: null, header: ["System", "Screens", "Steps"],
    rows: [["Phone", "", "Call the customer"]] } };

test("a failed rows stage makes Data and Applications and time say they could not run, never an empty table", () => {
  const out = html({ case_quality: CQ, facts: FACTS, findings: [], pdd_data: null, pdd_time: null,
    stage_errors: [{ stage: "pdd_rows", error: "KeyError: 'rows'" }] });
  assert.ok(out.includes(STAGE_NOT_RUN + ", so the fields entered are not listed."));
  assert.ok(out.includes(STAGE_NOT_RUN + ", so the times are not measured."));
  assert.ok(!out.includes("No field entries were recorded"));
  assert.ok(!out.includes('class="ov-rows"'));
});

test("control: rows that ran and found no field entry say the PDD's own sentence, not that the check could not run", () => {
  const out = html({ case_quality: CQ, facts: FACTS, findings: [], pdd_data: NO_ENTRIES, pdd_time: TIMES, stage_errors: [] });
  assert.ok(out.includes("No field entries were recorded in the steps of this process."));
  assert.ok(out.includes("One transaction (not marked), so there is no time per transaction."));
  assert.ok(!out.includes(STAGE_NOT_RUN));
  // A failed findings stage no longer touches the Observations: they read the PDD's rows.
  const findingsFailed = html({ case_quality: CQ, facts: FACTS, findings: null, pdd_data: NO_ENTRIES, pdd_time: TIMES,
    stage_errors: [{ stage: "findings", error: "not run: depends on failed stage(s) motifs" }] });
  assert.ok(!findingsFailed.includes(STAGE_NOT_RUN) && findingsFailed.includes("No field entries were recorded"));
});

test("a failed run check is said on the Overview, not read as 'not analyzed'", () => {
  const out = html({ case_quality: null, facts: FACTS, findings: [FINDING],
    stage_errors: [{ stage: "case_quality", error: "TypeError: bad marker" }] });
  assert.ok(out.includes("The transaction check could not run on this recording, so the transactions are not compared"));
  assert.ok(out.includes("Technical detail: TypeError: bad marker"));
  assert.ok(!out.includes("not analyzed yet"));
  assert.ok(out.includes("Help, Troubleshooting has Re-analyze"), "where to run it again");
  assert.ok(!out.includes("Analyze session"), "no global Analyze button to point at");
  const never = overviewHtml({ analysis: { meta: {} }, annotations: {} });
  assert.ok(never.includes("This project is not analyzed yet."), "control: an analysis without the blocks is 'not analyzed yet'");
});

test("before an analysis the Overview says where it is: running, failed, cancelled or not run; and keeps the project line", () => {
  const sess = { analysis: null, annotations: {}, manifest: { engagement_id: "eng-1",
    config: { worker: { id: "w1" } } }, sessionFolder: "S" };
  const running = overviewHtml(sess, { folder: "S", status: "running" });
  assert.ok(running.includes("The steps and the map are being drafted from the recording."));
  assert.ok(running.includes('id="ov-summary"') && running.includes('id="btn-attach-video"') &&
    running.includes('id="btn-attach-transcript"'), "the project line and its acts are there before the analysis");
  assert.ok(!running.includes('id="ov-next"'), "no path before the runs are known");
  assert.ok(overviewHtml(sess, { folder: "S", status: "failed" }).includes("The analysis failed, so the steps and the map are not drafted. The log at the top says why"));
  assert.ok(overviewHtml(sess, { folder: "S", status: "cancelled" }).includes("The analysis was cancelled"));
  assert.ok(overviewHtml(sess, null).includes("This project is not analyzed yet. Help, Troubleshooting has Re-analyze."));
  assert.ok(waitingSentence(null, true).startsWith("This project was analyzed by an older version"));
});

/* ---- The Map level's lock message (item 2 fix) --------------------------- */

test("the map lock says what actually happened: being analyzed, not analyzed, older analysis, or a failed run check", () => {
  const lead = "The process map is not shown because it draws how the transactions flow.";
  const none = mapLockHtml(null);
  assert.ok(none.startsWith(lead) && none.includes("not analyzed yet"), none);
  assert.ok(mapLockHtml(null, { status: "running" }).includes("being drafted from the recording"));
  assert.ok(mapLockHtml(null, { status: "failed" }).includes("The analysis failed"));
  const failed = mapLockHtml({ case_quality: null, stage_errors: [{ stage: "case_quality", error: "TypeError: x" }] });
  assert.ok(failed.includes("The transaction check could not run on this recording, so the transactions are not known"), failed);
  assert.ok(!failed.includes("not analyzed yet"), "a failed check is not 'not analyzed yet'");
  assert.ok(failed.includes("Technical detail: TypeError: x"));
  const older = mapLockHtml({ meta: {} });
  assert.ok(older.includes("analyzed by an older version") && !older.includes("not analyzed yet"), older);
  for (const out of [none, failed, older]) assert.ok(!out.includes("Analyze session"), "no global Analyze button to point at");
});

test("the map lock names the missing runs and offers the mark-runs verb; unlocked means no lock", () => {
  const noRuns = mapLockHtml({ case_quality: { mode: "unsegmented", case_count: 0, coverage: 0, tier2_unlocked: false } });
  assert.ok(noRuns.includes(NO_RUNS_MARKED));
  assert.ok(noRuns.includes('data-map-cta="mark-runs"'), "the lock carries the mark-runs button");
  assert.equal(mapLockHtml({ case_quality: CQ }), null);
});

test("AD-18: one marked run is enough for the map, and so is any coverage", () => {
  assert.equal(mapLockHtml({ case_quality: { mode: "markers", case_count: 1, coverage: 1, tier2_unlocked: false } }), null,
    "a one-run recording gets its map");
  assert.equal(mapLockHtml({ case_quality: { mode: "markers", case_count: 3, coverage: 0.5, tier2_unlocked: false } }), null,
    "runs that cover half the recording still draw");
  assert.ok(mapLockHtml({ case_quality: { mode: "markers", case_count: 0, coverage: 0, tier2_unlocked: false } })
    .includes(NO_RUNS_MARKED), "no run counted is still no runs marked");
});

test("a project with no steps yet: the Map says to add steps, never that the transactions are not marked", () => {
  // A blank project (C16) has its one implicit transaction, so the lock is
  // off and the Map's empty text is what shows.
  assert.equal(mapLockHtml({ case_quality: { mode: "implicit", case_count: 1, coverage: null, tier2_unlocked: false } }), null);
  assert.equal(NO_STEPS_YET, "No steps yet: add steps in Steps to build the map.");
  assert.equal(mapEmptyText([]), NO_STEPS_YET);
  assert.equal(mapEmptyText(undefined), NO_STEPS_YET);
  assert.ok(!/marked/i.test(mapEmptyText([])));
  // Steps that exist but cannot be drawn (all hidden) are named as such.
  const hidden = mapEmptyText([{ step_id: "a", state: "hidden" }]);
  assert.ok(hidden.includes("the transactions have no visible steps") && hidden !== NO_STEPS_YET, hidden);
});
