/*
 * Minimal logging helper for capture-side code. Two surfaces:
 *
 *   const { createSessionLogger, appLogger } = require("./log.js");
 *
 *   const log = createSessionLogger(sessionFolder);   // per-session file
 *   log.info("session started");
 *   log.warn("OBS overlay create failed", err);
 *
 *   appLogger.info("...");                            // before a session exists
 *
 * Session logs land at `<sessionFolder>/capture.log`. App-scope logs land in
 * the Electron userData dir at `app.log`. Both are append-only plaintext
 * with ISO timestamps. Levels: info / warn / error. No rotation in v1; the
 * file grows linearly with session duration (megabyte-scale for an 8-hour
 * shift, which is fine).
 *
 * The existing `bootLog` in main.js handles uncaughtException/unhandledRejection
 * paths and is gated on PDT_DEBUG; this helper is always on and meant for
 * post-hoc diagnostics of normal operation (OBS handshake, overlay create,
 * etc.).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function _fmt(level, msg, extra) {
  const ts = new Date().toISOString();
  let line = `${ts} ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) {
    if (extra instanceof Error) {
      line += " | " + (extra.stack || extra.message || String(extra));
    } else {
      try { line += " | " + JSON.stringify(extra); }
      catch (_) { line += " | " + String(extra); }
    }
  }
  return line + "\n";
}

function _append(file, line) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, line);
  } catch (_) { /* best-effort */ }
}

function _mkLogger(file) {
  return {
    info:  (msg, extra) => _append(file, _fmt("info",  msg, extra)),
    warn:  (msg, extra) => _append(file, _fmt("warn",  msg, extra)),
    error: (msg, extra) => _append(file, _fmt("error", msg, extra)),
    file,
  };
}

function createSessionLogger(sessionFolder) {
  return _mkLogger(path.join(sessionFolder, "capture.log"));
}

let _appLogger = null;
function appLogger() {
  if (_appLogger) return _appLogger;
  let dir;
  try {
    const { app } = require("electron");
    dir = app.getPath("userData");
  } catch (_) {
    dir = path.join(process.cwd(), ".pdt-logs");
  }
  _appLogger = _mkLogger(path.join(dir, "app.log"));
  return _appLogger;
}

module.exports = { createSessionLogger, appLogger };
