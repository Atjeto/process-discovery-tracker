"use strict";

/*
 * step-scope.js: what the automation does with a step and who does it
 * (contract C25), the rules the step editor saves and reads by.
 *
 *   step.automation: "undecided" (also: absent), "automated", "person" or
 *     "not_needed", in the step editor's Automation choice read as "Not
 *     decided yet", "The automation does it", "Stays with a person", "No
 *     longer needed". It took the place of the Waste tick: flags.waste stays
 *     in step with it ("not_needed" sets it true, any other choice false),
 *     so every reader of waste keeps working, and a step flagged as waste
 *     without a choice (an older project) reads as "not_needed". An unknown
 *     value reads as "undecided". The pipeline reads it the same way
 *     (normalization/step_context.py step_automation).
 *   step.done_by: a role or a person, one line, at most 80 characters.
 *     Without one the step is done by the recording's role
 *     (manifest.config.worker.role, its first letter a capital), else nobody
 *     is named (step_context.py recording_role, step_done_by).
 *
 * Pure: no DOM, no electron.
 */

/* The choices, in the order the step editor lists them. */
const CHOICES = [
  { value: "undecided", label: "Not decided yet" },
  { value: "automated", label: "The automation does it" },
  { value: "person", label: "Stays with a person" },
  { value: "not_needed", label: "No longer needed" },
];
const VALUES = new Set(CHOICES.map((c) => c.value));
const DONE_BY_MAX = 80;
/* The tooltip of the "No longer needed" tag (a Steps row, the step panel),
   where "Waste" was. */
const NOT_NEEDED_TITLE = "Automation: this step is no longer needed.";

/* What the automation does with `step`: one of CHOICES' values. */
function automationOf(step) {
  if (!step || typeof step !== "object") return "undecided";
  const v = step.automation;
  if (v === undefined || v === null) return step.flags && step.flags.waste === true ? "not_needed" : "undecided";
  return typeof v === "string" && VALUES.has(v) ? v : "undecided";
}

/* The words a choice reads as ("Not decided yet" for an unknown one). */
function labelOf(value) {
  const hit = CHOICES.find((c) => c.value === value);
  return hit ? hit.label : CHOICES[0].label;
}

/* Set the choice on `step` (mutated), flags.waste in step with it. "undecided"
   takes the key away. False when `value` is no choice or the step reads as it
   already. */
function setAutomation(step, value) {
  if (!step || !VALUES.has(value)) return false;
  const was = automationOf(step);
  const wasteWas = !!(step.flags && step.flags.waste === true);
  const waste = value === "not_needed";
  if (was === value && wasteWas === waste && (value === "undecided" ? step.automation === undefined : step.automation === value)) return false;
  if (value === "undecided") delete step.automation; else step.automation = value;
  step.flags = Object.assign({}, step.flags || {}, { waste });
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

/* What the Done by field shows while it is empty: the recording's role, said
   as the default ("Sales assistant (from the recording)"), else a hint. */
function doneByPlaceholder(manifest) {
  const role = recordingRole(manifest);
  return role ? role + " (from the recording)" : "A role or a person";
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
  CHOICES, DONE_BY_MAX, NOT_NEEDED_TITLE, automationOf, labelOf, setAutomation, cleanDoneBy, recordingRole, doneByOf,
  doneByPlaceholder, setDoneBy,
};
