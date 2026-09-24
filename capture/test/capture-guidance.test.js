"use strict";
// The words the SME reads while recording (capture-guidance.js): the
// recording bar, the tray's status line, the end summary, the toasts.

const test = require("node:test");
const assert = require("node:assert");
const G = require("../capture-guidance.js");

const RECORDING = {
  tracking: true, paused: false, openMarkers: ["Run 2"], markerDepth: 1,
  elapsedMs: (14 * 60 + 6) * 1000, recorder_state: "on",
};

/* Machine words the SME never reads (lane C, item 8). */
const MACHINE_WORDS = /\b(tracking|session|events?|interactions?|polling|sidecar|jsonl|engagement|operator|worker|markers?|cases?)\b/i;

test("formatHotkey: Control+Shift+S -> Ctrl+Shift+S", () => {
  assert.strictEqual(G.formatHotkey("Control+Shift+S"), "Ctrl+Shift+S");
  assert.strictEqual(G.formatHotkey("CommandOrControl+Shift+M"), "Ctrl+Shift+M");
  assert.strictEqual(G.formatHotkey(""), "");
  assert.strictEqual(G.formatHotkey(null), "");
});

test("formatElapsed: m:ss under an hour, h:mm:ss from an hour", () => {
  assert.strictEqual(G.formatElapsed(0), "0:00");
  assert.strictEqual(G.formatElapsed(59 * 1000), "0:59");
  assert.strictEqual(G.formatElapsed((14 * 60 + 6) * 1000), "14:06");
  assert.strictEqual(G.formatElapsed((3600 + 2 * 60 + 5) * 1000), "1:02:05");
  assert.strictEqual(G.formatElapsed(undefined), "0:00");
  assert.strictEqual(G.formatElapsed(-5), "0:00");
});

test("bar: recording shows Recording, the run in progress, the time and the run key", () => {
  const m = G.barModel({ status: RECORDING, hotkey: "Control+Shift+S" });
  assert.strictEqual(m.state, "recording");
  assert.strictEqual(m.stateText, "Recording");
  assert.strictEqual(m.runText, "Run 2");
  assert.strictEqual(m.elapsed, "14:06");
  assert.strictEqual(m.key, "Ctrl+Shift+S");
  assert.strictEqual(m.pauseLabel, "Pause");
  assert.strictEqual(m.problem, null);
  assert.strictEqual(m.title, "Recording: Run 2, 14:06");
});

test("bar: paused says Paused and offers Resume", () => {
  const m = G.barModel({ status: { ...RECORDING, paused: true } });
  assert.strictEqual(m.state, "paused");
  assert.strictEqual(m.stateText, "Paused");
  assert.strictEqual(m.pauseLabel, "Resume");
});

test("bar: after End run the bar says between runs", () => {
  const m = G.barModel({ status: { ...RECORDING, openMarkers: [], markerDepth: 0 } });
  assert.strictEqual(m.runText, "between runs");
});

test("bar: not recording says Not recording, with no run and no time", () => {
  const m = G.barModel({ status: { tracking: false }, hotkey: "Control+Shift+S" });
  assert.strictEqual(m.state, "idle");
  assert.strictEqual(m.stateText, "Not recording");
  assert.strictEqual(m.runText, "");
  assert.strictEqual(m.elapsed, "");
  assert.strictEqual(m.key, "Ctrl+Shift+S");
  assert.strictEqual(G.barModel({}).state, "idle");
});

test("bar: a key that could not be registered is not shown", () => {
  assert.strictEqual(G.barModel({ status: RECORDING, hotkey: "" }).key, "");
});

test("bar: a named-run caret only while recording and only when named runs are set up", () => {
  assert.strictEqual(G.barModel({ status: RECORDING, namedRuns: true }).namedRuns, true);
  assert.strictEqual(G.barModel({ status: RECORDING, namedRuns: false }).namedRuns, false);
  assert.strictEqual(G.barModel({ status: { tracking: false }, namedRuns: true }).namedRuns, false);
});

test("bar: a problem is one line in words: the recorder stopped for good or went silent", () => {
  assert.strictEqual(G.barModel({ status: { ...RECORDING, recorder_state: "dead" } }).problem, G.CLICKS_NOT_RECORDED);
  assert.strictEqual(G.barModel({ status: { ...RECORDING, recorder_silent: true } }).problem, G.CLICKS_NOT_RECORDED);
  // Clicks and typing switched off in setup, or a recorder restarting, is not a problem line.
  assert.strictEqual(G.barModel({ status: { ...RECORDING, recorder_state: "disabled" } }).problem, null);
  assert.strictEqual(G.barModel({ status: { ...RECORDING, recorder_state: "off" } }).problem, null);
  assert.strictEqual(G.barModel({ status: { tracking: false, recorder_state: "dead" } }).problem, null);
});

