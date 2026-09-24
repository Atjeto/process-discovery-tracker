"use strict";
// The save state in the top bar (save-state.js): the pure state logic, and the
// element as the renderer drives it (a fake element, fake timers and a fixed
// clock). The real top bar, a real read-only annotations.json and the real
// write reports of main.js are in e2e/companion-smoke.js (o).

const test = require("node:test");
const assert = require("node:assert");
const S = require("./save-state.js");

const FOLDER = "D:\\Projects\\Order call";
const T0 = new Date("2026-09-24T10:15:30Z");
const fmt = (d) => d.toISOString().slice(11, 19);   // "10:15:30"

const start = (channel, folder) => ({ folder: folder || FOLDER, channel, phase: "start" });
const ok = (channel, folder) => ({ folder: folder || FOLDER, channel, phase: "end", ok: true, error: null, code: null });
const fail = (channel, error, code, folder) => ({ folder: folder || FOLDER, channel, phase: "end", ok: false, error, code: code || null });

/* A state after a list of reports, each arriving one second after the last. */
function after(reports, state) {
  let s = state || S.initialState(FOLDER);
  reports.forEach((r, i) => { s = S.applyWrite(s, r, new Date(T0.getTime() + i * 1000)); });
  return s;
}

test("a project just opened says Saved, and the tooltip says every change saves itself to its folder", () => {
  const v = S.view(S.initialState(FOLDER), fmt);
  assert.deepStrictEqual(v, { kind: "saved", text: "Saved",
    title: "Every change saves itself to the project folder: D:\\Projects\\Order call." });
});

test("a save that reached the folder says Saved with its time; one still under way changes nothing until Saving... is shown", () => {
  const s = after([start("annotations"), ok("annotations")]);
  assert.deepStrictEqual(S.view(s, fmt), { kind: "saved", text: "Saved",
    title: "Saved at 10:15:31. Every change saves itself to the project folder: D:\\Projects\\Order call." });
  const running = after([start("annotations")]);
  assert.strictEqual(running.inFlight, 1);
  assert.strictEqual(S.view(running, fmt).text, "Saved", "no Saving... before the delay has passed");
  const shown = Object.assign({}, running, { savingShown: true });
  assert.deepStrictEqual(S.view(shown, fmt), { kind: "saving", text: "Saving...",
    title: "Saving to the project folder: D:\\Projects\\Order call." });
});

test("a failed annotations save says Not saved: the reason in plain words, what the system said, and that the change waits on screen", () => {
  const raw = "EPERM: operation not permitted, rename 'D:\\Projects\\Order call\\annotations.json.tmp-1-2'";
  const v = S.view(after([start("annotations"), fail("annotations", raw, "EPERM")]), fmt);
  assert.strictEqual(v.kind, "failed");
  assert.strictEqual(v.text, "Not saved");
  assert.strictEqual(v.title, "Your change was not saved: a file in the project folder is read-only, or another program holds it (" +
    raw + "). It stays on screen and is saved with your next change once the problem is fixed.");
  // The code can also come only from the message.
  const fromMessage = S.view(after([fail("annotations", "ENOSPC: no space left on device, write")]), fmt);
  assert.match(fromMessage.title, /^Your change was not saved: the disk is full \(ENOSPC: no space left on device, write\)\. It stays on screen/);
});

test("a failed annotations save stays through successful saves of other kinds and ends with the next annotations save", () => {
  const failed = after([fail("annotations", "EPERM: operation not permitted", "EPERM")]);
  for (const other of ["transcript", "video", "screenshot", "attachment"]) {
    const s = after([start(other), ok(other)], failed);
    assert.strictEqual(S.view(s, fmt).text, "Not saved", "a " + other + " save does not write the change waiting on screen");
  }
  const saved = after([start("transcript"), ok("transcript"), start("annotations"), ok("annotations")], failed);
  assert.strictEqual(S.view(saved, fmt).text, "Saved");
  assert.deepStrictEqual(saved.failures, []);
});

