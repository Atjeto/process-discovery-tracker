"use strict";
/* Lane A-2: the app's zoom (app-zoom.js), its steps, keys and message. */
const test = require("node:test");
const assert = require("node:assert");
const Z = require("./app-zoom.js");

test("the steps are 80 to 200 percent, the usual size 100", () => {
  assert.deepStrictEqual(Z.ZOOM_STEPS, [80, 90, 100, 110, 125, 150, 175, 200]);
  assert.strictEqual(Z.USUAL_ZOOM, 100);
});

test("a step up and a step down follow the ladder and stay at its ends", () => {
  assert.strictEqual(Z.nextZoom(100, 1), 110);
  assert.strictEqual(Z.nextZoom(110, 1), 125);
  assert.strictEqual(Z.nextZoom(125, 1), 150);
  assert.strictEqual(Z.nextZoom(175, 1), 200);
  assert.strictEqual(Z.nextZoom(200, 1), 200);
  assert.strictEqual(Z.nextZoom(100, -1), 90);
  assert.strictEqual(Z.nextZoom(90, -1), 80);
  assert.strictEqual(Z.nextZoom(80, -1), 80);
  assert.strictEqual(Z.nextZoom(150, -1), 125);
});

test("0 is the usual size from anywhere", () => {
  for (const z of [80, 100, 125, 200, 133]) assert.strictEqual(Z.nextZoom(z, 0), 100);
});

test("a zoom between two steps goes to the next step in that direction", () => {
  assert.strictEqual(Z.nextZoom(133, 1), 150);
  assert.strictEqual(Z.nextZoom(133, -1), 125);
  assert.strictEqual(Z.nextZoom(300, -1), 200);
  assert.strictEqual(Z.nextZoom(50, 1), 80);
  assert.strictEqual(Z.nextZoom("not a number", 1), 110);
});

test("a stored value is read as a step, anything else as the usual size", () => {
  assert.strictEqual(Z.zoomOf("125"), 125);
  assert.strictEqual(Z.zoomOf(80), 80);
  for (const bad of [null, undefined, "", "abc", "130", 0, -100, 1.25]) assert.strictEqual(Z.zoomOf(bad), 100, String(bad));
  assert.strictEqual(Z.storedZoom({ getItem: (k) => (k === Z.ZOOM_KEY ? "150" : null) }), 150);
  assert.strictEqual(Z.storedZoom({ getItem: () => { throw new Error("blocked"); } }), 100);
  assert.strictEqual(Z.storedZoom(null), 100);
});

test("the keys: Ctrl with Plus or =, Minus or _, and 0, on the main keys and the number pad", () => {
  const k = (key, code, mods) => Z.zoomKeyOf(Object.assign({ key, code, ctrlKey: true }, mods || {}));
  assert.strictEqual(k("+", "Equal"), 1);
  assert.strictEqual(k("=", "Equal"), 1);
  assert.strictEqual(k("+", "NumpadAdd"), 1);
  assert.strictEqual(k("-", "Minus"), -1);
  assert.strictEqual(k("_", "Minus"), -1);
  assert.strictEqual(k("-", "NumpadSubtract"), -1);
  assert.strictEqual(k("0", "Digit0"), 0);
  assert.strictEqual(k("0", "Numpad0"), 0);
  assert.strictEqual(k("+", "Equal", { ctrlKey: false, metaKey: true }), 1);
});

test("the Timeline's own keys (no Ctrl), Alt combinations and other keys are not the zoom", () => {
  assert.strictEqual(Z.zoomKeyOf({ key: "+", code: "Equal" }), null);
  assert.strictEqual(Z.zoomKeyOf({ key: "-", code: "Minus" }), null);
  assert.strictEqual(Z.zoomKeyOf({ key: "0", code: "Digit0" }), null);
  assert.strictEqual(Z.zoomKeyOf({ key: "+", code: "Equal", ctrlKey: true, altKey: true }), null);
  assert.strictEqual(Z.zoomKeyOf({ key: "z", code: "KeyZ", ctrlKey: true }), null);
  assert.strictEqual(Z.zoomKeyOf(null), null);
});

test("the wheel with Ctrl: away is larger, towards is smaller; without Ctrl or taken by a map, nothing", () => {
  assert.strictEqual(Z.wheelZoomOf({ ctrlKey: true, deltaY: -100 }), 1);
  assert.strictEqual(Z.wheelZoomOf({ ctrlKey: true, deltaY: 100 }), -1);
  assert.strictEqual(Z.wheelZoomOf({ ctrlKey: false, deltaY: -100 }), null);
  assert.strictEqual(Z.wheelZoomOf({ ctrlKey: true, deltaY: 0 }), null);
  assert.strictEqual(Z.wheelZoomOf({ ctrlKey: true, deltaY: -100, defaultPrevented: true }), null);
});

test("the message says the zoom", () => {
  assert.strictEqual(Z.zoomMessage(125), "Zoom 125%.");
  assert.strictEqual(Z.zoomMessage(100), "Zoom 100%.");
});

test("wire: a key sets the zoom, keeps it, says it, and stops the key; another window's change is shown without a message", () => {
  const listeners = {};
  const win = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const factors = [];
  const frame = { setZoomFactor: (f) => factors.push(f) };
  const said = [];
  store[Z.ZOOM_KEY] = "110";
  const z = Z.wire({ win, storage, frame, say: (t) => said.push(t) });
  assert.strictEqual(z.current(), 110);
  assert.deepStrictEqual(factors, [1.1]);
  let stopped = 0, prevented = 0;
  const ev = (key, code) => ({ key, code, ctrlKey: true, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  listeners.keydown[0](ev("=", "Equal"));
  assert.strictEqual(z.current(), 125);
  assert.strictEqual(store[Z.ZOOM_KEY], "125");
  assert.deepStrictEqual(said, ["Zoom 125%."]);
  assert.strictEqual(factors[factors.length - 1], 1.25);
  assert.strictEqual(prevented, 1);
  assert.strictEqual(stopped, 1);
  listeners.keydown[0](ev("0", "Digit0"));
  assert.strictEqual(z.current(), 100);
  // A plain + (the Timeline's) passes through untouched.
  listeners.keydown[0]({ key: "+", code: "Equal", preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  assert.strictEqual(z.current(), 100);
  assert.strictEqual(prevented, 2);
  listeners.storage[0]({ key: Z.ZOOM_KEY, newValue: "150" });
  assert.strictEqual(z.current(), 150);
  assert.strictEqual(said.length, 2);
  listeners.storage[0]({ key: "pdt.theme", newValue: "dark" });
  assert.strictEqual(z.current(), 150);
});

test("wire: one notch of a mouse wheel is one step; a touchpad's small turns add up to one", () => {
  const listeners = {};
  const win = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const storage = { getItem: () => null, setItem: () => {} };
  const z = Z.wire({ win, storage, frame: { setZoomFactor: () => {} } });
  const wheel = (dy) => listeners.wheel[0]({ ctrlKey: true, deltaY: dy, preventDefault: () => {} });
  wheel(-100);
  assert.strictEqual(z.current(), 110);
  wheel(-20); wheel(-20);
  assert.strictEqual(z.current(), 110);
  wheel(-20);
  assert.strictEqual(z.current(), 125);
  wheel(100);
  assert.strictEqual(z.current(), 110);
});
