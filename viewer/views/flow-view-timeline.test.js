"use strict";

/*
 * Unit tests for the Flow timeline's pure helpers: the case-label-density
 * decision (NAV-AUDIT §J/§9), timeAtClientX, the run pairing
 * (layoutCaseLanes) and the markers' time-of-day move (timeOfDayOn).
 *
 * flow-view-timeline.js self-wires DOM controls at require() time, so a minimal
 * browser stub is installed BEFORE the require — enough for the top-level
 * `$("#btn…").addEventListener` / `getElementById(...).addEventListener` wiring
 * to no-op. Then the REAL exported `caseLabelFits` is exercised (no stub logic
 * substitutes for it — the function under test is the shipped one).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// ---- minimal browser stub (set before require) --------------------------
const _noopNode = new Proxy({}, {
  get(_t, prop) {
    if (prop === "addEventListener" || prop === "removeEventListener") return () => {};
    if (prop === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    if (prop === "style") return {};
    if (prop === "querySelector" || prop === "closest") return () => _noopNode;
    if (prop === "querySelectorAll") return () => [];
    if (prop === "getBoundingClientRect") return () => ({ top: 0, left: 0, width: 0, height: 0 });
    if (prop === "dataset") return {};
    return undefined;
  },
});
global.document = {
  querySelector: () => _noopNode,
  querySelectorAll: () => [],
  getElementById: () => _noopNode,
  addEventListener: () => {},
  createElement: () => _noopNode,
  body: _noopNode,
  documentElement: { setAttribute: () => {}, removeAttribute: () => {} },
};
global.window = { addEventListener: () => {}, localStorage: undefined };
const _ls = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

const Timeline = require("./flow-view-timeline.js");
const { caseLabelFits, CASE_LABEL_MIN_PX } = Timeline;

test("caseLabelFits is exported as a function with a numeric threshold", () => {
  assert.equal(typeof caseLabelFits, "function");
  assert.equal(typeof CASE_LABEL_MIN_PX, "number");
  assert.ok(CASE_LABEL_MIN_PX > 0);
});

test("a band wide enough (>= threshold px) keeps its label", () => {
  // 10% of a 1500px timeline = 150px, well over the ~46px floor.
  assert.equal(caseLabelFits(10, 1500), true);
});

test("a narrow band (< threshold px) drops its label", () => {
  // The audit's degrade: 60 cases over 3.6h in ~1500px ≈ 25px each.
  // 1.6% of 1500px = 24px < 46px floor -> silenced.
  assert.equal(caseLabelFits(1.6, 1500), false);
});

test("zooming in (wider host) makes a silenced label reappear", () => {
  // Same 1.6% band, but a 3x-zoomed 4500px timeline = 72px -> now fits.
  assert.equal(caseLabelFits(1.6, 1500), false);
  assert.equal(caseLabelFits(1.6, 4500), true);
});

test("the threshold boundary is inclusive (>=)", () => {
  // Exactly at the floor px should render (>=), just below should not.
  const hostW = 1000;
  const pctAtFloor = (CASE_LABEL_MIN_PX / hostW) * 100;
  assert.equal(caseLabelFits(pctAtFloor, hostW), true);
  assert.equal(caseLabelFits(pctAtFloor - 0.01, hostW), false);
});

test("a caller-supplied floor overrides the default", () => {
  // 50px band: passes a 40px floor, fails an 80px floor.
  assert.equal(caseLabelFits(5, 1000, 40), true);
  assert.equal(caseLabelFits(5, 1000, 80), false);
});

test("a zero-width host renders nothing (no divide-by-zero surprise)", () => {
  assert.equal(caseLabelFits(50, 0), false);
});

/* ---- timeAtClientX: the marker menu acts at the clicked moment (item 8) ---- */

const { timeAtClientX } = Timeline;
const T0 = Date.parse("2026-05-14T09:00:00Z");
const T1 = Date.parse("2026-05-14T09:10:00Z");   // a 600 s session

