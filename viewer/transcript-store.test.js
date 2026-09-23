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

test("removeTranscript deletes transcript.json only; the copied original stays", () => {
  const dir = session(JSON.stringify(DOC));
  fs.mkdirSync(path.join(dir, "transcript"));
  fs.writeFileSync(path.join(dir, "transcript", "m.vtt"), "WEBVTT\n");
  assert.equal(Store.removeTranscript(dir).removed, true);
  assert.equal(fs.existsSync(path.join(dir, "transcript.json")), false);
  assert.equal(fs.readFileSync(path.join(dir, "transcript", "m.vtt"), "utf-8"), "WEBVTT\n");
  assert.equal(Store.removeTranscript(dir).removed, false);
});
