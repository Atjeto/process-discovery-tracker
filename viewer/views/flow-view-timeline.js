/*
 * flow-view-timeline.js -- the Flow timeline subsystem.
 *
 * Extracted from flow-view.js (god-file split). Owns renderTimeline (the lane
 * stack: ticks / cases / activity+idle+markers / screenshots /
 * density / titles / steps / notes, via TimelineCore.renderLaneStack), the
 * lane plugins' helpers (layoutCaseLanes, isUserActivityEvent, monitorBadgeFor),
 * the minimap, the lane-visibility toggles, per-session zoom/scroll
 * persistence, the timeline summary line, and the zoom / middle-drag-pan /
 * scroll-persist wiring. Self-wires its DOM controls at require() time.
 *
 * Requires the sibling Flow modules one-way (apps / video / markers /
 * screenshots) for the values the lanes render; cross-surface glue that lives
 * back in flow-view.js -- currentScopeRange (case scope), showMarkerInsertMenu
 * / showCaseContextMenu (the timeline context menus), activateAnnoTab -- is
 * injected via initTimeline() so this module never require()s flow-view.js.
 * flow-view.js re-exports renderTimeline on its own surface, so renderer.js
 * sees no change.
 */

"use strict";

const TimelineCore = require("../timeline/timeline-core.js");
const State = require("../state.js");
const { $, formatDuration } = require("../dom.js");
const { appColor, appLabel, renderLegend } = require("./flow-view-apps.js");
const { seekToTimestamp } = require("./flow-view-video.js");
const { effectiveLabel } = require("./flow-view-markers.js");
const { openScreenshot } = require("./flow-view-screenshots.js");
const { rollUpSteps } = require("../process-map-levels.js");

/* NAV-AUDIT §J/§9: case-label density. At a multi-hour span dozens of case
   bands pack into ~1500px and their left-anchored labels overlap into
   unreadable repetition (the audit saw 60 labels collide at 3.60h). Mirror the
   window-title lane's chip-silencing precedent (minLabelPx below): a case label
   renders ONLY when its band is at least CASE_LABEL_MIN_PX wide on screen;
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

/* Injected by flow-view.js via initTimeline() -- kept out of a require() to
   avoid a flow-view <-> timeline cycle. */
let currentScopeRange = () => null;
let showMarkerInsertMenu = () => {};
let showCaseContextMenu = () => {};
let activateAnnoTab = () => {};

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
   jump; drag the rectangle to scroll. */
function renderMinimap() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  if (!mm || !scroll || !State.getSession() || !State.getSession().events) return;
  const evs = State.getSession().events;
  if (!evs.length) { mm.style.display = "none"; return; }
  mm.style.display = "";
  const first = new Date(evs[0].timestamp).getTime();
  const last  = new Date(evs[evs.length - 1].timestamp).getTime();
  const span  = Math.max(1, last - first);
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
  if (!evs.length) { $("#timeline-summary").textContent = ""; return; }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  $("#timeline-summary").textContent =
    first.toLocaleTimeString() + " → " + last.toLocaleTimeString() +
    " · " + formatDuration(last - first);
}

/* NAV-AUDIT §A3: the labeled Flow→Steps affordance for a steps-lane band. A
   plain band click selects + seeks (no view change); this right-click menu is
   the LABELED verb that actually switches to Steps, reusing the arrival-reveal
   (setSelectedStepId + setPendingStepReveal, which the Steps render consumes to
   scroll the row into view). Mirrors showMarkerInsertMenu's construction. */
