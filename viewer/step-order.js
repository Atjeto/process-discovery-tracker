/*
 * step-order.js: where a step comes in its transaction's process (contract
 * C22, 2.0.5). Pure: no DOM, no State; unit-tested (step-order.test.js), and
 * the order rule is pinned with the pipeline's twin
 * (normalization/step_context.py process_order) by
 * shared/step-order-golden.json.
 *
 * The owner's report: while listening to a video, the SME corrects a step in
 * its second half, or adds a condition to something shown in the first. A
 * step marked there on the Timeline came after every step in between,
 * because the time ordered every step. A step's place in the process is now
 * its own: `step.placed_after` names the step it comes after ("start": first
 * in its transaction), while its time_range stays where it was shown (its
 * band on the Timeline, its video, its length, "Transaction 1 at 12:30").
 *
 * The order of one list of steps (a transaction's, or a sub-process's):
 *   1. the base order, contract C16's: the steps with a time by their start,
 *      then the steps without one by their `order`, then any step with
 *      neither; steps that tie keep their list order;
 *   2. a placement holds when it names "start", or a step of the same list
 *      that is visible, of the same transaction (case_id) and not the step
 *      itself, and does not lead back to the step; any other is ignored (a
 *      missing or hidden step, another transaction's, a loop) and the step
 *      goes by its time;
 *   3. the steps placed first come first, then each other step in the base
 *      order; a step is followed by the steps placed after it, in the base
 *      order, each followed by its own.
 * A hidden step is never a step another comes after: hiding one hands its
 * followers over (keepOrder), so a list with or without its hidden steps
 * reads the same order.
 *
 * The edits (the viewer's verbs, steps-view.js) give a wanted order, and
 * deriveOrder writes the fewest placements that give it: the steps that can
 * keep their time order keep no placement, so a step moved back where its
 * time puts it is no longer placed.
 */

"use strict";

const START = "start";

/* An ISO time in ms, NaN when it cannot be read. A time without a zone is
   UTC, as the pipeline reads it (_dt.parse_ts). */
function _ms(iso) {
  if (typeof iso !== "string" || !iso.trim()) return NaN;
  const s = iso.trim();
  const zoned = /T.*([zZ]|[+-]\d{2}:?\d{2})$/.test(s) || !s.includes("T");
  const t = Date.parse(zoned ? s : s + "Z");
  return Number.isFinite(t) ? t : NaN;
}

function startMs(step) { return _ms(step && step.time_range && step.time_range.start); }

function _visible(s) { return !!s && s.state !== "hidden"; }
function _caseOf(s) { return s && typeof s.case_id === "string" && s.case_id ? s.case_id : null; }
function _steps(list) { return (Array.isArray(list) ? list : []).filter((s) => s && typeof s === "object"); }

/* C16's place of a step: [0, start] with a time, [1, order] without one, [2,
   0] with neither (the pipeline's step_context.step_sort_key). */
function baseKey(s) {
  const t = startMs(s);
  if (Number.isFinite(t)) return [0, t];
  const o = s && s.order;
  return typeof o === "number" && Number.isFinite(o) ? [1, o] : [2, 0];
}

function _byBase(a, b) {
  const x = baseKey(a.s), y = baseKey(b.s);
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  return a.i - b.i;
}

/* The base order (rule 1): a new array. */
function baseOrder(steps) {
  return _steps(steps).map((s, i) => ({ s, i })).sort(_byBase).map((x) => x.s);
}

/* The placements that hold (rule 2): Map step => START or the step it comes
   after. */
function _holding(list) {
  const byId = new Map();
  for (const s of list) {
    if (typeof s.step_id === "string" && s.step_id && !byId.has(s.step_id)) byId.set(s.step_id, s);
  }
  const named = new Map();
  for (const s of list) {
    const a = s.placed_after;
    if (a === START) { named.set(s, START); continue; }
    if (typeof a !== "string" || !a) continue;
    const t = byId.get(a);
    if (!t || t === s || !_visible(t) || _caseOf(t) !== _caseOf(s)) continue;
    named.set(s, t);
  }
  // A placement that leads back to its own step holds nowhere.
  const out = new Map();
  for (const [s, a] of named) {
    const seen = new Set();
    let x = a, loops = false;
    for (;;) {
      if (x === s) { loops = true; break; }
      if (x === START || !named.has(x) || seen.has(x)) break;
      seen.add(x);
      x = named.get(x);
    }
    if (!loops) out.set(s, a);
  }
  return out;
}

