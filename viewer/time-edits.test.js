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
  assert.deepEqual(TE.placeUntimed(12000, others, outer, 15000), { endMs: 15000 }, "or the next transaction boundary");
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

test("the owner's 2.0.3 report, \"the duration is endless\": a step lasts until the next boundary, and a transaction's end cuts a step of the analyst's", () => {
  const M = (ms, type) => ({ type: "marker", timestamp: new Date(ms).toISOString(), data: { marker_type: type } });
  // Transaction 1 from 5 s, ended at 60 s; transaction 2 from 90 s, open.
  const moments = TE.markerMoments([M(90000, "start"), M(5000, "start"), M(60000, "end")]);
  assert.deepEqual(moments.map((m) => [m.ms, m.type]), [[5000, "start"], [60000, "end"], [90000, "start"]], "in time order");
  assert.equal(TE.nextBoundary(moments, 20000), 60000);
  assert.equal(TE.nextBoundary(moments, 60000), 90000, "a boundary at the moment itself is not after it");
  assert.equal(TE.nextBoundary(moments, 95000), null, "none after the last");
  assert.equal(TE.inMarkedTransaction(moments, 20000), true);
  assert.equal(TE.inMarkedTransaction(moments, 70000), false, "between an End and the next Start");
  assert.equal(TE.inMarkedTransaction(moments, 1000), false, "before the first Start");
  const cut = TE.cutAtBoundaries([
    { id: "a", startMs: 20000, endMs: 200000 },   // runs past its transaction's end
    { id: "b", startMs: 95000, endMs: 200000 },   // in the open transaction: nothing ends it
    { id: "c", startMs: 4900, endMs: 30000 },     // starts outside: a Start just after it does not cut it
    { id: "d", startMs: 30000, endMs: 50000 },    // inside
  ], moments);
  assert.deepEqual(cut, [{ id: "a", endMs: 60000 }]);
  // A new step inside a step of the analyst's cuts it; neither runs over a boundary.
  assert.deepEqual(TE.cutForNewStep({ startMs: 20000, endMs: 200000 }, 40000, moments),
    { before: { startMs: 20000, endMs: 40000 }, after: { startMs: 40000, endMs: 60000 } });
  assert.deepEqual(TE.cutForNewStep({ startMs: 20000, endMs: 200000 }, 95000, moments),
    { before: { startMs: 20000, endMs: 60000 }, after: { startMs: 95000, endMs: 200000 } },
    "a step running into the next transaction ends at its own transaction's end");
  // A step without a time placed inside a step of the analyst's: that step is the one it cuts.
  assert.deepEqual(TE.placeUntimed(30000, [{ startMs: 20000, endMs: 200000 }], { startMs: 0, endMs: 300000 }, 60000),
    { inside: { startMs: 20000, endMs: 200000 } });
});

test("the owner, after 2.0.3: \"you always add steps sequentially\": each step added ends the one before it, the newest is open until the next step or the transaction's end", () => {
  const LINE_END = 600000;   // a 10 minute video
  const M = (ms, type) => ({ type: "marker", timestamp: new Date(ms).toISOString(), data: { marker_type: type } });
  let moments = TE.markerMoments([M(40000, "start")]);   // Transaction 1 marked, no end yet
  // Step 1 at 0:40: nothing after it, so it runs to the end of the video: open.
  let steps = [{ id: "s1", startMs: 40000, endMs: LINE_END }];
  assert.equal(TE.isOpen(steps[0], LINE_END, moments), true, "the step being marked is open, not 9m 20s long");
  // Steps 2 and 3, one after the other: each ends the one before it.
  for (const [id, at] of [["s2", 65000], ["s3", 100000]]) {
    const prev = steps[steps.length - 1];
    const cut = TE.cutForNewStep(prev, at, moments);
    steps[steps.length - 1] = { id: prev.id, ...cut.before };
    steps.push({ id, ...cut.after });
  }
  assert.deepEqual(steps.map((s) => [s.id, s.startMs, s.endMs]), [["s1", 40000, 65000], ["s2", 65000, 100000], ["s3", 100000, LINE_END]]);
  assert.deepEqual(steps.map((s) => TE.isOpen(s, LINE_END, moments)), [false, false, true], "only the newest is open");
  // The transaction ends at 2:10: its last step ends there and is no longer open.
  moments = TE.markerMoments([M(40000, "start"), M(130000, "end")]);
  assert.deepEqual(TE.cutAtBoundaries(steps, moments), [{ id: "s3", endMs: 130000 }]);
  steps[2] = { ...steps[2], endMs: 130000 };
  assert.equal(TE.isOpen(steps[2], LINE_END, moments), false);
  // A step that ends where the video ends, in a transaction that ends there too, is not open.
  assert.equal(TE.isOpen({ startMs: 100000, endMs: LINE_END }, LINE_END, TE.markerMoments([M(40000, "start"), M(LINE_END, "end")])), false);
  assert.equal(TE.isOpen({ startMs: 100000, endMs: LINE_END - 100 }, LINE_END, moments.slice(0, 1)), true, "within OPEN_TOL_MS of the end");
  assert.equal(TE.isOpen({ startMs: 100000, endMs: 400000 }, LINE_END, moments.slice(0, 1)), false, "control: an end typed before the end of the video");
  assert.equal(TE.isOpen({ startMs: 100000, endMs: LINE_END }, NaN, []), false, "the video's length unknown: nothing is open");
});

