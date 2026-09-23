/*
 * Viewer renderer -- the thin wiring entry.
 *
 * After the Phase 3 decomposition (ADR-0003) this file only wires the
 * feature modules together: the Overview / Flow / Steps / Map level
 * switcher, the state-change bus subscriptions, global keyboard
 * shortcuts, the Recent menu, the export buttons, and boot. Every
 * surface lives in its own module, reached through the require() block
 * below; index.html loads only this entry script plus the vendored
 * libraries.
 */

"use strict";

const Ipc = require("./ipc.js");
const path = require("node:path");
const fs = require("node:fs");
const TimelineCore = require("./timeline/timeline-core.js");
const State = require("./state.js");
const PdtTheme = require("./theme.js");
const PdtDfg = require("./dfg-viewer.js");
const PdtSteps = require("./step-editor.js");
require("./layout-controls.js"); // side-effect import: self-wires resize handles + video modes

const { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast } = require("./dom.js");
const { promptModal } = require("./modals.js");
const { initRecent, getRecent, renderRecent } = require("./recent.js");
const { initStepsView, renderStepsLevel, addManualStep, splitStep, mergeStepWithNext, mergeSelectedSteps, addStepAtTimestamp, visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun } = require("./views/steps-view.js");
const { initSession, resetUndoStack, canUndo, canRedo, saveAnnotationsWithUndo, performUndo, performRedo, ensureAnnoShape, persistAnnotations } = require("./session.js");
const { initFlowView, loadSessionIntoView, renderTimeline, renderMarkersList, renderSessionPills, seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow, watchStep, addStepAtPlayhead, analyzeSession } = require("./views/flow-view.js");
const { renderOverviewLevel, openMarkersInFlow, mapLockHtml } = require("./views/overview-view.js");
const { createMapController } = require("./map-controller.js");
const { buildAnnotationDfg } = require("./process-map-levels.js");
const RunsModel = require("./runs-model.js");
const RefmapUI = require("./refmap-ui.js");
const { pddExportOutcome } = require("./normalize-result.js");

/* ============ Flow view -- see views/flow-view.js ================= */

/* Cross-surface glue that stays in this entry is injected into the
   Flow module as lazy wrappers so hoisting / load order does not
   matter (rerenderActiveLevel etc. are declared further down). */
initFlowView({
  rerenderActiveLevel:    () => rerenderActiveLevel(),
  addStepAtTimestamp:     (ts) => addStepAtTimestamp(ts),
});

/* ============ Session / undo layer -- see session.js ============== */

initSession({
  renderSessionPills: () => renderSessionPills(),
});

/* ============ Recent sessions ===================================== */

initRecent({ onOpenSession: (folder) => loadSessionIntoView(folder) });

/* ============ Session view-mode switcher (Flow / Steps / Map) =====
   The view-mode bar at the top of the loaded session swaps between
   the top-level layouts, among them:
     #session-layout-flow    - video + timeline + annotations
     #session-layout-steps   - full-width step editor with timeline band
     #session-layout-map     - the interactive process map
   This is a much bigger change than the original "toggle which timeline
   strip is visible" approach because users couldn't find the cramped
   editor inside the narrow annotations panel. */

/* Show a level AND mark its view-mode button active, so the level bar always
   names what is on screen. Code that switches level on the analyst's behalf
   uses this, never applyLevel alone (item 7: the PDD export used to leave
   the Overview button lit while the Map showed). */
function selectLevel(name) {
  $$(".view-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.level === name));
  applyLevel(name);
}
$$(".view-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => selectLevel(btn.dataset.level));
});

/* P2.3: viewport state transfer on mode switch. The Flow timeline owns
   a scroll container and a zoom; the other levels ride the same path with
   no-op zoom accessors. MODE_VIEWPORT pairs them so snapshot/apply is one
   code path instead of copy-pasted `if (mode === ...)` arms. */
