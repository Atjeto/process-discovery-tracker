/*
 * processes-store.js: the saved processes (light template, contract C5).
 * Main process only (node:fs); every function takes an optional `fs` so the
 * unit tests can inject a failing file system.
 *
 * File: <viewer userData>/pdt-library/processes.json
 *   { "version": 1,
 *     "processes": [ {
 *         "id": "proc-<uuid>", "name": "Incident logging", "saved_at": "ISO 8601",
 *         "source_session_id": "<session_id>",
 *         "steps": [ { "draft_key": "...", "name": "...", "description": "...", "waste": false } ]
 *     } ] }
 * A step carries draft_key (a drafted step), or draft_keys (merged drafts,
 * their keys in order), or neither (a step added by hand).
 *
 * Written by "Save as this process" on a confirmed pattern run (and its
 * Undo); read by the viewer when a session opens, to compare it with the
 * closest saved process. The pipeline never reads it.
 *
 * The rules of names-store.js hold here too: a file that exists but cannot
 * be read is UNREADABLE (never "absent") and is never replaced, and a write
 * goes to a temp file that is renamed over the store, so a failed write
 * leaves the previous store in place.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { renameWithRetry } = require("./annotations-store.js");

const LIBRARY_DIR = "pdt-library";
const FILE = "processes.json";
const VERSION = 1;

function processesStorePath(userDataDir) {
  return path.join(userDataDir, LIBRARY_DIR, FILE);
}

function _keyList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === "string" && k !== "") ? v : null;
}

/* A saved step as stored: the draft identity, a name, a description and the
   waste flag. Null for something that is not a step. */
function _cleanStep(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const out = {};
  if (typeof s.draft_key === "string" && s.draft_key) out.draft_key = s.draft_key;
  else if (_keyList(s.draft_keys)) out.draft_keys = s.draft_keys.slice();
  out.name = typeof s.name === "string" ? s.name.trim() : "";
  out.description = typeof s.description === "string" ? s.description : "";
  out.waste = s.waste === true;
  return out;
}

function _isProcess(p) {
  return !!(p && typeof p === "object" && !Array.isArray(p) && typeof p.id === "string" && p.id &&
    typeof p.name === "string" && p.name.trim() && Array.isArray(p.steps));
}

/* Read the store. Returns one of
     { status: "absent", path, processes: [] }
     { status: "ok", path, processes, raw }     processes: the entries this version reads
     { status: "unreadable", path, error } */
function readProcessesFile(p, fs = nodeFs) {
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "absent", path: p, processes: [] };
    return { status: "unreadable", path: p, error: (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e)) };
  }
  let doc;
  try {
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf));
  } catch (e) {
    return { status: "unreadable", path: p, error: ((e && e.name) || "Error") + ": " + ((e && e.message) || String(e)) };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.version !== VERSION || !Array.isArray(doc.processes)) {
    return { status: "unreadable", path: p, error: "it is not a version " + VERSION + " saved processes file" };
  }
  const processes = doc.processes.filter(_isProcess).map((x) => ({
    id: x.id, name: x.name.trim(), saved_at: typeof x.saved_at === "string" ? x.saved_at : "",
    source_session_id: typeof x.source_session_id === "string" ? x.source_session_id : "",
    steps: x.steps.map(_cleanStep).filter(Boolean),
  }));
  return { status: "ok", path: p, processes, raw: doc };
}

class ProcessesUnreadableError extends Error {
  constructor(p, reason) {
    super("The saved processes file cannot be read (" + reason + "), so nothing is saved in it. " +
      "Remove or repair the file, then try again. File: " + p);
    this.name = "ProcessesUnreadableError";
    this.code = "PROCESSES_UNREADABLE";
  }
}

function _writeAtomic(p, doc, fs) {
  const text = JSON.stringify(doc, null, 2);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(tmp, text);
    renameWithRetry(fs, tmp, p);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); }
    catch (cleanupErr) { e.message += " (the temporary file " + tmp + " could not be removed: " + cleanupErr.message + ")"; }
    throw e;
  }
}

/* The current document to change, or a new one; throws for an unreadable
   store (which is left untouched). */
function _docForWrite(p, fs) {
  const current = readProcessesFile(p, fs);
  if (current.status === "unreadable") throw new ProcessesUnreadableError(p, current.error);
  return current.status === "ok" ? current.raw : { version: VERSION, processes: [] };
}

const _sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/* "Save as this process": store `steps` under `name`. A saved process with
   the same name (case does not matter) is replaced and keeps its id; else a
   new one is added. Every other entry is kept as it is on disk. Returns
   { path, id, previous } where previous is the replaced entry as it was, or
   null. Throws for an empty name, no steps, an unreadable store, or a failed
   write (the previous store stays in place). */
function saveProcess(p, payload, opts) {
  const o = opts || {};
  const fs = o.fs || nodeFs;
  const name = payload && typeof payload.name === "string" ? payload.name.trim() : "";
  const steps = (payload && Array.isArray(payload.steps) ? payload.steps : []).map(_cleanStep).filter(Boolean);
  if (!name) throw new Error("Nothing to save: the process has no name.");
  if (!steps.length) throw new Error("Nothing to save: the run has no steps.");
  const doc = _docForWrite(p, fs);
  const at = doc.processes.findIndex((x) => _isProcess(x) && _sameName(x.name, name));
  const previous = at >= 0 ? JSON.parse(JSON.stringify(doc.processes[at])) : null;
  const entry = {
    id: previous ? previous.id : "proc-" + (o.uuid || crypto.randomUUID()),
    name,
    saved_at: o.now || new Date().toISOString(),
    source_session_id: payload && typeof payload.sourceSessionId === "string" ? payload.sourceSessionId : "",
    steps,
  };
  if (at >= 0) doc.processes[at] = entry; else doc.processes.push(entry);
  _writeAtomic(p, doc, fs);
  return { path: p, id: entry.id, previous };
}

/* Undo a save: the replaced entry `previous` comes back in place of `id`, or,
   when the save added `id`, it is removed. Returns { path, changed }. */
function undoSaveProcess(p, payload, opts) {
  const fs = (opts && opts.fs) || nodeFs;
  const id = payload && typeof payload.id === "string" ? payload.id : "";
  const previous = payload && payload.previous && typeof payload.previous === "object" ? payload.previous : null;
  if (!id) throw new Error("Nothing to undo: no saved process was named.");
  const doc = _docForWrite(p, fs);
  const at = doc.processes.findIndex((x) => x && x.id === id);
  if (at < 0 && !previous) return { path: p, changed: false };
  if (previous) {
    if (at >= 0) doc.processes[at] = previous; else doc.processes.push(previous);
  } else {
    doc.processes.splice(at, 1);
  }
  _writeAtomic(p, doc, fs);
  return { path: p, changed: true };
}

module.exports = {
  LIBRARY_DIR, FILE, VERSION, processesStorePath, readProcessesFile, saveProcess, undoSaveProcess,
  ProcessesUnreadableError,
};
