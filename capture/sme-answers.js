"use strict";

/*
 * sme-answers.js: what the SME gives at the end (contract C24).
 *
 * The end summary asks four optional one-line questions and takes example
 * files, before the zip, so both travel in it:
 *   manifest.sme_answers  { trigger, result, effort, exceptions }, each the
 *                         SME's line trimmed, at most 300 characters; an
 *                         empty answer leaves its key out, four empty
 *                         answers the object.
 *   manifest.sme_files    [{ file, label, added_at }]: each picked file
 *                         copied into the recording's attachments/ (the
 *                         folder the viewer's attachments use, C16), " (2)"
 *                         before the extension when the name is taken; at
 *                         most 20 files, each at most 50 MB.
 *
 * Every write goes through session.updateManifest (one read-modify-write),
 * and the integrity file is written again when there is one, as the name
 * does (session.setSessionLabel), so the list the viewer checks stays true.
 *
 * The handlers (smeHandlers) act only on a recording folder under the
 * recordings folder (session.isRecordingFolder). The page never names a
 * path to write to: the files come from the main process's file dialog,
 * and a removal names an entry of sme_files, deleted only inside that
 * recording's attachments/.
 */

const fs = require("node:fs");
const path = require("node:path");
const { updateManifest, writeSessionIntegrity, isRecordingFolder } = require("./session.js");

/* The questions, in the end summary's order (C24). */
const QUESTIONS = [
  { key: "trigger", label: "What starts this work?" },
  { key: "result", label: "What do you have when it is done?" },
  { key: "effort", label: "How often do you do it, and how long does one take?" },
  { key: "exceptions", label: "What goes differently sometimes, and what do you do then?" },
];
const ANSWER_MAX = 300;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ATTACHMENTS = "attachments";

/* The answers as the manifest keeps them: the four keys in order, each a
   trimmed line of at most ANSWER_MAX characters, empty ones left out; null
   when nothing is left. Anything else the page sends is ignored. */
function cleanAnswers(answers) {
  const src = answers && typeof answers === "object" ? answers : {};
  const out = {};
  for (const { key } of QUESTIONS) {
    const v = typeof src[key] === "string" ? src[key] : "";
    const line = v.replace(/\s+/g, " ").trim().slice(0, ANSWER_MAX).trim();
    if (line) out[key] = line;
  }
  return Object.keys(out).length ? out : null;
}

/* A file name not yet in `taken` (compared without case, as Windows does):
   the name itself, else " (2)", " (3)"... before the extension. */
