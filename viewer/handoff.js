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
 * "<project> v2.zip" next to the project folder: the folder (without the
 * working file's backups and the analysis log), plus at the zip's root
 * "<project> v2 PDD.docx", "<project> v2 Technical details.xlsx" (when
 * something was recorded), "<project> v2 map.svg" and "<project> v2
 * map.bpmn" (when a map can be drawn) and "Start here.txt", made for that
 * version (handoff-zip.js). Open project... opens such a zip
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
   at its root, the PDD, the Technical details, the process map as a picture
   and as BPMN, and the note that says what each is. */
function fileNames(base, version) {
  const stem = safeBase(base) + " v" + version;
  return { stem, zip: stem + ".zip", pdd: stem + " PDD.docx", tech: stem + " Technical details.xlsx",
    mapSvg: stem + " map.svg", mapBpmn: stem + " map.bpmn", startHere: START_HERE };
}

/* The note at a hand-off zip's root, for whoever unzips it without the
   viewer: what each file is. */
const START_HERE = "Start here.txt";
const CRLF = String.fromCharCode(13, 10);
const START_HERE_ROWS = [
  ["pdd", "The process written down. Read this first."],
  ["tech", "For developers: the recorded controls, the data fields and the values of every transaction."],
  ["mapSvg", "The process map as a picture. It opens in a browser."],
  ["mapBpmn", "The process map as BPMN 2.0, for ADONIS, Camunda, Bizagi and similar tools."],
];
const START_HERE_FOLDER = "The whole project: the video, the screenshots, the attachments and the work behind the document.";
const START_HERE_VIEWER = [
  "To look through the project (play each step, see its screenshots and what was said), open the",
  "Process Discovery Tracker viewer, choose Open, then \"Open a zip...\", and pick this",
  "zip. It opens read only.",
];

/* Start here.txt of one hand-off: opts = { base (the project's name),
   version, entry (its annotations.handoffs entry, or null), folder (the
   project folder's name in the zip), has: { tech, mapSvg, mapBpmn } (which
   of those files the zip holds; the PDD always) }. Lines end in CRLF, for
   Notepad. Pure. */
function startHereText(opts) {
  const o = opts || {};
  const names = fileNames(o.base, o.version);
  const has = o.has || {};
  const line = o.entry ? handedOffLine(Object.assign({}, o.entry, { version: o.version })) : "Version " + o.version;
  const rows = START_HERE_ROWS.filter(([k]) => k === "pdd" || has[k]).map(([k, what]) => [names[k], what])
    .concat([[String(o.folder || "") + "\\", START_HERE_FOLDER]]);
  const width = Math.max(...rows.map(([n]) => n.length)) + 3;
  const out = [safeBase(o.base) + ": " + line.charAt(0).toLowerCase() + line.slice(1), "", "In this zip:"]
    .concat(rows.map(([n, what]) => "  " + n.padEnd(width) + what), [""], START_HERE_VIEWER);
  return out.join(CRLF) + CRLF;
}

module.exports = {
  FIRST_NOTE, entries, latest, nextVersion, newEntry, entryDate, handedOffLine, readOnlyLine,
  projectName, safeBase, fileNames, MAX_BASE, START_HERE, startHereText,
};
