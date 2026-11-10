/*
 * flow-view-timeline.js -- the Flow timeline subsystem.
 *
 * Extracted from flow-view.js (god-file split). Owns renderTimeline (the lane
 * stack: ticks / runs / activity+idle+markers / transcript / screenshots /
 * steps, via TimelineCore.renderLaneStack, and the lanes' names at its left,
 * renderLaneNames), the lane plugins' helpers
 * (layoutCaseLanes, monitorBadgeFor), the minimap, the lane-visibility
 * toggles, per-session zoom/scroll persistence, the timeline summary line,
 * and the zoom / middle-drag-pan / scroll-persist wiring. Self-wires its DOM
 * controls at require() time.
 *
 * Requires the sibling Flow modules one-way (apps / video / screenshots) and
 * marker-edits.js (the markers with the analyst's changes laid over them) for
 * the values the lanes render. The cross-surface glue that lives back in
 * flow-view.js (currentScopeRange for the case scope, showMarkerInsertMenu
 * and showCaseContextMenu for the timeline context menus) is injected via
 * initTimeline(), so this module never require()s flow-view.js.
 * flow-view.js re-exports renderTimeline on its own surface, so renderer.js
 * sees no change.
 */

"use strict";

const TimelineCore = require("../timeline/timeline-core.js");
const State = require("../state.js");
const { $, formatDuration, placeMenu, recordingStartMs, sinceStart, toast } = require("../dom.js");
const { appColor, appLabel, renderLegend } = require("./flow-view-apps.js");
const { seekToTimestamp, timelineSpan, attachVideo } = require("./flow-view-video.js");
const AC = require("../analyst-content.js");
const MarkerEdits = require("../marker-edits.js");
const RunsModel = require("../runs-model.js");
const { numberOnlyLabel } = RunsModel;
const { isoMs } = require("../run-differences.js");
const LeftOut = require("../left-out.js");
const SPM = require("../sub-process-maps.js");
const StepOrder = require("../step-order.js");
const RO = require("../read-only.js");
const { openScreenshot, timelineScreenshots, screenshotTitle } = require("./flow-view-screenshots.js");
const { transcriptLane: makeTranscriptLane } = require("./flow-view-transcript.js");
const { videoLane: makeVideoLane } = require("./video-lane.js");
const { moveMarker, insertMarker, applyNote } = require("./flow-view-markers.js");
const { SNAP_PX, MIN_SPAN_MS, snapMs, markerDragBounds, stepSide, stepSideChanges, markerMoments, isOpen } = require("../time-edits.js");

/* NAV-AUDIT §J/§9: case-label density. At a multi-hour span dozens of case
   bands pack into ~1500px and their left-anchored labels overlap into
   unreadable repetition (the audit saw 60 labels collide at 3.60h). A case
   label renders ONLY when its band is at least CASE_LABEL_MIN_PX wide on screen;
   narrower bands stay a pure colour stripe (the full label is always one hover
   away in the band's title). Zooming in widens the bands, so labels reappear.
   Because layoutCaseLanes packs non-overlapping bands per lane, a per-band width
   floor is sufficient — a labelled band has room before the next band in its
   lane. Pure + unit-tested (flow-view-timeline.test.js). */
const CASE_LABEL_MIN_PX = 46;
/** @returns {boolean} whether a case band that spans `widthPct` percent of a
 *  `hostW`-px-wide timeline is wide enough to carry its label. */
function caseLabelFits(widthPct, hostW, minPx) {
  const floor = (typeof minPx === "number") ? minPx : CASE_LABEL_MIN_PX;
  return ((widthPct / 100) * (hostW || 0)) >= floor;
}

/* The moment under the pointer on the Flow timeline, as an ISO string: `rect`
   is the timeline host's client rect (its whole zoomed width, however far it
   is scrolled), firstMs / lastMs the session's first and last event times,
   which the lanes lay out across that width. Clamped to the session; null
   when the geometry is unusable. Pure + unit-tested (flow-view-timeline.test.js). */
function timeAtClientX(clientX, rect, firstMs, lastMs) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(clientX) ||
      !Number.isFinite(firstMs) || !Number.isFinite(lastMs) || lastMs < firstMs) return null;
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  return new Date(firstMs + (x / rect.width) * (lastMs - firstMs)).toISOString();
}

/* ============ Dragging a side, and snapping (2.0.3) ===============
   A process manager's report: a transaction started a few pixels after the
   step it was meant to hold, and nothing could move either of them. The
   transactions' sides and the sides of a step whose time is the analyst's
   (AC.stepTimeMovable) are dragged on the timeline, by the rules Steps types
   times with (time-edits.js); a side dragged, and a moment right-clicked for
   a transaction or a step, comes to a side drawn or to the playhead within
   SNAP_PX of it. A transaction's Start or End comes only to a step's start:
   a marker at a step's last action would part that action from its step (a
   marker sorts before an action of the same time). */
/* A side is found within EDGE_PX of a band's edge (a third of a narrow
   band), and moves once the pointer has gone DRAG_PX. */
const EDGE_PX = 6;
const DRAG_PX = 3;

/* The sides the last render drew that a moment snaps to: { ms, key, kind },
   the key naming the side ("m:<marker key>", "s:<step id>:start" or ":end"),
   the kind "tx" (a transaction's side), "step-start" or "step-end". */
let _edgeTargets = [];
/* The kinds of side each kind of moment comes to. */
const SNAPS_TO = { marker: ["step-start"], step: ["step-start", "step-end", "tx"] };

/* The playhead's moment (ms) while it is drawn, else null. */
function _playheadMs(firstMs, spanMs) {
  const ph = document.getElementById("tl-playhead");
  if (!ph || ph.style.display === "none") return null;
  const pct = parseFloat(ph.style.left);
  return Number.isFinite(pct) ? firstMs + (pct / 100) * spanMs : null;
}

/* What a moment of kind `what` ("marker" or "step") snaps to: the sides
   drawn of the kinds it comes to but the ones named in `skip` (a dragged
   side's own, and one that moves with it), and the playhead. */
function _snapTargets(what, skip, firstMs, spanMs) {
  const kinds = SNAPS_TO[what] || [];
  const out = _edgeTargets.filter((t) => kinds.includes(t.kind) && !skip.includes(t.key)).map((t) => t.ms);
  const ph = _playheadMs(firstMs, spanMs);
  if (ph != null) out.push(ph);
  return out;
}

/* The moment a right-click at `iso` names for a transaction's start or end
   (`what` "marker") or for a new step ("step"), the timeline's menu in
   flow-view.js: a side drawn or the playhead within SNAP_PX of it, else `iso`
   itself. */
function snapMoment(iso, what) {
  const ms = Date.parse(iso);
  const host = document.getElementById("timeline");
  const sp = timelineSpan();
  if (!Number.isFinite(ms) || !host || !sp || !(host.clientWidth > 0)) return iso;
  const span = Math.max(1, sp.endMs - sp.startMs);
  const t = snapMs(ms, _snapTargets(what, [], sp.startMs, span), (SNAP_PX / host.clientWidth) * span);
  return t === ms ? iso : new Date(t).toISOString();
}

/* A band drawn from `startMs` to `endMs` (its left and width in percent). */
function _placeBand(el, startMs, endMs, firstMs, spanMs, minPct) {
  el.style.left = (((startMs - firstMs) / spanMs) * 100) + "%";
  el.style.width = Math.max(minPct, ((endMs - startMs) / spanMs) * 100) + "%";
}

/* Make a band's sides draggable. `g` = { host, firstMs, spanMs, origin,
   edges: { start, end }, begin(edge) }. `begin` is asked as a side is pressed
   and gives { fromMs, lo, hi, targets, preview(ms), restore(), commit(ms) },
   or null when that side does not move. The pointer over a side that drags
   shows the resize cursor; once pressed and moved DRAG_PX, the side follows
   the pointer, snapping to `targets` and kept in [lo, hi], its time above
   it; the release commits, Esc puts it back. The click the release of a
   drag makes (dropped or put back) is not a click on the band. */
function wireEdgeDrag(band, g) {
  const sideAt = (clientX) => {
    const r = band.getBoundingClientRect();
    const zone = Math.min(EDGE_PX, r.width / 3);
    if (g.edges.start && clientX - r.left <= zone) return "start";
    if (g.edges.end && r.right - clientX <= zone) return "end";
    return null;
  };
  band.addEventListener("mousemove", (e) => {
    if (!document.body.classList.contains("tl-edge-dragging")) band.classList.toggle("tl-edge-hot", !!sideAt(e.clientX));
  });
  band.addEventListener("mouseleave", () => band.classList.remove("tl-edge-hot"));
  band.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.shiftKey) return;
    const edge = sideAt(e.clientX);
    const d = edge ? g.begin(edge) : null;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    _dragEdge(e, band, g, d);
  });
}

