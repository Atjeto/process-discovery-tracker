"use strict";

/*
 * handoff-open.js: opening a hand-off zip read only (lane HV, contract C20),
 * in the main process.
 *
 * Open a hand-off (.zip)... takes a hand-off zip ("<project> v<N>.zip",
 * handoff-zip.js). The zip is read, never changed: it is a hand-off when its
 * root holds one project folder (a manifest.json) whose annotations.json
 * lists at least one hand-off version. Its content is extracted into the
 * viewer's own folder, <userData>/handoffs/<project> v<N>/ (the zip's root
 * there: the project folder, the PDD, the Technical details when the
 * project recorded anything, the map files and Start here.txt), and the
 * project folder inside opens read only: every folder under
 * <userData>/handoffs is read only (isReadOnlyFolder, within
 * isReadOnlyProject: main.js refuses every write there, and the renderer
 * shows no editing control).
 *
 * The same zip opened again opens the folder it was extracted to (the
 * folder's .pdt-handoff.json names the hand-off: the session and the time it
 * was handed off). Another hand-off of the same version (an undone hand-off
 * made again) gets "<project> v<N> (2)". A newer version is a folder of its
 * own: it just opens, and nothing compares it with the older one.
 *
 * A hand-off unzipped by hand (Windows' Extract All, then Open project on
 * the folder it makes) is read only too: a project folder beside which lies
 * the PDD of the version its annotations.json lists last ("<project> v<N>
 * PDD.docx", as the zip's root holds it, with "<project> v<N> Technical
 * details.xlsx" when there is one) is a hand-off
 * (isReadOnlyProject, the rule main refuses writes by).
 *
 * Extraction is careful with what it is given: an entry that would land
 * outside the folder (an absolute name, a drive, "..") or that is encrypted
 * or compressed in another way than stored or deflated stops it, and so does
 * a file whose size or CRC does not match. It writes into a temporary folder
 * beside the final one and renames it only when complete, so a folder under
 * handoffs/ is always a whole hand-off. Files are streamed, one at a time.
 */

const nodeFs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { crc32 } = require("./zip-folder.js");
const Handoff = require("./handoff.js");

const HANDOFFS = "handoffs";
const MARKER = ".pdt-handoff.json";
const MAX_SMALL = 64 * 1024 * 1024;   // manifest.json and annotations.json are read whole

/* A refusal whose message is the sentence the analyst reads. */
class HandoffOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = "HandoffOpenError";
  }
}

const NOT_A_HANDOFF = "This zip is not a hand-off. A recording the SME sent, or a whole project's zip, is " +
  "unzipped first (right-click it, Extract All), then its folder opens with Open project.";

/* The folder the hand-offs are opened in. */
function handoffsRoot(userData) {
  return path.join(String(userData || ""), HANDOFFS);
}

/* Whether `folder` is inside <userData>/handoffs, where everything opens read
   only. `userData` null (plain node, no electron app): nothing is. */
function isReadOnlyFolder(userData, folder) {
  if (!userData || !folder) return false;
  const base = path.resolve(handoffsRoot(userData)).toLowerCase();
  const full = path.resolve(String(folder)).toLowerCase();
  return full.startsWith(base + path.sep);
}

/* The PDD and the Technical details beside the project folder `folder` of a
   hand-off unzipped by hand: { pdd, tech } (their paths; tech null when the
   hand-off came without one, nothing having been recorded in the project)
   for the version its annotations.json lists last, or null when its PDD is
   not there (or the project lists no version). */
function unzippedHandoffFiles(folder, fs = nodeFs) {
  const root = path.resolve(String(folder || ""));
  const parent = path.dirname(root);
  let names = [];
  try { names = fs.readdirSync(parent); } catch (_) { return null; }
  // Only a folder beside hand-off documents is read (the usual project has
  // none, and a save asks this each time).
  if (!names.some((n) => / v\d+ PDD\.docx$/.test(n))) return null;
  let anno = null;
  try { anno = JSON.parse(fs.readFileSync(path.join(root, "annotations.json"), "utf8").replace(/^\uFEFF/, "")); }
  catch (_) { return null; }
  const latest = Handoff.latest(anno);
  if (!latest) return null;
  const stem = " v" + latest.version;
  const pdd = names.find((n) => n.endsWith(stem + " PDD.docx"));
  const tech = names.find((n) => n.endsWith(stem + " Technical details.xlsx"));
  return pdd ? { pdd: path.join(parent, pdd), tech: tech ? path.join(parent, tech) : null } : null;
}

