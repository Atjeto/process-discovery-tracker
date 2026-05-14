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
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { desktopCapturer, screen, nativeImage } = require("electron");

function timestampFilename() {
  const d = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-` +
    `${pad(d.getMilliseconds(), 3)}.jpg`
  );
}

async function captureScreenshot({ screenshotsFolder, quality }) {
  fs.mkdirSync(screenshotsFolder, { recursive: true });

  /* Get the primary display dimensions so the capture is at native
     resolution, not the default low-res thumbnail. scaleFactor handles
     high-DPI displays. */
  const primary = screen.getPrimaryDisplay();
  const w = Math.round(primary.size.width * (primary.scaleFactor || 1));
  const h = Math.round(primary.size.height * (primary.scaleFactor || 1));

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: w, height: h },
    });
  } catch (_e) {
    return null;
  }
  if (!sources || !sources.length) return null;

  /* Multi-monitor: take the primary screen by display_id when
     available, otherwise fall back to the first source. */
  let source = sources.find(
    (s) => s.display_id && String(s.display_id) === String(primary.id)
  ) || sources[0];
  if (!source || !source.thumbnail) return null;

  const img = source.thumbnail;
  if (img.isEmpty()) return null;

  const jpegBuffer = img.toJPEG(quality || 60);
  const filename = timestampFilename();
  const outPath = path.join(screenshotsFolder, filename);
  fs.writeFileSync(outPath, jpegBuffer);

  /* Return path relative to session folder, forward-slash normalized
     so it works on every OS the viewer might run on. */
  return `screenshots/${filename}`;
}

module.exports = { captureScreenshot };
