/*
 * transcript-list.js: the list the Timeline's Transcript tab shows (lane E,
 * item E3), the pure side. No DOM, no State; transcript-list.test.js drives
 * it. The DOM side is flow-view-transcript.js (the tab).
 *
 * The tab lists every placed sentence of every transcript of the project on
 * the one clock (transcript-model.js partsOf places them), in time order; a
 * stretch put aside on the Timeline (left-out.js) stands in one row for the
 * sentences said in it. The speaker shows where it changes. A search and a
 * speaker narrow the list by hiding rows: the list is built once and never
 * again while the analyst types or the video plays (a ninety minute call is
 * thousands of sentences).
 */

"use strict";

const TM = require("./transcript-model.js");
const LeftOut = require("./left-out.js");

/* The tab's model: { rows, speakers, unplaced, total }. rows: in time order,
   { kind: "sentence", s, speakerShown } or { kind: "gap", gap } (a stretch,
   left-out.js stretchesOf); `speakerShown` when the speaker differs from the
   sentence row before it (a gap between them shows it again). speakers: the
   names in the order they first speak. unplaced: the transcripts not placed
   on the clock yet ({ file, number }). total: the sentence rows. `parts` as
   transcript-model.js partsOf, `stretches` as left-out.js stretchesOf. */
function tabModel(parts, stretches) {
  const placed = [];
  const unplaced = [];
  (parts || []).forEach((p, k) => {
    if (!p || !p.synced) { if (p) unplaced.push({ file: p.file, number: p.number }); return; }
    p.sentences.forEach((s, i) => { if (Number.isFinite(s.startMs)) placed.push({ s, k, i }); });
  });
  placed.sort((a, b) => (a.s.startMs - b.s.startMs) || (a.k - b.k) || (a.i - b.i));
  const sentences = placed.map((x) => x.s);
  const rows = [];
  let prevSpeaker;
  for (const item of LeftOut.omitSentences(sentences, stretches)) {
    if (item.gap) { rows.push({ kind: "gap", gap: item.gap }); prevSpeaker = undefined; continue; }
    const s = item.sentence;
    rows.push({ kind: "sentence", s, speakerShown: !!s.speaker && s.speaker !== prevSpeaker });
    prevSpeaker = s.speaker;
  }
  return { rows, speakers: TM.speakersOf(sentences), unplaced, total: rows.filter((r) => r.kind === "sentence").length };
}

/* The index in `starts` (the sentence rows' start times, ascending) of the
   sentence at the moment `ms`: the last one that started at or before it;
   -1 before the first or when `ms` is unknown. A binary search: it runs on
   every tick of the playhead. */
function currentIndex(starts, ms) {
  if (!Number.isFinite(ms) || !starts || !starts.length || ms < starts[0]) return -1;
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= ms) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* The sentence the tab marks at the moment `ms` ("the sentence at this
   moment"): currentIndex, and none while the moment is inside a stretch put
   aside (`stretches`, left-out.js stretchesOf). The one rule of the tab and
   of the caption under the video. */
function sentenceIndexAt(starts, ms, stretches) {
  const i = currentIndex(starts, ms);
  return i >= 0 && LeftOut.inside(stretches, ms) ? -1 : i;
}

/* The sentence the caption under the video shows at `ms` (lane W2, plan
   section 11.1): the tab's sentence at this moment (sentenceIndexAt) while
   it is being said, so the caption is empty from its end to the next
   sentence's start. `sentences` the tab's sentence rows, `starts` their
   start times. -1 for none. */
function sayingAt(sentences, starts, ms, stretches) {
  const i = sentenceIndexAt(starts, ms, stretches);
  const s = i >= 0 && sentences ? sentences[i] : null;
  if (!s) return -1;
  return Number.isFinite(s.endMs) && ms >= s.endMs ? -1 : i;
}

/* The query as the search reads it: whitespace joined, lower case. */
function queryOf(text) {
  return TM.normalizeSpace(text).toLowerCase();
}

/* Whether a sentence row is shown for the search `q` (queryOf) and the
   speaker (`speaker` "": everyone). */
function shows(s, q, speaker) {
  if (speaker && s.speaker !== speaker) return false;
  return !q || TM.normalizeSpace(s.text).toLowerCase().includes(q);
}

function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* A sentence's text as HTML with each match of `q` (queryOf) marked. The
   text is read with its whitespace joined, as the search reads it. */
function markedHtml(text, q) {
  const t = TM.normalizeSpace(text);
  if (!q) return _esc(t);
  const low = t.toLowerCase();
  let out = "", at = 0;
  for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) {
    out += _esc(t.slice(at, i)) + "<mark>" + _esc(t.slice(i, i + q.length)) + "</mark>";
    at = i + q.length;
  }
  return out + _esc(t.slice(at));
}

/* What the count beside the search says: "340 sentences" while nothing
   narrows the list, else "12 of 340". */
function countText(shown, total, narrowed) {
  if (!narrowed) return total + (total === 1 ? " sentence" : " sentences");
  return shown + " of " + total;
}

module.exports = { tabModel, currentIndex, sentenceIndexAt, sayingAt, queryOf, shows, markedHtml, countText };
