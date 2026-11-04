/*
 * video-chain.js: the videos of a project on its one timeline (contract C23,
 * 2.0.6). Pure: no DOM, no State; unit-tested (video-chain.test.js).
 *
 * The owner: "10th minute on the timeline is 10th minute on the timeline,
 * regardless if there are 1 or 7 videos on the timeline". A project holds a
 * list of videos, annotations.external_videos, each a clip:
 *   { id, path, offset_ms, in_ms, out_ms, length_ms, attached_at }
 * offset_ms places the file's own 0 on the project clock (ms after
 * manifest.started_at), as external_video.offset_ms did; in_ms and out_ms
 * trim it (the part of the file used; out_ms null: to its end); length_ms is
 * the file's length as measured when it was added (null when not known). A
 * clip covers [offset_ms + in_ms, offset_ms + out) of the clock. A project of
 * 2.0.5 or older has one video, annotations.external_video, read here as a
 * list of one.
 *
 * In a project made from videos (no recording) the clips run back to back, as
 * in a video editor: a video added goes after the last one, and a trim, a
 * replace or a remove that changes a clip's length moves the clips after it,
 * and everything marked on them with them (transactions, steps, notes and
 * screenshots at a moment), so a mark stays on what it marks: shiftMarks. A
 * trim that would cut away a mark is refused (cutBlocks); a step that only
 * runs into the part cut away is shortened to where the cut starts. In a
 * recording the clips are placed by sync on the recording's clock, and a
 * trim, a replace or a remove moves nothing else.
 */

"use strict";

/* The least a clip keeps. */
const MIN_CLIP_MS = 1000;

function _num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/* The project's clips, read from annotations (external_videos, else the
   one external_video), each normalized: { id, path, offset_ms, in_ms,
   out_ms, length_ms, attached_at }, in the order they start on the clock. A
   clip without a path is left out. */
function clipsOf(anno) {
  const a = anno && typeof anno === "object" ? anno : {};
  const raw = Array.isArray(a.external_videos) ? a.external_videos
    : (a.external_video && typeof a.external_video === "object" ? [Object.assign({ id: "v1" }, a.external_video)] : []);
  const seen = new Set();
  const out = [];
  raw.forEach((c, i) => {
    if (!c || typeof c !== "object" || typeof c.path !== "string" || !c.path.trim()) return;
    let id = typeof c.id === "string" && c.id ? c.id : "v" + (i + 1);
    while (seen.has(id)) id += "+";
    seen.add(id);
    const inMs = Math.max(0, _num(c.in_ms) || 0);
    const outMs = _num(c.out_ms);
    out.push({
      id, path: c.path, offset_ms: _num(c.offset_ms) || 0, in_ms: inMs,
      out_ms: outMs != null && outMs > inMs ? outMs : null,
      length_ms: _num(c.length_ms) != null && c.length_ms > 0 ? c.length_ms : null,
      attached_at: typeof c.attached_at === "string" ? c.attached_at : null,
    });
  });
  return out.sort((x, y) => (x.offset_ms + x.in_ms) - (y.offset_ms + y.in_ms));
}

/* Write `clips` back as annotations.external_videos (the old single key
   goes). */
function writeClips(anno, clips) {
  anno.external_videos = (clips || []).map((c) => {
    const o = { id: c.id, path: c.path, offset_ms: Math.round(c.offset_ms || 0), in_ms: Math.round(c.in_ms || 0),
      out_ms: c.out_ms == null ? null : Math.round(c.out_ms) };
    if (c.length_ms != null) o.length_ms = Math.round(c.length_ms);
    if (c.attached_at) o.attached_at = c.attached_at;
    return o;
  });
  delete anno.external_video;
  return anno.external_videos;
}

/* A clip's length in ms: what `lengthOf(clip)` measured, else its stored
   length_ms, else null. */
function _length(clip, lengthOf) {
  const m = typeof lengthOf === "function" ? _num(lengthOf(clip)) : null;
  return m != null && m > 0 ? m : clip.length_ms;
}

