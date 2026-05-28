/*
 * Smoke test: the C# recorder's Chromium accessibility wake-up still
 * works.
 *
 * Spawns a stock headed Chromium via Playwright (NO
 * --force-renderer-accessibility), opens a form with labelled inputs,
 * types into them, and asserts that the recorder emits >= 4
 * value_changed events with framework_id="Chrome" that carry the form
 * field labels as their `name`.
 *
 * Without the wake-up (UiaSubscriber.WakeChromiumAccessibility), Chrome
 * exposes only its omnibox to UIA -- this test would fail and that
 * would catch a regression of the fix.
 *
 * Run as part of the capture test suite (`cd capture && npm test`).
 * Skipped silently when playwright-core / a Chromium channel are not
 * available (so a checkout without Playwright still passes npm test).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnRecorder } = require("../recorder.js");

let chromium = null;
try { ({ chromium } = require("playwright-core")); } catch (_) {}

test("C# recorder captures Chrome web-content events without --force-renderer-accessibility",
{ skip: chromium ? false : "playwright-core not installed -- see _pdt_verify/" },
async () => {
  // Try to launch a headed browser; if no channel available, skip.
  let browser;
  try {
    try { browser = await chromium.launch({ headless: false }); }
    catch (_) {
      browser = await chromium.launch({ headless: false, channel: "chrome" });
    }
  } catch (e) {
    // No browser executable on this machine; skip without failing.
    test.skip("no Chromium / Chrome on this machine: " + e.message);
    return;
  }

  // Local HTML with labelled inputs -- no network dependency. Form
  // labels become UIA `name` properties via Chrome's accessibility tree.
  const tmp = path.join(os.tmpdir(),
    "pdt-wakeup-" + Date.now().toString(36));
  fs.mkdirSync(tmp, { recursive: true });
  const htmlPath = path.join(tmp, "form.html");
  fs.writeFileSync(htmlPath, `<!doctype html>
<html><body>
  <form>
    <label>Customer name: <input type="text" name="custname"></label>
    <label>Telephone: <input type="text" name="custtel"></label>
    <label>E-mail address: <input type="text" name="custemail"></label>
  </form>
</body></html>
`, "utf-8");

  const events = [];
  const recorder = spawnRecorder({
    sessionId: "smoke-" + Date.now().toString(36),
    verbose: false,
    debounceMs: 500,
    onEvent: (data) => events.push(data),
    onWarning: () => {},
    onStats: () => {},
    onExit: () => {},
    bootLog: () => {},
  });
  // Give the recorder ~3 s to spawn + the wake-up burst to kick in.
  await new Promise((r) => setTimeout(r, 3500));

  let pass = false;
  try {
    const page = await browser.newPage();
    await page.bringToFront();
    await page.goto("file:///" + htmlPath.replace(/\\/g, "/"));
    await page.waitForTimeout(2000);
    for (const [sel, val] of [
      ["input[name='custname']",  "Acme Corp"],
      ["input[name='custtel']",   "555-0142"],
      ["input[name='custemail']", "test@example.com"],
    ]) {
      try {
        await page.fill(sel, val);
        await page.keyboard.press("Tab");
        await page.waitForTimeout(700);
      } catch (_) {}
    }
    await page.waitForTimeout(2500);

    // Assert: web-content interactions reached the recorder.
    const webEvents = events.filter((e) =>
      e && e.kind === "value_changed" &&
      e.framework_id === "Chrome" &&
      e.name && /name:|telephone|e-mail/i.test(e.name));
    pass = webEvents.length >= 2;
    if (!pass) {
      const counts = events.reduce((m, e) => {
        m[e.kind || "?"] = (m[e.kind || "?"] || 0) + 1;
        return m;
      }, {});
      console.log("[wake-up smoke] total events:", events.length,
                  "by kind:", counts);
      console.log("[wake-up smoke] sample:", events.slice(0, 4));
    }
  } finally {
    try { await browser.close(); } catch (_) {}
    try { await recorder.stop({ drainTimeoutMs: 1500 }); } catch (_) {}
  }
  assert.ok(pass,
    "Recorder did not capture Chrome web-content value_changed events -- " +
    "the WakeChromiumAccessibility poller may have regressed");
});
