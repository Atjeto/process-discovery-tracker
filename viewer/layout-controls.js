/*
 * layout-controls.js
 * Drag-to-resize handles + video mode (Normal / Expanded / Fullscreen).
 *
 * Wires up two resize handles in the session flow view:
 *  - #resize-timeline (vertical drag, sets --timeline-height)
 *  - #resize-video    (horizontal drag, sets --video-width)
 * And three video modes via #btn-video-expand / #btn-video-fullscreen.
 */

"use strict";

(function () {
  const TIMELINE_HEIGHT_MIN = 80;
  const TIMELINE_HEIGHT_MAX = 360;
  const TIMELINE_HEIGHT_DEFAULT = 160;
  const VIDEO_WIDTH_MIN = 240;
  const VIDEO_WIDTH_MAX = 900;
  const VIDEO_WIDTH_DEFAULT = 420;

  const LS_TIMELINE = "pdt.timelineHeight";
  const LS_VIDEO = "pdt.videoWidth";

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
    document.documentElement.style.setProperty("--timeline-height", v + "px");
    writeNum(LS_TIMELINE, v);
  }
  function setVideoWidth(px) {
    const v = clamp(Math.round(px), VIDEO_WIDTH_MIN, VIDEO_WIDTH_MAX);
    document.documentElement.style.setProperty("--video-width", v + "px");
    writeNum(LS_VIDEO, v);
  }

  // ---- Drag-resize utility ----
  function makeDraggable(handle, getStart, onDelta) {
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
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function initResize() {
    const tlHandle = document.getElementById("resize-timeline");
    const vidHandle = document.getElementById("resize-video");

    // Restore persisted sizes
    setTimelineHeight(readNum(LS_TIMELINE, TIMELINE_HEIGHT_DEFAULT));
    setVideoWidth(readNum(LS_VIDEO, VIDEO_WIDTH_DEFAULT));

    makeDraggable(tlHandle,
      () => readNum(LS_TIMELINE, TIMELINE_HEIGHT_DEFAULT),
      (start, _dx, dy) => setTimelineHeight(start + dy));

    makeDraggable(vidHandle,
      () => readNum(LS_VIDEO, VIDEO_WIDTH_DEFAULT),
      (start, dx, _dy) => setVideoWidth(start + dx));
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
    if (status) status.textContent =
      mode === "fullscreen" ? "FULLSCREEN" :
      mode === "expanded" ? "EXPANDED" : "VIDEO";
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

  window.PdtLayout = { setTimelineHeight, setVideoWidth, setVideoMode };
})();
