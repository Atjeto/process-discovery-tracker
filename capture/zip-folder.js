"use strict";

/*
 * zip-folder.js: one recording folder as one .zip file, written next to the
 * folder, so the SME can hand the analyst a single file (the end summary's
 * "Make a zip for the analyst"). Local only: node:fs and node:zlib, no
 * network and no external program.
 *
 * Format: plain PKZIP 2.0 (no ZIP64), UTF-8 names (flag bit 11). The zip's
 * root is the folder itself, so extracting it gives the recording folder
 * back. Files are DEFLATEd, except formats that are already compressed
 * (stored as they are). Folders are written as entries too, so an empty
 * screenshots or obs folder survives the trip. Files are streamed, one at a
 * time, and each local header is patched once its sizes and CRC are known.
 *
 * Limits of the format without ZIP64: a recording over 4 GB, or with more
 * than 65,535 entries, is refused with a ZipTooLargeError (copy the folder
 * instead).
 *
 * The zip is written to "<name>.zip.partial" and renamed at the end, so a
 * failed run never leaves a half zip under the final name, and an earlier
 * zip of the same folder is replaced.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { Transform, Writable } = require("node:stream");

const MAX32 = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;
const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: deflate and folders
const STORED = 0;
const DEFLATED = 8;

/* Formats that deflate cannot shrink: stored as they are. */
const STORED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".mp4", ".mkv", ".webm", ".mov",
  ".zip", ".gz", ".7z", ".docx", ".xlsx", ".pptx",
]);

class ZipTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

let crcTable = null;

/* CRC-32 (IEEE), continuing from `prev` when given. Pure JS; used when the
   running Node has no zlib.crc32. */
function crc32js(buf, prev) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = ((prev || 0) ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function crc32(buf, prev) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf, prev || 0) >>> 0;
  return crc32js(buf, prev);
}

/* MS-DOS date and time, the only timestamp a plain zip entry carries. */
function dosDateTime(d) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

/* Where the zip of a recording folder goes: next to it, same name. */
function zipPathFor(folder) {
  const clean = path.resolve(folder);
  return path.join(path.dirname(clean), path.basename(clean) + ".zip");
}

/* Every folder and file under `root`, sorted by name so the zip is stable.
   Links and other special entries are skipped (a recording has none).
   `leaveOut` (optional): a function given each entry's path relative to
   `root` ("/" between the parts, a folder's ending in "/") that returns true
   for an entry the zip leaves out (a folder with everything in it). */
async function listEntries(root, prefix, leaveOut) {
  const out = [];
  async function walk(dir, rel, inner) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const name = rel + e.name;
      const own = inner + e.name;
      if (e.isDirectory()) {
        if (leaveOut && leaveOut(own + "/")) continue;
        out.push({ abs, name: name + "/", dir: true });
        await walk(abs, name + "/", own + "/");
      } else if (e.isFile()) {
        if (leaveOut && leaveOut(own)) continue;
        out.push({ abs, name, dir: false });
      }
    }
  }
  await walk(root, prefix, "");
  return out;
}

function localHeader(e) {
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

function centralHeader(e) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(VERSION, 4); // made by: 2.0, MS-DOS attributes
  h.writeUInt16LE(VERSION, 6);
  h.writeUInt16LE(UTF8_FLAG, 8);
  h.writeUInt16LE(e.method, 10);
  h.writeUInt16LE(e.time, 12);
  h.writeUInt16LE(e.date, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.csize, 20);
  h.writeUInt32LE(e.usize, 24);
  h.writeUInt16LE(e.nameBuf.length, 28);
  h.writeUInt16LE(0, 30); // extra
  h.writeUInt16LE(0, 32); // comment
  h.writeUInt16LE(0, 34); // disk
  h.writeUInt16LE(0, 36); // internal attributes
  h.writeUInt32LE(e.dir ? 0x10 : 0, 38); // MS-DOS directory bit
  h.writeUInt32LE(e.offset, 42);
  return h;
}

function tooLarge() {
  return new ZipTooLargeError(
    "This recording is too large for a zip (over 4 GB). Copy the folder instead.");
}

