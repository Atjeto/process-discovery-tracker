/*
 * sub-process-maps.js: the maps a project holds (contract C19, AD-33): one
 * main map plus one map per sub-process, at any depth, and what each is drawn
 * from. A step is a sub-process when it carries `sub_steps` (an array, empty
 * or not); annotations.steps stays the main level, and a sub-step has the
 * shape of a step, its parent's case_id and its own sub_steps in turn.
 *
 * The rule, pinned by shared/sub-process-maps-golden.json for this module
 * and for the pipeline's normalization/sub_process_maps.py:
 *   - the main map (path []) has one trace per transaction, its visible
 *     steps in order;
 *   - below it, consecutive visible steps with one node are one visit, and a
 *     visit of a sub-process node gives one trace: the visible sub_steps of
 *     its steps in order (a visit whose steps carry none gives no trace, and
 *     an empty trace is left out);
 *   - the map of a sub-process node at level P (a path of nodes from the main
 *     map down) is drawn from the traces of every visit of that node at P, in
 *     transaction order, by the step flow's edge rule (C17,
 *     process-map-levels.buildAnnotationDfg), so an end inside a sub-process
 *     ends the sub-process only; its path is P plus the node;
 *   - a hidden step is left out with everything under it;
 *   - its number is the position of the node's first visit among the visible
 *     steps of the reference transaction's first trace at P (steps counted,
 *     not visits), after the parent's number and a dot ("2", "2.4"); null when
 *     the node is not in that trace (it then gets no PDD chapter);
 *   - maps are listed depth first; at each level the sub-process nodes come
 *     in the order the node first appears (at any visit, with sub_steps or
 *     not, so maps follow their numbers), the reference transaction's traces
 *     first, then the others in transaction order.
 * The node of a step is the map's node rule (process-map-levels.mapNodeLabel),
 * at every level: a drafted sub-step (action_key) is its name.
 *
 * With it, the helpers the Steps level, the step panel, the Timeline and the
 * Map use to work at one level: the tree finder, the places of each
 * transaction at a level (its visits, as the Steps level lists them), the
 * visits of a node, the names the maps go by and the path that is still there
 * after an edit.
 *
 * Pure: no DOM, no State. The verbs are sub-process-verbs.js.
 */

"use strict";

const { mapNodeLabel } = require("./process-map-levels.js");
const StepOrder = require("./step-order.js");

/* A step is a sub-process when it carries sub_steps, even an empty list. */
function isSubProcess(step) {
  return !!step && typeof step === "object" && Array.isArray(step.sub_steps);
}

function isHidden(step) { return !step || step.state === "hidden"; }

/* A list of steps in order (C16: the steps with a time in time order, then
   the steps without one by `order`; C22: a step the analyst placed after
   another comes right after it, step-order.js processOrder); steps that tie
   keep their list order, which for drafted sub-steps is the order they were
   recorded in (two actions can share a second), as the map's order does. */
function inOrder(steps) {
  return StepOrder.processOrder(steps);
}

function visibleOf(steps) { return (steps || []).filter((s) => !isHidden(s)); }

/* The visits of a list of steps: consecutive visible steps with one node are
   one visit, [{ node, steps }] in order. */
function visitsOf(steps) {
  const out = [];
  for (const st of inOrder(steps)) {
    if (isHidden(st)) continue;
    const node = mapNodeLabel(st);
    const last = out[out.length - 1];
    if (last && last.node === node) last.steps.push(st);
    else out.push({ node, steps: [st] });
  }
  return out;
}

/* The places of one transaction at level `path`: [{ parents, steps }], where
   `steps` are the level's steps there (every one, hidden ones too: the
   sub_steps of each parent in order, parent after parent) and `parents` the
   steps whose sub_steps they are ([] at the main level, where the one place
   is the transaction's own steps). A place below the main level is one visit
   of the path's last node whose steps carry sub_steps. */
function placesAt(members, path) {
  let places = [{ parents: [], steps: inOrder(members) }];
  for (const node of path || []) {
    const next = [];
    for (const pl of places) {
      for (const v of visitsOf(pl.steps)) {
        if (v.node !== node) continue;
        const parents = v.steps.filter(isSubProcess);
        if (!parents.length) continue;
        next.push({ parents, steps: parents.flatMap((p) => inOrder(p.sub_steps)) });
      }
    }
    places = next;
  }
  return places;
}