/* The order and, for each step, the step its place hangs from: itself when
   it goes by its time, START for the steps placed first. */
function _plan(steps) {
  const list = _steps(steps);
  const base = baseOrder(list);
  const held = _holding(list);
  const kids = new Map();
  for (const s of base) {
    if (!held.has(s)) continue;
    const a = held.get(s);
    if (!kids.has(a)) kids.set(a, []);
    kids.get(a).push(s);
  }
  const order = [], root = new Map();
  const emit = (key, r) => {
    for (const c of kids.get(key) || []) {
      order.push(c);
      root.set(c, r);
      emit(c, r);
    }
  };
  emit(START, START);
  for (const s of base) {
    if (held.has(s)) continue;
    order.push(s);
    root.set(s, s);
    emit(s, s);
  }
  return { order, root, held };
}

/* The process order of one list of steps (rules 1 to 3): a new array. */
function processOrder(steps) {
  return _plan(steps).order;
}

/* The moment each step counts at among a transaction's stretches left out of
   the analysis (lane FX1's cuts and the differences): its own start, or, for
   a placed step, the start of the step its place hangs from (-Infinity for
   the steps placed first; NaN when that step has no time: after every
   stretch). Map step => ms. */
function placeMoments(steps) {
  const { root } = _plan(steps);
  const out = new Map();
  for (const [s, r] of root) out.set(s, r === START ? -Infinity : startMs(r));
  return out;
}

/* The place a step holds in `steps` (its list): START, the step it comes
   after, or null when its time places it. */
function anchorOf(step, steps) {
  const held = _holding(_steps(steps));
  return held.has(step) ? held.get(step) : null;
}

function isPlaced(step, steps) { return anchorOf(step, steps) != null; }

/* The weights deriveOrder maximizes, in this order: steps kept free (no
   placement), steps free before the edit kept free, steps other than the
   one moved kept free. */
function _weight(s, freeBefore, moved) {
  return [1, freeBefore.has(s) && s !== moved ? 1 : 0, s !== moved ? 1 : 0];
}
function _add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function _more(a, b) {
  for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] > b[k];
  return false;
}

/**
 * Write the placements that give `wanted`, the fewest: the visible steps of
 * one place (one transaction's steps at the main level, one list of
 * sub-steps below it), all of one case_id, in `wanted`'s order.
 * @param {Array} steps    the place's visible steps, in their list's order
 *                         (the base order breaks ties by it)
 * @param {Array} wanted   the same steps (objects or step_ids) in the order
 *                         wanted
 * @param {Object} [opts]  opts.moved: the step the edit moved (it keeps a
 *   placement when another step could keep it as well); opts.canBeFree(step):
 *   whether a step that is placed now, or the one moved, may go by its time
 *   again (at the main level: its start lies in its transaction); a step free
 *   now stays free when it can. opts.placedBefore: the steps placed before
 *   the edit, when `steps` no longer holds what placed them (keepOrder).
 * @returns {Array} the steps whose placed_after changed
 */
