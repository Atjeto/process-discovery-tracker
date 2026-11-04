"use strict";

/* video-chain.js (contract C23, 2.0.6): the videos of a project on its one
   timeline, back to back, trimmed, and what moves with them. */

const test = require("node:test");
const assert = require("node:assert/strict");
const VC = require("./video-chain.js");

const ORIGIN = Date.parse("2026-11-04T10:00:00Z");
const at = (sec) => new Date(ORIGIN + sec * 1000).toISOString();
const rel = (iso) => (Date.parse(iso) - ORIGIN) / 1000;
const len = (clip) => ({ a: 60000, b: 40000, c: 30000 })[clip.path];

/* Three videos back to back: a 0 to 60 s, b 60 to 100 s, c 100 to 130 s. */
function project() {
  return {
    external_videos: [
      { id: "v1", path: "a", offset_ms: 0, in_ms: 0, out_ms: null, length_ms: 60000 },
      { id: "v2", path: "b", offset_ms: 60000, in_ms: 0, out_ms: null, length_ms: 40000 },
      { id: "v3", path: "c", offset_ms: 100000, in_ms: 0, out_ms: null, length_ms: 30000 },
    ],
    steps: [
      { step_id: "s1", name: "Open", state: "manually_authored", time_range: { start: at(5), end: at(30) } },
      { step_id: "s2", name: "Check", state: "manually_authored", time_range: { start: at(30), end: at(70) } },
      { step_id: "s3", name: "Send", state: "manually_authored", time_range: { start: at(70), end: at(110) } },
      { step_id: "s4", name: "Close", state: "manually_authored", time_range: { start: at(110), end: at(130) } },
    ],
    marker_edits: [
      { id: "m1", op: "insert", marker_type: "start", timestamp: at(2), ts: at(0) },
      { id: "m2", op: "insert", marker_type: "end", timestamp: at(120), ts: at(0) },
    ],
    analyst_notes: [{ id: "n1", text: "x", step_id: null, at: at(105) }],
  };
}
const steps = (a) => a.steps.map((s) => s.step_id + " " + rel(s.time_range.start) + "-" + rel(s.time_range.end));
const offsets = (a) => VC.clipsOf(a).map((c) => c.id + "@" + c.offset_ms / 1000 + "[" + c.in_ms / 1000 + "," + (c.out_ms == null ? "end" : c.out_ms / 1000) + "]");

test("clipsOf reads a project of 2.0.5 (one external_video) as a list of one, and the list in clock order", () => {
  assert.deepEqual(VC.clipsOf({ external_video: { path: "video/a.mp4", offset_ms: 2000 } }).map((c) => [c.id, c.offset_ms, c.in_ms, c.out_ms]),
    [["v1", 2000, 0, null]]);
  assert.deepEqual(VC.clipsOf({ external_videos: [{ id: "b", path: "b", offset_ms: 9000 }, { id: "a", path: "a", offset_ms: 0 }, { path: "" }] })
    .map((c) => c.id), ["a", "b"]);
  const anno = { external_video: { path: "x" } };
  VC.writeClips(anno, VC.clipsOf(anno));
  assert.equal(anno.external_video, undefined);
  assert.equal(anno.external_videos.length, 1);
});

test("the clock: 1 or 7 videos, a moment is the same moment; which file shows it and where in it", () => {
  const clips = VC.clipsOf(project());
  assert.equal(VC.chainEndRel(clips, len), 130000);
  assert.deepEqual(VC.clipAtRel(clips, len, 75000) && [VC.clipAtRel(clips, len, 75000).clip.id, VC.clipAtRel(clips, len, 75000).sourceMs], ["v2", 15000]);
  assert.equal(VC.clipAtRel(clips, len, 130000), null, "past the end");
  assert.equal(VC.nextClip(clips, len, clips[0]).id, "v2");
  assert.equal(VC.appendOffset(clips, len), 130000, "a video added goes after the last");
  assert.equal(VC.appendOffset([], len), 0);
  assert.equal(VC.newClipId(clips), "v4");
});

test("trimming a video's end, back to back: the videos after it and what is marked on them move up; a step that runs into the cut ends there", () => {
  const anno = project();
  const clips = VC.clipsOf(anno);
  const plan = VC.planTrim(clips, len, "v1", "end", 50000);
  assert.equal(VC.applyTrim(anno, plan, ORIGIN, true).ok, true);
  assert.deepEqual(offsets(anno), ["v1@0[0,50]", "v2@50[0,end]", "v3@90[0,end]"]);
  // s2 started at 30 and ran to 70: its end moves with v2's content (70 -> 60).
  assert.deepEqual(steps(anno), ["s1 5-30", "s2 30-60", "s3 60-100", "s4 100-120"]);
  assert.deepEqual(anno.marker_edits.map((e) => rel(e.timestamp)), [2, 110]);
  assert.equal(rel(anno.analyst_notes[0].at), 95);
});

