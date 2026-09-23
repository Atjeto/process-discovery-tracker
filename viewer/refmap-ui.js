/*
 * refmap-ui.js -- the Reference Maps surface (ADR-0019): the Fork action, the
 * gallery panel, and the full-screen editor overlay, plus the PDD image bridge.
 *
 * Store logic lives in reference-maps.js (pure, testable). This module is the
 * thin renderer glue: it wires DOM by id, persists through the annotations
 * undo layer (Session.saveAnnotationsWithUndo, so every verb is Ctrl+Z-able),
 * and reuses the singleton bpmn-viewer in `editable` mode for the editor.
 *
 * Honesty invariant: a reference map can never be mistaken for the live mined
 * map. The editor wears a distinct badge + chrome; every gallery row states
 * "hand-edited, not updated by analysis"; PDD embeds carry a provenance caption
 * (pdd_export._write_tobe_map).
 */

"use strict";

const State = require("./state.js");
const Session = require("./session.js");
const RefStore = require("./reference-maps.js");
const PdtBpmn = require("./bpmn-viewer.js");
const { toast, escapeHtml } = require("./dom.js");

let _deps = {};
let _editingId = null;
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

/* ---- drift -------------------------------------------------------------- */
/* The hash of the file a copy was forked from, as it is now. Only the
   step-level BPMN is a fork source; a copy forked from another cell before
   the map was reduced to one (the activity-level map) has no source the
   viewer reads any more, so no drift is claimed for it. */
function currentSourceHash(map) {
  const s = session();
  if (!s || !map || !map.source || map.source.level !== "step") return null;
  const p = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  return p ? RefStore.fileHash(p) : null;
}
function driftFor(map) { return RefStore.isStale(map, currentSourceHash(map)); }