/* Where a clip's kept part ends in the file (ms), or null when unknown. */
function outOf(clip, lengthOf) {
  if (clip.out_ms != null) return clip.out_ms;
  const len = _length(clip, lengthOf);
  return len != null ? len : null;
}

/* A clip on the clock: { clip, startRel, endRel } (ms after started_at;
   endRel null while its length is not known). */
function spanOf(clip, lengthOf) {
  const o = outOf(clip, lengthOf);
  return { clip, startRel: clip.offset_ms + clip.in_ms, endRel: o == null ? null : clip.offset_ms + o };
}

function spansOf(clips, lengthOf) { return (clips || []).map((c) => spanOf(c, lengthOf)); }

/* Where the last clip ends on the clock, or null (no clip, or a length not
   known yet). */
function chainEndRel(clips, lengthOf) {
  let end = null;
  for (const s of spansOf(clips, lengthOf)) {
    if (s.endRel == null) return null;
    end = end == null ? s.endRel : Math.max(end, s.endRel);
  }
  return end;
}

/* The clip that shows the moment `tRel` and the time in its file:
   { clip, sourceMs, span }, or null. A clip whose length is not known yet
   covers until the next clip starts. */
function clipAtRel(clips, lengthOf, tRel) {
  const spans = spansOf(clips, lengthOf);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const end = s.endRel != null ? s.endRel : (spans[i + 1] ? spans[i + 1].startRel : Infinity);
    if (tRel >= s.startRel && tRel < end) return { clip: s.clip, sourceMs: tRel - s.clip.offset_ms, span: s };
  }
  return null;
}

/* The clip that starts where `clip` ends (back to back), or the next one
   after it on the clock, or null. */
function nextClip(clips, lengthOf, clip) {
  const spans = spansOf(clips, lengthOf);
  const i = spans.findIndex((s) => s.clip.id === clip.id);
  return i >= 0 && spans[i + 1] ? spans[i + 1].clip : null;
}

/* The offset a video added after the others takes: where the last one ends
   (0 with none). Null while a length is not known. */
function appendOffset(clips, lengthOf) {
  if (!(clips || []).length) return 0;
  return chainEndRel(clips, lengthOf);
}

/* A fresh clip id, not one of `clips`. */
function newClipId(clips) {
  const used = new Set((clips || []).map((c) => c.id));
  for (let n = 1; ; n++) if (!used.has("v" + n)) return "v" + n;
}

/* ---- What is marked on the clock -------------------------------------- */

function _ms(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; }
function _iso(ms) { return new Date(ms).toISOString(); }

function _walk(steps, fn) {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s !== "object") continue;
    fn(s);
    if (Array.isArray(s.sub_steps)) _walk(s.sub_steps, fn);
  }
}

/* The marks of a project with a time on the clock in [aMs, bMs) (absolute
   ms), the ones a cut there would take away: steps that start there, the
   inserted markers (a transaction's start or end), notes and screenshots at
   a moment there. { steps, markers, notes, shots }. */
function marksIn(anno, aMs, bMs) {
  const a = anno || {};
  const inside = (t) => Number.isFinite(t) && t >= aMs && t < bMs;
  const steps = [];
  _walk(a.steps, (s) => { if (s.time_range && inside(_ms(s.time_range.start))) steps.push(s); });
  const markers = (Array.isArray(a.marker_edits) ? a.marker_edits : [])
    .filter((e) => e && e.op === "insert" && inside(_ms(e.timestamp)));
  const notes = (Array.isArray(a.analyst_notes) ? a.analyst_notes : []).filter((n) => n && !n.step_id && inside(_ms(n.at)));
  const shots = (Array.isArray(a.analyst_screenshots) ? a.analyst_screenshots : []).filter((x) => x && inside(_ms(x.at)));
  return { steps, markers, notes, shots };
}

function _count(m) { return m.steps.length + m.markers.length + m.notes.length + m.shots.length; }

/* Why a cut of [aMs, bMs) is refused, in one sentence, or "" when nothing
   marked is there (`what`: "the part you trim away"). */