/* Stream one file into the zip at `dataPos`; returns crc and sizes. */
async function writeFileData(fh, abs, dataPos, deflate) {
  let crc = 0;
  let usize = 0;
  let csize = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      crc = crc32(chunk, crc);
      usize += chunk.length;
      cb(null, chunk);
    },
  });
  const sink = new Writable({
    write(chunk, _enc, cb) {
      if (dataPos + csize + chunk.length > MAX32) { cb(tooLarge()); return; }
      fh.write(chunk, 0, chunk.length, dataPos + csize).then(
        () => { csize += chunk.length; cb(); },
        cb);
    },
  });
  const source = fs.createReadStream(abs, { highWaterMark: 1 << 20 });
  if (deflate) await pipeline(source, tap, zlib.createDeflateRaw(), sink);
  else await pipeline(source, tap, sink);
  return { crc, usize, csize };
}

/*
 * Write `folder` as a zip at `zipPath` (default: next to the folder).
 * `leaveOut` (optional, listEntries): the entries the zip leaves out.
 * Resolves { zipPath, bytes, entries }. Rejects when the folder is missing,
 * a file cannot be read, the zip cannot be written, or the recording is too
 * large for the format (ZipTooLargeError); the partial file is removed.
 */
async function zipFolder(folder, zipPath, leaveOut) {
  const root = path.resolve(folder);
  const target = zipPath ? path.resolve(zipPath) : zipPathFor(root);
  const rootStat = await fsp.stat(root);
  if (!rootStat.isDirectory()) throw new Error("Not a folder: " + root);
  const base = path.basename(root);
  const entries = [{ abs: root, name: base + "/", dir: true }]
    .concat(await listEntries(root, base + "/", leaveOut));
  if (entries.length > MAX_ENTRIES) throw tooLarge();

  const partial = target + ".partial";
  const fh = await fsp.open(partial, "w");
  const written = [];
  let pos = 0;
  try {
    for (const e of entries) {
      const st = await fsp.stat(e.abs);
      if (!e.dir && st.size > MAX32) throw tooLarge();
      const { time, date } = dosDateTime(st.mtime);
      const entry = {
        nameBuf: Buffer.from(e.name, "utf8"),
        dir: e.dir,
        method: STORED,
        time,
        date,
        crc: 0,
        csize: 0,
        usize: 0,
        offset: pos,
      };
      const headerLen = 30 + entry.nameBuf.length;
      if (pos + headerLen > MAX32) throw tooLarge();
      if (!e.dir) {
        const deflate = st.size > 0 && !STORED_EXTENSIONS.has(path.extname(e.abs).toLowerCase());
        entry.method = deflate ? DEFLATED : STORED;
        const r = await writeFileData(fh, e.abs, pos + headerLen, deflate);
        entry.crc = r.crc;
        entry.usize = r.usize;
        entry.csize = r.csize;
      }
      const header = localHeader(entry);
      await fh.write(header, 0, header.length, pos);
      await fh.write(entry.nameBuf, 0, entry.nameBuf.length, pos + header.length);
      pos += headerLen + entry.csize;
      written.push(entry);
    }
    const cdStart = pos;
    for (const entry of written) {
      const h = centralHeader(entry);
      if (pos + h.length + entry.nameBuf.length > MAX32) throw tooLarge();
      await fh.write(h, 0, h.length, pos);
      await fh.write(entry.nameBuf, 0, entry.nameBuf.length, pos + h.length);
      pos += h.length + entry.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(pos - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    await fh.write(end, 0, end.length, pos);
    pos += end.length;
    await fh.close();
  } catch (e) {
    await fh.close().catch(() => {});
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw e;
  }
  try {
    await fsp.rm(target, { force: true }); // replace an earlier zip of this folder
    await fsp.rename(partial, target);
  } catch (e) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw e;
  }
  return { zipPath: target, bytes: pos, entries: written.length };
}

/* The sentence the end summary shows when a zip could not be made. */
function describeZipError(e) {
  if (e instanceof ZipTooLargeError) return e.message;
  const code = e && e.code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return "An earlier zip of this recording is open in another program, or the folder " +
      "cannot be written to. Close the zip and try again.";
  }
  if (code === "ENOSPC") return "The disk is full.";
  if (code === "ENOENT") return "The recording folder was not found.";
  const msg = String((e && e.message) || e || "unknown error").trim().replace(/\.$/, "");
  return "Windows reported: " + msg + ".";
}

module.exports = {
  zipFolder,
  zipPathFor,
  describeZipError,
  crc32,
  crc32js,
  dosDateTime,
  ZipTooLargeError,
  STORED_EXTENSIONS,
};