test("timeAtClientX maps the pointer across the timeline width to the session time", () => {
  const rect = { left: 100, width: 1200 };
  assert.equal(timeAtClientX(100, rect, T0, T1), "2026-05-14T09:00:00.000Z");
  assert.equal(timeAtClientX(700, rect, T0, T1), "2026-05-14T09:05:00.000Z");
  assert.equal(timeAtClientX(1300, rect, T0, T1), "2026-05-14T09:10:00.000Z");
});

test("timeAtClientX follows a zoomed timeline that is scrolled (its rect starts left of the viewport)", () => {
  // Zoomed 4x: 4800 px wide, scrolled so the host starts 2000 px left of the screen.
  const rect = { left: -2000, width: 4800 };
  // x = 160 + 2000 = 2160 px of 4800 = 45 % of 600 s = 270 s.
  assert.equal(timeAtClientX(160, rect, T0, T1), "2026-05-14T09:04:30.000Z");
});

test("timeAtClientX clamps to the session and refuses unusable geometry", () => {
  const rect = { left: 0, width: 600 };
  assert.equal(timeAtClientX(-50, rect, T0, T1), "2026-05-14T09:00:00.000Z");
  assert.equal(timeAtClientX(9999, rect, T0, T1), "2026-05-14T09:10:00.000Z");
  assert.equal(timeAtClientX(10, { left: 0, width: 0 }, T0, T1), null);
  assert.equal(timeAtClientX(10, rect, NaN, T1), null);
  assert.equal(timeAtClientX(10, null, T0, T1), null);
});

/* ---- layoutCaseLanes: runs pair the way the pipeline pairs them ---------- */
// normalization/case_assignment.py: runs never nest. A Start that arrives
// while a run is open ends that run there and opens the next one; an End with
// no open run is ignored; a run left open reaches the end of the recording.

const { layoutCaseLanes } = Timeline;
const mk = (min, type, label) => ({ type: "marker", timestamp: new Date(T0 + min * 60000).toISOString(),
  data: { marker_type: type, label: label || null } });

test("layoutCaseLanes: a Start while a run is open ends it at that Start; runs never nest and share one row", () => {
  const r = layoutCaseLanes([mk(1, "start", "A"), mk(3, "start", "B"), mk(5, "end"), mk(6, "start", "C")], T0, T1);
  assert.equal(r.lanesNeeded, 1, "runs never overlap, so one row holds them");
  assert.deepEqual(r.cases.map((c) => [c.title, c.label, (c.startMs - T0) / 60000, (c.endMs - T0) / 60000, c.dangling]), [
    ["Run 1", "A", 1, 3, false],   // ended by B's Start, not nested around B
    ["Run 2", "B", 3, 5, false],
    ["Run 3", "C", 6, 10, true],   // open at the end: it reaches the recording's end
  ]);
});

test("layoutCaseLanes: an End with no open run starts nothing and closes nothing", () => {
  const r = layoutCaseLanes([mk(1, "end"), mk(2, "start", "A"), mk(4, "end"), mk(5, "end")], T0, T1);
  assert.deepEqual(r.cases.map((c) => [c.label, (c.startMs - T0) / 60000, (c.endMs - T0) / 60000]), [["A", 2, 4]]);
  assert.equal(layoutCaseLanes([], T0, T1).cases.length, 0);
});

/* ---- timeOfDayOn: Move without a video asks for a time of day (P3.3) ------ */

const { timeOfDayOn } = require("./flow-view-markers.js");

test("timeOfDayOn puts a typed local time of day on the marker's own day; anything else is refused", () => {
  const day = new Date(2026, 4, 14, 11, 0, 19);   // local 11:00:19
  const at = (h, m, s) => new Date(2026, 4, 14, h, m, s).toISOString();
  assert.equal(timeOfDayOn(day.toISOString(), "11:02:07"), at(11, 2, 7));
  assert.equal(timeOfDayOn(day.toISOString(), " 9:05 "), at(9, 5, 0), "seconds are optional");
  for (const bad of ["", "11", "25:00", "11:60", "11:02:61", "2026-05-14T09:23:11Z", "noon"]) {
    assert.equal(timeOfDayOn(day.toISOString(), bad), null, JSON.stringify(bad));
  }
  assert.equal(timeOfDayOn("not a date", "11:02"), null);
});
