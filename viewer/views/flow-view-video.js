/*
 * flow-view-video.js -- the video <-> timeline bridge for the Flow level.
 *
 * Extracted from flow-view.js (god-file split). Owns the videos of a project
 * on its clock, the player, the playhead, seeking (and the no-video playhead
 * fallback), adding, syncing, replacing, trimming and removing a video.
 * Wires the #btn-sync-video and #btn-video-remove buttons at require() time
 * (the DOM is parsed when renderer.js pulls flow-view.js in, which
 * require()s this). Watching a step is the step panel's
 * (views/step-panel.js); the Timeline's Videos lane is video-lane.js.
 *
 * Contract C23 (2.0.6, the owner: "10th minute on the timeline is 10th
 * minute on the timeline, regardless if there are 1 or 7 videos"). A project
 * holds a chain of videos (annotations.external_videos, video-chain.js),
 * each placed on the one clock and trimmed; a recording without one plays
 * its own video (OBS) as a chain of one. The player (#video) shows one video
 * at a time: a seek picks the video showing that moment, and playing on
 * past a video's end goes on with the next one when it starts there (back
 * to back). Every time this module gives or takes is a moment on the clock
 * (playheadMs); the time inside a file is the player's only.
 *
 * In a project made from videos (no recording) the videos run back to back,
 * as in a video editor: one added goes after the last, and a trim, a replace
 * or a remove that changes a video's length moves the videos after it and
 * everything marked on them (video-chain.js shiftMarks). In a recording each
 * video is placed by its sync (two clicks), and an edit of one moves nothing
 * else. Every edit of the chain is one undoable edit.
 *
 * Cross-surface glue (loadSessionIntoView, called after an edit) is
 * injected via initVideo() so this module never require()s flow-view.js
 * back. Consumed by flow-view.js, flow-view-screenshots.js,
 * flow-view-markers.js and the step panel, so it must not depend on them
 * (flow-view-markers.js keepApplied and the transcript module are required
 * lazily, at the moment of an edit).
 */

"use strict";

const State = require("../state.js");
const Ipc = require("../ipc.js");
const { $, toast } = require("../dom.js");
const { saveAnnotationsWithUndo } = require("../session.js");
const { confirmModal } = require("../modals.js");
const { isVideoCopy } = require("../analyst-files.js");
const VideoChain = require("../video-chain.js");
const TM = require("../transcript-model.js");
const MarkerEdits = require("../marker-edits.js");

/* Injected by flow-view.js via initVideo() -- kept out of a require() to
   avoid a flow-view <-> video cycle. */
let loadSessionIntoView = async () => {};

function setVideoOverlay(text) {
  const o = $("#video-overlay");
  if (o) o.textContent = text;
}

/* ============ The chain (C23) ========================================== */

/* The lengths of the video files on this machine, in ms, as the player or a
   probe measured them (a file that holds none, a recorded .webm, is
   measured by one seek past its end). */
const _videoLength = new Map();

function _originMs(s) {
  const t = Date.parse(s && s.manifest && s.manifest.started_at);
  return Number.isFinite(t) ? t : NaN;
}

function fileUrl(p) { return "file:///" + String(p).replace(/\\/g, "/"); }

function _sess(sess) { return sess === undefined ? State.getSession() : sess; }

/* Whether the project runs its videos back to back: it has no recording
   (no events, C16), so its clock is its videos. */
function isBackToBack(sess) {
  const s = _sess(sess);
  return !!s && !(s.events || []).length;
}

/* The videos the project plays, in clock order: the analyst's
   (annotations.external_videos, video-chain.js clipsOf), each with `file`,
   the file found on this machine (main.js resolves it; null when not
   found); else a recording's own video (OBS) as one clip, `obs`, placed by
   its recording_start_ts (offset_ms null when it has none). */
function chainOf(sess) {
  const s = _sess(sess);
  if (!s) return [];
  const found = new Map((Array.isArray(s.videos) ? s.videos : []).map((v) => [v.id, v.path || null]));
  const clips = VideoChain.clipsOf(s.annotations).map((c) => Object.assign(c, { file: found.get(c.id) || null }));
  if (clips.length) return clips;
  if (!s.recordingAvailable || !s.recordingPath) return [];
  const rst = Date.parse(s.manifest && s.manifest.obs && s.manifest.obs.recording_start_ts);
  const o = _originMs(s);
  return [{ id: "obs", path: null, file: s.recordingPath, obs: true,
    offset_ms: Number.isFinite(rst) && Number.isFinite(o) ? rst - o : null,
    in_ms: 0, out_ms: null, length_ms: null, attached_at: null }];
}

/* The videos the analyst added (not a recording's own). */
function addedClips(sess) { return chainOf(sess).filter((c) => !c.obs); }

/* A clip's length in ms: measured on this machine, else as stored, else
   null. */
function lengthOf(clip) {
  const m = clip && clip.file ? _videoLength.get(clip.file) : undefined;
  if (m > 0) return m;
  return clip && clip.length_ms > 0 ? clip.length_ms : null;
}

