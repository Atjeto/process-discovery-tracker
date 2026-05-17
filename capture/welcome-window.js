/*
 * First-run welcome window.
 *
 * Shown the first time the user launches the capture app on a given
 * machine (a one-shot flag in userData/welcome-shown.json prevents
 * re-showing). Goal: take a fresh SME from "tray icon appeared, now
 * what?" to "I can record a session" in under 60 seconds.
 *
 * Three CTAs:
 *   1. Show the operator panel (the most useful guided surface)
 *   2. Open the help window (full how-to)
 *   3. Dismiss ("I know what I'm doing")
 *
 * Optionally takes a `force` flag so the user can reopen it from
 * the tray menu later ("Help > Show welcome again").
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { BrowserWindow, app, ipcMain } = require("electron");

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
    width: 560,
    height: 540,
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

function buildHtml(opts) {
  const hotkeys = (opts && opts.hotkeys) || {};
  const start = hotkeys.start_picker || "Ctrl+Shift+S";
  const end = hotkeys.end_innermost || "Ctrl+Shift+E";
  const shot = hotkeys.manual_screenshot || "Ctrl+Shift+P";
  /* Markup lives in ui/welcome.html; the three {{HK_*}} tokens carry
     the (escaped) current hotkey bindings. */
  return fs
    .readFileSync(path.join(__dirname, "ui", "welcome.html"), "utf-8")
    .split("{{HK_START}}").join(escapeHtml(start))
    .split("{{HK_END}}").join(escapeHtml(end))
    .split("{{HK_SHOT}}").join(escapeHtml(shot));
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
};
