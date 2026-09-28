/*
 * time-edits.js: the times the analyst gives a transaction or a step (2.0.3,
 * a process manager's report: a transaction started a few pixels after the
 * step it was meant to hold, and neither could be moved or given a time).
 * Pure; unit-tested (time-edits.test.js).
 *
 * Two ways in, one set of rules. The Timeline drags a side
 * (views/flow-view-timeline.js); Steps types a time (views/steps-view.js):
 *   - a transaction's side is a marker. It moves between the markers before
 *     and after it, MIN_SPAN_MS from each, so the transactions keep their
 *     order and pairing; an End typed where a transaction has none is added.
 *   - a step's time is the analyst's to change when no recorded action gives
 *     it one (analyst-content.js stepTimeMovable). A side moves between the
 *     steps beside it; a step back to back with it, whose time is the
 *     analyst's too, gives way. A step without a time is given one where no
 *     other step is, until the next step starts or its transaction ends.
 *   - a dragged side, and a right-click's new transaction or step, comes to
 *     another side drawn or to the playhead within SNAP_PX of it.
 *   - a time reads on the one clock, the time since the recording started, to
 *     a tenth of a second where it has one ("0:09.6"), and is typed the same
 *     way.
 */

"use strict";

const { clock } = require("./dom.js");

/* A side dragged, or a right-click's moment, comes to a side drawn or the
   playhead this many pixels away. */
const SNAP_PX = 8;
/* The least left between two markers, or as a step's length. */
const MIN_SPAN_MS = 100;

/* `ms` taken to the nearest of `targets` (ms) within `tolMs`, else `ms`
   itself. */
function snapMs(ms, targets, tolMs) {
  let best = ms, gap = tolMs;
  for (const t of targets || []) {
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - ms);
    if (d <= gap) { best = t; gap = d; }
  }
  return best;
}

/* The times a marker may take: between the markers before and after it (so
   the transactions keep their order and their pairing), at least
   MIN_SPAN_MS from each, and on the timeline. `times` the markers' times as
   they now are, in order; `i` the moved one's index. */
function markerDragBounds(times, i, firstMs, lastMs) {
  const lo = Math.max(firstMs, i > 0 ? times[i - 1] + MIN_SPAN_MS : firstMs);
  const hi = Math.min(lastMs, i < times.length - 1 ? times[i + 1] - MIN_SPAN_MS : lastMs);
  return { lo, hi: Math.max(lo, hi) };
}

/* The times one side (`edge`, "start" or "end") of a step may take: never
   over another step beside it (`others`, each { startMs, endMs }), the step
   left MIN_SPAN_MS long, inside `outer` (the timeline, or the sub-process
   the step is in). `span` is the step's own. */
function stepEdgeBounds(span, edge, others, outer) {
  if (edge === "start") {
    let lo = outer.startMs;
    for (const o of others || []) if (o.startMs < span.startMs) lo = Math.max(lo, Math.min(o.endMs, span.startMs));
    return { lo, hi: Math.max(lo, span.endMs - MIN_SPAN_MS) };
  }
  let hi = outer.endMs;
  for (const o of others || []) if (o.endMs > span.endMs) hi = Math.min(hi, Math.max(o.startMs, span.endMs));
  const lo = span.startMs + MIN_SPAN_MS;
  return { lo, hi: Math.max(lo, hi) };
}

/* One side of a step moved: the range it may take, { lo, hi }, and `link`,
   the step back to back with it on that side that gives way (one of
   `others`, each { id, startMs, endMs, movable }), or null. The link keeps
   MIN_SPAN_MS of its own. */
function stepSide(own, edge, others, outer) {
  const all = others || [];
  const link = all.find((o) => o.movable && (edge === "start" ? o.endMs === own.startMs : o.startMs === own.endMs)) || null;
  let { lo, hi } = stepEdgeBounds(own, edge, all.filter((o) => o !== link), outer);
  if (link && edge === "start") lo = Math.min(own.startMs, Math.max(lo, link.startMs + MIN_SPAN_MS));
  if (link && edge === "end") hi = Math.max(own.endMs, Math.min(hi, link.endMs - MIN_SPAN_MS));
  return { lo, hi, link };
}

