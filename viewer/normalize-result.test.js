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
  "[Errno 13] Permission denied. The analysis outputs were written; the PDD was not.";

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
  assert.ok(r.error.includes("the PDD was not"), r.error);
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

test("analysisNeed: an analysis without the blocks today's pipeline always writes came from an older version", () => {
  const current = { stats: { meta: { draft_summary: { runs: 4 } } },
    analysis: { case_quality: { mode: "markers" }, stage_errors: [] } };
  assert.equal(R.analysisNeed(current), null, "control: today's analysis needs no run");
  const without = (fn) => { const s = JSON.parse(JSON.stringify(current)); fn(s); return R.analysisNeed(s); };
  assert.equal(without((s) => { delete s.analysis.stage_errors; }), "stale", "before C12");
  assert.equal(without((s) => { delete s.analysis.case_quality; }), "stale", "before the run check");
  assert.equal(without((s) => { delete s.stats.meta.draft_summary; }), "stale", "before the C1 drafting rule");
  assert.equal(without((s) => { s.stats.meta = undefined; }), "stale");
});

test("analysisNeed: a run check that failed is today's analysis, not an older one (C12)", () => {
  assert.equal(R.analysisNeed({ stats: { meta: { draft_summary: {} } },
    analysis: { case_quality: null, stage_errors: [{ stage: "case_quality", error: "TypeError" }] } }), null);
});
