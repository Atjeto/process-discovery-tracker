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
  "(unzip the SME's zip first: right-click it, Extract All), or a project made with New.";

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

/* An error that came back over IPC, in its own words: Electron's prefix
   and the "Error: " of the error's name taken off. */
function ipcErrorText(e) {
  const msg = String((e && e.message) || e || "");
  return msg.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(?:[A-Za-z]*Error:\s*)+/, "").trim() ||
    "no reason was given";
}

module.exports = { MANIFEST, NOT_A_PROJECT, resolveProjectFolder, ipcErrorText };
