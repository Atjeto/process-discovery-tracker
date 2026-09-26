"use strict";
/* Recorder sidecar supervision: RP-20 (per-session restart cap), RP-22
 * (spawn failure reaches the exit/restart path), RP-23 (stop() waits for
 * the recorder's final output). A fake child stands in for recorder.exe via
 * spawnRecorder's spawnFn seam; RP-22 uses a real spawn of a missing exe. */

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { spawnRecorder, superviseRecorder, warmUpRecorder } = require("../recorder.js");

/* A ChildProcess look-alike: piped stdio, and 'close' once stdout has
   closed (as Node emits it after the stdio streams end). `onStdin` sees
   every line the parent writes (hello, shutdown, ...). */
function fakeChild({ onStdin } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _enc, cb) { if (onStdin) onStdin(String(chunk), child); cb(); },
  });
  child.kill = () => true;
  child.stdout.on("close", () => child.emit("close", 0, null));
  return child;
}

/* Shutdown in the order a real sidecar can produce: the process exits,
   while its last flushed line is still in the pipe. */
function exitThenFlush(finalLine) {
  return (text, child) => {
    if (!text.includes('"shutdown"')) return;
    setImmediate(() => {
      child.emit("exit", 0, null);
      setImmediate(() => { child.stdout.end(finalLine + "\n"); child.stderr.end(); });
    });
  };
}

test("RP-20: a crash-looping recorder reaches the per-session restart cap and is declared dead", async () => {
  let spawns = 0;
  const spawnFn = () => {
    spawns += 1;
    const child = fakeChild();
    // Crash right after launch, like a recorder that dies on start. After
    // 10 spawns stop crashing, so a missing cap ends the test, not a loop.
    if (spawns <= 10) setImmediate(() => child.emit("exit", 3221225477, null));
    return child;
  };
  const died = [];
  let dead = 0;
  let started = 0;
  await new Promise((resolve) => {
    superviseRecorder({
      spawnOpts: { sessionId: "t", recorderPath: "fake-recorder.exe", spawnFn, bootLog: () => {} },
      autoRestart: true,
      maxRestarts: 3,
      schedule: (fn) => setImmediate(fn),
      onStarted: () => { started += 1; if (started > 10) resolve(); },
      onDied: (info) => died.push(info.restart_count),
      onDead: () => { dead += 1; resolve(); },
    });
  });
  assert.equal(dead, 1, "recorder_dead_permanent fires once");
  assert.equal(started, 4, "the first spawn plus exactly 3 restarts");
  assert.deepEqual(died, [0, 1, 2, 3], "recorder_died carries the running restart count");
});

test("superviseRecorder: after stop(), the recorder's clean exit is neither a death nor a restart", async () => {
  let spawns = 0;
  const spawnFn = () => { spawns += 1; return fakeChild({ onStdin: exitThenFlush('{"v":1,"type":"stats","data":{}}') }); };
  const died = [];
  const sup = superviseRecorder({
    spawnOpts: { sessionId: "t", recorderPath: "fake-recorder.exe", spawnFn, onStats: () => {}, bootLog: () => {} },
    autoRestart: true,
    maxRestarts: 3,
    schedule: (fn) => setImmediate(fn),
    onStarted: () => {},
    onDied: (info) => died.push(info),
    onDead: () => { throw new Error("onDead must not fire on a clean stop"); },
  });
  assert.ok(sup.current(), "a live recorder after start");
  await sup.stop({ drainTimeoutMs: 1000 });
  await new Promise((r) => setImmediate(r));
  assert.equal(sup.current(), null);
  assert.deepEqual(died, []);
  assert.equal(spawns, 1);
});

test("RP-22: a recorder that cannot start reaches onExit once, not an uncaught 'error'", async () => {
  const missing = path.join(os.tmpdir(), `pdt-no-such-recorder-${process.pid}.exe`);
  const exits = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("onExit was never called for a spawn failure")), 5000);
    spawnRecorder({
      sessionId: "t",
      recorderPath: missing,
      bootLog: () => {},
      onExit: (info) => {
        exits.push(info);
        clearTimeout(timer);
        setTimeout(resolve, 200);   // time for a duplicate report to show up
      },
    });
  });
  assert.equal(exits.length, 1, "reported exactly once");
  assert.equal(exits[0].code, null);
  assert.equal(exits[0].signal, null);
  assert.match(exits[0].error, /ENOENT/);
});

test("RP-23: stop() resolves only after the recorder's final output reached onEvent", async () => {
  const events = [];
  const finalLine = JSON.stringify({
    v: 1, type: "interaction", data: { kind: "value_changed", name: "Customer", value: "Acme" },
  });
  const rec = spawnRecorder({
    sessionId: "t",
    recorderPath: "fake-recorder.exe",
    spawnFn: () => fakeChild({ onStdin: exitThenFlush(finalLine) }),
    onEvent: (d) => events.push(d),
    bootLog: () => {},
  });
  await rec.stop({ drainTimeoutMs: 1000 });
  assert.deepEqual(events.map((d) => d.value), ["Acme"], "the last typed value was not dropped");
});

test("lane LF-SME: the recorder's activity lines reach onActivity and never onEvent", async () => {
  const events = [];
  const activity = [];
  const lines = [
    JSON.stringify({ v: 1, type: "activity", data: { process_name: "chrome.exe" } }),
    JSON.stringify({ v: 1, type: "interaction", data: { kind: "invoked", name: "Save order" } }),
  ].join("\n");
  const rec = spawnRecorder({
    sessionId: "t",
    recorderPath: "fake-recorder.exe",
    spawnFn: () => fakeChild({ onStdin: exitThenFlush(lines) }),
    onEvent: (d) => events.push(d),
    onActivity: (d) => activity.push(d),
    bootLog: () => {},
  });
  await rec.stop({ drainTimeoutMs: 1000 });
  assert.deepEqual(activity, [{ process_name: "chrome.exe" }]);
  assert.deepEqual(events.map((d) => d.kind), ["invoked"], "an activity line is not an interaction");
});

test("live finding 15: the warm-up starts the recorder once in a worker, asks it to shut down, and reports", async () => {
  // Node stands in for recorder.exe: it ends when its stdin (the shutdown line) ends.
  const fake = ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"];
  const r = await warmUpRecorder(process.execPath, { args: fake, timeoutMs: 20000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.code, 0);
  assert.ok(Number.isFinite(r.spawnMs) && Number.isFinite(r.totalMs), JSON.stringify(r));
  const missing = await warmUpRecorder(path.join(os.tmpdir(), `pdt-no-such-recorder-${process.pid}.exe`));
  assert.equal(missing.ok, false);
  assert.match(String(missing.error), /ENOENT/);
});
