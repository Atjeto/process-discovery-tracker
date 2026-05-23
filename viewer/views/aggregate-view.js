/*
 * aggregate-view.js -- the Compare Sessions surface.
 *
 * Owns multi-session loading, the "Analyze all" batch flow, the
 * activity/case/variant/outlier/rework statistics, the merged process
 * map (BPMN + DFG with zoom controls), and drill-down from a map node
 * back to a single session. The drill action reaches into the Session
 * view, so it is injected by renderer.js via initAggregateView().
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { $, $$, escapeHtml, escapeAttr, fillTable, toast } = require("../dom.js");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const PdtCharts = require("../charts.js");
const PdtBpmn = require("../bpmn-viewer.js");
const PdtDfg = require("../dfg-viewer.js");
const { buildAnnotationDfg, processLabel, dropRareEdges } = require("../process-map-levels.js");
const { formModal } = require("../modals.js");
const SessionSummary = require("../session-summary.js");
const AnalysisAggregate = require("../analysis-aggregate.js");
const PdtTheme = require("../theme.js");
const TimelineCore = require("../timeline/timeline-core.js");

/* H2/H3 conformance colours -- must match dfg-viewer.js's CONF_*. */
const CONF_GREEN = "#4f9d5b";
const CONF_AMBER = "#cf9233";

/* Injected by renderer.js -- activates the Session tab, loads a
   session folder, and seeks to a timestamp. */
let onDrillToSession = async () => {};

/* ============ Map sub-tabs ======================================== */

function setMapZoomVisible(visible) {
  const wrap = document.getElementById("map-zoom");
  if (wrap) wrap.style.display = visible ? "" : "none";
}
function setMapZoomPct(z) {
  const el = document.getElementById("map-zoom-pct");
  if (el) el.textContent = Math.round((z || 1) * 100) + "%";
}

/* The active map viewer, derived from which host is visible -- both the
   BPMN and DFG viewers expose the same zoomIn/zoomOut/fit/getZoom API. */
function activeMapViewer() {
  const bpmnHost = $("#bpmn-host");
  const bpmnVisible = bpmnHost && bpmnHost.style.display !== "none";
  return bpmnVisible ? PdtBpmn : PdtDfg;
}

/* P0.2: notation (Process diagram = BPMN, Flow diagram = DFG) and level
   (Activity / Step / Phase) are fully ORTHOGONAL. Each cell of the matrix has
   its own artifact:
     BPMN × activity   -> process_map.bpmn (PM4Py inductive miner)
     BPMN × step/phase -> process_map_step|phase.bpmn (observed flow mined from
                          the annotations -- normalization/bpmn_observed.py)
     DFG  × activity   -> the merged taxonomy DFG
     DFG  × step/phase -> buildAnnotationDfg (the annotation DFG)
   The level selector changes level and re-renders the CURRENT notation; the
   notation tabs change notation and re-render the CURRENT level. Neither resets
   the other. renderMap() draws the active cell -- the single entry point. */
function showMapNotation(which) {
  $$(".panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.map === which));
  $("#bpmn-host").style.display = which === "bpmn" ? "" : "none";
  $("#dfg-host").style.display = which === "dfg" ? "" : "none";
  setMapZoomVisible(true);
  // The rare-path toggle only applies to the live DFG; applyMapLevel re-shows
  // it for the Flow diagram.
  if (which === "bpmn") {
    const rareWrap = document.getElementById("hide-rare-wrap");
    if (rareWrap) rareWrap.style.display = "none";
  }
}

/* Keep the level dropdown's shown value in step with _mapLevel. */
function syncMapLevelControl() {
  const lvl = document.getElementById("map-level");
  if (lvl) lvl.value = _mapLevel;
}

/* Session-folder BPMN filename for a level, and the first loaded session that
   has it (the BPMN pane shows one representative session, as the activity map
   always has). */
function mapBpmnFile(level) {
  return level === "step" ? "process_map_step.bpmn"
       : level === "phase" ? "process_map_phase.bpmn"
       : "process_map.bpmn";
}
function firstSessionWithMap(level) {
  const fname = mapBpmnFile(level);
  return (_lastFilteredForMap || []).find((s) =>
    s && s.sessionFolder && fs.existsSync(path.join(s.sessionFolder, fname))) || null;
}

/* Render the Process diagram (BPMN) at the current level. */
/* Drill-down navigation: clicking a node on the phase or step map descends one
   level (phase -> step -> activity), so the hierarchy is navigable by clicking,
   not only via the level dropdown. Activity is the bottom -- there a click
   drills to the source session (drillToActivity) instead.

   Scoping: on the live Flow diagram (DFG) the descent is FILTERED to the
   clicked node's children -- a phase drills to just its steps, a step to just
   the activity labels seen inside it. The Process diagram (BPMN) is a pre-mined
   static file that cannot be re-filtered live, so there a click descends
   UNFILTERED (consistent with the BPMN only collapsing on a re-analyze). */
function drillDownLevel(label) {
  const next = _mapLevel === "phase" ? "step" : _mapLevel === "step" ? "activity" : null;
  if (!next) return;
  const canScope = _mapNotation === "dfg" && !!label;
  if (canScope && _mapLevel === "phase") {
    _mapDrillFilter = { level: "step", parent: label, phaseName: label };
  } else if (canScope && _mapLevel === "step") {
    _mapDrillFilter = { level: "activity", parent: label, labels: _activityLabelsForStep(label) };
  } else {
    _mapDrillFilter = null;
  }
  _mapLevel = next;
  syncMapLevelControl();
  renderMap();
  setTimeout(() => {
    const v = activeMapViewer();
    if (v) { v.fit(); setMapZoomPct(v.getZoom()); }
  }, 50);
}

function renderBpmnAtLevel() {
  const host = $("#bpmn-host");
  if (!host || !PdtBpmn) return;
  const sess = firstSessionWithMap(_mapLevel);
  if (!sess) {
    host.innerHTML = '<div class="map-empty-inline">' +
      (_mapLevel === "activity"
        ? 'No process map yet — click "Analyze all sessions".'
        : 'No ' + _mapLevel + '-level Process diagram yet — Analyze a session that has ' +
          (_mapLevel === "phase" ? "phases" : "steps") +
          ' (it is mined from your annotations).') + '</div>';
    return;
  }
  // Drill-down maps node labels to activity stats, so it applies at the
  // activity level only (step/phase nodes are step/phase names).
  const opts = {};
  if (_mapLevel === "activity") opts.onNodeClick = (label) => drillToActivity(label);
  else opts.onNodeClick = (label) => drillDownLevel(label);   // descend a level (BPMN: unfiltered)
  PdtBpmn.render(host, path.join(sess.sessionFolder, mapBpmnFile(_mapLevel)), opts)
    .then(() => setMapZoomPct(PdtBpmn.getZoom())).catch(() => {});
  setMapZoomVisible(true);
}

/* Draw the active (notation × level) cell -- the single entry point. */
function renderMap() {
  showMapNotation(_mapNotation);
  renderMapScopeChip();
  if (_mapNotation === "bpmn") renderBpmnAtLevel();
  else applyMapLevel();
}

function wireMapTabs() {
  $$(".panel-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Notation changes IN PLACE -- the level is preserved.
      _mapNotation = tab.dataset.map === "dfg" ? "dfg" : "bpmn";
      // The BPMN is a static mined file and cannot honour a live drill scope,
      // so switching to it clears any Flow-diagram scope.
      if (_mapNotation === "bpmn") _mapDrillFilter = null;
      renderMap();
      setTimeout(() => {
        const v = activeMapViewer();
        if (v) { v.fit(); setMapZoomPct(v.getZoom()); }
      }, 50);
    });
  });

  // The zoom/fit controls (named btn-dfg-* historically) serve whichever
  // map tab is active, routed through activeMapViewer().
  const btnZoomIn = document.getElementById("btn-dfg-zoom-in");
  const btnZoomOut = document.getElementById("btn-dfg-zoom-out");
  const btnZoomFit = document.getElementById("btn-dfg-zoom-fit");
  if (btnZoomIn) btnZoomIn.addEventListener("click", () => {
    const v = activeMapViewer();
    if (v) { v.zoomIn(); setMapZoomPct(v.getZoom()); }
  });
  if (btnZoomOut) btnZoomOut.addEventListener("click", () => {
    const v = activeMapViewer();
    if (v) { v.zoomOut(); setMapZoomPct(v.getZoom()); }
  });
  if (btnZoomFit) btnZoomFit.addEventListener("click", () => {
    const v = activeMapViewer();
    if (v) { v.fit(); setMapZoomPct(v.getZoom()); }
  });

  // C1b / P0.2: the level selector changes level IN PLACE on the current
  // notation -- it never swaps notation. Every (notation × level) cell renders
  // (the step/phase Process diagram is the observed-flow BPMN).
  const lvl = document.getElementById("map-level");
  if (lvl) {
    lvl.addEventListener("change", () => {
      _mapLevel = lvl.value || "activity";
      _mapDrillFilter = null;   // an explicit level pick shows the whole level
      renderMap();
      setTimeout(() => {
        const v = activeMapViewer();
        if (v) { v.fit(); setMapZoomPct(v.getZoom()); }
      }, 50);
    });
  }

  // ADR-0013 #5: rare-path frequency slider (Flow diagram only). Drag to raise
  // the minimum edge frequency shown; 1 = every path. Re-renders live as it
  // drags, without an auto-fit so the user's pan/zoom is preserved.
  const rareRange = document.getElementById("rng-rare");
  if (rareRange) {
    rareRange.addEventListener("input", (e) => {
      _rarePathCutoff = Math.max(1, parseInt(e.target.value, 10) || 1);
      applyMapLevel();
    });
  }
}

