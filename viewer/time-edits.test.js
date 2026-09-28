"use strict";
/*
 * 2.0.3 (a process manager's report: a transaction started a few pixels
 * after the step it was meant to hold, and nothing could be moved or given a
 * time): the rules a dragged side and a typed time follow (time-edits.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const TE = require("./time-edits.js");
const ME = require("./marker-edits.js");

const { MIN_SPAN_MS } = TE;

test("a moment comes to the nearest target within the tolerance, else stays where it is", () => {
  assert.equal(TE.snapMs(1000, [1040, 1500], 50), 1040);
  assert.equal(TE.snapMs(1000, [960, 1030], 50), 1030, "the nearest wins");
  assert.equal(TE.snapMs(1000, [1060], 50), 1000, "control: beyond the tolerance nothing moves");
  assert.equal(TE.snapMs(1000, [], 50), 1000);
  assert.equal(TE.snapMs(1000, [NaN, null], 50), 1000);
});

test("a marker moves between its neighbours and on the timeline", () => {
  const times = [1000, 5000, 9000];
  assert.deepEqual(TE.markerDragBounds(times, 1, 0, 10000), { lo: 1000 + MIN_SPAN_MS, hi: 9000 - MIN_SPAN_MS });
  assert.deepEqual(TE.markerDragBounds(times, 0, 0, 10000), { lo: 0, hi: 5000 - MIN_SPAN_MS }, "the first reaches back to the timeline's start");
  assert.deepEqual(TE.markerDragBounds(times, 2, 0, 10000), { lo: 5000 + MIN_SPAN_MS, hi: 10000 }, "the last reaches its end");
});

test("a step's side never runs over another step, leaves the step MIN_SPAN_MS long, and stays inside its sub-process", () => {
  const own = { startMs: 4000, endMs: 6000 };
  const others = [{ startMs: 1000, endMs: 3000 }, { startMs: 7000, endMs: 8000 }];
  const outer = { startMs: 0, endMs: 10000 };
  assert.deepEqual(TE.stepEdgeBounds(own, "start", others, outer), { lo: 3000, hi: 6000 - MIN_SPAN_MS });
  assert.deepEqual(TE.stepEdgeBounds(own, "end", others, outer), { lo: 4000 + MIN_SPAN_MS, hi: 7000 });
  assert.deepEqual(TE.stepEdgeBounds(own, "start", [], { startMs: 2500, endMs: 10000 }), { lo: 2500, hi: 6000 - MIN_SPAN_MS },
    "a sub-step stays in its parent");
  assert.equal(TE.stepEdgeBounds(own, "start", [{ startMs: 3000, endMs: 4500 }], outer).lo, 4000,
    "a step already over this one's start holds the start where it is");
});

test("a step back to back with the side moved gives way when its time is the analyst's too, and keeps a length of its own", () => {
  const own = { startMs: 4000, endMs: 6000 };
  const outer = { startMs: 0, endMs: 10000 };
  const before = { id: "b", startMs: 1000, endMs: 4000, movable: true };
  const after = { id: "a", startMs: 6000, endMs: 9000, movable: true };
  const s = TE.stepSide(own, "start", [before, after], outer);
  assert.equal(s.link, before);
  assert.deepEqual([s.lo, s.hi], [1000 + MIN_SPAN_MS, 6000 - MIN_SPAN_MS], "the start may go back into the step before, which gives way");
  assert.deepEqual(TE.stepSideChanges("x", own, "start", s.link, 2500),
    [{ stepId: "x", startMs: 2500, endMs: 6000 }, { stepId: "b", startMs: 1000, endMs: 2500 }]);
  const e = TE.stepSide(own, "end", [before, after], outer);
  assert.equal(e.link, after);
  assert.deepEqual([e.lo, e.hi], [4000 + MIN_SPAN_MS, 9000 - MIN_SPAN_MS]);
  assert.deepEqual(TE.stepSideChanges("x", own, "end", e.link, 7000),
    [{ stepId: "x", startMs: 4000, endMs: 7000 }, { stepId: "a", startMs: 7000, endMs: 9000 }]);
  // Control: a recorded step back to back keeps its time, and holds the side.
  const fixed = TE.stepSide(own, "start", [Object.assign({}, before, { movable: false })], outer);
  assert.equal(fixed.link, null);
  assert.equal(fixed.lo, 4000, "the start cannot go back over a step whose recorded actions give it its time");
  // A step with a gap before it moves alone.
  assert.equal(TE.stepSide(own, "start", [{ id: "g", startMs: 1000, endMs: 3500, movable: true }], outer).link, null);
});

test("a step without a time is given one where no step is, until the next step starts or its transaction ends", () => {
  const outer = { startMs: 0, endMs: 30000 };
  const others = [{ startMs: 5000, endMs: 9000 }, { startMs: 20000, endMs: 25000 }];
  assert.deepEqual(TE.placeUntimed(12000, others, outer, null), { endMs: 20000 }, "until the next step starts");
  assert.deepEqual(TE.placeUntimed(12000, others, outer, 15000), { endMs: 15000 }, "or its transaction ends");
  assert.deepEqual(TE.placeUntimed(26000, others, outer, null), { endMs: 30000 }, "or the timeline ends");
  assert.deepEqual(TE.placeUntimed(7000, others, outer, null), { inside: others[0] }, "not over another step");
  assert.deepEqual(TE.placeUntimed(9000, others, outer, null), { endMs: 20000 }, "a step may start where the one before ends");
  assert.deepEqual(TE.placeUntimed(19950, others, outer, null), { tooShort: true });
  assert.deepEqual(TE.placeUntimed(31000, others, outer, null), { outside: true });
});

test("a time reads on the one clock, with its tenth of a second when it has one, and is typed the same way", () => {
  assert.equal(TE.fieldTime(9570, 0), "0:09.6", "two moments a second apart never read the same");
  assert.equal(TE.fieldTime(9720, 0), "0:09.7");
  assert.equal(TE.fieldTime(9000, 0), "0:09");
  assert.equal(TE.fieldTime(9960, 0), "0:10", "the tenth rounds up into the next second");
  assert.equal(TE.fieldTime(3723400, 0), "1:02:03.4");
  assert.equal(TE.fieldTime(NaN, 0), "");
  assert.equal(TE.parseFieldTime("0:09"), 9000);
  assert.equal(TE.parseFieldTime(" 0:09.6 "), 9600);
  assert.equal(TE.parseFieldTime("1:05,5"), 65500, "a decimal comma too");
  assert.equal(TE.parseFieldTime("1:02:03"), 3723000);
  for (const bad of ["", "9", "0:9", "1:60", "1:61:00", "0:09.6s", "noon", null]) {
    assert.equal(TE.parseFieldTime(bad), null, JSON.stringify(bad));
  }
  // What a field shows is read back as the same moment.
  for (const ms of [0, 9000, 9600, 65500, 3723400]) assert.equal(TE.parseFieldTime(TE.fieldTime(ms, 0)), ms);
});

test("a transaction's sides: its Start, its own End or the next Start that ends it, as the markers now are", () => {
  const t = (s) => new Date(Date.UTC(2026, 8, 28, 9, 0, s)).toISOString();
  const events = [
    { type: "marker", event_id: "s1", timestamp: t(10), data: { marker_type: "start", label: "A" } },
    { type: "marker", event_id: "e1", timestamp: t(20), data: { marker_type: "end" } },
    { type: "marker", event_id: "s2", timestamp: t(30), data: { marker_type: "start", label: "B" } },
    { type: "marker", event_id: "s3", timestamp: t(40), data: { marker_type: "start", label: "C" } },
  ];
  const analyzed = Date.UTC(2026, 8, 28, 12);
  const run = (a, b) => ({ startMs: Date.parse(t(a)), endMs: b == null ? null : Date.parse(t(b)) });
  let view = ME.markerView(events, [], analyzed);
  let s = TE.runSides(run(10, 20), view);
  assert.deepEqual([s.start.key, s.end && s.end.key, s.next], ["s1", "e1", null], "its own End");
  s = TE.runSides(run(30, 40), view);
  assert.deepEqual([s.start.key, s.end, s.next && s.next.key], ["s2", null, "s3"], "ended by the next Start");
  s = TE.runSides(run(40, null), view);
  assert.deepEqual([s.start.key, s.end, s.next], ["s3", null, null], "running to the end");
  assert.deepEqual(TE.runSides({ startMs: Date.parse(t(0)), endMs: null }, view).start, null, "no marker starts it");
  // An End typed for B, not applied yet: B's side shows it at once.
  const typed = [{ id: "n1", op: "insert", marker_type: "end", label: null, timestamp: t(35), ts: new Date(analyzed + 1000).toISOString() }];
  view = ME.markerView(events, typed, analyzed);
  s = TE.runSides(run(30, 40), view);
  assert.deepEqual([s.end && s.end.key, s.end && s.end.pending], ["insert-n1", true]);
  // A's start moved, not applied: still A's start, at its new time.
  view = ME.markerView(events, [{ id: "m1", event_id: "s1", field: "timestamp", value: t(12), ts: new Date(analyzed + 1000).toISOString() }], analyzed);
  s = TE.runSides(run(10, 20), view);
  assert.deepEqual([s.start.key, s.start.timestamp, s.start.pending], ["s1", t(12), true]);
});
