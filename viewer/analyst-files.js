/*
 * analyst-files.js: the files the analyst adds to a session folder (contract
 * C16), main process only. Screenshots go to screenshots/analyst/<id>.<png|jpg>
 * and attachments to attachments/<name>; annotations.json names each by its
 * file name only (analyst_screenshots[].file, attachments[].file). Every path
 * is made here from the session folder and a file name, never taken from the
 * renderer as a path.
 *
 * Removing an entry is an annotations edit, so Undo covers it: after each
 * annotations save, a file the previous annotations named and the new ones do
 * not leaves the folder for a holding folder outside it, and a file the new
 * annotations name that is missing comes back from there (moveRemoved). Only
 * files an entry named are ever moved, so a file put in the folder by hand is
 * never touched. The holding folder is emptied when the viewer starts (the
 * undo history does not outlive the app).
 *
 * Every function takes an optional `fs` so the unit tests can use a fake.
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");

const SHOTS_DIR = "screenshots/analyst";
const ATTACH_DIR = "attachments";

/* The last part of a file name written on any machine, or "" when it is not
   a plain name ("..", empty). */
function fileName(p) {
  const n = String(p == null ? "" : p).split(/[\\/]/).filter(Boolean).pop() || "";
  return n === "." || n === ".." ? "" : n;
}

/* The session-relative paths (with "/") of the files an annotations object
   names: its analyst screenshots and its attachments. */
function namedFiles(anno) {
  const out = new Set();
  const a = anno && typeof anno === "object" ? anno : {};
  for (const [key, dir] of [["analyst_screenshots", SHOTS_DIR], ["attachments", ATTACH_DIR]]) {
    for (const e of Array.isArray(a[key]) ? a[key] : []) {
      const n = e && fileName(e.file);
      if (n) out.add(dir + "/" + n);
    }
  }
  return out;
}

/* A file name not taken in `dir`: the name itself, else "stem (2).ext", ... */
function freeName(dir, name, exists) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const cand = n === 1 ? name : stem + " (" + n + ")" + ext;
    if (!exists(path.join(dir, cand))) return cand;
  }
  throw new Error("no free file name for " + name);
}

/* "png" or "jpg" from an image's first bytes, else null. */
function imageKind(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

/* Write an image as screenshots/analyst/<id>.<png|jpg>. Returns { file }.
   Throws when the bytes are not a PNG or JPEG image. */
function writeScreenshot(root, id, buf, fs = nodeFs) {
  const kind = imageKind(buf);
  if (!kind) throw new Error("this is not a PNG or JPEG image");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("the image is larger than 40 MB");
  if (!/^[A-Za-z0-9-]+$/.test(String(id))) throw new Error("bad screenshot id");
  const dir = path.join(root, SHOTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = id + "." + kind;
  fs.writeFileSync(path.join(dir, file), buf);
  return { file };
}

/* Copy a file into attachments/ under a free name. Returns { file }. */
function copyAttachment(root, src, fs = nodeFs) {
  const name = fileName(src);
  if (!name) throw new Error("the file has no name");
  const dir = path.join(root, ATTACH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = freeName(dir, name, (p) => fs.existsSync(p));
  fs.copyFileSync(src, path.join(dir, file));
  return { file };
}

function _move(fs, from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (!e || e.code !== "EXDEV") throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

/* After an annotations save: the files `before` named and `after` does not
   move from the session folder into `holdDir`; the files `after` names that
   are missing from the folder come back from `holdDir` when they are there.
   Returns { removed, restored, errors } (session-relative paths). */
function moveRemoved(root, before, after, holdDir, fs = nodeFs) {
  const out = { removed: [], restored: [], errors: [] };
  for (const rel of before) {
    if (after.has(rel)) continue;
    const from = path.join(root, rel);
    try {
      if (!fs.existsSync(from)) continue;
      _move(fs, from, path.join(holdDir, rel));
      out.removed.push(rel);
    } catch (e) { out.errors.push(rel + ": " + ((e && e.message) || e)); }
  }
  for (const rel of after) {
    const to = path.join(root, rel);
    const held = path.join(holdDir, rel);
    try {
      if (fs.existsSync(to) || !fs.existsSync(held)) continue;
      _move(fs, held, to);
      out.restored.push(rel);
    } catch (e) { out.errors.push(rel + ": " + ((e && e.message) || e)); }
  }
  return out;
}

/* File types an attachment opens with (documents, images, mail); any other
   type is shown in its folder instead, so a file received in a session
   folder never runs as a program from a click. */
const OPENS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".csv", ".txt", ".rtf", ".odt", ".ods",
  ".ppt", ".pptx", ".msg", ".eml", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".vsdx", ".xml", ".json", ".md"]);

/* The attachment `file` of the session at `root`: { ok: true, path, open }
   (open: false means show it in its folder), or { ok: false, error }. */
function attachmentTarget(root, file, exists) {
  const name = fileName(file);
  if (!name || name !== String(file || "").trim()) return { ok: false, error: "not an attachment of this session" };
  const full = path.join(root, ATTACH_DIR, name);
  if (!exists(full)) return { ok: false, error: "the file is not in the session's attachments folder" };
  return { ok: true, path: full, open: OPENS.has(path.extname(name).toLowerCase()) };
}

module.exports = {
  SHOTS_DIR, ATTACH_DIR, fileName, namedFiles, freeName, imageKind, writeScreenshot, copyAttachment,
  moveRemoved, attachmentTarget,
};
