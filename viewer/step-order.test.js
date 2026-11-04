"use strict";

/* step-order.js (contract C22, 2.0.5): the process order of a list of steps,
   pinned with the pipeline by shared/step-order-golden.json, and the edits
   that write the fewest placements for a wanted order. */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const SO = require("./step-order.js");

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "step-order-golden.json"), "utf8"));
const BASE = Date.parse("2026-05-14T09:00:00Z");
const iso = (sec) => new Date(BASE + sec * 1000).toISOString();

/* A golden step as the annotations carry it. */
function stepOf(g) {
  const s = { step_id: g.id, case_id: g.case === undefined ? null : g.case, name: g.id,
    time_range: g.t == null ? null : { start: iso(g.t), end: iso(g.t + 1) }, state: g.state || "manually_authored" };
  if (g.order !== undefined) s.order = g.order;
  if (g.after !== undefined) s.placed_after = g.after;
  return s;
}

test("C22: every case of the shared step order golden (the pipeline's process_order pins the same file)", () => {
  assert.ok(GOLDEN.cases.length >= 10, "precondition: the golden has its cases");
  for (const c of GOLDEN.cases) {
    const steps = c.steps.map(stepOf);
    assert.deepEqual(SO.processOrder(steps).map((s) => s.step_id), c.expected, c.name);
    const at = SO.placeMoments(steps);
    const got = {};
    for (const s of steps) {
      const ms = at.get(s);
      got[s.step_id] = ms === -Infinity ? "first" : Number.isFinite(ms) ? (ms - BASE) / 1000 : null;
    }
    assert.deepEqual(got, c.moments, c.name + " (moments)");
  }
});

test("the order leaves the list as it was and reads the same with or without the hidden steps", () => {
  const steps = GOLDEN.cases.find((c) => /hidden step can be placed/.test(c.name)).steps.map(stepOf);
  const before = steps.map((s) => s.step_id);
  const all = SO.processOrder(steps).filter((s) => s.state !== "hidden").map((s) => s.step_id);
  const vis = SO.processOrder(steps.filter((s) => s.state !== "hidden")).map((s) => s.step_id);
  assert.deepEqual(all, vis);
  assert.deepEqual(steps.map((s) => s.step_id), before, "the list is not sorted in place");
});

/* Five steps a second apart, a to e, all free. */
function five() { return ["a", "b", "c", "d", "e"].map((id, i) => stepOf({ id, t: i * 10, case: "T1" })); }
const ids = (list) => list.map((s) => s.step_id);
const placed = (list) => Object.fromEntries(list.filter((s) => s.placed_after != null).map((s) => [s.step_id, s.placed_after]));

