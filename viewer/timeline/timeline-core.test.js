"use strict";

/*
 * Tests for the pure functions of timeline-core.js. Run with `npm test`
 * (Node's built-in runner -- no test library). DOM helpers are not covered
 * here; they are verified by launching the viewer.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const tc = require("./timeline-core.js");

test("timeToXPct maps a time linearly onto 0-100", () => {
  assert.equal(tc.timeToXPct(0, 0, 100), 0);
  assert.equal(tc.timeToXPct(50, 0, 100), 50);
  assert.equal(tc.timeToXPct(100, 0, 100), 100);
  assert.equal(tc.timeToXPct(150, 100, 100), 50);
});

test("formatAxisLabel: seconds sub-minute, HH:MM for hours, date for days", () => {
  const t = Date.now();
  assert.match(tc.formatAxisLabel(t, 30000), /^\d\d:\d\d:\d\d$/);
  assert.match(tc.formatAxisLabel(t, 59999), /^\d\d:\d\d:\d\d$/);
  assert.match(tc.formatAxisLabel(t, 60000), /^\d\d:\d\d$/);
  assert.match(tc.formatAxisLabel(t, 3600000), /^\d\d:\d\d$/);
  assert.match(tc.formatAxisLabel(t, 86400000), /^\d{1,2}\/\d{1,2}$/);
});

test("chooseTicks returns nothing for a non-positive span", () => {
  assert.deepEqual(tc.chooseTicks(100, 100, 5), []);
  assert.deepEqual(tc.chooseTicks(100, 50, 5), []);
});

test("chooseTicks places round, evenly-spaced ticks across the span", () => {
  const ticks = tc.chooseTicks(0, 60000, 6); // target 10000ms -> 10s interval
  assert.equal(ticks.length, 7);
  assert.equal(ticks[0].tMs, 0);
  assert.equal(ticks[6].tMs, 60000);
  assert.equal(ticks[3].tMs, 30000);
  assert.equal(ticks[3].xPct, 50);
  for (const tick of ticks) assert.equal(tick.tMs % 10000, 0);
});

test("chooseTicks with an origin counts from it and reads the time since it (the one clock)", () => {
  const origin = Date.UTC(2026, 4, 14, 9, 0, 0);
  const ticks = tc.chooseTicks(origin + 4000, origin + 64000, 6, origin);   // 10 s ticks
  assert.deepEqual(ticks.map((t) => t.label), ["0:10", "0:20", "0:30", "0:40", "0:50", "1:00"]);
  assert.equal(ticks[0].tMs, origin + 10000, "counted from the origin, not from the epoch");
  const hours = tc.chooseTicks(origin, origin + 3 * 3600000, 3, origin);
  assert.deepEqual(hours.map((t) => t.label), ["0:00", "1:00:00", "2:00:00", "3:00:00"]);
});

test("chooseTicks widens the interval as the span grows", () => {
  const ticks = tc.chooseTicks(0, 3600000, 6); // target 600000ms -> 10m interval
  for (let i = 1; i < ticks.length; i++) {
    assert.equal(ticks[i].tMs - ticks[i - 1].tMs, 600000);
  }
  assert.match(ticks[0].label, /^\d\d:\d\d$/); // >= 1 minute -> no seconds
});

test("packLanes keeps non-overlapping items on one lane", () => {
  const r = tc.packLanes(
    [{ id: "a", startMs: 0, endMs: 100 }, { id: "b", startMs: 1000, endMs: 1100 }],
    { maxLanes: 4, spanMs: 10000 }
  );
  assert.equal(r.laneCount, 1);
  assert.equal(r.laneOf.get("a"), 0);
  assert.equal(r.laneOf.get("b"), 0);
});

test("packLanes splits overlapping items onto separate lanes", () => {
  const r = tc.packLanes(
    [{ id: "a", startMs: 0, endMs: 5000 }, { id: "b", startMs: 1000, endMs: 6000 }],
    { maxLanes: 4, spanMs: 10000 }
  );
  assert.equal(r.laneCount, 2);
  assert.equal(r.laneOf.get("a"), 0);
  assert.equal(r.laneOf.get("b"), 1);
});

test("packLanes caps lanes at maxLanes; overflow shares the last lane", () => {
  const items = [
    { id: "a", startMs: 0, endMs: 10000 },
    { id: "b", startMs: 100, endMs: 10000 },
    { id: "c", startMs: 200, endMs: 10000 },
    { id: "d", startMs: 300, endMs: 10000 },
  ];
  const r = tc.packLanes(items, { maxLanes: 3, spanMs: 10000 });
  assert.equal(r.laneCount, 3);
  assert.equal(r.laneOf.get("c"), 2);
  assert.equal(r.laneOf.get("d"), 2); // overflow -> last lane
});

test("packLanes uses a visual footprint so near-simultaneous items separate", () => {
  // Raw ranges (0-1 and 10-11) do not overlap, but on a 100s span the rendered
  // blocks do once padded to their minimum width -> they must take two lanes.
  const r = tc.packLanes(
    [{ id: "a", startMs: 0, endMs: 1 }, { id: "b", startMs: 10, endMs: 11 }],
    { maxLanes: 4, spanMs: 100000 }
  );
  assert.equal(r.laneCount, 2);
  assert.notEqual(r.laneOf.get("a"), r.laneOf.get("b"));
});

test("packLanes ignores items with non-finite times", () => {
  const r = tc.packLanes(
    [{ id: "a", startMs: 0, endMs: 100 }, { id: "bad", startMs: NaN, endMs: 100 }],
    { maxLanes: 4, spanMs: 10000 }
  );
  assert.equal(r.laneOf.has("bad"), false);
  assert.equal(r.laneOf.get("a"), 0);
});

test("layoutLaneStack stacks lanes cumulatively, offsetting each by its gap", () => {
  const layout = tc.layoutLaneStack([
    { key: "ticks", height: 20, gapBefore: 4 },
    { key: "cases", height: 22, gapBefore: 4 },
    { key: "activity", height: 60, gapBefore: 6 },
  ]);
  assert.deepEqual(layout.slots.get("ticks"), { top: 4, height: 20 });
  assert.deepEqual(layout.slots.get("cases"), { top: 28, height: 22 });
  assert.deepEqual(layout.slots.get("activity"), { top: 56, height: 60 });
  assert.equal(layout.contentHeight, 116);
  assert.equal(layout.totalHeight, 116);
});

test("layoutLaneStack offsets the first lane by its gapBefore", () => {
  const layout = tc.layoutLaneStack([{ key: "only", height: 20, gapBefore: 4 }]);
  assert.deepEqual(layout.slots.get("only"), { top: 4, height: 20 });
});

test("layoutLaneStack keeps a zero-height lane in the stack but adds no height", () => {
  const layout = tc.layoutLaneStack([
    { key: "a", height: 10, gapBefore: 0 },
    { key: "b", height: 0, gapBefore: 5 },
    { key: "c", height: 10, gapBefore: 5 },
  ]);
  assert.deepEqual(layout.slots.get("a"), { top: 0, height: 10 });
  assert.deepEqual(layout.slots.get("b"), { top: 15, height: 0 });
  assert.deepEqual(layout.slots.get("c"), { top: 20, height: 10 });
  assert.equal(layout.contentHeight, 30);
});

test("layoutLaneStack adds tailPx below the last lane", () => {
  const layout = tc.layoutLaneStack([{ key: "a", height: 10, gapBefore: 4 }], { tailPx: 14 });
  assert.equal(layout.contentHeight, 14);
  assert.equal(layout.totalHeight, 28);
});

test("layoutLaneStack reproduces the Flow timeline lane cascade", () => {
  // The Flow lane stack with default toggles: cases + activity + screenshots
  // shown; density/titles/steps/notes off (height 0). Expected tops are
  // hand-computed from the pre-refactor renderTimeline() geometry.
  const layout = tc.layoutLaneStack([
    { key: "ticks", height: 20, gapBefore: 4 },
    { key: "cases", height: 22, gapBefore: 4 },
    { key: "activity", height: 60, gapBefore: 6 },
    { key: "screenshots", height: 26, gapBefore: 4 },
    { key: "density", height: 0, gapBefore: 6 },
    { key: "titles", height: 0, gapBefore: 4 },
    { key: "steps", height: 0, gapBefore: 0 },
    { key: "notes", height: 0, gapBefore: 0 },
  ], { tailPx: 14 });
  assert.deepEqual(layout.slots.get("ticks"), { top: 4, height: 20 });
  assert.deepEqual(layout.slots.get("cases"), { top: 28, height: 22 });
  assert.deepEqual(layout.slots.get("activity"), { top: 56, height: 60 });
  assert.deepEqual(layout.slots.get("screenshots"), { top: 120, height: 26 });
  assert.deepEqual(layout.slots.get("density"), { top: 152, height: 0 });
  assert.deepEqual(layout.slots.get("titles"), { top: 156, height: 0 });
  assert.deepEqual(layout.slots.get("steps"), { top: 156, height: 0 });
  assert.deepEqual(layout.slots.get("notes"), { top: 156, height: 0 });
  assert.equal(layout.contentHeight, 156);
  assert.equal(layout.totalHeight, 170);
});
