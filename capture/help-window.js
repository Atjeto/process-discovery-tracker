/*
 * Capture-side help window. Toggled from the tray menu.
 *
 * Markup lives in ui/help-window.html and is loaded via a data: URL.
 * The content is a quick reference for tray actions, hotkeys, OBS
 * setup, config, and troubleshooting.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");

/* Static read-only content -- served verbatim from ui/help-window.html. */
function buildHelpHtml() {
  return fs.readFileSync(path.join(__dirname, "ui", "help-window.html"), "utf-8");
}

function showHelpWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 760,
    title: "PDT Help",
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
    "data:text/html;charset=utf-8," + encodeURIComponent(buildHelpHtml())
  );
  return win;
}

module.exports = { showHelpWindow, buildHelpHtml };
