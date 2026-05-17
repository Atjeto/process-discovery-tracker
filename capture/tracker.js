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
const { activityEvent, markerEvent, systemEvent, interactionEvent } = require("./events.js");

const POLL_INTERVAL_MS = 5_000;

/* E5 -- a foreground app the recorder produced zero interaction events
   for, after this many ms continuously frontmost, is flagged as
   uncaptured (commonly an elevated process, or one with no UIA surface).
   Conservative on purpose; a calibration candidate once 8h-recording
   data exists. */
const UNCAPTURED_WARN_MS = 90_000;

let activeWinPromise = null;
function getActiveWin() {
  if (!activeWinPromise) {
    activeWinPromise = import("active-win").then((m) => m.default);
  }
  return activeWinPromise;
}

/* A window title carries cosmetic churn that isn't a process step: a
   "(3)" unread-count prefix, a "*"/"●" unsaved-changes marker, the
   trailing browser-name suffix. Strip those before deciding whether the
   title changed enough to start a new activity run -- so a Gmail unread
   tick doesn't fragment the timeline, while a real navigation
   (Salesforce -> SAP, both inside Chrome) still does. The raw title is
   kept verbatim on the emitted event; this governs run boundaries only. */
function normalizeTitle(title) {
  let t = (title || "").trim();
  t = t.replace(/^\(\d+\)\s*/, "");          // "(3) " unread-count prefix
  t = t.replace(/^[*●•]\s*/, "");             // unsaved-changes marker
  t = t.replace(
    /\s+[-–—]\s+(Google Chrome|Microsoft\s*Edge|Mozilla Firefox|Brave|Opera|Chromium)$/i,
    "",
  );
  return t.trim();
}

/* An activity run is a maximal stretch of polls sharing the same app,
   pid, AND normalized window title. Putting the title in the run key
   (design §3.1 / §7.1) keeps in-browser navigation between web apps
   visible, instead of collapsing a long Chrome stretch into one
   undifferentiated "chrome.exe" event. */
function isNewRun(currentRun, app, pid, normTitle) {
  return (
    !currentRun ||
    currentRun.app !== app ||
    currentRun.pid !== pid ||
    currentRun._normTitle !== normTitle
  );
}

/* E5 -- whether a foreground app should be flagged as uncaptured: the
   recorder is expected to be running, the app has been frontmost past
   the threshold, and it has never produced an interaction event. Pure
   (all state passed in) so it is unit-testable, like isNewRun above. */
function isUncapturedApp({
  interactionsExpected,
  pid,
  interactivePids,
  uncapturedWarned,
  foregroundElapsedMs,
  thresholdMs,
}) {
  if (!interactionsExpected) return false;
  if (pid == null) return false;
  if (interactivePids.has(pid)) return false;
  if (uncapturedWarned.has(pid)) return false;
  return foregroundElapsedMs >= thresholdMs;
}