test("a transaction's side moved takes the step sides joined to it along; taken out, the step that ended there runs on", () => {
  const M = (ms, type) => ({ type: "marker", timestamp: new Date(ms).toISOString(), data: { marker_type: type } });
  // Transaction 1 from 40 s to 130 s; transaction 2 from 150 s, open. Steps of the analyst's, back to back.
  const spans = [
    { id: "s1", startMs: 40000, endMs: 65000 }, { id: "s2", startMs: 65000, endMs: 130000 },
    { id: "t1", startMs: 150000, endMs: 600000 },
  ];
  const others = spans.concat([{ id: "rec", startMs: 135000, endMs: 140000 }]);   // a recorded step between the transactions
  // The Start corrected later: the first step starts with it (it never falls outside its transaction).
  assert.deepEqual(TE.followMarker(spans, others, "start", 40000, 42000), [{ id: "s1", startMs: 42000, endMs: 65000 }]);
  // The End moved later: the last step still ends there, but never over the recorded step after it.
  assert.deepEqual(TE.followMarker(spans, others, "end", 130000, 134000), [{ id: "s2", startMs: 65000, endMs: 134000 }]);
  assert.deepEqual(TE.followMarker(spans, others, "end", 130000, 137000), [], "it would run over the recorded step: it stays");
  // Only a step's start goes with a Start: an End moved does not move a step starting there.
  assert.deepEqual(TE.followMarker([{ id: "x", startMs: 130000, endMs: 132000 }], [], "end", 130000, 131000), []);
  // A step would be left under MIN_SPAN_MS: it stays.
  assert.deepEqual(TE.followMarker(spans, others, "start", 40000, 64950), []);
  assert.deepEqual(TE.followMarker(spans, others, "end", 130000, 130000), [], "control: not moved");
  // The End taken out: the step that ended there runs on to the next transaction's start.
  const without = TE.markerMoments([M(40000, "start"), M(150000, "start")]);
  assert.deepEqual(TE.followRemoval(spans, spans, 130000, without, 600000), [{ id: "s2", startMs: 65000, endMs: 150000 }]);
  // ... or, with no transaction after it, to the end of the video: open again.
  const alone = TE.markerMoments([M(40000, "start")]);
  assert.deepEqual(TE.followRemoval(spans.slice(0, 2), spans.slice(0, 2), 130000, alone, 600000), [{ id: "s2", startMs: 65000, endMs: 600000 }]);
  assert.deepEqual(TE.followRemoval(spans, spans, 99000, alone, 600000), [], "control: no step ended there");
  assert.equal(TE.naturalEnd({ id: "s1", startMs: 40000 }, spans, alone, 600000), 65000, "the next step's start first");
  assert.equal(TE.naturalEnd({ id: "s2", startMs: 65000 }, spans.slice(0, 2), without, NaN), 150000,
    "the video's length unknown: the next boundary still ends it");
  assert.equal(TE.naturalEnd({ id: "s2", startMs: 65000 }, spans.slice(0, 2), alone, NaN), Infinity, "and nothing else: no end to give");
});

test("a step deleted gives its time back to the step that ended where it started", () => {
  const spans = [{ id: "s1", startMs: 40000, endMs: 65000 }, { id: "s2", startMs: 65000, endMs: 600000 }];
  assert.deepEqual(TE.handBack(spans, spans[1]), { id: "s1", startMs: 40000, endMs: 600000 }, "the open step deleted: the one before it is open again");
  assert.equal(TE.handBack(spans, spans[0]), null, "no step ends where the first starts");
  assert.equal(TE.handBack([{ id: "s1", startMs: 40000, endMs: 60000 }], { id: "g", startMs: 65000, endMs: 70000 }), null,
    "control: a gap between them: nothing is joined");
  // The last step of transaction 1 ends at its End, where transaction 2's first step started: it stays.
  const M = (ms, type) => ({ type: "marker", timestamp: new Date(ms).toISOString(), data: { marker_type: type } });
  const moments = TE.markerMoments([M(40000, "start"), M(130000, "end"), M(130000, "start")]);
  assert.equal(TE.handBack([{ id: "s1", startMs: 100000, endMs: 130000 }], { id: "t1", startMs: 130000, endMs: 170000 }, moments), null);
});
