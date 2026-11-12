"use strict";

/*
 * shot-groups.test.js: screenshots closer than a mark's width are one mark
 * (shot-groups.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./shot-groups.js");

const sizes = (gs) => gs.map((g) => g.to - g.from + 1);

/* Drawn from their first screenshot's place, each as wide as its count
   needs: no mark reaches the next one. */
function noneCovers(xs, gs) {
  for (let i = 1; i < gs.length; i++) {
    const prev = gs[i - 1];
    if (xs[gs[i].from] - xs[prev.from] < G.markWidth(prev.to - prev.from + 1)) return false;
  }
  return true;
}

test("groupShots: none close, each its own mark", () => {
  // A positive control: 20 px apart, wider than a mark.
  const xs = [0, 20, 40, 100];
  const gs = G.groupShots(xs);
  assert.deepEqual(gs, [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }]);
  assert.ok(noneCovers(xs, gs));
});

test("groupShots: all close, one mark holding them all", () => {
  const gs = G.groupShots([100, 103, 108, 115]);
  assert.deepEqual(gs, [{ from: 0, to: 3 }]);
});

test("groupShots: a chain where each is close to the next is cut a mark's width apart", () => {
  const xs = [0, 10, 20, 30, 40, 50];
  const gs = G.groupShots(xs);
  assert.deepEqual(sizes(gs), [2, 2, 2]);
  assert.ok(noneCovers(xs, gs));
  // Every screenshot in one mark, in order.
  assert.equal(sizes(gs).reduce((a, b) => a + b, 0), xs.length);
});

test("groupShots: zooming in splits a mark as the room allows", () => {
  const secs = [0, 2, 4, 30];
  const at = (pxPerSec) => secs.map((t) => t * pxPerSec);
  assert.deepEqual(sizes(G.groupShots(at(1))), [3, 1]);
  assert.deepEqual(sizes(G.groupShots(at(5))), [2, 1, 1], "zoomed in: 0, 10, 20 px");
  assert.deepEqual(sizes(G.groupShots(at(10))), [1, 1, 1, 1], "zoomed in again: 0, 20, 40 px");
});

test("groupShots: two at one moment are one mark; none, no mark", () => {
  assert.deepEqual(sizes(G.groupShots([50, 50, 90])), [2, 1]);
  assert.deepEqual(G.groupShots([]), []);
  assert.deepEqual(G.groupShots(null), []);
});

test("groupShots: a mark whose count needs two digits is wider, and still covers no other", () => {
  // Twelve screenshots a pixel apart, then one 18 px after the first: a
  // mark of twelve is drawn 22 px wide, so that one joins it too.
  const xs = Array.from({ length: 12 }, (_, i) => i).concat([18, 60]);
  const gs = G.groupShots(xs);
  assert.deepEqual(sizes(gs), [13, 1]);
  assert.ok(noneCovers(xs, gs));
  assert.equal(G.markWidth(1), G.MARK_PX);
  assert.equal(G.markWidth(9), 16);
  assert.equal(G.markWidth(12), 22);
  assert.equal(G.markWidth(140), 28);
  // A fixed width is every mark's.
  assert.deepEqual(sizes(G.groupShots([0, 10, 20, 30], 16)), [2, 2]);
});

test("the words of a mark of several", () => {
  assert.equal(G.groupTitle(3, "1:40", "1:46"), "3 screenshots from 1:40 to 1:46. Click: show the first in the Screenshots tab.");
});
