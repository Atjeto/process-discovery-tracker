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
 *   3. Attach a transcript... (#btn-attach-transcript, Replace the
 *      transcript... once one is attached) and Remove the transcript
 *      (#btn-remove-transcript), its inverse, in the Overview's transcript
 *      row (plan D5; overview-view.js renders them), and
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
const AC = require("../analyst-content.js");
const RO = require("../read-only.js");
const LeftOut = require("../left-out.js");
const TL = require("../transcript-list.js");

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
      // Lane W2: the sentences are the lane's marks, one Tab stop
      // (flow-view-timeline.js gives the box its role and its keys).
      const box = document.createElement("div");
      box.className = "tl-lane-marks";
      box.dataset.lane = "transcript";
      host.appendChild(box);
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
          block.dataset.startMs = String(s.startMs);
          if (Number.isFinite(s.endMs)) block.dataset.endMs = String(s.endMs);
          block.dataset.mark = "t:" + part.file + "|" + s.id;
          block.addEventListener("click", (e) => {
            e.stopPropagation();
            Video.seekToTimestamp(new Date(s.startMs).toISOString());
            // Lane PANE: the Transcript tab beside the video, at this sentence
            // (it follows the clock; lazy: the pane requires this module).
            require("./timeline-pane.js").showTab("transcript");
          });
          box.appendChild(block);
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
          '<button type="button" class="link-btn tl-tr-sync" title="' + escapeAttr(TM.SYNC_TITLE) + '">Sync the transcript...</button>' +
          '<button type="button" class="link-btn tl-tr-replace" title="' + escapeAttr(TM.REPLACE_TITLE) + '">Replace the transcript...</button>' +
          '<button type="button" class="link-btn tl-tr-remove" title="' + escapeAttr(TM.REMOVE_TITLE) + '">Remove the transcript</button>';
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
  renderTab();
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
  renderTab();
  const sess = State.getSession();
  const err = sess && sess.transcriptError;
  const key = err ? sess.sessionFolder + "\n" + err : null;
  if (key && key !== _errorShown) {
    toast("The transcript could not be read: " + err + ". Replace it on the Overview, in the Transcript row.", "error");
  }
  _errorShown = key;
}

/* ---- The Transcript tab (lane E, item E3) -------------------------------------
   The third tab beside the video: the talk as text, on the one clock, so the
   useful part of a ninety minute call is found by reading and searching, not
   by scrubbing. Every placed sentence of every transcript in time order
   (transcript-list.js tabModel), the speaker where it changes; a search
   that hides what does not match, marks what does and counts it; a speaker
   select with more than one speaker. The sentence at the playhead is marked
   and, while the video plays, kept in view, unless the pointer is over the
   list or the search holds text (never fight the reader). A click on a
   sentence takes the clock there (playing on only if it played). Its menu:
   Add a step here (what S does at that moment), Add to the selected step's
   description (the step editor's handler), Add to a document field (the
   Overview's menu). A stretch put aside (left-out.js) stands in one row,
   with Include again. Read only: reading, searching and seeking only.
   The list is built once per change of what it shows (_tabKey) and never
   while typing or playing: a tick toggles one class. */

let addStepAt = async () => {};
let includeAgain = async () => {};

const _tab = { key: null, rows: [], starts: [], sentences: [], byStart: [], cur: -1, hover: false,
  query: "", speaker: "", marked: new Set(), stretches: [] };

/* ---- The caption under the video (lane W2, plan section 11.1) ----------------
   While a transcript is placed on the clock, a band under the picture (the
   video, or the screen of a recording without one) shows what is said at the
   clock's moment: the speaker in bold, then the sentence, on at most two
   lines, the whole of it in the tooltip. It is the Transcript tab's sentence
   at this moment while it is being said (transcript-list.js sayingAt, over
   the tab's own rows: a sentence in a stretch put aside is not there), so
   the band is empty between two sentences, keeping its height. It follows
   the clock, every frame while the video plays. A click opens the Transcript
   tab at that sentence. */
const _cap = { cur: null, raf: 0 };
const CAPTION_CLICK = "Click: show it in the Transcript tab.";

