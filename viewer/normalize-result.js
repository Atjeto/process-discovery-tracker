/*
 * normalize-result.js: what the viewer tells the analyst about a finished
 * normalize.py run (contract C13; RP-04 and RP-09), and whether a recording
 * needs a run as it opens (analysisNeed, AD-22). Pure, so the mapping is
 * unit-tested without spawning Python.
 *
 * normalize.py exit codes (C13):
 *   0  success
 *   2  annotations.json exists but cannot be read; nothing was written
 *   3  a requested export (the PDD) failed; the analysis outputs were
 *      written, the export was not
 * Any non-zero exit is a failure. The pipeline states the reason as one
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
      (reason && /analysis outputs were written/i.test(reason) ? "" : " The analysis itself was updated.");
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

/* Whether a recording needs an analysis as it opens (AD-22): "missing" when
   it has none (no stats.json or no analysis.json), "stale" when its analysis
   came from an older version of the pipeline, else null. normalize.py stamps
   no version number, so an older analysis is told by the blocks today's
   pipeline always writes: analysis.json `stage_errors` (C12, empty when every
   stage ran) and `case_quality` (or a stage error naming it), and stats.json
   `meta.draft_summary` (the C1 drafting rule's numbers). */
function analysisNeed(session) {
  if (!session || !session.stats || !session.analysis) return "missing";
  const a = session.analysis;
  if (!Array.isArray(a.stage_errors)) return "stale";
  const runCheckFailed = a.stage_errors.some((e) => e && e.stage === "case_quality");
  if (!a.case_quality && !runCheckFailed) return "stale";
  const ds = (session.stats.meta || {}).draft_summary;
  if (!ds || typeof ds !== "object") return "stale";
  return null;
}

module.exports = {
  ERROR_PREFIX, pipelineErrorLine, describeNormalizeFailure, resultFromRunnerError, pddExportOutcome,
  analysisNeed,
};
