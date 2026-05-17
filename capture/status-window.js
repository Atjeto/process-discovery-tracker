/*
 * Legacy status window for the capture tracker.
 *
 * DEPRECATED -- everything this window shows is now also in
 * operator-panel.js (rebranded as "Live session window") with the
 * additional affordances of inline marker firing, sync-ID input,
 * and end-session confirm. The tray surfaces both for backward
 * compatibility, but new work should land in operator-panel.js.
 * This file remains as a safe fallback in case the merged window
 * has a regression an operator can't work around -- once we've
 * shipped a v0.3 release that proves the merged window in the
 * field, this file can be removed.
 *
 * Polls main process via IPC every 1 second for current state.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");

/* Markup lives in ui/status-window.html, loaded via a data: URL.
   This window carries no runtime-dynamic markup -- all state arrives
   over IPC after load -- so the file is served verbatim. */
function buildStatusHtml() {
  return fs.readFileSync(path.join(__dirname, "ui", "status-window.html"), "utf-8");
}

function showStatusWindow(opts) {
  const win = new BrowserWindow({
    width: 340,
    height: 720,
    title: "PDT Status",
    resizable: false,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#14141A",
    skipTaskbar: false,
    webPreferences: {
      /* Trusted first-party HTML loaded via a data: URL. CSP in the
         page restricts what the renderer can do. */
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
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildStatusHtml())
  );
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showStatusWindow, buildStatusHtml };