function _showStepBandMenu(x, y, stepId, ts) {
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();
  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);" +
    "min-width:180px;cursor:default;user-select:none;";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", () => { menu.remove(); handler(); });
    menu.appendChild(item);
  }
  addItem("Open in Steps", () => {
    if (stepId) {
      State.setSelectedStepId(stepId);
      State.setPendingStepReveal();   // Steps render scrolls the row into view
    }
    const stepsBtn = document.querySelector('.view-mode-btn[data-level="steps"]');
    if (stepsBtn) setTimeout(() => stepsBtn.click(), 0);
  });
  addItem("Select + seek here", () => {
    if (stepId) State.setSelectedStepId(stepId);
    if (ts) seekToTimestamp(ts);
  });
  document.body.appendChild(menu);
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
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
  idle: true, markers: false, screenshots: false, cases: true,
  density: false, titles: false, steps: false, notes: false,
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

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = State.getSession().events;
  if (!evs.length) {
    const mm = document.getElementById("timeline-minimap");
    if (mm) mm.style.display = "none";
    return;
  }
  const lanes = getLaneToggles();
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  /* Lane stack (top to bottom):
       ticks        -- HH:MM:SS labels at sensible intervals
       cases        -- one labelled row per concurrent case (header)
       activity     -- per-app coloured bands (the hero lane)
       screenshots  -- dedicated capture rail
       density / titles / steps / notes -- optional lanes
       playhead overlays all lanes.
     Each lane below is a { key, height, gapBefore, render } plugin; the
     shared timeline core (TimelineCore.renderLaneStack) stacks them, drives
     the zoom width + minHeight, and calls each lane's render(host, ctx).
     See docs/adr/0003-viewer-architecture-refactor.md items 4-5. */
  const ticksH = 20;
  const caseRowH = 22;

  // P2.12: window-title runs lane. Group consecutive activity events
  // by (app, title) and emit one band per run.
  const _titleRuns = [];
  {
    let runStart = null, runEndDur = 0, runApp = null, runTitle = null;
    function flushRun(endMs) {
      if (runStart != null && endMs > runStart) {
        _titleRuns.push({ startMs: runStart, endMs, app: runApp, title: runTitle });
      }
      runStart = null; runApp = null; runTitle = null; runEndDur = 0;
    }
    for (const ev of evs) {
      if (ev.type !== "activity") continue;
      const t = new Date(ev.timestamp).getTime();
      const dur = ev.data.duration_ms || 0;
      const app = ev.data.app || "";
      const title = ev.data.title || "";
      if (runStart == null) {
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      } else if (app === runApp && title === runTitle) {
        runEndDur = (t + dur) - runStart;
      } else {
        flushRun(runStart + runEndDur);
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      }
    }
    if (runStart != null) flushRun(runStart + runEndDur);
  }

  // ADR-0024: the steps lane follows the shared grain notch. At "element" it
  // shows every step with its raw (value-laden) name — the finest timeline; at
  // a coarser notch it shows the view-time roll-up (one band per consecutive
  // run, labelled by the notch), so the single Grain control reaches Flow too.
  const _anno = (State.getSession().annotations) || {};
  const _grain = State.getGrain();
  const _rawSteps = (_anno.steps || []).filter((s) => s && s.state !== "hidden");
  let _stepsForLane;
  if (_grain === "element") {
    _stepsForLane = _rawSteps.map((s) => ({
      label: s.name || s.step_id || "", step_id: s.step_id,
      time_range: s.time_range, count: 1,
    }));
  } else {
    const _phaseName = {};
    for (const ph of (_anno.phases || [])) _phaseName[ph.phase_id] = ph.name || "(phase)";
    const _interById = {};
    for (const ev of (State.getSession().events || [])) {
      if (ev.type === "interaction" && ev.event_id) _interById[ev.event_id] = ev;
    }
    // ADR-0028 §3: at the screen notch a named work item flows its name down to
    // its member fragments' timeline band (same grainLabel seam the map uses).
    const _groupName = require("../work-items.js")
      .groupNameResolver(_anno.group_annotations || []);
    _stepsForLane = rollUpSteps(_rawSteps, _grain,
      { phaseName: _phaseName, interactionsById: _interById, caseLabel: (id) => id, groupName: _groupName })
      .map((g) => ({
        label: g.label, step_id: (g.step_ids && g.step_ids[0]) || null,
        time_range: g.time_range, count: g.count,
      }));
  }
  const _notesForLane = (State.getSession().annotations && State.getSession().annotations.notes) || [];

  // Case bands render as a labelled header ABOVE the activity lane;
  // layoutCaseLanes assigns each case a non-overlapping lane (sweep-line).
  const caseLanes = layoutCaseLanes(evs, first, last);

  // Resolved lane heights. A height of 0 hides the lane: the core skips its
  // render and (with gapBefore) collapses the spacing. These mirror the
  // pre-core geometry; gapBefore values below reproduce the lane cascade.
  const casesH = lanes.cases ? caseLanes.lanesNeeded * caseRowH : 0;
  const activityH = 60;
  const screenshotsH = lanes.screenshots ? 26 : 0;
  const densityH = lanes.density ? 12 : 0;
  const titlesLaneH = (lanes.titles && _titleRuns.length) ? 14 : 0;
  const stepsLaneH = (lanes.steps && _stepsForLane.length) ? 16 : 0;
  const notesLaneH = (lanes.notes && _notesForLane.length) ? 18 : 0;

  // Apps observed while drawing the activity lane feed the legend; the case
  // scope range dims out-of-scope activity bands. Both computed once.
  const observedApps = new Set();
  const scopeRange = currentScopeRange();

  // ===== Time-axis ticks =====
  // Tick positions, intervals, and labels come from the shared timeline
  // core -- the same logic the Steps and Phases timelines use. The
  // `.tl-flow-tick` class keeps the Flow ticks (tall vertical lines)
  // distinct from the mini-timelines' short `.tl-tick` axis ticks. The
  // tick lines reach down to the bottom of the activity lane.
  const ticksLane = {
    key: "ticks",
    height: ticksH,
    gapBefore: 4,
    render(host, ctx) {
      const ticksTop = ctx.slot.top;
      const act = ctx.slots.get("activity");
      const activityTop = act.top;
      const activityH = act.height;
      for (const tk of TimelineCore.chooseTicks(first, last, 12)) {
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

  // ===== Case lanes =====
  // layoutCaseLanes() walks the marker stream and assigns each case to a
  // non-overlapping lane via a sweep-line algo:
  //   - Each case knows its [start, end) and a parent_id.
  //   - A new case picks the first lane whose previous occupant ended
  //     before this case starts. Nested cases land BELOW their parent.
  //   - Dangling cases (start with no end) extend to `last` with a
  //     dashed right edge so they're visually distinct from closed.
  // The case scope dropdown can target any of these directly.
  const casesLane = {
    key: "cases",
    height: casesH,
    gapBefore: 4,
    render(host, ctx) {
      const casesTop = ctx.slot.top;
      // host.style.width is already the zoomed width when this runs (see the
      // titles lane note), so clientWidth reflects the on-screen px width.
      const hostW = host.clientWidth || 800;
      for (const c of (lanes.cases ? caseLanes.cases : [])) {
        const x = ((c.startMs - first) / span) * 100;
        const w = Math.max(0.15, ((c.endMs - c.startMs) / span) * 100);
        const top = casesTop + c.lane * caseRowH;
        const band = document.createElement("div");
        band.className = "tl-case-band" + (c.dangling ? " dangling" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = top + "px";
        band.style.height = (caseRowH - 4) + "px";
        band.title = (c.dangling ? "unclosed: " : "case: ") +
          (c.label || "(unlabeled)") +
          (c.dangling ? "" : "\n" + formatDuration(c.endMs - c.startMs));
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
          // Scope-to-case option (in addition to the marker insert menu
          // available on activity bands).
          showCaseContextMenu(e.clientX, e.clientY, c);
        });
        host.appendChild(band);
        // NAV-AUDIT §J/§9: only label a band wide enough to read it; the rest
        // stay pure stripes (label still in the band's title on hover). The
        // label is also clipped to the band width so a kept label can never
        // spill into its neighbour.
        if (caseLabelFits(w, hostW)) {
          const lbl = document.createElement("div");
          lbl.className = "tl-case-label";
          lbl.style.left = "calc(" + x + "% + 4px)";
          lbl.style.top = (top + 3) + "px";
          lbl.style.maxWidth = "calc(" + w + "% - 4px)";
          lbl.textContent = c.label || "(unlabeled)";
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
        band.className = "tl-band tl-activity" + (inScope ? "" : " out-of-scope");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = activityTop + "px";
        band.style.height = activityH + "px";
        band.style.background = appColor(ev.data.app);
        band.dataset.app = ev.data.app || "";
        if (ev.data.app) observedApps.add(ev.data.app);
        band.title = (ev.data.app || "") + " - " + (ev.data.title || "") +
          "\n" + new Date(t).toLocaleTimeString() + " (" + formatDuration(dur) + ")";

        // Label: app name (top line, bold-ish) + window title (second line, dim).
        // Duration pinned to bottom-right. CSS hides children that don't fit.
        const lbl = document.createElement("div");
        lbl.className = "tl-activity-label";
        const appName = document.createElement("span");
        appName.className = "tl-act-app";
        appName.textContent = appLabel(ev.data.app);
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
          showMarkerInsertMenu(e.clientX, e.clientY, ev.timestamp, ev.data.app || "");
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
            ? "Idle (still at desk — recent mouse/keyboard activity), "
            : "Idle (away), ") + formatDuration(endT - idleStart);
          host.appendChild(band);
          idleStart = null;
          idleAtDesk = false;
        }
      }

      // Marker bars (rendered above bands)
      for (const ev of (lanes.markers ? evs : [])) {
        if (ev.type !== "marker") continue;
        const t = new Date(ev.timestamp).getTime();
        const x = ((t - first) / span) * 100;
        const bar = document.createElement("div");
        bar.className = "tl-marker";
        bar.style.left = x + "%";
        bar.style.height = activityH + "px";
        bar.style.top = activityTop + "px";
        bar.title = ev.data.marker_type + ": " + (ev.data.label || "") +
          (ev.data.reason ? " (" + ev.data.reason + ")" : "");
        host.appendChild(bar);
        if (ev.data.marker_type === "start") {
          const label = effectiveLabel(ev);
          if (label) {
            const lbl = document.createElement("div");
            lbl.className = "tl-marker-label";
            lbl.style.left = "calc(" + x + "% + 4px)";
            lbl.style.top = (activityTop + 2) + "px";
            lbl.textContent = label;
            host.appendChild(lbl);
          }
        }
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
      const railLabel = document.createElement("div");
      railLabel.className = "tl-rail-label";
      railLabel.style.top = (screenshotsTop + screenshotsH / 2 - 5) + "px";
      railLabel.textContent = "CAPTURES";
      host.appendChild(railLabel);
      const markY = screenshotsTop + (screenshotsH - 16) / 2;
      const camSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="3" y="3" width="18" height="18" rx="2"/>'
        + '<circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L6 21"/></svg>';
      for (const ev of evs) {
        if (ev.type !== "system") continue;
        if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
        const t = new Date(ev.timestamp).getTime();
        const x = ((t - first) / span) * 100;
        const dot = document.createElement("div");
        dot.className = "tl-screenshot";
        dot.style.left = "calc(" + x + "% - 8px)";
        dot.style.top = markY + "px";
        dot.innerHTML = camSvg;
        dot.title = ev.data.kind + " - " + new Date(t).toLocaleTimeString() +
          "\n" + (ev.data.path || "");
        dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
        host.appendChild(dot);
      }
    },
  };

  // ===== Density histogram lane =====
  // Bucket events into ~120 bins across the span. Background events
  // (idle_start/end, paused/resumed, recorder_*) are excluded so the
  // histogram reflects user activity, not session bookkeeping. The bucket
  // maths runs inside render() -- it only fires when the lane is shown.
  const densityLane = {
    key: "density",
    height: densityH,
    gapBefore: screenshotsH ? 6 : 4,
    render(host, ctx) {
      const densityTop = ctx.slot.top;
      const densityH = ctx.slot.height;
      const N_BUCKETS = 120;
      const bucketDur = span / N_BUCKETS;
      const buckets = new Array(N_BUCKETS).fill(0);
      for (const ev of evs) {
        if (!isUserActivityEvent(ev)) continue;
        const idx = Math.min(N_BUCKETS - 1, Math.floor((new Date(ev.timestamp).getTime() - first) / bucketDur));
        if (idx >= 0) buckets[idx] += 1;
      }
      const maxBucket = buckets.reduce((m, v) => v > m ? v : m, 0) || 1;
      for (let i = 0; i < N_BUCKETS; i++) {
        if (!buckets[i]) continue;
        const x = (i / N_BUCKETS) * 100;
        const w = (1 / N_BUCKETS) * 100;
        const h = Math.max(2, Math.round(densityH * (buckets[i] / maxBucket)));
        const bar = document.createElement("div");
        bar.className = "tl-density-bar";
        bar.style.left = x + "%";
        bar.style.width = w + "%";
        bar.style.top = (densityTop + densityH - h) + "px";
        bar.style.height = h + "px";
        bar.title = `${buckets[i]} events @ ` +
          new Date(first + i * bucketDur).toLocaleTimeString();
        host.appendChild(bar);
      }
      // Density baseline (faint background strip so the lane reads even
      // when sparse).
      const densityBaseline = document.createElement("div");
      densityBaseline.className = "tl-density-base";
      densityBaseline.style.top = densityTop + "px";
      densityBaseline.style.height = densityH + "px";
      host.appendChild(densityBaseline);
    },
  };

  // ===== Window-title runs lane (P2.12) =====
  // One band per consecutive (app, title) run. Label only renders when
  // the band is wide enough to fit ~6 chars; otherwise the band is a
  // pure colour stripe so the rhythm of title changes is still visible.
  const titlesLane = {
    key: "titles",
    height: titlesLaneH,
    gapBefore: 4,
    render(host, ctx) {
      const titlesLaneTop = ctx.slot.top;
      // renderLaneStack set host.style.width to the zoomed width before
      // this runs, so host.clientWidth ALREADY reflects the zoomed width.
      // Don't multiply by zoomFactor again -- the band's pixel width is
      // just (w / 100) * hostW.
      const hostW = host.clientWidth || 800;
      const minLabelPx = 50;
      for (const r of _titleRuns) {
        const x = ((r.startMs - first) / span) * 100;
        const w = Math.max(0.05, ((r.endMs - r.startMs) / span) * 100);
        const band = document.createElement("div");
        band.className = "tl-title-band";
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = titlesLaneTop + "px";
        band.title = (r.app || "") + " — " + (r.title || "(untitled)");
        const renderedPx = (w / 100) * hostW;
        if (renderedPx >= minLabelPx) {
          band.textContent = r.title || (r.app || "").replace(/\.exe$/i, "");
        }
        host.appendChild(band);
      }
    },
  };

  // ===== Per-step lane (P1.4) =====
  // Renders a single row of step bands beneath density when steps exist.
  // Click to select the step + jump to Steps view.
  const stepsLane = {
    key: "steps",
    height: stepsLaneH,
    gapBefore: titlesLaneH ? 4 : 0,
    render(host, ctx) {
      const stepsLaneTop = ctx.slot.top;
      for (const s of (lanes.steps ? _stepsForLane : [])) {
        if (!s.time_range || !s.time_range.start || !s.time_range.end) continue;
        const sStart = new Date(s.time_range.start).getTime();
        const sEnd   = new Date(s.time_range.end).getTime();
        if (!isFinite(sStart) || !isFinite(sEnd) || sEnd <= sStart) continue;
        const x = ((sStart - first) / span) * 100;
        const w = Math.max(0.2, ((sEnd - sStart) / span) * 100);
        const band = document.createElement("div");
        band.className = "tl-step-band";
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = stepsLaneTop + "px";
        const lbl = s.label || s.step_id || "";
        // At a coarse grain a band folds several steps — show the count.
        const foldNote = (s.count > 1) ? " (" + s.count + " steps)" : "";
        band.textContent = lbl;
        band.title = lbl + foldNote + " — " + formatDuration(sEnd - sStart) +
          "\nClick: select + seek · Right-click: Open in Steps";
        if (s.step_id) band.dataset.stepId = s.step_id;
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
        });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          _showStepBandMenu(e.clientX, e.clientY, s.step_id, s.time_range && s.time_range.start);
        });
        host.appendChild(band);
      }
    },
  };

  // ===== Annotation lane (P1.9) =====
  // Numbered note dots beneath the steps lane (or beneath density if no
  // steps). Click to open the note in the side panel + switch to Notes
  // tab.
  const notesLane = {
    key: "notes",
    height: notesLaneH,
    gapBefore: stepsLaneH ? 4 : 0,
    render(host, ctx) {
      const notesLaneTop = ctx.slot.top;
      (lanes.notes ? _notesForLane : []).forEach((n, idx) => {
        if (!n.timestamp) return;
        const ms = new Date(n.timestamp).getTime();
        if (!isFinite(ms)) return;
        const x = ((ms - first) / span) * 100;
        const dot = document.createElement("div");
        dot.className = "tl-note-dot";
        dot.style.left = "calc(" + x + "% - 7px)";
        dot.style.top = notesLaneTop + "px";
        dot.textContent = String(idx + 1);
        dot.dataset.noteIdx = String(idx);
        dot.title = (n.text || "(empty note)").slice(0, 80);
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          activateAnnoTab("notes");
          const noteRow = document.querySelector(`[data-note-idx="${idx}"]`);
          if (noteRow) noteRow.scrollIntoView({ behavior: "smooth", block: "center" });
          seekToTimestamp(n.timestamp);
        });
        host.appendChild(dot);
      });
    },
  };

  // Stack and render every lane through the shared timeline core. The core
  // owns the vertical layout maths, the zoom width, and the minHeight; each
  // lane plugin owns its own DOM. tailPx (14) + the 120 floor reproduce the
  // pre-core host.style.minHeight.
  TimelineCore.renderLaneStack(host, {
    lanes: [ticksLane, casesLane, activityLane, screenshotsLane,
            densityLane, titlesLane, stepsLane, notesLane],
    span: { startMs: first, endMs: last },
    zoom: State.getZoomFactor(),
    tailPx: 14,
    minHeightFloor: 120,
  });

  // Legend mirrors the apps observed while the activity lane rendered.
  renderLegend(observedApps);

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

