"use strict";

/*
 * step-exceptions.js: the exceptions of a step (contract C27), the rules the
 * step editor's Exceptions section saves and reads by.
 *
 *   step.exceptions: [{ when, then }], the analyst's entries in the
 *     analyst's order. `when` is required (one line, at most 120
 *     characters); `then` is optional (one line, at most 200, the key left
 *     out when empty). An entry whose `when` is empty is not kept, and an
 *     empty list takes the key away. Sub-steps carry it the same way. A step
 *     that gets, changes or loses an entry is the analyst's: a draft becomes
 *     edited (analyst-content.js markEdited, as C26 and the flow do). The
 *     pipeline reads it the same way (normalization/step_context.py
 *     step_exceptions) and never writes it.
 *
 * The pattern is step-information.js (C26). Pure: no DOM, no electron.
 */

const AC = require("./analyst-content.js");

const WHEN_MAX = 120;
const THEN_MAX = 200;
/* The editor's words (C27). */
const WORDS = {
  heading: "Exceptions",
  when: "When",
  then: "What is done",
  add: "Add exception",
  addTitle: "Adds what happens when something goes wrong at this step, and what is done.",
  remove: "Remove",
  removeTitle: "Removes this exception.",
  emptyWhen: "The exception was removed: it had nothing under When.",
};

/* A text as one line, its whitespace collapsed, at most `max` characters. */
function _line(v, max) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

/* One entry as it is kept, or null when its `when` is empty. */
function cleanEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const when = _line(entry.when, WHEN_MAX);
  if (!when) return null;
  const out = { when };
  const then = _line(entry.then, THEN_MAX);
  if (then) out.then = then;
  return out;
}

/* The analyst's entries of `step`, cleaned (one without a `when` left out). */
function entriesOf(step) {
  const list = step && Array.isArray(step.exceptions) ? step.exceptions : [];
  return list.map(cleanEntry).filter(Boolean);
}

/* Whether `step` holds an entry. */
function hasEntries(step) {
  return entriesOf(step).length > 0;
}

/* Put `list` on `step` (an empty list takes the key away) and mark the step
   the analyst's. */
function _put(step, list) {
  if (list.length) step.exceptions = list; else delete step.exceptions;
  AC.markEdited(step);
  return true;
}

function _same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* Add an entry at the end. False when its `when` is empty (nothing kept). */
function addEntry(step, entry) {
  if (!step) return false;
  const clean = cleanEntry(entry);
  if (!clean) return false;
  return _put(step, entriesOf(step).concat([clean]));
}

/* The keys of an entry's fields. */
const FIELDS = ["when", "then"];

/* Change one field (`key`: when or then) of entry `i`. Returns "changed",
   "removed" (its `when` was emptied: the entry is not kept) or "" (nothing
   changed: no such entry or field, or the same text). */
function setField(step, i, key, value) {
  if (!step || !FIELDS.includes(key)) return "";
  const list = entriesOf(step);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return "";
  const next = Object.assign({}, list[i], { [key]: value });
  const clean = cleanEntry(next);
  if (!clean) {
    list.splice(i, 1);
    _put(step, list);
    return "removed";
  }
  if (_same(clean, list[i])) return "";
  list[i] = clean;
  _put(step, list);
  return "changed";
}

/* Take entry `i` out. False when there is no such entry. */
function removeEntry(step, i) {
  if (!step) return false;
  const list = entriesOf(step);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return false;
  list.splice(i, 1);
  return _put(step, list);
}

/* The entries of several steps as one list, each entry once (a merge of
   steps, a sub-process dissolved): the first step's first. */
function joined(steps) {
  const out = [];
  const seen = new Set();
  for (const s of steps || []) {
    for (const e of entriesOf(s)) {
      const k = JSON.stringify(e);
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
  }
  return out;
}

/* Put the joined entries of `steps` on `target` (the key away when none). */
function putJoined(target, steps) {
  if (!target) return;
  const list = joined(steps);
  if (list.length) target.exceptions = list; else delete target.exceptions;
}

/* A split: the entries stay with the first half (as C26's lines do). */
function splitExceptions(first, second) {
  if (second) delete second.exceptions;
  if (first && !hasEntries(first)) delete first.exceptions;
}

/* Whether any step of `steps`, at any level, that is not hidden holds an
   entry: the pipeline then writes the Technical details (their Exceptions
   sheet) for a project without a recording. */
function anyEntries(steps) {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || s.state === "hidden") continue;
    if (hasEntries(s) || anyEntries(s.sub_steps)) return true;
  }
  return false;
}

module.exports = {
  WHEN_MAX, THEN_MAX, WORDS, FIELDS, cleanEntry, entriesOf, hasEntries, addEntry, setField, removeEntry,
  joined, putJoined, splitExceptions, anyEntries,
};
