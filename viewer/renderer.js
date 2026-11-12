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

const { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast, placeToast } = require("./dom.js");
const { initRecent, getRecent, renderRecent } = require("./recent.js");
const { initStepsView, renderStepsLevel, addManualStep, splitStep, mergeStepWithNext, mergeSelectedSteps, addStepAtTimestamp, visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun, moveSelectedStep } = require("./views/steps-view.js");
const { initSession, resetUndoStack, canUndo, canRedo, saveAnnotationsWithUndo, performUndo, performRedo, ensureAnnoShape, persistAnnotations } = require("./session.js");
const { initFlowView, loadSessionIntoView, openInNewWindow, renderTimeline, renderSessionPills, seekToTimestamp, jumpToStepInFlow, addStepAtPlayhead, analyzeSession, analysisBusy, runPipeline, UPDATING, syncRawEventsShown, scheduleAutoApply, yieldAutoApply, markersReverted } = require("./views/flow-view.js");
// V2 item 4: the step panel beside the map, the timeline and the Steps list.
const StepPanel = require("./views/step-panel.js");
const Video = require("./views/flow-view-video.js");
const Screens = require("./views/flow-view-screenshots.js");
const { stretchKey } = require("./views/flow-view.js");
const { renderOverviewLevel, openMarkersInFlow, mapLockHtml, mapEmptyText } = require("./views/overview-view.js");
const { createMapController } = require("./map-controller.js");
const { buildAnnotationDfg, mapNodeLabel, flowEdges, wasteNodes } = require("./process-map-levels.js");
const RunsModel = require("./runs-model.js");
const RunDiff = require("./run-differences.js");
const SystemNames = require("./system-names.js");
const RefmapUI = require("./refmap-ui.js");
const SPM = require("./sub-process-maps.js");
const Planes = require("./map-planes.js");
const AsIsLinks = require("./asis-links.js");
const { pddExportOutcome } = require("./normalize-result.js");
const SaveState = require("./save-state.js");
const RO = require("./read-only.js");
const HandoffUI = require("./views/handoff-ui.js");
const Library = require("./library.js");
const LibraryBuilder = require("./views/library-builder-ui.js");
const { exportBaseName } = require("./session-summary.js");
// Lane A-2: the app's zoom (Ctrl+Plus, Ctrl+Minus, Ctrl+0, Ctrl and the
// wheel), the same in every window and kept on this computer.
require("./app-zoom.js").wire({ say: (text) => toast(text) });

/* The name an export is offered under (lane FX3, validation pass 2, item
   20): the project's name, then the file's kind ("Order to cash PDD.docx",
   "Order to cash map.svg"), never a generic "process.pdd.docx". */
function _exportName(sess, kind) {
  const folder = sess && sess.sessionFolder ? path.basename(sess.sessionFolder) : "";
  return exportBaseName(sess, folder) + " " + kind;
}

/* ============ Flow view -- see views/flow-view.js ================= */

/* Cross-surface glue that stays in this entry is injected into the
   Flow module as lazy wrappers so hoisting / load order does not
   matter (rerenderActiveLevel etc. are declared further down). */
initFlowView({
  rerenderActiveLevel:    () => rerenderActiveLevel(),
  addStepAtTimestamp:     (ts, opts) => addStepAtTimestamp(ts, opts),
});

/* ============ Session / undo layer -- see session.js ============== */