/* ============ Timeline helpers (lane layout, density)
   ================================================================ */

/* Walk markers, build closed/dangling cases, and assign each to a
   non-overlapping lane. Returns { cases: [...], lanesNeeded }.
   Each case: { startMs, endMs, label, dangling, lane, parent_id, id }. */
function layoutCaseLanes(evs, first, last) {
  const opening = [];   // stack of currently-open cases by depth
  const closed = [];
  let nextId = 0;
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      opening.push({
        id: nextId++,
        startMs: t,
        label: ev.data.label,
        parent_id: opening.length ? opening[opening.length - 1].id : null,
      });
    } else if (ev.data.marker_type === "end" && opening.length) {
      const c = opening.pop();
      c.endMs = t;
      c.dangling = false;
      closed.push(c);
    }
  }
  // Dangling cases: extend to session end.
  for (const c of opening) {
    c.endMs = last;
    c.dangling = true;
    closed.push(c);
  }
  // Lane assignment is delegated to the shared timeline core. Cases stay
  // sorted by start so the returned array order is unchanged; maxLanes is
  // set high enough that cases are never capped (unlike step/phase lanes).
  closed.sort((a, b) => a.startMs - b.startMs);
  const packed = TimelineCore.packLanes(
    closed.map((c) => ({ id: String(c.id), startMs: c.startMs, endMs: c.endMs })),
    { maxLanes: Math.max(1, closed.length), spanMs: Math.max(1, last - first) }
  );
  for (const c of closed) c.lane = packed.laneOf.get(String(c.id)) || 0;
  return { cases: closed, lanesNeeded: packed.laneCount };
}

