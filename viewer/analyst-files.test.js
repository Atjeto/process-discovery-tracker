"use strict";
/*
 * The files the analyst adds to a session folder and the new projects
 * (contract C16; analyst-files.js, new-project.js), on real temp folders.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AF = require("./analyst-files.js");
const NewProject = require("./new-project.js");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const t0 = "2026-09-24T10:00:00.000Z";
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), "pdt-af-" + tag + "-"));

test("a screenshot is written under screenshots/analyst as <id>.png; anything but a PNG or JPEG is refused", () => {
  const root = tmp("shot");
  assert.deepEqual(AF.writeScreenshot(root, "abc-1", PNG), { file: "abc-1.png" });
  assert.ok(fs.existsSync(path.join(root, "screenshots", "analyst", "abc-1.png")));
  assert.throws(() => AF.writeScreenshot(root, "abc-2", Buffer.from("MZ not an image")), /not a PNG or JPEG/);
  assert.throws(() => AF.writeScreenshot(root, "../x", PNG), /bad screenshot id/);
});

test("an attachment is copied into attachments/ with a numeric suffix when the name is taken", () => {
  const root = tmp("att"), src = path.join(tmp("src"), "order email.msg");
  fs.writeFileSync(src, "mail");
  assert.deepEqual(AF.copyAttachment(root, src), { file: "order email.msg" });
  assert.deepEqual(AF.copyAttachment(root, src), { file: "order email (2).msg" });
  assert.equal(fs.readFileSync(path.join(root, "attachments", "order email (2).msg"), "utf8"), "mail");
});

test("a removed entry's file leaves the folder, and a save that names it again brings it back (Undo)", () => {
  const root = tmp("move"), hold = tmp("hold");
  AF.writeScreenshot(root, "s1", PNG);
  fs.mkdirSync(path.join(root, "attachments"));
  fs.writeFileSync(path.join(root, "attachments", "a.pdf"), "pdf");
  fs.writeFileSync(path.join(root, "attachments", "by-hand.txt"), "put there by hand");
  const full = { analyst_screenshots: [{ id: "s1", file: "s1.png" }], attachments: [{ id: "x", file: "a.pdf" }] };
  const none = { analyst_screenshots: [], attachments: [] };
  assert.deepEqual([...AF.namedFiles(full)], ["screenshots/analyst/s1.png", "attachments/a.pdf"]);
  const out = AF.moveRemoved(root, AF.namedFiles(full), AF.namedFiles(none), hold);
  assert.deepEqual(out.removed.sort(), ["attachments/a.pdf", "screenshots/analyst/s1.png"]);
  assert.ok(!fs.existsSync(path.join(root, "attachments", "a.pdf")));
  assert.ok(fs.existsSync(path.join(root, "attachments", "by-hand.txt")), "a file no entry named stays");
  const back = AF.moveRemoved(root, AF.namedFiles(none), AF.namedFiles(full), hold);
  assert.deepEqual(back.restored.sort(), ["attachments/a.pdf", "screenshots/analyst/s1.png"]);
  assert.equal(fs.readFileSync(path.join(root, "attachments", "a.pdf"), "utf8"), "pdf");
});

test("an attachment opens only inside attachments/, and a program file is shown in its folder instead", () => {
  const root = tmp("open");
  fs.mkdirSync(path.join(root, "attachments"));
  for (const f of ["sop.pdf", "tool.exe"]) fs.writeFileSync(path.join(root, "attachments", f), "x");
  const exists = (p) => fs.existsSync(p);
  assert.equal(AF.attachmentTarget(root, "sop.pdf", exists).open, true);
  assert.equal(AF.attachmentTarget(root, "tool.exe", exists).open, false);
  assert.equal(AF.attachmentTarget(root, "../manifest.json", exists).ok, false);
  assert.equal(AF.attachmentTarget(root, "missing.pdf", exists).ok, false);
});

test("a video project: manifest (session_id, source, started_at, label), empty events, the video copied in with offset 0", async () => {
  const where = tmp("proj"), video = path.join(tmp("vid"), "call.webm");
  fs.writeFileSync(video, "video bytes");
  const folder = path.join(where, "Order entry");
  await NewProject.createProject({ folder, kind: "video", name: "Order entry", videoPath: video, id: "id-1", now: t0 });
  const m = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m), ["session_id", "source", "started_at", "label"]);
  assert.deepEqual([m.session_id, m.source, m.label], ["id-1", "video", "Order entry"]);
  assert.ok(Number.isFinite(Date.parse(m.started_at)));
  assert.equal(fs.readFileSync(path.join(folder, "events.jsonl"), "utf8"), "");
  const a = JSON.parse(fs.readFileSync(path.join(folder, "annotations.json"), "utf8"));
  assert.deepEqual(a.external_video, { path: "video/call.webm", offset_ms: 0, attached_at: t0 });
  assert.equal(fs.readFileSync(path.join(folder, "video", "call.webm"), "utf8"), "video bytes");
});

test("a blank project starts at its creation time; a folder that is not empty is refused", async () => {
  const where = tmp("blank");
  const folder = path.join(where, "New process");
  await NewProject.createProject({ folder, kind: "blank", name: "New process", id: "id-2", now: t0 });
  const m = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
  assert.deepEqual([m.source, m.started_at], ["blank", t0]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "annotations.json"), "utf8")).external_video, undefined);
  assert.match(NewProject.folderProblem(folder), /not empty/);
  await assert.rejects(NewProject.createProject({ folder, kind: "blank", name: "x", id: "id-3", now: t0 }), /not empty/);
  assert.equal(NewProject.folderProblem(path.join(where, "free")), null);
});

/* ---- lane CC: the video's copy, the edited maps' files, the transcript ---- */

