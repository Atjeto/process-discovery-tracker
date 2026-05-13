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

function markerEvent(sessionId, { markerType, label }) {
  return makeEvent("marker", sessionId, {
    marker_type: markerType,
    label: label || null,
  });
}

function systemEvent(sessionId, kind, payload) {
  return makeEvent("system", sessionId, {
    kind,
    ...(payload || {}),
  });
}

module.exports = { activityEvent, markerEvent, systemEvent, nowIso };
