"use strict";

const test = require("node:test");
const assert = require("node:assert");
const Rail = require("./next-act-rail.js");

/* A minimal "everything done" input: cases present, an analyst edit, a
   business-required judgment, all findings in the memo, zero unnamed controls.
   Individual tests knock one signal out to make an act unmet. */
function doneInput(overrides) {
  return Object.assign({
    hasCases: true,
    unnamedControls: 0,
    findingCount: 2,
    annotations: {
      steps: [{ step_id: "s1", manually_authored: true }],
      analysis_overrides: [{ process_label: "Search", bnva_ms: 20000 }],
      memo_selection: ["f1", "f2"],
    },
    analysis: {
      time_study: [{ name: "Search", instances: 4 }],
      findings: [{ id: "f1" }, { id: "f2" }],
    },
  }, overrides || {});
}

test("ACT_IDS is the five acts in the analyst's sequence", () => {
  assert.deepStrictEqual(Rail.ACT_IDS, ["name", "cases", "story", "judge", "memo"]);
});

test("all signals met -> no act is active", () => {
  const { acts, activeId } = Rail.buildRail(doneInput());
  assert.equal(activeId, null);
  assert.equal(acts.length, 5);
  assert.ok(acts.every((a) => !a.active));
  assert.ok(acts.every((a) => a.done));
});

test("exactly one act is highlighted (the first unmet in order)", () => {
  // Knock out cases (act 2) AND memo (act 5). Only act 2 highlights.
  const input = doneInput({ hasCases: false });
  input.annotations.memo_selection = [];
  const { acts, activeId } = Rail.buildRail(input);
  assert.equal(activeId, "cases");
  const active = acts.filter((a) => a.active);
  assert.equal(active.length, 1, "exactly one active act");
  assert.equal(active[0].id, "cases");
});

test("act 1 name: unmet when advisory unnamed controls > 0, count shown as ~N", () => {
  const { acts, activeId } = Rail.buildRail(doneInput({ unnamedControls: 7 }));
  assert.equal(activeId, "name");
  const name = acts.find((a) => a.id === "name");
  assert.equal(name.active, true);
  assert.equal(name.done, false);
  assert.match(name.sentence, /~7 controls/);
  assert.match(name.sentence, /estimated/i);   // labelled advisory
  assert.equal(name.button.target, "app-library");
});

test("act 1 name: singular grammar for exactly one unnamed control", () => {
  const name = Rail.buildRail(doneInput({ unnamedControls: 1 })).acts.find((a) => a.id === "name");
  assert.match(name.sentence, /~1 control\b/);
});

test("act 1 name: null count is pending, never highlights, falls through to a later unmet act", () => {
  // unnamed = null (still being counted) AND cases unmet -> cases highlights.
  const { acts, activeId } = Rail.buildRail(doneInput({ unnamedControls: null, hasCases: false }));
  assert.equal(activeId, "cases");
  const name = acts.find((a) => a.id === "name");
  assert.equal(name.active, false);
  assert.equal(name.done, false);
  assert.match(name.sentence, /Checking/);
});

test("act 2 cases: unmet uses the exact no-cases signal (hasCases false)", () => {
  const { acts, activeId } = Rail.buildRail(doneInput({ hasCases: false }));
  assert.equal(activeId, "cases");
  const cases = acts.find((a) => a.id === "cases");
  assert.equal(cases.done, false);
  assert.equal(cases.button.target, "markers");
});

test("act 2 cases: a waiting anchor candidate is announced (annotations)", () => {
  const input = doneInput({ hasCases: false });
  input.annotations.anchor_candidates = [{ signature: "x" }];
  const cases = Rail.buildRail(input).acts.find((a) => a.id === "cases");
  assert.match(cases.sentence, /waiting/i);
  assert.match(cases.button.label, /candidate/i);
});

test("act 2 cases: anchor candidate from analysis.json also counts", () => {
  const input = doneInput({ hasCases: false });
  input.analysis.anchor_candidates = [{ signature: "y" }];
  const cases = Rail.buildRail(input).acts.find((a) => a.id === "cases");
  assert.match(cases.sentence, /waiting/i);
});

test("act 3 story: unmet only when NO analyst edit exists anywhere", () => {
  const input = doneInput();
  // Strip every edit shape.
  input.annotations = { steps: [{ step_id: "s1" }] };
  const { activeId, acts } = Rail.buildRail(input);
  assert.equal(activeId, "story");
  assert.equal(acts.find((a) => a.id === "story").button.target, "flow");
});

test("act 3 story: a single group_annotation counts as touched", () => {
  const input = doneInput();
  input.annotations = { steps: [], group_annotations: [{ screen_key: "k", name: "X" }] };
  assert.equal(Rail.hasAnyAnalystEdit(input), true);
  const story = Rail.buildRail(input).acts.find((a) => a.id === "story");
  assert.equal(story.done, true);
});

test("act 3 story: a note counts as touched", () => {
  const input = { annotations: { notes: [{ text: "hi" }] } };
  assert.equal(Rail.hasAnyAnalystEdit(input), true);
});

test("act 4 judge: unmet when no bnva judgment AND time rows exist", () => {
  const input = doneInput();
  input.annotations.analysis_overrides = [];   // no judgment
  const { activeId, acts } = Rail.buildRail(input);
  assert.equal(activeId, "judge");
  assert.equal(acts.find((a) => a.id === "judge").button.target, "time-goes");
});

test("act 4 judge: NOT unmet when there are no time-goes rows", () => {
  const input = doneInput();
  input.annotations.analysis_overrides = [];
  input.analysis.time_study = [];
  const { activeId, acts } = Rail.buildRail(input);
  assert.equal(activeId, null, "no rows to judge -> act 4 is not an ask");
  assert.equal(acts.find((a) => a.id === "judge").done, true);
});

test("act 4 judge: an analysis_override without bnva_ms is not a judgment", () => {
  const input = doneInput();
  input.annotations.analysis_overrides = [{ segment_signature: "seg", automation_confirmed: true }];
  assert.equal(Rail.hasBusinessRequiredJudgment(input), false);
  assert.equal(Rail.buildRail(input).activeId, "judge");
});

test("act 5 memo: unmet when findings exist but none is selected", () => {
  const input = doneInput();
  input.annotations.memo_selection = [];
  const { activeId, acts } = Rail.buildRail(input);
  assert.equal(activeId, "memo");
  assert.equal(acts.find((a) => a.id === "memo").button.target, "findings");
});

test("act 5 memo: NOT an ask when there are no findings", () => {
  const input = doneInput();
  input.annotations.memo_selection = [];
  input.analysis.findings = [];
  input.findingCount = 0;
  const { activeId } = Rail.buildRail(input);
  assert.equal(activeId, null);
});

test("every act carries exactly one button with a symbolic target (never a URL)", () => {
  const { acts } = Rail.buildRail(doneInput({ hasCases: false }));
  for (const a of acts) {
    assert.ok(a.button && a.button.label && a.button.target, a.id + " has a button");
    assert.ok(!/https?:|\//.test(a.button.target), a.id + " target is symbolic, not a path");
  }
});

test("anchorCandidateCount takes the max of annotations and analysis", () => {
  assert.equal(Rail.anchorCandidateCount({
    annotations: { anchor_candidates: [1, 2] },
    analysis: { anchor_candidates: [1] },
  }), 2);
});
