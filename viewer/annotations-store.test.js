"use strict";
/*
 * RP-04: annotations.json writes never lose work, and an unreadable file is
 * an error, never "absent" (annotations-store.js, used by main.js).
 *
 * Every test runs against a real temp session folder. The write-failure
 * tests inject a file system whose write or rename fails at the chosen step,
 * which is how a full disk, a locked file or a crash mid-save looks from
 * here. The load-path tests go through main.js's own loadSessionData (main.js
 * is requireable under plain node: it shims the Electron API).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Store = require("./annotations-store.js");
const { loadSessionData } = require("./main.js");

const _dirs = [];
test.after(() => { for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tempSession(annotationsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-annostore-test-"));
  _dirs.push(dir);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "s1" }));
  if (annotationsText !== undefined) fs.writeFileSync(path.join(dir, "annotations.json"), annotationsText);
  return dir;
}
const read = (dir, name) => fs.readFileSync(path.join(dir, name), "utf-8");
const exists = (dir, name) => fs.existsSync(path.join(dir, name));
const leftoverTemps = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith("annotations.json.tmp-"));

/* A file system that behaves like node:fs except for one failing call. */
function failingFs(which) {
  return Object.assign({}, fs, {
    writeFileSync(p, data) {
      if (which === "write" && String(p).includes(".tmp-")) {
        const e = new Error("ENOSPC: no space left on device, write"); e.code = "ENOSPC"; throw e;
      }
      return fs.writeFileSync(p, data);
    },
    renameSync(from, to) {
      if (which === "rename") { const e = new Error("EXDEV: cross-device link not permitted, rename"); e.code = "EXDEV"; throw e; }
      return fs.renameSync(from, to);
    },
  });
}

test("readAnnotationsFile tells absent, ok and unreadable apart", () => {
  assert.equal(Store.readAnnotationsFile(tempSession()).status, "absent");

  const ok = Store.readAnnotationsFile(tempSession('{"steps":[{"name":"a"}]}'));
  assert.equal(ok.status, "ok");
  assert.equal(ok.annotations.steps[0].name, "a");

  // Truncated mid-write (what a cancelled or crashed save leaves), empty, a
  // list, and invalid UTF-8 are all unreadable, never absent.
  for (const bad of ['{"steps":[{"name":"a"', "", "[]", "null", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])]) {
    const r = Store.readAnnotationsFile(tempSession(bad));
    assert.equal(r.status, "unreadable", "expected unreadable for " + JSON.stringify(String(bad)));
    assert.ok(r.error && r.error.length > 0, "an unreadable read carries its reason");
  }
});

test("a write COPIES the current file into the backups; annotations.json is never removed", () => {
  const dir = tempSession('{"v":0}');
  for (let v = 1; v <= 6; v++) Store.writeAnnotationsFile(dir, { v });
  assert.equal(JSON.parse(read(dir, "annotations.json")).v, 6);
  // .2 newest to .5 oldest: the four versions before the current one.
  assert.deepEqual([2, 3, 4, 5].map((i) => JSON.parse(read(dir, "annotations.json." + i)).v), [5, 4, 3, 2]);
  assert.equal(exists(dir, "annotations.json.6"), false, "five versions are kept, no more");
  assert.deepEqual(leftoverTemps(dir), []);
});

test("a failed write leaves the previous annotations.json in place (disk full on the temp file)", () => {
  const dir = tempSession('{"steps":["analyst work"]}');
  assert.throws(() => Store.writeAnnotationsFile(dir, { steps: [] }, failingFs("write")), /ENOSPC/);
  assert.equal(read(dir, "annotations.json"), '{"steps":["analyst work"]}',
    "the analyst's file must still be there, unchanged");
  assert.deepEqual(leftoverTemps(dir), [], "the temp file is cleaned up");
});

test("a failed rename leaves the previous annotations.json in place", () => {
  const dir = tempSession('{"steps":["analyst work"]}');
  assert.throws(() => Store.writeAnnotationsFile(dir, { steps: [] }, failingFs("rename")), /EXDEV/);
  assert.equal(read(dir, "annotations.json"), '{"steps":["analyst work"]}');
  assert.equal(read(dir, "annotations.json.2"), '{"steps":["analyst work"]}',
    "the backup is a copy of the file that is still in place");
  assert.deepEqual(leftoverTemps(dir), []);
});

test("an unreadable annotations.json is never overwritten, and no backup is rotated", () => {
  const dir = tempSession('{"steps":[{"name":"half written');
  fs.writeFileSync(path.join(dir, "annotations.json.2"), '{"steps":["good backup"]}');
  assert.throws(() => Store.writeAnnotationsFile(dir, { steps: [] }),
    (e) => e instanceof Store.AnnotationsUnreadableError && e.code === "ANNOTATIONS_UNREADABLE" &&
      /annotations\.json/.test(e.message) && /annotations\.json\.2/.test(e.message));
  assert.equal(read(dir, "annotations.json"), '{"steps":[{"name":"half written');
  assert.equal(read(dir, "annotations.json.2"), '{"steps":["good backup"]}', "the good backup is not rotated away");
  assert.equal(exists(dir, "annotations.json.3"), false);
});

test("a first save of a fresh session writes the file and makes no backup", () => {
  const dir = tempSession();
  const r = Store.writeAnnotationsFile(dir, { steps: [] });
  assert.equal(r.path, path.join(dir, "annotations.json"));
  assert.equal(r.backupError, null);
  assert.equal(exists(dir, "annotations.json.2"), false);
});

test("load path: an unreadable annotations.json is reported, not treated as absent", () => {
  const dir = tempSession('{"steps":[{"name":"x"}');
  fs.writeFileSync(path.join(dir, "annotations.json.2"), "{}");
  fs.writeFileSync(path.join(dir, "annotations.json.4"), "{}");
  const s = loadSessionData(dir);
  assert.equal(s.annotations, null);
  assert.ok(s.annotationsError, "the session carries the load error");
  assert.equal(s.annotationsError.file, path.join(dir, "annotations.json"));
  assert.deepEqual(s.annotationsError.backups, ["annotations.json.2", "annotations.json.4"]);
  assert.match(s.annotationsError.message, /annotations\.json in this project folder cannot be read/);
  assert.match(s.annotationsError.message, /annotations\.json\.2, annotations\.json\.4/);
});

test("load path: absent and valid files carry no load error", () => {
  const fresh = loadSessionData(tempSession());
  assert.equal(fresh.annotations, null);
  assert.equal(fresh.annotationsError, null);
  const ok = loadSessionData(tempSession('{"steps":[]}'));
  assert.deepEqual(ok.annotations, { steps: [] });
  assert.equal(ok.annotationsError, null);
});

test("load path: with no backups the message says so", () => {
  const s = loadSessionData(tempSession("not json"));
  assert.deepEqual(s.annotationsError.backups, []);
  assert.match(s.annotationsError.message, /No backups \(annotations\.json\.2 to annotations\.json\.5\) were found/);
});
