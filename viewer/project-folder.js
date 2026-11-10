"use strict";

/*
 * project-folder.js: which folder a chosen folder opens (lane FX2, validation
 * pass 3, F7). The SME's end summary makes a zip whose root is the recording
 * folder, and Windows' Extract All puts it in a folder named after the zip,
 * so the analyst often chooses that outer folder: it holds no manifest.json,
 * only the recording folder. A chosen folder that holds exactly one project
 * folder opens that one; any other folder without a manifest.json is refused
 * with a sentence that says what to open instead.
 *
 * With it, the words of an error that came back over IPC without Electron's
 * own prefix ("Error invoking remote method 'viewer:loadSession': Error: "),
 * which is no sentence for the analyst.
 *
 * Main process (resolveProjectFolder reads the disk through an `fs` that the
 * unit tests may replace) and renderer (ipcErrorText, pure).
 */

const nodeFs = require("node:fs");
const path = require("node:path");

const MANIFEST = "manifest.json";

/* The sentence for a folder that is no project and holds none. */
const NOT_A_PROJECT = "This folder is not a project: it has no manifest.json. Open the recording folder the SME sent " +
  "(the SME's zip itself opens with Open a zip...), or a project made with New.";

function _isProject(dir, fs) {
  try { return fs.statSync(path.join(dir, MANIFEST)).isFile(); } catch (_) { return false; }
}

/* The project folder `dir` opens: { folder, inner } where inner is true when
   it is the one project folder inside `dir` (the folder Extract All makes).
   Throws an Error with a sentence when `dir` is not a folder, or is no
   project and holds none, or holds several (the analyst picks one). */
function resolveProjectFolder(dir, fs = nodeFs) {
  const root = path.resolve(String(dir || ""));
  let st = null;
  try { st = fs.statSync(root); } catch (_) { st = null; }
  if (!st || !st.isDirectory()) throw new Error("The project folder was not found: " + root);
  if (_isProject(root, fs)) return { folder: root, inner: false };
  let names = [];
  try { names = fs.readdirSync(root); } catch (_) { names = []; }
  const inside = names.map((n) => path.join(root, n)).filter((p) => {
    try { return fs.statSync(p).isDirectory() && _isProject(p, fs); } catch (_) { return false; }
  });
  if (inside.length === 1) return { folder: inside[0], inner: true };
  if (inside.length > 1) {
    throw new Error("This folder holds " + inside.length + " recordings: open one of them (" +
      inside.map((p) => path.basename(p)).join(", ") + ").");
  }
  throw new Error(NOT_A_PROJECT + " Folder: " + root);
}

/* Lane B4c: the page shown while no project is open takes dropped files.
   The paths of a drop's files (`dataTransfer`, the drop event's): each
   File's path through `pathOf` (Electron's webUtils.getPathForFile; the File
   object has no path of its own since Electron 32); a File with no path on
   disk is left out. Renderer, pure. */
function dropPaths(dataTransfer, pathOf) {
  const files = dataTransfer && dataTransfer.files ? Array.from(dataTransfer.files) : [];
  const out = [];
  for (const f of files) {
    let p = "";
    try { p = pathOf(f) || ""; } catch (_) { p = ""; }
    if (p) out.push(p);
  }
  return out;
}

/* Whether a drag carries files (a text dragged in the page does not). */
function dragHasFiles(dataTransfer) {
  const types = dataTransfer && dataTransfer.types ? Array.from(dataTransfer.types) : [];
  return types.includes("Files");
}

/* The sentence for a drop the page does not take. */
const DROP_TAKES = "This page takes a project folder, a zip, or a video with its transcript: drop one of them.";

/* What a drop on that page opens, read from its paths (`isDir(p)`: whether a
   path is a folder): { kind: "folder", path } (one folder: it opens as Open
   project... does), { kind: "zip", path } (one zip: as Open a zip...),
   { kind: "videos", paths } (videos, with or without transcripts: as New
   project from a video..., from its name dialog on), or { kind: "none",
   error } (the sentence to show). Pure. */
function dropKind(paths, isDir) {
  const ps = (paths || []).filter((p) => typeof p === "string" && p);
  if (!ps.length) return { kind: "none", error: DROP_TAKES };
  const dirs = ps.filter((p) => isDir(p));
  if (dirs.length) return dirs.length === 1 && ps.length === 1 ? { kind: "folder", path: ps[0] } : { kind: "none", error: DROP_TAKES };
  if (ps.length === 1 && /\.zip$/i.test(ps[0])) return { kind: "zip", path: ps[0] };
  const NP = require("./new-project.js");
  const picked = NP.sortPicked(ps);
  if (picked.others.length) return { kind: "none", error: DROP_TAKES };
  if (!picked.videos.length) return { kind: "none", error: "A transcript goes with the video it was said in: drop the video with it." };
  return { kind: "videos", paths: ps };
}

/* An error that came back over IPC, in its own words: Electron's prefix
   and the "Error: " of the error's name taken off. */
function ipcErrorText(e) {
  const msg = String((e && e.message) || e || "");
  return msg.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(?:[A-Za-z]*Error:\s*)+/, "").trim() ||
    "no reason was given";
}

module.exports = { MANIFEST, NOT_A_PROJECT, DROP_TAKES, resolveProjectFolder, ipcErrorText, dropPaths, dragHasFiles, dropKind };
