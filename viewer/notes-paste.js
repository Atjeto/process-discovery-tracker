/*
 * notes-paste.js: Paste notes... on Steps (lane E1). The notes a process
 * manager wrote during a call, in Notepad, in Teams or on paper, read in one
 * paste: a line is a step, a line that starts with a document field's name
 * goes to that field. Pure: no DOM, no State; unit-tested
 * (notes-paste.test.js). steps-view.js makes the steps and the field texts
 * as one undoable edit.
 *
 * The rules, one per line of the notes:
 *  - an empty line is dropped;
 *  - a leading list mark is dropped ("-", "*", a bullet, "1." "1)" "a)"
 *    "(1)", "[ ]" "[x]"), and a leading "Step 3:" or "Step 3." counter;
 *  - a line is a step: its name is the text before the first colon that is
 *    followed by a space or ends the line (a colon between two digits, as in
 *    "10:30", is not that colon), its description the text after it; a line
 *    whose name would be empty is a step named by the whole line;
 *  - a line that starts with a document field's name and a colon goes to
 *    that field (the labels of overview-view.js DOC_FIELDS, case blind, and
 *    a few short forms: "Volume:", "Rules:");
 *  - a line indented deeper than the step or field line above it joins that
 *    one's text on a new line (details under a step);
 *  - two lines for one field join the same way, and a field that already
 *    holds text keeps it, the pasted text after it on a new line
 *    (mergeDocument).
 */

"use strict";

/* Short forms of the document fields, each naming a field by its label (the
   labels and the keys stay DOC_FIELDS's). */
const SHORT_FORMS = {
  "Contacts": "Key contacts",
  "Rules": "Business rules",
  "Volume": "Volume and effort",
  "Effort": "Volume and effort",
  "Improvement": "Improvement and automation scope",
  "Automation": "Improvement and automation scope",
};

/* The leading list marks: a bullet ("-", "*", "+", and the bullet
   characters a word processor or Teams pastes, the private one of a Word
   list among them), a number or letter counter, a check box. */
const MARKS = [
  /^[-*+\u2022\u25e6\u25aa\u25ab\u25cf\u25cb\u2023\u2043\u00b7\uf0b7\uf0a7]\s+/,
  /^\(?\d{1,3}[.)]\s+/,
  /^\(\d{1,3}\)\s+/,
  /^\(?[a-zA-Z][)]\s+/,
  /^\([a-zA-Z]\)\s+/,
  /^\[[ xX]?\]\s*/,
];
const COUNTER = /^step\s+\d{1,4}\s*[:.]\s*/i;

/* A line's indentation, a tab counting four spaces. */
function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " " || ch === "\u00a0") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

/* The line without its list marks and its step counter, trimmed. */
function stripMarks(text) {
  let s = String(text || "").trim();
  for (let again = true; again;) {
    again = false;
    for (const re of MARKS) {
      const m = re.exec(s);
      if (m && m[0].length < s.length) { s = s.slice(m[0].length).trim(); again = true; }
    }
  }
  const c = COUNTER.exec(s);
  if (c) {
    const rest = s.slice(c[0].length).trim();
    s = rest || s.replace(/\s*[:.]\s*$/, "");
  }
  return s;
}

/* Where a line's name ends: the first colon followed by a space or the end
   of the line, never one between two digits. -1 when there is none. */
function nameColon(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ":") continue;
    const before = s[i - 1], after = s[i + 1];
    if (/\d/.test(before || "") && /\d/.test(after || "")) continue;
    if (after === undefined || /\s/.test(after)) return i;
  }
  return -1;
}

/* The field a line opens, or null: { field, text } when the line starts
   with a field's label or short form and a colon. `fields`: DOC_FIELDS
   ({ key, label }). */
function _fieldLine(s, names) {
  const low = s.toLowerCase();
  for (const n of names) {
    if (!low.startsWith(n.name)) continue;
    const m = /^\s*:(\s|$)/.exec(s.slice(n.name.length));
    if (m) return { field: n.field, text: s.slice(n.name.length + m[0].length).trim() };
  }
  return null;
}

