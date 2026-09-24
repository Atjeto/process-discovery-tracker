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
const PdtSteps = require("./step-editor.js");
require("./layout-controls.js"); // side-effect import: self-wires resize handles + video modes

const { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast } = require("./dom.js");
const { initRecent, getRecent, renderRecent } = require("./recent.js");
const { initStepsView, renderStepsLevel, addManualStep, splitStep, mergeStepWithNext, mergeSelectedSteps, addStepAtTimestamp, visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun, moveSelectedStep } = require("./views/steps-view.js");
const { initSession, resetUndoStack, canUndo, canRedo, saveAnnotationsWithUndo, performUndo, performRedo, ensureAnnoShape, persistAnnotations } = require("./session.js");
const { initFlowView, loadSessionIntoView, renderTimeline, renderMarkersList, renderSessionPills, seekToTimestamp, jumpToStepInFlow, addStepAtPlayhead, analyzeSession, runPipeline, UPDATING } = require("./views/flow-view.js");
// V2 item 4: the step panel beside the map, the timeline and the Steps list.
const StepPanel = require("./views/step-panel.js");
const Video = require("./views/flow-view-video.js");
const { renderOverviewLevel, openMarkersInFlow, mapLockHtml, mapEmptyText } = require("./views/overview-view.js");
const { createMapController } = require("./map-controller.js");
const { buildAnnotationDfg, mapNodeLabel } = require("./process-map-levels.js");
const RunsModel = require("./runs-model.js");
const SystemNames = require("./system-names.js");
const RefmapUI = require("./refmap-ui.js");
const { pddExportOutcome } = require("./normalize-result.js");
const SaveState = require("./save-state.js");

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
  if (!sess) return { emptyMessage: escapeHtml("Open a project to see its process map.") };
  const run = State.getAnalysisRun();
  const lock = mapLockHtml(sess.analysis, run && run.folder === sess.sessionFolder ? run : null);
  if (lock) return { emptyMessage: lock };
  const runs = RunsModel.buildRuns(sess.stats, (sess.annotations && sess.annotations.steps) || []).runs;
  return {
    dfg: buildAnnotationDfg(runs.map((r) => r.visible)),
    // AD-28: each box names the system its step happened in, under its name.
    nodeSystems: _nodeSystems(sess, runs),
    // §B2: the map is TIME-weighted: edge thickness carries the time that
    // flowed along each path; the times and the count are in the tooltip.
    edgeWeight: "time",
    // A project with no steps yet says so; hidden steps are named as such.
    emptyMessage: escapeHtml(mapEmptyText((sess.annotations && sess.annotations.steps) || [])),
  };
}

/* { map node: system } for the runs' visible steps: each node's most
   frequent system (the one vocabulary, C14). */
