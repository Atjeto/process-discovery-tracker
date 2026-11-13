/*
 * layout-controls.js
 * The Timeline level's two dividers and the video modes (Normal / Expanded /
 * Fullscreen).
 *
 * The dividers (lane SCREEN: the stage with the video and the pane above,
 * the timeline at the full width of the window below), both role="separator"
 * with the Steps level's divider's behaviour (pane-splitter.js):
 *  - #resize-video, between the video and the pane: sets the video pane's
 *    width (--video-width). styles.css keeps it between the video's least
 *    width and the width that leaves the pane its least width, at any window
 *    width; with nothing stored the video takes 58% of the stage, or less
 *    when the stage's height at 16:9 binds.
 *  - #resize-timeline, between the stage and the timeline: sets the
 *    timeline's height (--tl-height), between the timeline's least height
 *    and the height that leaves the stage its least height; with nothing
 *    stored the stylesheet's 272 px.
 * Either follows a drag, Left and Right (Up and Down) move it 24 px, 96 px
 * with Shift, Home and End take it to the two ends, and a double-click or
 * Enter puts the usual size back. Both sizes are remembered on this computer
 * (pdt.stage.videoWidth, pdt.stage.timelineHeight); the usual size back
 * forgets the stored one. The storage is a convenience: blocked, the
 * dividers still work for as long as the viewer stays open.
 *
 * The pure rules (the clamp, the usual video width, a stored size, the
 * separator's values, the keys) are exported for the unit tests; the
 * wiring runs only in the viewer's page.
 */

"use strict";

const LS_TIMELINE = "pdt.stage.timelineHeight";
const LS_VIDEO = "pdt.stage.videoWidth";
const KEY_STEP_PX = 24;
const KEY_BIG_STEP_PX = 96;
// The timeline's least height a drag or a key gives (styles.css keeps the
// stage at least its min-height, so a short window shrinks the timeline).
const TIMELINE_MIN = 150;

/* The first pane's size (the video's width, the stage's height) in pixels,
   held between its least size and the size that leaves the second pane its
   least: when both cannot hold, the first keeps its own, as the CSS does. */
function clampSplit(px, room, minFirst, minSecond) {
  return Math.round(Math.max(minFirst, Math.min(px, room - minSecond)));
}

/* The video pane's usual width in a stage of content width w and height h:
   58% of the width, or the height at 16:9 when that is less. */
function defaultVideoWidth(w, h) {
  return Math.min(0.58 * w, (h * 16) / 9);
}

/* The width the video pane is drawn at: the stored width, else the usual,
   kept within the limits of this stage (styles.css, .lower-workspace
   .video-pane, the same rule). lim: { minVideo, minPane, handle }. */
function videoWidth(stored, w, h, lim) {
  const want = stored == null ? defaultVideoWidth(w, h) : stored;
  return clampSplit(want, w - lim.handle, lim.minVideo, lim.minPane);
}

/* The width the video's header needs to show its label and its buttons on
   one line, none cut: its padding, the label, the room between them (gap)
   and the buttons shown side by side with their gap. */
function headWidth(padding, label, gap, buttons, buttonGap) {
  const shown = buttons.filter((w) => w > 0);
  const sum = shown.reduce((a, w) => a + w, 0) + Math.max(0, shown.length - 1) * buttonGap;
  return Math.ceil(padding + label + gap + sum);
}

/* A stored size: a whole number of pixels above 0. Anything else (nothing
   stored, or a value this version cannot read) is null: the usual size. */