/* ---- gallery ------------------------------------------------------------ */
function refresh() {
  const s = session();
  const maps = s ? RefStore.list(s.annotations) : [];
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

function rowHtml(m, s) {
  const missing = !RefStore.fileExists(s.sessionFolder, m);
  const stale = !missing && driftFor(m);
  const date = fmtDate(m.forked_at);
  const cell = RefStore.cellLabel(m.source);
  const pddOpt = (val, lbl) =>
    '<option value="' + val + '"' + (((m.pdd_role || "") === val) ? " selected" : "") + ">" + lbl + "</option>";
  const actions = missing
    ? '<button class="icon-btn xs danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Remove entry</button>'
    : (
      '<label class="refmap-bar-lbl">PDD ' +
        '<select class="map-status-select" data-rm-pdd="' + esc(m.map_id) + '">' +
          pddOpt("", "No") + pddOpt("as_is", "As-Is map") + pddOpt("to_be", "To-Be map") +
        "</select></label>" +
      '<button class="icon-btn xs" data-rm-act="edit" data-rm-id="' + esc(m.map_id) + '">Edit</button>' +
      (stale ? '<button class="icon-btn xs" data-rm-act="refork" data-rm-id="' + esc(m.map_id) +
        '" title="Make a NEW copy from the current mined map; this copy is left untouched.">Re-fork</button>' : "") +
      '<button class="icon-btn xs" data-rm-act="dup" data-rm-id="' + esc(m.map_id) + '">Duplicate</button>' +
      '<button class="icon-btn xs danger" data-rm-act="del" data-rm-id="' + esc(m.map_id) + '">Delete</button>'
    );
  return (
    '<li class="refmap-row' + (missing ? " missing" : "") + '">' +
      '<div class="refmap-row-main">' +
        '<span class="refmap-kind-chip kind-' + esc(m.kind) + '">' + esc(RefStore.kindLabel(m.kind)) + "</span>" +
        '<span class="refmap-row-name">' + esc(m.name) + "</span>" +
        (m.pdd_role && !missing ? '<span class="refmap-pdd-chip">in PDD · ' + (m.pdd_role === "as_is" ? "As-Is" : "To-Be") + "</span>" : "") +
        (stale ? '<span class="refmap-drift-chip" title="The mined map this was forked from has since changed. This copy is unchanged.">source changed</span>' : "") +
        (missing ? '<span class="refmap-missing-chip" title="The .bpmn file for this entry is gone: remove the stale entry or re-fork.">⚠ file missing</span>' : "") +
      "</div>" +
      '<div class="refmap-row-meta">forked from ' + esc(cell) + (date ? " · " + esc(date) : "") +
        " · hand-edited, not updated by analysis</div>" +
      '<div class="refmap-row-actions">' + actions + "</div>" +
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
    RefStore.duplicate({ sessionFolder: s.sessionFolder, anno: s.annotations, srcEntry: src, nowIso: new Date().toISOString() });
    await persist("Duplicate reference map");
    refresh();
    return;
  }
  if (act === "del") {
    const e = RefStore.find(s.annotations, id);
    if (!e) return;
    if (!window.confirm('Remove reference map "' + (e.name || "") + '" from this session? Ctrl+Z restores it.')) return;
    RefStore.destroy({ sessionFolder: s.sessionFolder, anno: s.annotations, id });
    await persist("Delete reference map");
    if (_editingId === id) closeEditor();
    refresh();
    return;
  }
  if (act === "refork") {
    await onFork();
    return;
  }
}

async function onRowPdd(id, role) {
  const s = session();
  if (!s) return;
  RefStore.setPddRole(s.annotations, id, role || null);
  await persist("Set PDD role");
  refresh();
  if (_editingId === id) { const sel = $("refmap-editor-pdd"); if (sel) sel.value = role || ""; }
  toast(role ? ("Will embed in the PDD as the " + (role === "as_is" ? "As-Is" : "To-Be") + " map.") : "Removed from the PDD.", "info");
}

/* ---- fork --------------------------------------------------------------- */
/* Fork copies the step-level BPMN the pipeline writes with --mine
   (process_map_step.bpmn): the process map as a BPMN file bpmn-js can edit.
   It is read from disk, so Fork works from any state of the Map level. The
   copy needs what the map needs: while the Map shows its lock message, Fork
   says so. When no file exists, it fails LOUD with a plain-language toast,
   never a silent no-op. */
async function onFork() {
  const s = session();
  if (!s || !s.sessionFolder) { toast("Open a session first.", "error"); return; }
  const fs = require("node:fs");
  const srcPath = _deps.sourceBpmnPath ? _deps.sourceBpmnPath() : null;
  if (!srcPath || !fs.existsSync(srcPath)) {
    toast("Nothing to fork yet: this session has no process map file. " +
      'Run Analyze with "Build process map" checked (under ⋯ More), then fork again.', "error");
    return;
  }
  const cq = (s.analysis || {}).case_quality;
  if (!cq || !cq.tier2_unlocked) {
    toast("Nothing to fork yet: the process map is not shown for this session, " +
      "and the Map level says why.", "error");
    return;
  }
  let xml = null;
  try { xml = fs.readFileSync(srcPath, "utf-8"); } catch (e) {
    toast("Could not read the process map file to fork: " + ((e && e.message) || e), "error");
    return;
  }
  const source = { notation: "bpmn", level: "step", scope: null };
  const n = RefStore.list(s.annotations).length;
  const name = RefStore.cellLabel(source) + ", reference " + (n + 1);
  const entry = RefStore.fork({
    sessionFolder: s.sessionFolder, anno: s.annotations, xml, source,
    sourceBpmnPath: srcPath, name, kind: "reference", nowIso: new Date().toISOString(),
  });
  await persist("Fork reference map");
  _showGallery(true);
  openEditor(entry.map_id);
}

/* ---- editor overlay ----------------------------------------------------- */
function provText(e) {
  return "Forked from " + RefStore.cellLabel(e.source) +
    (e.forked_at ? " · " + fmtDate(e.forked_at) : "") +
    (driftFor(e) ? " · source has since changed" : "");
}
async function openEditor(id) {
  const s = session();
  if (!s) return;
  const e = RefStore.find(s.annotations, id);
  if (!e) return;
  if (!RefStore.fileExists(s.sessionFolder, e)) {
    toast("This reference map's .bpmn file is missing: remove the entry or re-fork.", "error");
    return;
  }
  _editingId = id;
  const full = RefStore.absPath(s.sessionFolder, e);
  const nameInput = $("refmap-editor-name");
  const kindSel = $("refmap-editor-kind");
  const pddSel = $("refmap-editor-pdd");
  const prov = $("refmap-editor-prov");
  if (nameInput) nameInput.value = e.name || "";
  if (kindSel) kindSel.value = e.kind || "reference";
  if (pddSel) pddSel.value = e.pdd_role || "";
  if (prov) prov.textContent = provText(e);
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "";
  const host = $("refmap-editor-host");
  if (!host) return;
  try {
    await PdtBpmn.render(host, full, { editable: true });
    setTimeout(() => { try { PdtBpmn.fit && PdtBpmn.fit(); } catch (_) {} }, 60);
  } catch (err) {
    toast("Could not open the reference map: " + ((err && err.message) || err), "error");
  }
}
function closeEditor() {
  const overlay = $("refmap-editor-overlay");
  if (overlay) overlay.style.display = "none";
  _editingId = null;
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
    await persist("Rename reference map");
  } else if (which === "kind") {
    const v = ($("refmap-editor-kind") || {}).value;
    RefStore.setKind(s.annotations, _editingId, v);
    await persist("Set reference-map type");
  } else if (which === "pdd") {
    const v = ($("refmap-editor-pdd") || {}).value;
    RefStore.setPddRole(s.annotations, _editingId, v || null);
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
  const xml = RefStore.readBpmn(sessionFolder, entry);
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
      .catch(() => resolve(null))
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
/* Show or hide the reference-maps gallery (collapsed by default). The toggle
   is its inverse: a click on a shown gallery hides it. */
function _showGallery(show) {
  const panel = $("refmap-panel");
  if (!panel) return;
  panel.style.display = show ? "" : "none";
  const toggle = $("btn-toggle-refmaps");
  if (toggle) toggle.setAttribute("aria-expanded", show ? "true" : "false");
  if (show) refresh();
}

/* ---- init --------------------------------------------------------------- */
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
  const nameInput = $("refmap-editor-name");
  if (nameInput) nameInput.addEventListener("change", () => onEditorField("name"));
  const kindSel = $("refmap-editor-kind");
  if (kindSel) kindSel.addEventListener("change", () => onEditorField("kind"));
  const pddSel = $("refmap-editor-pdd");
  if (pddSel) pddSel.addEventListener("change", () => onEditorField("pdd"));
  // Esc closes the editor.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _editingId) { const o = $("refmap-editor-overlay"); if (o && o.style.display !== "none") closeEditor(); }
  });
}

module.exports = { initRefmapUI, refresh, renderPddMaps, showGallery: _showGallery };