test("a failed write of another kind left nothing waiting: the next successful save of any kind ends it", () => {
  for (const [kind, what] of [["screenshot", "The screenshot"], ["attachment", "The attachment"], ["video", "The video"], ["transcript", "The transcript change"]]) {
    const failed = after([start(kind), fail(kind, "this is not a PNG or JPEG image")]);
    const v = S.view(failed, fmt);
    assert.strictEqual(v.text, "Not saved");
    assert.strictEqual(v.title, what + " was not saved: this is not a PNG or JPEG image.", "no waiting sentence for " + kind);
    for (const next of ["annotations", "transcript", kind]) {
      assert.strictEqual(S.view(after([start(next), ok(next)], failed), fmt).text, "Saved", kind + " failure ended by a " + next + " save");
    }
  }
});

test("a failed map save (the editor's delayed write, a new copy) says the map was not saved, and stays until a map save succeeds", () => {
  const raw = "ENOSPC: no space left on device, write";
  const failed = after([start("map"), fail("map", raw, "ENOSPC")]);
  const v = S.view(failed, fmt);
  assert.strictEqual(v.text, "Not saved");
  assert.strictEqual(v.title, "The map was not saved: the disk is full (" + raw + ").");
  // The edit waits in the editor: a save of another kind does not write it.
  for (const other of ["annotations", "transcript", "video", "screenshot", "attachment"]) {
    assert.strictEqual(S.view(after([start(other), ok(other)], failed), fmt).text, "Not saved", "a " + other + " save");
  }
  const saved = after([start("annotations"), ok("annotations"), start("map"), ok("map")], failed);
  assert.strictEqual(S.view(saved, fmt).text, "Saved");
  assert.deepStrictEqual(saved.failures, []);
  // And a map save does not write a change of annotations waiting on screen.
  const both = after([fail("annotations", "EBUSY: resource busy or locked", "EBUSY"), start("map"), ok("map")]);
  assert.strictEqual(S.view(both, fmt).text, "Not saved");
  assert.deepStrictEqual(both.failures.map((f) => f.channel), ["annotations"]);
});

test("while failures stand, the change waiting on screen is said first, then the others, latest first; a new failure of one kind replaces the old", () => {
  const s = after([
    fail("screenshot", "first screenshot problem"),
    fail("annotations", "EBUSY: resource busy or locked", "EBUSY"),
    fail("attachment", "attachment problem"),
    fail("screenshot", "second screenshot problem"),
  ]);
  assert.strictEqual(s.failures.length, 3);
  assert.strictEqual(S.view(s, fmt).title,
    "Your change was not saved: another program holds a file in the project folder (EBUSY: resource busy or locked). " +
    "It stays on screen and is saved with your next change once the problem is fixed. " +
    "The screenshot was not saved: second screenshot problem. " +
    "The attachment was not saved: attachment problem.");
});

test("a change refused while the analysis runs is said as main says it, without the waiting sentence (the page reloads)", () => {
  const busy = "the steps and the map are being updated. Make the change again once the update is done.";
  const v = S.view(after([start("annotations"), fail("annotations", busy, "ANALYSIS_RUNNING")]), fmt);
  assert.strictEqual(v.title, "Your change was not saved: " + busy);
});

test("a project folder that is gone is said in plain words, without main's own sentence", () => {
  const v = S.view(after([fail("annotations", "Refusing to write annotations: not a project folder.", "NO_PROJECT")]), fmt);
  assert.strictEqual(v.title, "Your change was not saved: the project folder was not found (was it moved, renamed or deleted?). " +
    "It stays on screen and is saved with your next change once the problem is fixed.");
  const empty = S.view(after([fail("attachment", "", null)]), fmt);
  assert.strictEqual(empty.title, "The attachment was not saved: no reason was given.");
});