/* A clip's length for the edits of the chain, which work on the clips of
   the annotations (video-chain.js clipsOf, no `file`): measured for the
   clip of that id, else as stored. */
function _lengths(sess) {
  const byId = new Map(chainOf(sess).map((c) => [c.id, c]));
  return (c) => lengthOf((c && byId.get(c.id)) || c);
}

/* A clip on the clock, in absolute ms: { clip, fileStartMs (its file's 0),
   startMs, endMs (null while its length is not known) }, or null when it is
   not placed. */
function clipSpan(clip, sess) {
  const o = _originMs(_sess(sess));
  if (!clip || clip.offset_ms == null || !Number.isFinite(o)) return null;
  const out = VideoChain.outOf(clip, lengthOf);
  return { clip, fileStartMs: o + clip.offset_ms, startMs: o + clip.offset_ms + clip.in_ms,
    endMs: out == null ? null : o + clip.offset_ms + out };
}

/* The clip showing the moment `ms` (absolute) and where in its file:
   { clip, sec, span }, or null. */
function clipAtMs(ms, sess) {
  const s = _sess(sess);
  const o = _originMs(s);
  if (!Number.isFinite(o) || !Number.isFinite(ms)) return null;
  const clips = chainOf(s).filter((c) => c.offset_ms != null);
  const hit = VideoChain.clipAtRel(clips, lengthOf, ms - o);
  return hit ? { clip: hit.clip, sec: hit.sourceMs / 1000, span: clipSpan(hit.clip, s) } : null;
}

/* The clip that plays after `clip`: the next one, when it starts within a
   second of where this one ends (back to back), else null. */
function _followerOf(clip) {
  const clips = chainOf().filter((c) => c.offset_ms != null);
  const next = VideoChain.nextClip(clips, lengthOf, clip);
  const a = clipSpan(clip), b = next && clipSpan(next);
  return a && b && a.endMs != null && Math.abs(b.startMs - a.endMs) <= 1000 ? next : null;
}

/* ============ The player =============================================== */

let _curId = null;        // the clip in the player
let _curFolder = null;    // the project it belongs to
let _pending = null;      // { sec, play }: a seek waiting for the clip's file to load
let _parkedMs = null;     // the playhead put at a moment no video shows
let _measuringSrc = null;
/* Playback reached a file's last moments while playing: an `ended` that
   follows is the end of playback, not the seek past the end that measures a
   recorded .webm (which can fire it too). */
let _playingAtEnd = false;

function currentClip() {
  if (!_curId) return null;
  return chainOf().find((c) => c.id === _curId) || null;
}

