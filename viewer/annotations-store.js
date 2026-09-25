/*
 * annotations-store.js: the viewer's reads and writes of a session's
 * annotations.json (RP-04). Main process only (node:fs); every function takes
 * an optional `fs` so the unit tests can inject a failing file system.
 *
 * The two rules (the pipeline keeps the same ones, contract C13 exit code 2):
 *   1. A file that exists but cannot be read is UNREADABLE, never "absent".
 *      Loading reports it, naming the file and its backups, and no writer
 *      may replace it: the analyst restores a backup first. Treating it as
 *      absent is how an edit, a video attach or an Analyze run used to write
 *      a near-empty object over the analyst's work.
 *   2. A write never leaves the session without an annotations.json. The
 *      current file is COPIED into the backup rotation (annotations.json.2
 *      newest to annotations.json.5 oldest); the new content goes to a temp
 *      file in the same folder, which is then renamed over annotations.json.
 *      The old code RENAMED the current file into .2 first, so a failed write
 *      left no annotations.json at all.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");

const FILE = "annotations.json";
const BACKUP_DEPTH = 5;          // annotations.json.2 (newest) .. annotations.json.5 (oldest)
const RENAME_RETRIES = 5;        // Windows: a scanner or indexer can hold the target briefly
const RENAME_RETRY_MS = 40;

function annotationsPath(root) { return path.join(root, FILE); }
function backupName(i) { return FILE + "." + i; }

class AnnotationsUnreadableError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnnotationsUnreadableError";
    this.code = "ANNOTATIONS_UNREADABLE";
  }
}

/* Read the session's annotations.json. Returns one of
     { status: "absent", path }                 no file: a fresh session
     { status: "ok", path, annotations }         an annotations object
     { status: "unreadable", path, error }       exists, cannot be used
   Strict like the pipeline's reader: invalid UTF-8, a byte-order mark, bad
   JSON, or a top level that is not an object all count as unreadable. */
function readAnnotationsFile(root, fs = nodeFs) {
  const p = annotationsPath(root);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "absent", path: p };
    return { status: "unreadable", path: p, error: (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e)) };
  }
  let data;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
    data = JSON.parse(text);
  } catch (e) {
    return { status: "unreadable", path: p, error: ((e && e.name) || "Error") + ": " + ((e && e.message) || String(e)) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const kind = data === null ? "null" : Array.isArray(data) ? "a list" : typeof data;
    return { status: "unreadable", path: p, error: "the top level is " + kind + ", not an object" };
  }
  return { status: "ok", path: p, annotations: data };
}

/* The backups present next to annotations.json, newest first:
   [{ name: "annotations.json.2", mtimeMs }, ...]. A backup that cannot be
   stat'ed is not offered (it could not be restored either). */
function listAnnotationBackups(root, fs = nodeFs) {
  const out = [];
  for (let i = 2; i <= BACKUP_DEPTH; i++) {
    let st = null;
    try {
      st = fs.statSync(path.join(root, backupName(i)));
    } catch (_) {
      // ENOENT: that generation does not exist yet. Any other error: the
      // backup cannot be read, so it is not offered as a way back.
    }
    if (st && st.isFile()) out.push({ name: backupName(i), mtimeMs: st.mtimeMs });
  }
  return out;
}

/* Read one annotations file (the current one or a backup) the way
   readAnnotationsFile does: { status: "ok", annotations } or { status:
   "unreadable", error } (a missing file is unreadable here). */
function _readObject(p, fs) {
  let buf;
  try { buf = fs.readFileSync(p); }
  catch (e) { return { status: "unreadable", error: (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e)) }; }
  let data;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf)); }
  catch (e) { return { status: "unreadable", error: ((e && e.name) || "Error") + ": " + ((e && e.message) || String(e)) }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { status: "unreadable", error: "not an object" };
  return { status: "ok", annotations: data };
}

/* The newest backup that can be read, { name, mtimeMs }, or null: the
   rotation's order (annotations.json.2 is the newest), each one read the way
   annotations.json is. */
