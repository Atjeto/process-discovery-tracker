/*
 * flow-view-transcript.js: the meeting transcript on the Flow level and in
 * the session's More menu (contract C8, plan section 7). Nothing here reads
 * meaning into the text; transcript-model.js holds the time rule and every
 * computation.
 *   1. The Transcript lane (a plugin flow-view-timeline.js stacks), present
 *      only while a transcript is attached. Synced: one row of sentence
 *      blocks at their wall times (hover: time, speaker, text; click: seek).
 *      Not synced: the label says so. The label carries Sync in both states.
 *   2. Sync, the H4 video re-sync pattern (a non-blocking card, Cancel,
 *      Escape cancels): step 1 picks a sentence from a searchable list, step
 *      2 is a click on the timeline where it was said. The offset goes to
 *      transcript.json; running Sync again is the correction.
 *   3. The More menu: Attach transcript (Replace once one is attached) and
 *      Remove transcript, its inverse.
 * Cross-surface glue (loadSessionIntoView, renderTimeline) is injected by
 * flow-view.js through initTranscript(), so this module never requires it.
 */

"use strict";

const State = require("../state.js");
const Ipc = require("../ipc.js");
const TM = require("../transcript-model.js");
const { $, escapeAttr, toast } = require("../dom.js");
const Video = require("./flow-view-video.js");

let loadSessionIntoView = async () => {};
let renderTimeline = () => {};

/* The lane: a label row, then (synced) a row of sentence blocks under it, so
   the label never covers a block. */
const LABEL_ROW_H = 20;
const BLOCK_H = 10;
const LANE_H_SYNCED = LABEL_ROW_H + BLOCK_H + 4;

/* The session carries a transcript file (usable or not): the menu then
   offers Replace and Remove. Every other surface needs a usable one. */
function _hasFile(sess) {
  return !!(sess && (sess.transcript || sess.transcriptError));
}

function _sentenceTitle(s) {
  return TM.formatClock(s.startS) + (s.speaker ? " · " + s.speaker : "") + "\n" + s.text;
}
const sentenceRowHtml = TM.sentenceRowHtml;

/* ---- The lane ------------------------------------------------------------ */

/* Keep the lane label at the left edge of the visible timeline, however far
   it is scrolled, so Sync stays one click away. */
function _placeLabel() {
  const scroll = document.getElementById("timeline-scroll");
  const label = document.querySelector("#timeline .tl-tr-label");
  if (scroll && label) label.style.left = (scroll.scrollLeft + 6) + "px";
}

/* The lane plugin for renderTimeline. env = { first, last, span, on }: the
   session's first and last event times, their span, and the lane toggle. */
