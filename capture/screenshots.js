/*
 * Event-triggered screenshots (§3.4).
 *
 * Uses Electron's built-in desktopCapturer + nativeImage rather than a
 * bundled helper executable. Rationale: avoids third-party screen-
 * capture binaries that corporate AV heuristics sometimes flag as
 * potentially-unwanted-program (PUP) screen recorders. desktopCapturer
 * is a first-party Chromium API; the only binary involved is Electron
 * itself.
 *
 * Triggers (wired in main.js): app switch, marker fire, idle resume
 * after long idle, manual hotkey.
 *
 * Multi-monitor behaviour: the analyst's machine is single-monitor
 * by default, but workers often have 2+ displays (Salesforce on one,
 * Outlook on another). `display` config:
 *   "active"  -- (default) capture the display containing the
 *               currently-focused window. Falls back to primary if
 *               we can't resolve a window position.
 *   "primary" -- always capture the primary display (legacy behaviour).
 *   "all"     -- capture every connected display; the caller receives
 *               an array of relative paths and emits one screenshot
 *               system event per display.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { desktopCapturer, screen, nativeImage } = require("electron");

function timestampFilename(suffix) {
  const d = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  const stem =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-` +
    `${pad(d.getMilliseconds(), 3)}`;
  return suffix ? `${stem}_${suffix}.jpg` : `${stem}.jpg`;
}

/* Resolve which Electron Display to capture, given the mode + the
   foreground window's bounds (if known). The bounds come from
   active-win in tracker.js -- a {x, y, width, height} rect or null. */
function resolveTargetDisplays({ mode, foregroundBounds }) {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  if (mode === "all") return all;
  if (mode === "primary") return [primary];

  // "active" (default): screen.getDisplayNearestPoint() takes any
  // point and returns the display whose work area contains it. Use
  // the centre of the foreground window when we have bounds; fall
  // back to the cursor position; fall back to primary.
  if (foregroundBounds && Number.isFinite(foregroundBounds.x) && Number.isFinite(foregroundBounds.width)) {
    const cx = Math.round(foregroundBounds.x + foregroundBounds.width / 2);
    const cy = Math.round(foregroundBounds.y + foregroundBounds.height / 2);
    return [screen.getDisplayNearestPoint({ x: cx, y: cy })];
  }
  try {
    const cur = screen.getCursorScreenPoint();
    return [screen.getDisplayNearestPoint(cur)];
  } catch (_) {
    return [primary];
  }
}

/* D3: hide our OWN recorder windows during the grab so the always-on-top
   panel / status window don't occlude the worker's screen --
   the single-monitor case, where there is no other display to push them to.
   `windows` are this process's BrowserWindows (passed by the caller); the
   worker's apps are native OS windows, not BrowserWindows, so they are never
   touched. Opacity 0 (not hide) avoids focus/z-order churn. Returns a restore
   fn the caller MUST run in a finally, so a window can never get stuck
   invisible even if the capture throws. */
function _dimOwnWindows(windows) {
  const dimmed = [];
  for (const w of windows || []) {
    try {
      if (w && !w.isDestroyed() && w.isVisible() && w.getOpacity() > 0) {
        dimmed.push([w, w.getOpacity()]);
        w.setOpacity(0);
      }
    } catch (_) { /* window torn down mid-capture -- skip it */ }
  }
  return () => {
    for (const [w, prior] of dimmed) {
      try { if (!w.isDestroyed()) w.setOpacity(prior); } catch (_) { /* ignore */ }
    }
  };
}

async function captureScreenshot({ screenshotsFolder, quality, mode, foregroundBounds, occludingWindows }) {
  fs.mkdirSync(screenshotsFolder, { recursive: true });
  const targets = resolveTargetDisplays({
    mode: mode || "active",
    foregroundBounds: foregroundBounds || null,
  });
  if (!targets.length) return null;

  const restoreWindows = _dimOwnWindows(occludingWindows);
  try {
    // Sources from desktopCapturer aren't tied to scaleFactor; we ask
    // for the largest target's pixel dimensions and let the per-source
    // thumbnailSize match its native resolution. desktopCapturer.getSources
    // only takes a single thumbnailSize, so we make one request per
    // display and pick the thumbnail whose display_id matches.
    let sources;
    try {
      const w = Math.max(...targets.map(d => Math.round(d.size.width * (d.scaleFactor || 1))));
      const h = Math.max(...targets.map(d => Math.round(d.size.height * (d.scaleFactor || 1))));
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: w, height: h },
      });
    } catch (_e) {
      return null;
    }
    if (!sources || !sources.length) return null;

    const written = [];
    const multi = targets.length > 1;
    for (const display of targets) {
      let src = sources.find(s => s.display_id && String(s.display_id) === String(display.id))
        || (targets.length === 1 ? sources[0] : null);
      if (!src || !src.thumbnail || src.thumbnail.isEmpty()) continue;
      const jpegBuffer = src.thumbnail.toJPEG(quality || 60);
      const filename = timestampFilename(multi ? `d${display.id}` : null);
      const outPath = path.join(screenshotsFolder, filename);
      fs.writeFileSync(outPath, jpegBuffer);
      written.push(`screenshots/${filename}`);
    }
    if (!written.length) return null;
    return multi ? written : written[0];
  } finally {
    restoreWindows();
  }
}

module.exports = { captureScreenshot, timestampFilename, dimOwnWindows: _dimOwnWindows };