const MODE_VIEWPORT = {
  // Lab-phase §A5: the Overview has no timeline / zoom of its own; the
  // no-op zoom accessors let it ride the viewport-transfer path harmlessly
  // (same shape as analysis/map — an absent entry would silently SKIP the
  // render on switch, the v0.18.0 "Map opens but is empty" failure mode).
  overview: {
    scrollSel: "#session-layout-overview",
    getZoom: () => 1, setZoom: () => {},
    render: renderOverviewLevel,
  },
  flow: {
    scrollSel: "#timeline-scroll",
    getZoom: State.getZoomFactor, setZoom: State.setZoomFactor,
    render: renderTimeline,
  },
  // The Steps level has no timeline of its own: while the analyst is on it,
  // it holds the Flow timeline's zoom and scroll, so a return to Flow lands
  // where the analyst left it (as the removed Steps strip used to).
  steps: {
    getZoom: () => _stepsViewport.zoom, setZoom: (z) => { _stepsViewport.zoom = z; },
    getScrollFrac: () => _stepsViewport.scrollFrac, setScrollFrac: (f) => { _stepsViewport.scrollFrac = f; },
    render: renderStepsLevel,
  },
  // v0.18.1: the Map level also has no timeline / scroll / zoom of its own
  // (the BPMN + DFG viewers have their own zoom controls inside the map
  // panel). Crucially, MUST appear here -- _viewportApplyToMode early-returns
  // if `MODE_VIEWPORT[mode]` is undefined, which silently SKIPS the render
  // every time the user switches TO Map from another level. That was the
  // v0.18.0 "Map opens but is empty" failure mode.
  map: {
    scrollSel: "#session-layout-map",
    getZoom: () => 1, setZoom: () => {},
    render: renderMapLevel,
  },
};
const _stepsViewport = { zoom: 1, scrollFrac: 0 };
function _viewportSnapshotForMode(mode) {
  const m = MODE_VIEWPORT[mode];
  if (!m) return { zoom: 1, scrollFrac: 0 };
  let scrollFrac = 0;
  if (m.getScrollFrac) {
    scrollFrac = m.getScrollFrac();
  } else {
    const el = document.querySelector(m.scrollSel);
    if (el && el.scrollWidth > el.clientWidth) {
      scrollFrac = el.scrollLeft / (el.scrollWidth - el.clientWidth);
    }
  }
  return { zoom: Math.max(1, m.getZoom() || 1), scrollFrac: Math.max(0, Math.min(1, scrollFrac || 0)) };
}
function _viewportApplyToMode(mode, snap) {
  // Set the mode's zoom BEFORE re-rendering (the render reads it), then
  // restore scrollLeft after a frame so the host has expanded.
  const m = MODE_VIEWPORT[mode];
  if (!m) return;
  m.setZoom(snap.zoom);
  m.render();
  if (m.setScrollFrac) { m.setScrollFrac(snap.scrollFrac); return; }
  requestAnimationFrame(() => {
    const el = document.querySelector(m.scrollSel);
    if (el) el.scrollLeft = snap.scrollFrac * Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

/* ============ Map level (Session view) ============================ */

/* The Map level shows the one process map: a Flow diagram built from the
   runs' steps (process-map-levels.buildAnnotationDfg), bound to the loaded
   session through map-controller.js. Created on first render so its lookups
   land after the DOM is ready. */
let _sessionMapCtrl = null;

/* The step-level BPMN the pipeline writes with --mine: the source Fork copies
   into an editable reference map (ADR-0019). */
function _stepBpmnPath() {
  const sess = State.getSession();
  return (sess && sess.sessionFolder) ? path.join(sess.sessionFolder, "process_map_step.bpmn") : null;
}

/* The map's data: the lock message while the runs cannot be drawn
   (overview-view.mapLockHtml owns the sentences and the mark-runs verb),
   else the graph of every run's visible steps, the runs as the Steps level
   builds them. */
function _sessionMapData() {
  const sess = State.getSession();
  if (!sess) return { emptyMessage: escapeHtml("Open a session to see its process map.") };
  const lock = mapLockHtml(sess.analysis);
  if (lock) return { emptyMessage: lock };
  const runs = RunsModel.buildRuns(sess.stats, (sess.annotations && sess.annotations.steps) || []).runs;
  return {
    dfg: buildAnnotationDfg(runs.map((r) => r.visible)),
    // §B2: the map is TIME-weighted: edge thickness carries the time that
    // flowed along each path; the times and the count are in the tooltip.
    edgeWeight: "time",
    emptyMessage: escapeHtml("No steps to draw yet: the runs have no visible steps. Add or unhide steps in the Steps view."),
  };
}

function _ensureSessionMapCtrl() {
  if (_sessionMapCtrl) return _sessionMapCtrl;
  _sessionMapCtrl = createMapController({
    hostDfg: document.getElementById("session-map-dfg-host"),
    zoomControls: {
      fit: document.getElementById("btn-session-map-zoom-fit"),
      wrap: document.getElementById("session-map-zoom"),
    },
    dataSource: _sessionMapData,
  });
  // The lock message's call to action ("Mark runs in Flow", the same verb as
  // the Overview's). Delegated once, so innerHTML rewrites keep it alive.
  const host = document.getElementById("session-map-dfg-host");
  if (host) {
    host.addEventListener("click", (e) => {
      if (e.target.closest('[data-map-cta="mark-runs"]')) openMarkersInFlow();
    });
  }
  return _sessionMapCtrl;
}

function renderMapLevel() {
  // Cheap to call when the Map level isn't visible: its host is hidden anyway.
  // We early-return mainly to skip the layout when nothing's on screen.
  if (State.getLevel() !== "map") return;
  _ensureSessionMapCtrl().render();
  try { RefmapUI.refresh(); } catch (_) {}   // ADR-0019: keep the reference-maps gallery + count fresh
}

const LEVEL_RENDERERS = { overview: renderOverviewLevel, flow: renderTimeline, steps: renderStepsLevel, map: renderMapLevel };

/* Wire the state change-notification bus: an annotation edit emits the
   topics it touched (see persistAnnotations / performUndo / performRedo)
   and the matching view re-renders itself -- no full-session reload.
   The Map level early-returns when not visible, so subscribing it to the
   annotation topics is cheap and keeps the step-level maps fresh. */
State.subscribe("steps",    renderStepsLevel);
State.subscribe("timeline", renderTimeline);
State.subscribe("markers",  renderMarkersList);
// Item 6: the actions bar's "Analyze to apply N marker changes" call to action.
State.subscribe("markers",  renderSessionPills);
// Lab-phase §A5 + R4: the Overview renders the what-is-left line, the
// findings AND (R4) the Evidence modules retired from the Analysis level, so
// it follows markers, analysis and steps.
State.subscribe("markers",  renderOverviewLevel);
State.subscribe("analysis", renderOverviewLevel);
State.subscribe("steps",    renderOverviewLevel);
State.subscribe("steps",    renderMapLevel);

/* Re-render whichever session sub-view is on screen. The single
   dispatch point for "the active level's data changed" -- it replaces
   an `if (currentLevel === ...)` triplet that was copied verbatim
   across the case-scope handlers (issue S5). */
function rerenderActiveLevel() {
  const fn = LEVEL_RENDERERS[State.getLevel()];
  if (fn) fn();
}

function applyLevel(name) {
  // P2.3: capture the outgoing mode's viewport BEFORE we hide its
  // panel -- once display:none is set, scrollWidth / clientWidth both
  // return 0 and we'd lose the snapshot. Skip the very first call
  // (the level wasn't yet displayed).
  const prev = State.getLevel();
  const incomingSnap = (prev && prev !== name)
    ? _viewportSnapshotForMode(prev)
    : null;
  // Now safe to swap visibility.
  State.setLevel(name);
  // The run select dims the other runs on the Flow timeline and changes
  // nothing on the other levels, so it shows on Flow only (P1.2).
  const caseScope = document.getElementById("case-scope");
  if (caseScope) caseScope.style.display = (name === "flow") ? "" : "none";
  const layouts = ["overview", "flow", "steps", "map"];
  for (const l of layouts) {
    const el = document.getElementById("session-layout-" + l);
    if (el) el.style.display = l === name ? "" : "none";
  }
  // P2.10: the Raw events drawer (the machine layer) shows on Flow only.
  const rawEvents = document.querySelector(".event-table-host");
  if (rawEvents) rawEvents.style.display = name === "flow" ? "" : "none";
  // Arrival reveal: switching TO Steps with a surviving selection (e.g. after
  // a "Jump to in Flow" round-trip) should scroll that row back into view. This
  // is an arrival, not an incidental re-render, so it is gated by a one-shot
  // flag renderStepsLevel consumes -- select/rename/flag re-renders never set
  // it and never scroll (scroll-law: the only unrequested scroll is the
  // arrival reveal).
  if (name === "steps" && prev !== "steps" && State.getSelectedStepId()) {
    State.setPendingStepReveal();
  }
  if (incomingSnap) {
    _viewportApplyToMode(name, incomingSnap);
  } else {
    rerenderActiveLevel();
  }
}

/* ============ Theme toggle ======================================== */

/* Flips Warm Editorial (light) <-> Studio Dark (dark). CSS chrome
   recolors itself the instant data-theme flips; the JS-painted marks
   (timeline bands, the cytoscape DFG) are repainted by re-running the
   existing renderers. */
(function wireThemeToggle() {
  const btn = document.getElementById("btn-theme-toggle");
  if (!btn) return;
  const sync = () => {
    const dark = PdtTheme.getTheme() === "dark";
    btn.textContent = dark ? "☀" : "☾";
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = dark ? "Switch to light theme" : "Switch to dark theme";
  };
  btn.addEventListener("click", () => PdtTheme.toggleTheme());
  PdtTheme.onChange(() => {
    sync();
    if (State.getSession()) rerenderActiveLevel();
  });
  sync();
})();

/* ============ Steps view module =================================== */

/* Steps view module -- see views/steps-view.js. Deps are passed as lazy
   wrappers so hoisting order does not matter. */
initStepsView({
  ensureAnnoShape: (a) => ensureAnnoShape(a),
  persistAnnotations: (a, label) => persistAnnotations(a, label),
  videoTimeToSessionTs: (t) => videoTimeToSessionTs(t),
  jumpToStepInFlow: (s) => jumpToStepInFlow(s),
  watchStep: (s) => watchStep(s),
});

/* (Steps CRUD and ignored apps -> views/steps-view.js) */

/* ============ Step map / PDD exports ============================= */

async function exportArtifact(kind) {
  const target = State.getSession();
  if (!target) return;

  // Process map (BPMN), P2.12: the As-Is copy chosen for the PDD when there is
  // one (the map the analyst finished), else the OBSERVED-FLOW map the viewer
  // shows (process_map_step.bpmn, mined from the annotations by
  // bpmn_observed.py under --mine), mining it first if it is not there yet.
  if (kind === "step-bpmn") {
    const asIs = _chosenAsIsMap();
    if (asIs) {
      const out = await Ipc.exportFile({ sourcePath: asIs.path, suggestedName: "as-is-map.bpmn" });
      if (out) {
        await Ipc.revealFile(out);
        toast("Exported: " + path.basename(out), "success");
      }
      return;
    }
    const sourcePath = path.join(target.sessionFolder, "process_map_step.bpmn");
    if (!fs.existsSync(sourcePath)) {
      const r = await Ipc.runNormalizeExtended({ sessionFolder: target.sessionFolder, mine: true });
      // r.error is the full sentence from main.js (C13: the pipeline's reason).
      if (!r || !r.ok) { toast((r && r.error) || "Export failed: the analysis did not answer.", "error"); return; }
    }
    if (!fs.existsSync(sourcePath)) {
      toast("No step-level flow to export. Analyze a session that has steps first.", "error");
      return;
    }
    const out = await Ipc.exportFile({ sourcePath, suggestedName: "process-map.bpmn" });
    if (out) {
      await Ipc.revealFile(out);
      toast("Exported: " + path.basename(out), "success");
    }
    return;
  }

  // PDD: normalize writes the document straight to a temp path.
  const os = require("os");
  const ext = "docx";
  const tmpPath = path.join(os.tmpdir(), "pdt-export-" + Date.now() + "." + ext);
  // RP-09: nothing may sit at the temp path before the run, so a document
  // found there afterwards can only be THIS run's (pddExportOutcome below).
  try { fs.unlinkSync(tmpPath); }
  catch (e) {
    if (e.code !== "ENOENT") { toast("Export failed: could not prepare " + tmpPath + ": " + e.message, "error"); return; }
  }
  const opts = { sessionFolder: target.sessionFolder, mine: false };
  let mapImgPath = null, tobeImgPath = null;
  if (kind === "pdd") {
    opts.pddOut = tmpPath;
    // Embed the process map on screen as the PDD's As-Is map. cytoscape
    // rasterises cleanly; when the Map shows a message instead (locked, no
    // steps) there is no graph (map-controller clears it), so the embed is
    // skipped and the PDD keeps its placeholder.
    try {
      const dataUrl = (PdtDfg && PdtDfg.exportPng) ? PdtDfg.exportPng() : null;
      const comma = dataUrl ? dataUrl.indexOf("base64,") : -1;
      if (comma !== -1) {
        mapImgPath = path.join(os.tmpdir(), "pdt-pddmap-" + Date.now() + ".png");
        fs.writeFileSync(mapImgPath, Buffer.from(dataUrl.slice(comma + 7), "base64"));
        opts.pddMapImage = mapImgPath;
      }
    } catch (e) {
      // TD#1c: don't drop the map embed silently -- a caught error here
      // leaves the PDD showing its placeholder map with no explanation.
      // Log so the failure is diagnosable (cf. map-controller.js, which
      // logs + shows a fallback rather than swallowing).
      console.error("[renderer] PDD map embed failed; exporting without process map:", e);
      mapImgPath = null;
    }
    // ADR-0019: an analyst-selected reference map can override the mined As-Is
    // image and/or supply a proposed To-Be map. Rendered off-screen to PNG.
    try {
      const refImgs = await RefmapUI.renderPddMaps();
      const writePng = (dataUrl, tag) => {
        const comma = dataUrl ? dataUrl.indexOf("base64,") : -1;
        if (comma === -1) return null;
        const p = path.join(os.tmpdir(), "pdt-pdd" + tag + "-" + Date.now() + ".png");
        fs.writeFileSync(p, Buffer.from(dataUrl.slice(comma + 7), "base64"));
        return p;
      };
      if (refImgs && refImgs.asis) {
        const p = writePng(refImgs.asis, "asis");
        if (p) {
          if (mapImgPath && mapImgPath !== p) { try { fs.unlinkSync(mapImgPath); } catch (_) {} }
          mapImgPath = p; opts.pddMapImage = p;   // analyst As-Is wins over the mined DFG
        }
      }
      if (refImgs && refImgs.tobe) {
        const p = writePng(refImgs.tobe, "tobe");
        if (p) { tobeImgPath = p; opts.pddTobeImage = p; }
      }
    } catch (e) {
      console.error("[renderer] reference-map PDD embed failed; continuing:", e);
    }
  }
  const r = await Ipc.runNormalizeExtended(opts);
  if (mapImgPath) { try { fs.unlinkSync(mapImgPath); } catch (_) {} }
  if (tobeImgPath) { try { fs.unlinkSync(tobeImgPath); } catch (_) {} }
  // RP-09 / C13: a non-zero exit (3 = the export failed) is a failure with
  // the pipeline's reason, and so is a "success" that wrote no document. The
  // analyst is offered the file only when this run wrote it.
  let doc = { exists: false, size: 0 };
  try { const st = fs.statSync(tmpPath); doc = { exists: st.isFile(), size: st.size }; }
  catch (e) { if (e.code !== "ENOENT") console.error("[renderer] could not read the exported PDD:", e); }
  const outcome = pddExportOutcome(r, doc);
  if (!outcome.ok) {
    toast(outcome.message, "error");
    try { fs.unlinkSync(tmpPath); } catch (_) { /* absent, or a partial file the OS will clean from temp */ }
    return;
  }
  const suggested = "process." + kind + "." + ext;
  let out = null;
  try {
    out = await Ipc.exportFile({ sourcePath: tmpPath, suggestedName: suggested });
  } catch (e) {
    toast("Export failed: the document could not be saved: " + ((e && e.message) || e), "error");
  }
  if (out) {
    await Ipc.revealFile(out);
    toast("Exported: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

/* AD-11: the Session Export menu carries the two map exports. "Process map
   (BPMN)" copies a BPMN file; "Process map (image)" is exportMapSvg below.
   P2.12: both save the As-Is copy chosen for the PDD when there is one. */
if ($("#btn-session-step-bpmn")) $("#btn-session-step-bpmn").addEventListener("click", () => exportArtifact("step-bpmn"));
if ($("#btn-session-map-svg"))   $("#btn-session-map-svg").addEventListener("click", () => exportMapSvg());

/* ADR-0019: Reference Maps surface: fork, gallery, editor and the PDD image
   bridge. Wired once at boot. Fork copies the step-level BPMN file, after an
   analysis when the steps changed since that file was written (AD-19). */
RefmapUI.initRefmapUI({
  renderLiveMap: () => _ensureSessionMapCtrl().render(),
  sourceBpmnPath: () => _stepBpmnPath(),
  analyze: () => analyzeSession({ quiet: true }),
});

/* ============ Exports ============================================= */

/* P2.12: the As-Is copy chosen for the PDD (reference_maps pdd_role "as_is")
   when its file is on disk: { entry, path }, else null. */
function _chosenAsIsMap() {
  const RefStore = require("./reference-maps.js");
  const sess = State.getSession();
  if (!sess || !sess.sessionFolder) return null;
  const entry = RefStore.pddPick(sess.annotations, "as_is");
  if (!entry || !RefStore.fileExists(sess.sessionFolder, entry)) return null;
  return { entry, path: RefStore.absPath(sess.sessionFolder, entry) };
}

/* A BPMN file drawn off screen and saved as SVG (bpmn-js saveSVG), or null. */
function _bpmnXmlToSvg(xml) {
  return new Promise((resolve) => {
    if (typeof BpmnJS === "undefined" || !xml) { resolve(null); return; }
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-99999px;top:-99999px;width:1600px;height:1200px;";
    document.body.appendChild(host);
    const v = new BpmnJS({ container: host });
    v.importXML(xml)
      .then(() => v.saveSVG())
      .then(({ svg }) => resolve(svg || null))
      .catch((e) => { console.error("[renderer] As-Is map image failed:", e); resolve(null); })
      .finally(() => { try { v.destroy(); } catch (_) {} host.remove(); });
  });
}

/* AD-11: "Process map (image)" saves the process map as an SVG image, the
   format Figma / Lucidchart / browsers all import. P2.12: the As-Is copy
   chosen for the PDD when there is one, drawn off screen. Else the map the
   Map level shows: from another level it opens the Map first and lets the
   diagram draw (the same settle the PDD export uses). A Map that shows a
   message instead of a diagram (locked, no steps) exports nothing and says so. */
async function exportMapSvg() {
  if (!State.getSession()) { toast("Open a session first.", "error"); return; }
  const asIs = _chosenAsIsMap();
  if (asIs) {
    let xml = null;
    try { xml = fs.readFileSync(asIs.path, "utf-8"); }
    catch (e) { console.error("[renderer] could not read the As-Is map:", e); }
    const asIsSvg = await _bpmnXmlToSvg(xml);
    if (!asIsSvg) { toast("The As-Is map could not be drawn as an image.", "error"); return; }
    const saved = await Ipc.saveSvgFile({ content: asIsSvg, suggestedName: "as-is-map.svg" });
    if (saved && saved.ok) toast("As-Is map exported to " + saved.path, "success");
    else if (saved && saved.error) toast("Export failed: " + saved.error, "error");
    return;
  }
  if (State.getLevel() !== "map") {
    // Click the level button (not applyLevel alone) so the View bar shows Map.
    const mapBtn = document.querySelector('.view-mode-btn[data-level="map"]');
    if (mapBtn) mapBtn.click(); else applyLevel("map");
    await new Promise((r) => setTimeout(r, 900));
  }
  _ensureSessionMapCtrl();
  const host = document.getElementById("session-map-dfg-host");
  const svg = (host && host.querySelector("canvas")) ? PdtDfg.exportSvg() : null;
  if (!svg) {
    toast("No process map is drawn on the Map level to export: the Map says why.", "error");
    return;
  }
  const r = await Ipc.saveSvgFile({ content: svg, suggestedName: "process-map.svg" });
  if (r && r.ok) toast("Process map exported to " + r.path, "success");
  else if (r && r.error) toast("Export failed: " + r.error, "error");
}

/* PDD export from Session view -- new in v0.18.1. The PDD's As-Is process
   map is rasterised from the process map on the Map level; to embed THIS
   session's map (not a blank canvas), the Map level is shown (which draws
   it) and cytoscape settles before the shared exportArtifact("pdd") path
   runs. Item 7: the Map shows while the map is drawn (with the level bar
   saying so), and afterwards the analyst is returned to the level they
   started from (the Overview when its what-is-left line started the
   export), unless they moved on meanwhile. */
if ($("#btn-session-pdd")) {
  $("#btn-session-pdd").addEventListener("click", async () => {
    if (!State.getSession()) { toast("Open a session first.", "error"); return; }
    const from = State.getLevel();
    toast("Preparing PDD: drawing the process map...", "info");
    selectLevel("map");
    try {
      // Let cytoscape paint + layout settle so PdtDfg.exportPng() captures the
      // rendered diagram and not a blank canvas.
      await new Promise((r) => setTimeout(r, 900));
      await exportArtifact("pdd");
    } finally {
      if (from !== "map" && State.getLevel() === "map") selectLevel(from);
    }
  });
}

/* ============ Keyboard shortcuts ================================== */

document.addEventListener("keydown", (e) => {
  // Esc closes the help modal regardless of focus, since the modal
  // captures itself rather than the input fields beneath it.
  if (e.key === "Escape" && $("#help-modal").style.display !== "none") {
    closeHelp();
    e.preventDefault();
    return;
  }
  // Don't intercept other shortcuts while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  // <video controls> handles Space / arrows natively; skip them here
  // so the global handler doesn't double-fire and cancel the toggle.
  if (tag === "video" && (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    return;
  }

  // Undo / redo apply to any view as long as a session is loaded.
  // Ctrl+Z = undo, Ctrl+Shift+Z (or Ctrl+Y) = redo.
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      performUndo();
      return;
    }
    if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      performRedo();
      return;
    }
  }

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    openHelp();
    e.preventDefault();
    return;
  }
  // Flow view: S adds/splits a step at the video playhead (only with a video,
  // like its + Step button: without one there is no playhead to place it at).
  if (State.getLevel() === "flow" && State.getSession() && State.getSession().recordingAvailable
      && e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    addStepAtPlayhead();
    e.preventDefault();
    return;
  }
  // Step shortcuts (only on the Steps level). They act only on what the list
  // shows: the rows of the open run and a selected step whose row is on
  // screen (RP-12: a shortcut once mutated a selection that was not on
  // screen). Enter on a focused button or link keeps its own meaning, and a
  // dialog on screen owns the keyboard (its Enter confirms the dialog).
  if (State.getLevel() === "steps" && State.getSession()) {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const onControl = tag === "button" || tag === "select" || tag === "a" ||
      (e.target.getAttribute && e.target.getAttribute("role") === "button");
    // The help modal is a .modal-backdrop that stays in the page, hidden:
    // only a dialog on screen counts.
    const dialogOpen = Array.from(document.querySelectorAll(".modal-backdrop"))
      .some((m) => getComputedStyle(m).display !== "none");
    if (dialogOpen) {
      // Nothing: the dialog's own keys apply.
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (confirmOpenRun()) e.preventDefault();
    } else if (e.key === "Enter" && plain && !onControl) {
      if (renameSelectedStep()) e.preventDefault();
    } else if ((e.key === "j" || e.key === "ArrowDown") && plain) {
      if (moveSelection(1)) e.preventDefault();
    } else if ((e.key === "k" || e.key === "ArrowUp") && plain) {
      if (moveSelection(-1)) e.preventDefault();
    } else if (e.key === "n" && plain) {
      addManualStep(); e.preventDefault();
    } else if (e.key === "s" && plain) {
      const sid = visibleSelectedStepId();
      if (sid) { splitStep(sid); e.preventDefault(); }
    } else if (e.key === "m" && plain) {
      // P0.1: with a 2+ multi-selection (ticks stand only on rows the list
      // shows), M merges that selection; otherwise it merges the selected
      // step with the next step of its run. No hidden "wrong pair".
      const sid = visibleSelectedStepId();
      if (State.getMultiSelectedStepIds().size >= 2) { mergeSelectedSteps(); e.preventDefault(); }
      else if (sid) { mergeStepWithNext(sid); e.preventDefault(); }
    }
  }
  else if (e.key === " ") {
    const video = $("#video");
    if (video && video.src) {
      if (video.paused) video.play(); else video.pause();
      e.preventDefault();
    }
  } else if (e.key === "ArrowLeft") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "ArrowRight") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "+" || e.key === "=") {
    if ($("#view-session").classList.contains("active")) {
      State.setZoomFactor(State.getZoomFactor() * 1.5); renderTimeline();
    }
  } else if (e.key === "-" || e.key === "_") {
    if ($("#view-session").classList.contains("active")) {
      State.setZoomFactor(Math.max(1, State.getZoomFactor() / 1.5)); renderTimeline();
    }
  } else if (e.key === "0") {
    if ($("#view-session").classList.contains("active")) {
      State.setZoomFactor(1); renderTimeline();
    }
  }
});

/* ============ Help modal ========================================== */

function openHelp(section) {
  $("#help-modal").style.display = "";
  if (section) selectHelpSection(section);
}
function closeHelp() { $("#help-modal").style.display = "none"; }
function selectHelpSection(name) {
  $$(".help-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  $$(".help-section").forEach((s) => s.classList.toggle("active", s.dataset.section === name));
}
$("#btn-help").addEventListener("click", () => openHelp());
/* The inline "What is a step?" link in the toolbar opens the help modal
   at the right section. */
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest(".link-help");
  if (!t) return;
  e.preventDefault();
  openHelp(t.dataset.helpSection || "stepsphases");
});
$("#btn-help-close").addEventListener("click", closeHelp);
$$(".help-nav-item").forEach((b) =>
  b.addEventListener("click", () => selectHelpSection(b.dataset.section))
);
$("#help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") closeHelp();
});