test("an annotations.json that cannot be read is Not saved from the moment the project opens, until a load can read it or a save succeeds", () => {
  const err = { file: "annotations.json", reason: "SyntaxError: Unexpected token", backups: [], message: "..." };
  const opened = S.initialState(FOLDER, err);
  const v = S.view(opened, fmt);
  assert.strictEqual(v.text, "Not saved");
  assert.strictEqual(v.title, "The file annotations.json in the project folder cannot be read, so no change is saved until it is fixed: " +
    "the message at the top of the page says how.");
  // main refuses the saves meanwhile (the same code): still Not saved.
  const refused = after([start("annotations"), fail("annotations", "The file annotations.json ...", "ANNOTATIONS_UNREADABLE")], opened);
  assert.strictEqual(S.view(refused, fmt).text, "Not saved");
  assert.strictEqual(refused.failures.length, 1);
  // Loaded again once the file was fixed.
  assert.strictEqual(S.view(S.withUnreadable(refused, null), fmt).text, "Saved");
  assert.strictEqual(S.view(after([start("annotations"), ok("annotations")], opened), fmt).text, "Saved");
});

test("a report for another folder changes nothing; the same folder matches in any case and with either slash", () => {
  const s = S.initialState(FOLDER);
  assert.strictEqual(S.applyWrite(s, fail("annotations", "x", "EPERM", "D:\\Projects\\Other"), T0), s);
  assert.strictEqual(S.applyWrite(s, { phase: "end" }, T0), s, "no folder");
  assert.strictEqual(S.applyWrite(s, null, T0), s);
  assert.ok(S.sameFolder("d:/projects/ORDER CALL/", FOLDER));
  assert.ok(!S.sameFolder("D:\\Projects\\Order call 2", FOLDER));
  assert.ok(!S.sameFolder(null, FOLDER));
  // An end without its start never counts below zero.
  assert.strictEqual(after([ok("annotations"), ok("annotations")]).inFlight, 0);
});

/* ---- The element, as renderer.js mounts it --------------------------------- */

function fakeEl() {
  const classes = new Set();
  const el = {
    textContent: "Saved", title: "", dataset: {}, offsetWidth: 0, fades: 0, writes: 0,
    classList: {
      add(c) { if (c === "fade") el.fades++; classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
    },
  };
  let text = el.textContent;
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(v) { el.writes++; text = v; },
  });
  return el;
}

/* Mount on a fake element; returns the element, the report function main.js
   would call, the pending timers and a way to run them, and the clock. */
function mounted() {
  const el = fakeEl();
  const timers = [];
  let report = null;
  let now = T0.getTime();
  S.mount(el, {
    subscribe: (fn) => { report = fn; },
    now: () => new Date(now),
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { t.cleared = true; },
    fmtTime: fmt,
  });
  return {
    el, timers,
    report: (evt) => report(evt),
    tick: (ms) => { now += ms; },
    runTimers: () => { for (const t of timers.splice(0)) if (!t.cleared) t.fn(); },
  };
}

test("mounted: the subscription is taken, the element says Saved, and opening a project names its folder", () => {
  const m = mounted();
  assert.strictEqual(m.el.textContent, "Saved");
  assert.strictEqual(m.el.dataset.state, "saved");
  S.projectOpened({ sessionFolder: FOLDER });
  assert.strictEqual(m.el.title, "Every change saves itself to the project folder: D:\\Projects\\Order call.");
});

test("mounted: a quick save never shows Saving..., fades Saved in again and puts its time in the tooltip", () => {
  const m = mounted();
  S.projectOpened({ sessionFolder: FOLDER });
  const fades = m.el.fades, writes = m.el.writes;
  m.report(start("annotations"));
  assert.strictEqual(m.timers.length, 1);
  assert.strictEqual(m.timers[0].ms, S.SAVING_DELAY_MS);
  m.tick(40);
  m.report(ok("annotations"));
  assert.ok(m.timers[0].cleared, "the Saving... timer is cleared when the write ends");
  m.runTimers();
  assert.strictEqual(m.el.textContent, "Saved");
  assert.strictEqual(m.el.writes, writes, "the word itself was never rewritten");
  assert.strictEqual(m.el.fades, fades + 1, "one fade for the save");
  assert.strictEqual(m.el.title, "Saved at 10:15:30. Every change saves itself to the project folder: D:\\Projects\\Order call.");
});

