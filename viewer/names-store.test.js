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

test("nothing is remembered for a blank name or a step without a draft key", () => {
  const p = Names.namesStorePath(tempUserData());
  assert.throws(() => Names.rememberName(p, KEY_A, "   "), /name is empty/);
  assert.throws(() => Names.rememberName(p, "", "Name"), /no draft key/);
  assert.equal(fs.existsSync(p), false);
});
