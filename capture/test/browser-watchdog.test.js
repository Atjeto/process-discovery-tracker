"use strict";
// The "Clicks and typing in Chrome are not being recorded" check
// (browser-watchdog.js, lane LF-SME, live finding 14): it warns only when a
// browser in front, with the SME active, has had nothing recorded for 30 s in
// all; typing counts; Resume and pauses never raise it.

const test = require("node:test");
const assert = require("node:assert");
const { createBrowserWatchdog, browserKey } = require("../browser-watchdog.js");

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/* Tick every 5 s (the tracker's poll) for `seconds`; true when it warned. */
function run(w, c, seconds, state) {
  let warned = false;
  for (let s = 0; s < seconds; s += 5) {
    c.advance(5000);
    if (w.tick(Object.assign({ userIdleMs: 0, paused: false, recorderOn: true }, state))) warned = true;
  }
  return warned;
}

test("a browser that was never recorded, in front with the SME active for 30 s, warns once", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  w.tick({ foregroundApp: "Google Chrome", userIdleMs: 0, paused: false, recorderOn: true });
  assert.strictEqual(run(w, c, 25, { foregroundApp: "Google Chrome" }), false, "not before 30 s");
  assert.strictEqual(run(w, c, 10, { foregroundApp: "Google Chrome" }), true, "at 30 s");
  assert.strictEqual(run(w, c, 120, { foregroundApp: "Google Chrome" }), false, "once per recording");
});

test("rec09: a browser being recorded never warns, even through a long description typed in one field", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  w.noteRecorded("chrome.exe");   // a click earlier in the recording
  assert.strictEqual(run(w, c, 300, { foregroundApp: "Google Chrome" }), false);
});

test("typing the recorder has seen and not written yet counts as recorded", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  w.tick({ foregroundApp: "Google Chrome", userIdleMs: 0, paused: false, recorderOn: true });
  assert.strictEqual(run(w, c, 20, { foregroundApp: "Google Chrome" }), false);
  w.noteRecorded("chrome.exe");   // the recorder's activity line during the typing
  assert.strictEqual(run(w, c, 120, { foregroundApp: "Google Chrome" }), false);
});

test("rec11: right after Resume the count starts again; paused and idle time do not count", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  w.tick({ foregroundApp: "Google Chrome", userIdleMs: 0, paused: false, recorderOn: true });
  assert.strictEqual(run(w, c, 20, { foregroundApp: "Google Chrome" }), false);
  // A long pause: no ticks count while paused.
  assert.strictEqual(run(w, c, 300, { foregroundApp: "Google Chrome", paused: true }), false);
  w.restart();   // Resume
  assert.strictEqual(run(w, c, 25, { foregroundApp: "Google Chrome" }), false, "no warning straight after Resume");
  // Idle (reading, away): no count either.
  assert.strictEqual(run(w, c, 300, { foregroundApp: "Google Chrome", userIdleMs: 60_000 }), false);
});

test("nothing counts while the recorder is starting, and other programs never count", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  assert.strictEqual(run(w, c, 120, { foregroundApp: "Google Chrome", recorderOn: false }), false);
  assert.strictEqual(run(w, c, 120, { foregroundApp: "Microsoft Excel" }), false);
});

test("each browser answers for itself: Chrome recorded does not vouch for Edge", () => {
  const c = clock();
  const w = createBrowserWatchdog({ now: c.now });
  w.noteRecorded("chrome.exe");
  w.tick({ foregroundApp: "Microsoft Edge", userIdleMs: 0, paused: false, recorderOn: true });
  assert.strictEqual(run(w, c, 35, { foregroundApp: "Microsoft Edge" }), true);
});

test("browser names from the recorder and from the foreground window meet", () => {
  assert.strictEqual(browserKey("chrome.exe"), browserKey("Google Chrome"));
  assert.strictEqual(browserKey("MSEDGE.EXE"), browserKey("Microsoft Edge"));
  assert.strictEqual(browserKey("EXCEL.exe"), null);
  assert.strictEqual(browserKey(undefined), null);
});
