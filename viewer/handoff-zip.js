"use strict";

/*
 * handoff-zip.js: the zip of one hand-off (lane HV, contract C20), in the
 * main process. "<project> v<N>.zip", next to the project folder, holds what
 * Export, Whole project (.zip) holds (the project folder as its root folder,
 * zip-folder.js) and, at the zip's root beside that folder, the two files
 * made for this version: "<project> v<N> PDD.docx" and "<project> v<N>
 * Technical details.xlsx".
 *
 * zip-folder.js stays the capture app's copy (project-zip.test.js holds the
 * two alike), so the two files are appended to the zip it writes: their
 * entries go where its central directory began, then the central directory
 * again with theirs added, then a new end record (the same PKZIP 2.0 format,
 * UTF-8 names). The zip is built as "<name>.zip.building" and renamed only
 * when complete, so no half zip ever carries the final name, and it never
 * replaces a zip: a name that is taken gets " (2)", " (3)" (the numbering the
 * Whole project zip uses).
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { zipFolder, crc32, dosDateTime, STORED_EXTENSIONS, ZipTooLargeError } = require("./zip-folder.js");
const { freeName } = require("./analyst-files.js");
const { ProjectZipError } = require("./project-zip.js");
const Handoff = require("./handoff.js");

const MAX32 = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const EOCD_SIG = 0x06054b50;

function _tooLarge() {
  return new ZipTooLargeError("The hand-off is too large for a zip (over 4 GB).");
}

function _local(e) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(VERSION, 4);
  h.writeUInt16LE(UTF8_FLAG, 6);
  h.writeUInt16LE(e.method, 8);
  h.writeUInt16LE(e.time, 10);
  h.writeUInt16LE(e.date, 12);
  h.writeUInt32LE(e.crc, 14);
  h.writeUInt32LE(e.csize, 18);
  h.writeUInt32LE(e.usize, 22);
  h.writeUInt16LE(e.nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return h;
}

function _central(e) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(VERSION, 4);
  h.writeUInt16LE(VERSION, 6);
  h.writeUInt16LE(UTF8_FLAG, 8);
  h.writeUInt16LE(e.method, 10);
  h.writeUInt16LE(e.time, 12);
  h.writeUInt16LE(e.date, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.csize, 20);
  h.writeUInt32LE(e.usize, 24);
  h.writeUInt16LE(e.nameBuf.length, 28);
  h.writeUInt16LE(0, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);
  h.writeUInt16LE(0, 36);
  h.writeUInt32LE(0, 38);
  h.writeUInt32LE(e.offset, 42);
  return h;
}

/* Append `files` ([{ name, path }]: `name` the entry's name at the zip's
   root) to the zip at `zipPath`, a zip zip-folder.js wrote (no comment, so
   its end record is its last 22 bytes). Resolves { bytes, entries }. */
