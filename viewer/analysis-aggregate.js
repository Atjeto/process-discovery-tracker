"use strict";

/*
 * analysis-aggregate.js -- pure cross-session rollup of the per-session
 * analysis.json sidecars, for the Compare-Sessions Analysis panel.
 *
 * No DOM, no requires: aggregateAnalysis(sessions) takes loaded session
 * objects ({ analysis, manifest, stats, sessionFolder }) and returns plain
 * data, so views/aggregate-view.js and the node:test suite share the
 * logic. Mirrors session-summary.js. See ANALYSIS-LAYER-FOLLOWUPS.md.
 *
 * Per-session automation scoring is weak -- a step seen once cannot be
 * judged for repetitiveness. Pooled across many recordings of the same
 * process it gains real signal: instances add up, and each session's
 * `sequence_signature` (how the step was performed) can be compared.
 *
 * Steps are matched across sessions by `canonical_step_id`, falling back
 * to the step name when a session was not matched to a Process Template
 * -- the same cross-session key the side-by-side comparison relies on.
 */

function _round(x, dp) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

/* Worker who recorded a session -- stats meta wins, then the manifest
   config block. Same precedence as aggregate-view.js / session-summary.js. */
function _worker(s) {
  const meta = (s && s.stats && s.stats.meta) || {};
  const m = (s && s.manifest) || {};
  return meta.worker_id ||
    (m.config && m.config.worker && m.config.worker.id) ||
    m.worker || "unknown worker";
}

function _sessionName(s) {
  if (!s) return "session";
  const base = String(s.sessionFolder || "").split(/[\\/]/).filter(Boolean).pop();
  return base || (s.manifest && s.manifest.session_id) || "session";
}

/* The key a step is pooled under across sessions: its canonical id when
   a Process Template was matched, else its name. */
function _stepKey(entry) {
  return entry.canonical_step_id || entry.name || "";
}

/* Aggregate the analysis.json sidecars of the loaded sessions. Returns
   { sessionCount, time_study, by_worker, automation, efficiency_trend };
   sessions with no `analysis` are ignored. */
