"use strict";

/*
 * process-map-levels.js: build the process map (a directly-follows graph,
 * DFG) from the runs' steps: the one map of the Map level (BA-helper cycle).
 *
 * A node is a step (mapNodeLabel: the value-free name every run shares), and
 * an edge joins two consecutive steps of one run. One trace per RUN gives the
 * edges their frequency: four runs of the same work read "this path 4 of 4
 * times" rather than one line per run. Consecutive steps with the same node
 * collapse into one visit.
 *
 * Contract C17 (step flow): the process starts at the START node and ends at
 * the END node, and the analyst's conditions (step.only_when) and links
 * (step.links) add edges and labels, by the rule shared/flow-links-golden.json
 * pins for this map and for the pipeline's step BPMN.
 *
 * Pure (no DOM, no cytoscape) so it is unit-testable. The output shape
 * matches dfg-viewer.js's input: { edges, start_activities, end_activities,
 * start_edges, end_edges }.
 */

// A separator that cannot appear in a step name. Built from a char code so no
// literal control byte sits in the source.
const SEP = String.fromCharCode(1);

// The map's two event nodes (C17): their ids start with SEP, so no step name
// can take them.
const START = SEP + "start";
const END = SEP + "end";
// The label of the path around a conditional step (C17 rule 2).
const OTHERWISE = "otherwise";

// Value-free step label so repeated work across cases collapses to ONE node
// instead of one-per-instance (every case's order #, customer id, SKU, qty
// makes the raw name unique). The rewrite RULES are the SINGLE SOURCE in
// shared/process-label-patterns.json, loaded here AND by Python
// (step_suggest.process_label) so the live map and the stats collapse
// identically, with no two hand-synced regexes to drift. The JSON ships to
// resources/shared/ (build-package.js); `__dirname/../shared` resolves in dev
// and in the package, same as recognition.js.
const _labelPath = require("node:path").join(__dirname, "..", "shared", "process-label-patterns.json");
const _LABEL_RULES = require(_labelPath).rules.map(
  (r) => ({ re: new RegExp(r.pattern), replacement: r.replacement }));
// G-4 pre_rules: artifact scrubbers ('(split N)' stacks), applied first,
// always, globally -- mirrors step_suggest.process_label (Python).
const _LABEL_PRE_RULES = (require(_labelPath).pre_rules || []).map(
  (r) => ({ re: new RegExp(r.pattern, "g"), replacement: r.replacement }));
