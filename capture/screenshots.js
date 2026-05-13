/*
 * Event-triggered screenshots (§3.4).
 *
 * Uses screenshot-desktop to grab a full-screen PNG, then Electron's
 * nativeImage to JPEG-encode at configurable quality. Stored under
 * <sessionFolder>/screenshots/<timestamp>.jpg.
 *
 * Triggers (wired in main.js): app switch, marker fire, idle resume
 * after long idle, manual hotkey.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");

let screenshotLib = null;
function getScreenshot() {
  if (!screenshotLib) screenshotLib = require("screenshot-desktop");
  return screenshotLib;
}

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
  const screenshot = getScreenshot();
  let pngBuffer;
  try {
    pngBuffer = await screenshot({ format: "png" });
  } catch (_e) {
    return null;
  }
  const img = nativeImage.createFromBuffer(pngBuffer);
  if (img.isEmpty()) return null;
  const jpeg = img.toJPEG(quality || 60);
  const filename = timestampFilename();
  const outPath = path.join(screenshotsFolder, filename);
  fs.writeFileSync(outPath, jpeg);
  /* Return path relative to session folder, forward-slash normalized
     so it works on every OS the viewer might run on. */
  return `screenshots/${filename}`;
}

module.exports = { captureScreenshot };