function deriveOrder(steps, wanted, opts) {
  const o = opts || {};
  const list = _steps(steps);
  const byId = new Map(list.map((s) => [s.step_id, s]));
  const want = (Array.isArray(wanted) ? wanted : []).map((w) => (typeof w === "string" ? byId.get(w) : w))
    .filter((s) => s && list.includes(s));
  const rank = new Map(baseOrder(list).map((s, i) => [s, i]));
  const held = _holding(list);
  const was = o.placedBefore instanceof Set ? o.placedBefore : null;
  const freeBefore = new Set(list.filter((s) => (was ? !was.has(s) : !held.has(s))));
  const moved = typeof o.moved === "string" ? byId.get(o.moved) : o.moved || null;
  const canBeFree = typeof o.canBeFree === "function" ? o.canBeFree : () => true;
  const eligible = (s) => (freeBefore.has(s) && s !== moved) || !!canBeFree(s);
  // The heaviest run of steps in wanted order that is also in base order.
  const n = want.length;
  const best = new Array(n).fill(null), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!eligible(want[i])) continue;
    const w = _weight(want[i], freeBefore, moved);
    best[i] = w;
    for (let j = 0; j < i; j++) {
      if (!best[j] || rank.get(want[j]) >= rank.get(want[i])) continue;
      const c = _add(best[j], w);
      if (_more(c, best[i])) { best[i] = c; prev[i] = j; }
    }
  }
  let end = -1;
  for (let i = 0; i < n; i++) if (best[i] && (end < 0 || _more(best[i], best[end]))) end = i;
  const free = new Set();
  for (let i = end; i >= 0; i = prev[i]) free.add(want[i]);
  const changed = [];
  want.forEach((s, k) => {
    const before = s.placed_after;
    if (free.has(s)) delete s.placed_after;
    else s.placed_after = k ? want[k - 1].step_id : START;
    if (s.placed_after !== before) changed.push(s);
  });
  return changed;
}

/* The place's visible steps keep the order they have while `goneIds` leave
   it (a step hidden, deleted, merged or grouped): the steps that came after
   a gone one come after the step before it. Same opts as deriveOrder.
   Returns the steps whose placed_after changed. */
function keepOrder(steps, goneIds, opts) {
  const gone = new Set(goneIds || []);
  const all = _steps(steps);
  const now = processOrder(all).filter((s) => _visible(s) && !gone.has(s.step_id));
  const rest = all.filter((s) => _visible(s) && !gone.has(s.step_id));
  if (!rest.some((s) => s.placed_after != null)) return [];
  // What was placed is read before the gone steps leave: a step placed after
  // one of them was placed, though nothing in `rest` places it now.
  const placedBefore = new Set(_holding(all).keys());
  return deriveOrder(rest, now, Object.assign({}, opts, { placedBefore }));
}

/* A step placed after another belongs to that step's transaction, wherever
   its own time is; a chain follows the step it hangs from. `steps`: one
   level's list (annotations.steps at the main level). The pipeline's
   step_suggest._follow_placement_case, the same rule. Returns the steps
   whose case_id changed. */
function followTransaction(steps) {
  const list = _steps(steps);
  const byId = new Map();
  for (const s of list) {
    if (typeof s.step_id === "string" && s.step_id && !byId.has(s.step_id)) byId.set(s.step_id, s);
  }
  const changed = new Set();
  for (let pass = 0; pass <= list.length; pass++) {
    let moved = false;
    for (const s of list) {
      const t = typeof s.placed_after === "string" ? byId.get(s.placed_after) : null;
      if (!t || t === s || !_visible(t)) continue;
      const want = t.case_id === undefined ? null : t.case_id;
      if ((s.case_id === undefined ? null : s.case_id) !== want) {
        s.case_id = want;
        changed.add(s);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [...changed];
}

/* A step of `steps` (visible, timed, not one of `members`) that starts
   between the earliest and the latest start of `members` on the timeline,
   or null: a merge or a group of the members would then run over it. */
function apartOnTimeline(members, steps) {
  const own = new Set(_steps(members));
  const times = [...own].map(startMs).filter(Number.isFinite);
  if (times.length < 2) return null;
  const lo = Math.min(...times), hi = Math.max(...times);
  return _steps(steps).filter((s) => _visible(s) && !own.has(s))
    .find((s) => { const t = startMs(s); return Number.isFinite(t) && t > lo && t < hi; }) || null;
}

module.exports = {
  START, startMs, baseKey, baseOrder, processOrder, placeMoments, anchorOf, isPlaced,
  deriveOrder, keepOrder, followTransaction, apartOnTimeline,
};
