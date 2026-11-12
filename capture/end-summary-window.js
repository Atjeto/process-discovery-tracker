"use strict";

/*
 * end-summary-window.js: the one screen the SME sees when a recording stops.
 *
 * "Recording saved", the transactions and the duration in one line ("4
 * transactions, 0:11"), a warning when no transaction was marked, where
 * the recording folder is, "Make a zip for the
 * analyst" (a zip written next to the folder and shown in Explorer; nothing
 * is sent anywhere), "Show the folder", an optional name for the recording,
 * four optional one-line questions and example files (contract C24,
 * sme-answers.js), and Done. No counts of clicks, events or screenshots.
 *
 * The words come from capture-guidance.summaryModel; the model is injected
 * into the page's inline script through jsonForScript, so a folder path or
 * a name can never break out of the <script> (nodeIntegration is on).
 *
 * IPC used by the page (main.js):
 *   pdt:showFolder(folder)             Explorer with the folder selected
 *   pdt:zipFolder(folder)              { ok, zipName, size } or { ok:false, error }
 *   pdt:setSessionLabel(folder, name)  the optional name, on the manifest
 *   pdt:setSmeAnswers(folder, answers) the four answers, manifest.sme_answers
 *   pdt:addSmeFiles(folder)            the file dialog; { ok, files, refused }
 *   pdt:removeSmeFile(folder, file)    one example file out; { ok, files }
 */

const fs = require("node:fs");
const path = require("node:path");
const { jsonForScript } = require("./json-for-script.js");
const { injectTokens } = require("./ui/tokens.js");

/* Lane C: the questions and two example files measure 800 px of content
   (the design drew 760 in Segoe UI; the app's own font is taller), and a
   refused file's line under the list adds 42; the no-transaction warning
   adds 86. A screen that cannot hold it (1366 x 768 with the taskbar is a
   728 px work area, 689 px of content under the frame) gets the window as
   tall as its work area, and the page scrolls inside. */
const WIDTH = 480;
const HEIGHT = 850;
const HEIGHT_WITH_WARNING = 936;

/* The content height the window gets: the height wanted, at most what the
   work area holds under the window's frame (its title bar and edges). */
function fitContentHeight(wanted, workAreaHeight, frameHeight) {
  if (!Number.isFinite(workAreaHeight) || workAreaHeight <= 0) return wanted;
  const room = Math.floor(workAreaHeight - Math.max(0, frameHeight || 0));
  return Math.max(200, Math.min(wanted, room));
}

function buildSummaryHtml(model) {
  return injectTokens(fs
    .readFileSync(path.join(__dirname, "ui", "end-summary.html"), "utf-8")
    .split("{{SUMMARY}}").join(jsonForScript(model || {})));
}

function showEndSummaryWindow(model) {
  // Electron is required here, not at the top, so the page builder loads
  // under plain node (test/end-summary.test.js).
  const { BrowserWindow, screen } = require("electron");
  const wanted = model && model.warning ? HEIGHT_WITH_WARNING : HEIGHT;
  const win = new BrowserWindow({
    width: WIDTH,
    height: wanted,
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
  // The frame is measured, not guessed: the window's height less its
  // content's, on the screen it opened on.
  try {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const frame = win.getBounds().height - win.getContentBounds().height;
    const fit = fitContentHeight(wanted, area.height, frame);
    if (fit < wanted) {
      win.setContentSize(WIDTH, fit);
      win.center();
    }
  } catch (_) { /* no screen information: the wanted size stays */ }
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

module.exports = { showEndSummaryWindow, buildSummaryHtml, fitContentHeight, WIDTH, HEIGHT, HEIGHT_WITH_WARNING };