/* C1b: render the process map (Flow diagram) at the selected depth without a
   full aggregate re-run. Activity uses the taxonomy-classified DFG; step and
   phase build one from the analyst's annotations, so the map is meaningful
   even when the taxonomy is empty. */
function applyMapLevel() {
  if (!PdtDfg) return;
  const host = $("#dfg-host");
  if (!host) return;
  let dfg;
  const opts = { onZoomChange: (z) => setMapZoomPct(z) };
  if (_mapLevel === "activity") {
    dfg = _lastActivityDfg;
    // Drill scope: a step node was clicked, so show only the activity labels
    // produced inside that step.
    if (_mapDrillFilter && _mapDrillFilter.level === "activity") {
      dfg = _filterDfgToLabels(_lastActivityDfg, _mapDrillFilter.labels);
    }
    opts.onNodeClick = (label, ev) => drillToActivity(label, ev);
    opts.variants = _lastVariantsForMap;
    // H3: re-apply the conformance overlay across re-renders (set up in
    // renderAggregate when a template-matched DFG is available).
    if (_lastConfActive && _lastConformance) opts.conformance = _lastConformance.status;
  } else {
    // Drill scope: a phase node was clicked, so build the step map from only
    // that phase's steps.
    const phaseFilter = (_mapDrillFilter && _mapDrillFilter.level === "step")
      ? { phaseName: _mapDrillFilter.phaseName } : null;
    dfg = buildAnnotationDfg(_lastFilteredForMap || [], _mapLevel, phaseFilter);
    opts.onNodeClick = (label) => drillDownLevel(label);   // descend a level, scoped
  }
  // ADR-0013 #5: rare-path frequency slider (Flow diagram only). The slider's
  // range tracks this map's busiest edge; a cutoff of 1 shows every path, higher
  // hides paths seen fewer times. dropRareEdges clamps the cutoff to maxFreq, so
  // the map is never blanked. The slider hides on the BPMN (showMapNotation) and
  // when the map has no edges; it disables when there is no spread to thin.
  const rareWrap = document.getElementById("hide-rare-wrap");
  const rareLbl = document.getElementById("hide-rare-lbl");
  const rareRange = document.getElementById("rng-rare");
  const baseHasEdges = !!(dfg && dfg.edges && dfg.edges.length);
  const maxFreq = baseHasEdges ? Math.max(...dfg.edges.map((e) => e.frequency || 1)) : 1;
  const canThin = baseHasEdges && maxFreq > 1 && dfg.edges.length >= 3;
  let hiddenRare = 0;
  let appliedCutoff = 1;
  if (canThin && _rarePathCutoff > 1) {
    const r = dropRareEdges(dfg, _rarePathCutoff);
    dfg = r.dfg;
    hiddenRare = r.hidden;
    appliedCutoff = r.cutoff;
  }
  if (rareWrap) rareWrap.style.display = baseHasEdges ? "" : "none";
  if (rareRange) {
    rareRange.max = String(Math.max(1, maxFreq));
    rareRange.value = String(Math.min(_rarePathCutoff, Math.max(1, maxFreq)));
    rareRange.disabled = !canThin;
  }
  if (rareLbl) {
    rareLbl.textContent = appliedCutoff > 1
      ? ("≥ " + appliedCutoff + "×  (" + hiddenRare + " hidden)")
      : "All paths";
  }
  if (dfg && dfg.edges && dfg.edges.length) {
    PdtDfg.render(host, dfg, opts);
    setMapZoomVisible(true);
  } else if (_mapDrillFilter) {
    host.innerHTML = '<div class="map-empty-inline">No sub-flow inside “' +
      escapeHtml(_mapDrillFilter.parent) + '” — it has a single ' +
      (_mapLevel === "activity" ? "activity" : "step") +
      '. Use “show all” to see the whole level.</div>';
  } else {
    host.innerHTML = '<div class="map-empty-inline">No ' + _mapLevel + '-level flow yet'
      + (_mapLevel === "activity"
          ? ' — classify your apps in the taxonomy'
          : ' — add steps or phases to this session') + '</div>';
  }
}

/* Activity labels produced inside every step whose value-free label matches
   `stepLabel`, pooled across the loaded sessions -- the children the activity
   Flow diagram is scoped to when a step node is drilled. */
function _activityLabelsForStep(stepLabel) {
  const labels = new Set();
  for (const s of (_lastFilteredForMap || [])) {
    const steps = ((s.annotations || {}).steps || []).filter((st) => st && st.state !== "hidden");
    const events = s.events || [];
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
  }
  return labels;
}

/* Restrict a DFG to a set of node labels -- keep an edge only when BOTH
   endpoints survive, with the matching start/end markers. */
function _filterDfgToLabels(dfg, labels) {
  if (!dfg || !labels) return dfg;
  const keep = (n) => labels.has(n);
  const filtObj = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => keep(k)));
  return {
    edges: (dfg.edges || []).filter((e) => keep(e.source) && keep(e.target)),
    start_activities: filtObj(dfg.start_activities),
    end_activities: filtObj(dfg.end_activities),
  };
}

/* Show/hide the drill-down scope chip in the map header. It names the parent
   the Flow diagram is scoped to and offers a one-click "show all" -- the
   inverse of drilling in. Only the live DFG can be scoped, so the chip is
   hidden on the BPMN. */
function renderMapScopeChip() {
  const chip = document.getElementById("map-scope");
  if (!chip) return;
  if (!_mapDrillFilter || _mapNotation !== "dfg") {
    chip.style.display = "none";
    chip.innerHTML = "";
    return;
  }
  chip.style.display = "";
  chip.innerHTML =
    '<span class="map-scope-lbl" title="The Flow diagram is scoped to this parent\'s children">scoped: ' +
    escapeHtml(_mapDrillFilter.parent) + '</span>' +
    '<button type="button" class="map-scope-clear" title="Show the whole level">show all ✕</button>';
  const btn = chip.querySelector(".map-scope-clear");
  if (btn) btn.addEventListener("click", () => {
    _mapDrillFilter = null;
    renderMap();
    setTimeout(() => {
      const v = activeMapViewer();
      if (v) { v.fit(); setMapZoomPct(v.getZoom()); }
    }, 50);
  });
}

/* ============ Multi-session loading =============================== */

async function openMultiFlow() {
  const folders = await Ipc.openMultipleSessions();
  if (!folders || !folders.length) return;
  const sessions = await Ipc.loadMultipleSessions(folders);
  State.setAggregateSessions(sessions.filter((s) => !s.error));
  $("#aggregate-empty").style.display = State.getAggregateSessions().length ? "none" : "";
  $("#aggregate-loaded").style.display = State.getAggregateSessions().length ? "" : "none";
  $("#btn-normalize-all").disabled = !State.getAggregateSessions().length;
  renderAggregate();
  if (State.getAggregateSessions().length) {
    toast(`Loaded ${State.getAggregateSessions().length} session(s)`, "success");
  }
}