initSession({
  renderSessionPills: () => renderSessionPills(),
  // An undo or a redo that changes the stretches left out of the analysis
  // analyzes again; one that changes the video reloads the project.
  reloadSession: (folder) => loadSessionIntoView(folder),
  analyzeSession: () => analyzeSession(),
  // 2.0.3: an automatic run for marker changes gives way to a save.
  beforeWrite: () => yieldAutoApply(),
  // D4: an undo or a redo of a marker change runs the analysis a moment later.
  markersReverted: () => markersReverted(),
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

/* The Map level shows the map the PDD prints (lane MV, refmap-ui.js and
   map-view.js: the As-Is copy chosen for the PDD, else
   process_map_step.bpmn, drawn by bpmn-js), and one click away how the
   transactions ran: the live map, a Flow diagram built from the runs' steps
   (process-map-levels.buildAnnotationDfg), bound to the loaded session
   through map-controller.js. The controller is created on first render so
   its lookups land after the DOM is ready. */
let _sessionMapCtrl = null;

/* The step-level BPMN the pipeline writes with --mine: the source Fork copies
   into an editable reference map (ADR-0019). */
function _stepBpmnPath() {
  const sess = State.getSession();
  return (sess && sess.sessionFolder) ? path.join(sess.sessionFolder, "process_map_step.bpmn") : null;
}

/* The level the Map shows (contract C19): State.mapPath as far as its maps
   are still there (a sub-process dissolved, hidden or renamed since takes the
   level up, as the Steps level does), with the project's maps (mapTree:
   depth first, numbered through the reference transaction). */
function _mapLevel() {
  const sess = State.getSession();
  const runs = RunsModel.buildRuns(sess && sess.stats, (sess && sess.annotations && sess.annotations.steps) || []).runs;
  const txs = runs.map((r) => r.members);
  const want = State.getMapPath();
  const path = SPM.validPath(txs, want);
  if (!SPM.samePath(path, want)) State.setMapPath(path);
  const pattern = RunsModel.patternRun((sess && sess.annotations) || {}, runs);
  const ref = pattern.run ? Math.max(0, runs.indexOf(pattern.run)) : 0;
  const tree = SPM.mapTree(txs, { reference: ref });
  return { runs, txs, ref, path, tree, map: tree.find((m) => SPM.samePath(m.path, path)) || null };
}

/* The name a map goes by: the main map by the process name the document
   gives, a sub-process's by its step's name (the Steps breadcrumb's names). */
function _mapName(lv, mapPath) {
  const sess = State.getSession();
  return mapPath.length ? SPM.nodeName(lv.txs, mapPath, lv.ref) : SPM.mainMapName(sess && sess.annotations);
}

/* The boxes of the level shown that are sub-processes: their maps are one
   level down. */
function _subNodes(lv) {
  return lv.tree.filter((m) => m.path.length === lv.path.length + 1 && SPM.samePath(m.path.slice(0, -1), lv.path))
    .map((m) => m.path[m.path.length - 1]);
}

const NO_SUB_STEPS = "This sub-process has no steps to draw yet: add them in Steps.";

/* The map's data: the lock message while the runs cannot be drawn
   (overview-view.mapLockHtml owns the sentences and the mark-runs verb),
   else the graph of every run's visible steps, the runs as the Steps level
   builds them; C19: at a sub-process's level, the graph of its visits'
   steps (mapTree's traces for that path, by the same edge rule). */
function _sessionMapData() {
  const sess = State.getSession();
  if (!sess) return { emptyMessage: escapeHtml("Open a project to see its process map.") };
  const run = State.getAnalysisRun();
  const lock = mapLockHtml(sess.analysis, run && run.folder === sess.sessionFolder ? run : null);
  if (lock) return { emptyMessage: lock };
  const lv = _mapLevel();
  const traces = lv.path.length ? (lv.map ? lv.map.traces : []) : lv.runs.map((r) => r.visible);
  // Lane FX1: at the main level a stretch left out of the analysis cuts its
  // transaction's trace, as it cuts the step BPMN's (step_flow).
  // Lane E (E4): none in a project without a recording (left-out.js).
  const excluded = require("./left-out.js").analysisRanges(sess);
  const leftOut = lv.path.length ? undefined
    : lv.runs.map((r) => RunDiff.leftOutStretches(excluded, { startMs: r.startMs, endMs: r.endMs }));
  return {
    dfg: buildAnnotationDfg(traces, { leftOut }),
    // AD-28: each box names the system its step happened in, under its name.
    nodeSystems: _nodeSystems(sess, traces),
    // Lane FX2 (validation pass 2, F21): a box a step of which is flagged as
    // waste says so, quietly.
    wasteNodes: wasteNodes(traces),
    // §B2: the map is TIME-weighted: edge thickness carries the time that
    // flowed along each path; the times and the count are in the tooltip.
    edgeWeight: "time",
    // C19: the sub-processes' boxes carry the mark; each level keeps its own
    // dragged arrangement.
    subNodes: _subNodes(lv),
    layoutScope: lv.path.length ? JSON.stringify(lv.path) : "",
    // A project with no steps yet says so; hidden steps are named as such.
    emptyMessage: escapeHtml(lv.path.length ? NO_SUB_STEPS : mapEmptyText((sess.annotations && sess.annotations.steps) || [])),
  };
}

/* Whether the live map draws: locked while it says why it draws no map at
   all (not analyzed, no transaction marked, a failed check), drawable when
   the level shown has a step to draw (the picture the PDD prints shows only
   then, map-view.js). */
function _liveMapState() {
  const data = _sessionMapData();
  return { locked: !data.dfg, drawable: !!(data.dfg && flowEdges(data.dfg).length) };
}

/* { map node: system } for the steps drawn (one list per run, or per visit
   of a sub-process): each node's most frequent system (the one vocabulary,
   C14). */
function _nodeSystems(sess, lists) {
  const inter = {};
  for (const ev of sess.events || []) if (ev && ev.type === "interaction" && ev.event_id) inter[ev.event_id] = ev;
  const names = (sess.stats && sess.stats.meta && sess.stats.meta.app_names) || {};
  const counts = new Map();
  for (const st of lists.flat()) {
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
      // Lane CC: beside fit once a box was dragged.
      reset: document.getElementById("btn-session-map-reset-layout"),
      wrap: document.getElementById("session-map-zoom"),
    },
    dataSource: _sessionMapData,
    // V2 item 4: a box opens the step panel beside the map, at the level
    // shown (C19).
    onNodeClick: (label) => StepPanel.openForNode(label, _mapLevel().path),
    // C19: a double-click on a sub-process's box opens its map.
    onNodeDblClick: (label) => {
      const lv = _mapLevel();
      const next = lv.path.concat([label]);
      if (lv.tree.some((m) => SPM.samePath(m.path, next))) setMapLevel(next);
    },
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
  if (State.getSession()) _renderMapPicker(_mapLevel());
  // Which picture shows, and the live map drawn while it shows (lane MV);
  // ADR-0019: the edited maps' gallery and count stay fresh.
  try { RefmapUI.refresh(); } catch (e) { console.error("[renderer] the Map was not drawn:", e); }
}

/* Show the map at `path` (the picker, a double-click on a sub-process's box,
   the As-Is map's own drill down, the step panel's Open sub-process): the
   level the Steps list and the Timeline's steps lane show too (C19). A step
   selected at another level is let go, as the Steps breadcrumb does
   (steps-view goToLevel), so Steps opens on this level. */
function setMapLevel(path) {
  State.setMapPath(path);
  const sess = State.getSession();
  const sel = State.getSelectedStepId();
  const loc = sel && sess ? SPM.findStep((sess.annotations && sess.annotations.steps) || [], sel) : null;
  if (sel && !(loc && SPM.samePath(loc.path, State.getMapPath()))) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  renderMapLevel();
}

/* ---- The Map's picker (contract C19) ----
   Shown when the project has a sub-process: "Map: <name>", and a list of
   every map depth first, indented, each sub-process's with its number (a map
   without one is not in the reference transaction, so the PDD has no chapter
   for it). Choosing one shows it. */
function _renderMapPicker(lv) {
  const wrap = document.getElementById("map-picker");
  const popup = document.getElementById("map-picker-popup");
  if (!wrap || !popup) return;
  const show = lv.tree.length > 1;
  wrap.hidden = !show;
  if (!show) { popup.style.display = "none"; return; }
  const name = _mapName(lv, lv.path);
  const nameEl = document.getElementById("map-picker-name");
  if (nameEl) nameEl.textContent = name;
  const btn = document.getElementById("btn-map-picker");
  if (btn) btn.title = "Choose the main process or one of its sub-processes; Steps shows the same level.";
  popup.innerHTML = lv.tree.map((m) => {
    const here = SPM.samePath(m.path, lv.path);
    const nm = _mapName(lv, m.path);
    const tip = !m.path.length ? ""
      : m.number != null ? "Sub-process " + m.number + ", with a chapter of its own in the PDD"
        : "Not in the reference transaction, so the PDD has no chapter for it";
    return '<button type="button" class="project-menu-item map-pick' + (here ? " current" : "") + '"' +
      (here ? ' aria-current="true"' : "") + ' data-map="' + escapeAttr(JSON.stringify(m.path)) + '"' +
      ' style="--map-depth:' + m.path.length + '"' + (tip ? ' title="' + escapeAttr(tip) + '"' : "") + ">" +
      (m.number != null ? '<span class="map-pick-num">' + escapeHtml(m.number) + "</span>" : "") +
      '<span class="map-pick-name">' + escapeHtml(nm) + "</span></button>";
  }).join("");
}
(function wireMapPicker() {
  const btn = document.getElementById("btn-map-picker");
  const popup = document.getElementById("map-picker-popup");
  if (!btn || !popup) return;
  const toggle = (open) => {
    popup.style.display = open ? "" : "none";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(popup.style.display === "none"); });
  popup.addEventListener("click", (e) => {
    const item = e.target.closest(".map-pick");
    if (!item) return;
    toggle(false);
    let path = [];
    try { path = JSON.parse(item.dataset.map || "[]"); } catch (_) { /* the main map */ }
    setMapLevel(Array.isArray(path) ? path : []);
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) toggle(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup.style.display !== "none") { toggle(false); btn.focus(); }
  });
})();

/* The As-Is map's own drill down (bpmn-js's arrow on a sub-process, a crumb
   above a plane) went to the plane at `names`: the Map shows that level when
   the project has its map (a plane the project has no map for, one added or
   renamed in the editor, leaves the level as it is). */
function _onAsIsLevel(names) {
  const lv = _mapLevel();
  const p = AsIsLinks.projectPath(names, lv.txs);
  if (!p || SPM.samePath(p, lv.path) || !lv.tree.some((m) => SPM.samePath(m.path, p))) return;
  setMapLevel(p);
}

const LEVEL_RENDERERS = { overview: renderOverviewLevel, flow: renderTimeline, steps: renderStepsLevel, map: renderMapLevel };

