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

/* The process a map draws, as a signature. Every analysis writes the step
   map's file anew, and the miner orders its elements (so their ids and the
   layout) differently from one analysis to the next: two analyses of the
   same steps give two files whose bytes differ. So a copy compares the
   process instead: processSignature is a short hash of what the map says,
   without its ids, its layout (the BPMNDiagram) or its documentation text:
   the tasks (kind and name), the events (kind and name), the sequence flows
   (source, target, name), the data objects (name, and the task holding
   each) and the text annotations (text, and what each is joined to). A node
   with no name (a gateway, a start event while the Trigger is empty) is
   named by its kind and by the nodes and flows around it, over as many
   rounds as there are such nodes, so a branch wired to another choice
   counts as a change while a reordered file does not. Null when the XML
   holds no task, event or gateway. Names and texts are compared with their
   whitespace collapsed. */
const _ACTIVITY = /^(?:task|[A-Za-z]+Task|subProcess|adHocSubProcess|transaction|callActivity)$/;
const _EVENT = /^[A-Za-z]+Event$/;
const _GATEWAY = /^[A-Za-z]+Gateway$/;
const _ENTITY = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function _unescape(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (all, e) => {
    if (e[0] !== "#") return Object.prototype.hasOwnProperty.call(_ENTITY, e) ? _ENTITY[e] : all;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(code); } catch (_) { return all; }
  });
}
function _words(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function _attrs(s) {
  const out = Object.create(null);
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s || ""))) out[m[1]] = _unescape(m[2] != null ? m[2] : m[3]);
  return out;
}

/* The process elements of a BPMN file, read by one pass over its tags (any
   namespace prefix): { nodes: id => {kind, name}, flows: [{source, target,
   name}], data: id => name, notes: id => text, joins: [[source, target]] of
   the associations, holds: [[task id, data object reference id]] }. */
function _readProcess(xml) {
  const src = String(xml == null ? "" : xml);
  const re = /<!-{2}[\s\S]*?-{2}>|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const p = { nodes: new Map(), flows: [], data: new Map(), notes: new Map(), joins: [], holds: [] };
  const stack = [];
  const close = (kind) => {
    while (stack.length) {
      const el = stack.pop();
      const parent = stack.at(-1);
      if (el.text != null && el.kind === "text" && parent) p.notes.set(parent.id, _words(el.text));
      if (el.text != null && el.kind === "sourceRef") {
        const task = stack.slice().reverse().find((o) => _ACTIVITY.test(o.kind));
        if (task) p.holds.push([task.id, _words(el.text)]);
      }
      if (el.kind === kind) return;
    }
  };
  let at = 0, anon = 0, m;
  while ((m = re.exec(src))) {
    const top = stack.at(-1);
    if (top && top.text != null) top.text += _unescape(src.slice(at, m.index)) + (m[1] || "");
    at = re.lastIndex;
    if (m[3] == null) continue;   // a comment, a declaration or a CDATA section
    if (m[2]) { close(m[3]); continue; }
    const kind = m[3], a = _attrs(m[4]);
    const el = { kind, id: a.id || "#" + (anon++), text: null };
    if (_ACTIVITY.test(kind) || _EVENT.test(kind) || _GATEWAY.test(kind)) {
      p.nodes.set(el.id, { kind, name: _words(a.name) });
    } else if (kind === "sequenceFlow") {
      p.flows.push({ source: a.sourceRef || "", target: a.targetRef || "", name: _words(a.name) });
    } else if (kind === "dataObjectReference") {
      p.data.set(el.id, _words(a.name));
    } else if (kind === "textAnnotation") {
      p.notes.set(el.id, "");
    } else if (kind === "association") {
      p.joins.push([a.sourceRef || "", a.targetRef || ""]);
    } else if ((kind === "text" && top && top.kind === "textAnnotation") ||
               (kind === "sourceRef" && top && top.kind === "dataInputAssociation")) {
      el.text = "";
    }
    stack.push(el);
    if (m[5]) close(kind);
  }
  return p;
}

