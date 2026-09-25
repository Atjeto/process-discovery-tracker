/*
 * refmap-ui.js: the edited maps (the ADR-0019 reference maps). The Map's
 * edit act (Fork), the gallery panel, and the full-screen editor overlay,
 * plus the PDD image bridge.
 *
 * Store logic lives in reference-maps.js (pure, testable). This module is the
 * thin renderer glue: it wires DOM by id, persists through the annotations
 * undo layer (Session.saveAnnotationsWithUndo, so every verb is Ctrl+Z-able),
 * and reuses the singleton bpmn-viewer in `editable` mode for the editor.
 * The map files it writes (a new copy, a duplicate, the editor's saves) are
 * reported to the save state in the top bar (save-state.js, channel "map").
 *
 * One act (AD-19): the Map's primary button copies the process map into the
 * editor, after an analysis when the steps changed since the map's BPMN file
 * was written (so the copy carries the current step names, F1), and makes the
 * copy the PDD's As-Is map when none is chosen. The copy is kept at its first
 * change (in the map, its name or its role): leaving the editor without one
 * keeps nothing, no row and no file (lane MV). A copy never follows the
 * analysis afterwards; the PDD's caption says it is hand-edited
 * (pdd_export._write_tobe_map).
 *
 * The Map level's picture (lane MV, map-view.js): the map the PDD prints, the
 * As-Is copy chosen for it, else process_map_step.bpmn, drawn by bpmn-js
 * (asis-view.js); how the transactions ran (the live map) one click away.
 * That file changes only when the project is analyzed, so the Map analyzes
 * first when annotations.json is newer, once per change, keeping the
 * picture it had meanwhile.
 */

"use strict";

const State = require("./state.js");
const Session = require("./session.js");
const RefStore = require("./reference-maps.js");
const PdtBpmn = require("./bpmn-viewer.js");
const AsIsView = require("./asis-view.js");
const AsIsLinks = require("./asis-links.js");
const Planes = require("./map-planes.js");
const MapView = require("./map-view.js");
const SaveState = require("./save-state.js");
const AsIsFresh = require("./asis-freshness.js");
const RO = require("./read-only.js");
const { toast, escapeHtml } = require("./dom.js");
const { confirmModal } = require("./modals.js");
const { TextWrapModule } = require("./bpmn-text-wrap.js");

let _deps = {};
let _editingId = null;
let _forking = false;
const $ = (id) => document.getElementById(id);

const esc = escapeHtml;   // shared escaper (deduped from dom.js)
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso); }
}
function session() { return State.getSession(); }

/* ---- the step map's freshness --------------------------------------------- */
/* process_map_step.bpmn is current when it is newer than annotations.json.
   A write that changes only the edited maps (a copy kept, renamed, given a
   role, duplicated, deleted) or the analysis's own rewrite of
   annotations.json for the PDD leaves it current: such a write marks the
   annotations.json it left as current (_current), so no analysis follows it.
   Any other write gives annotations.json another time, which the mark does
   not name. */
let _current = null;   // { folder, mtime }: annotations.json at that time is current for the map
function _fileMtime(p) {
  if (!p) return null;
  try { return require("node:fs").statSync(p).mtimeMs; } catch (_) { return null; }
}
function _annoMtime(folder) {
  return folder ? _fileMtime(require("node:path").join(folder, "annotations.json")) : null;
}
function _markCurrent(s) {
  if (s && s.sessionFolder) _current = { folder: s.sessionFolder, mtime: _annoMtime(s.sessionFolder) };
}
/* Whether process_map_step.bpmn (`srcPath`) needs an analysis before it is
   shown or copied: missing, or older than annotations.json. Never in a
   hand-off opened read only (lane HV): it shows the map it came with. */
function _needsAnalyze(s, srcPath) {
  if (RO.isReadOnly(s)) return false;
  const bpmnMs = _fileMtime(srcPath);
  if (bpmnMs == null) return true;
  const annoMs = s ? _annoMtime(s.sessionFolder) : null;
  if (annoMs == null || annoMs <= bpmnMs) return false;
  return !(_current && _current.folder === s.sessionFolder && _current.mtime === annoMs);
}
function _stepMapCurrent(s) {
  const src = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  return !!(s && src && !_needsAnalyze(s, src));
}
/* Run `write`, a write of annotations.json that leaves the steps as they
   are (the analysis that writes the PDD, renderer.js), and keep the step map
   current when it was. */
async function keepingStepMapCurrent(write) {
  const s = session();
  const was = _stepMapCurrent(s);
  const out = await write();
  const now = session();
  if (was && now && s && now.sessionFolder === s.sessionFolder) _markCurrent(now);
  return out;
}

/* The edited maps' own saves: they change no step, so a step map current
   before stays current. */
async function persist(label) {
  const s = session();
  if (!s) return;
  const was = _stepMapCurrent(s);
  await Session.saveAnnotationsWithUndo(s.annotations, label);
  if (was) _markCurrent(s);
}

/* A write of a map file of the project at `folder`, reported to the save
   state like every write of the project: { phase: "start" }, then
   { phase: "end", ok, error, code }. */
function _mapReport(folder) {
  return (evt) => SaveState.noteWrite(Object.assign({ folder, channel: "map" }, evt));
}
/* Run `write` (a new copy, a duplicate) with its report; a failure is
   reported and thrown on to the act, which says it. */
