/*
 * Unit tests for the viewer theme module (theme.js).
 *
 * Covers the pure logic: theme state, the light<->dark flip, the
 * onChange bus, and the palette accessors. `localStorage` and
 * `document` are stubbed so the persistence and data-theme paths run
 * under the DOM-less `node:test` runner.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/* ---- stub the browser globals theme.js touches ------------------- *
 * Set BEFORE require()-ing theme.js: the module reads localStorage and
 * sets the data-theme attribute at load time. */
const _ls = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
let _attr = null;
global.document = {
  documentElement: {
    setAttribute: (k, v) => { if (k === "data-theme") _attr = v; },
    removeAttribute: (k) => { if (k === "data-theme") _attr = null; },
  },
};

const Theme = require("./theme.js");

/* ---- theme state + flip ------------------------------------------ */

test("default theme is light when nothing is stored", () => {
  assert.equal(Theme.getTheme(), "light");
});

test("setTheme('dark') flips state, the attribute, and persistence", () => {
  Theme.setTheme("dark");
  assert.equal(Theme.getTheme(), "dark");
  assert.equal(_attr, "dark");
  assert.equal(_ls["pdt.theme"], "dark");
});

test("setTheme('light') clears the data-theme attribute", () => {
  Theme.setTheme("dark");
  Theme.setTheme("light");
  assert.equal(Theme.getTheme(), "light");
  assert.equal(_attr, null);
  assert.equal(_ls["pdt.theme"], "light");
});

test("toggleTheme flips between the two themes", () => {
  Theme.setTheme("light");
  Theme.toggleTheme();
  assert.equal(Theme.getTheme(), "dark");
  Theme.toggleTheme();
  assert.equal(Theme.getTheme(), "light");
});

test("an unknown theme name is coerced to light", () => {
  Theme.setTheme("dark");
  Theme.setTheme("chartreuse");
  assert.equal(Theme.getTheme(), "light");
});

/* ---- onChange bus ------------------------------------------------ */

test("onChange fires on a real theme change with the new name", () => {
  Theme.setTheme("light");
  let seen = null;
  const off = Theme.onChange((name) => { seen = name; });
  Theme.setTheme("dark");
  assert.equal(seen, "dark");
  off();
});

test("onChange does not fire when the theme does not actually change", () => {
  Theme.setTheme("dark");
  let n = 0;
  const off = Theme.onChange(() => { n++; });
  Theme.setTheme("dark"); // no-op: already dark
  assert.equal(n, 0);
  off();
});

test("the onChange unsubscribe stops further callbacks", () => {
  Theme.setTheme("light");
  let n = 0;
  const off = Theme.onChange(() => { n++; });
  Theme.toggleTheme();
  off();
  Theme.toggleTheme();
  assert.equal(n, 1);
});

test("a throwing onChange subscriber does not block the others", () => {
  Theme.setTheme("light");
  let n = 0;
  const offBad = Theme.onChange(() => { throw new Error("boom"); });
  const offGood = Theme.onChange(() => { n++; });
  assert.doesNotThrow(() => Theme.toggleTheme());
  assert.equal(n, 1);
  offBad();
  offGood();
});

/* ---- palette accessors ------------------------------------------- */

test("the app palettes differ between the two themes", () => {
  Theme.setTheme("light");
  const lightFallback = Theme.appColors().fallback;
  Theme.setTheme("dark");
  assert.notEqual(lightFallback, Theme.appColors().fallback);
});

test("appColors returns the expected { map, palette, fallback } shape", () => {
  Theme.setTheme("dark");
  const c = Theme.appColors();
  assert.ok(c.map && typeof c.map === "object");
  assert.ok(Array.isArray(c.palette) && c.palette.length > 0);
  assert.equal(typeof c.fallback, "string");
});

test("dfgStyleTokens carry the mirrored keys and differ between themes", () => {
  Theme.setTheme("light");
  const lt = Theme.dfgStyleTokens();
  Theme.setTheme("dark");
  const dt = Theme.dfgStyleTokens();
  for (const k of ["fg", "fg2", "fg3", "bg", "bg2", "rule", "accent", "accent3", "bad"]) {
    assert.equal(typeof lt[k], "string");
    assert.equal(typeof dt[k], "string");
  }
  assert.notEqual(lt.bg, dt.bg);
  assert.notEqual(lt.accent, dt.accent);
});
