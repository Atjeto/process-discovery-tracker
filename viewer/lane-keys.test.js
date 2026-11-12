"use strict";

/*
 * lane-keys.test.js: which mark of a lane the keys go to (lane-keys.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./lane-keys.js");

const T0 = Date.parse("2026-05-14T09:00:00.000Z");
const s = (n) => T0 + n * 1000;
const band = (a, b) => ({ startMs: s(a), endMs: s(b) });
const pin = (a) => ({ startMs: s(a), endMs: null });

test("timeOrder: the marks in time order, whatever order they were drawn in", () => {
  // A positive control: drawn out of order.
  assert.deepEqual(K.timeOrder([band(30, 40), band(0, 10), band(10, 30)]), [1, 2, 0]);
  assert.deepEqual(K.timeOrder([]), []);
  assert.deepEqual(K.timeOrder(null), []);
});

test("timeOrder: two marks at one moment keep the order the lane draws them in", () => {
  assert.deepEqual(K.timeOrder([pin(20), pin(5), pin(20), pin(5)]), [1, 3, 0, 2]);
});

test("startAt: the mark at the clock's moment, else the nearest after it, else the first", () => {
  const ordered = [band(0, 10), band(10, 30), band(40, 50)];
  // A positive control: inside the second band.
  assert.equal(K.startAt(ordered, s(15)), 1);
  // Its start, and its end, are its moment too (the first that holds it).
  assert.equal(K.startAt(ordered, s(10)), 0);
  assert.equal(K.startAt(ordered, s(30)), 1);
  // Between two marks: the next one.
  assert.equal(K.startAt(ordered, s(35)), 2);
  // After the last: the first.
  assert.equal(K.startAt(ordered, s(99)), 0);
  // Before the first: the first (the nearest after).
  assert.equal(K.startAt([band(5, 9), band(12, 20)], s(1)), 0);
  // Without a moment, the first; with no mark, none.
  assert.equal(K.startAt(ordered, null), 0);
  assert.equal(K.startAt([], s(15)), -1);
});

test("startAt: a mark of one moment holds only its moment", () => {
  const pins = [pin(5), pin(20), pin(20), pin(60)];
  assert.equal(K.startAt(pins, s(20)), 1, "of two at one moment, the first");
  assert.equal(K.startAt(pins, s(21)), 3);
});

test("stepTo: Left and Right stop at the ends, Home and End go to them", () => {
  assert.equal(K.stepTo(5, 2, "ArrowRight"), 3);
  assert.equal(K.stepTo(5, 2, "ArrowLeft"), 1);
  assert.equal(K.stepTo(5, 4, "ArrowRight"), 4, "the last stays the last");
  assert.equal(K.stepTo(5, 0, "ArrowLeft"), 0, "the first stays the first");
  assert.equal(K.stepTo(5, 2, "Home"), 0);
  assert.equal(K.stepTo(5, 2, "End"), 4);
  assert.equal(K.stepTo(5, 2, "Enter"), -1, "not a key of the lane");
  assert.equal(K.stepTo(0, 0, "ArrowRight"), -1);
});

test("markName: the first line of the tooltip", () => {
  assert.equal(K.markName("Enter the order · 12s\nClick: open it"), "Enter the order · 12s");
  assert.equal(K.markName(""), "");
  assert.equal(K.markName(null), "");
});
