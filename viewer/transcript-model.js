/*
 * transcript-model.js: the pure side of the meeting transcript (contract C8,
 * plan section 7). No DOM, no State, no IPC: main.js, the Flow lane, the step
 * editor and the Overview all place and pick sentences through here, and the
 * unit tests drive it directly (transcript-model.test.js).
 *
 * Nothing here interprets the text. It checks the parsed file, places each
 * sentence in wall time, picks the sentences of a time window, and appends a
 * sentence to a text field; the analyst does the thinking.
 *
 * The time model, one rule for every surface. The wall time of a sentence,
 * in ms, is Date.parse(manifest.started_at) + offset + start_s * 1000, where
 * offset is the EFFECTIVE offset:
 *   0. C23 (2.0.6): a transcript of one video of the chain (`video_id`
 *      names it in annotations.external_videos, video-chain.js): that
 *      video's offset_ms plus the transcript's own offset_ms (null reads as
 *      0, the transcript starting with the video's file). Its sentences
 *      count from its video, so they move with it when the chain moves (a
 *      trim, a remove or a replace before it). Its video gone: null;
 *   1. transcript.offset_ms when it is a number (the analyst synced it);
 *   2. else the first video's offset_ms when a video is attached: the
 *      transcript shares the meeting video's clock (plan D2), the reference
 *      the video player uses (wall time at video t=0 = started_at +
 *      offset_ms), so a video re-sync moves the transcript with it;
 *   3. else null: the transcript is not synced and nothing is placed in time.
 * The `clock` field transcript_import.py writes is informational only.
 *
 * A project holds several transcripts (C23: transcript.json, then
 * transcript-2.json and on, main.js loads them as session.transcripts, each
 * { file, transcript }). forSession places them all and merges their
 * sentences (an id outside the first file is prefixed with its file's name,
 * so every id is one sentence); partsOf gives them one by one.
 */

"use strict";

const { clock } = require("./dom.js");
const VideoChain = require("./video-chain.js");

const VERSION = 1;
/* Talk that leads into an action usually comes just before it: a step's
   window starts this long before the step. */
const STEP_LEAD_MS = 10000;

const NOT_SYNCED_LINE = "The transcript is not synced to the recording yet. Sync it on the Timeline.";

/* The tooltips of Attach (Replace) and Remove, on the Overview's recording
   line and on the Timeline's Transcript lane label alike. */
const ATTACH_TITLE = "Attach the meeting transcript Teams saved (.vtt or .docx). Its sentences show on the " +
  "timeline, next to each step and beside the document fields.";
const REPLACE_TITLE = "Replace the transcript with another Teams file (.vtt or .docx). Sync the new one again " +
  "unless a video is attached.";
const REMOVE_TITLE = "Take the transcript out of this project, with its original file in the project's " +
  "transcript folder. Ctrl+Z brings them back.";
/* C23 (2.0.6): one more transcript, of another video. */
const ADD_TITLE = "Attach another transcript (.vtt or .docx), of another video of this project: its sentences " +
  "are placed from that video's start.";

/* Why a parsed transcript.json cannot be used, in one line, or null when it
   can: a version 1 object with a segments list. */
function validateTranscript(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return "the file does not hold a transcript";
  if (doc.version !== VERSION) return "it is not a version " + VERSION + " transcript";
  if (!Array.isArray(doc.segments)) return "it has no list of sentences";
  return null;
}

/* The usable sentences of a transcript, in file order:
   { id, startS, endS, speaker, text }. A segment without a numeric start or
   without text is left out; a missing or earlier end reads as the start. */
function segmentsOf(transcript) {
  const segs = transcript && Array.isArray(transcript.segments) ? transcript.segments : [];
  const out = [];
  segs.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const startS = Number(s.start_s);
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!Number.isFinite(startS) || !text) return;
    const end = Number(s.end_s);
    out.push({
      id: typeof s.id === "string" && s.id ? s.id : "s" + (i + 1),
      startS,
      endS: Number.isFinite(end) && end >= startS ? end : startS,
      speaker: typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : null,
      text,
    });
  });
  return out;
}

