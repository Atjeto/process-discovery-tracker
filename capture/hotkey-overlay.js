/*
 * Persistent hotkey overlay.
 *
 * A tiny always-on-top frameless window that sits in the
 * bottom-right corner showing the three primary hotkeys. Defeats the
 * "what was the shortcut again?" problem that costs an SME a tray
 * round-trip every marker.
 *
 * Toggled via tray menu. Persists position across sessions. Click-
 * through (the user can still click whatever's behind it).
 *
 * Persists on/off state in userData/hotkey-overlay.json so the
 * widget reappears across launches if the user wanted it visible.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { BrowserWindow, screen, app } = require("electron");

const STATE_FILE = "hotkey-overlay.json";

let overlayWindow = null;

function stateFile() {
  return path.join(app.getPath("userData"), STATE_FILE);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8"));
  } catch (_) {
    return { visible: false, x: null, y: null };
  }
}

function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  } catch (_) { /* best-effort */ }
}

function isVisible() {
  return overlayWindow && !overlayWindow.isDestroyed();
}

function placement() {
  /* Bottom-right of the primary display by default, with a small
     margin. Honour a saved position if we have one. */
  const saved = loadState();
  const primary = screen.getPrimaryDisplay();
  const W = 220, H = 110;
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x, y: saved.y, w: W, h: H };
  }
  const area = primary.workArea;
  return {
    x: area.x + area.width - W - 16,
    y: area.y + area.height - H - 16,
    w: W, h: H,
  };
}

function showOverlay(hotkeys) {
  if (isVisible()) {
    overlayWindow.show();
    overlayWindow.focus();
    return overlayWindow;
  }
  const p = placement();
  overlayWindow = new BrowserWindow({
    x: p.x, y: p.y, width: p.w, height: p.h,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,        // don't steal focus from whatever app is recording
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });  // click-through
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlayWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  overlayWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml(hotkeys || {})));
  overlayWindow.on("closed", () => { overlayWindow = null; });
  saveState({ ...loadState(), visible: true });
  return overlayWindow;
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
  saveState({ ...loadState(), visible: false });
}

function toggleOverlay(hotkeys) {
  if (isVisible()) {
    hideOverlay();
    return false;
  }
  showOverlay(hotkeys);
  return true;
}

function shouldRestoreOnLaunch() {
  return !!loadState().visible;
}

function buildHtml(hotkeys) {
  const start = hotkeys.start_picker || "Ctrl+Shift+S";
  const end = hotkeys.end_innermost || "Ctrl+Shift+E";
  const shot = hotkeys.manual_screenshot || "Ctrl+Shift+P";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDT Hotkeys</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 8px 10px;
         background: rgba(20, 20, 26, 0.85);
         backdrop-filter: blur(6px);
         color: #D8D6CE;
         font-family: "Segoe UI", system-ui, sans-serif;
         font-size: 11px; line-height: 1.4;
         border: 1px solid #424250;
         border-radius: 8px;
         user-select: none;
         -webkit-user-select: none;
         pointer-events: none; /* re-affirm click-through at the CSS layer */
  }
  .title { font-size: 9px; letter-spacing: 1px; color: #807E78;
           text-transform: uppercase; margin-bottom: 4px; }
  .row { display: flex; justify-content: space-between;
         align-items: center; padding: 3px 0; }
  .row .label { color: #A8A69E; font-size: 11px; }
  .kbd { font-family: "IBM Plex Mono", Consolas, monospace;
         font-size: 10px; padding: 1px 5px;
         background: rgba(46, 46, 55, 0.85);
         border: 1px solid #424250; border-radius: 3px;
         color: #D8D6CE; }
</style></head><body>
<div class="title">Hotkeys</div>
<div class="row"><span class="label">Start marker</span><span class="kbd">${escapeHtml(start)}</span></div>
<div class="row"><span class="label">End marker</span><span class="kbd">${escapeHtml(end)}</span></div>
<div class="row"><span class="label">Screenshot</span><span class="kbd">${escapeHtml(shot)}</span></div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = {
  showOverlay,
  hideOverlay,
  toggleOverlay,
  isVisible,
  shouldRestoreOnLaunch,
};
