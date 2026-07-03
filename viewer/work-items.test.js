"use strict";

/*
 * Unit tests for work-items.js -- ADR-0028 case-scoped screen-visit work items.
 * Pure module; run with `npm test` (node:test). Covers the four cases the R3
 * spec requires: A-B-A-B interleave folds to 2 items (visit_count 2 each), a
 * case boundary keeps the same screen in two cases separate, hidden steps are
 * excluded from duration but the members list, and a no-cases input returns the
 * fallback signal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWorkItems, findGroupAnnotation, groupNameResolver, UNASSIGNED_CASE,
} = require("./work-items.js");

/* A step carrying an explicit screen grain key (so grainKey(step,"screen")
   resolves without interaction lookup). durMs sets the fragment duration. */
function step(id, caseId, screen, startMs, durMs, extra) {
  return Object.assign({
    step_id: id, case_id: caseId, name: id,
    grain_keys: { screen, app: "APP", element: "el" },
    state: "edited",
    time_range: {
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + (durMs == null ? 1000 : durMs)).toISOString(),
    },
  }, extra || {});
}

test("A-B-A-B interleave folds to 2 work items, visit_count 2 each", () => {
  const steps = [
    step("s1", "c1", "TAMBA", 1000, 1000),
    step("s2", "c1", "Excel", 2000, 1000),
    step("s3", "c1", "TAMBA", 3000, 1000),
    step("s4", "c1", "Excel", 4000, 1000),
  ];
  const { cases, hasCases } = buildWorkItems(steps, {});
  assert.equal(hasCases, true);
  assert.equal(cases.length, 1);
  const items = cases[0].work_items;
  assert.equal(items.length, 2, "non-consecutive merge -> one item per screen");
  const tamba = items.find((w) => w.screen_key.includes("TAMBA"));
  const excel = items.find((w) => w.screen_key.includes("Excel"));
  assert.equal(tamba.visit_count, 2, "TAMBA entered twice (the two bounces)");
  assert.equal(excel.visit_count, 2, "Excel entered twice");
  assert.equal(tamba.fragment_count, 2);
  assert.deepEqual(tamba.step_ids, ["s1", "s3"], "members in chronological order");
  assert.deepEqual(excel.step_ids, ["s2", "s4"]);
  assert.equal(tamba.total_ms, 2000, "duration = sum of member durations");
});

test("case boundary keeps the same screen in two cases separate", () => {
  const steps = [
    step("a1", "c1", "TAMBA", 1000, 1000),
    step("a2", "c2", "TAMBA", 2000, 1000),
  ];
  const { cases } = buildWorkItems(steps, {});
  assert.equal(cases.length, 2, "two cases -> two case groups");
  // Each case has its own TAMBA work item -- NOT merged across the boundary.
  const c1 = cases.find((c) => c.case_id === "c1");
  const c2 = cases.find((c) => c.case_id === "c2");
  assert.equal(c1.work_items.length, 1);
  assert.equal(c2.work_items.length, 1);
  assert.deepEqual(c1.work_items[0].step_ids, ["a1"]);
  assert.deepEqual(c2.work_items[0].step_ids, ["a2"]);
});

test("hidden steps are excluded from duration but the members list has the rest", () => {
  const steps = [
    step("s1", "c1", "TAMBA", 1000, 1000),
    step("s2", "c1", "TAMBA", 2000, 5000, { state: "hidden" }),
    step("s3", "c1", "TAMBA", 8000, 1000),
  ];
  const { cases } = buildWorkItems(steps, {});
  const item = cases[0].work_items[0];
  // The hidden s2 is dropped entirely (never counted), s1 + s3 remain.
  assert.deepEqual(item.step_ids, ["s1", "s3"]);
  assert.equal(item.fragment_count, 2);
  assert.equal(item.total_ms, 2000, "hidden step's 5000ms is NOT in the total");
});

test("no-cases input returns the fallback signal (hasCases false)", () => {
  const steps = [
    step("s1", null, "TAMBA", 1000, 1000),
    step("s2", null, "Excel", 2000, 1000),
  ];
  const { cases, hasCases } = buildWorkItems(steps, {});
  assert.equal(hasCases, false, "no step carries a case_id -> fallback");
  // The steps still group under the Unassigned pseudo-case (last), not dropped.
  assert.equal(cases.length, 1);
  assert.equal(cases[0].case_id, null);
  assert.equal(cases[0].case_label, "Unassigned");
  assert.equal(cases[0].work_items.length, 2);
});

test("Unassigned pseudo-case sorts LAST after real cases", () => {
  const steps = [
    step("u1", null, "TAMBA", 500, 1000),   // earliest, but unassigned
    step("a1", "c1", "TAMBA", 1000, 1000),
  ];
  const { cases, hasCases } = buildWorkItems(steps, {});
  assert.equal(hasCases, true);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].case_id, "c1", "real case first");
  assert.equal(cases[cases.length - 1].case_id, null, "Unassigned last");
});

test("group annotation flows name/waste/hidden onto the work item", () => {
  const steps = [step("s1", "c1", "TAMBA", 1000, 1000)];
  const screenKey = buildWorkItems(steps, {}).cases[0].work_items[0].screen_key;
  const groupAnnotations = [{
    case_id: "c1", screen_key: screenKey,
    name: "Investigate in TAMBA", waste: true, hidden: false, manually_authored: true,
  }];
  const { cases } = buildWorkItems(steps, { groupAnnotations });
  const w = cases[0].work_items[0];
  assert.equal(w.label, "Investigate in TAMBA", "the analyst name wins over the screen label");
  assert.equal(w.waste, true);
  assert.equal(w.hidden, false);
  assert.ok(w.group_annotation, "the entry is attached");
});

test("findGroupAnnotation matches null case_id (Unassigned)", () => {
  const gas = [{ case_id: null, screen_key: "scr:X", name: "n" }];
  assert.ok(findGroupAnnotation(gas, null, "scr:X"));
  assert.equal(findGroupAnnotation(gas, "c1", "scr:X"), null);
  // An entry with an absent case_id is treated as null too.
  const gas2 = [{ screen_key: "scr:Y", name: "n2" }];
  assert.ok(findGroupAnnotation(gas2, null, "scr:Y"));
});

test("groupNameResolver returns '' when there is no name (falls back)", () => {
  const resolve = groupNameResolver([{ case_id: "c1", screen_key: "scr:X" }]);
  assert.equal(resolve("c1", "scr:X"), "", "no name -> empty so grainLabel falls back");
  const resolve2 = groupNameResolver([{ case_id: "c1", screen_key: "scr:X", name: "  Named  " }]);
  assert.equal(resolve2("c1", "scr:X"), "Named", "trimmed");
});

test("UNASSIGNED_CASE constant is exported for callers", () => {
  assert.equal(typeof UNASSIGNED_CASE, "string");
});
