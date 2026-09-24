/*
 * Capture-side help window, opened from the tray's Help item and the
 * welcome's Help button.
 *
 * One screen for the SME: how to start, what a transaction is and how to
 * mark the next one, how to pause and stop, how to hand the recording
 * over, what is recorded and where the recordings are. The keys are the
 * ones actually registered and the folder is the real one. The developer
 * reference (OBS setup, the
 * config files, the session folder's files, Citrix, troubleshooting) lives
 * in docs/architecture/CAPTURE.md, not here.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { injectTokens } = require("./ui/tokens.js");
const { formatHotkey, TRANSACTION_MEANS } = require("./capture-guidance.js");

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* The sentences that name keys, from the keys actually registered
   (`keys.start`, `keys.end`, `keys.shot`: Electron accelerators, or empty
   when another program holds one). */
function helpLines(keys) {
  const k = (accel) => {
    const key = formatHotkey(accel);
    return key ? "<kbd>" + escapeHtml(key) + "</kbd>" : "";
  };
  const start = k(keys && keys.start);
  const end = k(keys && keys.end);
  const shot = k(keys && keys.shot);
  const other = [];
  if (end) other.push(end + " ends the current transaction without starting the next.");
  if (shot) other.push(shot + " takes a screenshot.");
  return {
    start: start
      ? "Press " + start + ", or choose Start recording in the tray menu."
      : "Choose Start recording in the tray menu.",
    next: start
      ? "press " + start + " (or click Next transaction on the bar)."
      : "click Next transaction on the bar.",
    other: other.join(" "),
  };
}

/* Static page from ui/help-window.html: keys, folder and version filled in. */
function buildHelpHtml(opts) {
  const o = opts || {};
  const lines = helpLines(o.keys || {});
  return injectTokens(fs.readFileSync(path.join(__dirname, "ui", "help-window.html"), "utf-8"))
    .split("{{START_HOW}}").join(lines.start)
    .split("{{NEXT_HOW}}").join(lines.next)
    .split("{{TRANSACTION}}").join(escapeHtml(TRANSACTION_MEANS))
    .split("{{OTHER_KEYS}}").join(lines.other)
    .split("{{OTHER_HIDDEN}}").join(lines.other ? "" : " hidden")
    .split("{{FOLDER}}").join(escapeHtml(o.folder || ""))
    .split("{{VERSION}}").join(escapeHtml(require("./package.json").version));
}

function showHelpWindow(opts) {
  const win = new BrowserWindow({
    width: 560,
    height: 640,     // one screen with every key listed needs 638 (measured)
    useContentSize: true,
    title: "How to record",
    autoHideMenuBar: true,
    backgroundColor: "#14141A",
    webPreferences: {
      /* Help is static read-only content; we run it under the
         strictest mode: sandboxed renderer with no Node access. */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildHelpHtml(opts))
  );
  return win;
}

module.exports = { showHelpWindow, buildHelpHtml, helpLines };
