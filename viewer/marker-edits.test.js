"use strict";
/*
 * Item 6: marker changes show at once as pending, and become ordinary
 * markers once an analysis has applied them (marker-edits.js).
 *
 * "Applied" is decided the way the pipeline works: it replays every edit on
 * every Analyze and keeps them, so an edit made (edit.ts) after the last
 * analysis (stats.meta.normalization_run_at) is pending, one made before is
 * applied. Each pending case has its applied twin as the control.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const ME = require("./marker-edits.js");

const EVENTS = [
  { type: "activity", timestamp: "2026-05-14T09:00:05Z", data: {} },
  { type: "marker", event_id: "m1", timestamp: "2026-05-14T09:00:10Z", data: { marker_type: "start", label: "Order A" } },
  { type: "marker", event_id: "m2", timestamp: "2026-05-14T09:00:50Z", data: { marker_type: "end" } },
];
const ANALYZED = Date.parse("2026-09-01T10:00:00Z");
const BEFORE = "2026-09-01T09:00:00.000Z";   // made before the last analysis
const AFTER = "2026-09-01T11:00:00.000Z";    // made after it

const insert = (ts, extra) => Object.assign({ id: "e1", op: "insert", marker_type: "start", label: "New run",
  timestamp: "2026-05-14T09:00:30Z", ts }, extra || {});

test("an insert made after the last analysis is shown, pending, and not in the case lane", () => {
  const view = ME.markerView(EVENTS, [insert(AFTER)], ANALYZED);
  const row = view.find((m) => m.inserted);
  assert.ok(row, "the inserted marker is a row");
  assert.equal(row.key, "insert-e1");
  assert.equal(row.pending, true);
  assert.equal(row.label, "New run");
  assert.deepEqual(view.map((m) => m.key), ["m1", "insert-e1", "m2"], "rows sort by time");
  assert.equal(ME.pendingEditCount([insert(AFTER)], ANALYZED), 1);
  assert.ok(!ME.appliedMarkerEvents(view).some((e) => e.event_id === "insert-e1"),
    "the case lane follows the last analysis, which did not have it");
});

test("control: the same insert made before the last analysis is an ordinary, applied marker", () => {
  const view = ME.markerView(EVENTS, [insert(BEFORE)], ANALYZED);
  const row = view.find((m) => m.inserted);
  assert.equal(row.pending, false);
  assert.equal(ME.pendingEditCount([insert(BEFORE)], ANALYZED), 0);
  const applied = ME.appliedMarkerEvents(view);
  assert.deepEqual(applied.map((e) => e.event_id), ["m1", "insert-e1", "m2"]);
  assert.deepEqual(applied[1].data, { marker_type: "start", label: "New run" });
});

test("a session never analyzed has every change pending", () => {
  assert.equal(ME.pendingEditCount([insert(BEFORE)], NaN), 1);
  assert.equal(ME.lastAnalysisMs({ stats: null }), NaN);
  assert.equal(ME.lastAnalysisMs({ stats: { meta: { normalization_run_at: "2026-09-01T10:00:00.123456+00:00" } } }),
    Date.parse("2026-09-01T10:00:00.123Z"), "the pipeline's microsecond timestamp parses");
});

test("a pending move and rename show the new values; the case lane keeps the analyzed ones", () => {
  const edits = [
    { id: "r1", event_id: "m1", field: "label", value: "Order A (fixed)", ts: AFTER },
    { id: "t1", event_id: "m1", field: "timestamp", value: "2026-05-14T09:00:12Z", ts: AFTER },
  ];
  const view = ME.markerView(EVENTS, edits, ANALYZED);
  const m1 = view.find((m) => m.key === "m1");
  assert.equal(m1.pending, true);
  assert.equal(m1.edited, true);
  assert.equal(m1.label, "Order A (fixed)");
  assert.equal(m1.timestamp, "2026-05-14T09:00:12Z");
  const applied = ME.appliedMarkerEvents(view).find((e) => e.event_id === "m1");
  assert.equal(applied.timestamp, "2026-05-14T09:00:10Z");
  assert.equal(applied.data.label, "Order A");
});

test("the last rename wins even when a later move follows it", () => {
  const edits = [
    { id: "r1", event_id: "m1", field: "label", value: "first", ts: BEFORE },
    { id: "r2", event_id: "m1", field: "label", value: "second", ts: BEFORE },
    { id: "t1", event_id: "m1", field: "timestamp", value: "2026-05-14T09:00:11Z", ts: BEFORE },
  ];
  const m1 = ME.markerView(EVENTS, edits, ANALYZED).find((m) => m.key === "m1");
  assert.equal(m1.label, "second");
  assert.equal(m1.pending, false);
});

test("a pending delete still counts in the case lane; an analyzed one does not", () => {
  const pending = ME.markerView(EVENTS, [{ id: "d1", event_id: "m2", op: "delete", ts: AFTER }], ANALYZED);
  const m2p = pending.find((m) => m.key === "m2");
  assert.equal(m2p.deleted, true);
  assert.equal(m2p.pending, true);
  assert.ok(ME.appliedMarkerEvents(pending).some((e) => e.event_id === "m2"));
  const done = ME.markerView(EVENTS, [{ id: "d1", event_id: "m2", op: "delete", ts: BEFORE }], ANALYZED);
  assert.equal(done.find((m) => m.key === "m2").deletedApplied, true);
  assert.ok(!ME.appliedMarkerEvents(done).some((e) => e.event_id === "m2"));
});

test("like the pipeline: an insert without a time is skipped; an undated edit on an analyzed session is applied", () => {
  const view = ME.markerView(EVENTS, [insert(AFTER, { timestamp: null })], ANALYZED);
  assert.ok(!view.some((m) => m.inserted));
  assert.equal(ME.pendingEditCount([insert(AFTER, { timestamp: null })], ANALYZED), 0);
  assert.equal(ME.isPendingEdit({ event_id: "m1", op: "delete" }, ANALYZED), false);
});

test("removing an analyzed insert leaves one pending delete of its marker id, and no row", () => {
  // The Markers list's delete of an applied inserted marker (flow-view-markers.js).
  const edits = [{ id: "x9", event_id: "insert-e1", op: "delete", ts: AFTER }];
  const view = ME.markerView(EVENTS, edits, ANALYZED);
  assert.deepEqual(view.map((m) => m.key), ["m1", "m2"], "no ghost row for the removed marker");
  assert.equal(ME.pendingEditCount(edits, ANALYZED), 1, "the change still waits for Analyze");
});