function _writeMap(folder, write) {
  const report = _mapReport(folder);
  report({ phase: "start" });
  try {
    const out = write();
    report({ phase: "end", ok: true, error: null, code: null });
    return out;
  } catch (e) {
    report({ phase: "end", ok: false, error: (e && e.message) || String(e), code: (e && e.code) || null });
    throw e;
  }
}

/* The copy chosen as the PDD's As-Is map, when its file is on disk (the
   Overview's As-Is stage asks the same, overview-view.pathState). */
function _asIsMap(s) {
  const e = s ? RefStore.pddPick(s.annotations, "as_is") : null;
  return e && RefStore.fileExists(s.sessionFolder, e) ? e : null;
}

/* ---- drift -------------------------------------------------------------- */
/* Whether a copy was made before the steps changed (asis-freshness.js): a
   copy that kept the signature of the maps its steps drew compares it with
   the steps now, at once; an older copy compares the process of
   process_map_step.bpmn with the one it was copied from (so an analysis
   that only writes the same map in another order says nothing), once the
   steps are analyzed. A copy made from another map than the step map (the
   activity-level map of old) claims no drift. */
function driftFor(map) {
  return AsIsFresh.copyStale(session(), map);
}

/* ---- the Map's edit act ---------------------------------------------------- */
/* Its label says what it makes (P1.12): the As-Is map while none is chosen,
   in the orange of the screen's next act; a new copy once one is. */
const FORK_ASIS = "Edit as the As-Is map";
const FORK_AGAIN = "Edit a new copy";
/* Lane FX3 (validation pass 3, F16): while the Map withholds the process map
   (overview-view.mapLockHtml: no transaction marked, not analyzed yet, a
   failed check), or no transaction has a step, there is no map to copy: the
   act is disabled with the reason in its title, and says it at once if it is
   reached, with no analysis. */
const WITHHELD_TO_EDIT = "No map to edit yet: the process map is not shown for this project, and the Map says why.";
const NO_STEPS_TO_EDIT = "No map to edit yet: add steps in Steps to build the map.";
function _hasSteps() {
  return !_deps.hasSteps || !!_deps.hasSteps();
}
/* Why the act cannot copy the map now, or "". The lock is required lazily:
   the Overview requires this module. */
function _forkBlocker(s) {
  if (!s) return "";
  if (require("./views/overview-view.js").mapLockHtml(s.analysis)) return WITHHELD_TO_EDIT;
  return _hasSteps() ? "" : NO_STEPS_TO_EDIT;
}
function syncForkButton() {
  const btn = $("btn-fork-refmap");
  if (!btn || _forking) return;
  const done = !!_asIsMap(session());
  const why = _forkBlocker(session());
  btn.disabled = !!why;
  btn.removeAttribute("aria-busy");
  btn.textContent = done ? FORK_AGAIN : FORK_ASIS;
  btn.classList.toggle("primary", !done);
  btn.title = why ? why : done
    ? "Copy the process map into the editor again, for example to start over. The As-Is map chosen for the PDD stays as it is. A copy you leave unchanged is not kept."
    : "Copy the process map into the editor as the PDD's As-Is map. Your edits stay in the copy: analyzing the project again never changes it. A copy you leave unchanged is not kept.";
}
function _setForkBusy() {
  const btn = $("btn-fork-refmap");
  if (!btn) return;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = "Updating the map...";
  btn.title = "Analyzing the project first, so the copy carries your latest step names";
}

/* ---- the Map level's picture (lane MV; C18, C19) --------------------------- */
/* The Map shows the map the PDD prints (map-view.js pick): the As-Is copy
   chosen for the PDD, else process_map_step.bpmn, drawn by bpmn-js read only
   and linked (a task opens the step panel, a file its attachment, a note its
   text: asis-view.js); how the transactions ran (the live map) is the second
   view, one click away, and back. The view chosen holds per project, for
   this window. Contract C19: the plane of the level the Map shows (the
   picker, _deps.mapPath), the copy's when it has one, else the step map's;
   whether a file has a plane is known once it has been drawn (_defs). One
   header line (#map-view-bar) says which picture shows; one line over the
   map (#map-view-why) says why the picture the PDD prints does not show,
   when it does not. */
let _mapView = { folder: null, which: "map" };
let _drawn = null;         // { key, mtime }: the file on the canvas
let _defs = new Map();     // key => { mtime, defs }: the planes of each file drawn
let _tried = null;         // { folder, mtime }: annotations.json the Map last analyzed for
let _analysis = null;      // the Map's own analysis while it runs (a promise)

/* A file the canvas can draw: { key, file, mtime } (mtime null when it is
   not on disk). */
function _source(key, file) {
  return { key, file, mtime: _fileMtime(file) };
}

/* Whether `src` has a map for the level at `path`: true for the main map;
   true or false once the file has been drawn at this time; else null. */
function _planeOf(src, path) {
  if (!src || src.mtime == null) return null;
  if (!Array.isArray(path) || !path.length) return true;
  const d = _defs.get(src.key);
  if (!d || d.mtime !== src.mtime || !d.defs) return null;
  return !!Planes.findPlane(d.defs, path);
}

/* The Map's own analysis: process_map_step.bpmn is needed and older than
   the steps. It runs once per change of annotations.json (_tried), also
   when it fails or writes no map, and the Map draws again when it ends. */
