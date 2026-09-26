"use strict";
// The recording bar (recording-bar.js): where it opens, that it stays on a
// screen, and that its page carries the view model safely.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { placeBar, clampIntoArea, buildBarHtml, barWidth, BAR_WIDTH, BAR_HEIGHT } = require("../recording-bar.js");

const SIZE = { width: BAR_WIDTH, height: BAR_HEIGHT };
// A 1366x768 laptop screen with a 40 px taskbar, and a second screen to its right.
const LAPTOP = { x: 0, y: 0, width: 1366, height: 728 };
const RIGHT = { x: 1366, y: 0, width: 1920, height: 1040 };

test("the bar is small: one row, under half of a 1366 wide screen, a tenth of the old panel's area at most", () => {
  const w = barWidth();
  // Under 41% (560 px) until the AD-29 words: "between transactions" and
  // "Next transaction" need 95 px more than "between runs" and "Next run".
  assert.ok(w <= 0.5 * 1366, "width " + w);
  assert.ok(BAR_HEIGHT <= 48, "height " + BAR_HEIGHT);
  assert.ok(w * BAR_HEIGHT <= (460 * 720) / 10, "area against the 460x720 panel: " + w * BAR_HEIGHT);
  assert.strictEqual(w, BAR_WIDTH, "2.0.1: no named-transaction caret");
});

test("the bar is wide enough for its longest line, as measured in the real renderer", () => {
  // "Recording · between transactions · 1:02:05" beside Next transaction
  // (with Ctrl+Shift+S), Pause and Stop: 615 px (the Plus Jakarta Sans the
  // bar embeds).
  assert.ok(barWidth() >= 615, "width " + barWidth());
});

test("with nothing saved, the bar opens at the top centre of the main screen, off the buttons (live finding 16)", () => {
  const p = placeBar({ saved: null, size: SIZE, workAreas: [LAPTOP], primary: LAPTOP });
  assert.deepStrictEqual(p, { x: Math.round((1366 - BAR_WIDTH) / 2), y: 0 });
  // On the live run's 2560 wide screen it no longer covers Calculator's "="
  // (the key's box was x 1792 to 2236, y 954 to 1028).
  const wide = { x: 0, y: 0, width: 2560, height: 1032 };
  const q = placeBar({ saved: null, size: SIZE, workAreas: [wide], primary: wide });
  const overlaps = q.x < 2236 && q.x + BAR_WIDTH > 1792 && q.y < 1028 && q.y + BAR_HEIGHT > 954;
  assert.ok(!overlaps, "the bar covers the = key: " + JSON.stringify(q));
  // A main screen to the right of another: its own top centre.
  assert.deepStrictEqual(placeBar({ saved: null, size: SIZE, workAreas: [LAPTOP, RIGHT], primary: RIGHT }),
    { x: 1366 + Math.round((1920 - BAR_WIDTH) / 2), y: 0 });
});

test("a saved place is kept (the bar remembers where it was put)", () => {
  const saved = { x: 300, y: 12 };
  assert.deepStrictEqual(placeBar({ saved, size: SIZE, workAreas: [LAPTOP, RIGHT], primary: LAPTOP }), saved);
  const onSecond = { x: 2000, y: 900 };
  assert.deepStrictEqual(placeBar({ saved: onSecond, size: SIZE, workAreas: [LAPTOP, RIGHT], primary: LAPTOP }), onSecond);
});

test("a saved place on a screen that is gone falls back to the main screen's top centre", () => {
  const p = placeBar({ saved: { x: 2000, y: 900 }, size: SIZE, workAreas: [LAPTOP], primary: LAPTOP });
  assert.deepStrictEqual(p, { x: Math.round((1366 - BAR_WIDTH) / 2), y: 0 });
});

test("a saved place partly off its screen is pulled back so the whole bar shows", () => {
  const p = placeBar({ saved: { x: 1366 - BAR_WIDTH / 2 - 10, y: 700 }, size: SIZE, workAreas: [LAPTOP], primary: LAPTOP });
  assert.deepStrictEqual(p, { x: 1366 - BAR_WIDTH, y: 728 - BAR_HEIGHT });
});

test("a bar that grows for a problem line near the bottom moves up to stay on screen", () => {
  const x = 1366 - BAR_WIDTH - 16;   // a place the SME dragged it to, 44 px tall until the problem line
  const p = clampIntoArea({ x, y: 728 - 44 - 16, width: BAR_WIDTH, height: 82 }, LAPTOP);
  assert.deepStrictEqual(p, { x, y: 728 - 82 });
});

test("the bar's page carries its first view model inert: a run name cannot break out of the script", () => {
  const html = buildBarHtml({ state: "recording", runText: "</script><img src=x onerror=alert(1)>" });
  const script = html.slice(html.lastIndexOf("<script>"));
  assert.ok(!script.includes("<img"), "no raw markup from the view model");
  assert.ok(!/\{\{INITIAL_VIEW\}\}/.test(html), "the slot is filled");
});

test("the bar's page has no counters, no event feed and no program or window title", () => {
  // The raw page, not the built one: the built page inlines base64 fonts.
  const html = fs.readFileSync(path.join(__dirname, "..", "ui", "recording-bar.html"), "utf-8");
  for (const gone of ["counters", "feed", "Recent events", "interactions", "currentApp", "currentTitle", "recorder on", "Tracking"]) {
    assert.ok(!html.includes(gone), "the bar still has: " + gone);
  }
  for (const kept of ["btn-next", "btn-pause", "btn-stop", "btn-start", "Keep recording", "Stop recording"]) {
    assert.ok(html.includes(kept), "the bar lacks: " + kept);
  }
});