function _shownPath(video) {
  try { return decodeURIComponent(new URL(video.currentSrc || video.src).pathname).replace(/^\/+/, ""); }
  catch (_) { return ""; }
}
function _sameFile(video, file) {
  // The leading slashes go on both sides: a file URL's path has one before a
  // drive letter, and an absolute path elsewhere starts with one.
  return !!video && !!video.src && !!file &&
    _shownPath(video).toLowerCase() === String(file).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/* The video pane shows the player (`shown`) or the slim no-video band. */
function _showPane(shown) {
  const video = $("#video");
  if (video) video.style.display = shown ? "" : "none";
  const noVid = $("#no-video"), overlay = $("#video-overlay");
  if (noVid) noVid.style.display = shown ? "none" : "";
  if (overlay) overlay.style.display = shown ? "" : "none";
  for (const id of ["lower-workspace", "video-pane"]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("no-recording", !shown);
  }
}

/* Put `clip` in the player at `sec` (in its file), playing or not. A clip
   whose file is not found cannot be shown: false. */
function _loadClip(clip, sec, play) {
  const video = $("#video");
  if (!video || !clip || !clip.file) return false;
  _parkedMs = null;
  _playingAtEnd = false;
  if (_curId !== clip.id || !_sameFile(video, clip.file)) {
    _curId = clip.id;
    _pending = { sec: Math.max(0, sec), play: !!play };
    video.src = fileUrl(clip.file);
    _showPane(true);
    return true;
  }
  video.currentTime = Math.max(0, sec);
  if (play) video.play().catch(() => {});
  return true;
}

/* After a session load (flow-view.js): the player shows the video it showed,
   at the same moment of the clock while a video shows it (an edit of the
   chain keeps the playhead where it is, as a video editor does); else the
   first video at its start; else the no-video band. Returns whether a
   video is shown. */
function loadPlayer() {
  const s = State.getSession();
  const video = $("#video");
  const was = s && s.sessionFolder === _curFolder ? playheadMs() : null;
  _curFolder = s ? s.sessionFolder : null;
  _parkedMs = null;
  _measuringSrc = null;
  const clips = chainOf(s).filter((c) => c.file);
  if (!s || !video || !clips.length) {
    _curId = null;
    _pending = null;
    if (video) { video.removeAttribute("src"); video.load(); }
    _showPane(false);
    return false;
  }
  const at = was != null ? clipAtMs(was, s) : null;
  const clip = at && at.clip.file ? at.clip : clips[0];
  const sec = at && at.clip.file ? at.sec : clip.in_ms / 1000;
  _curId = null;   // the file is set again: a replaced file of the same clip loads
  _loadClip(clip, sec, false);
  return true;
}

/* The moment the playhead is at, in absolute ms, or null: the player's
   time in its clip, or the moment it was put at where no video shows. */
function playheadMs() {
  if (_parkedMs != null) return _parkedMs;
  const video = $("#video");
  const clip = currentClip();
  const sp = clip && clipSpan(clip);
  if (!sp || !video || !video.src) return null;
  const sec = _pending ? _pending.sec : (video.currentTime || 0);
  return sp.fileStartMs + sec * 1000;
}

/* The span the Timeline lays out, { startMs, endMs }, or null. A recording
   runs from its first event to its last. A session without events (a video
   or blank project, C16) runs on its videos: from the first one's start to
   the last one's end, once their lengths are known. */
function timelineSpan() {
  const s = State.getSession();
  if (!s) return null;
  const evs = s.events || [];
  if (evs.length) {
    const a = Date.parse(evs[0].timestamp), b = Date.parse(evs[evs.length - 1].timestamp);
    return isFinite(a) && isFinite(b) ? { startMs: a, endMs: b } : null;
  }
  const spans = chainOf(s).map((c) => clipSpan(c, s)).filter(Boolean);
  if (!spans.length) return null;
  const start = Math.min(...spans.map((x) => x.startMs));
  let end = -Infinity;
  for (const x of spans) end = Math.max(end, x.endMs != null ? x.endMs : -Infinity);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { startMs: start, endMs: end } : null;
}

/* Read the length of the video in the player, and do the seek that waited
   for it to load. A video whose file holds no length (a recorded .webm
   reports Infinity) is measured by one seek far past its end, then put
   where it was asked to be. Returns true when a known length changed. */
function noteVideoLength(video) {
  const clip = currentClip();
  if (!clip || !video || !video.src || !_sameFile(video, clip.file)) return false;
  if (!isFinite(video.duration)) {
    if (_measuringSrc !== video.src && video.readyState >= 1) { _measuringSrc = video.src; video.currentTime = 1e101; }
    return false;
  }
  const measured = _measuringSrc === video.src;
  if (measured) _measuringSrc = null;
  if (_pending || measured) {
    const p = _pending;
    _pending = null;
    video.currentTime = p ? p.sec : clip.in_ms / 1000;
    if (p && p.play) video.play().catch(() => {});
  }
  const ms = Math.round(video.duration * 1000);
  if (!(ms > 0) || _videoLength.get(clip.file) === ms) return false;
  _videoLength.set(clip.file, ms);
  return true;
}

/* While the player plays: a trimmed part is never shown, and at a video's
   end the next one plays on when it starts there; else it stops there. */
function _keepInClip() {
  const video = $("#video");
  const clip = currentClip();
  if (!video || !clip || _pending || _measuringSrc || !isFinite(video.duration)) return;
  if (!video.paused) _playingAtEnd = video.duration - video.currentTime < 0.75;
  const t = video.currentTime * 1000;
  if (t < clip.in_ms - 50) { video.currentTime = clip.in_ms / 1000; return; }
  const out = clip.out_ms;
  if (out != null && t >= out) _atEnd(clip, !video.paused);
}
function _atEnd(clip, playing) {
  const video = $("#video");
  const next = _followerOf(clip);
  if (next && next.file && playing) { _loadClip(next, next.in_ms / 1000, true); return; }
  video.pause();
  if (clip.out_ms != null) video.currentTime = clip.out_ms / 1000;
}

function positionPlayhead() {
  const ph = $("#tl-playhead");
  const sp = timelineSpan();
  if (!ph || !sp) return;
  const first = sp.startMs;
  const span = Math.max(1, sp.endMs - first);
  const at = playheadMs();
  if (at == null) { ph.style.display = "none"; return; }
  ph.style.left = (((at - first) / span) * 100) + "%";
  ph.style.display = "";
  const video = $("#video");
  if (video && video.src && _parkedMs == null) setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

/* ============ Video helpers ======================================= */

/* The wall clock at the player's t=0, as an ISO string, or null: the file
   0 of the video in the player (else of the first video). Times of the
   player's own file only; every other time is a moment on the clock. */
function videoStartTs() {
  const clip = currentClip() || chainOf().find((c) => c.file) || null;
  const sp = clip && clipSpan(clip);
  return sp ? new Date(sp.fileStartMs).toISOString() : null;
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
  const at = clipAtMs(Date.parse(ts));
  if (at && at.clip.file && _loadClip(at.clip, at.sec, true)) return;
  // No video shows this moment: the Flow timeline playhead goes there and
  // scrolls into view, so a "jump" / row click still does something visible.
  const video = $("#video");
  if (video && !video.paused) video.pause();
  movePlayheadToTimestamp(ts);
}

/* Position the timeline playhead at a wall-clock timestamp and scroll
   the timeline so it is on screen. Gives a moment no video shows a working
   seek: the playhead stays there (playheadMs) until a video plays. */
function movePlayheadToTimestamp(ts) {
  const sp = timelineSpan();
  const ph = $("#tl-playhead");
  if (!sp || !ph) return;
  const t = new Date(ts).getTime();
  if (Number.isFinite(t)) _parkedMs = t;
  const first = sp.startMs;
  const span = Math.max(1, sp.endMs - first);
  const frac = Math.min(1, Math.max(0, (t - first) / span));
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

/* The part of the clock the videos cover, { startMs, endMs }, or null: from
   the first video's start to the last one's end (the playback bar's
   range). */
function chainRange() {
  const spans = chainOf().filter((c) => c.file).map((c) => clipSpan(c)).filter(Boolean);
  if (!spans.length) return null;
  const startMs = Math.min(...spans.map((x) => x.startMs));
  const ends = spans.map((x) => (x.endMs != null ? x.endMs : x.startMs));
  const endMs = Math.max(...ends);
  return endMs > startMs ? { startMs, endMs } : null;
}

/* Put the player at the moment `ms` of the clock (the playback bar, its
   skips and the arrow keys), playing on if it was. A moment no video shows
   goes to the nearest video: the next one's start, else the last one's
   end. */
function seekClock(ms, play) {
  const video = $("#video");
  const playing = play === undefined ? !!(video && !video.paused) : !!play;
  const at = clipAtMs(ms);
  if (at && at.clip.file) { _loadClip(at.clip, at.sec, playing); return; }
  const spans = chainOf().filter((c) => c.file).map((c) => clipSpan(c)).filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs);
  if (!spans.length) return;
  const next = spans.find((x) => x.startMs > ms);
  if (next) { _loadClip(next.clip, next.clip.in_ms / 1000, playing); return; }
  const last = spans[spans.length - 1];
  const out = last.endMs != null ? (last.endMs - last.fileStartMs) / 1000 - 0.05 : last.clip.in_ms / 1000;
  _loadClip(last.clip, Math.max(last.clip.in_ms / 1000, out), false);
}

/* Steps/Phases detail panel -> Flow view. Switches the active level
   and seeks the video to the start of the step (if a recording is
   linked) or scrolls the Flow timeline playhead there. */
function jumpToStepInFlow(step) {
  if (!step || !step.time_range || !step.time_range.start) return;
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  seekToTimestamp(step.time_range.start);
}

/* The moment `seconds` into the player's file is, as an ISO string, or
   null. */
function videoTimeToSessionTs(seconds) {
  const obsStartTs = videoStartTs();
  if (!obsStartTs) return null;
  return new Date(new Date(obsStartTs).getTime() + seconds * 1000).toISOString();
}

/* The length of a video file in ms (an off-screen copy; a file that holds
   none is sought past its end), or null when it cannot be read. */
function probeLength(file) {
  const known = _videoLength.get(file);
  if (known > 0) return Promise.resolve(known);
  return new Promise((resolve) => {
    const m = document.createElement("video");
    m.muted = true;
    m.preload = "metadata";
    let over = false;
    const done = (secs) => {
      if (over) return;
      over = true;
      m.removeAttribute("src");
      try { m.load(); } catch (_) { /* nothing loaded */ }
      const ms = Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null;
      if (ms) _videoLength.set(file, ms);
      resolve(ms);
    };
    m.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(m.duration)) { done(m.duration); return; }
      m.addEventListener("durationchange", () => { if (Number.isFinite(m.duration)) done(m.duration); });
      m.currentTime = 1e101;
    }, { once: true });
    m.addEventListener("error", () => done(NaN), { once: true });
    setTimeout(() => done(NaN), 20000);
    m.src = fileUrl(file);
  });
}

