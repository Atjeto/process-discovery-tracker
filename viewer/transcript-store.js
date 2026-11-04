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
 *   3. takes it out (Remove transcript, lane CC): transcript.json and the
 *      originals under transcript/ (transcriptFiles) leave the folder
 *      together, parked for an Undo (main.js, analyst-files.js parkFiles),
 *      which brings them all back.
 * Contract C23 (2.0.6): a project holds several transcripts, one per video
 * of its chain: transcript.json, then transcript-2.json, transcript-3.json
 * and on (nextTranscriptFile), each with its own original. Every function
 * takes the file it acts on (transcript.json when none is given). A
 * transcript of a video carries `video_id` (the video's id in
 * annotations.external_videos), and its offset_ms is then counted from that
 * video's own start (transcript-model.js), so it moves with its video.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const { renameWithRetry } = require("./annotations-store.js");
const { validateTranscript } = require("./transcript-model.js");

const FILE = "transcript.json";
const NAMED = /^transcript(?:-(\d+))?\.json$/;

function transcriptPath(root, file) { return path.join(root, file || FILE); }

/* The transcript files of a project, in their order: transcript.json first,
   then transcript-2.json and on. */
function transcriptFileNames(root, fs = nodeFs) {
  let names = [];
  try { names = fs.readdirSync(root); } catch (_) { return []; }
  return names.filter((n) => NAMED.test(n))
    .sort((a, b) => Number((NAMED.exec(a)[1]) || 1) - Number((NAMED.exec(b)[1]) || 1));
}

/* The file a new transcript is written to: transcript.json, else the first
   free transcript-N.json. */
function nextTranscriptFile(root, fs = nodeFs) {
  if (!fs.existsSync(transcriptPath(root, FILE))) return FILE;
  for (let n = 2; ; n++) if (!fs.existsSync(transcriptPath(root, "transcript-" + n + ".json"))) return "transcript-" + n + ".json";
}

/* Whether `file` names a transcript file of a project. */
function isTranscriptFile(file) { return typeof file === "string" && NAMED.test(file); }

function _fsError(e) {
  return (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e));
}

/* Read the session's transcript.json. Returns one of
     { status: "absent", path }
     { status: "ok", path, transcript }
     { status: "unreadable", path, error }   exists, cannot be used (error: one line) */
function readTranscriptFile(root, fs = nodeFs, file = FILE) {
  const p = transcriptPath(root, file);
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

/* Every transcript of the project: [{ file, ...readTranscriptFile }]. */
function readTranscriptFiles(root, fs = nodeFs) {
  return transcriptFileNames(root, fs).map((file) => Object.assign({ file }, readTranscriptFile(root, fs, file)));
}

/* Set the transcript's offset_ms (a finite number of ms, rounded; null
   clears it). Every other key stays as it is on disk. Returns { path }.
   Throws when there is no usable transcript (nothing is written) and when
   the write fails (the previous file stays in place). */
function saveTranscriptOffset(root, offsetMs, fs = nodeFs, file = FILE) {
  if (offsetMs !== null && (typeof offsetMs !== "number" || !Number.isFinite(offsetMs))) {
    throw new Error("The sync offset is not a number of milliseconds.");
  }
  return patchTranscript(root, { offset_ms: offsetMs === null ? null : Math.round(offsetMs) }, fs, file);
}

/* Set some keys of a transcript (offset_ms, video_id; C23), every other key
   kept as it is on disk; a key set to undefined is taken out. Returns
   { path }. Throws as saveTranscriptOffset. */
function patchTranscript(root, patch, fs = nodeFs, file = FILE) {
  if (!isTranscriptFile(file)) throw new Error("That is not a transcript of this project.");
  const read = readTranscriptFile(root, fs, file);
  if (read.status === "absent") throw new Error("This project has no transcript to sync.");
  if (read.status === "unreadable") throw new Error("The transcript could not be read: " + read.error + ".");
  const doc = read.transcript;
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) delete doc[k]; else doc[k] = v;
  }
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

/* The files one transcript has in the folder, session-relative with "/":
   its file (transcript.json by default) and its original under transcript/
   (its source_file), unless another transcript names the same original.
   The last transcript of a project takes every file directly in
   transcript/ with it (the originals of earlier imports too). What Remove
   transcript takes out. */
const ORIGINALS_DIR = "transcript";
function transcriptFiles(root, fs = nodeFs, file = FILE) {
  const out = [];
  if (fs.existsSync(transcriptPath(root, file))) out.push(file);
  const others = transcriptFileNames(root, fs).filter((f) => f !== file);
  let names = [];
  try { names = fs.readdirSync(path.join(root, ORIGINALS_DIR), { withFileTypes: true }); }
  catch (e) { if (!e || e.code !== "ENOENT") throw e; }
  if (!others.length) {
    for (const d of names) if (d.isFile()) out.push(ORIGINALS_DIR + "/" + d.name);
    return out;
  }
  const own = readTranscriptFile(root, fs, file);
  const src = own.status === "ok" && typeof own.transcript.source_file === "string" ? own.transcript.source_file : "";
  const named = new Set(others.map((f) => readTranscriptFile(root, fs, f)).filter((r) => r.status === "ok")
    .map((r) => r.transcript.source_file));
  if (src.startsWith(ORIGINALS_DIR + "/") && !named.has(src) && names.some((d) => d.isFile() && ORIGINALS_DIR + "/" + d.name === src)) out.push(src);
  return out;
}

module.exports = {
  FILE, ORIGINALS_DIR, transcriptPath, transcriptFileNames, nextTranscriptFile, isTranscriptFile,
  readTranscriptFile, readTranscriptFiles, saveTranscriptOffset, patchTranscript, transcriptFiles,
};
