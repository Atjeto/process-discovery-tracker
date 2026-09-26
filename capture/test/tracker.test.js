"use strict";
// C1 — unit tests for tracker.js marker/event/status surface.
// The 5s polling tick is left to run once; every test calls stop() to
// clear the interval so the runner exits cleanly.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  startTracker, POLL_INTERVAL_MS, normalizeTitle, isNewRun, isUncapturedApp,
} = require("../tracker.js");

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

// --- One-hotkey runs ------------------------------------------------
// The marker EVENT FORMAT is the pipeline's contract (case assignment reads
// type "marker", data.marker_type, data.label): these tests pin it exactly.

// Each run test stops its tracker in `finally` (a second stop() is a no-op):
// a failed assertion must fail the test, not leave the 5 s poll interval
// alive and hang the runner.

test("startRun: one key per run, 'Transaction N' labels (AD-29), the open run ends first, runs never nest", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  try {
    t.startRun();
    assert.deepStrictEqual(t.getStatus().openMarkers, ["Transaction 1"]);
    t.startRun();                        // run 1 still open: end it, then start run 2
    assert.strictEqual(t.getStatus().markerDepth, 1);
    assert.deepStrictEqual(t.getStatus().openMarkers, ["Transaction 2"]);
    t.fireMarker({ markerType: "end" }); // the end hotkey
    assert.strictEqual(t.getStatus().markerDepth, 0);
    t.startRun();
    assert.strictEqual(t.getStatus().startMarkerCount, 3);
    t.stop();
    const markers = readEvents(file).filter((e) => e.type === "marker");
    assert.deepStrictEqual(markers.map((e) => e.data), [
      { marker_type: "start", label: "Transaction 1" },
      { marker_type: "end", label: null, reason: "auto_close_for_sibling" },
      { marker_type: "start", label: "Transaction 2" },
      { marker_type: "end", label: null },
      { marker_type: "start", label: "Transaction 3" },
      { marker_type: "end", label: null },   // stop() ends the open run
    ]);
    for (const e of markers) {
      assert.deepStrictEqual(Object.keys(e).sort(),
        ["_seq", "data", "event_id", "session_id", "timestamp", "type"]);
    }
  } finally {
    t.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("startRun(label): a named run counts toward the next 'Transaction N'", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  try {
    t.startRun("Order entry");
    t.startRun();
    assert.deepStrictEqual(t.getStatus().openMarkers, ["Transaction 2"]);
    t.stop();
    const starts = readEvents(file)
      .filter((e) => e.type === "marker" && e.data.marker_type === "start")
      .map((e) => e.data.label);
    assert.deepStrictEqual(starts, ["Order entry", "Transaction 2"]);
  } finally {
    t.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop() writes the open run's end marker before session_end", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  try {
    t.startRun();
    t.stop();
    const tail = readEvents(file).slice(-2);
    assert.deepStrictEqual(tail.map((e) => e.type), ["marker", "system"]);
    assert.deepStrictEqual(tail[0].data, { marker_type: "end", label: null });
    assert.strictEqual(tail[1].data.kind, "session_end");
  } finally {
    t.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("a recorder password entry reaches events.jsonl with value_redacted and no value (live finding 1)", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  // The recorder's line for a password field, as the sidecar sends it.
  t.fireInteraction({
    kind: "value_changed", control_type: "Edit", automation_id: "si-password", name: "Password",
    framework: "chromium", identity_source: "automation_id", confidence: 0.95, value_redacted: true,
  });
  t.stop();
  const [pw] = readEvents(file).filter((e) => e.type === "interaction");
  assert.strictEqual(pw.data.value_redacted, true);
  assert.ok(!("value" in pw.data));
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

test("lane FX3: the elapsed time leaves the pauses out; the time paused is counted, an ongoing pause too", async () => {
  const { dir, file } = tmpEvents();
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const t = startTracker({ sessionId: "s", eventsFile: file });
    now += 10000;
    t.pause();
    now += 6000;
    let s = t.getStatus();
    assert.strictEqual(s.pausedMs, 6000, "an ongoing pause counts");
    assert.strictEqual(s.currentPauseMs, 6000, "the pause in progress, from its start");
    assert.strictEqual(s.elapsedMs, 10000, "the clock stands still while paused");
    t.resume();
    now += 4000;
    s = t.getStatus();
    assert.deepStrictEqual([s.elapsedMs, s.pausedMs, s.currentPauseMs], [14000, 6000, 0]);
    t.pause();
    now += 1000;
    const end = await t.stop();
    assert.deepStrictEqual([end.elapsedMs, end.pausedMs], [14000, 7000], "a pause the stop ends is counted");
  } finally {
    Date.now = realNow;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Title-grained activity runs (ADR-0007) -------------------------

test("normalizeTitle strips the unread-count prefix and browser suffix", () => {
  assert.strictEqual(normalizeTitle("(3) Inbox - Google Chrome"), "Inbox");
  assert.strictEqual(normalizeTitle("(27) Slack | acme - Google Chrome"), "Slack | acme");
});

test("normalizeTitle strips an unsaved-changes marker", () => {
  assert.strictEqual(normalizeTitle("*Quarterly report"), "Quarterly report");
  assert.strictEqual(normalizeTitle("● Untitled"), "Untitled");
});

test("normalizeTitle strips the suffix for several browsers", () => {
  assert.strictEqual(normalizeTitle("Workday — Mozilla Firefox"), "Workday");
  assert.strictEqual(normalizeTitle("SAP Fiori - Microsoft Edge"), "SAP Fiori");
});

test("normalizeTitle leaves a plain title untouched", () => {
  assert.strictEqual(normalizeTitle("SAP Fiori Launchpad"), "SAP Fiori Launchpad");
  assert.strictEqual(normalizeTitle(""), "");
  assert.strictEqual(normalizeTitle(undefined), "");
});

test("normalizeTitle keeps genuinely different web apps distinct", () => {
  const a = normalizeTitle("(2) Salesforce | Accounts - Google Chrome");
  const b = normalizeTitle("SAP Sales Order - Google Chrome");
  assert.notStrictEqual(a, b);
});

test("isNewRun: a null run, or any app/pid change, starts a new run", () => {
  assert.strictEqual(isNewRun(null, "chrome.exe", 10, "Salesforce"), true);
  const run = { app: "chrome.exe", pid: 10, _normTitle: "Salesforce" };
  assert.strictEqual(isNewRun(run, "chrome.exe", 10, "Salesforce"), false);
  assert.strictEqual(isNewRun(run, "excel.exe", 10, "Salesforce"), true);
  assert.strictEqual(isNewRun(run, "chrome.exe", 99, "Salesforce"), true);
});

test("isNewRun: a normalized-title change starts a new run (web-app switch)", () => {
  const run = { app: "chrome.exe", pid: 10, _normTitle: "Salesforce" };
  assert.strictEqual(isNewRun(run, "chrome.exe", 10, "SAP Sales Order"), true);
});

// --- Sequence counter (E2) ------------------------------------------

test("appendEvent stamps a monotonic _seq, in append order, on every event", () => {
  const { dir, file } = tmpEvents();
  const t = startTracker({ sessionId: "s", eventsFile: file });
  t.fireMarker({ markerType: "start", label: "A" });
  t.fireInteraction({ kind: "click", name: "OK" });
  t.fireSystem("note");
  t.stop();
  const evs = readEvents(file);
  // session_start is _seq 0; each subsequent appended event increments by 1.
  assert.ok(evs.length >= 4);
  evs.forEach((e, i) => assert.strictEqual(e._seq, i));
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Uncaptured-app detection (E5) ----------------------------------

const UNCAPTURED_BASE = {
  interactionsExpected: true,
  pid: 1234,
  interactivePids: new Set(),
  uncapturedWarned: new Set(),
  foregroundElapsedMs: 999_999,
  thresholdMs: 90_000,
};

test("isUncapturedApp: flags a long-foreground app with no interactions", () => {
  assert.strictEqual(isUncapturedApp({ ...UNCAPTURED_BASE }), true);
});

test("isUncapturedApp: does nothing when interactions aren't expected", () => {
  assert.strictEqual(
    isUncapturedApp({ ...UNCAPTURED_BASE, interactionsExpected: false }), false);
});

test("isUncapturedApp: below the threshold it does not flag yet", () => {
  assert.strictEqual(
    isUncapturedApp({ ...UNCAPTURED_BASE, foregroundElapsedMs: 5_000 }), false);
});

test("isUncapturedApp: a pid that produced an interaction is never flagged", () => {
  assert.strictEqual(
    isUncapturedApp({ ...UNCAPTURED_BASE, interactivePids: new Set([1234]) }), false);
});

test("isUncapturedApp: an already-warned pid is not flagged twice", () => {
  assert.strictEqual(
    isUncapturedApp({ ...UNCAPTURED_BASE, uncapturedWarned: new Set([1234]) }), false);
});

test("isUncapturedApp: a null pid is never flagged", () => {
  assert.strictEqual(isUncapturedApp({ ...UNCAPTURED_BASE, pid: null }), false);
});

// --- H-6: durability-critical write failures are re-queued, never lost ---

test("flushEvents re-queues a failed durability-critical batch and retries", () => {
  const { dir, file } = tmpEvents();
  let failNext = true;
  const writes = [];
  // Injected writer: throw once on the first (critical) flush, then let
  // every subsequent flush succeed by writing to the real file.
  const appendFile = (f, data) => {
    if (failNext) { failNext = false; throw new Error("EACCES (simulated)"); }
    writes.push(data);
    fs.appendFileSync(f, data);
  };
  const notices = [];
  const t = startTracker({
    sessionId: "s",
    eventsFile: file,
    appendFile,
    onNotice: (kind, payload) => notices.push({ kind, payload }),
  });
  // session_start fired on construction -> first flush throws, re-queues.
  assert.strictEqual(t.getStatus().writeErrorCount, 1);
  assert.ok(notices.some((n) => n.kind === "write_error"));
  // A second critical event triggers a flush that now succeeds, draining
  // BOTH the re-queued session_start and the new marker.
  t.fireMarker({ markerType: "start", label: "A" });
  t.stop();
  const evs = readEvents(file);
  const kinds = evs.map((e) => (e.type === "system" ? e.data.kind : e.type));
  assert.ok(kinds.includes("session_start"), "re-queued session_start survived");
  assert.ok(kinds.includes("marker"), "later marker written");
  assert.ok(kinds.includes("session_end"), "session_end written");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("RP-21: a failed non-critical batch is counted and recorded as an events_dropped event", (tc) => {
  const { dir, file } = tmpEvents();
  tc.mock.timers.enable({ apis: ["setTimeout"] });
  // Fail every write that carries an interaction line while failInteractions
  // is set; everything else (session_start first) writes normally.
  let failInteractions = true;
  const appendFile = (f, data) => {
    if (failInteractions && data.includes('"interaction"')) throw new Error("EACCES (simulated)");
    fs.appendFileSync(f, data);
  };
  const notices = [];
  const t = startTracker({
    sessionId: "s", eventsFile: file, appendFile,
    onNotice: (kind, payload) => notices.push({ kind, payload }),
  });
  try {
    t.fireInteraction({ kind: "click", name: "OK" });
    t.fireInteraction({ kind: "click", name: "Save" });
    // The interactions ride the 500ms deferred timer ONLY -- no critical
    // event shares their batch. Advance the timer so the (failing) flush runs.
    tc.mock.timers.tick(500);
    // Dropped (not retried) and not a critical write error (H-6 stays
    // critical-only) -- but counted, and the operator is told once.
    assert.strictEqual(t.getStatus().writeErrorCount, 0);
    assert.strictEqual(t.getStatus().droppedEventCount, 2);
    assert.deepStrictEqual(notices.map((n) => n.kind), ["events_dropped"]);
    // The disk recovers; the next event carries the loss record ahead of it.
    failInteractions = false;
    t.fireMarker({ markerType: "start", label: "Run 1" });
    tc.mock.timers.reset();
    t.stop();
    const evs = readEvents(file);
    assert.strictEqual(evs.filter((e) => e.type === "interaction").length, 0, "the batch stayed dropped");
    const loss = evs.filter((e) => e.type === "system" && e.data.kind === "events_dropped");
    assert.strictEqual(loss.length, 1, "exactly one durable loss record");
    const d = loss[0].data;
    assert.strictEqual(d.dropped_interactions, 2);
    assert.strictEqual(d.dropped_activities, 0);
    assert.strictEqual(d.failed_writes, 1);
    assert.match(d.last_error, /EACCES/);
    assert.ok(d.first_dropped_ts <= d.last_dropped_ts, "the lost span is bounded");
    const firstMarker = evs.findIndex((e) => e.type === "marker");
    assert.ok(evs.indexOf(loss[0]) < firstMarker, "the loss record precedes the event after the gap");
  } finally {
    tc.mock.timers.reset();
    t.stop();   // a no-op when the body already stopped it
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("startTracker accepts the E5 options without disturbing the marker flow", () => {
  const { dir, file } = tmpEvents();
  const notices = [];
  const t = startTracker({
    sessionId: "s",
    eventsFile: file,
    interactionsExpected: true,
    onNotice: (kind, payload) => notices.push({ kind, payload }),
  });
  t.fireMarker({ markerType: "start", label: "A" });
  t.stop();
  // No app has been foreground long enough on the first tick.
  assert.strictEqual(notices.length, 0);
  const kinds = readEvents(file).filter((e) => e.type === "system").map((e) => e.data.kind);
  assert.ok(!kinds.includes("uncaptured_app"));
  fs.rmSync(dir, { recursive: true, force: true });
});
