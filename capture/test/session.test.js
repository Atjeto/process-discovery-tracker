"use strict";
// C1 — unit tests for session.js (folder layout, manifest lifecycle, scans).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createSession,
  closeSession,
  markSessionRecovered,
  findOrphanedSessions,
  listRecentSessions,
  writeSessionIntegrity,
  setSessionLabel,
} = require("../session.js");

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-sess-"));
}
function readManifest(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8"));
}

test("createSession builds the folder layout and an active manifest", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "eng1", config: { a: 1 } });
  assert.ok(fs.existsSync(path.join(s.sessionFolder, "screenshots")));
  assert.ok(fs.existsSync(path.join(s.sessionFolder, "obs")));
  assert.strictEqual(fs.readFileSync(s.eventsFile, "utf-8"), "");
  const m = readManifest(s.sessionFolder);
  assert.strictEqual(m.engagement_id, "eng1");
  assert.strictEqual(m.status, "active");
  assert.strictEqual(m.purpose, "process");
  assert.strictEqual(m.ended_at, null);
  assert.deepStrictEqual(m.config, { a: 1 });
  fs.rmSync(base, { recursive: true, force: true });
});

test("createSession honours an app_prep purpose and prepApp", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "e", purpose: "app_prep", prepApp: "Excel" });
  const m = readManifest(s.sessionFolder);
  assert.strictEqual(m.purpose, "app_prep");
  assert.strictEqual(m.prep_app, "Excel");
  fs.rmSync(base, { recursive: true, force: true });
});

test("closeSession stamps ended_at and the given status", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "e" });
  closeSession({ sessionFolder: s.sessionFolder, status: "closed" });
  const m = readManifest(s.sessionFolder);
  assert.strictEqual(m.status, "closed");
  assert.ok(m.ended_at);
  fs.rmSync(base, { recursive: true, force: true });
});

test("closeSession is a no-op when the manifest is missing", () => {
  const base = tmpBase();
  assert.doesNotThrow(() => closeSession({ sessionFolder: base, status: "closed" }));
  fs.rmSync(base, { recursive: true, force: true });
});

test("markSessionRecovered flags the manifest as recovered", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "e" });
  markSessionRecovered({ sessionFolder: s.sessionFolder });
  const m = readManifest(s.sessionFolder);
  assert.strictEqual(m.recovered, true);
  assert.strictEqual(m.status, "recovered");
  assert.ok(m.ended_at);
  fs.rmSync(base, { recursive: true, force: true });
});

test("findOrphanedSessions returns active sessions that never ended", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "e" });
  assert.strictEqual(findOrphanedSessions(base).length, 1);
  closeSession({ sessionFolder: s.sessionFolder, status: "closed" });
  assert.strictEqual(findOrphanedSessions(base).length, 0);
  fs.rmSync(base, { recursive: true, force: true });
});

test("findOrphanedSessions skips malformed manifests", () => {
  const base = tmpBase();
  const bad = path.join(base, "e", "bad");
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, "manifest.json"), "{not json");
  assert.doesNotThrow(() => findOrphanedSessions(base));
  assert.strictEqual(findOrphanedSessions(base).length, 0);
  fs.rmSync(base, { recursive: true, force: true });
});

test("findOrphanedSessions returns empty for a missing baseDir", () => {
  assert.deepStrictEqual(findOrphanedSessions(path.join(os.tmpdir(), `nope-${Date.now()}`)), []);
});

test("listRecentSessions sorts newest first and respects the limit", () => {
  const base = tmpBase();
  const mk = (name, startedAt) => {
    const folder = path.join(base, "eng", name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "manifest.json"),
      JSON.stringify({ session_id: name, started_at: startedAt, ended_at: null, status: "active" })
    );
  };
  mk("s1", "2026-05-10T00:00:00.000Z");
  mk("s2", "2026-05-12T00:00:00.000Z");
  mk("s3", "2026-05-11T00:00:00.000Z");
  const recent = listRecentSessions(base, 2);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].started_at, "2026-05-12T00:00:00.000Z");
  assert.strictEqual(recent[1].started_at, "2026-05-11T00:00:00.000Z");
  fs.rmSync(base, { recursive: true, force: true });
});

test("writeSessionIntegrity lists every file with its size, excluding itself (B5)", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "eng1", config: {} });
  fs.writeFileSync(s.eventsFile, '{"type":"system"}\n');
  fs.writeFileSync(path.join(s.sessionFolder, "screenshots", "001.jpg"), "jpgbytes");

  const integrity = writeSessionIntegrity(s.sessionFolder);
  const names = integrity.files.map((f) => f.name);
  assert.ok(names.includes("events.jsonl"));
  assert.ok(names.includes("manifest.json"));
  assert.ok(names.includes("screenshots/001.jpg"));
  assert.ok(integrity.files.every((f) => typeof f.size === "number"));
  assert.match(integrity.created_at, /^\d{4}-\d{2}-\d{2}T/);

  // It is written to disk, and a second run never lists the file it
  // just wrote.
  assert.ok(fs.existsSync(path.join(s.sessionFolder, "session-integrity.json")));
  const again = writeSessionIntegrity(s.sessionFolder);
  assert.ok(!again.files.some((f) => f.name === "session-integrity.json"));
  fs.rmSync(base, { recursive: true, force: true });
});

test("setSessionLabel writes a trimmed label, and a blank one clears it (B1)", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "eng1" });
  setSessionLabel(s.sessionFolder, "  Acme morning run  ");
  assert.strictEqual(readManifest(s.sessionFolder).label, "Acme morning run");
  setSessionLabel(s.sessionFolder, "   ");
  assert.ok(!("label" in readManifest(s.sessionFolder)));
  fs.rmSync(base, { recursive: true, force: true });
});