function syncCaption() {
  const band = document.getElementById("video-caption");
  const say = document.getElementById("video-caption-say");
  const pane = document.getElementById("video-pane");
  if (!band || !say || !pane) return;
  const video = document.getElementById("video");
  const player = !!video && !!video.src && video.style.display !== "none";
  const shown = _tab.starts.length > 0 && (player || pane.classList.contains("on-screen"));
  if (band.hidden !== !shown) band.hidden = !shown;
  const i = shown ? TL.sayingAt(_tab.sentences, _tab.starts, Video.playheadMs(), _tab.stretches) : -1;
  const s = i >= 0 ? _tab.sentences[i] : null;
  if (s === _cap.cur) return;
  _cap.cur = s;
  say.hidden = !s;
  const who = say.querySelector(".cap-speaker"), text = say.querySelector(".cap-text");
  if (!s) { who.textContent = ""; text.textContent = ""; say.removeAttribute("title"); return; }
  const line = TM.normalizeSpace(s.text);
  who.textContent = s.speaker ? s.speaker + " " : "";
  who.hidden = !s.speaker;
  text.textContent = line;
  say.title = (s.speaker ? s.speaker + ": " : "") + line + "\n" + CAPTION_CLICK;
}

/* Every frame while the video plays: a sentence of a second shows its whole
   second, and the band empties as it ends. */
function _captionLoop() {
  _cap.raf = 0;
  syncCaption();
  const video = document.getElementById("video");
  if (video && !video.paused && !video.ended) _cap.raf = requestAnimationFrame(_captionLoop);
}

function _tabHost() { return document.getElementById("transcript-tab"); }
function _tabShown() {
  const host = _tabHost();
  const panel = host && host.closest(".anno-panel");
  return !!panel && panel.style.display !== "none";
}

/* What the list depends on: the transcripts and their placement, the
   stretches put aside, whether the project can be edited. */
function _tabKey(sess) {
  if (!sess) return "";
  const a = sess.annotations || {};
  return JSON.stringify([sess.sessionFolder, (sess.manifest || {}).started_at, TM.transcriptsOf(sess).map((t) => [t.file,
    (t.transcript.segments || []).length, t.transcript.offset_ms, t.transcript.video_id]), a.external_videos || a.external_video || null,
    a.excluded_ranges || [], RO.isReadOnly(sess), !!sess.recordingAvailable, (sess.events || []).length > 0]);
}

function _clockOf(ms, origin) {
  return Number.isFinite(ms) && Number.isFinite(origin) ? clock(Math.max(0, ms - origin)) : "";
}

function _gapLine(gap, origin, recorded) {
  return LeftOut.wordsFor(recorded).band + ": " + _clockOf(gap.startMs, origin) + " to " + _clockOf(gap.endMs, origin);
}

/* The tab, built from the project on screen (only when what it shows
   changed, unless `force`). */
