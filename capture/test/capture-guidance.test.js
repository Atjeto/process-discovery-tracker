"use strict";
// The words the SME reads while recording (capture-guidance.js): the
// recording bar, the tray's status line, the end summary, the toasts.

const test = require("node:test");
const assert = require("node:assert");
const G = require("../capture-guidance.js");

const RECORDING = {
  tracking: true, paused: false, openMarkers: ["Transaction 2"], markerDepth: 1,
  elapsedMs: (14 * 60 + 6) * 1000, recorder_state: "on",
};

/* Machine words the SME never reads (lane C, item 8). */
const MACHINE_WORDS = /\b(tracking|session|events?|interactions?|polling|sidecar|jsonl|engagement|operator|worker|markers?|cases?)\b/i;
/* The word the SME no longer reads (AD-29): one pass through the process is
   a transaction. */
const RETIRED_WORDS = /\bruns?\b/i;

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

test("bar: recording shows Recording, the transaction in progress, the time and the transaction key", () => {
  const m = G.barModel({ status: RECORDING, hotkey: "Control+Shift+S" });
  assert.strictEqual(m.state, "recording");
  assert.strictEqual(m.stateText, "Recording");
  assert.strictEqual(m.runText, "Transaction 2");
  assert.strictEqual(m.elapsed, "14:06");
  assert.strictEqual(m.key, "Ctrl+Shift+S");
  assert.strictEqual(m.pauseLabel, "Pause");
  assert.strictEqual(m.problem, null);
  assert.strictEqual(m.title, "Recording: Transaction 2, 14:06");
});

test("bar: paused says Paused and offers Resume", () => {
  const m = G.barModel({ status: { ...RECORDING, paused: true } });
  assert.strictEqual(m.state, "paused");
  assert.strictEqual(m.stateText, "Paused");
  assert.strictEqual(m.pauseLabel, "Resume");
});

test("lane FX3: the bar's clock is the time recorded; while paused, the pause's length shows beside Paused, and the time paused in all is in the tooltip", () => {
  const paused = G.barModel({ status: { ...RECORDING, paused: true, elapsedMs: 65000, pausedMs: 6000, currentPauseMs: 3000 } });
  assert.strictEqual(paused.stateText, "Paused", "the tray's line keeps its word");
  assert.strictEqual(paused.pauseNow, "0:03");
  assert.strictEqual(paused.elapsed, "1:05");
  assert.strictEqual(paused.paused, "paused 0:06");
  assert.strictEqual(paused.title, "Paused: Transaction 2, 1:05 (paused 0:06)");
  const after = G.barModel({ status: { ...RECORDING, elapsedMs: 70000, pausedMs: 6000, currentPauseMs: 0 } });
  assert.strictEqual(after.stateText, "Recording");
  assert.strictEqual(after.pauseNow, "");
  assert.strictEqual(after.title, "Recording: Transaction 2, 1:10 (paused 0:06)");
  // No pause (or under a second): nothing said.
  assert.strictEqual(G.barModel({ status: RECORDING }).paused, "");
  assert.strictEqual(G.barModel({ status: { ...RECORDING, pausedMs: 400 } }).paused, "");
  assert.strictEqual(G.barModel({ status: { ...RECORDING, paused: true, currentPauseMs: 400 } }).pauseNow, "");
  assert.strictEqual(G.barModel({ status: { tracking: false, pausedMs: 6000 } }).paused, "");
  assert.strictEqual(G.trayStatusLine({ ...RECORDING, paused: true, currentPauseMs: 3000 }), "Paused: Transaction 2");
});

test("lane FX3: the end summary's duration is the time recorded; a pause is said beside it", () => {
  assert.strictEqual(G.summaryModel({ runs: 4, durationMs: 77000, pausedMs: 6000 }).headline,
    "4 transactions, 1:17 (paused 0:06, not counted)");
  assert.strictEqual(G.summaryModel({ runs: 4, durationMs: 77000, pausedMs: 0 }).headline, "4 transactions, 1:17");
  assert.strictEqual(G.pausedText(3723000), "paused 1:02:03");
});

test("bar: after End transaction the bar says between transactions", () => {
  const m = G.barModel({ status: { ...RECORDING, openMarkers: [], markerDepth: 0 } });
  assert.strictEqual(m.runText, "between transactions");
});

