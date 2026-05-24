"use strict";

/*
 * Unit tests for step-alignment.js -- intra-session repetition alignment.
 * Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { stepSignature, alignSteps, groupForStep, alignCases, alignCaseSequences, representativeCuration } = require("./step-alignment.js");

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

// --- Ordered sequence alignment (ADR-0015 phase 1) -------------------------

/** A step with a controllable token (process_label) + a time for ordering. */
function seqStep(stepId, caseId, label, startMs, opts = {}) {
  return {
    step_id: stepId, case_id: caseId,
    process_label: opts.usePlain ? undefined : label,   // else stepToken strips name
    name: opts.name || label,
    state: opts.state || "edited",
    time_range: { start: new Date(startMs).toISOString() },
  };
}

test("alignCases: identical cases -> backbone hit by every case", () => {
  const steps = [
    seqStep("a1", "cA", "Search", 1000), seqStep("a2", "cA", "Resolve", 2000),
    seqStep("b1", "cB", "Search", 1000), seqStep("b2", "cB", "Resolve", 2000),
    seqStep("c1", "cC", "Search", 1000), seqStep("c2", "cC", "Resolve", 2000),
  ];
  const r = alignCases(steps);
  assert.equal(r.caseCount, 3);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Resolve"]);
  assert.deepEqual(r.backbone.map((b) => b.frequency), [3, 3]);
  assert.equal(r.exceptions.length, 0);
  assert.deepEqual(r.backbone[0].members.map((m) => m.caseId).sort(), ["cA", "cB", "cC"]);
});

test("alignCases: an exception ticket's extra step is a gap, not a backbone node", () => {
  const steps = [
    seqStep("a1", "cA", "Search", 1000), seqStep("a2", "cA", "Resolve", 2000),
    seqStep("b1", "cB", "Search", 1000), seqStep("b2", "cB", "Resolve", 2000),
    // cC detours mid-ticket
    seqStep("c1", "cC", "Search", 1000), seqStep("c2", "cC", "Detour", 1500), seqStep("c3", "cC", "Resolve", 2000),
  ];
  const r = alignCases(steps);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Resolve"]);
  assert.deepEqual(r.backbone.map((b) => b.frequency), [3, 3]);   // all 3 still hit Search + Resolve
  assert.deepEqual(r.exceptions, [{ caseId: "cC", stepId: "c2", token: "Detour" }]);
});

test("alignCases: a step missing in one case lowers that position's frequency", () => {
  const steps = [];
  for (const c of ["cA", "cB", "cC"]) {
    steps.push(seqStep(c + "1", c, "Search", 1000), seqStep(c + "2", c, "Validate", 2000), seqStep(c + "3", c, "Resolve", 3000));
  }
  steps.push(seqStep("d1", "cD", "Search", 1000), seqStep("d2", "cD", "Resolve", 3000));   // cD skips Validate
  const r = alignCases(steps);
  assert.equal(r.caseCount, 4);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Validate", "Resolve"]);
  assert.deepEqual(r.backbone.map((b) => b.frequency), [4, 3, 4]);   // Validate hit by 3 of 4
  assert.equal(r.exceptions.length, 0);
});

test("alignCases: value-laden names align by their value-free process_label", () => {
  // No process_label set -> stepToken strips the name (Search — CUST-1 -> Search).
  const steps = [
    seqStep("a1", "cA", "Search — CUST-1", 1000, { usePlain: true, name: "Search — CUST-1" }),
    seqStep("a2", "cA", "Resolve", 2000, { usePlain: true, name: "Resolve" }),
    seqStep("b1", "cB", "Search — CUST-2", 1000, { usePlain: true, name: "Search — CUST-2" }),
    seqStep("b2", "cB", "Resolve", 2000, { usePlain: true, name: "Resolve" }),
  ];
  const r = alignCases(steps);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Resolve"]);
  assert.deepEqual(r.backbone.map((b) => b.frequency), [2, 2]);
});

test("alignCases: steps within a case are ordered by time before aligning", () => {
  // Given out of order; the backbone must still read Search -> Resolve.
  const steps = [
    seqStep("a2", "cA", "Resolve", 2000), seqStep("a1", "cA", "Search", 1000),
    seqStep("b1", "cB", "Search", 1000), seqStep("b2", "cB", "Resolve", 2000),
  ];
  const r = alignCases(steps);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Resolve"]);
});

test("alignCases: a substituted (divergent) step surfaces as an exception, never lost", () => {
  // cA + cB share Search -> Submit -> Resolve; cC substitutes Escalate for Submit.
  // NW aligns Escalate diagonally onto Submit (a mismatch), so it must be
  // recorded as an exception -- not silently dropped (the fuzzer's catch).
  const steps = [
    seqStep("a1", "cA", "Search", 1000), seqStep("a2", "cA", "Submit", 2000), seqStep("a3", "cA", "Resolve", 3000),
    seqStep("b1", "cB", "Search", 1000), seqStep("b2", "cB", "Submit", 2000), seqStep("b3", "cB", "Resolve", 3000),
    seqStep("c1", "cC", "Search", 1000), seqStep("c2", "cC", "Escalate", 2000), seqStep("c3", "cC", "Resolve", 3000),
  ];
  const r = alignCases(steps);
  assert.deepEqual(r.backbone.map((b) => b.token), ["Search", "Submit", "Resolve"]);
  assert.deepEqual(r.backbone.map((b) => b.frequency), [3, 2, 3]);   // cC did NOT hit Submit
  assert.deepEqual(r.exceptions, [{ caseId: "cC", stepId: "c2", token: "Escalate" }]);
});

test("alignCaseSequences: empty input is empty", () => {
  assert.deepEqual(alignCaseSequences([]), { caseCount: 0, backbone: [], exceptions: [] });
  assert.deepEqual(alignCaseSequences([{ caseId: "x", steps: [] }]), { caseCount: 0, backbone: [], exceptions: [] });
});

// --- representativeCuration (ADR-0015 phase 3 seed) ------------------------

test("representativeCuration: empty members -> no description, all flags false", () => {
  const r = representativeCuration([]);
  assert.equal(r.description, "");
  assert.deepEqual(r.flags, { conditional: false, exception_path: false, waste: false, automation_candidate: false });
});

test("representativeCuration: a flag set on a strict majority is seeded on", () => {
  const members = [
    { description: "", flags: { waste: true } },
    { description: "look up the serial", flags: { waste: true } },
    { description: "", flags: { waste: false, automation_candidate: true } },
  ];
  const r = representativeCuration(members);
  assert.equal(r.flags.waste, true);                 // 2 of 3 -> majority
  assert.equal(r.flags.automation_candidate, false); // 1 of 3 -> not majority
  assert.equal(r.description, "look up the serial");  // first non-empty
});

test("representativeCuration: an exactly-half flag is NOT seeded (strict majority)", () => {
  const members = [{ flags: { waste: true } }, { flags: { waste: false } }];
  assert.equal(representativeCuration(members).flags.waste, false);
});

test("representativeCuration: ignores null members", () => {
  const r = representativeCuration([null, { flags: { conditional: true } }, undefined]);
  assert.equal(r.flags.conditional, true);   // 1 of 1 real member
});
