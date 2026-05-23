/*
 * Markdown report generator for sessions + aggregates.
 *
 * Produces a Confluence-friendly Markdown report from in-memory
 * session data. Used by the "Export Markdown" buttons on both views.
 */

"use strict";

function fmtDuration(ms) {
  if (ms == null) return "-";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

function fmtTs(iso) {
  if (!iso) return "-";
  return iso.replace("T", " ").replace(/\.\d{3}Z?$/, "");
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildSessionReport(session) {
  const m = session.manifest || {};
  const stats = session.stats || {};
  const meta = stats.meta || {};
  const evs = session.events || [];
  const markers = evs.filter((e) => e.type === "marker");

  const lines = [];
  lines.push(`# Process Discovery Session Report`);
  lines.push("");
  lines.push(`**Engagement:** ${mdEscape(m.engagement_id || "-")}`);
  lines.push(`**Session:** ${mdEscape(m.session_id || "-")}`);
  lines.push(`**Started:** ${fmtTs(m.started_at)}`);
  lines.push(`**Ended:** ${fmtTs(m.ended_at)}`);
  lines.push(`**Status:** ${mdEscape(m.status || "-")}`);
  if (meta.worker_id) lines.push(`**Worker:** ${mdEscape(meta.worker_id)}`);
  if (meta.taxonomy_version) lines.push(`**Taxonomy version:** ${mdEscape(meta.taxonomy_version)}`);
  if (m.obs && m.obs.recording_path) {
    lines.push(`**OBS recording:** ${mdEscape(m.obs.recording_path)} (offset ${m.obs.offset_ms || 0}ms)`);
  }
  lines.push("");

  /* Summary */
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- Total events: ${evs.length}`);
  if (meta.collapsed_activity_count != null) {
    lines.push(`- Activity events after collapse: ${meta.collapsed_activity_count}`);
  }
  lines.push(`- Markers fired: ${markers.length}`);
  const shotCount = evs.filter((e) =>
    e.type === "system" && (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual")
  ).length;
  lines.push(`- Screenshots: ${shotCount}`);
  if (meta.case_count != null) lines.push(`- Cases identified: ${meta.case_count}`);
  if (meta.marker_edits_applied) lines.push(`- Annotation edits applied: ${meta.marker_edits_applied}`);
  lines.push("");

  /* Steps + analyst flags (A3) -- the analyst's annotations reach the report,
     not just the viewer. Hidden steps are left out. */
  const reportSteps = ((session.annotations || {}).steps || []).filter((s) => s.state !== "hidden");
  if (reportSteps.length) {
    lines.push(`## Steps`);
    lines.push("");
    lines.push(`| # | Step | Duration | Flags |`);
    lines.push(`|---|---|---:|---|`);
    reportSteps.forEach((s, i) => {
      const fl = s.flags || {};
      const flags = [
        fl.waste ? "waste" : null,
        fl.automation_candidate ? "automation" : null,
        fl.conditional ? "conditional" : null,
        fl.exception_path ? "exception" : null,
      ].filter(Boolean).join(", ");
      const tr = s.time_range || {};
      const durMs = (tr.start && tr.end) ? (new Date(tr.end) - new Date(tr.start)) : 0;
      lines.push(`| ${i + 1} | ${mdEscape(s.name || "(unnamed)")} ` +
        `| ${fmtDuration(durMs)} | ${mdEscape(flags)} |`);
    });
    lines.push("");
  }

  /* Cases / Markers timeline */
  if (markers.length) {
    lines.push(`## Markers`);
    lines.push("");
    lines.push(`| Time | Type | Label | Reason |`);
    lines.push(`|---|---|---|---|`);
    let depth = 0;
    for (const mk of markers) {
      if (mk.data.marker_type === "end") depth = Math.max(0, depth - 1);
      const indent = "  ".repeat(depth);
      lines.push(`| ${fmtTs(mk.timestamp)} | ${mk.data.marker_type} ` +
        `| ${indent}${mdEscape(mk.data.label || "(unlabeled)")} ` +
        `| ${mdEscape(mk.data.reason || "")} |`);
      if (mk.data.marker_type === "start") depth += 1;
    }
    lines.push("");
  }

  /* Per-activity statistics */
  if (stats.activity_stats && stats.activity_stats.length) {
    lines.push(`## Activity statistics`);
    lines.push("");
    lines.push(`| Activity | Frequency | Total time | Median | p90 |`);
    lines.push(`|---|---:|---:|---:|---:|`);
    for (const r of stats.activity_stats.slice(0, 25)) {
      lines.push(`| ${mdEscape(r.activity_label)} | ${r.frequency} ` +
        `| ${fmtDuration(r.total_duration_ms)} | ${fmtDuration(r.median_ms)} | ${fmtDuration(r.p90_ms)} |`);
    }
    lines.push("");
  }

  /* Per-step statistics -- the step-level analogue of the activity table, so
     the analyst's stepped view gets the same distribution (no split-brain). */
  if (stats.step_stats && stats.step_stats.length) {
    lines.push(`## Step statistics`);
    lines.push("");
    lines.push(`| Step | Frequency | Total time | Median | p90 |`);
    lines.push(`|---|---:|---:|---:|---:|`);
    for (const r of stats.step_stats.slice(0, 25)) {
      lines.push(`| ${mdEscape(r.step_name)} | ${r.frequency} ` +
        `| ${fmtDuration(r.total_duration_ms)} | ${fmtDuration(r.median_ms)} | ${fmtDuration(r.p90_ms)} |`);
    }
    lines.push("");
  }

  /* Cases */
  if (stats.case_stats && stats.case_stats.length) {
    lines.push(`## Cases`);
    lines.push("");
    lines.push(`| Case | Label | Wall-clock | Active | End reason |`);
    lines.push(`|---|---|---:|---:|---|`);
    for (const r of stats.case_stats) {
      if (r.parent_case_id) continue;
      lines.push(`| ${mdEscape(r.case_id.slice(0, 8))} | ${mdEscape(r.label || "")} ` +
        `| ${fmtDuration(r.wall_clock_ms)} | ${fmtDuration(r.active_ms)} | ${mdEscape(r.end_reason || "")} |`);
    }
    lines.push("");
  }

  /* Outliers + rework */
  if (stats.app_outliers && stats.app_outliers.length) {
    lines.push(`## App outliers (under 5% of cases)`);
    lines.push("");
    lines.push(`| App | Cases | % |`);
    lines.push(`|---|---:|---:|`);
    for (const r of stats.app_outliers) {
      lines.push(`| ${mdEscape(r.app)} | ${r.case_count} | ${r.case_pct}% |`);
    }
    lines.push("");
  }
  if (stats.rework_loops && stats.rework_loops.length) {
    lines.push(`## Rework loops`);
    lines.push("");
    lines.push(`| Activity | Repeats |`);
    lines.push(`|---|---:|`);
    for (const r of stats.rework_loops) {
      lines.push(`| ${mdEscape(r.activity_label)} | ${r.rework_count} |`);
    }
    lines.push("");
  }

  /* Footer */
  lines.push(`---`);
  lines.push(`Generated by Process Discovery Viewer on ${new Date().toISOString()}.`);
  return lines.join("\n");
}

function buildAggregateReport(sessions, mergedActivity, mergedCases, dfg) {
  const lines = [];
  lines.push(`# Process Discovery - Aggregate Report`);
  lines.push("");
  lines.push(`**Sessions included:** ${sessions.length}`);
  const earliest = sessions
    .map((s) => s.manifest && s.manifest.started_at)
    .filter(Boolean).sort()[0];
  const latest = sessions
    .map((s) => s.manifest && s.manifest.ended_at)
    .filter(Boolean).sort().slice(-1)[0];
  if (earliest) lines.push(`**Earliest session start:** ${fmtTs(earliest)}`);
  if (latest) lines.push(`**Latest session end:** ${fmtTs(latest)}`);
  lines.push("");

  lines.push(`## Sessions`);
  lines.push("");
  lines.push(`| Folder | Started | Status | Events | OBS |`);
  lines.push(`|---|---|---|---:|---|`);
  for (const s of sessions) {
    const m = s.manifest || {};
    const folder = s.sessionFolder.split(/[\\/]/).slice(-1)[0];
    lines.push(`| ${mdEscape(folder)} | ${fmtTs(m.started_at)} ` +
      `| ${mdEscape(m.status || "")} | ${(s.events || []).length} ` +
      `| ${m.obs && m.obs.recording_path ? "yes" : "no"} |`);
  }
  lines.push("");

  if (mergedActivity && mergedActivity.length) {
    lines.push(`## Activities (merged across sessions)`);
    lines.push("");
    lines.push(`| Activity | Total frequency | Total time |`);
    lines.push(`|---|---:|---:|`);
    for (const r of mergedActivity.slice(0, 40)) {
      lines.push(`| ${mdEscape(r.activity_label)} | ${r.frequency} | ${fmtDuration(r.total_duration_ms)} |`);
    }
    lines.push("");
  }

  if (mergedCases && mergedCases.length) {
    lines.push(`## Top cases by active duration`);
    lines.push("");
    lines.push(`| Case | Label | Wall-clock | Active |`);
    lines.push(`|---|---|---:|---:|`);
    for (const r of mergedCases.slice(0, 30)) {
      lines.push(`| ${mdEscape((r.case_id || "").slice(0, 8))} | ${mdEscape(r.label || "")} ` +
        `| ${fmtDuration(r.wall_clock_ms)} | ${fmtDuration(r.active_ms)} |`);
    }
    lines.push("");
  }

  if (dfg && dfg.edges && dfg.edges.length) {
    lines.push(`## Process flow (top transitions by frequency)`);
    lines.push("");
    lines.push(`| From | To | Count |`);
    lines.push(`|---|---|---:|`);
    const sorted = dfg.edges.slice().sort((a, b) => b.frequency - a.frequency).slice(0, 30);
    for (const e of sorted) {
      lines.push(`| ${mdEscape(e.source)} | ${mdEscape(e.target)} | ${e.frequency} |`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`Generated by Process Discovery Viewer on ${new Date().toISOString()}.`);
  return lines.join("\n");
}

module.exports = { buildSessionReport, buildAggregateReport };
