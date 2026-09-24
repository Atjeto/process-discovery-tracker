/*
 * Unit tests for run-differences.js: the differences review's algorithm, the
 * viewer half of the one normalization/pdd_export.py writes into the PDD's
 * section 6.1.
 *
 * The seam guard is shared/run-differences-golden.json: this file and
 * normalization/test/test_run_differences_golden.py assert the same cases
 * (the alignment keys after folding, and the difference lines), so the Steps
 * level and the PDD cannot drift apart without one of the two going red.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const RD = require("./run-differences.js");

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "run-differences-golden.json"), "utf-8"));

/* ---- the shared golden -------------------------------------------------------- */

test("golden: the fixture covers every kind of difference and every kind of key", () => {
  assert.equal(GOLDEN.version, 1);
  assert.ok(GOLDEN.cases.length >= 4 && GOLDEN.cases.length <= 6, "4 to 6 cases");
  const lines = GOLDEN.cases.flatMap((c) => c.expected);
  const keys = GOLDEN.cases.flatMap((c) => c.run_keys);
  for (const prefix of ["Extra step: ", "Skipped: ", "Different order: "]) {
    assert.ok(lines.some((l) => l.startsWith(prefix)), "a case expects a line starting " + JSON.stringify(prefix));
  }
  for (const prefix of ["draft:", "merge:", "label:"]) {
    assert.ok(keys.some((k) => k.startsWith(prefix)), "a case expects a key starting " + JSON.stringify(prefix));
  }
  assert.ok(GOLDEN.cases.some((c) => c.expected.length === 0), "a case expects no differences");
});

for (const c of GOLDEN.cases) {
  test("golden: " + c.name, () => {
    assert.deepEqual(RD.collapseToReference(c.pattern, c.run).map(RD.alignKey), c.run_keys, "alignment keys after folding");
    assert.deepEqual(RD.differences(c.pattern, c.run).map((d) => d.text), c.expected, "difference lines");
  });
}

/* ---- the key rule ---------------------------------------------------------------- */

test("alignKey: a draft_key wins, then draft_keys, then the label of the name", () => {
  assert.equal(RD.alignKey({ draft_key: "a|s|c", draft_keys: ["x", "y"], name: "N" }), "draft:a|s|c");
  assert.equal(RD.alignKey({ draft_keys: ["x|1", "y|2"], name: "N" }), 'merge:["x|1","y|2"]');
  assert.equal(RD.alignKey({ draft_keys: ["x", ""], name: "Look up" }), "label:Look up", "a malformed list is no identity");
  assert.equal(RD.alignKey({ draft_keys: [], name: "Look up" }), "label:Look up");
  assert.equal(RD.alignKey({ name: "Order form: Enter 7 in Quantity" }), "label:Order form: Enter Quantity");
  assert.equal(RD.alignKey({}), "label:");
});

test("stepKeys: a draft's key, a merge's keys, none for a step without draft identity", () => {
  assert.deepEqual(RD.stepKeys({ draft_key: "a" }), ["a"]);
  assert.deepEqual(RD.stepKeys({ draft_keys: ["a", "b"] }), ["a", "b"]);
  assert.equal(RD.stepKeys({ name: "Added" }), null);
  assert.equal(RD.stepKeys(null), null);
});

/* ---- folding -------------------------------------------------------------------------- */

const P = (name, extra) => Object.assign({ name }, extra);

test("fold: a run's own merge of the first keys plus the next draft spells a merged step of three (flattened)", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Check, create, print", { draft_keys: ["c", "k", "p"] })];
  const run = [P("Find", { draft_key: "f" }), P("Check + Create", { draft_keys: ["c", "k"] }), P("Print", { draft_key: "p" })];
  const units = RD.collapseToReference(ref, run);
  assert.deepEqual(units.map(RD.alignKey), ["draft:f", 'merge:["c","k","p"]']);
  assert.equal(units[1].name, "Check, create, print", "the unit reads as the reference step");
  assert.deepEqual(RD.differences(ref, run), []);
});

