/*
 * Settings window. A single top-level surface for everything that
 * persists across sessions:
 *   - Hotkeys        — global shortcuts (re-register on next launch)
 *   - Video / OBS    — WebSocket URL, password, scene, required flag
 *   - Screenshots    — enable, quality, triggers, display selection
 *   - Storage & limits — warn threshold, auto-stop idle minutes
 *
 * Markup lives in ui/settings.html, loaded via a data: URL.
 *
 * Renderer talks to main.js via:
 *   pdt:settingsGet   -> the live config slices the window owns
 *   pdt:settingsSave  -> { saved: boolean, error?: string }
 *   pdt:obsTest       -> { ok, message } (shared with the old OBS dialog)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { injectTokens } = require("./ui/tokens.js");

function buildHtml() {
  return injectTokens(fs.readFileSync(path.join(__dirname, "ui", "settings.html"), "utf-8"));
}

function showSettingsWindow(opts) {
  const win = new BrowserWindow({
    width: 600,
    height: 760,
    title: "Settings",
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

module.exports = { showSettingsWindow, buildHtml };