/* A clip's name: its file's name. */
function clipName(clip) {
  const p = String((clip && (clip.path || clip.file)) || "");
  return p.split(/[\\/]/).filter(Boolean).pop() || "the video";
}

/* ============ Editing the chain ====================================== */

/* What a ripple does to a marker it moves: the change waits for Apply
   marker changes like a marker moved by hand (2.0.3 keepApplied; a project
   made from videos applies it itself). */
function _onMarker(now) {
  const analyzed = MarkerEdits.lastAnalysisMs(State.getSession());
  const keep = require("./flow-view-markers.js").keepApplied;   // lazy: it requires this module
  return (e) => { keep(e, analyzed); e.ts = now; };
}

/* One edit of the chain, saved as one undoable edit: `edit(anno, ripple,
   opts)` changes the annotations (returns { why } to refuse: nothing is
   then saved). The transcripts placed without a video are tied to theirs
   first (TM.bindsBeforeChainEdit; their place stays the same, so it is not
   an edit to undo). Resolves true when saved. */
async function _commitChain(label, edit, okText) {
  const session = State.getSession();
  if (!session) return false;
  const ripple = isBackToBack(session);
  const anno = session.annotations || (session.annotations = {});
  const before = JSON.stringify(anno);
  const restore = () => {
    for (const k of Object.keys(anno)) delete anno[k];
    Object.assign(anno, JSON.parse(before));
  };
  const now = new Date().toISOString();
  const L = _lengths(session);
  let r;
  try { r = edit(anno, ripple, { onMarker: _onMarker(now), at: now, lengthOf: L }); }
  catch (e) { r = { why: (e && e.message) || String(e) }; }
  if (r && r.why) { restore(); toast(r.why, "error"); return false; }
  // A length measured here is kept with its video, so the chain can be edited
  // before that video is played again.
  for (const c of Array.isArray(anno.external_videos) ? anno.external_videos : []) {
    if (c && c.length_ms == null) { const len = L(c); if (len) c.length_ms = Math.round(len); }
  }
  const binds = TM.bindsBeforeChainEdit(Object.assign({}, session, { annotations: JSON.parse(before) }), L, ripple);
  if (binds.length) {
    let b;
    try { b = await Ipc.saveTranscriptSync({ sessionFolder: session.sessionFolder, binds }); }
    catch (e) { b = { ok: false, error: (e && e.message) || String(e) }; }
    if (!b || !b.ok) {
      restore();
      toast("The videos were not changed: the transcripts could not be tied to their videos (" +
        ((b && b.error) || "no reason was given") + ").", "error");
      return false;
    }
  }
  try { await saveAnnotationsWithUndo(anno, label); }
  catch (_) { restore(); return false; }   // already shown to the analyst (session.js)
  await loadSessionIntoView(session.sessionFolder);
  if (okText) toast(okText, "success");
  return true;
}

