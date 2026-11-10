"use strict";
// "Make a zip for the analyst" (zip-folder.js): a plain zip of one recording
// folder, next to it, local only. Read back here by an independent reader
// (central directory, local headers, inflate, CRC) and, where Windows has it,
// by the system's tar.exe.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const {
  zipFolder,
  zipPathFor,
  describeZipError,
  crc32,
  crc32js,
  ZipTooLargeError,
} = require("../zip-folder.js");

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-zip-"));
}

/* A recording folder shaped like a real one (no real data). */
function makeRecording(base, name) {
  const folder = path.join(base, "default", name || "20260924-101500");
  fs.mkdirSync(path.join(folder, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(folder, "obs"), { recursive: true }); // stays empty
  const events = Array.from({ length: 400 }, (_, i) =>
    JSON.stringify({ type: "marker", seq: i, data: { label: "Run " + (1 + (i % 3)) } })).join("\n") + "\n";
  fs.writeFileSync(path.join(folder, "events.jsonl"), events);
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ session_id: "s1", label: "Bestellung prüfen" }));
  fs.writeFileSync(path.join(folder, "empty.txt"), "");
  const jpg = Buffer.alloc(3000);
  for (let i = 0; i < jpg.length; i += 1) jpg[i] = (i * 7919) & 0xff;
  fs.writeFileSync(path.join(folder, "screenshots", "20260924-101512-001.jpg"), jpg);
  fs.writeFileSync(path.join(folder, "screenshots", "Überweisung.txt"), "umlaut name");
  return folder;
}

