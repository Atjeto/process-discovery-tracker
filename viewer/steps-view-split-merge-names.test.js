/*
 * Unit tests for the pure split/merge name helpers in views/steps-view.js
 * (G-4 label hygiene). The step CRUD itself is DOM- and State-bound (not
 * unit-testable headless), so we test the pure logic it delegates to.
 *
 * steps-view.js transitively loads DOM-touching modules at require time
 * (theme.js reads document.documentElement). We stub
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

// --- Lane FX2 (validation pass 3, F5): steps the analyst added stay added ---

test("lane FX2: a merge of steps the analyst added is an added step (it keeps Delete and its hand marker); any other merge is edited", () => {
  const mk = (id, state, extra) => Object.assign({
    step_id: id, name: "Step " + id, state, time_range: null, order: 1,
    evidence: { interaction_event_ids: [], screenshot_refs: [] },
  }, extra || {});
  assert.equal(SV.mergeStepObjects([mk("a", "manually_authored"), mk("b", "manually_authored")]).state, "manually_authored");
  assert.equal(SV.mergeStepObjects([mk("a", "manually_authored"), mk("b", "auto_suggested", { draft_key: "k" })]).state, "edited");
  assert.equal(SV.mergeStepObjects([mk("a", "edited"), mk("b", "confirmed")]).state, "edited");
});

test("lane FX2: derivedState, the rule Split, Merge and + Step follow", () => {
  const AC = require("./analyst-content.js");
  assert.equal(AC.derivedState({ state: "manually_authored" }), "manually_authored", "a split half of an added step");
  assert.equal(AC.derivedState([{ state: "manually_authored" }, { state: "manually_authored" }]), "manually_authored");
  assert.equal(AC.derivedState([{ state: "manually_authored" }, { state: "confirmed" }]), "edited");
  assert.equal(AC.derivedState({ state: "auto_suggested" }), "edited");
  assert.equal(AC.derivedState([]), "edited");
});
