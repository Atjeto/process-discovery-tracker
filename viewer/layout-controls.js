/*
 * layout-controls.js
 * Drag-to-resize handles + video mode (Normal / Expanded / Fullscreen).
 *
 * Wires up two resize handles on the Timeline (lane SCREEN: the stage with
 * the video and the pane above, the timeline at the full width below):
 *  - #resize-timeline (vertical drag between the stage and the timeline,
 *    sets --tl-height, the timeline's height; dragged up, the timeline grows)
 *  - #resize-video    (horizontal drag between the video and the pane, sets
 *    --video-width; styles.css keeps the video at most 58% of the stage)
 * And three video modes via #btn-video-expand / #btn-video-fullscreen.
 * The sizes are stored under keys of their own: the sizes the old layout
 * stored (the lanes' height, the video's width under the timeline) are not
 * read, so they cannot break this one.
 */

"use strict";

(function () {
  // The timeline's height: what a drag can give it (styles.css also keeps
  // the stage at least its min-height, so a short window shrinks the
  // timeline first). No stored size: the stylesheet's (272 px).
  const TIMELINE_HEIGHT_MIN = 150;
  const TIMELINE_HEIGHT_MAX = 640;
  const VIDEO_WIDTH_MIN = 240;
  const VIDEO_WIDTH_MAX = 2400;

  const LS_TIMELINE = "pdt.stage.timelineHeight";
  const LS_VIDEO = "pdt.stage.videoWidth";

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function readNum(key, fallback) {
    try {
      const v = parseInt(localStorage.getItem(key), 10);
      return Number.isFinite(v) ? v : fallback;
    } catch (_) { return fallback; }
  }
  function writeNum(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (_) {}
  }

  function setTimelineHeight(px) {
    const v = clamp(Math.round(px), TIMELINE_HEIGHT_MIN, TIMELINE_HEIGHT_MAX);
    document.documentElement.style.setProperty("--tl-height", v + "px");
    writeNum(LS_TIMELINE, v);
  }
  function setVideoWidth(px) {
    const v = clamp(Math.round(px), VIDEO_WIDTH_MIN, VIDEO_WIDTH_MAX);
    document.documentElement.style.setProperty("--video-width", v + "px");
    writeNum(LS_VIDEO, v);
  }

  // ---- Drag-resize utility ----
  function makeDraggable(handle, getStart, onDelta, onEnd) {
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.classList.add("dragging");
      const start = getStart();
      const startX = e.clientX, startY = e.clientY;
      document.body.style.userSelect = "none";

      function onMove(ev) {
        onDelta(start, ev.clientX - startX, ev.clientY - startY);
      }
      function onUp() {
        handle.classList.remove("dragging");
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (onEnd) onEnd();
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function initResize() {
    const tlHandle = document.getElementById("resize-timeline");
    const vidHandle = document.getElementById("resize-video");

    // Restore persisted sizes (none stored: the stylesheet's).
    const h = readNum(LS_TIMELINE, null);
    if (h != null) setTimelineHeight(h);
    const w = readNum(LS_VIDEO, null);
    if (w != null) setVideoWidth(w);

    // A drag starts from the size shown (a stored size may be more than the
    // window gives).
    const shownHeight = () => {
      const tl = document.getElementById("timeline-section");
      return tl ? tl.getBoundingClientRect().height : 272;
    };
    const shownWidth = () => {
      const vp = document.getElementById("video-pane");
      return vp ? vp.getBoundingClientRect().width : 600;
    };
    makeDraggable(tlHandle, shownHeight, (start, _dx, dy) => setTimelineHeight(start - dy));
    makeDraggable(vidHandle, shownWidth, (start, dx, _dy) => setVideoWidth(start + dx));
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  module.exports = { setTimelineHeight, setVideoWidth, setVideoMode };
})();
