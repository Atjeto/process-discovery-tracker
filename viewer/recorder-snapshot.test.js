"use strict";

/*
 * Unit tests for recorderExeCandidates (ADR-0025 discovery on a destination PC).
 * The packaged viewer ships WITHOUT the recorder (it lives in the capture app),
 * so a deployed viewer must find it in a SIBLING capture/ folder. These pin the
 * candidate ordering + the sibling probe so the "recorder.exe not found" failure
 * on a viewer-only/deployed machine can't silently come back. Run with `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { recorderExeCandidates } = require("./recorder-snapshot.js");

const SEP = path.sep;

test("PDT_RECORDER_PATH overrides and is probed first", () => {
  const c = recorderExeCandidates({
    env: { PDT_RECORDER_PATH: "X:/custom/recorder.exe" },
    dirname: path.join("repo", "viewer"),
    resourcesPath: null,
  });
  assert.equal(c[0], "X:/custom/recorder.exe");
});

test("dev tree probes the sibling capture/recorder/publish build", () => {
  const dirname = path.join(SEP + "repo", "viewer");
  const c = recorderExeCandidates({ env: {}, dirname, resourcesPath: null });
  // Candidate #2 is path.resolve(dirname, "..", "capture", ...) -- match it exactly.
  const want = path.resolve(dirname, "..", "capture", "recorder", "publish", "recorder.exe");
  assert.ok(c.includes(want), "dev candidate missing: " + JSON.stringify(c) + " want " + want);
});

test("packaged viewer finds a SIBLING capture dist (recommended deploy)", () => {
  // <deploy>/viewer/resources  +  <deploy>/capture/resources/publish/recorder.exe
  const deploy = SEP + "deploy";
  const c = recorderExeCandidates({
    env: {},
    dirname: path.join(deploy, "viewer"),
    resourcesPath: path.join(deploy, "viewer", "resources"),
    readdir: () => ["viewer", "capture", "release"],
  });
  const want = path.join(deploy, "capture", "resources", "publish", "recorder.exe");
  assert.ok(c.includes(want), "sibling capture candidate missing: " + JSON.stringify(c));
});

test("packaged viewer finds a RENAMED sibling app folder via the scan", () => {
  const deploy = SEP + "deploy";
  const c = recorderExeCandidates({
    env: {},
    dirname: path.join(deploy, "viewer"),
    resourcesPath: path.join(deploy, "viewer", "resources"),
    readdir: () => ["viewer", "Worker Capture"],
  });
  const want = path.join(deploy, "Worker Capture", "resources", "publish", "recorder.exe");
  assert.ok(c.includes(want), "renamed-sibling candidate missing: " + JSON.stringify(c));
});

test("candidate list is de-duped (sibling scan + explicit capture path don't double up)", () => {
  const deploy = SEP + "deploy";
  const c = recorderExeCandidates({
    env: {},
    dirname: path.join(deploy, "viewer"),
    resourcesPath: path.join(deploy, "viewer", "resources"),
    readdir: () => ["viewer", "capture"],   // self + the explicit capture overlap
  });
  assert.equal(c.length, new Set(c).size, "candidates must be unique: " + JSON.stringify(c));
});

test("a broken readdir does not throw (degrades to the explicit candidates)", () => {
  const deploy = SEP + "deploy";
  let c;
  assert.doesNotThrow(() => {
    c = recorderExeCandidates({
      env: {},
      dirname: path.join(deploy, "viewer"),
      resourcesPath: path.join(deploy, "viewer", "resources"),
      readdir: () => { throw new Error("EACCES"); },
    });
  });
  // The conventional capture/ path is still present without the scan.
  assert.ok(c.includes(path.join(deploy, "capture", "resources", "publish", "recorder.exe")));
});
