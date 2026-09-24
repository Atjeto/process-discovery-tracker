/*
 * flow-view-timeline.js -- the Flow timeline subsystem.
 *
 * Extracted from flow-view.js (god-file split). Owns renderTimeline (the lane
 * stack: ticks / runs / activity+idle+markers / transcript / screenshots /
 * steps, via TimelineCore.renderLaneStack), the lane plugins' helpers
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
const { $, formatDuration, placeMenu, recordingStartMs, sinceStart } = require("../dom.js");
const { appColor, appLabel, renderLegend } = require("./flow-view-apps.js");
const { seekToTimestamp } = require("./flow-view-video.js");
const MarkerEdits = require("../marker-edits.js");
const { openScreenshot } = require("./flow-view-screenshots.js");
const { transcriptLane: makeTranscriptLane } = require("./flow-view-transcript.js");

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

/* Injected by flow-view.js via initTimeline() -- kept out of a require() to
   avoid a flow-view <-> timeline cycle. */
let currentScopeRange = () => null;
let showMarkerInsertMenu = () => {};
let showCaseContextMenu = () => {};

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
  if (!evs.length || !(State.getZoomFactor() > 1)) { mm.style.display = "none"; mm.innerHTML = ""; return; }
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
  // The one place the time of day shows: the recording's date and start.
  $("#timeline-summary").textContent = "Recorded " + first.toLocaleDateString() + " " +
    first.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " · " + formatDuration(last - first);
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
  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", () => { close(); handler(); });
    menu.appendChild(item);
  }
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
  document.body.appendChild(menu);
  placeMenu(menu, x, y);   // at (x, y), kept inside the window
  // A press ON the menu is a choice, not a dismissal (see showMarkerInsertMenu
  // in flow-view.js: closing on the item's own mousedown swallowed the click).
  function close() {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  }
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    close();
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
  // V2 item 8: the Steps lane is on by default (the Timeline's link to Steps
  // and to the step panel).
  idle: true, screenshots: false, cases: true, steps: true,
  // C8: exists only while a transcript is attached; on when it does.
  transcript: true,
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
  // One clock (AD-26): the axis, the tooltips and the screenshots read the
  // time since the recording started.
  const origin = recordingStartMs(State.getSession());
  // C8: the Transcript lane exists only while a transcript is attached
  // (flow-view-transcript.js; it also shows the lane's row in the Lanes menu).
  const transcriptLane = makeTranscriptLane({ first, last, span, on: !!lanes.transcript });

  /* Lane stack (top to bottom):
       ticks:        m:ss labels (the time since the recording started)
       cases:        one labelled band per run (header)
       activity:     per-app coloured bands (the hero lane)
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

  // The steps lane shows the steps as they are: one band per visible step,
  // named as in the Steps list.
  const _anno = (State.getSession().annotations) || {};
  const _stepsForLane = (_anno.steps || []).filter((s) => s && s.state !== "hidden").map((s) => ({
    label: s.name || s.step_id || "", step_id: s.step_id, time_range: s.time_range,
  }));

  // Run bands render as a labelled header ABOVE the activity lane;
  // layoutCaseLanes pairs the markers into runs the way the pipeline does.
  // The bands follow the markers the LAST ANALYSIS used (captured markers
  // with the applied marker changes, marker-edits.js), so a pending insert
  // shows as a pending marker bar, and becomes a run band once analyzed.
  const markerRows = MarkerEdits.sessionMarkerView(State.getSession());
  const caseLanes = layoutCaseLanes(MarkerEdits.appliedMarkerEvents(markerRows), first, last);

  // Resolved lane heights. A height of 0 hides the lane: the core skips its
  // render and (with gapBefore) collapses the spacing. These mirror the
  // pre-core geometry; gapBefore values below reproduce the lane cascade.
  const casesH = lanes.cases ? caseLanes.lanesNeeded * caseRowH : 0;
  const activityH = 60;
  const screenshotsH = lanes.screenshots ? 26 : 0;
  const stepsLaneH = (lanes.steps && _stepsForLane.length) ? 16 : 0;

  // The systems drawn on the activity lane feed the legend (each with the
  // application its bands came from, for the colour); the case scope range
  // dims out-of-scope activity bands. Both computed once.
  const observedApps = new Map();
  const appNames = ((State.getSession().stats || {}).meta || {}).app_names || {};
  const scopeRange = currentScopeRange();

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
        band.className = "tl-case-band" + (c.dangling ? " dangling" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = top + "px";
        band.style.height = (caseRowH - 4) + "px";
        band.title = c.title + (c.label ? ": " + c.label : "") +
          (c.dangling ? " (no end marker)" : "\n" + formatDuration(c.endMs - c.startMs));
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
        // The system the band names (C14): Salesforce, not the browser.
        const system = appLabel(ev.data.app, ev.data.title, appNames);
        if (ev.data.app && !observedApps.has(system)) observedApps.set(system, ev.data.app);
        band.title = system + (ev.data.title ? "\n" + ev.data.title : "") +
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
      // labelled pending: it is the immediate feedback for an insert / move /
      // delete. Applied markers are not drawn here (the Marker bars lane is
      // cut): the Runs lane and the Markers tab show them.
      for (const m of markerRows) {
        if (!m.pending) continue;
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
            ", not applied yet. Click Apply marker changes to update the runs." : "");
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
        dot.title = "Screenshot at " + sinceStart(ev.timestamp, origin) + "\n" + (ev.data.path || "");
        dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
        host.appendChild(dot);
      }
    },
  };

  // ===== Per-step lane (P1.4) =====
  // Renders a single row of step bands beneath the screenshot rail when steps
  // exist. Click to select the step + seek; right-click opens it in Steps.
  const stepsLane = {
    key: "steps",
    height: stepsLaneH,
    gapBefore: 6,
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
        band.textContent = lbl;
        band.title = lbl + " · " + formatDuration(sEnd - sStart) +
          "\nClick: the step panel, and seek · Right-click: Open in Steps";
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
          // V2 item 4: the step panel opens beside the timeline (lazy: the
          // panel requires the video module this one requires too).
          const step = (_anno.steps || []).find((x) => x.step_id === s.step_id);
          if (step) require("./step-panel.js").openForStep(step);
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

  // Stack and render every lane through the shared timeline core. The core
  // owns the vertical layout maths, the zoom width, and the minHeight; each
  // lane plugin owns its own DOM. tailPx (14) + the 120 floor reproduce the
  // pre-core host.style.minHeight.
  TimelineCore.renderLaneStack(host, {
    lanes: [ticksLane, casesLane, activityLane, transcriptLane, screenshotsLane, stepsLane],
    span: { startMs: first, endMs: last },
    zoom: State.getZoomFactor(),
    tailPx: 14,
    minHeightFloor: 120,
  });

  // Legend mirrors the apps observed while the activity lane rendered, and
  // explains only the marks the timeline draws: an entry whose lane is off is
  // hidden (a pending marker is drawn whatever its lane says).
  renderLegend(observedApps);
  const legendShows = {
    ".lg-idle": !!lanes.idle,
    ".lg-marker": markerRows.some((m) => m.pending),
    ".lg-screenshot": !!lanes.screenshots,
  };
  for (const [sel, on] of Object.entries(legendShows)) {
    const el = document.querySelector("#timeline-legend " + sel);
    if (el) el.style.display = on ? "" : "none";
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
   { id, startMs, endMs, label, title ("Run N", the Steps level's name for
   it), dangling, lane }. */
