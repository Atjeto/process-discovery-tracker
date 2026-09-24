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
 * Pure (no DOM, no cytoscape) so it is unit-testable. The output shape
 * matches dfg-viewer.js's input: { edges, start_activities, end_activities }.
 */

// A separator that cannot appear in a step name. Built from a char code so no
// literal control byte sits in the source.
const SEP = String.fromCharCode(1);

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

/**
 * The process map of a session: one trace per run.
 *
 * @param {Array<Array>} runs  one array of steps per run (a run's steps, in any
 *   order; hidden steps are left out here too). Steps outside every run are
 *   not passed: the map shows the runs.
 * @returns {{edges: Array, start_activities: Object, end_activities: Object}}
 *   edges carry `frequency` (how many times a run took the path) and
 *   `total_ms` (the time that flowed along it, summed over those times).
 */
function buildAnnotationDfg(runs) {
  const edgeMap = new Map();
  const startAct = {};
  const endAct = {};

  for (const run of runs || []) {
    const steps = (Array.isArray(run) ? run : [])
      .filter((st) => st && st.state !== "hidden")
      .map((st, i) => ({ st, i }))
      .sort(_byOrder)
      .map((x) => x.st);
    // Collapse consecutive duplicates (a run of same-node steps = one visit),
    // keeping each visit's ENTRY time so the edges can accumulate transition
    // time (§B2).
    const labels = [];
    const entries = [];
    for (const st of steps) {
      const label = mapNodeLabel(st);
      if (!labels.length || labels[labels.length - 1] !== label) {
        labels.push(label);
        entries.push(_stepStart(st));
      }
    }
    if (!labels.length) continue;

    startAct[labels[0]] = (startAct[labels[0]] || 0) + 1;
    endAct[labels[labels.length - 1]] = (endAct[labels[labels.length - 1]] || 0) + 1;
    for (let i = 0; i < labels.length - 1; i++) {
      const k = labels[i] + SEP + labels[i + 1];
      const cur = edgeMap.get(k) || { freq: 0, ms: 0 };
      cur.freq += 1;
      // §B2 time-weighted edges: the time that flows along A->B is
      // entering A -> entering B (A's dwell, trailing gap included), so
      // a thick edge reads "this hand-off carried the time". Summed over
      // every traversal; a missing timestamp contributes 0, never a guess.
      const a = entries[i];
      const b = entries[i + 1];
      if (a && b && b > a) cur.ms += (b - a);
      edgeMap.set(k, cur);
    }
  }

  const edges = [...edgeMap.entries()].map(([k, v]) => {
    const [source, target] = k.split(SEP);
    // `total_ms` is ADDITIVE next to the traversal count -- dfg-viewer keeps
    // rendering count-weighted when asked (or when no time was measurable).
    return { source, target, frequency: v.freq, total_ms: Math.round(v.ms) };
  });
  return { edges, start_activities: startAct, end_activities: endAct };
}

module.exports = {
  buildAnnotationDfg, mapNodeLabel, processLabel,
  // Used by the Steps level (steps-view.js): the value-free screen label and
  // the view-time fallback for a step's screen / app keys.
  screenType, resolveStepGrainKeys, valueFree,
};