function parseSize(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/* The separator's values, in percent of the room the two panes share: the
   first pane's share now, and at the two ends. */
function ariaValues(px, room, minFirst, minSecond) {
  const pct = (v) => Math.round((v / room) * 100);
  return { now: pct(px), min: pct(minFirst), max: pct(room - minSecond) };
}

/* Where a key takes the first pane's size, before the clamp; null for a key
   the divider leaves to the page (Enter, the reset, is handled apart). A
   vertical divider (side by side) takes Left and Right, a horizontal one
   (one above the other) Up and Down. */
function keyTarget(key, px, shift, horizontal) {
  const step = shift ? KEY_BIG_STEP_PX : KEY_STEP_PX;
  const less = horizontal ? "ArrowUp" : "ArrowLeft";
  const more = horizontal ? "ArrowDown" : "ArrowRight";
  switch (key) {
    case less: return px - step;
    case more: return px + step;
    case "Home": return -Infinity;
    case "End": return Infinity;
    default: return null;
  }
}

function readSize(key) {
  try { return parseSize(localStorage.getItem(key)); } catch (_) { return null; }
}
function writeSize(key, v) {
  try { localStorage.setItem(key, String(v)); } catch (_) { /* kept until the viewer closes */ }
}
function forgetSize(key) {
  try { localStorage.removeItem(key); } catch (_) { /* nothing was kept */ }
}

/* Wire one divider. o: { horizontal, first() the first pane's size now,
   room() the size the two panes share, limits() { minFirst, minSecond },
   apply(px) the first pane's size (null: the usual), store(px), forget(),
   observe: the elements whose size changes the values }. */
function wireDivider(handle, o) {
  if (!handle) return;
  const shown = () => o.room() > 0 && (o.horizontal ? handle.offsetHeight : handle.offsetWidth) > 0;
  const at = (px) => { const l = o.limits(); return clampSplit(px, o.room(), l.minFirst, l.minSecond); };

  // The values assistive technology reads, taken from the layout.
  function sync() {
    if (!shown()) return;
    const l = o.limits();
    const v = ariaValues(o.first(), o.room(), l.minFirst, l.minSecond);
    handle.setAttribute("aria-valuenow", String(v.now));
    handle.setAttribute("aria-valuemin", String(v.min));
    handle.setAttribute("aria-valuemax", String(v.max));
  }
  function set(px) { o.apply(px); sync(); }
  function reset() { o.forget(); o.apply(null); sync(); }

  // A drag: the pointer capture keeps one that leaves the window, and the
  // document's listeners carry it whether or not the capture holds.
  let drag = null;
  const coord = (e) => (o.horizontal ? e.clientY : e.clientX);
  function finish() {
    const px = drag && drag.px;
    drag = null;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    if (px != null) o.store(px);
  }
  function end(e) {
    if (drag && e.pointerId === drag.id) finish();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // The button came up where the page could not see it: the drag is over.
    if ((e.buttons & 1) === 0) { finish(); return; }
    if (drag.px == null && coord(e) === drag.c) return;
    drag.px = at(drag.from + coord(e) - drag.c);
    set(drag.px);
  }
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !shown()) return;
    if (drag) finish();   // an earlier drag whose end the page never saw
    e.preventDefault();   // no text selection
    drag = { id: e.pointerId, c: coord(e), from: o.first(), px: null };
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* the document's listeners carry the drag */ }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
  });
  handle.addEventListener("dblclick", (e) => { e.stopPropagation(); reset(); });
  // The divider's own keys; the Timeline's shortcuts do not see them.
  handle.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !shown()) return;
    if (e.key === "Enter" && !e.shiftKey) {
      reset();
    } else {
      const want = keyTarget(e.key, o.first(), e.shiftKey, o.horizontal);
      if (want == null) return;
      const px = at(want);
      set(px);
      o.store(px);
    }
    e.preventDefault();
    e.stopPropagation();
  });
  // A window resize, the level shown, the Raw events opened.
  const ro = new ResizeObserver(() => sync());
  for (const el of o.observe) if (el) ro.observe(el);
}

