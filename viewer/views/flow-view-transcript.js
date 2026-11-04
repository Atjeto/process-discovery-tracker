/*
 * flow-view-transcript.js: the meeting transcript on the Timeline level and
 * on the Overview's recording line (contract C8, plan section 7). Nothing
 * here reads meaning into the text; transcript-model.js holds the time rule
 * and every computation.
 *   1. The Transcript lane (a plugin flow-view-timeline.js stacks, which
 *      names it at the left with the other lanes), present only while a
 *      transcript is attached. Synced: one row of sentence blocks at their
 *      wall times (hover: time, speaker, text; click: seek). Not synced: the
 *      label says so. The label carries Sync, Replace and Remove in both
 *      states.
 *   2. Sync, the H4 video re-sync pattern (a non-blocking card, Cancel,
 *      Escape cancels): step 1 picks a sentence from a searchable list, step
 *      2 is a click on the timeline where it was said. The offset goes to
 *      transcript.json; running Sync again is the correction.
 *   3. Attach transcript (#btn-attach-transcript, Replace once one is
 *      attached) and Remove transcript (#btn-remove-transcript), its inverse,
 *      on the Overview's recording line (overview-view.js renders them), and
 *      Replace and Remove on the lane label. The clicks are delegated, so the
 *      buttons may be rendered again at any time.
 * Cross-surface glue (loadSessionIntoView, renderTimeline) is injected by
 * flow-view.js through initTranscript(), so this module never requires it.
 */

"use strict";

const State = require("../state.js");
const Ipc = require("../ipc.js");
const Session = require("../session.js");
const TM = require("../transcript-model.js");
const { $, escapeAttr, toast, recordingStartMs, clock } = require("../dom.js");
const { chooseModal } = require("../modals.js");
const Video = require("./flow-view-video.js");

let loadSessionIntoView = async () => {};
let renderTimeline = () => {};

/* The lane: a label row, then (synced) a row of sentence blocks under it, so
   the label never covers a block. */
const LABEL_ROW_H = 20;
const BLOCK_H = 10;
const LANE_H_SYNCED = LABEL_ROW_H + BLOCK_H + 4;

/* A block's tooltip: when it was said (the time since the recording started,
   the one clock), who said it and what. */
function _sentenceTitle(s, originMs) {
  return TM.sentenceClock(s, originMs) + (s.speaker ? " · " + s.speaker : "") + "\n" + s.text;
}
const sentenceRowHtml = TM.sentenceRowHtml;

/* ---- The lane ------------------------------------------------------------ */

/* Keep the lane label at the left edge of the visible timeline, however far
   it is scrolled, so Sync stays one click away. */
function _placeLabel() {
  const scroll = document.getElementById("timeline-scroll");
  if (!scroll) return;
  for (const label of document.querySelectorAll("#timeline .tl-tr-label")) label.style.left = (scroll.scrollLeft + 6) + "px";
}

/* C23 (2.0.6): what a transcript's label calls it when the project has
   several: "Transcript 2", and the video it belongs to. */
function _partName(part, parts) {
  if (parts.length < 2) return "";
  const clip = part.videoId ? Video.chainOf().find((c) => c.id === part.videoId) : null;
  return "Transcript " + part.number + (clip ? " · " + Video.clipName(clip) : "");
}

/* The lane plugin for renderTimeline. env = { first, last, span, on }: the
   session's first and last event times, their span, and the lane toggle.
   C23: one row per transcript (a label row, then its sentences when it is
   synced), each with its own Sync, Replace and Remove. */