/* Wire the state change-notification bus: an annotation edit emits the
   topics it touched (see persistAnnotations / performUndo / performRedo)
   and the matching view re-renders itself -- no full-session reload.
   The Map level early-returns when not visible, so subscribing it to the
   annotation topics is cheap and keeps the step-level maps fresh. */
State.subscribe("steps",    renderStepsLevel);
State.subscribe("timeline", renderTimeline);
// Lane PANE: the pane beside the video follows the topics itself
// (views/timeline-pane.js; the Markers tab is gone).
// D4: the top bar's Update the steps, after a cancelled or failed run.
State.subscribe("markers",  renderSessionPills);
// 2.0.3, D4: every project applies its marker changes itself; a change
// releases a hold a cancelled or failed run left.
State.subscribe("markers",  () => scheduleAutoApply({ changed: true }));
// The Overview renders the Checklist, the project line (its warnings read
// analysis.json) and the document, so it follows markers, analysis and
// steps.
State.subscribe("markers",  renderOverviewLevel);
State.subscribe("analysis", renderOverviewLevel);
State.subscribe("steps",    renderOverviewLevel);
State.subscribe("steps",    renderMapLevel);
State.subscribe("steps",    () => StepPanel.refresh());
// C19: the step panel's Open sub-process on the Map shows that map.
State.subscribe("mapPath",  () => setMapLevel(State.getMapPath()));

/* Re-render whichever session sub-view is on screen. The single
   dispatch point for "the active level's data changed" -- it replaces
   an `if (currentLevel === ...)` triplet that was copied verbatim
   across the level handlers (issue S5). */
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
  // Lane FX3 (validation pass 3, F25): the Timeline's video stops when the
  // level changes (a click on a step band plays it), so it never plays on,
  // with its sound, on a level that does not show it.
  if (prev && prev !== name) {
    const video = document.getElementById("video");
    if (video && !video.paused) video.pause();
  }
  // The step panel closes on the Overview; elsewhere its foot follows.
  StepPanel.onLevel(name);
  // (The run select dims the other runs on the timeline and changes nothing
  // on the other levels: it sits in the Timeline's own header, P1.2.)
  const layouts = ["overview", "flow", "steps", "map"];
  for (const l of layouts) {
    const el = document.getElementById("session-layout-" + l);
    if (el) el.style.display = l === name ? "" : "none";
  }
  // Lane SCREEN: on the Timeline the stage and the timeline share the
  // window's height, edge to edge, and the page does not scroll; a message
  // reads in the timeline's row there (dom.js placeToast), at the foot of
  // the window elsewhere.
  const sessionView = document.getElementById("view-session");
  if (sessionView) sessionView.classList.toggle("on-timeline", name === "flow");
  placeToast();
  // P2.10: the Raw events drawer (the machine layer) shows on Flow only;
  // lane FX3: only when the project has events.
  syncRawEventsShown();
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
  // The topics and the undo entry's extra (lane HV: its tag) pass through.
  persistAnnotations: (a, label, topics, extra) => persistAnnotations(a, label, topics, extra),
  jumpToStepInFlow: (s) => jumpToStepInFlow(s),
  // Watch plays the step in the step panel, beside the steps (V2 item 4).
  watchStep: (s) => StepPanel.watch(s),
  // Apps outside the process analyzes again once saved.
  analyze: (opts) => analyzeSession(opts),
});

/* (Steps CRUD and Apps outside the process -> views/steps-view.js) */

/* ============ Step map / PDD exports ============================= */

async function exportArtifact(kind) {
  const target = State.getSession();
  if (!target) return;

  // Process map (BPMN), P2.12: the As-Is copy chosen for the PDD when there is
  // one (the map the analyst finished), else the OBSERVED-FLOW map the viewer
  // shows (process_map_step.bpmn, mined from the annotations by
  // bpmn_observed.py under --mine). One file with every map (C19: a plane
  // per sub-process).
  if (kind === "step-bpmn") {
    const src = await mapBpmnSource(target);
    if (!src.path) { if (src.error) toast(src.error, "error"); return; }
    const out = await Ipc.exportFile({ sourcePath: src.path, suggestedName: _exportName(target, src.asIs ? "As-Is map.bpmn" : "map.bpmn") });
    if (out) {
      await Ipc.revealFile(out);
      toast("Exported: " + path.basename(out), "success");
    }
    return;
  }

  // PDD: normalize writes the document straight to a temp path. 2.0.1: the
  // attachments go with the PDD: a project with any exports one zip, the PDD
  // and an Attachments folder its attachment names link to (pdd-zip.js).
  const os = require("os");
  const tmpPath = path.join(os.tmpdir(), "pdt-export-" + Date.now() + ".docx");
  const attached = hasAttachments(target);
  const made = await writeDocuments(target, { pddOut: tmpPath, pddAttachments: attached ? "Attachments" : null,
    label: "Writing the PDD..." });
  if (!made.ok) {
    if (made.message) toast(made.message, "error");
    return;
  }
  if (attached) await _offerPddZip(target, tmpPath);
  else await _offerExport(tmpPath, _exportName(target, "PDD.docx"));
}

/* Whether the project on screen has attached files (annotations.attachments). */
function hasAttachments(sess) {
  const list = sess && sess.annotations && sess.annotations.attachments;
  return Array.isArray(list) && list.some((a) => a && typeof a.file === "string" && a.file.trim());
}

/* 2.0.1: offer the PDD at `tmpPath` with its attachments as one zip: the
   save dialog, then its folder opens with the zip selected; the temp file
   goes either way. */