function renderTab(force) {
  const host = _tabHost();
  if (!host) return;
  const sess = State.getSession();
  const key = _tabKey(sess);
  if (!force && key === _tab.key) { tickTab(); return; }
  _tab.key = key;
  _tab.rows = [];
  _tab.starts = [];
  _tab.sentences = [];
  _tab.cur = -1;
  _cap.cur = null;
  _tab.marked = new Set();
  _closeTabMenu();
  syncCaption();
  if (!sess) { host.innerHTML = ""; return; }
  const editable = !RO.isReadOnly(sess);
  const origin = recordingStartMs(sess);
  const recorded = AC.hasRecording(sess);
  const parts = TM.partsOf(sess);
  if (!parts.length) {
    host.innerHTML = '<p class="trt-note">No transcript is attached.</p>' + (editable
      ? '<button type="button" class="link-btn trt-attach" title="' + escapeAttr(TM.ATTACH_TITLE) + '">Attach transcript...</button>' : "");
    const b = host.querySelector(".trt-attach");
    if (b) b.addEventListener("click", () => attachTranscript());
    return;
  }
  _tab.stretches = LeftOut.stretchesOf(sess.annotations);
  const model = TL.tabModel(parts, _tab.stretches);
  if (_tab.speaker && !model.speakers.includes(_tab.speaker)) _tab.speaker = "";
  const timeline = !!Video.timelineSpan();
  const notes = model.unplaced.map((u) => {
    const name = parts.length > 1 ? "Transcript " + u.number : "The transcript";
    return '<p class="trt-note">' + escapeAttr(name) + " is not placed on the clock yet" +
      (editable && timeline ? ': <button type="button" class="link-btn trt-sync" data-file="' + escapeAttr(u.file) + '" ' +
        'title="' + escapeAttr(TM.SYNC_TITLE) + '">Sync the transcript...</button>'
        : editable ? ": attach the video first, then sync it." : ".") + "</p>";
  }).join("");
  if (!model.rows.length) {
    host.innerHTML = notes || '<p class="trt-note">The transcript has no sentences.</p>';
    _wireTabNotes(host);
    return;
  }
  const speakers = model.speakers.length > 1
    ? '<select class="trt-speaker" aria-label="Speaker" title="Show what one person said"><option value="">Everyone</option>' +
      model.speakers.map((sp) => '<option value="' + escapeAttr(sp) + '"' + (sp === _tab.speaker ? " selected" : "") + ">" +
        escapeAttr(sp) + "</option>").join("") + "</select>" : "";
  // Two text acts after the sentence: shown on the row under the pointer,
  // the row with the keyboard and the playhead's row; on the others they
  // keep their space (no row changes height) and stay reachable by Tab.
  const acts = editable ? '<span class="trt-acts">' +
    '<button type="button" class="link-btn trt-act trt-add-step" title="Adds a step that starts where this is said.">Add step here</button>' +
    '<button type="button" class="link-btn trt-act trt-copy" aria-haspopup="menu" title="Copies this sentence into the description of a step or a field of the document.">Copy to...</button>' +
    "</span>" : "";
  let k = 0;
  const items = model.rows.map((r) => {
    if (r.kind === "gap") {
      const line = _gapLine(r.gap, origin, recorded);
      return '<li class="trt-gap" data-start="' + r.gap.startMs + '"><span class="trt-gap-text">' + escapeAttr(line) + "</span>" +
        (editable ? '<button type="button" class="link-btn trt-include" title="Brings this stretch back: it plays again and what was said in it is listed here.">Include again</button>' : "") +
        "</li>";
    }
    const s = r.s;
    const html = '<li class="trt-row" data-k="' + k + '"><button type="button" class="trt-say" title="Goes to the moment this was said.">' +
      '<span class="tr-time">' + escapeAttr(TM.sentenceClock(s, origin)) + "</span>" +
      (s.speaker ? '<span class="tr-speaker' + (r.speakerShown ? "" : " same") + '">' + escapeAttr(s.speaker) + "</span>" : "") +
      '<span class="tr-text">' + escapeAttr(TM.normalizeSpace(s.text)) + "</span></button>" + acts + "</li>";
    k += 1;
    return html;
  });
  host.innerHTML = notes +
    '<div class="trt-tools"><input type="search" class="trt-search" placeholder="Search the transcript" aria-label="Search the transcript" value="' +
      escapeAttr(_tab.query) + '" />' + speakers + '<span class="trt-count" aria-live="polite"></span></div>' +
    '<ol class="trt-list" aria-label="What was said">' + items.join("") + "</ol>";
  _wireTabNotes(host);
  const list = host.querySelector(".trt-list");
  const sentences = model.rows.filter((r) => r.kind === "sentence").map((r) => r.s);
  const els = list.querySelectorAll(".trt-row");
  _tab.rows = sentences.map((s, i) => ({ s, el: els[i], text: els[i].querySelector(".tr-text"),
    low: TM.normalizeSpace(s.text).toLowerCase(), shown: true }));
  _tab.starts = sentences.map((s) => s.startMs);
  _tab.sentences = sentences;
  _tab.total = model.total;
  _wireTabList(host, list, editable);
  _applyFilter();
  tickTab(true);
  syncCaption();
}

function _wireTabNotes(host) {
  for (const b of host.querySelectorAll(".trt-sync")) b.addEventListener("click", (e) => startTranscriptSync(e, b.dataset.file));
}

