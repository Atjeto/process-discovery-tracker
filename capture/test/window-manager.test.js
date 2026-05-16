"use strict";
// C5 — unit tests for the shared window-manager singleton helper.

const test = require("node:test");
const assert = require("node:assert");
const { createWindowManager } = require("../window-manager.js");

function fakeWindow() {
  const listeners = {};
  return {
    destroyed: false,
    shown: 0,
    focused: 0,
    show() { this.shown++; },
    focus() { this.focused++; },
    close() { this.destroyed = true; (listeners.closed || []).forEach((fn) => fn()); },
    isDestroyed() { return this.destroyed; },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
}

test("show builds a window once and reuses it on the next call", () => {
  const wm = createWindowManager();
  let built = 0;
  const factory = () => { built++; return fakeWindow(); };
  const first = wm.show("k", factory);
  const second = wm.show("k", factory);
  assert.strictEqual(built, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(second.shown, 1);
  assert.strictEqual(second.focused, 1);
});

test("isOpen reflects live state", () => {
  const wm = createWindowManager();
  assert.strictEqual(wm.isOpen("k"), false);
  wm.show("k", fakeWindow);
  assert.strictEqual(wm.isOpen("k"), true);
});

test("toggle opens when closed and closes when open", () => {
  const wm = createWindowManager();
  const win = wm.toggle("k", fakeWindow);
  assert.ok(win);
  assert.strictEqual(wm.isOpen("k"), true);
  const closed = wm.toggle("k", fakeWindow);
  assert.strictEqual(closed, null);
  assert.strictEqual(wm.isOpen("k"), false);
  assert.strictEqual(win.destroyed, true);
});

test("a window closed externally is forgotten", () => {
  const wm = createWindowManager();
  const win = wm.show("k", fakeWindow);
  win.close();
  assert.strictEqual(wm.isOpen("k"), false);
  assert.strictEqual(wm.get("k"), null);
});

test("a destroyed window is rebuilt on the next show", () => {
  const wm = createWindowManager();
  let built = 0;
  const factory = () => { built++; return fakeWindow(); };
  const first = wm.show("k", factory);
  first.close();
  const second = wm.show("k", factory);
  assert.strictEqual(built, 2);
  assert.notStrictEqual(first, second);
});

test("separate keys track independent windows", () => {
  const wm = createWindowManager();
  wm.show("a", fakeWindow);
  wm.show("b", fakeWindow);
  wm.toggle("a", fakeWindow);
  assert.strictEqual(wm.isOpen("a"), false);
  assert.strictEqual(wm.isOpen("b"), true);
});
