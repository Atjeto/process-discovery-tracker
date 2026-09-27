"use strict";

/*
 * The demo project (2.0.1): a finished order-to-cash project that ships with
 * the app, resources/demo in the package and demo/ in the dev tree. It shows
 * every part of the app on one recording: four orders in the Order Desk web
 * app and an Excel tracking sheet, with its video, transcript, flow,
 * sub-process, notes, attachments, document, As-Is and To-Be maps and a
 * hand-off. Open, Open the demo project copies it into Documents\PDT demo
 * (PDT_DEMO_DIR names another folder, for tests), a fresh copy each time
 * ("Order to cash", then "Order to cash (2)", ...), and the copy opens like
 * any project: the packaged one is never changed, and an earlier copy stays
 * in Recent projects.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEMO_NAME = "Order to cash";

/* The shipped demo project's folder, or null: the package's resources/demo,
   else the dev tree's demo/ (`appDir` is the viewer folder). */
function demoSource(resourcesPath, appDir) {
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "demo", DEMO_NAME) : null,
    appDir ? path.join(appDir, "..", "demo", DEMO_NAME) : null,
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(path.join(p, "manifest.json"))) || null;
}

/* A folder under `root` no copy uses yet: `name`, then "name (2)", ... */
function freshTarget(root, name) {
  let n = 1;
  let p = path.join(root, name);
  while (fs.existsSync(p)) {
    n += 1;
    p = path.join(root, name + " (" + n + ")");
  }
  return p;
}

/* Copies the demo project `src` into a fresh folder under `root`; returns
   the copy's folder. */
function copyDemo(src, root) {
  fs.mkdirSync(root, { recursive: true });
  const dst = freshTarget(root, path.basename(src));
  fs.cpSync(src, dst, { recursive: true });
  return dst;
}

module.exports = { DEMO_NAME, demoSource, freshTarget, copyDemo };
