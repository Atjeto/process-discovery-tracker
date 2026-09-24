"use strict";
/* pane-splitter.js: the pure parts of the divider between the Steps level's
 * transactions and selected step (the clamp, a stored share, the separator's
 * values, the keys). The drag, the double-click, the storage and the stacked
 * layout run in the real viewer (e2e/runs-smoke.js). */
const test = require("node:test");
const assert = require("node:assert");
const S = require("./pane-splitter.js");

// The stylesheet's limits (styles.css, .editor-split).
const LIM = { minList: 360, minDetail: 280, handle: 10 };

test("clampList keeps the transactions between their minimum and the width that leaves the selected step its minimum", () => {
  assert.strictEqual(S.clampList(657, 1460, LIM), 657);
  assert.strictEqual(S.clampList(100, 1460, LIM), 360);
  assert.strictEqual(S.clampList(1400, 1460, LIM), 1170);   // 1460 less the divider and 280
  assert.strictEqual(S.clampList(-Infinity, 1460, LIM), 360);
  assert.strictEqual(S.clampList(Infinity, 1460, LIM), 1170);
});

test("clampList: a share kept from a wider window is squeezed, never below either minimum", () => {
  // 0.8 of 1460 fits; the same share with the step panel open (1080) leaves the step pane its 280.
  assert.strictEqual(S.clampList(0.8 * 1460, 1460, LIM), 1168);
  assert.strictEqual(S.clampList(0.8 * 1080, 1080, LIM), 790);
  assert.strictEqual(1080 - LIM.handle - S.clampList(0.8 * 1080, 1080, LIM), 280);
  // 0.2 at any width stays at the transactions' minimum.
  assert.strictEqual(S.clampList(0.2 * 763, 763, LIM), 360);
});

test("clampList: when both minimums cannot hold, the transactions keep theirs, as the CSS clamp does", () => {
  assert.strictEqual(S.clampList(500, 600, LIM), 360);
});

test("parseShare reads a stored share strictly between 0 and 1, and nothing else", () => {
  assert.strictEqual(S.parseShare("0.5527"), 0.5527);
  assert.strictEqual(S.parseShare(" 0.25 "), 0.25);
  for (const bad of [null, undefined, "", "   ", "0", "1", "1.2", "-0.3", "abc", "0.4px", "45%", "NaN", "Infinity", "{}"]) {
    assert.strictEqual(S.parseShare(bad), null, JSON.stringify(bad));
  }
});

test("ariaValues: the divider's position and its two ends, in percent of the split's width", () => {
  assert.deepStrictEqual(S.ariaValues(657, 1460, LIM), { now: 45, min: 25, max: 80 });
  // At each end the position reads as that end.
  assert.deepStrictEqual(S.ariaValues(360, 1080, LIM), { now: 33, min: 33, max: 73 });
  assert.deepStrictEqual(S.ariaValues(790, 1080, LIM), { now: 73, min: 33, max: 73 });
});

test("keyTarget: Left and Right move the edge by a small step, Home and End to the two ends; other keys are left to the page", () => {
  assert.strictEqual(S.keyTarget("ArrowLeft", 500), 500 - S.KEY_STEP_PX);
  assert.strictEqual(S.keyTarget("ArrowRight", 500), 500 + S.KEY_STEP_PX);
  assert.strictEqual(S.clampList(S.keyTarget("Home", 500), 1460, LIM), 360);
  assert.strictEqual(S.clampList(S.keyTarget("End", 500), 1460, LIM), 1170);
  for (const k of ["ArrowUp", "ArrowDown", "Enter", "s", " ", "Tab"]) assert.strictEqual(S.keyTarget(k, 500), null, k);
  assert.ok(S.KEY_STEP_PX > 0 && S.KEY_STEP_PX <= 40, "a small step");
});

test("the share is remembered under a pdt. key, like the viewer's other layout sizes", () => {
  assert.match(S.STORAGE_KEY, /^pdt\.[A-Za-z]+$/);
});
