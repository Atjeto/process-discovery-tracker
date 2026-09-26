"use strict";

/*
 * capture-guidance.js: the words the SME reads while recording, derived from
 * one pdt:status snapshot. Used by main.js for the recording bar
 * (ui/recording-bar.html paints the model it is sent), the tray's status
 * line and tooltip, the end summary and the toasts.
 *
 * The SME's words (AD-29): "Recording", "Paused", "Not recording",
 * "Transaction 1", "between transactions"; a transaction is one pass
 * through the process (TRANSACTION_MEANS). Never "run", "Tracking",
 * "session", "events" or "interactions". The code keeps "run" for it.
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

/* The transaction in progress: the open run's name ("Transaction 2", or a
   named one), or "between transactions" after an End transaction (or an
   idle stretch that ended it). Empty when not recording. */
function runText(status) {
  const s = status || {};
  if (!s.tracking) return "";
  const open = Array.isArray(s.openMarkers) ? s.openMarkers : [];
  return open.length ? String(open[open.length - 1]) : "between transactions";
}

/* What a transaction is, where the SME first meets the word (the welcome)
   and in Help. */
const TRANSACTION_MEANS =
  "A transaction is one pass through the process, for example one order or one ticket.";

const CLICKS_NOT_RECORDED =
  "Clicks and typing are not being recorded. Keep going and tell the analyst.";

/* Lane LF-SME (live finding 15): the first start after an install or an
   update waits for Windows to check the recorder; the bar says so instead
   of the app seeming frozen. */
const STARTING_RECORDER = "Starting the recorder...";

/* The one line the bar shows under its row: the recorder that captures
   clicks and typing has stopped for good, or has been silent past the alarm
   threshold; or it is still starting. Nothing when recording is fine, when
   clicks and typing are switched off in setup, or when not recording. */
function problemText(status) {
  const s = status || {};
  if (!s.tracking) return null;
  if (s.recorder_state === "dead" || s.recorder_silent) return CLICKS_NOT_RECORDED;
  if (s.recorder_state === "starting") return STARTING_RECORDER;
  return null;
}

/* The time paused, from a second on: "paused 0:06" (lane FX3, validation
   pass 3, F17). The elapsed time beside it leaves it out. */
function pausedText(ms) {
  return Number.isFinite(ms) && ms >= 1000 ? "paused " + formatElapsed(ms) : "";
}

/* Everything the recording bar paints, from one status snapshot, the run
   key actually registered (hotkey: an Electron accelerator, or empty when
   the key could not be registered) and whether named runs are set up. The
   elapsed time is the time recorded (the pauses left out); while paused,
   the pause's own length shows beside Paused (pauseNow, "0:03"), and the
   time paused in all is in the bar's tooltip (lane FX3, F17). */
function barModel({ status, hotkey } = {}) {
  const state = recordingState(status);
  const stateText = state === "idle" ? "Not recording" : state === "paused" ? "Paused" : "Recording";
  const run = runText(status);
  const elapsed = state === "idle" ? "" : formatElapsed(status && status.elapsedMs);
  const pausedLine = state === "idle" ? "" : pausedText(status && status.pausedMs);
  const current = status && status.currentPauseMs;
  const pauseNow = state === "paused" && Number.isFinite(current) && current >= 1000 ? formatElapsed(current) : "";
  return {
    state,
    stateText,
    runText: run,
    elapsed,
    paused: pausedLine,
    pauseNow,
    key: formatHotkey(hotkey),
    problem: problemText(status),
    pauseLabel: state === "paused" ? "Resume" : "Pause",
    title: state === "idle" ? stateText : stateText + ": " + run + ", " + elapsed + (pausedLine ? " (" + pausedLine + ")" : ""),
  };
}

/* The tray's first menu line (and, prefixed with the app name, its
   tooltip): "Not recording", "Recording: Transaction 2", "Paused: between
   transactions". */
function trayStatusLine(status) {
  const m = barModel({ status });
  if (m.state === "idle") return m.stateText;
  const line = m.stateText + ": " + m.runText;
  return m.problem === CLICKS_NOT_RECORDED ? line + " (clicks and typing not recorded)" : line;
}

/* The end summary: transactions and duration in one line ("4 transactions,
   0:11"), where the folder is, and a warning when no transaction was
   marked. No counts of clicks, events or screenshots: the SME acts on none
   of them. Lane FX3 (F17): the duration is the time recorded, and a pause
   is said beside it ("4 transactions, 1:17 (paused 0:06, not counted)"). */
function summaryModel({ runs, durationMs, pausedMs, sessionFolder, hotkey } = {}) {
  const n = Number.isFinite(runs) && runs > 0 ? runs : 0;
  const key = formatHotkey(hotkey);
  const folder = sessionFolder || "";
  const base = folder.split(/[\\/]/).filter(Boolean).pop() || "";
  const paused = pausedText(pausedMs);
  return {
    headline: (n === 1 ? "1 transaction" : n + " transactions") + ", " + formatElapsed(durationMs) +
      (paused ? " (" + paused + ", not counted)" : ""),
    folder,
    zipName: base ? base + ".zip" : "",
    warning: n > 0 ? null
      : "No transaction was marked, so the analyst cannot tell where each " +
        "transaction starts. Tell the analyst, or record again and " +
        (key ? "press " + key : "click Next transaction on the recording bar") +
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
  pausedText,
  trayStatusLine,
  summaryModel,
  friendlyAppName,
  CLICKS_NOT_RECORDED,
  STARTING_RECORDER,
  TRANSACTION_MEANS,
};