function processSignature(xml) {
  const p = _readProcess(xml);
  if (!p.nodes.size) return null;
  const ins = new Map(), outs = new Map();
  for (const f of p.flows) {
    if (!outs.has(f.source)) outs.set(f.source, []);
    if (!ins.has(f.target)) ins.set(f.target, []);
    outs.get(f.source).push(f);
    ins.get(f.target).push(f);
  }
  let label = new Map();
  for (const [id, n] of p.nodes) label.set(id, n.kind + ":" + n.name);
  const lab = (id) => (label.has(id) ? label.get(id) : "?");
  const digest = (v) => hashContent(Buffer.from(JSON.stringify(v), "utf-8"));
  const sorted = (items) => items.map((v) => JSON.stringify(v)).sort();
  const unnamed = [...p.nodes.keys()].filter((id) => !p.nodes.get(id).name);
  for (let round = 0; round < unnamed.length; round++) {
    const next = new Map(label);
    for (const id of unnamed) {
      next.set(id, digest([lab(id),
        sorted((ins.get(id) || []).map((f) => [lab(f.source), f.name])),
        sorted((outs.get(id) || []).map((f) => [f.name, lab(f.target)]))]));
    }
    label = next;
  }
  const nodes = [...p.nodes.values()];
  return digest({
    tasks: sorted(nodes.filter((n) => _ACTIVITY.test(n.kind)).map((n) => [n.kind, n.name])),
    events: sorted(nodes.filter((n) => _EVENT.test(n.kind)).map((n) => [n.kind, n.name])),
    flows: sorted(p.flows.map((f) => [lab(f.source), lab(f.target), f.name])),
    data: sorted([...p.data].map(([id, name]) =>
      [name, p.holds.filter((h) => h[1] === id).map((h) => lab(h[0])).sort()])),
    notes: sorted([...p.notes].map(([id, text]) =>
      [text, p.joins.filter((j) => j.includes(id)).map((j) => lab(j[0] === id ? j[1] : j[0])).sort()])),
  });
}

/* A source map's marks as the file is on disk: the hash of its bytes (what a
   copy made before the signature compares) and the signature of its
   process; null when the file cannot be read. */
