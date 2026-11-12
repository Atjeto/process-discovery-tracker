"use strict";

/*
 * timeline-core.js -- shared timeline rendering core.
 *
 * The shared maths behind the Flow timeline: ticks, lane packing and the lane
 * stack. Before it existed, tick maths and lane packing were copy-pasted
 * across the timeline renderers, so a fix in one never reached the others.
 * See docs/adr/0003-viewer-architecture-refactor.md.
 *
 * CommonJS module: `require("./timeline/timeline-core.js")`. Type-checked via
 * JSDoc (`npm run typecheck`); the pure functions are covered by
 * timeline-core.test.js (`npm test`).
 */

/**
 * @typedef {Object} Tick
 * @property {number} tMs    Absolute time of the tick (ms since epoch).
 * @property {string} label  Human-readable axis label.
 * @property {number} xPct   Horizontal position, percent (0-100) of the span.
 */

/**
 * @typedef {Object} LaneItem
 * @property {string} id       Stable identifier.
 * @property {number} startMs  Start time (ms since epoch).
 * @property {number} endMs    End time (ms since epoch).
 */

/**
 * Tick-interval ladder, ascending, in ms (1s .. 24h). The shared superset of
 * the three ladders previously hard-coded across the timelines; `chooseTicks`
 * picks the smallest rung that keeps the tick count at or below the target.
 */
const { clock } = require("../dom.js");

const TICK_LADDER_MS = [
  1000, 2000, 5000, 10000, 15000, 30000,
  60000, 120000, 300000, 600000, 900000, 1800000,
  3600000, 7200000, 14400000, 21600000,
  43200000, 86400000,
];

/**
 * Map an absolute time to a percentage position across a span.
 * @param {number} tMs      Time to map (ms since epoch).
 * @param {number} startMs  Span start (ms since epoch).
 * @param {number} spanMs   Span length (ms); must be > 0.
 * @returns {number} Percent position; may fall outside 0-100 if tMs is outside the span.
 */
function timeToXPct(tMs, startMs, spanMs) {
  return ((tMs - startMs) / spanMs) * 100;
}

/**
 * Format an axis label, with precision chosen from the tick interval:
 * HH:MM:SS for sub-minute intervals, HH:MM up to a day, M/D beyond.
 * @param {number} tMs         Time (ms since epoch).
 * @param {number} intervalMs  Tick interval (ms); decides the precision.
 * @returns {string}
 */
