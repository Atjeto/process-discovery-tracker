#!/usr/bin/env node
/*
 * Wrapper around @electron/packager. See viewer/build-package.js for
 * the full rationale -- summary:
 *
 *  - Programmatic call avoids cmd.exe eating `^` anchors in ignores.
 *  - Computes the production-dep whitelist via
 *    `npm ls --omit=dev --all --parseable` and ignores every other
 *    node_modules subtree, so the asar carries only runtime deps
 *    without us having to delete anything on disk.
 *  - Strips non-en-US Chromium locale .pak files.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");
const { packager } = require("@electron/packager");

const PROJECT_DIR = __dirname;
const OUT_DIR = path.join(PROJECT_DIR, "dist");

const IGNORE = [
  /^[\\/]dist$/,
  /^[\\/]dist[\\/]/,
  /^[\\/]dist-electron$/,
  /^[\\/]dist-electron[\\/]/,
  /^[\\/]recorder[\\/]bin([\\/]|$)/,
  /^[\\/]recorder[\\/]obj([\\/]|$)/,
  /^[\\/]recorder[\\/]publish([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]test([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]tests([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]docs?([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]example(s)?([\\/]|$)/,
  /\.map$/,
];

const KEEP_LOCALES = new Set(["en-US.pak"]);

function getProdDepDirs() {
  const raw = execSync("npm ls --omit=dev --all --parseable", {
    cwd: PROJECT_DIR,
    maxBuffer: 32 * 1024 * 1024,
  }).toString();
  const projectPrefix = PROJECT_DIR.toLowerCase().replace(/\\/g, "/");
  const set = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const norm = line.toLowerCase().replace(/\\/g, "/");
    if (!norm.startsWith(projectPrefix)) continue;
    let rel = norm.slice(projectPrefix.length);
    if (!rel.startsWith("/")) rel = "/" + rel;
    if (rel.includes("/node_modules/")) set.add(rel);
  }
  return set;
}

function buildIgnore(prodDepDirs) {
  const NM_PREFIX = /^([\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/;
  return function ignore(filePath) {
    const norm = filePath.toLowerCase().replace(/\\/g, "/");
    const m = norm.match(NM_PREFIX);
    if (m) {
      const pkgPath = m[1].toLowerCase().replace(/\\/g, "/");
      if (!prodDepDirs.has(pkgPath)) return true;
    }
    return IGNORE.some((re) => re.test(filePath));
  };
}

function stripLocales(appDir) {
  const localesDir = path.join(appDir, "locales");
  if (!fs.existsSync(localesDir)) return null;
  let dropped = 0;
  let droppedBytes = 0;
  for (const f of fs.readdirSync(localesDir)) {
    if (KEEP_LOCALES.has(f)) continue;
    const p = path.join(localesDir, f);
    droppedBytes += fs.statSync(p).size;
    fs.unlinkSync(p);
    dropped++;
  }
  return { dropped, mb: (droppedBytes / (1024 * 1024)).toFixed(1) };
}

(async () => {
  console.log("[1/3] Enumerating production deps via `npm ls --omit=dev`...");
  const prodDeps = getProdDepDirs();
  console.log(`    ${prodDeps.size} prod-dep package(s) in tree`);

  console.log("[2/3] Running electron-packager (devDep trees will be ignored)...");
  const out = await packager({
    dir: PROJECT_DIR,
    name: "Process Discovery Tracker",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    out: OUT_DIR,
    prune: false,
    ignore: buildIgnore(prodDeps),
    /* shared/tracker-icon.ico ships multi-resolution PNG-compressed
       entries at 16/32/48/64/128/256. Setting it via `icon:` makes
       electron-packager embed it into Process Discovery Tracker.exe
       so taskbar / alt-tab / start menu / window chrome all show the
       brand square rather than the default Electron diamond. The tray
       still loads tray-icon.png at runtime (also brand-derived). */
    icon: path.join(PROJECT_DIR, "..", "shared", "tracker-icon.ico"),
    extraResource: [
      path.join(PROJECT_DIR, "tray-icon.png"),
      path.join(PROJECT_DIR, "recorder", "publish"),
    ],
  });

  console.log("[3/3] Stripping unused Chromium locales...");
  for (const appDir of out) {
    const r = stripLocales(appDir);
    if (r) console.log(`    ${appDir}: dropped ${r.dropped} locale(s), -${r.mb} MB`);
  }

  console.log("Wrote new app to:", out.join(", "));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
