"use strict";
// The one start (recording-control.js): the Start recording button, the tray
// item, the welcome's button and the run key all start the recording with
// Run 1; each later start is the next run; runs never nest (the tracker ends
// the open run first); Stop ends the recording; presses during a start or a
// stop are absorbed.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createRecordingControl } = require("../recording-control.js");

/* A recording double with the tracker's run rule: a start while a run is
   open ends that run first ("Run N" counts every start). */
function fakeRecording(opts = {}) {
  const rec = {
    recording: false,
    recordingsStarted: 0,
    stops: 0,
    open: null,
    log: [],
    startCount: 0,
  };
  rec.startRecording = async () => {
    if (opts.gate) await opts.gate;
    if (opts.decline) return false;
    rec.recording = true;
    rec.recordingsStarted += 1;
    rec.startCount = 0;
    return true;
  };
  rec.startRun = (label) => {
    if (rec.open) rec.log.push("end " + rec.open);
    rec.startCount += 1;
    rec.open = label || "Run " + rec.startCount;
    rec.log.push("start " + rec.open);
    return rec.open;
  };
  rec.stopRecording = async () => {
    if (opts.stopGate) await opts.stopGate;
    if (rec.open) rec.log.push("end " + rec.open);
    rec.open = null;
    rec.recording = false;
    rec.stops += 1;
    return "folder-" + rec.stops;
  };
  rec.control = createRecordingControl({
    isRecording: () => rec.recording,
    startRecording: rec.startRecording,
    startRun: rec.startRun,
    stopRecording: rec.stopRecording,
  });
  return rec;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("one start: with nothing recording, start() starts the recording with Run 1", async () => {
  const rec = fakeRecording();
  const r = await rec.control.start();
  assert.deepStrictEqual(r, { started: true, run: "Run 1", newRecording: true });
  assert.strictEqual(rec.recordingsStarted, 1);
  assert.deepStrictEqual(rec.log, ["start Run 1"]);
});

test("one start: each later start is the next run, never a second recording, and runs never nest", async () => {
  const rec = fakeRecording();
  await rec.control.start();
  const r2 = await rec.control.start();
  const r3 = await rec.control.start();
  assert.deepStrictEqual([r2.run, r3.run], ["Run 2", "Run 3"]);
  assert.strictEqual(r2.newRecording, false);
  assert.strictEqual(rec.recordingsStarted, 1);
  assert.deepStrictEqual(rec.log, [
    "start Run 1", "end Run 1", "start Run 2", "end Run 2", "start Run 3",
  ]);
});

test("one start: a named run is started the same way and takes its name", async () => {
  const rec = fakeRecording();
  await rec.control.start();
  const r = await rec.control.start("Refund flow");
  assert.strictEqual(r.run, "Refund flow");
  assert.deepStrictEqual(rec.log, ["start Run 1", "end Run 1", "start Refund flow"]);
});

// Timeouts: a regression here must fail, never hang the suite on the gate.
test("one start: presses while the recording is still starting are absorbed, not queued", { timeout: 5000 }, async () => {
  const gate = deferred();
  const rec = fakeRecording({ gate: gate.promise });
  const first = rec.control.start();                 // e.g. the consent window is open
  const second = rec.control.start();                // the SME presses the key again
  const third = rec.control.start("Refund flow");
  assert.strictEqual(rec.control.busy(), "starting");
  gate.resolve();
  const [r1, r2, r3] = await Promise.all([first, second, third]);
  assert.deepStrictEqual(r2, { started: false, reason: "starting" });
  assert.deepStrictEqual(r3, { started: false, reason: "starting" });
  assert.strictEqual(r1.run, "Run 1");
  assert.strictEqual(rec.recordingsStarted, 1);
  assert.deepStrictEqual(rec.log, ["start Run 1"]);
  assert.strictEqual(rec.control.busy(), null);
});

test("one start: a declined start (consent) starts no run, and a later start tries again", async () => {
  const rec = fakeRecording({ decline: true });
  const r = await rec.control.start();
  assert.deepStrictEqual(r, { started: false, reason: "not_started" });
  assert.deepStrictEqual(rec.log, []);
  const again = await rec.control.start();
  assert.strictEqual(again.started, false);
  assert.strictEqual(rec.control.busy(), null);
});

test("one start: a start that throws leaves the control usable", async () => {
  let calls = 0;
  const control = createRecordingControl({
    isRecording: () => false,
    startRecording: async () => { calls += 1; throw new Error("boom"); },
    startRun: () => "never",
    stopRecording: async () => null,
  });
  await assert.rejects(control.start(), /boom/);
  assert.strictEqual(control.busy(), null);
  await assert.rejects(control.start(), /boom/);
  assert.strictEqual(calls, 2);
});

test("stop ends the recording; the next start is a new recording with Run 1", async () => {
  const rec = fakeRecording();
  await rec.control.start();
  await rec.control.start();
  const stopped = await rec.control.stop();
  assert.deepStrictEqual(stopped, { stopped: true, result: "folder-1" });
  assert.strictEqual(rec.recording, false);
  const r = await rec.control.start();
  assert.deepStrictEqual(r, { started: true, run: "Run 1", newRecording: true });
  assert.strictEqual(rec.recordingsStarted, 2);
});

test("stop with nothing recording does nothing", async () => {
  const rec = fakeRecording();
  assert.deepStrictEqual(await rec.control.stop(), { stopped: false, reason: "not_recording" });
  assert.strictEqual(rec.stops, 0);
});

test("a start or a second stop while stopping is absorbed: no run after the recording ended", { timeout: 5000 }, async () => {
  const stopGate = deferred();
  const rec = fakeRecording({ stopGate: stopGate.promise });
  await rec.control.start();
  const stopping = rec.control.stop();
  const startDuring = rec.control.start();
  const stopDuring = rec.control.stop();
  stopGate.resolve();
  const [, started, stoppedAgain] = await Promise.all([stopping, startDuring, stopDuring]);
  assert.deepStrictEqual(started, { started: false, reason: "stopping" });
  assert.deepStrictEqual(stoppedAgain, { stopped: false, reason: "stopping" });
  assert.strictEqual(rec.stops, 1);
  assert.deepStrictEqual(rec.log, ["start Run 1", "end Run 1"]);
});

// Wiring guard: main.js is Electron-only, so the rule is pinned at the
// source level. Every start path goes through startFromUi (the control), and
// startSession() is called only by the control's startRecording.
test("main.js: the button, the tray, the welcome, the key and pdt:startSession all use the one start", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf-8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")            // block comments
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");      // line comments (not URLs)
  const calls = code.match(/(?<!function )\bstartSession\(\)/g) || [];
  assert.strictEqual(calls.length, 1, "startSession() is called once, by the control's startRecording");
  assert.match(src, /startRecording: async \(\) => \{\s*const s = await startSession\(\);/);
  assert.match(src, /ipcMain\.handle\("pdt:fireStart", \(_e, label\) => startFromUi\(label\)\)/);
  assert.match(src, /ipcMain\.handle\("pdt:startSession", async \(\) => \{\s*const r = await startFromUi\(\);/);
  assert.match(src, /registerHotkey\(config\.hotkeys\.start_picker, \(\) => \{ startFromUi\(\); \}\)/);
  assert.match(src, /if \(action === "start"\) return startFromUi\(\);/);
  assert.match(src, /label: "Start recording",\s*accelerator: keyFor\("start"\) \|\| undefined,\s*click: \(\) => \{ startFromUi\(\); \}/);
  assert.match(src, /label: "Next run",\s*accelerator: keyFor\("start"\) \|\| undefined,\s*click: \(\) => \{ startFromUi\(\); \}/);
  assert.ok(!/fireStartMarker/.test(src), "the old two-way start is gone");
});

test("the recording bar's Start recording and Next run buttons both send the one start", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "ui", "recording-bar.html"), "utf-8");
  assert.match(html, /\$\("btn-start"\)\.addEventListener\("click", async \(\) => \{ await ipcRenderer\.invoke\("pdt:fireStart"\)/);
  assert.match(html, /\$\("btn-next"\)\.addEventListener\("click", async \(\) => \{ await ipcRenderer\.invoke\("pdt:fireStart"\)/);
  assert.ok(!/pdt:startSession/.test(html), "the bar never starts a recording without a run");
});
