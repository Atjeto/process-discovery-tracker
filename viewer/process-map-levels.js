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
// makes the raw name unique). Computed live here -- mirrors
// step_suggest.process_label (Python) so the DFG and the observed-flow BPMN
// agree -- so the flow collapses without needing a re-analyze. Keep the two in
// sync if either changes.
const _ENTER_IN_RE = /(:\s*Enter)\s+.+?\s+in\s+(.+)$/;   // "Enter 25 in Quantity" -> "Enter Quantity"
const _VALUE_TAIL_RE = /\s+[—–-]\s+.*$/;                 // "Search — CUST-10001"  -> "Search"
function processLabel(name) {
  const s = (name || "").trim();
  if (!s) return s;
  const rewritten = s.replace(_ENTER_IN_RE, "$1 $2");
  if (rewritten !== s) return rewritten.trim();
  return s.replace(_VALUE_TAIL_RE, "").trim();
}

function _stepStart(st) {
  const t = (st && st.time_range && st.time_range.start) || null;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Array} sessions  loaded sessions, each with `.annotations`
 * @param {"step"|"phase"} level
 * @param {{phaseName?: string}} [filter]  drill-down scope: when descending
 *   from a phase node, restrict the step map to that phase's steps.
 * @returns {{edges: Array, start_activities: Object, end_activities: Object}}
 */
function buildAnnotationDfg(sessions, level, filter) {
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

    for (const caseSteps of byCase.values()) {
      caseSteps.sort((a, b) => _stepStart(a) - _stepStart(b));
      let seq = caseSteps.map((st) => level === "phase"
        ? (st.phase_id ? (phaseName[st.phase_id] || "(phase)") : "(unphased)")
        // Value-free label, computed live so the flow collapses without a
        // re-analyze; prefer the persisted process_label when present.
        : (st.process_label || processLabel(st.name) || "(unnamed)"));
      // Collapse consecutive duplicates (a run of steps in one phase = one node).
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

module.exports = { buildAnnotationDfg, processLabel, dropRareEdges };