test("namedFiles: the attached video's copy in video/ and the edited maps' files; a video kept elsewhere never", () => {
  const anno = {
    external_video: { path: "video/call.webm", offset_ms: 0 },
    reference_maps: [{ map_id: "m1", file: "derived_maps/m1.bpmn" }, { map_id: "m2", file: "../escape.bpmn" }, { map_id: "m3" }],
  };
  assert.deepEqual([...AF.namedFiles(anno)].sort(), ["derived_maps/m1.bpmn", "video/call.webm"]);
  const BS = String.fromCharCode(92);
  for (const p of ["D:" + BS + "Videos" + BS + "call.mp4", "C:/Users/pm/call.mp4", "recording.mp4", "obs/rec.mkv", "video/sub/x.mp4",
    "video/..", "", null]) {
    assert.deepEqual([...AF.namedFiles({ external_video: { path: p } })], [], "not the app's copy: " + p);
    assert.equal(AF.isVideoCopy(p), false, p);
  }
  assert.deepEqual([...AF.namedFiles({ external_video: { path: "video" + String.fromCharCode(92) + "call (2).mp4" } })],
    ["video/call (2).mp4"], "either slash");
  assert.equal(AF.isVideoCopy("video/call.webm"), true);
});

test("Remove video and Replace video: the save takes the copy out of video/, and Undo (a save naming it again) brings it back", () => {
  const root = tmp("vid"), hold = tmp("vhold");
  fs.mkdirSync(path.join(root, "video"));
  fs.writeFileSync(path.join(root, "video", "a.mp4"), "first video");
  fs.writeFileSync(path.join(root, "video", "b.mp4"), "second video");
  const withA = { external_video: { path: "video/a.mp4", offset_ms: 100 } };
  const withB = { external_video: { path: "video/b.mp4", offset_ms: 0 } };
  const none = {};
  // Replace a by b: a leaves, b stays.
  let out = AF.moveRemoved(root, AF.namedFiles(withA), AF.namedFiles(withB), hold);
  assert.deepEqual(out.removed, ["video/a.mp4"]);
  assert.ok(!fs.existsSync(path.join(root, "video", "a.mp4")) && fs.existsSync(path.join(root, "video", "b.mp4")));
  // Undo the replace: a comes back, b leaves.
  out = AF.moveRemoved(root, AF.namedFiles(withB), AF.namedFiles(withA), hold);
  assert.deepEqual([out.removed, out.restored], [["video/b.mp4"], ["video/a.mp4"]]);
  assert.equal(fs.readFileSync(path.join(root, "video", "a.mp4"), "utf8"), "first video");
  // Remove: a leaves; Undo: it comes back.
  AF.moveRemoved(root, AF.namedFiles(withA), AF.namedFiles(none), hold);
  assert.ok(!fs.existsSync(path.join(root, "video", "a.mp4")));
  AF.moveRemoved(root, AF.namedFiles(none), AF.namedFiles(withA), hold);
  assert.equal(fs.readFileSync(path.join(root, "video", "a.mp4"), "utf8"), "first video");
});

