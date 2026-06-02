/*
 * Viewer renderer -- the thin wiring entry.
 *
 * After the Phase 3 decomposition (ADR-0003) this file only wires the
 * feature modules together: tab routing, the Flow / Steps / Phases
 * level switcher, the state-change bus subscriptions, global keyboard
 * shortcuts, the project menu, the export buttons, and boot. Every
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
const PdtCharts = require("./charts.js");
const PdtReport = require("./report-md.js");
const PdtReportHtml = require("./report-html.js");
const PdtPalette = require("./command-palette.js");
const PdtDfg = require("./dfg-viewer.js");
const PdtBpmn = require("./bpmn-viewer.js");
const PdtSteps = require("./step-editor.js");
const PdtPhases = require("./phase-editor.js");
require("./layout-controls.js"); // side-effect import: self-wires resize handles + video modes

const { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast } = require("./dom.js");
const { promptModal, confirmModal, checklistModal } = require("./modals.js");
const { initRecent, getRecent, getHiddenExamples, listBundledExamples, pushRecent, renderRecent, relTime } = require("./recent.js");
const { initAggregateView, renderAggregate, loadAggregateFolders, filteredAggregateSessions } = require("./views/aggregate-view.js");
const { initVocabView, reloadVocabList } = require("./views/vocab-view.js");
const { mergeInteractionsIntoVocab } = require("./canonical-author.js");
const { refreshTemplateVersions, renderCanonicalStepList, loadCanonical } = require("./views/template-view.js");
const { initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep, deleteSelectedSteps, splitStep, mergeStepWithNext, mergeSelectedSteps, addStepAtTimestamp } = require("./views/steps-view.js");
const { initPhasesView, renderPhasesLevel, addManualPhase, groupIntoPhase } = require("./views/phases-view.js");
const { initSession, resetUndoStack, canUndo, canRedo, saveAnnotationsWithUndo, performUndo, performRedo, ensureAnnoShape, persistAnnotations } = require("./session.js");
const { initFlowView, loadSessionIntoView, renderTimeline, renderMarkersList, renderAnchorCandidates, renderAnnotations, renderSessionPills, seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow, watchStep, activateAnnoTab, addStepAtPlayhead } = require("./views/flow-view.js");
const { renderAnalysisLevel } = require("./views/analysis-view.js");
const { createMapController } = require("./map-controller.js");
const { buildAnnotationDfg, processLabel } = require("./process-map-levels.js");
const RefmapUI = require("./refmap-ui.js");

/* ============ Flow view -- see views/flow-view.js ================= */

/* Cross-surface glue that stays in this entry is injected into the
   Flow module as lazy wrappers so hoisting / load order does not
   matter (renderShortcutsOverlay etc. are declared further down). */
initFlowView({
  renderShortcutsOverlay: () => renderShortcutsOverlay(),
  rerenderActiveLevel:    () => rerenderActiveLevel(),
  applyLevel:             (name) => applyLevel(name),
  activateTab:            (name) => activateTab(name),
  addStepAtTimestamp:     (ts) => addStepAtTimestamp(ts),
});

/* ============ Session / undo layer -- see session.js ============== */

initSession({
  renderAnnotations: () => renderAnnotations(),
  renderSessionPills: () => renderSessionPills(),
});

/* ============ Recent sessions ===================================== */

initRecent({ onOpenSession: (folder) => loadSessionIntoView(folder) });

/* ============ Tabs ================================================ */

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.view));
});
function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  // Trigger lazy re-fit of any active viz
  if (name === "aggregate") {
    setTimeout(() => {
      if (PdtBpmn) PdtBpmn.fit();
      if (PdtDfg) PdtDfg.fit();
    }, 100);
    // AM.1: refresh the version compare list when the analyst lands
    // on the aggregate view (and a template is loaded).
    if (typeof refreshTemplateVersions === "function") refreshTemplateVersions().catch(() => {});
  }
  if (name === "vocabularies") {
    reloadVocabList();
  }
  // P2.4: shortcuts overlay only shows on Session view.
  if (typeof renderShortcutsOverlay === "function") renderShortcutsOverlay();
  // Let the bottom playback bar re-evaluate its visibility for this tab.
  document.dispatchEvent(new Event("pdt:tabchange"));
}

/* ============ Session view-mode switcher (Flow / Steps / Phases) ===
   The view-mode bar at the top of the loaded session swaps between
   three top-level layouts:
     #session-layout-flow    - video + timeline + annotations
     #session-layout-steps   - full-width step editor with timeline band
     #session-layout-phases  - full-width phase editor with timeline band
   This is a much bigger change than the original "toggle which timeline
   strip is visible" approach because users couldn't find the cramped
   editor inside the narrow annotations panel. */

$$(".view-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".view-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    applyLevel(btn.dataset.level);
  });
});

/* ADR-0024: the single grain control. The slider notch (and the synced map
   level select) set the shared view-time grain; Steps / Flow / Map all roll up
   to it with no re-normalization. "activity" on the map select is a map-only
   taxonomy escape hatch and does not move the grain. */
const _GRAIN_NOTCHES = ["element", "screen", "app", "phase", "case"];
function _applyGrain(notch, opts = {}) {
  if (!_GRAIN_NOTCHES.includes(notch)) return;
  State.setGrain(notch);
  const slider = document.getElementById("grain-slider");
  if (slider) slider.value = String(_GRAIN_NOTCHES.indexOf(notch));
  const lbl = document.getElementById("grain-notch-lbl");
  if (lbl) lbl.textContent = notch;
  const sel = document.getElementById("session-map-level");
  if (sel && sel.value !== notch) sel.value = notch;
  // The map's grain is the controller's level. The controller's own select
  // listener already moved it when the change came FROM the select.
  if (!opts.fromMapCtrl && _sessionMapCtrl) _sessionMapCtrl.setLevel(notch);
  State.emit("grain");           // Steps + Flow re-render to the new grain
  scheduleAutoSave();
}
(() => {
  const slider = document.getElementById("grain-slider");
  if (slider) {
    // Reflect the persisted default on boot.
    slider.value = String(Math.max(0, _GRAIN_NOTCHES.indexOf(State.getGrain())));
    slider.addEventListener("input", (e) => {
      const i = parseInt(e.target.value, 10) || 0;
      _applyGrain(_GRAIN_NOTCHES[Math.max(0, Math.min(4, i))]);
    });
  }
  const sel = document.getElementById("session-map-level");
  if (sel) {
    sel.value = State.getGrain();   // default the map select to the grain
    sel.addEventListener("change", () => {
      // "activity" is map-only; a grain notch syncs the shared grain. The map
      // controller's own listener already re-rendered the map, so skip its setLevel.
      if (sel.value !== "activity") _applyGrain(sel.value, { fromMapCtrl: true });
    });
  }
})();

const VIEW_MODE_HELP = {
  flow:   "Flow view: video, raw event timeline, and side panel for notes / screenshots / markers.",
  steps:  "Steps view: rename, split, merge, or flag the logical actions captured — or use the Grain slider to roll them up by screen / app / phase / case.",
  phases: "Phases view: group steps into milestones, or review the phases an auto-match produced.",
  map:    "Map view: the process diagram (BPMN) or Flow diagram (DFG) for this session, at the chosen Grain notch (element … case) or the Activity taxonomy level.",
  analysis: "Analysis view: heuristic waste, time-study and automation findings — review before relying on them.",
};

/* P2.3: viewport state transfer on mode switch. Each mode owns its own
   scroll container (the Flow timeline, the Steps mini-timeline, the
   Phases mini-timeline). When the analyst flips views we snapshot the
   outgoing mode's zoom + scroll fraction and apply them to the
   incoming mode -- "stayed at the same zoom + position" feel without
   forcing the three modes to share a single DOM scroll container. */
/* P2.3 viewport transfer: each mode owns its own scroll container and
   zoom variable. MODE_VIEWPORT pairs the three so snapshot/apply is one
   code path instead of three copy-pasted `if (mode === ...)` arms.
   (Zoom still reads/writes the renderer-local vars; they move into the
   state module in a later step.) */
