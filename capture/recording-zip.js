"use strict";

/*
 * recording-zip.js: which zip is a recording's, and what it is called.
 *
 * The end summary's "Make a zip for the analyst" names the zip after the
 * recording: the name the SME typed just above the button (manifest.json's
 * `label`), made safe for Windows, so the file in the analyst's mail says
 * what it is (lane LF-SME, live finding 23). The time stamp only when the
 * recording has no name, or when another recording's zip already has that
 * name. The zip's root folder stays the time stamp folder, as before.
 *
 * Which zips are a recording's is read from the zip itself: its first entry
 * is the recording folder ("20260924-101500/", zip-folder.js writes it
 * first), so a zip made under an earlier name is still found, replaced by
 * the next zip, counted in the storage total and deleted with the recording.
 *
 * The writer itself, zip-folder.js, is unchanged: the viewer keeps a copy of
 * it that must stay the same (viewer/project-zip.test.js).
 */

const fs = require("node:fs");
const path = require("node:path");
const { zipFolder } = require("./zip-folder.js");

const MAX_NAME = 80;

/* A recording's name as a file name: the characters Windows refuses in a
   name become spaces, runs of spaces one, no trailing dot or space, at most
   MAX_NAME characters. Empty when nothing usable is left, or a device name. */
function safeFileName(label) {
  let s = String(label || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME).trim();
  s = s.replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) return "";
  return s;
}

/* The name the SME gave the recording (manifest.json's label), or "". */
function recordingLabel(folder) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8"));
    return typeof m.label === "string" ? m.label : "";
  } catch (_) {
    return "";
  }
}

/* The name of a zip's first entry (a recording zip starts with its folder,
   "20260924-101500/"), or null for anything else. */
function zipRootOf(zipFile) {
  let fd = null;
  try {
    fd = fs.openSync(zipFile, "r");
    const head = Buffer.alloc(30 + 260);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n < 30 || head.readUInt32LE(0) !== 0x04034b50) return null;
    const len = head.readUInt16LE(26);
    if (30 + len > n) return null;
    return head.slice(30, 30 + len).toString("utf8");
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* already closed */ } }
  }
}

/* Every zip next to a recording folder that holds that folder. */
function zipsOf(folder) {
  const clean = path.resolve(folder);
  const dir = path.dirname(clean);
  const root = path.basename(clean) + "/";
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter((n) => n.toLowerCase().endsWith(".zip"))
    .map((n) => path.join(dir, n))
    .filter((z) => zipRootOf(z) === root);
}

/* Where a recording's zip goes: next to its folder, named after the
   recording; the time stamp without a name, or beside it when another
   recording's zip has taken the name. */
function recordingZipPath(folder) {
  const clean = path.resolve(folder);
  const dir = path.dirname(clean);
  const stamp = path.basename(clean);
  const name = safeFileName(recordingLabel(clean));
  if (!name) return path.join(dir, stamp + ".zip");
  const named = path.join(dir, name + ".zip");
  if (fs.existsSync(named) && zipRootOf(named) !== stamp + "/") {
    return path.join(dir, name + " " + stamp + ".zip");
  }
  return named;
}

/* Make the recording's zip (zip-folder.js), then remove one made before
   under another name: one zip per recording. Resolves like zipFolder. */
async function zipRecording(folder) {
  const target = recordingZipPath(folder);
  const r = await zipFolder(folder, target);
  for (const older of zipsOf(folder)) {
    if (path.resolve(older) !== path.resolve(target)) {
      try { fs.rmSync(older, { force: true }); } catch (_) { /* in use: it stays, harmless */ }
    }
  }
  return r;
}

module.exports = { safeFileName, recordingLabel, zipRootOf, zipsOf, recordingZipPath, zipRecording };
