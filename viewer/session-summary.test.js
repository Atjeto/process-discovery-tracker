/*
 * Unit tests for session-summary.js: the pure derivations behind the
 * Overview's one-line session summary.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const SessionSummary = require("./session-summary.js");
const { eventSpanMs, computeSummary, detectMarkerProblems } = SessionSummary;

/* ---- eventSpanMs --------------------------------------------------- */

test("eventSpanMs is the first-to-last timestamp span", () => {
  const events = [
    { timestamp: "2026-05-11T09:00:00Z" },
    { timestamp: "2026-05-11T09:00:30Z" },
    { timestamp: "2026-05-11T09:02:00Z" },
  ];
  assert.equal(eventSpanMs(events), 120000);
});

test("eventSpanMs is 0 for an empty or missing list", () => {
  assert.equal(eventSpanMs([]), 0);
  assert.equal(eventSpanMs(undefined), 0);
});

/* ---- computeSummary ------------------------------------------------ */

function sampleSession() {
  return {
    manifest: { engagement_id: "eng-x", config: { worker: { id: "w-cfg" } } },
    stats: {
      activity_stats: [
        { activity_label: "CRM", total_duration_ms: 6000, frequency: 2 },
        { activity_label: "Excel", total_duration_ms: 2000, frequency: 1 },
      ],
      case_stats: [
        { case_id: "c1", label: "Order 1", parent_case_id: null, wall_clock_ms: 5000 },
        { case_id: "c2", label: "Order 2", parent_case_id: null, wall_clock_ms: 9000 },
        { case_id: "c2s", label: "sub", parent_case_id: "c2", wall_clock_ms: 1000 },
      ],
      meta: {
        normalization_run_at: "2026-05-17T10:00:00Z",
        raw_event_count: 12,
        interaction_count: 4,
        case_count: 2,
        step_count: 3,
        step_state_breakdown: {
          auto_suggested: 2, auto_matched: 0, manually_authored: 1, edited: 0,
        },
        worker_id: "w-meta",
        match_rate: 0,
      },
    },
    events: [
      { type: "activity", timestamp: "2026-05-11T09:00:00Z", data: { app: "a.exe", duration_ms: 3000 } },
      { type: "activity", timestamp: "2026-05-11T09:00:03Z", data: { app: "b.exe", duration_ms: 2000 } },
      { type: "activity", timestamp: "2026-05-11T09:00:05Z", data: { app: "a.exe", duration_ms: 3000 } },
      { type: "marker", timestamp: "2026-05-11T09:00:08Z", data: { marker_type: "start", label: "X" } },
    ],
  };
}

test("computeSummary returns null for an unanalyzed session", () => {
  assert.equal(computeSummary(null), null);
  assert.equal(computeSummary({ events: [] }), null);
  assert.equal(computeSummary({ stats: {} }), null);
});

test("computeSummary derives the recording's name, worker, duration and analysis time", () => {
  const s = computeSummary(sampleSession());
  assert.equal(s.engagement, "eng-x");
  assert.equal(s.engagementName, null);
  assert.equal(s.worker, "w-meta");           // meta.worker_id wins over config
  assert.equal(s.durationMs, 8000);           // 09:00:00 -> 09:00:08
  assert.equal(s.analyzedAt, "2026-05-17T10:00:00Z");
});

test("computeSummary falls back to manifest worker when meta lacks one", () => {
  const sess = sampleSession();
  delete sess.stats.meta.worker_id;
  assert.equal(computeSummary(sess).worker, "w-cfg");
});

test("computeSummary prefers the project name the operator typed", () => {
  const sess = sampleSession();
  sess.manifest.engagement_name = "Order intake";
  assert.equal(computeSummary(sess).engagementName, "Order intake");
});

test("the removed summary panel's helpers and fields are gone", () => {
  // The one-line summary replaced the panel: no state collapse helpers, no
  // step split read from the stats snapshot, no template fields.
  assert.equal(SessionSummary.stepStateLabel, undefined);
  assert.equal(SessionSummary.isAutoState, undefined);
  const s = computeSummary(sampleSession());
  for (const k of ["confirmedSteps", "autoSteps", "hasTemplate", "canonicalDrift", "matchRate",
    "topActivities", "topCases", "vocabCoverage", "efficiencyRatio"]) {
    assert.ok(!(k in s), k);
  }
});

/* ---- detectMarkerProblems ------------------------------------------ */

function marker(type, label, timestamp, id) {
  return { type: "marker", event_id: id, timestamp, data: { marker_type: type, label } };
}

test("detectMarkerProblems finds nothing in a balanced stream", () => {
  const events = [
    marker("start", "A", "2026-05-11T09:00:00Z", "m1"),
    marker("end", null, "2026-05-11T09:05:00Z", "m2"),
  ];
  assert.deepEqual(detectMarkerProblems(events), []);
});

test("detectMarkerProblems flags a dangling start", () => {
  const events = [marker("start", "Order 9", "2026-05-11T09:00:00Z", "m1")];
  const p = detectMarkerProblems(events);
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, "dangling_start");
  assert.equal(p[0].label, "Order 9");
  assert.equal(p[0].eventId, "m1");
});

test("detectMarkerProblems flags an orphan end", () => {
  const events = [marker("end", null, "2026-05-11T09:05:00Z", "m9")];
  const p = detectMarkerProblems(events);
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, "orphan_end");
  assert.equal(p[0].eventId, "m9");
});

test("detectMarkerProblems flags a suspiciously short case", () => {
  const events = [
    marker("start", "oops", "2026-05-11T09:00:00.000Z", "m1"),
    marker("end", null, "2026-05-11T09:00:02.000Z", "m2"),
  ];
  const p = detectMarkerProblems(events);
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, "short_case");
  assert.equal(p[0].durationMs, 2000);
});

test("detectMarkerProblems handles nested cases without false flags", () => {
  const events = [
    marker("start", "outer", "2026-05-11T09:00:00Z", "m1"),
    marker("start", "inner", "2026-05-11T09:01:00Z", "m2"),
    marker("end", null, "2026-05-11T09:02:00Z", "m3"),
    marker("end", null, "2026-05-11T09:05:00Z", "m4"),
  ];
  assert.deepEqual(detectMarkerProblems(events), []);
});