const MODE_VIEWPORT = {
  flow: {
    scrollSel: "#timeline-scroll",
    getZoom: State.getZoomFactor, setZoom: State.setZoomFactor,
    render: renderTimeline,
  },
  steps: {
    scrollSel: "#session-layout-steps .mini-timeline-scroll",
    getZoom: State.getStepZoom, setZoom: State.setStepZoom,
    render: renderStepsLevel,
  },
  phases: {
    scrollSel: "#session-layout-phases .mini-timeline-scroll",
    getZoom: State.getPhaseZoom, setZoom: State.setPhaseZoom,
    render: renderPhasesLevel,
  },
  // The Analysis view has no timeline / zoom; the no-op zoom accessors
  // let it ride the same viewport-transfer code path harmlessly.
  analysis: {
    scrollSel: "#session-layout-analysis",
    getZoom: () => 1, setZoom: () => {},
    render: renderAnalysisLevel,
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
function _viewportSnapshotForMode(mode) {
  const m = MODE_VIEWPORT[mode];
  if (!m) return { zoom: 1, scrollFrac: 0 };
  let scrollFrac = 0;
  const el = document.querySelector(m.scrollSel);
  if (el && el.scrollWidth > el.clientWidth) {
    scrollFrac = el.scrollLeft / (el.scrollWidth - el.clientWidth);
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
  requestAnimationFrame(() => {
    const el = document.querySelector(m.scrollSel);
    if (el) el.scrollLeft = snap.scrollFrac * Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

/* ============ Map level (Session view) ============================ */

/* The Session view's "Map" level shares the interactive process-map UI with
   Compare-Sessions, but bound to a single-session data source via
   map-controller.js. Lazily created on first render so its querySelector
   lookups land after the DOM is ready. State (notation × level × scope ×
   rare-cutoff) lives in the controller and persists across session switches. */
let _sessionMapCtrl = null;

function _sessionBpmnFile(level) {
  // The observed-flow BPMN is pre-mined only at the step (=element) and phase
  // grains (ADR-0012); the screen/app/case notches have no Process-diagram file
  // and fall back to the Flow diagram. "activity" uses the taxonomy BPMN.
  return (level === "step" || level === "element") ? "process_map_step.bpmn"
       : level === "phase" ? "process_map_phase.bpmn"
       : level === "activity" ? "process_map.bpmn"
       : null;   // screen / app / case -> no Process diagram (use Flow diagram)
}

/* Activity labels emitted inside every step whose value-free label matches
   `stepLabel` in the current session -- the children the activity Flow diagram
   is scoped to when a step node is drilled. Single-session analogue of
   aggregate-view's pooled version. */
function _sessionActivityLabelsForStep(stepLabel) {
  const sess = State.getSession();
  const labels = new Set();
  if (!sess) return labels;
  const steps = ((sess.annotations || {}).steps || []).filter((st) => st && st.state !== "hidden");
  const events = sess.events || [];
  for (const st of steps) {
    const lbl = st.process_label || processLabel(st.name) || "(unnamed)";
    if (lbl !== stepLabel) continue;
    const tr = st.time_range || {};
    const a = tr.start ? new Date(tr.start).getTime() : NaN;
    const b = tr.end ? new Date(tr.end).getTime() : NaN;
    if (!isFinite(a) || !isFinite(b)) continue;
    for (const ev of events) {
      if (ev.type !== "activity") continue;
      const t = new Date(ev.timestamp).getTime();
      if (isFinite(t) && t >= a && t <= b) {
        const al = (ev.data || {}).activity_label;
        if (al) labels.add(al);
      }
    }
  }
  return labels;
}

/* DataSource: resolve the (notation × level × scope) cell for the controller.
   Pulls from State.getSession() so it always sees the current session. */
function _sessionMapDataSource({ notation, level, scope }) {
  const sess = State.getSession();
  if (!sess) return { emptyMessage: "Open a session to see its process map." };
  // Generic post-analyze hint we attach to most empty messages so a user who
  // ran Analyze with "Build process map" unchecked understands why nothing
  // shows -- the checkbox lives in the "⋯ More" menu under the actions bar.
  const mineHint = ' (Map files are produced by Analyze with "Build process map" checked — under ⋯ More.)';
  if (notation === "bpmn") {
    const file = _sessionBpmnFile(level);
    // ADR-0024: the screen/app/case notches have no pre-mined Process diagram —
    // guide to the Flow diagram rather than render a dead/empty BPMN host.
    if (!file) {
      return {
        emptyMessage: 'The Process diagram (BPMN) is mined at the Element and Phase grains. ' +
          'For the ' + level + ' grain, switch to the Flow diagram tab above — it rolls up live.',
      };
    }
    const bpmnPath = sess.sessionFolder ? path.join(sess.sessionFolder, file) : null;
    if (!bpmnPath || !fs.existsSync(bpmnPath)) {
      return {
        emptyMessage: level === "activity"
          ? 'No process map BPMN yet — click "Analyze session".' + mineHint
          : 'No ' + level + '-level Process diagram yet — Analyze a session that has ' +
            (level === "phase" ? "phases" : "steps") +
            ' (mined from your annotations).' + mineHint,
      };
    }
    return { bpmnPath };
  }
  // notation === "dfg"
  if (level === "activity") {
    const dfg = sess.dfg;
    if (!dfg || !dfg.edges || !dfg.edges.length) {
      return {
        dfg,
        emptyMessage: 'No activity-level Flow diagram yet — Analyze the session, then classify your apps in the taxonomy (the activity DFG comes from taxonomy-classified events). The grain ladder (element … case) builds its flow from your annotations and needs no taxonomy.',
      };
    }
    return { dfg };
  }
  // element / screen / app / phase / case — the grain ladder (ADR-0024), rolled
  // up live from the annotations. Phase drill-scope still applies on the
  // element notch (a phase node descends to its steps).
  const phaseFilter = (scope && scope.level === "step")
    ? { phaseName: scope.phaseName } : null;
  return {
    dfg: buildAnnotationDfg([sess], level, phaseFilter, _sessionGrainCtx(sess)),
    emptyMessage: 'No ' + level + '-grain Flow diagram yet — add steps to this ' +
      'session in the Steps view (the map rolls them up at the chosen grain).',
  };
}

/* Resolver context for the grain roll-up: a stable case label and the
   interaction map (the view-time fallback for sessions analyzed before
   grain_keys were stamped). Lazy-require flow-view to dodge the load cycle. */
function _sessionGrainCtx(sess) {
  let caseLabel = (id) => id;
  try {
    const cases = require("./views/flow-view.js").deriveCases(sess) || [];
    const m = {};
    cases.forEach((c, i) => { m[c.id] = (c.label && c.label !== c.id) ? c.label : ("Case " + (i + 1)); });
    caseLabel = (id) => m[id] || "Case ?";
  } catch (_) { /* fall back to the raw id */ }
  const interactionsById = {};
  for (const ev of (sess.events || [])) {
    if (ev.type === "interaction" && ev.event_id) interactionsById[ev.event_id] = ev;
  }
  return { caseLabel, interactionsById };
}

/* Activity-node click in the Session-view map: seek the Flow timeline to the
   first matching event and switch to the Flow level. */
function _sessionOnActivityNodeClick(label /*, ev */) {
  const sess = State.getSession();
  if (!sess || !sess.events || !label) return;
  const want = String(label).toLowerCase();
  const target = sess.events.find((e) =>
    e.type === "activity" &&
    (((e.data || {}).activity_label || "").toLowerCase() === want));
  if (target && target.timestamp) {
    applyLevel("flow");
    setTimeout(() => seekToTimestamp(target.timestamp), 0);
  }
}

function _ensureSessionMapCtrl() {
  if (_sessionMapCtrl) return _sessionMapCtrl;
  _sessionMapCtrl = createMapController({
    hostBpmn: document.getElementById("session-map-bpmn-host"),
    hostDfg: document.getElementById("session-map-dfg-host"),
    notationTabs: Array.from(document.querySelectorAll("#session-layout-map .panel-tab[data-map]")),
    levelSelect: document.getElementById("session-map-level"),
    scopeChip: document.getElementById("session-map-scope"),
    zoomControls: {
      in: document.getElementById("btn-session-map-zoom-in"),
      out: document.getElementById("btn-session-map-zoom-out"),
      fit: document.getElementById("btn-session-map-zoom-fit"),
      wrap: document.getElementById("session-map-zoom"),
      pct: document.getElementById("session-map-zoom-pct"),
    },
    rareSlider: {
      wrap: document.getElementById("session-hide-rare-wrap"),
      range: document.getElementById("session-rng-rare"),
      label: document.getElementById("session-hide-rare-lbl"),
    },
    dataSource: _sessionMapDataSource,
    activityLabelsForStep: _sessionActivityLabelsForStep,
    onActivityNodeClick: _sessionOnActivityNodeClick,
    // ADR-0024: the Map opens at the shared grain notch (default "screen"). That
    // notch has no pre-mined BPMN, so default to the Flow diagram, which rolls
    // up live — the Process diagram (Element/Phase) stays one tab away.
    initialNotation: "dfg",
    initialLevel: State.getGrain(),
  });
  return _sessionMapCtrl;
}

function renderMapLevel() {
  // Cheap to call when the Map level isn't visible: the controller's tabs and
  // hosts are hidden anyway. We early-return mainly to skip BPMN's async render
  // when nothing's on screen.
  if (State.getLevel() !== "map") return;
  _ensureSessionMapCtrl().render();
  try { RefmapUI.refresh(); } catch (_) {}   // ADR-0019: keep the reference-maps gallery + count fresh
}

const LEVEL_RENDERERS = { flow: renderTimeline, steps: renderStepsLevel, phases: renderPhasesLevel, map: renderMapLevel, analysis: renderAnalysisLevel };

/* Wire the state change-notification bus: an annotation edit emits the
   topics it touched (see persistAnnotations / performUndo / performRedo)
   and the matching view re-renders itself -- no full-session reload.
   The Map level early-returns when not visible, so subscribing it to the
   annotation topics is cheap and keeps step/phase-level DFGs fresh. */
State.subscribe("steps",    renderStepsLevel);
State.subscribe("phases",   renderPhasesLevel);
State.subscribe("timeline", renderTimeline);
State.subscribe("markers",  renderMarkersList);
State.subscribe("markers",  renderAnchorCandidates);
State.subscribe("analysis", renderAnalysisLevel);
State.subscribe("steps",    renderMapLevel);
State.subscribe("phases",   renderMapLevel);
// ADR-0024: a grain change re-renders the Steps list and the Flow timeline to
// the new notch (the Map is moved by mapCtrl.setLevel, so it isn't subscribed
// here to avoid a double render).
State.subscribe("grain",    renderStepsLevel);
State.subscribe("grain",    renderTimeline);
State.subscribe("grain",    renderAnalysisLevel);

/* Re-render whichever session sub-view is on screen. The single
   dispatch point for "the active level's data changed" -- it replaces
   an `if (currentLevel === ...)` triplet that was copied verbatim
   across the case-scope and command-palette handlers (issue S5). */
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
  const layouts = ["flow", "steps", "phases", "map", "analysis"];
  for (const l of layouts) {
    const el = document.getElementById("session-layout-" + l);
    if (el) el.style.display = l === name ? "" : "none";
  }
  const help = document.getElementById("view-mode-help");
  if (help) {
    // Clutter pass: the per-view hint is an onboarding aid, not permanent
    // chrome. A dismiss "×" hides it for good (persisted); the same guidance
    // stays in the Help (?) modal. Re-show by clearing pdt.viewModeHelpDismissed.
    let dismissed = false;
    try { dismissed = localStorage.getItem("pdt.viewModeHelpDismissed") === "1"; } catch (e) {}
    const txt = VIEW_MODE_HELP[name] || "";
    if (dismissed || !txt) {
      help.innerHTML = "";
      help.style.display = "none";
    } else {
      help.style.display = "";
      help.innerHTML = '<span class="view-mode-help-text"></span>' +
        '<button class="view-mode-help-x" id="btn-view-mode-help-x" title="Hide these per-view hints (still in Help)" aria-label="Dismiss view hint">×</button>';
      help.querySelector(".view-mode-help-text").textContent = txt;
      const x = help.querySelector("#btn-view-mode-help-x");
      if (x) x.addEventListener("click", (e) => {
        e.stopPropagation();
        try { localStorage.setItem("pdt.viewModeHelpDismissed", "1"); } catch (_) {}
        help.innerHTML = "";
        help.style.display = "none";
      });
    }
  }
  if (incomingSnap) {
    _viewportApplyToMode(name, incomingSnap);
  } else {
    rerenderActiveLevel();
  }
  // P2.4: refresh the shortcuts overlay for the new view.
  renderShortcutsOverlay();
  scheduleAutoSave();   // F1: persist the project after a view-mode switch
}

/* P2.4: small persistent corner widget listing 3-4 most-used
   shortcuts for the active view. Dismissable; state persisted to
   localStorage so the analyst doesn't have to dismiss every launch. */
const SHORTCUTS_OVERLAY_KEY = "pdt.shortcutsOverlayHidden";
const VIEW_SHORTCUTS = {
  map: [
    ["Click node", "Drill into details"],
    ["Scroll",     "Zoom map"],
    ["Drag",       "Pan map"],
  ],
  flow: [
    ["Space", "Play / pause video"],
    ["← →",  "Scrub 5s"],
    ["+ −",  "Zoom timeline"],
    ["Shift-drag", "Select range"],
  ],
  steps: [
    ["J / K", "Prev / next step"],
    ["S",     "Split step at playhead"],
    ["M",     "Merge selected"],
    ["Ctrl+Z", "Undo"],
  ],
  phases: [
    ["Drag",  "Reorder steps in phase"],
    ["G",     "Group selected steps into a phase"],
    ["Ctrl+Z", "Undo"],
    ["?",     "Open help"],
  ],
};
function renderShortcutsOverlay() {
  const ov = document.getElementById("shortcuts-overlay");
  if (!ov) return;
  const hidden = localStorage.getItem(SHORTCUTS_OVERLAY_KEY) === "1";
  // Only show on the Session view, when a session is loaded, and not dismissed.
  const onSession = document.querySelector(".tab.active") &&
                    document.querySelector(".tab.active").dataset.view === "session";
  if (hidden || !onSession || !State.getSession()) {
    ov.style.display = "none";
    return;
  }
  const lvl = State.getLevel();
  const items = VIEW_SHORTCUTS[lvl] || [];
  if (!items.length) { ov.style.display = "none"; return; }
  ov.style.display = "";
  document.getElementById("shortcuts-overlay-title").textContent =
    lvl.charAt(0).toUpperCase() + lvl.slice(1) + " shortcuts";
  document.getElementById("shortcuts-overlay-list").innerHTML =
    items.map(([k, d]) =>
      '<li><span class="key">' + escapeHtml(k) + '</span><span>' + escapeHtml(d) + '</span></li>'
    ).join("");
}
(function wireShortcutsOverlay() {
  const closeBtn = document.getElementById("shortcuts-overlay-close");
  if (closeBtn) closeBtn.addEventListener("click", () => {
    localStorage.setItem(SHORTCUTS_OVERLAY_KEY, "1");
    renderShortcutsOverlay();
  });
})();

/* ============ Theme toggle ======================================== */

/* Flips Warm Editorial (light) <-> Studio Dark (dark). CSS chrome
   recolors itself the instant data-theme flips; the JS-painted marks
   (timeline bands, the cytoscape DFG, the charts) are repainted by
   re-running the existing renderers. */
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
    renderAggregate();
  });
  sync();
})();

/* ============ Steps + Phases view modules ========================= */

/* Steps + Phases view modules -- see views/steps-view.js + phases-view.js.
   Deps are passed as lazy wrappers so hoisting order does not matter. */
initStepsView({
  ensureAnnoShape: (a) => ensureAnnoShape(a),
  persistAnnotations: (a, label) => persistAnnotations(a, label),
  videoTimeToSessionTs: (t) => videoTimeToSessionTs(t),
  jumpToStepInFlow: (s) => jumpToStepInFlow(s),
  watchStep: (s) => watchStep(s),
  openCanonicalInTemplateTab: (r) => { activateTab("canonical"); loadCanonical(r); },
});
initPhasesView({
  ensureAnnoShape: (a) => ensureAnnoShape(a),
  persistAnnotations: (a, label) => persistAnnotations(a, label),
  activateAnnoTab: (n) => activateAnnoTab(n),
});

/* ============ Mini-timeline zoom (Steps / Phases) ================= */

function bindMiniTimelineZoom(prefix, getZoom, setZoom, rerender) {
  const buttons = [
    ["zoom-in",    () => setZoom(Math.min(20, getZoom() * 1.5))],
    ["zoom-out",   () => setZoom(Math.max(1, getZoom() / 1.5))],
    ["zoom-reset", () => setZoom(1)],
  ];
  for (const [suffix, fn] of buttons) {
    const btn = document.getElementById(`btn-${prefix}-${suffix}`);
    if (btn) btn.addEventListener("click", () => { fn(); rerender(); });
  }
}
bindMiniTimelineZoom("steps",
  State.getStepZoom, State.setStepZoom,
  () => renderStepsLevel());
bindMiniTimelineZoom("phases",
  State.getPhaseZoom, State.setPhaseZoom,
  () => renderPhasesLevel());

/* (Steps + phases CRUD, ignored-apps, grouping suggestions -> views/) */
/* (Process Template tab editor + version compare -> views/template-view.js) */

/* ============ Save App Vocabulary from this session ================ */

async function buildVocabFromSession(suggestedName) {
  if (!State.getSession()) return;
  const vocabName = suggestedName || await promptModal({
    title: "Save to App Library",
    message: "App vocabulary name",
    detail: "e.g., \"Salesforce\". Used as the file name under normalization/app_vocabularies/.",
    placeholder: "Salesforce",
    okLabel: "Save",
  });
  if (!vocabName) return;
  const vocabId = vocabName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const r = await Ipc.bootstrapAppVocab({
    sessionFolder: State.getSession().sessionFolder,
    vocabId, vocabName,
  });
  if (!r || !r.ok) {
    toast("App Library entry build failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  // Parse the bootstrapped vocab. If a vocab with the same id already
  // exists, merge into it (signature-deduped) instead of overwriting --
  // re-running this for an app must never destroy the prior vocab.
  const yaml = require("js-yaml");
  let bootstrapped = null;
  try { bootstrapped = (yaml.load(r.yaml) || {}).app_vocabulary || null; }
  catch (_) { bootstrapped = null; }
  const list = await Ipc.listAppVocabs();
  const existing = ((list && list.vocabs) || []).find((v) => v.id === vocabId);

  if (bootstrapped && existing) {
    const current = await Ipc.readVocab(existing.path);
    if (current && !current._error) {
      const merged = mergeInteractionsIntoVocab(current, bootstrapped.interactions || []);
      const w = await Ipc.writeVocab({ path: existing.path, vocab: merged.vocab });
      if (w && w.ok) {
        await Ipc.revealFile(existing.path);
        toast("Merged into the existing App Library entry — " + merged.added +
          " new interaction(s), " + merged.skipped + " already present.", "success");
      } else {
        toast("Couldn't update the App Library file: " + ((w && w.error) || "unknown"), "error");
      }
      return;
    }
  }

  // No existing vocab for this id -> save as a new file. preferAppVocabDir
  // defaults to the shipped vocab dir so the analyst needn't hunt for it.
  const out = await Ipc.saveAppVocab({
    defaultName: vocabId + ".yaml",
    content: r.yaml,
    preferAppVocabDir: true,
  });
  if (out) {
    await Ipc.revealFile(out);
    toast("App Library starter saved — name each interaction in plain English, then re-analyze any session to apply.", "success");
  }
}

const btnSaveVocab = $("#btn-save-vocab");
if (btnSaveVocab) {
  btnSaveVocab.addEventListener("click", async () => {
    btnSaveVocab.disabled = true;
    await buildVocabFromSession();
    btnSaveVocab.disabled = false;
  });
}

const btnPrepBootstrap = $("#btn-prep-bootstrap");
if (btnPrepBootstrap) {
  btnPrepBootstrap.addEventListener("click", async () => {
    if (!State.getSession()) return;
    const m = State.getSession().manifest || {};
    const friendly = (m.prep_app || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    btnPrepBootstrap.disabled = true;
    await buildVocabFromSession(friendly || null);
    btnPrepBootstrap.disabled = false;
  });
}

/* ============ Step / phase / PDD exports ========================= */

async function exportArtifact(kind, callOpts) {
  if (!State.getSession() && !State.getAggregateSessions().length) return;
  // v0.18.1: callers from the Session view (Export → PDD) can pass
  // { singleSession: true } to force the export to use the current session
  // rather than whatever aggregate sessions are loaded in Compare-Sessions.
  // Without this, opening a session in Session view AFTER having loaded a
  // different set in Compare-Sessions would silently export the wrong target.
  const forceSingle = callOpts && callOpts.singleSession === true;
  const filtered = (!forceSingle && State.getAggregateSessions().length)
    ? filteredAggregateSessions()
    : [State.getSession()].filter(Boolean);
  if (!filtered.length) return;
  const target = filtered[0];

  // Step / Phase BPMN export = the OBSERVED-FLOW map the viewer already shows
  // (process_map_step|phase.bpmn, mined from the annotations by
  // bpmn_observed.py under --mine). The old --step-bpmn-out / --phase-bpmn-out
  // route is the TEMPLATE-derived bpmn_step, which emits an empty Start->End
  // without a --canonical template — so export the session-folder observed
  // file instead (mining it first if it is not there yet).
  if (kind === "step-bpmn" || kind === "phase-bpmn") {
    const level = kind === "step-bpmn" ? "step" : "phase";
    const sourcePath = path.join(target.sessionFolder, "process_map_" + level + ".bpmn");
    if (!fs.existsSync(sourcePath)) {
      const r = await Ipc.runNormalizeExtended({ sessionFolder: target.sessionFolder, mine: true });
      if (!r || !r.ok) { toast("Export failed: " + ((r && r.error) || "unknown"), "error"); return; }
    }
    if (!fs.existsSync(sourcePath)) {
      toast("No " + level + "-level flow to export — analyze a session that has steps first.", "error");
      return;
    }
    const out = await Ipc.exportFile({ sourcePath, suggestedName: "process." + kind + ".bpmn" });
    if (out) {
      await Ipc.revealFile(out);
      toast("Exported: " + path.basename(out), "success");
    }
    return;
  }

  // PDD / step-CSV: normalize writes the artifact straight to a temp path.
  const os = require("os");
  const ext = kind === "pdd" ? "docx" : "csv";
  const tmpPath = path.join(os.tmpdir(), "pdt-export-" + Date.now() + "." + ext);
  const opts = { sessionFolder: target.sessionFolder, mine: false };
  let mapImgPath = null, tobeImgPath = null;
  if (kind === "pdd") {
    opts.pddOut = tmpPath;
    // Embed the currently-rendered Flow (DFG) as the PDD's As-Is process map.
    // cytoscape rasterises cleanly; if no map is on screen we skip it and the
    // PDD falls back to its placeholder.
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
  if (kind === "step-csv") opts.stepCsvOut = tmpPath;
  const r = await Ipc.runNormalizeExtended(opts);
  if (mapImgPath) { try { fs.unlinkSync(mapImgPath); } catch (_) {} }
  if (tobeImgPath) { try { fs.unlinkSync(tobeImgPath); } catch (_) {} }
  if (!r || !r.ok) { toast("Export failed: " + ((r && r.error) || "unknown"), "error"); return; }
  const suggested = "process." + kind + "." + ext;
  const out = await Ipc.exportFile({ sourcePath: tmpPath, suggestedName: suggested });
  if (out) {
    await Ipc.revealFile(out);
    toast("Exported: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").addEventListener("click", () => exportArtifact("step-bpmn"));
if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").addEventListener("click", () => exportArtifact("phase-bpmn"));
if ($("#btn-export-pdd"))        $("#btn-export-pdd").addEventListener("click", () => exportArtifact("pdd"));
if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").addEventListener("click", () => exportArtifact("step-csv"));

/* ============ Aggregate (Compare Sessions) view =================== */

initAggregateView({
  onDrillToSession: async (folder, timestamp) => {
    activateTab("session");
    await loadSessionIntoView(folder);
    if (timestamp) seekToTimestamp(timestamp);
  },
});

/* Re-fit the process map after its panel is drag-resized (layout-controls
   fires pdt:mapresized on drag release). */
document.addEventListener("pdt:mapresized", () => {
  if (PdtBpmn && PdtBpmn.fit) PdtBpmn.fit();
  if (PdtDfg && PdtDfg.fit) PdtDfg.fit();
});

/* ADR-0019: Reference Maps surface — fork / gallery / editor + the PDD image
   bridge. Wired once at boot; reads the live session map via the controller. */
RefmapUI.initRefmapUI({
  getMapState: () => _ensureSessionMapCtrl().getState(),
  renderLiveMap: () => _ensureSessionMapCtrl().render(),
  setMapCell: (level) => _ensureSessionMapCtrl().setState({ notation: "bpmn", level }),
  sourceBpmnPath: (state) => {
    const f = _sessionBpmnFile(state && state.level);
    const sf = State.getSession() && State.getSession().sessionFolder;
    return (f && sf) ? path.join(sf, f) : null;
  },
});

/* ============ Exports ============================================= */

$("#btn-export-bpmn").addEventListener("click", () => exportFirst("process_map.bpmn"));
$("#btn-export-xes").addEventListener("click", () => exportFirst("events.xes"));
$("#btn-export-stats").addEventListener("click", () => exportFirst("stats.json"));

/* Phase F: export the active process-map (BPMN diagram or Flow
   diagram) as an SVG -- the format Figma / Lucidchart / browsers all
   import. Picks the renderer for whichever map tab is showing. */
if ($("#btn-export-map-svg")) {
  $("#btn-export-map-svg").addEventListener("click", async () => {
    const activeTab = document.querySelector(".panel-tab.active[data-map]");
    const which = activeTab ? activeTab.dataset.map : "bpmn";
    let svg = null;
    if (which === "dfg" && PdtDfg && PdtDfg.exportSvg) {
      svg = PdtDfg.exportSvg();
    } else if (PdtBpmn && PdtBpmn.exportSvg) {
      svg = await PdtBpmn.exportSvg();
    }
    if (!svg) {
      toast("No process map to export — analyze sessions first.", "error");
      return;
    }
    const r = await Ipc.saveSvgFile({
      content: svg,
      suggestedName: (which === "dfg" ? "flow-diagram" : "process-diagram") + ".svg",
    });
    if (r && r.ok) toast("Process map exported to " + r.path, "success");
    else if (r && r.error) toast("Export failed: " + r.error, "error");
  });
}

$("#btn-export-md").addEventListener("click", async () => {
  if (!PdtReport) return;
  const filtered = filteredAggregateSessions();
  if (!filtered.length) return;
  /* Re-merge activity stats and cases across the filtered set so the
     report matches what the panels show. */
  const actMap = new Map();
  for (const s of filtered) {
    for (const r of ((s.stats || {}).activity_stats || [])) {
      const e = actMap.get(r.activity_label) || { activity_label: r.activity_label, frequency: 0, total_duration_ms: 0 };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      actMap.set(r.activity_label, e);
    }
  }
  const mergedActivity = [...actMap.values()].sort((a, b) => b.frequency - a.frequency);
  const mergedCases = [];
  for (const s of filtered) {
    for (const r of ((s.stats || {}).case_stats || [])) {
      if (!r.parent_case_id) mergedCases.push(r);
    }
  }
  mergedCases.sort((a, b) => (b.active_ms || 0) - (a.active_ms || 0));
  const edgeMap = new Map();
  for (const s of filtered) {
    for (const e of ((s.dfg || {}).edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
  }
  const dfg = { edges: [...edgeMap.entries()].map(([k, freq]) => {
    const [source, target] = k.split("\x00");
    return { source, target, frequency: freq };
  })};
  const md = PdtReport.buildAggregateReport(filtered, mergedActivity, mergedCases, dfg);
  await saveMarkdownReport(md, "aggregate-report.md");
});

$("#btn-session-md").addEventListener("click", async () => {
  if (!State.getSession() || !PdtReport) return;
  const md = PdtReport.buildSessionReport(State.getSession());
  const name = "session-" + (State.getSession().sessionFolder.split(/[\\/]/).slice(-1)[0] || "report") + ".md";
  await saveMarkdownReport(md, name);
});

/* PDD export from Session view -- new in v0.18.1. The PDD's As-Is process
   map (section 3.3) is rasterised from the currently-rendered Flow diagram;
   to embed THIS session's map (not whatever was last shown on the
   Compare-Sessions tab, or nothing at all), pre-render the Session-view
   Map controller's Flow tab and let cytoscape settle before invoking the
   shared exportArtifact("pdd", { singleSession: true }) path. Leaves the
   user on Map level + Flow tab after the export -- reasonable context for
   "you just exported this." */
if ($("#btn-session-pdd")) {
  $("#btn-session-pdd").addEventListener("click", async () => {
    if (!State.getSession()) { toast("Open a session first.", "error"); return; }
    toast("Preparing PDD — rendering process map…", "info");
    applyLevel("map");
    const ctrl = _ensureSessionMapCtrl();
    ctrl.setState({ notation: "dfg" });
    // Let cytoscape paint + layout settle so PdtDfg.exportPng() captures the
    // rendered diagram and not a blank canvas. 900ms matches the post-tab-
    // switch timing used elsewhere in the controller.
    await new Promise((r) => setTimeout(r, 900));
    await exportArtifact("pdd", { singleSession: true });
  });
}

/* Reduce a suggested filename to a safe basename for a temp-file write: take
   the last path segment and drop leading dots, so a crafted name like
   "..\\..\\evil" cannot escape the temp dir via path.join. */
function safeBasename(name, fallback) {
  const segs = String(name || "").split(/[\\/]+/);
  const base = segs[segs.length - 1].replace(/^\.+/, "");
  return base || (fallback || "export");
}

async function saveMarkdownReport(md, suggestedName) {
  /* Write into a temp file, then ask main.js to copy it via the
     export-file dialog so the user picks the destination. */
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-" + safeBasename(suggestedName, "report.md"));
  fs.writeFileSync(tmpPath, md, "utf-8");
  const out = await Ipc.exportFile({
    sourcePath: tmpPath,
    suggestedName,
  });
  if (out) {
    await Ipc.revealFile(out);
    toast("Markdown report saved: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

/* Phase D: self-contained HTML findings report. A pre-export dialog
   picks which optional sections to include; report-html.js builds the
   document string; viewer:saveHtmlFile writes it (viewer:exportFile
   only copies an existing file -- ADR-0006 Correction 1). */
if ($("#btn-export-findings")) {
  $("#btn-export-findings").addEventListener("click", async () => {
    const session = State.getSession();
    if (!session) { toast("Open a session first.", "error"); return; }
    if (!PdtReportHtml) return;
    const anno = session.annotations || {};
    const notes = anno.notes || [];
    const starred = anno.starred_screenshots || [];
    let mapSvg = null;
    try { if (PdtDfg && PdtDfg.exportSvg) mapSvg = PdtDfg.exportSvg(); } catch (_) {}
    const opts = await checklistModal({
      title: "Export findings report",
      message: "Choose what to include in the HTML report.",
      okLabel: "Generate",
      items: [
        { key: "map", label: "Process map", checked: !!mapSvg,
          disabled: !mapSvg, hint: mapSvg ? "" : "no process map rendered" },
        { key: "analysis", label: "Waste & automation findings",
          checked: !!session.analysis, disabled: !session.analysis,
          hint: session.analysis ? "" : "session not analyzed" },
        { key: "notes", label: "Notes", checked: notes.length > 0,
          disabled: notes.length === 0, hint: notes.length ? "" : "no notes" },
        { key: "screenshots", label: "Starred screenshots",
          checked: starred.length > 0, disabled: starred.length === 0,
          hint: starred.length ? starred.length + " starred"
            : "none starred — star them in the Screenshots panel" },
      ],
    });
    if (!opts) return;
    const screenshotData = {};
    if (opts.screenshots) {
      for (const rel of starred) {
        try {
          const full = path.join(session.sessionFolder, rel);
          if (fs.existsSync(full)) {
            screenshotData[rel] = "data:image/jpeg;base64," +
              fs.readFileSync(full).toString("base64");
          }
        } catch (_) {}
      }
    }
    const proj = PdtProject.activeProject();
    const html = PdtReportHtml.generateFindingsReport(session, {
      includeProcessMap: !!opts.map,
      includeAnalysis: !!opts.analysis,
      includeNotes: !!opts.notes,
      includeScreenshots: !!opts.screenshots,
      processMapSvg: opts.map ? mapSvg : null,
      screenshotData,
      projectFindings: (proj && proj.findings) || "",
    });
    const folder = (session.sessionFolder || "").split(/[\\/]/).slice(-1)[0] || "session";
    const r = await Ipc.saveHtmlFile({ content: html,
      suggestedName: "findings-" + folder + ".html" });
    if (r && r.ok) {
      await Ipc.revealFile(r.path);
      toast("Findings report saved: " + path.basename(r.path), "success");
    } else if (r && r.error) {
      toast("Export failed: " + r.error, "error");
    }
  });
}

$("#btn-export-promotions").addEventListener("click", async () => {
  /* Taxonomy promotion (§13). Walk normalized sessions for events
     classified as "Unclassified - <app>". Emit a YAML stub with one
     rule per unique app, ready for the analyst to refine and append
     to the central taxonomy. */
  const filtered = filteredAggregateSessions();
  const apps = new Map(); // app -> { firstTitle, count }
  for (const sess of filtered) {
    for (const ev of (sess.events || [])) {
      if (ev.type !== "activity") continue;
      const label = ev.data.activity_label || "";
      if (!/^Unclassified/.test(label)) continue;
      const app = ev.data.app || "unknown";
      const entry = apps.get(app) || { firstTitle: ev.data.title || "", count: 0 };
      entry.count += 1;
      apps.set(app, entry);
    }
  }
  /* Also include unclassified activity_stats entries (which may be the
     only signal if events aren't loaded for older sessions). */
  for (const sess of filtered) {
    for (const r of (((sess.stats || {}).activity_stats) || [])) {
      if (!/^Unclassified/.test(r.activity_label || "")) continue;
      const app = (r.activity_label.split("-").pop() || "").trim();
      if (!apps.has(app)) apps.set(app, { firstTitle: "", count: r.frequency || 0 });
    }
  }
  if (!apps.size) {
    toast("No Unclassified activities found in the loaded sessions", "");
    return;
  }
  const sorted = [...apps.entries()].sort((a, b) => b[1].count - a[1].count);
  const lines = [
    "# Taxonomy promotion candidates",
    "# Generated by Process Discovery Viewer on " + new Date().toISOString(),
    "# Each `label` below is prefixed with [REVIEW] — replace the bracketed prefix",
    "# with the final activity name before appending to the central taxonomy YAML.",
    "# Refine `title_regex` for stricter matching and add `extract` rules where useful.",
    "",
    "rules:",
  ];
  for (const [app, info] of sorted) {
    lines.push("  - match:");
    lines.push("      app: \"" + app.replace(/"/g, "\\\"") + "\"");
    lines.push("      title_regex: \".*\"");
    lines.push("    label: \"[REVIEW] " + app.replace(/"/g, "\\\"") + "\"  # " + info.count + " unclassified events" +
      (info.firstTitle ? "; sample title: " + JSON.stringify(info.firstTitle.slice(0, 60)) : ""));
  }
  const yaml = lines.join("\n") + "\n";
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-taxonomy-promotions.yaml");
  fs.writeFileSync(tmpPath, yaml, "utf-8");
  const out = await Ipc.exportFile({
    sourcePath: tmpPath,
    suggestedName: "taxonomy-promotions.yaml",
  });
  if (out) {
    await Ipc.revealFile(out);
    toast(`Promoted ${sorted.length} app(s) as taxonomy candidates`, "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
});

async function exportFirst(filename) {
  const s = State.getAggregateSessions().find((x) =>
    fs.existsSync(path.join(x.sessionFolder, filename)));
  if (!s) return;
  const src = path.join(s.sessionFolder, filename);
  const out = await Ipc.exportFile({
    sourcePath: src,
    suggestedName: filename,
  });
  if (out) {
    await Ipc.revealFile(out);
    toast("Exported: " + path.basename(out), "success");
  }
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
  // Flow view: S adds/splits a step at the video playhead.
  if (State.getLevel() === "flow" && State.getSession()
      && e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    addStepAtPlayhead();
    e.preventDefault();
    return;
  }
  if (e.key === "1") activateTab("session");
  else if (e.key === "2") activateTab("aggregate");
  else if (e.key === "3") activateTab("canonical");
  else if (e.key === "4") activateTab("vocabularies");
  // Step editor shortcuts (only when on session view and steps panel)
  else if (State.getLevel() === "steps" && State.getSession()) {
    const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
    if (e.key === "j" || e.key === "ArrowDown") {
      const idx = steps.findIndex(s => s.step_id === State.getSelectedStepId());
      if (idx < steps.length - 1) { State.setSelectedStepId(steps[Math.max(0, idx + 1)].step_id); renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "k" || e.key === "ArrowUp") {
      const idx = steps.findIndex(s => s.step_id === State.getSelectedStepId());
      if (idx > 0) { State.setSelectedStepId(steps[idx - 1].step_id); renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "n") {
      addManualStep(); e.preventDefault();
    } else if (e.key === "s") {
      if (State.getSelectedStepId()) { splitStep(State.getSelectedStepId()); e.preventDefault(); }
    } else if (e.key === "m") {
      // P0.1: with a 2+ multi-selection, M merges that selection; otherwise it
      // merges the selected step with the next one. No hidden "wrong pair".
      if (State.getMultiSelectedStepIds().size >= 2) { mergeSelectedSteps(); e.preventDefault(); }
      else if (State.getSelectedStepId()) { mergeStepWithNext(State.getSelectedStepId()); e.preventDefault(); }
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
/* Inline "What is a step?" / "What is a phase?" links in the toolbar
   open the help modal at the right section. */
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
/* A global transport mirroring the #video element. Visible only on the
   Session tab with a recording loaded; the .hidden class collapses it
   otherwise. Space / arrow shortcuts are handled in the keydown block
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
  function onSessionTab() {
    const t = document.querySelector(".tab.active");
    return !!t && t.dataset.view === "session";
  }
  function refresh() {
    bar.classList.toggle("hidden", !onSessionTab() || !hasVideo());
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
  document.addEventListener("pdt:tabchange", refresh);
  refresh();
})();

/* ============ Boot ================================================ */

renderRecent();
$("#topbar-meta").textContent = "v" + require("./package.json").version + " · " + new Date().toLocaleDateString();

/* If launched with --session=<path>, the main process pushes the path
   via this channel. Open it without any further user click. */
Ipc.onOpenInitialSession((folder) => {
  if (folder) loadSessionIntoView(folder);
});

/* ============ Vocabularies tab -- see views/vocab-view.js ========= */

initVocabView();

/* I72: the topbar command-palette hint opens the palette (also Ctrl+K). */
const _cmdkHint = document.getElementById("btn-cmdk-hint");
if (_cmdkHint && PdtPalette) _cmdkHint.addEventListener("click", () => PdtPalette.toggle());

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

/* ============ Project / engagement wiring (P2.1) ==================
   A project bundles aggregate sessions, the current focus session, the
   active process template, view mode, case scope, and (forward-
   compatible) vocabularies into a single re-loadable file. The data
   layer lives in viewer/project.js; this block snapshots / restores
   the live state and wires the topbar UI. */

const PdtProject = require("./project.js");

const projectCollectors = {
  currentSessionFolder: () => State.getSession() && State.getSession().sessionFolder,
  aggregateSessions:    () => (State.getAggregateSessions() || []).map((s) => s && s.sessionFolder).filter(Boolean),
  templatePath:         () => State.getCanonicalState() && State.getCanonicalState().path,
  vocabularies:         () => [],   // captured by path on a future project-format bump
  currentTab:           () => {
    const t = document.querySelector(".tab.active");
    return t ? t.dataset.view : "session";
  },
  viewMode:             () => State.getLevel(),
  currentCaseScope:     () => State.getCaseScope() || null,
  timeline: () => {
    const scroll = document.getElementById("timeline-scroll");
    return {
      zoomFactor: State.getZoomFactor(),
      scrollLeft: scroll ? scroll.scrollLeft : 0,
    };
  },
};

function updateProjectMenuLabel() {
  const lbl = document.getElementById("project-menu-label");
  const btn = document.getElementById("btn-project-menu");
  const saveItem = document.getElementById("btn-project-save");
  const notesItem = document.getElementById("btn-project-notes");
  const tmplItem = document.getElementById("btn-set-session-template");
  const closeItem = document.getElementById("btn-project-close");
  const proj = PdtProject.activeProject();
  if (proj && proj.path) {
    if (lbl) lbl.textContent = proj.name || path.basename(proj.path, ".pdt-project.json");
    if (btn) btn.classList.add("has-project");
    if (saveItem) saveItem.style.display = "";
    if (notesItem) notesItem.style.display = "";
    if (tmplItem) tmplItem.style.display = "";
    if (closeItem) closeItem.style.display = "";
  } else {
    if (lbl) lbl.textContent = "No project";
    if (btn) btn.classList.remove("has-project");
    if (saveItem) saveItem.style.display = "none";
    if (notesItem) notesItem.style.display = "none";
    if (tmplItem) tmplItem.style.display = "none";
    if (closeItem) closeItem.style.display = "none";
  }
}

document.addEventListener("pdt:projectChanged", updateProjectMenuLabel);

function toggleProjectMenu(force) {
  const popup = document.getElementById("project-menu-popup");
  if (!popup) return;
  const open = force === undefined ? popup.style.display === "none" : !!force;
  popup.style.display = open ? "" : "none";
}

(function wireProjectMenu() {
  const btn = document.getElementById("btn-project-menu");
  const popup = document.getElementById("project-menu-popup");
  if (!btn || !popup) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProjectMenu();
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggleProjectMenu(false);
  });
})();

/* ===== Recent dropdown (top-bar) =====
   Recent sessions + projects were only reachable from the Session
   empty-state, which disappears once a session loads. This top-bar
   menu makes them reachable any time. */
function renderRecentMenu() {
  const host = document.getElementById("recent-menu-content");
  if (!host) return;
  let html = "";
  // Recent projects.
  const projects = (typeof PdtProject !== "undefined") ? PdtProject.getRecentProjects() : [];
  if (projects.length) {
    html += '<div class="recent-menu-heading">Recent projects</div>';
    html += projects.map((p) => {
      let missing = false;
      try { missing = !fs.existsSync(p.path); } catch (_) { missing = true; }
      return '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="project" data-path="' + escapeHtml(p.path) + '">' +
        '<span class="ri-label">' + escapeHtml(p.name || path.basename(p.path)) + '</span>' +
        '<span class="ri-tag">' + (missing ? "missing" : "project") + '</span>' +
        '</button>';
    }).join("");
  }
  // Recent sessions + bundled examples.
  const recents = getRecent();
  const hidden = getHiddenExamples();
  const examples = listBundledExamples().filter((e) => !hidden.has(e.folder));
  const sessions = recents.concat(examples);
  if (sessions.length) {
    html += '<div class="recent-menu-heading">Recent sessions</div>';
    html += sessions.map((r) => {
      let missing = false;
      try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
      const label = r.label || path.basename(r.folder);
      return '<button class="recent-menu-item' + (missing ? " missing" : "") + '" ' +
        'data-kind="session" data-folder="' + escapeHtml(r.folder) + '">' +
        '<span class="ri-label">' + escapeHtml(label) + '</span>' +
        '<span class="ri-tag">' + (missing ? "missing" : (r.example ? "example" : "session")) + '</span>' +
        '</button>';
    }).join("");
  }
  if (!html) {
    html = '<div class="recent-menu-empty">No recent sessions or projects yet.</div>';
  }
  host.innerHTML = html;
  host.querySelectorAll(".recent-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      toggleRecentMenu(false);
      if (item.dataset.kind === "project") {
        projectOpenByPath(item.dataset.path);
      } else {
        activateTab("session");
        loadSessionIntoView(item.dataset.folder);
      }
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
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) toggleRecentMenu(false);
  });
})();

/* Generic dropdown menu (button + popup) -- used by the Export menus on
   the Session and Compare Sessions tabs. Mirrors wireProjectMenu: the
   button toggles the popup, an outside click closes it, and clicking
   any enabled menu item closes it after the item's own handler runs. */
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
wireDropdownMenu("btn-agg-export-menu", "agg-export-popup");

async function projectSaveAs() {
  toggleProjectMenu(false);
  const name = await promptModal({
    title: "Save project as",
    message: "Project name",
    detail: "Saves the current aggregate session set, focus session, template, view mode, and case scope into a single .pdt-project.json file you can re-open later.",
    placeholder: "e.g. ENG-2026-001 onboarding review",
    initial: (PdtProject.activeProject() && PdtProject.activeProject().name) || "Untitled project",
  });
  if (!name) return;
  const project = PdtProject.captureFromCollectors(projectCollectors, { name });
  const r = await Ipc.saveProjectAs({ project, suggestedName: name.replace(/[^A-Za-z0-9._-]+/g, "-") });
  if (!r) return;
  if (!r.ok) { toast("Save failed: " + (r.error || "unknown"), "error"); return; }
  PdtProject.setActiveProject({ path: r.path, name, ...project });
  PdtProject.pushRecentProject(r.path, name);
  renderRecentProjects();
  toast("Project saved", "success");
}

async function projectSave() {
  toggleProjectMenu(false);
  const active = PdtProject.activeProject();
  if (!active || !active.path) return projectSaveAs();
  const project = PdtProject.captureFromCollectors(projectCollectors, { name: active.name });
  const r = await Ipc.saveProject({ project, path: active.path });
  if (!r || !r.ok) { toast("Save failed: " + ((r && r.error) || "unknown"), "error"); return; }
  PdtProject.setActiveProject({ path: r.path, name: active.name, ...project });
  PdtProject.pushRecentProject(r.path, active.name);
  renderRecentProjects();
  toast("Project saved", "success");
}

async function projectOpen() {
  toggleProjectMenu(false);
  const r = await Ipc.openProject();
  if (!r) return;
  if (!r.ok) { toast("Couldn't open project: " + (r.error || "unknown"), "error"); return; }
  await applyProject(r.path, r.project);
}

async function projectOpenByPath(filePath) {
  const r = await Ipc.loadProjectFile(filePath);
  if (!r) return;
  if (!r.ok) { toast("Couldn't open project: " + (r.error || "unknown"), "error"); return; }
  await applyProject(r.path, r.project);
}

async function applyProject(filePath, raw) {
  const v = PdtProject.validateProject(raw);
  if (!v.ok) { toast("Project file invalid: " + v.error, "error"); return; }
  const project = v.project;
  PdtProject.setActiveProject({ path: filePath, ...project });
  PdtProject.pushRecentProject(filePath, project.name);
  renderRecentProjects();

  // Aggregate sessions
  if (project.aggregateSessions && project.aggregateSessions.length) {
    try {
      const sessions = await Ipc.loadMultipleSessions(project.aggregateSessions);
      State.setAggregateSessions((sessions || []).filter((s) => s && !s.error));
      const aggEmpty = $("#aggregate-empty");
      const aggLoaded = $("#aggregate-loaded");
      if (aggEmpty) aggEmpty.style.display = State.getAggregateSessions().length ? "none" : "";
      if (aggLoaded) aggLoaded.style.display = State.getAggregateSessions().length ? "" : "none";
      const btnNorm = $("#btn-normalize-all");
      if (btnNorm) btnNorm.disabled = !State.getAggregateSessions().length;
      if (typeof renderAggregate === "function" && State.getAggregateSessions().length) renderAggregate();
    } catch (e) {
      toast("Failed to load aggregate sessions: " + (e.message || e), "error");
    }
  }

  // Focus session
  if (project.currentSessionFolder) {
    try { await loadSessionIntoView(project.currentSessionFolder); }
    catch (e) { toast("Couldn't load focus session: " + (e.message || e), "error"); }
  }

  // Process template
  if (project.templatePath) {
    try {
      if (fs.existsSync(project.templatePath)) {
        State.getCanonicalState().path = project.templatePath;
        State.getCanonicalState().content = fs.readFileSync(project.templatePath, "utf-8");
        const yamlEl = document.getElementById("canonical-yaml");
        if (yamlEl) yamlEl.value = State.getCanonicalState().content;
        const metaEl = document.getElementById("canonical-meta");
        if (metaEl) metaEl.textContent = "Loaded " + project.templatePath;
        const saveBtn = document.getElementById("btn-save-canonical");
        if (saveBtn) saveBtn.disabled = false;
        const closeBtn = document.getElementById("btn-close-canonical");
        if (closeBtn) closeBtn.disabled = false;
        const deleteBtn = document.getElementById("btn-delete-canonical");
        if (deleteBtn) deleteBtn.disabled = false;
        if (typeof renderCanonicalStepList === "function") renderCanonicalStepList();
      }
    } catch (_) { /* template missing or unreadable; project still usable */ }
  }

  // View mode (Flow / Steps / Phases)
  if (project.viewMode && project.viewMode !== State.getLevel()) {
    const vmBtn = document.querySelector('.view-mode-btn[data-level="' + project.viewMode + '"]');
    if (vmBtn) vmBtn.click();
  }

  // Case scope
  if (project.currentCaseScope) {
    State.setCaseScope(project.currentCaseScope);
    const sel = document.getElementById("case-scope-select");
    if (sel) {
      sel.value = State.getCaseScope();
      sel.dispatchEvent(new Event("change"));
    }
  }

  // Tab last so any tab-specific re-render (e.g. aggregate fit) runs.
  if (project.currentTab) activateTab(project.currentTab);

  toast("Project loaded: " + (project.name || path.basename(filePath)), "success");
}

function projectClose() {
  toggleProjectMenu(false);
  PdtProject.setActiveProject(null);
  toast("Project closed (sessions stay loaded)");
}

/* F1: auto-save the active project ~5s after a project-state change
   (a tab or view-mode switch). Only a named project auto-saves -- an
   unsaved capture has no file to write to. Best-effort: a failure is
   swallowed; the interactive Save still works. */
let _autoSaveTimer = null;
function scheduleAutoSave() {
  const active = PdtProject.activeProject();
  if (!active || !active.path) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(autoSaveProject, 5000);
}
async function autoSaveProject() {
  const active = PdtProject.activeProject();
  if (!active || !active.path) return;
  const project = PdtProject.captureFromCollectors(projectCollectors, { name: active.name });
  try {
    const r = await Ipc.saveProject({ project, path: active.path });
    if (r && r.ok) {
      PdtProject.setActiveProject({ path: r.path, name: active.name, ...project });
    }
  } catch (_) { /* best-effort -- interactive Save still works */ }
}
document.addEventListener("pdt:tabchange", scheduleAutoSave);

/* F4: project-level notes. A textarea modal off the Project menu; the
   text is stored on the project file (`findings`) and included in the
   findings report when one is generated with a project open. */
async function projectNotes() {
  toggleProjectMenu(false);
  const active = PdtProject.activeProject();
  if (!active || !active.path) {
    toast("Open or save a project first.", "error");
    return;
  }
  const text = await promptModal({
    title: "Project notes",
    message: "Findings and notes for this project.",
    detail: "Saved on the project file; included in the findings report.",
    multiline: true,
    okLabel: "Save",
    defaultValue: active.findings || "",
  });
  if (text == null) return;
  PdtProject.setActiveProject(Object.assign({}, PdtProject.activeProject(), { findings: text }));
  await projectSave();
}

/* F5 setter: record the loaded session as the project's step template
   so a step-less session later opened under the project is offered its
   step structure. Mirrors projectNotes(). */
async function setSessionAsTemplate() {
  toggleProjectMenu(false);
  const active = PdtProject.activeProject();
  if (!active || !active.path) {
    toast("Open or save a project first.", "error");
    return;
  }
  const session = State.getSession();
  const folder = session && session.sessionFolder;
  if (!folder) {
    toast("Open a session first.", "error");
    return;
  }
  PdtProject.setActiveProject(Object.assign({}, active, { step_template_session: folder }));
  await projectSave();
}

(function wireProjectMenuItems() {
  const open = document.getElementById("btn-project-open");
  const saveAs = document.getElementById("btn-project-save-as");
  const save = document.getElementById("btn-project-save");
  const close = document.getElementById("btn-project-close");
  const notes = document.getElementById("btn-project-notes");
  const tmpl = document.getElementById("btn-set-session-template");
  if (open)   open.addEventListener("click", projectOpen);
  if (saveAs) saveAs.addEventListener("click", projectSaveAs);
  if (save)   save.addEventListener("click", projectSave);
  if (notes)  notes.addEventListener("click", projectNotes);
  if (tmpl)   tmpl.addEventListener("click", setSessionAsTemplate);
  if (close)  close.addEventListener("click", projectClose);
})();

function renderRecentProjects() {
  const block = document.getElementById("recent-projects-block");
  const list = document.getElementById("recent-list-projects");
  if (!block || !list) return;
  const recents = PdtProject.getRecentProjects();
  if (!recents.length) { block.style.display = "none"; return; }
  block.style.display = "";
  list.innerHTML = recents.map((r) => {
    let missing = false;
    try { missing = !fs.existsSync(r.path); } catch (_) { missing = true; }
    const name = escapeHtml(r.name || path.basename(r.path, ".pdt-project.json"));
    const missingTag = missing ? '<span class="recent-missing-tag">missing</span>' : "";
    const cls = missing ? "missing" : "";
    return '<li data-project-path="' + escapeHtml(r.path) + '" class="' + cls + '" title="' + escapeHtml(r.path) + '">' +
      '<span class="label">' + name + missingTag + '</span>' +
      '<span class="when">' + (r.ts ? relTime(r.ts) : "") + '</span>' +
      '<button class="recent-remove" type="button" title="Remove from Recent projects">×</button>' +
    '</li>';
  }).join("");
  list.querySelectorAll("li[data-project-path]").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".recent-remove")) return;
      projectOpenByPath(li.dataset.projectPath);
    });
  });
  list.querySelectorAll(".recent-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      PdtProject.removeRecentProject(btn.closest("li").dataset.projectPath);
      renderRecentProjects();
    });
  });
}

(function wireRecentProjectsClear() {
  const btn = document.getElementById("recent-projects-clear");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!PdtProject.getRecentProjects().length) return;
    const ok = await confirmModal({
      title: "Clear Recent projects?",
      message: "Remove all entries from Recent projects?",
      detail: "Project files on disk are not touched; only the localStorage list is cleared.",
      okLabel: "Clear",
      danger: true,
    });
    if (ok) {
      PdtProject.clearRecentProjects();
      renderRecentProjects();
    }
  });
})();

// Initial render
updateProjectMenuLabel();
renderRecentProjects();
