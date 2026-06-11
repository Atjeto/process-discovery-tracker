/*
 * Unit tests for the phase-membership coherence helpers in
 * views/steps-view.js (CR M-1..M-3).
 *
 * Phase membership is stored TWICE -- on phase.step_ids AND on
 * step.phase_id. These pure helpers are the single point that keeps the
 * pair consistent across delete / split / merge. The step CRUD itself is
 * DOM- and State-bound (not unit-testable headless), so we test the pure
 * membership logic the CRUD now delegates to.
 *
 * steps-view.js transitively loads DOM-touching modules at require time
 * (command-palette.js / theme.js bind document-level listeners). We stub
 * a permissive `document`/`window` via Proxy so the module loads under
 * plain node; the helpers under test touch neither.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// --- Permissive DOM stub so steps-view.js can be required headless. ---
function makeEl() {
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === "style" || p === "dataset") return {};
      if (p === "children" || p === "childNodes") return [];
      return makeEl();
    },
    apply() { return makeEl(); },
    set() { return true; },
  });
}
if (typeof global.document === "undefined") {
  global.document = new Proxy({}, {
    get(_t, p) {
      if (p === "querySelectorAll") return () => [];
      if (p === "createElement" || p === "getElementById" || p === "querySelector") return () => makeEl();
      if (p === "body" || p === "documentElement" || p === "head") return makeEl();
      if (p === "addEventListener" || p === "removeEventListener") return () => {};
      return () => makeEl();
    },
  });
}
if (typeof global.window === "undefined") {
  global.window = new Proxy({}, { get() { return () => {}; } });
}

const SV = require("./views/steps-view.js");

function step(id, phaseId) {
  return { step_id: id, phase_id: phaseId === undefined ? null : phaseId };
}
function phase(id, stepIds) {
  return { phase_id: id, step_ids: stepIds.slice() };
}

/* ===== detachStepsFromPhases (M-1: delete) ===== */

test("detachStepsFromPhases removes the id from step_ids and clears phase_id", () => {
  const anno = {
    steps: [step("s1", "p1"), step("s2", "p1")],
    phases: [phase("p1", ["s1", "s2"])],
  };
  // s1 was just deleted from anno.steps in the caller; detach its id.
  anno.steps = anno.steps.filter(s => s.step_id !== "s1");
  SV.detachStepsFromPhases(anno, new Set(["s1"]));
  assert.deepEqual(anno.phases[0].step_ids, ["s2"], "dangling id pruned");
});

test("detachStepsFromPhases clears phase_id on a still-present detached step", () => {
  const anno = {
    steps: [step("s1", "p1")],
    phases: [phase("p1", ["s1"])],
  };
  SV.detachStepsFromPhases(anno, new Set(["s1"]));
  assert.equal(anno.steps[0].phase_id, null);
  assert.deepEqual(anno.phases[0].step_ids, []);
});

test("detachStepsFromPhases handles a bulk set across phases", () => {
  const anno = {
    steps: [step("s1", "p1"), step("s2", "p2"), step("s3", "p1")],
    phases: [phase("p1", ["s1", "s3"]), phase("p2", ["s2"])],
  };
  SV.detachStepsFromPhases(anno, new Set(["s1", "s2"]));
  assert.deepEqual(anno.phases[0].step_ids, ["s3"]);
  assert.deepEqual(anno.phases[1].step_ids, []);
  assert.equal(anno.steps[0].phase_id, null);
  assert.equal(anno.steps[1].phase_id, null);
  assert.equal(anno.steps[2].phase_id, "p1");
});

test("detachStepsFromPhases is a no-op on an empty set", () => {
  const anno = { steps: [step("s1", "p1")], phases: [phase("p1", ["s1"])] };
  SV.detachStepsFromPhases(anno, new Set());
  assert.deepEqual(anno.phases[0].step_ids, ["s1"]);
  assert.equal(anno.steps[0].phase_id, "p1");
});

/* ===== ensureStepInPhase (M-2: split / add-at-playhead) ===== */

test("ensureStepInPhase adds the new half (which inherited phase_id) to step_ids", () => {
  const anno = {
    steps: [step("first", "p1"), step("second", "p1")],
    phases: [phase("p1", ["first"])], // the split copied phase_id onto `second`
  };
  SV.ensureStepInPhase(anno, anno.steps[1]);
  assert.deepEqual(anno.phases[0].step_ids, ["first", "second"]);
});

test("ensureStepInPhase is a no-op when the step has no phase_id", () => {
  const anno = { steps: [step("free", null)], phases: [phase("p1", [])] };
  SV.ensureStepInPhase(anno, anno.steps[0]);
  assert.deepEqual(anno.phases[0].step_ids, []);
});

