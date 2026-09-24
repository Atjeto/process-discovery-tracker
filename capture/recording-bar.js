"use strict";

/*
 * recording-bar.js: the recording bar, the SME's one window while recording.
 * It replaces the 460x720 Live Session panel and the hotkey overlay.
 *
 * One small frameless strip, always on top: the state (Recording, Paused,
 * Not recording), the transaction in progress, the elapsed time, Next
 * transaction with its key, Pause or Resume, and Stop with an inline
 * confirm. A problem (clicks and typing not recorded) adds one line under
 * it. Nothing else: no
 * counters, no event feed, no program name or window title. The page
 * (ui/recording-bar.html) only paints the view model main.js sends with
 * pdt:status (capture-guidance.barModel).
 *
 * Made for recording during a Teams call:
 *   - it is small, can be dragged anywhere by its text, and remembers where
 *     it was put (userData/recording-bar.json); a position on a monitor that
 *     is gone falls back to the bottom right of the main screen;
 *   - it appears without taking the keyboard focus (showInactive), so the
 *     transaction key pressed in a program never moves the typing into the bar;
 *   - it asks Windows to leave it out of screen captures
 *     (setContentProtection), so a shared screen, the OBS video and the
 *     recording's own screenshots show the work, not the bar.
 *
 * Electron is required lazily, inside the window functions, so the pure
 * placement helpers load under plain node (test/recording-bar.test.js).
 */

const fs = require("node:fs");
const path = require("node:path");
const { jsonForScript } = require("./json-for-script.js");
const { injectTokens } = require("./ui/tokens.js");

/* Measured in the real renderer (AD-29 words): "Recording · between
   transactions · 1:02:05" beside Next transaction (with its key), Pause
   and Stop needs 615 px, 5 more are kept for font rendering; the
   named-transaction caret adds 29 (30 kept). */
const BAR_WIDTH = 620;
const NAMED_RUNS_EXTRA = 30; // the caret next to Next transaction, when named transactions are set up
const BAR_HEIGHT = 44;       // one row; a problem line makes it taller (fitHeight)
const BAR_MAX_HEIGHT = 200;
const MARGIN = 16;
const STATE_FILE = "recording-bar.json";

let bar = null;

/* Pure: where the bar opens. A saved position is kept when the bar's centre
   is on one of the screens (clamped so the whole bar shows); otherwise, or
   with nothing saved, the bottom right corner of the main screen's work
   area (above the taskbar), MARGIN pixels in. */
function placeBar({ saved, size, workAreas, primary, margin = MARGIN }) {
  const w = size.width;
  const h = size.height;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const cx = saved.x + w / 2;
    const cy = saved.y + h / 2;
    const area = (workAreas || []).find((a) =>
      cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height);
    if (area) return clampIntoArea({ x: saved.x, y: saved.y, width: w, height: h }, area);
  }
  return {
    x: primary.x + primary.width - w - margin,
    y: primary.y + primary.height - h - margin,
  };
}

/* Pure: the position that keeps `rect` inside `area` (used after the bar
   grows for a problem line near the bottom of the screen). */
function clampIntoArea(rect, area) {
  return {
    x: Math.max(area.x, Math.min(rect.x, area.x + area.width - rect.width)),
    y: Math.max(area.y, Math.min(rect.y, area.y + area.height - rect.height)),
  };
}

function stateFile() {
  return path.join(require("electron").app.getPath("userData"), STATE_FILE);
}

function loadPosition() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf-8"));
    return Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
  } catch (_) {
    return null;
  }
}

function savePosition(x, y) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ x, y }));
  } catch (_) { /* the position is a convenience; the bar works without it */ }
}

/* The page, with the first view model in its inline script (jsonForScript:
   a run name must never break out of the <script>). */
function buildBarHtml(initialView) {
  return injectTokens(fs
    .readFileSync(path.join(__dirname, "ui", "recording-bar.html"), "utf-8")
    .split("{{INITIAL_VIEW}}").join(jsonForScript(initialView || { state: "idle" })));
}

function isOpen() {
  return !!(bar && !bar.isDestroyed());
}

function getBar() {
  return isOpen() ? bar : null;
}

/* The bar's width: wide enough for "Recording · between transactions ·
   1:02:05" beside its buttons, plus the named-transaction caret when named
   transactions are set up. */
function barWidth(namedRuns) {
  return BAR_WIDTH + (namedRuns ? NAMED_RUNS_EXTRA : 0);
}

/* Open the bar (or show it again) without taking the focus. thickFrame is
   off: a frameless window that cannot be resized otherwise comes out 16 px
   narrower and 8 px lower than asked on Windows, and ignores setSize. */
function openBar(initialView, opts) {
  if (isOpen()) {
    if (!bar.isVisible()) bar.showInactive();
    return bar;
  }
  const { BrowserWindow, screen } = require("electron");
  const size = { width: barWidth(opts && opts.namedRuns), height: BAR_HEIGHT };
  const pos = placeBar({
    saved: loadPosition(),
    size,
    workAreas: screen.getAllDisplays().map((d) => d.workArea),
    primary: screen.getPrimaryDisplay().workArea,
  });
  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    title: "Recording bar",
    frame: false,
    thickFrame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#14141A",
    webPreferences: {
      /* Trusted first-party HTML loaded via a data: URL; the page's CSP
         restricts what the renderer can do. */
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  bar = win;
  // Above other always-on-top windows, so Stop is always reachable.
  win.setAlwaysOnTop(true, "screen-saver");
  try { win.setContentProtection(true); } catch (_) { /* capture exclusion is best effort */ }
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => { if (!win.isDestroyed()) win.showInactive(); });
  win.on("moved", () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    savePosition(x, y);
  });
  win.on("closed", () => { if (bar === win) bar = null; });
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildBarHtml(initialView)));
  return win;
}

function closeBar() {
  if (isOpen()) bar.close();
  bar = null;
}

/* The page reports its height (one row, or one row and a problem line);
   the window follows and stays on its screen. */
function fitHeight(height) {
  if (!isOpen()) return;
  const h = Math.max(BAR_HEIGHT, Math.min(Math.ceil(Number(height)) || BAR_HEIGHT, BAR_MAX_HEIGHT));
  const [width, current] = bar.getSize();
  if (current === h) return;
  bar.setSize(width, h);
  const { screen } = require("electron");
  const b = bar.getBounds();
  const p = clampIntoArea(b, screen.getDisplayMatching(b).workArea);
  if (p.x !== b.x || p.y !== b.y) bar.setPosition(p.x, p.y);
}

module.exports = {
  openBar,
  closeBar,
  isOpen,
  getBar,
  fitHeight,
  buildBarHtml,
  placeBar,
  clampIntoArea,
  barWidth,
  BAR_WIDTH,
  BAR_HEIGHT,
};
