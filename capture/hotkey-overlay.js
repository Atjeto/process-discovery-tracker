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
  /* Markup lives in ui/hotkey-overlay.html; the three {{HK_*}} tokens
     carry the (escaped) current hotkey bindings. */
  return fs
    .readFileSync(path.join(__dirname, "ui", "hotkey-overlay.html"), "utf-8")
    .split("{{HK_START}}").join(escapeHtml(start))
    .split("{{HK_END}}").join(escapeHtml(end))
    .split("{{HK_SHOT}}").join(escapeHtml(shot));
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
  buildHtml,
};
