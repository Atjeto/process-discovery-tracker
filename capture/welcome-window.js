/*
 * First-run welcome window.
 *
 * Shown the first time the user launches the capture app on a given
 * machine (a one-shot flag in userData/welcome-shown.json prevents
 * re-showing). Goal: take a fresh SME from "tray icon appeared, now
 * what?" to "I can record a session" in under 60 seconds.
 *
 * Three CTAs:
 *   1. Show the operator panel (the most useful guided surface)
 *   2. Open the help window (full how-to)
 *   3. Dismiss ("I know what I'm doing")
 *
 * Optionally takes a `force` flag so the user can reopen it from
 * the tray menu later ("Help > Show welcome again").
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { BrowserWindow, app, ipcMain } = require("electron");

const FLAG_FILE = "welcome-shown.json";

function flagPath() {
  return path.join(app.getPath("userData"), FLAG_FILE);
}

function shouldShowOnLaunch() {
  try {
    return !fs.existsSync(flagPath());
  } catch (_) {
    return true;
  }
}

function markShown() {
  try {
    fs.mkdirSync(path.dirname(flagPath()), { recursive: true });
    fs.writeFileSync(flagPath(), JSON.stringify({ shown_at: new Date().toISOString() }));
  } catch (_) {
    /* best-effort */
  }
}

let welcomeWindow = null;

function showWelcomeWindow(opts) {
  opts = opts || {};
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.show();
    welcomeWindow.focus();
    return welcomeWindow;
  }
  welcomeWindow = new BrowserWindow({
    width: 560,
    height: 540,
    title: "Welcome to Process Discovery Tracker",
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#14141A",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  welcomeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  welcomeWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  welcomeWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml(opts)));
  welcomeWindow.on("closed", () => {
    welcomeWindow = null;
    markShown();
  });
  return welcomeWindow;
}

function buildHtml(opts) {
  const hotkeys = opts.hotkeys || {};
  const start = hotkeys.start_picker || "Ctrl+Shift+S";
  const end = hotkeys.end_innermost || "Ctrl+Shift+E";
  const shot = hotkeys.manual_screenshot || "Ctrl+Shift+P";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Welcome</title>
<style>
  :root {
    --bg: #14141A; --bg-2: #22222A; --bg-3: #2E2E37; --border: #424250;
    --fg: #D8D6CE; --fg-2: #A8A69E; --fg-3: #807E78;
    --accent: #6E8A66; --accent-2: #5A7488;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 30px; background: var(--bg); color: var(--fg);
         font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 18px; font-weight: 500; margin: 0 0 4px; }
  .tag { font-size: 11px; color: var(--fg-3); letter-spacing: 1.5px;
         text-transform: uppercase; margin: 0 0 24px; }
  p { color: var(--fg-2); margin: 0 0 14px; }
  ol { padding-left: 20px; margin: 0 0 18px; color: var(--fg-2); }
  li { margin-bottom: 6px; }
  .kbd { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 11px;
         padding: 2px 6px; background: var(--bg-3); border: 1px solid var(--border);
         border-radius: 3px; color: var(--fg); margin: 0 2px; }
  .row { display: flex; gap: 10px; margin-top: 22px; }
  .row button { flex: 1; padding: 10px 14px; border: 1px solid var(--border);
                background: var(--bg-2); color: var(--fg-2); border-radius: 5px;
                font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.12s; }
  .row button:hover { background: var(--bg-3); color: var(--fg); }
  .row button.primary { background: var(--accent); color: var(--bg);
                        border-color: var(--accent); font-weight: 500; }
  .row button.primary:hover { background: #8AAB7E; border-color: #8AAB7E; }
  .footer-hint { font-size: 11px; color: var(--fg-3); margin-top: 18px; text-align: center; }
</style></head><body>
<h1>Welcome to Process Discovery Tracker</h1>
<p class="tag">Capture · Mine · Synthesize</p>
<p>This is the worker-side capture app. It runs in your system tray and records what you do (with markers and screenshots) so an analyst can later study the process.</p>
<p><strong>Three hotkeys to remember:</strong></p>
<ol>
  <li><span class="kbd">${escapeHtml(start)}</span> &mdash; Start a marker. Pops a label picker, then begins capturing under that name.</li>
  <li><span class="kbd">${escapeHtml(end)}</span> &mdash; End the innermost open marker.</li>
  <li><span class="kbd">${escapeHtml(shot)}</span> &mdash; Take a manual screenshot any time.</li>
</ol>
<p>For guided walkthroughs (record + name + close in one panel), open the <strong>Operator panel</strong>.</p>
<div class="row">
  <button id="btn-operator" class="primary">Show me the operator panel</button>
  <button id="btn-help">Open Help</button>
  <button id="btn-close">I know what to do</button>
</div>
<div class="footer-hint">You can reopen this from the tray &rarr; Help submenu.</div>
<script>
  const { ipcRenderer } = require("electron");
  document.getElementById("btn-operator").addEventListener("click", () => {
    ipcRenderer.invoke("pdt:welcomeAction", "operator");
  });
  document.getElementById("btn-help").addEventListener("click", () => {
    ipcRenderer.invoke("pdt:welcomeAction", "help");
  });
  document.getElementById("btn-close").addEventListener("click", () => {
    window.close();
  });
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;" }[c]));
  }
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = {
  showWelcomeWindow,
  shouldShowOnLaunch,
  markShown,
};
