"use strict";
// The hand-off's zip (handoff-zip.js) and its read-only open
// (handoff-open.js), lane HV, contract C20. Each zip is read back by an
// independent reader (central directory, local headers, inflate, zlib's
// CRC) and compared with the folder file by file; then it is opened as a
// developer opens it, extracted under a temporary userData. The real Export
// menu, the PDD inside and the read-only viewer are in e2e/handoff-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const HZ = require("./handoff-zip.js");
const HO = require("./handoff-open.js");

const NAME = "sess-2026-0514-0900";
const ENTRY = { version: 1, handed_off_at: "2026-09-25T10:00:00.000Z", by: "rasha", note: "First hand-off" };

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-handoff-zip-"));
}

/* A project folder (invented data) whose annotations.json holds `handoffs`. */
function makeProject(base, handoffs) {
  const root = path.join(base, NAME);
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  const bytes = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 7) & 0xff; return b; };
  write("manifest.json", JSON.stringify({ session_id: "s-1", started_at: "2026-05-14T09:00:00Z" }));
  write("events.jsonl", "{}\n");
  write("annotations.json", JSON.stringify({ version: 1, document: { title: "Order entry" }, handoffs: handoffs || [ENTRY] }));
  write("video/call.webm", bytes(120000, 31));
  write("attachments/Überweisung.csv", "sku,qty\nA-1,4\n");
  fs.mkdirSync(path.join(root, "obs"));
  return root;
}

function extras(base, tag) {
  const pdd = path.join(base, "made-" + tag + ".docx");
  const tech = path.join(base, "made-" + tag + ".xlsx");
  fs.writeFileSync(pdd, Buffer.from("PK fake docx " + tag));
  fs.writeFileSync(tech, Buffer.from("PK fake xlsx " + tag));
  return { pdd, tech };
}

function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  assert.equal(eocd + 22, buf.length, "the end record closes the file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  assert.equal(p + buf.readUInt32LE(eocd + 12), eocd, "the central directory ends where the end record starts");
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, "local header of " + name);
    assert.equal(buf.readUInt32LE(offset + 14), crc, "local CRC of " + name);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, usize, "size of " + name);
    assert.equal(zlib.crc32(data) >>> 0, crc, "CRC of " + name);
    assert.equal(flags & 0x0800, 0x0800, "UTF-8 name " + name);
    out[name] = data;
  }
  return out;
}

function folderFiles(root) {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + e.name + "/");
      else out.push(rel + e.name);
    }
  })(root, path.basename(root) + "/");
  return out.sort();
}

/* A small zip of stored entries with any names (the tests' bad zips). */
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

