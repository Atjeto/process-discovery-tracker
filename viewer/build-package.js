#!/usr/bin/env node
/*
 * Wrapper around @electron/packager.
 *
 * Why this exists instead of the upstream CLI:
 *
 * 1. cmd.exe ate the `^` anchors in --ignore regexes when invoked via
 *    `npm run`. Programmatic invocation keeps regex literals intact.
 *
 * 2. electron-packager's built-in --prune uses galactus and broke for
 *    us. We can't `npm prune --production` either, because that
 *    removes @electron/packager itself (which we're running). So we
 *    compute the prod-dep whitelist via `npm ls --omit=dev --all`
 *    and pass an ignore function that filters everything else out of
 *    node_modules. Result: asar carries only runtime deps without
 *    deleting anything on disk.
 *
 * 3. Chromium ships ~50 locale .pak files. We don't translate the
 *    UI, so we keep only en-US after packaging.
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
  /^[\\/]python$/,
  /^[\\/]python[\\/]/,
  /^[\\/]normalization$/,
  /^[\\/]normalization[\\/]/,
  /^[\\/]test-out([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]test([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]tests([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]docs?([\\/]|$)/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]example(s)?([\\/]|$)/,
  /\.map$/,
];

const KEEP_LOCALES = new Set(["en-US.pak"]);

function getProdDepDirs() {
  /* Returns a Set of node_modules paths (relative, lowercased,
     forward-slash) for every production dep -- direct + transitive.
     Anything in node_modules NOT in this set is a devDep tree and
     gets filtered out of the asar. */
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
  /* Match the start of every filePath. electron-packager passes a
     "/"-rooted path relative to the project. We extract the
     /node_modules/<pkg> prefix (or /node_modules/<scope>/<pkg> for
     scoped packages) and check it against the whitelist. */
  const NM_PREFIX = /^([\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/;
  return function ignore(filePath) {
    const norm = filePath.toLowerCase().replace(/\\/g, "/");
    const m = norm.match(NM_PREFIX);
    if (m) {
      // Build the candidate whitelist key. npm ls --parseable returns
      // package roots only -- no trailing slash, no file part.
      const pkgPath = m[1].toLowerCase().replace(/\\/g, "/");
      if (!prodDepDirs.has(pkgPath)) {
        return true; // devDep tree -- drop
      }
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
    name: "Process Discovery Viewer",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    out: OUT_DIR,
    prune: false,
    ignore: buildIgnore(prodDeps),
    /* Same brand-square .ico as capture: taskbar / alt-tab / window
       chrome / start menu show the muted-gradient square instead of
       the default Electron diamond. Multi-res at 16/32/48/64/128/256.
       Regenerate via scripts/generate-icons.ps1. */
    icon: path.join(PROJECT_DIR, "..", "shared", "tracker-icon.ico"),
    extraResource: [
      path.join(PROJECT_DIR, "python"),
      path.join(PROJECT_DIR, "..", "normalization"),
      /* Shared recognition table (ADR-0011): both recognition.js (in the
         asar) and normalization/recognition.py read shared/recognition-
         patterns.json. Shipping shared/ here keeps it a sibling of
         normalization/ under resources/, so `../shared` resolves in both the
         dev tree and the package. Without this the released app's recognition
         silently breaks while dev tests stay green. */
      path.join(PROJECT_DIR, "..", "shared"),
      /* The app's activity library (contract C21): library.js and the
         pipeline's --library read resources/library/activities.json, a
         sibling of normalization/ and shared/ as in the dev tree. */
      path.join(PROJECT_DIR, "..", "library"),
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
