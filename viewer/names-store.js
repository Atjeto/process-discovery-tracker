/*
 * names-store.js: the remembered-names store (light vocab, contract C4).
 * Main process only (node:fs); every function takes an optional `fs` so the
 * unit tests can inject a failing file system.
 *
 * File: <viewer userData>/pdt-library/remembered-names.json
 *   { "version": 1,
 *     "names": { "<draft_key>": { "name": "Look up customer", "updated_at": "ISO 8601" } } }
 *
 * Written when the analyst renames a step that carries a draft_key, and by
 * the Remembered names dialog (Rename, Forget); read by the pipeline at draft
 * time (normalize.py --names, passed on every Analyze) and by the viewer for
 * its name suggestions. A draft_key is used whole as the key and never split
 * (a screen label can contain "|").
 *
 * The two rules of annotations-store.js hold here too:
 *   1. A file that exists but cannot be read is UNREADABLE, never "absent",
 *      and is never replaced: the analyst removes or repairs it first (the
 *      error names the file). Treating it as absent would drop every name
 *      remembered so far.
 *   2. A write goes to a temp file in the same folder, which is then renamed
 *      over the store, so a failed write leaves the previous store in place.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const { renameWithRetry } = require("./annotations-store.js");

const LIBRARY_DIR = "pdt-library";
const FILE = "remembered-names.json";
const VERSION = 1;

/* The store's path under a viewer userData folder. */
function namesStorePath(userDataDir) {
  return path.join(userDataDir, LIBRARY_DIR, FILE);
}

/* Read the store. Returns one of
     { status: "absent", path, names: {} }
     { status: "ok", path, names }            names: { draft_key: { name, updated_at } }
     { status: "unreadable", path, error }    exists, cannot be used
   Entries without a non-blank name are left out of `names` (the pipeline
   skips them too). */
function readNamesFile(p, fs = nodeFs) {
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "absent", path: p, names: {} };
    return { status: "unreadable", path: p, error: (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e)) };
  }
  let doc;
  try {
    // Strict like the pipeline's reader: a byte-order mark is not stripped
    // (json.load refuses it), so it reads as unreadable here too.
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf));
  } catch (e) {
    return { status: "unreadable", path: p, error: ((e && e.name) || "Error") + ": " + ((e && e.message) || String(e)) };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.version !== VERSION ||
      !doc.names || typeof doc.names !== "object" || Array.isArray(doc.names)) {
    return { status: "unreadable", path: p, error: "it is not a version " + VERSION + " remembered-names file" };
  }
  const names = {};
  for (const [key, entry] of Object.entries(doc.names)) {
    if (key && entry && typeof entry === "object" && typeof entry.name === "string" && entry.name.trim()) {
      names[key] = { name: entry.name.trim(), updated_at: typeof entry.updated_at === "string" ? entry.updated_at : "" };
    }
  }
  return { status: "ok", path: p, names, raw: doc };
}

class NamesUnreadableError extends Error {
  /* `consequence` says what could not be done; by default a rename. */
  constructor(p, reason, consequence) {
    super("The remembered names file cannot be read (" + reason + "), " +
      (consequence || "so names are not being remembered. Remove or repair the file, then rename the step again.") +
      " File: " + p);
    this.name = "NamesUnreadableError";
    this.code = "NAMES_UNREADABLE";
  }
}

/* Write `text` over the store through a temp file in the same folder, so a
   failed write leaves the previous store in place and no temp file behind. */
function _writeAtomic(p, text, fs) {
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

/* Remember `name` for `draftKey`: every other entry is kept as it is on disk.
   Creates the folder and the file when absent. Returns { path }. Throws
   NamesUnreadableError when the current file cannot be read (it is left
   untouched), and the file-system error when the write fails (the previous
   store stays in place). */
function rememberName(p, draftKey, name, opts) {
  const o = opts || {};
  const fs = o.fs || nodeFs;
  const key = typeof draftKey === "string" ? draftKey : "";
  const nm = typeof name === "string" ? name.trim() : "";
  if (!key) throw new Error("Nothing to remember: the step has no draft key.");
  if (!nm) throw new Error("Nothing to remember: the name is empty.");
  const current = readNamesFile(p, fs);
  if (current.status === "unreadable") throw new NamesUnreadableError(p, current.error);
  // Keep the file's own entries as they are (including any this version does
  // not read); only this key changes.
  const doc = current.status === "ok" ? current.raw : { version: VERSION, names: {} };
  doc.names[key] = { name: nm, updated_at: o.now || new Date().toISOString() };
  _writeAtomic(p, JSON.stringify(doc, null, 2), fs);
  return { path: p };
}

/* Forget the name remembered for `draftKey`, the inverse of rememberName
   (the Remembered names dialog, item 8): its entry is removed and every
   other entry is kept as it is on disk. Returns { path, removed }, removed
   false when there was nothing to forget (nothing is written then). Throws
   NamesUnreadableError when the store cannot be read (it is left untouched),
   and the file-system error when the write fails (the previous store stays
   in place). */
function forgetName(p, draftKey, opts) {
  const fs = (opts && opts.fs) || nodeFs;
  const key = typeof draftKey === "string" ? draftKey : "";
  if (!key) throw new Error("Nothing to forget: no draft key was given.");
  const current = readNamesFile(p, fs);
  if (current.status === "unreadable") {
    throw new NamesUnreadableError(p, current.error, "so the name cannot be forgotten. Remove or repair the file, then try again.");
  }
  if (current.status !== "ok" || !Object.prototype.hasOwnProperty.call(current.raw.names, key)) return { path: p, removed: false };
  delete current.raw.names[key];
  _writeAtomic(p, JSON.stringify(current.raw, null, 2), fs);
  return { path: p, removed: true };
}

module.exports = { LIBRARY_DIR, FILE, VERSION, namesStorePath, readNamesFile, rememberName, forgetName, NamesUnreadableError };
