"use strict";

/*
 * step-band-label.test.js: what a step's band on the Timeline's Steps lane
 * says (step-band-label.js): the name where it reads, else the number the
 * pane's Steps tab shows, else nothing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./step-band-label.js");
const PL = require("./pane-lists.js");

const step = (id, extra) => Object.assign({ step_id: id, name: "Step " + id, state: "confirmed" }, extra || {});

test("bandLabel: a wide band shows the name", () => {
  // A positive control: 200 px is room enough for any name (cut on two lines).
  assert.deepEqual(L.bandLabel(200, "Enter the order lines", 160, 3), { kind: "name", text: "Enter the order lines" });
  // At the least room for a name, the name; a px under it, the number.
  const atMin = L.NAME_MIN_PX + 2 * (L.PAD_PX + L.BORDER_PX);
  assert.equal(L.bandLabel(atMin, "Enter the order lines", 160, 3).kind, "name");
  assert.deepEqual(L.bandLabel(atMin - 1, "Enter the order lines", 160, 3), { kind: "number", text: "3" });
});

test("bandLabel: a short name that fits whole shows in a narrow band", () => {
  // "Pay" is 22 px wide: a 36 px band holds it (24 px inside its padding).
  assert.deepEqual(L.bandLabel(36, "Pay", 22, 7), { kind: "name", text: "Pay" });
  // Not measured: the number.
  assert.deepEqual(L.bandLabel(36, "Pay", NaN, 7), { kind: "number", text: "7" });
});

test("bandLabel: a band too narrow for the name shows its number, then nothing", () => {
  assert.deepEqual(L.bandLabel(20, "Find the customer", 110, 2), { kind: "number", text: "2" });
  assert.deepEqual(L.bandLabel(20, "Find the customer", 110, 12), { kind: "number", text: "12" });
  assert.deepEqual(L.bandLabel(8, "Find the customer", 110, 12), { kind: "none", text: "" });
  assert.deepEqual(L.bandLabel(3, "Find the customer", 110, 2), { kind: "none", text: "" });
  // No number (a step outside every listed group): nothing.
  assert.deepEqual(L.bandLabel(20, "Find the customer", 110, null), { kind: "none", text: "" });
});

test("bandLabel: an empty name never shows as a name", () => {
  assert.deepEqual(L.bandLabel(300, "  ", 0, 4), { kind: "number", text: "4" });
  assert.deepEqual(L.bandLabel(300, null, 0, null), { kind: "none", text: "" });
});

test("stepNumbers: the number the pane's Steps tab shows, its place in its group", () => {
  // The pane's own groups (pane-lists.js stepGroups): the reference
  // transaction first, then the others, each numbered from 1.
  const model = {
    runs: [
      { caseId: "c1", members: [step("a"), step("b"), step("h", { state: "hidden" }), step("c")] },
      { caseId: "c2", members: [step("d"), step("e")] },
    ],
    outside: [step("x")],
  };
  const groups = PL.stepGroups(model, "c2", null);
  const nums = L.stepNumbers(groups);
  assert.deepEqual([...nums], [["d", 1], ["e", 2], ["a", 1], ["b", 2], ["c", 3], ["x", 1]]);
  assert.equal(nums.has("h"), false, "a hidden step has no number");
  // Each number is the row the pane draws for it.
  for (const g of groups) g.steps.forEach((s, i) => assert.equal(nums.get(s.step_id), PL.stepRow(s, i, {}, {}).num));
});

test("stepNumbers: an empty or odd input numbers nothing", () => {
  assert.equal(L.stepNumbers(null).size, 0);
  assert.equal(L.stepNumbers([{ steps: null }, null]).size, 0);
  assert.deepEqual([...L.stepNumbers([{ steps: [step("s1"), null, step("s2")] }])], [["s1", 1], ["s2", 3]]);
});