function samePath(a, b) {
  const x = a || [], y = b || [];
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/**
 * The maps of a project (the golden's rule, see the header).
 * @param {Array<Array>} transactions  each transaction's main-level steps
 * @param {{reference?: number}} opts  the reference transaction's index (0 by default)
 * @returns {Array<{path: string[], number: (string|null), traces: Array<Array>, transactions: number[]}>}
 *   depth first; each trace is a list of step objects, and `transactions`
 *   names the transaction (its index) each trace came from.
 */
function mapTree(transactions, opts) {
  const txs = (transactions || []).map((t) => (Array.isArray(t) ? t : []));
  const r = opts && opts.reference;
  const ref = Number.isInteger(r) && r >= 0 && r < txs.length ? r : 0;
  const order = txs.length ? [ref].concat(txs.map((_, i) => i).filter((i) => i !== ref)) : [];
  const maps = [];
  const build = (path, number) => {
    const places = txs.map((m) => placesAt(m, path));
    const traces = [], from = [];
    places.forEach((list, t) => {
      for (const pl of list) {
        const v = visibleOf(pl.steps);
        if (v.length) { traces.push(v); from.push(t); }
      }
    });
    maps.push({ path: path.slice(), number, traces, transactions: from });
    // The sub-process nodes of this level, in the order the node first
    // appears (at any visit, with sub_steps or not), so maps follow numbers.
    const nodes = [];
    const sub = new Set();
    for (const t of order) for (const pl of places[t]) for (const st of visibleOf(pl.steps)) {
      const node = mapNodeLabel(st);
      if (!nodes.includes(node)) nodes.push(node);
      if (isSubProcess(st)) sub.add(node);
    }
    const refTrace = (places[ref] || []).map((pl) => visibleOf(pl.steps)).find((v) => v.length) || [];
    for (const node of nodes) {
      if (!sub.has(node)) continue;
      const i = refTrace.findIndex((s) => mapNodeLabel(s) === node);
      const num = i < 0 || (path.length && number == null) ? null : (path.length ? number + "." : "") + (i + 1);
      build(path.concat([node]), num);
    }
  };
  build([], null);
  return maps;
}

/* The number of the map at `path` ("2.4"), or null (the main map, a map
   the reference transaction does not reach, or no such map). */
function numberOf(transactions, path, reference) {
  if (!path || !path.length) return null;
  const m = mapTree(transactions, { reference }).find((x) => samePath(x.path, path));
  return m ? m.number : null;
}

/* ---- The tree of steps ------------------------------------------------------ */

/* Call fn(step, list, index, ancestors) for every step at every depth, parent
   before its sub-steps; `ancestors` are the steps above it, the main level's
   first. */
function eachStep(steps, fn) {
  const walk = (list, ancestors) => {
    if (!Array.isArray(list)) return;
    list.forEach((s, i) => {
      if (!s || typeof s !== "object") return;
      fn(s, list, i, ancestors);
      if (Array.isArray(s.sub_steps)) walk(s.sub_steps, ancestors.concat([s]));
    });
  };
  walk(steps, []);
}

/* Every step at every depth, parents first. */
function allSteps(steps) {
  const out = [];
  eachStep(steps, (s) => out.push(s));
  return out;
}

/* The steps under `step`, at every depth (not the step itself). */
function descendants(step) {
  return isSubProcess(step) ? allSteps(step.sub_steps) : [];
}

/**
 * The tree finder: a step by id at any depth.
 * @returns {{step, list, index, parent, ancestors, depth, path}|null}
 *   list: the array that holds it (annotations.steps or a parent's
 *   sub_steps); parent: the step whose sub_steps it is (null at the main
 *   level); ancestors: the steps above it, the main level's first; path: the
 *   level it is at, as the nodes of its ancestors ([] for the main level).
 */
function findStep(steps, id) {
  if (typeof id !== "string" || !id) return null;
  let hit = null;
  const walk = (list, ancestors) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length && !hit; i++) {
      const s = list[i];
      if (!s || typeof s !== "object") continue;
      if (s.step_id === id) {
        hit = { step: s, list, index: i, parent: ancestors[ancestors.length - 1] || null,
          ancestors: ancestors.slice(), depth: ancestors.length, path: ancestors.map(mapNodeLabel) };
        return;
      }
      if (Array.isArray(s.sub_steps)) walk(s.sub_steps, ancestors.concat([s]));
    }
  };
  walk(steps, []);
  return hit;
}

