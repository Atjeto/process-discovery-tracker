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
const { detectVariantDivergence, pooledAlignment } = require("../variant-divergence.js");
const { findingCardHtml } = require("../finding-cards.js");

/* H2/H3 conformance colours -- must match dfg-viewer.js's CONF_*. */
const CONF_GREEN = "#4f9d5b";
const CONF_AMBER = "#cf9233";

/* Injected by renderer.js -- activates the Session tab, loads a
   session folder, and seeks to a timestamp. */
let onDrillToSession = async () => {};

/* ============ Map sub-tabs ======================================== */

/* The interactive process map (notation × level × drill scope × rare-path
   cutoff) lives in map-controller.js so the Session view's "Map" level can
   mount the same UI over its single-session data source. aggregate-view's job
   here is to be the DATA SOURCE -- pulling DFG / BPMN-path / variants /
   conformance from the cached multi-session aggregate state (_lastActivityDfg,
   _lastFilteredForMap, _lastVariantsForMap, _lastConformance, _dfgConformance
   / _lastConfActive set up in renderAggregate). */

const { createMapController } = require("../map-controller.js");

let _mapCtrl = null;   // lazily created in initAggregateView

/* P0.2: notation (Process diagram = BPMN, Flow diagram = DFG) and level
   (Activity / Step / Phase) are fully orthogonal. The matrix:
     BPMN × activity   -> process_map.bpmn (PM4Py inductive miner)
     BPMN × step/phase -> process_map_step|phase.bpmn (observed flow mined from
                          the annotations -- normalization/bpmn_observed.py)
     DFG  × activity   -> the merged taxonomy DFG (_lastActivityDfg)
     DFG  × step/phase -> buildAnnotationDfg (live from the annotations) */

/* Session-folder BPMN filename for a grain notch (ADR-0024). The observed-flow
   BPMN is mined only at the element (=step) and phase grains; screen/app/case
   have no Process diagram and fall back to the Flow diagram. */
function _bpmnFileForLevel(level) {
  return (level === "step" || level === "element") ? "process_map_step.bpmn"
       : level === "phase" ? "process_map_phase.bpmn"
       : level === "activity" ? "process_map.bpmn"
       : null;   // screen / app / case -> no Process diagram
}
/* First loaded session that has a BPMN at the given level -- the BPMN pane
   shows one representative session, as the activity map always has. */