function _analyzeForMap(s) {
  if (_analysis || !_deps.analyze) return;
  const folder = s.sessionFolder;
  _tried = { folder, mtime: _annoMtime(folder) };
  _analysis = Promise.resolve()
    .then(() => _deps.analyze())
    .catch((e) => { console.error("[refmap-ui] the process map was not updated:", e); return false; })
    .then((ok) => {
      _analysis = null;
      const now = session();
      // What the analysis left in annotations.json is analyzed too.
      if (now && now.sessionFolder === folder) _tried = { folder, mtime: _annoMtime(folder) };
      try { if (_deps.renderMap) _deps.renderMap(); } catch (e) { console.error("[refmap-ui] the Map was not drawn again:", e); }
      return ok;
    });
}

/* The header line: which picture shows (MapView.line), or nothing while the
   live map says why it draws no map. Lane FX2: while the As-Is copy it shows
   was made before the steps changed, it says so, with Copy again. */
function _setBar(p, copy, copyName) {
  const bar = $("map-view-bar");
  if (!bar) return;
  const show = !!p && (p.view === "bpmn" || p.back || !!p.why);
  bar.hidden = !show;
  if (!show) return;
  const l = MapView.line(p, copy, copyName);
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set("map-view-title", l.title);
  set("map-view-note", l.note);
  const edit = $("btn-map-asis-edit");
  if (edit) edit.hidden = !l.edit;
  const stale = $("map-view-stale");
  if (stale) { stale.hidden = !l.stale; stale.textContent = l.stale || ""; }
  const recopy = $("btn-map-asis-recopy");
  if (recopy) recopy.hidden = !l.stale;
  const toRuns = $("btn-map-show-runs");
  if (toRuns) { toRuns.hidden = !l.toRuns; if (l.toRuns) toRuns.textContent = l.toRuns; }
  const toMap = $("btn-map-show-map");
  if (toMap) {
    toMap.hidden = !l.toMap;
    if (l.toMap) {
      toMap.textContent = l.toMap;
      toMap.title = l.toMap === MapView.TO_COPY ? "Show your As-Is map, the map the PDD prints" : "Show the process map, the map the PDD prints";
    }
  }
}

function _setWhy(text) {
  const why = $("map-view-why");
  if (!why) return;
  why.hidden = !text;
  why.textContent = text || "";
}

function syncMapView() {
  const s = session();
  const folder = s ? s.sessionFolder : null;
  if (_mapView.folder !== folder) {
    _mapView = { folder, which: "map" };
    _drawn = null; _defs = new Map(); _tried = null; _current = null;
    AsIsView.clear();
  }
  const box = $("session-map-asis");
  const host = document.querySelector("#session-layout-map .map-host");
  const canvas = $("map-asis-canvas");
  if (!s) { if (box) box.hidden = true; _setBar(null); _setWhy(null); return; }
  const path = _deps.mapPath ? _deps.mapPath() : [];
  const live = _deps.liveMap ? _deps.liveMap() : { locked: false, drawable: true };
  const asIs = _asIsMap(s);
  const copySrc = asIs ? _source("copy:" + asIs.map_id, RefStore.absPath(folder, asIs)) : null;
  const stepPath = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  const stepSrc = _source("step", stepPath);
  const copy = copySrc ? { plane: _planeOf(copySrc, path), stale: driftFor(asIs) } : null;
  const annoMs = _annoMtime(folder);
  const p = MapView.pick({
    want: _mapView.which,
    live,
    copy,
    step: { exists: stepSrc.mtime != null, stale: !stepPath || _needsAnalyze(s, stepPath), plane: _planeOf(stepSrc, path) },
    busy: !!_analysis || !!(_deps.analysisBusy && _deps.analysisBusy()),
    tried: !!(_tried && _tried.folder === folder && _tried.mtime === annoMs),
  });
  if (p.analyze) _analyzeForMap(s);
  _setBar(p, copy, asIs && asIs.name);
  _setWhy(p.why);
  const showMap = p.view === "bpmn";
  if (box) box.hidden = !showMap;
  if (host) host.style.display = showMap ? "none" : "";
  // The Map's fit fits the picture while it shows (initRefmapUI); the live
  // map's controller shows it or not with its own drawing.
  const zoom = $("session-map-zoom");
  if (zoom && showMap) zoom.style.display = "";
  // Reset layout is the live map's (its boxes can be dragged); the picture
  // the PDD prints has none to reset.
  const reset = $("btn-session-map-reset-layout");
  if (reset && showMap) reset.hidden = true;
  if (!showMap) {
    AsIsView.hideNote();
    // The live map is drawn while it shows (its host has its size then).
    try { if (_deps.renderLiveMap) _deps.renderLiveMap(); } catch (e) { console.error("[refmap-ui] the live map was not drawn:", e); }
    return;
  }
  const src = p.source === "copy" ? copySrc : stepSrc;
  // Drawn where it shows: a Map level not on screen draws it when it shows.
  if (!canvas || !canvas.clientWidth) return;
  const current = !!(_drawn && _drawn.key === src.key && _drawn.mtime === src.mtime && AsIsView.drawnIn(canvas));
  if (current) { AsIsView.showLevel(path); return; }
  _drawn = { key: src.key, mtime: src.mtime };
  let xml = null;
  try { xml = require("node:fs").readFileSync(src.file, "utf-8"); } catch (e) { console.error("[refmap-ui] the map file could not be read:", e); }
  // Once drawn, the planes it has (or lacks) decide what shows.
  AsIsView.draw(canvas, xml, path).then((ok) => {
    if (!ok) return;
    _defs.set(src.key, { mtime: src.mtime, defs: AsIsView.definitions() });
    syncMapView();
  });
}

function _showMapView(which) {
  _mapView.which = which;
  syncMapView();
}

