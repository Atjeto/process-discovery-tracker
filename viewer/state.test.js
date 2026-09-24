/*
 * Unit tests for the viewer state store (ADR-0003 Phase 2).
 *
 * Covers the pure logic: the change-notification bus and the
 * undo/redo stack rules. The accessors are trivial passthroughs and
 * the views they drive need the DOM, so those are verified by
 * launching the app -- as with timeline-core's DOM helpers.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const State = require("./state.js");

/* ---- change-notification bus ------------------------------------- */

test("subscribe + emit runs the callback", () => {
  let n = 0;
  const off = State.subscribe("steps", () => { n++; });
  State.emit("steps");
  assert.equal(n, 1);
  off();
});

test("the unsubscribe function stops further callbacks", () => {
  let n = 0;
  const off = State.subscribe("markers", () => { n++; });
  State.emit("markers");
  off();
  State.emit("markers");
  assert.equal(n, 1);
});

test("emit on a topic with no subscribers is a no-op", () => {
  assert.doesNotThrow(() => State.emit("markers"));
});

test("batch coalesces repeated emits of one topic into a single callback", () => {
  let n = 0;
  const off = State.subscribe("timeline", () => { n++; });
  State.batch(() => {
    State.emit("timeline");
    State.emit("timeline");
    State.emit("timeline");
  });
  assert.equal(n, 1);
  off();
});

test("batch defers emits until it ends, then fires each topic once", () => {
  /** @type {string[]} */
  const seen = [];
  const offS = State.subscribe("steps", () => seen.push("steps"));
  const offM = State.subscribe("markers", () => seen.push("markers"));
  State.batch(() => {
    State.emit("steps");
    State.emit("markers");
    State.emit("steps");
    assert.deepEqual(seen, []);   // nothing has fired yet
  });
  assert.equal(seen.filter(x => x === "steps").length, 1);
  assert.equal(seen.filter(x => x === "markers").length, 1);
  offS();
  offM();
});

test("a throwing subscriber does not block the others", () => {
  let n = 0;
  const offBad = State.subscribe("steps", () => { throw new Error("boom"); });
  const offGood = State.subscribe("steps", () => { n++; });
  assert.doesNotThrow(() => State.emit("steps"));
  assert.equal(n, 1);
  offBad();
  offGood();
});

/* ---- undo / redo ------------------------------------------------- */

/**
 * @param {string} label
 * @param {string} folder
 */
function entry(label, folder) {
  return { label, annotations: { steps: [] }, sessionFolder: folder };
}

test("recordEdit makes the session undoable, not redoable", () => {
  State.resetUndo();
  assert.equal(State.canUndo("/s/A"), false);
  State.recordEdit(entry("rename", "/s/A"));
  assert.equal(State.canUndo("/s/A"), true);
  assert.equal(State.canRedo("/s/A"), false);
});

test("recordEdit clears the redo stack -- a new edit invalidates redo", () => {
  State.resetUndo();
  State.pushRedo(entry("stale redo", "/s/A"));
  assert.equal(State.canRedo("/s/A"), true);
  State.recordEdit(entry("new edit", "/s/A"));
  assert.equal(State.canRedo("/s/A"), false);
});

test("the undo stack is capped at UNDO_MAX", () => {
  State.resetUndo();
  const folder = "/s/cap";
  for (let i = 0; i < State.UNDO_MAX + 12; i++) {
    State.recordEdit(entry("edit " + i, folder));
  }
  let popped = 0;
  while (State.popUndo(folder)) popped++;
  assert.equal(popped, State.UNDO_MAX);
});

test("popUndo returns the topmost entry for that session only", () => {
  State.resetUndo();
  State.recordEdit(entry("A1", "/s/A"));
  State.recordEdit(entry("B1", "/s/B"));
  State.recordEdit(entry("A2", "/s/A"));
  const top = State.popUndo("/s/A");
  assert.equal(top && top.label, "A2");
  assert.equal(State.canUndo("/s/B"), true);   // B untouched
  const next = State.popUndo("/s/A");
  assert.equal(next && next.label, "A1");
  assert.equal(State.canUndo("/s/A"), false);
});

test("popUndo on an empty stack returns null", () => {
  State.resetUndo();
  assert.equal(State.popUndo("/s/none"), null);
});

test("pushUndo (the Redo path) does not clear the redo stack", () => {
  State.resetUndo();
  State.pushRedo(entry("r1", "/s/A"));
  State.pushRedo(entry("r2", "/s/A"));
  State.pushUndo(entry("back onto undo", "/s/A"));
  assert.equal(State.canRedo("/s/A"), true);
  assert.ok(State.popRedo("/s/A"));
  assert.ok(State.popRedo("/s/A"));
  assert.equal(State.canRedo("/s/A"), false);
});

test("resetUndo clears both stacks", () => {
  State.resetUndo();
  State.recordEdit(entry("e", "/s/A"));
  State.pushRedo(entry("r", "/s/A"));
  State.resetUndo();
  assert.equal(State.canUndo("/s/A"), false);
  assert.equal(State.canRedo("/s/A"), false);
});

/* ---- the current level (contract C19) ------------------------------ */

test("mapPath: the main map by default; a copy goes in and a copy comes out", () => {
  assert.deepEqual(State.getMapPath(), []);
  const p = ["Save order", "Enter the product"];
  State.setMapPath(p);
  p.push("changed outside");
  const got = State.getMapPath();
  assert.deepEqual(got, ["Save order", "Enter the product"]);
  got.push("changed outside");
  assert.deepEqual(State.getMapPath(), ["Save order", "Enter the product"]);
  State.setMapPath(null);
  assert.deepEqual(State.getMapPath(), []);
});
