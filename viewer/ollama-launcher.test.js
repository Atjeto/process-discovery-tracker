/*
 * ollama-launcher tests — PDT-1.0-SPEC §3.2, ADR-0028.
 *
 * Runs under node:test. Lightweight smoke + real round-trip when the
 * bundle is present at viewer/ollama/.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const launcher = require("./ollama-launcher.js");

const BUNDLE_DIR = path.join(__dirname, "ollama");
const HAS_BUNDLE = fs.existsSync(path.join(BUNDLE_DIR, "bin", "ollama.exe"));

test("isBundlePresent reflects on-disk state", () => {
  assert.equal(launcher.isBundlePresent(), HAS_BUNDLE);
});

test("readBundleInfo returns null when no bundle, dict when present", () => {
  const info = launcher.readBundleInfo();
  if (HAS_BUNDLE) {
    assert.ok(info, "should return bundle info when present");
    assert.ok(info.bundled_model, "bundled_model must be set in BUNDLE.json");
  } else {
    assert.equal(info, null);
  }
});

test("start returns null when no bundle (graceful)", { skip: HAS_BUNDLE }, async () => {
  const info = await launcher.start();
  assert.equal(info, null);
});

test("start/stop round-trips and responds to /api/tags", { skip: !HAS_BUNDLE, timeout: 60_000 }, async () => {
  const info = await launcher.start();
  assert.ok(info);
  assert.ok(info.url);
  assert.ok(info.url.startsWith("http://127.0.0.1:"));
  assert.equal(info.bundled, true);
  assert.equal(launcher.isRunning(), true);

  // Real API probe.
  const resp = await fetch(info.url + "/api/tags");
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.ok(Array.isArray(data.models));
  assert.ok(data.models.length > 0, "bundled model must be listed");

  // env vars exported so the embedded Python sees our endpoint.
  assert.equal(process.env.PDT_OLLAMA_URL, info.url);
  assert.equal(process.env.PDT_OLLAMA_MODEL, info.model);

  launcher.stop();
  // Give the process a moment to exit.
  await new Promise(r => setTimeout(r, 1000));
  assert.equal(launcher.isRunning(), false);
});
