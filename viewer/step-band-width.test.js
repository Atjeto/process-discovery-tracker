"use strict";

/*
 * step-band-width.test.js: a step's band is drawn as wide as its time, at
 * least MIN_PX, and never past the start of the next band of its
 * transaction (step-band-width.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("./step-band-width.js");

const band = (id, key, startPx, endPx) => ({ id, key, startPx, endPx });
const widths = (m) => Object.fromEntries([...m].map(([id, d]) => [id, d.widthPx]));

test("drawnBands: a band as wide as its time where it has room", () => {
  // A positive control: three steps back to back, each 40 px.
  const m = W.drawnBands([band("a", "t1", 0, 40), band("b", "t1", 40, 80), band("c", "t1", 80, 120)]);
  assert.deepEqual(widths(m), { a: 40, b: 40, c: 40 });
  assert.equal(m.get("b").leftPx, 40);
  assert.equal(m.get("a").slim, false);
});

test("drawnBands: a run of narrow steps never draws over the next one", () => {
  // Steps 3, 1, 6 and 0 px long, one after another: each stops at the next
  // one's start; the one of no length is drawn MIN_PX wide.
  const m = W.drawnBands([band("a", "t1", 10, 13), band("b", "t1", 13, 14), band("c", "t1", 14, 20), band("d", "t1", 20, 20)]);
  assert.deepEqual(widths(m), { a: 3, b: W.MIN_PX, c: 6, d: W.MIN_PX });
  // Drawn, no band reaches past the next one's start (but for the least
  // width, when the next one starts closer than that).
  const list = [...m.entries()].sort((x, y) => x[1].leftPx - y[1].leftPx);
  for (let i = 0; i + 1 < list.length; i++) {
    const [, d] = list[i], [, n] = list[i + 1];
    assert.ok(d.leftPx + d.widthPx <= n.leftPx || d.widthPx === W.MIN_PX, list[i][0]);
  }
  assert.ok([...m.values()].every((d) => d.slim));
});

test("drawnBands: a band running over the next one's start is cut there", () => {
  // Its time is 50 px, the next band starts 12 px after it.
  const m = W.drawnBands([band("long", "t1", 100, 150), band("next", "t1", 112, 130)]);
  assert.equal(m.get("long").widthPx, 12);
  assert.equal(m.get("next").widthPx, 18);
});

test("drawnBands: the last step of a transaction keeps its time", () => {
  const m = W.drawnBands([band("a", "t1", 0, 30), band("last", "t1", 30, 90), band("x", "t2", 200, 260)]);
  assert.equal(m.get("last").widthPx, 60);
  // And a last step shorter than the least width is drawn at it.
  assert.equal(W.drawnBands([band("dot", "t1", 5, 5.5)]).get("dot").widthPx, W.MIN_PX);
});

test("drawnBands: a band whose next band is in another transaction is not held back by it", () => {
  const m = W.drawnBands([band("a", "t1", 0, 50), band("other", "t2", 20, 60), band("b", "t1", 80, 100)]);
  assert.equal(m.get("a").widthPx, 50, "t2's band at 20 px does not cut t1's step");
  // Steps outside every transaction (key null) are one group of their own.
  const n = W.drawnBands([band("o1", null, 0, 50), band("o2", undefined, 10, 30), band("t", "t1", 5, 9)]);
  assert.equal(n.get("o1").widthPx, 10);
  assert.equal(n.get("t").widthPx, 4);
});

test("drawnBands: two steps at one moment, and odd input", () => {
  const m = W.drawnBands([band("a", "t1", 10, 30), band("b", "t1", 10, 20)]);
  assert.equal(m.get("a").widthPx, W.MIN_PX, "a next band at the same start leaves the least width");
  assert.equal(W.drawnBands(null).size, 0);
  assert.equal(W.drawnBands([null, band("x", "t", NaN, 3), band(null, "t", 0, 3)]).size, 0);
  assert.equal(W.drawnBands([band("w", "t", 0, 1)], 5).get("w").widthPx, 5);
});