function aggregateAnalysis(sessions) {
  const loaded = (sessions || []).filter((s) => s && s.analysis);
  const result = {
    sessionCount: loaded.length,
    time_study: [],
    by_worker: [],
    automation: [],
    efficiency_trend: [],
  };
  if (!loaded.length) return result;

  // ---- Cross-session time study -----------------------------------
  // Pool step instances by key. The per-session mean times the session's
  // instance count is that session's total elapsed, so summing those and
  // dividing by the pooled instance count gives the true pooled mean.
  const tsGroups = new Map();
  for (const s of loaded) {
    for (const t of (s.analysis.time_study || [])) {
      const key = _stepKey(t);
      if (!key) continue;
      let g = tsGroups.get(key);
      if (!g) {
        g = { key, name: t.name || key, sessions: 0, instances: 0,
              totalElapsed: 0, min: Infinity, max: 0,
              active_ms: 0, waiting_ms: 0, switching_ms: 0 };
        tsGroups.set(key, g);
      }
      const inst = t.instances || 0;
      const c = t.cycle_ms || {};
      g.sessions += 1;
      g.instances += inst;
      g.totalElapsed += (c.mean || 0) * inst;
      if (typeof c.min === "number") g.min = Math.min(g.min, c.min);
      if (typeof c.max === "number") g.max = Math.max(g.max, c.max);
      g.active_ms += t.active_ms || 0;
      g.waiting_ms += t.waiting_ms || 0;
      g.switching_ms += t.switching_ms || 0;
      if (t.name) g.name = t.name;
    }
  }
  result.time_study = [...tsGroups.values()].map((g) => ({
    key: g.key,
    name: g.name,
    sessions: g.sessions,
    instances: g.instances,
    cycle_ms: {
      mean: g.instances ? Math.round(g.totalElapsed / g.instances) : 0,
      min: g.min === Infinity ? 0 : Math.round(g.min),
      max: Math.round(g.max),
    },
    active_ms: Math.round(g.active_ms),
    waiting_ms: Math.round(g.waiting_ms),
    switching_ms: Math.round(g.switching_ms),
  })).sort((a, b) => b.cycle_ms.mean - a.cycle_ms.mean);

  // ---- Per-worker comparison --------------------------------------
  const workerMap = new Map();
  for (const s of loaded) {
    const w = _worker(s);
    let steps = workerMap.get(w);
    if (!steps) { steps = new Map(); workerMap.set(w, steps); }
    for (const t of (s.analysis.time_study || [])) {
      const key = _stepKey(t);
      if (!key) continue;
      let e = steps.get(key);
      if (!e) { e = { key, name: t.name || key, instances: 0, total: 0 }; steps.set(key, e); }
      const inst = t.instances || 0;
      e.instances += inst;
      e.total += ((t.cycle_ms || {}).mean || 0) * inst;
      if (t.name) e.name = t.name;
    }
  }
  result.by_worker = [...workerMap.entries()].map(([worker, steps]) => ({
    worker,
    steps: [...steps.values()].map((e) => ({
      key: e.key,
      name: e.name,
      instances: e.instances,
      mean_cycle_ms: e.instances ? Math.round(e.total / e.instances) : 0,
    })).sort((a, b) => b.mean_cycle_ms - a.mean_cycle_ms),
  })).sort((a, b) => a.worker.localeCompare(b.worker));

  // ---- Aggregated automation candidates ---------------------------
  // Each session contributes one signature per step (its modal way of
  // performing it). Across sessions, how many share the modal signature
  // is the cross-session repetitiveness; the distinct-signature count
  // drives rule-basedness -- the same formulas analysis_automation.py
  // uses per session, lifted to session granularity.
  const autoGroups = new Map();
  for (const s of loaded) {
    for (const a of (s.analysis.automation_candidates || [])) {
      const key = _stepKey(a);
      if (!key) continue;
      let g = autoGroups.get(key);
      if (!g) {
        g = { key, name: a.name || key, sessions: 0, instances: 0,
              volume: 0, signatures: [], confirmed: 0, dismissed: 0 };
        autoGroups.set(key, g);
      }
      g.sessions += 1;
      g.instances += a.instances || 0;
      g.volume += (a.scores && a.scores.volume) || 0;
      if (a.sequence_signature) g.signatures.push(a.sequence_signature);
      if (a.automation_confirmed === true) g.confirmed += 1;
      else if (a.automation_confirmed === false) g.dismissed += 1;
      if (a.name) g.name = a.name;
    }
  }
  result.automation = [...autoGroups.values()].map((g) => {
    let repetitiveness = null;
    let rule_based = null;
    if (g.signatures.length >= 2) {
      const counts = {};
      for (const sig of g.signatures) counts[sig] = (counts[sig] || 0) + 1;
      const modal = Math.max(...Object.values(counts));
      repetitiveness = _round(modal / g.signatures.length, 3);
      rule_based = _round(1 / Object.keys(counts).length, 3);
    }
    return {
      key: g.key,
      name: g.name,
      sessions: g.sessions,
      instances: g.instances,
      volume: Math.round(g.volume),
      repetitiveness,
      rule_based,
      confirmed: g.confirmed,
      dismissed: g.dismissed,
      data_sufficiency: g.instances >= 2 ? "multi_instance" : "single_instance",
    };
  }).sort((a, b) =>
    (b.repetitiveness || 0) - (a.repetitiveness || 0) || b.volume - a.volume);

  // ---- Process-efficiency trend -----------------------------------
  result.efficiency_trend = loaded
    .map((s) => {
      const eff = s.analysis.efficiency || {};
      return {
        name: _sessionName(s),
        worker: _worker(s),
        startedAt: (s.manifest && s.manifest.started_at) || null,
        ratio: typeof eff.process_efficiency_ratio === "number"
          ? eff.process_efficiency_ratio : null,
      };
    })
    .filter((e) => e.ratio !== null)
    .sort((a, b) =>
      String(a.startedAt || "").localeCompare(String(b.startedAt || "")));

  return result;
}

module.exports = { aggregateAnalysis };
