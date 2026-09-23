/*
 * reference-maps.js -- the Reference Maps store (ADR-0019).
 *
 * A reference map is a standalone, fully-editable BPMN copy the analyst forks
 * from a mined map cell. It is a ONE-WAY LEAF: data flows in once at the fork
 * and never flows back. The pipeline never re-mines, merges, or regenerates it.
 *
 *   - the .bpmn blob lives in   <session>/derived_maps/<map_id>.bpmn
 *   - the metadata row lives in  annotations.json `reference_maps[]`
 *
 * This module is deliberately FREE of Electron / app state: every function
 * takes the plain `anno` object (and a session folder for fs ops) and
 * mutates/returns it, so the caller owns persistence (Session.saveAnnotations-
 * WithUndo) and so the pure logic is unit-testable under node:test without a
 * renderer. Only node built-ins are required.
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KINDS = ["as_is", "to_be", "reference"];
const PDD_ROLES = ["as_is", "to_be"];
const DERIVED_DIR = "derived_maps";

/* ---- hashing (drift detection) -------------------------------------------
   blake2b where available (matches the Python signature idiom), sha256 fallback
   on an OpenSSL build without it. Drift only ever compares two hashes computed
   the same way on the same machine, so the algorithm choice is internal. */
let _cachedAlgo = null;
function _algo() {
  if (_cachedAlgo) return _cachedAlgo;
  try { crypto.createHash("blake2b512"); _cachedAlgo = "blake2b512"; }
  catch (_) { _cachedAlgo = "sha256"; }
  return _cachedAlgo;
}
function hashContent(buf) {
  return crypto.createHash(_algo()).update(buf).digest("hex").slice(0, 16);
}
function fileHash(p) {
  try { return hashContent(fs.readFileSync(p)); } catch (_) { return null; }
}

function genId() {
  try { return "rm_" + crypto.randomUUID(); }
  catch (_) { return "rm_" + crypto.randomBytes(8).toString("hex"); }
}

/* ---- pure manifest manipulation (unit-tested) ----------------------------- */

function ensure(anno) {
  if (!anno || typeof anno !== "object") return [];
  if (!Array.isArray(anno.reference_maps)) anno.reference_maps = [];
  return anno.reference_maps;
}
function list(anno) {
  return (anno && Array.isArray(anno.reference_maps)) ? anno.reference_maps : [];
}
function find(anno, id) {
  return list(anno).find((m) => m && m.map_id === id) || null;
}

function buildEntry({ map_id, name, kind, file, source, forked_from_hash, forked_at } = {}) {
  return {
    map_id: map_id || genId(),
    name: (name && String(name).trim()) || "Untitled map",
    kind: KINDS.includes(kind) ? kind : "reference",
    file,
    source: source || null,
    forked_from_hash: forked_from_hash || null,
    forked_at: forked_at || null,
    edited_at: forked_at || null,
    pdd_role: null,
    notes: "",
  };
}

function upsert(anno, entry) {
  const arr = ensure(anno);
  const i = arr.findIndex((m) => m && m.map_id === entry.map_id);
  if (i === -1) arr.push(entry); else arr[i] = entry;
  return entry;
}
function remove(anno, id) {
  const arr = ensure(anno);
  const i = arr.findIndex((m) => m && m.map_id === id);
  if (i === -1) return null;
  return arr.splice(i, 1)[0];
}
function rename(anno, id, name) {
  const e = find(anno, id);
  if (!e) return null;
  const n = String(name == null ? "" : name).trim();
  if (n) e.name = n;
  return e;
}
/* A PDD role (as_is / to_be) is exclusive: at most one map fills each slot, so
   selecting a new one clears the prior holder. `null` / unknown clears. */
function setPddRole(anno, id, role) {
  const arr = ensure(anno);
  const e = arr.find((m) => m && m.map_id === id);
  if (!e) return null;
  const next = PDD_ROLES.includes(role) ? role : null;
  if (next) {
    for (const m of arr) if (m && m.map_id !== id && m.pdd_role === next) m.pdd_role = null;
  }
  e.pdd_role = next;
  return e;
}
/* The one role control (P2.5): the PDD role a map fills (exclusive, see
   setPddRole) and, when it has one, its stored kind follows it, so the stored
   shape keeps a kind that agrees with the role although the viewer no longer
   shows the kind on its own. */
