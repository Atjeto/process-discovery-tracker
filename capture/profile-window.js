/*
 * Profile window. Edits the worker's identity (id, display name, role,
 * team) -- the per-operator slice of config.worker that gets stamped
 * into every session manifest.
 *
 * Persistence: writes the `worker` slice into userData/user-config.json
 * via user-config.js and mirrors into the live config. Surfaced both
 * from the tray (top-level "Profile…") and from the first-run welcome.
 *
 * Markup lives in ui/profile.html, loaded via a data: URL.
 *
 * IPC:
 *   pdt:profileGet  -> { id, name, role, bu }
 *   pdt:profileSave -> { saved: boolean, error?: string }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");

function buildHtml() {
  return fs.readFileSync(path.join(__dirname, "ui", "profile.html"), "utf-8");
}

function showProfileWindow(opts) {
  const win = new BrowserWindow({
    width: 540,
    height: 540,
    title: "Profile",
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
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml()));
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showProfileWindow, buildHtml };
