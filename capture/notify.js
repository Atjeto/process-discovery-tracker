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

module.exports = { notifyUser, trayIconImage };