/* Whether the Map's own analysis runs (the e2e smokes wait for it). */
function mapBusy() {
  return !!_analysis;
}

/* ---- gallery ------------------------------------------------------------ */
function refresh() {
  const s = session();
  const maps = s ? RefStore.list(s.annotations) : [];
  syncForkButton();
  syncMapView();
  const countEl = $("refmap-count");
  if (countEl) countEl.textContent = maps.length ? "(" + maps.length + ")" : "";
  const listEl = $("refmap-list");
  const emptyEl = $("refmap-empty");
  if (!listEl) return;
  if (!maps.length) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";
  listEl.innerHTML = maps.map((m) => rowHtml(m, s)).join("");
  listEl.querySelectorAll("[data-rm-act]").forEach((btn) => {
    btn.addEventListener("click", () =>
      onRowAction(btn.getAttribute("data-rm-act"), btn.getAttribute("data-rm-id")));
  });
  listEl.querySelectorAll("[data-rm-pdd]").forEach((sel) => {
    sel.addEventListener("change", () => onRowPdd(sel.getAttribute("data-rm-pdd"), sel.value));
  });
}

/* Copy again (lane FX2): a new copy of the process map as it is now, named
   like the copy it was clicked on, kept at its first change (as Edit's), and
   then in that copy's place in the PDD. */
const RECOPY_TITLE = "Make a new copy of the process map as it is now, named like this one. It is kept once you change " +
  "something in it, and then takes this copy's place in the PDD; this copy stays as it is.";

/* What Copy again gives a copy the process map changed after (C18): a copy
   made before the map had its colours, notes and attachments gets them. */
function copyAgainLine(m, s) {
  return RefStore.predatesRichMap(RefStore.readBpmn(s.sessionFolder, m))
    ? "Copy again to get the colours, notes and attachments on the map; your edits to this copy are not carried over."
    : "Copy again to get the map as it is now; your edits to this copy are not carried over.";
}

/* One row, one line (P2.5): the name, the date it was made, the one role
   control ("Use in PDD as"), and the verbs; under a copy the process map
   changed after, what Copy again gives. */
function rowHtml(m, s) {
  const missing = !RefStore.fileExists(s.sessionFolder, m);
  const stale = !missing && driftFor(m);
  const date = fmtDate(m.forked_at);
  const pddOpt = (val, lbl) =>
    '<option value="' + val + '"' + (((m.pdd_role || "") === val) ? " selected" : "") + ">" + lbl + "</option>";
  const actions = missing
    ? '<button type="button" class="tool-btn danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Remove entry</button>'
    : (
      '<label class="refmap-bar-lbl">Use in PDD as ' +
        '<select class="map-status-select" data-rm-pdd="' + esc(m.map_id) + '">' +
          pddOpt("", "None") + pddOpt("as_is", "As-Is map") + pddOpt("to_be", "To-Be map") +
        "</select></label>" +
      '<button type="button" class="tool-btn" data-rm-act="edit" data-rm-id="' + esc(m.map_id) + '">Edit</button>' +
      (stale ? '<button type="button" class="tool-btn" data-rm-act="refork" data-rm-id="' + esc(m.map_id) +
        '" title="' + esc(RECOPY_TITLE) + '">Copy again</button>' : "") +
      '<button type="button" class="tool-btn" data-rm-act="dup" data-rm-id="' + esc(m.map_id) + '" title="Copy this map, for example to start the To-Be map from it">Duplicate</button>' +
      '<button type="button" class="tool-btn danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Delete</button>'
    );
  return (
    '<li class="refmap-row' + (missing ? " missing" : "") + '">' +
      '<div class="refmap-row-main">' +
        '<span class="refmap-row-name">' + esc(m.name) + "</span>" +
        (date ? '<span class="refmap-row-date">' + esc(date) + "</span>" : "") +
        (stale ? '<span class="refmap-drift-chip" title="The process map changed after this copy was made. This copy is unchanged.">process map changed</span>' : "") +
        (missing ? '<span class="refmap-missing-chip" title="This map\'s file is gone: remove the entry, or make a new copy.">⚠ file missing</span>' : "") +
      "</div>" +
      '<div class="refmap-row-actions">' + actions + "</div>" +
      (stale ? '<p class="refmap-row-note">' + esc(copyAgainLine(m, s)) + "</p>" : "") +
    "</li>"
  );
}

async function onRowAction(act, id) {
  const s = session();
  if (!s || RO.isReadOnly(s)) return;
  if (act === "edit") { openEditor(id); return; }
  if (act === "dup") {
    const src = RefStore.find(s.annotations, id);
    if (!src) return;
    try {
      _writeMap(s.sessionFolder, () =>
        RefStore.duplicate({ sessionFolder: s.sessionFolder, anno: s.annotations, srcEntry: src, nowIso: new Date().toISOString() }));
    } catch (e) {
      toast("The map was not duplicated: " + ((e && e.message) || e), "error");
      return;
    }
    await persist("Duplicate map");
    refresh();
    return;
  }
  if (act === "del") {
    const e = RefStore.find(s.annotations, id);
    if (!e) return;
    // Lane CC: the save takes its file out of derived_maps/ too, and Ctrl+Z
    // brings both back (analyst-files.js).
    const ok = await confirmModal({
      title: "Delete this map?",
      message: 'The map "' + (e.name || "") + '" leaves this project, with its file in the project folder.',
      detail: "Ctrl+Z brings both back.",
      okLabel: "Delete map",
      danger: true,
    });
    if (!ok || session() !== s) return;
    RefStore.destroy({ sessionFolder: s.sessionFolder, anno: s.annotations, id });
    await persist("Delete map");
    if (_editingId === id) closeEditor();
    refresh();
    return;
  }
  if (act === "refork") {
    await onFork(RefStore.find(s.annotations, id));
    return;
  }
}