function transcriptLane(env) {
  const placed = TM.forSession(State.getSession());
  const parts = placed ? placed.parts : [];
  const rowH = (part) => (part.synced ? LANE_H_SYNCED : LABEL_ROW_H);
  const height = !parts.length || !env.on ? 0 : parts.reduce((h, part) => h + rowH(part), 0);
  return {
    key: "transcript",
    height,
    gapBefore: 4,
    render(host, ctx) {
      let top = ctx.slot.top;
      const rail = document.createElement("div");
      rail.className = "tl-tr-rail";
      rail.style.top = top + "px";
      rail.style.height = ctx.slot.height + "px";
      host.appendChild(rail);
      for (const part of parts) {
        for (const s of part.synced ? part.sentences : []) {
          // Only what was said while the recording ran is drawn.
          if (!Number.isFinite(s.startMs) || s.endMs < env.first || s.startMs > env.last) continue;
          const a = Math.max(env.first, s.startMs), b = Math.min(env.last, s.endMs);
          const block = document.createElement("div");
          block.className = "tl-tr-block";
          block.dataset.seg = s.id;
          block.dataset.file = part.file;
          block.style.left = ((a - env.first) / env.span) * 100 + "%";
          block.style.width = Math.max(0.15, ((b - a) / env.span) * 100) + "%";
          block.style.top = (top + LABEL_ROW_H) + "px";
          block.style.height = BLOCK_H + "px";
          block.title = _sentenceTitle(s, recordingStartMs(State.getSession()));
          block.addEventListener("click", (e) => {
            e.stopPropagation();
            Video.seekToTimestamp(new Date(s.startMs).toISOString());
          });
          host.appendChild(block);
        }
        const label = document.createElement("div");
        label.className = "tl-tr-label";
        label.dataset.file = part.file;
        label.style.top = (top + 2) + "px";   // a 16px row inside the 20px label row
        // The lane's name, Transcript, is at the left with the other lanes'
        // (flow-view-timeline.js renderLaneNames).
        const name = _partName(part, parts);
        label.innerHTML = (name ? '<span class="tl-tr-name">' + escapeAttr(name) + "</span>" : "") +
          (part.synced ? "" : '<span class="tl-tr-state">Not synced</span>') +
          '<button type="button" class="link-btn tl-tr-sync" title="Place the transcript on the timeline: ' +
          'pick a sentence, then click the moment on the timeline where it was said.">Sync...</button>' +
          '<button type="button" class="link-btn tl-tr-replace" title="' + escapeAttr(TM.REPLACE_TITLE) + '">Replace...</button>' +
          '<button type="button" class="link-btn tl-tr-remove" title="' + escapeAttr(TM.REMOVE_TITLE) + '">Remove</button>';
        label.addEventListener("click", (e) => e.stopPropagation());
        label.querySelector(".tl-tr-sync").addEventListener("click", (e) => startTranscriptSync(e, part.file));
        label.querySelector(".tl-tr-replace").addEventListener("click", () => attachTranscript({ file: part.file }));
        label.querySelector(".tl-tr-remove").addEventListener("click", () => removeTranscript(part.file));
        host.appendChild(label);
        top += rowH(part);
      }
      _placeLabel();
    },
  };
}

/* ---- Sync ---------------------------------------------------------------- */

let _sync = null;

function _card() {
  let card = document.getElementById("transcript-sync-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "transcript-sync-card";
    card.className = "video-sync-card tr-sync-card";
    document.body.appendChild(card);
  }
  return card;
}

function cancelTranscriptSync() {
  if (_sync) {
    const tl = document.getElementById("timeline");
    if (tl) {
      tl.removeEventListener("click", _sync.onTimelineClick, true);
      tl.classList.remove("video-sync-target");
    }
    document.removeEventListener("keydown", _sync.onKey, true);
  }
  _sync = null;
  const card = document.getElementById("transcript-sync-card");
  if (card) card.remove();
}

/* `file`: the transcript synced (C23; the first one by default). */
function startTranscriptSync(e, file) {
  if (e && e.stopPropagation) e.stopPropagation();
  const sess = State.getSession();
  const parts = TM.transcriptsOf(sess);
  const part = parts.find((t) => t.file === file) || parts[0];
  if (!sess || !part) return;
  if (!sess.manifest || !Number.isFinite(Date.parse(sess.manifest.started_at))) {
    toast("This project has no start time, so the transcript cannot be placed.", "error");
    return;
  }
  const sentences = TM.segmentsOf(part.transcript);
  if (!sentences.length) { toast("The transcript has no sentences to place.", "error"); return; }
  Video.cancelVideoSync();   // one sync at a time
  cancelTranscriptSync();
  const onKey = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancelTranscriptSync(); }
  };
  // Step 2's click. The timeline's own click (seek) is suppressed for it;
  // the lane's Sync action restarts the flow instead.
  const onTimelineClick = (ev) => {
    if (!_sync || _sync.step !== 2) return;
    if (ev.target && ev.target.closest && ev.target.closest(".tl-tr-label")) return;
    ev.preventDefault();
    ev.stopPropagation();
    // The timeline's span: a recording's events, else the videos (C16, C23).
    const sp = Video.timelineSpan();
    const tl = document.getElementById("timeline");
    const at = (tl && sp) ? require("./flow-view-timeline.js").timeAtClientX(ev.clientX,
      tl.getBoundingClientRect(), sp.startMs, sp.endMs) : null;
    const offsetMs = at ? TM.offsetForSync(Date.parse(at), sess.manifest.started_at, _sync.seg.startS) : null;
    if (offsetMs === null) {
      cancelTranscriptSync();
      toast("Could not read the timeline position.", "error");
      return;
    }
    _applySync(sess, part, offsetMs);
  };
  _sync = { step: 1, seg: null, onKey, onTimelineClick };
  document.addEventListener("keydown", onKey, true);
  const tl = document.getElementById("timeline");
  if (tl) tl.addEventListener("click", onTimelineClick, true);
  _renderPick(sentences);
}