function _wireTabList(host, list, editable) {
  const search = host.querySelector(".trt-search");
  search.addEventListener("input", () => { _tab.query = search.value; _applyFilter(); });
  const speaker = host.querySelector(".trt-speaker");
  if (speaker) speaker.addEventListener("change", () => { _tab.speaker = speaker.value; _applyFilter(); });
  list.addEventListener("mouseenter", () => { _tab.hover = true; });
  list.addEventListener("mouseleave", () => { _tab.hover = false; });
  list.addEventListener("click", (e) => {
    const say = e.target.closest(".trt-say");
    if (say) { const row = _rowOf(say); if (row) _seekTo(row.s); return; }
    const add = e.target.closest(".trt-add-step");
    if (add) { const row = _rowOf(add); if (row) _addStepAt(row.s); return; }
    const copy = e.target.closest(".trt-copy");
    if (copy) { const row = _rowOf(copy); if (row) _openCopyMenu(copy, row.s, e.detail === 0); return; }
    const inc = e.target.closest(".trt-include");
    if (inc && editable) {
      const start = Number(inc.closest(".trt-gap").dataset.start);
      const gap = _tab.stretches.find((g) => g.startMs === start);
      if (gap) _includeGap(gap);
    }
  });
}

function _rowOf(el) {
  const li = el.closest(".trt-row");
  return li ? _tab.rows[Number(li.dataset.k)] || null : null;
}

/* The search and the speaker: rows hidden, not built again; the matches
   marked; the count beside the search. */
function _applyFilter() {
  const host = _tabHost();
  if (!host || !_tab.rows.length) return;
  const q = TL.queryOf(_tab.query);
  const sp = _tab.speaker;
  const narrowed = !!(q || sp);
  let shown = 0;
  const marked = new Set();
  for (const r of _tab.rows) {
    const on = (!sp || r.s.speaker === sp) && (!q || r.low.includes(q));
    if (on !== r.shown) { r.el.hidden = !on; r.shown = on; }
    if (on) shown += 1;
    if (on && q) { r.text.innerHTML = TL.markedHtml(r.s.text, q); marked.add(r); }
  }
  for (const r of _tab.marked) if (!marked.has(r)) r.text.textContent = TM.normalizeSpace(r.s.text);
  _tab.marked = marked;
  const list = host.querySelector(".trt-list");
  if (list) list.classList.toggle("narrowed", narrowed);
  const count = host.querySelector(".trt-count");
  if (count) count.textContent = TL.countText(shown, _tab.total, narrowed);
}

/* The sentence at the playhead: one class moved, and while the video plays
   the row kept in view (not while the analyst reads: the pointer over the
   list, the search holding text, the keyboard in it). `jump`: put it in
   view whatever plays (the tab just shown). */
function tickTab(jump) {
  if (!_tab.rows.length || !_tabShown()) return;
  const ms = Video.playheadMs();
  const i = TL.sentenceIndexAt(_tab.starts, ms, _tab.stretches);
  if (i !== _tab.cur) {
    const old = _tab.rows[_tab.cur];
    if (old) { old.el.classList.remove("current"); old.el.removeAttribute("aria-current"); }
    const now = _tab.rows[i];
    if (now) { now.el.classList.add("current"); now.el.setAttribute("aria-current", "true"); }
    _tab.cur = i;
  } else if (!jump) return;
  const row = _tab.rows[i];
  if (!row || !row.shown) return;
  const list = row.el.parentElement;
  const reading = _tab.hover || !!_tab.query || (list && list.contains(document.activeElement)) ||
    !!document.getElementById("ov-tr-add-menu");
  if (reading || !(jump || Video.isPlaying())) return;
  // The list is the rows' offset parent (position: relative).
  const top = row.el.offsetTop, bottom = top + row.el.offsetHeight;
  if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }
}

/* A sentence clicked: the clock goes there; a playing video plays on, a
   paused one stays paused. */
function _seekTo(s) {
  if (!Number.isFinite(s.startMs)) return;
  const at = Video.clipAtMs(s.startMs);
  if (at && at.clip.file) Video.seekClock(s.startMs);
  else Video.movePlayheadToTimestamp(new Date(s.startMs).toISOString());
  tickTab();
}

function _closeTabMenu() {
  const m = document.getElementById("ov-tr-add-menu");
  if (m) m.remove();
}

