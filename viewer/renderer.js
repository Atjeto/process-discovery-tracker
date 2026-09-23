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
const PdtBpmn = require("./bpmn-viewer.js");
const PdtSteps = require("./step-editor.js");
require("./layout-controls.js"); // side-effect import: self-wires resize handles + video modes

const { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast } = require("./dom.js");
const { promptModal } = require("./modals.js");
const { initRecent, getRecent, getHiddenExamples, listBundledExamples, pushRecent, renderRecent } = require("./recent.js");
const { initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep, deleteSelectedSteps, splitStep, mergeStepWithNext, mergeSelectedSteps, addStepAtTimestamp, reorderSelectedStep } = require("./views/steps-view.js");
const { initSession, resetUndoStack, canUndo, canRedo, saveAnnotationsWithUndo, performUndo, performRedo, ensureAnnoShape, persistAnnotations } = require("./session.js");
const { initFlowView, loadSessionIntoView, renderTimeline, renderMarkersList, renderAnnotations, renderSessionPills, seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow, watchStep, addStepAtPlayhead } = require("./views/flow-view.js");
const { renderOverviewLevel, openMarkersInFlow, NO_RUNS_MARKED, MARK_RUNS_INSTRUCTION, MARK_RUNS_BUTTON } = require("./views/overview-view.js");
const { createMapController } = require("./map-controller.js");
const { buildAnnotationDfg, processLabel } = require("./process-map-levels.js");
const RefmapUI = require("./refmap-ui.js");
const { pddExportOutcome } = require("./normalize-result.js");

/* ============ Flow view -- see views/flow-view.js ================= */

/* Cross-surface glue that stays in this entry is injected into the
   Flow module as lazy wrappers so hoisting / load order does not
   matter (renderShortcutsOverlay etc. are declared further down). */
initFlowView({
  renderShortcutsOverlay: () => renderShortcutsOverlay(),
  rerenderActiveLevel:    () => rerenderActiveLevel(),
  addStepAtTimestamp:     (ts) => addStepAtTimestamp(ts),
});

/* ============ Session / undo layer -- see session.js ============== */