function initResize() {
  const root = document.documentElement;
  const stage = document.getElementById("lower-workspace");
  const videoPane = document.getElementById("video-pane");
  const pane = document.getElementById("timeline-pane");
  const tl = document.getElementById("timeline-section");
  const tlHandle = document.getElementById("resize-timeline");
  const vidHandle = document.getElementById("resize-video");
  if (!stage || !videoPane || !pane || !tl) return;

  // The limits the stylesheet sets on the stage, in pixels.
  const cssPx = (el, name) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
  const width = (el) => el.getBoundingClientRect().width;
  const height = (el) => el.getBoundingClientRect().height;

  function applyVideo(px) {
    if (px == null) root.style.removeProperty("--video-width");
    else root.style.setProperty("--video-width", px + "px");
  }
  // The timeline's height is the room less the stage's height.
  const tlRoom = () => height(stage) + height(tl);
  function applyStage(px) {
    if (px == null) root.style.removeProperty("--tl-height");
    else root.style.setProperty("--tl-height", (tlRoom() - px) + "px");
  }

  // The video pane's least width: the stylesheet's, or what its header's
  // buttons need when that is more (they change with the video attached and
  // synced): --video-head-w on the stage, which styles.css reads.
  const head = videoPane.querySelector(".video-controls");
  function videoLeast() {
    let need = 0;
    if (head && head.offsetWidth > 0) {
      const cs = getComputedStyle(head);
      const label = head.querySelector(".vc-status");
      const box = head.querySelector(".vc-buttons");
      const buttons = box ? [...box.children].map((b) => b.offsetWidth) : [];
      need = headWidth(parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
        label ? label.offsetWidth : 0, 8, buttons, box ? parseFloat(getComputedStyle(box).columnGap) || 0 : 0);
      stage.style.setProperty("--video-head-w", need + "px");
    }
    return Math.max(cssPx(stage, "--stage-video-least"), need);
  }
  videoLeast();
  if (head) new MutationObserver(() => videoLeast()).observe(head, { attributes: true, subtree: true, childList: true, characterData: true });

  // The sizes kept from an earlier session (none stored: the stylesheet's).
  applyVideo(readSize(LS_VIDEO));
  const h = readSize(LS_TIMELINE);
  if (h != null) root.style.setProperty("--tl-height", Math.max(TIMELINE_MIN, h) + "px");

  wireDivider(vidHandle, {
    horizontal: false,
    first: () => width(videoPane),
    room: () => width(videoPane) + width(pane),
    limits: () => ({ minFirst: videoLeast(), minSecond: cssPx(stage, "--stage-pane-min") }),
    apply: applyVideo,
    store: (px) => writeSize(LS_VIDEO, px),
    forget: () => forgetSize(LS_VIDEO),
    observe: [stage, videoPane],
  });
  wireDivider(tlHandle, {
    horizontal: true,
    first: () => height(stage),
    room: tlRoom,
    limits: () => ({ minFirst: parseFloat(getComputedStyle(stage).minHeight) || 0, minSecond: TIMELINE_MIN }),
    apply: applyStage,
    store: (px) => writeSize(LS_TIMELINE, Math.round(tlRoom() - px)),
    forget: () => forgetSize(LS_TIMELINE),
    observe: [stage, tl],
  });
}

// ---- Video modes ----
let currentMode = "normal"; // 'normal' | 'expanded' | 'fullscreen'

function setVideoMode(mode) {
  const layout = document.getElementById("session-layout-flow");
  if (!layout) return;
  currentMode = mode;
  layout.classList.toggle("video-expanded", mode === "expanded");
  layout.classList.toggle("video-fullscreen", mode === "fullscreen");

  const exp = document.getElementById("btn-video-expand");
  const full = document.getElementById("btn-video-fullscreen");
  if (exp) exp.setAttribute("aria-pressed", mode === "expanded" ? "true" : "false");
  if (full) full.setAttribute("aria-pressed", mode === "fullscreen" ? "true" : "false");

  const status = document.getElementById("vc-status-text");
  const pane = document.getElementById("video-pane");
  if (status) status.textContent =
    mode === "fullscreen" ? "FULLSCREEN" :
    mode === "expanded" ? "EXPANDED" : pane && pane.classList.contains("on-screen") ? "SCREEN" : "VIDEO";
}

function initVideoModes() {
  const exp = document.getElementById("btn-video-expand");
  const full = document.getElementById("btn-video-fullscreen");
  const videoPane = document.getElementById("video-pane");

  if (exp) exp.addEventListener("click", (e) => {
    e.stopPropagation();
    setVideoMode(currentMode === "expanded" ? "normal" : "expanded");
  });
  if (full) full.addEventListener("click", (e) => {
    e.stopPropagation();
    setVideoMode(currentMode === "fullscreen" ? "normal" : "fullscreen");
  });

  // Double-click the video frame to toggle expanded
  if (videoPane) videoPane.addEventListener("dblclick", (e) => {
    // Ignore double-clicks on native video controls
    if (e.target.closest(".video-controls")) return;
    setVideoMode(currentMode === "expanded" ? "normal" : "expanded");
  });

  // Esc exits fullscreen
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentMode === "fullscreen") {
      setVideoMode("normal");
    }
  });
}

function init() {
  initResize();
  initVideoModes();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

module.exports = {
  setVideoMode, clampSplit, defaultVideoWidth, videoWidth, headWidth, parseSize, ariaValues, keyTarget,
  LS_VIDEO, LS_TIMELINE, KEY_STEP_PX, KEY_BIG_STEP_PX, TIMELINE_MIN,
};
