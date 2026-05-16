"use strict";

/*
 * timeline-core.js -- shared timeline rendering core.
 *
 * One module behind all three viewer timelines (Flow, Steps, Phases). Before it
 * existed, tick maths, lane packing, and band construction were copy-pasted
 * across renderer.js / step-editor.js / phase-editor.js, so a fix in one never
 * reached the others. See docs/adr/0003-viewer-architecture-refactor.md.
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
 * @typedef {Object} BandSpec
 * @property {number} leftPct                  Left edge, percent of span.
 * @property {number} widthPct                 Width, percent of span.
 * @property {string} top                      CSS length for `top` (px or calc()).
 * @property {string} height                   CSS length for `height` (px or calc()).
 * @property {string} className                Full class string for the band.
 * @property {string} [label]                  Text label; rendered in a child span.
 * @property {string} [labelClass]             Class for the label span.
 * @property {string} [background]             CSS background.
 * @property {string} [borderColor]            CSS border-color.
 * @property {string} [color]                  CSS text color.
 * @property {string} [title]                  Native hover tooltip.
 * @property {Record<string, string>} [data]   data-* attributes (name -> value).
 * @property {() => void} [onClick]            Click handler (event already stopped).
 */

/**
 * @typedef {Object} MiniItem
 * @property {string} id
 * @property {number} startMs
 * @property {number} endMs
 * @property {string} label
 * @property {string} color           Solid hex, e.g. "#5A7488".
 * @property {string} [title]
 * @property {boolean} [selected]
 * @property {boolean} [dimmed]
 */

/**
 * @typedef {Object} MiniTimelineOptions
 * @property {MiniItem[]} items
 * @property {{ startMs: number, endMs: number }} span
 * @property {number} maxLanes        Lane cap; overflow items share the last lane.
 * @property {number} laneHeight      Natural lane height in px (the minHeight floor).
 * @property {string} blockClass      Base block class, e.g. "step-block".
 * @property {string} idAttr          data-* attribute for the id, e.g. "data-step-id".
 * @property {number} [zoom]          Horizontal zoom factor, >= 1 (default 1).
 * @property {string} [labelClass]    Class for each block's label span.
 * @property {string} [tintAlpha]     Hex alpha appended to color for the fill (default "1F").
 * @property {string} [borderAlpha]   Hex alpha appended to color for the border (default "55").
 * @property {string} [selectedId]    Id to scroll into view after render.
 * @property {(id: string) => void} [onSelect]
 */

/** Vertical gap between lanes, in px. */
const LANE_GAP = 2;
/** Height of the time-axis row, in px. */
const AXIS_H = 16;
/** Gap between the lane stack and the axis, in px. */
const AXIS_GAP = 4;

/**
 * Tick-interval ladder, ascending, in ms (1s .. 24h). The shared superset of
 * the three ladders previously hard-coded across the timelines; `chooseTicks`
 * picks the smallest rung that keeps the tick count at or below the target.
 */
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
 * @returns {Tick[]} Ticks ordered by time; empty when the span is non-positive.
 */
function chooseTicks(startMs, endMs, targetCount) {
  const spanMs = endMs - startMs;
  if (!(spanMs > 0)) return [];
  const target = spanMs / Math.max(1, targetCount);
  let intervalMs = TICK_LADDER_MS[TICK_LADDER_MS.length - 1];
  for (const rung of TICK_LADDER_MS) {
    if (rung >= target) { intervalMs = rung; break; }
  }
  /** @type {Tick[]} */
  const ticks = [];
  const firstTick = Math.ceil(startMs / intervalMs) * intervalMs;
  for (let t = firstTick; t <= endMs; t += intervalMs) {
    ticks.push({ tMs: t, label: formatAxisLabel(t, intervalMs), xPct: timeToXPct(t, startMs, spanMs) });
  }
  return ticks;
}

/**
 * Greedily pack time-ranged items into non-overlapping lanes. Overlap is judged
 * on a *visual* footprint: each item is padded to a minimum width so two items
 * a few ms apart still land on separate lanes. Unifies the old assignLanes /
 * layoutCaseLanes / inline phase-editor lane loop.
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
 * Create one absolutely-positioned timeline band/block and append it to host.
 * @param {HTMLElement} host
 * @param {BandSpec} spec
 * @returns {HTMLElement} the band element
 */
function renderBand(host, spec) {
  const band = document.createElement("div");
  band.className = spec.className;
  band.style.left = spec.leftPct + "%";
  band.style.width = spec.widthPct + "%";
  band.style.top = spec.top;
  band.style.height = spec.height;
  if (spec.background) band.style.background = spec.background;
  if (spec.borderColor) band.style.borderColor = spec.borderColor;
  if (spec.color) band.style.color = spec.color;
  if (spec.title) band.title = spec.title;
  if (spec.data) {
    for (const [name, value] of Object.entries(spec.data)) band.setAttribute(name, value);
  }
  if (spec.label != null) {
    const lbl = document.createElement("span");
    if (spec.labelClass) lbl.className = spec.labelClass;
    lbl.textContent = spec.label;
    band.appendChild(lbl);
  }
  if (spec.onClick) {
    const onClick = spec.onClick;
    band.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  }
  host.appendChild(band);
  return band;
}

