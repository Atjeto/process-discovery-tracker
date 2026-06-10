/*
 * Capture-side observation tests (lab-phase §E3) -- synthetic events,
 * no session folder needed for the pure core.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { observeSession, observeSessionFolder, interactionLabel } = require("./observe.js");

function activity(ts, app, durMs) {
  return { type: "activity", timestamp: ts, data: { app, title: app, pid: 1, duration_ms: durMs } };
}
function interaction(data) {
  return { type: "interaction", timestamp: "2026-06-05T09:00:00Z", data };
}
function marker(ts, markerType, label) {
  return { type: "marker", timestamp: ts, data: { marker_type: markerType, label: label || null } };
}

test("focus stretches merge consecutive same-app runs and find the longest", () => {
  const obs = observeSession([
    activity("2026-06-05T09:00:00Z", "excel.exe", 60_000),
    activity("2026-06-05T09:01:00Z", "excel.exe", 120_000),  // title change, same app
    activity("2026-06-05T09:03:00Z", "sap.exe", 30_000),
    activity("2026-06-05T09:03:30Z", "excel.exe", 10_000),
  ]);
  assert.equal(obs.focus_stretches.length, 3);
  assert.equal(obs.longest_stretch.app, "excel.exe");
  assert.equal(obs.longest_stretch.dur_ms, 180_000);
  assert.equal(obs.longest_stretch.start, "2026-06-05T09:00:00Z");
  // Per-app totals accumulate across stretches.
  assert.deepEqual(obs.apps[0], { app: "excel.exe", ms: 190_000 });
});

test("app switch pairs tally alternation regardless of direction", () => {
  const obs = observeSession([
    activity("t1", "a.exe", 1000),
    activity("t2", "b.exe", 1000),
    activity("t3", "a.exe", 1000),
    activity("t4", "b.exe", 1000),
    activity("t5", "c.exe", 1000),
  ]);
  assert.deepEqual(obs.app_switch_pairs[0], { app_a: "a.exe", app_b: "b.exe", n: 3 });
  assert.equal(obs.app_switch_pairs.length, 2); // a<->b and b<->c
});

test("top interaction label uses the kind verb + captured name", () => {
  const obs = observeSession([
    interaction({ kind: "invoked", name: "Save", control_type: "Button", process_name: "sap.exe" }),
    interaction({ kind: "invoked", name: "Save", control_type: "Button", process_name: "sap.exe" }),
    interaction({ kind: "invoked", name: "Cancel", control_type: "Button", process_name: "sap.exe" }),
  ]);
  assert.deepEqual(obs.top_interaction_label, { label: "click 'Save'", n: 2 });
  assert.equal(obs.counts.interactions, 3);
});

test("interactionLabel skips label-less and unknown-kind events", () => {
  assert.equal(interactionLabel({ kind: "invoked", automation_id: "btn-1" }), null);
  assert.equal(interactionLabel({ kind: "focus_changed", name: "X" }), null);
});

test("retyped values need >= 2 distinct places and a non-trivial value", () => {
  const obs = observeSession([
    interaction({ kind: "value_changed", name: "Customer", value: "CUST-10852", process_name: "crm.exe", automation_id: "f1" }),
    interaction({ kind: "value_changed", name: "Ref", value: "CUST-10852", process_name: "sap.exe", automation_id: "f9" }),
    // Same place twice -- not a re-key.
    interaction({ kind: "value_changed", name: "Notes", value: "hello there", process_name: "crm.exe", automation_id: "f2" }),
    interaction({ kind: "value_changed", name: "Notes", value: "hello there", process_name: "crm.exe", automation_id: "f2" }),
    // Too short to count.
    interaction({ kind: "value_changed", name: "Qty", value: "12", process_name: "crm.exe", automation_id: "f3" }),
    interaction({ kind: "value_changed", name: "Qty2", value: "12", process_name: "sap.exe", automation_id: "f4" }),
  ]);
  assert.deepEqual(obs.retyped_values, [{ value: "CUST-10852", n_places: 2 }]);
});

test("markers and screenshots are tallied with their labels", () => {
  const obs = observeSession([
    marker("t1", "start", "Order entry"),
    { type: "system", timestamp: "t2", data: { kind: "screenshot", path: "screenshots/x.jpg" } },
    marker("t3", "end"),
  ]);
  assert.equal(obs.counts.markers, 2);
  assert.equal(obs.counts.screenshots, 1);
  assert.deepEqual(obs.markers[0], { marker_type: "start", label: "Order entry", timestamp: "t1" });
});

test("observeSessionFolder reads events.jsonl and survives a truncated tail", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-observe-"));
  const lines = [
    JSON.stringify(activity("2026-06-05T09:00:00Z", "excel.exe", 90_000)),
    JSON.stringify(marker("2026-06-05T09:01:00Z", "start", "Task A")),
    '{"type":"interaction","data":{"kind":"invo',   // crash-truncated tail
  ].join("\n");
  fs.writeFileSync(path.join(dir, "events.jsonl"), lines);
  const obs = observeSessionFolder(dir);
  assert.equal(obs.counts.events, 2);
  assert.equal(obs.markers.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a missing events.jsonl observes as empty, not a throw", () => {
  const obs = observeSessionFolder(path.join(os.tmpdir(), "pdt-no-such-session"));
  assert.equal(obs.counts.events, 0);
  assert.equal(obs.longest_stretch, null);
});