function _nodeSystems(sess, runs) {
  const inter = {};
  for (const ev of sess.events || []) if (ev && ev.type === "interaction" && ev.event_id) inter[ev.event_id] = ev;
  const names = (sess.stats && sess.stats.meta && sess.stats.meta.app_names) || {};
  const counts = new Map();
  for (const st of runs.flatMap((r) => r.visible)) {
    const system = SystemNames.whereOfStep(st, inter, names).system;
    if (!system) continue;
    const label = mapNodeLabel(st);
    const c = counts.get(label) || new Map();
    c.set(system, (c.get(system) || 0) + 1);
    counts.set(label, c);
  }
  const out = {};
  for (const [label, c] of counts) out[label] = [...c].sort((a, b) => b[1] - a[1])[0][0];
  return out;
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
    // V2 item 4: a box opens the step panel beside the map.
    onNodeClick: (label) => StepPanel.openForNode(label),
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
// Item 6: the top bar's "Apply N marker changes" call to action.
State.subscribe("markers",  renderSessionPills);
// Lab-phase §A5 + R4: the Overview renders the what-is-left line, the
// findings AND (R4) the Evidence modules retired from the Analysis level, so
// it follows markers, analysis and steps.
State.subscribe("markers",  renderOverviewLevel);
State.subscribe("analysis", renderOverviewLevel);
State.subscribe("steps",    renderOverviewLevel);
State.subscribe("steps",    renderMapLevel);
State.subscribe("steps",    () => StepPanel.refresh());

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
  // The step panel closes on the Overview; elsewhere its foot follows.
  StepPanel.onLevel(name);
  // (The run select dims the other runs on the timeline and changes nothing
  // on the other levels: it sits in the Timeline's own header, P1.2.)
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
  jumpToStepInFlow: (s) => jumpToStepInFlow(s),
  // Watch plays the step in the step panel, beside the steps (V2 item 4).
  watchStep: (s) => StepPanel.watch(s),
  analyze: () => analyzeSession(),
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
      const r = await runPipeline({ sessionFolder: target.sessionFolder, mine: true }, UPDATING);
      // r.error is the full sentence from main.js (C13: the pipeline's reason).
      if (r.cancelled) { toast("Export cancelled."); return; }
      if (!r.ok) { toast(r.error || "Export failed: the analysis did not answer.", "error"); return; }
    }
    if (!fs.existsSync(sourcePath)) {
      toast("No process map to export: the transactions have no steps yet.", "error");
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
    const writePng = (dataUrl, tag) => {
      const comma = dataUrl ? dataUrl.indexOf("base64,") : -1;
      if (comma === -1) return null;
      const p = path.join(os.tmpdir(), "pdt-pdd" + tag + "-" + Date.now() + ".png");
      fs.writeFileSync(p, Buffer.from(dataUrl.slice(comma + 7), "base64"));
      return p;
    };
    // ADR-0019: the maps the analyst chose for the PDD, the edited As-Is copy
    // and a proposed To-Be map, each drawn off screen by bpmn-js to a PNG.
    try {
      const refImgs = await RefmapUI.renderPddMaps();
      if (refImgs && refImgs.asis) {
        const p = writePng(refImgs.asis, "asis");
        if (p) { mapImgPath = p; opts.pddMapImage = p; }
      }
      if (refImgs && refImgs.tobe) {
        const p = writePng(refImgs.tobe, "tobe");
        if (p) { tobeImgPath = p; opts.pddTobeImage = p; }
      }
    } catch (e) {
      console.error("[renderer] reference-map PDD embed failed; continuing:", e);
    }
    // AD-28: with no edited As-Is copy, the PDD's map is the map from the
    // runs: process_map_step.bpmn drawn by the same off-screen bpmn-js
    // renderer (laid out to print, never the one-row live map on the Map
    // level, and whether or not the Map level was ever opened). That file
    // changes only on an analysis, so when the steps are newer (a rename, a
    // confirmed run) or it is missing, the analysis runs first, as the
    // Map's edit act does. While the Map says why it draws nothing (no runs
    // marked, a failed run check), there is no map and the PDD says so.
    const sess = State.getSession();
    if (!opts.pddMapImage && sess && !mapLockHtml(sess.analysis)) {
      const src = _stepBpmnPath();
      if (!src || RefmapUI.needsAnalyze(sess, src)) {
        if (!(await analyzeSession())) return;   // the analysis said why
      }
      // TD#1c: a map that cannot be drawn is said in the console, never dropped silently.
      if (!fs.existsSync(src)) {
        console.warn("[renderer] the analysis wrote no process map for these runs; exporting without it");
      } else {
        try {
          const p = writePng(await RefmapUI.renderBpmnToPng(fs.readFileSync(src, "utf-8")), "map");
          if (p) { mapImgPath = p; opts.pddMapImage = p; }
          else console.error("[renderer] the map from the runs could not be drawn; exporting without it");
        } catch (e) {
          console.error("[renderer] the map from the runs could not be read; exporting without it:", e);
        }
      }
    }
  }
  const r = await runPipeline(opts, kind === "pdd" ? "Writing the PDD..." : UPDATING);
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
   (BPMN)" copies a BPMN file; "Process map (image)" is exportMapSvg below,
   the same map drawn as the PDD draws it. P2.12: both save the As-Is copy
   chosen for the PDD when there is one. */
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

/* A saved image, like every export (AD-29): its folder opens with the file
   selected, and the toast names it. */
async function _svgSaved(r) {
  if (r && r.ok) {
    await Ipc.revealFile(r.path);
    toast("Exported: " + path.basename(r.path), "success");
  } else if (r && r.error) {
    toast("Export failed: " + r.error, "error");
  }
}