/* The density histogram counts only events that represent user
   activity, not session bookkeeping (pause/resume, idle starts,
   recorder lifecycle, etc.). */
function isUserActivityEvent(ev) {
  if (ev.type === "activity" || ev.type === "interaction" || ev.type === "marker") return true;
  if (ev.type === "system") {
    const k = ev.data && ev.data.kind;
    if (k === "screenshot" || k === "screenshot_manual") return true;
  }
  return false;
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
   activateAnnoTab } -- flow-view-resident glue, injected at boot. */
function initTimeline(deps) {
  currentScopeRange    = (deps && deps.currentScopeRange)    || (() => null);
  showMarkerInsertMenu = (deps && deps.showMarkerInsertMenu) || (() => {});
  showCaseContextMenu  = (deps && deps.showCaseContextMenu)  || (() => {});
  activateAnnoTab      = (deps && deps.activateAnnoTab)      || (() => {});
}

module.exports = {
  initTimeline,
  renderTimeline, renderTimelineSummary, renderMinimap, syncMinimapViewport,
  restoreTimelineForCurrent, persistTimelineForCurrent, maybeAutoScrollToFirstCase,
  _wireTimelineScrollPersist, getLaneToggles, setLaneToggle,
  caseLabelFits, CASE_LABEL_MIN_PX,
};