function setRole(anno, id, role) {
  const e = setPddRole(anno, id, role);
  if (e && e.pdd_role) e.kind = e.pdd_role;
  return e;
}
function pddPick(anno, role) {
  return list(anno).find((m) => m && m.pdd_role === role) || null;
}

/* Stale = the source map this copy was forked from has since changed (a
   re-analyze re-mined it). The copy is still perfectly valid — it is just no
   longer a snapshot of the current mined map. */
function isStale(entry, currentSourceHash) {
  return !!(entry && entry.forked_from_hash && currentSourceHash &&
            entry.forked_from_hash !== currentSourceHash);
}

/* ---- fs-backed ops -------------------------------------------------------- */

function derivedDir(sessionFolder) { return path.join(sessionFolder, DERIVED_DIR); }
/* Resolve entry.file under the session folder, REFUSING any path that escapes it
   (a hand-edited annotations.json could carry "../.." traversal — defence in
   depth, matching pdd_export's screenshot_ref guard). Returns null on violation. */
function absPath(sessionFolder, entry) {
  const rel = entry && entry.file;
  if (!rel) return null;
  const base = path.resolve(sessionFolder);
  const abs = path.resolve(base, rel);
  const within = path.relative(base, abs);
  if (!within || within.startsWith("..") || path.isAbsolute(within)) return null;
  return abs;
}
function fileExists(sessionFolder, entry) {
  const p = absPath(sessionFolder, entry);
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}
function writeBpmn(sessionFolder, entry, xml) {
  const p = absPath(sessionFolder, entry);
  if (!p) throw new Error("reference map path escapes the session folder: " + (entry && entry.file));
  fs.mkdirSync(derivedDir(sessionFolder), { recursive: true });
  fs.writeFileSync(p, xml || "", "utf-8");
}
function readBpmn(sessionFolder, entry) {
  const p = absPath(sessionFolder, entry);
  if (!p) return null;
  try { return fs.readFileSync(p, "utf-8"); } catch (_) { return null; }
}
function deleteBpmn(sessionFolder, entry) {
  const p = absPath(sessionFolder, entry);
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* already gone */ }
}

/* Compose a fork: snapshot `xml` (the live view, WYSIWYF) into a new copy,
   stamp provenance, write the blob, upsert the row. Returns the entry. */
function fork({ sessionFolder, anno, xml, source, sourceBpmnPath, name, kind, nowIso }) {
  const map_id = genId();
  const file = path.posix.join(DERIVED_DIR, map_id + ".bpmn");
  const forked_from_hash = sourceBpmnPath
    ? fileHash(sourceBpmnPath)
    : (xml ? hashContent(Buffer.from(xml, "utf-8")) : null);
  const entry = buildEntry({ map_id, name, kind, file, source, forked_from_hash, forked_at: nowIso || null });
  writeBpmn(sessionFolder, entry, xml || "");
  upsert(anno, entry);
  return entry;
}

/* Duplicate an existing copy (provenance carried; fresh id + file). A
   duplicate is how a To-Be map starts from the As-Is map, so it is named and
   kept as one ("To-Be map"); it fills no PDD role until the analyst chooses. */
function duplicate({ sessionFolder, anno, srcEntry, nowIso }) {
  const xml = readBpmn(sessionFolder, srcEntry) || "";
  const map_id = genId();
  const file = path.posix.join(DERIVED_DIR, map_id + ".bpmn");
  const entry = buildEntry({
    map_id, name: "To-Be map", kind: "to_be",
    file, source: srcEntry.source, forked_from_hash: srcEntry.forked_from_hash, forked_at: nowIso || null,
  });
  writeBpmn(sessionFolder, entry, xml);
  upsert(anno, entry);
  return entry;
}

/* "Delete" removes the manifest ROW only; the .bpmn blob is RETAINED on disk so
   the annotations-undo layer can restore a working entry with one Ctrl+Z (the
   undo stack snapshots annotations, not files — unlinking here would resurrect a
   row pointing at a deleted file). A retained blob with no row is a harmless,
   invisible orphan. `sessionFolder` is kept for signature parity with fork. */
function destroy({ sessionFolder, anno, id }) {
  void sessionFolder;
  return remove(anno, id);
}

module.exports = {
  KINDS, PDD_ROLES, DERIVED_DIR,
  hashContent, fileHash, genId,
  ensure, list, find, buildEntry, upsert, remove, rename, setPddRole, setRole, pddPick, isStale,
  derivedDir, absPath, fileExists, writeBpmn, readBpmn, deleteBpmn,
  fork, duplicate, destroy,
};
