"use strict";
// The map editor's delayed write (bpmn-viewer.js createDelayedWrite): an
// edit waits 600 ms for its write, and the save state in the top bar hears
// one start and one end for it (save-state.js), with fake timers and a fake
// write. The real editor, its file and the top bar are in
// e2e/panel-smoke.js (f).

const test = require("node:test");
const assert = require("node:assert");
const { createDelayedWrite } = require("./bpmn-viewer.js");

/* A writer on fake timers: the reports it made, the writes it ran, and a
   way to run the timers due. `result(n)` decides the n-th write (a value, or
   a thrown error; a promise to hold the write in flight). */
function harness(result) {
  const reports = [];
  const timers = [];
  let writes = 0;
  const w = createDelayedWrite({
    delayMs: 600,
    report: (evt) => reports.push(evt),
    write: async () => { writes += 1; return result ? result(writes) : undefined; },
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
  });
  return {
    w, reports, timers,
    writes: () => writes,
    runTimers: async () => {
      for (const t of timers.splice(0)) if (!t.cleared) t.fn();
      await new Promise((r) => setImmediate(r));
    },
  };
}
const START = { phase: "start" };
const OK = { phase: "end", ok: true, error: null, code: null };

test("an edit says it waits at once, is written after the delay, and says it is saved", async () => {
  const h = harness();
  h.w.schedule();
  assert.deepStrictEqual(h.reports, [START]);
  assert.strictEqual(h.timers[0].ms, 600);
  assert.strictEqual(h.writes(), 0, "nothing is written before the delay");
  assert.strictEqual(h.w.pending(), true);
  await h.runTimers();
  assert.strictEqual(h.writes(), 1);
  assert.deepStrictEqual(h.reports, [START, OK]);
  assert.strictEqual(h.w.pending(), false);
});

test("edits within the delay are one write, one start and one end", async () => {
  const h = harness();
  h.w.schedule();
  h.w.schedule();
  h.w.schedule();
  assert.strictEqual(h.timers.filter((t) => !t.cleared).length, 1, "each edit restarts the delay");
  await h.runTimers();
  assert.strictEqual(h.writes(), 1);
  assert.deepStrictEqual(h.reports, [START, OK]);
});

test("a failed write says why (the message and the file system code), and the next edit starts again", async () => {
  const h = harness((n) => {
    if (n === 1) throw Object.assign(new Error("EPERM: operation not permitted, open 'x.bpmn'"), { code: "EPERM" });
  });
  h.w.schedule();
  await h.runTimers();
  assert.deepStrictEqual(h.reports, [START,
    { phase: "end", ok: false, error: "EPERM: operation not permitted, open 'x.bpmn'", code: "EPERM" }]);
  h.w.schedule();
  await h.runTimers();
  assert.strictEqual(h.writes(), 2);
  assert.deepStrictEqual(h.reports.slice(2), [START, OK]);
});

test("an edit made while a write runs waits for the next write: the start stays open until nothing waits", async () => {
  let release = null;
  const h = harness((n) => (n === 1 ? new Promise((r) => { release = r; }) : undefined));
  h.w.schedule();
  await h.runTimers();
  assert.strictEqual(h.writes(), 1, "the first write is in flight");
  h.w.schedule();               // an edit during the write
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(h.reports, [START], "no end while an edit still waits");
  await h.runTimers();
  assert.strictEqual(h.writes(), 2);
  assert.deepStrictEqual(h.reports, [START, OK]);
});

test("flush writes what waits at once (before another map opens); with nothing waiting it writes nothing", async () => {
  const h = harness();
  await h.w.flush();
  assert.strictEqual(h.writes(), 0);
  assert.deepStrictEqual(h.reports, []);
  h.w.schedule();
  await h.w.flush();
  assert.ok(h.timers[0].cleared, "the delay is cancelled");
  assert.strictEqual(h.writes(), 1);
  assert.deepStrictEqual(h.reports, [START, OK]);
  await h.runTimers();
  assert.strictEqual(h.writes(), 1, "written once");
});

test("a report that fails is logged, and the writes go on", async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    let writes = 0;
    const w = createDelayedWrite({ delayMs: 0, write: async () => { writes += 1; }, report: () => { throw new Error("gone"); } });
    w.schedule();
    await w.flush();
    w.schedule();
    await w.flush();
    assert.strictEqual(writes, 2);
    assert.ok(logged.length >= 2 && logged.every((l) => /the save state was not told/.test(l)));
  } finally {
    console.error = orig;
  }
});

test("a writer with no report still writes", async () => {
  let wrote = 0;
  const w = createDelayedWrite({ delayMs: 0, write: async () => { wrote += 1; } });
  w.schedule();
  await w.flush();
  assert.strictEqual(wrote, 1);
});