function formatAxisLabel(tMs, intervalMs) {
  const d = new Date(tMs);
  if (intervalMs >= 86400000) return `${d.getMonth() + 1}/${d.getDate()}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (intervalMs < 60000) {
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

/**
 * Choose evenly-spaced, human-readable axis ticks across a time span. Unifies
 * the old pickTickStep / pickTickIntervalMs / fmtAxisLabel helpers.
 * @param {number} startMs      Span start (ms since epoch).
 * @param {number} endMs        Span end (ms since epoch).
 * @param {number} targetCount  Desired approximate tick count (>= 1).
 * @param {number} [originMs]   When given, the ticks count from it and read the
 *   time since it ("0:30", "1:00:00", the one clock) instead of the time of day.
 * @returns {Tick[]} Ticks ordered by time; empty when the span is non-positive.
 */
function chooseTicks(startMs, endMs, targetCount, originMs) {
  const spanMs = endMs - startMs;
  if (!(spanMs > 0)) return [];
  const target = spanMs / Math.max(1, targetCount);
  let intervalMs = TICK_LADDER_MS[TICK_LADDER_MS.length - 1];
  for (const rung of TICK_LADDER_MS) {
    if (rung >= target) { intervalMs = rung; break; }
  }
  const elapsed = Number.isFinite(originMs);
  const base = elapsed ? originMs : 0;
  /** @type {Tick[]} */
  const ticks = [];
  const firstTick = base + Math.ceil((startMs - base) / intervalMs) * intervalMs;
  for (let t = firstTick; t <= endMs; t += intervalMs) {
    ticks.push({ tMs: t, label: elapsed ? clock(t - base) : formatAxisLabel(t, intervalMs), xPct: timeToXPct(t, startMs, spanMs) });
  }
  return ticks;
}

/**
 * Greedily pack time-ranged items into non-overlapping lanes. Overlap is judged
 * on a *visual* footprint: each item is padded to a minimum width so two items
 * a few ms apart still land on separate lanes. Unifies the old assignLanes /
 * layoutCaseLanes / inline lane loops.
 * @param {LaneItem[]} items      Items to place.
 * @param {{ maxLanes: number, spanMs: number }} opts
 * @returns {{ laneCount: number, laneOf: Map<string, number> }}
 */
function packLanes(items, opts) {
  const minVisualMs = Math.max(1, opts.spanMs * 0.005);
  const sorted = items
    .filter((it) => Number.isFinite(it.startMs) && Number.isFinite(it.endMs))
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
  /** @type {number[]} */
  const laneEnds = [];
  /** @type {Map<string, number>} */
  const laneOf = new Map();
  for (const it of sorted) {
    const visualEnd = Math.max(it.endMs, it.startMs + minVisualMs);
    let lane = laneEnds.findIndex((end) => end <= it.startMs);
    if (lane === -1) {
      if (laneEnds.length < opts.maxLanes) {
        lane = laneEnds.length;
        laneEnds.push(visualEnd);
      } else {
        lane = opts.maxLanes - 1;
        laneEnds[lane] = Math.max(laneEnds[lane], visualEnd);
      }
    } else {
      laneEnds[lane] = visualEnd;
    }
    laneOf.set(it.id, lane);
  }
  return { laneCount: Math.max(1, laneEnds.length), laneOf };
}

/**
 * @typedef {Object} LaneSlot
 * @property {number} top     Resolved top offset, px from the host top.
 * @property {number} height  Lane height, px.
 */

/**
 * @typedef {Object} LaneStackLayout
 * @property {Map<string, LaneSlot>} slots  Resolved geometry, keyed by lane key.
 * @property {number} contentHeight         Bottom edge of the last lane, px.
 * @property {number} totalHeight           contentHeight plus tailPx.
 */

/**
 * @typedef {Object} LaneRenderCtx
 * @property {LaneSlot} slot                This lane's resolved geometry.
 * @property {Map<string, LaneSlot>} slots  Every lane's geometry (cross-lane refs).
 * @property {number} startMs               Span start (ms since epoch).
 * @property {number} endMs                 Span end (ms since epoch).
 * @property {number} spanMs                Span length (ms; always >= 1).
 * @property {number} zoom                  Horizontal zoom factor (>= 1).
 */

/**
 * @typedef {Object} StackLane
 * @property {string} key        Stable lane id; used for cross-lane geometry lookup.
 * @property {number} height     Resolved lane height in px; 0 hides the lane.
 * @property {number} gapBefore  Vertical gap in px inserted above this lane.
 * @property {(host: HTMLElement, ctx: LaneRenderCtx) => void} render  Draws the lane.
 */

/**
 * @typedef {Object} LaneStackOptions
 * @property {StackLane[]} lanes               Lanes in top-to-bottom order.
 * @property {{ startMs: number, endMs: number }} span
 * @property {number} [zoom]            Horizontal zoom factor, >= 1 (default 1).
 * @property {number} [tailPx]          Padding added below the last lane, px.
 * @property {number} [minHeightFloor]  Lower bound for the host minHeight, px.
 */

/**
 * Stack lanes vertically into cumulative { top, height } geometry. Pure layout
 * maths -- no DOM, no time -- so it is unit-tested directly. The Flow timeline
 * is a heterogeneous vertical stack (ticks, runs, activity, screenshots, the
 * optional lanes); this resolves that stack.
 * @param {{ key: string, height: number, gapBefore: number }[]} lanes
 *        Lanes in top-to-bottom order. A height of 0 keeps the lane in the
 *        stack (a slot at the cursor, 0 high) but adds neither its gapBefore
 *        nor any height.
 * @param {{ tailPx?: number }} [opts]  tailPx is added below the last lane.
 * @returns {LaneStackLayout}
 */
function layoutLaneStack(lanes, opts) {
  /** @type {Map<string, LaneSlot>} */
  const slots = new Map();
  let cursor = 0;
  for (const lane of lanes) {
    // Lane LANES: a lane of height 0 is not drawn and adds no gap either,
    // so no room is left under the last lane drawn.
    if (!(lane.height > 0)) { slots.set(lane.key, { top: cursor, height: 0 }); continue; }
    const top = cursor + lane.gapBefore;
    slots.set(lane.key, { top, height: lane.height });
    cursor = top + lane.height;
  }
  return {
    slots,
    contentHeight: cursor,
    totalHeight: cursor + ((opts && opts.tailPx) || 0),
  };
}

/**
 * Render a heterogeneous vertical lane stack into host: set the host width for
 * zoom, resolve the layout, set the host minHeight, then call render(host, ctx)
 * on each visible (height > 0) lane in order. Each lane is a { height, render }
 * plugin (ADR-0003 item 5). It does NOT clear host or bind host listeners:
 * the caller owns the host lifecycle (innerHTML, click handlers, overlays such
 * as a playhead).
 * @param {HTMLElement} host
 * @param {LaneStackOptions} opts
 * @returns {LaneStackLayout}
 */
function renderLaneStack(host, opts) {
  const zoom = Math.max(1, opts.zoom || 1);
  host.style.width = 100 * zoom + "%";
  const layout = layoutLaneStack(opts.lanes, { tailPx: opts.tailPx });
  host.style.minHeight =
    Math.max(opts.minHeightFloor || 0, layout.totalHeight) + "px";
  const spanMs = Math.max(1, opts.span.endMs - opts.span.startMs);
  for (const lane of opts.lanes) {
    if (lane.height <= 0) continue;
    const slot = layout.slots.get(lane.key);
    if (!slot) continue; // unreachable: every lane has a slot -- narrows for tsc
    lane.render(host, {
      slot,
      slots: layout.slots,
      startMs: opts.span.startMs,
      endMs: opts.span.endMs,
      spanMs,
      zoom,
    });
  }
  return layout;
}

/* ============ The bar of the whole length (lane LANES) ==============
   One thin bar under the lanes always shows the whole length of the
   timeline; the part the lanes show now is a box on it. Drag the box to move
   along the timeline, click elsewhere on the bar to centre the view there,
   Left and Right move the box. The geometry is the lanes' scroll box:
   `scrollLeft`, `clientWidth` (what shows) and `scrollWidth` (the whole
   zoomed width), all in px. */

/**
 * The furthest the lanes can scroll: the whole width less what shows.
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {number}
 */
function _maxScroll(clientWidth, scrollWidth) {
  return Math.max(0, (Number(scrollWidth) || 0) - Math.max(0, Number(clientWidth) || 0));
}

/**
 * Where the box lies on the bar, in percent of the bar: { leftPct, widthPct }.
 * When the lanes show the whole length (nothing to scroll) the box fills the
 * bar: { 0, 100 }.
 * @param {number} scrollLeft
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {{ leftPct: number, widthPct: number }}
 */
function barBox(scrollLeft, clientWidth, scrollWidth) {
  const whole = Number(scrollWidth) || 0;
  const shown = Math.max(0, Number(clientWidth) || 0);
  if (!(whole > 0) || !(shown > 0) || _maxScroll(shown, whole) < 1) return { leftPct: 0, widthPct: 100 };
  const left = Math.max(0, Math.min(_maxScroll(shown, whole), Number(scrollLeft) || 0));
  return { leftPct: (left / whole) * 100, widthPct: (Math.min(shown, whole) / whole) * 100 };
}

/**
 * The scrollLeft that centres the view on the place `frac` (0 to 1 along the
 * bar, a click on it), kept inside the timeline.
 * @param {number} frac
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {number}
 */
function barCentreOn(frac, clientWidth, scrollWidth) {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  const whole = Number(scrollWidth) || 0;
  const shown = Math.max(0, Number(clientWidth) || 0);
  return Math.max(0, Math.min(_maxScroll(shown, whole), f * whole - shown / 2));
}

/**
 * The scrollLeft after the box, taken at `startScrollLeft`, is dragged
 * `dxPx` along a bar `barPx` wide (a px of the bar is scrollWidth / barPx
 * px of the lanes), kept inside the timeline.
 * @param {number} startScrollLeft
 * @param {number} dxPx
 * @param {number} barPx
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {number}
 */
function barDragTo(startScrollLeft, dxPx, barPx, clientWidth, scrollWidth) {
  const whole = Number(scrollWidth) || 0;
  const per = whole / Math.max(1, Number(barPx) || 0);
  const to = (Number(startScrollLeft) || 0) + (Number(dxPx) || 0) * per;
  return Math.max(0, Math.min(_maxScroll(clientWidth, whole), to));
}

/**
 * What a press of Left (`dir` -1) or Right (+1) does on the bar: the box
 * moves a tenth of what shows, kept inside the timeline.
 * @param {number} scrollLeft
 * @param {number} dir
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {number}
 */
function barStep(scrollLeft, dir, clientWidth, scrollWidth) {
  const shown = Math.max(0, Number(clientWidth) || 0);
  const to = (Number(scrollLeft) || 0) + Math.sign(Number(dir) || 0) * shown / 10;
  return Math.max(0, Math.min(_maxScroll(shown, scrollWidth), to));
}

/**
 * The bar's value for a screen reader (aria-valuenow): how far along the
 * timeline the view is, 0 at its start and 100 at its end, a whole number;
 * 0 when the whole length shows.
 * @param {number} scrollLeft
 * @param {number} clientWidth
 * @param {number} scrollWidth
 * @returns {number}
 */
function barValue(scrollLeft, clientWidth, scrollWidth) {
  const max = _maxScroll(clientWidth, scrollWidth);
  if (max < 1) return 0;
  return Math.round((Math.max(0, Math.min(max, Number(scrollLeft) || 0)) / max) * 100);
}

/* The most a double-click on a transaction zooms in: a transaction of a
   few seconds in a recording of hours would otherwise make the lanes
   millions of px wide. */
const MAX_ZOOM = 400;
/* The room shown on each side of a transaction zoomed to, as a share of its
   length. */
const ZOOM_ROOM = 0.05;

/**
 * The view a double-click on a transaction's band gives: the zoom that shows
 * [startMs, endMs] with a little room on each side filling the width, and
 * where the view then starts, as a share (0 to 1) of the whole length
 * [spanStartMs, spanEndMs]. A transaction that, with its room, covers the
 * whole length gives the whole length: { zoom: 1, leftFrac: 0 }. The zoom is
 * at most MAX_ZOOM; the start is kept inside the timeline.
 * @param {number} spanStartMs
 * @param {number} spanEndMs
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} [room]  share of the transaction's length on each side (ZOOM_ROOM)
 * @returns {{ zoom: number, leftFrac: number } | null}  null when the times cannot be read
 */
function zoomToSpan(spanStartMs, spanEndMs, startMs, endMs, room) {
  const whole = spanEndMs - spanStartMs;
  const len = endMs - startMs;
  if (!Number.isFinite(whole) || !Number.isFinite(len) || !(whole > 0) || !(len > 0)) return null;
  const pad = len * (Number.isFinite(room) && room >= 0 ? room : ZOOM_ROOM);
  const shown = len + 2 * pad;
  if (shown >= whole) return { zoom: 1, leftFrac: 0 };
  const zoom = Math.min(MAX_ZOOM, whole / shown);
  // What shows at that zoom, centred on the transaction when the zoom is
  // capped, kept inside the timeline.
  const view = whole / zoom;
  const from = startMs - spanStartMs + len / 2 - view / 2;
  const leftFrac = Math.max(0, Math.min(1 - 1 / zoom, from / whole));
  return { zoom, leftFrac };
}

module.exports = {
  timeToXPct,
  formatAxisLabel,
  chooseTicks,
  packLanes,
  layoutLaneStack,
  renderLaneStack,
  barBox,
  barCentreOn,
  barDragTo,
  barStep,
  barValue,
  zoomToSpan,
  MAX_ZOOM,
  ZOOM_ROOM,
};
