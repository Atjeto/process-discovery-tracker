"use strict";
/*
 * The viewer half of shared/steps-signature-golden.json, and the rule the
 * Overview follows as it opens (rows-freshness.js; lane CC). The pipeline half
 * is normalization/test/test_steps_signature.py.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Fresh = require("./rows-freshness.js");

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "steps-signature-golden.json"), "utf-8"));

test("the golden: every case has its signature in the viewer too, and what the rows do not read changes nothing", () => {
  assert.equal(GOLDEN.version, 1);
  for (const c of GOLDEN.cases) {
    assert.equal(Fresh.stepsSignature(c.annotations), c.signature, c.name);
    if (c.same_as) assert.equal(c.signature, GOLDEN.cases.find((o) => o.name === c.same_as).signature, c.name);
  }
  const byName = Object.fromEntries(GOLDEN.cases.map((c) => [c.name, c.signature]));
  assert.notEqual(byName["a rename changes it"], byName["a project"]);
});

test("the text is the one json.dumps writes: whole numbers, no spaces, a lone surrogate escaped", () => {
  const text = Fresh.signatureText({ pattern_run: { case_id: "c" }, steps: [
    { step_id: "a", name: "x\ud800y", order: 2, state: "confirmed" }] });
  assert.equal(text, '["c",[["a",null,"x\\ud800y","confirmed",null,null,2,null,null,null,null,null]]]');
});

/* A session whose analysis measured `measured` while `steps` are on screen. */
function sess(measured, steps, extra) {
  const analysis = Object.assign({ format: 3, pdd_data: { rows: [] }, pdd_time: {},
    steps_signature: Fresh.stepsSignature({ steps: measured }) }, (extra && extra.analysis) || {});
  return Object.assign({ sessionFolder: "P", analysis, annotations: { steps } }, (extra && extra.sess) || {});
}
const STEPS = [{ step_id: "s1", case_id: "c1", name: "Look up the customer", state: "confirmed",
  time_range: { start: "2026-05-14T09:00:19Z", end: "2026-05-14T09:00:31Z" } }];
const RENAMED = [Object.assign({}, STEPS[0], { name: "Find the customer" })];

test("rowsAge: current for the steps measured, older after a rename, none without rows to judge", () => {
  assert.equal(Fresh.rowsAge(sess(STEPS, STEPS)), "current");
  assert.equal(Fresh.rowsAge(sess(STEPS, RENAMED)), "older");
  // The document typed in is not a step: the rows stay current.
  const typed = sess(STEPS, STEPS);
  typed.annotations.document = { trigger: "An order e-mail arrives" };
  assert.equal(Fresh.rowsAge(typed), "current");
  // An analysis from before the signature: older, so the Overview measures once.
  assert.equal(Fresh.rowsAge(sess(STEPS, STEPS, { analysis: { steps_signature: undefined } })), "older");
  assert.equal(Fresh.rowsAge(null), null);
  assert.equal(Fresh.rowsAge({ sessionFolder: "P", annotations: { steps: STEPS } }), null, "not analyzed yet");
  const before = sess(STEPS, RENAMED);
  delete before.analysis.pdd_data;
  delete before.analysis.pdd_time;
  assert.equal(Fresh.rowsAge(before), null, "an analysis from before the rows is analyzed again as the project opens");
  assert.equal(Fresh.rowsAge(sess(STEPS, RENAMED, { sess: { annotationsError: { message: "x" } } })), null);
});

test("refreshNeed: once per change of the steps, never while an analysis runs or the analyst types", () => {
  const older = sess(STEPS, RENAMED);
  const want = Fresh.stepsSignature({ steps: RENAMED });
  assert.equal(Fresh.refreshNeed(older, {}), want);
  assert.equal(Fresh.refreshNeed(older, { busy: true }), null, "an analysis is queued or running");
  assert.equal(Fresh.refreshNeed(older, { typing: true }), null, "the analyst types in a text field of the Overview");
  assert.equal(Fresh.refreshNeed(older, { tried: "P|" + want }), null, "these steps were refreshed for once");
  assert.equal(Fresh.refreshNeed(older, { tried: "P|" + Fresh.stepsSignature({ steps: STEPS }) }), want,
    "a refresh for other steps does not count");
  assert.equal(Fresh.refreshNeed(older, { tried: "Q|" + want }), want, "nor one of another project");
  assert.equal(Fresh.refreshNeed(sess(STEPS, STEPS), {}), null, "the rows are current");
  assert.equal(Fresh.refreshNeed(Object.assign(older, { sessionFolder: "" }), {}), null);
});

test("freshnessLine: nothing while current, the refreshing line while an analysis measures, else the older line", () => {
  assert.equal(Fresh.freshnessLine("current", true), "");
  assert.equal(Fresh.freshnessLine(null, true), "");
  assert.equal(Fresh.freshnessLine("older", true), "From the last analysis; refreshing");
  assert.equal(Fresh.freshnessLine("older", false), "From the last analysis; the steps changed since.");
});