async function _offerPddZip(target, tmpPath) {
  let r = null;
  try {
    r = await Ipc.exportPddZip({ sessionFolder: target.sessionFolder, pdd: tmpPath, name: _exportName(target, "PDD") });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
  if (!r) return;
  if (!r.ok) { toast("Export failed: the PDD and its attachments were not saved. " + (r.error || ""), "error"); return; }
  await Ipc.revealFile(r.path);
  toast("Exported: " + path.basename(r.path) + " (the PDD and " +
    (r.files === 1 ? "its attachment" : "its " + r.files + " attachments") + ")", "success");
}

/* Offer a document an export wrote to a temp path: the save dialog, then its
   folder opens with the file selected; the temp file goes either way. */
async function _offerExport(tmpPath, suggested) {
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

/* Write the documents of the project on screen (`target`): the PDD to
   `pddOut` and (contract C20, lane HV) the Technical details workbook to
   `techOut`, either or both, in one run of the pipeline; `handoff` is the
   hand-off version they are made for (none: a working copy), `label` the
   status line's words while it runs. The PDD's maps are drawn off screen
   first, after an analysis when the step map is older than the steps.
   Resolves { ok: true, techWritten } once every file asked for is written,
   else { ok: false, message } (message null when the analysis before it has
   already said why); a file written by a run that failed is removed.
   techWritten (with techOut): false when the run succeeded and wrote no
   workbook, which the pipeline does for a project where nothing was
   recorded; true when it wrote one. */
async function writeDocuments(target, { pddOut, techOut, handoff, label, pddAttachments } = {}) {
  const os = require("os");
  const outs = [pddOut, techOut].filter(Boolean);
  // RP-09: nothing may sit at an output path before the run, so a file found
  // there afterwards can only be THIS run's (pddExportOutcome below).
  for (const p of outs) {
    try { fs.unlinkSync(p); }
    catch (e) {
      if (e.code !== "ENOENT") return { ok: false, message: "Export failed: could not prepare " + p + ": " + e.message };
    }
  }
  const opts = { sessionFolder: target.sessionFolder, mine: false };
  if (techOut) opts.techOut = techOut;
  if (Number.isInteger(handoff) && handoff >= 1) opts.handoff = handoff;
  // 2.0.1: the folder beside the PDD its attachments travel in.
  if (pddAttachments) opts.pddAttachments = pddAttachments;
  let mapImgPath = null, tobeImgPath = null, picsDir = null;
  if (pddOut) {
    opts.pddOut = pddOut;
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
    // level, and whether or not the Map level was ever opened); C19: so are
    // the sub-processes' maps a copy has no plane for. That file changes only
    // on an analysis, so when the steps are newer (a rename, a confirmed run)
    // or it is missing, the analysis runs first, as the Map's edit act does.
    // While the Map says why it draws nothing (no runs marked, a failed run
    // check), there is no map and the PDD says so.
    const before = State.getSession();
    const locked = !before || !!mapLockHtml(before.analysis);
    if (!locked && (!opts.pddMapImage || Planes.pddMaps(_mapLevel().tree).length)) {
      const src = _stepBpmnPath();
      if ((!src || RefmapUI.needsAnalyze(before, src)) && !(await analyzeSession())) {
        // The analysis said why; the pictures drawn so far go.
        for (const p of [mapImgPath, tobeImgPath]) { if (p) { try { fs.unlinkSync(p); } catch (_) {} } }
        return { ok: false, message: null };
      }
    }
    if (!opts.pddMapImage && !locked) {
      const src = _stepBpmnPath();
      // TD#1c: a map that cannot be drawn is said in the console, never dropped silently.
      if (!src || !fs.existsSync(src)) {
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
    // C19: a picture of each sub-process's map the PDD gives a chapter,
    // passed in a manifest (--pdd-map-images); the main map's stays above.
    if (!locked && Planes.pddMaps(_mapLevel().tree).length) {
      try {
        picsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-pdd-maps-"));
        const manifest = await _writeSubMapPictures(picsDir);
        if (manifest) opts.pddMapImages = manifest;
      } catch (e) {
        console.error("[renderer] the sub-processes' maps could not be drawn; the PDD prints them as tables:", e);
      }
    }
  }
  // The PDD's run rewrites annotations.json from the same steps and writes
  // no map, so the map it printed stays current (lane MV: opening the Map
  // afterwards does not analyze again).
  const r = await RefmapUI.keepingStepMapCurrent(() => runPipeline(opts, label || UPDATING));
  if (mapImgPath) { try { fs.unlinkSync(mapImgPath); } catch (_) {} }
  if (tobeImgPath) { try { fs.unlinkSync(tobeImgPath); } catch (_) {} }
  if (picsDir) { try { fs.rmSync(picsDir, { recursive: true, force: true }); } catch (_) {} }
  // RP-09 / C13: a non-zero exit (3 = the export failed) is a failure with
  // the pipeline's reason, and so is a "success" that wrote no file. The
  // analyst is offered a file only when this run wrote it.
  let techWritten = techOut ? true : undefined;
  for (const p of outs) {
    let doc = { exists: false, size: 0 };
    try { const st = fs.statSync(p); doc = { exists: st.isFile(), size: st.size }; }
    catch (e) { if (e.code !== "ENOENT") console.error("[renderer] could not read the exported file:", e); }
    // Nothing recorded: the pipeline succeeds and writes no Technical details.
    if (p === techOut && !doc.exists && r && r.ok && !r.cancelled) { techWritten = false; continue; }
    const outcome = pddExportOutcome(r, doc);
    if (!outcome.ok) {
      for (const q of outs) { try { fs.unlinkSync(q); } catch (_) { /* absent, or a partial file the OS will clean from temp */ } }
      return { ok: false, message: outcome.message };
    }
  }
  // The run wrote analysis.json too, with the rows the PDD prints in
  // sections 5 and 6: the Overview shows those (one source, lane CC).
  _rereadAnalysis(target);
  return { ok: true, techWritten };
}

const NO_TECH_DETAILS = "Nothing was recorded in this project, so there are no Technical details to write.";

/* Export, Technical details (.xlsx) (contract C20, lane HV): the workbook a
   developer reads beside the PDD, written by the pipeline (--tech-out),
   then offered like every export. */
async function exportTechDetails() {
  const target = State.getSession();
  if (!target) { toast("Open a project first.", "error"); return; }
  const tmpPath = path.join(require("os").tmpdir(), "pdt-export-" + Date.now() + ".xlsx");
  const made = await writeDocuments(target, { techOut: tmpPath, label: "Writing the Technical details..." });
  if (!made.ok) {
    if (made.message) toast(made.message, "error");
    return;
  }
  // The pipeline writes no workbook for a project where nothing was
  // recorded: said plainly, and no folder opens.
  if (made.techWritten === false) { toast(NO_TECH_DETAILS, "info"); return; }
  await _offerExport(tmpPath, _exportName(target, "Technical details.xlsx"));
}
if ($("#btn-session-tech")) $("#btn-session-tech").addEventListener("click", () => exportTechDetails());

/* Lane HV: Export, Hand off... (views/handoff-ui.js), with the documents
   writer above; and, in a hand-off opened read only, the PDD and the
   Technical details it came with. */
HandoffUI.initHandoffUI({ writeDocuments: (target, o) => writeDocuments(target, o),
  writeMaps: (target, dir, names) => writeHandoffMaps(target, dir, names) });

/* Read the project's analysis.json again into the project on screen (the
   PDD's run rewrote it) and redraw what shows it: the Overview's project
   line reads its checks. */
function _rereadAnalysis(target) {
  const now = State.getSession();
  if (!now || !target || now.sessionFolder !== target.sessionFolder) return;
  try {
    now.analysis = JSON.parse(fs.readFileSync(path.join(now.sessionFolder, "analysis.json"), "utf-8"));
  } catch (e) {
    console.error("[renderer] analysis.json could not be read after the PDD export:", e);
    return;
  }
  State.emit("analysis");
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
  // Lane MV: the Map draws the picture the PDD prints; it analyzes first when
  // the steps are newer than process_map_step.bpmn, and draws again after.
  renderMap: () => renderMapLevel(),
  liveMap: () => _liveMapState(),
  analysisBusy: () => analysisBusy(),
  sourceBpmnPath: () => _stepBpmnPath(),
  analyze: () => analyzeSession({ quiet: true }),
  // C19: the As-Is map shows the plane of the level the Map shows, and its
  // own drill down moves that level.
  mapPath: () => (State.getSession() ? _mapLevel().path : []),
  onAsIsLevel: (names) => _onAsIsLevel(names),
  mainMapName: () => SPM.mainMapName((State.getSession() || {}).annotations),
  // Lane FX3: without a step there is no process map to copy.
  hasSteps: () => _hasMapSteps(),
});

/* Lane FX3 (validation pass 3, F16): whether a transaction has a visible
   step, so there is a process map to draw, copy or export. Without one the
   map's acts say why at once, with no analysis. */
function _hasMapSteps() {
  return !!State.getSession() && _mapLevel().runs.some((r) => r.visible.length > 0);
}
const NO_MAP_TO_EXPORT = "No process map to export: the transactions have no steps yet.";

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

/* A map file's text, or null (missing; a file that cannot be read is said
   in the console). */
function _readMapFile(p) {
  if (!p) return null;
  try { return fs.readFileSync(p, "utf-8"); }
  catch (e) { if (e.code !== "ENOENT") console.error("[renderer] could not read " + p + ":", e); return null; }
}

/* C19: the pictures of the sub-processes' maps the PDD gives a chapter
   (map-planes.pddMaps: the maps with a number), each the chosen As-Is copy's
   plane for its path when the copy has one, else process_map_step.bpmn's,
   written as PNG files into `dir` beside the manifest the pipeline reads
   (--pdd-map-images). Returns the manifest's path, or null when there is no
   such map or none could be drawn; a map without a picture prints as a table
   (said in the console). */
async function _writeSubMapPictures(dir) {
  const maps = Planes.pddMaps(_mapLevel().tree);
  if (!maps.length) return null;
  const pics = maps.map(() => null);
  const draw = async (xml, which) => {
    if (!xml || !which.length) return;
    const got = await RefmapUI.renderPlanesToPng(xml, which.map((i) => maps[i].path));
    got.forEach((d, k) => { if (d) pics[which[k]] = d; });
  };
  const asIs = _chosenAsIsMap();
  if (asIs) await draw(_readMapFile(asIs.path), maps.map((_, i) => i));
  await draw(_readMapFile(_stepBpmnPath()), maps.map((_, i) => i).filter((i) => !pics[i]));
  const pictures = [];
  pics.forEach((d, i) => {
    const comma = d ? d.indexOf("base64,") : -1;
    if (comma === -1) {
      console.warn("[renderer] the map of sub-process " + maps[i].number + " could not be drawn; the PDD prints it as a table");
      return;
    }
    const png = "map-" + (i + 1) + ".png";
    fs.writeFileSync(path.join(dir, png), Buffer.from(d.slice(comma + 7), "base64"));
    pictures.push({ path: maps[i].path, png });
  });
  const manifest = Planes.pddManifest(pictures);
  if (!manifest.maps.length) return null;
  const file = path.join(dir, "maps.json");
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), "utf-8");
  return file;
}

/* AD-11: "Process map (image)" saves the process map as an SVG image, the
   format Figma, Lucidchart and browsers import, drawn off screen by the
   PDD's map renderer (RefmapUI.renderPlaneToSvg), so the picture saved is the
   one the PDD prints: the As-Is copy chosen for the PDD when there is one
   (P2.12), else (AD-32) process_map_step.bpmn, analyzed first when the
   steps are newer than it or it is missing, as for the PDD (exportArtifact).
   C19: the map the Map level shows, the main map unless another is chosen
   there: its plane in the As-Is copy, else (the copy has no map for that
   sub-process, and the Map shows the one from the transactions) its plane in
   process_map_step.bpmn. The analyst stays on the level they are on. While
   the Map says why it draws no map (no transactions marked, a failed check),
   there is none to save, and the export says so. */
async function exportMapSvg() {
  const sess = State.getSession();
  if (!sess) { toast("Open a project first.", "error"); return; }
  const level = (() => { const lv = _mapLevel(); return lv.map || { path: [], number: null }; })();
  const r = await mapSvgOf(sess, level.path);
  if (!r.svg) { if (r.error) toast(r.error, "error"); return; }
  await _svgSaved(await Ipc.saveSvgFile({ content: r.svg, suggestedName: Planes.imageName(_exportName(sess, r.asIs ? "As-Is map" : "map"), level) }));
}

/* The picture Process map (image) saves for the map at `levelPath` ([] the
   main map) of the project `sess`: { svg, asIs } (asIs: drawn from the
   As-Is copy chosen for the PDD), or { svg: null, error } with the sentence
   that says why there is none (null when an analysis already said why).
   The hand-off's map picture is this one for the main map. */
async function mapSvgOf(sess, levelPath) {
  const asIs = _chosenAsIsMap();
  if (asIs) {
    const r = await RefmapUI.renderPlaneToSvg(_readMapFile(asIs.path), levelPath);
    if (r.svg) return { svg: r.svg, asIs: true };
    if (!r.missing) return { svg: null, error: "The As-Is map could not be drawn as an image." };
  }
  if (mapLockHtml(sess.analysis)) return { svg: null, error: "No process map to export: the Map says why." };
  // Lane FX3 (validation pass 3, F16): no step, no map: said at once, never
  // an analysis that ends without a word.
  if (!_hasMapSteps()) return { svg: null, error: NO_MAP_TO_EXPORT };
  const src = _stepBpmnPath();
  if (RefmapUI.needsAnalyze(sess, src)) {
    if (!(await analyzeSession())) return { svg: null, error: "The process map could not be updated, so it was not exported." };
  }
  const xml = _readMapFile(src);
  if (!xml) return { svg: null, error: NO_MAP_TO_EXPORT };
  const r = await RefmapUI.renderPlaneToSvg(xml, levelPath);
  if (!r.svg) return { svg: null, error: "The process map could not be drawn as an image." };
  return { svg: r.svg, asIs: false };
}

/* The file Process map (BPMN) saves for the project `target`: { path,
   asIs } (the As-Is copy chosen for the PDD when there is one, else
   process_map_step.bpmn, which holds every map, C19: analyzed first when the
   steps are newer than it or it is missing, as Edit as the As-Is map does),
   or { path: null, error } (error null when the analysis already said why).
   The hand-off's map.bpmn is this file. */
async function mapBpmnSource(target) {
  const asIs = _chosenAsIsMap();
  if (asIs) return { path: asIs.path, asIs: true };
  const sourcePath = path.join(target.sessionFolder, "process_map_step.bpmn");
  // Lane FX3: no step, no map: said at once, with no analysis.
  if (!_hasMapSteps()) return { path: null, error: NO_MAP_TO_EXPORT };
  if (RefmapUI.needsAnalyze(target, sourcePath)) {
    if (!(await analyzeSession())) return { path: null, error: null };   // the analysis said why
  }
  if (!fs.existsSync(sourcePath)) return { path: null, error: NO_MAP_TO_EXPORT };
  return { path: sourcePath, asIs: false };
}

/* The hand-off's map files (views/handoff-ui.js), written into `dir` under
   `names` (handoff.js fileNames): the main map's picture as Process map
   (image) draws it and the file Process map (BPMN) saves. Resolves
   { mapSvg, mapBpmn }, each the file's path or null when there is no map to
   draw (said in the console; the hand-off goes out without it). */
async function writeHandoffMaps(target, dir, names) {
  const out = { mapSvg: null, mapBpmn: null };
  try {
    const bpmn = await mapBpmnSource(target);
    if (bpmn.path) {
      out.mapBpmn = path.join(dir, names.mapBpmn);
      fs.copyFileSync(bpmn.path, out.mapBpmn);
    } else console.warn("[renderer] the hand-off goes out without map.bpmn:", bpmn.error || "the analysis said why");
    const svg = await mapSvgOf(target, []);
    if (svg.svg) {
      out.mapSvg = path.join(dir, names.mapSvg);
      fs.writeFileSync(out.mapSvg, svg.svg, "utf-8");
    } else console.warn("[renderer] the hand-off goes out without map.svg:", svg.error || "the analysis said why");
  } catch (e) {
    console.error("[renderer] the hand-off's map files could not be written; it goes out without them:", e);
    for (const k of ["mapSvg", "mapBpmn"]) { if (out[k]) { try { fs.unlinkSync(out[k]); } catch (_) {} out[k] = null; } }
  }
  return out;
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
  // The map editor (refmap-ui.js) covers the app and has its own keys: its
  // Ctrl+Z and Ctrl+Y undo and redo the map's changes (bpmn-viewer.js). None
  // of the viewer's shortcuts act underneath it (an annotations undo there
  // once took the As-Is copy away and left the map edit in place).
  const mapEditor = document.getElementById("refmap-editor-overlay");
  if (mapEditor && mapEditor.style.display !== "none") return;
  // Lane FX2: while annotations.json cannot be read, the page is the banner
  // alone and no shortcut edits anything (Help's ? still opens Help).
  const unreadable = State.getSession() && State.getSession().annotationsError;
  if (unreadable && !(e.key === "?" || (e.shiftKey && e.key === "/"))) return;
  // Lane HV: in a hand-off opened read only no shortcut edits anything (the
  // video, the zoom, the step selection and Help still answer).
  if (RO.isReadOnly(State.getSession()) && _editsInReadOnly(e)) return;
  // Don't intercept other shortcuts while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  // Lane W2: the screenshot gallery owns its keys (it steps, plays and
  // closes with them); the clock does not move behind it.
  if (Screens.galleryOpen() && (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Escape")) return;

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
  // Lane W2: I and O select a stretch on the Timeline (I where it starts, O
  // where it ends), not in a field, with no dialog or menu open; neither
  // asks anything or takes the focus.
  if (State.getLevel() === "flow" && State.getSession() && !e.ctrlKey && !e.metaKey && !e.altKey &&
      (e.key === "i" || e.key === "o" || e.key === "I" || e.key === "O") && tag !== "select" && !_overlayOnScreen()) {
    if (stretchKey(e.key)) e.preventDefault();
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
    // Lane SCREEN: Space on a control of the timeline's row that the
    // keyboard reached works that control (a click there leaves the focus
    // where it was, flow-view.js wireTimelineRow); elsewhere it plays or
    // pauses.
    if (e.target.closest && e.target.closest("#tl-row") && tag !== "div") return;
    const video = $("#video");
    if (video && video.src) {
      if (video.paused) video.play(); else video.pause();
      e.preventDefault();
    }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    // C23: a skip moves on the clock, across the videos of the chain; lane
    // W2: in a recording without a video the clock moves the same, on the
    // Timeline, and the screen from its screenshots follows. A select keeps
    // its own arrows (the speed).
    if (tag === "select") return;
    const video = $("#video");
    const delta = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10000 : 5000);
    if ((video && video.src) || State.getLevel() === "flow") {
      if (Video.nudgeClock(delta)) e.preventDefault();
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

/* Lane W2: a dialog, a menu or the screenshot gallery is on screen (its
   keys are its own). The help modal is a .modal-backdrop that stays in the
   page, hidden: only one on screen counts. */
function _overlayOnScreen() {
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  return [...document.querySelectorAll(".modal-backdrop, .lanes-popup, .project-menu-popup, #tl-ctx-menu, #step-ctx-menu, #run-ctx-menu, #shot-src-menu, #screenshot-gallery")].some(shown);
}

/* Lane HV: the shortcuts that change a project (Undo and Redo, the Steps
   verbs, a step at the playhead), which a hand-off opened read only ignores. */
function _editsInReadOnly(e) {
  const key = String(e.key || "").toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y" || key === "enter")) return true;
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) return true;
  const level = State.getLevel();
  if (level === "flow" && key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
  return level === "steps" && !e.ctrlKey && !e.metaKey && !e.altKey && (key === "enter" || key === "n" || key === "s" || key === "m");
}

/* ============ Help modal ========================================== */

/* Lane A-1: Help is a dialog (modals.js holdFocus): it takes the focus, to
   its section shown in the list, keeps Tab inside, and gives the focus back
   when it closes. */
const { holdFocus } = require("./modals.js");
let _releaseHelpFocus = null;
function openHelp(section) {
  const modal = $("#help-modal");
  const wasOpen = modal.style.display !== "none";
  modal.style.display = "";
  if (section) selectHelpSection(section);
  renderHelpLibrary();
  if (!wasOpen) {
    _releaseHelpFocus = holdFocus(modal.querySelector(".modal"));
    const here = modal.querySelector(".help-nav-item.active") || $("#btn-help-close");
    if (here) here.focus();
  }
}
/* C21: Help's line on the app's activity library, its version and counts
   ("Library 1: 9 applications, 0 activities"), read again each time Help
   opens: the builder may have replaced the file. The file and why it cannot
   be read are its tooltip. */
async function renderHelpLibrary() {
  const el = $("#help-library");
  if (!el) return;
  let r = null;
  try { r = await Ipc.readAppLibrary(); } catch (_) { r = null; }
  // The counts on a line of their own, so the narrow column breaks it there.
  const line = Library.summaryLine(r);
  const at = line.indexOf(": ");
  el.innerHTML = at > 0 && r && r.status === "ok"
    ? escapeHtml(line.slice(0, at + 1)) + ' <span class="help-library-counts">' + escapeHtml(line.slice(at + 2)) + "</span>"
    : escapeHtml(line);
  el.title = r ? String(r.path || "") + (r.error ? ": " + r.error : "") : "";
}
function closeHelp() {
  $("#help-modal").style.display = "none";
  const release = _releaseHelpFocus;
  _releaseHelpFocus = null;
  if (release) release();
}
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
/* C21: Help, Build the library...: the owner's tool (views/library-builder-ui.js). */
if ($("#btn-build-library")) {
  $("#btn-build-library").addEventListener("click", () => {
    closeHelp();
    LibraryBuilder.openLibraryBuilder({ onSaved: () => renderHelpLibrary() });
  });
}
/* Help, Troubleshooting: Re-analyze, the one way to run the analysis by hand
   (AD-22: it runs by itself otherwise). It asks first when the recording has
   steps. */
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

/* ============ Boot ================================================ */

renderRecent();
// P3.1: the version lives in Help, not in the top bar.
$("#help-version").textContent = "Version " + require("./package.json").version;
renderHelpLibrary();
// The save state in the top bar: Saved, Saving... or Not saved (save-state.js).
SaveState.mount(document.getElementById("save-state"), { subscribe: Ipc.onProjectWrite });

/* ============ Lane W0: the next act, Undo and Redo ============== */

/* The top bar's next act of the Checklist and its Undo and Redo
   (top-bar-acts.js decides what shows; overview-view.js nextActText names
   the act from the Checklist's own stages). They follow:
     - the topics the Checklist follows (steps, markers, analysis) and the
       timeline's;
     - every change of the undo and redo stacks (state.js's topic "undo"),
       a project opened or closed ("session") and a level shown ("level");
     - every write to the project folder (a transaction opened in Steps is
       saved without an undo entry or a topic, and ticks Review);
     - the page's classes (has-session, read-only, annotations-unreadable)
       and the map editor shown or closed (its overlay's style);
     - the window's width, for the tooltip of a cut text.
   One sync per tick, whatever asked for it. */
(function wireTopBarActs() {
  const TopBarActs = require("./top-bar-acts.js");
  const Overview = require("./views/overview-view.js");
  const nextBtn = document.getElementById("btn-next-act");
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  if (!nextBtn || !undoBtn || !redoBtn) return;

  const mapEditorOpen = () => {
    const o = document.getElementById("refmap-editor-overlay");
    return !!o && o.style.display !== "none" && o.getClientRects().length > 0;
  };
  function sync() {
    const sess = State.getSession();
    let nextText = null, checklist = false;
    if (sess && !RO.isReadOnly(sess) && !sess.annotationsError && Overview.hasAnalysisBlocks(sess.analysis)) {
      checklist = true;
      try { nextText = Overview.nextActText(Overview.pathState(sess)); }
      catch (e) { console.error("[top bar] the next act could not be named:", e); nextText = null; }
    }
    const v = TopBarActs.topBarActs({
      session: !!sess, readOnly: RO.isReadOnly(sess), unreadable: !!(sess && sess.annotationsError),
      level: State.getLevel(), checklist, mapEditorOpen: mapEditorOpen(), nextText,
      canUndo: canUndo(), canRedo: canRedo(),
    });
    for (const [btn, s] of [[undoBtn, v.undo], [redoBtn, v.redo]]) {
      if (btn.hidden !== !s.shown) btn.hidden = !s.shown;
      if (btn.getAttribute("aria-disabled") !== String(!s.enabled)) btn.setAttribute("aria-disabled", String(!s.enabled));
    }
    if (nextBtn.textContent !== v.next.text) nextBtn.textContent = v.next.text;
    // The bar keeps one line: the next act takes the room the rest leaves,
    // and gives way altogether below NEXT_MIN_ROOM px.
    const room = v.next.shown ? roomForNext() : 0;
    const shown = v.next.shown && room >= NEXT_MIN_ROOM;
    if (nextBtn.hidden !== !shown) nextBtn.hidden = !shown;
    const max = shown ? Math.floor(room) + "px" : "";
    if (nextBtn.style.maxWidth !== max) nextBtn.style.maxWidth = max;
    // An ellipsis drops whole letters, so an overflow of one pixel is a cut.
    const cut = shown && nextBtn.scrollWidth > nextBtn.clientWidth;
    const title = TopBarActs.nextTitle(v.next.text, cut);
    if (nextBtn.title !== title) nextBtn.title = title;
  }
  /* The width the bar leaves the next act: its inner width less every other
     item shown and the gaps between them (the spacer takes no room of its
     own). Each item keeps its own width whether the bar wraps or not. */
  const NEXT_MIN_ROOM = 64;
  function roomForNext() {
    const bar = nextBtn.parentElement;
    if (!bar) return 0;
    const cs = getComputedStyle(bar);
    const gap = parseFloat(cs.columnGap) || 0;
    let used = 0, items = 0;
    for (const el of bar.children) {
      if (el === nextBtn) { items++; continue; }
      if (!el.checkVisibility()) continue;
      items++;
      if (!el.classList.contains("flex-spacer")) used += el.getBoundingClientRect().width;
    }
    const inner = bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return inner - used - gap * Math.max(0, items - 1) - 1;
  }
  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }

  nextBtn.addEventListener("click", () => {
    const overview = document.querySelector('.view-mode-btn[data-level="overview"]');
    if (overview) overview.click();
    // The Overview draws the Checklist as it opens; the focus goes to its one
    // button, the act this one named.
    if (!Overview.focusNextAct()) requestAnimationFrame(() => Overview.focusNextAct());
  });
  // Exactly what Ctrl+Z and Ctrl+Y call; nothing while there is nothing to do.
  undoBtn.addEventListener("click", () => {
    if (undoBtn.getAttribute("aria-disabled") === "true") return;
    performUndo();
  });
  redoBtn.addEventListener("click", () => {
    if (redoBtn.getAttribute("aria-disabled") === "true") return;
    performRedo();
  });

  for (const topic of ["steps", "markers", "analysis", "timeline", "undo", "session", "level"]) State.subscribe(topic, queue);
  Ipc.onProjectWrite(() => queue());
  const watch = new MutationObserver(queue);
  const app = document.querySelector(".app");
  if (app) watch.observe(app, { attributes: true, attributeFilter: ["class"] });
  // What else the bar shows (the status line, the save state, the zip's
  // line) changes the room the next act has. Only what changes is set
  // above, so its own writes end here.
  const bar = nextBtn.parentElement;
  if (bar) watch.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  // A theme's face can cut the text where the other's did not.
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.fonts && typeof document.fonts.addEventListener === "function") document.fonts.addEventListener("loadingdone", queue);
  const overlay = document.getElementById("refmap-editor-overlay");
  if (overlay) watch.observe(overlay, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
  window.addEventListener("resize", queue);
  sync();
})();

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
   folder opens here too), "Open in a new window..." (lane MW, flow-view's
   openInNewWindowFlow), then the recent projects, reachable from every
   level, each with a button that opens it in a new window. */
const NEW_WINDOW_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/>' +
  '<path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
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
      const item = '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="session" data-folder="' + escapeHtml(r.folder) + '">' +
        '<span class="ri-label">' + escapeHtml(label) + '</span>' +
        (missing ? '<span class="ri-tag">missing</span>' : "") +
        '</button>';
      // Lane MW: a project that is there opens in a new window too.
      const newWindow = missing ? "" : '<button type="button" class="recent-menu-newwin" data-folder="' +
        escapeHtml(r.folder) + '" title="Open in a new window" aria-label="' +
        escapeHtml("Open " + label + " in a new window") + '">' + NEW_WINDOW_ICON + "</button>";
      return '<div class="recent-menu-row">' + item + newWindow + "</div>";
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
  host.querySelectorAll(".recent-menu-newwin").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleRecentMenu(false);
      openInNewWindow(btn.dataset.folder);
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
  for (const id of ["btn-open-session", "btn-open-new-window", "btn-open-handoff", "btn-open-demo"]) {
    const item = document.getElementById(id);
    if (item) item.addEventListener("click", () => toggleRecentMenu(false));
  }
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) toggleRecentMenu(false);
  });
  // Lane FX3 (validation pass 3, F21): Escape closes it, as it closes the
  // Map's picker, and the keyboard goes back to its button.
  closeOnEscape(btn, popup, () => toggleRecentMenu(false));
})();

