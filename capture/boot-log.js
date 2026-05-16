"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

/*
 * Diagnostic log, opt-in via the PDT_DEBUG=1 environment variable.
 * Appends ISO-stamped lines to <userData>/boot.log. Best-effort: a
 * logging failure is swallowed so it never propagates into a caller.
 */
const DEBUG = process.env.PDT_DEBUG === "1";

function bootLog(msg) {
  if (!DEBUG) return;
  try {
    const dir = app.getPath("userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "boot.log"),
      `${new Date().toISOString()} ${msg}\n`
    );
  } catch (_e) { /* best-effort */ }
}

module.exports = { bootLog, DEBUG };
