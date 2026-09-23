/*
 * transcript-store.js: the viewer's reads and writes of a session's
 * transcript.json (contract C8). Main process only (node:fs); every function
 * takes an optional `fs` so the unit tests can inject a failing file system.
 *
 * normalization/transcript_import.py writes the file (an import replaces it
 * whole, offset_ms reset to null) and copies the original next to it under
 * transcript/. The viewer only ever:
 *   1. reads it when a session loads (a file that exists but cannot be used
 *      is reported, never treated as a transcript);
 *   2. rewrites its offset_ms when the analyst syncs it (temp file + rename,
 *      like annotations-store.js, every other key kept as it is on disk);
 *   3. deletes it (Remove transcript); the copy under transcript/ stays, so
 *      nothing that cannot be imported again is lost.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const { renameWithRetry } = require("./annotations-store.js");
const { validateTranscript } = require("./transcript-model.js");

const FILE = "transcript.json";

function transcriptPath(root) { return path.join(root, FILE); }

function _fsError(e) {
  return (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e));
}

/* Read the session's transcript.json. Returns one of
     { status: "absent", path }
     { status: "ok", path, transcript }
     { status: "unreadable", path, error }   exists, cannot be used (error: one line) */
function readTranscriptFile(root, fs = nodeFs) {
  const p = transcriptPath(root);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "absent", path: p };
    return { status: "unreadable", path: p, error: _fsError(e) };
  }
  let doc;
  try {
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
  } catch (e) {
    return { status: "unreadable", path: p, error: "it is not valid JSON (" + ((e && e.message) || String(e)) + ")" };
  }
  const why = validateTranscript(doc);
  if (why) return { status: "unreadable", path: p, error: why };
  return { status: "ok", path: p, transcript: doc };
}

/* Set the transcript's offset_ms (a finite number of ms, rounded; null
   clears it). Every other key stays as it is on disk. Returns { path }.
   Throws when there is no usable transcript (nothing is written) and when
   the write fails (the previous file stays in place). */
function saveTranscriptOffset(root, offsetMs, fs = nodeFs) {
  if (offsetMs !== null && (typeof offsetMs !== "number" || !Number.isFinite(offsetMs))) {
    throw new Error("The sync offset is not a number of milliseconds.");
  }
  const read = readTranscriptFile(root, fs);
  if (read.status === "absent") throw new Error("This session has no transcript to sync.");
  if (read.status === "unreadable") throw new Error("The transcript could not be read: " + read.error + ".");
  const doc = read.transcript;
  doc.offset_ms = offsetMs === null ? null : Math.round(offsetMs);
  const text = JSON.stringify(doc, null, 2);
  const tmp = read.path + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(tmp, text);
    renameWithRetry(fs, tmp, read.path);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); }
    catch (cleanupErr) { e.message += " (the temporary file " + tmp + " could not be removed: " + cleanupErr.message + ")"; }
    throw e;
  }
  return { path: read.path };
}

/* Delete transcript.json only; the original under transcript/ stays.
   Returns { path, removed } (removed false when there was no file). */
function removeTranscript(root, fs = nodeFs) {
  const p = transcriptPath(root);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e && e.code === "ENOENT") return { path: p, removed: false };
    throw e;
  }
  return { path: p, removed: true };
}

module.exports = { FILE, transcriptPath, readTranscriptFile, saveTranscriptOffset, removeTranscript };