function _dragEdge(e0, band, g, d) {
  const rect = g.host.getBoundingClientRect();
  const tolMs = (SNAP_PX / Math.max(1, rect.width)) * g.spanMs;
  // The side never jumps where it is pressed: a marker closer to its
  // neighbour than MIN_SPAN_MS (an End and the next Start the capture app
  // wrote together) or a step shorter than it keeps its place in range.
  const lo = Math.min(d.lo, d.fromMs), hi = Math.max(d.hi, d.fromMs);
  // pressed, then dragging once moved, cancelled by Esc (until the release).
  let phase = "pressed", ms = d.fromMs;
  const tip = document.createElement("div");
  tip.className = "tl-drag-time";
  const stopShowing = () => {
    document.body.classList.remove("tl-edge-dragging");
    tip.remove();
  };
  const onMove = (e) => {
    if (phase === "cancelled") return;
    if (phase === "pressed") {
      if (Math.abs(e.clientX - e0.clientX) < DRAG_PX) return;
      phase = "dragging";
      document.body.classList.add("tl-edge-dragging");
      g.host.appendChild(tip);
    }
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    ms = Math.min(hi, Math.max(lo, snapMs(g.firstMs + (x / rect.width) * g.spanMs, d.targets, tolMs)));
    d.preview(ms);
    tip.style.left = (((ms - g.firstMs) / g.spanMs) * 100) + "%";
    tip.style.top = Math.max(0, band.offsetTop - 17) + "px";
    tip.textContent = sinceStart(new Date(ms).toISOString(), g.origin);
  };
  const onKey = (e) => {
    if (e.key !== "Escape" || phase !== "dragging") return;
    e.preventDefault();
    e.stopPropagation();
    phase = "cancelled";
    stopShowing();
    d.restore();
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("keydown", onKey, true);
    stopShowing();
    if (phase === "pressed") return;   // no drag: the press is a click
    // The click this release makes belongs to the drag, not to the band.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener("click", swallow, true);
    setTimeout(() => document.removeEventListener("click", swallow, true), 0);
    if (phase === "cancelled") return;
    if (ms === d.fromMs) { d.restore(); return; }
    Promise.resolve(d.commit(ms)).catch(() => d.restore());
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
  document.addEventListener("keydown", onKey, true);
}

/* Injected by flow-view.js via initTimeline() -- kept out of a require() to
   avoid a flow-view <-> timeline cycle. */
let currentScopeRange = () => null;
let showMarkerInsertMenu = () => {};
let showCaseContextMenu = () => {};
let includeAgain = async () => {};

/* The stretches left out of the analysis (annotations.excluded_ranges) the
   Timeline draws, in time order: [{ range, startMs, endMs }] for each entry
   that can be read (start before end), `range` the entry itself (Include
   again removes it). Pure + unit-tested (flow-view-timeline.test.js). */
function leftOutBands(ranges) {
  const out = [];
  for (const r of Array.isArray(ranges) ? ranges : []) {
    // Read as the differences rule reads them (a time without a zone is UTC).
    const a = isoMs(r && r.start), b = isoMs(r && r.end);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) out.push({ range: r, startMs: a, endMs: b });
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

/* Lane FX2 (validation pass 2, F10): an app the analyst put among the apps
   outside the process (annotations.step_filters.ignored_processes, the
   process names the dialog lists) is left out of the analysis: its bands are
   drawn hatched like a stretch left out. The pipeline's rule for a window
   band (process_filter.py): the process name, without ".exe" and case,
   is one of them. Pure + unit-tested. */
function _procKey(p) {
  const s = String(p == null ? "" : p).trim().toLowerCase();
  return s.endsWith(".exe") ? s.slice(0, -4) : s;
}
function appLeftOut(app, ignored) {
  const key = _procKey(app);
  return !!key && (Array.isArray(ignored) ? ignored : []).some((p) => typeof p === "string" && _procKey(p) === key);
}
/* What such a band says under the pointer, before the band's own lines. */
function appLeftOutTitle(system) {
  return "Left out of the analysis: " + (system || "this app") + " is among the apps outside the process, so its steps " +
    "are not drafted and its time is not counted. Apps outside the process, in Steps, includes it again.";
}

/* What a band left out of the analysis says under the pointer. Lane E (E4):
   in a project without a recording (`recorded` false) the stretch is not
   part of the process, and its band says what that does. */
function leftOutTitle(startText, endText, recorded) {
  const times = startText && endText ? ", " + startText + " to " + endText : "";
  if (recorded === false) {
    return "Not part of the process" + (startText && endText ? ": " + startText + " to " + endText : "") +
      ". Click it to include it again.";
  }
  return "Left out of the analysis" + times +
    ": its steps are not drafted and its time is not counted. Click to include it again.";
}
const LEFT_OUT_LABEL = "Left out of the analysis";
const LEFT_OUT_LABEL_SHORT = "Left out";
/* The label a band `px` wide shows: the whole of it where it fits, else its
   first words, else none (the tooltip and the legend say it). Pure +
   unit-tested. */
function leftOutLabel(px, recorded) {
  const w = Number(px) || 0;
  const words = LeftOut.wordsFor(recorded !== false);
  return w >= 150 ? words.band : w >= 64 ? words.short : "";
}

/* P1.10: persistent timeline zoom + scroll per session. Keyed by
   sessionFolder so each session reopens to where the analyst left it.
   Uses a small in-memory throttle for scroll writes since scroll fires
   continuously during drag. */
const TL_STATE_KEY = "pdt.timelineState";
function _readTimelineState() {
  try { return JSON.parse(localStorage.getItem(TL_STATE_KEY)) || {}; }
  catch (_) { return {}; }
}
function _writeTimelineState(map) {
  try { localStorage.setItem(TL_STATE_KEY, JSON.stringify(map)); }
  catch (_) {}
}
function persistTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const scroll = document.getElementById("timeline-scroll");
  map[State.getSession().sessionFolder] = {
    zoomFactor: State.getZoomFactor(),
    scrollLeft: scroll ? scroll.scrollLeft : 0,
    ts: Date.now(),
  };
  _writeTimelineState(map);
}
function restoreTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const saved = map[State.getSession().sessionFolder];
  if (!saved) return;
  if (typeof saved.zoomFactor === "number" && saved.zoomFactor >= 1) {
    State.setZoomFactor(saved.zoomFactor);
    renderTimeline();
  }
  // Wait one frame so the host has expanded to the new width before scrolling.
  requestAnimationFrame(() => {
    const scroll = document.getElementById("timeline-scroll");
    if (scroll && typeof saved.scrollLeft === "number") scroll.scrollLeft = saved.scrollLeft;
  });
}
let _tlScrollPersistTimer = null;
function _wireTimelineScrollPersist() {
  const scroll = document.getElementById("timeline-scroll");
  if (!scroll || scroll._pdtPersistWired) return;
  scroll._pdtPersistWired = true;
  scroll.addEventListener("scroll", () => {
    syncMinimapViewport();
    if (_tlScrollPersistTimer) return;
    _tlScrollPersistTimer = setTimeout(() => {
      _tlScrollPersistTimer = null;
      persistTimelineForCurrent();
    }, 250);
  });
}
/* I2: on the first load of a session (no remembered timeline view),
   nudge the scroll to the first case so a long recording doesn't open
   on empty pre-case time. Skipped once the analyst has zoomed or
   scrolled -- restoreTimelineForCurrent already owns that case. */
function maybeAutoScrollToFirstCase() {
  const sess = State.getSession();
  if (!sess || !sess.sessionFolder) return;
  if (_readTimelineState()[sess.sessionFolder]) return;   // remembered view
  if (State.getZoomFactor() !== 1) return;                // default zoom only
  const cases = (sess.stats && sess.stats.case_stats) || [];
  const evs = sess.events || [];
  if (!evs.length) return;
  const tops = cases
    .filter((c) => !c.parent_case_id && c.start_ts)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts));
  if (!tops.length) return;
  const first = Date.parse(evs[0].timestamp);
  const last = Date.parse(evs[evs.length - 1].timestamp);
  const span = Math.max(1, last - first);
  const frac = (Date.parse(tops[0].start_ts) - first) / span;
  if (!isFinite(frac) || frac < 0.04) return;   // first case already near the start
  requestAnimationFrame(() => {
    const scroll = document.getElementById("timeline-scroll");
    if (scroll) scroll.scrollLeft = Math.max(0, frac * scroll.scrollWidth - 48);
  });
}

// Zoom controls. 1.5x in / out (floor 1) / reset, each re-renders + persists.
$("#btn-zoom-in").addEventListener("click", () => { State.setZoomFactor(State.getZoomFactor() * 1.5); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-out").addEventListener("click", () => { State.setZoomFactor(Math.max(1, State.getZoomFactor() / 1.5)); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-reset").addEventListener("click", () => { State.setZoomFactor(1); renderTimeline(); persistTimelineForCurrent(); });

/* P1.3: minimap overview above the timeline. A 30px strip showing the
   whole session compressed; the highlighted rectangle marks the
   currently-visible region in the scroll container. Click anywhere to
   jump; drag the rectangle to scroll. Shown only while the timeline is
   zoomed in: at zoom 1 the timeline itself is the whole session. */
function renderMinimap() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  if (!mm || !scroll || !State.getSession() || !State.getSession().events) return;
  const evs = State.getSession().events;
  const sp = timelineSpan();
  if (!sp || !(State.getZoomFactor() > 1)) { mm.style.display = "none"; mm.innerHTML = ""; return; }
  mm.style.display = "";
  const first = sp.startMs;
  const span  = Math.max(1, sp.endMs - first);
  // Build / reset content.
  mm.innerHTML = "";
  // Activity bands (compressed). Skip very short ones for clarity.
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const dur = ev.data.duration_ms || 0;
    if (dur < span * 0.0005) continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.1, (dur / span) * 100);
    const b = document.createElement("div");
    b.className = "tl-mm-band";
    b.style.left = x + "%";
    b.style.width = w + "%";
    b.style.background = appColor(ev.data.app);
    mm.appendChild(b);
  }
  // Viewport rectangle.
  const vp = document.createElement("div");
  vp.className = "tl-mm-viewport";
  vp.id = "tl-mm-viewport";
  mm.appendChild(vp);
  syncMinimapViewport();
}
function syncMinimapViewport() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  const vp = document.getElementById("tl-mm-viewport");
  if (!mm || !scroll || !vp) return;
  const inner = scroll.scrollWidth || 1;
  const outer = scroll.clientWidth || 1;
  const visibleFrac = Math.min(1, outer / inner);
  const startFrac   = scroll.scrollLeft / inner;
  vp.style.left  = (startFrac * 100) + "%";
  vp.style.width = (visibleFrac * 100) + "%";
}
(function wireMinimap() {
  const mm = document.getElementById("timeline-minimap");
  if (!mm || mm._pdtWired) return;
  mm._pdtWired = true;
  mm.addEventListener("click", (e) => {
    // Click outside the viewport rect → jump there.
    if (e.target.id === "tl-mm-viewport") return;
    const scroll = document.getElementById("timeline-scroll");
    if (!scroll) return;
    const rect = mm.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const inner = scroll.scrollWidth || 1;
    const outer = scroll.clientWidth || 1;
    scroll.scrollLeft = Math.max(0, frac * inner - outer / 2);
    syncMinimapViewport();
    persistTimelineForCurrent();
  });
  // Drag the viewport.
  let dragging = null;
  mm.addEventListener("mousedown", (e) => {
    if (e.target.id !== "tl-mm-viewport") return;
    e.preventDefault();
    const vp = e.target;
    vp.classList.add("dragging");
    const scroll = document.getElementById("timeline-scroll");
    const rect = mm.getBoundingClientRect();
    dragging = { startX: e.clientX, startScrollLeft: scroll.scrollLeft, mmW: rect.width, scroll };
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dxPx = e.clientX - dragging.startX;
    const inner = dragging.scroll.scrollWidth || 1;
    const dxScroll = (dxPx / Math.max(1, dragging.mmW)) * inner;
    dragging.scroll.scrollLeft = Math.max(0, dragging.startScrollLeft + dxScroll);
    syncMinimapViewport();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    const vp = document.getElementById("tl-mm-viewport");
    if (vp) vp.classList.remove("dragging");
    dragging = null;
    persistTimelineForCurrent();
  });
})();