/* AD-11: "Process map (image)" saves the process map as an SVG image, the
   format Figma, Lucidchart and browsers import, drawn off screen by the
   PDD's map renderer (RefmapUI.renderBpmnToSvg), so the picture saved is the
   one the PDD prints: the As-Is copy chosen for the PDD when there is one
   (P2.12), else (AD-32) process_map_step.bpmn, analyzed first when the
   steps are newer than it or it is missing, as for the PDD (exportArtifact).
   The analyst stays on the level they are on. While the Map says why it
   draws no map (no transactions marked, a failed check), there is none to
   save, and the export says so. */
async function exportMapSvg() {
  const sess = State.getSession();
  if (!sess) { toast("Open a project first.", "error"); return; }
  const asIs = _chosenAsIsMap();
  if (asIs) {
    let xml = null;
    try { xml = fs.readFileSync(asIs.path, "utf-8"); }
    catch (e) { console.error("[renderer] could not read the As-Is map:", e); }
    const asIsSvg = xml ? await RefmapUI.renderBpmnToSvg(xml) : null;
    if (!asIsSvg) { toast("The As-Is map could not be drawn as an image.", "error"); return; }
    await _svgSaved(await Ipc.saveSvgFile({ content: asIsSvg, suggestedName: "as-is-map.svg" }));
    return;
  }
  if (mapLockHtml(sess.analysis)) {
    toast("No process map to export: the Map says why.", "error");
    return;
  }
  const src = _stepBpmnPath();
  if (RefmapUI.needsAnalyze(sess, src)) {
    if (!(await analyzeSession())) return;   // the analysis said why
  }
  let xml = null;
  try { xml = fs.readFileSync(src, "utf-8"); }
  catch (e) { if (e.code !== "ENOENT") console.error("[renderer] could not read the process map:", e); }
  if (!xml) { toast("No process map to export: the transactions have no steps yet.", "error"); return; }
  const svg = await RefmapUI.renderBpmnToSvg(xml);
  if (!svg) { toast("The process map could not be drawn as an image.", "error"); return; }
  await _svgSaved(await Ipc.saveSvgFile({ content: svg, suggestedName: "process-map.svg" }));
}

/* PDD export (the Export menu, and the Overview's last act). Its maps are
   drawn off screen (exportArtifact), so the analyst stays on the level they
   are on. */
if ($("#btn-session-pdd")) {
  $("#btn-session-pdd").addEventListener("click", async () => {
    if (!State.getSession()) { toast("Open a project first.", "error"); return; }
    toast("Preparing the PDD...", "info");
    await exportArtifact("pdd");
  });
}

/* Export, Whole project (.zip): the project folder as one zip next to it,
   "<name>.zip" (a number added when that name is taken), then its folder
   opens with the zip selected, like every export. The main process writes it
   (project-zip.js); a long video takes a while, so until it is done Export
   pulses (aria-busy) and its menu item says so. */