function newestReadableBackup(root, fs = nodeFs) {
  for (const b of listAnnotationBackups(root, fs)) {
    if (_readObject(path.join(root, b.name), fs).status === "ok") return b;
  }
  return null;
}

/* The locale a backup's time is written in: the app's, the one the viewer's
   pages write every other date in (the machine's regional format can differ
   from it); the default outside Electron (the unit tests). */
function _timeLocale() {
  try {
    const { app } = require("electron");
    return app && typeof app.getLocale === "function" && app.isReady() ? app.getLocale() : undefined;
  } catch (_) { return undefined; }
}

/* When a backup was saved, as the analyst reads it: this machine's date and
   time, written the way the viewer writes dates. */
function backupTime(mtimeMs, locale) {
  const d = new Date(mtimeMs);
  if (!Number.isFinite(d.getTime())) return "at an unknown time";
  try { return d.toLocaleString(locale === undefined ? _timeLocale() : locale); }
  catch (_) { return d.toLocaleString(); }
}

/* The analyst-facing explanation for an unreadable annotations.json: what is
   wrong, what it means, and how to recover (the newest backup that can be
   read, which the banner's Restore the newest backup puts back). */
function unreadableMessage(root, reason, backups, newest) {
  const names = (backups || []).map((b) => b.name);
  return "The file " + FILE + " in this project folder cannot be read (" + reason + "). " +
    "Your steps, marker changes and notes for this project are not shown, and nothing " +
    "will be saved until the file is fixed. " +
    (newest
      ? "Restore the newest backup puts back " + newest.name + ", saved " + backupTime(newest.mtimeMs) +
        " (backups found, newest first: " + names.join(", ") + "); the file that cannot be read is kept beside it."
      : names.length
        ? "None of the backups found (" + names.join(", ") + ") can be read either."
        : "No backups (" + FILE + ".2 to " + FILE + "." + BACKUP_DEPTH + ") were found in the folder.") +
    " Folder: " + root;
}

/* The load-time report for an unreadable file, or null when the file is
   absent or fine. Shape: { file, reason, backups, newest, message } (newest:
   the newest backup that can be read, { name, mtimeMs, saved }, or null;
   saved is its time as the message writes it, which the banner's confirm
   repeats). */
function annotationsLoadError(read, root, fs = nodeFs) {
  if (!read || read.status !== "unreadable") return null;
  const backups = listAnnotationBackups(root, fs);
  const found = newestReadableBackup(root, fs);
  const newest = found ? Object.assign({}, found, { saved: backupTime(found.mtimeMs) }) : null;
  return { file: read.path, reason: read.error, backups: backups.map((b) => b.name), newest,
    message: unreadableMessage(root, read.error, backups, newest) };
}

/* The name the unreadable file is kept under beside the restored one:
   annotations.unreadable-<YYYYMMDD-HHMMSS>.json (local time), with " (2)",
   ... when that name is taken. */
function keptName(root, nowMs, fs = nodeFs) {
  const d = new Date(nowMs);
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  for (let n = 1; n < 100; n++) {
    const name = "annotations.unreadable-" + stamp + (n === 1 ? "" : " (" + n + ")") + ".json";
    if (!fs.existsSync(path.join(root, name))) return name;
  }
  throw new Error("no free name to keep the unreadable file under");
}

/* Restore the newest backup (the unreadable banner's act): only while
   annotations.json cannot be read. The unreadable file is kept beside it
   (keptName), then the newest backup that can be read is copied into place
   (a temp file renamed over, so annotations.json is never left missing for
   long). `expect` (optional): the backup's name the analyst confirmed; a
   different newest backup refuses (the folder changed meanwhile). Returns
   { backup, mtimeMs, keptAs }; throws with a sentence when it cannot. */
