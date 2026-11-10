"use strict";
/* Lane A-1: --fg-4 is a decoration colour, never the colour of a text.
 *
 * --fg-4 gives about 2.0:1 on a white card (2.1:1 in the dark theme), where a
 * text needs 4.5:1. It is kept for decorations: a separator, a caret, a large
 * placeholder glyph. This guard reads styles.css and fails on a
 * `color: var(--fg-4)` in any rule whose selectors are not all on the short
 * list below, each with the reason it is a decoration. A text that needs a
 * muted colour takes --fg-3 (--fg-2 on a fill); see
 * docs/architecture/DESIGN-SYSTEM.md, "Contrast".
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

/* selector -> why it may draw in --fg-4. */
const ALLOW = {
  ".nv-icon": "the 36 px placeholder glyph of the empty video pane, a picture, with its text beside it",
  ".crumb-sep": "the separator between the sub-process crumbs, a decoration between two named links",
  ".tr-more-chevron": "the caret of a disclosure, whose head says what it opens",
};

/* Every rule (innermost braces, so a rule inside @media is read too) with
   its selectors and its declarations, comments stripped. */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selectors: m[1].split(",").map((s) => s.trim()).filter(Boolean), body: m[2] });
  }
  return out;
}

function fg4TextRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const r of rules(clean)) {
    if (!/(^|[;\s])color\s*:\s*var\(\s*--fg-4\s*\)/.test(r.body)) continue;
    const off = r.selectors.filter((s) => !Object.prototype.hasOwnProperty.call(ALLOW, s));
    if (off.length) bad.push(off.join(", "));
  }
  return bad;
}

test("styles.css never colours a text in --fg-4 outside the decorations allowed", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const bad = fg4TextRules(css);
  assert.deepStrictEqual(bad, [], "color: var(--fg-4) on: " + bad.join(" | ") + ". Use --fg-3 (or --fg-2 on a fill).");
});

test("the guard reads a rule as the stylesheet writes it", () => {
  assert.deepStrictEqual(fg4TextRules(".a { color: var(--fg-4); }"), [".a"]);
  assert.deepStrictEqual(fg4TextRules(".a { background: var(--bg); color:var( --fg-4 ) }"), [".a"]);
  assert.deepStrictEqual(fg4TextRules("@media (x) { .b, .crumb-sep { font-size: 1px; color: var(--fg-4); } }"), [".b"]);
  assert.deepStrictEqual(fg4TextRules(".a { background-color: var(--fg-4); border-color: var(--fg-4); }"), []);
  assert.deepStrictEqual(fg4TextRules("/* .a { color: var(--fg-4); } */ .crumb-sep { color: var(--fg-4); }"), []);
});

test("every allowed selector is still in styles.css (a stale entry is removed)", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const present = new Set(rules(css).flatMap((r) => r.selectors));
  for (const sel of Object.keys(ALLOW)) assert.ok(present.has(sel), sel + " is on the allow-list but not in styles.css");
});