test("a trim that would cut away a mark is refused, saying what is there; nothing changes", () => {
  const anno = project();
  const before = JSON.stringify(anno);
  const plan = VC.planTrim(VC.clipsOf(anno), len, "v1", "end", 20000);   // 20 to 60 goes: s2 starts at 30
  const r = VC.applyTrim(anno, plan, ORIGIN, true);
  assert.match(r.why, /"Check" starts there, at 0:30/);
  assert.equal(JSON.stringify(anno), before);
});

test("trimming a video's start, back to back: it still starts where it did; its content and everything after move up", () => {
  const anno = project();
  // Nothing starts in v2's first 5 s; s2 runs on into v2, and its part after the cut moves up with it.
  const plan = VC.planTrim(VC.clipsOf(anno), len, "v2", "start", 5000);
  assert.equal(VC.applyTrim(anno, plan, ORIGIN, true).ok, true);
  assert.deepEqual(offsets(anno), ["v1@0[0,end]", "v2@55[5,end]", "v3@95[0,end]"]);
  assert.deepEqual(steps(anno), ["s1 5-30", "s2 30-65", "s3 65-105", "s4 105-125"]);
  // Growing it back gives the clock back as it was.
  const back = VC.planTrim(VC.clipsOf(anno), len, "v2", "start", 0);
  assert.equal(VC.applyTrim(anno, back, ORIGIN, true).ok, true);
  assert.deepEqual(offsets(anno), ["v1@0[0,end]", "v2@60[0,end]", "v3@100[0,end]"]);
  assert.deepEqual(steps(anno), ["s1 5-30", "s2 30-70", "s3 70-110", "s4 110-130"]);
});

test("in a recording a trim only trims: nothing else moves", () => {
  const anno = project();
  const plan = VC.planTrim(VC.clipsOf(anno), len, "v1", "end", 20000);
  assert.equal(VC.applyTrim(anno, plan, ORIGIN, false).ok, true);
  assert.deepEqual(offsets(anno), ["v1@0[0,20]", "v2@60[0,end]", "v3@100[0,end]"]);
  assert.deepEqual(steps(anno), ["s1 5-30", "s2 30-70", "s3 70-110", "s4 110-130"]);
});

test("removing a video, back to back: what was marked on it goes with it, and what follows moves up by its length", () => {
  const anno = project();
  assert.deepEqual(VC.marksOnClip(anno, len, "v2", ORIGIN).steps.map((s) => s.step_id), ["s3"]);
  const r = VC.applyRemove(anno, len, "v2", ORIGIN, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.gone.steps.map((s) => s.step_id), ["s3"]);
  assert.deepEqual(offsets(anno), ["v1@0[0,end]", "v3@60[0,end]"]);
  assert.deepEqual(steps(anno), ["s1 5-30", "s2 30-60", "s4 70-90"]);
  assert.deepEqual(anno.marker_edits.map((e) => rel(e.timestamp)), [2, 80]);
  assert.equal(rel(anno.analyst_notes[0].at), 65, "a note on the video after it moves up with it");
  // A note pinned on the video removed goes with it.
  const other = project();
  other.analyst_notes[0].at = at(80);
  VC.applyRemove(other, len, "v2", ORIGIN, true);
  assert.deepEqual(other.analyst_notes, []);
});

test("replacing a video with a shorter one moves what follows up; a mark in the part it lacks refuses it", () => {
  const anno = project();
  const r = VC.applyReplace(anno, len, "v3", "c2", 25000, ORIGIN, true, { at: "now" });
  assert.equal(r.ok, true);
  assert.deepEqual(offsets(anno), ["v1@0[0,end]", "v2@60[0,end]", "v3@100[0,end]"]);
  assert.equal(VC.clipsOf(anno)[2].path, "c2");
  assert.equal(VC.clipsOf(anno)[2].length_ms, 25000);
  assert.deepEqual(steps(anno).slice(3), ["s4 110-125"], "the step running to its end ends with it");
  const again = project();
  assert.match(VC.applyReplace(again, len, "v2", "b2", 5000, ORIGIN, true).why, /the part the new video does not have/);
});

test("a video added goes after the last one, with a fresh id", () => {
  const anno = project();
  const c = VC.applyAppend(anno, { path: "d", length_ms: 10000, attached_at: "now" }, VC.appendOffset(VC.clipsOf(anno), len));
  assert.equal(c.id, "v4");
  assert.deepEqual(offsets(anno).slice(-1), ["v4@130[0,end]"]);
});

test("planTrim keeps at least a second and needs the length", () => {
  const clips = VC.clipsOf(project());
  const p = VC.planTrim(clips, len, "v3", "end", 10);
  assert.equal(p.outMs, VC.MIN_CLIP_MS);
  assert.match(VC.planTrim([{ id: "x", path: "x", offset_ms: 0, in_ms: 0, out_ms: null, length_ms: null }], () => null, "x", "end", 5).why,
    /length is not known/);
});
