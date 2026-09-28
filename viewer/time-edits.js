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
 *     analyst's too, gives way.
 *   - steps are added one after another, each where it starts (the owner:
 *     "you always add steps sequentially"): a new step ends the step of the
 *     analyst's it starts in (cutForNewStep), and a transaction's end, or
 *     the next transaction's start, ends the step that runs past it
 *     (cutAtBoundaries). Until then the newest step is open (isOpen): it
 *     runs to the end of the timeline and reads "open", not a length.
 *   - a side joined to a transaction's side goes with it when that side is
 *     moved (followMarker) or taken out (followRemoval); a step deleted
 *     gives its time back to the step before it (handBack).
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
/* How near the timeline's end a step's end is that end (a video's length is
   measured to a fraction of a millisecond; a time is stored to one). */
const OPEN_TOL_MS = 500;

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
   the next step beside it starts, or the next transaction boundary
   (`boundaryMs`, a Start or an End marker after `ms`, null when none), or
   `outer` ends. { endMs } or { inside } (the step of `others` that runs
   over `ms`: one of the analyst's is cut there, cutForNewStep),
   { outside: true } (`ms` is off `outer`) or { tooShort: true } (a step
   starts right there). */
function placeUntimed(ms, others, outer, boundaryMs) {
  if (!(ms >= outer.startMs && ms < outer.endMs)) return { outside: true };
  const inside = (others || []).find((o) => o.startMs < ms && ms < o.endMs);
  if (inside) return { inside };
  let endMs = outer.endMs;
  for (const o of others || []) if (o.startMs >= ms) endMs = Math.min(endMs, o.startMs);
  if (Number.isFinite(boundaryMs) && boundaryMs > ms) endMs = Math.min(endMs, boundaryMs);
  return endMs - ms >= MIN_SPAN_MS ? { endMs } : { tooShort: true };
}

/* The markers as they now are, as moments: [{ ms, type }] ("start" or
   "end") in time order, from marker-edits.js currentMarkerEvents. */
function markerMoments(events) {
  return (events || []).map((e) => ({ ms: Date.parse(e && e.timestamp),
    type: e && e.data && e.data.marker_type === "end" ? "end" : "start" }))
    .filter((m) => Number.isFinite(m.ms)).sort((a, b) => a.ms - b.ms);
}

/* The first transaction boundary (a Start or an End) after `ms`, or null. */
function nextBoundary(moments, ms) {
  const m = (moments || []).find((x) => x.ms > ms);
  return m ? m.ms : null;
}

/* Whether `ms` lies in a marked transaction: the last marker at or before
   it is a Start. */
function inMarkedTransaction(moments, ms) {
  let last = null;
  for (const m of moments || []) { if (m.ms <= ms) last = m; else break; }
  return !!last && last.type === "start";
}

/* The steps a transaction boundary cuts: a step of the analyst's (`spans`,
   [{ id, startMs, endMs }]) that starts inside a marked transaction and runs
   on past that transaction's end (the first boundary after its start) ends
   there, so no such step runs past its transaction or into the next one. A
   step that starts outside every transaction is left whole: a Start placed
   just after it does not cut it to nothing. [{ id, endMs }] for the ones
   cut. */
function cutAtBoundaries(spans, moments) {
  const out = [];
  for (const s of spans || []) {
    if (!inMarkedTransaction(moments, s.startMs)) continue;
    const b = nextBoundary(moments, s.startMs);
    if (b != null && b < s.endMs) out.push({ id: s.id, endMs: b });
  }
  return out;
}

/* A step of the analyst's (`span`) cut by a new step at `ms` inside it (+
   Step, Add a step here, a start typed for a step without a time): the step
   the analyst is marking when the next one starts, so it ends at `ms`, or at
   its transaction's end if that comes first; the new step runs from `ms`
   until the old one ended (the end of the timeline while it was open), or
   its own transaction's end if that comes first. { before, after }, each
   { startMs, endMs }. */
function cutForNewStep(span, ms, moments) {
  const b1 = nextBoundary(moments, span.startMs);
  const b2 = nextBoundary(moments, ms);
  return {
    before: { startMs: span.startMs, endMs: b1 != null && b1 < ms ? b1 : ms },
    after: { startMs: ms, endMs: b2 != null && b2 < span.endMs ? b2 : span.endMs },
  };
}

/* Whether a step of the analyst's (`span`, { startMs, endMs }) is open: the
   step being marked, nothing marked after it yet. It runs to the end of the
   timeline (`lineEndMs`) and no transaction boundary (`moments`) follows
   its start, so its end is not known: it reads "open", not a length. */
function isOpen(span, lineEndMs, moments) {
  return !!span && Number.isFinite(span.endMs) && Number.isFinite(lineEndMs) &&
    span.endMs >= lineEndMs - OPEN_TOL_MS && nextBoundary(moments, span.startMs) == null;
}

/* Where a step (`span`, { id, startMs }) ends when nothing else ends it:
   where the next step starts (of `others`, the timed steps at its level),
   at the next transaction boundary after its start (`moments`), or at
   `outerEndMs` (Infinity when neither ends it and that is unknown). */
function naturalEnd(span, others, moments, outerEndMs) {
  let end = Number.isFinite(outerEndMs) ? outerEndMs : Infinity;
  for (const o of others || []) if (o.id !== span.id && o.startMs > span.startMs) end = Math.min(end, o.startMs);
  const b = nextBoundary(moments, span.startMs);
  return b != null ? Math.min(end, b) : end;
}

/* The steps whose `id`s appear in `changes` would not run over any other of
   `all` (each { id, startMs, endMs }) with their new times: the changes that
   keep the steps apart. */
function _apart(changes, all) {
  const now = new Map((all || []).map((o) => [o.id, o]));
  for (const c of changes) now.set(c.id, c);
  return changes.filter((c) => ![...now.values()].some((o) => o.id !== c.id && o.startMs < c.endMs && c.startMs < o.endMs));
}

/* A transaction's side moved (a marker of `type`, "start" or "end", from
   `fromMs` to `toMs`): the steps of the analyst's (`spans`) joined to it go
   with it, a step's start on a Start and a step's end on a Start or an End,
   so a transaction's start corrected keeps its first step in it and its end
   moved keeps its last step ending there. A step left under MIN_SPAN_MS, or
   one that would run over another step (`others`, the timed steps at the
   main level), stays. [{ id, startMs, endMs }] for the ones moved. */
function followMarker(spans, others, type, fromMs, toMs) {
  const out = [];
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs === toMs) return out;
  for (const s of spans || []) {
    const a = type === "start" && s.startMs === fromMs ? toMs : s.startMs;
    const b = s.endMs === fromMs ? toMs : s.endMs;
    if ((a !== s.startMs || b !== s.endMs) && b - a >= MIN_SPAN_MS) out.push({ id: s.id, startMs: a, endMs: b });
  }
  return _apart(out, others);
}

