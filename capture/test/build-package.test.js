"use strict";

/* The packager's filter keeps every production dependency, scoped ones
   included. It once dropped the scope folders ("node_modules/@mapbox")
   before judging the packages in them, so the packaged capture app shipped
   active-win without @mapbox/node-pre-gyp and never saw the foreground
   window (lane LF-SHOT, found on a live recording with the packaged app). */

const test = require("node:test");
const assert = require("node:assert");
const { buildIgnore } = require("../build-package.js");

const PROD = new Set([
  "/node_modules/active-win",
  "/node_modules/@mapbox/node-pre-gyp",
  "/node_modules/@msgpack/msgpack",
]);

test("a scope folder that holds a production dependency is kept, with that package", () => {
  const ignore = buildIgnore(PROD);
  assert.strictEqual(ignore("/node_modules/@mapbox"), false);
  assert.strictEqual(ignore("/node_modules/@mapbox/node-pre-gyp"), false);
  assert.strictEqual(ignore("/node_modules/@mapbox/node-pre-gyp/lib/node-pre-gyp.js"), false);
  assert.strictEqual(ignore("\\node_modules\\@msgpack\\msgpack\\dist\\index.js"), false);
  assert.strictEqual(ignore("/node_modules/active-win/lib/windows-binding.js"), false);
});

test("development trees are dropped, scoped or not", () => {
  const ignore = buildIgnore(PROD);
  assert.strictEqual(ignore("/node_modules/@electron"), true, "no production package in the scope");
  assert.strictEqual(ignore("/node_modules/@electron/packager/dist/index.js"), true);
  assert.strictEqual(ignore("/node_modules/@mapbox/other-tool/index.js"), true, "another package of a kept scope");
  assert.strictEqual(ignore("/node_modules/left-pad/index.js"), true);
});

test("the app's own files and the fixed patterns", () => {
  const ignore = buildIgnore(PROD);
  assert.strictEqual(ignore("/main.js"), false);
  assert.strictEqual(ignore("/dist/capture.zip"), true);
  assert.strictEqual(ignore("/recorder/publish/recorder.exe"), true, "the recorder ships as an extra resource");
  assert.strictEqual(ignore("/node_modules/active-win/test/fixture.js"), true);
});
