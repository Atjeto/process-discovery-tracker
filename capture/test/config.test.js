"use strict";
// C1 — unit tests for config.js (defaults, deep merge, load/snapshot).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DEFAULTS, loadConfig, writeConfigSnapshot, deepMerge, validateConfig } = require("../config.js");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("deepMerge: an empty override yields a deep-equal copy of base", () => {
  const merged = deepMerge(DEFAULTS, {});
  assert.deepStrictEqual(merged, DEFAULTS);
  assert.notStrictEqual(merged, DEFAULTS);
});

test("deepMerge: nested objects merge, sibling keys are preserved", () => {
  const merged = deepMerge(DEFAULTS, { obs: { required: true } });
  assert.strictEqual(merged.obs.required, true);
  assert.strictEqual(merged.obs.websocket_url, DEFAULTS.obs.websocket_url);
});

test("deepMerge: arrays are replaced wholesale, not merged", () => {
  const merged = deepMerge(DEFAULTS, { process_labels: ["a", "b"] });
  assert.deepStrictEqual(merged.process_labels, ["a", "b"]);
});

test("deepMerge: a null override returns base unchanged", () => {
  assert.strictEqual(deepMerge(DEFAULTS, null), DEFAULTS);
});

test("deepMerge: scalar overrides replace the base value", () => {
  assert.strictEqual(deepMerge(DEFAULTS, { poll_interval_seconds: 10 }).poll_interval_seconds, 10);
});

test("loadConfig: no path returns defaults with a null sourcePath", () => {
  const { config, sourcePath } = loadConfig(null);
  assert.strictEqual(sourcePath, null);
  assert.strictEqual(config.auto_end_idle_minutes, DEFAULTS.auto_end_idle_minutes);
});

test("loadConfig: a non-existent path returns defaults", () => {
  const { config } = loadConfig(path.join(os.tmpdir(), `missing-${Date.now()}.yaml`));
  assert.strictEqual(config.poll_interval_seconds, DEFAULTS.poll_interval_seconds);
});

test("loadConfig: a partial YAML file merges over the defaults", () => {
  const dir = tmpDir("pdt-cfg-");
  const file = path.join(dir, "c.yaml");
  fs.writeFileSync(file, "poll_interval_seconds: 9\nobs:\n  required: true\n");
  const { config, sourcePath } = loadConfig(file);
  assert.strictEqual(config.poll_interval_seconds, 9);
  assert.strictEqual(config.obs.required, true);
  assert.strictEqual(config.obs.websocket_url, DEFAULTS.obs.websocket_url);
  assert.strictEqual(sourcePath, path.resolve(file));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeConfigSnapshot: writes config.yaml that reloads to the same values", () => {
  const dir = tmpDir("pdt-snap-");
  const out = writeConfigSnapshot(dir, DEFAULTS);
  assert.strictEqual(out, path.join(dir, "config.yaml"));
  assert.ok(fs.existsSync(out));
  assert.strictEqual(loadConfig(out).config.poll_interval_seconds, DEFAULTS.poll_interval_seconds);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: always supplies the keys main.js consumes without a fallback", () => {
  // C3 — main.js reads these directly; deepMerge over DEFAULTS must guarantee them.
  const { config } = loadConfig(null);
  assert.strictEqual(typeof config.idle_threshold_seconds, "number");
  assert.strictEqual(typeof config.auto_end_idle_minutes, "number");
  assert.strictEqual(typeof config.screenshots.on_idle_resume_minutes, "number");
  assert.strictEqual(typeof config.screenshots.display, "string");
  assert.strictEqual(typeof config.interactions.max_restarts_per_session, "number");
});

test("interactions.debounce_ms defaults to 750 (E4)", () => {
  const { config } = loadConfig(null);
  assert.strictEqual(config.interactions.debounce_ms, 750);
});

test("a config can override interactions.debounce_ms without losing siblings (E4)", () => {
  const merged = deepMerge(DEFAULTS, { interactions: { debounce_ms: 1200 } });
  assert.strictEqual(merged.interactions.debounce_ms, 1200);
  assert.strictEqual(merged.interactions.enabled, DEFAULTS.interactions.enabled);
});

test("auto_end_on_idle defaults to true (G1)", () => {
  const { config } = loadConfig(null);
  assert.strictEqual(config.auto_end_on_idle, true);
});

test("validateConfig does not flag the default project code: no toast at every start (B2)", () => {
  assert.deepStrictEqual(validateConfig({ engagement_id: "default" }, os.tmpdir()), []);
  assert.deepStrictEqual(validateConfig({}, os.tmpdir()), []);
});

test("validateConfig passes a configured engagement and a writable folder (B2)", () => {
  const dir = tmpDir("pdt-vc-");
  assert.deepStrictEqual(validateConfig({ engagement_id: "ACME-2026" }, dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("validateConfig flags a missing / unwritable session folder (B2)", () => {
  const problems = validateConfig(
    { engagement_id: "ACME-2026" },
    path.join(os.tmpdir(), `pdt-nonexistent-${Date.now()}`));
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /cannot be written to/);
});