function _ownOffset(transcript) {
  const own = transcript && transcript.offset_ms;
  return typeof own === "number" && Number.isFinite(own) ? own : null;
}

/* The video a transcript belongs to (C23): its `video_id`, or "". */
function videoIdOf(transcript) {
  const v = transcript && transcript.video_id;
  return typeof v === "string" && v ? v : "";
}

/* The effective offset in ms (the rules above), or null. */
function effectiveOffsetMs(transcript, annotations) {
  const clips = VideoChain.clipsOf(annotations);
  const vid = videoIdOf(transcript);
  if (vid) {
    const c = clips.find((x) => x.id === vid);
    return c ? c.offset_ms + (_ownOffset(transcript) || 0) : null;
  }
  const own = _ownOffset(transcript);
  if (own !== null) return own;
  return clips.length ? clips[0].offset_ms : null;
}

/* The offset_ms to store for a sync that puts the transcript's 0 at
   `absOffsetMs` (ms after started_at, offsetForSync): counted from its
   video's start when it belongs to one, else as it is. */
function storedOffsetFor(transcript, annotations, absOffsetMs) {
  if (!Number.isFinite(absOffsetMs)) return null;
  const vid = videoIdOf(transcript);
  const c = vid ? VideoChain.clipsOf(annotations).find((x) => x.id === vid) : null;
  return Math.round(c ? absOffsetMs - c.offset_ms : absOffsetMs);
}

/* Wall time in ms of `seconds` from the transcript's start, or NaN. */
function wallMs(startedAt, offsetMs, seconds) {
  const base = Date.parse(startedAt);
  if (!Number.isFinite(base) || typeof offsetMs !== "number" || !Number.isFinite(offsetMs) ||
      !Number.isFinite(seconds)) return NaN;
  return base + offsetMs + Math.round(seconds * 1000);
}

/* Every sentence with its wall time: { synced, offsetMs, sentences } where a
   sentence is { id, startS, endS, speaker, text, startMs, endMs }. Not
   synced (no effective offset, or no start time): startMs and endMs are
   null. */
function placeTranscript(transcript, annotations, startedAt) {
  const offsetMs = effectiveOffsetMs(transcript, annotations);
  const synced = offsetMs !== null && Number.isFinite(Date.parse(startedAt));
  const sentences = segmentsOf(transcript).map((s) => Object.assign({}, s, {
    startMs: synced ? wallMs(startedAt, offsetMs, s.startS) : null,
    endMs: synced ? wallMs(startedAt, offsetMs, s.endS) : null,
  }));
  return { synced, offsetMs: synced ? offsetMs : null, sentences };
}

/* The transcripts of a loaded session, each { file, transcript } (C23:
   session.transcripts; a session of an older viewer carries only
   session.transcript, transcript.json). */
function transcriptsOf(sess) {
  if (!sess) return [];
  if (Array.isArray(sess.transcripts) && sess.transcripts.length) {
    return sess.transcripts.filter((t) => t && t.transcript && typeof t.file === "string");
  }
  return sess.transcript ? [{ file: "transcript.json", transcript: sess.transcript }] : [];
}

/* A sentence id unique across the transcripts of a project: the first
   file's as it is, another's prefixed with its file's name. */
function _sentenceId(file, id) {
  return file === "transcript.json" ? id : String(file).replace(/\.json$/, "") + ":" + id;
}

/* Each transcript of a loaded session placed: [{ file, transcript, number,
   videoId, synced, offsetMs, sentences }] (placeTranscript, the sentence
   ids made unique, each sentence carrying its `file`); number counts them
   from 1 in their order. */
