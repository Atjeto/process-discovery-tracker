"use strict";

/*
 * process-map-levels.js -- build a directly-follows graph (DFG) from the
 * analyst's annotations (steps or phases) instead of taxonomy-classified
 * activity events (ADR-0010 C1b).
 *
 * Why: the activity-level DFG is empty until the taxonomy has rules for the
 * deployment's apps, so a fresh session shows only Start -> End. Steps and
 * phases come from the analyst's own annotations, so a step- or phase-level
 * map is meaningful with zero taxonomy.
 *
 * One trace per CASE gives the edges their frequency: a session with 12
 * repetitions of a ticket yields a real "this path 10/12 times" map rather
 * than a single line (one trace) or a hairball (all-unique). Consecutive
 * duplicate labels collapse, so a run of steps inside one phase becomes a
 * single phase node.
 *
 * Pure (no DOM, no cytoscape) so it is unit-testable. The output shape
 * matches dfg-viewer.js's input: { edges, start_activities, end_activities }.
 */

// A separator that cannot appear in a step or phase name. Built from a char
// code so no literal control byte sits in the source.
const SEP = String.fromCharCode(1);

// Value-free step label so repeated work across cases collapses to ONE node
// instead of one-per-instance (every case's order #, customer id, SKU, qty
// makes the raw name unique). The rewrite RULES are the SINGLE SOURCE in
// shared/process-label-patterns.json, loaded here AND by Python
// (step_suggest.process_label) so the live DFG, the observed-flow BPMN, and the
// stats collapse identically -- no two hand-synced regexes to drift. The JSON
// ships to resources/shared/ (build-package.js); `__dirname/../shared` resolves
// in dev and in the package, same as recognition.js.
const _labelPath = require("node:path").join(__dirname, "..", "shared", "process-label-patterns.json");
const _LABEL_RULES = require(_labelPath).rules.map(
  (r) => ({ re: new RegExp(r.pattern), replacement: r.replacement }));
function processLabel(name) {
  const s = (name || "").trim();
  if (!s) return s;
  // First rule that CHANGES the name wins (enter-in rewrite, else value-tail strip).
  for (const rule of _LABEL_RULES) {
    const out = s.replace(rule.re, rule.replacement);
    if (out !== s) return out.trim();
  }
  return s;
}