async function onRowPdd(id, role) {
  const s = session();
  if (!s || RO.isReadOnly(s)) return;
  RefStore.setRole(s.annotations, id, role || null);
  await persist("Set PDD role");
  refresh();
  if (_editingId === id) { const sel = $("refmap-editor-pdd"); if (sel) sel.value = role || ""; }
  toast(role ? ("Will embed in the PDD as the " + (role === "as_is" ? "As-Is" : "To-Be") + " map.") : "Removed from the PDD.", "info");
}

/* ---- fork --------------------------------------------------------------- */
/* The one act (AD-19). The copy is made from the step-level BPMN the
   pipeline writes on every Analyze (process_map_step.bpmn). That file only
   changes on an Analyze, so when annotations.json is newer than it (a rename,
   a merge, a confirmed run since) or it is missing, the session is analyzed
   first (_needsAnalyze, above; the Map's own update, when one runs, is waited
   for): the copy then carries the current step names (F1) and the PDD's
   As-Is image agrees with its own step list. The button is busy meanwhile.
   While the Map shows its lock message there is nothing to copy, and Fork
   says so; a failure is said, never a silent no-op.
   The copy opens in the editor unsaved and is kept at its first change
   (lane MV, _keepCopy): Edit and leaving without a change keeps nothing. */

/* The editing of a new copy (Edit, Edit a new copy, Copy again): { folder,
   entry, xml, label, kept, touched, replaces, tookRole }. `entry` is its
   row, written with its file at the first change; `touched`: its name or
   role was changed in the editor. Lane FX2, Copy again: the new copy's row
   carries the PDD role of the copy it was asked on (`replaces`), so the
   editor shows it, and takes it from that copy when it is kept (`tookRole`,
   the role it took, given back if the keeping is taken back). */
let _edit = null;

/* `like`: the copy "Copy again" was clicked on (the gallery's row, or the
   Map's header while the As-Is copy it shows is older than the steps). The
   new copy takes its name and kind; like Edit's, it is kept only at its
   first change (lane FX2: leaving the editor without one keeps nothing),
   and then it takes the PDD role of the copy it was asked on. */
async function onFork(like) {
  const s = session();
  if (!s || !s.sessionFolder) { toast("Open a project first.", "error"); return; }
  // Lane HV: no map is copied or edited in a hand-off opened read only.
  if (RO.isReadOnly(s)) return;
  if (_forking) return;
  // The Map's lock (no runs marked, not analyzed, or a failed check) or, lane
  // FX3, no step: no map to copy, said at once, with no analysis.
  const why = _forkBlocker(s);
  if (why) { toast(why, "error"); return; }
  const fs = require("node:fs");
  // The Map's own update of the process map runs: the copy waits for it.
  if (_analysis) {
    _forking = true;
    _setForkBusy();
    try { await _analysis; } finally { _forking = false; syncForkButton(); }
  }
  let srcPath = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  if (srcPath && _deps.analyze && _needsAnalyze(session(), srcPath)) {
    _forking = true;
    _setForkBusy();
    let analyzed = false;
    try { analyzed = await _deps.analyze(); }
    finally { _forking = false; syncForkButton(); }
    if (!analyzed) return;   // the analysis said why (its log and toast)
    try { if (_deps.renderMap) _deps.renderMap(); } catch (_) { /* the map redraws on its next render */ }
    srcPath = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  }
  const cur = session();
  if (!cur || !srcPath || !fs.existsSync(srcPath)) {
    toast("No map to edit yet: the analysis drew no process map for these transactions.", "error");
    return;
  }
  let xml = null;
  try { xml = fs.readFileSync(srcPath, "utf-8"); } catch (e) {
    toast("Could not read the process map file: " + ((e && e.message) || e), "error");
    return;
  }
  // The first copy becomes the PDD's As-Is map. A later one is named for
  // what the next map usually is, the To-Be map, and waits for the analyst
  // to choose its role (the As-Is map already chosen stays).
  const asIs = !like && !_asIsMap(cur);
  const made = {
    xml, source: { notation: "bpmn", level: "step", scope: null }, sourceBpmnPath: srcPath,
    name: like ? like.name : (asIs ? "As-Is map" : "To-Be map"),
    kind: like ? like.kind : (asIs ? "as_is" : "to_be"),
    nowIso: new Date().toISOString(),
    // Lane FX2: the maps the steps draw now, so the copy says when the
    // steps change after it (asis-freshness.js).
    stepsSig: AsIsFresh.stepsMapSignature(cur.annotations, cur.stats),
  };
  const entry = RefStore.forkEntry(made);
  const role = asIs ? "as_is" : like && RefStore.PDD_ROLES.includes(like.pdd_role) ? like.pdd_role : null;
  if (role) { entry.pdd_role = role; entry.kind = role; }
  _edit = { folder: cur.sessionFolder, entry, xml,
    label: like ? "Copy the process map again" : asIs ? "Make the As-Is map" : "Copy the process map",
    kept: false, touched: false, replaces: like ? like.map_id : null, tookRole: null };
  if (like) _showGallery(true);
  await _openEditorOn(cur, entry, xml);
}

