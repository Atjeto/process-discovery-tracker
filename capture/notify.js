"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Notification, nativeImage } = require("electron");
const { bootLog } = require("./boot-log.js");

/*
 * The 16px tray icon, resolved from the packaged resources directory or
 * the source tree. Returns an empty image when neither path exists.
 */
function trayIconImage() {
  const candidates = [
    path.join(process.resourcesPath || "", "tray-icon.png"),
    path.join(__dirname, "tray-icon.png"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      const img = nativeImage.createFromPath(c);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

/*
 * Warning-state variant of the tray icon (lab-phase §E2): the base icon
 * with an amber disc badged into the bottom-right corner, composed from
 * the raw bitmap so no second PNG asset has to ship. Falls back to the
 * plain icon when the bitmap is unavailable (empty icon, odd DPI).
 * Cached -- the composition runs once.
 */
let _warningImage = null;
function trayWarningImage() {
  if (_warningImage) return _warningImage;
  const base = trayIconImage();
  try {
    const size = base.getSize();
    if (!size.width || !size.height) return base;
    const buf = base.toBitmap(); // raw BGRA, scale factor 1
    if (!buf || buf.length < size.width * size.height * 4) return base;
    const r = Math.max(3, Math.floor(Math.min(size.width, size.height) * 0.3));
    const cx = size.width - r - 1;
    const cy = size.height - r - 1;
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = (y * size.width + x) * 4;
        buf[i] = 16;       // B
        buf[i + 1] = 150;  // G
        buf[i + 2] = 230;  // R  -> amber #E69610
        buf[i + 3] = 255;  // A
      }
    }
    _warningImage = nativeImage.createFromBitmap(buf, { width: size.width, height: size.height });
    return _warningImage;
  } catch (e) {
    bootLog(`trayWarningImage failed: ${e && e.message}`);
    return base;
  }
}

/*
 * Native OS toast for failure modes the user otherwise wouldn't notice
 * (recorder dead, OBS dropped, screenshots failing). Routes through the
 * OS notification surface so it pierces attention without a modal.
 * No-ops gracefully when notifications aren't supported.
 */
function notifyUser(title, body, options) {
  options = options || {};
  try {
    if (!Notification.isSupported || !Notification.isSupported()) return;
    const n = new Notification({
      title,
      body,
      silent: !!options.silent,
      urgency: options.urgency || "normal",
      icon: trayIconImage(),
    });
    if (options.onClick) n.on("click", options.onClick);
    n.show();
    bootLog(`notify: ${title} -- ${body}`);
  } catch (e) {
    bootLog(`notify failed: ${e && e.message}`);
  }
}

module.exports = { notifyUser, trayIconImage, trayWarningImage };
