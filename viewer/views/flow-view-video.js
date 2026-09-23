/*
 * flow-view-video.js -- the video <-> timeline bridge for the Flow level.
 *
 * Extracted from flow-view.js (god-file split). Owns the "video start
 * timestamp" derivation, video<->session-time conversion, the playhead,
 * seeking (and the no-video playhead fallback), watch-a-step playback, and
 * the interactive video re-sync flow. Wires its own #video timeupdate guard
 * and the #btn-sync-video button at require() time (the DOM is parsed when
 * renderer.js pulls flow-view.js in, which require()s this).
 *
 * Cross-surface glue (loadSessionIntoView, called after a re-sync) is
 * injected via initVideo() so this module never require()s flow-view.js back.
 * Consumed by flow-view.js, flow-view-screenshots.js, and flow-view-markers.js
 * (seekToTimestamp / videoStartTs), so it must not depend on them.
 */

"use strict";

const State = require("../state.js");
const Ipc = require("../ipc.js");
const { $, formatDuration, toast } = require("../dom.js");

/* Injected by flow-view.js via initVideo() -- kept out of a require() to
   avoid a flow-view <-> video cycle. */
let loadSessionIntoView = async () => {};

function setVideoOverlay(text) {
  let o = $("#video-overlay");
  o.textContent = text;
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !State.getSession() || !State.getSession().events.length) return;
  const first = new Date(State.getSession().events[0].timestamp).getTime();
  const last = new Date(State.getSession().events[State.getSession().events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsStartTs = videoStartTs();
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = x + "%";
  ph.style.display = "";
  setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

/* ============ Video helpers ======================================= */

/* The "video start timestamp" -- i.e. the wall clock at video t=0.
   Priority: external-video offset (Teams recording etc.), else OBS's
   recording_start_ts. Returns ISO string or null. */
function videoStartTs() {
  if (!State.getSession()) return null;
  // External video override: session started_at + offsetMs = wall-clock when video t=0.
  if (State.getSession().externalVideoOffsetMs != null && State.getSession().manifest && State.getSession().manifest.started_at) {
    const ms = new Date(State.getSession().manifest.started_at).getTime()
             + Number(State.getSession().externalVideoOffsetMs);
    return new Date(ms).toISOString();
  }
  return (State.getSession().manifest.obs && State.getSession().manifest.obs.recording_start_ts) || null;
}

function formatPlayback(curS, durS) {
  const fmt = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  };
  return fmt(curS) + " / " + (isFinite(durS) ? fmt(durS) : "??:??");
}

function seekToTimestamp(ts) {
  if (!State.getSession()) return;
  // Remember this position so the Steps view can focus on the matching
  // step the next time the analyst switches to it.
  State.setPendingStepJump(ts);
  const video = $("#video");
  const obsStartTs = videoStartTs();
  if (obsStartTs && video && video.src) {
    const offsetS = (new Date(ts).getTime() - new Date(obsStartTs).getTime()) / 1000;
    if (offsetS < 0) return;
    video.currentTime = offsetS;
    video.play().catch(() => {});
    return;
  }
  // No video recording -- the seek above is dead without one. Move the
  // Flow timeline playhead to the timestamp and scroll it into view so
  // a "jump" / row click still does something visible.
  movePlayheadToTimestamp(ts);
}

/* Position the timeline playhead at a wall-clock timestamp and scroll
   the timeline so it is on screen. Gives no-video sessions a working
   seek -- the playhead is otherwise driven only by video playback. */
function movePlayheadToTimestamp(ts) {
  const sess = State.getSession();
  if (!sess || !sess.events || !sess.events.length) return;
  const ph = $("#tl-playhead");
  if (!ph) return;
  const first = new Date(sess.events[0].timestamp).getTime();
  const last = new Date(sess.events[sess.events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const frac = Math.min(1, Math.max(0, (new Date(ts).getTime() - first) / span));
  ph.style.left = (frac * 100) + "%";
  ph.style.display = "";
  const scroll = document.getElementById("timeline-scroll");
  if (scroll && scroll.scrollWidth > scroll.clientWidth) {
    scroll.scrollTo({
      left: Math.max(0, frac * scroll.scrollWidth - scroll.clientWidth / 2),
      behavior: "smooth",
    });
  }
  if (ph.animate) {
    ph.animate([{ filter: "brightness(2.6)" }, { filter: "brightness(1)" }],
               { duration: 650 });
  }
}

/* Steps/Phases detail panel -> Flow view. Switches the active level
   and seeks the video to the start of the step (if a recording is
   linked) or scrolls the Flow timeline playhead there. */
function jumpToStepInFlow(step) {
  if (!step || !step.time_range || !step.time_range.start) return;
  // Switch view-mode bar back to Flow
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  // Seek if we have a recording, else just nudge the playhead to land at the right column
  seekToTimestamp(step.time_range.start);
}

function videoTimeToSessionTs(seconds) {
  const obsStartTs = videoStartTs();
  if (!obsStartTs) return null;
  return new Date(new Date(obsStartTs).getTime() + seconds * 1000).toISOString();
}

/* H5: play the recording across a step's time range. Seeks to the step
   start and plays; a timeupdate guard pauses once the step end is hit
   so the analyst sees exactly the step and no more. */
let _watchStepStopAt = null;
function watchStep(step) {
  if (!step || !step.time_range || !step.time_range.start) return;
  const session = State.getSession();
  const video = $("#video");
  if (!session || !session.recordingAvailable || !video || !video.src) {
    toast("No video is linked to this session.", "error");
    return;
  }
  const startTs = videoStartTs();
  if (!startTs) {
    toast("Cannot line the video up with the timeline: no video start time.", "error");
    return;
  }
  // Make sure the video is on screen.
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  const base = new Date(startTs).getTime();
  const startS = (new Date(step.time_range.start).getTime() - base) / 1000;
  if (!isFinite(startS) || startS < 0) {
    toast("This step starts before the recording does.", "error");
    return;
  }
  const endS = step.time_range.end
    ? (new Date(step.time_range.end).getTime() - base) / 1000
    : null;
  _watchStepStopAt = (endS != null && endS > startS) ? endS : null;
  video.currentTime = startS;
  video.play().catch(() => {});
}
/* timeupdate guard for watchStep -- pauses once the step end is hit. */
function _watchStepGuard() {
  if (_watchStepStopAt == null) return;
  const video = $("#video");
  if (video && video.currentTime >= _watchStepStopAt) {
    video.pause();
    _watchStepStopAt = null;
  }
}

/* H4: interactive video re-sync. The analyst clicks a recognizable
   moment in the video, then the matching point on the timeline; the
   wall-clock gap becomes the external-video offset (annotations.json
   external_video.offset_ms, the same field the Attach video flow
   writes). The instruction card is non-blocking so the video and
   timeline stay clickable underneath it. */
let _videoSync = null;
function _videoSyncCard(text, primaryLabel, primaryFn) {
  let card = document.getElementById("video-sync-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "video-sync-card";
    card.className = "video-sync-card";
    document.body.appendChild(card);
  }
  let html = '<span class="vs-text"></span>';
  if (primaryLabel) html += '<button type="button" class="vs-mark primary"></button>';
  html += '<button type="button" class="vs-cancel">Cancel</button>';
  card.innerHTML = html;
  card.querySelector(".vs-text").textContent = text;
  if (primaryLabel) {
    const mark = card.querySelector(".vs-mark");
    mark.textContent = primaryLabel;
    mark.addEventListener("click", primaryFn);
  }
  card.querySelector(".vs-cancel").addEventListener("click", cancelVideoSync);
}
function cancelVideoSync() {
  if (_videoSync) {
    const tl = document.getElementById("timeline");
    if (tl) {
      tl.removeEventListener("click", _videoSync.onTimelineClick, true);
      tl.classList.remove("video-sync-target");
    }
    document.removeEventListener("keydown", _videoSync.onKey, true);
  }
  _videoSync = null;
  const card = document.getElementById("video-sync-card");
  if (card) card.remove();
}
function startVideoSync() {
  const session = State.getSession();
  const video = $("#video");
  if (!session || !session.recordingAvailable || !video || !video.src) {
    toast("No video is linked to this session.", "error");
    return;
  }
  if (!session.manifest || !session.manifest.started_at) {
    toast("Session has no start time: cannot compute a video offset.", "error");
    return;
  }
  cancelVideoSync();
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancelVideoSync(); }
  };
  // Step 1 -> 2: capture where the analyst paused the video. The video
  // keeps its normal controls so they can scrub to the right frame; a
  // card button (not a click on the video) records it, so marking can
  // never toggle playback.
  function markFrame() {
    if (!_videoSync || _videoSync.step !== 1) return;
    _videoSync.videoTime = video.currentTime || 0;
    _videoSync.step = 2;
    const tl = document.getElementById("timeline");
    if (tl) tl.classList.add("video-sync-target");
    _videoSyncCard("Step 2 of 2: click the matching moment on the timeline below.");
  }
  // The timeline's normal click (seek) is suppressed for the whole sync;
  // a step-2 click also sets the sync point.
  function onTimelineClick(e) {
    if (!_videoSync) return;
    e.preventDefault();
    e.stopPropagation();
    if (_videoSync.step !== 2) return;
    const eventMs = _timelineClickToMs(e.clientX);
    if (eventMs == null) {
      cancelVideoSync();
      toast("Could not read the timeline position.", "error");
      return;
    }
    const startedAt = new Date(session.manifest.started_at).getTime();
    // external_video.offset_ms is added to manifest.started_at to get
    // wall-clock at video t=0, so: offset = clicked wall-clock - the
    // video time at that moment - session start.
    const offsetMs = Math.round(eventMs - startedAt - (_videoSync.videoTime || 0) * 1000);
    applyVideoSync(offsetMs);
  }
  _videoSync = { videoTime: null, step: 1, onTimelineClick, onKey };
  const tl = document.getElementById("timeline");
  if (tl) tl.addEventListener("click", onTimelineClick, true);
  document.addEventListener("keydown", onKey, true);
  _videoSyncCard("Step 1 of 2: pause the video at a recognizable moment, then click Mark frame.",
    "Mark frame", markFrame);
}
async function applyVideoSync(offsetMs) {
  const session = State.getSession();
  cancelVideoSync();
  if (!session) return;
  const r = await Ipc.saveExternalVideoSync({
    sessionFolder: session.sessionFolder,
    videoPath: session.recordingPath,
    offsetMs,
  });
  if (!r || !r.ok) {
    toast("Could not save the video sync: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  toast("Video re-synced: reloading session", "success");
  await loadSessionIntoView(session.sessionFolder);
}
/* Wall-clock ms at a clicked x on the Flow timeline. #timeline spans the
   full (zoomed) session width and its left edge tracks the scroll, so a
   plain clientX-to-fraction read is correct without a scroll term. */
function _timelineClickToMs(clientX) {
  const host = document.getElementById("timeline");
  const session = State.getSession();
  const evs = (session && session.events) || [];
  if (!host || !evs.length) return null;
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const rect = host.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  return first + frac * span;
}

/* deps = { loadSessionIntoView } -- injected by flow-view.js at boot. */
function initVideo(deps) {
  loadSessionIntoView = (deps && deps.loadSessionIntoView) || (async () => {});
}

// Self-wire the require()-time listeners (mirrors the originals in
// flow-view.js: the timeupdate watch-step guard + the re-sync button).
if ($("#video")) $("#video").addEventListener("timeupdate", _watchStepGuard);
if ($("#btn-sync-video")) {
  $("#btn-sync-video").addEventListener("click", startVideoSync);
}

module.exports = {
  initVideo,
  setVideoOverlay, positionPlayhead,
  videoStartTs, formatPlayback, videoTimeToSessionTs,
  seekToTimestamp, movePlayheadToTimestamp, jumpToStepInFlow,
  watchStep, startVideoSync,
};
