#!/usr/bin/env node
/*
 * Syntax-check every first-party .js file in viewer/ and capture/ via
 * `node --check` -- a fast parse gate that catches a file broken by a bad edit
 * before it ships (the viewer and capture apps are bundler-free,
 * so a parse error otherwise only surfaces at runtime in the renderer). Skips
 * node_modules and build output. Exits non-zero if any file fails to parse.
 *
 * Run: `node scripts/check-js-syntax.js` (cwd-independent). Wired into CI by
 * .github/workflows/js.yml.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIRS = ["viewer", "capture"];
const SKIP = new Set([
  "node_modules", "dist", "dist-electron", "test-out", "build",
  "publish", "bin", "obj", "python",
]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, files);
}

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    failed++;
    process.stderr.write("SYNTAX ERROR: " + path.relative(ROOT, f) + "\n");
    process.stderr.write((e.stderr ? e.stderr.toString() : String(e)) + "\n");
  }
}

console.log("node --check: " + (files.length - failed) + "/" + files.length + " files OK");
if (failed) {
  console.error(failed + " file(s) failed the syntax check");
  process.exit(1);
}
