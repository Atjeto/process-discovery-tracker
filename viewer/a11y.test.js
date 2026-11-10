"use strict";
/* Lane A-1: the pure parts of the keyboard and naming rules.
 *
 * - modals.js wrapFocusIndex: where Tab goes inside a dialog (holdFocus).
 *   The DOM half (the trap, the focus given back) is pinned by the e2e
 *   session smoke on the real viewer.
 * - theme.js toggleLabel: the theme toggle, a glyph, is named by what a
 *   press does.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapFocusIndex } = require("./modals.js");
const { toggleLabel } = require("./theme.js");

test("Tab from the last item of a dialog goes to its first, Shift+Tab from the first to its last", () => {
  assert.equal(wrapFocusIndex(4, 3, false), 0);
  assert.equal(wrapFocusIndex(4, 0, true), 3);
});

test("inside a dialog, a Tab between two of its items is the browser's own move", () => {
  assert.equal(wrapFocusIndex(4, 0, false), null);
  assert.equal(wrapFocusIndex(4, 2, false), null);
  assert.equal(wrapFocusIndex(4, 3, true), null);
});

test("a focus that is not on one of the dialog's items goes to its first (Tab) or its last (Shift+Tab)", () => {
  assert.equal(wrapFocusIndex(4, -1, false), 0);
  assert.equal(wrapFocusIndex(4, -1, true), 3);
  assert.equal(wrapFocusIndex(4, 9, false), 0);
});

test("a dialog with one item keeps the focus on it; with none, on the dialog itself (-1)", () => {
  assert.equal(wrapFocusIndex(1, 0, false), 0);
  assert.equal(wrapFocusIndex(1, 0, true), 0);
  assert.equal(wrapFocusIndex(0, -1, false), -1);
});

test("the theme toggle says what a press does, in each theme", () => {
  assert.equal(toggleLabel("light"), "Switch to the dark theme");
  assert.equal(toggleLabel("dark"), "Switch to the light theme");
});
