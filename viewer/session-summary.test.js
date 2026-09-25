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

/* ---- The SME's name and the Recents entry ------------------------------- */

test("smeName is the Profile's display name when it says more than the Windows login", () => {
  const { smeName } = SessionSummary;
  assert.equal(smeName({ config: { worker: { id: "anovak", name: "Ana Novak" } } }), "Ana Novak");
  assert.equal(smeName({ config: { worker: { id: "anovak", name: "ANOVAK" } } }), null, "the login again is no name");
  assert.equal(smeName({ config: { worker: { id: "anovak", name: null } } }), null, "the capture app's default");
  assert.equal(smeName({}), null);
  assert.equal(computeSummary(Object.assign(sampleSession(), {
    manifest: { config: { worker: { id: "w", name: "Ana Novak" } } } })).smeName, "Ana Novak");
});

test("requestOf is the capture's request (AD-30): name and code when set, never the capture app's defaults", () => {
  const { requestOf } = SessionSummary;
  assert.equal(requestOf({ engagement_id: "ENG-7", engagement_name: "Order intake" }), "Order intake (ENG-7)");
  assert.equal(requestOf({ engagement_id: "ENG-7", config: { engagement_name: "Order intake" } }), "Order intake (ENG-7)",
    "an older recording keeps the name in its config");
  assert.equal(requestOf({ engagement_id: "default", engagement_name: "Order intake" }), "Order intake");
  assert.equal(requestOf({ engagement_id: "ENG-7", engagement_name: "Default engagement" }), "ENG-7");
  assert.equal(requestOf({ engagement_id: "ENG-7", engagement_name: " ENG-7 " }), "ENG-7", "a name that repeats the code");
  assert.equal(requestOf({ engagement_id: "default", engagement_name: "Default engagement" }), null, "the defaults");
  assert.equal(requestOf({ engagement_id: "default" }), null);
  assert.equal(requestOf({}), null);
  assert.equal(requestOf(null), null);
});

test("recentLabel is the document title once written, else the recording's label, else the request code and folder", () => {
  const { recentLabel } = SessionSummary;
  const sess = { manifest: { engagement_id: "demo-order-processing", label: "" }, annotations: { document: { title: "  " } } };
  assert.equal(recentLabel(sess, "sess-1"), "demo-order-processing · sess-1");
  sess.manifest.label = "Tuesday call";
  assert.equal(recentLabel(sess, "sess-1"), "Tuesday call");
  sess.annotations.document.title = "Order intake: e-mail to sales order";
  assert.equal(recentLabel(sess, "sess-1"), "Order intake: e-mail to sales order");
  assert.equal(recentLabel({ manifest: {} }, "sess-2"), "sess-2", "no request: the folder's name once");
  assert.equal(recentLabel({ manifest: { engagement_id: "default" } }, "sess-3"), "sess-3",
    "lane FX1: the capture app's default code is no request");
});

test("lane FX1: the capture app's default request never names a project", () => {
  const sess = sampleSession();
  sess.manifest.engagement_id = "default";
  sess.manifest.engagement_name = "Default engagement";
  const s = computeSummary(sess);
  assert.equal(s.engagement, null);
  assert.equal(s.engagementName, null);
  const { projectName, requestName, requestCode } = SessionSummary;
  assert.equal(projectName(sess.manifest, "20260925-085516"), "20260925-085516");
  assert.equal(projectName({}, ""), "This project");
  assert.equal(projectName({ engagement_id: "REQ-2026-042", engagement_name: "Invoice intake review" }, "f"),
    "Invoice intake review");
  assert.equal(projectName({ engagement_id: "REQ-2026-042", config: { engagement_name: "Default engagement" } }, "f"),
    "REQ-2026-042");
  assert.equal(requestName({ config: { engagement_name: " Order intake " } }), "Order intake");
  assert.equal(requestCode({ engagement_id: " default " }), null);
});

test("lane FX3: an export is named after the project: the document title, the recording's name, the request, the folder", () => {
  const { exportBaseName } = SessionSummary;
  const titled = { annotations: { document: { title: " Order to cash " } }, manifest: { label: "Orders with Sam" } };
  assert.equal(exportBaseName(titled, "20260925-085516"), "Order to cash");
  assert.equal(exportBaseName({ manifest: { label: "Orders with Sam" } }, "f"), "Orders with Sam");
  assert.equal(exportBaseName({ manifest: { engagement_id: "REQ-2026-042", engagement_name: "Invoice intake review" } }, "f"),
    "Invoice intake review");
  assert.equal(exportBaseName({ manifest: { engagement_id: "default", engagement_name: "Default engagement" } }, "20260925-085516"),
    "20260925-085516", "never the capture app's defaults");
  // Fit for a file name on Windows: no \ / : * ? " < > |, no dot or space at its end, at most 80 characters.
  const odd = { annotations: { document: { title: 'Orders: "A/B" \\ C*D? <E> | F.. ' } } };
  assert.equal(exportBaseName(odd, "f"), "Orders A B C D E F");
  assert.equal(exportBaseName({ annotations: { document: { title: "x".repeat(120) } } }, "f").length, 80);
  assert.equal(exportBaseName({ annotations: { document: { title: " ... " } } }, ""), "Process");
});