function cutBlocks(anno, aMs, bMs, originMs, what) {
  const m = marksIn(anno, aMs, bMs);
  if (!_count(m)) return "";
  const at = (ms) => { const d = Math.max(0, Math.round((ms - originMs) / 1000)); return Math.floor(d / 60) + ":" + String(d % 60).padStart(2, "0"); };
  const first = m.steps[0] ? '"' + (String(m.steps[0].name || "").trim() || "a step") + '" starts there, at ' + at(_ms(m.steps[0].time_range.start))
    : m.markers[0] ? "a transaction " + (m.markers[0].marker_type === "end" ? "ends" : "starts") + " there, at " + at(_ms(m.markers[0].timestamp))
      : m.notes[0] ? "a note is pinned there, at " + at(_ms(m.notes[0].at))
        : "a screenshot is taken there, at " + at(_ms(m.shots[0].at));
  return "Something is marked in " + (what || "that part") + ": " + first + ". Move or delete it first, or trim less.";
}

/* Take the marks of [aMs, bMs) away (a video removed with what was marked
   on it): steps that start there (the step lists, at every level), inserted
   markers, notes and screenshots at a moment there. Returns what went, as
   marksIn. */
function removeMarksIn(anno, aMs, bMs) {
  const m = marksIn(anno, aMs, bMs);
  const gone = new Set(m.steps);
  const prune = (list) => {
    if (!Array.isArray(list)) return list;
    const keep = list.filter((s) => !gone.has(s));
    for (const s of keep) if (s && Array.isArray(s.sub_steps)) s.sub_steps = prune(s.sub_steps);
    return keep;
  };
  if (Array.isArray(anno.steps)) anno.steps = prune(anno.steps);
  const markers = new Set(m.markers), notes = new Set(m.notes), shots = new Set(m.shots);
  if (Array.isArray(anno.marker_edits)) anno.marker_edits = anno.marker_edits.filter((e) => !markers.has(e));
  if (Array.isArray(anno.analyst_notes)) anno.analyst_notes = anno.analyst_notes.filter((n) => !notes.has(n));
  if (Array.isArray(anno.analyst_screenshots)) anno.analyst_screenshots = anno.analyst_screenshots.filter((x) => !shots.has(x));
  return m;
}

/* A step that only runs into the part [aMs, bMs) cut away (it starts before
   it) ends where the cut starts. Returns the steps shortened. */
function clampInto(anno, aMs, bMs) {
  const out = [];
  _walk(anno && anno.steps, (s) => {
    const tr = s.time_range;
    if (!tr) return;
    const a = _ms(tr.start), b = _ms(tr.end);
    if (Number.isFinite(a) && Number.isFinite(b) && a < aMs && b > aMs && b <= bMs) {
      s.time_range = { start: tr.start, end: _iso(aMs) };
      out.push(s);
    }
  });
  return out;
}

/* Move by `deltaMs` everything marked at or after `fromMs` on the clock
   (absolute ms): a step's start and end (each on its own: a step across
   `fromMs` stretches or shrinks), inserted markers (`onMarker(edit, oldIso)`
   is told before each moves, for marker-edits' applied_timestamp), notes
   and screenshots at a moment, stretches left out, and the clips that start
   there (their offset; not opts.exceptClip, the clip a trim sets itself).
   `originMs`: manifest.started_at. Returns how many marks moved. */
function shiftMarks(anno, fromMs, deltaMs, originMs, opts) {
  if (!deltaMs) return 0;
  const o = opts || {};
  let n = 0;
  const move = (iso) => { const t = _ms(iso); return Number.isFinite(t) && t >= fromMs ? _iso(t + deltaMs) : null; };
  _walk(anno.steps, (s) => {
    const tr = s.time_range;
    if (!tr) return;
    const a = move(tr.start), b = move(tr.end);
    if (a || b) { s.time_range = { start: a || tr.start, end: b || tr.end }; n++; }
  });
  for (const e of Array.isArray(anno.marker_edits) ? anno.marker_edits : []) {
    if (!e || e.op !== "insert") continue;
    const t = move(e.timestamp);
    if (!t) continue;
    if (typeof o.onMarker === "function") o.onMarker(e, e.timestamp);
    e.timestamp = t;
    n++;
  }
  for (const key of ["analyst_notes", "analyst_screenshots"]) {
    for (const x of Array.isArray(anno[key]) ? anno[key] : []) {
      const t = x && move(x.at);
      if (t) { x.at = t; n++; }
    }
  }
  for (const r of Array.isArray(anno.excluded_ranges) ? anno.excluded_ranges : []) {
    const a = r && move(r.start), b = r && move(r.end);
    if (a) r.start = a;
    if (b) r.end = b;
    if (a || b) n++;
  }
  const clips = clipsOf(anno);
  let moved = false;
  for (const c of clips) {
    if (c.id !== o.exceptClip && originMs + c.offset_ms + c.in_ms >= fromMs) { c.offset_ms += deltaMs; moved = true; }
  }
  if (moved) writeClips(anno, clips);
  return n;
}