/* Escape closes an open menu of the top bar (New, Open, Export) and gives
   the keyboard back to its button. Captured, so the menu closes before any
   other key handler reads the Escape (the help modal's, the Timeline's). */
function closeOnEscape(btn, popup, close) {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || popup.style.display === "none") return;
    close();
    e.stopPropagation();
    e.preventDefault();
    try { btn.focus(); } catch (_) { /* the button left the page */ }
  }, true);
}

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
  // Lane FX3 (F21): Escape closes it.
  closeOnEscape(btn, popup, () => toggle(false));
}
wireDropdownMenu("btn-new-menu", "new-menu-popup");
wireDropdownMenu("btn-session-export-menu", "session-export-popup");

/* ===== One start (lane B4) =====
   Open a zip... (B4a): the Open menu's item and the start page's button
   keep lane HV's handles (flow-view.js openHandoffFlow loads the path this
   flow gives, through ipc.js openHandoffDialog). A hand-off zip opens read
   only; a project zip (the capture app's, a Whole project zip) is unzipped
   where the analyst says, with the one status line and its Cancel, then
   opens for editing like any folder (its analysis runs by itself) and joins
   the recent projects. */
async function zipToOpen(zipPath) {
  let r;
  try { r = await Ipc.openZip(zipPath || null); }
  catch (e) { r = { ok: false, error: require("./project-folder.js").ipcErrorText(e) }; }
  if (!r) return null;
  if (!r.ok) {
    if (r.cancelled) toast("Cancelled: nothing was unzipped.", "info");
    else toast("The zip did not open: " + (r.error || "no reason was given"), "error");
    return null;
  }
  if (r.kind === "project") toast("Unzipped into " + r.path + ". The project opens for editing.", "success");
  return r.path;
}
Ipc.setZipFlow(() => zipToOpen(null));

