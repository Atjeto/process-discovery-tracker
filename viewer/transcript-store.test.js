"use strict";
/*
 * transcript-store.js: the main process's reads and writes of a session's
 * transcript.json (contract C8), on a real temp folder.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Store = require("./transcript-store.js");

function session(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-transcript-store-"));
  fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
  if (content !== undefined) fs.writeFileSync(path.join(dir, "transcript.json"), content);
  return dir;
}
const DOC = { version: 1, source_file: "transcript/m.vtt", format: "vtt", clock: "own", offset_ms: null,
  segments: [{ id: "t0001", start_s: 1.5, end_s: 2, speaker: "Ana", text: "Å text" }] };

test("readTranscriptFile: absent, ok, and unreadable with a one-line reason", () => {
  assert.equal(Store.readTranscriptFile(session()).status, "absent");
  const ok = Store.readTranscriptFile(session(JSON.stringify(DOC)));
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.transcript, DOC);
  const bad = Store.readTranscriptFile(session("{ not json"));
  assert.equal(bad.status, "unreadable");
  assert.match(bad.error, /not valid JSON/);
  const v2 = Store.readTranscriptFile(session(JSON.stringify({ version: 2, segments: [] })));
  assert.deepEqual([v2.status, v2.error], ["unreadable", "it is not a version 1 transcript"]);
});

test("saveTranscriptOffset rewrites offset_ms and keeps everything else as it is", () => {
  const dir = session(JSON.stringify(Object.assign({ future_key: [1, 2] }, DOC)));
  Store.saveTranscriptOffset(dir, -30000.4);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf-8"));
  assert.equal(after.offset_ms, -30000);
  assert.deepEqual(after.segments, DOC.segments);
  assert.deepEqual(after.future_key, [1, 2]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", "transcript.json"]);   // no temp file left
});

test("saveTranscriptOffset refuses a missing or unreadable transcript and a bad offset, writing nothing", () => {
  assert.throws(() => Store.saveTranscriptOffset(session(), 5), /no transcript/);
  const dir = session("{ not json");
  assert.throws(() => Store.saveTranscriptOffset(dir, 5), /could not be read/);
  assert.equal(fs.readFileSync(path.join(dir, "transcript.json"), "utf-8"), "{ not json");
  assert.throws(() => Store.saveTranscriptOffset(session(JSON.stringify(DOC)), "5"), /not a number/);
});

test("saveTranscriptOffset leaves the previous file in place when the write fails", () => {
  const dir = session(JSON.stringify(DOC));
  const failing = Object.assign({}, fs, { renameSync: () => { const e = new Error("disk full"); e.code = "ENOSPC"; throw e; } });
  assert.throws(() => Store.saveTranscriptOffset(dir, 1, failing), /disk full/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf-8")), DOC);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", "transcript.json"]);
});

test("loadSessionData hands the renderer the transcript, or one line on why it cannot be used", () => {
  const { loadSessionData } = require("./main.js");
  const none = loadSessionData(session());
  assert.deepEqual([none.transcript, none.transcriptError], [null, null]);
  const ok = loadSessionData(session(JSON.stringify(DOC)));
  assert.deepEqual([ok.transcript, ok.transcriptError], [DOC, null]);
  const bad = loadSessionData(session(JSON.stringify({ version: 1, segments: "none" })));
  assert.deepEqual([bad.transcript, bad.transcriptError], [null, "it has no list of sentences"]);
});

test("transcriptFiles: transcript.json and every original under transcript/ (what Remove transcript takes out)", () => {
  const dir = session(JSON.stringify(DOC));
  assert.deepEqual(Store.transcriptFiles(dir), ["transcript.json"], "no transcript/ folder: the file alone");
  fs.mkdirSync(path.join(dir, "transcript"));
  fs.writeFileSync(path.join(dir, "transcript", "m.vtt"), "WEBVTT\n");
  fs.writeFileSync(path.join(dir, "transcript", "earlier.docx"), "docx");
  fs.mkdirSync(path.join(dir, "transcript", "not-a-file"));
  assert.deepEqual(Store.transcriptFiles(dir).sort(), ["transcript.json", "transcript/earlier.docx", "transcript/m.vtt"]);
  fs.unlinkSync(path.join(dir, "transcript.json"));
  assert.deepEqual(Store.transcriptFiles(dir).sort(), ["transcript/earlier.docx", "transcript/m.vtt"]);
});

/* ---- C23 (2.0.6): one transcript per video --------------------------------- */