test("tray: the status line says Not recording, Recording: Run 2, Paused: between runs", () => {
  assert.strictEqual(G.trayStatusLine({ tracking: false }), "Not recording");
  assert.strictEqual(G.trayStatusLine(RECORDING), "Recording: Run 2");
  assert.strictEqual(G.trayStatusLine({ ...RECORDING, paused: true, openMarkers: [] }), "Paused: between runs");
  assert.strictEqual(G.trayStatusLine({ ...RECORDING, recorder_state: "dead" }),
    "Recording: Run 2 (clicks and typing not recorded)");
});

test("end summary: runs and duration in one line, the folder, the zip name, no warning when a run was marked", () => {
  const folder = "C:\\Users\\sme\\AppData\\Roaming\\process-discovery-tracker\\sessions\\default\\20260924-101500";
  const m = G.summaryModel({ runs: 3, durationMs: (21 * 60 + 40) * 1000, sessionFolder: folder, hotkey: "Control+Shift+S" });
  assert.strictEqual(m.headline, "3 runs, 21:40");
  assert.strictEqual(m.folder, folder);
  assert.strictEqual(m.zipName, "20260924-101500.zip");
  assert.strictEqual(m.warning, null);
  assert.strictEqual(G.summaryModel({ runs: 1, durationMs: 65000 }).headline, "1 run, 1:05");
});

test("end summary: a clear warning when no run was marked, naming the real key", () => {
  const m = G.summaryModel({ runs: 0, durationMs: 90000, sessionFolder: "D:\\r\\default\\x", hotkey: "Control+Alt+S" });
  assert.strictEqual(m.headline, "0 runs, 1:30");
  assert.match(m.warning, /^No run was marked/);
  assert.match(m.warning, /press Ctrl\+Alt\+S each time you start the process/);
  const noKey = G.summaryModel({ runs: 0, durationMs: 1000 });
  assert.match(noKey.warning, /click Next run on the recording bar/);
  assert.match(G.summaryModel({}).warning, /^No run was marked/);
});

test("end summary: no count of clicks, typing, events or screenshots", () => {
  const m = G.summaryModel({ runs: 3, durationMs: 1000, sessionFolder: "x", interactions: 612, screenshots: 21 });
  assert.deepStrictEqual(Object.keys(m).sort(), ["folder", "headline", "warning", "zipName"]);
  assert.ok(!/612|21 screenshots|interaction/i.test(JSON.stringify(m)));
});

test("toasts: programs by a plain name", () => {
  assert.strictEqual(G.friendlyAppName("chrome.exe"), "Chrome");
  assert.strictEqual(G.friendlyAppName("MSEDGE.EXE"), "Edge");
  assert.strictEqual(G.friendlyAppName("saplogon.exe"), "saplogon");
  assert.strictEqual(G.friendlyAppName(""), "this program");
  assert.strictEqual(G.friendlyAppName(null), "this program");
});

test("every sentence the SME reads here is free of machine words and dash punctuation", () => {
  const texts = [];
  for (const status of [RECORDING, { ...RECORDING, paused: true }, { tracking: false },
    { ...RECORDING, openMarkers: [] }, { ...RECORDING, recorder_state: "dead" }]) {
    const m = G.barModel({ status, hotkey: "Control+Shift+S", namedRuns: true });
    texts.push(m.stateText, m.runText, m.pauseLabel, m.title, m.problem || "", G.trayStatusLine(status));
  }
  const s0 = G.summaryModel({ runs: 0, durationMs: 5000, sessionFolder: "D:\\r\\default\\x", hotkey: "Control+Shift+S" });
  const s1 = G.summaryModel({ runs: 0, durationMs: 5000 });
  texts.push(s0.headline, s0.warning, s1.warning, G.CLICKS_NOT_RECORDED);
  for (const t of texts) {
    assert.ok(!MACHINE_WORDS.test(t), "machine word in: " + t);
    assert.ok(!/[\u2013\u2014]|\s--\s|\w\s-\s\w/.test(t), "dash punctuation in: " + t);
  }
});
