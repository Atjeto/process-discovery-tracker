/*
 * field-refusal.js: a refused entry says why beside its field (lane A-2,
 * audit A18).
 *
 * When the app refuses what was typed in a field (a time outside what the
 * steps beside it allow, a text that is no time, an empty step name) the
 * message goes, and the field shows its old value again. The reason then
 * stays where the person looks: a line under the field's line (role
 * "alert", 12 px), the field aria-invalid="true" and aria-describedby that
 * line, until the next edit of that field (an input event), as well as in
 * the message it gives today.
 *
 * A refusal is kept by a key (the caller's: the field and what it is for,
 * such as "step:<id>:start"), so a field drawn again (the editor draws
 * itself again on many changes) shows it again: renew(field, key) at the
 * wiring. One helper for every field: show, clear, renew.
 */

"use strict";

const _held = new Map();   // key -> text
let _seq = 0;

/* The line the reason goes under: the line that holds the field (a
   transaction's times, the step's line of facts, the Timeline's row), else
   the field itself (a step's name: the line goes under it, in its box). */
const LINES = ".run-times, #step-facts, #tl-row";
function _lineOf(field) {
  return (field.closest && field.closest(LINES)) || field;
}

/* An element of the page (not a test's stand-in). */
const _inPage = (field) => !!field && typeof document !== "undefined" && typeof field.getAttribute === "function" &&
  typeof field.insertAdjacentElement === "function";

function _noteOf(field) {
  const id = field.getAttribute("aria-describedby");
  const el = id ? document.getElementById(id) : null;
  return el && el.classList.contains("field-refusal") ? el : null;
}

/* Say `text` beside `field` until its next edit; `key` keeps it across a
   draw of the field. Returns the line. */
function show(field, text, key) {
  if (!text) return null;
  if (key) _held.set(key, String(text));
  // A field drawn again while its check ran: the one that carries the key.
  if (!field && key && typeof document !== "undefined") {
    field = [...document.querySelectorAll("[data-refusal-key]")].find((el) => el.dataset.refusalKey === key) || null;
  }
  if (!_inPage(field)) return null;
  let note = _noteOf(field);
  if (!note && key) {
    // The line of a field drawn before, left in the page: one line a field.
    for (const old of document.querySelectorAll(".field-refusal")) if (old.dataset.key === key) old.remove();
  }
  if (!note) {
    note = document.createElement("div");
    note.className = "field-refusal";
    if (key) note.dataset.key = key;
    note.id = (field.id ? field.id : "field") + "-refused-" + (++_seq);
    note.setAttribute("role", "alert");
    const line = _lineOf(field);
    if (line === field) field.insertAdjacentElement("afterend", note);
    else line.insertAdjacentElement("afterend", note);
    field.setAttribute("aria-describedby", note.id);
    const off = () => { clear(field, key); field.removeEventListener("input", off); };
    field.addEventListener("input", off);
  }
  note.textContent = String(text);
  field.setAttribute("aria-invalid", "true");
  return note;
}

/* Take the reason away (the field was edited, or what it holds was saved). */
function clear(field, key) {
  if (key) _held.delete(key);
  if (!_inPage(field)) return;
  const note = _noteOf(field);
  if (note) note.remove();
  field.removeAttribute("aria-invalid");
  if (note) field.removeAttribute("aria-describedby");
}

/* A field drawn again: the reason it was refused with, when it still holds. */
function renew(field, key) {
  if (!field || !key) return;
  if (field.dataset) field.dataset.refusalKey = key;
  if (_held.has(key)) show(field, _held.get(key), key);
}

/* Forget every reason (another project was opened). */
function forgetAll() {
  _held.clear();
}

/* The reason held for `key`, or null. Pure (for the tests). */
function heldFor(key) {
  return _held.has(key) ? _held.get(key) : null;
}

module.exports = { show, clear, renew, forgetAll, heldFor };