/* ============ Bottom playback bar ================================= */
/* A global transport mirroring the #video element. Visible only with a
   recording loaded; the .hidden class collapses it otherwise. Space /
   arrow shortcuts are handled in the keydown block
   above and reflect here through the video's own play/pause/timeupdate
   events, so the bar stays in sync regardless of how playback changes. */
(function wirePlaybackBar() {
  const bar = $("#playback-bar");
  const video = $("#video");
  if (!bar || !video) return;
  const iconPlay = bar.querySelector(".pb-icon-play");
  const iconPause = bar.querySelector(".pb-icon-pause");
  const scrub = $("#pb-scrub"), fill = $("#pb-fill"), knob = $("#pb-knob");
  const curEl = $("#pb-current"), totEl = $("#pb-total");

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  }
  function hasVideo() {
    return !!(video.src && isFinite(video.duration) && video.duration > 0);
  }
  function refresh() {
    bar.classList.toggle("hidden", !hasVideo());
    const dur = video.duration || 0, cur = video.currentTime || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    fill.style.width = pct + "%";
    knob.style.left = pct + "%";
    curEl.textContent = fmtTime(cur);
    totEl.textContent = fmtTime(dur);
    const playing = !video.paused && !video.ended;
    iconPlay.style.display = playing ? "none" : "";
    iconPause.style.display = playing ? "" : "none";
  }
  function seekFromEvent(e) {
    if (!hasVideo()) return;
    const r = scrub.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    video.currentTime = frac * video.duration;
  }

  $("#pb-play").addEventListener("click", () => {
    if (!hasVideo()) return;
    if (video.paused) video.play(); else video.pause();
  });
  $("#pb-skip-back").addEventListener("click", () => {
    if (hasVideo()) video.currentTime = Math.max(0, video.currentTime - 5);
  });
  $("#pb-skip-fwd").addEventListener("click", () => {
    if (hasVideo()) video.currentTime = Math.min(video.duration, video.currentTime + 5);
  });
  scrub.addEventListener("mousedown", (e) => {
    if (!hasVideo()) return;
    seekFromEvent(e);
    const onMove = (ev) => seekFromEvent(ev);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  for (const evt of ["timeupdate", "loadedmetadata", "play", "pause", "emptied", "durationchange"]) {
    video.addEventListener(evt, refresh);
  }
  refresh();
})();

/* ============ Boot ================================================ */

renderRecent();
// P3.1: the version lives in Help, not in the top bar.
$("#help-version").textContent = "Version " + require("./package.json").version;

/* If launched with --session=<path>, the main process pushes the path
   via this channel. Open it without any further user click. */
Ipc.onOpenInitialSession((folder) => {
  if (folder) loadSessionIntoView(folder);
});

/* ============ Attach external video (Teams recording, etc.) ======= */

function parseHmsToMs(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  const sign = s.startsWith("-") ? -1 : 1;
  if (s.startsWith("-") || s.startsWith("+")) s = s.slice(1);
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
           + (m[4] ? Number(m[4].padEnd(3, "0").slice(0, 3)) : 0);
  return sign * ms;
}

async function attachExternalVideo() {
  if (!State.getSession()) return;
  const r = await Ipc.attachExternalVideo({
    sessionFolder: State.getSession().sessionFolder,
  });
  if (!r) return;
  const m = State.getSession().manifest || {};
  const started_at = m.started_at;
  if (!started_at) {
    toast("Session manifest has no started_at; can't compute video offset", "error");
    return;
  }
  const ans = await promptModal({
    title: "Align video to session",
    message: "When did the recording start, relative to the session?",
    detail: "Session started at " + started_at + ". Format HH:MM:SS, signed (-00:00:05 means recording started 5 sec before the session).",
    placeholder: "00:00:00",
    defaultValue: "00:00:00",
    okLabel: "Attach"
  });
  if (ans == null) return;
  const offsetMs = parseHmsToMs(ans);
  if (offsetMs === null) {
    toast("Couldn't parse offset; try 00:00:05 or -00:01:30", "error");
    return;
  }
  const saved = await Ipc.saveExternalVideoSync({
    sessionFolder: State.getSession().sessionFolder,
    videoPath: r.path,
    offsetMs,
  });
  if (!saved || !saved.ok) {
    toast("Video attach failed: " + ((saved && saved.error) || "unknown"), "error");
    return;
  }
  toast("Video attached - reloading session", "success");
  await loadSessionIntoView(State.getSession().sessionFolder);
}

if ($("#btn-attach-video")) {
  $("#btn-attach-video").addEventListener("click", attachExternalVideo);
}
// Item 1: the "Link recording…" affordance on the slim no-recording band is
// the same verb as "Attach video…" — keep the inverse verb reachable there.
if ($("#btn-link-recording")) {
  $("#btn-link-recording").addEventListener("click", attachExternalVideo);
}

/* ===== Open menu (top-bar) =====
   One menu for opening a session (P2.2): "Open session folder..." (its
   click is flow-view's openSessionFlow), then the recent sessions, reachable
   from every level. */
function renderRecentMenu() {
  const host = document.getElementById("recent-menu-content");
  if (!host) return;
  let html = "";
  const sessions = getRecent();
  if (sessions.length) {
    html += '<div class="recent-menu-heading">Recent sessions</div>';
    html += sessions.map((r) => {
      let missing = false;
      try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
      const label = r.label || path.basename(r.folder);
      return '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="session" data-folder="' + escapeHtml(r.folder) + '">' +
        '<span class="ri-label">' + escapeHtml(label) + '</span>' +
        (missing ? '<span class="ri-tag">missing</span>' : "") +
        '</button>';
    }).join("");
  }
  if (!html) {
    html = '<div class="recent-menu-empty">No recent sessions yet.</div>';
  }
  host.innerHTML = html;
  host.querySelectorAll(".recent-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      toggleRecentMenu(false);
      loadSessionIntoView(item.dataset.folder);
    });
  });
}
function toggleRecentMenu(force) {
  const popup = document.getElementById("recent-menu-popup");
  if (!popup) return;
  const open = force === undefined ? popup.style.display === "none" : !!force;
  if (open) renderRecentMenu();
  popup.style.display = open ? "" : "none";
}
(function wireRecentMenu() {
  const btn = document.getElementById("btn-recent-menu");
  const popup = document.getElementById("recent-menu-popup");
  if (!btn || !popup) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRecentMenu();
  });
  const openFolder = document.getElementById("btn-open-session");
  if (openFolder) openFolder.addEventListener("click", () => toggleRecentMenu(false));
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggleRecentMenu(false);
  });
})();

/* Generic dropdown menu (button + popup) -- used by the session's Export
   and More menus. Mirrors wireRecentMenu: the button toggles the popup,
   an outside click closes it, and clicking any enabled menu item closes
   it after the item's own handler runs. */
function wireDropdownMenu(btnId, popupId) {
  const btn = document.getElementById(btnId);
  const popup = document.getElementById(popupId);
  if (!btn || !popup) return;
  function toggle(force) {
    const open = force === undefined ? popup.style.display === "none" : !!force;
    popup.style.display = open ? "" : "none";
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  popup.addEventListener("click", (e) => {
    if (e.target.closest(".project-menu-item")) toggle(false);
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggle(false);
  });
}
wireDropdownMenu("btn-session-export-menu", "session-export-popup");
wireDropdownMenu("btn-session-more-menu", "session-more-popup");