/* The new copy's first change keeps it: its file (the process map as it was
   copied; the editor writes the change over it a moment later), its row,
   its role, and one undo entry. */
async function _keepCopy() {
  const t = _edit;
  if (!t || t.kept) return;
  const s = session();
  if (!s || s.sessionFolder !== t.folder) return;
  t.kept = true;
  try {
    _writeMap(t.folder, () => RefStore.writeBpmn(t.folder, t.entry, t.xml));
  } catch (e) {
    t.kept = false;
    toast("The map was not copied: " + ((e && e.message) || e), "error");
    return;
  }
  // Copy again (lane FX2): the new copy takes the PDD role of the copy it was
  // asked on (roles are exclusive, so that copy lets it go below).
  const old = t.replaces ? RefStore.find(s.annotations, t.replaces) : null;
  t.tookRole = old && old.pdd_role && old.pdd_role === t.entry.pdd_role ? old.pdd_role : null;
  RefStore.upsert(s.annotations, t.entry);
  if (t.entry.pdd_role) RefStore.setRole(s.annotations, t.entry.map_id, t.entry.pdd_role);
  try { await persist(t.label); } catch (_) { /* the save said why; the next save writes it */ }
}

/* A new copy kept at its first change whose changes were all undone before
   the editor closed keeps nothing either: its keeping is taken back (its
   undo entry, its row, its file). When something else was saved since (its
   undo entry is not the last), it stays, since taking it back would undo
   that too. */
async function _takeBack(t) {
  const s = session();
  if (!s || s.sessionFolder !== t.folder) return false;
  const entry = RefStore.find(s.annotations, t.entry.map_id);
  if (!entry) return false;
  const last = State.popUndo(t.folder);
  if (!last || last.label !== t.label) { if (last) State.pushUndo(last); return false; }
  const was = _stepMapCurrent(s);
  RefStore.remove(s.annotations, entry.map_id);
  RefStore.deleteBpmn(t.folder, entry);
  // Copy again: the copy it was asked on gets its PDD role back.
  if (t.tookRole && t.replaces && RefStore.find(s.annotations, t.replaces)) RefStore.setRole(s.annotations, t.replaces, t.tookRole);
  try { await Session.saveAnnotationsDirect(s.annotations, "the unchanged copy removed"); }
  catch (_) { /* the save said why; the next save writes it */ }
  if (was) _markCurrent(s);
  return true;
}

/* ---- editor overlay ----------------------------------------------------- */
/* Open a copy that is kept (the Map's Edit, a gallery row). */
async function openEditor(id) {
  const s = session();
  if (!s || RO.isReadOnly(s)) return;
  const e = RefStore.find(s.annotations, id);
  if (!e) return;
  if (!RefStore.fileExists(s.sessionFolder, e)) {
    toast("This map's file is missing: remove the entry, or make a new copy.", "error");
    return;
  }
  _edit = null;
  await _openEditorOn(s, e, null);
}
/* The editor overlay on `entry`: its file, or `xml` for a new copy whose
   file is written at its first change. */
async function _openEditorOn(s, entry, xml) {
  _editingId = entry.map_id;
  const full = RefStore.absPath(s.sessionFolder, entry);
  const nameInput = $("refmap-editor-name");
  const pddSel = $("refmap-editor-pdd");
  if (nameInput) nameInput.value = entry.name || "";
  if (pddSel) pddSel.value = entry.pdd_role || "";
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "";
  const host = $("refmap-editor-host");
  if (!host) return;
  try {
    // Its saves report to the save state in the top bar; a new copy is kept
    // at its first change.
    await PdtBpmn.render(host, full, {
      editable: true, report: _mapReport(s.sessionFolder),
      xml: xml == null ? undefined : xml,
      onChange: () => { _keepCopy().catch((e) => console.error("[refmap-ui] the new copy was not kept:", e)); },
    });
    setTimeout(() => { try { PdtBpmn.fit && PdtBpmn.fit(); } catch (_) {} }, 60);
  } catch (err) {
    toast("Could not open the map: " + ((err && err.message) || err), "error");
  }
}
async function closeEditor() {
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "none";
  // Ctrl+Z and Ctrl+Y are the viewer's again (bpmn-viewer.js bound them to
  // the map while the editor showed).
  PdtBpmn.unbindKeys();
  _editingId = null;
  const t = _edit;
  _edit = null;
  // An edit still waiting for its delayed write is written first, so the
  // map drawn from the file shows it.
  await PdtBpmn.flush();
  if (t && t.kept) {
    // A new copy: kept when it differs from the process map (or was named
    // or given a role); one whose changes were all undone is taken back.
    const dropped = !t.touched && !(await PdtBpmn.changed()) && await _takeBack(t);
    if (!dropped) { _mapView.which = "map"; _showGallery(true); }
  }
  // A new copy never changed left nothing: no row, no file, and the Map
  // shows what it showed before.
  refresh();
}
async function onEditorField(which) {
  const s = session();
  if (!s || !_editingId) return;
  const t = _edit && _edit.entry.map_id === _editingId ? _edit : null;
  if (t) t.touched = true;
  if (t && !t.kept) {
    // A name or a role given to a new copy keeps it, with them.
    if (which === "name") {
      const v = (($("refmap-editor-name") || {}).value || "").trim();
      if (v) t.entry.name = v;
    } else if (which === "pdd") {
      const v = ($("refmap-editor-pdd") || {}).value || null;
      t.entry.pdd_role = v;
      if (v) t.entry.kind = v;
    }
    await _keepCopy();
    refresh();
    return;
  }
  if (which === "name") {
    const v = ($("refmap-editor-name") || {}).value || "";
    RefStore.rename(s.annotations, _editingId, v);
    await persist("Rename map");
  } else if (which === "pdd") {
    const v = ($("refmap-editor-pdd") || {}).value;
    RefStore.setRole(s.annotations, _editingId, v || null);
    await persist("Set PDD role");
  }
  refresh();
}