/* Middle-button drag-to-pan the Flow timeline. Without this, middle-clicking the
   scrollable #timeline-scroll triggered Chromium's native auto-scroll: it bounced
   erratically toward the cursor and left the page in auto-scroll mode, so the next
   click was swallowed exiting it ("locked controls"). We suppress the native
   behaviour (preventDefault on the middle-button mousedown + the trailing
   auxclick) and pan by adjusting scrollLeft directly. Any mouseup clears the pan
   state, so it can never stick; the move/up listeners are inert unless a
   middle-drag is in progress. */
(function wireTimelinePan() {
  const scroll = document.getElementById("timeline-scroll");
  if (!scroll || scroll._pdtPanWired) return;
  scroll._pdtPanWired = true;
  let pan = null;
  scroll.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;            // middle button only
    e.preventDefault();                     // suppress Chromium's native auto-scroll
    pan = { startX: e.clientX, startScrollLeft: scroll.scrollLeft };
    scroll.classList.add("panning");
  });
  document.addEventListener("mousemove", (e) => {
    if (!pan) return;
    scroll.scrollLeft = Math.max(0, pan.startScrollLeft - (e.clientX - pan.startX));
    syncMinimapViewport();
  });
  document.addEventListener("mouseup", () => {
    if (!pan) return;
    pan = null;
    scroll.classList.remove("panning");
    persistTimelineForCurrent();
  });
  // The auxclick that fires after a middle release can re-enter auto-scroll on
  // some builds; swallow it while we own the gesture.
  scroll.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
})();

function renderTimelineSummary() {
  const evs = State.getSession().events;
  if (!evs.length) {
    // A video project (C16): the Timeline follows its video.
    const sp = timelineSpan();
    $("#timeline-summary").textContent = sp ? "Video · " + formatDuration(sp.endMs - sp.startMs) : "";
    return;
  }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  // The one place the time of day shows: the recording's date and start.
  $("#timeline-summary").textContent = "Recorded " + first.toLocaleDateString() + " " +
    first.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " · " + formatDuration(last - first);
}

/* NAV-AUDIT §A3: the labeled Flow→Steps affordance for a steps-lane band. A
   plain band click selects + seeks (no view change); this right-click menu is
   the LABELED verb that actually switches to Steps, reusing the arrival-reveal
   (setSelectedStepId + setPendingStepReveal, which the Steps render consumes to
   scroll the row into view). The owner, after 2.0.3: "you always add steps
   sequentially", so the next step is right-clicked on the band of the one
   before it: the menu marks at `at`, the moment right-clicked, first
   (flow-view.js showMarkerInsertMenu), then the step's own items, under its
   `name`. */
function _showStepBandMenu(x, y, stepId, ts, at, name) {
  const items = [];
  const addItem = (label, handler) => items.push([label, handler]);
  addItem("Open in Steps", () => {
    if (stepId) {
      // This step is the explicit target: drop a seek position an earlier
      // click parked for the Steps view, or it would select the step at that
      // older moment instead.
      State.consumePendingStepJump();
      State.setSelectedStepId(stepId);
      State.setPendingStepReveal();   // Steps render reveals the row (its run opens)
    }
    const stepsBtn = document.querySelector('.view-mode-btn[data-level="steps"]');
    if (stepsBtn) setTimeout(() => stepsBtn.click(), 0);
  });
  addItem("Select + seek here", () => {
    if (stepId) State.setSelectedStepId(stepId);
    if (ts) seekToTimestamp(ts);
  });
  // 2.0.1: take the step out here, as in Steps: a step added by hand is
  // deleted (asked first), a recorded one hidden; Ctrl+Z brings it back.
  const sess = State.getSession();
  const hit = stepId && sess && !RO.isReadOnly(sess)
    ? SPM.findStep((sess.annotations && sess.annotations.steps) || [], stepId) : null;
  if (hit && hit.step.state !== "hidden") {
    // C22 (2.0.5, the owner's report): a correction the SME shows late in the
    // video belongs earlier in the process; its band stays here.
    addItem("Place after a step…", () => require("./steps-view.js").placeStepAfterAction(stepId));
    if (placedLine(hit.step)) addItem("Back to its time", () => require("./steps-view.js").backToTimeAction(stepId));
    addItem(hit.step.state === "manually_authored" ? "Delete step" : "Hide step",
      () => require("./steps-view.js").deleteStep(stepId));
  }
  showMarkerInsertMenu(x, y, at || ts, { title: name || "This step", items });
}

/* C22: the line a step placed elsewhere in the process than its time puts
   it says on its band ("In the process: after "Check the stock". Here: where
   it was shown."), "" for a step its time places. */
function placedLine(step) {
  const sess = State.getSession();
  const hit = step && sess ? SPM.findStep((sess.annotations && sess.annotations.steps) || [], step.step_id) : null;
  if (!hit || step.placed_after == null) return "";
  const key = (s) => (s && typeof s.case_id === "string" && s.case_id ? s.case_id : null);
  const list = hit.list.filter((s) => s && s.state !== "hidden" && (hit.depth || key(s) === key(step)));
  const a = StepOrder.anchorOf(step, list);
  if (!a) return "";
  return "In the process: " + (a === StepOrder.START ? "first in its transaction"
    : 'after "' + (String(a.name || "").trim() || "a step") + '"') + ". Here on the Timeline: where it was shown.";
}

/* A small context menu at (x, y): items = [[label, act], ...] (the notes
   lane's). The same look and dismissal as the menus above. */
function _menu(x, y, items) {
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();
  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText = "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);min-width:160px;cursor:default;user-select:none;";
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    close();
  };
  for (const [label, act] of items) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => { item.style.background = "var(--accent)"; });
    item.addEventListener("mouseleave", () => { item.style.background = ""; });
    item.addEventListener("click", () => { close(); act(); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  placeMenu(menu, x, y);
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
}

/* P2.D / R1 timeline-defaults pass: lane visibility. The timeline's job is
   find-the-moment (DISCLOSURE-MODEL "Flow / Steps / Phases" = Evidence), so a
   fresh profile opens with only the apps/activity lane (always on, no toggle)
   and the case-span lane visible; every other lane -- including markers and
   screenshots, previously on by default -- starts collapsed and is one click
   away in the Lanes menu. This changes ONLY the default for a profile with no
   saved preference; getLaneToggles() below still layers a saved choice from
   localStorage over these defaults, so an analyst who already turned a lane on
   keeps seeing it on. Persisted per-installation since it's a workflow
   preference, not session data. */
const LANE_KEY = "pdt.timelineLanes";
const LANE_DEFAULTS = {
  // V2 item 8: the Steps lane is on by default (the Timeline's link to Steps
  // and to the step panel).
  idle: true, screenshots: false, cases: true, steps: true,
  // C8: exists only while a transcript is attached; on when it does.
  transcript: true,
  // C23: exists only while a video is added; on when one is.
  videos: true,
  // C16: exists only while a note is pinned to a moment; on when one is.
  notes: true,
};
function getLaneToggles() {
  try {
    const saved = JSON.parse(localStorage.getItem(LANE_KEY)) || {};
    return Object.assign({}, LANE_DEFAULTS, saved);
  } catch (_) { return Object.assign({}, LANE_DEFAULTS); }
}
function setLaneToggle(key, on) {
  const cur = getLaneToggles();
  cur[key] = !!on;
  try { localStorage.setItem(LANE_KEY, JSON.stringify(cur)); } catch (_) {}
}
(function wireLanesMenu() {
  const btn = document.getElementById("btn-lanes");
  const popup = document.getElementById("lanes-popup");
  if (!btn || !popup) return;
  // Reflect persisted state into the checkboxes.
  const toggles = getLaneToggles();
  popup.querySelectorAll("input[data-lane]").forEach((cb) => {
    cb.checked = !!toggles[cb.dataset.lane];
    cb.addEventListener("change", () => {
      setLaneToggle(cb.dataset.lane, cb.checked);
      if (State.getSession()) renderTimeline();
    });
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.style.display = popup.style.display === "none" ? "" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) popup.style.display = "none";
  });
})();