/* Aggregate "Analyze all" supports the same cancel flow as the
   single-session Analyze. Each per-session normalize registers the
   kill handle via onProc on the backend; clicking the inline Cancel
   button kills the in-flight child AND breaks the for loop so we
   don't continue to the next session. */
let _aggregateNormalizeCancelled = false;

/* Phase H Compare-Sessions view toggles -- view state, not session
   data, so module-level (like _aggregateNormalizeCancelled above). */
let _groupByWorker = false;        // H1
let _variantMode = "activity";     // H10: "activity" | "step"
let _sxsAlign = "time";            // H2: "time" | "case"
let _dfgConformance = false;       // H3
/* C1b/P0.2: process-map axes + cached render inputs. _mapNotation (bpmn|dfg) ×
   _mapLevel (activity|step|phase) select the matrix cell; the cached inputs let
   the selectors re-render any cell without a full aggregate re-run. */
let _mapNotation = "bpmn";
let _mapLevel = "activity";
let _lastFilteredForMap = [];
let _lastVariantsForMap = null;
let _lastActivityDfg = null;
let _lastConformance = null;
let _lastConfActive = false;
/* Drill-down scope: when set, the Flow diagram is restricted to one parent
   node's children -- { level, parent, phaseName? | labels? }. Null = whole
   level. Cleared by an explicit level pick, a notation switch to BPMN, and a
   data refresh. */
let _mapDrillFilter = null;
/* Flow-diagram readability: a frequency CUTOFF (ADR-0013 #5) -- keep only edges
   seen >= _rarePathCutoff times, so a long, dense recording shows its dominant
   flow. 1 = show every path. A view setting, DFG-only; the slider's range tracks
   the current map's busiest edge. */
let _rarePathCutoff = 1;

function wireAggregateControls() {
  $("#btn-open-multi-hero").addEventListener("click", openMultiFlow);
  $("#btn-open-multi").addEventListener("click", openMultiFlow);

  const _btnNormalizeAllCancel = $("#btn-normalize-all-cancel");
  if (_btnNormalizeAllCancel) {
    _btnNormalizeAllCancel.addEventListener("click", async () => {
      _aggregateNormalizeCancelled = true;
      await Ipc.cancelNormalize();
      toast("Cancelling after current session...");
    });
  }
  $("#btn-normalize-all").addEventListener("click", async () => {
    if (!State.getAggregateSessions().length) return;
    _aggregateNormalizeCancelled = false;
    const btn = $("#btn-normalize-all");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    const cancelBtn = $("#btn-normalize-all-cancel");
    if (cancelBtn) cancelBtn.style.display = "";
    let cancelled = false;
    let done = 0;
    const total = State.getAggregateSessions().length;
    for (const s of State.getAggregateSessions()) {
      if (_aggregateNormalizeCancelled) { cancelled = true; break; }
      // P2.11: per-iteration progress label so a long aggregate analyze
      // doesn't look frozen.
      btn.textContent = `Analyzing ${done + 1} / ${total}...`;
      const r = await Ipc.runNormalize({
        sessionFolder: s.sessionFolder,
        mine: true,
      });
      done++;
      if (r && r.cancelled) { cancelled = true; break; }
    }
    if (cancelBtn) cancelBtn.style.display = "none";
    btn.textContent = originalLabel;
    if (cancelled) {
      toast(`Cancelled after ${done} of ${total} session${total === 1 ? "" : "s"}.`);
      btn.disabled = false;
      return;
    }
    const folders = State.getAggregateSessions().map((s) => s.sessionFolder);
    State.setAggregateSessions(await Ipc.loadMultipleSessions(folders));
    State.setAggregateSessions(State.getAggregateSessions().filter((s) => !s.error));
    renderAggregate();
    btn.disabled = false;
    toast("All sessions normalized + mined", "success");
  });

  $("#agg-filter").addEventListener("input", (e) => {
    State.setAggregateFilter((e.target.value || "").toLowerCase().trim());
    renderAggregate();
  });
  $("#agg-from").addEventListener("change", (e) => {
    State.setAggregateFromDate(e.target.value || "");
    renderAggregate();
  });
  $("#agg-to").addEventListener("change", (e) => {
    State.setAggregateToDate(e.target.value || "");
    renderAggregate();
  });

  // H1: group the activity / case charts by worker.
  const groupCb = document.getElementById("cb-agg-group-worker");
  if (groupCb) groupCb.addEventListener("change", (e) => {
    _groupByWorker = !!e.target.checked;
    renderAggregate();
  });

  // H10: variant table -- raw activity sequence vs. step-name sequence.
  const vmodeSwitch = document.getElementById("variant-mode-switch");
  if (vmodeSwitch) {
    vmodeSwitch.querySelectorAll("[data-vmode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        _variantMode = btn.dataset.vmode === "step" ? "step" : "activity";
        vmodeSwitch.querySelectorAll("[data-vmode]").forEach((b) =>
          b.classList.toggle("active", b === btn));
        renderAggregate();
      });
    });
  }

  // H3: DFG conformance overlay toggle.
  const confCb = document.getElementById("cb-dfg-conformance");
  if (confCb) confCb.addEventListener("change", (e) => {
    _dfgConformance = !!e.target.checked;
    renderAggregate();
  });

  // H2: two-session side-by-side comparison.
  const sxsBtn = document.getElementById("btn-compare-sxs");
  if (sxsBtn) sxsBtn.addEventListener("click", renderSideBySide);
  const sxsAlign = document.getElementById("btn-sxs-align");
  if (sxsAlign) sxsAlign.addEventListener("click", () => {
    _sxsAlign = _sxsAlign === "time" ? "case" : "time";
    sxsAlign.textContent = "Align: by " + (_sxsAlign === "time" ? "time" : "first case");
    renderSideBySide();
  });
}

function matchesFilter(text) {
  if (!State.getAggregateFilter()) return true;
  return String(text || "").toLowerCase().includes(State.getAggregateFilter());
}

function sessionInDateRange(s) {
  /* Use manifest.started_at against [from, to] inclusive when set.
     A session with no started_at is conservatively included. */
  if (!State.getAggregateFromDate() && !State.getAggregateToDate()) return true;
  const startedAt = (s.manifest || {}).started_at;
  if (!startedAt) return true;
  const day = startedAt.slice(0, 10); // YYYY-MM-DD
  if (State.getAggregateFromDate() && day < State.getAggregateFromDate()) return false;
  if (State.getAggregateToDate() && day > State.getAggregateToDate()) return false;
  return true;
}

function filteredAggregateSessions() {
  return State.getAggregateSessions().filter(sessionInDateRange);
}

/* Phase A2: total session duration for the outlier check -- the
   manifest's started/ended span, falling back to the event stream. */
function sessionWallMs(s) {
  const m = (s && s.manifest) || {};
  if (m.started_at && m.ended_at) {
    const a = Date.parse(m.started_at);
    const b = Date.parse(m.ended_at);
    if (isFinite(a) && isFinite(b) && b > a) return b - a;
  }
  const evs = (s && s.events) || [];
  if (evs.length) {
    const a = Date.parse(evs[0].timestamp);
    const b = Date.parse(evs[evs.length - 1].timestamp);
    if (isFinite(a) && isFinite(b)) return Math.max(0, b - a);
  }
  return 0;
}

function sessionName(s) {
  if (!s) return "session";
  return path.basename(s.sessionFolder || "") ||
    (s.manifest && s.manifest.session_id) || "session";
}

/* H1: the worker who recorded a session. stats meta wins, then the
   manifest config block -- the same resolution session-summary.js uses. */
function sessionWorker(s) {
  if (!s) return "unknown worker";
  const meta = (s.stats && s.stats.meta) || {};
  const m = s.manifest || {};
  return meta.worker_id ||
    (m.config && m.config.worker && m.config.worker.id) ||
    m.worker || "unknown worker";
}

