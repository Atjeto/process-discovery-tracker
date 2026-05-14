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
  ]);
  const shaped = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k) && v !== null && v !== undefined) shaped[k] = v;
  }
  return makeEvent("interaction", sessionId, shaped);
}

module.exports = { activityEvent, markerEvent, systemEvent, interactionEvent, nowIso };
