"use strict";

/*
 * step-scope.js: whether a step is no longer needed and who does it
 * (contract C25 as amended 2026-11-13), the rules the step editor saves and
 * reads by.
 *
 *   No longer needed: the step editor's tick, kept in flags.waste (true when
 *     ticked; every reader of waste keeps working). A step whose flags.waste
 *     is not a boolean and that carries automation: "not_needed" (the choice
 *     a project saved on 2026-11-12 holds) reads as ticked; any other
 *     automation value is ignored. The tick never writes automation, and a
 *     stored one round-trips untouched (C10): an untick writes flags.waste
 *     false, which then decides. The pipeline reads it the same way
 *     (normalization/step_context.py step_not_needed).
 *   step.done_by: a role or a person, one line, at most 80 characters.
 *     Without one the step is done by the recording's role
 *     (manifest.config.worker.role, its first letter a capital), else nobody
 *     is named (step_context.py recording_role, step_done_by).
 *
 * Pure: no DOM, no electron.
 */

const DONE_BY_MAX = 80;
/* The tick's words, and the tag a Steps row and the step panel show. */
const NOT_NEEDED_LABEL = "No longer needed";
/* The tooltip of the tick and of the tag. */
const NOT_NEEDED_TITLE = "This step should not be needed: rework, duplicate effort or copying between systems.";

/* Whether `step` is no longer needed (see the header). */
function isNotNeeded(step) {
  if (!step || typeof step !== "object") return false;
  const waste = step.flags && typeof step.flags === "object" ? step.flags.waste : undefined;
  if (typeof waste === "boolean") return waste;
  return step.automation === "not_needed";
}

/* Tick or untick No longer needed on `step` (mutated): flags.waste set to
   `on`, automation left as it is. False when the step reads so already. */
function setNotNeeded(step, on) {
  if (!step || typeof step !== "object") return false;
  const want = !!on;
  if (isNotNeeded(step) === want) return false;
  step.flags = Object.assign({}, step.flags || {}, { waste: want });
  return true;
}

/* A text as one line, its whitespace collapsed. */
function _line(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/* What the analyst typed in Done by, as it is kept: one line, at most
   DONE_BY_MAX characters ("" for nothing). */
function cleanDoneBy(text) {
  return _line(text).slice(0, DONE_BY_MAX).trim();
}

/* The role the recording was made under, its first letter a capital, or "". */
function recordingRole(manifest) {
  const w = manifest && manifest.config && manifest.config.worker;
  const role = _line(w && w.role);
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
}

/* Who does `step`: its own Done by, else the recording's role, else "". */
function doneByOf(step, manifest) {
  return cleanDoneBy(step && step.done_by) || recordingRole(manifest);
}

/* What the Done by field shows while it is empty: the recording's role
   ("Sales assistant"), else a hint. */
function doneByPlaceholder(manifest) {
  const role = recordingRole(manifest);
  return role || "A role or a person";
}

/* Set Done by on `step` (mutated): the cleaned text, or the key taken away
   when it is empty. False when nothing changes. */
function setDoneBy(step, text) {
  if (!step) return false;
  const v = cleanDoneBy(text);
  const own = cleanDoneBy(step.done_by);
  if (v === own && (v || step.done_by === undefined)) return false;
  if (v) step.done_by = v; else delete step.done_by;
  return true;
}

module.exports = {
  DONE_BY_MAX, NOT_NEEDED_LABEL, NOT_NEEDED_TITLE, isNotNeeded, setNotNeeded, cleanDoneBy, recordingRole, doneByOf,
  doneByPlaceholder, setDoneBy,
};
