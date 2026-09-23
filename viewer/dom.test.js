/*
 * Unit tests for dom.js fitMenuPosition: where a context menu opened at a
 * click point goes so all of it stays inside the window (L5b). The DOM half
 * (placeMenu) is pinned by the e2e session smoke, which right-clicks the
 * Flow timeline at the window's bottom edge in the real viewer.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fitMenuPosition } = require("./dom.js");

const VW = 1366, VH = 768, M = 4;
const W = 200, H = 105;   // the Flow timeline menu: 3 items

test("a menu that fits opens at the click point", () => {
  assert.deepEqual(fitMenuPosition(300, 200, W, H, VW, VH, M), { left: 300, top: 200 });
});

test("near the bottom edge the menu opens upwards from the click point", () => {
  assert.deepEqual(fitMenuPosition(300, 740, W, H, VW, VH, M), { left: 300, top: 740 - H });
});

test("near the right edge the menu opens leftwards from the click point", () => {
  assert.deepEqual(fitMenuPosition(1300, 200, W, H, VW, VH, M), { left: 1300 - W, top: 200 });
});

test("in the bottom right corner it opens up and to the left", () => {
  assert.deepEqual(fitMenuPosition(1360, 760, W, H, VW, VH, M), { left: 1360 - W, top: 760 - H });
});

test("at the very edge the opened-upwards menu still keeps the margin", () => {
  // Upwards from y = 767 the menu would end 1 px above the window edge,
  // inside the 4 px margin: it moves up to end at the margin.
  assert.deepEqual(fitMenuPosition(300, 767, W, H, VW, VH, M), { left: 300, top: VH - H - M });
});

test("when neither side of the point has room, it sits as close to the point as fits", () => {
  // A 700 px tall menu at y = 100 fits neither below (100 + 700 > 768) nor
  // above (100 - 700 < 0): it ends at the bottom margin, all of it shown.
  assert.deepEqual(fitMenuPosition(300, 100, W, 700, VW, VH, M), { left: 300, top: VH - 700 - M });
});

test("a menu taller than the window starts at the top margin", () => {
  assert.equal(fitMenuPosition(300, 400, W, 900, VW, VH, M).top, M);
});

test("from any click point inside the window every edge of the menu is inside it", () => {
  let n = 0;
  for (const [vw, vh] of [[1366, 768], [1024, 768], [1500, 950]]) {
    for (let x = 0; x <= vw; x += 37) {
      for (let y = 0; y <= vh; y += 23) {
        for (const [w, h] of [[200, 105], [240, 105], [240, 300]]) {
          const p = fitMenuPosition(x, y, w, h, vw, vh, M);
          const where = JSON.stringify({ vw, vh, x, y, w, h, p });
          assert.ok(p.left >= M && p.left + w <= vw - M, "horizontally inside " + where);
          assert.ok(p.top >= M && p.top + h <= vh - M, "vertically inside " + where);
          n++;
        }
      }
    }
  }
  assert.ok(n > 5000, "the sweep covered " + n + " placements");
});

test("the margin defaults to 4 px", () => {
  assert.deepEqual(fitMenuPosition(1366, 768, W, H, VW, VH), fitMenuPosition(1366, 768, W, H, VW, VH, 4));
});