function partsOf(sess) {
  const startedAt = sess && sess.manifest && sess.manifest.started_at;
  return transcriptsOf(sess).map((t, i) => {
    const placed = placeTranscript(t.transcript, sess.annotations, startedAt);
    return {
      file: t.file, transcript: t.transcript, number: i + 1, videoId: videoIdOf(t.transcript),
      synced: placed.synced, offsetMs: placed.offsetMs,
      sentences: placed.sentences.map((x) => Object.assign(x, { id: _sentenceId(t.file, x.id), file: t.file })),
    };
  });
}

/* Every transcript of a loaded session, placed and merged: { synced (one of
   them is), offsetMs (the first one's), sentences (all, each file's in its
   order), parts (partsOf) }, or null when it has none. */
function forSession(sess) {
  const parts = partsOf(sess);
  if (!parts.length) return null;
  return {
    synced: parts.some((p) => p.synced),
    offsetMs: parts[0].offsetMs,
    sentences: [].concat(...parts.map((p) => p.sentences)),
    parts,
  };
}

/* Before the videos of a chain move (C23: a trim, a remove, a replace or an
   add that moves what follows), the transcripts placed without a video are
   tied to one with the offset that keeps them where they are, so they move
   with what was said with them: the video showing their first sentence,
   else the first video. A transcript placed by its own offset in a
   recording (`ripple` false) stays on the recording's clock and is left.
   `lengthOf` as video-chain.js. Returns [{ file, videoId, offsetMs }], one
   per transcript to tie (saveTranscriptSync's binds). */
function bindsBeforeChainEdit(sess, lengthOf, ripple) {
  const clips = VideoChain.clipsOf(sess && sess.annotations);
  if (!clips.length) return [];
  const origin = Date.parse(sess && sess.manifest && sess.manifest.started_at);
  const out = [];
  for (const p of partsOf(sess)) {
    if (p.videoId || !p.synced) continue;
    if (!ripple && _ownOffset(p.transcript) !== null) continue;
    const firstTimed = p.sentences.find((x) => Number.isFinite(x.startMs));
    const at = firstTimed && Number.isFinite(origin)
      ? VideoChain.clipAtRel(clips, lengthOf, firstTimed.startMs - origin) : null;
    const clip = at ? at.clip : clips[0];
    out.push({ file: p.file, videoId: clip.id, offsetMs: Math.round(p.offsetMs - clip.offset_ms) });
  }
  return out;
}

/* Closed intervals: touching counts as overlapping. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

function _byTime(a, b) {
  return (a.startMs - b.startMs) || (a.endMs - b.endMs) || (a.startS - b.startS);
}

/* A step's window: [start - STEP_LEAD_MS, end], or null without a start.
   2.0.1: `prevEndMs`, the end of the step before it, bounds the lead: talk
   before that end belongs to that step. */
function stepWindow(step, leadMs, prevEndMs) {
  const tr = step && step.time_range;
  const s = Date.parse(tr && tr.start);
  if (!Number.isFinite(s)) return null;
  const e = Date.parse(tr && tr.end);
  const lead = typeof leadMs === "number" ? leadMs : STEP_LEAD_MS;
  let from = s - lead;
  if (Number.isFinite(prevEndMs) && prevEndMs >= from) from = Math.min(s, prevEndMs + 1);
  return { startMs: from, endMs: Number.isFinite(e) && e >= s ? e : s };
}

/* The end of the timed step before `step` on the timeline among `list` (its
   transaction's steps, or its visit's inside a sub-process), or NaN: the one
   that starts last before it (a tie: the one listed first). C22: a step the
   analyst placed elsewhere in the process keeps its moment, so what was said
   then is bounded by the step before it in time, not in the list. */
