"use strict";

// Lane E (E5): the step "<step>" starts here acts on, and the place it keeps.
const test = require("node:test");
const assert = require("node:assert/strict");
const SH = require("./show-here.js");
const StepOrder = require("./step-order.js");

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const hand = (id, extra) => Object.assign({ step_id: id, name: "Step " + id, state: "manually_authored", case_id: "c1",
  evidence: { interaction_event_ids: [] }, time_range: null }, extra || {});
const timed = (id, a, b, extra) => hand(id, Object.assign({ time_range: { start: iso(a), end: iso(b) } }, extra || {}));

test("targetOf: the selected step when its time is the analyst's to set, else the first step without a time", () => {
  const rec = timed("r", 0, 5, { state: "confirmed", evidence: { interaction_event_ids: ["e1"] } });
  const mine = timed("m", 5, 10);
  const u1 = hand("u1", { order: 1 }), u2 = hand("u2", { order: 2 });
  const hidden = hand("h", { state: "hidden", order: 3 });
  const ordered = [rec, mine, u1, u2];
  // The selected step: one without a time, or with the analyst's time.
  assert.equal(SH.targetOf(u2, ordered), u2);
  assert.equal(SH.targetOf(mine, ordered), mine);
  // A recorded step is never its step: the first one without a time instead.
  assert.equal(SH.targetOf(rec, ordered), u1);
  // Nothing selected, or a step not in the list (a hidden one).
  assert.equal(SH.targetOf(null, ordered), u1);
  assert.equal(SH.targetOf(hidden, ordered), u1);
  // Neither: the button is hidden.
  assert.equal(SH.targetOf(rec, [rec, mine]), null);
  assert.equal(SH.targetOf(null, []), null);
  // A step with sub-steps has its time from them.
  const parent = hand("s", { sub_steps: [hand("x")] });
  assert.equal(SH.targetOf(parent, [parent]), null);
});

test("nextAfter: the next step without a time after the one done, else the first before it, else none", () => {
  const a = timed("a", 0, 5), b = hand("b", { order: 1 }), c = hand("c", { order: 2 }), d = timed("d", 9, 12);
  assert.equal(SH.nextAfter(a, [a, b, c, d]), b);
  assert.equal(SH.nextAfter(d, [b, a, c, d]), b);
  assert.equal(SH.nextAfter(a, [a, d]), null);
});

test("keepPlace: a step given an earlier moment than the steps before it in the list keeps its place in the process", () => {
  // A (0:10 to 0:30) is timed; B and C were written first (no time). C is
  // shown at 0:20, inside A, which then ends there: by time C would come
  // before B.
  const A = timed("A", 10, 30), B = hand("B", { order: 1 }), C = hand("C", { order: 2 });
  const list = [A, B, C];
  const before = StepOrder.processOrder(list);
  assert.deepEqual(before.map((s) => s.step_id), ["A", "B", "C"]);
  A.time_range = { start: iso(10), end: iso(20) };
  C.time_range = { start: iso(20), end: iso(30) };
  delete C.order;
  assert.deepEqual(StepOrder.processOrder(list).map((s) => s.step_id), ["A", "C", "B"]);
  const changed = SH.keepPlace(before, list, C, () => true);
  assert.deepEqual(StepOrder.processOrder(list).map((s) => s.step_id), ["A", "B", "C"]);
  // The fewest placements: the step moved carries the one placement.
  assert.deepEqual(changed.map((s) => s.step_id), ["C"]);
  assert.equal(C.placed_after, "B");
  assert.equal(A.placed_after, undefined);
});

test("keepPlace: a step given a moment in its time order needs no placement", () => {
  const A = timed("A", 10, 30), B = hand("B", { order: 1 });
  const list = [A, B];
  const before = StepOrder.processOrder(list);
  B.time_range = { start: iso(40), end: iso(50) };
  assert.deepEqual(SH.keepPlace(before, list, B, () => true), []);
  assert.equal(B.placed_after, undefined);
});

test("nameOf, labelOf, titleOf and doneText: the owner's words", () => {
  const s = { name: "  Enter the order " };
  assert.equal(SH.nameOf(s), "Enter the order");
  assert.equal(SH.nameOf({ name: "" }), "this step");
  assert.equal(SH.labelOf(s), '"Enter the order" starts here');
  assert.equal(SH.titleOf(s), 'Sets the start of "Enter the order" to the moment the video shows now. Its place among the steps stays.');
  assert.equal(SH.titleOf(s, true), 'Sets the start of "Enter the order" to the moment you clicked. Its place among the steps stays.');
  assert.equal(SH.doneText(s, "0:16"), '"Enter the order" starts at 0:16.');
});