test("bar: not recording says Not recording, with no transaction and no time", () => {
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

test("bar: a named-transaction caret only while recording and only when named transactions are set up", () => {
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

test("tray: the status line says Not recording, Recording: Transaction 2, Paused: between transactions", () => {
  assert.strictEqual(G.trayStatusLine({ tracking: false }), "Not recording");
  assert.strictEqual(G.trayStatusLine(RECORDING), "Recording: Transaction 2");
  assert.strictEqual(G.trayStatusLine({ ...RECORDING, paused: true, openMarkers: [] }),
    "Paused: between transactions");
  assert.strictEqual(G.trayStatusLine({ ...RECORDING, recorder_state: "dead" }),
    "Recording: Transaction 2 (clicks and typing not recorded)");
});

test("end summary: transactions and duration in one line, the folder, the zip name, no warning when a transaction was marked", () => {
  const folder = "C:\\Users\\sme\\AppData\\Roaming\\process-discovery-tracker\\sessions\\default\\20260924-101500";
  const m = G.summaryModel({ runs: 3, durationMs: (21 * 60 + 40) * 1000, sessionFolder: folder, hotkey: "Control+Shift+S" });
  assert.strictEqual(m.headline, "3 transactions, 21:40");
  assert.strictEqual(m.folder, folder);
  assert.strictEqual(m.zipName, "20260924-101500.zip");
  assert.strictEqual(m.warning, null);
  assert.strictEqual(G.summaryModel({ runs: 1, durationMs: 65000 }).headline, "1 transaction, 1:05");
});

test("end summary: a clear warning when no transaction was marked, naming the real key", () => {
  const m = G.summaryModel({ runs: 0, durationMs: 90000, sessionFolder: "D:\\r\\default\\x", hotkey: "Control+Alt+S" });
  assert.strictEqual(m.headline, "0 transactions, 1:30");
  assert.strictEqual(m.warning, "No transaction was marked, so the analyst cannot tell where each " +
    "transaction starts. Tell the analyst, or record again and press Ctrl+Alt+S each time you " +
    "start the process.");
  assert.match(m.warning, /press Ctrl\+Alt\+S each time you start the process/);
  const noKey = G.summaryModel({ runs: 0, durationMs: 1000 });
  assert.match(noKey.warning, /click Next transaction on the recording bar each time/);
  assert.match(G.summaryModel({}).warning, /^No transaction was marked/);
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

test("every sentence the SME reads here is free of machine words, the retired run and dash punctuation", () => {
  const texts = [];
  for (const status of [RECORDING, { ...RECORDING, paused: true }, { tracking: false },
    { ...RECORDING, openMarkers: [] }, { ...RECORDING, recorder_state: "dead" },
    { ...RECORDING, paused: true, pausedMs: 6000 }]) {
    const m = G.barModel({ status, hotkey: "Control+Shift+S", namedRuns: true });
    texts.push(m.stateText, m.runText, m.pauseLabel, m.title, m.problem || "", m.paused, m.pauseNow, G.trayStatusLine(status));
  }
  texts.push(G.summaryModel({ runs: 2, durationMs: 5000, pausedMs: 4000 }).headline);
  const s0 = G.summaryModel({ runs: 0, durationMs: 5000, sessionFolder: "D:\\r\\default\\x", hotkey: "Control+Shift+S" });
  const s1 = G.summaryModel({ runs: 0, durationMs: 5000 });
  const s3 = G.summaryModel({ runs: 3, durationMs: 5000 });
  texts.push(s0.headline, s0.warning, s1.warning, s3.headline, G.CLICKS_NOT_RECORDED, G.TRANSACTION_MEANS);
  for (const t of texts) {
    assert.ok(!MACHINE_WORDS.test(t), "machine word in: " + t);
    assert.ok(!RETIRED_WORDS.test(t), "run for a transaction in: " + t);
    assert.ok(!/[\u2013\u2014]|\s--\s|\w\s-\s\w/.test(t), "dash punctuation in: " + t);
  }
});

/* The visible text of a capture page: scripts, styles and tags out. */
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
}

test("the welcome and Help say transaction and explain it where the SME first meets the word", () => {
  // Required here, not at the top: both require electron, which plain node
  // resolves to the binary's path, so their page builders still load.
  const W = require("../welcome-window.js");
  const H = require("../help-window.js");
  for (const keys of [{ start: "Control+Shift+S" }, {}]) {
    const lines = W.welcomeLines({ keys });
    assert.match(lines.start, /It starts with Transaction 1\. A transaction is one pass through the process/);
    assert.ok(lines.start.endsWith(G.TRANSACTION_MEANS), lines.start);
    assert.match(lines.next, /next transaction|Next transaction/);
    const page = visibleText(W.buildHtml({ keys }));
    assert.ok(page.includes(G.TRANSACTION_MEANS), "the welcome defines a transaction");
    assert.ok(!RETIRED_WORDS.test(page), "run in the welcome: " + page);
  }
  const help = visibleText(H.buildHelpHtml({ keys: { start: "Control+Shift+S", end: "Control+Shift+E" }, folder: "C:/x" }));
  assert.ok(help.includes("Recording starts with Transaction 1"), help);
  assert.ok(help.includes("The next transaction. " + G.TRANSACTION_MEANS), help);
  assert.ok(help.includes("Ctrl+Shift+E ends the current transaction"), help);
  assert.ok(!/\{\{/.test(help), "a placeholder left in Help");
  assert.ok(!RETIRED_WORDS.test(help), "run in Help: " + help);
  const noKey = visibleText(H.buildHelpHtml({ keys: {}, folder: "C:/x" }));
  assert.ok(noKey.includes("click Next transaction on the bar."), noKey);
});