/* An independent zip reader: every entry by the central directory, its
   bytes through the local header, inflated when deflated, CRC checked. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  assert.strictEqual(p + cdSize, eocd, "central directory ends where the end record starts");
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, "central header signature");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const external = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    assert.strictEqual(buf.readUInt32LE(offset), 0x04034b50, "local header signature for " + name);
    assert.strictEqual(buf.readUInt32LE(offset + 14), crc, "local CRC matches central for " + name);
    assert.strictEqual(buf.readUInt32LE(offset + 18), csize, "local size matches central for " + name);
    const lnlen = buf.readUInt16LE(offset + 26);
    const lxlen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lnlen + lxlen;
    const raw = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.ok(method === 0 || method === 8, "stored or deflated");
    assert.strictEqual(data.length, usize, "size for " + name);
    assert.strictEqual(crc32(data), crc, "CRC for " + name);
    entries.push({ name, method, flags, external, data });
  }
  return entries;
}

test("zipPathFor puts the zip next to the folder, with the folder's name", () => {
  const folder = path.join("C:", "x", "sessions", "default", "20260924-101500");
  assert.strictEqual(zipPathFor(folder), path.join("C:", "x", "sessions", "default", "20260924-101500.zip"));
});

test("the JS CRC-32 agrees with the known check value and with zlib, whole and in pieces", () => {
  assert.strictEqual(crc32js(Buffer.from("123456789")), 0xCBF43926);
  const data = Buffer.from("The analyst receives one file.".repeat(50));
  const whole = crc32js(data);
  assert.strictEqual(crc32js(data.slice(100), crc32js(data.slice(0, 100))), whole);
  if (typeof zlib.crc32 === "function") assert.strictEqual(zlib.crc32(data) >>> 0, whole);
  assert.strictEqual(crc32(data), whole);
});

test("the zip holds the whole folder: every file byte for byte, empty folders too, UTF-8 names", async () => {
  const base = tmpBase();
  try {
    const folder = makeRecording(base);
    const r = await zipFolder(folder);
    assert.strictEqual(r.zipPath, zipPathFor(folder));
    assert.ok(fs.existsSync(r.zipPath));
    assert.strictEqual(r.bytes, fs.statSync(r.zipPath).size);
    const entries = readZip(r.zipPath);
    const names = entries.map((e) => e.name);
    assert.deepStrictEqual(names, [
      "20260924-101500/",
      "20260924-101500/empty.txt",
      "20260924-101500/events.jsonl",
      "20260924-101500/manifest.json",
      "20260924-101500/obs/",
      "20260924-101500/screenshots/",
      "20260924-101500/screenshots/20260924-101512-001.jpg",
      "20260924-101500/screenshots/Überweisung.txt",
    ]);
    assert.strictEqual(r.entries, names.length);
    for (const e of entries) {
      assert.strictEqual(e.flags & 0x0800, 0x0800, "UTF-8 flag on " + e.name);
      if (e.name.endsWith("/")) {
        assert.strictEqual(e.data.length, 0);
        assert.strictEqual(e.external & 0x10, 0x10, "folder bit on " + e.name);
        continue;
      }
      const rel = e.name.split("/").slice(1).join(path.sep);
      assert.deepStrictEqual(e.data, fs.readFileSync(path.join(folder, rel)), "content of " + e.name);
    }
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    assert.strictEqual(byName["20260924-101500/events.jsonl"].method, 8, "text is deflated");
    assert.strictEqual(byName["20260924-101500/screenshots/20260924-101512-001.jpg"].method, 0, "a JPEG is stored");
    assert.strictEqual(byName["20260924-101500/empty.txt"].method, 0, "an empty file is stored");
    assert.ok(!fs.existsSync(r.zipPath + ".partial"), "no partial file left");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Windows' own tar.exe extracts the zip back to the same folder", { skip: process.platform !== "win32" && "Windows only" }, async (t) => {
  const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (!fs.existsSync(tarExe)) { t.skip("no System32 tar.exe"); return; }
  const base = tmpBase();
  try {
    const folder = makeRecording(base);
    const { zipPath } = await zipFolder(folder);
    const out = path.join(base, "extracted");
    fs.mkdirSync(out);
    const res = spawnSync(tarExe, ["-xf", zipPath, "-C", out], { encoding: "utf8" });
    assert.strictEqual(res.status, 0, "tar.exe exit 0: " + (res.stderr || ""));
    const back = path.join(out, "20260924-101500");
    for (const rel of ["events.jsonl", "manifest.json", "empty.txt", path.join("screenshots", "20260924-101512-001.jpg")]) {
      assert.deepStrictEqual(fs.readFileSync(path.join(back, rel)), fs.readFileSync(path.join(folder, rel)), rel);
    }
    assert.ok(fs.statSync(path.join(back, "obs")).isDirectory(), "the empty obs folder comes back");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a second zip replaces the first (a name added after the first zip is in the new one)", async () => {
  const base = tmpBase();
  try {
    const folder = makeRecording(base);
    const first = await zipFolder(folder);
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ session_id: "s1", label: "Renamed" }));
    const second = await zipFolder(folder);
    assert.strictEqual(second.zipPath, first.zipPath);
    const manifest = readZip(second.zipPath).find((e) => e.name.endsWith("manifest.json"));
    assert.strictEqual(JSON.parse(manifest.data.toString("utf8")).label, "Renamed");
    const siblings = fs.readdirSync(path.dirname(folder)).sort();
    assert.deepStrictEqual(siblings, ["20260924-101500", "20260924-101500.zip"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a missing folder is refused and leaves nothing behind", async () => {
  const base = tmpBase();
  try {
    const missing = path.join(base, "default", "nope");
    await assert.rejects(zipFolder(missing), (e) => e.code === "ENOENT");
    assert.deepStrictEqual(fs.readdirSync(base), []);
    assert.strictEqual(describeZipError({ code: "ENOENT" }), "The recording folder was not found.");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a zip that cannot be written fails cleanly: no partial file, no final file", async () => {
  const base = tmpBase();
  try {
    const folder = makeRecording(base);
    const target = path.join(base, "no-such-dir", "out.zip");
    await assert.rejects(zipFolder(folder, target));
    assert.ok(!fs.existsSync(target));
    assert.ok(!fs.existsSync(target + ".partial"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the end summary's error sentences are plain", () => {
  assert.match(describeZipError(new ZipTooLargeError("x too large")), /too large/);
  assert.match(describeZipError({ code: "EBUSY" }), /open in another program/);
  assert.strictEqual(describeZipError({ code: "ENOSPC" }), "The disk is full.");
  assert.strictEqual(describeZipError(new Error("Something odd.")), "Windows reported: Something odd.");
});

test("leaveOut (optional) leaves out what it names, each path relative to the folder; a folder it names goes with its files", async () => {
  const base = tmpBase();
  try {
    const folder = makeRecording(base);
    fs.writeFileSync(path.join(folder, "skip.log"), "left out");
    fs.mkdirSync(path.join(folder, "screenshots", "deep"), { recursive: true });
    fs.writeFileSync(path.join(folder, "screenshots", "deep", "skip.log"), "kept: not at the root");
    fs.mkdirSync(path.join(folder, "gone"));
    fs.writeFileSync(path.join(folder, "gone", "inside.txt"), "left out with its folder");
    const asked = [];
    const leaveOut = (rel) => { asked.push(rel); return rel === "skip.log" || rel === "gone/"; };
    const r = await zipFolder(folder, path.join(base, "out.zip"), leaveOut);
    const names = readZip(r.zipPath).map((e) => e.name);
    const top = path.basename(folder) + "/";
    assert.ok(!names.includes(top + "skip.log"));
    assert.ok(!names.includes(top + "gone/") && !names.includes(top + "gone/inside.txt"));
    assert.ok(names.includes(top + "screenshots/deep/skip.log"));
    assert.ok(names.includes(top + "manifest.json") && names.includes(top + "obs/"));
    assert.strictEqual(r.entries, names.length);
    assert.ok(asked.includes("screenshots/") && asked.includes("screenshots/deep/skip.log"), "relative paths, folders ending in /");
    assert.ok(!asked.includes("gone/inside.txt"), "a folder left out is not walked");
    // Without it, everything.
    const all = readZip((await zipFolder(folder, path.join(base, "all.zip"))).zipPath).map((e) => e.name);
    assert.ok(all.includes(top + "skip.log") && all.includes(top + "gone/inside.txt"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
