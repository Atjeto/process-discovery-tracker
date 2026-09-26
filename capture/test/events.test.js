"use strict";
// C1 — unit tests for events.js (envelope shape and per-type factories).

const test = require("node:test");
const assert = require("node:assert");
const { activityEvent, markerEvent, systemEvent, interactionEvent, nowIso } = require("../events.js");

const SID = "session-123";

function assertEnvelope(ev, type) {
  assert.strictEqual(ev.type, type);
  assert.strictEqual(ev.session_id, SID);
  assert.match(ev.event_id, /^[0-9a-f-]{36}$/);
  assert.match(ev.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.strictEqual(typeof ev.data, "object");
}

test("nowIso returns an ISO 8601 string", () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("activityEvent shapes the envelope and renames durationMs", () => {
  const ev = activityEvent(SID, { app: "chrome", title: "t", pid: 42, durationMs: 1500 });
  assertEnvelope(ev, "activity");
  assert.strictEqual(ev.data.app, "chrome");
  assert.strictEqual(ev.data.pid, 42);
  assert.strictEqual(ev.data.duration_ms, 1500);
});

test("markerEvent defaults label to null and omits reason when absent", () => {
  const ev = markerEvent(SID, { markerType: "start" });
  assertEnvelope(ev, "marker");
  assert.strictEqual(ev.data.marker_type, "start");
  assert.strictEqual(ev.data.label, null);
  assert.ok(!("reason" in ev.data));
});

test("markerEvent includes reason when supplied", () => {
  const ev = markerEvent(SID, { markerType: "end", label: "Step 1", reason: "auto_end_idle" });
  assert.strictEqual(ev.data.label, "Step 1");
  assert.strictEqual(ev.data.reason, "auto_end_idle");
});

test("systemEvent spreads the payload alongside kind", () => {
  const ev = systemEvent(SID, "screenshot", { file: "a.jpg" });
  assertEnvelope(ev, "system");
  assert.strictEqual(ev.data.kind, "screenshot");
  assert.strictEqual(ev.data.file, "a.jpg");
});

test("systemEvent works with no payload", () => {
  assert.strictEqual(systemEvent(SID, "session_start").data.kind, "session_start");
});

test("interactionEvent throws when data.kind is missing", () => {
  assert.throws(() => interactionEvent(SID, {}), /requires data\.kind/);
  assert.throws(() => interactionEvent(SID, null), /requires data\.kind/);
});

test("interactionEvent keeps allowed keys and drops disallowed or null ones", () => {
  const ev = interactionEvent(SID, {
    kind: "click",
    control_type: "Button",
    name: "OK",
    secret: "dropped — not in the allowlist",
    value: null,
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.kind, "click");
  assert.strictEqual(ev.data.control_type, "Button");
  assert.strictEqual(ev.data.name, "OK");
  assert.ok(!("secret" in ev.data));
  assert.ok(!("value" in ev.data));
});

test("event_id is unique across calls", () => {
  assert.notStrictEqual(systemEvent(SID, "x").event_id, systemEvent(SID, "x").event_id);
});

test("interactionEvent passes through the E6/E7 signal-quality fields", () => {
  // coverage_hint (E6) and value_truncated (E7) are recorder-emitted; the
  // allowlist must keep them or they never reach events.jsonl.
  const ev = interactionEvent(SID, {
    kind: "value_changed",
    value: "Customer Acme Corp",
    coverage_hint: "rich",
    value_truncated: true,
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.coverage_hint, "rich");
  assert.strictEqual(ev.data.value_truncated, true);
});

test("interactionEvent passes through the E8 desktop-coverage fields", () => {
  // framework / identity_source / confidence (§11e) are recorder-emitted;
  // the allowlist must keep them or the analyst never sees toolkit coverage
  // or per-element capture confidence.
  const ev = interactionEvent(SID, {
    kind: "invoked",
    control_type: "Button",
    framework_id: "Win32",
    class_name: "SunAwtFrame",
    framework: "java",
    identity_source: "name",
    confidence: 0.7,
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.framework, "java");
  assert.strictEqual(ev.data.identity_source, "name");
  assert.strictEqual(ev.data.confidence, 0.7);
  // The raw framework_id and the normalized framework coexist.
  assert.strictEqual(ev.data.framework_id, "Win32");
});

test("a password entry keeps value_redacted and never carries a value (live finding 1)", () => {
  // The recorder redacts a password field at capture: no value, the flag.
  // The allowlist must keep the flag, or the entry reads as "Cleared".
  const ev = interactionEvent(SID, {
    kind: "value_changed",
    control_type: "Edit",
    automation_id: "si-password",
    name: "Password",
    value_redacted: true,
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.value_redacted, true);
  assert.ok(!("value" in ev.data), "no value on a redacted entry");
  assert.strictEqual(ev.data.name, "Password");
});

test("interactionEvent passes through value_source (recovered value flag)", () => {
  // value_source (§11e) flags a value recovered off the primary ValuePattern
  // path; the allowlist must keep it for transparency about recovery.
  const ev = interactionEvent(SID, {
    kind: "value_changed",
    value: "Acme Corp",
    value_source: "text_pattern",
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.value_source, "text_pattern");
});

test("interactionEvent passes through ocr_text (recovered label)", () => {
  // ocr_text (§11e OCR last rung) is recorder-emitted for an identityless
  // element; the allowlist must keep it or the recovered label is lost.
  const ev = interactionEvent(SID, {
    kind: "invoked",
    control_type: "Custom",
    identity_source: "ocr",
    confidence: 0.25,
    ocr_text: "Submit Claim",
  });
  assertEnvelope(ev, "interaction");
  assert.strictEqual(ev.data.identity_source, "ocr");
  assert.strictEqual(ev.data.ocr_text, "Submit Claim");
});
