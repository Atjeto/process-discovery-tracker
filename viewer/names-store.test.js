"use strict";
/*
 * The remembered-names store (contract C4, names-store.js, used by main.js):
 * a rename is written atomically next to every name remembered before, an
 * unreadable store is an error and is never replaced, and a failed write
 * leaves the previous store in place.
 *
 * Every test runs against a real temp folder. The write-failure tests inject
 * a file system whose write or rename fails, the way a full disk or a locked
 * file looks from here.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Names = require("./names-store.js");

const _dirs = [];
test.after(() => { for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true }); });

function tempUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-names-test-"));
  _dirs.push(dir);
  return dir;
}
const leftoverTemps = (p) => fs.existsSync(path.dirname(p))
  ? fs.readdirSync(path.dirname(p)).filter((n) => n.includes(".tmp-")) : [];

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

/* A screen label with "|" inside: the key is stored whole. */
const KEY_A = "chrome|Case | Queue view|Button:save";
const KEY_B = "sapgui|va01|MenuItem:check-document";

test("the store lives at <userData>/pdt-library/remembered-names.json", () => {
  assert.equal(Names.namesStorePath(path.join("C:", "u")), path.join("C:", "u", "pdt-library", "remembered-names.json"));
});

test("rememberName creates the folder and the file in the pipeline's shape", () => {
  const p = Names.namesStorePath(tempUserData());
  assert.equal(Names.readNamesFile(p).status, "absent");
  Names.rememberName(p, KEY_A, "  Save the case  ", { now: "2026-09-23T10:00:00.000Z" });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf-8")), {
    version: 1,
    names: { [KEY_A]: { name: "Save the case", updated_at: "2026-09-23T10:00:00.000Z" } },
  });
  assert.deepEqual(leftoverTemps(p), []);
});

test("a second name keeps the first; renaming the same key replaces only it", () => {
  const p = Names.namesStorePath(tempUserData());
  Names.rememberName(p, KEY_A, "Save the case", { now: "t1" });
  Names.rememberName(p, KEY_B, "Check the order", { now: "t2" });
  Names.rememberName(p, KEY_A, "Save and close", { now: "t3" });
  const r = Names.readNamesFile(p);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.names, {
    [KEY_A]: { name: "Save and close", updated_at: "t3" },
    [KEY_B]: { name: "Check the order", updated_at: "t2" },
  });
});

test("entries this version does not read are kept on disk untouched", () => {
  const p = Names.namesStorePath(tempUserData());
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ version: 1, names: { odd: { name: "", note: "kept" } }, extra: 1 }));
  Names.rememberName(p, KEY_B, "Check the order", { now: "t" });
  const doc = JSON.parse(fs.readFileSync(p, "utf-8"));
  assert.deepEqual(doc.names.odd, { name: "", note: "kept" });
  assert.equal(doc.extra, 1);
  assert.deepEqual(Object.keys(Names.readNamesFile(p).names), [KEY_B], "a nameless entry is not offered");
});

test("an unreadable store is reported and never replaced", () => {
  for (const bad of ['{"version":1,"names":{', "[]", '{"version":2,"names":{}}', '{"version":1,"names":[]}',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"version":1,"names":{}}')])]) {
    const p = Names.namesStorePath(tempUserData());
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bad);
    const before = fs.readFileSync(p);
    assert.equal(Names.readNamesFile(p).status, "unreadable", "expected unreadable for " + JSON.stringify(String(bad)));
    assert.throws(() => Names.rememberName(p, KEY_A, "X"), (e) => e.code === "NAMES_UNREADABLE" && e.message.includes(p));
    assert.deepEqual(fs.readFileSync(p), before, "the file is left exactly as it was");
  }
});

test("a failed write or rename leaves the previous store in place and no temp file behind", () => {
  for (const which of ["write", "rename"]) {
    const p = Names.namesStorePath(tempUserData());
    Names.rememberName(p, KEY_A, "Save the case", { now: "t1" });
    const before = fs.readFileSync(p, "utf-8");
    assert.throws(() => Names.rememberName(p, KEY_B, "Check", { fs: failingFs(which) }), which === "write" ? /ENOSPC/ : /EXDEV/);
    assert.equal(fs.readFileSync(p, "utf-8"), before);
    assert.deepEqual(leftoverTemps(p), []);
  }
});