/* The lanes' names at the left of the timeline (the owner's review: "the
   lanes also don't have a description"): each drawn lane shows its name,
   and its tooltip says what the lane shows. The ticks have none. The
   screenshot mark's icon is the Screenshots lane's key too; a speech bubble
   is the Transcript lane's. */
const TRANSCRIPT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linejoin="round"><path d="M2.5 3h11v7.5h-6.5l-3 2.5v-2.5h-1.5z"/></svg>';
const SCREENSHOT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
  '<circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L6 21"/></svg>';
const LANE_NAMES = {
  cases: { name: "Transactions", title: "Transactions: each pass through the process, from its start to its end; click one to go to its start." },
  activity: { name: "Systems", title: "Systems: the system on screen at each moment, one band per window; click a band to go there, right-click to start or end a transaction or to add a note." },
  videos: { name: "Videos", title: "Videos: the videos of this project where they are on the timeline, one after the other; click one to go there, drag a side to trim it, right-click to trim, replace or remove it, or to add a video." },
  transcript: { name: "Transcript", title: "Transcript: what was said, one block per sentence at the moment it was said, once the transcript is synced; click one to go there." },
  notes: { name: "Notes", title: "Notes: your notes pinned to a moment; click one to go there, right-click to edit or delete it." },
  screenshots: { name: "Screenshots", title: "Screenshots: one mark per screenshot taken during the recording, and one per frame of the video you added to a step; click one to see it full size." },
  steps: { name: "Steps", title: "Steps: each step of each transaction; click one to see all its moments." },
};

/* A lane's key in its header: a small copy of the lane's own marks (a
   transaction's band with its label, the systems' colours, a note's pin, a
   screenshot's mark, a step's band) drawn in CSS, and for the Transcript a
   speech bubble; the Systems key takes the colours of the first systems
   drawn (`keyColours`). No text: the header's text is the lane's name. */
function _laneKey(lane) {
  const key = document.createElement("span");
  key.className = "tl-lane-key tl-lane-key-" + lane.key;
  key.setAttribute("aria-hidden", "true");
  if (lane.key === "activity") {
    const colours = (typeof lane.keyColours === "function" ? lane.keyColours() : []).slice(0, 3);
    for (const colour of colours.length ? colours : [null]) {
      const bar = document.createElement("i");
      if (colour) bar.style.background = colour;
      key.appendChild(bar);
    }
  }
  if (lane.key === "transcript") key.innerHTML = TRANSCRIPT_ICON;
  if (lane.key === "screenshots") key.innerHTML = SCREENSHOT_ICON;
  return key;
}

/* The lanes' header column (the owner's reviews: "the lanes also don't
   have a description", then "just text labels standing there on the
   side"), drawn like a video editor's track headers: one cell per lane,
   from the middle of the gap above it to the middle of the gap under it,
   holding the lane's key and its name; a divider between two lanes, which
   runs on across the timeline as the lanes' separator (and one under the
   last lane). Pointing at a cell lights the lane up across the timeline and
   shows what it shows (its tooltip). The name is centred on the part of its
   lane the lane draws on (`nameH` px from its top, where its marks leave a
   gap under them), else on the whole lane. `lanes` as the stack got them,
   `layout` as it returned, `host` the timeline; null hides the column
   (nothing is drawn). */
function renderLaneNames(lanes, layout, host) {
  const col = document.getElementById("tl-lane-names");
  if (!col) return;
  col.innerHTML = "";
  col.hidden = !layout;
  if (!layout) return;
  const drawn = lanes.filter((l) => l.height > 0 && layout.slots.get(l.key));
  const slotOf = (l) => layout.slots.get(l.key);
  // Under each lane drawn: the middle of the gap to the next one, or 3 px
  // under the last.
  const edges = drawn.map((l, i) => {
    const s = slotOf(l), next = drawn[i + 1];
    return Math.round(next ? (s.top + s.height + slotOf(next).top) / 2 : s.top + s.height + 3);
  });
  const line = (parent, y, before) => {
    const sep = document.createElement("div");
    sep.className = "tl-lane-sep";
    sep.style.top = y + "px";
    if (before) parent.insertBefore(sep, parent.firstChild); else parent.appendChild(sep);
  };
  // Across the timeline, under the marks.
  if (host) for (const y of edges) line(host, y, true);
  drawn.forEach((lane, i) => {
    const n = LANE_NAMES[lane.key];
    if (!n || lane.unnamed) return;
    const s = slotOf(lane);
    const top = i ? edges[i - 1] : 0, bottom = edges[i];
    const mid = s.top + Math.min(s.height, lane.nameH > 0 ? lane.nameH : s.height) / 2;
    // Padding that puts the middle of the cell's content on `mid`.
    const lift = 2 * mid - top - bottom;
    const el = document.createElement("div");
    el.className = "tl-lane-name";
    el.dataset.lane = lane.key;
    el.style.top = top + "px";
    el.style.height = (bottom - top) + "px";
    el.style.paddingTop = Math.max(0, lift) + "px";
    el.style.paddingBottom = Math.max(0, -lift) + "px";
    el.title = lane.title || n.title;
    el.appendChild(_laneKey(lane));
    const label = document.createElement("span");
    label.className = "tl-lane-label";
    // A lane may say more than its kind (C19: "Steps in Save order").
    label.textContent = lane.name || n.name;
    el.appendChild(label);
    if (lane.name) el.classList.add("tl-lane-level");
    // The lane itself, lit across the timeline while the pointer is here.
    if (host) {
      el.addEventListener("mouseenter", () => {
        const lit = document.createElement("div");
        lit.className = "tl-lane-hover";
        lit.style.top = top + "px";
        lit.style.height = (bottom - top) + "px";
        host.insertBefore(lit, host.firstChild);
        el._lit = lit;
      });
      el.addEventListener("mouseleave", () => { if (el._lit) el._lit.remove(); el._lit = null; });
    }
    col.appendChild(el);
  });
  for (const y of edges) line(col, y, false);
  // C19: a lane that names its level widens the column to show the name,
  // up to a limit (its tooltip holds the whole of a longer one); without one
  // the column keeps its width.
  const pane = col.closest(".timeline-pane");
  if (!pane) return;
  pane.style.removeProperty("--tl-names-w");
  const named = col.querySelectorAll(".tl-lane-level");
  if (!named.length) return;
  const usual = parseFloat(getComputedStyle(pane).getPropertyValue("--tl-names-w")) || 0;
  let want = 0;
  for (const el of named) {
    const label = el.querySelector(".tl-lane-label");
    want = Math.max(want, label.scrollWidth + (el.clientWidth - label.clientWidth) + 2);
  }
  if (want > usual) pane.style.setProperty("--tl-names-w", Math.min(want, 240) + "px");
}

/* A step's band on the steps lane: { startMs, endMs } from its time range,
   or null when it has none or it ends before it starts. Lane FX2
   (validation pass 2, F8): a step that starts and ends in the same moment (a
   one-click step) gets a band too, drawn at the lane's smallest width.
   Pure + unit-tested. */
