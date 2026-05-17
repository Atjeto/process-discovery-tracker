"use strict";

/*
 * session-summary.js -- pure derivations for the Session view's summary
 * panel (Phase A) and the Compare-Sessions outlier flag.
 *
 * No DOM, no requires: every function takes plain data and returns plain
 * data, so the rendering code (views/flow-view.js, views/aggregate-view.js,
 * step-editor.js) and the node:test suite share the same logic. Formatting
 * (durations, dates, HTML) is the caller's job -- this module only computes.
 */

/* The pipeline tracks four step states (auto_suggested, auto_matched,
   manually_authored, edited) plus `hidden`. The analyst only needs the
   distinction between "the tool guessed this" and "a human stands behind
   this" -- collapse to that. */
function stepStateLabel(state) {
  switch (state) {
    case "auto_suggested":
    case "auto_matched":
      return "Auto-detected";
    case "manually_authored":
    case "edited":
      return "Confirmed";
    case "hidden":
      return "Hidden";
    default:
      return state || "—";
  }
}

function isAutoState(state) {
  return state === "auto_suggested" || state === "auto_matched";
}

/* Wall-clock span between the first and last event, in ms. Assumes the
   event list is timestamp-ordered (it is: single-writer append on
   capture, defensive sort in normalization). */
function eventSpanMs(events) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const first = Date.parse(events[0].timestamp);
  const last = Date.parse(events[events.length - 1].timestamp);
  if (!isFinite(first) || !isFinite(last)) return 0;
  return Math.max(0, last - first);
}

/* Linear-interpolated percentile over an already-sorted numeric array. */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* Build the data behind the session summary panel. Returns null when the
   session has not been analyzed yet (no stats.json) -- the caller hides
   the panel and the existing onboarding card covers that state. */
function computeSummary(session) {
  if (!session || !session.stats || !session.stats.meta) return null;
  const stats = session.stats;
  const meta = stats.meta || {};
  const events = Array.isArray(session.events) ? session.events : [];
  const manifest = session.manifest || {};

  /* App switches + longest single-app stretch, from activity events.
     Consecutive activity events already differ in (app, pid) -- a change
     in `app` is a genuine application switch. */
  const activities = events.filter((e) => e && e.type === "activity");
  let appSwitches = 0;
  let prevApp = null;
  let runApp = null;
  let runMs = 0;
  const longest = { app: null, ms: 0 };
  for (const e of activities) {
    const app = (e.data && e.data.app) || "";
    const dur = (e.data && e.data.duration_ms) || 0;
    if (prevApp !== null && app !== prevApp) appSwitches++;
    prevApp = app;
    if (app === runApp) {
      runMs += dur;
    } else {
      runApp = app;
      runMs = dur;
    }
    if (runMs > longest.ms) {
      longest.ms = runMs;
      longest.app = runApp;
    }
  }

  /* Where the time went: per-activity-label totals, ranked, with each
     share as a fraction of total classified activity time. */
  const actStats = Array.isArray(stats.activity_stats) ? stats.activity_stats : [];
  const totalActivityMs = actStats.reduce(
    (sum, r) => sum + (r.total_duration_ms || 0), 0);
  const topActivities = actStats
    .slice()
    .sort((a, b) => (b.total_duration_ms || 0) - (a.total_duration_ms || 0))
    .slice(0, 5)
    .map((r) => ({
      label: r.activity_label || "(unclassified)",
      ms: r.total_duration_ms || 0,
      pct: totalActivityMs > 0 ? (r.total_duration_ms || 0) / totalActivityMs : 0,
    }));

  /* Top-level cases, longest first. */
  const caseStats = Array.isArray(stats.case_stats) ? stats.case_stats : [];
  const topLevelCases = caseStats.filter((c) => !c.parent_case_id);
  const topCases = topLevelCases
    .slice()
    .sort((a, b) => (b.wall_clock_ms || 0) - (a.wall_clock_ms || 0))
    .slice(0, 3)
    .map((c) => ({ label: c.label || c.case_id || "case", ms: c.wall_clock_ms || 0 }));

  const breakdown = meta.step_state_breakdown || {};
  const autoSteps = (breakdown.auto_suggested || 0) + (breakdown.auto_matched || 0);
  const confirmedSteps = (breakdown.manually_authored || 0) + (breakdown.edited || 0);

  /* Cluster N: the process efficiency ratio from the analysis.json
     sidecar, when the session was analyzed with the analysis layer. */
  const eff = session.analysis && session.analysis.efficiency;
  const efficiencyRatio =
    eff && typeof eff.process_efficiency_ratio === "number"
      ? eff.process_efficiency_ratio
      : null;

  return {
    engagement: manifest.engagement_id || "—",
    worker:
      meta.worker_id ||
      (manifest.config && manifest.config.worker && manifest.config.worker.id) ||
      "unknown worker",
    durationMs: eventSpanMs(events),
    analyzedAt: meta.normalization_run_at || null,
    caseCount: typeof meta.case_count === "number" ? meta.case_count : topLevelCases.length,
    topCases,
    eventCount: typeof meta.raw_event_count === "number" ? meta.raw_event_count : events.length,
    activityCount: activities.length,
    interactionCount: meta.interaction_count || 0,
    stepCount: meta.step_count || 0,
    autoSteps,
    confirmedSteps,
    phaseCount: meta.phase_count || 0,
    matchedInteractions: meta.matched_interactions || 0,
    matchRate: typeof meta.match_rate === "number" ? meta.match_rate : null,
    hasTemplate: !!meta.canonical_process_id,
    canonicalDrift: meta.canonical_drift || null,
    topActivities,
    appSwitches,
    longestStretch: { app: longest.app, ms: longest.ms },
    efficiencyRatio,
  };
}

