"use strict";

/*
 * sme-gives.js: what the SME gives at the end of a recording (contract C24,
 * lane C), the viewer's pure side; sme-gives.test.js drives it.
 *
 * The capture app's end summary writes on the recording's manifest.json:
 *   - `sme_answers`: the SME's one line for each of four questions, under
 *     the keys of the document fields they fill (trigger, result, effort,
 *     exceptions);
 *   - `sme_files`: the example files the SME added, copied into the
 *     recording's attachments/ folder ([{ file, label, added_at }]).
 * The viewer never writes either (C24, round trip).
 *
 * The answers: the Overview shows each under its document field while the
 * field's text is not the answer and the key is not dismissed
 * (`annotations.sme_answers_dismissed`, an array of keys), with Use and
 * Dismiss (views/overview-view.js). Use writes the answer and dismisses the
 * key in one undoable edit (usedAnswer), so a used answer stays gone after
 * the field is edited.
 * The files: when an editable project opens, each listed file that is in
 * attachments/ and in no attachment entry becomes an attachment of the whole
 * project, `from: "sme"`, in one save that is not on the undo stack
 * (views/flow-view.js loadSessionIntoView). The files taken so are named in
 * `annotations.sme_files_adopted`, so a file the analyst removes later is
 * neither taken again nor reported missing.
 *
 * No DOM, no State, no file system: whether a file is in the folder is
 * passed in.
 */

/* The four questions' keys, in the order of the Overview's fields. */
const ANSWER_KEYS = ["trigger", "result", "exceptions", "effort"];

/* The words (C24 and the brief, word for word). */
const WORDS = {
  wrote: "The SME wrote:",
  use: "Use",
  useTitle: "Writes the SME's answer into this field.",
  dismiss: "Dismiss",
  dismissTitle: "Hides the SME's answer for this field. Ctrl+Z brings it back.",
  replaceQuestion: "Replace what the field holds with the SME's answer?",
  replaceOk: "Replace",
  fromSme: "From the SME",
};

function _text(v) { return typeof v === "string" ? v.trim() : ""; }
function _obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }

/* The SME's answers on `manifest`: { key: answer } for each of the four keys
   whose answer is a string with text, trimmed; any other key is ignored. */
function answersOf(manifest) {
  const given = _obj(_obj(manifest).sme_answers);
  const out = {};
  for (const k of ANSWER_KEYS) {
    const a = _text(given[k]);
    if (a) out[k] = a;
  }
  return out;
}

/* The keys the analyst dismissed (annotations.sme_answers_dismissed). */
function dismissedOf(annotations) {
  const list = _obj(annotations).sme_answers_dismissed;
  return new Set((Array.isArray(list) ? list : []).filter((k) => typeof k === "string"));
}

/* Whether a document field's text is the SME's answer (both trimmed). */
function holdsAnswer(fieldText, answer) {
  return !!_text(answer) && _text(fieldText) === _text(answer);
}

/* The answers that wait under their fields: [{ key, answer }] in the
   Overview's order, each one whose field's text is not the answer and whose
   key is not dismissed. `document`: annotations.document. */
function waitingAnswers(manifest, annotations) {
  const answers = answersOf(manifest);
  const dismissed = dismissedOf(annotations);
  const doc = _obj(_obj(annotations).document);
  return ANSWER_KEYS.filter((k) => answers[k] && !dismissed.has(k) && !holdsAnswer(doc[k], answers[k]))
    .map((k) => ({ key: k, answer: answers[k] }));
}

/* The document's line while answers wait (n of them), "" while none does:
   how many ("The SME answered 2 questions."). */
function waitingLine(n) {
  if (!(n > 0)) return "";
  return n === 1 ? "The SME answered 1 question." : "The SME answered " + n + " questions.";
}

/* annotations with `key` dismissed: a new array, the key once. */
function withDismissed(annotations, key) {
  const list = Array.from(dismissedOf(annotations));
  if (!list.includes(key)) list.push(key);
  return list;
}

/* Use: the SME's answer `answer` written into the field `key` AND the key
   dismissed, one edit (so an answer used never comes back under the field
   after the analyst edits it, and one Ctrl+Z gives back both the field's
   old text and the line). Pure: `annotations` is not changed; returns
   { document, sme_answers_dismissed } to put on it, the document's other
   keys kept as they are. */
function usedAnswer(annotations, key, answer) {
  const a = _obj(annotations);
  return { document: Object.assign({}, _obj(a.document), { [key]: answer }), sme_answers_dismissed: withDismissed(a, key) };
}

/* Whether `file` is a plain file name inside attachments/ (no folder, not
   "." or ".."), as C16 and C24 store it. */
function plainName(file) {
  const f = _text(file);
  return !!f && f === file && !/[\\/]/.test(f) && f !== "." && f !== ".." && !/^[A-Za-z]:/.test(f);
}

/* What opening the project does with the SME's files: { add, missing }.
   `add`: the attachment entries to add, without their id
   ({ file, label, step_id: null, added_at, from: "sme" }), one per file
   listed in manifest.sme_files that is in attachments/ (`exists(file)`), in
   no annotations.attachments entry and not taken before
   (annotations.sme_files_adopted); `missing`: the names of the listed files
   not in the folder and not taken before. `nowIso`: the time an entry
   without its own added_at gets. */
function filesToAdopt(manifest, annotations, exists, nowIso) {
  const listed = _obj(manifest).sme_files;
  const anno = _obj(annotations);
  const attached = new Set((Array.isArray(anno.attachments) ? anno.attachments : [])
    .filter((a) => a && typeof a.file === "string").map((a) => a.file));
  const taken = new Set((Array.isArray(anno.sme_files_adopted) ? anno.sme_files_adopted : [])
    .filter((f) => typeof f === "string"));
  const seen = new Set();
  const add = [], missing = [];
  for (const e of Array.isArray(listed) ? listed : []) {
    if (!e || !plainName(e.file) || seen.has(e.file)) continue;
    seen.add(e.file);
    if (attached.has(e.file) || taken.has(e.file)) continue;
    const label = _text(e.label) || e.file;
    if (typeof exists === "function" && exists(e.file)) {
      const at = _text(e.added_at);
      add.push({ file: e.file, label, step_id: null,
        added_at: at && Number.isFinite(Date.parse(at)) ? at : nowIso || new Date().toISOString(), from: "sme" });
    } else {
      missing.push(label);
    }
  }
  return { add, missing };
}

/* Add `add` (filesToAdopt) to `annotations` in place: each entry with an id
   from `newId()`, and its file named in sme_files_adopted. The number added. */
function adoptFiles(annotations, add, newId) {
  if (!annotations || !Array.isArray(add) || !add.length) return 0;
  if (!Array.isArray(annotations.attachments)) annotations.attachments = [];
  if (!Array.isArray(annotations.sme_files_adopted)) annotations.sme_files_adopted = [];
  for (const a of add) {
    annotations.attachments.push(Object.assign({ id: newId() }, a));
    if (!annotations.sme_files_adopted.includes(a.file)) annotations.sme_files_adopted.push(a.file);
  }
  return add.length;
}

/* The Overview's line for a file listed but not in the folder. */
function missingLine(name) {
  return "The SME's file " + name + " is not in the project folder.";
}

/* Whether an attachment entry came from the SME. */
function fromSme(att) {
  return !!att && att.from === "sme";
}

module.exports = {
  ANSWER_KEYS, WORDS, answersOf, dismissedOf, holdsAnswer, waitingAnswers, waitingLine, withDismissed, usedAnswer,
  plainName, filesToAdopt, adoptFiles, missingLine, fromSme,
};
