"use strict";

/*
 * Unit tests for the Flow timeline's pure helpers: the case-label-density
 * decision (NAV-AUDIT §J/§9), timeAtClientX, the run pairing
 * (layoutCaseLanes) and the markers' move by a typed time since the
 * recording started (sinceStartToIso).
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
    ["Transaction 1", "A", 1, 3, false],   // ended by B's Start, not nested around B
    ["Transaction 2", "B", 3, 5, false],
    ["Transaction 3", "C", 6, 10, true],   // open at the end: it reaches the recording's end
  ]);
});

test("layoutCaseLanes: a label that only numbers the run (the capture app's Run N) is not shown on its band (AD-29)", () => {
  const r = layoutCaseLanes([mk(1, "start", "Run 1"), mk(3, "end"), mk(4, "start", "Order #10900"), mk(6, "start", "Transaction 3")], T0, T1);
  assert.deepEqual(r.cases.map((c) => [c.title, c.label]),
    [["Transaction 1", null], ["Transaction 2", "Order #10900"], ["Transaction 3", null]]);
});

test("layoutCaseLanes: an End with no open run starts nothing and closes nothing", () => {
  const r = layoutCaseLanes([mk(1, "end"), mk(2, "start", "A"), mk(4, "end"), mk(5, "end")], T0, T1);
  assert.deepEqual(r.cases.map((c) => [c.label, (c.startMs - T0) / 60000, (c.endMs - T0) / 60000]), [["A", 2, 4]]);
  assert.equal(layoutCaseLanes([], T0, T1).cases.length, 0);
});

/* ---- sinceStartToIso: Move without a video asks for the time since the
   recording started (P3.3; the one clock, V2 item 6) ---------------------- */

const { sinceStartToIso } = require("./flow-view-markers.js");

test("sinceStartToIso puts a typed time since the recording started on the recording; anything else is refused", () => {
  const origin = Date.UTC(2026, 4, 14, 9, 0, 0);
  const at = (s) => new Date(origin + s * 1000).toISOString();
  assert.equal(sinceStartToIso(origin, "2:07"), at(127));
  assert.equal(sinceStartToIso(origin, " 0:19 "), at(19));
  assert.equal(sinceStartToIso(origin, "1:02:03"), at(3723), "hours from an hour on");
  for (const bad of ["", "11", "1:60", "11:02:61", "2026-05-14T09:23:11Z", "noon"]) {
    assert.equal(sinceStartToIso(origin, bad), null, JSON.stringify(bad));
  }
  assert.equal(sinceStartToIso(NaN, "0:19"), null);
});

/* The lanes' names (the owner's review: "The lanes also don't have a
   description"). */

test("every lane the timeline stacks but the ticks has a name at the left, with a tooltip that starts with it and says what the lane shows", () => {
  const { LANE_NAMES } = Timeline;
  assert.deepEqual(Object.keys(LANE_NAMES).sort(), ["activity", "cases", "notes", "screenshots", "steps", "transcript"]);
  for (const [key, n] of Object.entries(LANE_NAMES)) {
    assert.ok(typeof n.name === "string" && n.name.length > 0, key);
    assert.ok(n.title.startsWith(n.name + ": ") && n.title.length > n.name.length + 20, key + ": " + n.title);
  }
  assert.equal(LANE_NAMES.activity.name, "Systems");
  assert.equal(LANE_NAMES.steps.title, "Steps: each step of each transaction; click one to see all its moments.");
});

test("a lane the Lanes menu lists has the same name there as at the timeline's left", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  const menu = [...html.matchAll(/<input type="checkbox" data-lane="([a-z]+)" \/>\s*([^<]+?)\s*<\/label>/g)].map((m) => [m[1], m[2]]);
  assert.ok(menu.length >= 6, "the Lanes menu rows were found");
  const named = menu.filter(([key]) => Timeline.LANE_NAMES[key]);
  assert.deepEqual(named.map(([key]) => key).sort(), ["cases", "notes", "screenshots", "steps", "transcript"]);
  for (const [key, word] of named) assert.equal(word, Timeline.LANE_NAMES[key].name, key);
});