function uniqueName(name, taken) {
  const used = new Set(Array.from(taken || [], (n) => String(n).toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  const suffix = ext && ext !== name ? ext : "";
  for (let i = 2; ; i += 1) {
    const candidate = stem + " (" + i + ")" + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/* "60 MB", "50.4 MB". */
function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
}

const LIMITS = { maxFiles: MAX_FILES, maxBytes: MAX_FILE_BYTES };

/* Why a file cannot be added, in a sentence naming it, or null when it can:
   `count` is the number of example files the recording holds already. */
function refusal({ name, size }, count, limits = LIMITS) {
  if (count >= limits.maxFiles) {
    return '"' + name + '" was not added: a recording holds at most ' + limits.maxFiles + " example files.";
  }
  if (size > limits.maxBytes) {
    return '"' + name + '" was not added: it is ' + megabytes(size) +
      ", and an example file can be at most " + megabytes(limits.maxBytes) + ".";
  }
  return null;
}

function readManifest(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8"));
  } catch (_) {
    return null;
  }
}

function smeFilesOf(manifest) {
  const list = manifest && Array.isArray(manifest.sme_files) ? manifest.sme_files : [];
  return list.filter((f) => f && typeof f.file === "string");
}

function refreshIntegrity(folder) {
  if (fs.existsSync(path.join(folder, "session-integrity.json"))) writeSessionIntegrity(folder);
}

/* Write the answers on the manifest; returns what was kept (or null). */
function setSmeAnswers(folder, answers) {
  const clean = cleanAnswers(answers);
  const wrote = updateManifest(folder, (m) => {
    if (clean) m.sme_answers = clean;
    else delete m.sme_answers;
  });
  if (wrote) refreshIntegrity(folder);
  return clean;
}

/* Copy the picked files into <folder>/attachments/ and list them in
   sme_files. Resolves { files, refused }: files is sme_files as it now is,
   refused one sentence per file not added. `limits` is for the tests. */
async function addSmeFiles(folder, sourcePaths, limits = LIMITS) {
  const dir = path.join(folder, ATTACHMENTS);
  const current = smeFilesOf(readManifest(folder));
  let count = current.length;
  let taken = [];
  try { taken = fs.readdirSync(dir); } catch (_) { /* no attachments yet */ }
  const added = [];
  const refused = [];
  for (const src of Array.isArray(sourcePaths) ? sourcePaths : []) {
    if (typeof src !== "string" || !src) continue;
    const name = path.basename(src);
    let size;
    try {
      const st = fs.statSync(src);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch (_) {
      refused.push('"' + name + '" was not added: it could not be read.');
      continue;
    }
    const why = refusal({ name, size }, count, limits);
    if (why) { refused.push(why); continue; }
    const file = uniqueName(name, taken);
    try {
      fs.mkdirSync(dir, { recursive: true });
      await fs.promises.copyFile(src, path.join(dir, file), fs.constants.COPYFILE_EXCL);
    } catch (_) {
      refused.push('"' + name + '" was not added: it could not be copied.');
      continue;
    }
    taken.push(file);
    count += 1;
    added.push({ file, label: name, added_at: new Date().toISOString() });
  }
  if (added.length) {
    updateManifest(folder, (m) => {
      m.sme_files = smeFilesOf(m).concat(added);
    });
    refreshIntegrity(folder);
  }
  return { files: smeFilesOf(readManifest(folder)), refused };
}

/* Take one example file out: only a `file` listed in sme_files, only inside
   <folder>/attachments/. Returns sme_files as it now is. */
function removeSmeFile(folder, file) {
  const listed = smeFilesOf(readManifest(folder));
  const ok = typeof file === "string" && file && path.basename(file) === file &&
    file !== "." && file !== ".." && listed.some((f) => f.file === file);
  if (!ok) return listed;
  const dir = path.join(folder, ATTACHMENTS);
  const target = path.join(dir, file);
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) return listed;
  fs.rmSync(target, { force: true });
  updateManifest(folder, (m) => {
    const left = smeFilesOf(m).filter((f) => f.file !== file);
    if (left.length) m.sme_files = left;
    else delete m.sme_files;
  });
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (_) { /* not there or not empty: it stays */ }
  refreshIntegrity(folder);
  return smeFilesOf(readManifest(folder));
}

/* The end summary's three handlers, for main.js to register. Each checks the
   folder first. `pickFiles(event)` opens the file dialog and resolves the
   picked paths (none when cancelled). */
function smeHandlers({ getBaseDir, pickFiles, log }) {
  const note = typeof log === "function" ? log : () => {};
  const allowed = (folder) => isRecordingFolder(getBaseDir(), folder);
  return {
    setAnswers(_e, folder, answers) {
      if (!allowed(folder)) return false;
      try {
        setSmeAnswers(folder, answers);
        return true;
      } catch (e) {
        note(`setSmeAnswers failed: ${e && e.message}`);
        return false;
      }
    },
    async addFiles(e, folder) {
      if (!allowed(folder)) return { ok: false, files: [], refused: ["This is not a recording folder."] };
      try {
        const picked = await pickFiles(e);
        if (!picked || !picked.length) return { ok: true, files: smeFilesOf(readManifest(folder)), refused: [] };
        const r = await addSmeFiles(folder, picked);
        return { ok: true, files: r.files, refused: r.refused };
      } catch (err) {
        note(`addSmeFiles failed: ${err && (err.stack || err.message)}`);
        return { ok: false, files: smeFilesOf(readManifest(folder)), refused: ["The files could not be added."] };
      }
    },
    removeFile(_e, folder, file) {
      if (!allowed(folder)) return { ok: false, files: [] };
      try {
        return { ok: true, files: removeSmeFile(folder, file) };
      } catch (err) {
        note(`removeSmeFile failed: ${err && err.message}`);
        return { ok: false, files: smeFilesOf(readManifest(folder)) };
      }
    },
  };
}

module.exports = {
  QUESTIONS,
  ANSWER_MAX,
  MAX_FILES,
  MAX_FILE_BYTES,
  megabytes,
  cleanAnswers,
  uniqueName,
  refusal,
  setSmeAnswers,
  addSmeFiles,
  removeSmeFile,
  smeHandlers,
};