/* Step 1: a search box and a short list of every sentence. A list, not a
   click on the lane: an unsynced or badly placed transcript may lie outside
   the visible range. */
function _renderPick(sentences) {
  const card = _card();
  card.innerHTML = '<div class="tr-sync-body">' +
      '<span class="vs-text">Step 1 of 2: pick a sentence you can place.</span>' +
      '<input type="search" class="tr-sync-search" placeholder="Search the transcript" aria-label="Search the transcript" />' +
      '<ol class="tr-sync-list"></ol>' +
    "</div>" +
    '<button type="button" class="vs-cancel">Cancel</button>';
  const input = card.querySelector(".tr-sync-search");
  const list = card.querySelector(".tr-sync-list");
  const fill = () => {
    const rows = TM.filterSentences(sentences, "", input.value);
    list.innerHTML = rows.length
      ? rows.map((s) => '<li><button type="button" class="tr-sync-pick" data-seg="' + escapeAttr(s.id) + '">' +
          sentenceRowHtml(s) + "</button></li>").join("")
      : '<li class="tr-note">No sentence matches.</li>';
  };
  input.addEventListener("input", fill);
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".tr-sync-pick");
    const seg = b && sentences.find((x) => x.id === b.dataset.seg);
    if (seg) _renderPlace(seg);
  });
  card.querySelector(".vs-cancel").addEventListener("click", cancelTranscriptSync);
  fill();
  input.focus();
}

/* Step 2: the chosen sentence, and the instruction. */
function _renderPlace(seg) {
  if (!_sync) return;
  _sync.step = 2;
  _sync.seg = seg;
  const tl = document.getElementById("timeline");
  if (tl) tl.classList.add("video-sync-target");
  const card = _card();
  card.innerHTML = '<div class="tr-sync-body">' +
      '<span class="vs-text">Step 2 of 2: click the moment on the timeline where it was said.</span>' +
      '<span class="tr-sync-picked">' + sentenceRowHtml(seg) + "</span>" +
    "</div>" +
    '<button type="button" class="vs-cancel">Cancel</button>';
  card.querySelector(".vs-cancel").addEventListener("click", cancelTranscriptSync);
}

/* `absOffsetMs` puts the transcript's 0 on the clock (ms after
   started_at); a transcript of a video stores it from that video's start
   (C23, TM.storedOffsetFor), so it moves with its video. */