/* A transaction's side taken out (the marker at `atMs`): a step of the
   analyst's (`spans`) that ended there runs on to its naturalEnd (`moments`
   the markers without it), so an End added and taken out again leaves the
   step as it was. [{ id, startMs, endMs }] for the ones that run on. */
function followRemoval(spans, others, atMs, moments, outerEndMs) {
  const out = [];
  for (const s of spans || []) {
    if (s.endMs !== atMs) continue;
    const endMs = naturalEnd(s, others, moments, outerEndMs);
    if (Number.isFinite(endMs) && endMs > s.endMs) out.push({ id: s.id, startMs: s.startMs, endMs });
  }
  return out;
}

/* A step of the analyst's deleted (`gone`, { id, startMs, endMs }): the step
   of `spans` that ended where it started takes its time, as before it was
   added, up to its own transaction's end (`moments`): a transaction's last
   step never runs into the next one. { id, startMs, endMs } or null. */
function handBack(spans, gone, moments) {
  const prev = (spans || []).find((o) => gone && o.id !== gone.id && o.endMs === gone.startMs);
  if (!prev) return null;
  const b = nextBoundary(moments, prev.startMs);
  const endMs = b != null && b < gone.endMs ? b : gone.endMs;
  return endMs > prev.endMs ? { id: prev.id, startMs: prev.startMs, endMs } : null;
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
  SNAP_PX, MIN_SPAN_MS, OPEN_TOL_MS,
  snapMs, markerDragBounds, stepEdgeBounds, stepSide, stepSideChanges, placeUntimed,
  markerMoments, nextBoundary, inMarkedTransaction, cutAtBoundaries, cutForNewStep,
  isOpen, naturalEnd, followMarker, followRemoval, handBack,
  fieldTime, parseFieldTime, runSides,
};
