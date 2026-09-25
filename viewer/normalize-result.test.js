"use strict";
/*
 * Contract C13 on the viewer side (RP-04, RP-09): how a finished normalize.py
 * run is reported to the analyst, and when a PDD export may be offered.
 *
 * The runner results are fakes shaped exactly like what python-runner.js
 * rejects with (exitCode + full stderr), so the mapping is tested without
 * spawning Python. The stderr samples mix progress lines with the one
 * "[normalize] ERROR:" line, as the pipeline prints them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./normalize-result.js");

function runnerError(exitCode, stderr) {
  const e = new Error("normalize.py exited " + exitCode);
  e.exitCode = exitCode;
  e.stderr = stderr;
  return e;
}

const UNREADABLE_LINE = "[normalize] ERROR: C:\\s\\annotations.json exists but cannot be read " +
  "(JSONDecodeError: Expecting value: line 1 column 1 (char 0)). Nothing was written. The viewer keeps " +
  "the previous versions next to it as annotations.json.2 to annotations.json.5; copy the newest good " +
  "one over annotations.json, then analyze again.";
const EXPORT_LINE = "[normalize] ERROR: PDD export to C:\\t\\pdt-export-1.docx failed: PermissionError: " +
  "[Errno 13] Permission denied. Nothing in the project was changed.";

test("exit code 2 shows the pipeline's ERROR line and says nothing was changed", () => {
  const r = R.resultFromRunnerError(runnerError(2,
    "[normalize] loading events\r\n" + UNREADABLE_LINE + "\r\n"));
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.error, /^Analysis stopped, nothing was changed: /);
  assert.ok(r.error.includes("annotations.json exists but cannot be read"), r.error);
  assert.ok(r.error.includes("annotations.json.2 to annotations.json.5"), r.error);
  assert.ok(!r.error.includes("[normalize] ERROR:"), "the prefix is stripped: " + r.error);
  assert.equal(r.pipelineError, UNREADABLE_LINE.replace("[normalize] ERROR: ", ""));
});

test("exit code 3 is an export failure with the pipeline's reason", () => {
  const r = R.resultFromRunnerError(runnerError(3,
    "[normalize] wrote stats.json\n[normalize] WARNING: something minor\n" + EXPORT_LINE + "\n"));
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.error, /^Export failed: PDD export to .* failed: PermissionError/);
  assert.ok(r.error.endsWith("Nothing in the project was changed."), r.error);
  assert.equal((r.error.match(/Nothing in the project was changed/g) || []).length, 1, "said once");
  // Lane FX1: an older pipeline's line says nothing of the project: the viewer says it.
  const older = R.resultFromRunnerError(runnerError(3, "[normalize] ERROR: PDD export failed: OSError\n"));
  assert.equal(older.error, "Export failed: PDD export failed: OSError Nothing in the project was changed.");
});

test("an older pipeline without an ERROR line still fails with its last stderr line", () => {
  const r = R.resultFromRunnerError(runnerError(1,
    "Traceback (most recent call last):\n  File \"normalize.py\", line 9\nKeyError: 'timestamp'\n"));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.equal(r.error, "Analysis failed (exit code 1): KeyError: 'timestamp'");
});

test("the last of several ERROR lines wins", () => {
  assert.equal(R.pipelineErrorLine("[normalize] ERROR: first\n[normalize] ERROR: second\n"), "second");
  assert.equal(R.pipelineErrorLine("no error here"), null);
});

test("a spawn failure and an outside stop are failures too, never success", () => {
  const spawn = R.resultFromRunnerError(new Error("failed to spawn python: ENOENT"));
  assert.equal(spawn.ok, false);
  assert.match(spawn.error, /^Analysis could not start: failed to spawn python/);
  const stopped = new Error("normalize.py was stopped (SIGKILL)");
  stopped.exitCode = null; stopped.signal = "SIGKILL"; stopped.stderr = "";
  const s = R.resultFromRunnerError(stopped);
  assert.equal(s.ok, false);
  assert.match(s.error, /stopped before it finished \(SIGKILL\)/);
});

test("PDD export: a code-3 run is reported as the failure and nothing is offered", () => {
  const run = R.resultFromRunnerError(runnerError(3, EXPORT_LINE));
  // Even if a document happened to sit at the path, a failed run offers nothing.
  const out = R.pddExportOutcome(run, { exists: true, size: 12345 });
  assert.equal(out.ok, false);
  assert.match(out.message, /^Export failed: PDD export to/);
});

test("PDD export: a run that reports success but wrote no document is a failure (RP-09)", () => {
  const out = R.pddExportOutcome({ ok: true, summary: {} }, { exists: false, size: 0 });
  assert.equal(out.ok, false);
  assert.match(out.message, /wrote no document, so nothing was exported/);
  assert.equal(R.pddExportOutcome({ ok: true }, { exists: true, size: 0 }).ok, false, "an empty file is not a document");
});

test("PDD export: success only when the run succeeded AND wrote a non-empty document", () => {
  assert.deepEqual(R.pddExportOutcome({ ok: true }, { exists: true, size: 2048 }), { ok: true, message: null });
  assert.equal(R.pddExportOutcome({ ok: false, cancelled: true, error: "Analysis cancelled by user." },
    { exists: true, size: 2048 }).ok, false);
  assert.equal(R.pddExportOutcome(null, { exists: true, size: 2048 }).ok, false);
});

/* ---- AD-22: which recordings are analyzed as they open --------------------- */