test("the hand-off zip holds the project folder byte for byte and, at its root, the PDD, the Technical details and Start here.txt", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const x = extras(base, "1");
    const r = await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech, entry: ENTRY });
    assert.equal(r.zipPath, path.join(base, "Order entry v1.zip"));
    assert.equal(r.bytes, fs.statSync(r.zipPath).size);
    const entries = readZip(r.zipPath);
    assert.equal(Object.keys(entries).length, r.entries);
    const files = Object.keys(entries).filter((n) => !n.endsWith("/"));
    assert.deepEqual(files.filter((n) => n.includes("/")).sort(), folderFiles(root), "the whole folder, nothing else in it");
    assert.deepEqual(files.filter((n) => !n.includes("/")).sort(), ["Order entry v1 PDD.docx", "Order entry v1 Technical details.xlsx", "Start here.txt"]);
    assert.deepEqual(r.root, ["Order entry v1 PDD.docx", "Order entry v1 Technical details.xlsx", "Start here.txt"]);
    assert.deepEqual(entries["Order entry v1 PDD.docx"], fs.readFileSync(x.pdd));
    assert.deepEqual(entries["Order entry v1 Technical details.xlsx"], fs.readFileSync(x.tech));
    assert.ok(entries[NAME + "/obs/"], "the empty folder comes along");
    assert.deepEqual(entries[NAME + "/video/call.webm"], fs.readFileSync(path.join(root, "video", "call.webm")));
    assert.deepEqual(fs.readdirSync(base).sort(), ["Order entry v1.zip", "made-1.docx", "made-1.xlsx", NAME].sort(),
      "no building or partial file left, nothing written in the folder");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a hand-off zip never replaces another: the same name again is \"(2)\", and the first stays as it was", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const x = extras(base, "a");
    const first = await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech });
    const before = fs.readFileSync(first.zipPath);
    const second = await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech });
    assert.equal(second.zipPath, path.join(base, "Order entry v1 (2).zip"));
    assert.deepEqual(fs.readFileSync(first.zipPath), before);
    assert.throws(() => HZ.handoffTarget(path.parse(process.cwd()).root, "X", 1, () => false),
      /top of a drive/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a zip that fails halfway leaves nothing under its name", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    await assert.rejects(HZ.writeHandoffZip(root, { base: "Order entry", version: 1,
      pdd: path.join(base, "missing.docx"), tech: path.join(base, "missing.xlsx") }), (e) => e.code === "ENOENT");
    assert.deepEqual(fs.readdirSync(base), [NAME]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("opening a hand-off: extracted under <userData>/handoffs/<project> v<N>, read only, and the same zip opens the same folder again", async () => {
  const base = tmpBase();
  const userData = path.join(base, "userData");
  try {
    const root = makeProject(base);
    const x = extras(base, "1");
    const zip = (await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech })).zipPath;
    const opened = await HO.openHandoffZip(zip, userData);
    assert.equal(opened.root, path.join(userData, "handoffs", "Order entry v1"));
    assert.equal(opened.folder, path.join(opened.root, NAME));
    assert.equal(opened.version, 1);
    assert.equal(opened.reused, false);
    for (const rel of folderFiles(root)) {
      const inside = rel.split("/").slice(1).join(path.sep);
      assert.deepEqual(fs.readFileSync(path.join(opened.folder, inside)), fs.readFileSync(path.join(root, inside)), rel);
    }
    assert.ok(fs.statSync(path.join(opened.folder, "obs")).isDirectory());
    assert.ok(HO.isReadOnlyFolder(userData, opened.folder), "the project opens read only");
    assert.ok(!HO.isReadOnlyFolder(userData, root), "the analyst's own folder does not");
    assert.ok(!HO.isReadOnlyFolder(userData, path.join(userData, "handoffs")), "nor the folder of the hand-offs itself");
    assert.ok(!HO.isReadOnlyFolder(null, opened.folder), "no userData, nothing is");
    assert.equal(HO.handoffFile(opened.folder, "pdd"), path.join(opened.root, "Order entry v1 PDD.docx"));
    assert.equal(HO.handoffFile(opened.folder, "tech"), path.join(opened.root, "Order entry v1 Technical details.xlsx"));
    assert.equal(HO.handoffFile(opened.folder, "other"), null);
    // The same zip again: the same folder, nothing extracted again.
    const stamp = fs.statSync(path.join(opened.folder, "manifest.json")).mtimeMs;
    const again = await HO.openHandoffZip(zip, userData);
    assert.equal(again.root, opened.root);
    assert.equal(again.reused, true);
    assert.equal(fs.statSync(path.join(opened.folder, "manifest.json")).mtimeMs, stamp);
    assert.deepEqual(fs.readdirSync(path.join(userData, "handoffs")), ["Order entry v1"], "no temporary folder left");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("another hand-off of the same version gets a folder of its own; a newer version just opens", async () => {
  const base = tmpBase();
  const userData = path.join(base, "userData");
  try {
    const root = makeProject(base);
    const x = extras(base, "1");
    const one = (await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech })).zipPath;
    await HO.openHandoffZip(one, userData);
    // The version taken back and handed off again: the same number, another time.
    fs.writeFileSync(path.join(root, "annotations.json"), JSON.stringify({ document: { title: "Order entry" },
      handoffs: [Object.assign({}, ENTRY, { handed_off_at: "2026-09-25T11:00:00.000Z" })] }));
    const redone = (await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech })).zipPath;
    const r2 = await HO.openHandoffZip(redone, userData);
    assert.equal(path.basename(r2.root), "Order entry v1 (2)");
    fs.writeFileSync(path.join(root, "annotations.json"), JSON.stringify({ document: { title: "Order entry" },
      handoffs: [ENTRY, { version: 2, handed_off_at: "2026-09-26T09:00:00.000Z", by: "rasha", note: "Credit check" }] }));
    const two = (await HZ.writeHandoffZip(root, { base: "Order entry", version: 2, pdd: x.pdd, tech: x.tech })).zipPath;
    const r3 = await HO.openHandoffZip(two, userData);
    assert.equal(path.basename(r3.root), "Order entry v2");
    assert.equal(r3.version, 2);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a hand-off unzipped by hand (Extract All) is read only too: its PDD and Technical details lie beside the project", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const x = extras(base, "1");
    const zip = (await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech })).zipPath;
    // What Extract All makes: a folder named after the zip, holding the zip's root.
    const out = path.join(base, "Order entry v1");
    for (const [name, data] of Object.entries(readZip(zip))) {
      const target = path.join(out, ...name.split("/").filter(Boolean));
      if (name.endsWith("/")) fs.mkdirSync(target, { recursive: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
    }
    const project = path.join(out, NAME);
    assert.equal(HO.isReadOnlyProject(null, project), true, "the unzipped project");
    assert.equal(HO.handoffFile(project, "pdd"), path.join(out, "Order entry v1 PDD.docx"));
    assert.equal(HO.handoffFile(project, "tech"), path.join(out, "Order entry v1 Technical details.xlsx"));
    assert.equal(HO.isReadOnlyProject(null, root), false, "the analyst's own project, the zip beside it, stays writable");
    // The Technical details are not needed (none where nothing was recorded).
    fs.renameSync(path.join(out, "Order entry v1 Technical details.xlsx"), path.join(out, "Order entry v0 Technical details.xlsx"));
    assert.equal(HO.isReadOnlyProject(null, project), true, "its PDD beside it is enough");
    assert.equal(HO.handoffFile(project, "tech"), null, "and no Technical details are offered");
    // Only the PDD of the version the project lists last counts.
    fs.renameSync(path.join(out, "Order entry v1 PDD.docx"), path.join(out, "Order entry v0 PDD.docx"));
    assert.equal(HO.isReadOnlyProject(null, project), false, "no PDD of version 1 beside it");
    assert.equal(HO.unzippedHandoffFiles(path.join(base, "nowhere")), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a zip that is no hand-off, or would write outside its folder, is refused and nothing is extracted", async () => {
  const base = tmpBase();
  const userData = path.join(base, "userData");
  try {
    // The SME's recording zip: a project folder, no hand-off version.
    const sme = rawZip(path.join(base, "sme.zip"), [["rec/manifest.json", "{\"session_id\":\"s\"}"], ["rec/events.jsonl", ""]]);
    await assert.rejects(HO.openHandoffZip(sme, userData), (e) => e instanceof HO.HandoffOpenError && e.message === HO.NOT_A_HANDOFF);
    // The Whole project zip of a project handed off before: its version entry,
    // but not the documents of that version at its root. A working copy, never
    // shown as a version.
    const whole = rawZip(path.join(base, "whole.zip"), [
      ["rec/manifest.json", "{\"session_id\":\"s\"}"], ["rec/annotations.json", JSON.stringify({ handoffs: [ENTRY] })]]);
    await assert.rejects(HO.openHandoffZip(whole, userData), (e) => e.message === HO.NOT_A_HANDOFF);
    const older = rawZip(path.join(base, "older.zip"), [
      ["rec/manifest.json", "{}"], ["rec/annotations.json", JSON.stringify({ handoffs: [ENTRY, Object.assign({}, ENTRY, { version: 2 })] })],
      ["Order entry v1 PDD.docx", "d"], ["Order entry v1 Technical details.xlsx", "x"]]);
    await assert.rejects(HO.openHandoffZip(older, userData), (e) => e.message === HO.NOT_A_HANDOFF,
      "the documents of another version than the one the project lists last");
    const slip = rawZip(path.join(base, "slip.zip"), [
      ["rec/manifest.json", "{}"], ["rec/annotations.json", JSON.stringify({ handoffs: [ENTRY] })], ["../evil.txt", "x"]]);
    await assert.rejects(HO.openHandoffZip(slip, userData), /outside its folder/);
    const drive = rawZip(path.join(base, "drive.zip"), [["C:/evil.txt", "x"]]);
    await assert.rejects(HO.openHandoffZip(drive, userData), /outside its folder/);
    fs.writeFileSync(path.join(base, "not.zip"), "hello");
    await assert.rejects(HO.openHandoffZip(path.join(base, "not.zip"), userData), /not a zip/);
    await assert.rejects(HO.openHandoffZip(path.join(base, "gone.zip"), userData), /not found/);
    assert.ok(!fs.existsSync(path.join(base, "evil.txt")));
    const left = fs.existsSync(path.join(userData, "handoffs")) ? fs.readdirSync(path.join(userData, "handoffs")) : [];
    assert.deepEqual(left, []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("an entry's name is kept inside the folder it is extracted to", () => {
  assert.equal(HO.safeEntryName("a/b.txt"), "a/b.txt");
  assert.equal(HO.safeEntryName("a\\b.txt"), "a/b.txt");
  assert.equal(HO.safeEntryName("a/"), "a/");
  for (const bad of ["../x", "a/../../x", "/abs", "C:/x", "c:x", "a//b", "", "a/./b", "a:b/c"]) {
    assert.equal(HO.safeEntryName(bad), null, bad);
  }
});

/* Contract C21: the Library builder reads a hand-off's steps from its zip
   where it is (annotations.json and manifest.json only), never extracting it. */
test("readProjectZip reads the zip's project where it is: its manifest and annotations, nothing extracted", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const zip = path.join(base, "whole.zip");
    await require("./zip-folder.js").zipFolder(root, zip);
    const before = fs.readdirSync(base).sort();
    const got = await HO.readProjectZip(zip);
    assert.equal(got.top, NAME);
    assert.equal(got.manifest.session_id, "s-1");
    assert.equal(got.annotations.document.title, "Order entry");
    assert.deepEqual(fs.readdirSync(base).sort(), before, "nothing extracted");
    const flat = rawZip(path.join(base, "flat.zip"), [["manifest.json", "{\"session_id\":\"f\"}"]]);
    assert.deepEqual(await HO.readProjectZip(flat), { top: "", manifest: { session_id: "f" }, annotations: null },
      "the project at the root, without annotations.json");
    const two = rawZip(path.join(base, "two.zip"), [["a/manifest.json", "{}"], ["b/manifest.json", "{}"]]);
    await assert.rejects(HO.readProjectZip(two), (e) => e instanceof HO.HandoffOpenError && /holds 2 projects/.test(e.message));
    const none = rawZip(path.join(base, "none.zip"), [["notes.txt", "x"]]);
    await assert.rejects(HO.readProjectZip(none), /holds no project/);
    const bad = rawZip(path.join(base, "bad.zip"), [["p/manifest.json", "{}"], ["p/annotations.json", "{ not json"]]);
    await assert.rejects(HO.readProjectZip(bad), /annotations.json in this zip cannot be read/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/* ---- What a hand-off zip leaves out, and what it adds at its root -------- */

test("leftOutOfHandoff: the backups and the log at the folder's root, a staged output or a zip being built anywhere", () => {
  for (const rel of ["annotations.json.2", "annotations.json.3", "annotations.json.4", "annotations.json.5",
    "normalize.log", "stats.json.pdt-staged", "analysis.json.pdt-staged", "derived_maps/m1.bpmn.pdt-staged",
    "Order entry v1.zip.building", "attachments/old.zip.building", "staged.pdt-staged/"]) {
    assert.equal(HZ.leftOutOfHandoff(rel), true, rel);
  }
  for (const rel of ["annotations.json", "annotations.json.1", "annotations.json.6", "annotations.json.2.txt",
    "annotations.unreadable-20261109-101500.json", "attachments/normalize.log", "attachments/annotations.json.2",
    "notes/normalize.log", "normalize.log.txt", "manifest.json", "events.jsonl", "video/call.webm", "attachments/",
    "screenshots/analyst/", "pdt-staged.txt", "building.zip"]) {
    assert.equal(HZ.leftOutOfHandoff(rel), false, rel);
  }
});

/* The project folder with what a working folder also holds: the backups,
   the log, a staged output, and files named like them deeper in. */
function addWorkingFiles(root) {
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  for (let i = 2; i <= 5; i++) write("annotations.json." + i, "{\"backup\":" + i + "}");
  write("normalize.log", "[normalize] done\n");
  write("stats.json.pdt-staged", "{}");
  write("derived_maps/m1.bpmn.pdt-staged", "<x/>");
  write("attachments/normalize.log", "the SME's own log, attached");
  write("attachments/annotations.json.2", "an attached file of that name");
}

test("a hand-off zip leaves the backups, the log and staged outputs out of the project folder; the Whole project zip keeps them", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    addWorkingFiles(root);
    const x = extras(base, "1");
    const svg = path.join(base, "made.svg"), bpmn = path.join(base, "made.bpmn");
    fs.writeFileSync(svg, "<svg/>");
    fs.writeFileSync(bpmn, "<definitions/>");
    const r = await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: x.tech,
      mapSvg: svg, mapBpmn: bpmn, entry: ENTRY });
    const entries = readZip(r.zipPath);
    const inFolder = Object.keys(entries).filter((n) => n.startsWith(NAME + "/") && !n.endsWith("/")).sort();
    const left = ["annotations.json.2", "annotations.json.3", "annotations.json.4", "annotations.json.5", "normalize.log",
      "stats.json.pdt-staged", "derived_maps/m1.bpmn.pdt-staged"].map((n) => NAME + "/" + n);
    assert.deepEqual(inFolder, folderFiles(root).filter((n) => !left.includes(n)), "everything else, byte for byte below");
    for (const n of left) assert.ok(!entries[n], n + " is left out");
    assert.deepEqual(entries[NAME + "/attachments/normalize.log"], fs.readFileSync(path.join(root, "attachments", "normalize.log")),
      "a file merely named like the log, deeper in, stays");
    assert.ok(entries[NAME + "/attachments/annotations.json.2"], "and so does one named like a backup");
    assert.ok(entries[NAME + "/derived_maps/"], "the folder of a staged file stays");
    // The root: the PDD, the Technical details, the map files, Start here.txt.
    const atRoot = Object.keys(entries).filter((n) => !n.includes("/"));
    assert.deepEqual(atRoot, ["Order entry v1 PDD.docx", "Order entry v1 Technical details.xlsx", "Order entry v1 map.svg",
      "Order entry v1 map.bpmn", "Start here.txt"]);
    assert.deepEqual(entries["Order entry v1 map.svg"], fs.readFileSync(svg));
    assert.deepEqual(entries["Order entry v1 map.bpmn"], fs.readFileSync(bpmn));
    const note = entries["Start here.txt"].toString("utf8");
    assert.equal(note, require("./handoff.js").startHereText({ base: "Order entry", version: 1, entry: ENTRY, folder: NAME,
      has: { tech: true, mapSvg: true, mapBpmn: true } }));
    assert.ok(note.startsWith("Order entry: version 1, handed off 2026-09-25 by rasha\r\n"), note);
    // The Whole project zip of the same folder: the whole folder, the backups and the log too.
    const whole = await require("./project-zip.js").zipProject(root);
    const all = Object.keys(readZip(whole.zipPath)).filter((n) => !n.endsWith("/")).sort();
    assert.deepEqual(all, folderFiles(root));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the Technical details are optional: a hand-off without them carries the PDD and Start here.txt without their line", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const x = extras(base, "1");
    const r = await HZ.writeHandoffZip(root, { base: "Order entry", version: 1, pdd: x.pdd, tech: null, entry: ENTRY });
    const entries = readZip(r.zipPath);
    assert.deepEqual(Object.keys(entries).filter((n) => !n.includes("/")), ["Order entry v1 PDD.docx", "Start here.txt"]);
    const note = entries["Start here.txt"].toString("utf8");
    assert.ok(!note.includes("Technical details") && !note.includes("map.svg") && !note.includes("map.bpmn"), note);
    assert.ok(note.includes("  Order entry v1 PDD.docx   The process written down. Read this first.\r\n"), note);
    // The PDD stays required.
    await assert.rejects(HZ.writeHandoffZip(root, { base: "Order entry", version: 2, pdd: path.join(base, "missing.docx"), tech: null }),
      (e) => e.code === "ENOENT");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("both shapes of a hand-off zip open read only: one made before Start here.txt and the map files, and one without the Technical details", async () => {
  const base = tmpBase();
  const userData = path.join(base, "userData");
  try {
    const anno = JSON.stringify({ document: { title: "Order entry" }, handoffs: [ENTRY] });
    // Before this change: the folder, the PDD and the Technical details at the root.
    const before = rawZip(path.join(base, "Order entry v1.zip"), [
      [NAME + "/manifest.json", "{\"session_id\":\"s-1\"}"], [NAME + "/annotations.json", anno],
      [NAME + "/annotations.json.2", "{}"], ["Order entry v1 PDD.docx", "d"], ["Order entry v1 Technical details.xlsx", "x"]]);
    const a = await HO.openHandoffZip(before, userData);
    assert.equal(a.version, 1);
    assert.equal(a.tech, "Order entry v1 Technical details.xlsx");
    assert.equal(HO.handoffFile(a.folder, "tech"), path.join(a.root, "Order entry v1 Technical details.xlsx"));
    // After: no Technical details (nothing recorded), the map files and Start here.txt.
    const root = makeProject(base);
    const x = extras(base, "1");
    const after = (await HZ.writeHandoffZip(root, { base: "Call", version: 1, pdd: x.pdd, tech: null, entry: ENTRY })).zipPath;
    const b = await HO.openHandoffZip(after, path.join(base, "userData2"));
    assert.equal(b.version, 1);
    assert.equal(b.tech, null);
    assert.equal(HO.handoffFile(b.folder, "pdd"), path.join(b.root, "Call v1 PDD.docx"));
    assert.equal(HO.handoffFile(b.folder, "tech"), null, "no Technical details of this version");
    assert.ok(fs.existsSync(path.join(b.root, "Start here.txt")));
    assert.ok(HO.isReadOnlyFolder(path.join(base, "userData2"), b.folder));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
