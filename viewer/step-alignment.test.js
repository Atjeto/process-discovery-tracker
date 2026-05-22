"use strict";

/*
 * Unit tests for step-alignment.js -- intra-session repetition alignment.
 * Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { stepSignature, alignSteps, groupForStep } = require("./step-alignment.js");

// Build a step + its interactions. `elems` is a list of
// [kind, control_type, automation_id] tuples; values are intentionally
// random per call so the signature must ignore them.
let _eid = 0;
function mk(stepId, caseId, elems, opts = {}) {
  const ids = [];
  const interactions = {};
  for (const [kind, ct, aid] of elems) {
    const id = "e" + (_eid++);
    ids.push(id);
    interactions[id] = { event_id: id, type: "interaction", data: {
      kind, control_type: ct, automation_id: aid, value: "val" + Math.random(),
    } };
  }
  const step = {
    step_id: stepId, case_id: caseId, name: opts.name || stepId,
    state: opts.state || "auto_suggested",
    canonical_step_id: opts.canonical || null,
    evidence: { interaction_event_ids: ids },
  };
  return { step, interactions };
}

function merge(...parts) {
  const steps = [];
  const interactionsById = {};
  for (const p of parts) {
    steps.push(p.step);
    Object.assign(interactionsById, p.interactions);
  }
  return { steps, interactionsById };
}

test("same structural step across two cases aligns despite different values", () => {
  // ticket A and ticket B each: type serial (txtsr) + click submit
  const a = mk("a1", "caseA", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const b = mk("b1", "caseB", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const { steps, interactionsById } = merge(a, b);
  const { caseCount, groups } = alignSteps(steps, interactionsById);
  assert.equal(caseCount, 2);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].caseSpan, 2);
  assert.deepEqual(groups[0].members.map((m) => m.stepId).sort(), ["a1", "b1"]);
});

test("structurally different steps do not align", () => {
  const a = mk("a1", "caseA", [["value_changed", "Edit", "txtsr"]]);
  const b = mk("b1", "caseB", [["invoked", "Button", "save-order"]]);
  const { steps, interactionsById } = merge(a, b);
  const { groups } = alignSteps(steps, interactionsById);
  assert.equal(groups.length, 0); // no signature spans >1 case
});

test("canonical_step_id groups instances directly", () => {
  const a = mk("a1", "caseA", [["value_changed", "Edit", "x"]], { canonical: "look-up-serial" });
  const b = mk("b1", "caseB", [["invoked", "Button", "y"]], { canonical: "look-up-serial" });
  const { steps, interactionsById } = merge(a, b);
  const { groups } = alignSteps(steps, interactionsById);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].signature, "c:look-up-serial");
  assert.equal(groups[0].caseSpan, 2);
});

test("a step that occurs in only one case is not a repeat group", () => {
  const a1 = mk("a1", "caseA", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const b1 = mk("b1", "caseB", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const aOnly = mk("a2", "caseA", [["invoked", "Button", "one-off-export"]]);
  const { steps, interactionsById } = merge(a1, b1, aOnly);
  const { groups } = alignSteps(steps, interactionsById);
  // only the txtsr+submit group spans both cases; the one-off does not
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].members.some((m) => m.stepId === "a2"));
});

test("hidden steps are excluded", () => {
  const a = mk("a1", "caseA", [["value_changed", "Edit", "txtsr"]]);
  const b = mk("b1", "caseB", [["value_changed", "Edit", "txtsr"]], { state: "hidden" });
  const { steps, interactionsById } = merge(a, b);
  const { groups } = alignSteps(steps, interactionsById);
  assert.equal(groups.length, 0); // b1 hidden -> txtsr group spans only caseA
});

test("groupForStep returns the repeat group for a member step", () => {
  const a = mk("a1", "caseA", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const b = mk("b1", "caseB", [["value_changed", "Edit", "txtsr"], ["invoked", "Button", "submit"]]);
  const { steps, interactionsById } = merge(a, b);
  const g = groupForStep("a1", steps, interactionsById);
  assert.ok(g);
  assert.equal(g.caseSpan, 2);
  const g2 = groupForStep("nonexistent", steps, interactionsById);
  assert.equal(g2, null);
});
