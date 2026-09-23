"use strict";
/*
 * The normalize.py command line the viewer builds (python-runner.js). Pins the
 * contract C4 pass-through: with a remembered-names store the run gets
 * `--names <path>`, without one it gets no --names at all. The end-to-end
 * proof (a re-drafted step arrives with the remembered name) is
 * e2e/runs-smoke.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNormalizeArgs } = require("./python-runner.js");

test("buildNormalizeArgs passes the remembered-names store as --names", () => {
  assert.deepEqual(
    buildNormalizeArgs("normalize.py", { sessionFolder: "S", taxonomyPath: "t.yaml", mine: true, namesPath: "N.json" }),
    ["normalize.py", "S", "--taxonomy", "t.yaml", "--mine", "--names", "N.json"]);
});

test("buildNormalizeArgs leaves --names out when there is no store", () => {
  const args = buildNormalizeArgs("normalize.py", { sessionFolder: "S", namesPath: null });
  assert.deepEqual(args, ["normalize.py", "S"]);
  assert.ok(!args.includes("--names"));
});

test("buildNormalizeArgs keeps the export flags and adds --names last", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", pddMapImage: "m.png", pddTobeImage: "t.png", namesPath: "N" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--pdd-map-image", "m.png", "--pdd-tobe-image", "t.png", "--names", "N"]);
});