async function _applySync(sess, part, absOffsetMs) {
  cancelTranscriptSync();
  const offsetMs = TM.storedOffsetFor(part.transcript, sess.annotations, absOffsetMs);
  let r;
  try { r = await Ipc.saveTranscriptSync({ sessionFolder: sess.sessionFolder, offsetMs, file: part.file }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The transcript sync was not saved: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  // The file now holds this offset and nothing else changed: the loaded
  // session takes it too, and the other surfaces read it when they render.
  if (State.getSession() === sess) part.transcript.offset_ms = offsetMs;
  toast("Transcript synced.", "success");
  renderTimeline();
}

/* ---- Attach, Replace, Remove ------------------------------------------------ */

/* The Lanes menu lists the lane only while a usable transcript is attached.
   (The recording line follows the file itself: overview-view.js.) */
function renderTranscriptMenu() {
  const sess = State.getSession();
  const laneRow = document.getElementById("lane-transcript-row");
  if (laneRow) laneRow.hidden = !TM.transcriptsOf(sess).length;
}

/* C23: the video a transcript attached now belongs to: the one video of the
   chain, or the one the analyst picks among several (null: cancelled); ""
   without a video. */
async function _videoFor(sess, current) {
  const clips = Video.addedClips(sess);
  if (!clips.length) return "";
  if (clips.length === 1) return clips[0].id;
  const origin = recordingStartMs(sess);
  const items = clips.map((c, i) => {
    const sp = Video.clipSpan(c, sess);
    return { value: c.id, label: (i + 1) + ". " + Video.clipName(c) + (sp && Number.isFinite(origin) ? ", from " + clock(Math.max(0, sp.startMs - origin)) : "") };
  });
  return chooseModal({
    title: "Which video is this transcript of?",
    message: "Its sentences are placed from that video's start, and move with it.",
    groups: [{ label: "The videos of this project", items }],
    value: current || clips[0].id,
    okLabel: "Attach",
  });
}

/* Attach transcript (opts.add: one more, C23), or Replace one (opts.file):
   the file is read by transcript_import.py; a transcript of a project with
   videos belongs to one (the one, or the one picked) and is placed from its
   start. */
async function attachTranscript(opts) {
  const o = opts || {};
  const sess = State.getSession();
  if (!sess) return;
  const parts = TM.transcriptsOf(sess);
  const replaced = o.file ? parts.find((t) => t.file === o.file) : (!o.add && parts[0]) || null;
  const videoId = await _videoFor(sess, replaced ? TM.videoIdOf(replaced.transcript) : "");
  if (videoId === null || State.getSession() !== sess) return;
  let r;
  try {
    r = await Ipc.importTranscript({ sessionFolder: sess.sessionFolder, file: replaced ? replaced.file : undefined,
      add: !replaced && parts.length > 0, videoId });
  } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r) return;   // the analyst cancelled the file dialog
  if (!r.ok) {
    toast("The transcript was not attached: " + (r.error || "no reason was given"), "error");
    return;
  }
  await loadSessionIntoView(sess.sessionFolder);
  const now = State.getSession();
  const placed = TM.forSession(now);
  const part = placed && placed.parts.find((x) => x.file === (r.file || "transcript.json"));
  if (!part) return;   // the load already said why it cannot be read
  toast(TM.attachedMessage(part.transcript, part.synced), "success");
}

/* Remove transcript (lane CC): transcript.json and its originals under
   transcript/ leave the folder, parked for an Undo; Ctrl+Z puts them back
   and Ctrl+Y takes them out again (session.js recordFileAct). */
async function _takeOut(folder, file) {
  let r;
  try { r = await Ipc.removeTranscript({ sessionFolder: folder, file }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The transcript was not removed: " + ((r && r.error) || "no reason was given"), "error");
    return null;
  }
  return r;
}
/* `file`: the transcript removed (C23; the first one by default). */
async function removeTranscript(file) {
  const sess = State.getSession();
  if (!sess) return;
  const folder = sess.sessionFolder;
  const which = typeof file === "string" && file ? file : ((TM.transcriptsOf(sess)[0] || {}).file || "transcript.json");
  let parked = await _takeOut(folder, which);
  if (!parked) return;
  await Session.recordFileAct("Remove the transcript", {
    undo: async () => {
      let r;
      try { r = await Ipc.restoreTranscript({ sessionFolder: folder, tag: parked.tag, files: parked.files }); }
      catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      if (!r || !r.ok) {
        toast("The transcript was not put back: " + ((r && r.error) || "no reason was given"), "error");
        return false;
      }
      await loadSessionIntoView(folder);
      return true;
    },
    redo: async () => {
      const again = await _takeOut(folder, which);
      if (!again) return false;
      parked = again;
      await loadSessionIntoView(folder);
      return true;
    },
  });
  await loadSessionIntoView(folder);
  const originals = parked.files.filter((f) => f.startsWith("transcript/")).length;
  toast("Transcript removed" + (originals ? ", with its original file" + (originals > 1 ? "s" : "") : "") +
    ". Ctrl+Z brings " + (originals ? "them" : "it") + " back.", "success");
}

/* After every session load (flow-view.js): a sync in progress belongs to the
   previous state, the menu follows the file, and an unreadable file is said
   once (not again on a reload of the same state). */
let _errorShown = null;
function onSessionLoaded() {
  cancelTranscriptSync();
  renderTranscriptMenu();
  const sess = State.getSession();
  const err = sess && sess.transcriptError;
  const key = err ? sess.sessionFolder + "\n" + err : null;
  if (key && key !== _errorShown) {
    toast("The transcript could not be read: " + err + ". Replace it on the Overview, on the line under the Checklist.", "error");
  }
  _errorShown = key;
}

/* deps = { loadSessionIntoView, renderTimeline }, injected by flow-view.js. */
function initTranscript(deps) {
  loadSessionIntoView = (deps && deps.loadSessionIntoView) || (async () => {});
  renderTimeline = (deps && deps.renderTimeline) || (() => {});
}

// Self-wire the require()-time listeners (the DOM is parsed by then). Attach
// and Remove are delegated by id: the recording line renders them again.
document.addEventListener("click", (e) => {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  if (t.closest("#btn-attach-transcript")) attachTranscript();
  else if (t.closest("#btn-add-transcript")) attachTranscript({ add: true });
  else if (t.closest("#btn-remove-transcript")) removeTranscript();
});
if (document.getElementById("timeline-scroll")) {
  document.getElementById("timeline-scroll").addEventListener("scroll", _placeLabel);
}
// One sync at a time: the video sync (flow-view-video.js) ends this one.
if ($("#btn-sync-video")) $("#btn-sync-video").addEventListener("click", () => cancelTranscriptSync());

module.exports = {
  initTranscript, onSessionLoaded, transcriptLane, startTranscriptSync, cancelTranscriptSync,
};