/* Copy each of `paths` into the folder's video/ (main.js copyVideoIn) and
   read its length (`needLength`: a video whose length cannot be read is
   refused, as one put back to back must be). Resolves [{ path, stored,
   lengthMs, copied, copyError }], or null after saying why one could not be
   added. */
async function _bringIn(session, paths, needLength) {
  const out = [];
  for (const p of paths) {
    const lengthMs = await probeLength(p);
    if (!lengthMs && needLength) {
      toast("The length of " + clipName({ path: p }) + " could not be read, so it was not added.", "error");
      return null;
    }
    let r;
    try { r = await Ipc.copyVideoIn({ sessionFolder: session.sessionFolder, videoPath: p }); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || !r.ok) { toast("The video was not added: " + ((r && r.error) || "no reason was given"), "error"); return null; }
    out.push({ path: p, stored: r.stored, lengthMs, copied: !!r.copied, copyError: r.copyError || null });
  }
  return out;
}

function _copyNote(items) {
  const failed = items.filter((x) => x.copyError);
  if (failed.length) {
    toast("The video is added, but it could not be copied into the project folder (" + failed[0].copyError +
      "), so a copy of the folder will not carry it.", "error");
    return null;
  }
  return items.some((x) => x.copied) ? " It is copied into the project folder." : "";
}

/* Add video: the analyst picks one or more files. A project made from
   videos puts them after the last video, back to back, in the order
   picked. A recording places the first with two clicks (pause the video at
   a moment you recognize, Mark frame, then click the same moment on the
   timeline) and the others after it, back to back; nothing is written
   until the second click. The one video of a recording whose file is not
   found takes the file chosen with its stored sync (a re-link). */
async function attachVideo() {
  const session = State.getSession();
  if (!session) return;
  if (!session.manifest || !session.manifest.started_at) {
    toast("This project has no start time, so a video cannot be placed on it.", "error");
    return;
  }
  const r = await Ipc.attachExternalVideo({ sessionFolder: session.sessionFolder });
  if (!r || !r.path || State.getSession() !== session) return;
  // Several files go in the order of their names ("part 2" before "part 10"),
  // whatever order the file dialog gives them in.
  const paths = (Array.isArray(r.paths) && r.paths.length ? r.paths.slice() : [r.path])
    .sort((a, b) => clipName({ path: a }).localeCompare(clipName({ path: b }), undefined, { numeric: true, sensitivity: "base" }));
  const added = addedClips(session);
  // A re-link (V2 item 5): the one video this project has is not found (a
  // moved or received folder); the file chosen takes its place.
  if (added.length === 1 && !added[0].file && paths.length === 1) {
    await replaceVideo(added[0].id, paths[0]);
    return;
  }
  if (isBackToBack(session)) {
    const clips = VideoChain.clipsOf(session.annotations);
    if (VideoChain.appendOffset(clips, _lengths(session)) == null) {
      toast("The length of a video of this project is not known (its file is not found), so another cannot be put after it. Find its file first.", "error");
      return;
    }
    const items = await _bringIn(session, paths, true);
    if (!items || State.getSession() !== session) return;
    const note = _copyNote(items);
    const many = items.length > 1;
    await _commitChain(many ? "Add " + items.length + " videos" : (clips.length ? "Add a video" : "Attach the video"), (anno, ripple, opts) => {
      for (const it of items) {
        const at = VideoChain.appendOffset(VideoChain.clipsOf(anno), opts.lengthOf);
        VideoChain.applyAppend(anno, { path: it.stored, length_ms: it.lengthMs, attached_at: new Date().toISOString() }, at);
      }
    }, note == null ? null : (many ? items.length + " videos added, one after the other." : clips.length ? "Video added after the last one." : "Video attached.") +
      (note || "") + " Ctrl+Z takes " + (many ? "them" : "it") + " back.");
    return;
  }
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  cancelVideoSync();
  require("./flow-view-transcript.js").cancelTranscriptSync();   // one sync at a time (lazy: it requires this module)
  _previewFile(paths[0]);
  startVideoSync({ pending: { kind: "add", paths } });
}