/* The status line while a zip is unzipped: how far it is, and Cancel. */
(function wireUnzipStatus() {
  const host = document.getElementById("unzip-status");
  if (!host) return;
  let pct = null;
  const draw = () => {
    host.innerHTML = '<span class="unzip-status-text"><span class="unzip-status-dot" aria-hidden="true"></span>' +
      escapeHtml("Unzipping the project" + (pct == null ? "..." : ": " + pct + "%")) + "</span>" +
      '<button type="button" class="unzip-cancel" id="btn-cancel-unzip" title="Stop unzipping: nothing is made">Cancel</button>';
    host.querySelector("#btn-cancel-unzip").addEventListener("click", () => {
      Ipc.cancelUnzip();
      toast("Cancelling the unzipping...");
    });
  };
  Ipc.onUnzip((evt) => {
    if (!evt) return;
    if (evt.phase === "start") { pct = null; host.hidden = false; draw(); return; }
    if (evt.phase === "progress") {
      const next = evt.total > 0 ? Math.min(100, Math.floor((evt.done / evt.total) * 100)) : null;
      if (next === pct) return;
      pct = next;
      const txt = host.querySelector(".unzip-status-text");
      if (txt) txt.lastChild.nodeValue = "Unzipping the project" + (pct == null ? "..." : ": " + pct + "%");
      return;
    }
    host.hidden = true;
    host.innerHTML = "";
  });
})();

