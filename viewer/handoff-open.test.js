"use strict";
// Lane B4a, Open a zip...: which zip is which (handoff-open.js zipKind), and
// the unzipping of a project zip for editing (extractProjectZip): the
// capture app's zip and a Whole project zip unzip into the folder named,
// byte for byte; a folder that is there and not empty is refused; a damaged
// or cancelled unzipping leaves nothing behind. The read-only hand-off path
// is in handoff-zip.test.js; the real menu in e2e/start-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const HO = require("./handoff-open.js");
const { zipFolder } = require("./zip-folder.js");

const ENTRY = { version: 1, handed_off_at: "2026-09-25T10:00:00.000Z", by: "rasha", note: "First hand-off" };

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-open-zip-"));
}

/* A zip of `entries` ([name, text]), stored, as handoff-zip.test.js writes
   one. */
function rawZip(file, entries) {
  const locals = [], centrals = [];
  let pos = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(pos, 42);
    locals.push(h, nameBuf, data);
    centrals.push(c, nameBuf);
    pos += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(pos, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
  return file;
}

/* A recording folder as the capture app saves one (invented data). */
function makeRecording(base, name) {
  const root = path.join(base, name);
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  const bytes = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 7) & 0xff; return b; };
  write("manifest.json", JSON.stringify({ session_id: "s-1", started_at: "2026-05-14T09:00:00Z", label: "Order entry" }));
  write("events.jsonl", "{\"type\":\"marker\"}\n");
  write("screenshots/0001.png", bytes(40000, 13));
  fs.mkdirSync(path.join(root, "obs"));
  return root;
}

function filesOf(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n), r = rel ? rel + "/" + n : n;
      if (fs.statSync(p).isDirectory()) { out[r + "/"] = "dir"; walk(p, r); } else out[r] = fs.readFileSync(p).toString("base64");
    }
  };
  walk(root, "");
  return out;
}

const HANDOFF = [["rec/manifest.json", "{\"session_id\":\"s\"}"], ["rec/annotations.json", JSON.stringify({ handoffs: [ENTRY] })],
  ["rec/events.jsonl", ""], ["Order entry v1 PDD.docx", "d"]];