/* Distinct worker names across a session set, sorted. */
function distinctWorkers(sessions) {
  return [...new Set((sessions || []).map(sessionWorker))].sort();
}

/* Stable per-worker colour, drawn from the theme's step palette. */
function workerColorMap(sessions) {
  const pal = PdtTheme.stepPalette();
  const map = new Map();
  distinctWorkers(sessions).forEach((w, i) => map.set(w, pal[i % pal.length]));
  return map;
}

/* Phase A2: flag a session whose total duration is a statistical
   outlier among the loaded set -- it can quietly distort the merged
   statistics. The banner offers a one-click drop from the comparison. */
function renderOutlierBanner(sessions) {
  const banner = document.getElementById("agg-outlier-banner");
  if (!banner) return;
  const outliers = SessionSummary.detectDurationOutliers(sessions.map(sessionWallMs));
  if (!outliers.length) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  banner.style.display = "";
  const many = outliers.length > 1;
  const parts = outliers.map((o) =>
    `<strong>${escapeHtml(sessionName(sessions[o.index]))}</strong> ` +
    `(${o.ratio.toFixed(1)}× the median) ` +
    `<span class="summary-link" data-drop="${o.index}">remove</span>`
  );
  banner.innerHTML =
    `Possible outlier${many ? "s" : ""}: ` + parts.join(" · ") +
    ". A very different duration can distort the merged statistics — " +
    `consider reviewing ${many ? "them" : "it"} separately.`;
  banner.querySelectorAll("[data-drop]").forEach((link) => {
    link.addEventListener("click", () => {
      const sess = sessions[Number(link.dataset.drop)];
      if (!sess) return;
      State.setAggregateSessions(
        State.getAggregateSessions().filter((x) => x !== sess));
      if (!State.getAggregateSessions().length) {
        $("#aggregate-empty").style.display = "";
        $("#aggregate-loaded").style.display = "none";
      }
      renderAggregate();
      toast("Removed " + sessionName(sess) + " from the comparison");
    });
  });
}

/* H9: warn when the loaded sessions were analyzed against different
   taxonomy versions -- their activity labels (and the variant
   comparison built on them) may not line up. */
function renderTaxonomyBanner(sessions) {
  const banner = document.getElementById("agg-taxonomy-banner");
  if (!banner) return;
  const versions = new Set();
  for (const s of sessions) {
    const tv = ((s.stats || {}).meta || {}).taxonomy_version;
    if (tv != null && tv !== "") versions.add(tv);
  }
  if (versions.size > 1) {
    banner.style.display = "";
    banner.textContent =
      "Sessions were analyzed with different taxonomy versions (" +
      [...versions].join(", ") + ") — activity labels may not line up, " +
      "so variant comparison can be unreliable. Re-analyze them against " +
      "the same taxonomy for a consistent comparison.";
  } else {
    banner.style.display = "none";
    banner.textContent = "";
  }
}

