"use strict";
// The zip for the analyst is named after the recording (recording-zip.js,
// lane LF-SME, live finding 23), and every zip of a recording is found by
// its content: replaced by the next zip, counted, deleted with it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeFileName, zipsOf, recordingZipPath, zipRecording } = require("../recording-zip.js");
const { createSession, removeSessionFolder, setSessionLabel } = require("../session.js");

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-rzip-"));
}

/* A recording folder with a manifest (its label optional). */
function makeRecording(base, stamp, label) {
  const folder = path.join(base, "REQ-1", stamp);
  fs.mkdirSync(path.join(folder, "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(folder, "events.jsonl"), '{"type":"system"}\n');
  const manifest = { session_id: stamp };
  if (label !== undefined) manifest.label = label;
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest));
  return folder;
}

test("the zip takes the recording's name; without a name, its time stamp", async () => {
  const base = tmpBase();
  try {
    const named = makeRecording(base, "20260926-012956", "Three orders for regular customers");
    const r = await zipRecording(named);
    assert.strictEqual(path.basename(r.zipPath), "Three orders for regular customers.zip");
    assert.ok(fs.existsSync(r.zipPath));
    const plain = makeRecording(base, "20260926-013434");
    assert.strictEqual(path.basename((await zipRecording(plain)).zipPath), "20260926-013434.zip");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a name is made safe for Windows", () => {
  assert.strictEqual(safeFileName("Order desk: new customer, repeat order, short order"),
    "Order desk new customer, repeat order, short order");
  assert.strictEqual(safeFileName('a/b\\c*d?e"f<g>h|i'), "a b c d e f g h i");
  assert.strictEqual(safeFileName("  Ana Kovač 1. . "), "Ana Kovač 1");
  assert.strictEqual(safeFileName("CON"), "");
  assert.strictEqual(safeFileName(""), "");
  assert.strictEqual(safeFileName("x".repeat(200)).length, 80);
});

test("another recording's zip keeps its name: the second one adds its time stamp", async () => {
  const base = tmpBase();
  try {
    const monday = makeRecording(base, "20260928-090000", "Order entry");
    const tuesday = makeRecording(base, "20260929-090000", "Order entry");
    const a = await zipRecording(monday);
    const b = await zipRecording(tuesday);
    assert.strictEqual(path.basename(a.zipPath), "Order entry.zip");
    assert.strictEqual(path.basename(b.zipPath), "Order entry 20260929-090000.zip");
    assert.ok(fs.existsSync(a.zipPath), "Monday's zip is still there");
    assert.deepStrictEqual(zipsOf(monday), [a.zipPath]);
    assert.deepStrictEqual(zipsOf(tuesday), [b.zipPath]);
    // Zipping Monday again replaces its own zip, under its own name.
    assert.strictEqual(recordingZipPath(monday), a.zipPath);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("renamed after a zip: the next zip has the new name and the old one is gone", async () => {
  const base = tmpBase();
  try {
    const folder = makeRecording(base, "20260926-012956");
    const first = await zipRecording(folder);
    assert.strictEqual(path.basename(first.zipPath), "20260926-012956.zip");
    setSessionLabel(folder, "Week 40 order lines");
    const second = await zipRecording(folder);
    assert.strictEqual(path.basename(second.zipPath), "Week 40 order lines.zip");
    assert.ok(!fs.existsSync(first.zipPath), "one zip per recording");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(folder)).sort(), ["20260926-012956", "Week 40 order lines.zip"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("deleting a recording deletes its named zip, and not another recording's", async () => {
  const base = tmpBase();
  try {
    const keep = makeRecording(base, "20260928-090000", "Order entry");
    const gone = makeRecording(base, "20260929-090000", "Service desk");
    const kept = await zipRecording(keep);
    await zipRecording(gone);
    removeSessionFolder(gone);
    assert.deepStrictEqual(fs.readdirSync(path.join(base, "REQ-1")).sort(), ["20260928-090000", "Order entry.zip"]);
    assert.ok(fs.existsSync(kept.zipPath));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("setSessionLabel keeps the integrity file true after the name is saved (live finding 20)", () => {
  const base = tmpBase();
  try {
    const s = createSession({ baseDir: base, engagementId: "REQ-1", config: {} });
    const { writeSessionIntegrity } = require("../session.js");
    writeSessionIntegrity(s.sessionFolder);   // at Stop
    setSessionLabel(s.sessionFolder, "Supplier invoices approved and rejected");
    const integrity = JSON.parse(fs.readFileSync(path.join(s.sessionFolder, "session-integrity.json"), "utf-8"));
    const listed = integrity.files.find((f) => f.name === "manifest.json");
    assert.strictEqual(listed.size, fs.statSync(path.join(s.sessionFolder, "manifest.json")).size);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("setSessionLabel on a recording still running writes no integrity file", () => {
  const base = tmpBase();
  try {
    const s = createSession({ baseDir: base, engagementId: "REQ-1", config: {} });
    setSessionLabel(s.sessionFolder, "A name");
    assert.ok(!fs.existsSync(path.join(s.sessionFolder, "session-integrity.json")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