function stepBandSpan(step) {
  const tr = step && step.time_range;
  const a = Date.parse(tr && tr.start), b = Date.parse(tr && tr.end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? { startMs: a, endMs: b } : null;
}

/* The steps the steps lane shows (C19): the level the Steps list shows
   (State.mapPath), inside a sub-process its steps in every visit of it;
   { steps, name } where name is the level's ("" at the main level, where
   the lane shows every visible step). */
function stepsForLevel(session) {
  const anno = (session && session.annotations) || {};
  const all = anno.steps || [];
  const model = RunsModel.buildRuns(session && session.stats, all);
  const txs = model.runs.map((r) => r.members);
  const path = SPM.validPath(txs, State.getMapPath());
  if (!path.length) return { steps: all.filter((s) => s && s.state !== "hidden"), name: "" };
  const pattern = RunsModel.patternRun(anno, model.runs);
  const ref = pattern.run ? Math.max(0, model.runs.indexOf(pattern.run)) : 0;
  return { steps: SPM.levelVisits(txs, path).flatMap((v) => v.visible), name: SPM.nodeName(txs, path, ref) };
}

/* Lane FX3 (validation pass 3, F16): the header's controls act on a drawn
   timeline (the Transaction select dims transactions on it, Lanes picks its
   lanes, the zoom zooms it). A project with no recording and no video has
   none, so they are not offered there; the line in its place says how to
   get one (Attach video). */
const HEADER_CONTROLS = ["case-scope", "lanes-menu", "btn-zoom-out", "btn-zoom-reset", "btn-zoom-in"];
function timelineDrawable(sess) {
  return !!sess && (((sess.events || []).length > 0) || !!sess.recordingAvailable);
}
function _syncHeaderControls(drawable) {
  for (const id of HEADER_CONTROLS) {
    const el = document.getElementById(id);
    if (el) el.style.display = drawable ? "" : "none";
  }
}

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = State.getSession().events;
  _syncHeaderControls(timelineDrawable(State.getSession()));
  // C16: the notes pinned to a moment; the Lanes menu lists their lane only
  // while there are some.
  const allNotes = AC.momentNotes((State.getSession().annotations || {}).analyst_notes);
  const notesRow = document.getElementById("lane-notes-row");
  if (notesRow) notesRow.hidden = !allNotes.length;
  const sp = timelineSpan();
  // The legend explains marks; with nothing drawn there is nothing to explain.
  const legend = document.getElementById("timeline-legend");
  if (legend) legend.style.display = sp ? "" : "none";
  if (!sp) {
    const mm = document.getElementById("timeline-minimap");
    if (mm) mm.style.display = "none";
    renderLaneNames([], null);
    // A session with nothing recorded and no video says so, in one line.
    if (!evs.length && !State.getSession().recordingAvailable) {
      host.style.width = "";
      host.style.minHeight = "";
      host.innerHTML = '<div class="tl-empty" id="tl-empty">No recording and no video in this project. ' +
        '<button type="button" class="link-btn" id="btn-tl-attach-video" title="Attach a video of the process: the Timeline then follows it.">Attach video...</button></div>';
      host.querySelector("#btn-tl-attach-video").addEventListener("click", () => attachVideo());
    }
    return;
  }
  const lanes = getLaneToggles();
  const first = sp.startMs;
  const last = sp.endMs;
  const span = Math.max(1, last - first);
  // One clock (AD-26): the axis, the tooltips and the screenshots read the
  // time since the recording started.
  const origin = recordingStartMs(State.getSession());
  // C8: the Transcript lane exists only while a transcript is attached
  // (flow-view-transcript.js; it also shows the lane's row in the Lanes menu).
  const transcriptLane = makeTranscriptLane({ first, last, span, on: !!lanes.transcript });
  // C23: the Videos lane exists only while the project has a video added
  // (video-lane.js; its row in the Lanes menu follows it).
  const videosLane = makeVideoLane({ first, last, span, on: !!lanes.videos, menu: _menu });
  const videosRow = document.getElementById("lane-videos-row");
  if (videosRow) videosRow.hidden = !require("./flow-view-video.js").addedClips().length;

  /* Lane stack (top to bottom):
       ticks:        m:ss labels (the time since the recording started)
       cases:        one labelled band per run (header)
       activity:     per-app coloured bands (the hero lane)
       videos:       the videos of the project (C23), when one is added
       transcript:   the meeting transcript, when one is attached
       screenshots:  dedicated capture rail
       steps:        optional per-step bands
       playhead overlays all lanes.
     Each lane below is a { key, height, gapBefore, render } plugin; the
     shared timeline core (TimelineCore.renderLaneStack) stacks them, drives
     the zoom width + minHeight, and calls each lane's render(host, ctx).
     See docs/adr/0003-viewer-architecture-refactor.md items 4-5. */
  const ticksH = 20;
  const caseRowH = 22;

  // The steps lane shows the steps as they are: one band per visible step of
  // the level the Steps list shows (C19), named as in the Steps list.
  const _anno = (State.getSession().annotations) || {};
  // C22: how many bands of steps placed elsewhere in the process are drawn.
  let placedDrawn = 0;
  const _level = stepsForLevel(State.getSession());
  const _stepsForLane = _level.steps.map((s) => ({
    label: s.name || s.step_id || "", step_id: s.step_id, time_range: s.time_range, step: s,
  }));
  // 2.0.3: what is dragged on the timeline, and where a change is refused.
  const editable = !RO.isReadOnly(State.getSession());

  // Run bands render as a labelled header ABOVE the activity lane;
  // layoutCaseLanes pairs the markers into runs the way the pipeline does.
  // 2.0.3: the bands follow the markers as they are now (every marker change,
  // marker-edits.js), so a transaction added or moved stands where it was
  // put; one the last analysis has not seen (no band of that analysis has
  // its span and label) is drawn pending until Apply marker changes.
  const markerRows = MarkerEdits.sessionMarkerView(State.getSession());
  const markersNow = MarkerEdits.currentMarkerEvents(markerRows);
  const caseLanes = layoutCaseLanes(markersNow, first, last);
  const analyzedCases = layoutCaseLanes(MarkerEdits.appliedMarkerEvents(markerRows), first, last).cases;
  for (const c of caseLanes.cases) {
    c.pending = !analyzedCases.some((a) => a.startMs === c.startMs && a.endMs === c.endMs &&
      a.dangling === c.dangling && (a.label || null) === (c.label || null));
  }
  // The sides a moment snaps to: the transactions' and the steps' drawn.
  _edgeTargets = [];
  for (const c of (lanes.cases ? caseLanes.cases : [])) {
    if (c.startKey) _edgeTargets.push({ ms: c.startMs, key: "m:" + c.startKey, kind: "tx" });
    if (c.endKey) _edgeTargets.push({ ms: c.endMs, key: "m:" + c.endKey, kind: "tx" });
  }
  for (const s of (lanes.steps ? _stepsForLane : [])) {
    const b = stepBandSpan(s);
    if (b) {
      _edgeTargets.push({ ms: b.startMs, key: "s:" + s.step_id + ":start", kind: "step-start" },
        { ms: b.endMs, key: "s:" + s.step_id + ":end", kind: "step-end" });
    }
  }
  // 2.0.3: a transaction that runs to the end has no End marker; its end
  // dragged gives it one (the owner: "the duration is endless").
  const endAddDrag = (c, band) => {
    const move = (ms) => _placeBand(band, c.startMs, ms, first, span, 0.15);
    return {
      fromMs: c.endMs, lo: c.startMs + MIN_SPAN_MS, hi: last, targets: _snapTargets("marker", [], first, span),
      preview: move, restore: () => move(c.endMs),
      commit: async (ms) => {
        const note = applyNote(State.getSession());
        if (await insertMarker("end", new Date(ms).toISOString()) && note) toast("Ended" + note + ".", "success");
      },
    };
  };
  // A marker dragged moves between its neighbours as drawn.
  const markerTimes = markersNow.map((ev) => Date.parse(ev.timestamp));
  const markerDrag = (host, key) => {
    const i = markersNow.findIndex((ev) => ev.event_id === key);
    if (i < 0) return null;
    const fromMs = markerTimes[i];
    const b = markerDragBounds(markerTimes, i, first, last);
    const move = (ms) => {
      for (const el of host.querySelectorAll(".tl-case-band")) {
        const atStart = el.dataset.startKey === key, atEnd = el.dataset.endKey === key;
        if (!atStart && !atEnd) continue;
        _placeBand(el, atStart ? ms : Number(el.dataset.startMs), atEnd ? ms : Number(el.dataset.endMs), first, span, 0.15);
      }
    };
    return {
      fromMs, lo: b.lo, hi: b.hi, targets: _snapTargets("marker", [], first, span),
      preview: move, restore: () => move(fromMs),
      commit: async (ms) => {
        const m = MarkerEdits.sessionMarkerView(State.getSession()).find((x) => x.key === key);
        const note = applyNote(State.getSession());
        if (m && await moveMarker(m, new Date(ms).toISOString()) && note) toast("Moved" + note + ".", "success");
      },
    };
  };

  // Resolved lane heights. A height of 0 hides the lane: the core skips its
  // render and (with gapBefore) collapses the spacing. These mirror the
  // pre-core geometry; gapBefore values below reproduce the lane cascade.
  const casesH = lanes.cases ? caseLanes.lanesNeeded * caseRowH : 0;
  // A video project (C16) has no activity bands: a low lane keeps the
  // pending marker bars and a place to right-click.
  const activityH = evs.length ? 60 : 28;
  const screenshotsH = lanes.screenshots ? 26 : 0;
  // The recording's screenshots and (lane FX2) the ones the analyst added
  // with a moment.
  const shotMarks = timelineScreenshots(State.getSession());
  const stepsLaneH = (lanes.steps && _stepsForLane.length) ? 16 : 0;
  const notes = allNotes.filter((n) => { const t = Date.parse(n.at); return t >= first && t <= last; });
  const notesH = (lanes.notes && notes.length) ? 18 : 0;

  // The systems drawn on the activity lane feed the legend (each with the
  // application its bands came from, for the colour); the case scope range
  // dims out-of-scope activity bands. Both computed once.
  const observedApps = new Map();
  const appNames = ((State.getSession().stats || {}).meta || {}).app_names || {};
  const scopeRange = currentScopeRange();
  // The stretches left out of the analysis, drawn over the Systems lane where
  // they are made (a Shift-drag range, Leave out of the analysis).
  const leftOut = leftOutBands(_anno.excluded_ranges).filter((b) => b.endMs > first && b.startMs < last);
  // Lane FX2: the apps outside the process, drawn hatched too.
  const ignoredApps = ((_anno.step_filters || {}).ignored_processes) || [];
  let appsLeftOut = 0;

  // ===== Time-axis ticks =====
  // Tick positions, intervals, and labels come from the shared timeline
  // core (chooseTicks). The tick lines (`.tl-flow-tick`) reach down to the
  // bottom of the activity lane.
  const ticksLane = {
    key: "ticks",
    height: ticksH,
    gapBefore: 4,
    render(host, ctx) {
      const ticksTop = ctx.slot.top;
      const act = ctx.slots.get("activity");
      const activityTop = act.top;
      const activityH = act.height;
      for (const tk of TimelineCore.chooseTicks(first, last, 12, origin)) {
        const x = tk.xPct;
        const tick = document.createElement("div");
        tick.className = "tl-flow-tick";
        tick.style.left = x + "%";
        tick.style.top = ticksTop + "px";
        tick.style.height = (activityTop + activityH - ticksTop) + "px";
        host.appendChild(tick);
        const lbl = document.createElement("div");
        lbl.className = "tl-flow-tick-label";
        lbl.style.left = "calc(" + x + "% + 3px)";
        lbl.style.top = ticksTop + "px";
        lbl.textContent = tk.label;
        host.appendChild(lbl);
      }
    },
  };

  // ===== Run lanes =====
  // layoutCaseLanes() pairs the markers into runs the way the pipeline does
  // (a Start ends the open run) and assigns each run a lane:
  //   - Each run knows its [start, end); runs never overlap, so they share
  //     one lane.
  //   - A run with no end extends to `last` with a dashed right edge so it
  //     is visually distinct from a closed one.
  // The case scope dropdown can target any of these directly.
  const casesLane = {
    key: "cases",
    height: casesH,
    gapBefore: 4,
    // Each row's band leaves 4 px under it: its name centres on the bands.
    nameH: casesH - 4,
    render(host, ctx) {
      const casesTop = ctx.slot.top;
      // host.style.width is already the zoomed width when this runs
      // (renderLaneStack sets it first), so clientWidth reflects the
      // on-screen px width.
      const hostW = host.clientWidth || 800;
      for (const c of (lanes.cases ? caseLanes.cases : [])) {
        const x = ((c.startMs - first) / span) * 100;
        const w = Math.max(0.15, ((c.endMs - c.startMs) / span) * 100);
        const top = casesTop + c.lane * caseRowH;
        const band = document.createElement("div");
        band.className = "tl-case-band" + (c.dangling ? " dangling" : "") + (c.pending ? " pending" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = top + "px";
        band.style.height = (caseRowH - 4) + "px";
        band.dataset.startMs = String(c.startMs);
        band.dataset.endMs = String(c.endMs);
        if (c.startKey) band.dataset.startKey = c.startKey;
        if (c.endKey) band.dataset.endKey = c.endKey;
        band.title = c.title + (c.label ? " · " + c.label : "") +
          (c.dangling ? " · open: no end marked yet" : "\n" + formatDuration(c.endMs - c.startMs)) +
          (c.pending ? "\nNot applied yet: Apply marker changes, in the top bar, updates the transactions and their steps." : "") +
          (editable ? "\nDrag its start or its end to move it" + (c.endKey ? "." : ", or right-click where it ends: End the transaction here.") : "");
        // 2.0.3: its start and its end drag (the marker there moves; a start
        // that ends the transaction before moves that end too; one running to
        // the end gets its End).
        if (editable) {
          wireEdgeDrag(band, { host, firstMs: first, spanMs: span, origin,
            edges: { start: !!c.startKey, end: !!c.endKey || !!c.dangling },
            begin: (edge) => edge === "end" && !c.endKey ? endAddDrag(c, band)
              : markerDrag(host, edge === "start" ? c.startKey : c.endKey) });
        }
        // Click anywhere on a case band -- closed OR dangling -- seeks
        // the video to the case start. Right-click opens the scope/jump
        // menu below.
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          seekToTimestamp(new Date(c.startMs).toISOString());
        });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // What marks at the moment right-clicked, then the band's jumps.
          showCaseContextMenu(e.clientX, e.clientY, c, timeAtClientX(e.clientX, host.getBoundingClientRect(), first, last));
        });
        host.appendChild(band);
        // NAV-AUDIT §J/§9: only label a band wide enough to read it; the rest
        // stay pure stripes (label still in the band's title on hover). The
        // label is also clipped to the band width so a kept label can never
        // spill into its neighbour.
        if (caseLabelFits(w, hostW)) {
          const lbl = document.createElement("div");
          lbl.className = "tl-case-label" + (c.pending ? " pending" : "");
          lbl.style.left = "calc(" + x + "% + 4px)";
          lbl.style.top = (top + 3) + "px";
          lbl.style.maxWidth = "calc(" + w + "% - 4px)";
          lbl.textContent = c.label || c.title;
          host.appendChild(lbl);
        }
      }
    },
  };

  // ===== Activity lane (the hero lane) =====
  // Per-app coloured bands with inline title + duration labels so analysts
  // can read the timeline without hovering. Out-of-scope bands (case scope
  // active and this band's midpoint outside the case range) are dimmed via
  // .out-of-scope so context survives. Idle bands and marker bars share the
  // activity lane's row.
  const activityLane = {
    key: "activity",
    height: activityH,
    gapBefore: casesH ? 6 : 4,
    // A video project's low lane shows no system: it has no name.
    unnamed: !evs.length,
    // Its key in the header: the colours of the first systems drawn.
    keyColours: () => [...observedApps.values()].map((app) => appColor(app)),
    render(host, ctx) {
      const activityTop = ctx.slot.top;
      const activityH = ctx.slot.height;
      for (const ev of evs) {
        if (ev.type !== "activity") continue;
        const t = new Date(ev.timestamp).getTime();
        const dur = ev.data.duration_ms || 0;
        const x = ((t - first) / span) * 100;
        const w = Math.max(0.15, (dur / span) * 100);
        const inScope = !scopeRange ||
          (t + dur / 2 >= scopeRange.startMs && t + dur / 2 <= scopeRange.endMs);
        const band = document.createElement("div");
        const outApp = appLeftOut(ev.data.app, ignoredApps);
        if (outApp) appsLeftOut++;
        band.className = "tl-band tl-activity" + (inScope ? "" : " out-of-scope") + (outApp ? " tl-app-left-out" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = activityTop + "px";
        band.style.height = activityH + "px";
        band.style.background = appColor(ev.data.app);
        band.dataset.app = ev.data.app || "";
        // The system the band names (C14): Salesforce, not the browser.
        const system = appLabel(ev.data.app, ev.data.title, appNames);
        if (ev.data.app && !observedApps.has(system)) observedApps.set(system, ev.data.app);
        band.title = (outApp ? appLeftOutTitle(system) + "\n" : "") + system + (ev.data.title ? "\n" + ev.data.title : "") +
          "\n" + sinceStart(ev.timestamp, origin) + " (" + formatDuration(dur) + ")";

        // Label: app name (top line, bold-ish) + window title (second line, dim).
        // Duration pinned to bottom-right. CSS hides children that don't fit.
        const lbl = document.createElement("div");
        lbl.className = "tl-activity-label";
        const appName = document.createElement("span");
        appName.className = "tl-act-app";
        appName.textContent = system;
        const titleEl = document.createElement("span");
        titleEl.className = "tl-act-title";
        titleEl.textContent = ev.data.title || "";
        const durEl = document.createElement("span");
        durEl.className = "tl-act-dur";
        durEl.textContent = formatDuration(dur);
        lbl.appendChild(appName);
        lbl.appendChild(titleEl);
        lbl.appendChild(durEl);
        band.appendChild(lbl);

        // I43: badge which monitor this window was on (multi-display only).
        const _mon = monitorBadgeFor(ev.data.bounds);
        if (_mon) {
          const monEl = document.createElement("span");
          monEl.className = "tl-monitor-badge";
          monEl.textContent = _mon;
          monEl.title = "Captured on monitor " + _mon.slice(1);
          band.appendChild(monEl);
        }

        band.addEventListener("click", (e) => { e.stopPropagation(); seekToTimestamp(ev.timestamp); });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // The menu acts at the moment the analyst right-clicked, not at the
          // band's start: "Insert Start marker here" means here.
          const at = timeAtClientX(e.clientX, host.getBoundingClientRect(), first, last) || ev.timestamp;
          showMarkerInsertMenu(e.clientX, e.clientY, at);
        });
        host.appendChild(band);
      }

      // Idle bands. I23: an idle stretch tagged at_desk (the recorder
      // still saw activity, e.g. inside a Citrix session the OS idle
      // timer cannot observe) renders distinctly from a genuine "away".
      let idleStart = null;
      let idleAtDesk = false;
      for (const ev of (lanes.idle ? evs : [])) {
        if (ev.type !== "system") continue;
        if (ev.data.kind === "idle_start") {
          idleStart = new Date(ev.timestamp).getTime();
          idleAtDesk = !!ev.data.at_desk;
        } else if (ev.data.kind === "idle_end" && idleStart) {
          const endT = new Date(ev.timestamp).getTime();
          const x = ((idleStart - first) / span) * 100;
          const w = Math.max(0.15, ((endT - idleStart) / span) * 100);
          const band = document.createElement("div");
          band.className = "tl-band tl-idle" + (idleAtDesk ? " tl-idle-atdesk" : "");
          band.style.left = x + "%";
          band.style.width = w + "%";
          band.style.top = activityTop + "px";
          band.style.height = activityH + "px";
          band.title = (idleAtDesk
            ? "Idle (still at desk: recent mouse/keyboard activity), "
            : "Idle (away), ") + formatDuration(endT - idleStart);
          host.appendChild(band);
          idleStart = null;
          idleAtDesk = false;
        }
      }

      // Pending marker bars (rendered above bands): a marker change that
      // waits for Apply marker changes (marker-edits.js) is drawn, dashed and
      // labelled pending. 2.0.3: the Transactions lane draws a marker added,
      // moved or renamed (its band, pending), so a bar says only what that
      // lane cannot: a marker deleted, or any change while the lane is off.
      // Applied markers are not drawn here: the Transactions lane and the
      // Markers tab show them.
      for (const m of markerRows) {
        if (!m.pending || (lanes.cases && !m.deleted)) continue;
        const t = new Date(m.timestamp).getTime();
        if (!isFinite(t)) continue;
        const x = ((t - first) / span) * 100;
        const bar = document.createElement("div");
        bar.className = "tl-marker" + (m.pending ? " tl-marker-pending" : "") +
          (m.pending && m.deleted ? " tl-marker-pending-delete" : "");
        bar.dataset.markerKey = m.key;
        bar.style.left = x + "%";
        bar.style.height = activityH + "px";
        bar.style.top = activityTop + "px";
        bar.title = m.markerType + ": " + (m.label || "") + (m.reason ? " (" + m.reason + ")" : "") +
          (m.pending ? "\nPending: " + (m.deleted ? "deleted" : m.inserted ? "added" : "changed") +
            ", not applied yet. Click Apply marker changes to update the transactions." : "");
        host.appendChild(bar);
        if (m.markerType === "start" && m.label && !m.deleted) {
          const lbl = document.createElement("div");
          lbl.className = "tl-marker-label" + (m.pending ? " tl-marker-label-pending" : "");
          lbl.style.left = "calc(" + x + "% + 4px)";
          lbl.style.top = (activityTop + 2) + "px";
          lbl.textContent = m.label + (m.pending ? " (pending)" : "");
          host.appendChild(lbl);
        }
      }

      // The stretches left out of the analysis: a quiet hatch over the lane,
      // its label where it fits; a click (or a right-click) offers Include
      // again, the inverse of Leave out of the analysis.
      const hostW = host.clientWidth || 800;
      // Lane E (E4): in a project without a recording the same mark is not
      // part of the process, and says so.
      const recorded = AC.hasRecording(State.getSession());
      for (const b of leftOut) {
        const s = Math.max(b.startMs, first), e = Math.min(b.endMs, last);
        const x = ((s - first) / span) * 100;
        const w = Math.max(0.15, ((e - s) / span) * 100);
        const band = document.createElement("div");
        band.className = "tl-left-out";
        band.dataset.start = b.range.start;
        band.dataset.end = b.range.end;
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = activityTop + "px";
        band.style.height = activityH + "px";
        band.title = leftOutTitle(sinceStart(b.range.start, origin), sinceStart(b.range.end, origin), recorded);
        const text = leftOutLabel((w / 100) * hostW, recorded);
        if (text) {
          const lbl = document.createElement("span");
          lbl.className = "tl-left-out-label";
          lbl.textContent = text;
          band.appendChild(lbl);
        }
        const menu = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // Lane HV: a hand-off opened read only keeps its stretches as they are.
          _menu(ev.clientX, ev.clientY, [
            ...(RO.isReadOnly(State.getSession()) ? [] : [["Include again", () => includeAgain(b.range)]]),
            ["Go to its start", () => seekToTimestamp(new Date(b.startMs).toISOString())],
          ]);
        };
        band.addEventListener("click", menu);
        band.addEventListener("contextmenu", menu);
        host.appendChild(band);
      }
    },
  };

  // ===== Screenshot rail =====
  // A dedicated capture lane beneath the activity bands: clearly visible,
  // clickable camera markers in their own row rather than dots lost on
  // the band edge. P1.2: hover still pops a thumbnail preview.
  const screenshotsLane = {
    key: "screenshots",
    height: screenshotsH,
    gapBefore: 4,
    render(host, ctx) {
      const screenshotsTop = ctx.slot.top;
      const screenshotsH = ctx.slot.height;
      const rail = document.createElement("div");
      rail.className = "tl-screenshot-rail";
      rail.style.top = screenshotsTop + "px";
      rail.style.height = screenshotsH + "px";
      host.appendChild(rail);
      // (Its name, Screenshots, is at the left with the other lanes'.)
      const markY = screenshotsTop + (screenshotsH - 16) / 2;
      for (const ev of shotMarks) {
        const t = new Date(ev.timestamp).getTime();
        if (!(t >= first && t <= last)) continue;
        const x = ((t - first) / span) * 100;
        const added = ev.data.kind === "screenshot_added";
        const dot = document.createElement("div");
        dot.className = "tl-screenshot" + (added ? " tl-screenshot-added" : "");
        dot.style.left = "calc(" + x + "% - 8px)";
        dot.style.top = markY + "px";
        dot.innerHTML = SCREENSHOT_ICON;
        dot.title = added ? screenshotTitle(ev, origin) : "Screenshot at " + sinceStart(ev.timestamp, origin) + "\n" + (ev.data.path || "");
        dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
        host.appendChild(dot);
      }
    },
  };

  // A step's side dragged (2.0.3): between the other bands of the lane,
  // inside its sub-process, the step it touches (when that one's time is the
  // analyst's too) giving way; saved as one edit (steps-view.js setStepTimes).
  // The owner, after 2.0.3: "you always add steps sequentially": the step
  // being marked has nothing after it yet, so it runs to the end. It is
  // drawn open (fading out after its start), with no length and no end to
  // drag (time-edits.js isOpen); the next step, or its transaction's end,
  // ends it. At the main level: a sub-step ends with its sub-process.
  const momentsNow = markerMoments(markersNow);
  const isOpenBand = (s, b) => !_level.name && AC.stepTimeMovable(s.step) && isOpen(b, last, momentsNow);
  const laneSpans = _stepsForLane.map((x) => {
    const b = stepBandSpan(x);
    return b ? { id: x.step_id, startMs: b.startMs, endMs: b.endMs, movable: editable && AC.stepTimeMovable(x.step) } : null;
  }).filter(Boolean);
  const stepDrag = (host, s, band, edge) => {
    const own = stepBandSpan(s);
    if (!own) return null;
    const others = laneSpans.filter((o) => o.id !== s.step_id);
    const hit = SPM.findStep(_anno.steps || [], s.step_id);
    const inside = hit && hit.parent ? stepBandSpan(hit.parent) : null;
    const outer = inside ? { startMs: Math.max(first, inside.startMs), endMs: Math.min(last, inside.endMs) } : { startMs: first, endMs: last };
    const { lo, hi, link } = stepSide(own, edge, others, outer);
    const linkBand = link ? host.querySelector('.tl-step-band[data-step-id="' + CSS.escape(link.id) + '"]') : null;
    const fromMs = edge === "start" ? own.startMs : own.endMs;
    const move = (ms) => {
      const [self, other] = stepSideChanges(s.step_id, own, edge, link, ms);
      _placeBand(band, self.startMs, self.endMs, first, span, 0.2);
      if (linkBand && other) _placeBand(linkBand, other.startMs, other.endMs, first, span, 0.2);
    };
    const skip = ["s:" + s.step_id + ":start", "s:" + s.step_id + ":end"];
    if (link) skip.push("s:" + link.id + (edge === "start" ? ":end" : ":start"));
    return {
      fromMs, lo, hi, targets: _snapTargets("step", skip, first, span),
      preview: move, restore: () => move(fromMs),
      commit: async (ms) => {
        if (!(await require("./steps-view.js").setStepTimes(stepSideChanges(s.step_id, own, edge, link, ms)))) move(fromMs);
      },
    };
  };

  // ===== Per-step lane (P1.4) =====
  // Renders a single row of step bands beneath the screenshot rail when steps
  // exist. Click to select the step + seek; right-click opens it in Steps.
  const stepsLane = {
    key: "steps",
    height: stepsLaneH,
    gapBefore: 6,
    // Its bands are 14 px high at the top of the lane (.tl-step-band).
    nameH: 14,
    name: _level.name ? "Steps in " + _level.name : "",
    title: _level.name ? "Steps in " + _level.name + ": the steps of this sub-process, each time a transaction goes through it; click one to see all its moments." : "",
    render(host, ctx) {
      const stepsLaneTop = ctx.slot.top;
      for (const s of (lanes.steps ? _stepsForLane : [])) {
        const bandSpan = stepBandSpan(s);
        if (!bandSpan) continue;
        const sStart = bandSpan.startMs, sEnd = bandSpan.endMs;
        const x = ((sStart - first) / span) * 100;
        const w = Math.max(0.2, ((sEnd - sStart) / span) * 100);
        const band = document.createElement("div");
        const open = isOpenBand(s, bandSpan);
        // C22: a step placed elsewhere in the process than its time puts it.
        const placed = placedLine(s.step);
        if (placed) placedDrawn++;
        band.className = "tl-step-band" + (open ? " open" : "") + (placed ? " placed" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = stepsLaneTop + "px";
        const lbl = s.label || s.step_id || "";
        band.textContent = lbl;
        const movable = editable && AC.stepTimeMovable(s.step);
        band.title = lbl + " · " + (open ? "open: it ends where you add the next step, or where its transaction ends"
          : formatDuration(sEnd - sStart)) +
          (placed ? "\n" + placed : "") +
          "\nClick: the step panel, and seek (Steps then opens on it) · Right-click: add the next step here, or Open in Steps, Place after a step, Hide or Delete" +
          (movable ? "\nDrag its " + (open ? "start" : "start or its end") + " to change its time." : "");
        if (s.step_id) band.dataset.stepId = s.step_id;
        // 2.0.3: a step whose time is the analyst's drags its sides; a step
        // back to back with it moves its touching side along.
        if (movable) {
          wireEdgeDrag(band, { host, firstMs: first, spanMs: span, origin, edges: { start: true, end: !open },
            begin: (edge) => stepDrag(host, s, band, edge) });
        }
        if (s.step_id && s.step_id === State.getSelectedStepId()) {
          band.classList.add("tl-step-selected");
        }
        // NAV-AUDIT §A3: a plain click is SELECT + SEEK, never a view change
        // ("selecting never changes view; view changes are labeled verbs only").
        // It selects the step (highlight in the lane + State.setSelectedStepId,
        // so a later Steps arrival reveals it) and seeks the playhead/timeline
        // to the step start. The Flow→Steps jump is now the labeled "Open in
        // Steps" affordance on the right-click menu below.
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          if (s.step_id) State.setSelectedStepId(s.step_id);
          host.querySelectorAll(".tl-step-band.tl-step-selected")
            .forEach((b) => b.classList.remove("tl-step-selected"));
          band.classList.add("tl-step-selected");
          if (s.time_range && s.time_range.start) seekToTimestamp(s.time_range.start);
          // 2.0.1: Steps opens on this step (its transaction open, the row in
          // view), not on the step a seek would park for it.
          if (s.step_id) {
            State.consumePendingStepJump();
            State.setSelectedStepId(s.step_id);
            State.setPendingStepReveal();
          }
          // V2 item 4: the step panel opens beside the timeline (lazy: the
          // panel requires the video module this one requires too).
          const hit = SPM.findStep(_anno.steps || [], s.step_id);
          if (hit) require("./step-panel.js").openForStep(hit.step);
        });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          _showStepBandMenu(e.clientX, e.clientY, s.step_id, s.time_range && s.time_range.start,
            timeAtClientX(e.clientX, host.getBoundingClientRect(), first, last), lbl);
        });
        host.appendChild(band);
      }
    },
  };

  // ===== Notes lane (C16) =====
  // A note pinned to a moment: click goes there, right-click edits or deletes.
  const notesLane = {
    key: "notes",
    height: notesH,
    gapBefore: 4,
    render(host, ctx) {
      for (const n of notes) {
        const pin = document.createElement("div");
        pin.className = "tl-note";
        pin.dataset.noteId = n.id;
        pin.style.left = "calc(" + (((Date.parse(n.at) - first) / span) * 100) + "% - 7px)";
        pin.style.top = (ctx.slot.top + 2) + "px";
        pin.textContent = "✎";
        pin.title = "Note at " + sinceStart(n.at, origin) + "\n" + n.text + "\nClick: go to this moment. Right-click: edit or delete it.";
        pin.addEventListener("click", (e) => { e.stopPropagation(); seekToTimestamp(n.at); });
        pin.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Lane HV: a note of a hand-off opened read only is read, not edited.
          if (RO.isReadOnly(State.getSession())) return;
          const UI = require("./analyst-ui.js");   // lazy: it requires this module
          _menu(e.clientX, e.clientY, [["Edit note…", () => UI.editNote(n.id)], ["Delete note", () => UI.deleteNote(n.id)]]);
        });
        host.appendChild(pin);
      }
    },
  };

  // Stack and render every lane through the shared timeline core. The core
  // owns the vertical layout maths, the zoom width, and the minHeight; each
  // lane plugin owns its own DOM. tailPx (14) + the 120 floor reproduce the
  // pre-core host.style.minHeight.
  const stack = [ticksLane, casesLane, activityLane, videosLane, transcriptLane, notesLane, screenshotsLane, stepsLane];
  const layout = TimelineCore.renderLaneStack(host, {
    lanes: stack,
    span: { startMs: first, endMs: last },
    zoom: State.getZoomFactor(),
    tailPx: 14,
    minHeightFloor: 120,
  });
  renderLaneNames(stack, layout, host);

  // Legend mirrors the apps observed while the activity lane rendered, and
  // explains only the marks the timeline draws: an entry whose lane is off is
  // hidden (a pending marker is drawn whatever its lane says).
  renderLegend(observedApps);
  const legendShows = {
    ".lg-idle": !!lanes.idle && evs.length > 0,
    ".lg-marker": markerRows.some((m) => m.pending),
    ".lg-screenshot": !!lanes.screenshots && shotMarks.length > 0,
    ".lg-note": notesH > 0,
    ".lg-left-out": leftOut.length > 0 || appsLeftOut > 0,
    ".lg-placed": placedDrawn > 0,
  };
  for (const [sel, on] of Object.entries(legendShows)) {
    const el = document.querySelector("#timeline-legend " + sel);
    if (el) el.style.display = on ? "" : "none";
  }
  // Lane E (E4): the hatch in this project's words.
  const lgOut = document.querySelector("#timeline-legend .lg-left-out");
  if (lgOut) {
    const recorded = AC.hasRecording(State.getSession());
    lgOut.textContent = LeftOut.wordsFor(recorded).legend;
    lgOut.title = recorded
      ? "Hatched: left out of the analysis (a stretch, or an app outside the process). Playing skips a stretch left out, " +
        "and the Transcript tab leaves out what was said in it. Click a stretch to include it again."
      : "A stretch you marked as not part of the process. It is skipped when playing and left out of the Transcript tab.";
  }

  // Playhead overlays all lanes; appended last so it paints on top.
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek on background. P2.9: snap to nearest event when one
  // is within ~250ms / span × pixel-tolerance of the click; else seek
  // to the literal point. Avoids the "click empty space, jump 30 ms
  // before the activity I meant" feel.
  host.addEventListener("click", (e) => {
    if (e.target !== host) return;
    // Lane E: a Shift-drag selects a stretch (flow-view.js
    // installRangeSelection); the click that ends it never seeks and never
    // starts the video.
    if (e.shiftKey) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX + host.scrollLeft - rect.left) / rect.width;
    const target = first + frac * span;
    // pixel tolerance scales with zoom: at 1x ~10px tolerance, at higher
    // zoom the same px is fewer ms, so snapping stays "near the cursor"
    // visually rather than "near in wall-clock".
    const pxTol = 10;
    const msTol = Math.max(50, Math.min(500, (pxTol / Math.max(1, host.clientWidth || rect.width)) * span));
    let nearestT = null, nearestDelta = Infinity;
    for (const ev of evs) {
      const t = new Date(ev.timestamp).getTime();
      const d = Math.abs(t - target);
      if (d < nearestDelta) { nearestDelta = d; nearestT = t; }
      if (d > msTol && nearestT != null) break; // events are time-sorted
    }
    const seekT = (nearestT != null && nearestDelta <= msTol) ? nearestT : target;
    seekToTimestamp(new Date(seekT).toISOString());
  });

  // P1.3: refresh minimap to mirror the new timeline content + viewport.
  renderMinimap();
}