function renderAggregate() {
  // Pills - count filtered + total
  const filtered = filteredAggregateSessions();
  renderOutlierBanner(filtered);
  renderTaxonomyBanner(filtered);
  renderAggAnalysis(filtered);
  // H1: the group-by-worker toggle is only meaningful with 2+ workers.
  const workerWrap = document.getElementById("agg-group-worker-wrap");
  if (workerWrap) {
    workerWrap.style.display =
      (filtered.length > 1 && distinctWorkers(filtered).length >= 2) ? "" : "none";
  }
  // H2: the side-by-side panel is available only for exactly two sessions.
  const sxsPanel = document.getElementById("side-by-side-panel");
  if (sxsPanel) sxsPanel.style.display = filtered.length === 2 ? "" : "none";
  const numNormalized = filtered.filter((s) => !!s.stats).length;
  const rangeNote = (State.getAggregateFromDate() || State.getAggregateToDate())
    ? ` (filtered from ${State.getAggregateSessions().length})` : "";
  $("#aggregate-pills").innerHTML =
    '<div class="pill ok"><span class="dot"></span><span class="lbl">sessions</span>' +
      filtered.length + escapeHtml(rangeNote) + '</div>' +
    '<div class="pill' + (numNormalized === filtered.length && filtered.length ? ' ok' : '') + '">' +
      '<span class="dot"></span><span class="lbl">normalized</span>' +
      numNormalized + ' / ' + filtered.length + '</div>';

  const allStats = filtered.map((s) => s.stats).filter(Boolean);
  if (!allStats.length) {
    $("#map-empty").style.display = "";
    $("#activity-chart").innerHTML = '<div class="chart-empty">no data</div>';
    $("#case-chart").innerHTML = '<div class="chart-empty">no data</div>';
    return;
  }
  $("#map-empty").style.display = "none";

  // P1.7: compute the wall-clock span across loaded sessions so we can
  // bucket sparkline data into 10 equal slices for each chart row.
  const sessionTimes = filtered
    .map((s) => (s.manifest && s.manifest.started_at) ? new Date(s.manifest.started_at).getTime() : null)
    .filter((t) => t != null && isFinite(t));
  const sparkSpan = sessionTimes.length
    ? { startMs: Math.min(...sessionTimes), endMs: Math.max(...sessionTimes) }
    : null;
  const SPARK_BUCKETS = 10;
  function bucketIdx(ms) {
    if (!sparkSpan || !isFinite(ms)) return -1;
    const sp = Math.max(1, sparkSpan.endMs - sparkSpan.startMs);
    return Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor(((ms - sparkSpan.startMs) / sp) * SPARK_BUCKETS)));
  }

  // Merge activity stats
  const actMap = new Map();
  for (const st of allStats) {
    for (const r of (st.activity_stats || [])) {
      const e = actMap.get(r.activity_label) || {
        activity_label: r.activity_label, frequency: 0, total_duration_ms: 0,
        median_samples: [], p90_samples: [], sparkline: new Array(SPARK_BUCKETS).fill(0),
      };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      e.median_samples.push(r.median_ms);
      e.p90_samples.push(r.p90_ms);
      // Bucket this session's contribution by its started_at.
      const sessTs = ((st.meta || {}).session_started_at) ||
                     (filtered.find((s) => s.stats === st) && filtered.find((s) => s.stats === st).manifest && filtered.find((s) => s.stats === st).manifest.started_at);
      if (sessTs) {
        const idx = bucketIdx(new Date(sessTs).getTime());
        if (idx >= 0) e.sparkline[idx] += r.frequency;
      }
      actMap.set(r.activity_label, e);
    }
  }
  const actRows = [...actMap.values()]
    .filter((r) => matchesFilter(r.activity_label))
    .sort((a, b) => b.frequency - a.frequency);
  // H1: when "Group by worker" is on (and the set spans 2+ workers),
  // split the merged top activities into one bar per worker.
  const wColors = workerColorMap(filtered);
  const showGrouping = _groupByWorker && distinctWorkers(filtered).length >= 2;
  if (showGrouping) {
    const topActs = actRows.slice(0, 8).map((r) => r.activity_label);
    PdtCharts.renderBarChart($("#activity-chart"),
      groupedActivityRows(filtered, topActs, wColors),
      { unit: "", maxBars: 32 });
  } else {
    PdtCharts.renderBarChart($("#activity-chart"),
      actRows.map((r) => ({
        label: r.activity_label,
        value: r.frequency,
        valueLabel: r.frequency + " · " + PdtCharts.fmtDurationS(r.total_duration_ms / 1000),
        sparkline: sparkSpan ? r.sparkline : null,
      })),
      { unit: "" });
  }
  renderWorkerLegend(showGrouping ? wColors : null);

  // Case durations: bar chart, active duration with wall-clock overlay.
  // H1: iterate sessions (not merged stats) so each case row knows its
  // worker and can be coloured when grouping is on.
  const caseRows = [];
  for (const s of filtered) {
    if (!s.stats) continue;
    const caseWorker = sessionWorker(s);
    for (const r of (s.stats.case_stats || [])) {
      if (r.parent_case_id) continue; // top-level only
      if (!matchesFilter(r.label || r.case_id)) continue;
      // Per-case sparkline: a single bin (the bucket containing this
      // case's start_time). Aggregated across the row gives a "when did
      // these cases happen" feel without needing per-event scan.
      let caseSpark = null;
      if (sparkSpan && r.start_time) {
        caseSpark = new Array(SPARK_BUCKETS).fill(0);
        const idx = bucketIdx(new Date(r.start_time).getTime());
        if (idx >= 0) caseSpark[idx] = 1;
      }
      caseRows.push({
        label: (r.label || r.case_id.slice(0, 8)),
        value: (r.active_ms || 0) / 1000,
        secondary: (r.wall_clock_ms || 0) / 1000,
        valueLabel: PdtCharts.fmtDurationS((r.active_ms || 0) / 1000),
        sparkline: caseSpark,
        color: showGrouping ? wColors.get(caseWorker) : undefined,
        meta: r,
      });
    }
  }
  caseRows.sort((a, b) => b.value - a.value);
  PdtCharts.renderBarChart($("#case-chart"), caseRows, {
    color: "var(--accent-2)",
    secondaryColor: "var(--warn)",
  });

  // Variants table -- with P2.2 frequency-heat bar inline. Each variant
  // row gets a visual bar showing how dominant it is relative to the
  // most-common variant; activities that appear at the same position
  // across MULTIPLE variants get a faint divergence highlight so the
  // analyst can spot where paths split.
  // H10: the variant table can key on the raw activity sequence or the
  // analyst's step-name sequence (stats.step_variants).
  const variantKey = _variantMode === "step" ? "step_variants" : "trace_variants";
  const varAgg = new Map();   // variantStr -> { freq, length, sessions }
  for (const st of allStats) {
    const sessId = ((st.meta || {}).session_id) || "?";
    for (const v of (st[variantKey] || [])) {
      const variantStr = v.variant.join(" → ");
      if (!matchesFilter(variantStr)) continue;
      const e = varAgg.get(variantStr) || { freq: 0, length: v.length, sessions: new Set() };
      e.freq += v.frequency;
      e.sessions.add(sessId);
      varAgg.set(variantStr, e);
    }
  }
  const varRows = Array.from(varAgg.entries())
    .map(([s, e]) => ({ variant: s, freq: e.freq, length: e.length, sessions: e.sessions.size }))
    .sort((a, b) => b.freq - a.freq);
  // Compute per-position activity sets across all variants for the
  // divergence highlight: position i is "divergent" if multiple
  // activities ever appear at position i across the loaded variants.
  const positionActivities = [];
  for (const r of varRows) {
    const acts = r.variant.split(" → ");
    acts.forEach((a, i) => {
      while (positionActivities.length <= i) positionActivities.push(new Set());
      positionActivities[i].add(a);
    });
  }
  function highlightDivergence(variant) {
    return variant.split(" → ").map((a, i) => {
      const div = positionActivities[i] && positionActivities[i].size > 1;
      return div ? '<span class="variant-div">' + escapeHtml(a) + '</span>'
                 : escapeHtml(a);
    }).join(' <span class="variant-arrow">→</span> ');
  }
  const variantHost = document.querySelector("#variants tbody") || $("#variants");
  if (variantHost) {
    if (!varRows.length) {
      // Clear stale rows from a previous render where variants existed.
      variantHost.innerHTML = '<tr><td colspan="3" style="color:var(--fg-3);font-style:italic;padding:8px">No variants — analyze sessions to populate.</td></tr>';
    } else {
      const maxFreq = varRows[0].freq;
      variantHost.innerHTML = varRows.slice(0, 80).map((r) => {
        const heatPct = Math.round((r.freq / maxFreq) * 100);
        return '<tr>' +
          '<td><div class="variant-heat" style="width:' + heatPct + '%"></div>' +
            '<span class="variant-freq">' + r.freq + '</span></td>' +
          '<td>' + r.length + '</td>' +
          '<td><span class="variant-sessions" title="' + r.sessions + ' session(s) follow this path">' +
            r.sessions + '×</span> ' + highlightDivergence(r.variant) +
          '</td>' +
          '</tr>';
      }).join("");
    }
  }

  // Variant data for the DFG variant-overlay (Phase E). Always the
  // activity sequence -- DFG nodes are activities -- independent of the
  // variant table's Activity/Step display mode (H10).
  const dfgVarAgg = new Map();
  for (const st of allStats) {
    for (const v of (st.trace_variants || [])) {
      const k = v.variant.join(" → ");
      dfgVarAgg.set(k, (dfgVarAgg.get(k) || 0) + (v.frequency || 0));
    }
  }
  const variantsForDfg = [...dfgVarAgg.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 80)
    .map(([k, freq]) => ({ variant: k.split(" → "), frequency: freq }));

  // Outliers + rework
  const outRows = [];
  for (const st of allStats) {
    for (const r of (st.app_outliers || [])) {
      if (!matchesFilter(r.app)) continue;
      outRows.push([r.app, r.case_count, r.case_pct + "%"]);
    }
  }
  fillTable("#outliers", outRows);
  const reworkRows = [];
  for (const st of allStats) {
    for (const r of (st.rework_loops || [])) {
      if (!matchesFilter(r.activity_label)) continue;
      reworkRows.push([r.activity_label, r.rework_count]);
    }
  }
  fillTable("#rework", reworkRows);

  // Merge DFG edges across the filtered sessions (the activity Flow diagram).
  const edgeMap = new Map();
  const starts = new Map();
  const ends = new Map();
  for (const s of filtered) {
    if (!s.dfg) continue;
    for (const e of (s.dfg.edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
    for (const [k, v] of Object.entries(s.dfg.start_activities || {})) {
      starts.set(k, (starts.get(k) || 0) + v);
    }
    for (const [k, v] of Object.entries(s.dfg.end_activities || {})) {
      ends.set(k, (ends.get(k) || 0) + v);
    }
  }
  // P0.2: cache the map inputs so the notation/level selectors can re-render
  // any (notation × level) cell without a full aggregate re-run.
  _lastFilteredForMap = filtered;
  _lastVariantsForMap = variantsForDfg;
  _lastActivityDfg = null;
  _lastConformance = null;
  _lastConfActive = false;
  _mapDrillFilter = null;   // a data refresh resets any drill-down scope

  // H3: hide the conformance toggle + legend by default; re-enabled below when
  // a template-matched activity DFG is available.
  renderConformanceLegend(null);
  const _confWrap = document.getElementById("dfg-conformance-wrap");
  if (_confWrap) _confWrap.style.display = "none";
  if (edgeMap.size) {
    _lastActivityDfg = {
      edges: [...edgeMap.entries()].map(([k, freq]) => {
        const [source, target] = k.split("\x00");
        return { source, target, frequency: freq };
      }),
      start_activities: Object.fromEntries(starts),
      end_activities: Object.fromEntries(ends),
    };
    // H3: conformance overlay -- offered when any session matched a Process
    // Template. Stored so applyMapLevel re-applies it across re-renders.
    _lastConformance = computeConformance(filtered, _lastActivityDfg);
    _lastConfActive = !!(_lastConformance && _dfgConformance);
    if (_confWrap) _confWrap.style.display = _lastConformance ? "" : "none";
    const confCb = document.getElementById("cb-dfg-conformance");
    if (confCb) confCb.checked = _lastConfActive;
    renderConformanceLegend(_lastConfActive ? _lastConformance : null);
  }

  // Default cell: if the activity Flow diagram is empty (e.g. no taxonomy) but
  // the analyst has steps/phases, fall back to that level on the Flow diagram
  // so the map is not blank. Only overrides an untouched (activity) selection.
  if (_mapLevel === "activity" && !(_lastActivityDfg && _lastActivityDfg.edges.length)) {
    const anyPhases = filtered.some((s) => ((s.annotations || {}).phases || []).length);
    const anySteps = filtered.some((s) => ((s.annotations || {}).steps || []).some((st) => st.state !== "hidden"));
    if (anyPhases) { _mapLevel = "phase"; _mapNotation = "dfg"; }
    else if (anySteps) { _mapLevel = "step"; _mapNotation = "dfg"; }
  }
  syncMapLevelControl();
  renderMap();

  // Export buttons
  const firstWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  $("#btn-export-bpmn").disabled = !firstWithBpmn;
  $("#btn-export-xes").disabled = !filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "events.xes")));
  $("#btn-export-stats").disabled = !allStats.length;
  $("#btn-export-md").disabled = !filtered.length;
  /* Taxonomy promotion is enabled when any normalized session has
     Unclassified activity labels in its stats. */
  $("#btn-export-promotions").disabled = !allStats.some((st) =>
    (st.activity_stats || []).some((r) => /^Unclassified/.test(r.activity_label || "")));

  // Phase E export buttons: enabled when at least one session has step data.
  const haveSteps = filtered.some((s) =>
    (s.annotations && (s.annotations.steps || []).length));
  if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").disabled  = !haveSteps;
  if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").disabled = !haveSteps;
  if ($("#btn-export-pdd"))        $("#btn-export-pdd").disabled        = !haveSteps;
  if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").disabled   = !haveSteps;

  // Version-spread banner
  const versions = new Set();
  for (const s of filtered) {
    const v = ((s.stats || {}).meta || {}).canonical_version;
    if (v != null) versions.add(v);
  }
  const banner = $("#agg-version-spread");
  if (banner) {
    if (versions.size > 1) {
      const latest = Math.max(...[...versions].filter(v => typeof v === "number"));
      banner.style.display = "";
      banner.innerHTML =
        `Loaded sessions span ${versions.size} canonical versions ` +
        `(${[...versions].join(", ")}). Statistics may be inconsistent. ` +
        `<button id="btn-renormalize-to-latest">Re-normalize all to v${latest}</button>`;
      const reBtn = $("#btn-renormalize-to-latest");
      if (reBtn) reBtn.addEventListener("click", () => $("#btn-renormalize-canonical").click());
    } else {
      banner.style.display = "none";
      banner.innerHTML = "";
    }
  }

  // Drift panel
  const driftPanel = $("#drift-panel");
  if (driftPanel) {
    const totalDrift = filtered.reduce((acc, s) =>
      acc + (((s.annotations || {}).drift_markers || []).length), 0);
    if (totalDrift > 0) {
      driftPanel.style.display = "";
      const rateRows = filtered.map((s) => ({
        folder: s.sessionFolder.split(/[\\/]/).pop(),
        match_rate: ((s.stats || {}).meta || {}).match_rate || 0,
        drift: ((s.annotations || {}).drift_markers || []).length,
      }));
      $("#drift-content").innerHTML = `
        <table class="stats-table">
          <thead><tr><th>session</th><th>match rate</th><th>drift markers</th></tr></thead>
          <tbody>
            ${rateRows.map(r => `<tr><td>${escapeHtml(r.folder)}</td>
              <td class="num">${Math.round((r.match_rate || 0) * 100)}%</td>
              <td class="num">${r.drift}</td></tr>`).join("")}
          </tbody>
        </table>`;
    } else {
      driftPanel.style.display = "none";
    }
  }
}

