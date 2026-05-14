#!/usr/bin/env node
/*
 * Wrapper around @electron/packager. See viewer/build-package.js for
 * the long explanation -- short version: cmd.exe was eating the `^`
 * anchors in our --ignore regexes via `npm run`, which silently
 * stripped node_modules/<pkg>/dist/ folders from the bundled asar and
 * broke obs-websocket-js (missing msgpack.cjs) and any other dep that
 * keeps its compiled output in dist/.
 */

"use strict";

const path = require("node:path");
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
  /^[\\/]node_modules[\\/]electron([\\/]|$)/,
  /^[\\/]node_modules[\\/]electron-builder/,
  /^[\\/]node_modules[\\/]@electron[\\/]packager/,
  /^[\\/]node_modules[\\/][^\\/]+[\\/]test([\\/]|$)/,
];

(async () => {
  const out = await packager({
    dir: PROJECT_DIR,
    name: "Process Discovery Tracker",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    out: OUT_DIR,
    prune: false,
    ignore: (filePath) => IGNORE.some(re => re.test(filePath)),
    extraResource: [
      path.join(PROJECT_DIR, "tray-icon.png"),
      path.join(PROJECT_DIR, "recorder", "publish"),
    ],
  });
  console.log("Wrote new app to:", out.join(", "));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