function _marks(buf) {
  return { hash: hashContent(buf), sig: processSignature(buf.toString("utf-8")) };
}
function sourceMarks(p) {
  let buf;
  try { buf = fs.readFileSync(p); } catch (_) { return null; }
  return _marks(buf);
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

function buildEntry({ map_id, name, kind, file, source, forked_from_hash, forked_from_sig, forked_from_steps, forked_at } = {}) {
  return {
    map_id: map_id || genId(),
    name: (name && String(name).trim()) || "Untitled map",
    kind: KINDS.includes(kind) ? kind : "reference",
    file,
    source: source || null,
    forked_from_hash: forked_from_hash || null,
    forked_from_sig: forked_from_sig || null,
    // Lane FX2: the signature of the maps the steps drew when the copy was
    // made (asis-freshness.js stepsMapSignature): the copy is older than the
    // steps once they draw another.
    forked_from_steps: forked_from_steps || null,
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

/* Stale = the process in the source map this copy was forked from has since
   changed (an analysis drew another map). The copy is still perfectly valid:
   it is just no longer a copy of the current map. A copy that stores the
   signature of the process it was made from (forked_from_sig) compares it
   with the current one (processSignature), so an analysis that only
   reorders the file is no change; a copy made before the signature was
   stored compares the file's bytes (forked_from_hash), as it always did. An
   unknown current mark is no change. */
function isStale(entry, currentSourceHash, currentSourceSig) {
  if (!entry) return false;
  if (entry.forked_from_sig) return !!(currentSourceSig && entry.forked_from_sig !== currentSourceSig);
  return !!(entry.forked_from_hash && currentSourceHash &&
            entry.forked_from_hash !== currentSourceHash);
}

/* A copy made before the step map had its systems, notes and attachments
   (contract C18): it has none of what process_map_step.bpmn has had since,
   a user or a manual task (the two kinds of every task until lane CL made a
   task done in a system a plain task), the legend (TextAnnotation_legend, on
   any plane) or a task's colour (bioc:fill) before 2.0.1, a system label
   (TextAnnotation_system, or TextAnnotation_system_<k>) since. Such a copy
   offers Copy again in those words once the process map changes
   (refmap-ui.js). */
/* A copy drawn before the system labels (2.0.1): a colour or the legend,
   and no system label. The Map and the Checklist treat it as made before
   the steps changed, so Copy again gives the labels. */
function predatesLabels(xml) {
  const s = String(xml || "");
  return (/\s[\w.-]+:fill="/.test(s) || /\sid="(?:Sub\d+_)?TextAnnotation_legend"/.test(s)) &&
    !/\sid="(?:Sub\d+_)?TextAnnotation_system(?:_\d+)?"/.test(s);
}

/* C25 adds its marks: a service task (the gear) and a Done by label
   (TextAnnotation_doneby, TextAnnotation_doneby_<k>). */
function predatesRichMap(xml) {
  const s = String(xml || "");
  return !/<(?:[\w.-]+:)?(?:userTask|manualTask|serviceTask)[\s/>]/.test(s) &&
    !/\sid="(?:Sub\d+_)?TextAnnotation_(?:legend|system(?:_\d+)?|doneby(?:_\d+)?)"/.test(s) &&
    !/\s[\w.-]+:fill="/.test(s);
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

/* The row of a new copy of `xml`, with its provenance (the source's hash and
   process signature, and `stepsSig`, the signature of the maps the steps
   drew then), and nothing written: the Map's Edit opens a new copy this way
   and keeps it (writeBpmn, upsert) only once the analyst changes it
   (refmap-ui.js). */
function forkEntry({ xml, source, sourceBpmnPath, name, kind, nowIso, stepsSig }) {
  const map_id = genId();
  const file = path.posix.join(DERIVED_DIR, map_id + ".bpmn");
  const marks = sourceBpmnPath
    ? sourceMarks(sourceBpmnPath)
    : (xml ? _marks(Buffer.from(xml, "utf-8")) : null);
  return buildEntry({
    map_id, name, kind, file, source,
    forked_from_hash: marks && marks.hash, forked_from_sig: marks && marks.sig,
    forked_from_steps: stepsSig || null, forked_at: nowIso || null,
  });
}

/* Compose a fork: snapshot `xml` (the live view, WYSIWYF) into a new copy,
   stamp provenance (the source's hash and process signature), write the
   blob, upsert the row. Returns the entry. */
function fork({ sessionFolder, anno, xml, source, sourceBpmnPath, name, kind, nowIso, stepsSig }) {
  const entry = forkEntry({ xml, source, sourceBpmnPath, name, kind, nowIso, stepsSig });
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
    file, source: srcEntry.source, forked_from_hash: srcEntry.forked_from_hash,
    forked_from_sig: srcEntry.forked_from_sig, forked_from_steps: srcEntry.forked_from_steps,
    forked_at: nowIso || null,
  });
  writeBpmn(sessionFolder, entry, xml);
  upsert(anno, entry);
  return entry;
}

/* "Delete" removes the manifest ROW here; the save of the annotations that
   follows takes its .bpmn out of derived_maps/ (lane CC: main.js moves a file
   no entry names any more to the holding folder of removed files,
   analyst-files.js), and one Ctrl+Z writes the row back, which brings the file
   back with it, a working entry that still carries its edits. Unlinking here
   would leave an Undo a row pointing at a deleted file. `sessionFolder` is kept
   for signature parity with fork. */
function destroy({ sessionFolder, anno, id }) {
  void sessionFolder;
  return remove(anno, id);
}

module.exports = {
  KINDS, PDD_ROLES, DERIVED_DIR,
  hashContent, fileHash, processSignature, sourceMarks, genId,
  ensure, list, find, buildEntry, upsert, remove, rename, setPddRole, setRole, pddPick, isStale, predatesRichMap, predatesLabels,
  derivedDir, absPath, fileExists, writeBpmn, readBpmn, deleteBpmn,
  forkEntry, fork, duplicate, destroy,
};