function layoutCaseLanes(evs, first, last) {
  const runs = [];
  let open = null;
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      if (open) { open.endMs = t; open.dangling = false; runs.push(open); }
      open = { startMs: t, label: ev.data.label };
    } else if (ev.data.marker_type === "end" && open) {
      open.endMs = t;
      open.dangling = false;
      runs.push(open);
      open = null;
    }
  }
  if (open) { open.endMs = last; open.dangling = true; runs.push(open); }
  runs.sort((a, b) => a.startMs - b.startMs);
  runs.forEach((r, i) => { r.id = i; r.title = "Run " + (i + 1); });
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

/* deps = { currentScopeRange, showMarkerInsertMenu, showCaseContextMenu }:
   the flow-view-resident glue, injected at boot. */
function initTimeline(deps) {
  currentScopeRange    = (deps && deps.currentScopeRange)    || (() => null);
  showMarkerInsertMenu = (deps && deps.showMarkerInsertMenu) || (() => {});
  showCaseContextMenu  = (deps && deps.showCaseContextMenu)  || (() => {});
}

module.exports = {
  initTimeline,
  renderTimeline, renderTimelineSummary, renderMinimap, syncMinimapViewport,
  restoreTimelineForCurrent, persistTimelineForCurrent, maybeAutoScrollToFirstCase,
  _wireTimelineScrollPersist, getLaneToggles, setLaneToggle,
  caseLabelFits, CASE_LABEL_MIN_PX, timeAtClientX, layoutCaseLanes,
};