function _firstSessionWithBpmn(level) {
  const fname = _bpmnFileForLevel(level);
  return (_lastFilteredForMap || []).find((s) =>
    s && s.sessionFolder && fs.existsSync(path.join(s.sessionFolder, fname))) || null;
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

/* Data source the controller calls on every render: returns the
   { dfg, variants, conformance, bpmnPath, emptyMessage } for the requested
   (notation × level × scope) cell. Pulls from the cached aggregate state set
   up by renderAggregate. */
function _aggregateMapDataSource({ notation, level, scope }) {
  if (notation === "bpmn") {
    // ADR-0024: screen/app/case have no pre-mined Process diagram — guide to the
    // Flow diagram rather than render a dead BPMN host.
    if (!_bpmnFileForLevel(level)) {
      return {
        emptyMessage: 'The Process diagram (BPMN) is mined at the Element and Phase grains. ' +
          'For the ' + level + ' grain, switch to the Flow diagram tab — it rolls up live.',
      };
    }
    const sess = _firstSessionWithBpmn(level);
    if (!sess) {
      return {
        emptyMessage: (level === "activity"
          ? 'No process map yet — click "Analyze all sessions".'
          : 'No ' + level + '-level Process diagram yet — Analyze a session that has ' +
            (level === "phase" ? "phases" : "steps") +
            ' (it is mined from your annotations).'),
      };
    }
    return { bpmnPath: path.join(sess.sessionFolder, _bpmnFileForLevel(level)) };
  }
  // notation === "dfg"
  if (level === "activity") {
    return {
      dfg: _lastActivityDfg,
      variants: _lastVariantsForMap,
      conformance: (_lastConfActive && _lastConformance) ? _lastConformance.status : null,
      emptyMessage: 'No activity-level flow yet — classify your apps in the taxonomy',
    };
  }
  // element / screen / app / phase / case — the grain ladder (ADR-0024), rolled
  // up live across the loaded sessions. Drill scope is the parent phase (when
  // descending phase->step on the element notch).
  const phaseFilter = (scope && scope.level === "step")
    ? { phaseName: scope.phaseName } : null;
  return {
    dfg: buildAnnotationDfg(_lastFilteredForMap || [], level, phaseFilter,
                            { caseLabel: (id) => id }),
    // §B2: grain-ladder edges are time-weighted (count stays in the tooltip).
    edgeWeight: "time",
    emptyMessage: 'No ' + level + '-grain flow yet — add steps to the loaded sessions',
  };
}

/* Lazily create the controller once the aggregate DOM exists (called from
   initAggregateView). Held at module scope so renderAggregate and the
   conformance toggle can call .render() / .setState() on it. */
function _initMapController() {
  if (_mapCtrl) return _mapCtrl;
  _mapCtrl = createMapController({
    hostBpmn: document.getElementById("bpmn-host"),
    hostDfg: document.getElementById("dfg-host"),
    notationTabs: Array.from(document.querySelectorAll(".aggregate-grid .panel-tab[data-map]")),
    levelSelect: document.getElementById("map-level"),
    scopeChip: document.getElementById("map-scope"),
    zoomControls: {
      in: document.getElementById("btn-dfg-zoom-in"),
      out: document.getElementById("btn-dfg-zoom-out"),
      fit: document.getElementById("btn-dfg-zoom-fit"),
      wrap: document.getElementById("map-zoom"),
      pct: document.getElementById("map-zoom-pct"),
    },
    rareSlider: {
      wrap: document.getElementById("hide-rare-wrap"),
      range: document.getElementById("rng-rare"),
      label: document.getElementById("hide-rare-lbl"),
    },
    dataSource: _aggregateMapDataSource,
    activityLabelsForStep: _activityLabelsForStep,
    onActivityNodeClick: (label, ev) => drillToActivity(label, ev),
    // ADR-0024: open at the shared grain notch (default "screen"), which has no
    // pre-mined BPMN, so default to the Flow diagram (it rolls up live).
    initialNotation: "dfg",
    initialLevel: State.getGrain(),
  });
  // Keep the shared grain in sync: choosing a grain notch in the map-level
  // select updates State.grain so the notion of grain is consistent across the
  // Session and Compare surfaces. "activity" is a Compare-only taxonomy view.
  const levelSel = document.getElementById("map-level");
  if (levelSel) {
    levelSel.value = State.getGrain();
    levelSel.addEventListener("change", () => {
      if (levelSel.value !== "activity") State.setGrain(levelSel.value);
    });
  }
  return _mapCtrl;
}

/* ============ Multi-session loading =============================== */

async function loadAggregateFolders(folders) {
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

async function openMultiFlow() {
  const folders = await Ipc.openMultipleSessions();
  await loadAggregateFolders(folders);
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
/* Cached map data: set by renderAggregate; read by the controller's
   dataSource (_aggregateMapDataSource) on every render. The map's own view
   state (notation × level × drill-scope × rare-path cutoff) lives inside the
   controller -- see map-controller.js. */
let _lastFilteredForMap = [];
let _lastVariantsForMap = null;
let _lastActivityDfg = null;
let _lastConformance = null;
let _lastConfActive = false;

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
  // §D2: the Compare surface leads with the divergence findings feed and
  // the aligned reading; the merged map renders below them.
  renderAggFindings(filtered);
  renderAggAligned(filtered);
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

  // Merge activity stats
  const actMap = new Map();
  for (const st of allStats) {
    for (const r of (st.activity_stats || [])) {
      const e = actMap.get(r.activity_label) || {
        activity_label: r.activity_label, frequency: 0, total_duration_ms: 0,
        median_samples: [], p90_samples: [],
      };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      e.median_samples.push(r.median_ms);
      e.p90_samples.push(r.p90_ms);
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
        title: "Filter the comparison to “" + r.activity_label + "”",
      })),
      { unit: "", onBarClick: (row) => {
        // Drill: filter the whole Compare surface (charts + variants) to this
        // activity. Inverse = clear the filter box. Reuses #agg-filter.
        const f = $("#agg-filter");
        if (f) { f.value = row.label; f.dispatchEvent(new Event("input", { bubbles: true })); }
      } });
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
      caseRows.push({
        label: (r.label || r.case_id.slice(0, 8)),
        value: (r.active_ms || 0) / 1000,
        secondary: (r.wall_clock_ms || 0) / 1000,
        valueLabel: PdtCharts.fmtDurationS((r.active_ms || 0) / 1000),
        color: showGrouping ? wColors.get(caseWorker) : undefined,
        meta: r,
        title: "Open this case in the Session view",
        caseSessionFolder: s.sessionFolder,
        caseId: r.case_id,
      });
    }
  }
  caseRows.sort((a, b) => b.value - a.value);
  PdtCharts.renderBarChart($("#case-chart"), caseRows, {
    color: "var(--accent-2)",
    secondaryColor: "var(--warn)",
    // Drill: open this case's source session in the Session view and seek the
    // Flow timeline to where the case begins. Reuses the activity-drill hook.
    onBarClick: (row) => {
      if (row.caseSessionFolder) {
        onDrillToSession(row.caseSessionFolder, (row.meta || {}).start_time || null);
      }
    },
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
    // Template. Stored so the controller's dataSource re-applies it across
    // re-renders.
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
  // Always clears any drill-down scope (a data refresh invalidates it).
  const ctrl = _initMapController();
  const ctrlState = ctrl.getState();
  const updates = { scope: null };
  if (ctrlState.level === "activity" && !(_lastActivityDfg && _lastActivityDfg.edges.length)) {
    const anyPhases = filtered.some((s) => ((s.annotations || {}).phases || []).length);
    const anySteps = filtered.some((s) => ((s.annotations || {}).steps || []).some((st) => st.state !== "hidden"));
    if (anyPhases) { updates.level = "phase"; updates.notation = "dfg"; }
    else if (anySteps) { updates.level = "step"; updates.notation = "dfg"; }
  }
  ctrl.setState(updates);   // re-renders the (notation × level × scope) cell

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
      // canonical_version comes from analyst-authored template YAML, so escape
      // it before it reaches innerHTML (XSS). `latest` is a numeric Math.max.
      banner.innerHTML =
        `Loaded sessions span ${versions.size} canonical versions ` +
        `(${escapeHtml([...versions].join(", "))}). Statistics may be inconsistent. ` +
        `<button id="btn-renormalize-to-latest">Re-normalize all to v${escapeHtml(String(latest))}</button>`;
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

/* ============ §D1/§D2: cross-session findings + aligned reading ==== */

/* The aggregate-level findings[] (additive, in-memory payload): computed
   fresh on every Compare render, cached only so the Markdown report
   export ships exactly what the panel showed. */
let _lastAggFindings = [];

/** The findings the Compare surface is currently showing (for export). */
function getAggregateFindings() {
  return _lastAggFindings.slice();
}

/* Per-unit breakdown line under a divergence card -- the evidence detail
   the scalar-number renderer can't reach (it lives in a nested array). */
function _divergenceDetailHtml(f) {
  const units = ((f.evidence || {}).per_unit) || [];
  if (!units.length) return "";
  const line = units.map((u) =>
    escapeHtml(u.label) + ": " + u.case_count + " case" + (u.case_count === 1 ? "" : "s") +
    " · median " + u.median_steps + " step" + (u.median_steps === 1 ? "" : "s") +
    " · " + u.variant_count + " variant" + (u.variant_count === 1 ? "" : "s")
  ).join('<span class="agg-vs"> ↔ </span>');
  return '<div class="ov-finding-evidence">' + line + "</div>";
}

/* §D2: Compare's TOP section -- the divergence findings feed, rendered
   with the same finding-card component as the Overview. Below the
   precondition (>= 2 Tier-2 sessions of the same process) the section
   shows the §1 replace-pattern note instead of empty authority. */
function renderAggFindings(sessions) {
  const panel = document.getElementById("agg-findings-panel");
  const host = document.getElementById("agg-findings-content");
  if (!panel || !host) return;
  let findings = [];
  try { findings = detectVariantDivergence(sessions) || []; }
  catch (_) { findings = []; }
  _lastAggFindings = findings;
  if (findings.length) {
    panel.style.display = "";
    host.innerHTML = findings.map((f) =>
      findingCardHtml(f, { detailHtml: _divergenceDetailHtml })).join("");
    return;
  }
  if ((sessions || []).length >= 2) {
    // Honest empty state: say what is missing, never render silence.
    panel.style.display = "";
    host.innerHTML = '<div class="analysis-note">No cross-session findings yet — ' +
      "the loaded sessions don't form a same-process, case-segmented pair. " +
      "Divergence is measured between ≥ 2 sessions that share a Process " +
      "Template or the same accepted case anchor, each with Tier-2 case " +
      "quality (markers, or an accepted anchor with ≥ 70% coverage — see the " +
      "session's Overview).</div>";
  } else {
    panel.style.display = "none";
  }
}

/* §D2: the aligned reading -- the Compare default for template-matched
   sessions. The pooled consensus backbone across every loaded case, with
   per-unit hit counts, ABOVE the merged map: how the process reads
   before it is drawn. Read-only here (curation lives in the Steps view's
   Aligned reading; the legend says so). */
function renderAggAligned(sessions) {
  const panel = document.getElementById("agg-aligned-panel");
  const host = document.getElementById("agg-aligned-content");
  if (!panel || !host) return;
  let pa = null;
  try { pa = pooledAlignment(sessions); }
  catch (_) { pa = null; }
  if (!pa || !pa.backbone.length) {
    panel.style.display = "none";
    host.innerHTML = "";
    return;
  }
  panel.style.display = "";
  const letters = "ABCDEFGH";
  const meta = document.getElementById("agg-aligned-meta");
  if (meta) {
    meta.textContent = pa.case_count + " cases · " +
      pa.units.map((u, i) => (letters[i] || "?") + " = " + u.label).join(" · ");
  }
  const rows = pa.backbone.map((r, i) => {
    const partial = r.frequency < pa.case_count;
    const per = r.per_unit_hits.map((h, ui) =>
      '<span title="' + escapeAttr(pa.units[ui].label) + '">' +
      (letters[ui] || "?") + " " + h + "/" + pa.units[ui].case_count + "</span>").join(" · ");
    return '<div class="backbone-row agg-bb-row">' +
      '<span class="bb-seq">' + (i + 1) + "</span>" +
      '<span class="bb-name" title="' + escapeAttr(r.token) + '">' + escapeHtml(r.token) + "</span>" +
      '<span class="agg-bb-units">' + per + "</span>" +
      '<span class="bb-freq' + (partial ? " partial" : "") + '" title="' +
        r.frequency + " of " + pa.case_count + ' cases include this step">' +
        r.frequency + "/" + pa.case_count + "</span>" +
      "</div>";
  }).join("");
  const excParts = [];
  pa.units.forEach((u, i) => {
    const uniq = [...new Set(u.exceptions || [])];
    if (uniq.length) {
      excParts.push((letters[i] || "?") + " only: " +
        uniq.slice(0, 4).map((t) => '"' + t + '"').join(", ") +
        (uniq.length > 4 ? " (+" + (uniq.length - 4) + " more)" : ""));
    }
  });
  const exc = excParts.length
    ? '<div class="bb-exceptions"><div class="bb-exc-head">Off-backbone steps</div>' +
      '<div class="analysis-note">' + escapeHtml(excParts.join(" · ")) + "</div></div>"
    : "";
  host.innerHTML = rows + exc +
    '<div class="analysis-note">Read-only here — curate the backbone in the ' +
    "Steps view's Aligned reading (open a session, Steps → Aligned).</div>";
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

function _aggTimeStudySection(agg) {
  if (!agg.time_study.length) return "";
  const title = '<div class="analysis-section-title">Cross-session time study</div>';
  // Where does the time actually go? Sort by active time and split off the
  // instant (0-duration) steps so this shows signal, not 30 rows of 0ms.
  const all = agg.time_study.slice().sort((a, b) =>
    (b.active_ms || 0) - (a.active_ms || 0) ||
    (b.cycle_ms.mean || 0) - (a.cycle_ms.mean || 0));
  const timed = all.filter((t) => (t.active_ms || 0) > 0 || (t.cycle_ms.mean || 0) > 0);
  const instant = all.length - timed.length;
  if (!timed.length) {
    return '<div class="analysis-section">' + title +
      '<div class="analysis-note">No measured step durations in the loaded session(s).</div></div>';
  }
  // Data-adaptive columns: show one only when it carries signal, so a
  // single-session view collapses to Step / Instances / Mean / Active.
  const multiSession = all.some((t) => t.sessions > 1);
  const hasSpread = timed.some((t) => t.cycle_ms.min !== t.cycle_ms.max);
  const anyWaiting = timed.some((t) => (t.waiting_ms || 0) > 0);
  const anySwitching = timed.some((t) => (t.switching_ms || 0) > 0);
  const head = ["<th>Step</th>"];
  if (multiSession) head.push("<th>Sessions</th>");
  head.push("<th>Instances</th>", "<th>Mean</th>");
  if (hasSpread) head.push("<th>Min</th>", "<th>Max</th>");
  head.push("<th>Active</th>");
  if (anyWaiting) head.push("<th>Waiting</th>");
  if (anySwitching) head.push("<th>Switching</th>");
  const rows = timed.map((t) => {
    const tds = ["<td>" + escapeHtml(t.name) + "</td>"];
    if (multiSession) tds.push('<td class="num">' + t.sessions + "</td>");
    tds.push('<td class="num">' + t.instances + "</td>",
             '<td class="num">' + _aggDur(t.cycle_ms.mean) + "</td>");
    if (hasSpread) tds.push('<td class="num">' + _aggDur(t.cycle_ms.min) + "</td>",
                            '<td class="num">' + _aggDur(t.cycle_ms.max) + "</td>");
    tds.push('<td class="num">' + _aggDur(t.active_ms) + "</td>");
    if (anyWaiting) tds.push('<td class="num">' + _aggDur(t.waiting_ms) + "</td>");
    if (anySwitching) tds.push('<td class="num">' + _aggDur(t.switching_ms) + "</td>");
    return "<tr>" + tds.join("") + "</tr>";
  }).join("");
  const note = instant
    ? '<div class="analysis-note">' + instant + " more step" + (instant === 1 ? "" : "s") +
      " had no measured duration (instant entries).</div>"
    : "";
  return '<div class="analysis-section">' + title +
    '<table class="analysis-table"><thead><tr>' + head.join("") +
    "</tr></thead><tbody>" + rows + "</tbody></table>" + note + "</div>";
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

/* Compare-Sessions automation panel at the segment grain (ADR-0016).
   Rows are coherent segments pooled across the loaded sessions; the
   strongest signal is "how many instances across how many sessions",
   not a per-click repetitiveness score. Single-instance segments fold
   into a tail note rather than fattening the table with empty rows. */
function _aggAutomationSection(agg) {
  if (!agg.automation.length) return "";
  const title = '<div class="analysis-section-title">Automation candidates (pooled)</div>';
  const intro = '<div class="analysis-caption">Candidacy is reported at the level ' +
    "of a coherent segment — a contiguous run of work in one app within one " +
    "case. Atomic clicks and keystrokes are not surfaced.</div>";
  const scored = agg.automation.filter((a) =>
    a.data_sufficiency === "multi_instance");
  if (!scored.length) {
    return '<div class="analysis-section">' + title + intro +
      '<div class="analysis-note">No segment was seen 2+ times across the ' +
      "loaded sessions. Load more recordings of the same process to surface " +
      "automation candidates.</div></div>";
  }
  const lonely = agg.automation.length - scored.length;
  const multiSession = scored.some((a) => a.sessions > 1);
  const anyDecision = scored.some((a) => a.confirmed || a.dismissed);
  const head = ["<th>Segment</th>", "<th>App</th>"];
  if (multiSession) head.push("<th>Sessions</th>");
  head.push("<th>Instances</th>", "<th>Total time</th>", "<th>Mean per instance</th>");
  if (anyDecision) head.push("<th>Analyst decision</th>");
  const rows = scored.map((a) => {
    const steps = (a.step_labels || []).slice(0, 5);
    const moreSteps = (a.step_labels || []).length - steps.length;
    const sequence = steps.length
      ? steps.map(escapeHtml).join('<span class="auto-arrow"> → </span>')
        + (moreSteps > 0 ? ' <span class="auto-more">+' + moreSteps + " more</span>" : "")
      : '<span class="score-na">no labelled steps</span>';
    const app = String(a.app || "").replace(/\.exe$/i, "") || "—";
    const tds = [
      '<td><div class="auto-label">' + escapeHtml(a.label || "(segment)") + "</div>" +
      '<div class="auto-sequence">' + sequence + "</div></td>",
      "<td>" + escapeHtml(app) + "</td>",
    ];
    if (multiSession) tds.push('<td class="num">' + a.sessions + "</td>");
    tds.push(
      '<td class="num">' + (a.instance_count || 0) + "</td>",
      '<td class="num">' + _aggDur(a.total_elapsed_ms) + "</td>",
      '<td class="num">' + _aggDur(a.mean_elapsed_ms) + "</td>"
    );
    if (anyDecision) {
      const parts = [];
      if (a.confirmed) parts.push(a.confirmed + " confirmed");
      if (a.dismissed) parts.push(a.dismissed + " dismissed");
      tds.push("<td>" + escapeHtml(parts.join(" · ") || "—") + "</td>");
    }
    return "<tr>" + tds.join("") + "</tr>";
  }).join("");
  const tail = lonely
    ? '<div class="analysis-note">' + lonely + " more segment" +
      (lonely === 1 ? "" : "s") + " occurred only once and aren't pooled here." +
      "</div>"
    : "";
  return '<div class="analysis-section">' + title + intro +
    '<table class="analysis-table"><thead><tr>' + head.join("") +
    "</tr></thead><tbody>" + rows + "</tbody></table>" + tail + "</div>";
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
  wireAggregateControls();
  // Build the map controller now that the aggregate DOM is in the document
  // (so its querySelector lookups resolve). Defaults: BPMN tab, Activity level.
  _initMapController();
}

module.exports = { initAggregateView, renderAggregate, openMultiFlow, loadAggregateFolders, filteredAggregateSessions, getAggregateFindings };