/* ---- The edits of a clip ---------------------------------------------------- */

/* A trim of one side of clip `id` to `sourceMs` (the time in its file),
   planned: { clip, inMs, outMs, offsetMs, cutA, cutB, fromRel, deltaMs }
   where [cutA, cutB) is the part of the clock that goes (relative ms; empty
   when the clip grows) and, back to back, everything from `fromRel` on moves
   by deltaMs; { why } when it cannot be. `lengthOf` as above. */
function planTrim(clips, lengthOf, id, edge, sourceMs) {
  const clip = (clips || []).find((c) => c.id === id);
  if (!clip) return { why: "That video is not in this project." };
  const len = _length(clip, lengthOf);
  const out = outOf(clip, lengthOf);
  if (out == null || len == null) return { why: "The video's length is not known yet: play it once, then trim it." };
  const t = Math.round(sourceMs);
  if (edge === "start") {
    const inMs = Math.max(0, Math.min(t, out - MIN_CLIP_MS));
    const delta = inMs - clip.in_ms;   // > 0 cuts, < 0 grows
    const startRel = clip.offset_ms + clip.in_ms;
    return { clip, inMs, outMs: clip.out_ms, offsetMs: clip.offset_ms - delta,
      cutA: startRel, cutB: delta > 0 ? startRel + delta : startRel,
      fromRel: clip.offset_ms + Math.max(clip.in_ms, inMs), deltaMs: -delta };
  }
  const outMs = Math.min(len, Math.max(t, clip.in_ms + MIN_CLIP_MS));
  const delta = outMs - out;   // < 0 cuts, > 0 grows
  const endRel = clip.offset_ms + out;
  return { clip, inMs: clip.in_ms, outMs: outMs >= len ? null : outMs, offsetMs: clip.offset_ms,
    cutA: delta < 0 ? endRel + delta : endRel, cutB: endRel, fromRel: endRel, deltaMs: delta };
}

/* Apply a trim planned by planTrim to `anno`. Back to back (`ripple`, a
   project made from videos) the part cut away must hold no mark (a step
   that only runs into it ends where it starts), and the marks and the clips
   after it move; in a recording only the clip changes. opts.onMarker as
   shiftMarks. Returns { ok: true } or { why }. */
function applyTrim(anno, plan, originMs, ripple, opts) {
  if (!plan || plan.why) return { why: (plan && plan.why) || "Nothing to trim." };
  const a = originMs + plan.cutA, b = originMs + plan.cutB;
  if (ripple && b > a) {
    const why = cutBlocks(anno, a, b, originMs, "the part you trim away");
    if (why) return { why };
    clampInto(anno, a, b);
  }
  if (ripple && plan.deltaMs) {
    shiftMarks(anno, originMs + plan.fromRel, plan.deltaMs, originMs,
      { onMarker: opts && opts.onMarker, exceptClip: plan.clip.id });
  }
  const clips = clipsOf(anno);
  const c = clips.find((x) => x.id === plan.clip.id);
  if (!c) return { why: "That video is not in this project." };
  c.in_ms = plan.inMs;
  c.out_ms = plan.outMs;
  if (ripple) c.offset_ms = plan.offsetMs;
  writeClips(anno, clips);
  return { ok: true };
}

