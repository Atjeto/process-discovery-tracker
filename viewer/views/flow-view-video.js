/*
 * flow-view-video.js -- the video <-> timeline bridge for the Flow level.
 *
 * Extracted from flow-view.js (god-file split). Owns the "video start
 * timestamp" derivation, video<->session-time conversion, the playhead,
 * seeking (and the no-video playhead fallback), attaching a video (a re-link
 * keeps the stored sync) and the interactive video re-sync flow. Wires the
 * #btn-sync-video button at require() time (the DOM is parsed when
 * renderer.js pulls flow-view.js in, which require()s this). Watching a step
 * is the step panel's (views/step-panel.js).
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

/* The span the Timeline lays out, { startMs, endMs }, or null. A recording
   runs from its first event to its last. A session without events (a video
   or blank project, C16) runs on its video: from the video's start for the
   video's length, once the length is read (noteVideoLength). */
const _videoLength = new Map();   // recordingPath -> ms
function timelineSpan() {
  const s = State.getSession();
  if (!s) return null;
  const evs = s.events || [];
  if (evs.length) {
    const a = Date.parse(evs[0].timestamp), b = Date.parse(evs[evs.length - 1].timestamp);
    return isFinite(a) && isFinite(b) ? { startMs: a, endMs: b } : null;
  }
  const len = s.recordingAvailable ? _videoLength.get(s.recordingPath) : null;
  const start = Date.parse(videoStartTs());
  return len && isFinite(start) ? { startMs: start, endMs: start + len } : null;
}

/* Read the video's length for the Timeline of a session without events. A
   video whose file holds no length (a recorded .webm reports Infinity) is
   measured by one seek far past its end, then put back at 0. Returns true
   when the known length changed. */
let _measuringSrc = null;
function noteVideoLength(video) {
  const s = State.getSession();
  if (!s || (s.events || []).length || !s.recordingAvailable || !video || !video.src) return false;
  let shown = "";
  try { shown = decodeURIComponent(new URL(video.currentSrc || video.src).pathname).replace(/^\/+/, ""); } catch (_) { return false; }
  if (shown.toLowerCase() !== String(s.recordingPath).replace(/\\/g, "/").toLowerCase()) return false;
  if (!isFinite(video.duration)) {
    if (_measuringSrc !== video.src && video.readyState >= 1) { _measuringSrc = video.src; video.currentTime = 1e101; }
    return false;
  }
  if (_measuringSrc === video.src) { _measuringSrc = null; video.currentTime = 0; }
  const ms = Math.round(video.duration * 1000);
  if (!(ms > 0) || _videoLength.get(s.recordingPath) === ms) return false;
  _videoLength.set(s.recordingPath, ms);
  return true;
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  const sp = timelineSpan();
  if (!ph || !sp) return;
  const first = sp.startMs;
  const span = Math.max(1, sp.endMs - first);
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
  const sp = timelineSpan();
  const ph = $("#tl-playhead");
  if (!sp || !ph) return;
  const first = sp.startMs;
  const span = Math.max(1, sp.endMs - first);
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

/* (Watch a step plays it in the step panel's own video now, beside the steps:
   views/step-panel.js, V2 item 4.) */

/* H4: interactive video re-sync. The analyst clicks a recognizable
   moment in the video, then the matching point on the timeline; the
   wall-clock gap becomes the external-video offset (annotations.json
   external_video.offset_ms). The instruction card is non-blocking so the
   video and timeline stay clickable underneath it. Attach video runs the
   same two clicks on the file just chosen (attachVideo below): nothing is
   saved until the second click, and Cancel leaves the recording as it was. */
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
  const pending = _videoSync && _videoSync.pendingPath;
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
  // An attach that did not finish: the player goes back to what the recording has.
  if (pending) _showVideo(null);
}

/* The video pane on the Timeline shows `file` (an attach in progress), or,
   with null, the recording's own video or the slim no-video band, as
   flow-view's session load leaves it. */
function _showVideo(file) {
  const session = State.getSession();
  const video = $("#video");
  if (!video) return;
  const src = file || (session && session.recordingAvailable ? session.recordingPath : null);
  const shown = !!src;
  if (src) video.src = "file:///" + String(src).replace(/\\/g, "/");
  else { video.removeAttribute("src"); video.load(); }
  video.style.display = shown ? "" : "none";
  const noVid = $("#no-video"), overlay = $("#video-overlay");
  if (noVid) noVid.style.display = shown ? "none" : "";
  if (overlay) overlay.style.display = shown ? "" : "none";
  for (const id of ["lower-workspace", "video-pane"]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("no-recording", !shown);
  }
}

/* Attach video (item 5): choose the file, then place it the way Sync video
   does, with two clicks: pause the video at a moment you recognize and Mark
   frame, then click the same moment on the timeline. Nothing is written
   until the second click; Cancel (or Escape) leaves the recording as it was.
   Opens the Timeline, where the video and the timeline are. */