/* The new times of the step `stepId` (span `own`) when its side `edge`
   goes to `ms`, and of `link` (stepSide's) with it:
   [{ stepId, startMs, endMs }, ...]. */
function stepSideChanges(stepId, own, edge, link, ms) {
  const out = [{ stepId, startMs: edge === "start" ? ms : own.startMs, endMs: edge === "end" ? ms : own.endMs }];
  if (link) {
    out.push({ stepId: link.id, startMs: edge === "start" ? link.startMs : ms, endMs: edge === "start" ? ms : link.endMs });
  }
  return out;
}

/* Where a step without a time goes when it is given the start `ms`: until
   the next step beside it starts, or its transaction ends (`runEndMs`, null
   when it runs to the end), or `outer` ends. { endMs } or { inside } (the
   step of `others` that runs over `ms`), { outside: true } (`ms` is off
   `outer`) or { tooShort: true } (a step starts right there). */
function placeUntimed(ms, others, outer, runEndMs) {
  if (!(ms >= outer.startMs && ms < outer.endMs)) return { outside: true };
  const inside = (others || []).find((o) => o.startMs <= ms && ms < o.endMs && o.endMs > o.startMs);
  if (inside) return { inside };
  let endMs = outer.endMs;
  for (const o of others || []) if (o.startMs >= ms) endMs = Math.min(endMs, o.startMs);
  if (Number.isFinite(runEndMs) && runEndMs > ms) endMs = Math.min(endMs, runEndMs);
  return endMs - ms >= MIN_SPAN_MS ? { endMs } : { tooShort: true };
}

/* A moment `ms` on the one clock, as a time field shows it: "0:09", "1:05",
   "1:02:03", with the tenth of a second where it has one ("0:09.6"): two
   times a second apart must not read the same. "" when unknown. */
function fieldTime(ms, originMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(originMs)) return "";
  const t = Math.round((ms - originMs) / 100);   // tenths of a second
  if (t < 0) return clock(ms - originMs);
  const whole = clock(Math.floor(t / 10) * 1000);
  return t % 10 ? whole + "." + (t % 10) : whole;
}

/* A typed time, the way the timeline shows it ("0:09", "1:05.5", "1:05,5",
   "1:02:03"), in ms since the recording started; null for anything else. */
function parseFieldTime(text) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*$/.exec(String(text == null ? "" : text));
  if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) return null;
  const frac = m[4] ? Math.round(Number("0." + m[4]) * 1000) : 0;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

/* The markers at the sides of a transaction, `run` as runs-model builds it
   from the last analysis, in the marker view (marker-edits.js markerView):
     start   its Start marker's row (found at the start the analysis used),
             null for a transaction no marker starts (the implicit one of a
             project without a recording, C16);
     end     the row of its own End marker, as the markers now are, or null;
     next    the marker that ends it now when it has no End of its own (the
             next Start), else null (it runs to the end);
     index   the start's place among `now`, the markers as they now are in
             time order (deleted ones left out), whose times bound a move. */
function runSides(run, view) {
  const rows = (view || []).filter((r) => r && !r.deletedApplied);
  const start = rows.find((r) => r.markerType === "start" && r.applied &&
    Date.parse(r.appliedTimestamp) === (run && run.startMs)) || null;
  const now = rows.filter((r) => !r.deleted)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const index = start ? now.indexOf(start) : -1;
  const after = index >= 0 ? now[index + 1] || null : null;
  return {
    start: index >= 0 ? start : null,
    end: after && after.markerType === "end" ? after : null,
    next: after && after.markerType === "start" ? after : null,
    now, index,
  };
}

module.exports = {
  SNAP_PX, MIN_SPAN_MS,
  snapMs, markerDragBounds, stepEdgeBounds, stepSide, stepSideChanges, placeUntimed,
  fieldTime, parseFieldTime, runSides,
};