function prevEndMs(list, step) {
  const arr = list || [];
  const i = arr.findIndex((x) => x && step && x.step_id === step.step_id);
  const own = Date.parse(step && step.time_range && step.time_range.start);
  if (i < 0 || !Number.isFinite(own)) {
    for (let j = i - 1; j >= 0; j--) {
      const e = Date.parse(arr[j] && arr[j].time_range && arr[j].time_range.end);
      if (Number.isFinite(e)) return e;
    }
    return NaN;
  }
  let best = NaN, bestStart = -Infinity, bestAt = -1;
  arr.forEach((x, j) => {
    if (!x || j === i) return;
    const a = Date.parse(x.time_range && x.time_range.start), e = Date.parse(x.time_range && x.time_range.end);
    if (!Number.isFinite(a) || !Number.isFinite(e) || a > own || (a === own && j > i)) return;
    if (a > bestStart || (a === bestStart && j > bestAt)) { best = e; bestStart = a; bestAt = j; }
  });
  return best;
}

/* The placed sentences whose time range overlaps the window, in time order. */
function sentencesInWindow(sentences, win) {
  if (!win) return [];
  return (sentences || [])
    .filter((x) => Number.isFinite(x.startMs) && Number.isFinite(x.endMs) &&
      overlaps(x.startMs, x.endMs, win.startMs, win.endMs))
    .sort(_byTime);
}

/* The sentences said during a step (the step editor's "Said during this
   step", the step panel's rows): those that start in its window, in time
   order. `list`, the steps of its transaction (or its visit), bounds the
   window by the step before it, so a sentence shows under one step only
   (2.0.1: adjacent steps showed the same sentences). */
function sentencesForStep(sentences, step, list) {
  const win = stepWindow(step, undefined, prevEndMs(list, step));
  if (!win) return [];
  return (sentences || [])
    .filter((x) => Number.isFinite(x.startMs) && x.startMs >= win.startMs && x.startMs <= win.endMs)
    .sort(_byTime);
}

/* The runs' spans ({ startMs, endMs }) from runs-model buildRuns. A run left
   open ends at its measured duration, else at the end of the recording. */
function runSpans(runs, recordingEndMs) {
  const out = [];
  for (const r of runs || []) {
    const s = r && r.startMs;
    if (!Number.isFinite(s)) continue;
    let e = r.endMs;
    if (!Number.isFinite(e)) {
      e = Number.isFinite(r.durationMs) ? s + r.durationMs
        : Number.isFinite(recordingEndMs) ? recordingEndMs : s;
    }
    out.push({ startMs: s, endMs: Math.max(s, e) });
  }
  return out;
}

/* The placed sentences that overlap no run's span (talk before, between and
   after the runs, before and after the recording included), in time order.
   A sentence that spans a run's boundary is inside. */
function outsideRuns(sentences, spans) {
  return (sentences || [])
    .filter((x) => Number.isFinite(x.startMs) && Number.isFinite(x.endMs) &&
      !(spans || []).some((sp) => overlaps(x.startMs, x.endMs, sp.startMs, sp.endMs)))
    .sort(_byTime);
}

/* Lane E (E6): whether the Overview's "From the transcript" lists all the
   talk rather than the talk outside the transactions: when no transaction
   is marked (the runs are only the implicit one of a project without a
   recording, `implicitId`, or none), every sentence is inside "the"
   transaction, and outside it the list would always be empty. */
function listsAllTalk(runs, implicitId) {
  return (runs || []).every((r) => !!r && !!implicitId && r.caseId === implicitId);
}

function normalizeSpace(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

/* Whether a text field already holds the sentence (whitespace-normalized). */
function isAdded(fieldText, sentenceText) {
  const t = normalizeSpace(sentenceText);
  return !!t && normalizeSpace(fieldText).includes(t);
}

/* The field with the sentence appended: on a new line when the field is not
   empty (its trailing whitespace dropped), the text only. */
function appendText(fieldText, sentenceText) {
  const field = String(fieldText == null ? "" : fieldText);
  const t = normalizeSpace(sentenceText);
  if (!t) return field;
  const base = field.replace(/\s+$/, "");
  return base ? base + "\n" + t : t;
}

/* Time from the transcript's start: "m:ss", or "h:mm:ss" from an hour on. */
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
}

