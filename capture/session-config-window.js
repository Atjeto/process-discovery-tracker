/*
 * Session-setup window. Edits the per-session inputs only:
 *   - engagement_id, engagement_name (the request code and its plain-English
 *     name, shown as Request, AD-30)
 *   - process_labels (the quick-pick task list)
 *
 * Hotkeys, OBS, screenshots and storage / lifecycle limits are no longer
 * here -- those are persistent and live in the Settings window. Worker
 * identity lives in the Profile window. Splitting these three concerns
 * was the headline of the IA polish pass.
 *
 * Save target: `<userData>/quick-config.yaml`. The next launch loads it
 * as the per-session YAML if PDT_CONFIG is unset (see main.js startup).
 * Editing takes effect on restart; the current session keeps the config
 * it was started with.
 *
 * IPC contract:
 *   pdt:sessionConfigGet   -> { yaml: string, path: string|null }
 *   pdt:sessionConfigSave  -> { saved: boolean, path: string, error?: string }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow } = require("electron");
const { injectTokens } = require("./ui/tokens.js");

/* Markup is served verbatim from ui/session-config.html -- the slimmer
   form has no runtime-templated slots (the old {{IDLE}} substitution
   left with the hotkeys / OBS / idle fields). */
function buildHtml() {
  return injectTokens(fs.readFileSync(path.join(__dirname, "ui", "session-config.html"), "utf-8"));
}

function showSessionConfigWindow(opts) {
  const win = new BrowserWindow({
    width: 580,
    height: 520,
    title: "Recording setup",
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
