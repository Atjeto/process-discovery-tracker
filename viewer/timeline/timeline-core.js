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
 *        stack (its gapBefore still applies) but contributes no height.
 * @param {{ tailPx?: number }} [opts]  tailPx is added below the last lane.
 * @returns {LaneStackLayout}
 */
function layoutLaneStack(lanes, opts) {
  /** @type {Map<string, LaneSlot>} */
  const slots = new Map();
  let cursor = 0;
  for (const lane of lanes) {
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

module.exports = {
  timeToXPct,
  formatAxisLabel,
  chooseTicks,
  packLanes,
  layoutLaneStack,
  renderLaneStack,
};