/* Whether the project folder `folder` opens read only: a hand-off opened
   from its zip (under <userData>/handoffs), or one unzipped by hand. */
function isReadOnlyProject(userData, folder, fs = nodeFs) {
  return isReadOnlyFolder(userData, folder) || !!unzippedHandoffFiles(folder, fs);
}

/* A zip entry's name as a relative path of forward slashes, or null when it
   would land outside the folder it is extracted to. */
function safeEntryName(name) {
  const n = String(name || "").replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.includes("\0")) return null;
  const parts = n.split("/");
  const dir = n.endsWith("/");
  const segs = dir ? parts.slice(0, -1) : parts;
  if (!segs.length || segs.some((s) => !s || s === "." || s === ".." || /[<>:"|?*]/.test(s))) return null;
  return segs.join("/") + (dir ? "/" : "");
}

/* The central directory of the zip open in `fh` (size `size`): the entries
   { name, dir, method, flags, crc, csize, usize, offset }. */
async function _directory(fh, size) {
  const tailLen = Math.min(size, 22 + 0xFFFF);
  const tail = Buffer.alloc(tailLen);
  await fh.read(tail, 0, tailLen, size - tailLen);
  let at = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { at = i; break; }
  }
  if (at < 0) throw new HandoffOpenError("This file is not a zip the app can read.");
  const count = tail.readUInt16LE(at + 10);
  const cdSize = tail.readUInt32LE(at + 12);
  const cdStart = tail.readUInt32LE(at + 16);
  if (cdStart === 0xFFFFFFFF || count === 0xFFFF || cdStart + cdSize > size) {
    throw new HandoffOpenError("This zip is too large for the app to read (over 4 GB).");
  }
  const cd = Buffer.alloc(cdSize);
  await fh.read(cd, 0, cdSize, cdStart);
  const out = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new HandoffOpenError("This zip is damaged.");
    const flags = cd.readUInt16LE(p + 8);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const raw = cd.subarray(p + 46, p + 46 + nlen);
    const name = (flags & 0x0800) ? raw.toString("utf8") : raw.toString("latin1");
    out.push({
      name, dir: name.endsWith("/") || name.endsWith("\\"), flags, method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/* Where an entry's data starts: after its local header. */
async function _dataStart(fh, entry) {
  const h = Buffer.alloc(30);
  await fh.read(h, 0, 30, entry.offset);
  if (h.readUInt32LE(0) !== 0x04034b50) throw new HandoffOpenError("This zip is damaged.");
  return entry.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}

function _checkEntry(entry) {
  if (entry.flags & 0x0001) throw new HandoffOpenError("This zip is locked with a password, so the app cannot open it.");
  if (!entry.dir && entry.method !== 0 && entry.method !== 8) {
    throw new HandoffOpenError("This zip is compressed in a way the app cannot read.");
  }
}

/* A small entry's bytes (manifest.json, annotations.json), checked. */
async function _readSmall(fh, entry) {
  _checkEntry(entry);
  if (entry.csize > MAX_SMALL || entry.usize > MAX_SMALL) throw new HandoffOpenError("This zip is damaged.");
  const start = await _dataStart(fh, entry);
  const raw = Buffer.alloc(entry.csize);
  await fh.read(raw, 0, entry.csize, start);
  const data = entry.method === 8 ? zlib.inflateRawSync(raw) : raw;
  if (data.length !== entry.usize || crc32(data) !== entry.crc) throw new HandoffOpenError("This zip is damaged.");
  return data;
}

function _json(buf) {
  try { return JSON.parse(buf.toString("utf8").replace(/^\uFEFF/, "")); } catch (_) { return null; }
}

/* What the zip holds: { top (the project folder's name), entries (their
   safe names), manifest, annotations, latest (the newest hand-off entry),
   pdd, tech (the root's PDD and Technical details of that version, tech
   null when the zip has none) }. Throws a HandoffOpenError with the sentence
   to show when it is no hand-off. A hand-off carries the PDD of the version
   its project lists last and, when something was recorded, its Technical
   details (handoff-zip.js), as one unzipped by hand has them beside it
   (unzippedHandoffFiles); the Whole project zip of a project handed off
   before carries neither: a working copy, never shown as a version. */
async function inspectHandoff(zipPath) {
  const fh = await fsp.open(zipPath, "r");
  try {
    const size = (await fh.stat()).size;
    const entries = await _directory(fh, size);
    for (const e of entries) {
      e.safe = safeEntryName(e.name);
      if (!e.safe) throw new HandoffOpenError("This zip holds a file that would land outside its folder, so the app does not open it.");
      _checkEntry(e);
    }
    const tops = new Set(entries.filter((e) => e.safe.includes("/")).map((e) => e.safe.split("/")[0]));
    const projects = [...tops].filter((t) => entries.some((e) => e.safe === t + "/manifest.json"));
    if (projects.length !== 1) throw new HandoffOpenError(NOT_A_HANDOFF);
    const top = projects[0];
    const manifestEntry = entries.find((e) => e.safe === top + "/manifest.json");
    const annoEntry = entries.find((e) => e.safe === top + "/annotations.json");
    const manifest = _json(await _readSmall(fh, manifestEntry));
    const annotations = annoEntry ? _json(await _readSmall(fh, annoEntry)) : null;
    const latest = annotations ? Handoff.latest(annotations) : null;
    if (!manifest || !latest) throw new HandoffOpenError(NOT_A_HANDOFF);
    const rootFile = (suffix) => {
      const e = entries.find((x) => !x.dir && !x.safe.includes("/") && x.safe.endsWith(suffix));
      return e ? e.safe : null;
    };
    const stem = " v" + latest.version;
    const pdd = rootFile(stem + " PDD.docx"), tech = rootFile(stem + " Technical details.xlsx");
    if (!pdd) throw new HandoffOpenError(NOT_A_HANDOFF);
    return { top, entries, manifest, annotations, latest, pdd, tech };
  } finally {
    await fh.close();
  }
}

/* The project in a zip, read where it is and never extracted (contract C21:
   the Library builder reads a hand-off's steps): { top, manifest,
   annotations } from the one project folder at its root (a folder holding a
   manifest.json; or the root itself), annotations null when it has no
   annotations.json. Throws a HandoffOpenError with the sentence to show when
   the zip holds no project, or more than one, or cannot be read. */
async function readProjectZip(zipPath) {
  const fh = await fsp.open(String(zipPath || ""), "r");
  try {
    const entries = await _directory(fh, (await fh.stat()).size);
    for (const e of entries) e.safe = safeEntryName(e.name);
    const files = entries.filter((e) => e.safe && !e.dir);
    const tops = [...new Set(files.filter((e) => /^[^/]+\/manifest\.json$/.test(e.safe)).map((e) => e.safe.split("/")[0]))];
    const top = files.some((e) => e.safe === "manifest.json") ? "" : tops.length === 1 ? tops[0] : null;
    if (top === null) {
      throw new HandoffOpenError(tops.length ? "This zip holds " + tops.length + " projects: add a zip of one project."
        : "This zip holds no project (no manifest.json).");
    }
    const at = (name) => files.find((e) => e.safe === (top ? top + "/" : "") + name) || null;
    const manifest = _json(await _readSmall(fh, at("manifest.json")));
    if (!manifest) throw new HandoffOpenError("The project's manifest.json in this zip cannot be read.");
    const annoEntry = at("annotations.json");
    const annotations = annoEntry ? _json(await _readSmall(fh, annoEntry)) : null;
    if (annoEntry && !annotations) throw new HandoffOpenError("The project's annotations.json in this zip cannot be read.");
    return { top, manifest, annotations };
  } finally {
    await fh.close();
  }
}

/* Extract every entry of the zip into `dest` (made fresh), streamed, each
   file's size and CRC checked. */
async function _extract(zipPath, entries, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const fh = await fsp.open(zipPath, "r");
  try {
    for (const e of entries) {
      const target = path.join(dest, ...e.safe.split("/").filter(Boolean));
      if (e.dir) { await fsp.mkdir(target, { recursive: true }); continue; }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      if (e.csize === 0) {
        if (e.usize !== 0) throw new HandoffOpenError("This zip is damaged.");
        await fsp.writeFile(target, Buffer.alloc(0));
        continue;
      }
      const start = await _dataStart(fh, e);
      let crc = 0, usize = 0;
      const tap = new Transform({
        transform(chunk, _enc, cb) { crc = crc32(chunk, crc); usize += chunk.length; cb(null, chunk); },
      });
      const source = nodeFs.createReadStream(zipPath, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
      const sink = nodeFs.createWriteStream(target);
      if (e.method === 8) await pipeline(source, zlib.createInflateRaw(), tap, sink);
      else await pipeline(source, tap, sink);
      if (usize !== e.usize || crc !== e.crc) throw new HandoffOpenError("This zip is damaged: " + e.safe + " does not read back whole.");
    }
  } finally {
    await fh.close();
  }
}

function _marker(folder) {
  try { return JSON.parse(nodeFs.readFileSync(path.join(folder, MARKER), "utf8")); } catch (_) { return null; }
}

function _sameHandoff(marker, info) {
  return !!(marker && marker.session_id === (info.manifest.session_id || null) &&
    marker.version === info.latest.version && marker.handed_off_at === info.latest.handed_off_at);
}

/* Open the hand-off zip at `zipPath`: extract it under
   <userData>/handoffs/<project> v<N>/ (or find where it was extracted
   before). Resolves { root (that folder), folder (the project folder in
   it, the one that opens), version, latest, reused, pdd, tech }. Throws a
   HandoffOpenError with a sentence when it is no hand-off or cannot be
   read. */
async function openHandoffZip(zipPath, userData) {
  const zip = path.resolve(String(zipPath || ""));
  let st = null;
  try { st = await fsp.stat(zip); } catch (_) { st = null; }
  if (!st || !st.isFile()) throw new HandoffOpenError("The zip was not found: " + zip);
  const info = await inspectHandoff(zip);
  const base = handoffsRoot(userData);
  await fsp.mkdir(base, { recursive: true });
  const name = Handoff.safeBase(Handoff.projectName({
    sessionFolder: info.top, manifest: info.manifest, annotations: info.annotations,
  }), info.top);
  const stem = name + " v" + info.latest.version;
  const done = (root, reused) => ({ root, folder: path.join(root, info.top), version: info.latest.version,
    latest: info.latest, reused, pdd: info.pdd, tech: info.tech });
  for (let n = 1; n < 100; n++) {
    const root = path.join(base, n === 1 ? stem : stem + " (" + n + ")");
    if (nodeFs.existsSync(root)) {
      if (_sameHandoff(_marker(root), info) && nodeFs.existsSync(path.join(root, info.top, "manifest.json"))) {
        return done(root, true);
      }
      continue;
    }
    const tmp = path.join(base, ".opening-" + crypto.randomBytes(6).toString("hex"));
    try {
      await _extract(zip, info.entries, tmp);
      await fsp.writeFile(path.join(tmp, MARKER), JSON.stringify({
        session_id: info.manifest.session_id || null, version: info.latest.version,
        handed_off_at: info.latest.handed_off_at, zip, pdd: info.pdd, tech: info.tech,
        opened_at: new Date().toISOString(),
      }, null, 2));
      await fsp.rename(tmp, root);
    } catch (e) {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    return done(root, false);
  }
  throw new HandoffOpenError("Too many copies of this hand-off are open already: remove some under " + base + ".");
}

/* The PDD or the Technical details (`kind` "pdd" or "tech") of the hand-off
   whose project folder is `folder`: the file at the extraction's root, as
   its .pdt-handoff.json names it (else, a hand-off unzipped by hand, the one
   beside the folder), or null. */
function handoffFile(folder, kind) {
  if (kind !== "pdd" && kind !== "tech") return null;
  const root = path.dirname(path.resolve(String(folder || "")));
  const marker = _marker(root);
  const name = marker && marker[kind];
  if (typeof name === "string" && safeEntryName(name) && !name.includes("/")) {
    const file = path.join(root, name);
    if (nodeFs.existsSync(file)) return file;
  }
  const unzipped = unzippedHandoffFiles(folder);
  return unzipped ? unzipped[kind] : null;
}

module.exports = {
  HANDOFFS, MARKER, NOT_A_HANDOFF, HandoffOpenError,
  handoffsRoot, isReadOnlyFolder, isReadOnlyProject, unzippedHandoffFiles, safeEntryName, inspectHandoff,
  readProjectZip, openHandoffZip, handoffFile,
};
