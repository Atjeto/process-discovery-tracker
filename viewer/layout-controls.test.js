"use strict";
/* layout-controls.js: the pure rules of the Timeline's two dividers (the
 * clamp, the video's usual width, a stored size, the separator's values, the
 * keys). The drag, the double-click, the storage and the layout run in the
 * real viewer (e2e/timeline-edit-smoke.js). */
const test = require("node:test");
const assert = require("node:assert");
const L = require("./layout-controls.js");

// The stylesheet's limits (styles.css, .lower-workspace).
const LIM = { minVideo: 240, minPane: 360, handle: 12 };

test("clampSplit keeps the first pane between its least size and the size that leaves the second its least", () => {
  assert.strictEqual(L.clampSplit(700, 1330, 240, 360), 700);
  assert.strictEqual(L.clampSplit(100, 1330, 240, 360), 240);        // the video's least width
  assert.strictEqual(L.clampSplit(1200, 1330, 240, 360), 970);       // the pane keeps its 360
  assert.strictEqual(L.clampSplit(-Infinity, 1330, 240, 360), 240);
  assert.strictEqual(L.clampSplit(Infinity, 1330, 240, 360), 970);
  assert.strictEqual(L.clampSplit(500.6, 1330, 240, 360), 501);      // whole pixels
});

test("clampSplit: when both least sizes cannot hold, the first keeps its own, as the CSS max(min()) does", () => {
  assert.strictEqual(L.clampSplit(400, 500, 240, 360), 240);
});

test("defaultVideoWidth: 58% of the stage, or its height at 16:9 when that is less", () => {
  assert.strictEqual(L.defaultVideoWidth(1000, 800), 580);                // width binds
  assert.strictEqual(Math.round(L.defaultVideoWidth(1342, 300)), 533);    // height binds (300 * 16 / 9)
});

test("videoWidth: nothing stored is the usual width; a stored width is taken as it is when it fits", () => {
  assert.strictEqual(L.videoWidth(null, 1342, 600, LIM), 778);            // 0.58 * 1342
  assert.strictEqual(L.videoWidth(null, 1342, 300, LIM), 533);
  assert.strictEqual(L.videoWidth(900, 1342, 300, LIM), 900);             // the 58% and the 16:9 are no limit to a drag
  assert.strictEqual(L.videoWidth(300, 1342, 600, LIM), 300);
});

test("videoWidth: the two limits, and a stored width too wide for a narrow window", () => {
  assert.strictEqual(L.videoWidth(100, 1342, 600, LIM), 240);             // the video's least width
  assert.strictEqual(L.videoWidth(970, 1342, 600, LIM), 970);             // the widest that leaves the pane 360
  assert.strictEqual(L.videoWidth(971, 1342, 600, LIM), 970);
  // 1100 kept from a 1500 px window; at 1024 (a stage of 1000) the pane keeps its 360.
  assert.strictEqual(L.videoWidth(1100, 1000, 400, LIM), 628);
  assert.strictEqual(1000 - LIM.handle - L.videoWidth(1100, 1000, 400, LIM), 360);
  // The usual width in a narrow window never takes the pane below its least.
  assert.strictEqual(L.videoWidth(null, 600, 600, LIM), 240);
});

test("headWidth: the video header's padding, label, room and the buttons shown with their gaps; a hidden button (0) takes nothing", () => {
  assert.strictEqual(L.headWidth(20, 37, 8, [90, 98, 28, 28], 4), 321);
  assert.strictEqual(L.headWidth(20, 37, 8, [0, 98, 28, 28], 4), 227);
  assert.strictEqual(L.headWidth(20, 37, 8, [], 4), 65);
  assert.strictEqual(L.headWidth(20, 37.2, 8, [28], 4), 94);   // whole pixels, rounded up
});

test("parseSize reads a stored size of whole pixels above 0, and nothing else", () => {
  assert.strictEqual(L.parseSize("640"), 640);
  assert.strictEqual(L.parseSize(" 300 "), 300);
  assert.strictEqual(L.parseSize("300.4"), 300);
  for (const bad of [null, undefined, "", "   ", "0", "-20", "abc", "300px", "NaN", "Infinity", "{}"]) {
    assert.strictEqual(L.parseSize(bad), null, JSON.stringify(bad));
  }
});

test("ariaValues: the first pane's share and the two ends, in percent of the room", () => {
  assert.deepStrictEqual(L.ariaValues(778, 1330, 240, 360), { now: 58, min: 18, max: 73 });
  assert.deepStrictEqual(L.ariaValues(240, 1330, 240, 360), { now: 18, min: 18, max: 73 });
});

test("keyTarget: Left and Right (Up and Down on the stage's divider) move 24 px, 96 px with Shift; Home and End go to the ends", () => {
  assert.strictEqual(L.keyTarget("ArrowLeft", 500, false, false), 476);
  assert.strictEqual(L.keyTarget("ArrowRight", 500, false, false), 524);
  assert.strictEqual(L.keyTarget("ArrowLeft", 500, true, false), 404);
  assert.strictEqual(L.keyTarget("ArrowRight", 500, true, false), 596);
  assert.strictEqual(L.keyTarget("ArrowUp", 400, false, true), 376);     // the line up: the stage less high
  assert.strictEqual(L.keyTarget("ArrowDown", 400, true, true), 496);
  assert.strictEqual(L.clampSplit(L.keyTarget("Home", 500, false, false), 1330, 240, 360), 240);
  assert.strictEqual(L.clampSplit(L.keyTarget("End", 500, false, false), 1330, 240, 360), 970);
  for (const k of ["ArrowUp", "ArrowDown", "Enter", "s", " ", "Tab"]) assert.strictEqual(L.keyTarget(k, 500, false, false), null, k);
  for (const k of ["ArrowLeft", "ArrowRight", "Enter"]) assert.strictEqual(L.keyTarget(k, 400, false, true), null, k);
});

test("the sizes are remembered under the keys the viewer has always used", () => {
  assert.strictEqual(L.LS_VIDEO, "pdt.stage.videoWidth");
  assert.strictEqual(L.LS_TIMELINE, "pdt.stage.timelineHeight");
});