/* The names a field line may start with, longest first: [{ name (lower
   case), field }]. */
function fieldNames(fields) {
  const out = [];
  for (const f of fields || []) {
    if (f && f.key && f.label) out.push({ name: String(f.label).toLowerCase(), field: f });
  }
  for (const [short, label] of Object.entries(SHORT_FORMS)) {
    const f = (fields || []).find((x) => x && x.label === label);
    if (f) out.push({ name: short.toLowerCase(), field: f });
  }
  return out.sort((a, b) => b.name.length - a.name.length);
}

/* Read the notes `text` against the document fields `fields` (DOC_FIELDS).
   Returns { steps: [{ name, description }], fields: [{ key, label, text }]
   (in the order first written, only those with text) }. */
function parseNotes(text, fields) {
  const names = fieldNames(fields);
  const steps = [];
  const byKey = new Map();
  let last = null;   // { indent, add(line) }
  for (const raw of String(text || "").split(/\r\n|\r|\n/)) {
    if (!raw.trim()) continue;
    const indent = indentOf(raw);
    const s = stripMarks(raw);
    // A line of marks alone ("-", "[ ]") says nothing.
    if (!/[\p{L}\p{N}]/u.test(s)) continue;
    if (last && indent > last.indent) { last.add(s); continue; }
    const f = _fieldLine(s, names);
    if (f) {
      let entry = byKey.get(f.field.key);
      if (!entry) { entry = { key: f.field.key, label: f.field.label, lines: [] }; byKey.set(f.field.key, entry); }
      if (f.text) entry.lines.push(f.text);
      last = { indent, add: (line) => entry.lines.push(line) };
      continue;
    }
    const at = nameColon(s);
    const name = at >= 0 ? s.slice(0, at).trim() : s;
    const step = name ? { name, description: at >= 0 ? s.slice(at + 1).trim() : "" } : { name: s, description: "" };
    steps.push(step);
    last = { indent, add: (line) => { step.description = step.description ? step.description + "\n" + line : line; } };
  }
  const out = [];
  for (const e of byKey.values()) if (e.lines.length) out.push({ key: e.key, label: e.label, text: e.lines.join("\n") });
  return { steps, fields: out };
}

/* What a paste will make, as the dialog says it under the box: "12 steps
   and 4 document fields: Trigger, Result, Volume and effort, Exceptions",
   "12 steps", "1 document field: Trigger", or "Nothing to add yet". */
function summary(parsed) {
  const n = parsed && parsed.steps ? parsed.steps.length : 0;
  const fs = parsed && parsed.fields ? parsed.fields : [];
  const steps = n === 1 ? "1 step" : n + " steps";
  const fields = (fs.length === 1 ? "1 document field: " : fs.length + " document fields: ") + fs.map((f) => f.label).join(", ");
  if (!n && !fs.length) return "Nothing to add yet";
  if (!fs.length) return steps;
  if (!n) return fields;
  return steps + " and " + fields;
}

/* The document after the paste: every field of `fields` (DOC_FIELDS) as it
   was, a pasted field's text after its own on a new line (or alone when it
   was empty), and the keys a later contract adds kept as they are. */
function mergeDocument(doc, pasted, fields) {
  const cur = doc && typeof doc === "object" ? doc : {};
  const val = (k) => (typeof cur[k] === "string" ? cur[k] : "");
  const next = {};
  for (const f of fields || []) next[f.key] = val(f.key);
  for (const k of Object.keys(cur)) if (!(k in next)) next[k] = cur[k];
  for (const p of pasted || []) {
    const had = typeof next[p.key] === "string" ? next[p.key] : "";
    next[p.key] = had.trim() ? had.replace(/\s+$/, "") + "\n" + p.text : p.text;
  }
  return next;
}

module.exports = { SHORT_FORMS, parseNotes, summary, mergeDocument, stripMarks, nameColon, indentOf, fieldNames };
