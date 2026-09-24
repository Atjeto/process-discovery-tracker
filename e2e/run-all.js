"use strict";
/*
 * run-all.js: the e2e runner (`npm test` here, the CI e2e job).
 *
 * Runs every smoke one after another, each even when an earlier one failed,
 * with its output passed through as it comes. At the end it prints one
 * summary line per smoke and one total line:
 *
 *   [run-all] PASS session-smoke.js   42/42 checks   51s  exit 0
 *   [run-all] FAIL overview-smoke.js  22/23 checks   30s  exit 1
 *   [run-all] 4 smokes: 3 passed, 1 failed
 *
 * The checks column is the smoke's own "N/M checks passed" line ("no count"
 * when it printed none, for example after a crash). The exit code is 0 only
 * when every smoke exited 0. PDT_E2E_WINDOW and the rest of the environment
 * reach every smoke unchanged.
 */

const { spawn } = require("child_process");
const path = require("path");

const SMOKES = ["session-smoke.js", "overview-smoke.js", "runs-smoke.js", "map-slim-smoke.js", "transcript-smoke.js", "panel-smoke.js"];

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    let tail = "";
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: __dirname, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (chunk) => { tail = (tail + chunk.toString("utf8")).slice(-20000); };
    child.stdout.on("data", (c) => { process.stdout.write(c); keep(c); });
    child.stderr.on("data", (c) => { process.stderr.write(c); keep(c); });
    const done = (code, signal) => {
      const counts = [...tail.matchAll(/(\d+)\/(\d+) checks passed, (\d+) failed/g)].pop();
      resolve({
        file, code: code == null ? null : code, signal: signal || null,
        secs: Math.round((Date.now() - started) / 1000),
        checks: counts ? counts[1] + "/" + counts[2] + " checks" : "no count",
      });
    };
    child.on("error", (e) => { tail += "\n" + e.message; done(null, null); });
    child.on("close", done);
  });
}

(async () => {
  const results = [];
  for (const file of SMOKES) {
    console.log("\n[run-all] ===== " + file + " =====");
    results.push(await runOne(file));
  }
  const width = Math.max(...SMOKES.map((f) => f.length));
  console.log("");
  for (const r of results) {
    const ok = r.code === 0;
    console.log("[run-all] " + (ok ? "PASS" : "FAIL") + " " + r.file.padEnd(width) + "  " +
      r.checks.padEnd(13) + " " + String(r.secs).padStart(4) + "s  " +
      (r.signal ? "signal " + r.signal : "exit " + r.code));
  }
  const failed = results.filter((r) => r.code !== 0).length;
  console.log("[run-all] " + results.length + " smokes: " + (results.length - failed) + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("[run-all] runner crash:", e && e.stack ? e.stack : e); process.exit(2); });