/* ---- PDD image bridge ---------------------------------------------------
   Render the maps selected for the PDD (pdd_role) to PNG data URLs the export
   path writes to tmp and passes as --pdd-map-image / --pdd-tobe-image (C19:
   and the sub-processes' maps, renderPlanesToPng, in the manifest passed as
   --pdd-map-images). Uses a throwaway off-screen bpmn-js so it never disturbs
   the live/editor viewer. */
async function renderPddMaps() {
  const out = { asis: null, tobe: null };
  const s = session();
  if (!s) return out;
  const asis = RefStore.pddPick(s.annotations, "as_is");
  const tobe = RefStore.pddPick(s.annotations, "to_be");
  if (asis) out.asis = await renderEntryToPng(s.sessionFolder, asis);
  if (tobe) out.tobe = await renderEntryToPng(s.sessionFolder, tobe);
  return out;
}
async function renderEntryToPng(sessionFolder, entry) {
  return renderBpmnToPng(RefStore.readBpmn(sessionFolder, entry));
}
/* A picture the PDD prints leaves the steps' notes out (lane FX2): the note
   dialog promises that notes stay in the app. The Map on screen, Export's
   map image and the BPMN file keep them. */
const PDD_PICTURE = { withoutNotes: true };
/* A BPMN diagram drawn by an off-screen bpmn-js and saved as a PNG data URL,
   or null. The one renderer of the PDD's map images: the As-Is and To-Be
   copies above, and (AD-28) the map from the runs, process_map_step.bpmn,
   when no As-Is copy exists (renderer.js exportArtifact). Export, Process
   map (image) saves the SVG the same renderer draws (xmlToSvg, renderer.js
   exportMapSvg), with the notes the PDD's picture leaves out. */
async function renderBpmnToPng(xml) {
  if (!xml) return null;
  const svg = (await _drawPlanes(xml, [[]], PDD_PICTURE)).maps[0].svg;
  if (!svg) return null;
  try { return await svgToPng(svg); } catch (_) { return null; }
}
/* The main map of a BPMN diagram as SVG, or null. */
function xmlToSvg(xml) {
  return _drawPlanes(xml, [[]]).then((r) => r.maps[0].svg);
}
/* The steps' notes (asis-links.isStepNote) and the lines that join them to
   their tasks, taken off a drawn diagram: its picture then shows neither.
   Only the drawing changes; the diagram's file is not touched. */
function _dropNotes(v) {
  const canvas = v.get("canvas");
  for (const note of v.get("elementRegistry").filter((el) => AsIsLinks.isStepNote(el) && !el.labelTarget)) {
    for (const line of [...(note.incoming || []), ...(note.outgoing || [])]) {
      try { canvas.removeConnection(line); } catch (_) { /* already gone */ }
    }
    try { canvas.removeShape(note); } catch (_) { /* already gone */ }
  }
}

/* Contract C19: the maps of one BPMN diagram (its planes, map-planes.js),
   drawn by one off-screen bpmn-js and saved as SVG, the plane of each path of
   `paths` ([] the main map) in turn (saveSVG saves the plane shown):
   { drawn, maps: [{ svg, found }] }, found false for a map the file has no
   plane for; drawn false (and every svg null) when the file could not be
   drawn at all. `opts.withoutNotes` (the PDD's pictures, lane FX2): the
   steps' notes are left out of every plane. */
function _drawPlanes(xml, paths, opts) {
  const list = Array.isArray(paths) ? paths : [];
  const none = () => ({ drawn: false, maps: list.map(() => ({ svg: null, found: false })) });
  return new Promise((resolve) => {
    if (typeof BpmnJS === "undefined" || !xml) { resolve(none()); return; }
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-99999px;top:-99999px;width:1600px;height:1200px;";
    document.body.appendChild(host);
    // Lane FX3: names break between words, as on the Map (bpmn-text-wrap.js).
    const v = new BpmnJS({ container: host, additionalModules: [TextWrapModule] });
    v.importXML(xml)
      .then(async () => {
        const canvas = v.get("canvas");
        const main = canvas.getRootElement();
        if (opts && opts.withoutNotes) _dropNotes(v);
        const maps = [];
        for (const p of list) {
          const sub = Array.isArray(p) && p.length > 0;
          const id = sub ? Planes.findPlane(v.getDefinitions(), p) : null;
          const root = !sub ? main : id ? canvas.findRoot(id + "_plane") : null;
          if (!root) { maps.push({ svg: null, found: false }); continue; }
          if (canvas.getRootElement() !== root) canvas.setRootElement(root);
          const { svg } = await v.saveSVG();
          maps.push({ svg: svg || null, found: true });
        }
        resolve({ drawn: true, maps });
      })
      .catch((e) => { console.error("[refmap-ui] a map could not be drawn:", e); resolve(none()); })
      .finally(() => { try { v.destroy(); } catch (_) {} host.remove(); });
  });
}
/* The maps at `paths` of one BPMN diagram as PNG data URLs (null for one it
   has no plane for, or that could not be drawn): the PDD's pictures of the
   sub-processes' maps (renderer.js exportArtifact), without the steps'
   notes. */