test("fold: where two merged steps match at one position the one with more keys wins; among equals the first", () => {
  const two = P("Two", { draft_keys: ["a", "b"] });
  const three = P("Three", { draft_keys: ["a", "b", "c"] });
  const twin = P("Twin", { draft_keys: ["a", "b"] });
  const run = [P("A", { draft_key: "a" }), P("B", { draft_key: "b" }), P("C", { draft_key: "c" })];
  assert.deepEqual(RD.collapseToReference([two, three], run).map((u) => u.name), ["Three"]);
  assert.deepEqual(RD.collapseToReference([twin, two], run.slice(0, 2)).map((u) => u.name), ["Twin"]);
});

test("fold: one step is never folded, a step with no draft identity breaks a stretch, other steps stay as they are", () => {
  const ref = [P("Merged", { draft_keys: ["a", "b"] })];
  const own = P("Own merge", { draft_keys: ["a", "b"] });
  assert.equal(RD.collapseToReference(ref, [own])[0], own, "a single step keeps its own name");
  const broken = [P("A", { draft_key: "a" }), P("Added"), P("B", { draft_key: "b" })];
  assert.deepEqual(RD.collapseToReference(ref, broken), broken);
  assert.deepEqual(RD.collapseToReference([], broken), broken);
  const partial = [P("A", { draft_key: "a" })];
  assert.deepEqual(RD.collapseToReference(ref, partial), partial, "a stretch that stops short is not folded");
});

test("fold: without the fold, the two drafts would read as extra steps and the merge as skipped (the control)", () => {
  const ref = [P("Merged", { draft_keys: ["a", "b"] })];
  const run = [P("A", { draft_key: "a" }), P("B", { draft_key: "b" })];
  assert.deepEqual(RD.differences(ref, run), [], "folded: no difference");
  // What the same lists give when the run is aligned step by step.
  const unfolded = RD.firstOccurrences(run).map((x) => x.key);
  assert.deepEqual(unfolded, ["draft:a", "draft:b"]);
  assert.ok(!unfolded.includes(RD.alignKey(ref[0])));
});

/* ---- the lines ----------------------------------------------------------------------- */

test("differences: the Steps level's words (AD-29) name a run a transaction; the defaults stay the PDD's", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" }), P("Send", { draft_key: "e" })];
  const run = [P("Log", { draft_key: "l" }), P("Save", { draft_key: "s" }), P("Find", { draft_key: "f" })];
  const words = { reference: RD.REFERENCE_RUN, unit: RD.RUN_UNIT };
  assert.deepEqual(RD.differences(ref, run, words).map((x) => x.text), [
    "Extra step: Log (at the start of the transaction).",
    "Different order: Find (in this transaction after Save).",
    "Skipped: Send (step 3 of the reference transaction).",
  ]);
  assert.deepEqual(RD.differences(ref, run).map((x) => x.text), [
    "Extra step: Log (at the start of the run).",
    "Different order: Find (in this run after Save).",
    "Skipped: Send (step 3 of the pattern run).",
  ], "without the words: the shared golden's and the PDD's lines");
});

test("differences: a step repeated within a run counts once; an empty run skips every step", () => {
  const ref = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" })];
  const run = [P("Find", { draft_key: "f" }), P("Save", { draft_key: "s" }), P("Find again", { draft_key: "f" })];
  assert.deepEqual(RD.differences(ref, run), []);
  assert.deepEqual(RD.differences(ref, []).map((d) => d.text),
    ["Skipped: Find (step 1 of the pattern run).", "Skipped: Save (step 2 of the pattern run)."]);
  assert.deepEqual(RD.differences([], [P("  ")]).map((d) => d.text), ["Extra step: (unnamed step) (at the start of the run)."]);
});
