"use strict";
// C1 — unit tests for tracker.js marker/event/status surface.
// The 5s polling tick is left to run once; every test calls stop() to
// clear the interval so the runner exits cleanly.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startTracker, POLL_INTERVAL_MS } = require("../tracker.js");

function tmpEvents() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-trk-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, "");
  return { dir, file };
}
function readEvents(file) {
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("startTracker requires sessionId and eventsFile", () => {
  assert.throws(() => startTracker({}), /requires/);
  assert.throws(() => startTracker({ sessionId: "s" }), /requires/);
});

test("POLL_INTERVAL_MS is exported and positive", () => {
  assert.ok(POLL_INTERVAL_MS > 0);
});

test("fireMarker writes marker events and tracks open-marker depth", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  t.fireMarker({ markerType: "start", label: "Step 1" });
  assert.strictEqual(t.getStatus().markerDepth, 1);
  assert.deepStrictEqual(t.getStatus().openMarkers, ["Step 1"]);
  t.fireMarker({ markerType: "end", label: "Step 1" });
  assert.strictEqual(t.getStatus().markerDepth, 0);
  t.stop();
  const markers = readEvents(file).filter((e) => e.type === "marker");
  assert.strictEqual(markers.length, 2);
  assert.strictEqual(markers[0].data.marker_type, "start");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fireMarker rejects an invalid marker type", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  assert.throws(() => t.fireMarker({ markerType: "middle" }), /start.*end/);
  t.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fireInteraction shapes and counts interaction events", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  t.fireInteraction({ kind: "click", name: "OK" });
  assert.strictEqual(t.getStatus().interactionCount, 1);
  t.stop();
  const interactions = readEvents(file).filter((e) => e.type === "interaction");
  assert.strictEqual(interactions.length, 1);
  assert.strictEqual(interactions[0].data.kind, "click");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("session_start is emitted on start and session_end on stop", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  t.stop();
  const kinds = readEvents(file)
    .filter((e) => e.type === "system")
    .map((e) => e.data.kind);
  assert.ok(kinds.includes("session_start"));
  assert.ok(kinds.includes("session_end"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pause and resume update status and emit system events", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  t.pause();
  assert.strictEqual(t.getStatus().paused, true);
  t.resume();
  assert.strictEqual(t.getStatus().paused, false);
  t.stop();
  const kinds = readEvents(file)
    .filter((e) => e.type === "system")
    .map((e) => e.data.kind);
  assert.ok(kinds.includes("paused"));
  assert.ok(kinds.includes("resumed"));
  fs.rmSync(dir, { recursive: true, force: true });
});
