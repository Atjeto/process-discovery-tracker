"use strict";

/*
 * end-summary-window.js: the one screen the SME sees when a recording stops.
 *
 * "Recording saved", the runs and the duration in one line, a warning when
 * no run was marked, where the recording folder is, "Make a zip for the
 * analyst" (a zip written next to the folder and shown in Explorer; nothing
 * is sent anywhere), "Show the folder", an optional name for the recording,
 * and Done. No counts of clicks, events or screenshots.
 *
 * The words come from capture-guidance.summaryModel; the model is injected
 * into the page's inline script through jsonForScript, so a folder path or
 * a name can never break out of the <script> (nodeIntegration is on).
 *
 * IPC used by the page (main.js):
 *   pdt:showFolder(folder)             Explorer with the folder selected
 *   pdt:zipFolder(folder)              { ok, zipName, size } or { ok:false, error }
 *   pdt:setSessionLabel(folder, name)  the optional name, on the manifest
 */

const fs = require("node:fs");
const path = require("node:path");
const { jsonForScript } = require("./json-for-script.js");
const { injectTokens } = require("./ui/tokens.js");

/* Room for the longest note (a zip error in four lines) without scrolling;
   the no-run warning adds its box. */
const WIDTH = 480;
const HEIGHT = 420;
const HEIGHT_WITH_WARNING = 500;

function buildSummaryHtml(model) {
  return injectTokens(fs
    .readFileSync(path.join(__dirname, "ui", "end-summary.html"), "utf-8")
    .split("{{SUMMARY}}").join(jsonForScript(model || {})));
}

function showEndSummaryWindow(model) {
  // Electron is required here, not at the top, so the page builder loads
  // under plain node (test/end-summary.test.js).
  const { BrowserWindow } = require("electron");
  const win = new BrowserWindow({
    width: WIDTH,
    height: model && model.warning ? HEIGHT_WITH_WARNING : HEIGHT,
    useContentSize: true,
    title: "Recording saved",
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#14141A",
    show: false,
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
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildSummaryHtml(model)));
  return win;
}

module.exports = { showEndSummaryWindow, buildSummaryHtml };
