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
 * copy the PDD's As-Is map when none is chosen. A copy never follows the
 * analysis afterwards; the PDD's caption says it is hand-edited
 * (pdd_export._write_tobe_map).
 */

"use strict";

const State = require("./state.js");
const Session = require("./session.js");
const RefStore = require("./reference-maps.js");
const PdtBpmn = require("./bpmn-viewer.js");
const AsIsView = require("./asis-view.js");
const SaveState = require("./save-state.js");
const { toast, escapeHtml } = require("./dom.js");

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
async function persist(label) {
  const s = session();
  if (!s) return;
  await Session.saveAnnotationsWithUndo(s.annotations, label);
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
/* The hash of the file a copy was made from, as it is now. Only the
   step-level BPMN is a source; a copy made from another cell before the map
   was reduced to one (the activity-level map) has no source the viewer reads
   any more, so no drift is claimed for it. */
function currentSourceHash(map) {
  const s = session();
  if (!s || !map || !map.source || map.source.level !== "step") return null;
  const p = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  return p ? RefStore.fileHash(p) : null;
}
function driftFor(map) { return RefStore.isStale(map, currentSourceHash(map)); }

/* ---- the Map's edit act ---------------------------------------------------- */
/* Its label says what it makes (P1.12): the As-Is map while none is chosen,
   in the orange of the screen's next act; a new copy once one is. */
const FORK_ASIS = "Edit as the As-Is map";
const FORK_AGAIN = "Edit a new copy";
function syncForkButton() {
  const btn = $("btn-fork-refmap");
  if (!btn || _forking) return;
  const done = !!_asIsMap(session());
  btn.disabled = false;
  btn.removeAttribute("aria-busy");
  btn.textContent = done ? FORK_AGAIN : FORK_ASIS;
  btn.classList.toggle("primary", !done);
  btn.title = done
    ? "Copy the process map into the editor again, for example to start over. The As-Is map chosen for the PDD stays as it is."
    : "Copy the process map into the editor as the PDD's As-Is map. Your edits stay in the copy: analyzing the project again never changes it.";
}
function _setForkBusy() {
  const btn = $("btn-fork-refmap");
  if (!btn) return;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = "Updating the map...";
  btn.title = "Analyzing the project first, so the copy carries your latest step names";
}

/* ---- the Map level's first view (V2 item 7, C18) --------------------------- */
/* When an As-Is copy is chosen for the PDD, the Map level shows it first,
   drawn by bpmn-js read only and as linked as the map from the runs (a task
   opens the step panel, a file its attachment, a note its text:
   asis-view.js), with Edit beside it; the map from the runs is one click
   away, and back. Per recording, for this window. */
let _mapView = { folder: null, which: "asis" };
let _drawn = null;   // { id, mtime }: the As-Is map on screen

function _fileMtime(s, e) {
  try { return require("node:fs").statSync(RefStore.absPath(s.sessionFolder, e)).mtimeMs; } catch (_) { return null; }
}

function syncMapView() {
  const s = session();
  const folder = s ? s.sessionFolder : null;
  if (_mapView.folder !== folder) { _mapView = { folder, which: "asis" }; _drawn = null; AsIsView.clear(); }
  const asIs = _asIsMap(s);
  if (!asIs && _drawn) { _drawn = null; AsIsView.clear(); }
  const showAsIs = !!asIs && _mapView.which === "asis";
  const box = $("session-map-asis");
  const host = document.querySelector("#session-layout-map .map-host");
  if (box) box.hidden = !showAsIs;
  if (host) host.style.display = showAsIs ? "none" : "";
  // The Map's fit fits the As-Is map while it shows (initRefmapUI).
  const zoom = $("session-map-zoom");
  if (zoom && showAsIs) zoom.style.display = "";
  const back = $("btn-map-show-asis");
  if (back) back.hidden = !(asIs && !showAsIs);
  if (!showAsIs) { AsIsView.hideNote(); return; }
  const title = $("map-asis-title");
  if (title) title.textContent = asIs.name || "As-Is map";
  // Drawn where it shows: a Map level not on screen draws it when it shows.
  const canvas = $("map-asis-canvas");
  if (!canvas || !canvas.clientWidth) return;
  const mtime = _fileMtime(s, asIs);
  if (_drawn && _drawn.id === asIs.map_id && _drawn.mtime === mtime && AsIsView.drawnIn(canvas)) return;
  _drawn = { id: asIs.map_id, mtime };
  AsIsView.draw(canvas, RefStore.readBpmn(s.sessionFolder, asIs));
}

function _showMapView(which) {
  _mapView.which = which;
  syncMapView();
  // The map from the runs is laid out once its host shows.
  if (which === "runs") { try { if (_deps.renderLiveMap) _deps.renderLiveMap(); } catch (_) {} }
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
    ? '<button class="icon-btn xs danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Remove entry</button>'
    : (
      '<label class="refmap-bar-lbl">Use in PDD as ' +
        '<select class="map-status-select" data-rm-pdd="' + esc(m.map_id) + '">' +
          pddOpt("", "None") + pddOpt("as_is", "As-Is map") + pddOpt("to_be", "To-Be map") +
        "</select></label>" +
      '<button class="icon-btn xs" data-rm-act="edit" data-rm-id="' + esc(m.map_id) + '">Edit</button>' +
      (stale ? '<button class="icon-btn xs" data-rm-act="refork" data-rm-id="' + esc(m.map_id) +
        '" title="Make a new copy of the process map as it is now, named like this one. This copy stays as it is.">Copy again</button>' : "") +
      '<button class="icon-btn xs" data-rm-act="dup" data-rm-id="' + esc(m.map_id) + '" title="Copy this map, for example to start the To-Be map from it">Duplicate</button>' +
      '<button class="icon-btn xs danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Delete</button>'
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
  if (!s) return;
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
    if (!window.confirm('Delete the map "' + (e.name || "") + '" from this project? Ctrl+Z restores it.')) return;
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
  if (!s) return;
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
   first: the copy then carries the current step names (F1) and the PDD's
   As-Is image agrees with its own step list. The button is busy meanwhile.
   While the Map shows its lock message there is nothing to copy, and Fork
   says so; a failure is said, never a silent no-op. */
function _needsAnalyze(s, srcPath) {
  const fs = require("node:fs");
  const path = require("node:path");
  let bpmnMs;
  try { bpmnMs = fs.statSync(srcPath).mtimeMs; } catch (_) { return true; }
  try { return fs.statSync(path.join(s.sessionFolder, "annotations.json")).mtimeMs > bpmnMs; }
  catch (_) { return false; }
}

/* `like`: the copy "Copy again" was clicked on; the new copy takes its name
   and kind, and no role (the analyst moves the role when the new copy is
   ready). */
async function onFork(like) {
  const s = session();
  if (!s || !s.sessionFolder) { toast("Open a project first.", "error"); return; }
  if (_forking) return;
  // The Map's lock (overview-view.mapLockHtml, required lazily: the Overview
  // requires this module): no runs marked, not analyzed, or a failed check.
  if (require("./views/overview-view.js").mapLockHtml(s.analysis)) {
    toast("No map to edit yet: the process map is not shown for this project, and the Map says why.", "error");
    return;
  }
  const fs = require("node:fs");
  let srcPath = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  if (srcPath && _deps.analyze && _needsAnalyze(s, srcPath)) {
    _forking = true;
    _setForkBusy();
    let analyzed = false;
    try { analyzed = await _deps.analyze(); }
    finally { _forking = false; syncForkButton(); }
    if (!analyzed) return;   // the analysis said why (its log and toast)
    try { if (_deps.renderLiveMap) _deps.renderLiveMap(); } catch (_) { /* the map redraws on its next render */ }
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
  let entry;
  try {
    entry = _writeMap(cur.sessionFolder, () => RefStore.fork({
      sessionFolder: cur.sessionFolder, anno: cur.annotations, xml,
      source: { notation: "bpmn", level: "step", scope: null }, sourceBpmnPath: srcPath,
      name: like ? like.name : (asIs ? "As-Is map" : "To-Be map"),
      kind: like ? like.kind : (asIs ? "as_is" : "to_be"),
      nowIso: new Date().toISOString(),
    }));
  } catch (e) {
    toast("The map was not copied: " + ((e && e.message) || e), "error");
    return;
  }
  if (asIs) RefStore.setRole(cur.annotations, entry.map_id, "as_is");
  await persist(asIs ? "Make the As-Is map" : "Copy the process map");
  _showGallery(true);
  openEditor(entry.map_id);
}

/* ---- editor overlay ----------------------------------------------------- */
async function openEditor(id) {
  const s = session();
  if (!s) return;
  const e = RefStore.find(s.annotations, id);
  if (!e) return;
  if (!RefStore.fileExists(s.sessionFolder, e)) {
    toast("This map's file is missing: remove the entry, or make a new copy.", "error");
    return;
  }
  _editingId = id;
  const full = RefStore.absPath(s.sessionFolder, e);
  const nameInput = $("refmap-editor-name");
  const pddSel = $("refmap-editor-pdd");
  if (nameInput) nameInput.value = e.name || "";
  if (pddSel) pddSel.value = e.pdd_role || "";
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "";
  const host = $("refmap-editor-host");
  if (!host) return;
  try {
    // Its saves report to the save state in the top bar.
    await PdtBpmn.render(host, full, { editable: true, report: _mapReport(s.sessionFolder) });
    setTimeout(() => { try { PdtBpmn.fit && PdtBpmn.fit(); } catch (_) {} }, 60);
  } catch (err) {
    toast("Could not open the map: " + ((err && err.message) || err), "error");
  }
}
async function closeEditor() {
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "none";
  _editingId = null;
  // An edit still waiting for its delayed write is written first, so the
  // As-Is map drawn from the file shows it.
  await PdtBpmn.flush();
  // Redraw the process map the overlay covered, so it is laid out at its size.
  try { _deps.renderLiveMap && _deps.renderLiveMap(); } catch (_) {}
  refresh();
}
async function onEditorField(which) {
  const s = session();
  if (!s || !_editingId) return;
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
   path writes to tmp and passes as --pdd-map-image / --pdd-tobe-image. Uses a
   throwaway off-screen bpmn-js so it never disturbs the live/editor viewer. */
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
/* A BPMN diagram drawn by an off-screen bpmn-js and saved as a PNG data URL,
   or null. The one renderer of the PDD's map images: the As-Is and To-Be
   copies above, and (AD-28) the map from the runs, process_map_step.bpmn,
   when no As-Is copy exists (renderer.js exportArtifact). Export, Process
   map (image) saves the SVG it draws (xmlToSvg, renderer.js exportMapSvg),
   so the picture saved is the PDD's. */
async function renderBpmnToPng(xml) {
  if (!xml) return null;
  const svg = await xmlToSvg(xml);
  if (!svg) return null;
  try { return await svgToPng(svg); } catch (_) { return null; }
}
function xmlToSvg(xml) {
  return new Promise((resolve) => {
    if (typeof BpmnJS === "undefined") { resolve(null); return; }
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-99999px;top:-99999px;width:1600px;height:1200px;";
    document.body.appendChild(host);
    const v = new BpmnJS({ container: host });
    v.importXML(xml)
      .then(() => v.saveSVG())
      .then(({ svg }) => resolve(svg || null))
      .catch((e) => { console.error("[refmap-ui] a map could not be drawn:", e); resolve(null); })
      .finally(() => { try { v.destroy(); } catch (_) {} host.remove(); });
  });
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
/* deps = { renderLiveMap, sourceBpmnPath, analyze } (renderer.js); analyze
   resolves true when the session was analyzed and reloaded. */
function initRefmapUI(deps) {
  _deps = deps || {};
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
  // V2 item 7: the As-Is map first, read only; Edit beside it; the map from
  // the runs one click away, and back.
  const editAsIs = $("btn-map-asis-edit");
  if (editAsIs) editAsIs.addEventListener("click", () => { const e = _asIsMap(session()); if (e) openEditor(e.map_id); });
  const showRuns = $("btn-map-show-runs");
  if (showRuns) showRuns.addEventListener("click", () => _showMapView("runs"));
  const showAsIs = $("btn-map-show-asis");
  if (showAsIs) showAsIs.addEventListener("click", () => _showMapView("asis"));
  // The Map's fit fits the As-Is map while it shows (map-controller.js fits
  // the map from the runs).
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
  // Process map (image) saves the same drawing as SVG.
  renderBpmnToPng, renderBpmnToSvg: xmlToSvg, needsAnalyze: _needsAnalyze,
};