let _zipBusy = false;
function _setZipBusy(busy) {
  _zipBusy = busy;
  const btn = document.getElementById("btn-session-export-menu");
  if (btn) {
    if (!btn.dataset.idleTitle) btn.dataset.idleTitle = btn.title;
    btn.classList.toggle("busy", busy);
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    btn.title = busy ? "Making the zip of the whole project: its folder opens when the zip is ready" : btn.dataset.idleTitle;
  }
  const item = document.getElementById("btn-session-zip");
  if (item) {
    item.disabled = busy;
    item.textContent = busy ? "Making the zip..." : "Whole project (.zip)";
  }
}
async function exportProjectZip() {
  const sess = State.getSession();
  if (!sess) { toast("Open a project first.", "error"); return; }
  if (_zipBusy) return;
  _setZipBusy(true);
  toast("Making the zip of the whole project. A long video takes a while: its folder opens when the zip is ready.", "info");
  let r;
  try {
    r = await Ipc.exportProjectZip({ sessionFolder: sess.sessionFolder });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  } finally {
    _setZipBusy(false);
  }
  if (!r || !r.ok) {
    toast("The zip was not made. " + ((r && r.error) || "No reason was given."), "error");
    return;
  }
  await Ipc.revealFile(r.path);
  toast("Exported: " + path.basename(r.path) + " (" + r.size + ")", "success");
}
if ($("#btn-session-zip")) $("#btn-session-zip").addEventListener("click", () => exportProjectZip());

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
    } else if (tag === "select") {
      // Nothing: a dropdown (the step pane's Go to) keeps its keys, so the
      // arrows and a typed letter pick an option, not a step or a verb.
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (confirmOpenRun()) e.preventDefault();
    } else if (e.key === "Enter" && plain && !onControl) {
      if (renameSelectedStep()) e.preventDefault();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.ctrlKey && !e.metaKey && !onControl) {
      // C16: move a step without a time up or down in its run.
      if (moveSelectedStep(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
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
/* Help, Troubleshooting: Re-analyze, the one way to run the analysis by hand
   (AD-22: it runs by itself otherwise). It asks first when the recording has
   steps, like Apply marker changes. */
if ($("#btn-help-reanalyze")) {
  $("#btn-help-reanalyze").addEventListener("click", () => {
    if (!State.getSession()) { toast("Open a project first.", "error"); return; }
    closeHelp();
    analyzeSession({ confirm: "reanalyze" });
  });
}
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
// The save state in the top bar: Saved, Saving... or Not saved (save-state.js).
SaveState.mount(document.getElementById("save-state"), { subscribe: Ipc.onProjectWrite });

/* If launched with --session=<path>, the main process pushes the path
   via this channel. Open it without any further user click. */
Ipc.onOpenInitialSession((folder) => {
  if (folder) loadSessionIntoView(folder);
});

/* ============ Attach video ====================================== */

/* The Timeline's no-video band carries Attach video... (the Overview's
   recording line carries the same act, wired there). Both run the
   click-to-sync flow: choose the file, then click a moment in the video and
   the same moment on the timeline (flow-view-video.attachVideo). */
if ($("#btn-link-recording")) {
  $("#btn-link-recording").addEventListener("click", () => Video.attachVideo());
}

/* Close the top bar's other menus when one opens: a button's own click
   stops at the button, so the others' outside-click never sees it. */
function _closeOtherTopMenus(keep) {
  document.querySelectorAll("header.topbar .project-menu-popup").forEach((p) => {
    if (p !== keep) p.style.display = "none";
  });
}

/* ===== New and Open menus (top bar) =====
   Two menus (owner review 2026-09-24, AD-29). New: "New project from a
   video..." and "New empty project..." (C16, flow-view's newProject). Open:
   "Open project..." (its click is flow-view's openSessionFlow; a recorder's
   folder opens here too), then the recent projects, reachable from every
   level. */
function renderRecentMenu() {
  const host = document.getElementById("recent-menu-content");
  if (!host) return;
  let html = "";
  const sessions = getRecent();
  if (sessions.length) {
    html += '<div class="recent-menu-heading">Recent projects</div>';
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
    html = '<div class="recent-menu-empty">No recent projects yet.</div>';
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
  if (open) { _closeOtherTopMenus(popup); renderRecentMenu(); }
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
  const item = document.getElementById("btn-open-session");
  if (item) item.addEventListener("click", () => toggleRecentMenu(false));
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) toggleRecentMenu(false);
  });
})();

/* Generic dropdown menu (button + popup), used by the New and Export menus.
   Mirrors wireRecentMenu: the button toggles the popup (closing the bar's
   other menus), an outside click closes it, and clicking any enabled menu
   item closes it after the item's own handler runs. */
function wireDropdownMenu(btnId, popupId) {
  const btn = document.getElementById(btnId);
  const popup = document.getElementById(popupId);
  if (!btn || !popup) return;
  function toggle(force) {
    const open = force === undefined ? popup.style.display === "none" : !!force;
    if (open) _closeOtherTopMenus(popup);
    popup.style.display = open ? "" : "none";
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  popup.addEventListener("click", (e) => {
    if (e.target.closest(".project-menu-item")) toggle(false);
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) toggle(false);
  });
}
wireDropdownMenu("btn-new-menu", "new-menu-popup");
wireDropdownMenu("btn-session-export-menu", "session-export-popup");