async function attachVideo() {
  const session = State.getSession();
  if (!session) return;
  if (!session.manifest || !session.manifest.started_at) {
    toast("This recording has no start time, so a video cannot be placed on it.", "error");
    return;
  }
  const r = await Ipc.attachExternalVideo({ sessionFolder: session.sessionFolder });
  if (!r || !r.path || State.getSession() !== session) return;
  // A re-link (V2 item 5): the video this recording was synced with is not
  // found (a moved or received folder); the file chosen takes its place with
  // the stored sync, which Sync video can still change.
  const stored = session.annotations && session.annotations.external_video;
  const storedOffset = stored && stored.path && stored.offset_ms != null && isFinite(Number(stored.offset_ms))
    ? Number(stored.offset_ms) : null;
  if (!session.recordingAvailable && storedOffset !== null) {
    await applyVideoSync(storedOffset, r.path, true);
    return;
  }
  // A session without a recording (C16) has no events to sync with: the
  // video starts with the session and the Timeline follows it.
  if (!(session.events || []).length) {
    await applyVideoSync(0, r.path);
    return;
  }
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  cancelVideoSync();
  // One sync at a time: a transcript sync in progress ends (lazy require, the
  // transcript module requires this one).
  require("./flow-view-transcript.js").cancelTranscriptSync();
  _showVideo(r.path);
  startVideoSync({ pendingPath: r.path });
}

/* opts.pendingPath: the video an attach in progress placed in the player; it
   is saved with the offset the two clicks give. */
function startVideoSync(opts) {
  const session = State.getSession();
  const video = $("#video");
  const pendingPath = (opts && typeof opts.pendingPath === "string") ? opts.pendingPath : null;
  if (!session || (!pendingPath && !session.recordingAvailable) || !video || !video.src) {
    toast("No video is linked to this session.", "error");
    return;
  }
  if (!session.manifest || !session.manifest.started_at) {
    toast("Session has no start time: cannot compute a video offset.", "error");
    return;
  }
  if (!pendingPath) cancelVideoSync();
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
    applyVideoSync(offsetMs, _videoSync.pendingPath);
  }
  _videoSync = { videoTime: null, step: 1, onTimelineClick, onKey, pendingPath };
  const tl = document.getElementById("timeline");
  if (tl) tl.addEventListener("click", onTimelineClick, true);
  document.addEventListener("keydown", onKey, true);
  _videoSyncCard("Step 1 of 2: pause the video at a recognizable moment, then click Mark frame.",
    "Mark frame", markFrame);
}
/* Save the offset (and, for an attach, the video's path), then reload. The
   main process copies a video from outside the folder into its video/
   folder first (V2 item 5), which takes a moment for a long video.
   `relink`: the stored sync was kept for a video found again. */
async function applyVideoSync(offsetMs, pendingPath, relink) {
  const session = State.getSession();
  // The sync is over: forget the attach before cancelVideoSync would restore the player.
  if (_videoSync) _videoSync.pendingPath = null;
  cancelVideoSync();
  if (!session) return;
  if (pendingPath) toast("Attaching the video...", "info");
  const r = await Ipc.saveExternalVideoSync({
    sessionFolder: session.sessionFolder,
    videoPath: pendingPath || session.recordingPath,
    offsetMs,
  });
  if (!r || !r.ok) {
    toast((pendingPath ? "The video was not attached: " : "Could not save the video sync: ") +
      ((r && r.error) || "no reason was given"), "error");
    if (pendingPath) _showVideo(null);
    return;
  }
  if (r.copyError) {
    toast("The video is attached, but it could not be copied into the recording folder (" + r.copyError +
      "), so a copy of the folder will not carry it.", "error");
  } else {
    const plain = !(session.events || []).length;
    toast((relink ? "Video found: it keeps its sync (Sync video changes it)." : plain && pendingPath ? "Video attached."
      : pendingPath ? "Video attached and synced." : "Video synced.") +
      (r.copied ? " It is copied into the recording folder." : ""), "success");
  }
  await loadSessionIntoView(session.sessionFolder);
}
/* Wall-clock ms at a clicked x on the Flow timeline. #timeline spans the
   full (zoomed) session width and its left edge tracks the scroll, so a
   plain clientX-to-fraction read is correct without a scroll term. */
function _timelineClickToMs(clientX) {
  const host = document.getElementById("timeline");
  const sp = timelineSpan();
  if (!host || !sp) return null;
  const first = sp.startMs;
  const span = Math.max(1, sp.endMs - first);
  const rect = host.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  return first + frac * span;
}

/* deps = { loadSessionIntoView } -- injected by flow-view.js at boot. */
function initVideo(deps) {
  loadSessionIntoView = (deps && deps.loadSessionIntoView) || (async () => {});
}

// Self-wire the require()-time listener of the re-sync button.
if ($("#btn-sync-video")) {
  $("#btn-sync-video").addEventListener("click", startVideoSync);
}

module.exports = {
  initVideo, timelineSpan, noteVideoLength,
  setVideoOverlay, positionPlayhead,
  videoStartTs, formatPlayback, videoTimeToSessionTs,
  seekToTimestamp, movePlayheadToTimestamp, jumpToStepInFlow,
  startVideoSync, cancelVideoSync, attachVideo,
};