async function renderPlanesToPng(xml, paths) {
  const r = await _drawPlanes(xml, paths, PDD_PICTURE);
  const out = [];
  for (const m of r.maps) {
    let png = null;
    if (m.svg) { try { png = await svgToPng(m.svg); } catch (_) { png = null; } }
    out.push(png);
  }
  return out;
}
/* The map at `path` of one BPMN diagram as SVG (Export, Process map
   (image)): { svg, missing }, missing when the file draws but has no plane
   for that map. */
async function renderPlaneToSvg(xml, path) {
  const r = await _drawPlanes(xml, [Array.isArray(path) ? path : []]);
  return { svg: r.maps[0].svg, missing: r.drawn && !r.maps[0].found };
}
function svgToPng(svg, scale) {
  scale = scale || 2;
  return new Promise((resolve, reject) => {
    // Ensure the SVG declares a size so the off-screen <img> has natural dims.
    let dimW = 1200, dimH = 800;
    const vb = /viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    if (vb) { dimW = Math.ceil(parseFloat(vb[1])) || dimW; dimH = Math.ceil(parseFloat(vb[2])) || dimH; }
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || dimW;
      const h = img.naturalHeight || dimH;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      try { ctx.drawImage(img, 0, 0, w, h); } catch (e) { URL.revokeObjectURL(url); reject(e); return; }
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/* ---- gallery toggle ------------------------------------------------------ */
/* Show or hide the edited maps (collapsed by default). The toggle is its
   inverse: a click on a shown gallery hides it. */
function _showGallery(show) {
  const panel = $("refmap-panel");
  if (!panel) return;
  panel.style.display = show ? "" : "none";
  const toggle = $("btn-toggle-refmaps");
  if (toggle) toggle.setAttribute("aria-expanded", show ? "true" : "false");
  if (show) refresh();
}

/* ---- init --------------------------------------------------------------- */
/* deps = { renderLiveMap, renderMap, liveMap, sourceBpmnPath, analyze,
   analysisBusy, mapPath, onAsIsLevel, mainMapName, hasSteps } (renderer.js);
   renderLiveMap draws the live map, renderMap the whole Map level while it
   shows; liveMap says whether the live map draws ({ locked, drawable });
   analyze resolves true when the session was analyzed and reloaded, and
   analysisBusy is true while an analysis is queued or running; mapPath is
   the level the Map shows (C19), and onAsIsLevel hears the path of names of
   the plane the picture's own drill down went to; mainMapName names the
   main map. */
function initRefmapUI(deps) {
  _deps = deps || {};
  AsIsView.configure({
    onLevel: (names) => { if (_deps.onAsIsLevel) _deps.onAsIsLevel(names); },
    mainName: () => (_deps.mainMapName ? _deps.mainMapName() : ""),
  });
  const forkBtn = $("btn-fork-refmap");
  if (forkBtn) forkBtn.addEventListener("click", () => onFork());
  const toggle = $("btn-toggle-refmaps");
  if (toggle) toggle.addEventListener("click", () => {
    const panel = $("refmap-panel");
    if (!panel) return;
    _showGallery(panel.style.display === "none");
  });
  const closeBtn = $("btn-refmap-editor-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeEditor());
  // The map the PDD prints first, read only; the As-Is copy's Edit beside
  // it; how the transactions ran one click away, and back.
  const editAsIs = $("btn-map-asis-edit");
  if (editAsIs) editAsIs.addEventListener("click", () => { const e = _asIsMap(session()); if (e) openEditor(e.map_id); });
  // Lane FX2: Copy again on the header, while the As-Is copy shown is older
  // than the steps.
  const recopy = $("btn-map-asis-recopy");
  if (recopy) recopy.addEventListener("click", () => { const e = _asIsMap(session()); if (e) onFork(e); });
  const showRuns = $("btn-map-show-runs");
  if (showRuns) showRuns.addEventListener("click", () => _showMapView("runs"));
  const showMap = $("btn-map-show-map");
  if (showMap) showMap.addEventListener("click", () => _showMapView("map"));
  // The Map's fit fits the picture while it shows (map-controller.js fits
  // the live map).
  const fitBtn = $("btn-session-map-zoom-fit");
  if (fitBtn) fitBtn.addEventListener("click", () => { const box = $("session-map-asis"); if (box && !box.hidden) AsIsView.fit(); });
  const nameInput = $("refmap-editor-name");
  if (nameInput) nameInput.addEventListener("change", () => onEditorField("name"));
  const pddSel = $("refmap-editor-pdd");
  if (pddSel) pddSel.addEventListener("change", () => onEditorField("pdd"));
  // Esc closes the editor.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _editingId) { const o = $("refmap-editor-overlay"); if (o && o.style.display !== "none") closeEditor(); }
  });
}

module.exports = {
  initRefmapUI, refresh, renderPddMaps, showGallery: _showGallery,
  // The PDD export's map from the runs (renderer.js): the same renderer, and
  // the rule for when process_map_step.bpmn is older than the steps. Export,
  // Process map (image) saves the same drawing as SVG. C19: the maps of the
  // sub-processes, one plane each.
  renderBpmnToPng, renderBpmnToSvg: xmlToSvg, needsAnalyze: _needsAnalyze,
  renderPlanesToPng, renderPlaneToSvg,
  // Lane MV: the PDD's own run keeps the step map current; the Map's own
  // analysis while it runs.
  keepingStepMapCurrent, mapBusy,
};