initSession({
  renderAnnotations: () => renderAnnotations(),
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
// Item 19: Overview is the default level on boot (State.getLevel() ===
// "overview" before any session loads) -- set the playhead-button visibility
// once up front so it isn't visible-by-HTML-default until the first level
// switch fires applyLevel().
(() => {
  const playheadBtn = document.getElementById("btn-scope-to-playhead");
  if (playheadBtn) playheadBtn.style.display = (State.getLevel() === "overview") ? "none" : "";
})();

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
  overview: "Overview: what the capture measured (facts), the case-quality gate, the findings feed, and the PDD export.",
  flow:   "Flow view: video, raw event timeline, and side panel for notes / screenshots / markers.",
  steps:  "Steps view: rename, split, merge, or flag the logical actions captured, or use the Detail slider to roll them up by screen / app / phase / case.",
  map:    "Map view: the Process diagram (BPMN) or Flow diagram for this session, at the chosen detail level (element … case) or by app category.",
};

/* P2.3: viewport state transfer on mode switch. Each mode owns its own
   scroll container (the Flow timeline, the Steps mini-timeline). When
   the analyst flips views we snapshot the outgoing mode's zoom + scroll
   fraction and apply them to the incoming mode -- "stayed at the same
   zoom + position" feel without forcing the modes to share a single DOM
   scroll container. */
/* P2.3 viewport transfer: each mode owns its own scroll container and
   zoom variable. MODE_VIEWPORT pairs them so snapshot/apply is one
   code path instead of copy-pasted `if (mode === ...)` arms.
   (Zoom still reads/writes the renderer-local vars; they move into the
   state module in a later step.) */
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
  steps: {
    scrollSel: "#session-layout-steps .mini-timeline-scroll",
    getZoom: State.getStepZoom, setZoom: State.setStepZoom,
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

/* The Session view's "Map" level renders the interactive process-map UI,
   bound to a single-session data source via map-controller.js. Lazily
   created on first render so its querySelector
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
   is scoped to when a step node is drilled. */
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
  const mineHint = ' (Map files are produced by Analyze with "Build process map" checked, under ⋯ More.)';
  if (notation === "bpmn") {
    const file = _sessionBpmnFile(level);
    // ADR-0024: the screen/app/case notches have no pre-mined Process diagram —
    // guide to the Flow diagram rather than render a dead/empty BPMN host.
    if (!file) {
      return {
        emptyMessage: 'The Process diagram (BPMN) is built at the Element and Phase detail levels. ' +
          'For the ' + level + ' level, switch to the Flow diagram tab above: it regroups live.',
      };
    }
    // §B2 honesty gate: the step-grain observed BPMN draws CASE flow (one
    // trace per case), so it is Tier-2 — it renders only when
    // case_quality.tier2_unlocked. Below the gate the section is REPLACED
    // by the one-line state + the mark-runs call to action (the §1 replace
    // pattern), never rendered with fact-level authority.
    if (level === "step" || level === "element") {
      const cq = (sess.analysis || {}).case_quality;
      if (!cq || !cq.tier2_unlocked) {
        return { emptyMessage: _stepBpmnLockedMessage(cq) };
      }
    }
    const bpmnPath = sess.sessionFolder ? path.join(sess.sessionFolder, file) : null;
    if (!bpmnPath || !fs.existsSync(bpmnPath)) {
      return {
        emptyMessage: level === "activity"
          ? 'No process map BPMN yet: click "Analyze session".' + mineHint
          : 'No ' + level + '-level Process diagram yet: Analyze a session that has ' +
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
        emptyMessage: 'No category-level Flow diagram yet. It needs app category rules for the apps in this session. The detail levels (element … case) build their flow from your annotations and need no categories.',
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
    // §B2: the default map is TIME-weighted — edge thickness/labels carry
    // accumulated transition time; the traversal count stays in the tooltip.
    edgeWeight: "time",
    emptyMessage: 'Nothing to draw at the ' + level + ' level yet: add steps to this ' +
      'session in the Steps view (the map groups them at the chosen detail level).',
  };
}

/* §B2 + AD-14: the replace-pattern lock message for the step-grain Process
   diagram. One honest line on WHY it is withheld, then the same mark-runs
   instruction and button the Overview shows (overview-view.js owns the
   sentence and the verb). HTML: the button is handled by the delegated
   listener installed on the BPMN host in _ensureSessionMapCtrl (innerHTML
   rewrites keep delegation alive). */
function _stepBpmnLockedMessage(cq) {
  const lead = "The step-level Process diagram is not shown because it draws how cases flow. ";
  if (!cq) return lead + "This session has not been analyzed yet, so run Analyze once.";
  const why = cq.mode === "unsegmented"
    ? NO_RUNS_MARKED
    : ((cq.case_count || 0) < 2
        ? "Only one case was identified, and case comparisons need at least 2."
        : "The identified cases cover only " + Math.round((cq.coverage || 0) * 100) +
          "% of the recording, below the 70% needed to trust them.");
  return escapeHtml(lead + why + " " + MARK_RUNS_INSTRUCTION) +
    ' <button type="button" class="link-btn" data-map-cta="mark-runs">' +
    escapeHtml(MARK_RUNS_BUTTON) + "</button>";
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
  // ADR-0028 §3: a work item's analyst name flows down to its member fragments
  // on the map's screen level (the same seam the Steps roll-up + timeline use).
  const groupName = require("./work-items.js")
    .groupNameResolver((sess.annotations && sess.annotations.group_annotations) || []);
  return { caseLabel, interactionsById, groupName };
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

// BPMN node-count (mirror of flow-view.countBpmnNodes; inlined to avoid the
// renderer<->flow-view load cycle).
const _BPMN_NODE_RE = /<(?:[\w-]+:)?(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|callActivity|subProcess|startEvent|endEvent|intermediateThrowEvent|intermediateCatchEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)\b/g;

/* Keep the "N nodes · Open · Reveal" status line honest: it describes the file
   ACTUALLY on screen (the controller's currently rendered BPMN), not always the
   activity-level process_map.bpmn. Hidden on the Flow diagram and on the coarse
   grains (screen/app/case), which have no file on disk. Driven by the map
   controller's onRender so it can never drift from what's displayed. */
function _syncMapStatus({ notation, level, bpmnPath } = {}) {
  const wrap = document.getElementById("process-map-status");
  if (!wrap) return;
  const detail = document.getElementById("process-map-detail");
  // The per-case picker is retired: it only re-pointed Open/Reveal, never
  // re-rendered the map, and confused the status line. Keep it hidden.
  const caseSel = document.getElementById("process-map-case-select");
  if (caseSel) caseSel.style.display = "none";
  if (notation !== "bpmn" || !bpmnPath) {
    wrap.style.display = "none";    // a live DFG / coarse grain has no file
    return;
  }
  let n = 0;
  try { n = (fs.readFileSync(bpmnPath, "utf8").match(_BPMN_NODE_RE) || []).length; } catch (_) {}
  if (detail) detail.textContent = n + (n === 1 ? " node" : " nodes");
  wrap.dataset.bpmnPath = bpmnPath;   // Open/Reveal now target the displayed file
  wrap.style.display = "";
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
    onRender: _syncMapStatus,   // keep the "N nodes / Open / Reveal" line tied to the displayed file
    // ADR-0024: the Map opens at the shared grain notch (default "screen"). That
    // notch has no pre-mined BPMN, so default to the Flow diagram, which rolls
    // up live — the Process diagram (Element/Phase) stays one tab away.
    initialNotation: "dfg",
    initialLevel: State.getGrain(),
  });
  // §B2 + AD-14: the lock-state CTA inside the BPMN host ("Mark runs in
  // Flow", the same verb as the Overview's button). Delegated once, so
  // innerHTML rewrites keep it alive.
  const bpmnHost = document.getElementById("session-map-bpmn-host");
  if (bpmnHost) {
    bpmnHost.addEventListener("click", (e) => {
      if (e.target.closest('[data-map-cta="mark-runs"]')) openMarkersInFlow();
    });
  }
  _wireMapExpertDrawer();
  return _sessionMapCtrl;
}

/* §B2: the Expert drawer — the off-contract cells removed from the default
   notation×level matrix (lab-phase §1 cargo-cult cuts): the activity-taxonomy
   level (both notations; the BPMN there IS the inductive-miner output) and
   the per-case BPMN files. The files + CLI flags are untouched; the drawer
   is the explicit, labelled way back in. */
function _wireMapExpertDrawer() {
  const dfgBtn = document.getElementById("btn-expert-activity-dfg");
  const bpmnBtn = document.getElementById("btn-expert-activity-bpmn");
  const perCase = document.getElementById("btn-expert-percase");
  if (dfgBtn) dfgBtn.addEventListener("click", () => {
    _ensureSessionMapCtrl().setState({ notation: "dfg", level: "activity" });
  });
  if (bpmnBtn) bpmnBtn.addEventListener("click", () => {
    _ensureSessionMapCtrl().setState({ notation: "bpmn", level: "activity" });
  });
  if (perCase) perCase.addEventListener("click", async () => {
    const sess = State.getSession();
    const dir = sess && sess.sessionFolder
      ? path.join(sess.sessionFolder, "process_maps") : null;
    if (dir && fs.existsSync(dir)) await Ipc.revealFile(dir);
    else toast("No per-case BPMNs on disk yet: Analyze with \"Build process map\" checked (needs 2+ cases).", "error");
  });

  // NAV-AUDIT §E2/§7a: keep the drawer LOCAL — opening it must grow the page
  // downward, not steal the map's height. The map host is a flex child that
  // otherwise gives up its grow-share to the opening drawer (546→499px). The
  // flex cascade can't be fixed by min-height here (an ancestor pins
  // min-height:0), so freeze the host at its CLOSED height and release it on
  // close. The height must be captured BEFORE the drawer expands (the `toggle`
  // event fires too late — the host has already reflowed), so snapshot it on the
  // summary's click in the capture phase; the `toggle` handler then applies the
  // freeze on open and clears it on close. The frozen host + drawer content
  // overflow the panel, so the Session view (overflow:auto) scrolls and the
  // drawer's own summary stays put under the cursor.
  const drawer = document.getElementById("map-expert-drawer");
  const mapHost = document.querySelector("#session-layout-map .map-host");
  if (drawer && mapHost) {
    let _closedHostH = 0;
    const snap = () => {
      if (!drawer.open) _closedHostH = Math.round(mapHost.getBoundingClientRect().height);
    };
    const summary = drawer.querySelector("summary");
    if (summary) summary.addEventListener("click", snap, true);
    drawer.addEventListener("toggle", () => {
      if (drawer.open) {
        const h = _closedHostH || Math.round(mapHost.getBoundingClientRect().height);
        if (h > 0) { mapHost.style.height = h + "px"; mapHost.style.flex = "0 0 auto"; }
      } else {
        mapHost.style.height = "";
        mapHost.style.flex = "";
        try { _sessionMapCtrl && _sessionMapCtrl.refit(); } catch (_) {}
      }
    });
  }
}

function renderMapLevel() {
  // Cheap to call when the Map level isn't visible: the controller's tabs and
  // hosts are hidden anyway. We early-return mainly to skip BPMN's async render
  // when nothing's on screen.
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
// Lab-phase §A5 + R4: the Overview renders the analysis-backed badge / facts /
// findings AND (R4) the Evidence modules retired from the Analysis level -- so
// it follows markers, analysis, steps, and grain (the time-goes itemisation
// notch).
State.subscribe("markers",  renderOverviewLevel);
State.subscribe("analysis", renderOverviewLevel);
State.subscribe("steps",    renderOverviewLevel);
State.subscribe("steps",    renderMapLevel);
// ADR-0024: a grain change re-renders the Steps list and the Flow timeline to
// the new notch (the Map is moved by mapCtrl.setLevel, so it isn't subscribed
// here to avoid a double render).
State.subscribe("grain",    renderStepsLevel);
State.subscribe("grain",    renderTimeline);
State.subscribe("grain",    renderOverviewLevel);

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
  // Item 19: "Scope to playhead" jumps the case scope to whichever case
  // contains the current video playhead -- meaningless on Overview, which has
  // no visible playhead/timeline. Hide it there; it stays wherever a timeline
  // (or a timeline-driven view) exists. The Case: select itself stays --
  // scoping by case is still meaningful on Overview.
  const playheadBtn = document.getElementById("btn-scope-to-playhead");
  if (playheadBtn) playheadBtn.style.display = (name === "overview") ? "none" : "";
  const layouts = ["overview", "flow", "steps", "map"];
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
  // P2.4: refresh the shortcuts overlay for the new view.
  renderShortcutsOverlay();
}

/* P2.4: small persistent corner widget listing 3-4 most-used
   shortcuts for the active view. Dismissable; state persisted to
   localStorage so the analyst doesn't have to dismiss every launch. */
const SHORTCUTS_OVERLAY_KEY = "pdt.shortcutsOverlayHidden";
const VIEW_SHORTCUTS = {
  map: [
    // NAV-AUDIT §E1: at the phase/element grains a node click drills one level
    // in; at screen/app/case (no deeper in-map level) it selects the node and
    // reveals its info. "Select · drill in" is honest for both, and never
    // implies a drill the default (screen) surface can't do.
    ["Click node", "Select · drill in"],
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
    ["Alt+↑ / ↓", "Move step up / down"],
    ["S",     "Split step at playhead"],
    ["M",     "Merge selected"],
    ["Ctrl+Z", "Undo"],
  ],
};
function renderShortcutsOverlay() {
  const ov = document.getElementById("shortcuts-overlay");
  if (!ov) return;
  const hidden = localStorage.getItem(SHORTCUTS_OVERLAY_KEY) === "1";
  // Only show when a session is loaded and the overlay is not dismissed.
  if (hidden || !State.getSession()) {
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

/* ============ Mini-timeline zoom (Steps) ========================== */

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

/* (Steps CRUD and ignored apps -> views/steps-view.js) */

/* ============ Step map / PDD exports ============================= */

async function exportArtifact(kind) {
  const target = State.getSession();
  if (!target) return;

  // Step BPMN export = the OBSERVED-FLOW map the viewer already shows
  // (process_map_step.bpmn, mined from the annotations by bpmn_observed.py
  // under --mine), exported from the session folder (mining it first if it
  // is not there yet).
  if (kind === "step-bpmn") {
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
    const out = await Ipc.exportFile({ sourcePath, suggestedName: "process." + kind + ".bpmn" });
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

/* AD-11: the Session Export menu carries the two map exports. "Step map as
   BPMN" copies the step-level Process diagram file the pipeline writes;
   "Map as SVG" is exportMapSvg below. */
if ($("#btn-session-step-bpmn")) $("#btn-session-step-bpmn").addEventListener("click", () => exportArtifact("step-bpmn"));
if ($("#btn-session-map-svg"))   $("#btn-session-map-svg").addEventListener("click", () => exportMapSvg());

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

/* AD-11: "Map as SVG" saves the map the Map level shows (the Process diagram
   or the Flow diagram, at its current detail level) as an SVG image, the
   format Figma / Lucidchart / browsers all import. From another level it
   opens the Map first and lets the diagram draw (the same settle the PDD
   export uses), then reads the renderer of the active notation. A cell that
   shows a message instead of a diagram (locked, or not built at this detail
   level) exports nothing and says so. */
async function exportMapSvg() {
  if (!State.getSession()) { toast("Open a session first.", "error"); return; }
  if (State.getLevel() !== "map") {
    // Click the level button (not applyLevel alone) so the View bar shows Map.
    const mapBtn = document.querySelector('.view-mode-btn[data-level="map"]');
    if (mapBtn) mapBtn.click(); else applyLevel("map");
    await new Promise((r) => setTimeout(r, 900));
  }
  const ctrl = _ensureSessionMapCtrl();
  let which = "dfg";
  const drawn = () => {
    which = ctrl.getState().notation === "dfg" ? "dfg" : "bpmn";
    const host = document.getElementById(which === "dfg" ? "session-map-dfg-host" : "session-map-bpmn-host");
    return !!(host && host.querySelector(which === "dfg" ? "canvas" : ".djs-container"));
  };
  // bpmn-js imports asynchronously: give a Process diagram a bounded moment.
  for (let i = 0; i < 30 && !drawn(); i++) await new Promise((r) => setTimeout(r, 100));
  let svg = null;
  if (drawn()) svg = which === "dfg" ? PdtDfg.exportSvg() : await PdtBpmn.exportSvg();
  if (!svg) {
    toast("No process map is drawn on the Map level to export. Analyze the session, or pick a view of the map that shows a diagram.", "error");
    return;
  }
  const r = await Ipc.saveSvgFile({
    content: svg,
    suggestedName: (which === "dfg" ? "flow-diagram" : "process-diagram") + ".svg",
  });
  if (r && r.ok) toast("Process map exported to " + r.path, "success");
  else if (r && r.error) toast("Export failed: " + r.error, "error");
}

/* PDD export from Session view -- new in v0.18.1. The PDD's As-Is process
   map (section 3.3) is rasterised from the currently-rendered Flow diagram;
   to embed THIS session's map (not a blank canvas), pre-render the
   Session-view Map controller's Flow tab and let cytoscape settle before
   invoking the shared exportArtifact("pdd") path. Item 7: the Map shows
   while the map is drawn (with the level bar saying so), and afterwards the
   analyst is returned to the level they started from (the Overview when
   they used its Export PDD button), unless they moved on meanwhile. */
if ($("#btn-session-pdd")) {
  $("#btn-session-pdd").addEventListener("click", async () => {
    if (!State.getSession()) { toast("Open a session first.", "error"); return; }
    const from = State.getLevel();
    toast("Preparing PDD: drawing the process map...", "info");
    selectLevel("map");
    try {
      const ctrl = _ensureSessionMapCtrl();
      ctrl.setState({ notation: "dfg" });
      // Let cytoscape paint + layout settle so PdtDfg.exportPng() captures the
      // rendered diagram and not a blank canvas. 900ms matches the post-tab-
      // switch timing used elsewhere in the controller.
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
  // Flow view: S adds/splits a step at the video playhead.
  if (State.getLevel() === "flow" && State.getSession()
      && e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    addStepAtPlayhead();
    e.preventDefault();
    return;
  }
  // Step editor shortcuts (only when on the Steps level)
  if (State.getLevel() === "steps" && State.getSession()) {
    const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
    // R1 (Steps chrome diet): reorder keeps a keyboard path now that the per-row
    // ↑ / ↓ buttons are gone -- Alt+ArrowUp / Alt+ArrowDown move the selected
    // step (same reorderStep semantics the right-click Move up/down items use).
    // Plain Arrow / j / k still just navigate the selection.
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.ctrlKey && !e.metaKey) {
      if (State.getSelectedStepId()) { reorderSelectedStep(e.key === "ArrowUp" ? -1 : 1); e.preventDefault(); }
    } else if (e.key === "j" || e.key === "ArrowDown") {
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
$("#topbar-meta").textContent = "v" + require("./package.json").version + " · " + new Date().toLocaleDateString();

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

/* ===== Recent dropdown (top-bar) =====
   Recent sessions were only reachable from the Session empty-state,
   which disappears once a session loads. This top-bar menu makes them
   reachable any time. */
function renderRecentMenu() {
  const host = document.getElementById("recent-menu-content");
  if (!host) return;
  let html = "";
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
