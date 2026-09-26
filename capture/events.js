"use strict";

const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function makeEvent(type, sessionId, data) {
  return {
    event_id: crypto.randomUUID(),
    type,
    timestamp: nowIso(),
    session_id: sessionId,
    data,
  };
}

function activityEvent(sessionId, { app, title, pid, durationMs }) {
  return makeEvent("activity", sessionId, {
    app,
    title,
    pid,
    duration_ms: durationMs,
  });
}

function markerEvent(sessionId, { markerType, label, reason }) {
  return makeEvent("marker", sessionId, {
    marker_type: markerType,
    label: label || null,
    ...(reason ? { reason } : {}),
  });
}

function systemEvent(sessionId, kind, payload) {
  return makeEvent("system", sessionId, {
    kind,
    ...(payload || {}),
  });
}

function interactionEvent(sessionId, data) {
  if (!data || typeof data.kind !== "string") {
    throw new Error("interactionEvent requires data.kind");
  }
  const allowed = new Set([
    "kind", "control_type", "automation_id", "name", "class_name",
    "framework_id", "window_title", "process_name", "pid",
    "selected_value", "toggle_state", "value",
    // SECURITY: the recorder never sends a password field's value; this
    // flag says one was typed (SCHEMA). Without it here a password entry
    // reached events.jsonl as a value change with no value, read downstream
    // as "Cleared Password" (lane LF-SME, live finding 1).
    "value_redacted",
    // E6 / E7 -- recorder-emitted signal-quality fields.
    "coverage_hint", "value_truncated",
    // E8 (§11e) -- desktop-coverage-hardening signal fields. `framework`
    // is the normalized UI-toolkit detection (win32/wpf/winforms/winui/
    // chromium/java/javafx/qt/remote/terminal/unknown), distinct from the
    // raw `framework_id`. `identity_source` is the identity-ladder rung
    // (automation_id/name/class_name/none) and `confidence` is the
    // per-element capture-confidence score in [0,1]. `value_source` flags a
    // value recovered off the primary ValuePattern path (text_pattern).
    // `ocr_text` is a label recovered by the OCR last rung for an
    // otherwise-identityless element (lifts identity_source to "ocr").
    // Without these allowlist entries the recorder's fields are silently
    // dropped before they reach events.jsonl.
    "framework", "identity_source", "confidence", "value_source", "ocr_text",
  ]);
  const shaped = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k) && v !== null && v !== undefined) shaped[k] = v;
  }
  return makeEvent("interaction", sessionId, shaped);
}

module.exports = { activityEvent, markerEvent, systemEvent, interactionEvent, nowIso };