/* Add step here: what S does at that moment. The clock goes there first,
   so the video shows the step's moment and its frame. */
async function _addStepAt(s) {
  if (!Number.isFinite(s.startMs)) return;
  _seekTo(s);
  await addStepAt(new Date(s.startMs).toISOString());
}

/* The selected step (any level), or null. */
function _selectedHit() {
  const sess = State.getSession();
  const id = State.getSelectedStepId();
  return id ? require("../sub-process-maps.js").findStep((sess && sess.annotations && sess.annotations.steps) || [], id) : null;
}

/* Copy to...: one menu, "Copy this sentence to", first the selected step's
   description (shown and not acting while no step is selected), then the
   document's fields (the Overview's menu, overview-view.js
   showDocTargetMenu). `keyboard`: the first item takes the focus. */
function _openCopyMenu(btn, s, keyboard) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return;
  const hit = _selectedHit();
  const name = hit ? (String(hit.step.name || "").trim() || "this step") : "";
  const added = !!hit && TM.isAdded(hit.step.description, s.text);
  const first = hit
    ? { label: 'The description of "' + name + '"' + (added ? " (added)" : ""), off: added,
      title: added ? "Its description already holds this sentence." : 'Adds this sentence to the description of "' + name + '".',
      act: () => _addToDescription(s) }
    : { label: "The description of a step (select a step first)", off: true,
      title: "Select a step on the Timeline first.", act: () => {} };
  require("./overview-view.js").showDocTargetMenu(btn, s, { head: "Copy this sentence to", first, focus: keyboard });
}

/* The selected step's description gets the sentence, through the step
   editor's own handler (steps-view.js describeStepAction: one undoable
   edit, a draft becoming edited). */
async function _addToDescription(s) {
  const sess = State.getSession();
  const hit = _selectedHit();
  const id = hit && hit.step.step_id;
  if (!sess || RO.isReadOnly(sess) || !hit || TM.isAdded(hit.step.description, s.text)) return;
  const cb = require("./steps-view.js").panelFieldCallbacks(hit.step);
  await cb.onDescription(id, TM.appendText(hit.step.description, s.text));
  toast("Added to the description of " + (String(hit.step.name || "").trim() || "the selected step") + ".", "success");
}

async function _includeGap(gap) {
  // A stretch is one or more entries joined (left-out.js): each goes.
  for (const range of gap.ranges) await includeAgain(range);
}

/* deps = { loadSessionIntoView, renderTimeline, addStepAt, includeAgain },
   injected by flow-view.js. */
function initTranscript(deps) {
  loadSessionIntoView = (deps && deps.loadSessionIntoView) || (async () => {});
  renderTimeline = (deps && deps.renderTimeline) || (() => {});
  addStepAt = (deps && deps.addStepAt) || (async () => {});
  includeAgain = (deps && deps.includeAgain) || (async () => {});
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
// The Transcript tab follows the playhead (a class moved per tick) and is
// built again only when what it lists changed (a stretch put aside or
// included again, an undo, the videos moved).
(function wireTab() {
  const video = document.getElementById("video");
  if (video) {
    video.addEventListener("timeupdate", () => tickTab());
    video.addEventListener("seeked", () => tickTab());
    // Lane W2: the caption follows the clock.
    for (const ev of ["timeupdate", "seeked", "pause", "emptied", "loadedmetadata"]) video.addEventListener(ev, syncCaption);
    video.addEventListener("play", () => { if (!_cap.raf) _cap.raf = requestAnimationFrame(_captionLoop); });
  }
  State.subscribe("timeline", () => renderTab());
  // A click on the caption: the Transcript tab at that sentence (the tab
  // marks the sentence at this moment and puts it in view).
  const say = document.getElementById("video-caption-say");
  if (say) say.addEventListener("click", () => require("./timeline-pane.js").showTab("transcript"));
})();

module.exports = {
  initTranscript, onSessionLoaded, transcriptLane, startTranscriptSync, cancelTranscriptSync,
  // Lane E (E3): the Transcript tab beside the video.
  renderTab, refreshTab: () => renderTab(), tickTab,
  // Lane W2: the caption under the video.
  syncCaption,
};