/* Walk the marker stream and flag the three problems an analyst inherits
   from an imperfect Start/End recording:
   - dangling_start: a Start that never got a matching End.
   - orphan_end:     an End with no open Start to close.
   - short_case:     a Start/End pair shorter than `shortCaseMs` (default
                     5s) -- usually an accidental double-press.
   Returns plain objects; the caller renders the message and any fix. */
function detectMarkerProblems(events, opts) {
  opts = opts || {};
  const shortCaseMs = typeof opts.shortCaseMs === "number" ? opts.shortCaseMs : 5000;
  const markers = (Array.isArray(events) ? events : []).filter(
    (e) => e && e.type === "marker");
  const problems = [];
  const stack = [];
  for (const m of markers) {
    const mt = m.data && m.data.marker_type;
    if (mt === "start") {
      stack.push(m);
    } else if (mt === "end") {
      if (stack.length) {
        const start = stack.pop();
        const startMs = Date.parse(start.timestamp);
        const endMs = Date.parse(m.timestamp);
        if (isFinite(startMs) && isFinite(endMs) && endMs - startMs < shortCaseMs) {
          problems.push({
            kind: "short_case",
            label: (start.data && start.data.label) || null,
            timestamp: start.timestamp,
            durationMs: endMs - startMs,
          });
        }
      } else {
        problems.push({
          kind: "orphan_end",
          timestamp: m.timestamp,
          eventId: m.event_id || null,
        });
      }
    }
  }
  for (const start of stack) {
    problems.push({
      kind: "dangling_start",
      label: (start.data && start.data.label) || null,
      timestamp: start.timestamp,
      eventId: start.event_id || null,
    });
  }
  return problems;
}

/* Flag sessions whose total duration is a statistical outlier among a
   loaded set, using a Tukey-style fence around the median. Returns
   `[{ index, durationMs, ratio }]` indexing back into `durations`.
   Needs at least 3 sessions; returns [] when the spread is degenerate
   (all-equal durations) so a uniform set raises no false alarm. */
function detectDurationOutliers(durations) {
  const list = Array.isArray(durations) ? durations : [];
  const valid = list.filter((d) => typeof d === "number" && isFinite(d) && d > 0);
  if (valid.length < 3) return [];
  const sorted = valid.slice().sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const iqr = percentile(sorted, 0.75) - percentile(sorted, 0.25);
  if (iqr <= 0 || median <= 0) return [];
  const out = [];
  list.forEach((d, index) => {
    if (typeof d !== "number" || !isFinite(d) || d <= 0) return;
    if (Math.abs(d - median) > 1.5 * iqr) {
      out.push({ index, durationMs: d, ratio: d / median });
    }
  });
  return out;
}

module.exports = {
  stepStateLabel,
  isAutoState,
  eventSpanMs,
  percentile,
  computeSummary,
  detectMarkerProblems,
  detectDurationOutliers,
};
