"use strict";

/*
 * handoff.js: hand-off versions (lane HV, contract C20). Pure: no DOM, no
 * electron, so the main process, the renderer and the unit tests share it.
 *
 * The owner: a developer builds from a project the analyst hands over, and
 * must not build from a copy that has since changed without knowing it. So a
 * project is handed over as numbered versions, and every copy says which one
 * it is. No sync, no locks, no roles, no comparison.
 *
 * Export, Hand off... (renderer.js) asks what changed, adds one entry to
 * annotations.handoffs,
 *     { version: 2, handed_off_at: "<ISO, UTC>", by: "<Windows user>", note }
 * (an undoable edit: Ctrl+Z takes the entry back, the zip stays), and writes
 * "<project> v2.zip" next to the project folder: the folder, plus at the
 * zip's root "<project> v2 PDD.docx" and "<project> v2 Technical details.xlsx"
 * made for that version (handoff-zip.js). Open project... opens such a zip
 * read only (handoff-open.js), and its line reads
 *     Version 2, handed off 2026-09-25 by rasha · Read only
 * The PDD prints the same words (normalization/handoff_versions.py).
 */

const SessionSummary = require("./session-summary.js");

/* The note the first hand-off's dialog is filled with. */
const FIRST_NOTE = "First hand-off";

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

/* A version number: a positive whole number (never a boolean). */
function _version(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/* The valid entries of annotations.handoffs, in version order (the later of
   two entries with one version counts), as handoff_versions.py reads them. */
function entries(anno) {
  const raw = anno && Array.isArray(anno.handoffs) ? anno.handoffs : [];
  const byVersion = new Map();
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const version = _version(e.version);
    if (version === null) continue;
    byVersion.set(version, { version, handed_off_at: _text(e.handed_off_at), by: _text(e.by), note: _text(e.note) });
  }
  return [...byVersion.keys()].sort((a, b) => a - b).map((v) => byVersion.get(v));
}

/* The latest entry, or null before the first hand-off. */
function latest(anno) {
  const list = entries(anno);
  return list.length ? list[list.length - 1] : null;
}

/* The version the next hand-off gets: one more than the highest. */
function nextVersion(anno) {
  const last = latest(anno);
  return last ? last.version + 1 : 1;
}

/* The entry a hand-off adds. `now` is an ISO time (UTC), `by` the Windows
   user name. */
function newEntry(opts) {
  const o = opts || {};
  return { version: o.version, handed_off_at: String(o.now || ""), by: _text(o.by), note: _text(o.note) };
}

/* The UTC date of an entry's hand-off ("2026-09-25"), or "". */
function entryDate(entry) {
  const at = _text(entry && entry.handed_off_at);
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : "";
}

/* "Version 2, handed off 2026-09-25 by rasha" (handoff_versions.py
   handed_off_line, the same words): the date and the name left out when the
   entry has none. */
function handedOffLine(entry) {
  if (!entry) return "";
  let line = "Version " + entry.version;
  const date = entryDate(entry);
  const by = _text(entry.by);
  if (date) line += ", handed off " + date;
  else if (by) line += ", handed off";
  if (by) line += " by " + by;
  return line;
}

/* The project line of a hand-off opened read only. */
function readOnlyLine(entry) {
  return entry ? handedOffLine(entry) + " · Read only" : "Read only";
}

/* The name the app shows for the project (session-summary.js displayName),
   or the folder's name. */
function projectName(session) {
  const folder = String((session && session.sessionFolder) || "").split(/[\\/]/).filter(Boolean).pop() || "";
  return SessionSummary.displayName(session, folder);
}

/* The characters Windows refuses in a file name, and the control characters. */
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_BASE = 60;

/* A project name made safe as the start of a file or folder name: the
   characters Windows refuses taken out, the spaces collapsed, no dot or
   space at the end, at most MAX_BASE characters; `fallback` (then
   "Project") when nothing is left. */
function safeBase(name, fallback) {
  const clean = (s) => String(s || "").replace(BAD_CHARS, " ").replace(/\s+/g, " ").trim()
    .slice(0, MAX_BASE).replace(/[. ]+$/, "").trim();
  return clean(name) || clean(fallback) || "Project";
}

/* The names of one hand-off's files: the zip beside the project folder and,
   at its root, the PDD and the Technical details. */
function fileNames(base, version) {
  const stem = safeBase(base) + " v" + version;
  return { stem, zip: stem + ".zip", pdd: stem + " PDD.docx", tech: stem + " Technical details.xlsx" };
}

module.exports = {
  FIRST_NOTE, entries, latest, nextVersion, newEntry, entryDate, handedOffLine, readOnlyLine,
  projectName, safeBase, fileNames, MAX_BASE,
};
