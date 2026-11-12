"use strict";

/*
 * step-information.js: the information a step uses or enters (contract C26),
 * the rules the step editor's Information section saves and reads by.
 *
 *   step.information: [{ name, example, goes_to }], the analyst's lines in
 *     the analyst's order. `name` is required (one line, at most 80
 *     characters); `example` and `goes_to` are optional (one line, at most
 *     120 each, the key left out when empty). A line whose name is empty is
 *     not kept, and an empty list takes the key away. Sub-steps carry it the
 *     same way. A step that gets, changes or loses a line is the analyst's:
 *     a draft becomes edited (analyst-content.js markEdited, as the flow
 *     does, C17). The pipeline reads it the same way
 *     (normalization/step_context.py step_information) and never writes it.
 *   recordedRows: the recorded fields of a step, read from its recorded
 *     actions as the Technical details read them (pdd_export._entered): a
 *     field typed into or chosen in, once per field in the order first
 *     entered, the value typed as its example (a password "typed
 *     (hidden)"), the system and screen as where it goes.
 *
 * Pure: no DOM, no electron.
 */

const AC = require("./analyst-content.js");
const { isBrowserChrome } = require("./recognition.js");
const { SECRET_VALUE, isBlankValue } = require("./step-facts.js");

const NAME_MAX = 80;
const TEXT_MAX = 120;
/* The editor's words (C26). */
const WORDS = {
  heading: "Information",
  recorded: "Recorded",
  name: "Information",
  example: "Example",
  goesTo: "Where it goes",
  add: "Add information",
  addTitle: "Adds a line for something this step uses or enters.",
  remove: "Remove",
  removeTitle: "Takes this line out. Ctrl+Z brings it back.",
  emptyName: "A line needs a name, so it was taken out. Ctrl+Z brings it back.",
};

/* A text as one line, its whitespace collapsed, at most `max` characters. */
function _line(v, max) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

/* One line as it is kept, or null when it has no name. */
function cleanEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const name = _line(entry.name, NAME_MAX);
  if (!name) return null;
  const out = { name };
  const example = _line(entry.example, TEXT_MAX);
  const goesTo = _line(entry.goes_to, TEXT_MAX);
  if (example) out.example = example;
  if (goesTo) out.goes_to = goesTo;
  return out;
}

/* The analyst's lines of `step`, cleaned (a line without a name left out). */
function entriesOf(step) {
  const list = step && Array.isArray(step.information) ? step.information : [];
  return list.map(cleanEntry).filter(Boolean);
}

/* Whether `step` holds a line of the analyst's. */
function hasEntries(step) {
  return entriesOf(step).length > 0;
}

/* Put `list` on `step` (an empty list takes the key away) and mark the step
   the analyst's. */
function _put(step, list) {
  if (list.length) step.information = list; else delete step.information;
  AC.markEdited(step);
  return true;
}

function _same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* Add a line at the end. False when it has no name (nothing is kept). */
function addEntry(step, entry) {
  if (!step) return false;
  const clean = cleanEntry(entry);
  if (!clean) return false;
  return _put(step, entriesOf(step).concat([clean]));
}

/* The keys of a line's fields. */
const FIELDS = ["name", "example", "goes_to"];

/* Change one field (`key`: name, example or goes_to) of line `i`. Returns
   "changed", "removed" (its name was emptied: the line is not kept) or ""
   (nothing changed: no such line or field, or the same text). */
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

/* Take line `i` out. False when there is no such line. */
function removeEntry(step, i) {
  if (!step) return false;
  const list = entriesOf(step);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return false;
  list.splice(i, 1);
  return _put(step, list);
}

/* The lines of several steps as one list, each line once (a merge of steps,
   a sub-process dissolved): the first step's first. */
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

/* Put the joined lines of `steps` on `target` (the key away when none). */
function putJoined(target, steps) {
  if (!target) return;
  const list = joined(steps);
  if (list.length) target.information = list; else delete target.information;
}

/* A split: the lines stay with the first half (as its condition does, C17). */
function splitInformation(first, second) {
  if (second) delete second.information;
  if (first && !hasEntries(first)) delete first.information;
}

/* Whether any step of `steps`, at any level, that is not hidden holds a
   line of the analyst's: the pipeline then writes the Technical details for a
   project without a recording (C26). */
function anyEntries(steps) {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || s.state === "hidden") continue;
    if (hasEntries(s) || anyEntries(s.sub_steps)) return true;
  }
  return false;
}

/* ---- the recorded fields (pdd_export._entered) ---- */

const TYPED = new Set(["value_changed", "text_changed"]);
const NOISE = new Set(["null", "(null)", "undefined", "(undefined)"]);
const VALUE_MAX = 200;

function _t(v) { return typeof v === "string" ? v.trim() : ""; }

/* { field, value } when the interaction entered a value into a field, else
   null: a secret the recorder redacted reads "typed (hidden)"; an empty web
   field, the browser's own bar and a choice named by its option are none. */
function entered(data) {
  if (!data || typeof data !== "object" || isBrowserChrome(data)) return null;
  let value;
  if (TYPED.has(data.kind)) {
    if (data.value_redacted === true) value = SECRET_VALUE;
    else {
      value = _t(data.value);
      if (!value || NOISE.has(value.toLowerCase()) || isBlankValue(value)) return null;
    }
  } else if (data.kind === "selection_changed" && data.control_type !== "TabItem" && data.control_type !== "Tab") {
    value = _t(data.selected_value);
    const label = _t(data.meaningful_name) || _t(data.name);
    if (!value || label === value) return null;
  } else {
    return null;
  }
  if (value.length > VALUE_MAX) value = value.slice(0, VALUE_MAX - 1) + "…";
  const field = _t(data.meaningful_name) || _t(data.name) || _t(data.automation_id) || "(unnamed field)";
  return { field, value };
}

/* The recorded rows of a step: [{ name, example, goes_to }] from `datas`
   (its interactions' data in order, step-facts.js stepDatas), once per field
   in the order first entered, the first value its example. `whereOf(data)`
   names where the entry went ("SAP, Create sales order"; "" when unknown). */
function recordedRows(datas, whereOf) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(datas) ? datas : []) {
    const got = entered(d);
    if (!got || seen.has(got.field)) continue;
    seen.add(got.field);
    out.push({ name: got.field, example: got.value, goes_to: typeof whereOf === "function" ? (whereOf(d) || "") : "" });
  }
  return out;
}

module.exports = {
  NAME_MAX, TEXT_MAX, WORDS, FIELDS, cleanEntry, entriesOf, hasEntries, addEntry, setField, removeEntry,
  joined, putJoined, splitInformation, anyEntries, entered, recordedRows,
};