function processLabel(name) {
  let s = (name || "").trim();
  if (!s) return s;
  for (const rule of _LABEL_PRE_RULES) s = s.replace(rule.re, rule.replacement).trim();
  if (!s) return (name || "").trim();
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

/* Value-free SCREEN type (ADR-0024 + ADR-0013 invariant). A window title
 * routinely embeds the case value ("Salesforce - Order #10900", "Outlook -
 * Order #10852 confirmation"); grouping on the raw title makes the SAME
 * logical screen a DISTINCT screen per case. Strip the embedded record values
 * (conservatively, in the same spirit as processLabel) so the one
 * "Salesforce - Order" screen is one screen across every case while
 * genuinely-different screens ("Account lookup" vs "Credit check") stay apart.
 * Short codes like "va01" survive (the digit-run threshold is 3+). */
// The value-free screen/window strip rules are the SINGLE SOURCE in
// shared/screen-label-patterns.json, loaded here AND by Python (step_suggest's
// window-title-derived step prefix) so the viewer's screen label and the step-
// name prefix strip identically, with no two hand-synced regexes to drift (same
// pattern as process-label-patterns.json). Applied IN ORDER, each a global replace.
const _screenPath = require("node:path").join(__dirname, "..", "shared", "screen-label-patterns.json");
const _SCREEN_RULES = require(_screenPath).rules.map(
  (r) => ({ re: new RegExp(r.pattern, "g"), replacement: r.replacement }));
function screenType(name) {
  let s = (name == null ? "" : String(name)).trim();
  if (!s) return s;
  for (const rule of _SCREEN_RULES) s = s.replace(rule.re, rule.replacement);
  // Trim separators left dangling at either end ("Order #" -> "Order").
  s = s.replace(/[\s#:\-–—|]+$/, "").replace(/^[\s#:\-–—|]+/, "").trim();
  return s || String(name).trim();   // never blank a screen that was all-value
}

/* The same rules without the fallback (step_suggest._value_free): "" when
   nothing but values remains, so a caller moves on to its next choice. */
function valueFree(text) {
  let s = (text == null ? "" : String(text)).trim();
  for (const rule of _SCREEN_RULES) s = s.replace(rule.re, rule.replacement);
  return s.replace(/[\s#:\-\u2013\u2014|]+$/, "").replace(/^[\s#:\-\u2013\u2014|]+/, "").trim();
}

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
 * Mirrors the Python rules so the viewer agrees with the stamped keys. */
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

/* The map node of a step. A drafted step (it carries a draft_key) is its own
 * name, whatever its state: a drafted name is free of case values by
 * construction (contract C1), and a rename is the name the analyst chose for
 * every step with that key (C4). This is the pipeline's process_label rule
 * since 43d307b (step_suggest._step_process_label), so the map, the stats and
 * the PDD group the same steps. Any other step (added by hand, merged, split,
 * or from an older analysis) groups by its process_label: the one the
 * pipeline stamped, else the shared value rules applied to its name. */
function mapNodeLabel(step) {
  const name = (step && typeof step.name === "string") ? step.name.trim() : "";
  if (step && step.draft_key && name) return name;
  return (step && step.process_label) || processLabel(name) || "(unnamed step)";
}

/* The order within a run, the one the Steps list shows (runs-model byStart,
   contract C16): the steps with a time in time order, then the steps without
   one by their `order`, then any step with neither; the sort is stable. */
function _orderKey(st) {
  const n = _stepStart(st);
  if (n > 0) return [0, n];
  const o = st && st.order;
  return typeof o === "number" && Number.isFinite(o) ? [1, o] : [2, 0];
}
function _byOrder(a, b) {
  const x = _orderKey(a.st), y = _orderKey(b.st);
  return (x[0] - y[0]) || (x[1] - y[1]) || (a.i - b.i);
}

/* An analyst's text as one line, whitespace collapsed ("" for a non-string):
   the pipeline's step_flow._line. */
function _line(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

/* A step's links (C17): [{ to, when }] with `to` a step_id or "end"; an entry
   without a target is left out. */
function stepLinks(step) {
  return (Array.isArray(step && step.links) ? step.links : [])
    .filter((l) => l && typeof l.to === "string" && l.to.trim());
}

/**
 * The process map of a session: one trace per run, plus the step flow the
 * analyst set (contract C17).
 *
 * @param {Array<Array>} runs  one array of steps per run (a run's steps, in any
 *   order; hidden steps are left out here too). Steps outside every run are
 *   not passed: the map shows the runs.
 * @returns {{edges: Array, start_activities: Object, end_activities: Object,
 *   start_edges: Array, end_edges: Array}}
 *   edges join two steps; start_edges leave the START node ({ target }) and
 *   end_edges enter the END node ({ source }; an edge from START to END is a
 *   start edge). Every edge carries `frequency` (how many times a run took
 *   the path), `total_ms` (the time that flowed along it, summed over those
 *   times), `observed` (the steps of a run follow it) and `label` (the
 *   analyst's condition text on it, "otherwise" on the path around a
 *   conditional step, several joined with " or " in step order; null when
 *   none).
 */
function buildAnnotationDfg(runs) {
  // (from, to) -> the edge's record; `order` keeps the first-seen order.
  const byFrom = new Map();
  const order = [];
  const edge = (from, to) => {
    let m = byFrom.get(from);
    if (!m) { m = new Map(); byFrom.set(from, m); }
    let rec = m.get(to);
    if (!rec) {
      rec = { from, to, freq: 0, ms: 0, observed: false, labels: [] };
      m.set(to, rec);
      order.push(rec);
    }
    return rec;
  };
  const addLabel = (rec, text) => {
    const t = _line(text);
    if (t && !rec.labels.includes(t)) rec.labels.push(t);
  };
  const startAct = {};
  const endAct = {};

  // Each run's visible steps in order, as visits: consecutive steps with the
  // same node are one visit, which keeps its ENTRY time so the edges can
  // accumulate transition time (§B2).
  const runVisits = [];
  for (const run of runs || []) {
    const steps = (Array.isArray(run) ? run : [])
      .filter((st) => st && st.state !== "hidden")
      .map((st, i) => ({ st, i }))
      .sort(_byOrder)
      .map((x) => x.st);
    const visits = [];
    for (const st of steps) {
      const node = mapNodeLabel(st);
      const last = visits[visits.length - 1];
      if (last && last.node === node) last.steps.push(st);
      else visits.push({ node, entry: _stepStart(st), steps: [st] });
    }
    if (visits.length) runVisits.push(visits);
  }

  // C17 rule 1, the observed edges: consecutive visits of each run, start to
  // the first and the last to end.
  for (const visits of runVisits) {
    const first = visits[0].node, last = visits[visits.length - 1].node;
    startAct[first] = (startAct[first] || 0) + 1;
    endAct[last] = (endAct[last] || 0) + 1;
    const s = edge(START, first);
    s.observed = true;
    s.freq += 1;
    for (let i = 0; i < visits.length - 1; i++) {
      const cur = edge(visits[i].node, visits[i + 1].node);
      cur.observed = true;
      cur.freq += 1;
      // §B2 time-weighted edges: the time that flows along A->B is
      // entering A -> entering B (A's dwell, trailing gap included), so
      // a thick edge reads "this hand-off carried the time". Summed over
      // every traversal; a missing timestamp contributes 0, never a guess.
      const a = visits[i].entry;
      const b = visits[i + 1].entry;
      if (a && b && b > a) cur.ms += (b - a);
    }
    const e = edge(last, END);
    e.observed = true;
    e.freq += 1;
  }

  // C17 rule 2: a step's condition makes its node conditional in every run
  // where the node appears (the conditions in step order, each once). A
  // link's target is the node of a visible step of any run (the pipeline's
  // step_flow.flow_edges); a hidden or unknown step draws nothing.
  const conditions = new Map();
  const nodeOf = new Map();
  for (const visits of runVisits) {
    for (const v of visits) {
      for (const st of v.steps) {
        if (typeof st.step_id === "string" && st.step_id && !nodeOf.has(st.step_id)) nodeOf.set(st.step_id, v.node);
        const c = _line(st.only_when);
        if (!c) continue;
        const list = conditions.get(v.node) || [];
        if (!list.includes(c)) list.push(c);
        conditions.set(v.node, list);
      }
    }
  }

  // The declarations, walked in step order so the labels of one edge join
  // in step order (rule 4).
  for (const visits of runVisits) {
    visits.forEach((v, i) => {
      const conds = conditions.get(v.node);
      if (conds) {
        // The edge entering the step from its previous step carries the
        // condition, and a path around it reads "otherwise".
        const prev = i > 0 ? visits[i - 1].node : START;
        const next = i < visits.length - 1 ? visits[i + 1].node : END;
        const into = edge(prev, v.node);
        for (const c of conds) addLabel(into, c);
        if (prev !== next) addLabel(edge(prev, next), OTHERWISE);
      }
      // Rule 3: a link goes from the step to its target, or to the end.
      for (const st of v.steps) {
        for (const l of stepLinks(st)) {
          const id = l.to.trim();
          if (id === st.step_id) continue;   // a link never points at its own step
          const to = id === "end" ? END : nodeOf.get(id);
          if (!to) continue;
          addLabel(edge(v.node, to), l.when);
        }
      }
    });
  }

  const edges = [], startEdges = [], endEdges = [];
  for (const r of order) {
    // `total_ms` is ADDITIVE next to the traversal count: dfg-viewer keeps
    // rendering count-weighted when asked (or when no time was measurable).
    const out = { frequency: r.freq, total_ms: Math.round(r.ms), observed: r.observed,
      label: r.labels.length ? r.labels.join(" or ") : null };
    if (r.from === START) startEdges.push(Object.assign({ target: r.to }, out));
    else if (r.to === END) endEdges.push(Object.assign({ source: r.from }, out));
    else edges.push(Object.assign({ source: r.from, target: r.to }, out));
  }
  return { edges, start_activities: startAct, end_activities: endAct, start_edges: startEdges, end_edges: endEdges };
}

/* Every edge of a map as { from, to, label, observed, frequency, total_ms },
   the start edges first and the end edges last (from START, to END): the
   list the map draws and the flow-links golden pins. */
function flowEdges(dfg) {
  const d = dfg || {};
  const pick = (e) => ({ label: e.label == null ? null : e.label, observed: !!e.observed,
    frequency: e.frequency || 0, total_ms: e.total_ms || 0 });
  return [
    ...(d.start_edges || []).map((e) => Object.assign({ from: START, to: e.target }, pick(e))),
    ...(d.edges || []).map((e) => Object.assign({ from: e.source, to: e.target }, pick(e))),
    ...(d.end_edges || []).map((e) => Object.assign({ from: e.source, to: END }, pick(e))),
  ];
}

module.exports = {
  buildAnnotationDfg, flowEdges, stepLinks, mapNodeLabel, processLabel,
  START, END, OTHERWISE,
  // Used by the Steps level (steps-view.js): the value-free screen label and
  // the view-time fallback for a step's screen / app keys.
  screenType, resolveStepGrainKeys, valueFree,
};