test("forgetName removes only its key; the other entries (read or not) stay on disk", () => {
  const p = Names.namesStorePath(tempUserData());
  Names.rememberName(p, KEY_A, "Save the case", { now: "t1" });
  Names.rememberName(p, KEY_B, "Check the order", { now: "t2" });
  const doc = JSON.parse(fs.readFileSync(p, "utf-8"));
  doc.names.odd = { name: "", note: "kept" };
  fs.writeFileSync(p, JSON.stringify(doc));
  assert.deepEqual(Names.forgetName(p, KEY_A), { path: p, removed: true, previous: { name: "Save the case", updated_at: "t1" } });
  const after = JSON.parse(fs.readFileSync(p, "utf-8"));
  assert.deepEqual(Object.keys(after.names).sort(), [KEY_B, "odd"].sort());
  assert.deepEqual(Names.readNamesFile(p).names, { [KEY_B]: { name: "Check the order", updated_at: "t2" } });
  assert.deepEqual(leftoverTemps(p), []);
});

test("forgetName with nothing to forget writes nothing; an unreadable store is never replaced", () => {
  const absent = Names.namesStorePath(tempUserData());
  assert.deepEqual(Names.forgetName(absent, KEY_A), { path: absent, removed: false, previous: null });
  assert.equal(fs.existsSync(absent), false, "no file is created to forget nothing");
  const p = Names.namesStorePath(tempUserData());
  Names.rememberName(p, KEY_B, "Check", { now: "t" });
  const before = fs.readFileSync(p);
  assert.deepEqual(Names.forgetName(p, KEY_A), { path: p, removed: false, previous: null });
  assert.deepEqual(fs.readFileSync(p), before);
  fs.writeFileSync(p, '{"version":1,"names":{');
  const broken = fs.readFileSync(p);
  assert.throws(() => Names.forgetName(p, KEY_B), (e) => e.code === "NAMES_UNREADABLE" && /cannot be forgotten/.test(e.message));
  assert.deepEqual(fs.readFileSync(p), broken);
  assert.throws(() => Names.forgetName(p, ""), /no draft key/);
});

test("a failed forget leaves the previous store in place and no temp file behind", () => {
  for (const which of ["write", "rename"]) {
    const p = Names.namesStorePath(tempUserData());
    Names.rememberName(p, KEY_A, "Save the case", { now: "t1" });
    const before = fs.readFileSync(p, "utf-8");
    assert.throws(() => Names.forgetName(p, KEY_A, { fs: failingFs(which) }), which === "write" ? /ENOSPC/ : /EXDEV/);
    assert.equal(fs.readFileSync(p, "utf-8"), before);
    assert.deepEqual(leftoverTemps(p), []);
  }
});

test("lane FX2: a rename says the key's entry before it and the one written; restoreName puts either back exactly (an undo and a redo)", () => {
  const p = Names.namesStorePath(tempUserData());
  const first = Names.rememberName(p, KEY_A, "Save the case", { now: "t1" });
  assert.deepEqual([first.previous, first.entry], [null, { name: "Save the case", updated_at: "t1" }]);
  Names.rememberName(p, KEY_B, "Check the order", { now: "t2" });
  const second = Names.rememberName(p, KEY_A, "Save and close", { now: "t3" });
  assert.deepEqual(second.previous, { name: "Save the case", updated_at: "t1" });
  // Ctrl+Z of the second rename: the first name, with its own time, back.
  Names.restoreName(p, KEY_A, second.previous);
  assert.deepEqual(Names.readNamesFile(p).names[KEY_A], { name: "Save the case", updated_at: "t1" });
  // Ctrl+Z of the first rename: nothing was remembered for the key before it.
  Names.restoreName(p, KEY_A, first.previous);
  assert.deepEqual(Object.keys(Names.readNamesFile(p).names), [KEY_B], "the other key is left alone");
  // Ctrl+Y: the renames again.
  Names.restoreName(p, KEY_A, second.entry);
  assert.deepEqual(Names.readNamesFile(p).names[KEY_A], { name: "Save and close", updated_at: "t3" });
  assert.deepEqual(leftoverTemps(p), []);
  const broken = Names.namesStorePath(tempUserData());
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, '{"version":1,"names":{');
  assert.throws(() => Names.restoreName(broken, KEY_A, first.entry), (e) => e.code === "NAMES_UNREADABLE");
});

test("nothing is remembered for a blank name or a step without a draft key", () => {
  const p = Names.namesStorePath(tempUserData());
  assert.throws(() => Names.rememberName(p, KEY_A, "   "), /name is empty/);
  assert.throws(() => Names.rememberName(p, "", "Name"), /no draft key/);
  assert.equal(fs.existsSync(p), false);
});
