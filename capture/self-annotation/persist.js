/*
 * Close-out persistence (lab-phase §E3) -- electron-free so it is unit-
 * testable and reusable.
 *
 * Two writes, both additive sidecar/metadata -- events.jsonl is never
 * touched:
 *
 *   - self_annotations[] appended to the session's annotations.json
 *     (created here if the pipeline hasn't made one yet). Entries carry
 *     manually_authored: true; re-normalization preserves unknown
 *     top-level keys, so the pipeline round-trips them untouched.
 *   - manifest.worker_review -- the worker's explicit "Submit session"
 *     (worker agency as the consent feature). Absent = never submitted.
 *
 * Both rewrite session-integrity.json afterwards: it was written at
 * session close, BEFORE the wizard ran, so the new/changed files must be
 * re-declared or the viewer's completeness check would not cover them.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeSessionIntegrity } = require("../session.js");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch (_e) { return fallback; }
}

/* Append wizard answers to annotations.json self_annotations[].
   Returns the total entry count after the write. */
function writeSelfAnnotations(sessionFolder, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return countSelfAnnotations(sessionFolder);
  }
  const file = path.join(sessionFolder, "annotations.json");
  const anno = readJson(file, {});
  if (!Array.isArray(anno.self_annotations)) anno.self_annotations = [];
  anno.self_annotations.push(...entries);
  fs.writeFileSync(file, JSON.stringify(anno, null, 2));
  refreshIntegrity(sessionFolder);
  return anno.self_annotations.length;
}

function countSelfAnnotations(sessionFolder) {
  const anno = readJson(path.join(sessionFolder, "annotations.json"), {});
  return Array.isArray(anno.self_annotations) ? anno.self_annotations.length : 0;
}

/* Stamp the worker's explicit submit decision onto the manifest. */
function stampWorkerReview(sessionFolder, { questionsAsked, questionsAnswered }) {
  const file = path.join(sessionFolder, "manifest.json");
  const manifest = readJson(file, null);
  if (!manifest) return false;
  manifest.worker_review = {
    submitted: true,
    submitted_at: new Date().toISOString(),
    questions_asked: questionsAsked | 0,
    questions_answered: questionsAnswered | 0,
  };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  refreshIntegrity(sessionFolder);
  return true;
}

function refreshIntegrity(sessionFolder) {
  try { writeSessionIntegrity(sessionFolder); }
  catch (_e) { /* best-effort -- the data writes above are the contract */ }
}

module.exports = { writeSelfAnnotations, stampWorkerReview, countSelfAnnotations };
