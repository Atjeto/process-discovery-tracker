"use strict";

/*
 * Unit tests for the main-process screenshot-open path validation
 * (SEC Vuln 1: click-to-RCE via shell.openPath). The session folder is
 * UNTRUSTED input, so the viewer:openExternal sink must confine a
 * renderer-supplied path to the active session's screenshots/ directory
 * and require an image extension before handing it to the OS shell.
 *
 * These exercise the pure helper validateScreenshotOpen exported from
 * main.js. main.js is requireable under plain node because it shims the
 * Electron API when require("electron") returns a path string. Run with
 * `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { validateScreenshotOpen, validateDiagramOpen } = require("./main.js");

// A resolved, absolute session root the way loadSessionData tracks it.
const SESS = path.resolve("C:/work/sessions/atm-001");
const roots = new Set([SESS]);
const shot = (rel) => path.join(SESS, rel); // e.g. screenshots/x.png

test("accepts a real in-folder image (relative-form resolved)", () => {
  const r = validateScreenshotOpen(shot("screenshots/shot-001.png"), roots);
  assert.equal(r.ok, true);
  assert.equal(r.path, path.resolve(SESS, "screenshots", "shot-001.png"));
});

test("accepts each allowed image extension", () => {
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "PNG", "JpG"]) {
    const r = validateScreenshotOpen(shot("screenshots/a." + ext), roots);
    assert.equal(r.ok, true, "ext " + ext + " should be allowed");
  }
});

test("rejects a planted executable masquerading as an image (.png.exe)", () => {
  const r = validateScreenshotOpen(shot("screenshots/Invoice.png.exe"), roots);
  assert.equal(r.ok, false);
  assert.match(r.error, /allowed image type/i);
});

test("rejects non-image extensions (.exe, .bat, .lnk, .ps1, none)", () => {
  for (const rel of ["screenshots/x.exe", "screenshots/x.bat", "screenshots/x.lnk", "screenshots/x.ps1", "screenshots/x"]) {
    const r = validateScreenshotOpen(shot(rel), roots);
    assert.equal(r.ok, false, rel + " should be rejected");
  }
});

test("rejects a raw `..` traversal segment (pre-normalization)", () => {
  // A literal path string carrying `..` is rejected by the traversal
  // guard before any path math. (path.join in callers may collapse
  // these, but the sink must not rely on that.)
  const r = validateScreenshotOpen(SESS + "/screenshots/../../../Users/victim/evil.png", roots);
  assert.equal(r.ok, false);
  assert.match(r.error, /traversal/i);
});

test("rejects `..` that escapes the session even after normalization", () => {
  // path.join collapses the `..`, landing outside screenshots/; still rejected.
  const r = validateScreenshotOpen(shot("screenshots/../../Users/victim/evil.png"), roots);
  assert.equal(r.ok, false);
});

test("rejects an absolute path outside the session", () => {
  const r = validateScreenshotOpen("C:/Windows/System32/calc.png", roots);
  assert.equal(r.ok, false);
  assert.match(r.error, /outside the active session/i);
});

test("rejects a path under the session root but outside screenshots/", () => {
  const r = validateScreenshotOpen(path.join(SESS, "events.png"), roots);
  assert.equal(r.ok, false);
  assert.match(r.error, /outside the active session/i);
});

test("rejects when no session is loaded (empty roots)", () => {
  const r = validateScreenshotOpen(shot("screenshots/shot-001.png"), new Set());
  assert.equal(r.ok, false);
});

test("rejects non-string / empty input", () => {
  for (const bad of [null, undefined, 42, "", {}]) {
    const r = validateScreenshotOpen(bad, roots);
    assert.equal(r.ok, false, JSON.stringify(bad) + " should be rejected");
  }
});

test("confines to the correct root when multiple sessions are loaded", () => {
  const other = path.resolve("D:/other/session-9");
  const multi = new Set([SESS, other]);
  assert.equal(validateScreenshotOpen(path.join(other, "screenshots/a.png"), multi).ok, true);
  assert.equal(validateScreenshotOpen(path.join(SESS, "screenshots/a.png"), multi).ok, true);
  // A path under neither session's screenshots dir is still rejected.
  assert.equal(validateScreenshotOpen("E:/elsewhere/a.png", multi).ok, false);
});

/* --- validateDiagramOpen: the dedicated .bpmn sink (review HIGH #11) --- */

test("diagram: accepts process_map.bpmn at the session root", () => {
  const r = validateDiagramOpen(shot("process_map.bpmn"), roots);
  assert.equal(r.ok, true);
  assert.equal(r.path, path.resolve(SESS, "process_map.bpmn"));
});

test("diagram: accepts a per-case map under process_maps/", () => {
  assert.equal(validateDiagramOpen(shot("process_maps/case-CUST-1.bpmn"), roots).ok, true);
});

test("diagram: rejects non-.bpmn (.exe/.png/none) so the button can't launch a program", () => {
  for (const rel of ["process_map.exe", "process_map.png", "process_map", "a.bpmn.exe"]) {
    const r = validateDiagramOpen(shot(rel), roots);
    assert.equal(r.ok, false, rel + " should be rejected");
  }
});

test("diagram: rejects traversal and out-of-session paths", () => {
  assert.match(validateDiagramOpen(SESS + "/../../evil.bpmn", roots).error, /traversal/i);
  assert.match(validateDiagramOpen("C:/Windows/Temp/x.bpmn", roots).error, /outside the active session/i);
  assert.equal(validateDiagramOpen(shot("process_map.bpmn"), new Set()).ok, false);
  for (const bad of [null, undefined, 42, "", {}]) {
    assert.equal(validateDiagramOpen(bad, roots).ok, false);
  }
});
