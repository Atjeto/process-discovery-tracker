"use strict";
// §11f — unit tests for consent.js (pure record + prompt-decision logic) and
// the manifest.consent field createSession writes.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  needsPrompt,
  consentRecord,
  acknowledgementKey,
  DEFAULT_CONSENT_TEXT,
} = require("../consent.js");
const { DEFAULTS } = require("../config.js");
const { createSession } = require("../session.js");

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-consent-"));
}
function readManifest(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8"));
}

test("needsPrompt: off never prompts, per_session always, once respects ack", () => {
  assert.strictEqual(needsPrompt("off", false), false);
  assert.strictEqual(needsPrompt("off", true), false);
  assert.strictEqual(needsPrompt("per_session", false), true);
  assert.strictEqual(needsPrompt("per_session", true), true);
  assert.strictEqual(needsPrompt("once", false), true);
  assert.strictEqual(needsPrompt("once", true), false);
  // Unknown mode fails safe -> prompt.
  assert.strictEqual(needsPrompt("weird", false), true);
});

test("consentRecord(off) is the not-required shape", () => {
  assert.deepStrictEqual(consentRecord({ mode: "off" }),
    { required: false, granted: null, mode: "off" });
});

test("consentRecord(per_session, granted) captures the decision + ack time", () => {
  const r = consentRecord({
    mode: "per_session", version: 2, workerId: "alice", granted: true,
    acknowledgedAt: "2026-05-30T10:00:00.000Z",
  });
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.granted, true);
  assert.strictEqual(r.mode, "per_session");
  assert.strictEqual(r.version, 2);
  assert.strictEqual(r.worker_id, "alice");
  assert.strictEqual(r.acknowledged_at, "2026-05-30T10:00:00.000Z");
});

test("consentRecord(declined) records granted:false and no ack time", () => {
  const r = consentRecord({ mode: "once", version: 1, workerId: "bob", granted: false });
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.granted, false);
  assert.strictEqual(r.acknowledged_at, null);
});

test("acknowledgementKey varies by worker and version", () => {
  assert.strictEqual(acknowledgementKey("alice", 1), "alice:1");
  assert.notStrictEqual(acknowledgementKey("alice", 1), acknowledgementKey("alice", 2));
  assert.notStrictEqual(acknowledgementKey("alice", 1), acknowledgementKey("bob", 1));
});

test("config DEFAULTS ship consent off with the default text", () => {
  assert.strictEqual(DEFAULTS.consent.mode, "off");
  assert.strictEqual(DEFAULTS.consent.version, 1);
  assert.strictEqual(DEFAULTS.consent.text, DEFAULT_CONSENT_TEXT);
  assert.match(DEFAULT_CONSENT_TEXT, /consent/i);
});

test("createSession defaults manifest.consent to the not-required record", () => {
  const base = tmpBase();
  const s = createSession({ baseDir: base, engagementId: "e", config: {} });
  assert.deepStrictEqual(readManifest(s.sessionFolder).consent,
    { required: false, granted: null, mode: "off" });
  fs.rmSync(base, { recursive: true, force: true });
});

test("createSession writes the supplied consent record onto the manifest", () => {
  const base = tmpBase();
  const consent = consentRecord({ mode: "per_session", version: 1, workerId: "alice", granted: true });
  const s = createSession({ baseDir: base, engagementId: "e", config: {}, consent });
  const m = readManifest(s.sessionFolder);
  assert.strictEqual(m.consent.required, true);
  assert.strictEqual(m.consent.granted, true);
  assert.strictEqual(m.consent.worker_id, "alice");
  fs.rmSync(base, { recursive: true, force: true });
});
