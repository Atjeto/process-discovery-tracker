/*
 * Session config window. Form for editing the per-session YAML that the
 * tracker loads at startup -- engagement metadata, worker identity,
 * label list for the tray menu, idle threshold, OBS scene.
 *
 * Save target: `<userData>/quick-config.yaml`. The next launch picks
 * this up automatically if PDT_CONFIG is unset (see main.js startup).
 * Editing takes effect on restart; the current session keeps its
 * loaded config.
 *
 * IPC contract:
 *   pdt:sessionConfigGet   -> { yaml: string, path: string|null }
 *   pdt:sessionConfigSave  -> { saved: boolean, path: string, error?: string }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { DEFAULTS } = require("./config.js");

/* Markup lives in ui/session-config.html, loaded via a data: URL.
   {{IDLE}} is substituted with the auto-stop default from config.js
   DEFAULTS, keeping that the single source of truth. */
function buildHtml() {
  return fs
    .readFileSync(path.join(__dirname, "ui", "session-config.html"), "utf-8")
    .split("{{IDLE}}")
    .join(String(DEFAULTS.auto_end_idle_minutes));
}

function showSessionConfigWindow(opts) {
  const win = new BrowserWindow({
    width: 580,
    height: 640,
    title: "Set up a recording session",
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: "#14141A",
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml()));
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showSessionConfigWindow, buildHtml };