test("zipKind: a hand-off is a hand-off; the capture app's zip, a Whole project zip and a zip of a folder's contents are projects", async () => {
  const base = tmpBase();
  try {
    assert.deepEqual(await HO.zipKind(rawZip(path.join(base, "h.zip"), HANDOFF)), { kind: "handoff" });
    // The capture app's zip: its root is the time stamp folder.
    const rec = makeRecording(base, "20260924-101500");
    const capture = (await zipFolder(rec, path.join(base, "Order entry.zip"))).zipPath;
    const k = await HO.zipKind(capture);
    assert.equal(k.kind, "project");
    assert.equal(k.top, "20260924-101500");
    assert.equal(k.name, "Order entry", "named after the zip, not after the time stamp folder in it");
    assert.equal(k.manifest.label, "Order entry");
    assert.ok(k.entries.some((e) => e.out === "screenshots/0001.png"));
    // The Whole project zip of a project handed off before: a working copy.
    const whole = rawZip(path.join(base, "whole.zip"), HANDOFF.slice(0, 3));
    assert.equal((await HO.zipKind(whole)).kind, "project");
    // The project at the zip's root: named after the zip.
    const flat = rawZip(path.join(base, "Invoice check.zip"), [["manifest.json", "{}"], ["events.jsonl", ""]]);
    const f = await HO.zipKind(flat);
    assert.equal(f.kind, "project");
    assert.equal(f.top, "");
    assert.equal(f.name, "Invoice check");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("zipKind: a zip with no project, two projects, a file that would land outside, or no zip at all says so in one sentence", async () => {
  const base = tmpBase();
  try {
    await assert.rejects(HO.zipKind(rawZip(path.join(base, "none.zip"), [["notes.txt", "x"]])),
      (e) => e instanceof HO.HandoffOpenError && e.message === "This zip holds no project (no manifest.json).");
    await assert.rejects(HO.zipKind(rawZip(path.join(base, "two.zip"), [["a/manifest.json", "{}"], ["b/manifest.json", "{}"]])),
      (e) => e.message === "This zip holds 2 projects: add a zip of one project.");
    await assert.rejects(HO.zipKind(rawZip(path.join(base, "slip.zip"), [["rec/manifest.json", "{}"], ["../evil.txt", "x"]])), /outside its folder/);
    fs.writeFileSync(path.join(base, "not.zip"), "hello");
    await assert.rejects(HO.zipKind(path.join(base, "not.zip")), /not a zip/);
    await assert.rejects(HO.zipKind(path.join(base, "gone.zip")), /not found/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("extractProjectZip: the capture app's zip unzips into the folder named, the recording byte for byte, with progress", async () => {
  const base = tmpBase();
  try {
    const rec = makeRecording(base, "20260924-101500");
    const zip = (await zipFolder(rec, path.join(base, "Order entry.zip"))).zipPath;
    const k = await HO.zipKind(zip);
    const dest = path.join(base, "out", "Order entry");
    const seen = [];
    const r = await HO.extractProjectZip(zip, k, dest, { onProgress: (done, total) => seen.push([done, total]) });
    assert.equal(r.folder, path.resolve(dest));
    assert.deepEqual(filesOf(dest), filesOf(rec));
    assert.ok(seen.length > 0 && seen[seen.length - 1][0] === seen[seen.length - 1][1], "the progress reaches the whole");
    assert.deepEqual(fs.readdirSync(path.join(base, "out")), ["Order entry"], "no hidden folder is left beside it");
    // An empty folder of that name is taken.
    const empty = path.join(base, "empty");
    fs.mkdirSync(empty);
    await HO.extractProjectZip(zip, k, empty);
    assert.ok(fs.existsSync(path.join(empty, "manifest.json")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("extractProjectZip: a folder that is there and not empty, or a file of that name, is refused and nothing is written", async () => {
  const base = tmpBase();
  try {
    const zip = rawZip(path.join(base, "p.zip"), [["rec/manifest.json", "{}"], ["rec/events.jsonl", ""]]);
    const k = await HO.zipKind(zip);
    const full = path.join(base, "full");
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, "keep.txt"), "mine");
    await assert.rejects(HO.extractProjectZip(zip, k, full),
      (e) => e instanceof HO.HandoffOpenError && e.message === "a folder of that name is there and it is not empty (" + full + ").");
    assert.deepEqual(fs.readdirSync(full), ["keep.txt"]);
    const file = path.join(base, "afile");
    fs.writeFileSync(file, "x");
    await assert.rejects(HO.extractProjectZip(zip, k, file), /a file of that name is there/);
    assert.deepEqual(fs.readdirSync(base).sort(), ["afile", "full", "p.zip"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("extractProjectZip: a damaged file or a Cancel leaves no folder, whole or half", async () => {
  const base = tmpBase();
  try {
    const zip = rawZip(path.join(base, "p.zip"), [["rec/manifest.json", "{}"], ["rec/events.jsonl", "AAAAAAAAAAAAAAAA"]]);
    const k = await HO.zipKind(zip);
    // Damage the events' bytes (stored): their CRC no longer matches.
    const buf = fs.readFileSync(zip);
    const at = buf.indexOf(Buffer.from("AAAAAAAAAAAAAAAA"));
    buf.write("BBBB", at);
    fs.writeFileSync(zip, buf);
    const dest = path.join(base, "Damaged");
    await assert.rejects(HO.extractProjectZip(zip, k, dest), /damaged/);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(base), ["p.zip"], "the hidden folder is gone too");
    // Cancelled before it starts, and while a file streams.
    const rec = makeRecording(base, "rec2");
    const good = (await zipFolder(rec, path.join(base, "good.zip"))).zipPath;
    const k2 = await HO.zipKind(good);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(HO.extractProjectZip(good, k2, path.join(base, "C1"), { signal: ac.signal }), (e) => e.cancelled === true && e.message === HO.CANCELLED);
    const ac2 = new AbortController();
    await assert.rejects(HO.extractProjectZip(good, k2, path.join(base, "C2"),
      { signal: ac2.signal, onProgress: (done) => { if (done > 1000) ac2.abort(); } }), (e) => e.cancelled === true);
    assert.deepEqual(fs.readdirSync(base).sort(), ["good.zip", "p.zip", "rec2"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("readProjectZip (the Library builder's) still reads the project where it is, and never refuses a stray entry", async () => {
  const base = tmpBase();
  try {
    const zip = rawZip(path.join(base, "p.zip"), [["rec/manifest.json", "{\"label\":\"x\"}"], ["../stray.txt", "x"]]);
    const r = await HO.readProjectZip(zip);
    assert.deepEqual(r, { top: "rec", manifest: { label: "x" }, annotations: null });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