function startTracker({ sessionId, eventsFile, onTick, interactionsExpected = false, onNotice = null }) {
  if (!sessionId || !eventsFile) {
    throw new Error("startTracker requires { sessionId, eventsFile }");
  }

  let paused = false;
  let stopped = false;
  let currentRun = null; // { app, title, _normTitle, pid, bounds, _startMs, timestamp }
  let pollHandle = null;
  let markerStack = []; // for tray/status only; case IDs are derived in normalization

  /* Live counters and a small ring buffer for the status window. None
     of this affects the durable JSONL; it's UI state derived from the
     append pipeline. */
  const sessionStartMs = Date.now();
  let eventCount = 0;
  let markerCount = 0;
  let screenshotCount = 0;
  let interactionCount = 0;
  const RECENT_BUFFER_SIZE = 16;
  const recentEvents = [];

  /* E5 -- uncaptured-app detection. interactivePids holds pids the
     recorder HAS produced an interaction for; uncapturedWarned holds
     pids already flagged so we warn once. foregroundPid / SinceMs track
     how long the current frontmost pid has held focus. */
  const interactivePids = new Set();
  const uncapturedWarned = new Set();
  let foregroundPid = null;
  let foregroundSinceMs = 0;

  function appendEvent(ev) {
    // _seq is the 0-based events.jsonl line ordinal. Normalization uses
    // it as a secondary sort key so events sharing a millisecond
    // timestamp keep their true append order.
    ev._seq = eventCount;
    fs.appendFileSync(eventsFile, JSON.stringify(ev) + "\n");
    eventCount += 1;
    if (ev.type === "marker") markerCount += 1;
    if (ev.type === "interaction") interactionCount += 1;
    if (ev.type === "system" && (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      screenshotCount += 1;
    }
    recentEvents.push(ev);
    if (recentEvents.length > RECENT_BUFFER_SIZE) recentEvents.shift();
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

    // active-win exposes `bounds: {x, y, width, height}` -- desktop
    // coordinates of the foreground window. We capture them on every
    // tick so screenshots.js can pick the right display in multi-
    // monitor setups. Stored on currentRun (refreshed every tick)
    // and surfaced via getStatus(). Optional: older OS / active-win
    // builds may omit bounds; consumer falls back to primary display.
    const bounds = (win && win.bounds && Number.isFinite(win.bounds.x)) ? win.bounds : null;

    const normTitle = normalizeTitle(title);
    if (isNewRun(currentRun, app, pid, normTitle)) {
      closeRun(now);
      currentRun = {
        _startMs: now,
        timestamp: new Date(now).toISOString(),
        app,
        title,
        _normTitle: normTitle,
        pid,
        bounds,
      };
    } else {
      currentRun.title = title;
      currentRun.bounds = bounds;
    }

    // E5: track how long the current foreground pid has held focus, and
    // flag it once if the recorder never captures an interaction for it.
    if (pid !== foregroundPid) {
      foregroundPid = pid;
      foregroundSinceMs = now;
    }
    maybeWarnUncaptured(now, app, pid);

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

  function fireInteraction(data) {
    const ev = interactionEvent(sessionId, data);
    appendEvent(ev);
    // The recorder produced an interaction for this pid -- it is
    // capturable, so it is never an uncaptured-app candidate.
    if (data && data.pid != null) interactivePids.add(data.pid);
    return ev;
  }

  /* Flag a foreground app the recorder has produced no interaction for.
     Fires the durable uncaptured_app system event (and an onNotice
     toast) once per pid. The decision itself is the pure isUncapturedApp. */
  function maybeWarnUncaptured(now, app, pid) {
    const flag = isUncapturedApp({
      interactionsExpected,
      pid,
      interactivePids,
      uncapturedWarned,
      foregroundElapsedMs: now - foregroundSinceMs,
      thresholdMs: UNCAPTURED_WARN_MS,
    });
    if (!flag) return;
    uncapturedWarned.add(pid);
    fireSystem("uncaptured_app", { app, pid });
    if (onNotice) {
      try { onNotice("uncaptured_app", { app, pid }); }
      catch (_e) { /* notice is best-effort */ }
    }
  }

  function getStatus() {
    return {
      paused,
      stopped,
      sessionId,
      currentApp: currentRun ? currentRun.app : null,
      currentTitle: currentRun ? currentRun.title : null,
      currentBounds: currentRun ? currentRun.bounds : null,
      markerDepth: markerStack.length,
      openMarkers: markerStack.map((m) => m.label),
      eventCount,
      markerCount,
      screenshotCount,
      interactionCount,
      sessionStartMs,
      elapsedMs: Date.now() - sessionStartMs,
      recentEvents: recentEvents.slice(),
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

  return { fireMarker, fireSystem, fireInteraction, getStatus, pause, resume, stop };
}

module.exports = { startTracker, POLL_INTERVAL_MS, normalizeTitle, isNewRun, isUncapturedApp };