/* ============ Timeline helpers (lane layout)
   ================================================================ */

/* Pair the markers into runs the way the pipeline does
   (normalization/case_assignment.py): runs never nest, so a Start that
   arrives while a run is open ends that run there and opens the next one;
   an End closes the open run, and an End with no open run is ignored. A run
   left open at the end of the recording extends to `last` (dangling). Runs
   never overlap, so the lane packing puts them on one lane. Returns
   { cases: [...], lanesNeeded }; each run is
   { id, startMs, endMs, label, title ("Transaction N", the Steps level's
   name for it, AD-29), dangling, lane, startKey, endKey }, the keys the
   event ids of the markers at its sides (2.0.3: what a side dragged moves):
   its Start, and the End or the next Start that ends it (null when it runs
   to the end). */
function layoutCaseLanes(evs, first, last) {
  const runs = [];
  let open = null;
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      if (open) { open.endMs = t; open.endKey = ev.event_id || null; open.dangling = false; runs.push(open); }
      open = { startMs: t, label: ev.data.label, startKey: ev.event_id || null, endKey: null };
    } else if (ev.data.marker_type === "end" && open) {
      open.endMs = t;
      open.endKey = ev.event_id || null;
      open.dangling = false;
      runs.push(open);
      open = null;
    }
  }
  if (open) { open.endMs = last; open.dangling = true; runs.push(open); }
  runs.sort((a, b) => a.startMs - b.startMs);
  // A label that only numbers the run ("Run 2" from the capture app) is not
  // shown: the band says its title (AD-29).
  runs.forEach((r, i) => {
    r.id = i;
    r.title = "Transaction " + (i + 1);
    if (numberOnlyLabel(r.label)) r.label = null;
  });
  // Lane assignment is delegated to the shared timeline core. maxLanes is
  // set high enough that runs are never capped.
  const packed = TimelineCore.packLanes(
    runs.map((c) => ({ id: String(c.id), startMs: c.startMs, endMs: c.endMs })),
    { maxLanes: Math.max(1, runs.length), spanMs: Math.max(1, last - first) }
  );
  for (const c of runs) c.lane = packed.laneOf.get(String(c.id)) || 0;
  return { cases: runs, lanesNeeded: packed.laneCount };
}

