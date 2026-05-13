/*
 * Process Discovery Tracker -- capture-side polling core.
 *
 * Pattern derived from pocket-tracker/desktop-tracker/tracker.js but
 * with a different data model (per-session JSONL, envelope events,
 * marker stream) so the implementations diverge by §3.6 of the design.
 *
 * Output is per-event append to events.jsonl. Sync semantics: each
 * append goes through fs.appendFileSync which on Windows/Linux flushes
 * to the OS page cache; we trust the OS to fsync within the kernel
 * writeback window. Crash loss bound is therefore "events buffered in
 * kernel cache at crash time" -- typically sub-second. If we ever need
 * stricter guarantees, swap appendFileSync for an open(O_SYNC) fd.
 */

"use strict";

const fs = require("node:fs");
const { activityEvent, markerEvent, systemEvent } = require("./events.js");

const POLL_INTERVAL_MS = 5_000;

let activeWinPromise = null;
function getActiveWin() {
  if (!activeWinPromise) {
    activeWinPromise = import("active-win").then((m) => m.default);
  }
  return activeWinPromise;
}

function startTracker({ sessionId, eventsFile, onTick }) {
  if (!sessionId || !eventsFile) {
    throw new Error("startTracker requires { sessionId, eventsFile }");
  }

  let paused = false;
  let stopped = false;
  let currentRun = null; // { app, title, pid, _startMs, timestamp }
  let pollHandle = null;
  let markerStack = []; // for tray/status only; case IDs are derived in normalization

  function appendEvent(ev) {
    fs.appendFileSync(eventsFile, JSON.stringify(ev) + "\n");
  }

  function closeRun(endMs) {
    if (!currentRun) return;
    const durMs = endMs - currentRun._startMs;
    if (durMs <= 0) {
      currentRun = null;
      return;
    }
    const ev = activityEvent(sessionId, {
      app: currentRun.app,
      title: currentRun.title,
      pid: currentRun.pid,
      durationMs: durMs,
    });
    /* Override envelope timestamp to the run start (when we first saw
       this app/title), not the moment we closed the run. The duration
       carries the span. */
    ev.timestamp = currentRun.timestamp;
    appendEvent(ev);
    currentRun = null;
  }

  async function tick() {
    if (paused || stopped) return;
    const now = Date.now();
    let win;
    try {
      const activeWin = await getActiveWin();
      win = await activeWin();
    } catch (_e) {
      closeRun(now);
      return;
    }
    if (!win) {
      closeRun(now);
      return;
    }
    const app = (win.owner && win.owner.name) || win.platform || "unknown";
    const title = typeof win.title === "string" ? win.title : "";
    const pid = (win.owner && win.owner.processId) || null;

    if (!currentRun || currentRun.app !== app || currentRun.pid !== pid) {
      closeRun(now);
      currentRun = {
        _startMs: now,
        timestamp: new Date(now).toISOString(),
        app,
        title,
        pid,
      };
    } else {
      currentRun.title = title;
    }

    if (onTick) {
      try { onTick(getStatus()); } catch (_e) { /* ignore */ }
    }
  }

  function fireMarker({ markerType, label, reason }) {
    if (markerType !== "start" && markerType !== "end") {
      throw new Error('fireMarker requires markerType "start" or "end"');
    }
    /* Close any in-flight activity at the marker boundary so the
       duration math doesn't span the marker. The next tick will start
       a fresh run. */
    closeRun(Date.now());
    const ev = markerEvent(sessionId, { markerType, label, reason });
    appendEvent(ev);
    if (markerType === "start") {
      markerStack.push({ label: label || "(unlabeled)", t: ev.timestamp });
    } else if (markerStack.length > 0) {
      markerStack.pop();
    }
    return ev;
  }

  function fireSystem(kind, payload) {
    const ev = systemEvent(sessionId, kind, payload);
    appendEvent(ev);
    return ev;
  }

  function getStatus() {
    return {
      paused,
      stopped,
      sessionId,
      currentApp: currentRun ? currentRun.app : null,
      currentTitle: currentRun ? currentRun.title : null,
      markerDepth: markerStack.length,
      openMarkers: markerStack.map((m) => m.label),
    };
  }

  async function stop() {
    if (stopped) return getStatus();
    stopped = true;
    if (pollHandle) clearInterval(pollHandle);
    closeRun(Date.now());
    fireSystem("session_end");
    return getStatus();
  }

  function pause() {
    if (paused) return;
    paused = true;
    closeRun(Date.now());
    fireSystem("paused");
  }

  function resume() {
    if (!paused) return;
    paused = false;
    fireSystem("resumed");
  }

  fireSystem("session_start");
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
  tick();

  return { fireMarker, fireSystem, getStatus, pause, resume, stop };
}

module.exports = { startTracker, POLL_INTERVAL_MS };
