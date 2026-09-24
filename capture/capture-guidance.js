"use strict";

/*
 * capture-guidance.js: the words the SME reads while recording, derived from
 * one pdt:status snapshot. Used by main.js for the recording bar
 * (ui/recording-bar.html paints the model it is sent), the tray's status
 * line and tooltip, the end summary and the toasts.
 *
 * The SME's words: "Recording", "Paused", "Not recording", "Run 1",
 * "between runs". Never "Tracking", "session", "events" or "interactions".
 *
 * Pure module: no DOM, no Electron, no IPC. Unit-tested in
 * test/capture-guidance.test.js.
 */

/* An Electron accelerator in the form people read ("Ctrl+Shift+S", not
   "Control+Shift+S"). Empty when there is no key. */
function formatHotkey(accel) {
  if (typeof accel !== "string" || !accel.trim()) return "";
  return accel
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (/^Control$/i.test(p)) return "Ctrl";
      if (/^CommandOrControl$/i.test(p) || /^CmdOrCtrl$/i.test(p)) return "Ctrl";
      if (/^Command$/i.test(p) || /^Cmd$/i.test(p) || /^Meta$/i.test(p) || /^Super$/i.test(p)) return "Cmd";
      return p;
    })
    .join("+");
}

/* Elapsed time on the one clock: m:ss under an hour, h:mm:ss from an hour. */
function formatElapsed(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

/* "idle" | "recording" | "paused" from a pdt:status snapshot. */
function recordingState(status) {
  const s = status || {};
  if (!s.tracking) return "idle";
  return s.paused ? "paused" : "recording";
}

/* The run in progress: the open run's name, or "between runs" after an
   End run (or an idle stretch that ended it). Empty when not recording. */
function runText(status) {
  const s = status || {};
  if (!s.tracking) return "";
  const open = Array.isArray(s.openMarkers) ? s.openMarkers : [];
  return open.length ? String(open[open.length - 1]) : "between runs";
}

const CLICKS_NOT_RECORDED =
  "Clicks and typing are not being recorded. Keep going and tell the analyst.";

/* The one problem the bar shows as a line of its own: the recorder that
   captures clicks and typing has stopped for good, or has been silent past
   the alarm threshold. Nothing when recording is fine, when clicks and
   typing are switched off in setup, or when not recording. */
function problemText(status) {
  const s = status || {};
  if (!s.tracking) return null;
  if (s.recorder_state === "dead" || s.recorder_silent) return CLICKS_NOT_RECORDED;
  return null;
}

/* Everything the recording bar paints, from one status snapshot, the run
   key actually registered (hotkey: an Electron accelerator, or empty when
   the key could not be registered) and whether named runs are set up. */
function barModel({ status, hotkey, namedRuns } = {}) {
  const state = recordingState(status);
  const stateText = state === "idle" ? "Not recording" : state === "paused" ? "Paused" : "Recording";
  const run = runText(status);
  const elapsed = state === "idle" ? "" : formatElapsed(status && status.elapsedMs);
  return {
    state,
    stateText,
    runText: run,
    elapsed,
    key: formatHotkey(hotkey),
    problem: problemText(status),
    pauseLabel: state === "paused" ? "Resume" : "Pause",
    namedRuns: !!namedRuns && state !== "idle",
    title: state === "idle" ? stateText : stateText + ": " + run + ", " + elapsed,
  };
}

/* The tray's first menu line (and, prefixed with the app name, its
   tooltip): "Not recording", "Recording: Run 2", "Paused: between runs". */
function trayStatusLine(status) {
  const m = barModel({ status });
  if (m.state === "idle") return m.stateText;
  const line = m.stateText + ": " + m.runText;
  return m.problem ? line + " (clicks and typing not recorded)" : line;
}

/* The end summary: runs and duration in one line, where the folder is, and
   a warning when no run was marked. No counts of clicks, events or
   screenshots: the SME acts on none of them. */
function summaryModel({ runs, durationMs, sessionFolder, hotkey } = {}) {
  const n = Number.isFinite(runs) && runs > 0 ? runs : 0;
  const key = formatHotkey(hotkey);
  const folder = sessionFolder || "";
  const base = folder.split(/[\\/]/).filter(Boolean).pop() || "";
  return {
    headline: (n === 1 ? "1 run" : n + " runs") + ", " + formatElapsed(durationMs),
    folder,
    zipName: base ? base + ".zip" : "",
    warning: n > 0 ? null
      : "No run was marked, so the analyst cannot tell where each run starts. " +
        "Tell the analyst, or record again and " +
        (key ? "press " + key : "click Next run on the recording bar") +
        " each time you start the process.",
  };
}

/* A program name for a toast: browsers by their product name, anything else
   without its ".exe". */
const BROWSER_NAMES = {
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "brave.exe": "Brave",
  "iexplore.exe": "Internet Explorer",
  "opera.exe": "Opera",
  "vivaldi.exe": "Vivaldi",
};
function friendlyAppName(app) {
  const raw = typeof app === "string" ? app.trim() : "";
  if (!raw) return "this program";
  return BROWSER_NAMES[raw.toLowerCase()] || raw.replace(/\.exe$/i, "");
}

module.exports = {
  formatHotkey,
  formatElapsed,
  recordingState,
  runText,
  problemText,
  barModel,
  trayStatusLine,
  summaryModel,
  friendlyAppName,
  CLICKS_NOT_RECORDED,
};