async function appendFiles(zipPath, files) {
  const fh = await fsp.open(zipPath, "r+");
  try {
    const size = (await fh.stat()).size;
    if (size < 22) throw new Error("not a zip: " + zipPath);
    const end = Buffer.alloc(22);
    await fh.read(end, 0, 22, size - 22);
    if (end.readUInt32LE(0) !== EOCD_SIG) throw new Error("not a zip written by the viewer: " + zipPath);
    const count = end.readUInt16LE(10);
    const cdSize = end.readUInt32LE(12);
    const cdStart = end.readUInt32LE(16);
    if (cdStart + cdSize + 22 !== size) throw new Error("not a zip written by the viewer: " + zipPath);
    if (count + files.length > MAX_ENTRIES) throw _tooLarge();
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdStart);
    let pos = cdStart;
    const added = [];
    const { time, date } = dosDateTime(new Date());
    for (const f of files) {
      const data = await fsp.readFile(f.path);
      const deflate = data.length > 0 && !STORED_EXTENSIONS.has(path.extname(f.name).toLowerCase());
      const body = deflate ? zlib.deflateRawSync(data) : data;
      const e = { nameBuf: Buffer.from(f.name, "utf8"), method: deflate ? 8 : 0, time, date,
        crc: crc32(data), csize: body.length, usize: data.length, offset: pos };
      if (pos + 30 + e.nameBuf.length + body.length > MAX32) throw _tooLarge();
      const header = _local(e);
      await fh.write(header, 0, header.length, pos);
      await fh.write(e.nameBuf, 0, e.nameBuf.length, pos + header.length);
      await fh.write(body, 0, body.length, pos + header.length + e.nameBuf.length);
      pos += header.length + e.nameBuf.length + body.length;
      added.push(e);
    }
    const newCdStart = pos;
    await fh.write(cd, 0, cd.length, pos);
    pos += cd.length;
    for (const e of added) {
      const h = _central(e);
      if (pos + h.length + e.nameBuf.length + 22 > MAX32) throw _tooLarge();
      await fh.write(h, 0, h.length, pos);
      await fh.write(e.nameBuf, 0, e.nameBuf.length, pos + h.length);
      pos += h.length + e.nameBuf.length;
    }
    const total = count + added.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(total, 8);
    eocd.writeUInt16LE(total, 10);
    eocd.writeUInt32LE(pos - newCdStart, 12);
    eocd.writeUInt32LE(newCdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await fh.write(eocd, 0, eocd.length, pos);
    pos += eocd.length;
    await fh.truncate(pos);
    return { bytes: pos, entries: total };
  } finally {
    await fh.close();
  }
}

/* Where the hand-off's zip goes: next to the project folder, named
   "<base> v<N>.zip", " (2)" and on when that name is taken. A folder at the
   top of a drive is refused, as the Whole project zip refuses it. */
function handoffTarget(folder, base, version, exists) {
  const root = path.resolve(folder);
  const parent = path.dirname(root);
  if (!path.basename(root) || parent === root) {
    throw new ProjectZipError("A project at the top of a drive cannot be handed off next to itself: move its folder into another folder first.");
  }
  const names = Handoff.fileNames(base, version);
  return { zipPath: path.join(parent, freeName(parent, names.zip, exists)), names };
}

/* Write the hand-off zip of the project at `folder`: opts = { base (the
   project's name), version, pdd, tech (the two files' paths) }. Resolves
   { zipPath, bytes, entries, names }; rejects with the writer's error (the
   caller turns it into a sentence, project-zip.js describeZipError).
   deps (the tests): { zipFolder, exists }. */
async function writeHandoffZip(folder, opts, deps) {
  const zip = (deps && deps.zipFolder) || zipFolder;
  const exists = (deps && deps.exists) || fs.existsSync;
  const root = path.resolve(folder);
  const { zipPath, names } = handoffTarget(root, opts.base, opts.version, exists);
  const building = zipPath + ".building";
  try {
    try {
      await zip(root, building);
    } catch (e) {
      // A file listed as the zip started was gone when its turn came (a save
      // replaced annotations.json through a temporary file): once more.
      if (!(e && e.code === "ENOENT") || !exists(path.join(root, "manifest.json"))) throw e;
      await zip(root, building);
    }
    const r = await appendFiles(building, [{ name: names.pdd, path: opts.pdd }, { name: names.tech, path: opts.tech }]);
    // Never over another zip: a name taken meanwhile gets the next number.
    let final = zipPath;
    if (exists(final)) final = path.join(path.dirname(zipPath), freeName(path.dirname(zipPath), path.basename(zipPath), exists));
    await fsp.rename(building, final);
    return { zipPath: final, bytes: r.bytes, entries: r.entries, names };
  } catch (e) {
    await fsp.rm(building, { force: true }).catch(() => {});
    await fsp.rm(building + ".partial", { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { appendFiles, handoffTarget, writeHandoffZip };
