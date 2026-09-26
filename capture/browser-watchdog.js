"use strict";

/*
 * browser-watchdog.js: when to tell the SME "Clicks and typing in Chrome are
 * not being recorded".
 *
 * Chrome and Edge show web pages to UI Automation only once their
 * accessibility is on; the recorder switches it on, and this check says so
 * when that did not work: a browser has been in front, with the SME's mouse
 * or keyboard in use, for 30 s in all, and nothing from that browser has
 * been recorded in this recording. Recorded means a click, a selection, a
 * value, or typing the recorder has seen and not written yet (its activity
 * line: a value is written only once the typing pauses).
 *
 * The check it replaces wanted a browser event every 8 s. In the live
 * recordings of 2026-09-26 (lane LF-SME, finding 14) that raised the toast
 * while Chrome was being recorded: during a 10 s description typed in one
 * field, and right after Resume.
 *
 * Time paused, time idle, and time while the recorder is not running (still
 * starting, restarting) do not count; restart() begins a fresh count (at a
 * start and at Resume). The toast is given once per recording.
 *
 * Pure: an injected clock; main.js calls tick() on the tracker's 5 s tick.
 */

const WINDOW_MS = 30_000;
const ACTIVE_WITHIN_MS = 5_000;
const MAX_STEP_MS = 10_000;

/* One key per browser, whether named by its process ("chrome.exe", from an
   interaction) or by active-win's owner name ("Google Chrome"). */
const BROWSERS = {
  "chrome.exe": "chrome", "google chrome": "chrome",
  "msedge.exe": "edge", "microsoft edge": "edge",
  "brave.exe": "brave", "brave": "brave", "brave browser": "brave",
  "iexplore.exe": "ie", "internet explorer": "ie",
  "opera.exe": "opera", "opera": "opera",
  "vivaldi.exe": "vivaldi", "vivaldi": "vivaldi",
};

function browserKey(name) {
  return BROWSERS[String(name || "").trim().toLowerCase()] || null;
}

function createBrowserWatchdog({ windowMs = WINDOW_MS, activeWithinMs = ACTIVE_WITHIN_MS, now = Date.now } = {}) {
  const recorded = new Set();
  const unrecordedMs = new Map();
  let lastTickMs = null;
  let warned = false;

  return {
    /* Something from this program was recorded (an interaction, or typing). */
    noteRecorded(processName) {
      const b = browserKey(processName);
      if (b) recorded.add(b);
    },

    /* A fresh count: the recording started, or resumed after a pause. */
    restart() {
      lastTickMs = null;
      unrecordedMs.clear();
    },

    /* One tick. Returns true once, when the SME should be told. */
    tick({ foregroundApp, userIdleMs, paused, recorderOn }) {
      const t = now();
      const step = lastTickMs == null ? 0 : Math.max(0, Math.min(t - lastTickMs, MAX_STEP_MS));
      lastTickMs = t;
      if (warned || paused || !recorderOn) return false;
      const b = browserKey(foregroundApp);
      if (!b || recorded.has(b)) return false;
      if (!(Number.isFinite(userIdleMs) && userIdleMs <= activeWithinMs)) return false;
      const total = (unrecordedMs.get(b) || 0) + step;
      unrecordedMs.set(b, total);
      if (total < windowMs) return false;
      warned = true;
      return true;
    },
  };
}

module.exports = { createBrowserWatchdog, browserKey, WINDOW_MS };
