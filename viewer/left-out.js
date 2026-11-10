/*
 * left-out.js: the stretches put aside on the Timeline (lane E, items E3 and
 * E4), the pure side. No DOM, no State: the player, the Transcript tab and
 * the Timeline read the rules here, and left-out.test.js drives them.
 *
 * One mark, annotations.excluded_ranges ({ start, end } ISO), read two ways:
 *   - in a recording it is "Left out of the analysis" (lane CC): the
 *     analysis drafts the steps without what was recorded there, and the
 *     differences and the maps cut the transaction's trace at it;
 *   - in a project without a recording (C16: made from a video or from
 *     nothing) it is "Not part of the process": a detour of a call, which
 *     nothing analyzes, so the steps, the maps and the PDD do not read it
 *     (analysisRanges).
 * In both, playing skips it (skipTo) and the Transcript tab leaves out what
 * was said in it (omitSentences): a thirty minute detour is never played or
 * read again, until Include again brings it back.
 */

"use strict";

const AC = require("./analyst-content.js");
const { isoMs } = require("./run-differences.js");

/* The stretches of `annotations`, readable ones only (start before end), in
   time order, overlapping or touching ones joined: [{ startMs, endMs,
   ranges }], `ranges` the entries joined into it (Include again removes
   them). */
function stretchesOf(annotations) {
  const list = annotations && Array.isArray(annotations.excluded_ranges) ? annotations.excluded_ranges : [];
  const read = [];
  for (const r of list) {
    const a = isoMs(r && r.start), b = isoMs(r && r.end);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) read.push({ startMs: a, endMs: b, range: r });
  }
  read.sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs);
  const out = [];
  for (const r of read) {
    const last = out[out.length - 1];
    if (last && r.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, r.endMs);
      last.ranges.push(r.range);
    } else out.push({ startMs: r.startMs, endMs: r.endMs, ranges: [r.range] });
  }
  return out;
}

/* The excluded ranges the analysis and its readers (the differences in
   Steps, the live map's cuts) take: the entries in a recording, none in a
   project without one, where a stretch put aside is not part of the
   process and changes nothing in the steps, the maps or the PDD. */
function analysisRanges(sess) {
  if (!sess || !AC.hasRecording(sess)) return [];
  const a = sess.annotations;
  return a && Array.isArray(a.excluded_ranges) ? a.excluded_ranges : [];
}

/* Where playing goes on after the moment `prevMs` played on to `nowMs`:
   the end of the stretch whose start it ran into (prevMs before the start,
   nowMs at or after it, and before its end), else null. A seek into a
   stretch is no running into it (the player resets prevMs on a seek), so
   it plays from there to its end: the analyst can still watch it before
   including it again. `stretches` as stretchesOf. */
function skipTo(stretches, prevMs, nowMs) {
  if (!Number.isFinite(prevMs) || !Number.isFinite(nowMs) || nowMs <= prevMs) return null;
  for (const s of stretches || []) {
    if (prevMs < s.startMs && nowMs >= s.startMs && nowMs < s.endMs) return s.endMs;
  }
  return null;
}

/* The first stretch start after `ms`, or null: the player checks again
   right there, so a skip never waits for the next time update. */
function nextStart(stretches, ms) {
  if (!Number.isFinite(ms)) return null;
  for (const s of stretches || []) if (s.startMs > ms) return s.startMs;
  return null;
}

/* Whether the moment `ms` lies in a stretch (its start included, its end
   not). */
function inside(stretches, ms) {
  return Number.isFinite(ms) && (stretches || []).some((s) => ms >= s.startMs && ms < s.endMs);
}

/* The sentences the Transcript tab lists, in order, with each stretch that
   holds one of them in their place: the items are { sentence } or { gap:
   stretch } (stretchesOf), in time order. A sentence is inside a stretch
   when it starts in it; one without a time is never inside. */
function omitSentences(sentences, stretches) {
  const out = [];
  let lastGap = null;
  for (const x of sentences || []) {
    const t = x && x.startMs;
    const s = Number.isFinite(t) ? (stretches || []).find((g) => t >= g.startMs && t < g.endMs) : null;
    if (!s) { out.push({ sentence: x }); continue; }
    if (s !== lastGap) { out.push({ gap: s }); lastGap = s; }
  }
  return out;
}

/* The sentences that are not inside a stretch of `annotations` (the step
   panel's and the step editor's "Said" lists): the rule omitSentences
   reads, without the gap rows. */
function saidOutside(sentences, annotations) {
  const stretches = stretchesOf(annotations);
  if (!stretches.length) return sentences || [];
  return (sentences || []).filter((x) => !inside(stretches, x && x.startMs));
}

/* The words of the mark in a project of either kind: what the Timeline's
   selection offers, what a band and the legend say. */
function wordsFor(recorded) {
  return recorded
    ? { act: "Leave out of the analysis", band: "Left out of the analysis", short: "Left out", legend: "left out of the analysis" }
    : { act: "Not part of the process", band: "Not part of the process", short: "Not part", legend: "not part of the process" };
}

module.exports = { stretchesOf, analysisRanges, skipTo, nextStart, inside, omitSentences, saidOutside, wordsFor };
