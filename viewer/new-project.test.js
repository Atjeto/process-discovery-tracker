"use strict";
// Lane B4b: New project from a video... takes the videos and their
// transcripts in one pick (new-project.js): the files sorted by kind and
// name, each transcript with its video, the videos back to back, and the
// project made with the chain. The real dialogs and the import are in
// e2e/start-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const NP = require("./new-project.js");

const D = "C:\\calls\\";

test("sortPicked: videos and transcripts apart, each in the order of their names; anything else aside", () => {
  const r = NP.sortPicked([D + "Part 10.mp4", D + "part 2.MP4", D + "Part 2.vtt", D + "notes.txt", D + "Part 10.docx", D + "a.webm"]);
  assert.deepEqual(r.videos, [D + "a.webm", D + "part 2.MP4", D + "Part 10.mp4"]);
  assert.deepEqual(r.transcripts, [D + "Part 2.vtt", D + "Part 10.docx"]);
  assert.deepEqual(r.others, [D + "notes.txt"]);
});

test("matchTranscripts: a transcript goes with the video it shares a stem with, case blind, the longest stem first", () => {
  const vids = [D + "Order call part 1.mp4", D + "Order call part 10.mp4"];
  const r = NP.matchTranscripts(vids, [D + "order call part 10 transcript.vtt", D + "ORDER CALL PART 1.vtt"]);
  assert.deepEqual(r.pairs, [
    { video: vids[0], transcript: D + "ORDER CALL PART 1.vtt" },
    { video: vids[1], transcript: D + "order call part 10 transcript.vtt" },
  ]);
  assert.deepEqual(r.unmatched, []);
  // The video's stem may be the longer one.
  const one = NP.matchTranscripts([D + "Intro.mp4", D + "Order call recording.mp4"], [D + "Order call.vtt"]);
  assert.deepEqual(one.pairs, [{ video: D + "Order call recording.mp4", transcript: D + "Order call.vtt" }]);
});

test("matchTranscripts: the rest go to the videos left, in order, one each; a transcript left over is unmatched", () => {
  const vids = [D + "a.mp4", D + "b.mp4", D + "c.mp4"];
  const r = NP.matchTranscripts(vids, [D + "b.vtt", D + "Meeting transcript.docx", D + "x.vtt", D + "y.vtt"]);
  assert.deepEqual(r.pairs, [
    { video: D + "a.mp4", transcript: D + "Meeting transcript.docx" },
    { video: D + "b.mp4", transcript: D + "b.vtt" },
    { video: D + "c.mp4", transcript: D + "x.vtt" },
  ]);
  assert.deepEqual(r.unmatched, [D + "y.vtt"]);
  assert.deepEqual(NP.matchTranscripts([D + "a.mp4"], []), { pairs: [], unmatched: [] });
});

test("chainOf: back to back from 0; every video but the last needs its length", () => {
  assert.deepEqual(NP.chainOf(["a", "b", "c"], [32000, 12000.4, null]), [
    { path: "a", offset_ms: 0, length_ms: 32000 }, { path: "b", offset_ms: 32000, length_ms: 12000 },
    { path: "c", offset_ms: 44000, length_ms: null }]);
  assert.deepEqual(NP.chainOf(["a"], []), [{ path: "a", offset_ms: 0, length_ms: null }]);
  assert.throws(() => NP.chainOf([D + "a.mp4", D + "b.mp4"], [null, 5]), /the length of a\.mp4 cannot be read/);
});

test("createProject: several videos are copied into video/ and chained as v1, v2; one video as before", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-new-project-"));
  try {
    const a = path.join(base, "part 1.webm"), b = path.join(base, "part 2.webm");
    fs.writeFileSync(a, "AAAA");
    fs.writeFileSync(b, "BBBBBB");
    const folder = path.join(base, "Order call");
    await NP.createProject({ folder, kind: "video", name: "Order call", id: "id-1", now: "2026-11-10T09:00:00.000Z",
      videos: NP.chainOf([a, b], [32000, 12000]) });
    const anno = JSON.parse(fs.readFileSync(path.join(folder, "annotations.json"), "utf8"));
    assert.deepEqual(anno.external_videos, [
      { id: "v1", path: "video/part 1.webm", offset_ms: 0, in_ms: 0, out_ms: null, length_ms: 32000, attached_at: "2026-11-10T09:00:00.000Z" },
      { id: "v2", path: "video/part 2.webm", offset_ms: 32000, in_ms: 0, out_ms: null, length_ms: 12000, attached_at: "2026-11-10T09:00:00.000Z" }]);
    assert.equal(fs.readFileSync(path.join(folder, "video", "part 2.webm"), "utf8"), "BBBBBB");
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
    assert.equal(manifest.source, "video");
    const single = path.join(base, "Single");
    await NP.createProject({ folder: single, kind: "video", name: "Single", id: "id-2", now: "2026-11-10T09:00:00.000Z", videoPath: a });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(single, "annotations.json"), "utf8")).external_videos,
      [{ id: "v1", path: "video/part 1.webm", offset_ms: 0, in_ms: 0, out_ms: null, attached_at: "2026-11-10T09:00:00.000Z" }]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
