"use strict";

/* The packager's filter keeps every production dependency, scoped ones
   included: it once dropped the scope folders, so the packaged viewer
   shipped without @dagrejs/dagre and @bpmn-io/diagram-js-ui (lane MW), and
   the packaged capture app without @mapbox/node-pre-gyp (lane LF-SHOT). */

const test = require("node:test");
const assert = require("node:assert");
const { buildIgnore } = require("./build-package.js");

const PROD = new Set([
  "/node_modules/cytoscape",
  "/node_modules/@dagrejs/dagre",
  "/node_modules/@dagrejs/graphlib",
  "/node_modules/@bpmn-io/diagram-js-ui",
]);

test("a scope folder that holds a production dependency is kept, with its packages", () => {
  const ignore = buildIgnore(PROD);
  assert.strictEqual(ignore("/node_modules/@dagrejs"), false);
  assert.strictEqual(ignore("/node_modules/@dagrejs/dagre/dist/dagre.js"), false);
  assert.strictEqual(ignore("\\node_modules\\@bpmn-io\\diagram-js-ui\\lib\\index.js"), false);
  assert.strictEqual(ignore("/node_modules/cytoscape/dist/cytoscape.cjs.js"), false);
});

test("development trees are dropped, scoped or not, and the Python and pipeline ship as resources", () => {
  const ignore = buildIgnore(PROD);
  assert.strictEqual(ignore("/node_modules/@electron"), true, "no production package in the scope");
  assert.strictEqual(ignore("/node_modules/@electron/packager/dist/index.js"), true);
  assert.strictEqual(ignore("/node_modules/@dagrejs/other/index.js"), true);
  assert.strictEqual(ignore("/node_modules/playwright-core/index.js"), true);
  assert.strictEqual(ignore("/python/python.exe"), true);
  assert.strictEqual(ignore("/normalization/normalize.py"), true);
  assert.strictEqual(ignore("/renderer.js"), false);
});
