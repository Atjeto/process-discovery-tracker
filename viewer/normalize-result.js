/*
 * normalize-result.js: what the viewer tells the analyst about a finished
 * normalize.py run (contract C13; RP-04 and RP-09), and whether a recording
 * needs a run as it opens (analysisNeed, AD-22). Pure, so the mapping is
 * unit-tested without spawning Python.
 *
 * normalize.py exit codes (C13):
 *   0  success
 *   2  annotations.json exists but cannot be read; nothing was written
 *   3  a requested export (the PDD) failed; nothing in the project was
 *      changed (lane FX1: a run moves its outputs into the project folder
 *      only as its last act, once everything succeeded), and the export was
 *      not written
 * Any non-zero exit is a failure, and leaves the project as it was. The pipeline states the reason as one
 * stderr line starting with "[normalize] ERROR:"; that line is what the
 * analyst sees (older pipelines print none, so the last stderr line stands
 * in for it).
 */

"use strict";

const ERROR_PREFIX = "[normalize] ERROR:";

/* The reason from the pipeline's "[normalize] ERROR:" line (the last one when
   there are several), without the prefix; null when there is none. */
function pipelineErrorLine(stderr) {
  let found = null;
  for (const line of String(stderr || "").split(/\r?\n/)) {
    const at = line.indexOf(ERROR_PREFIX);
    if (at !== -1) found = line.slice(at + ERROR_PREFIX.length).trim();
  }
  return found || null;
}

function _lastLine(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

/* The sentence shown for a non-zero exit. */
function describeNormalizeFailure(code, stderr) {
  const reason = pipelineErrorLine(stderr);
  if (code === 2) {
    return "Analysis stopped, nothing was changed: " + (reason || "annotations.json could not be read.");
  }
  if (code === 3) {
    return "Export failed: " + (reason || "the export could not be written.") +
      (reason && /nothing in the project was changed/i.test(reason) ? "" : " Nothing in the project was changed.");
  }
  return "Analysis failed (exit code " + code + "): " + (reason || _lastLine(stderr) || "no error message was given.");
}

/* The IPC result for a runner failure. `err` is what python-runner.js rejects
   with: a non-zero exit carries `exitCode` and `stderr`; a process stopped
   from outside carries `signal`; a spawn failure carries neither. */
function resultFromRunnerError(err) {
  const code = err && Number.isInteger(err.exitCode) ? err.exitCode : null;
  if (code !== null) {
    return { ok: false, code, pipelineError: pipelineErrorLine(err.stderr),
      error: describeNormalizeFailure(code, err.stderr) };
  }
  if (err && err.signal) {
    return { ok: false, code: null, pipelineError: pipelineErrorLine(err.stderr),
      error: "Analysis stopped before it finished (" + err.signal + "). Re-analyze from Help, Troubleshooting." };
  }
  return { ok: false, code: null, pipelineError: null,
    error: "Analysis could not start: " + ((err && err.message) || String(err)) };
}

/* PDD export (RP-09): decide from the run result AND the document on disk.
   The export is reported (and the file offered to the analyst) only when the
   run succeeded AND this run's own output file exists and is not empty. The
   caller deletes any file at the temp path before the run, so a file found
   here was written by this run: a failed run can never hand the analyst an
   older document as the new export. `file` = { exists, size }. */
function pddExportOutcome(result, file) {
  if (!result) return { ok: false, message: "Export failed: the analysis did not answer." };
  if (result.cancelled) return { ok: false, message: "Export cancelled." };
  if (!result.ok) return { ok: false, message: result.error || "Export failed: no reason was given." };
  if (!file || !file.exists || !(file.size > 0)) {
    return { ok: false, message: "Export failed: the analysis finished but wrote no document, so nothing was exported." };
  }
  return { ok: true, message: null };
}

/* The analysis.json format this viewer reads: the number the pipeline writes
   as analysis.json `format` (normalization/pipeline_stages.py
   ANALYSIS_FORMAT; V2 item 10). 3: the Overview's Data and Applications and
   time read the PDD's rows (`pdd_data`, `pdd_time`; lane CC). 4: the
   project line's warning on the apps recorded with less detail reads
   `coverage_caveat` (the findings that held it are cut, lane FX1). 5: the
   PDD's rows are the document's alone, the Overview no longer shows them
   (`pdd_data`, `pdd_time` and `steps_signature` are cut). An older
   analysis is analyzed again as the project opens. */
const ANALYSIS_FORMAT = 5;

/* Whether a recording needs an analysis as it opens (AD-22): "missing" when
   it has none (no stats.json or no analysis.json), "stale" when its analysis
   came from an older version of the pipeline (its analysis.json `format` is
   missing or lower than ANALYSIS_FORMAT), else null. */
function analysisNeed(session) {
  if (!session || !session.stats || !session.analysis) return "missing";
  const f = Number(session.analysis.format);
  return Number.isFinite(f) && f >= ANALYSIS_FORMAT ? null : "stale";
}

module.exports = {
  ERROR_PREFIX, pipelineErrorLine, describeNormalizeFailure, resultFromRunnerError, pddExportOutcome,
  analysisNeed, ANALYSIS_FORMAT,
};
