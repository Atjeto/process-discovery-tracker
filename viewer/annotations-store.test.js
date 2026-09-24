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

/* ---- Restore the newest backup (the unreadable banner's act, lane CC) ---- */

test("the newest backup that can be read is offered: a broken .2 gives way to .3; the message names it and its time", () => {
  const dir = tempSession("not json");
  fs.writeFileSync(path.join(dir, "annotations.json.2"), "{ broken");
  fs.writeFileSync(path.join(dir, "annotations.json.3"), '{"steps":["older"]}');
  fs.writeFileSync(path.join(dir, "annotations.json.4"), '{"steps":["oldest"]}');
  const newest = Store.newestReadableBackup(dir);
  assert.equal(newest.name, "annotations.json.3");
  const s = loadSessionData(dir);
  assert.equal(s.annotationsError.newest.name, "annotations.json.3");
  // Its time as the message writes it: the banner's confirm repeats this string.
  assert.equal(typeof s.annotationsError.newest.saved, "string");
  assert.ok(s.annotationsError.message.includes(", saved " + s.annotationsError.newest.saved + " ("));
  assert.match(s.annotationsError.message, /Restore the newest backup puts back annotations\.json\.3, saved /);
  assert.match(s.annotationsError.message, /the file that cannot be read is kept beside it/);
  const none = tempSession("not json");
  fs.writeFileSync(path.join(none, "annotations.json.2"), "[1]");
  assert.equal(Store.newestReadableBackup(none), null);
  assert.match(loadSessionData(none).annotationsError.message, /None of the backups found \(annotations\.json\.2\) can be read either/);
});

test("Restore the newest backup keeps the unreadable file beside it, puts the backup in place, and the project reads again", () => {
  const dir = tempSession('{"steps":[{"name":"half written');
  fs.writeFileSync(path.join(dir, "annotations.json.2"), '{"steps":["good backup"]}');
  const now = new Date(2026, 8, 25, 14, 3, 9).getTime();
  const r = Store.restoreNewestBackup(dir, { expect: "annotations.json.2", nowMs: now });
  assert.deepEqual([r.backup, r.keptAs], ["annotations.json.2", "annotations.unreadable-20260925-140309.json"]);
  assert.equal(read(dir, "annotations.json"), '{"steps":["good backup"]}');
  assert.equal(read(dir, r.keptAs), '{"steps":[{"name":"half written', "the unreadable file is kept as it was");
  assert.equal(read(dir, "annotations.json.2"), '{"steps":["good backup"]}', "the backup stays");
  assert.deepEqual(leftoverTemps(dir), []);
  const s = loadSessionData(dir);
  assert.equal(s.annotationsError, null);
  assert.deepEqual(s.annotations, { steps: ["good backup"] });
  // A second unreadable file the same second is kept under another name.
  fs.writeFileSync(path.join(dir, "annotations.json"), "broken again");
  assert.equal(Store.restoreNewestBackup(dir, { nowMs: now }).keptAs, "annotations.unreadable-20260925-140309 (2).json");
});

test("Restore the newest backup refuses a readable file, a folder with no readable backup, and a backup other than the one confirmed", () => {
  const ok = tempSession('{"steps":[]}');
  fs.writeFileSync(path.join(ok, "annotations.json.2"), "{}");
  assert.throws(() => Store.restoreNewestBackup(ok), /can be read, so there is nothing to restore/);
  const none = tempSession("not json");
  assert.throws(() => Store.restoreNewestBackup(none), /no backup of annotations\.json can be read/);
  assert.equal(read(none, "annotations.json"), "not json", "nothing moved");
  const moved = tempSession("not json");
  fs.writeFileSync(path.join(moved, "annotations.json.3"), "{}");
  assert.throws(() => Store.restoreNewestBackup(moved, { expect: "annotations.json.2" }), /the backups changed/);
  assert.equal(read(moved, "annotations.json"), "not json");
  assert.deepEqual(fs.readdirSync(moved).filter((n) => n.startsWith("annotations.unreadable-")), []);
});

test("a failed copy of the backup puts the unreadable file back where it was", () => {
  const dir = tempSession("not json");
  fs.writeFileSync(path.join(dir, "annotations.json.2"), '{"steps":[]}');
  assert.throws(() => Store.restoreNewestBackup(dir, {}, failingFs("write")), /ENOSPC/);
  assert.equal(read(dir, "annotations.json"), "not json");
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith("annotations.unreadable-")), []);
  assert.deepEqual(leftoverTemps(dir), []);
});