/* B4b: a new project from videos says what it could not attach, in place of
   flow-view.js's own message (held, so that one does not cover it). */
Ipc.onNewProjectNotes((r) => {
  toast("Project made: " + path.basename(String(r.folder || "")) + ". " + r.notes.join(" "), "error", { hold: true });
});

/* B4b, from the drop: the videos and transcripts dropped, from the name
   dialog on, as New project from a video... (flow-view.js newProject). */
async function newProjectFromFiles(paths) {
  let r = await Ipc.chooseNewProject({ kind: "video", files: paths });
  if (!r) return;
  if (!r.ok) { toast("The project was not made: " + (r.error || "no reason was given"), "error"); return; }
  toast("Copying the video into the new project...", "info");
  r = await Ipc.createProject();
  if (!r || !r.ok) { toast("The project was not made: " + ((r && r.error) || "no reason was given"), "error"); return; }
  await loadSessionIntoView(r.folder);
  const flow = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flow) flow.click();
  toast("Project made: " + path.basename(r.folder) + ". Play the video and press S, or click Add step, where each step starts.", "success");
}

/* B4c: what a drop on the start page opens (project-folder.js dropKind),
   each kind ending where its menu act ends. A real drag from Explorer
   cannot be driven by a test, so e2e/start-smoke.js calls this with paths
   (window.__pdtOpenDropped: renderer.js is the page's entry, no module to
   require). */