/* The player shows `file` (an add or a replace waiting for its sync). */
function _previewFile(file) {
  const video = $("#video");
  if (!video) return;
  _curId = null;
  _pending = null;
  _parkedMs = null;
  video.src = fileUrl(file);
  _showPane(true);
}

/* Replace video: clip `id` takes another file (`path`, else one the analyst
   picks). Back to back, it keeps its place and its trim (its end within the
   new file) and what follows moves by the change of length (a mark in a
   part the new file lacks refuses it). In a recording the new file is
   synced with the two clicks, unless the clip's own file is not found (a
   re-link keeps its sync). The copy it replaces leaves video/; Ctrl+Z
   brings it back. */
async function replaceVideo(id, path) {
  const session = State.getSession();
  if (!session) return;
  const clip = addedClips(session).find((c) => c.id === id);
  if (!clip) return;
  let file = path;
  if (!file) {
    const r = await Ipc.attachExternalVideo({ sessionFolder: session.sessionFolder, single: true });
    if (!r || !r.path || State.getSession() !== session) return;
    file = r.path;
  }
  const relink = !clip.file;
  if (relink || isBackToBack(session)) {
    const items = await _bringIn(session, [file], isBackToBack(session));
    if (!items || State.getSession() !== session) return;
    const note = _copyNote(items);
    const it = items[0];
    await _commitChain(relink ? "Find the video" : "Replace the video", (anno, ripple, opts) => {
      if (!ripple && !it.lengthMs) {
        // A recording's video whose length cannot be read keeps its place and loses its trim.
        const clips = VideoChain.clipsOf(anno);
        const c = clips.find((x) => x.id === id);
        if (!c) return { why: "That video is not in this project." };
        Object.assign(c, { path: it.stored, out_ms: null, length_ms: null, attached_at: opts.at });
        VideoChain.writeClips(anno, clips);
        return null;
      }
      return VideoChain.applyReplace(anno, opts.lengthOf, id, it.stored, it.lengthMs, _originMs(session), ripple, opts);
    },
    note == null ? null : (relink ? "Video found: it keeps its place" + (isBackToBack(session) ? "." : " and its sync (Sync video changes it).")
      : "Video replaced.") + (note || "") + " Ctrl+Z brings the previous one back.");
    return;
  }
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  cancelVideoSync();
  require("./flow-view-transcript.js").cancelTranscriptSync();
  _previewFile(file);
  startVideoSync({ pending: { kind: "replace", id, paths: [file] } });
}

/* Trim video: one side of clip `id` to `sourceMs` (the time in its file).
   Back to back, the part cut away must hold no mark, and what follows
   moves up (or back, when it grows); in a recording only the video
   changes. */
async function trimVideo(id, edge, sourceMs) {
  const session = State.getSession();
  if (!session) return false;
  const plan = VideoChain.planTrim(VideoChain.clipsOf(session.annotations), _lengths(session), id, edge, sourceMs);
  if (plan.why) { toast(plan.why, "error"); return false; }
  const same = edge === "start" ? plan.inMs === plan.clip.in_ms
    : (plan.outMs == null ? null : plan.outMs) === (plan.clip.out_ms == null ? null : plan.clip.out_ms);
  if (same) return false;
  const grew = plan.deltaMs > 0;
  return _commitChain(edge === "start" ? "Trim the video's start" : "Trim the video's end",
    (anno, ripple, opts) => VideoChain.applyTrim(anno, plan, _originMs(session), ripple, opts),
    (grew ? "Video lengthened" : "Video trimmed") + (isBackToBack(session) && plan.deltaMs ? ": what follows moved with it" : "") +
      ". Ctrl+Z takes it back.");
}

/* Sync video for clip `id` (a recording): the clip is put in the player at
   its start, then the two clicks. */
function syncVideo(id) {
  const clip = chainOf().find((c) => c.id === id) || currentClip();
  if (!clip || !clip.file) { toast("No video is linked to this project.", "error"); return; }
  if (_curId !== clip.id) _loadClip(clip, clip.in_ms / 1000, false);
  startVideoSync({ id: clip.id });
}

