"use strict";

/* step-scope.js (contract C25 as amended 2026-11-13): whether a step is no
   longer needed and who does it, the rules the step editor saves and reads
   by; the pipeline's step_context.py reads the same keys the same way
   (test_step_scope.py). */

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./step-scope.js");

test("the tick's words and its tooltip: one sentence of 90 characters or fewer", () => {
  assert.equal(S.NOT_NEEDED_LABEL, "No longer needed");
  assert.equal(S.NOT_NEEDED_TITLE, "This step should not be needed: rework, duplicate effort or copying between systems.");
  assert.ok(S.NOT_NEEDED_TITLE.length <= 90);
  assert.equal(S.CHOICES, undefined, "no Automation choice");
  assert.equal(S.automationOf, undefined);
});

test("a step is no longer needed when its waste flag is set", () => {
  assert.equal(S.isNotNeeded({ flags: { waste: true } }), true);
  assert.equal(S.isNotNeeded({ flags: { waste: false } }), false);
  assert.equal(S.isNotNeeded({}), false);
  assert.equal(S.isNotNeeded(null), false);
  assert.equal(S.isNotNeeded({ flags: { waste: "yes" } }), false);
});

test("the choice a project saved on 2026-11-12 reads as ticked; the other choices are ignored", () => {
  assert.equal(S.isNotNeeded({ automation: "not_needed" }), true);
  assert.equal(S.isNotNeeded({ automation: "not_needed", flags: {} }), true);
  for (const v of ["automated", "person", "undecided", "robot", 3]) assert.equal(S.isNotNeeded({ automation: v }), false, String(v));
  assert.equal(S.isNotNeeded({ automation: "person", flags: { waste: true } }), true, "the flag decides");
  assert.equal(S.isNotNeeded({ automation: "not_needed", flags: { waste: false } }), false, "an untick holds");
});

test("the tick writes flags.waste only: never automation, which round-trips untouched", () => {
  const st = { flags: { waste: false } };
  assert.equal(S.setNotNeeded(st, true), true);
  assert.deepEqual(st, { flags: { waste: true } });
  assert.equal(S.setNotNeeded(st, true), false, "no change");
  assert.equal(S.setNotNeeded(st, false), true);
  assert.deepEqual(st, { flags: { waste: false } });
  const old = { automation: "not_needed" };
  assert.equal(S.setNotNeeded(old, false), true, "an old choice reads ticked, so an untick writes");
  assert.deepEqual(old, { automation: "not_needed", flags: { waste: false } });
  assert.equal(S.isNotNeeded(old), false);
  const kept = { automation: "person", flags: { waste: false, other: 1 } };
  assert.equal(S.setNotNeeded(kept, true), true);
  assert.deepEqual(kept, { automation: "person", flags: { waste: true, other: 1 } });
  assert.equal(S.setNotNeeded(null, true), false);
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
