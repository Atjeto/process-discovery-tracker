"use strict";

/*
 * project-zip.js: Export, Whole project (.zip), in the main process. The open
 * project's folder as one zip next to it, to hand the project to someone.
 * Everything of a project lives in its folder (the recording, the analyst's
 * edits in annotations.json and their backups, the analysis, the video, the
 * transcript, screenshots, attachments and the edited maps), so the zip
 * carries all of it, and extracting it gives the folder back.
 *
 * The writer is zip-folder.js, the copy of the capture app's. This module
 * adds what the viewer needs. (1) The zip never replaces an earlier one:
 * "<name>.zip", else "<name> (2).zip", "<name> (3).zip" (the numbering
 * attachments use). (2) One more try when a file listed as the zip started
 * was gone when its turn came (a save replaces annotations.json through a
 * temporary file). (3) The sentences the analyst reads, and the size.
 */

const fs = require("node:fs");
const path = require("node:path");
const { zipFolder, ZipTooLargeError } = require("./zip-folder.js");
const { freeName } = require("./analyst-files.js");

/* A refusal whose message is already the sentence the analyst reads. */
class ProjectZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectZipError";
  }
}

/* Where the zip of the project at `folder` goes: next to the folder, named
   after it, with a number when that name is taken. `exists` is
   fs.existsSync (a fake in the tests). A folder with nothing above it (the
   top of a drive) is refused: its zip would land inside it. */
function zipTargetFor(folder, exists) {
  const root = path.resolve(folder);
  const parent = path.dirname(root);
  const name = path.basename(root);
  if (!name || parent === root) {
    throw new ProjectZipError("A project at the top of a drive cannot be zipped next to itself: move its folder into another folder first.");
  }
  return path.join(parent, freeName(parent, name + ".zip", exists));
}

/* Zip the project at `folder`. Resolves { zipPath, bytes, entries } (the
   zip-folder.js result); rejects with the writer's error, which
   describeZipError turns into a sentence. deps (the tests): { zipFolder,
   exists }. */
async function zipProject(folder, deps) {
  const zip = (deps && deps.zipFolder) || zipFolder;
  const exists = (deps && deps.exists) || fs.existsSync;
  const root = path.resolve(folder);
  const target = zipTargetFor(root, exists);
  try {
    return await zip(root, target);
  } catch (e) {
    // A file listed when the zip started was gone when its turn came: a save
    // in between replaced annotations.json through a temporary file. Once
    // more from a new listing, while the project is still there; a second
    // failure is the answer.
    if (!(e && e.code === "ENOENT") || !exists(path.join(root, "manifest.json"))) throw e;
    return zip(root, target);
  }
}

/* The sentence the analyst reads after "The zip was not made.". */
function describeZipError(e) {
  if (e instanceof ProjectZipError) return e.message;
  if (e instanceof ZipTooLargeError) {
    return "The project is too large for a zip (over 4 GB, or more than 65,535 files): copy the folder instead.";
  }
  const code = e && e.code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return "A file of the project is open in another program, or the folder that holds the project cannot be written to.";
  }
  if (code === "ENOSPC") return "The disk is full.";
  if (code === "ENOENT") return "A file of the project was not found while it was zipped: was the project folder moved or renamed?";
  const msg = String((e && e.message) || e || "unknown error").trim().replace(/\.$/, "");
  return "Windows reported: " + msg + ".";
}

/* A size the way Explorer shows it: "840 KB", "1.2 GB". */
function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i + 1 < units.length) { n /= 1024; i++; }
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + " " + units[i];
}

module.exports = { zipTargetFor, zipProject, describeZipError, humanSize, ProjectZipError };