test("ensureStepInPhase does not duplicate an already-listed id", () => {
  const anno = { steps: [step("s1", "p1")], phases: [phase("p1", ["s1"])] };
  SV.ensureStepInPhase(anno, anno.steps[0]);
  assert.deepEqual(anno.phases[0].step_ids, ["s1"]);
});

test("ensureStepInPhase clears phase_id pointing at a missing phase", () => {
  const anno = { steps: [step("s1", "gone")], phases: [phase("p1", [])] };
  SV.ensureStepInPhase(anno, anno.steps[0]);
  assert.equal(anno.steps[0].phase_id, null);
  assert.deepEqual(anno.phases[0].step_ids, []);
});

/* ===== substituteSurvivorInPhases (M-3: merge) ===== */

test("substituteSurvivorInPhases substitutes the survivor and drops the consumed id", () => {
  // Merge s1 + s2 -> survivor keeps s1's id; both lived in p1.
  const anno = {
    steps: [step("s1", "p1")], // s2 already filtered out; survivor == s1
    phases: [phase("p1", ["s1", "s2"])],
  };
  SV.substituteSurvivorInPhases(anno, new Set(["s1", "s2"]), "s1");
  assert.deepEqual(anno.phases[0].step_ids, ["s1"], "consumed id dropped, survivor kept once");
  assert.equal(anno.steps[0].phase_id, "p1");
});

test("substituteSurvivorInPhases keeps a step in a phase even when only the OTHER half was in it", () => {
  // M-3 regression: s1 had no phase, s2 was in p1; merging must not drop
  // the membership -- the survivor inherits p1.
  const anno = {
    steps: [step("s1", null)], // survivor (kept s1's identity)
    phases: [phase("p1", ["s2"])],
  };
  SV.substituteSurvivorInPhases(anno, new Set(["s1", "s2"]), "s1");
  assert.deepEqual(anno.phases[0].step_ids, ["s1"]);
  assert.equal(anno.steps[0].phase_id, "p1", "survivor inherits the consumed half's phase");
});

test("substituteSurvivorInPhases lands the survivor in the earliest phase when halves span phases", () => {
  const anno = {
    steps: [step("s1", "p1")],
    phases: [phase("p1", ["s1"]), phase("p2", ["s2"])],
  };
  SV.substituteSurvivorInPhases(anno, new Set(["s1", "s2"]), "s1");
  assert.deepEqual(anno.phases[0].step_ids, ["s1"]);
  assert.deepEqual(anno.phases[1].step_ids, [], "s2 removed from p2");
  assert.equal(anno.steps[0].phase_id, "p1");
});

test("substituteSurvivorInPhases clears phase_id when no consumed id was in any phase", () => {
  const anno = {
    steps: [step("s1", null)],
    phases: [phase("p1", ["other"])],
  };
  SV.substituteSurvivorInPhases(anno, new Set(["s1", "s2"]), "s1");
  assert.deepEqual(anno.phases[0].step_ids, ["other"]);
  assert.equal(anno.steps[0].phase_id, null);
});

// --- G-4: split/merge name hygiene (owner's real-session findings) ---------

test("stripSplitSuffix removes single and stacked (split N) artifacts", () => {
  assert.equal(SV.stripSplitSuffix("Fill form (split 1)"), "Fill form");
  assert.equal(SV.stripSplitSuffix("Fill form (split 1) (split 1)"), "Fill form");
  assert.equal(SV.stripSplitSuffix("Fill form (split 2) + Other"), "Fill form + Other");
  assert.equal(SV.stripSplitSuffix("No artifact"), "No artifact");
});

test("mergeStepObjects dedupes split halves into one clean name", () => {
  const mk = (id, name) => ({
    step_id: id, name,
    time_range: { start: "2026-05-14T09:00:00Z", end: "2026-05-14T09:01:00Z" },
    evidence: { interaction_event_ids: [id + "-e"], screenshot_refs: [] },
    state: "edited",
  });
  const merged = SV.mergeStepObjects([
    mk("a", "Fill 8 fields (split 1) (split 1)"),
    mk("b", "Fill 8 fields (split 2)"),
  ]);
  assert.equal(merged.name, "Fill 8 fields");
  const merged2 = SV.mergeStepObjects([mk("a", "A (split 1)"), mk("b", "B")]);
  assert.equal(merged2.name, "A + B");
});

test("mergeStepObjects caps a runaway merged name", () => {
  const long = "X".repeat(100);
  const mk = (id, name) => ({
    step_id: id, name,
    time_range: { start: "t1", end: "t2" },
    evidence: { interaction_event_ids: [], screenshot_refs: [] },
  });
  const merged = SV.mergeStepObjects([mk("a", long + "1"), mk("b", long + "2")]);
  assert.ok(merged.name.length <= 120, "merged name capped at ~120 chars");
});
