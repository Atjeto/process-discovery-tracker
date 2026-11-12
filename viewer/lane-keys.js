"use strict";

/*
 * lane-keys.js: a lane of the Timeline is one Tab stop and its marks are
 * reached with the arrows (lane W2, plan section 11.5: "inside a lane the
 * arrow keys go from item to item and Enter opens one"). Pure;
 * lane-keys.test.js drives it, views/flow-view-timeline.js wires the keys.
 *
 * A lane's marks are taken in time order (two at one moment in the order the
 * lane draws them). The lane takes the focus on the mark at the clock's
 * moment (one whose time holds it), else the nearest after it, else the
 * first. Left and Right go to the previous and the next mark, stopping at
 * the ends; Home and End go to the first and the last.
 */

/* `marks` = [{ startMs, endMs }] in the order the lane draws them (endMs
   null or less than startMs: a mark of one moment). Returns their indices in
   time order, two at one moment keeping the drawing order. */
function timeOrder(marks) {
  const list = Array.isArray(marks) ? marks : [];
  return list.map((m, i) => ({ i, t: Number(m && m.startMs) }))
    .sort((a, b) => (Number.isFinite(a.t) ? a.t : Infinity) - (Number.isFinite(b.t) ? b.t : Infinity) || a.i - b.i)
    .map((x) => x.i);
}

function _end(m) {
  const a = Number(m.startMs), b = Number(m.endMs);
  return Number.isFinite(b) && b >= a ? b : a;
}

/* The position (in `ordered`, marks in time order) the lane takes the focus
   on at the clock's moment `ms`: the first mark whose time holds it, else
   the first that starts after it, else the first; 0 without a moment, -1
   with no mark. */
function startAt(ordered, ms) {
  const list = Array.isArray(ordered) ? ordered : [];
  if (!list.length) return -1;
  if (!Number.isFinite(ms)) return 0;
  const at = list.findIndex((m) => m && Number(m.startMs) <= ms && ms <= _end(m));
  if (at >= 0) return at;
  const after = list.findIndex((m) => m && Number(m.startMs) > ms);
  return after >= 0 ? after : 0;
}

/* The position a key goes to from `index` among `count` marks: Left and
   Right one back and one on, stopping at the ends; Home the first, End the
   last. -1 for any other key (it is not the lane's). */
function stepTo(count, index, key) {
  const n = Number(count) || 0;
  if (n <= 0) return -1;
  const i = Math.max(0, Math.min(n - 1, Number(index) || 0));
  if (key === "ArrowLeft") return Math.max(0, i - 1);
  if (key === "ArrowRight") return Math.min(n - 1, i + 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return -1;
}

/* A mark's name for a screen reader: the first line of its tooltip. */
function markName(title) {
  return String(title == null ? "" : title).split("\n")[0].trim();
}

module.exports = { timeOrder, startAt, stepTo, markName };