function transcriptLane(env) {
  const placed = TM.forSession(State.getSession());
  return {
    key: "transcript",
    height: !placed || !env.on ? 0 : placed.synced ? LANE_H_SYNCED : LABEL_ROW_H,
    gapBefore: 4,
    render(host, ctx) {
      const top = ctx.slot.top, h = ctx.slot.height;
      const rail = document.createElement("div");
      rail.className = "tl-tr-rail";
      rail.style.top = top + "px";
      rail.style.height = h + "px";
      host.appendChild(rail);
      for (const s of placed.synced ? placed.sentences : []) {
        // Only what was said while the recording ran is drawn.
        if (s.endMs < env.first || s.startMs > env.last) continue;
        const a = Math.max(env.first, s.startMs), b = Math.min(env.last, s.endMs);
        const block = document.createElement("div");
        block.className = "tl-tr-block";
        block.dataset.seg = s.id;
        block.style.left = ((a - env.first) / env.span) * 100 + "%";
        block.style.width = Math.max(0.15, ((b - a) / env.span) * 100) + "%";
        block.style.top = (top + LABEL_ROW_H) + "px";
        block.style.height = BLOCK_H + "px";
        block.title = _sentenceTitle(s);
        block.addEventListener("click", (e) => {
          e.stopPropagation();
          Video.seekToTimestamp(new Date(s.startMs).toISOString());
        });
        host.appendChild(block);
      }
      const label = document.createElement("div");
      label.className = "tl-tr-label";
      label.style.top = (top + 2) + "px";   // a 16px row inside the 20px label row
      label.innerHTML = '<span class="tl-tr-name">Transcript</span>' +
        (placed.synced ? "" : '<span class="tl-tr-state">Not synced</span>') +
        '<button type="button" class="link-btn tl-tr-sync" title="Place the transcript on the recording: ' +
        'pick a sentence, then click the moment on the timeline where it was said.">Sync...</button>';
      label.addEventListener("click", (e) => e.stopPropagation());
      label.querySelector(".tl-tr-sync").addEventListener("click", startTranscriptSync);
      host.appendChild(label);
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

function startTranscriptSync(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const sess = State.getSession();
  if (!sess || !sess.transcript) return;
  if (!sess.manifest || !Number.isFinite(Date.parse(sess.manifest.started_at))) {
    toast("This session has no start time, so the transcript cannot be placed.", "error");
    return;
  }
  const sentences = TM.segmentsOf(sess.transcript);
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
    const evs = sess.events || [];
    const tl = document.getElementById("timeline");
    const at = (tl && evs.length) ? require("./flow-view-timeline.js").timeAtClientX(ev.clientX,
      tl.getBoundingClientRect(), Date.parse(evs[0].timestamp), Date.parse(evs[evs.length - 1].timestamp)) : null;
    const offsetMs = at ? TM.offsetForSync(Date.parse(at), sess.manifest.started_at, _sync.seg.startS) : null;
    if (offsetMs === null) {
      cancelTranscriptSync();
      toast("Could not read the timeline position.", "error");
      return;
    }
    _applySync(sess, offsetMs);
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

async function _applySync(sess, offsetMs) {
  cancelTranscriptSync();
  let r;
  try { r = await Ipc.saveTranscriptSync({ sessionFolder: sess.sessionFolder, offsetMs }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The transcript sync was not saved: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  // The file now holds this offset and nothing else changed: the loaded
  // session takes it too, and the other surfaces read it when they render.
  if (State.getSession() === sess && sess.transcript) sess.transcript.offset_ms = offsetMs;
  toast("Transcript synced.", "success");
  renderTimeline();
}

/* ---- The More menu --------------------------------------------------------- */

/* The More menu follows the file; the Lanes menu lists the lane only while a
   usable transcript is attached. */
function renderTranscriptMenu() {
  const sess = State.getSession();
  const has = _hasFile(sess);
  const attach = document.getElementById("btn-attach-transcript");
  const remove = document.getElementById("btn-remove-transcript");
  const laneRow = document.getElementById("lane-transcript-row");
  if (attach) {
    attach.textContent = has ? "Replace transcript..." : "Attach transcript...";
    attach.title = has
      ? "Replace the transcript with another Teams file (.vtt or .docx). Sync the new one again unless a video is attached."
      : "Attach the meeting transcript Teams saved (.vtt or .docx). Its sentences show on the timeline, next to each step and beside the document sections.";
  }
  if (remove) remove.hidden = !has;
  if (laneRow) laneRow.hidden = !(sess && sess.transcript);
}

async function attachTranscript() {
  const sess = State.getSession();
  if (!sess) return;
  let r;
  try { r = await Ipc.importTranscript({ sessionFolder: sess.sessionFolder }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r) return;   // the analyst cancelled the file dialog
  if (!r.ok) {
    toast("The transcript was not attached: " + (r.error || "no reason was given"), "error");
    return;
  }
  await loadSessionIntoView(sess.sessionFolder);
  const now = State.getSession();
  if (!now || !now.transcript) return;   // the load already said why it cannot be read
  const placed = TM.forSession(now);
  toast(TM.attachedMessage(now.transcript, !!(placed && placed.synced)), "success");
}

async function removeTranscript() {
  const sess = State.getSession();
  if (!sess) return;
  let r;
  try { r = await Ipc.removeTranscript({ sessionFolder: sess.sessionFolder }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The transcript was not removed: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  await loadSessionIntoView(sess.sessionFolder);
  toast("Transcript removed. The original file stays in the session's transcript folder.", "success");
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
    toast("The transcript could not be read: " + err + ". Replace it from the More menu.", "error");
  }
  _errorShown = key;
}

/* deps = { loadSessionIntoView, renderTimeline }, injected by flow-view.js. */
function initTranscript(deps) {
  loadSessionIntoView = (deps && deps.loadSessionIntoView) || (async () => {});
  renderTimeline = (deps && deps.renderTimeline) || (() => {});
}

// Self-wire the require()-time listeners (the DOM is parsed by then).
if ($("#btn-attach-transcript")) $("#btn-attach-transcript").addEventListener("click", attachTranscript);
if ($("#btn-remove-transcript")) $("#btn-remove-transcript").addEventListener("click", removeTranscript);
if (document.getElementById("timeline-scroll")) {
  document.getElementById("timeline-scroll").addEventListener("scroll", _placeLabel);
}
// One sync at a time: the video sync (flow-view-video.js) ends this one.
if ($("#btn-sync-video")) $("#btn-sync-video").addEventListener("click", () => cancelTranscriptSync());

module.exports = {
  initTranscript, onSessionLoaded, transcriptLane, startTranscriptSync, cancelTranscriptSync,
};