test("mounted: a slow write shows Saving... once the delay has passed, then Saved", () => {
  const m = mounted();
  S.projectOpened({ sessionFolder: FOLDER });
  m.report(start("video"));
  m.report(start("annotations"));
  assert.strictEqual(m.timers.length, 1, "one timer for writes that overlap");
  m.runTimers();
  assert.strictEqual(m.el.textContent, "Saving...");
  assert.strictEqual(m.el.dataset.state, "saving");
  m.report(ok("annotations"));
  assert.strictEqual(m.el.textContent, "Saving...", "the video is still being written");
  m.tick(5000);
  m.report(ok("video"));
  assert.strictEqual(m.el.textContent, "Saved");
  assert.strictEqual(m.el.dataset.state, "saved");
  assert.match(m.el.title, /^Saved at 10:15:35\. /);
});

test("mounted: Not saved in the failed state until the next annotations save; another project starts over", () => {
  const m = mounted();
  S.projectOpened({ sessionFolder: FOLDER });
  m.report(start("annotations"));
  m.report(fail("annotations", "EPERM: operation not permitted, rename", "EPERM"));
  assert.strictEqual(m.el.textContent, "Not saved");
  assert.strictEqual(m.el.dataset.state, "failed");
  assert.match(m.el.title, /read-only, or another program holds it \(EPERM: operation not permitted, rename\)/);
  m.report(start("transcript"));
  m.report(ok("transcript"));
  assert.strictEqual(m.el.textContent, "Not saved");
  // Loaded again (the same folder): the failure stays.
  S.projectOpened({ sessionFolder: FOLDER.toUpperCase() });
  assert.strictEqual(m.el.textContent, "Not saved");
  // Another project: nothing of the first is carried, and its reports are ignored.
  S.projectOpened({ sessionFolder: "D:\\Projects\\Invoice run" });
  assert.strictEqual(m.el.textContent, "Saved");
  m.report(fail("annotations", "EPERM: late report of the first project", "EPERM"));
  assert.strictEqual(m.el.textContent, "Saved");
  S.projectOpened({ sessionFolder: FOLDER });
  m.report(fail("annotations", "EPERM: x", "EPERM"));
  m.report(start("annotations"));
  m.report(ok("annotations"));
  assert.strictEqual(m.el.textContent, "Saved");
});

test("mounted: a map edit shows Saving... while it waits for its delayed write, then Saved", () => {
  const m = mounted();
  S.projectOpened({ sessionFolder: FOLDER });
  m.report(start("map"));
  m.runTimers();
  assert.strictEqual(m.el.textContent, "Saving...");
  m.report(ok("map"));
  assert.strictEqual(m.el.textContent, "Saved");
  m.report(start("map"));
  m.report(fail("map", "EPERM: operation not permitted, open", "EPERM"));
  assert.strictEqual(m.el.textContent, "Not saved");
  assert.match(m.el.title, /^The map was not saved: a file in the project folder is read-only/);
});

test("mounted: a project whose annotations.json cannot be read opens as Not saved", () => {
  const m = mounted();
  S.projectOpened({ sessionFolder: FOLDER, annotationsError: { reason: "SyntaxError" } });
  assert.strictEqual(m.el.textContent, "Not saved");
  assert.match(m.el.title, /^The file annotations\.json in the project folder cannot be read/);
  S.projectOpened({ sessionFolder: FOLDER, annotationsError: null });
  assert.strictEqual(m.el.textContent, "Saved");
});