function _stepStart(st) {
  const t = (st && st.time_range && st.time_range.start) || null;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

/* ===== ADR-0024: view-time grain roll-up ============================== */

// The grain ladder, finest → coarsest. The map's level selector (ADR-0012's
// Activity/Step/Phase) folds into these notches: "element" is the finest "show
// every step" grain, "screen" is the default resting notch ("one step per
// screen"), and "phase"/"case" are the coarse ends. A node/step at a notch is a
// run of CONSECUTIVE steps within a case sharing that notch's key.
const GRAIN_NOTCHES = ["element", "screen", "app", "phase", "case"];
const DEFAULT_GRAIN = "screen";

// Most frequent non-empty string, ties broken by first appearance -- the JS
// twin of step_suggest._most_common (keep them in sync).
function _mostCommon(values) {
  const counts = new Map();
  const order = [];
  for (let v of values) {
    v = (v == null ? "" : String(v)).trim();
    if (!v) continue;
    if (!counts.has(v)) { counts.set(v, 0); order.push(v); }
    counts.set(v, counts.get(v) + 1);
  }
  if (!counts.size) return "";
  let best = order[0];
  for (const v of order) if (counts.get(v) > counts.get(best)) best = v;
  return best;
}

/* The view-time FALLBACK twin of step_suggest.step_grain_keys (Python). Used
 * only when a step lacks persisted `grain_keys` (a session analyzed before the
 * field existed, or a hand-authored step): resolve element/screen/app from the
 * step's interaction events. `interactionsById` maps event_id -> interaction.
 * Mirrors the Python rules so the live roll-up agrees with the stamped keys. */
function resolveStepGrainKeys(step, interactionsById) {
  const ids = ((step && step.evidence && step.evidence.interaction_event_ids) || []);
  const datas = ids
    .map((id) => interactionsById && interactionsById[id])
    .filter(Boolean)
    .map((ev) => ev.data || {});
  const eid = (d) => (d.automation_id || d.name || "");
  const typed = datas.filter((d) => d.kind === "value_changed" || d.kind === "text_changed").map(eid);
  const element = _mostCommon(typed) || _mostCommon(datas.map(eid)) || "(element)";
  const screen = _mostCommon(datas.map((d) => d.screen_id || ""))
    || _mostCommon(datas.map((d) => d.window_title || "")) || "(screen)";
  const procs = [];
  for (const d of datas) {
    let p = (d.process_name || "").trim();
    if (p.toLowerCase().endsWith(".exe")) p = p.slice(0, -4);
    if (p) procs.push(p);
  }
  const app = _mostCommon(procs) || "(app)";
  return { element, screen, app };
}

/* The element/screen/app keys for a step: prefer the persisted `grain_keys`
 * (stamped by the pipeline), else resolve live from `ctx.interactionsById`. */
function _containmentKeys(step, ctx) {
  if (step && step.grain_keys && typeof step.grain_keys === "object") return step.grain_keys;
  if (ctx && ctx.interactionsById) return resolveStepGrainKeys(step, ctx.interactionsById);
  return {};
}

/* The COLLAPSE key for a step at a notch -- consecutive steps sharing it fold
 * into one node/step. `element` is identity (the step's own id), so the element
 * notch shows EVERY step (the finest grain -- detail is never destroyed). The
 * coarser notches share a key so a run consolidates. */
function grainKey(step, notch, ctx) {
  const k = _containmentKeys(step, ctx);
  switch (notch) {
    case "element": return "id:" + (step.step_id || Math.random());
    case "screen":  return "scr:" + (k.screen || "(screen)");
    case "app":     return "app:" + (k.app || "(app)");
    case "phase":   return "ph:" + (step.phase_id || "(unphased)");
    case "case":    return "cs:" + (step.case_id || "(case)");
    default:        return "id:" + (step.step_id || Math.random());
  }
}

/* The readable DISPLAY label for a step at a notch (the node caption / the
 * rolled-up step name). For element/screen the label is the value-free step
 * type so the map reads as process steps, not raw ids; the coarse notches read
 * their container's name. `ctx.phaseName` / `ctx.caseLabel` resolve ids. */
function grainLabel(step, notch, ctx) {
  const k = _containmentKeys(step, ctx);
  const stepType = step.process_label || processLabel(step.name) || "(unnamed)";
  switch (notch) {
    case "element": return stepType;
    case "screen":  return k.screen || "(screen)";
    case "app":     return k.app || "(app)";
    case "phase":   return step.phase_id
      ? ((ctx && ctx.phaseName && ctx.phaseName[step.phase_id]) || "(phase)")
      : "(unphased)";
    case "case":    return (ctx && ctx.caseLabel && ctx.caseLabel(step.case_id))
      || step.case_id || "(case)";
    default:        return stepType;
  }
}

/* Roll a session's steps up to the chosen notch: a group is a run of
 * consecutive (time-ordered, per case) steps sharing the notch's grainKey. This
 * is the engine behind the Steps list and the acceptance counts -- at the
 * `element` notch every step is its own group (the fine count is reproduced
 * exactly: detail is never destroyed); coarser notches consolidate runs.
 *
 * Returns one entry per group: { key, label, case_id, step_ids, steps, count,
 * time_range:{start,end}, _repeatNotch } -- enough to render a list row, seek
 * the timeline, and re-expand. Hidden steps are excluded (as in buildAnnotationDfg).
 */
function rollUpSteps(steps, notch, ctx) {
  const n = GRAIN_NOTCHES.includes(notch) ? notch : DEFAULT_GRAIN;
  const valid = (steps || []).filter((st) => st && st.state !== "hidden");
  const byCase = new Map();
  for (const st of valid) {
    const cid = st.case_id || "__nocase__";
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(st);
  }
  const groups = [];
  for (const caseSteps of byCase.values()) {
    caseSteps.sort((a, b) => _stepStart(a) - _stepStart(b));
    let run = null;
    for (const st of caseSteps) {
      const key = grainKey(st, n, ctx || {});
      if (run && run.key === key) {
        run.steps.push(st);
      } else {
        if (run) groups.push(run);
        run = { key, label: grainLabel(st, n, ctx || {}), case_id: st.case_id || null, steps: [st] };
      }
    }
    if (run) groups.push(run);
  }
  // Order groups by their first step's start time (stable cross-case ordering).
  groups.sort((a, b) => _stepStart(a.steps[0]) - _stepStart(b.steps[0]));
  return groups.map((g) => {
    const first = g.steps[0];
    const last = g.steps[g.steps.length - 1];
    return {
      key: g.key,
      label: g.label,
      notch: n,
      case_id: g.case_id,
      step_ids: g.steps.map((s) => s.step_id),
      steps: g.steps,
      count: g.steps.length,
      time_range: {
        start: (first.time_range && first.time_range.start) || null,
        end: (last.time_range && last.time_range.end) || null,
      },
    };
  });
}

/**
 * @param {Array} sessions  loaded sessions, each with `.annotations`
 * @param {"step"|"phase"|"element"|"screen"|"app"|"case"} level  the grain notch
 *   (ADR-0024). "step" and "element" both collapse by the value-free step type
 *   (the readable map grain); "screen"/"app"/"case" collapse by the containment
 *   key; "phase" by phase. Back-compatible: "step"/"phase" behave as before.
 * @param {{phaseName?: string}} [filter]  drill-down scope: when descending
 *   from a phase node, restrict the step map to that phase's steps.
 * @param {{caseLabel?: Function, interactionsById?: Object}} [ctx]  optional
 *   resolvers for the case-notch label and the view-time grain-key fallback.
 * @returns {{edges: Array, start_activities: Object, end_activities: Object}}
 */
function buildAnnotationDfg(sessions, level, filter, ctx) {
  // "step" is the value-free step-type collapse (ADR-0013); on the grain ladder
  // that IS the "element"/finest map grain, so treat them alike here.
  const notch = level === "step" ? "element" : level;
  const edgeMap = new Map();
  const startAct = {};
  const endAct = {};

  for (const s of sessions || []) {
    const anno = (s && s.annotations) || {};
    let steps = (anno.steps || []).filter((st) => st && st.state !== "hidden");
    if (!steps.length) continue;

    const phaseName = {};
    for (const ph of (anno.phases || [])) phaseName[ph.phase_id] = ph.name || "(phase)";

    // Drill-down scope: a click on a phase node restricts the step-level map
    // to that phase's steps (its children), not the whole session. Compare the
    // exact phase-node label, "(unphased)" included.
    if (filter && filter.phaseName != null) {
      steps = steps.filter((st) => {
        const lbl = st.phase_id ? (phaseName[st.phase_id] || "(phase)") : "(unphased)";
        return lbl === filter.phaseName;
      });
      if (!steps.length) continue;
    }

    // One trace per case -- repetitions of the same task across cases are
    // what give the edges meaningful frequencies.
    const byCase = new Map();
    for (const st of steps) {
      const cid = st.case_id || "__nocase__";
      if (!byCase.has(cid)) byCase.set(cid, []);
      byCase.get(cid).push(st);
    }

    // Resolver context for the notch labels (phase names + optional case label
    // and view-time grain-key fallback). phaseName is built above per session.
    const labelCtx = Object.assign({ phaseName }, ctx || {});
    for (const caseSteps of byCase.values()) {
      caseSteps.sort((a, b) => _stepStart(a) - _stepStart(b));
      // The node caption at the chosen grain notch. "element"/"step" use the
      // value-free step type (computed live so the flow collapses without a
      // re-analyze, persisted process_label preferred); "screen"/"app"/"case"
      // read the containment key; "phase" the phase name.
      let seq = caseSteps.map((st) => grainLabel(st, notch, labelCtx));
      // Collapse consecutive duplicates (a run of same-grain steps = one node).
      seq = seq.filter((v, i) => i === 0 || v !== seq[i - 1]);
      if (!seq.length) continue;

      startAct[seq[0]] = (startAct[seq[0]] || 0) + 1;
      endAct[seq[seq.length - 1]] = (endAct[seq[seq.length - 1]] || 0) + 1;
      for (let i = 0; i < seq.length - 1; i++) {
        const k = seq[i] + SEP + seq[i + 1];
        edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
      }
    }
  }

  const edges = [...edgeMap.entries()].map(([k, freq]) => {
    const [source, target] = k.split(SEP);
    return { source, target, frequency: freq };
  });
  return { edges, start_activities: startAct, end_activities: endAct };
}

/* Thin a DFG for readability: keep only edges seen at least `minFreq` times, so
 * rare deviations don't clutter the dominant flow on a long, dense recording.
 * `minFreq` is the rare-path slider's cutoff (ADR-0013 #5): 1 shows every path,
 * higher hides paths below the cutoff; it defaults to 2 (the old binary
 * "hide one-off paths" behaviour). The cutoff is CLAMPED to the map's busiest
 * edge frequency, so it can never drop every edge -- the map is never blanked.
 * A no-op when there is no frequency spread (every edge a singleton) or fewer
 * than 3 edges. Nodes left with no edges are dropped. Returns
 * { dfg, hidden, cutoff, maxFreq }: `hidden` is the edge count removed, `cutoff`
 * the effective (clamped) threshold applied, `maxFreq` the busiest edge.
 */
function dropRareEdges(dfg, minFreq = 2) {
  const edges = (dfg && dfg.edges) || [];
  const maxFreq = edges.length ? Math.max(...edges.map((e) => e.frequency || 1)) : 1;
  // Clamp into [1, maxFreq] so a high cutoff can never blank the map.
  const cutoff = Math.max(1, Math.min(Math.floor(minFreq || 1), maxFreq));
  if (cutoff <= 1 || edges.length < 3 || maxFreq <= 1) {
    return { dfg, hidden: 0, cutoff: 1, maxFreq };
  }
  const kept = edges.filter((e) => (e.frequency || 1) >= cutoff);
  const nodes = new Set();
  for (const e of kept) { nodes.add(e.source); nodes.add(e.target); }
  const filt = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => nodes.has(k)));
  return {
    dfg: {
      edges: kept,
      start_activities: filt(dfg.start_activities),
      end_activities: filt(dfg.end_activities),
    },
    hidden: edges.length - kept.length,
    cutoff,
    maxFreq,
  };
}

module.exports = {
  buildAnnotationDfg, processLabel, dropRareEdges,
  // ADR-0024 view-time grain roll-up
  rollUpSteps, grainKey, grainLabel, resolveStepGrainKeys,
  GRAIN_NOTCHES, DEFAULT_GRAIN,
};
