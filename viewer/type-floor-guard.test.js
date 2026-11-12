"use strict";
/* Lane A-2: a floor of 12 px for text a person reads (audit A4, A5).
 *
 * The viewer's base is 13 px; anything a process manager reads is at least
 * 12 px. Only the mono clock times (a moment on the one clock, "0:42", in
 * --font-mono) may be 11 px, and only in the rules listed below. This guard
 * reads styles.css and fails on a `font-size` under 12 px in any rule whose
 * selectors are not all on the list, or on a listed rule under 11 px or not
 * in the mono face. It also reads the inline styles the viewer's JS writes
 * (a `font-size: Npx` inside a string literal). Where 12 px does not fit,
 * the layout changes, not the floor; see docs/architecture/DESIGN-SYSTEM.md,
 * "Type scale".
 *
 * What it cannot see: a size set from a number in code (the map of how the
 * transactions ran, dfg-viewer.js, sizes its canvas text in cytoscape's
 * style object), a size in em or rem, and the vendored bpmn-js styles.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const FLOOR_PX = 12;
const MONO_TIME_PX = 11;

/* selector -> the clock time it shows (11 px, mono). */
const MONO_TIMES = {
  ".step-row .step-time": "when a step starts, on its row in Steps",
  ".editor-detail-pane .si-time": "the moment of a recorded action under Recorded",
  ".tr-time": "the moment of a sentence of the transcript",
  ".sp-note-at": "the moment of a note in the step panel",
  ".step-shot .stamp": "the moment of a screenshot on its card",
  ".screens-grid .thumb .stamp": "the moment of a screenshot in the Screenshots tab",
  ".tl-drag-time": "the time a dragged side is at",
};

/* Every rule (innermost braces, so a rule inside @media is read too). */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selectors: m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean), body: m[2] });
  }
  return out;
}

/* The rules that break the floor: [{ selectors, px, why }]. */
function floorBreaks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const r of rules(clean)) {
    const re = /(?:^|[;\s{])font-size\s*:\s*([0-9.]+)px/g;
    let m;
    while ((m = re.exec(r.body))) {
      const px = Number(m[1]);
      if (px >= FLOOR_PX) continue;
      const listed = r.selectors.every((s) => Object.prototype.hasOwnProperty.call(MONO_TIMES, s));
      const mono = /font-family\s*:\s*var\(\s*--font-mono\s*\)/.test(r.body);
      if (listed && mono && px >= MONO_TIME_PX) continue;
      bad.push({ selectors: r.selectors.join(", "), px,
        why: !listed ? "under " + FLOOR_PX + " px" : !mono ? "a clock time not in --font-mono" : "under " + MONO_TIME_PX + " px" });
    }
  }
  return bad;
}

/* `font-size: Npx` under the floor in a JS source outside its comments (an
   inline style the viewer writes). Comments: block comments, and lines that
   are a comment (// or a block comment's * line). */
function inlineBreaks(src) {
  const bad = [];
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    const re = /font-size\s*:\s*([0-9.]+)px/g;
    let m;
    while ((m = re.exec(line))) if (Number(m[1]) < FLOOR_PX) bad.push((i + 1) + ": " + t.slice(0, 80));
  });
  return bad;
}

test("styles.css: no text under 12 px, the mono clock times at 11 px or more", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const bad = floorBreaks(css);
  assert.deepStrictEqual(bad, [], "font-size under the floor: " +
    bad.map((b) => b.selectors + " " + b.px + "px (" + b.why + ")").join(" | ") +
    ". Make it 12px, and change the layout where it does not fit.");
});

test("the viewer's inline styles: no text under 12 px", () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => path.join(__dirname, f))
    .concat(fs.readdirSync(path.join(__dirname, "views")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => path.join(__dirname, "views", f)));
  const bad = [];
  for (const f of files) for (const b of inlineBreaks(fs.readFileSync(f, "utf8"))) bad.push(path.basename(f) + ":" + b);
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of html.matchAll(/font-size\s*:\s*([0-9.]+)px/g)) if (Number(m[1]) < FLOOR_PX) bad.push("index.html: " + m[0]);
  assert.deepStrictEqual(bad, [], "inline font-size under 12 px: " + bad.join(" | "));
});

test("the guard reads a rule as the stylesheet writes it (positive controls)", () => {
  assert.deepStrictEqual(floorBreaks(".a { font-size: 11px; }").map((b) => b.selectors), [".a"]);
  assert.deepStrictEqual(floorBreaks("@media (x) { .b { color: red; font-size:10px } }").map((b) => b.selectors), [".b"]);
  assert.deepStrictEqual(floorBreaks(".a { font-size: 12px; } .b { font-size: 13px; }"), []);
  assert.deepStrictEqual(floorBreaks("/* .a { font-size: 9px; } */ .c { font-size: 12px; }"), []);
  // A listed clock time: 11 px in mono passes; under 11, or not mono, fails.
  assert.deepStrictEqual(floorBreaks(".tr-time { font-family: var(--font-mono); font-size: 11px; }"), []);
  assert.deepStrictEqual(floorBreaks(".tr-time { font-family: var(--font-mono); font-size: 10px; }").map((b) => b.why), ["under 11 px"]);
  assert.deepStrictEqual(floorBreaks(".tr-time { font-size: 11px; }").map((b) => b.why), ["a clock time not in --font-mono"]);
  // A listed selector in a group with one that is not listed fails.
  assert.deepStrictEqual(floorBreaks(".tr-time, .x { font-family: var(--font-mono); font-size: 11px; }").length, 1);
  assert.deepStrictEqual(inlineBreaks("el.style.cssText = 'color:red;font-size:10px';").length, 1);
  assert.deepStrictEqual(inlineBreaks("// font-size:9px in a comment\nconst a = 'font-size:12px';"), []);
});

test("every listed clock time is still in styles.css (a stale entry is removed)", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const present = new Set(rules(css).flatMap((r) => r.selectors));
  for (const sel of Object.keys(MONO_TIMES)) assert.ok(present.has(sel), sel + " is listed but not in styles.css");
});

module.exports = { MONO_TIMES, floorBreaks, inlineBreaks };