test("Delete map: the save takes its file out of derived_maps/; Undo brings the file back with its edits", () => {
  const root = tmp("map"), hold = tmp("mhold");
  fs.mkdirSync(path.join(root, "derived_maps"));
  fs.writeFileSync(path.join(root, "derived_maps", "rm_1.bpmn"), "<edited/>");
  const kept = { reference_maps: [{ map_id: "rm_1", file: "derived_maps/rm_1.bpmn" }] };
  AF.moveRemoved(root, AF.namedFiles(kept), AF.namedFiles({ reference_maps: [] }), hold);
  assert.ok(!fs.existsSync(path.join(root, "derived_maps", "rm_1.bpmn")));
  AF.moveRemoved(root, AF.namedFiles({ reference_maps: [] }), AF.namedFiles(kept), hold);
  assert.equal(fs.readFileSync(path.join(root, "derived_maps", "rm_1.bpmn"), "utf8"), "<edited/>");
});

test("Remove transcript parks its files together, and its Undo puts them back; a file of the same name attached since stays", () => {
  const root = tmp("tr"), hold = tmp("thold");
  fs.writeFileSync(path.join(root, "transcript.json"), "{}");
  fs.mkdirSync(path.join(root, "transcript"));
  fs.writeFileSync(path.join(root, "transcript", "m.vtt"), "WEBVTT");
  const files = ["transcript.json", "transcript/m.vtt", "transcript/gone.vtt"];
  const out = AF.parkFiles(root, files, hold, "transcript-1");
  assert.deepEqual([out.parked, out.errors], [["transcript.json", "transcript/m.vtt"], []], "a missing file is skipped");
  assert.ok(!fs.existsSync(path.join(root, "transcript.json")) && !fs.existsSync(path.join(root, "transcript", "m.vtt")));
  // A later removal parks under its own tag, never over this one.
  fs.writeFileSync(path.join(root, "transcript.json"), '{"later":1}');
  AF.parkFiles(root, ["transcript.json"], hold, "transcript-2");
  fs.writeFileSync(path.join(root, "transcript.json"), '{"newest":1}');
  const back = AF.restoreParked(root, out.parked, hold, "transcript-1");
  assert.deepEqual([back.restored, back.kept], [["transcript/m.vtt"], ["transcript.json"]]);
  assert.equal(fs.readFileSync(path.join(root, "transcript.json"), "utf8"), '{"newest":1}', "the file attached since stays");
  assert.equal(fs.readFileSync(path.join(root, "transcript", "m.vtt"), "utf8"), "WEBVTT");
  assert.throws(() => AF.parkFiles(root, files, hold, "../x"), /bad parking tag/);
  assert.deepEqual(AF.parkFiles(root, ["../manifest.json", "C:/x"], hold, "t3").errors.length, 2, "never outside the folder");
});