/* The distinct speaker names, in the order they first speak. */
function speakersOf(sentences) {
  const seen = [];
  for (const x of sentences || []) if (x.speaker && !seen.includes(x.speaker)) seen.push(x.speaker);
  return seen;
}

/* The sentences of one speaker ("" for all) whose text contains the query
   (case-insensitive, whitespace-normalized; "" for all). */
function filterSentences(sentences, speaker, query) {
  const q = normalizeSpace(query).toLowerCase();
  return (sentences || []).filter((x) => (!speaker || x.speaker === speaker) &&
    (!q || normalizeSpace(x.text).toLowerCase().includes(q)));
}

/* The transcript offset that puts the sentence starting at `startS` at the
   clicked wall time, or null. */
function offsetForSync(clickedWallMs, startedAt, startS) {
  const base = Date.parse(startedAt);
  if (!Number.isFinite(base) || !Number.isFinite(clickedWallMs) || !Number.isFinite(startS)) return null;
  return Math.round(clickedWallMs - base - startS * 1000);
}

function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* When a placed sentence starts, as the time since the recording started
   (the one clock, AD-26); an unplaced one (or no `originMs`) keeps the time
   from the transcript's own start. A sentence said before the recording
   started says how long before ("0:28 before"), never a negative time
   (AD-29); within a second of the start it reads "0:00". */
function sentenceClock(s, originMs) {
  if (!(Number.isFinite(s.startMs) && Number.isFinite(originMs))) return formatClock(s.startS);
  const since = s.startMs - originMs;
  return since <= -1000 ? clock(-since) + " before" : clock(Math.max(0, since));
}

/* The time cell's tooltip: what a time before the recording means. */
function _clockTitle(s, originMs) {
  return Number.isFinite(s.startMs) && Number.isFinite(originMs) && s.startMs - originMs <= -1000
    ? ' title="' + _esc("Said " + clock(originMs - s.startMs) + " before the recording started") + '"' : "";
}

/* One sentence as every list shows it (HTML): time, speaker, text. */
function sentenceRowHtml(s, originMs) {
  return '<span class="tr-time"' + _clockTitle(s, originMs) + ">" + _esc(sentenceClock(s, originMs)) + "</span>" +
    (s.speaker ? '<span class="tr-speaker">' + _esc(s.speaker) + "</span>" : "") +
    '<span class="tr-text">' + _esc(s.text) + "</span>";
}

function _count(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* The toast after an import: "Transcript attached: 214 sentences, 3
   speakers." and, when it is not synced, where to sync it. */
function attachedMessage(transcript, synced) {
  const segs = segmentsOf(transcript);
  const n = speakersOf(segs).length;
  return "Transcript attached: " + _count(segs.length, "sentence", "sentences") + ", " +
    (n ? _count(n, "speaker", "speakers") : "no speaker names") + "." +
    (synced ? "" : " Sync it on the Timeline to place it.");
}

module.exports = {
  VERSION, STEP_LEAD_MS, NOT_SYNCED_LINE, ATTACH_TITLE, REPLACE_TITLE, REMOVE_TITLE, ADD_TITLE,
  validateTranscript, segmentsOf, effectiveOffsetMs, storedOffsetFor, videoIdOf, wallMs, placeTranscript,
  transcriptsOf, partsOf, forSession, bindsBeforeChainEdit,
  overlaps, stepWindow, prevEndMs, sentencesInWindow, sentencesForStep, runSpans, outsideRuns, listsAllTalk,
  normalizeSpace, isAdded, appendText, formatClock, speakersOf, filterSentences,
  offsetForSync, attachedMessage, sentenceRowHtml, sentenceClock,
};
