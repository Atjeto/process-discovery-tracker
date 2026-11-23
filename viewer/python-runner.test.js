"use strict";
/*
 * The normalize.py command line the viewer builds (python-runner.js). Pins the
 * contract C21 pass-through: with the app's activity library the run gets
 * `--library <path>`, without one no --library at all, and never --names
 * (the remembered step names, C4, are gone). The end-to-end proof (a project
 * gets library.json after its first analysis) is e2e/library-smoke.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildNormalizeArgs, scriptTakesFlag, transcriptImportResult, pythonEnv } = require("./python-runner.js");

test("buildNormalizeArgs passes the app's library as --library", () => {
  assert.deepEqual(
    buildNormalizeArgs("normalize.py", { sessionFolder: "S", taxonomyPath: "t.yaml", mine: true, libraryPath: "L.json" }),
    ["normalize.py", "S", "--taxonomy", "t.yaml", "--mine", "--library", "L.json"]);
});

test("buildNormalizeArgs leaves --library out when there is no library, and never passes --names", () => {
  const args = buildNormalizeArgs("normalize.py", { sessionFolder: "S", libraryPath: null, namesPath: "N.json" });
  assert.deepEqual(args, ["normalize.py", "S"]);
  assert.ok(!args.includes("--library") && !args.includes("--names"));
});

test("buildNormalizeArgs keeps the export flags and adds --library last", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", pddMapImage: "m.png", pddTobeImage: "t.png", libraryPath: "L" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--pdd-map-image", "m.png", "--pdd-tobe-image", "t.png", "--library", "L"]);
});

test("scriptTakesFlag: a pipeline whose source defines --library takes it; one without it, or no script, does not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-runner-"));
  try {
    const withIt = path.join(dir, "with.py"), without = path.join(dir, "without.py");
    fs.writeFileSync(withIt, 'parser.add_argument("--library", type=str, default=None)\n');
    fs.writeFileSync(without, 'parser.add_argument("--names", type=str, default=None)\n');
    assert.equal(scriptTakesFlag(withIt, "--library"), true);
    assert.equal(scriptTakesFlag(without, "--library"), false);
    assert.equal(scriptTakesFlag(path.join(dir, "missing.py"), "--library"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildNormalizeArgs passes the sub-processes' map pictures as --pdd-map-images (contract C19), beside the main map's", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", pddMapImage: "m.png", pddMapImages: "D/maps.json" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--pdd-map-image", "m.png", "--pdd-map-images", "D/maps.json"]);
  assert.ok(!buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx" }).includes("--pdd-map-images"),
    "no manifest, no flag");
});

test("2.0.1: buildNormalizeArgs passes the PDD's attachments folder as --pdd-attachments, only with a PDD to write", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", pddAttachments: "Attachments" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--pdd-attachments", "Attachments"]);
  assert.deepEqual(buildNormalizeArgs("n.py", { sessionFolder: "S", pddAttachments: "Attachments" }), ["n.py", "S"]);
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

test("lane LP: Python runs with PYTHONUTF8, so its messages reach the viewer in UTF-8, at both spawns", () => {
  const before = process.env.PYTHONUTF8;
  const env = pythonEnv();
  assert.equal(env.PYTHONUTF8, "1");
  for (const key of Object.keys(process.env)) if (key !== "PYTHONUTF8") assert.equal(env[key], process.env[key], key);
  assert.equal(process.env.PYTHONUTF8, before, "the viewer's own environment is left as it was");
  const source = fs.readFileSync(path.join(__dirname, "python-runner.js"), "utf8");
  assert.equal((source.match(/spawn\(/g) || []).length, 2);
  assert.equal((source.match(/env: pythonEnv\(\)/g) || []).length, 2);
  assert.ok(!source.includes("env: process.env"));
});
