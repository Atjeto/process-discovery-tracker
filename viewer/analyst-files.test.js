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
