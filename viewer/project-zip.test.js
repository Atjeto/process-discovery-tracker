"use strict";
// Export, Whole project (.zip) (project-zip.js on zip-folder.js): the project
// folder as one zip next to it. Each zip is read back here by an independent
// reader (central directory, local headers, inflate, zlib's CRC) and compared
// with the folder file by file. The real Export menu, a real project with a
// video and Explorer's reveal are in e2e/companion-smoke.js (p).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const PZ = require("./project-zip.js");
const { ZipTooLargeError } = require("./zip-folder.js");

const NAME = "Order call Überprüfung";

/* A project folder shaped like a real one (invented data): the recording,
   the analyst's work and backups, the analysis, a video, a transcript,
   screenshots, attachments, an edited map, and an empty folder. */
function makeProject(base) {
  const root = path.join(base, NAME);
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  const bytes = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 7) & 0xff; return b; };
  write("manifest.json", JSON.stringify({ session_id: "s-1", source: "video", label: NAME }));
  write("events.jsonl", "");
  write("annotations.json", JSON.stringify({ version: 1, steps: [{ step_id: "a", name: "Check the customer" }], document: { purpose: "Hand over" } }, null, 2));
  write("annotations.json.2", JSON.stringify({ version: 1, steps: [] }));
  write("stats.json", JSON.stringify({ case_stats: [] }).repeat(50));
  write("transcript.json", JSON.stringify({ offset_ms: 0, segments: [] }));
  write("transcript/meeting.vtt", "WEBVTT\n\nSME: we start with the order\n");
  write("video/call.webm", bytes(200000, 31));
  write("screenshots/rec-1.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bytes(3000, 13)]));
  write("screenshots/analyst/0b1c.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bytes(900, 3)]));
  write("attachments/order email.txt", "Dear team, please enter order 4711.");
  write("attachments/Überweisung.csv", "sku,qty\nA-1,4\n");
  write("derived_maps/m1.bpmn", "<?xml version=\"1.0\"?><definitions/>");
  fs.mkdirSync(path.join(root, "obs"));   // stays empty
  return root;
}

/* Every file under `root`, as zip names ("<root name>/<rel>" with "/"). */
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

/* An independent zip reader: every entry by the central directory, its bytes
   through the local header, inflated when deflated, CRC checked with zlib. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  assert.strictEqual(p + buf.readUInt32LE(eocd + 12), eocd, "central directory ends where the end record starts");
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, "central header signature");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    assert.strictEqual(buf.readUInt32LE(offset), 0x04034b50, "local header signature for " + name);
    assert.strictEqual(buf.readUInt32LE(offset + 14), crc, "local CRC matches central for " + name);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.slice(start, start + csize);
    assert.ok(method === 0 || method === 8, "stored or deflated: " + name);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.strictEqual(data.length, usize, "size for " + name);
    assert.strictEqual(zlib.crc32(data) >>> 0, crc, "CRC for " + name);
    entries.push({ name, method, flags, data });
  }
  return entries;
}

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-project-zip-"));
}

test("viewer/zip-folder.js stays in step with capture/zip-folder.js: the code below the header comment is the same", (t) => {
  const capture = path.join(__dirname, "..", "capture", "zip-folder.js");
  if (!fs.existsSync(capture)) { t.skip("capture/zip-folder.js is not beside the viewer here"); return; }
  const MARK = 'const fs = require("node:fs");';
  const code = (file) => {
    const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const at = src.indexOf(MARK);
    assert.ok(at > 0, "the code of " + file + " starts with " + MARK);
    return src.slice(at);
  };
  assert.strictEqual(code(path.join(__dirname, "zip-folder.js")), code(capture),
    "The two copies differ: change viewer/zip-folder.js and capture/zip-folder.js together.");
});

test("the zip holds the whole project folder next to it, as <name>.zip: every file byte for byte, the empty folder too, UTF-8 names", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const r = await PZ.zipProject(root);
    assert.strictEqual(r.zipPath, path.join(base, NAME + ".zip"));
    assert.strictEqual(r.bytes, fs.statSync(r.zipPath).size);
    const entries = readZip(r.zipPath);
    assert.strictEqual(r.entries, entries.length);
    const files = entries.filter((e) => !e.name.endsWith("/"));
    assert.deepStrictEqual(files.map((e) => e.name).sort(), folderFiles(root), "every file of the folder, nothing else");
    for (const e of files) {
      const rel = e.name.split("/").slice(1).join(path.sep);
      assert.deepStrictEqual(e.data, fs.readFileSync(path.join(root, rel)), "content of " + e.name);
      assert.strictEqual(e.flags & 0x0800, 0x0800, "UTF-8 flag on " + e.name);
    }
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    assert.ok(byName[NAME + "/"], "the zip's root is the project folder");
    assert.ok(byName[NAME + "/obs/"], "the empty folder comes along");
    assert.ok(byName[NAME + "/attachments/Überweisung.csv"], "a UTF-8 name");
    assert.strictEqual(byName[NAME + "/video/call.webm"].method, 0, "the video is stored as it is");
    assert.strictEqual(byName[NAME + "/annotations.json"].method, 8, "annotations.json is deflated");
    assert.strictEqual(JSON.parse(byName[NAME + "/annotations.json"].data.toString("utf8")).document.purpose, "Hand over");
    assert.deepStrictEqual(fs.readdirSync(base).sort(), [NAME, NAME + ".zip"], "no partial file left, nothing written inside the folder");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a zip never replaces an earlier one: the second is <name> (2).zip, the third <name> (3).zip, the first stays as it was", async () => {
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const first = await PZ.zipProject(root);
    const firstBytes = fs.readFileSync(first.zipPath);
    fs.writeFileSync(path.join(root, "annotations.json"), JSON.stringify({ version: 1, document: { purpose: "Changed" } }));
    const second = await PZ.zipProject(root);
    const third = await PZ.zipProject(root);
    assert.strictEqual(second.zipPath, path.join(base, NAME + " (2).zip"));
    assert.strictEqual(third.zipPath, path.join(base, NAME + " (3).zip"));
    assert.deepStrictEqual(fs.readFileSync(first.zipPath), firstBytes, "the first zip is untouched");
    const anno = readZip(second.zipPath).find((e) => e.name === NAME + "/annotations.json");
    assert.strictEqual(JSON.parse(anno.data.toString("utf8")).document.purpose, "Changed", "the second zip has the folder as it is now");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("where the zip goes: next to the folder, named after it, numbered when taken; a folder at the top of a drive is refused", () => {
  const taken = new Set([path.join("D:\\work", "Order call.zip"), path.join("D:\\work", "Order call (2).zip")]);
  assert.strictEqual(PZ.zipTargetFor("D:\\work\\Order call", () => false), path.join("D:\\work", "Order call.zip"));
  assert.strictEqual(PZ.zipTargetFor("D:\\work\\Order call\\", (p) => taken.has(p)), path.join("D:\\work", "Order call (3).zip"));
  const driveRoot = path.parse(process.cwd()).root;
  assert.throws(() => PZ.zipTargetFor(driveRoot, () => false), (e) => e instanceof PZ.ProjectZipError &&
    PZ.describeZipError(e) === "A project at the top of a drive cannot be zipped next to itself: move its folder into another folder first.");
});

test("a file gone during the zip (a save replaced it through a temporary file): once more, and only once, while the project is there", async () => {
  const root = path.resolve("D:\\work\\Order call");
  const enoent = () => Object.assign(new Error("ENOENT: no such file or directory, stat 'annotations.json.tmp-1-2'"), { code: "ENOENT" });
  const exists = (p) => p === path.join(root, "manifest.json");
  // First try fails, the second succeeds.
  let calls = [];
  const flaky = async (folder, target) => { calls.push([folder, target]); if (calls.length === 1) throw enoent(); return { zipPath: target, bytes: 10, entries: 1 }; };
  const r = await PZ.zipProject(root, { zipFolder: flaky, exists });
  assert.strictEqual(calls.length, 2, "tried again");
  assert.deepStrictEqual(calls[1], [root, path.join(path.dirname(root), "Order call.zip")], "the same target, a new listing");
  assert.strictEqual(r.zipPath, path.join(path.dirname(root), "Order call.zip"));
  // Twice gone: the second failure is the answer.
  calls = [];
  const gone = async (folder, target) => { calls.push([folder, target]); throw enoent(); };
  await assert.rejects(PZ.zipProject(root, { zipFolder: gone, exists }), (e) => e.code === "ENOENT");
  assert.strictEqual(calls.length, 2);
  // The project itself is gone: no second try.
  calls = [];
  await assert.rejects(PZ.zipProject(root, { zipFolder: gone, exists: () => false }), (e) => e.code === "ENOENT");
  assert.strictEqual(calls.length, 1);
  // Any other failure: no second try.
  calls = [];
  const locked = async (folder, target) => { calls.push([folder, target]); throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" }); };
  await assert.rejects(PZ.zipProject(root, { zipFolder: locked, exists }), (e) => e.code === "EBUSY");
  assert.strictEqual(calls.length, 1);
});

test("the sentences the analyst reads when the zip was not made, and the size", () => {
  assert.strictEqual(PZ.describeZipError(new ZipTooLargeError("This recording is too large for a zip (over 4 GB). Copy the folder instead.")),
    "The project is too large for a zip (over 4 GB, or more than 65,535 files): copy the folder instead.");
  for (const code of ["EBUSY", "EPERM", "EACCES"]) {
    assert.strictEqual(PZ.describeZipError({ code }),
      "A file of the project is open in another program, or the folder that holds the project cannot be written to.");
  }
  assert.strictEqual(PZ.describeZipError({ code: "ENOSPC" }), "The disk is full.");
  assert.strictEqual(PZ.describeZipError({ code: "ENOENT" }),
    "A file of the project was not found while it was zipped: was the project folder moved or renamed?");
  assert.strictEqual(PZ.describeZipError(new Error("EIO: i/o error, read.")), "Windows reported: EIO: i/o error, read.");
  assert.strictEqual(PZ.humanSize(0), "0 B");
  assert.strictEqual(PZ.humanSize(512), "512 B");
  assert.strictEqual(PZ.humanSize(840 * 1024), "840 KB");
  assert.strictEqual(PZ.humanSize(1.25 * 1024 * 1024 * 1024), "1.3 GB");
});

test("zipFolder's optional leaveOut leaves out the paths it names (the hand-off's rule); without it the zip is the whole folder", async () => {
  const { zipFolder } = require("./zip-folder.js");
  const base = tmpBase();
  try {
    const root = makeProject(base);
    const top = path.basename(root) + "/";
    const asked = [];
    const r = await zipFolder(root, path.join(base, "some.zip"), (rel) => { asked.push(rel); return rel === "annotations.json.2" || rel === "transcript/"; });
    const names = readZip(r.zipPath).map((e) => e.name);
    assert.ok(!names.includes(top + "annotations.json.2"));
    assert.ok(!names.some((n) => n.startsWith(top + "transcript/")), "a folder left out goes with its files");
    assert.ok(names.includes(top + "transcript.json") && names.includes(top + "obs/"));
    assert.ok(asked.includes("attachments/order email.txt") && !asked.includes("transcript/meeting.vtt"));
    const whole = readZip((await zipFolder(root, path.join(base, "whole.zip"))).zipPath).map((e) => e.name)
      .filter((n) => !n.endsWith("/")).sort();
    assert.deepStrictEqual(whole, folderFiles(root));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
