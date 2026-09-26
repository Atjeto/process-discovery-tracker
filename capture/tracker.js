/*
 * Process Discovery Tracker -- capture-side polling core.
 *
 * Pattern derived from pocket-tracker/desktop-tracker/tracker.js but
 * with a different data model (per-session JSONL, envelope events,
 * marker stream) so the implementations diverge by §3.6 of the design.
 *
 * Output is append to events.jsonl through a small batching queue
 * (I47): high-volume events (activity polls, interactions) are flushed
 * on a 500ms timer, while markers and system events flush the whole
 * pending queue immediately -- so a case boundary or lifecycle event is
 * never left only in memory. The crash-loss bound is therefore "queued
 * activity/interaction events at crash time" -- under 500ms of
 * low-stakes data; stop() flushes the queue on a clean exit.
 */

"use strict";

const fs = require("node:fs");
const { activityEvent, markerEvent, systemEvent, interactionEvent } = require("./events.js");
const { bootLog } = require("./boot-log.js");

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

/* The window in front now, as { app, screen } (its title as normalizeTitle
   gives it), or null when it cannot be read. Never throws. */
async function readForeground() {
  try {
    const activeWin = await getActiveWin();
    const win = await activeWin();
    if (!win) return null;
    const app = (win.owner && win.owner.name) || win.platform || "unknown";
    return { app, screen: normalizeTitle(typeof win.title === "string" ? win.title : "") };
  } catch (_e) {
    return null;
  }
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

function startTracker({ sessionId, eventsFile, onTick, interactionsExpected = false, onNotice = null, appendFile = null }) {
  if (!sessionId || !eventsFile) {
    throw new Error("startTracker requires { sessionId, eventsFile }");
  }

  let paused = false;
  let stopped = false;
  /* Lane FX3 (validation pass 3, F17): the time the recording was paused,
     left out of its elapsed time (the bar's clock, the end summary). */
  let pausedTotalMs = 0;
  let pausedSinceMs = null;
  const pausedNowMs = () => pausedTotalMs + (paused && pausedSinceMs != null ? Date.now() - pausedSinceMs : 0);
  let currentRun = null; // { app, title, _normTitle, pid, bounds, _startMs, timestamp }
  let pollHandle = null;
  let markerStack = []; // for tray/status only; case IDs are derived in normalization

  /* Live counters and a small ring buffer for the status window. None
     of this affects the durable JSONL; it's UI state derived from the
     append pipeline. */
  const sessionStartMs = Date.now();
  let eventCount = 0;
  let markerCount = 0;
  /* Start markers written this session = runs recorded; the next
     unnamed run is "Transaction <startMarkerCount + 1>" (AD-29). */
  let startMarkerCount = 0;
  let screenshotCount = 0;
  let interactionCount = 0;
  /* H-6: count of failed durability-critical flushes this session. A
     non-zero value means a marker or system event hit a write error and
     was re-queued for retry; surfaced via getStatus().writeErrorCount so
     the tray/status can show the durable record is at risk. */
  let writeErrorCount = 0;
  /* RP-21: activity/interaction events lost to a failed write of a batch
     that held no marker/system event. Such a batch is still dropped (not
     retried), but no longer silently: droppedEventCount is the session
     total, and pendingLoss accumulates the not-yet-recorded loss that
     queueLossRecord() writes as an `events_dropped` system event ahead of
     the next appended event. */
  let droppedEventCount = 0;
  let pendingLoss = null;
  /* I23: wall-clock of the most recent interaction forwarded by the
     recorder. The idle monitor reads it to tell "idle but still at the
     desk" (recent mouse/keyboard) from "idle and away". */
  let lastInteractionMs = 0;
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

  /* I47: deferred-write queue. flushEvents() drains it; markers and
     system events flush synchronously, activity/interaction events ride
     a 500ms timer. Each entry is { line, critical, type, ts }: `critical`
     is true for markers and system events, which must never be silently
     lost; `type` and `ts` describe a dropped batch in its loss record. */
  let writeQueue = [];
  let flushTimer = null;
  const writeFn = appendFile || fs.appendFileSync;
  function flushEvents() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!writeQueue.length) return;
    const batch = writeQueue.splice(0);
    try {
      writeFn(eventsFile, batch.map((e) => e.line).join(""));
    } catch (e) {
      /* H-6: a failed flush used to be swallowed while counters/UI
         reported success -- silently losing markers/system events. If
         the batch held any durability-critical event, log loudly,
         notify best-effort, and RE-QUEUE the whole batch (at the front,
         preserving order) so the next flush retries it. */
      const hadCritical = batch.some((e) => e.critical);
      if (hadCritical) {
        writeErrorCount += 1;
        const msg = `events.jsonl flush FAILED for a durability-critical batch ` +
          `(${batch.length} events, attempt ${writeErrorCount}); re-queued for retry: ${e && e.message}`;
        bootLog(msg);
        // eslint-disable-next-line no-console
        console.error(`[tracker] ${msg}`);
        if (onNotice) {
          try { onNotice("write_error", { events: batch.length, attempt: writeErrorCount }); }
          catch (_e) { /* notice is best-effort */ }
        }
        writeQueue = batch.concat(writeQueue);
        // Re-arm the timer so the retry happens even with no further
        // events arriving; a synchronous critical flush re-attempts now
        // via the caller's next flushEvents() but the timer is the
        // backstop for the idle case.
        if (!flushTimer) flushTimer = setTimeout(flushEvents, 500);
      } else {
        /* No critical event in this batch -- the activity/interaction
           events are dropped (not retried), and RP-21: the loss is
           counted and recorded durably instead of vanishing. */
        noteDroppedBatch(batch, e);
      }
    }
  }

  /* RP-21: fold a dropped non-critical batch into the pending loss record.
     The operator is notified once per loss stretch (until the record is
     queued), not once per failed 500 ms flush. */
  function noteDroppedBatch(batch, err) {
    const interactions = batch.filter((q) => q.type === "interaction").length;
    const stamps = batch.map((q) => q.ts).sort();
    droppedEventCount += batch.length;
    const firstOfStretch = !pendingLoss;
    if (firstOfStretch) {
      pendingLoss = {
        dropped_interactions: 0,
        dropped_activities: 0,
        first_dropped_ts: stamps[0],
        last_dropped_ts: stamps[stamps.length - 1],
        failed_writes: 0,
        last_error: null,
      };
    }
    pendingLoss.dropped_interactions += interactions;
    pendingLoss.dropped_activities += batch.length - interactions;
    if (stamps[0] < pendingLoss.first_dropped_ts) pendingLoss.first_dropped_ts = stamps[0];
    if (stamps[stamps.length - 1] > pendingLoss.last_dropped_ts) {
      pendingLoss.last_dropped_ts = stamps[stamps.length - 1];
    }
    pendingLoss.failed_writes += 1;
    pendingLoss.last_error = String((err && err.message) || err);
    bootLog(`events.jsonl flush failed for a non-critical batch (${batch.length} events, ` +
      `${interactions} interactions), dropped and recorded as a loss: ${pendingLoss.last_error}`);
    if (firstOfStretch && onNotice) {
      try { onNotice("events_dropped", { events: batch.length, interactions }); }
      catch (_e) { /* notice is best-effort */ }
    }
  }

  /* Stamp an event into the write queue: _seq, the live counters, and the
     recent-events ring. Returns whether it is durability-critical. */
  function enqueue(ev) {
    // _seq is the 0-based events.jsonl line ordinal -- assigned in call
    // order so it stays monotonic even though the write is deferred.
    // Normalization uses it as a secondary sort key so events sharing a
    // millisecond timestamp keep their true append order.
    ev._seq = eventCount;
    eventCount += 1;
    if (ev.type === "marker") {
      markerCount += 1;
      if (ev.data.marker_type === "start") startMarkerCount += 1;
    }
    if (ev.type === "interaction") interactionCount += 1;
    if (ev.type === "system" && (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      screenshotCount += 1;
    }
    recentEvents.push(ev);
    if (recentEvents.length > RECENT_BUFFER_SIZE) recentEvents.shift();
    const critical = ev.type === "marker" || ev.type === "system";
    writeQueue.push({ line: JSON.stringify(ev) + "\n", critical, type: ev.type, ts: ev.timestamp });
    return critical;
  }

  /* RP-21: queue the pending loss record (a critical system event, so it
     is re-queued until written) ahead of the next event. */
  function queueLossRecord() {
    if (!pendingLoss) return false;
    const loss = pendingLoss;
    pendingLoss = null;
    enqueue(systemEvent(sessionId, "events_dropped", loss));
    return true;
  }

  function appendEvent(ev) {
    const lossQueued = queueLossRecord();
    const critical = enqueue(ev);
    // Markers and system events (session start/end, idle, screenshots)
    // are durability-critical -- flush the whole queue now, which also
    // preserves ordering of any activity/interaction events ahead of it.
    if (critical || lossQueued) {
      flushEvents();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flushEvents, 500);
    }
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
    /* I43: carry the foreground window's desktop bounds so the viewer
       can tell which monitor the work happened on. active-win reports
       {x, y, width, height}; older builds may omit it. */
    if (currentRun.bounds) {
      const b = currentRun.bounds;
      ev.data.bounds = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
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

  /* Write an end marker for every open run, innermost first. Returns how
     many were ended. `reason` is the existing optional marker field. */
  function endOpenRuns(reason) {
    let ended = 0;
    while (markerStack.length > 0) {
      fireMarker(reason ? { markerType: "end", reason } : { markerType: "end" });
      ended += 1;
    }
    return ended;
  }

  /* One key per run: end the open run (reason auto_close_for_sibling, the
     existing close-then-open value), then start the next one. Runs never
     nest. An unnamed run is "Transaction N" (the SME's word, AD-29; "Run N"
     in recordings made before it), N counting every start marker this
     session, so a named run (a task shortcut) takes a number too. */
  function startRun(label) {
    endOpenRuns("auto_close_for_sibling");
    return fireMarker({ markerType: "start", label: label || `Transaction ${startMarkerCount + 1}` });
  }

  function fireSystem(kind, payload) {
    const ev = systemEvent(sessionId, kind, payload);
    appendEvent(ev);
    return ev;
  }

  function fireInteraction(data) {
    lastInteractionMs = Date.now();
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
      startMarkerCount,
      screenshotCount,
      interactionCount,
      writeErrorCount,
      droppedEventCount,
      sessionStartMs,
      // The time recorded: since the start, less the time paused.
      elapsedMs: Date.now() - sessionStartMs - pausedNowMs(),
      pausedMs: pausedNowMs(),
      // The pause in progress, from its start (0 while recording).
      currentPauseMs: paused && pausedSinceMs != null ? Date.now() - pausedSinceMs : 0,
      lastInteractionMs,
      recentEvents: recentEvents.slice(),
    };
  }

  async function stop() {
    if (stopped) return getStatus();
    stopped = true;
    if (pollHandle) clearInterval(pollHandle);
    closeRun(Date.now());
    // Stopping the session ends the open run: its end marker lands before
    // session_end (and after the recorder's final values, which main.js
    // drains before calling stop).
    endOpenRuns();
    fireSystem("session_end");
    flushEvents();   // I47: drain any queued events on a clean exit
    return getStatus();
  }

  function pause() {
    if (paused) return;
    paused = true;
    pausedSinceMs = Date.now();
    closeRun(pausedSinceMs);
    fireSystem("paused");
  }

  function resume() {
    if (!paused) return;
    if (pausedSinceMs != null) pausedTotalMs += Date.now() - pausedSinceMs;
    pausedSinceMs = null;
    paused = false;
    fireSystem("resumed");
  }

  fireSystem("session_start");
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
  tick();

  return { fireMarker, startRun, fireSystem, fireInteraction, getStatus, pause, resume, stop };
}

module.exports = { startTracker, POLL_INTERVAL_MS, normalizeTitle, isNewRun, isUncapturedApp, readForeground };