/**
 * Render the time-axis row (ticks + labels) into host.
 * @param {HTMLElement} host
 * @param {Tick[]} ticks
 * @param {{ top?: string, axisHeight?: number }} [opts]
 * @returns {HTMLElement} the axis element
 */
function renderAxis(host, ticks, opts) {
  const axisHeight = (opts && opts.axisHeight) || AXIS_H;
  const axis = document.createElement("div");
  axis.className = "tl-time-axis";
  axis.style.top = (opts && opts.top) || `calc(100% - ${axisHeight}px)`;
  axis.style.height = axisHeight + "px";
  for (const tick of ticks) {
    const tickEl = document.createElement("div");
    tickEl.className = "tl-tick";
    tickEl.style.left = tick.xPct + "%";
    const lbl = document.createElement("span");
    lbl.className = "tl-tick-label";
    lbl.textContent = tick.label;
    tickEl.appendChild(lbl);
    axis.appendChild(tickEl);
  }
  host.appendChild(axis);
  return axis;
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
 * is a heterogeneous vertical stack (ticks, cases, activity, screenshots, the
 * optional lanes); this resolves that stack the way packLanes resolves the
 * single-block-type mini-timelines.
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
 * plugin (ADR-0003 item 5). Unlike renderMiniTimeline this does NOT clear host
 * or bind host listeners -- the caller owns the host lifecycle (innerHTML,
 * click handlers, overlays such as a playhead).
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

/**
 * Render a single-block-type mini-timeline -- the Steps and Phases strips: a
 * lane-packed row of blocks plus a bottom time axis, scaled to fill the
 * drag-resizable strip height. Replaces the bodies of renderStepTimeline and
 * renderPhaseTimeline.
 * @param {HTMLElement} host  The `.timeline` element inside `.mini-timeline-scroll`.
 * @param {MiniTimelineOptions} opts
 * @returns {void}
 */
function renderMiniTimeline(host, opts) {
  host.innerHTML = "";
  const { items, span } = opts;
  if (!items.length || !span || span.endMs <= span.startMs) return;
  const spanMs = span.endMs - span.startMs;
  const zoom = Math.max(1, opts.zoom || 1);
  host.style.width = 100 * zoom + "%";

  const { laneCount, laneOf } = packLanes(
    items.map((it) => ({ id: it.id, startMs: it.startMs, endMs: it.endMs })),
    { maxLanes: opts.maxLanes, spanMs }
  );

  // Lanes scale via calc() to fill the resizable strip; minHeight floors them
  // at natural size so a short strip scrolls rather than crushing the bands.
  const naturalH = laneCount * (opts.laneHeight + LANE_GAP) + AXIS_H + AXIS_GAP;
  host.style.height = "100%";
  host.style.minHeight = naturalH + "px";
  const laneSlot = `((100% - ${AXIS_H + AXIS_GAP}px) / ${laneCount})`;

  const tickCount = Math.max(4, Math.round(10 * zoom));
  renderAxis(host, chooseTicks(span.startMs, span.endMs, tickCount));

  const tintAlpha = opts.tintAlpha || "1F";
  const borderAlpha = opts.borderAlpha || "55";
  const onSelect = opts.onSelect;
  for (const it of items) {
    const lane = laneOf.get(it.id) || 0;
    renderBand(host, {
      leftPct: timeToXPct(it.startMs, span.startMs, spanMs),
      widthPct: Math.max(0.5, ((it.endMs - it.startMs) / spanMs) * 100),
      top: `calc(${laneSlot} * ${lane})`,
      height: `calc(${laneSlot} - ${LANE_GAP}px)`,
      className: opts.blockClass
        + (it.selected ? " selected" : "")
        + (it.dimmed ? " dimmed" : ""),
      label: it.label,
      labelClass: opts.labelClass,
      background: it.color + tintAlpha,
      borderColor: it.color + borderAlpha,
      color: it.color,
      title: it.title,
      data: { [opts.idAttr]: it.id },
      onClick: onSelect ? () => onSelect(it.id) : undefined,
    });
  }

  // Scroll the selected block into the horizontal centre of the viewport.
  if (opts.selectedId) {
    const sel = host.querySelector(`.${opts.blockClass}[${opts.idAttr}="${opts.selectedId}"]`);
    const scroll = host.parentElement;
    if (sel instanceof HTMLElement && scroll) {
      const target = sel.offsetLeft + sel.offsetWidth / 2 - scroll.clientWidth / 2;
      scroll.scrollLeft = Math.max(0, target);
    }
  }
}

module.exports = {
  LANE_GAP,
  AXIS_H,
  AXIS_GAP,
  timeToXPct,
  formatAxisLabel,
  chooseTicks,
  packLanes,
  renderBand,
  renderAxis,
  renderMiniTimeline,
  layoutLaneStack,
  renderLaneStack,
};
