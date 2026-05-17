/*
 * OBS settings window. Small modal where the user can paste their
 * OBS WebSocket password and test the connection.
 *
 * Markup lives in ui/obs-settings.html, loaded via a data: URL.
 * Renderer talks back via IPC:
 *   pdt:obsTest    -> { ok, message }
 *   pdt:obsSave    -> { saved: true }
 *   pdt:obsGet     -> { url, password }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");

/* Static markup -- served verbatim from ui/obs-settings.html. */
function buildSettingsHtml() {
  return fs.readFileSync(path.join(__dirname, "ui", "obs-settings.html"), "utf-8");
}

function showObsSettingsWindow(opts) {
  const win = new BrowserWindow({
    width: 540,
    height: 460,
    title: "OBS Settings",
    resizable: false,
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
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildSettingsHtml()));
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showObsSettingsWindow, buildSettingsHtml };
