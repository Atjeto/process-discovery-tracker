"use strict";

/*
 * timeline-screen.test.js: the screenshot a recording without a video shows
 * for a moment, and the lines around it (timeline-screen.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./timeline-screen.js");

const T0 = Date.parse("2026-05-14T09:00:00.000Z");
const shot = (sec, path) => ({ timestamp: new Date(T0 + sec * 1000).toISOString(), data: { path } });
const SHOTS = [shot(19, "a.png"), shot(49, "b.png"), shot(106, "c.png")];

test("screenAt: the last screenshot taken at or before the moment", () => {
  // A positive control: between the second and the third.
  assert.equal(S.screenAt(SHOTS, T0 + 60000), 1);
  // At a screenshot's own moment, that one.
  assert.equal(S.screenAt(SHOTS, T0 + 49000), 1);
  assert.equal(S.screenAt(SHOTS, T0 + 19000), 0);
  // After the last, the last.
  assert.equal(S.screenAt(SHOTS, T0 + 900000), 2);
});

test("screenAt: none before the first screenshot, and none without a moment", () => {
  assert.equal(S.screenAt(SHOTS, T0 + 18999), -1);
  assert.equal(S.screenAt(SHOTS, null), -1);
  assert.equal(S.screenAt(SHOTS, NaN), -1);
  assert.equal(S.screenAt([], T0 + 60000), -1);
  assert.equal(S.screenAt(null, T0 + 60000), -1);
});

test("screenAt: of two screenshots taken at one moment, the later in the list", () => {
  const two = [shot(19, "a.png"), shot(49, "b.png"), shot(49, "b-added.png"), shot(106, "c.png")];
  assert.equal(S.screenAt(two, T0 + 49000), 2);
  assert.equal(S.screenAt(two, T0 + 50000), 2);
});

test("screenAt: a screenshot taken in a stretch set aside still shows (the hatch is on the timeline)", () => {
  // The rule reads no stretch: the moment inside one shows what was on the screen.
  const set = [shot(10, "a.png"), shot(30, "in-the-stretch.png")];
  assert.equal(S.screenAt(set, T0 + 35000), 1);
});

test("screenAt: a screenshot whose moment cannot be read is passed over", () => {
  const odd = [shot(10, "a.png"), { timestamp: "not a time", data: { path: "x.png" } }];
  assert.equal(S.screenAt(odd, T0 + 60000), 0);
});

test("the lines: the moment, the step when it has one, and a file that is missing", () => {
  assert.equal(S.shotLine("1:42", "Enter the order"), "Screenshot at 1:42 · Enter the order");
  assert.equal(S.shotLine("1:42", ""), "Screenshot at 1:42");
  assert.equal(S.shotLine("1:42", "  "), "Screenshot at 1:42");
  assert.equal(S.shotLine("0:19", null), "Screenshot at 0:19");
  assert.equal(S.missingLine(S.fileName("screenshots/shot_03.png")), "The screenshot file is missing: shot_03.png");
  assert.equal(S.fileName("screenshots\\analyst\\f.png"), "f.png");
  assert.equal(S.WORDS.before, "No screenshot before this moment.");
  assert.equal(S.WORDS.noVideo, "No video in this project.");
});
