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
const { buildNormalizeArgs, transcriptImportResult } = require("./python-runner.js");

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

test("buildNormalizeArgs passes the sub-processes' map pictures as --pdd-map-images (contract C19), beside the main map's", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", pddMapImage: "m.png", pddMapImages: "D/maps.json" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--pdd-map-image", "m.png", "--pdd-map-images", "D/maps.json"]);
  assert.ok(!buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx" }).includes("--pdd-map-images"),
    "no manifest, no flag");
});

/* Contract C8: what the viewer makes of one transcript_import.py run. */
test("transcriptImportResult: exit 0 is a success carrying the summary line", () => {
  assert.deepEqual(
    transcriptImportResult({ code: 0, stdout: "[transcript] imported m.vtt: 3 segments\r\n", stderr: "" }),
    { ok: true, summary: "[transcript] imported m.vtt: 3 segments" });
});

test("transcriptImportResult: exits 1, 2 and 3 carry the script's error line without its prefix", () => {
  for (const code of [1, 2, 3]) {
    const r = transcriptImportResult({ code, stdout: "",
      stderr: "[transcript] ERROR: D:/t/notes.vtt: no transcript entries found. Nothing was written.\n" });
    assert.deepEqual(r, { ok: false, code, error: "D:/t/notes.vtt: no transcript entries found. Nothing was written." });
  }
});

test("transcriptImportResult: a crash without the error line says so, with its last line", () => {
  const r = transcriptImportResult({ code: 1, stderr: "Traceback (most recent call last):\n  ...\nImportError: session_io\n" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "the transcript import stopped (exit 1): ImportError: session_io");
  assert.equal(transcriptImportResult({ code: null, stderr: "" }).error, "the transcript import stopped (no exit code)");
});