/* (Watch a step plays it in the step panel's own video now, beside the steps:
   views/step-panel.js, V2 item 4.) */

/* H4: interactive video re-sync. The analyst clicks a recognizable
   moment in the video, then the matching point on the timeline; the
   wall-clock gap becomes the video's offset_ms. The instruction card is
   non-blocking so the video and timeline stay clickable underneath it. Add
   video and Replace in a recording run the same two clicks on the file just
   chosen (opts.pending): nothing is saved until the second click, and
   Cancel leaves the project as it was. */
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
  const pending = _videoSync && _videoSync.pending;
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
  // An add or a replace that did not finish: the player goes back to the project's videos.
  if (pending) loadPlayer();
}

/* opts.pending: { kind: "add" | "replace", paths, id } the file an add or a
   replace placed in the player, saved with the offset the two clicks give;
   opts.id: the clip synced (the one in the player by default). */
function startVideoSync(opts) {
  const session = State.getSession();
  const video = $("#video");
  const pending = opts && opts.pending ? opts.pending : null;
  const id = pending ? null : ((opts && opts.id) || _curId);
  const clip = id ? chainOf().find((c) => c.id === id) : null;
  if (!session || (!pending && !(clip && clip.file)) || !video || !video.src) {
    toast("No video is linked to this project.", "error");
    return;
  }
  if (!session.manifest || !session.manifest.started_at) {
    toast("This project has no start time, so the video cannot be synced.", "error");
    return;
  }
  if (!pending) cancelVideoSync();
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
    // offset_ms is added to manifest.started_at to get the wall clock at
    // the file's t=0, so the offset is the clicked wall clock, less the
    // video time at that moment, less the session's start.
    const offsetMs = Math.round(eventMs - _originMs(session) - (_videoSync.videoTime || 0) * 1000);
    _finishSync(offsetMs);
  }
  _videoSync = { videoTime: null, step: 1, onTimelineClick, onKey, pending, id };
  const tl = document.getElementById("timeline");
  if (tl) tl.addEventListener("click", onTimelineClick, true);
  document.addEventListener("keydown", onKey, true);
  _videoSyncCard("Step 1 of 2: pause the video at a recognizable moment, then click Mark frame.",
    "Mark frame", markFrame);
}

/* The second click: save the offset (an add or a replace with its file,
   copied into the folder's video/ first, which takes a moment for a long
   video). One undoable edit; a replace takes the copy it replaces out of
   video/ (Undo brings it back, analyst-files.js). */
async function _finishSync(offsetMs) {
  const sync = _videoSync;
  const session = State.getSession();
  const p = sync ? sync.pending : null;
  if (sync) sync.pending = null;   // the sync is over: the player keeps the file until the reload
  cancelVideoSync();
  if (!sync || !session) return;
  // A recording's own video (OBS) synced becomes a video of the project,
  // placed by the sync (it stays where it is; one outside the folder is
  // copied in, as an added one).
  const own = !p && sync.id === "obs" ? chainOf(session).find((c) => c.obs) : null;
  if (own) {
    const items = await _bringIn(session, [own.file], false);
    if (!items || State.getSession() !== session) return;
    await _commitChain("Sync the video", (anno) => {
      VideoChain.applyAppend(anno, { path: items[0].stored, length_ms: items[0].lengthMs, attached_at: new Date().toISOString() }, offsetMs);
      return null;
    }, "Video synced.");
    return;
  }
  if (!p) {
    await _commitChain("Sync the video", (anno) => {
      const clips = VideoChain.clipsOf(anno);
      const c = clips.find((x) => x.id === sync.id);
      if (!c) return { why: "That video is not in this project." };
      c.offset_ms = offsetMs;
      VideoChain.writeClips(anno, clips);
      return null;
    }, "Video synced.");
    return;
  }
  toast(p.kind === "add" ? "Adding the video..." : "Replacing the video...", "info");
  // The videos after the first go back to back after it: their lengths are needed.
  const items = await _bringIn(session, p.paths, p.paths.length > 1);
  if (!items || State.getSession() !== session) { loadPlayer(); return; }
  const note = _copyNote(items);
  const first = !addedClips(session).length;
  const saved = await _commitChain(p.kind === "replace" ? "Replace the video" : items.length > 1 ? "Add " + items.length + " videos"
    : first ? "Attach the video" : "Add a video", (anno) => {
    let at = offsetMs;
    if (p.kind === "replace") {
      const clips = VideoChain.clipsOf(anno);
      const c = clips.find((x) => x.id === p.id);
      if (!c) return { why: "That video is not in this project." };
      Object.assign(c, { path: items[0].stored, offset_ms: offsetMs, in_ms: 0, out_ms: null, length_ms: items[0].lengthMs,
        attached_at: new Date().toISOString() });
      VideoChain.writeClips(anno, clips);
      return null;
    }
    for (const it of items) {
      VideoChain.applyAppend(anno, { path: it.stored, length_ms: it.lengthMs, attached_at: new Date().toISOString() }, at);
      at += it.lengthMs || 0;
    }
    return null;
  }, note == null ? null : (p.kind === "replace" ? "Video replaced and synced." : items.length > 1
    ? items.length + " videos attached: the first synced, the others after it." : "Video attached and synced.") +
    (note || "") + (p.kind === "replace" ? " Ctrl+Z brings the previous one back." : ""));
  if (!saved) loadPlayer();
}