test("deriveOrder: one step moved up past another is the one placed (Alt+Up)", () => {
  const steps = five();
  SO.deriveOrder(steps, ["a", "c", "b", "d", "e"], { moved: "c" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["a", "c", "b", "d", "e"]);
  assert.deepEqual(placed(steps), { c: "a" });
});

test("deriveOrder: one step moved down past another is the one placed (Alt+Down)", () => {
  const steps = five();
  SO.deriveOrder(steps, ["a", "c", "b", "d", "e"], { moved: "b" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["a", "c", "b", "d", "e"]);
  assert.deepEqual(placed(steps), { b: "c" });
});

test("deriveOrder: a late step moved to the top is placed first; moved back where its time puts it, it is placed no more", () => {
  const steps = five();
  SO.deriveOrder(steps, ["e", "a", "b", "c", "d"], { moved: "e" });
  assert.deepEqual(placed(steps), { e: "start" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["e", "a", "b", "c", "d"]);
  SO.deriveOrder(steps, ["a", "b", "c", "d", "e"], { moved: "e" });
  assert.deepEqual(placed(steps), {});
});

test("deriveOrder: the steps that came after a moved step keep their place (the moved one takes no follower along)", () => {
  const steps = five();
  // e after a, then d after e: a, e, d, b, c.
  SO.deriveOrder(steps, ["a", "e", "b", "c", "d"], { moved: "e" });
  SO.deriveOrder(steps, ["a", "e", "d", "b", "c"], { moved: "d" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["a", "e", "d", "b", "c"]);
  // e moved up to the top: d stays after a.
  SO.deriveOrder(steps, ["e", "a", "d", "b", "c"], { moved: "e" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["e", "a", "d", "b", "c"]);
  assert.deepEqual(placed(steps), { e: "start", d: "a" });
});

test("deriveOrder: a step may not go by its time again when canBeFree says no (its start lies in another transaction)", () => {
  const steps = five();
  // e's time puts it last, where it is wanted, but it was placed into this transaction.
  steps[4].placed_after = "d";
  SO.deriveOrder(steps, ["a", "b", "c", "d", "e"], { canBeFree: (s) => s.step_id !== "e" });
  assert.deepEqual(placed(steps), { e: "d" });
  // A step free now stays free whatever canBeFree says.
  SO.deriveOrder(steps, ["a", "b", "c", "d", "e"], { canBeFree: () => false });
  assert.deepEqual(placed(steps), { e: "d" });
});

test("deriveOrder: the steps without a time can be placed among the steps with one", () => {
  const steps = [stepOf({ id: "a", t: 0 }), stepOf({ id: "b", t: 10 }), stepOf({ id: "u", t: null, order: 1 }), stepOf({ id: "v", t: null, order: 2 })];
  SO.deriveOrder(steps, ["a", "u", "b", "v"], { moved: "u" });
  assert.deepEqual(placed(steps), { u: "a" });
  assert.deepEqual(ids(SO.processOrder(steps)), ["a", "u", "b", "v"]);
});

test("keepOrder: a step hidden or taken out hands the steps after it to the step before it", () => {
  const steps = five();
  SO.deriveOrder(steps, ["a", "e", "b", "c", "d"], { moved: "e" });   // e after a
  SO.deriveOrder(steps, ["a", "e", "d", "b", "c"], { moved: "d" });   // d after e
  const changed = SO.keepOrder(steps, ["e"]);
  assert.deepEqual(changed.map((s) => s.step_id), ["d"]);
  assert.equal(steps.find((s) => s.step_id === "d").placed_after, "a");
  steps.find((s) => s.step_id === "e").state = "hidden";
  assert.deepEqual(ids(SO.processOrder(steps).filter((s) => s.state !== "hidden")), ["a", "d", "b", "c"]);
  // Nothing placed: nothing to keep.
  assert.deepEqual(SO.keepOrder(five(), ["b"]), []);
});

test("keepOrder: a placed step whose place is its time's again is placed no more", () => {
  const steps = five();
  SO.deriveOrder(steps, ["a", "b", "d", "c", "e"], { moved: "d" });   // d after b
  assert.deepEqual(placed(steps), { d: "b" });
  SO.keepOrder(steps, ["c"]);
  assert.deepEqual(placed(steps), {});
});

test("apartOnTimeline: a step starting between the members, else null", () => {
  const steps = five();
  assert.equal(SO.apartOnTimeline([steps[0], steps[1]], steps), null);
  assert.equal(SO.apartOnTimeline([steps[0], steps[2]], steps).step_id, "b");
  steps[1].state = "hidden";
  assert.equal(SO.apartOnTimeline([steps[0], steps[2]], steps), null, "a hidden step lies nowhere");
  assert.equal(SO.apartOnTimeline([steps[0]], steps), null);
});

test("anchorOf and isPlaced read only the placements that hold", () => {
  const steps = five();
  steps[3].placed_after = "a";
  steps[4].placed_after = "gone";
  assert.equal(SO.anchorOf(steps[3], steps), steps[0]);
  assert.equal(SO.anchorOf(steps[4], steps), null);
  assert.equal(SO.isPlaced(steps[3], steps), true);
  assert.equal(SO.isPlaced(steps[4], steps), false);
  steps[2].placed_after = "start";
  assert.equal(SO.anchorOf(steps[2], steps), SO.START);
});

test("followTransaction: a placed step and its chain take the transaction of the step they hang from (the pipeline's rule)", () => {
  const steps = [
    { step_id: "a", case_id: "T1", state: "edited" },
    { step_id: "h", case_id: "T1", state: "hidden" },
    { step_id: "p", case_id: "T2", state: "edited", placed_after: "a" },
    { step_id: "q", case_id: "T2", state: "edited", placed_after: "p" },
    { step_id: "r", case_id: "T2", state: "edited", placed_after: "h" },
    { step_id: "s", case_id: "T2", state: "edited", placed_after: "start" },
  ];
  assert.deepEqual(SO.followTransaction(steps).map((s) => s.step_id), ["p", "q"]);
  assert.deepEqual(steps.map((s) => s.case_id), ["T1", "T1", "T1", "T1", "T2", "T2"]);
});

test("keepOrder: a step placed after the gone step, whose time may not place it, stays placed after the step before (the hide of its anchor)", () => {
  const steps = [stepOf({ id: "s1", t: 3, case: "T1" }), stepOf({ id: "s2", t: 8, case: "T1" }), stepOf({ id: "s3", t: 13, case: "T1" }),
    stepOf({ id: "s4", t: 24, case: "T1", after: "s2" })];
  SO.keepOrder(steps, ["s2"], { canBeFree: (s) => s.step_id !== "s4" });
  assert.deepEqual(placed(steps), { s4: "s1" });
  assert.deepEqual(ids(SO.processOrder(steps.filter((s) => s.step_id !== "s2"))), ["s1", "s4", "s3"]);
});