/* I43: which monitor a captured window sat on -- "M1".."MN", or null
   when the session is single-display or carries no display geometry.
   The window's centre point is tested against each display's bounds. */
function monitorBadgeFor(bounds) {
  const session = State.getSession();
  const displays = (session && session.manifest && session.manifest.displays) || [];
  if (displays.length < 2 || !bounds) return null;
  const cx = bounds.x + (bounds.w || 0) / 2;
  const cy = bounds.y + (bounds.h || 0) / 2;
  for (let i = 0; i < displays.length; i++) {
    const b = displays[i].bounds || {};
    if (cx >= b.x && cx < b.x + (b.width || 0) &&
        cy >= b.y && cy < b.y + (b.height || 0)) {
      return "M" + (i + 1);
    }
  }
  return null;
}

/* deps = { currentScopeRange, showMarkerInsertMenu, showCaseContextMenu,
   includeAgain }: the flow-view-resident glue, injected at boot
   (includeAgain(range): Include again on a band left out of the analysis). */
function initTimeline(deps) {
  currentScopeRange    = (deps && deps.currentScopeRange)    || (() => null);
  showMarkerInsertMenu = (deps && deps.showMarkerInsertMenu) || (() => {});
  showCaseContextMenu  = (deps && deps.showCaseContextMenu)  || (() => {});
  includeAgain         = (deps && deps.includeAgain)         || (async () => {});
}

module.exports = {
  initTimeline,
  renderTimeline, renderTimelineSummary, renderMinimap, syncMinimapViewport,
  restoreTimelineForCurrent, persistTimelineForCurrent, maybeAutoScrollToFirstCase,
  _wireTimelineScrollPersist, getLaneToggles, setLaneToggle,
  caseLabelFits, CASE_LABEL_MIN_PX, timeAtClientX, layoutCaseLanes, LANE_NAMES, stepsForLevel,
  leftOutBands, leftOutTitle, leftOutLabel, LEFT_OUT_LABEL, appLeftOut, appLeftOutTitle, stepBandSpan,
  timelineDrawable,
  // 2.0.3: the moment a right-click's new transaction or step snaps to.
  snapMoment,
};