/* ============ Analysis aggregation (ANALYSIS-LAYER-FOLLOWUPS) ====== */

/* Render the cross-session Analysis panel from the loaded sessions'
   analysis.json sidecars. Hidden unless at least one loaded session was
   analyzed. The aggregation itself lives in the pure analysis-aggregate.js. */
function renderAggAnalysis(sessions) {
  const panel = document.getElementById("agg-analysis-panel");
  if (!panel) return;
  const withAnalysis = (sessions || []).filter((s) => s && s.analysis);
  if (!withAnalysis.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  const host = document.getElementById("agg-analysis-content");
  if (!host) return;
  const agg = AnalysisAggregate.aggregateAnalysis(withAnalysis);
  host.innerHTML =
    (_aggTimeStudySection(agg) + _aggWorkerSection(agg) +
     _aggAutomationSection(agg) + _aggEfficiencySection(agg)) ||
    '<div class="analysis-empty">The loaded sessions have no analysis ' +
    "findings yet.</div>";
}

function _aggDur(ms) {
  return escapeHtml(PdtCharts.fmtDurationS((ms || 0) / 1000));
}

function _aggScore(v) {
  return (v === null || v === undefined)
    ? '<span class="score-na" title="needs the step in 2+ sessions">—</span>'
    : Math.round(v * 100) + "%";
}

function _aggTimeStudySection(agg) {
  if (!agg.time_study.length) return "";
  const rows = agg.time_study.map((t) =>
    "<tr><td>" + escapeHtml(t.name) + "</td>" +
    '<td class="num">' + t.sessions + "</td>" +
    '<td class="num">' + t.instances + "</td>" +
    '<td class="num">' + _aggDur(t.cycle_ms.mean) + "</td>" +
    '<td class="num">' + _aggDur(t.cycle_ms.min) + "</td>" +
    '<td class="num">' + _aggDur(t.cycle_ms.max) + "</td>" +
    '<td class="num">' + _aggDur(t.active_ms) + "</td>" +
    '<td class="num">' + _aggDur(t.waiting_ms) + "</td>" +
    '<td class="num">' + _aggDur(t.switching_ms) + "</td></tr>"
  ).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Cross-session time study</div>' +
    '<table class="analysis-table"><thead><tr><th>Step</th><th>Sessions</th>' +
    "<th>Instances</th><th>Mean</th><th>Min</th><th>Max</th><th>Active</th>" +
    "<th>Waiting</th><th>Switching</th></tr></thead><tbody>" +
    rows + "</tbody></table></div>";
}

function _aggWorkerSection(agg) {
  // A per-worker comparison only says something with two or more workers.
  if (!agg.by_worker || agg.by_worker.length < 2) return "";
  const rows = [];
  for (const w of agg.by_worker) {
    for (const st of w.steps) {
      rows.push("<tr><td>" + escapeHtml(w.worker) + "</td>" +
        "<td>" + escapeHtml(st.name) + "</td>" +
        '<td class="num">' + st.instances + "</td>" +
        '<td class="num">' + _aggDur(st.mean_cycle_ms) + "</td></tr>");
    }
  }
  if (!rows.length) return "";
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Per-worker comparison</div>' +
    '<table class="analysis-table"><thead><tr><th>Worker</th><th>Step</th>' +
    "<th>Instances</th><th>Mean cycle</th></tr></thead><tbody>" +
    rows.join("") + "</tbody></table></div>";
}

function _aggAutomationSection(agg) {
  if (!agg.automation.length) return "";
  const rows = agg.automation.map((a) => {
    const parts = [];
    if (a.confirmed) parts.push(a.confirmed + " confirmed");
    if (a.dismissed) parts.push(a.dismissed + " dismissed");
    const decision = parts.length ? parts.join(" · ") : "—";
    return "<tr><td>" + escapeHtml(a.name) + "</td>" +
      '<td class="num">' + a.sessions + "</td>" +
      '<td class="num">' + a.instances + "</td>" +
      '<td class="num">' + _aggScore(a.repetitiveness) + "</td>" +
      '<td class="num">' + _aggScore(a.rule_based) + "</td>" +
      '<td class="num">' + _aggDur(a.volume) + "</td>" +
      "<td>" + escapeHtml(decision) + "</td></tr>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Automation candidates (pooled)</div>' +
    '<table class="analysis-table"><thead><tr><th>Step</th><th>Sessions</th>' +
    "<th>Instances</th><th>Repetitive</th><th>Rule-based</th><th>Volume</th>" +
    "<th>Analyst decision</th></tr></thead><tbody>" +
    rows + "</tbody></table></div>";
}

function _aggEfficiencySection(agg) {
  if (!agg.efficiency_trend.length) return "";
  const rows = agg.efficiency_trend.map((e) => {
    const pct = Math.round(e.ratio * 100);
    const label = e.name + (e.worker ? " · " + e.worker : "");
    return '<div class="agg-eff-row">' +
      '<span class="agg-eff-name" title="' + escapeAttr(label) + '">' +
        escapeHtml(label) + "</span>" +
      '<span class="agg-eff-track"><span class="agg-eff-fill" style="width:' +
        pct + '%"></span></span>' +
      '<span class="agg-eff-val">' + pct + "%</span></div>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Process-efficiency trend</div>' +
    '<div class="agg-eff-list">' + rows + "</div></div>";
}

/* ============ H1: per-worker chart grouping ======================= */

/* Per-(activity, worker) rows for the activity chart: the merged top
   activities, split into one bar per worker and coloured by worker. */
function groupedActivityRows(sessions, topActivities, wColors) {
  const byWorker = new Map();   // worker -> Map(activity -> frequency)
  for (const s of sessions) {
    if (!s.stats) continue;
    const w = sessionWorker(s);
    let m = byWorker.get(w);
    if (!m) { m = new Map(); byWorker.set(w, m); }
    for (const r of (s.stats.activity_stats || [])) {
      m.set(r.activity_label, (m.get(r.activity_label) || 0) + r.frequency);
    }
  }
  const workers = [...byWorker.keys()].sort();
  const rows = [];
  for (const act of topActivities) {
    for (const w of workers) {
      const freq = byWorker.get(w).get(act) || 0;
      if (!freq) continue;
      rows.push({
        label: act,
        value: freq,
        color: wColors.get(w),
        valueLabel: freq + " · " + w,
      });
    }
  }
  return rows;
}

/* Render (or hide) the worker colour legend above the charts. */
function renderWorkerLegend(wColors) {
  const host = document.getElementById("agg-worker-legend");
  if (!host) return;
  if (!wColors || !wColors.size) {
    host.style.display = "none";
    host.innerHTML = "";
    return;
  }
  host.style.display = "";
  host.innerHTML = "Worker: " + [...wColors.entries()].map(([w, c]) =>
    '<span class="lg-item"><span class="lg-swatch" style="background:' +
    escapeAttr(c) + '"></span>' + escapeHtml(w) + "</span>"
  ).join("");
}

/* ============ H3: DFG conformance overlay ========================= */

/* Build a conformance map for the merged DFG. A node is green when its
   activity label matches a canonical step name (taken from auto_matched
   steps across the loaded sessions), amber otherwise. Returns null when
   no session matched a Process Template -- the overlay has nothing to
   say. `missing` lists canonical steps no DFG node represents. */
function computeConformance(sessions, dfg) {
  const canonical = new Set();   // normalized canonical step names
  const canonicalDisplay = new Map();  // normalized -> display name
  for (const s of sessions) {
    for (const st of (((s.annotations || {}).steps) || [])) {
      if (st.state === "auto_matched" && st.name) {
        const norm = st.name.trim().toLowerCase();
        canonical.add(norm);
        if (!canonicalDisplay.has(norm)) canonicalDisplay.set(norm, st.name);
      }
    }
  }
  if (!canonical.size) return null;
  const nodes = new Set();
  for (const e of (dfg.edges || [])) { nodes.add(e.source); nodes.add(e.target); }
  const status = {};
  const seen = new Set();
  for (const n of nodes) {
    const norm = String(n).trim().toLowerCase();
    if (canonical.has(norm)) { status[n] = "green"; seen.add(norm); }
    else status[n] = "amber";
  }
  const missing = [];
  for (const norm of canonical) {
    if (!seen.has(norm)) missing.push(canonicalDisplay.get(norm));
  }
  return { status, missing };
}

/* Render (or hide) the conformance legend below the process map. */
function renderConformanceLegend(conf) {
  const host = document.getElementById("dfg-conformance-legend");
  if (!host) return;
  if (!conf) {
    host.style.display = "none";
    host.innerHTML = "";
    return;
  }
  host.style.display = "";
  let html =
    '<span class="lg-item"><span class="lg-swatch" style="background:' + CONF_GREEN +
      '"></span>matches a template step</span>' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + CONF_AMBER +
      '"></span>off-template</span>';
  if (conf.missing && conf.missing.length) {
    html += '<span class="lg-item lg-missing">Template steps not seen: ' +
      conf.missing.map(escapeHtml).join(", ") + "</span>";
  }
  host.innerHTML = html;
}

/* ============ H2: two-session side-by-side comparison ============= */

/* Render two sessions' step timelines stacked, for a direct visual
   comparison. Shared step names render green, divergent ones amber.
   Triggered by the "Compare side-by-side" button and the align toggle;
   no-ops unless exactly two sessions are loaded. */
function renderSideBySide() {
  const container = document.getElementById("side-by-side-container");
  const summary = document.getElementById("side-by-side-summary");
  if (!container) return;
  const sessions = filteredAggregateSessions();
  if (sessions.length !== 2) {
    container.innerHTML = "";
    if (summary) summary.textContent = "";
    return;
  }
  container.innerHTML = "";
  const [a, b] = sessions;
  const usable = (s) => (((s.annotations || {}).steps) || [])
    .filter((st) => st.time_range && st.time_range.start && st.time_range.end);
  const stepsA = usable(a);
  const stepsB = usable(b);
  if (!stepsA.length && !stepsB.length) {
    if (summary) summary.textContent =
      "Neither session has steps yet — analyze them first.";
    return;
  }
  const namesA = new Set(stepsA.map((s) => s.name));
  const namesB = new Set(stepsB.map((s) => s.name));
  const shared = (name) => namesA.has(name) && namesB.has(name);

  function firstCaseStart(sess, steps) {
    const cs = (((sess.stats || {}).case_stats) || [])
      .filter((c) => !c.parent_case_id && c.start_ts)
      .map((c) => new Date(c.start_ts).getTime())
      .filter((t) => isFinite(t));
    if (cs.length) return Math.min(...cs);
    return steps.length
      ? Math.min(...steps.map((s) => new Date(s.time_range.start).getTime()))
      : 0;
  }
  let spanA, spanB;
  if (_sxsAlign === "time" || !stepsA.length || !stepsB.length) {
    // Shared wall-clock window: equal time maps to equal x in both strips.
    const all = [...stepsA, ...stepsB];
    const starts = all.map((s) => new Date(s.time_range.start).getTime());
    const ends = all.map((s) => new Date(s.time_range.end).getTime());
    const span = { startMs: Math.min(...starts), endMs: Math.max(...ends) };
    spanA = span; spanB = span;
  } else {
    // Anchor each session at its first case start; both spans share the
    // same duration so equal elapsed-since-case-start lines up.
    const anchorA = firstCaseStart(a, stepsA);
    const anchorB = firstCaseStart(b, stepsB);
    const endA = Math.max(...stepsA.map((s) => new Date(s.time_range.end).getTime()));
    const endB = Math.max(...stepsB.map((s) => new Date(s.time_range.end).getTime()));
    const dur = Math.max(1, endA - anchorA, endB - anchorB);
    spanA = { startMs: anchorA, endMs: anchorA + dur };
    spanB = { startMs: anchorB, endMs: anchorB + dur };
  }
  function items(steps) {
    return steps.map((s) => ({
      id: s.step_id,
      startMs: new Date(s.time_range.start).getTime(),
      endMs: new Date(s.time_range.end).getTime(),
      label: s.name || "",
      color: shared(s.name) ? CONF_GREEN : CONF_AMBER,
      title: (s.name || "step") + (shared(s.name) ? " (in both sessions)" : " (only this session)"),
    }));
  }
  function strip(sess, steps, label, span) {
    const lbl = document.createElement("div");
    lbl.className = "sxs-strip-label";
    lbl.textContent = label + " — " + sessionName(sess) + " · " + sessionWorker(sess);
    container.appendChild(lbl);
    const scroll = document.createElement("div");
    scroll.className = "mini-timeline-scroll sxs-strip";
    const tl = document.createElement("div");
    tl.className = "timeline";
    scroll.appendChild(tl);
    container.appendChild(scroll);
    TimelineCore.renderMiniTimeline(tl, {
      items: items(steps), span,
      maxLanes: 4, laneHeight: 18,
      blockClass: "step-block", labelClass: "step-block-label",
      idAttr: "data-step-id",
    });
  }
  strip(a, stepsA, "Session A", spanA);
  strip(b, stepsB, "Session B", spanB);

  if (summary) {
    const sharedNames = [...namesA].filter((n) => namesB.has(n));
    const onlyA = [...namesA].filter((n) => !namesB.has(n));
    const onlyB = [...namesB].filter((n) => !namesA.has(n));
    const parts = [sharedNames.length + " step name(s) appear in both sessions."];
    if (onlyA.length) parts.push("Only in A: " + onlyA.join(", ") + ".");
    if (onlyB.length) parts.push("Only in B: " + onlyB.join(", ") + ".");
    if (!onlyA.length && !onlyB.length && sharedNames.length) {
      parts.push("Both sessions ran the same set of steps.");
    }
    summary.textContent = parts.join(" ");
  }
}

/* ============ Drill-down from aggregate to session ================ */

async function drillToActivity(activityLabel, fromEvent) {
  if (!activityLabel) return;
  // P1.5: collect every matching activity event across all loaded
  // sessions, not just the first session that mentions the label.
  // The picker lists those moments to drill into and (Phase 3) offers
  // a Reclassify action for the activity.
  const matches = [];
  for (const sess of State.getAggregateSessions()) {
    const stats = sess.stats;
    if (!stats) continue;
    const hit = (stats.activity_stats || []).find((r) => r.activity_label === activityLabel);
    if (!hit) continue;
    const ev = findFirstActivityByLabel(sess, activityLabel);
    if (!ev) continue;
    matches.push({
      sessionFolder: sess.sessionFolder,
      sessionName: sess.sessionFolder.split(/[\\/]/).pop(),
      timestamp: ev.timestamp,
      app: ev.data.app || "",
      title: ev.data.title || "",
    });
  }
  if (!matches.length) {
    toast("No loaded session contains " + activityLabel, "error");
    return;
  }
  // Always open the picker -- even for a single match -- so the
  // Reclassify action is reachable from every map node.
  showDfgDrillPicker(matches, activityLabel, fromEvent);
}

async function _drillTo(match, activityLabel) {
  await onDrillToSession(match.sessionFolder, match.timestamp);
  if (match.timestamp) {
    toast("Drilled to " + activityLabel + " in " + match.sessionName, "success");
  }
}

function showDfgDrillPicker(matches, activityLabel, fromEvent) {
  // Tear down any prior picker.
  const prior = document.getElementById("dfg-drill-picker");
  if (prior) prior.remove();

  const picker = document.createElement("div");
  picker.id = "dfg-drill-picker";
  picker.className = "dfg-drill-popup";
  // Position near the click if we have one, else center on viewer.
  let x = window.innerWidth / 2 - 200;
  let y = window.innerHeight / 2 - 100;
  if (fromEvent && typeof fromEvent.clientX === "number") {
    x = Math.min(fromEvent.clientX, window.innerWidth - 460);
    y = Math.min(fromEvent.clientY, window.innerHeight - 320);
  }
  picker.style.left = Math.max(8, x) + "px";
  picker.style.top  = Math.max(8, y) + "px";
  const rowsHtml = matches.map((m, i) =>
    '<div class="row' + (i === 0 ? " sel" : "") + '" data-idx="' + i + '">' +
    '<span class="ts">' + new Date(m.timestamp).toLocaleString() + '</span>' +
    '<span class="name"><strong>' + escapeHtml(m.sessionName) + '</strong>' +
    (m.title ? ' — ' + escapeHtml(m.title) : '') + '</span>' +
    '</div>'
  ).join("");
  picker.innerHTML =
    '<div class="dfg-drill-head">' +
    '<span class="lbl" title="' + escapeAttr(activityLabel) + '">' + escapeHtml(activityLabel) + '</span>' +
    '<button type="button" class="dfg-drill-reclassify">Reclassify…</button>' +
    '</div>' + rowsHtml;
  document.body.appendChild(picker);

  let selIdx = 0;
  function setSel(i) {
    selIdx = Math.max(0, Math.min(matches.length - 1, i));
    picker.querySelectorAll(".row").forEach((r, ri) => r.classList.toggle("sel", ri === selIdx));
  }
  function pick(i) {
    cleanup();
    _drillTo(matches[i], activityLabel);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(selIdx + 1); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setSel(selIdx - 1); }
    else if (e.key === "Enter")     { e.preventDefault(); pick(selIdx); }
  }
  function onMouse(e) {
    if (!picker.contains(e.target)) cleanup();
  }
  function cleanup() {
    picker.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onMouse, true);
  }
  picker.querySelectorAll(".row").forEach((r) => {
    r.addEventListener("click", () => pick(parseInt(r.dataset.idx, 10)));
    r.addEventListener("mouseenter", () => setSel(parseInt(r.dataset.idx, 10)));
  });
  const reBtn = picker.querySelector(".dfg-drill-reclassify");
  if (reBtn) {
    reBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      reclassifyActivity(activityLabel, matches);
    });
  }
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("mousedown", onMouse, true), 0);
}