/* Remove clip `id`. Back to back, what was marked on it goes with it (a
   step that only runs into it ends where it started) and what follows moves
   up by its length; in a recording only the clip goes. Returns { ok: true,
   gone } (gone: marksIn of what went, null in a recording) or { why }. */
function applyRemove(anno, lengthOf, id, originMs, ripple, opts) {
  const clips = clipsOf(anno);
  const c = clips.find((x) => x.id === id);
  if (!c) return { why: "That video is not in this project." };
  const span = spanOf(c, lengthOf);
  writeClips(anno, clips.filter((x) => x.id !== id));
  if (!ripple || span.endRel == null) return { ok: true, gone: null };
  const a = originMs + span.startRel, b = originMs + span.endRel;
  const gone = removeMarksIn(anno, a, b);
  clampInto(anno, a, b);
  shiftMarks(anno, b, -(b - a), originMs, { onMarker: opts && opts.onMarker });
  return { ok: true, gone };
}

/* What removing clip `id` would take with it, back to back (marksIn), for
   the question asked first. */
function marksOnClip(anno, lengthOf, id, originMs) {
  const c = clipsOf(anno).find((x) => x.id === id);
  if (!c) return marksIn(anno, 0, 0);
  const span = spanOf(c, lengthOf);
  return span.endRel == null ? marksIn(anno, 0, 0) : marksIn(anno, originMs + span.startRel, originMs + span.endRel);
}

/* Replace clip `id`'s file with `path` (its length `lengthMs`): the clip
   keeps its place and its trim (its end within the new file). Back to back,
   a kept part that ends sooner or later moves what follows (a mark in the
   part that goes refuses it). Returns { ok: true } or { why }. */
function applyReplace(anno, lengthOf, id, path, lengthMs, originMs, ripple, opts) {
  const clips = clipsOf(anno);
  const c = clips.find((x) => x.id === id);
  if (!c) return { why: "That video is not in this project." };
  const len = _num(lengthMs);
  if (!(len > 0)) return { why: "The new video's length could not be read." };
  if (len - c.in_ms < MIN_CLIP_MS) return { why: "The new video is shorter than where this one's trimmed start is." };
  const oldOut = outOf(c, lengthOf);
  const newOut = c.out_ms != null ? Math.min(c.out_ms, len) : len;
  const delta = oldOut == null ? 0 : newOut - oldOut;
  if (ripple && delta < 0) {
    const a = originMs + c.offset_ms + newOut, b = originMs + c.offset_ms + oldOut;
    const why = cutBlocks(anno, a, b, originMs, "the part the new video does not have");
    if (why) return { why };
    clampInto(anno, a, b);
  }
  if (ripple && delta) {
    shiftMarks(anno, originMs + c.offset_ms + oldOut, delta, originMs, { onMarker: opts && opts.onMarker, exceptClip: id });
  }
  const now = clipsOf(anno);
  const k = now.find((x) => x.id === id);
  k.path = path;
  k.length_ms = Math.round(len);
  k.out_ms = newOut >= len ? null : newOut;
  k.attached_at = (opts && opts.at) || k.attached_at;
  writeClips(anno, now);
  return { ok: true };
}

/* Add a clip: { path, length_ms, attached_at } at `offsetMs` (back to back:
   appendOffset; in a recording: where its sync puts it). Returns the clip. */
function applyAppend(anno, entry, offsetMs) {
  const clips = clipsOf(anno);
  const clip = { id: newClipId(clips), path: entry.path, offset_ms: Math.round(offsetMs || 0), in_ms: 0, out_ms: null,
    length_ms: _num(entry.length_ms) != null ? Math.round(entry.length_ms) : null, attached_at: entry.attached_at || null };
  clips.push(clip);
  writeClips(anno, clips);
  return clip;
}

module.exports = {
  MIN_CLIP_MS, clipsOf, writeClips, outOf, spanOf, spansOf, chainEndRel, clipAtRel, nextClip, appendOffset, newClipId,
  marksIn, cutBlocks, removeMarksIn, clampInto, shiftMarks, planTrim,
  applyTrim, applyRemove, marksOnClip, applyReplace, applyAppend,
};
