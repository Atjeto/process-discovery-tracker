/*
 * Live-session window (formerly "operator panel").
 *
 * This window is the canonical surface for everything an operator
 * needs during an active capture session:
 *   - status header (state dot, current app, session timer)
 *   - open markers stack
 *   - counter grid (events / markers / shots / interactions)
 *   - recent events feed (last 8, reverse chronology)
 *   - fire-start input + saved-label buttons
 *   - end-marker, pause/resume, manual screenshot, sync marker
 *   - end session (inline confirm, no window.confirm)
 *
 * Previously the counter grid + recent events feed lived in a
 * separate status-window.js; that legacy window was removed in the
 * v0.16 polish cycle -- this is now the only live-session surface.
 * See ../docs/UX-CHANGES.md for the merge rationale.
 *
 * Renderer talks to main.js via the same IPC channels as before
 * (pdt:fireStart, pdt:fireEnd, pdt:status, pdt:fireSync,
 * pdt:togglePause, pdt:manualScreenshot, pdt:endSession). pdt:fireStart
 * now optionally takes `{ nest: true }` to opt into nested-marker
 * semantics (default is close-then-open).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { jsonForScript } = require("./json-for-script.js");
const { injectTokens } = require("./ui/tokens.js");

/* Markup lives in ui/operator-panel.html, loaded via a data: URL.
   Runtime-dynamic slots:
     {{LABELS}}         the JSON-encoded saved-label list.
     {{MARKER_HOTKEY}}  the real marker (start) accelerator from config, so the
                        R4 guidance line names the actual key, not a default.
     {{GUIDANCE_MODULE}} the absolute path to capture-guidance.js, required by
                        the page (nodeIntegration:true) so the one guidance
                        component is shared, not re-implemented in the page.
   jsonForScript (not bare JSON.stringify): each slot lands inside an inline
   <script>, so a value containing "</script>..." would break out and -- with
   nodeIntegration:true -- execute. See json-for-script.js. */
function buildOperatorHtml(config) {
  const labels = jsonForScript((config && config.process_labels) || []);
  const hotkey = jsonForScript(
    ((config && config.hotkeys && config.hotkeys.start_picker) || ""));
  const modPath = jsonForScript(path.join(__dirname, "capture-guidance.js"));
  return injectTokens(fs
    .readFileSync(path.join(__dirname, "ui", "operator-panel.html"), "utf-8")
    .split("{{LABELS}}").join(labels)
    .split("{{MARKER_HOTKEY}}").join(hotkey)
    .split("{{GUIDANCE_MODULE}}").join(modPath));
}

function showOperatorPanel(config) {
  const win = new BrowserWindow({
    width: 460,
    height: 720,
    title: "Process Discovery -- Live session",
    alwaysOnTop: true,
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
  // D1: the highest always-on-top level so the live session window stays
  // visible above normal -- and even most always-on-top -- apps. The
  // operator must always be able to reach Stop / markers without hunting
  // for the window behind whatever they are working in.
  win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildOperatorHtml(config))
  );
  return win;
}

module.exports = { showOperatorPanel, buildOperatorHtml };