test("analysisNeed: a recording with no stats.json or no analysis.json has no analysis", () => {
  assert.equal(R.analysisNeed(null), "missing");
  assert.equal(R.analysisNeed({ stats: null, analysis: null }), "missing");
  assert.equal(R.analysisNeed({ stats: { meta: { draft_summary: {} } }, analysis: null }), "missing",
    "the committed demo's shape: an old stats.json and no analysis.json");
  assert.equal(R.analysisNeed({ stats: null, analysis: { stage_errors: [] } }), "missing");
});

test("analysisNeed (V2 item 10): the format number the pipeline writes tells an older analysis, not the keys it has", () => {
  const current = { stats: { meta: {} }, analysis: { format: R.ANALYSIS_FORMAT } };
  assert.equal(R.ANALYSIS_FORMAT, 4, "4 since the analysis nobody read is cut and the capture detail is its own key (lane FX1)");
  assert.equal(R.analysisNeed(current), null, "control: today's analysis needs no run");
  assert.equal(R.analysisNeed({ stats: {}, analysis: { format: R.ANALYSIS_FORMAT + 1 } }), null, "a newer one is read as it is");
  assert.equal(R.analysisNeed({ stats: {}, analysis: { format: 1 } }), "stale");
  assert.equal(R.analysisNeed({ stats: {}, analysis: { format: 2 } }), "stale", "an analysis without the PDD's rows is analyzed again");
  assert.equal(R.analysisNeed({ stats: {}, analysis: { format: 3 } }), "stale", "lane FX1: one without coverage_caveat too");
  assert.equal(R.analysisNeed({ stats: { meta: { draft_summary: { runs: 4 } } },
    analysis: { case_quality: { mode: "markers" }, stage_errors: [] } }), "stale", "every key of today, but no format: an older pipeline");
  assert.equal(R.analysisNeed({ stats: {}, analysis: { format: "4" } }), null, "read as a number");
});

test("analysisNeed: the pipeline writes the same format number the viewer reads", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "normalization", "pipeline_stages.py"), "utf-8");
  const m = /^ANALYSIS_FORMAT = ([0-9]+)\r?$/m.exec(src);
  assert.ok(m, "pipeline_stages.py defines ANALYSIS_FORMAT");
  assert.equal(Number(m[1]), R.ANALYSIS_FORMAT);
  assert.ok(src.includes('analysis_result["format"] = ANALYSIS_FORMAT'), "and writes it into analysis.json");
});
