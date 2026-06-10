"use strict";

/*
 * Unit tests for the data-posture setting (lab-phase §C4). Runs headless
 * (no localStorage): the module's in-memory fallback carries the state.
 * Run with `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Posture = require("./posture.js");

test("defaults to reviewable", () => {
  assert.equal(Posture.DEFAULT_POSTURE, "reviewable");
  assert.equal(Posture.getDataPosture(), "reviewable");
  assert.equal(Posture.copyForLlmAllowed(), true);
});

test("sealed forbids the Copy-for-LLM surface; open/reviewable allow it", () => {
  Posture.setDataPosture("sealed");
  assert.equal(Posture.getDataPosture(), "sealed");
  assert.equal(Posture.copyForLlmAllowed(), false);
  Posture.setDataPosture("open");
  assert.equal(Posture.copyForLlmAllowed(), true);
  Posture.setDataPosture("reviewable");
  assert.equal(Posture.copyForLlmAllowed(), true);
});

test("unknown values are rejected, listeners fire on real changes only", () => {
  Posture.setDataPosture("reviewable");
  const seen = [];
  Posture.onPostureChange((v) => seen.push(v));
  Posture.setDataPosture("yolo");          // invalid → ignored
  assert.equal(Posture.getDataPosture(), "reviewable");
  Posture.setDataPosture("reviewable");    // no-op → no event
  Posture.setDataPosture("sealed");
  assert.deepEqual(seen, ["sealed"]);
  Posture.setDataPosture("reviewable");
  assert.deepEqual(seen, ["sealed", "reviewable"]);
});

test("every posture has a legend line", () => {
  for (const p of Posture.POSTURES) {
    assert.ok(Posture.POSTURE_LABELS[p] && Posture.POSTURE_LABELS[p].length > 10, p);
  }
});
