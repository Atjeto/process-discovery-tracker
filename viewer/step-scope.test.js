"use strict";

/* step-scope.js (contract C25): what the automation does with a step and who
   does it, the rules the step editor saves and reads by; the pipeline's
   step_context.py reads the same keys the same way (test_step_scope.py). */

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./step-scope.js");

test("the four choices, in the editor's order and in C25's words", () => {
  assert.deepEqual(S.CHOICES.map((c) => [c.value, c.label]), [
    ["undecided", "Not decided yet"], ["automated", "The automation does it"],
    ["person", "Stays with a person"], ["not_needed", "No longer needed"]]);
});

test("a step reads as its choice: absent, each value, an older waste flag, an unknown value", () => {
  assert.equal(S.automationOf({}), "undecided");
  assert.equal(S.automationOf(null), "undecided");
  for (const c of S.CHOICES) assert.equal(S.automationOf({ automation: c.value }), c.value);
  assert.equal(S.automationOf({ flags: { waste: true } }), "not_needed", "flags.waste without a choice");
  assert.equal(S.automationOf({ flags: { waste: false } }), "undecided");
  assert.equal(S.automationOf({ automation: "automated", flags: { waste: true } }), "automated", "a choice wins");
  assert.equal(S.automationOf({ automation: "robot" }), "undecided", "an unknown value");
  assert.equal(S.automationOf({ automation: "robot", flags: { waste: true } }), "undecided");
  assert.equal(S.labelOf("person"), "Stays with a person");
  assert.equal(S.labelOf("robot"), "Not decided yet");
});

test("a choice keeps flags.waste in step: No longer needed sets it, any other clears it", () => {
  const st = { flags: { waste: false } };
  assert.equal(S.setAutomation(st, "not_needed"), true);
  assert.deepEqual([st.automation, st.flags.waste], ["not_needed", true]);
  assert.equal(S.setAutomation(st, "automated"), true);
  assert.deepEqual([st.automation, st.flags.waste], ["automated", false]);
  assert.equal(S.setAutomation(st, "undecided"), true);
  assert.equal("automation" in st, false, "Not decided yet takes the key away");
  assert.equal(st.flags.waste, false);
  assert.equal(S.setAutomation(st, "undecided"), false, "no change");
  assert.equal(S.setAutomation(st, "robot"), false, "no such choice");
  const old = { flags: { waste: true } };
  assert.equal(S.setAutomation(old, "person"), true);
  assert.deepEqual([old.automation, old.flags.waste], ["person", false]);
  const bare = {};
  assert.equal(S.setAutomation(bare, "not_needed"), true);
  assert.deepEqual(bare.flags, { waste: true });
});

test("who does a step: its own Done by (one line, at most 80 characters), else the recording's role, else nobody", () => {
  const manifest = { config: { worker: { id: "mk", role: "sales  assistant " } } };
  assert.equal(S.recordingRole(manifest), "Sales assistant");
  assert.equal(S.recordingRole({ config: { worker: { id: "mk" } } }), "");
  assert.equal(S.recordingRole(null), "");
  assert.equal(S.doneByOf({ done_by: " Finance\n clerk " }, manifest), "Finance clerk");
  assert.equal(S.doneByOf({ done_by: "  " }, manifest), "Sales assistant");
  assert.equal(S.doneByOf({}, {}), "");
  assert.equal(S.cleanDoneBy("x".repeat(120)).length, S.DONE_BY_MAX);
  assert.equal(S.doneByPlaceholder(manifest), "Sales assistant");
  assert.equal(S.doneByPlaceholder({}), "A role or a person");
});

test("Done by is kept cleaned, and emptied the key goes (the role comes back)", () => {
  const st = {};
  assert.equal(S.setDoneBy(st, "  Warehouse   clerk "), true);
  assert.equal(st.done_by, "Warehouse clerk");
  assert.equal(S.setDoneBy(st, "Warehouse clerk"), false, "no change");
  assert.equal(S.setDoneBy(st, "   "), true);
  assert.equal("done_by" in st, false);
  assert.equal(S.setDoneBy(st, ""), false);
  assert.equal(S.setDoneBy(null, "x"), false);
});
