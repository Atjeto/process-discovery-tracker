/*
 * First-run welcome window.
 *
 * Shown the first time the capture app starts on a machine (a one-shot flag
 * in userData/welcome-shown.json). Three lines with the real keys (the
 * first says what a transaction is, where the SME first meets the word),
 * then Start recording (the one start: the recording begins with
 * Transaction 1), Help and Close.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { BrowserWindow, app } = require("electron");
const { injectTokens } = require("./ui/tokens.js");
const { formatHotkey, TRANSACTION_MEANS } = require("./capture-guidance.js");

const FLAG_FILE = "welcome-shown.json";

function flagPath() {
  return path.join(app.getPath("userData"), FLAG_FILE);
}

function shouldShowOnLaunch() {
  try {
    return !fs.existsSync(flagPath());
  } catch (_) {
    return true;
  }
}

function markShown() {
  try {
    fs.mkdirSync(path.dirname(flagPath()), { recursive: true });
    fs.writeFileSync(flagPath(), JSON.stringify({ shown_at: new Date().toISOString() }));
  } catch (_) {
    /* best-effort */
  }
}

let welcomeWindow = null;

function showWelcomeWindow(opts) {
  opts = opts || {};
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.show();
    welcomeWindow.focus();
    return welcomeWindow;
  }
  welcomeWindow = new BrowserWindow({
    width: 540,
    height: 300,     // the three lines with the definition need 298 (measured)
    useContentSize: true,
    title: "Welcome to Process Discovery Tracker",
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#14141A",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  welcomeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  welcomeWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  welcomeWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml(opts)));
  welcomeWindow.on("closed", () => {
    welcomeWindow = null;
    markShown();
  });
  return welcomeWindow;
}

/* The two lines that name the transaction key. `opts.keys.start` is the
   key actually registered (an Electron accelerator), or empty when another
   program holds it; then the lines point at the tray and the bar instead. */
function welcomeLines(opts) {
  const key = formatHotkey(opts && opts.keys && opts.keys.start);
  const k = key ? "<kbd>" + escapeHtml(key) + "</kbd>" : "";
  return {
    start: (key
      ? "Press " + k + " to start recording. It starts with Transaction 1. "
      : "Choose <strong>Start recording</strong> in the tray menu. It starts with Transaction 1. ") +
      escapeHtml(TRANSACTION_MEANS),
    next: key
      ? "Each time you start the process again, press " + k + " for the next transaction."
      : "Each time you start the process again, click <strong>Next transaction</strong> on the recording bar.",
  };
}

function buildHtml(opts) {
  const lines = welcomeLines(opts);
  return injectTokens(fs
    .readFileSync(path.join(__dirname, "ui", "welcome.html"), "utf-8")
    .split("{{LINE_START}}").join(lines.start)
    .split("{{LINE_NEXT}}").join(lines.next));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = {
  showWelcomeWindow,
  shouldShowOnLaunch,
  markShown,
  buildHtml,
  welcomeLines,
};