/* Phase 3: capture an analyst classification correction from a map node.
   Writes a rule-scoped classification override into every loaded
   session's annotations.json, then re-runs the analyze pipeline so the
   corrected label flows through to the process map. */
async function reclassifyActivity(activityLabel, matches) {
  const sessions = State.getAggregateSessions();
  if (!sessions.length) return;
  // Existing labels across loaded sessions -> datalist, so the analyst is
  // nudged toward an existing canonical string, not a near-duplicate.
  const known = new Set();
  for (const s of sessions) {
    for (const r of (((s.stats || {}).activity_stats) || [])) {
      if (r.activity_label) known.add(r.activity_label);
    }
  }
  // The node's app, when every sampled occurrence shares one (always true
  // for an "Unclassified -- <app>" node -- that label is built from app).
  const apps = [...new Set((matches || []).map((m) => m.app).filter(Boolean))];
  const app = apps.length === 1 ? apps[0] : "";
  const res = await formModal({
    title: "Reclassify activity",
    message: 'Currently labelled "' + activityLabel + '".',
    okLabel: "Apply & re-analyze",
    fields: [
      {
        key: "label", label: "New activity label", value: activityLabel,
        placeholder: "e.g. CRM -- Salesforce", options: [...known].sort(),
      },
      {
        key: "pattern", label: "Window-title pattern (regex)", value: ".*",
        placeholder: ".*",
        hint: app
          ? "Reclassifies " + app + " windows whose title matches. Use .* for every window in this activity."
          : "Reclassifies windows whose title matches this regex.",
      },
    ],
  });
  if (!res) return;
  const label = (res.label || "").trim();
  const pattern = (res.pattern || "").trim() || ".*";
  if (!label) { toast("Reclassify cancelled — no label entered", "error"); return; }
  try {
    new RegExp(pattern);
  } catch (e) {
    toast("Invalid title pattern: " + e.message, "error");
    return;
  }
  const override = {
    override_id: randomUUID(),
    scope: "rule",
    match: app ? { app, title_regex: pattern } : { title_regex: pattern },
    label,
    created_at: new Date().toISOString(),
  };
  let written = 0;
  for (const s of sessions) {
    try {
      const r = await Ipc.addClassificationOverride({
        sessionFolder: s.sessionFolder, override,
      });
      if (r && r.ok) written++;
    } catch (_) { /* per-session failure -- keep going */ }
  }
  if (!written) { toast("Could not save the classification override", "error"); return; }
  toast('Reclassified to "' + label + '" — re-analyzing…', "success");
  // Reuse the verified "Analyze all" flow: re-runs normalization for every
  // loaded session and re-renders the map with the override applied.
  const btn = document.getElementById("btn-normalize-all");
  if (btn) btn.click();
}

function findFirstActivityByLabel(session, activityLabel) {
  /* Heuristic match: the label format from sample-taxonomy.yaml is
     usually "<Group> -- <App>" or similar. Pull the trailing token
     after "--" and match against event app strings. Best-effort. */
  if (!session || !session.events) return null;
  const tail = (activityLabel.split("--").pop() || "").trim().toLowerCase();
  for (const ev of session.events) {
    if (ev.type !== "activity") continue;
    const app = (ev.data.app || "").toLowerCase();
    const title = (ev.data.title || "").toLowerCase();
    if (tail && (app.includes(tail) || title.includes(tail))) return ev;
  }
  // Fallback: just the first activity event
  return session.events.find((e) => e.type === "activity") || null;
}

/* Wire the aggregate surface. onDrillToSession(folder, timestamp) is
   injected by renderer.js. Call once at boot. */
function initAggregateView(opts) {
  onDrillToSession = (opts && opts.onDrillToSession) || (async () => {});
  wireMapTabs();
  wireAggregateControls();
  // P0.2: BPMN is the default tab, so the level dropdown starts at Activity.
  syncMapLevelControl();
}

module.exports = { initAggregateView, renderAggregate, openMultiFlow, filteredAggregateSessions };