/* ---- the stretches left out of the analysis (lane CC) ------------------- */

test("leftOutBands: the excluded ranges the Timeline draws, readable ones only, in time order, each with its entry", () => {
  const a = { start: "2026-05-14T09:02:00Z", end: "2026-05-14T09:02:30Z", reason: "manual" };
  const b = { start: "2026-05-14T09:00:10Z", end: "2026-05-14T09:00:40Z" };
  const bands = Timeline.leftOutBands([a, { start: "x", end: "y" }, { start: a.end, end: a.start }, null, b]);
  assert.deepEqual(bands.map((x) => x.range), [b, a], "the entry itself, for Include again");
  assert.deepEqual(bands.map((x) => [x.startMs, x.endMs]), [[Date.parse(b.start), Date.parse(b.end)], [Date.parse(a.start), Date.parse(a.end)]]);
  assert.deepEqual(Timeline.leftOutBands(undefined), []);
});

test("a band left out says what it is and what a click does; its label is the legend's words", () => {
  assert.equal(Timeline.LEFT_OUT_LABEL, "Left out of the analysis");
  assert.equal(Timeline.leftOutTitle("1:10", "1:45"),
    "Left out of the analysis, 1:10 to 1:45: its steps are not drafted and its time is not counted. Click to include it again.");
  assert.ok(Timeline.leftOutTitle("", "").startsWith("Left out of the analysis: "));
  // The label: whole where it fits, its first words on a narrower band, none on a thin one.
  assert.deepEqual([200, 150, 149, 64, 63, 0].map(Timeline.leftOutLabel),
    ["Left out of the analysis", "Left out of the analysis", "Left out", "Left out", "", ""]);
});

test("lane FX2: an app outside the process is left out of the analysis: its bands are the apps the dialog lists, by process name, case and .exe aside", () => {
  const { appLeftOut, appLeftOutTitle } = Timeline;
  assert.equal(appLeftOut("notepad.exe", ["notepad.exe"]), true);
  assert.equal(appLeftOut("NOTEPAD.EXE", ["notepad"]), true);
  assert.equal(appLeftOut("notepad", ["Notepad.exe"]), true);
  assert.equal(appLeftOut("notepad++.exe", ["notepad.exe"]), false, "a process name, not a part of one");
  assert.equal(appLeftOut("chrome.exe", []), false);
  assert.equal(appLeftOut("", ["notepad.exe"]), false);
  assert.equal(appLeftOut("chrome.exe", null), false);
  assert.equal(appLeftOutTitle("Notepad"),
    "Left out of the analysis: Notepad is among the apps outside the process, so its steps are not drafted and its time is not counted. Apps outside the process, in Steps, includes it again.");
});

test("lane FX2: a one-click step (it starts and ends in the same moment) gets a band on the steps lane; only a step with no time or one ending before it starts gets none", () => {
  const { stepBandSpan } = Timeline;
  const tr = (start, end) => ({ time_range: { start, end } });
  assert.deepEqual(stepBandSpan(tr("2026-05-14T09:00:47Z", "2026-05-14T09:00:47Z")),
    { startMs: Date.parse("2026-05-14T09:00:47Z"), endMs: Date.parse("2026-05-14T09:00:47Z") });
  assert.deepEqual(stepBandSpan(tr("2026-05-14T09:00:40Z", "2026-05-14T09:00:47Z")),
    { startMs: Date.parse("2026-05-14T09:00:40Z"), endMs: Date.parse("2026-05-14T09:00:47Z") });
  assert.equal(stepBandSpan(tr("2026-05-14T09:00:47Z", "2026-05-14T09:00:40Z")), null);
  assert.equal(stepBandSpan({ time_range: null }), null);
  assert.equal(stepBandSpan(tr("2026-05-14T09:00:47Z", null)), null);
});
