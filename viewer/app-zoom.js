/*
 * app-zoom.js: the app's zoom (lane A-2, audit A12).
 *
 * Ctrl+Plus (and Ctrl+=), Ctrl+Minus and Ctrl+0, and Ctrl with the mouse
 * wheel, make everything larger, smaller, or the usual size, in steps:
 * 80, 90, 100, 110, 125, 150, 175 and 200 percent. Every window of the
 * viewer shows the same zoom, and this computer keeps it (localStorage,
 * ZOOM_KEY), read before the first paint (index.html's head) and again when
 * another window changes it (the storage event). The message area says
 * "Zoom 125%.". The Timeline's own keys (+, - and 0 without Ctrl) stay the
 * Timeline's; Ctrl with the wheel over a map (bpmn-js, cytoscape) stays the
 * map's own zoom, since the map takes the wheel first (defaultPrevented).
 *
 * The rules (the steps, the keys, the message) are pure and tested; wire()
 * binds them to a window.
 */

"use strict";

const ZOOM_KEY = "pdt.appZoom";
const ZOOM_STEPS = [80, 90, 100, 110, 125, 150, 175, 200];
const USUAL_ZOOM = 100;
const WHEEL_STEP = 50;

/* A stored or given zoom as one of the steps: a number (or its text) on the
   ladder, else the usual size. Pure. */
function zoomOf(value) {
  const n = Number(value);
  return ZOOM_STEPS.includes(n) ? n : USUAL_ZOOM;
}

/* The zoom after one step from `current` (percent): `dir` 1 the next step
   up, -1 the next step down, 0 the usual size. At either end it stays.
   A current zoom between two steps goes to the next step in that
   direction. Pure. */
function nextZoom(current, dir) {
  if (dir === 0) return USUAL_ZOOM;
  const c = Number.isFinite(Number(current)) ? Number(current) : USUAL_ZOOM;
  if (dir > 0) {
    const up = ZOOM_STEPS.find((z) => z > c);
    return up === undefined ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : up;
  }
  const down = ZOOM_STEPS.slice().reverse().find((z) => z < c);
  return down === undefined ? ZOOM_STEPS[0] : down;
}

/* What a key press asks of the zoom: 1 larger, -1 smaller, 0 the usual
   size, null nothing (an event-like { key, code, ctrlKey, metaKey,
   altKey }). Ctrl (or Cmd) without Alt, with Plus, =, Minus, _ or 0, on the
   main keys or the number pad. Pure. */
function zoomKeyOf(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = String(e.key || ""), code = String(e.code || "");
  if (key === "+" || key === "=" || code === "NumpadAdd" || code === "Equal") return 1;
  if (key === "-" || key === "_" || code === "NumpadSubtract" || code === "Minus") return -1;
  if (key === "0" || code === "Digit0" || code === "Numpad0") return 0;
  return null;
}

/* What a wheel turn with Ctrl asks: 1 larger (the wheel away from you), -1
   smaller, null nothing (no Ctrl, no turn, or the page under it took the
   wheel already, as a map does). Pure. */
function wheelZoomOf(e) {
  if (!e || !e.ctrlKey || e.defaultPrevented) return null;
  const dy = Number(e.deltaY);
  if (!Number.isFinite(dy) || dy === 0) return null;
  return dy < 0 ? 1 : -1;
}

/* The message a change says. Pure. */
function zoomMessage(pct) {
  return "Zoom " + pct + "%.";
}

/* The zoom this computer keeps, from a storage (localStorage), or the usual
   size when it holds none or cannot be read. */
function storedZoom(storage) {
  try { return zoomOf(storage && storage.getItem(ZOOM_KEY)); } catch (_) { return USUAL_ZOOM; }
}

/* The webFrame of this window, or null outside Electron (the unit tests). */
function _webFrame() {
  try { return require("electron").webFrame || null; } catch (_) { return null; }
}

/* Show the zoom this computer keeps (index.html's head calls it before the
   first paint). Returns the zoom shown. */
function applyStored(storage, frame) {
  const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const f = frame || _webFrame();
  const pct = storedZoom(s);
  if (f && typeof f.setZoomFactor === "function") f.setZoomFactor(pct / 100);
  return pct;
}

/* Bind the keys, the wheel and the other windows' changes to this window.
   opts = { win, storage, frame, say(text) }: say shows the message (dom.js
   toast). Returns { current(), set(pct) }. */
function wire(opts) {
  const o = opts || {};
  const win = o.win || window;
  const storage = o.storage || win.localStorage;
  const frame = o.frame || _webFrame();
  let pct = applyStored(storage, frame);
  const show = (next, said) => {
    pct = zoomOf(next);
    if (frame && typeof frame.setZoomFactor === "function") frame.setZoomFactor(pct / 100);
    if (said) {
      try { storage.setItem(ZOOM_KEY, String(pct)); } catch (_) { /* this window only */ }
      if (typeof o.say === "function") o.say(zoomMessage(pct));
    }
    return pct;
  };
  // Capture: before the Timeline's own + and - and the map editor's keys,
  // so Ctrl with them is the app's zoom wherever the focus is.
  win.addEventListener("keydown", (e) => {
    const dir = zoomKeyOf(e);
    if (dir === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && nextZoom(pct, dir) === pct) return;
    show(nextZoom(pct, dir), true);
  }, true);
  // Bubble: a map under the pointer takes the wheel first. A touchpad sends
  // many small turns: a step needs WHEEL_STEP of them together, as one
  // notch of a mouse wheel gives.
  let turned = 0, turnedAt = 0;
  win.addEventListener("wheel", (e) => {
    const dir = wheelZoomOf(e);
    if (dir === null) return;
    e.preventDefault();
    const now = Date.now();
    if (now - turnedAt > 400 || Math.sign(turned) !== Math.sign(e.deltaY)) turned = 0;
    turnedAt = now;
    turned += Number(e.deltaY);
    if (Math.abs(turned) < WHEEL_STEP) return;
    turned = 0;
    show(nextZoom(pct, dir), true);
  }, { passive: false });
  win.addEventListener("storage", (e) => {
    if (e && e.key === ZOOM_KEY) show(zoomOf(e.newValue), false);
  });
  return { current: () => pct, set: (next) => show(next, true) };
}

module.exports = {
  ZOOM_KEY, ZOOM_STEPS, USUAL_ZOOM,
  zoomOf, nextZoom, zoomKeyOf, wheelZoomOf, zoomMessage, storedZoom, applyStored, wire,
};