test("C23: the transcripts of a project in their order; the next one's file; a name that is not one", () => {
  const dir = session(JSON.stringify(DOC));
  assert.equal(Store.nextTranscriptFile(dir), "transcript-2.json");
  fs.writeFileSync(path.join(dir, "transcript-3.json"), JSON.stringify(DOC));
  fs.writeFileSync(path.join(dir, "transcript-2.json"), "{ not json");
  fs.writeFileSync(path.join(dir, "transcript-10.json"), JSON.stringify(DOC));
  assert.deepEqual(Store.transcriptFileNames(dir), ["transcript.json", "transcript-2.json", "transcript-3.json", "transcript-10.json"]);
  assert.deepEqual(Store.readTranscriptFiles(dir).map((r) => r.file + ":" + r.status),
    ["transcript.json:ok", "transcript-2.json:unreadable", "transcript-3.json:ok", "transcript-10.json:ok"]);
  assert.equal(Store.nextTranscriptFile(dir), "transcript-4.json");
  assert.equal(Store.nextTranscriptFile(session()), "transcript.json");
  for (const bad of ["annotations.json", "../transcript.json", "transcript-x.json", undefined]) assert.equal(Store.isTranscriptFile(bad), false, String(bad));
  assert.throws(() => Store.patchTranscript(dir, { video_id: "v1" }, undefined, "annotations.json"), /not a transcript/);
});

test("C23: patchTranscript sets the video a transcript belongs to and takes a key out, keeping the rest", () => {
  const dir = session(JSON.stringify(DOC));
  fs.writeFileSync(path.join(dir, "transcript-2.json"), JSON.stringify(Object.assign({ future_key: 1 }, DOC)));
  Store.patchTranscript(dir, { video_id: "v2", offset_ms: 1500 }, undefined, "transcript-2.json");
  let doc = JSON.parse(fs.readFileSync(path.join(dir, "transcript-2.json"), "utf-8"));
  assert.deepEqual([doc.video_id, doc.offset_ms, doc.future_key], ["v2", 1500, 1]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf-8")), DOC, "the other transcript untouched");
  Store.patchTranscript(dir, { video_id: undefined }, undefined, "transcript-2.json");
  doc = JSON.parse(fs.readFileSync(path.join(dir, "transcript-2.json"), "utf-8"));
  assert.equal("video_id" in doc, false);
  Store.saveTranscriptOffset(dir, 900, undefined, "transcript-2.json");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "transcript-2.json"), "utf-8")).offset_ms, 900);
});

test("C23: Remove takes one transcript and its own original; the last one takes every original", () => {
  const dir = session(JSON.stringify(DOC));   // source_file transcript/m.vtt
  fs.mkdirSync(path.join(dir, "transcript"));
  for (const f of ["m.vtt", "m (2).vtt", "old.vtt"]) fs.writeFileSync(path.join(dir, "transcript", f), "x");
  fs.writeFileSync(path.join(dir, "transcript-2.json"), JSON.stringify(Object.assign({}, DOC, { source_file: "transcript/m (2).vtt" })));
  assert.deepEqual(Store.transcriptFiles(dir, undefined, "transcript-2.json"), ["transcript-2.json", "transcript/m (2).vtt"]);
  assert.deepEqual(Store.transcriptFiles(dir, undefined, "transcript.json"), ["transcript.json", "transcript/m.vtt"]);
  fs.rmSync(path.join(dir, "transcript-2.json"));
  assert.deepEqual(Store.transcriptFiles(dir).sort(), ["transcript.json", "transcript/m (2).vtt", "transcript/m.vtt", "transcript/old.vtt"]);
});