function restoreNewestBackup(root, opts, fs = nodeFs) {
  const o = opts || {};
  const current = readAnnotationsFile(root, fs);
  if (current.status !== "unreadable") throw new Error("the file " + FILE + " can be read, so there is nothing to restore.");
  const newest = newestReadableBackup(root, fs);
  if (!newest) throw new Error("no backup of " + FILE + " can be read.");
  if (o.expect && o.expect !== newest.name) throw new Error("the backups changed since the question was asked; open the project again.");
  const keptAs = keptName(root, Number.isFinite(o.nowMs) ? o.nowMs : Date.now(), fs);
  const target = annotationsPath(root);
  const text = fs.readFileSync(path.join(root, newest.name));
  _renameWithRetry(fs, target, path.join(root, keptAs));
  const tmp = path.join(root, FILE + ".tmp-" + process.pid + "-" + Date.now());
  try {
    fs.writeFileSync(tmp, text);
    _renameWithRetry(fs, tmp, target);
  } catch (e) {
    // Put the unreadable file back where it was: nothing half done stays.
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* reported with e */ }
    try { if (!fs.existsSync(target)) _renameWithRetry(fs, path.join(root, keptAs), target); } catch (_) { /* reported with e */ }
    throw e;
  }
  return { backup: newest.name, mtimeMs: newest.mtimeMs, keptAs };
}

/* Throws AnnotationsUnreadableError when annotations.json exists but cannot be
   read; every writer calls this before replacing the file. Returns the read. */
function assertWritable(root, fs = nodeFs) {
  const read = readAnnotationsFile(root, fs);
  if (read.status === "unreadable") {
    throw new AnnotationsUnreadableError(unreadableMessage(root, read.error, listAnnotationBackups(root, fs),
      newestReadableBackup(root, fs)));
  }
  return read;
}

function _sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function _renameWithRetry(fs, from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const transient = e && (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES");
      if (!transient || attempt >= RENAME_RETRIES) throw e;
      _sleepSync(RENAME_RETRY_MS);
    }
  }
}

/* Copy the current file into the rotation: .4 -> .5, .3 -> .4, .2 -> .3, then
   annotations.json -> .2. Copies only, so annotations.json stays in place.
   Returns null, or the reason the backup could not be made; a failed backup
   does not block the save (the analyst's current work matters more than one
   backup generation), but the caller reports it. */
function _rotateBackups(root, fs) {
  try {
    for (let i = BACKUP_DEPTH - 1; i >= 2; i--) {
      const from = path.join(root, backupName(i));
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(root, backupName(i + 1)));
    }
    fs.copyFileSync(annotationsPath(root), path.join(root, backupName(2)));
    return null;
  } catch (e) {
    return (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e));
  }
}

/* Write `annotations` as the session's annotations.json. Returns
   { path, backupError } (backupError: null, or why the backup copy failed).
   Throws AnnotationsUnreadableError when the current file is unreadable, and
   the file-system error when the write fails; either way the existing
   annotations.json is left exactly as it was. */
function writeAnnotationsFile(root, annotations, fs = nodeFs) {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    throw new Error("Refusing to write annotations: the data is not an annotations object.");
  }
  const text = JSON.stringify(annotations, null, 2);   // a cycle throws here, before any disk change
  const current = assertWritable(root, fs);
  const target = annotationsPath(root);
  const backupError = current.status === "ok" ? _rotateBackups(root, fs) : null;
  const tmp = path.join(root, FILE + ".tmp-" + process.pid + "-" + Date.now());
  try {
    fs.writeFileSync(tmp, text);
    _renameWithRetry(fs, tmp, target);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); }
    catch (cleanupErr) { e.message += " (the temporary file " + tmp + " could not be removed: " + cleanupErr.message + ")"; }
    throw e;
  }
  return { path: target, backupError };
}

module.exports = {
  FILE, BACKUP_DEPTH,
  AnnotationsUnreadableError,
  readAnnotationsFile, listAnnotationBackups, unreadableMessage, annotationsLoadError,
  newestReadableBackup, backupTime, keptName, restoreNewestBackup,
  assertWritable, writeAnnotationsFile,
  // The same temp-then-rename step for the activity library the Library
  // builder saves (main.js viewer:saveLibrary, contract C21).
  renameWithRetry: _renameWithRetry,
};
