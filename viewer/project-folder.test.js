"use strict";

/*
 * Lane FX2 (validation pass 3, F7): the SME's zip, unzipped with Windows'
 * Extract All, gives a folder that holds the recording folder; opening that
 * outer folder opens the recording (project-folder.js). Any other folder
 * without a manifest.json is refused with a sentence, and an error that came
 * back over IPC reads without Electron's prefix. Real temp folders.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PF = require("./project-folder.js");

const _dirs = [];
test.after(() => { for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-pf-"));
  _dirs.push(d);
  return d;
}
function recording(dir, name) {
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "manifest.json"), "{}");
  fs.writeFileSync(path.join(p, "events.jsonl"), "");
  return p;
}

test("a project folder opens as it is", () => {
  const d = tmp();
  const p = recording(d, "20260925-085516");
  assert.deepEqual(PF.resolveProjectFolder(p), { folder: p, inner: false });
});

test("the folder Extract All makes (it holds the one recording folder) opens the recording inside it", () => {
  const outer = path.join(tmp(), "20260925-085516");
  const inner = recording(outer, "20260925-085516");
  fs.writeFileSync(path.join(outer, "desktop.ini"), "");
  assert.deepEqual(PF.resolveProjectFolder(outer), { folder: inner, inner: true });
});

test("a folder that is no project is refused with a sentence that says what to open; several recordings ask for one", () => {
  const empty = tmp();
  fs.mkdirSync(path.join(empty, "not-a-project"));
  assert.throws(() => PF.resolveProjectFolder(empty), (e) => e.message.startsWith(PF.NOT_A_PROJECT) && e.message.includes(empty));
  assert.match(PF.NOT_A_PROJECT, /unzip the SME's zip first: right-click it, Extract All/);
  const two = tmp();
  recording(two, "a");
  recording(two, "b");
  assert.throws(() => PF.resolveProjectFolder(two), /This folder holds 2 recordings: open one of them \(a, b\)\./);
  assert.throws(() => PF.resolveProjectFolder(path.join(two, "missing")), /The project folder was not found/);
});

test("an error that came back over IPC reads in its own words", () => {
  const e = new Error("Error invoking remote method 'viewer:loadSession': Error: This folder is not a project: it has no manifest.json.");
  assert.equal(PF.ipcErrorText(e), "This folder is not a project: it has no manifest.json.");
  assert.equal(PF.ipcErrorText(new Error("Disk full")), "Disk full");
  assert.equal(PF.ipcErrorText(null), "no reason was given");
});