async function openDropped(paths) {
  const PF = require("./project-folder.js");
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
  const k = PF.dropKind(paths, isDir);
  if (k.kind === "folder") { await loadSessionIntoView(k.path); return k.kind; }
  if (k.kind === "zip") {
    const p = await zipToOpen(k.path);
    if (p) await loadSessionIntoView(p);
    return k.kind;
  }
  if (k.kind === "videos") { await newProjectFromFiles(k.paths); return k.kind; }
  toast(k.error, "error");
  return k.kind;
}
window.__pdtOpenDropped = openDropped;

(function wireStartDrop() {
  const PF = require("./project-folder.js");
  const page = document.getElementById("session-empty");
  const line = document.getElementById("session-drop-line");
  const shown = () => !!page && page.style.display !== "none" && page.getClientRects().length > 0;
  let depth = 0;
  const ready = (on) => {
    if (!page) return;
    page.classList.toggle("drop-ready", on);
    if (line) line.textContent = on ? line.dataset.ready : line.dataset.idle;
  };
  // Only this page takes files: a file dropped anywhere else in the window
  // is refused here (main.js also keeps the window on its page).
  document.addEventListener("dragover", (e) => {
    if (!PF.dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const onPage = shown() && page.contains(e.target);
    e.dataTransfer.dropEffect = onPage ? "copy" : "none";
  });
  document.addEventListener("drop", (e) => {
    if (!PF.dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const onPage = shown() && page.contains(e.target);
    depth = 0;
    ready(false);
    if (!onPage) return;
    const { webUtils } = require("electron");
    openDropped(PF.dropPaths(e.dataTransfer, (f) => webUtils.getPathForFile(f)))
      .catch((err) => toast("The files did not open: " + PF.ipcErrorText(err), "error"));
  });
  if (!page) return;
  page.addEventListener("dragenter", (e) => {
    if (!PF.dragHasFiles(e.dataTransfer) || !shown()) return;
    depth++;
    ready(true);
  });
  page.addEventListener("dragleave", (e) => {
    if (!PF.dragHasFiles(e.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) ready(false);
  });
})();

/* Lane A-1: a menu's button says whether its menu is open (aria-expanded),
   and the level shown is the current page (aria-current). Each is read from
   what the page shows (the popup's display, the level button's .active), so
   every way a menu opens or closes and every way a level is chosen keeps it
   true. */
(function syncTopBarStates() {
  if (typeof MutationObserver !== "function") return;
  for (const [btnId, popupId] of [["btn-new-menu", "new-menu-popup"], ["btn-recent-menu", "recent-menu-popup"],
    ["btn-session-export-menu", "session-export-popup"], ["btn-lanes", "lanes-popup"]]) {
    const btn = document.getElementById(btnId);
    const popup = document.getElementById(popupId);
    if (!btn || !popup) continue;
    const sync = () => btn.setAttribute("aria-expanded", popup.style.display === "none" ? "false" : "true");
    new MutationObserver(sync).observe(popup, { attributes: true, attributeFilter: ["style"] });
    sync();
  }
  const levels = $$(".view-mode-btn");
  const syncLevels = () => levels.forEach((b) => {
    if (b.classList.contains("active")) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const obs = new MutationObserver(syncLevels);
  levels.forEach((b) => obs.observe(b, { attributes: true, attributeFilter: ["class"] }));
  syncLevels();
})();