/* Take the steps with these ids out of whatever list holds them, at any
   depth, in place (the lists stay the same arrays). Returns the steps taken. */
function removeSteps(steps, ids) {
  const gone = ids instanceof Set ? ids : new Set(ids || []);
  const taken = [];
  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s && gone.has(s.step_id)) { taken.unshift(s); list.splice(i, 1); }
      else if (s && Array.isArray(s.sub_steps)) walk(s.sub_steps);
    }
  };
  walk(steps);
  return taken;
}

/* ---- One level ------------------------------------------------------------- */

/* The places of every transaction at level `path`, as the Steps level lists
   them: [{ t, index, parents, members, visible }] in transaction order; t is
   the transaction's index and index counts that transaction's places at this
   level (0 the first, 1 "again", ...); members are the level's steps there
   (hidden ones too) and visible the others. At the main level each
   transaction is one place. */
function levelVisits(transactions, path) {
  const out = [];
  (transactions || []).forEach((m, t) => {
    placesAt(m, path).forEach((pl, index) => {
      out.push({ t, index, parents: pl.parents, members: pl.steps, visible: visibleOf(pl.steps) });
    });
  });
  return out;
}

/* The place at level `path` that holds the step `stepId`, as levelVisits
   gives it, or null. */
function placeOf(transactions, path, stepId) {
  return levelVisits(transactions, path).find((v) => v.members.some((s) => s.step_id === stepId)) || null;
}

/* The visits of `node` at level `path`: [{ t, index, steps }] in transaction
   order, each the consecutive visible steps of one visit (index counts the
   node's visits in that transaction). */
function nodeVisits(transactions, path, node) {
  const out = [];
  (transactions || []).forEach((m, t) => {
    let index = 0;
    for (const pl of placesAt(m, path)) {
      for (const v of visitsOf(pl.steps)) if (v.node === node) out.push({ t, index: index++, steps: v.steps });
    }
  });
  return out;
}

/* Every step at level `path` whose node is `node`, hidden ones too, in
   transaction order: the occurrences a rename of a sub-process renames. */
function levelStepsOfNode(transactions, path, node) {
  const out = [];
  for (const v of levelVisits(transactions, path)) {
    for (const s of v.members) if (mapNodeLabel(s) === node) out.push(s);
  }
  return out;
}

/* Whether `node` is a sub-process at level `path`: a visible step of it
   there carries sub_steps. */
function isSubProcessNode(transactions, path, node) {
  return levelVisits(transactions, path).some((v) => v.visible.some((s) => isSubProcess(s) && mapNodeLabel(s) === node));
}

/* The name a level goes by (the breadcrumb, the Timeline's lane): the name of
   the first step of its node's first visit at the level above, the
   reference transaction's first; the node when that step has none; "" for
   the main level. */
function nodeName(transactions, path, reference) {
  if (!path || !path.length) return "";
  const node = path[path.length - 1];
  const visits = nodeVisits(transactions, path.slice(0, -1), node);
  const v = visits.find((x) => x.t === reference) || visits[0];
  const first = v && v.steps[0];
  const nm = first && typeof first.name === "string" ? first.name.trim() : "";
  return nm || node;
}

/* The name the main map goes by (the first crumb, the Map's picker): the
   process name the document gives (its title, C6: the first line), else
   "Main process". */
function mainMapName(annotations) {
  const d = (annotations && annotations.document) || {};
  const t = typeof d.title === "string" ? d.title.trim().split(/\r?\n/)[0].trim() : "";
  return t || "Main process";
}

/* The longest start of `path` whose maps are still there (a sub-process
   dissolved, hidden or renamed since takes the level up to its parent). */
function validPath(transactions, path) {
  const out = [];
  for (const node of path || []) {
    if (!isSubProcessNode(transactions, out, node)) break;
    out.push(node);
  }
  return out;
}

module.exports = {
  mapNodeLabel, isSubProcess, inOrder, visitsOf, placesAt, samePath,
  mapTree, numberOf,
  eachStep, allSteps, descendants, findStep, removeSteps,
  levelVisits, placeOf, nodeVisits, levelStepsOfNode, isSubProcessNode, nodeName, mainMapName, validPath,
};