/* Whether the project plays a video the analyst attached (its entry is in
   annotations.external_videos and its file was found): Remove video applies
   to the one in the player. */
function attachedVideoShown(sess) {
  const s = _sess(sess);
  return !!(s && s.recordingAvailable && addedClips(s).some((c) => c.file));
}

/* Remove video (lane CC), the inverse of Add video: clip `id` (the one in
   the player by default) leaves the chain, and with it the copy the app
   made in the folder's video/ (moved out for an Undo, analyst-files.js); a
   video kept anywhere else stays where it is. Back to back, what was marked
   on it goes with it and what follows moves up by its length (the question
   says what goes). One undoable edit: Ctrl+Z brings it all back. Asks
   first. */
async function removeVideo(id) {
  const session = State.getSession();
  if (!session) return;
  const clips = addedClips(session);
  const clip = clips.find((c) => c.id === (id || _curId)) || (clips.length === 1 ? clips[0] : null);
  if (!clip) return;
  const copy = isVideoCopy(clip.path);
  const ripple = isBackToBack(session);
  const marks = ripple ? VideoChain.marksOnClip(session.annotations, _lengths(session), clip.id, _originMs(session)) : null;
  const n = marks ? marks.steps.length + marks.markers.length + marks.notes.length + marks.shots.length : 0;
  const what = marks ? [
    marks.steps.length ? marks.steps.length + " step" + (marks.steps.length === 1 ? "" : "s") : "",
    marks.markers.length ? marks.markers.length + " transaction mark" + (marks.markers.length === 1 ? "" : "s") : "",
    marks.notes.length ? marks.notes.length + " note" + (marks.notes.length === 1 ? "" : "s") : "",
    marks.shots.length ? marks.shots.length + " screenshot" + (marks.shots.length === 1 ? "" : "s") : "",
  ].filter(Boolean).join(", ") : "";
  const ok = await confirmModal({
    title: clips.length > 1 ? "Remove " + clipName(clip) + "?" : "Remove the video?",
    message: clips.length > 1
      ? (ripple ? "The videos after it move up by its length, with what is marked on them." : "The other videos stay where they are.")
      : "The project plays no video after this: the Timeline and the step panel show none.",
    detail: (n ? "What is marked on it goes with it: " + what + ". " : "") +
      (copy ? "Its copy in the project's video folder is deleted." : "The video file stays where it is.") + " Ctrl+Z brings it back.",
    okLabel: "Remove video",
    danger: true,
  });
  if (!ok || State.getSession() !== session) return;
  cancelVideoSync();
  await _commitChain("Remove the video", (anno, rip, opts) => VideoChain.applyRemove(anno, opts.lengthOf, clip.id, _originMs(session), rip, opts),
    "Video removed." + (copy ? " Its copy left the project folder." : "") + " Ctrl+Z brings it back.");
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

// Self-wire the require()-time listeners: the re-sync and remove buttons,
// and the player's own events (a trimmed part is never shown, playing on
// into the next video; a moment put where no video shows lasts until a
// video plays).
if ($("#btn-sync-video")) {
  $("#btn-sync-video").addEventListener("click", () => syncVideo(_curId));
}
if (document.getElementById("btn-video-remove")) {
  document.getElementById("btn-video-remove").addEventListener("click", () => removeVideo());
}
(function wirePlayer() {
  const video = document.getElementById("video");
  if (!video) return;
  video.addEventListener("timeupdate", _keepInClip);
  video.addEventListener("play", () => { _parkedMs = null; });
  video.addEventListener("ended", () => {
    const c = currentClip();
    if (!c || !_playingAtEnd || _measuringSrc || _pending) return;
    _playingAtEnd = false;
    _atEnd(c, true);
  });
})();

module.exports = {
  initVideo, timelineSpan, noteVideoLength,
  setVideoOverlay, positionPlayhead,
  videoStartTs, formatPlayback, videoTimeToSessionTs,
  seekToTimestamp, movePlayheadToTimestamp, jumpToStepInFlow,
  startVideoSync, cancelVideoSync, attachVideo, removeVideo, attachedVideoShown,
  // C23 (2.0.6): the chain.
  chainOf, addedClips, lengthOf, clipSpan, clipAtMs, currentClip, playheadMs, loadPlayer, isBackToBack, chainRange, seekClock,
  fileUrl, probeLength, clipName, replaceVideo, trimVideo, syncVideo,
};
