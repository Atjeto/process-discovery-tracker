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
const { formModal } = require("../modals.js");
const SessionSummary = require("../session-summary.js");

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

function wireMapTabs() {
  $$(".panel-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".panel-tab").forEach((t) => t.classList.toggle("active", t === tab));
      const which = tab.dataset.map;
      $("#bpmn-host").style.display = which === "bpmn" ? "" : "none";
      $("#dfg-host").style.display = which === "dfg" ? "" : "none";
      setMapZoomVisible(which === "dfg");
      setTimeout(() => {
        if (which === "bpmn" && PdtBpmn) PdtBpmn.fit();
        if (which === "dfg" && PdtDfg) {
          PdtDfg.fit();
          setMapZoomPct(PdtDfg.getZoom());
        }
      }, 50);
    });
  });

  const btnDfgZoomIn = document.getElementById("btn-dfg-zoom-in");
  const btnDfgZoomOut = document.getElementById("btn-dfg-zoom-out");
  const btnDfgZoomFit = document.getElementById("btn-dfg-zoom-fit");
  if (btnDfgZoomIn) btnDfgZoomIn.addEventListener("click", () => {
    if (PdtDfg) { PdtDfg.zoomIn(); setMapZoomPct(PdtDfg.getZoom()); }
  });
  if (btnDfgZoomOut) btnDfgZoomOut.addEventListener("click", () => {
    if (PdtDfg) { PdtDfg.zoomOut(); setMapZoomPct(PdtDfg.getZoom()); }
  });
  if (btnDfgZoomFit) btnDfgZoomFit.addEventListener("click", () => {
    if (PdtDfg) { PdtDfg.fit(); setMapZoomPct(PdtDfg.getZoom()); }
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

function renderAggregate() {
  // Pills - count filtered + total
  const filtered = filteredAggregateSessions();
  renderOutlierBanner(filtered);
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
  PdtCharts.renderBarChart($("#activity-chart"),
    actRows.map((r) => ({
      label: r.activity_label,
      value: r.frequency,
      valueLabel: r.frequency + " · " + PdtCharts.fmtDurationS(r.total_duration_ms / 1000),
      sparkline: sparkSpan ? r.sparkline : null,
    })),
    { unit: "" });

  // Case durations: bar chart, active duration with wall-clock overlay
  const caseRows = [];
  for (const st of allStats) {
    for (const r of (st.case_stats || [])) {
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
  const varAgg = new Map();   // variantStr -> { freq, length, sessions }
  for (const st of allStats) {
    const sessId = ((st.meta || {}).session_id) || "?";
    for (const v of (st.trace_variants || [])) {
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

  // Variant data for the DFG variant-overlay (Phase E). Each variant is
  // an ordered activity list; the DFG renderer uses these to highlight
  // the paths through a hovered node.
  const variantsForDfg = varRows.slice(0, 80).map((r) => ({
    variant: r.variant.split(" → "),
    frequency: r.freq,
  }));

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

  // BPMN + DFG render from the first available session
  const sessionWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  if (sessionWithBpmn && PdtBpmn) {
    PdtBpmn.render($("#bpmn-host"),
      path.join(sessionWithBpmn.sessionFolder, "process_map.bpmn"),
      { onNodeClick: (activityLabel) => drillToActivity(activityLabel) });
  }
  // Merge DFG edges across the filtered sessions
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
  if (edgeMap.size && PdtDfg) {
    const dfg = {
      edges: [...edgeMap.entries()].map(([k, freq]) => {
        const [source, target] = k.split("\x00");
        return { source, target, frequency: freq };
      }),
      start_activities: Object.fromEntries(starts),
      end_activities: Object.fromEntries(ends),
    };
    PdtDfg.render($("#dfg-host"), dfg, {
      onNodeClick: (activityLabel, ev) => drillToActivity(activityLabel, ev),
      onZoomChange: (z) => setMapZoomPct(z),
      // Phase E: variant overlay. Hovering a node highlights the
      // session paths (variants) that pass through that activity.
      variants: variantsForDfg,
    });
    // Show zoom controls if the DFG tab is currently active
    const dfgTabActive = document.querySelector('.panel-tab.active')?.dataset.map === "dfg";
    setMapZoomVisible(dfgTabActive);
  }

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
}

module.exports = { initAggregateView, renderAggregate, openMultiFlow, filteredAggregateSessions };
