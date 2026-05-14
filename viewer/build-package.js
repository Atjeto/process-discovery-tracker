#!/usr/bin/env node
/*
 * Wrapper around @electron/packager so the ignore regexes don't get
 * mangled by cmd.exe's `^`-as-escape-char behaviour. The previous
 * `electron-packager ... --ignore=^/dist$ ...` CLI invocation had
 * cmd.exe silently strip every leading `^`, turning the anchored
 * patterns into wildcard substring matches. That stripped
 * node_modules/bpmn-js/dist/, node_modules/cytoscape/dist/, etc.
 * from the bundled asar -- BPMN rendering silently broken in
 * packaged builds.
 *
 * Programmatic invocation receives JS values directly, so the
 * regexes survive unmolested.
 */

"use strict";

const path = require("node:path");
const { packager } = require("@electron/packager");

const PROJECT_DIR = __dirname;
const OUT_DIR = path.join(PROJECT_DIR, "dist");

// Anchored patterns -- only match at the project root, never inside
// node_modules/<pkg>/. RegExp literals so there is no shell to mangle.
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
  // Skip devDependencies we never want shipped (since --no-prune
  // keeps everything otherwise).
  /^[\\/]node_modules[\\/]electron([\\/]|$)/,
  /^[\\/]node_modules[\\/]electron-builder/,
  /^[\\/]node_modules[\\/]@electron[\\/]packager/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]test([\\/]|$)/,
];

(async () => {
  const out = await packager({
    dir: PROJECT_DIR,
    name: "Process Discovery Viewer",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    out: OUT_DIR,
    prune: false,
    ignore: (filePath) => IGNORE.some(re => re.test(filePath)),
    extraResource: [
      path.join(PROJECT_DIR, "python"),
      path.join(PROJECT_DIR, "..", "normalization"),
    ],
  });
  console.log("Wrote new app to:", out.join(", "));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
