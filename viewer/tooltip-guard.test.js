"use strict";
/* Lane A-2: a tooltip is short (audit A7, plan A10).
 *
 * A tooltip needs a mouse and a wait, so nothing a process manager needs is
 * said only there: a tooltip is one sentence on what the click does, 90
 * characters or fewer, and what a long one said is in Help (index.html and
 * docs/HOW-TO.md in the same words) or in a line where the act is.
 *
 * What this guard reads:
 *   - index.html: every static title="..." (comments taken out);
 *   - the viewer's JS (comments taken out, adjacent string literals joined
 *     where they are added with +): a literal assigned to .title, given to
 *     setAttribute("title", ...), given as a title: or ...Title: value, a
 *     static title="..." written inside a literal (HTML built in JS), a
 *     constant named ..._TITLE, and every string value of an object constant
 *     named ..._TITLES (a map of tooltips by id).
 * What it cannot see: a tooltip built from a variable or a ${} (a band's
 * name and length, a transcript's sentence, the save state's folder), one
 * handed to a helper under another name (a time field's title argument, the
 * Timeline row's words in timeline-row.js), and one in a constant whose name
 * does not say TITLE. Those were shortened by hand; the lane's report lists
 * them.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const MAX = 90;

/* A JS source without its comments: block comments, and // comments that
   start a line or follow code after a space (not inside a string: a //
   inside quotes, as in a URL, is kept by skipping quoted runs). */
function stripJsComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d || ""; i += 2; continue; }
      if (c === q || (c === "\n" && q !== "`")) q = null;
      i++; continue;
    }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; out += " ".repeat(end - i); i = end; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    out += c; i++;
  }
  return out;
}

/* Adjacent literals of one kind added with + become one: "a " + "b" is
   "a b" (across lines too), so a tooltip split over lines is read whole. */
function joinLiterals(src) {
  let s = src, prev;
  do {
    prev = s;
    s = s.replace(/"((?:[^"\\\n]|\\.)*)"\s*\+\s*"/g, '"$1').replace(/'((?:[^'\\\n]|\\.)*)'\s*\+\s*'/g, "'$1");
  } while (s !== prev);
  return s;
}

const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`[^`$]*`" + `)`;
const unquote = (lit) => lit.slice(1, -1).replace(/\\(["'\\`])/g, "$1").replace(/\\n/g, "\n");

/* Every static tooltip text in a JS source: [{ text, line }]. */
function jsTooltips(src) {
  const s = joinLiterals(stripJsComments(src));
  // Joining removes line breaks: a line is found in the source as written,
  // by the start of the text, else counted in the joined source.
  const lineAt = (idx) => {
    const head = s.slice(idx, idx + 40);
    const at = src.indexOf(head);
    return (at >= 0 ? src.slice(0, at) : s.slice(0, idx)).split("\n").length;
  };
  const out = [];
  const take = (re, group) => { for (const m of s.matchAll(re)) out.push({ text: unquote(m[group]), line: lineAt(m.index) }); };
  take(new RegExp(String.raw`\.title\s*=\s*` + LIT + String.raw`\s*[;,)\n]`, "g"), 1);
  take(new RegExp(String.raw`setAttribute\(\s*["']title["']\s*,\s*` + LIT + String.raw`\s*\)`, "g"), 1);
  take(new RegExp(String.raw`\b\w*[tT]itle\s*:\s*` + LIT + String.raw`\s*[,}\n]`, "g"), 1);
  take(new RegExp(String.raw`\bconst\s+\w*TITLE\s*=\s*` + LIT + String.raw`\s*;`, "g"), 1);
  for (const m of s.matchAll(/\bconst\s+\w*TITLES\s*=\s*\{([\s\S]*?)\n\s*\};/g)) {
    const base = m.index + m[0].indexOf(m[1]);
    for (const v of m[1].matchAll(new RegExp(String.raw`:\s*` + LIT, "g"))) out.push({ text: unquote(v[1]), line: lineAt(base + v.index) });
  }
  // A static title="..." inside a literal of HTML (no quote or + in it).
  for (const m of s.matchAll(/\btitle=\\?"([^"'`$+\\]*)\\?"/g)) out.push({ text: m[1], line: lineAt(m.index) });
  return out;
}

/* Every static title="..." in an HTML source. */
function htmlTooltips(src) {
  const s = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  return [...s.matchAll(/\stitle="([^"]*)"/g)].map((m) => ({ text: m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
    line: s.slice(0, m.index).split("\n").length }));
}

function tooLong(list) {
  return list.filter((t) => t.text.length > MAX).map((t) => t.line + " [" + t.text.length + "] " + t.text.slice(0, 70));
}

function viewerJs() {
  const dir = __dirname;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => path.join(dir, f))
    .concat(fs.readdirSync(path.join(dir, "views")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => path.join(dir, "views", f)));
}

test("index.html: no static tooltip over 90 characters", () => {
  const bad = tooLong(htmlTooltips(fs.readFileSync(path.join(__dirname, "index.html"), "utf8")));
  assert.deepStrictEqual(bad, [], "a tooltip is one sentence on what the click does, 90 characters or fewer; " +
    "put the rest in Help or in a line where the act is:\n  " + bad.join("\n  "));
});

test("the viewer's JS: no static tooltip over 90 characters", () => {
  const bad = [];
  for (const f of viewerJs()) for (const b of tooLong(jsTooltips(fs.readFileSync(f, "utf8")))) bad.push(path.basename(f) + ":" + b);
  assert.deepStrictEqual(bad, [], "a tooltip is one sentence on what the click does, 90 characters or fewer; " +
    "put the rest in Help or in a line where the act is:\n  " + bad.join("\n  "));
});

test("the guard reads tooltips as the viewer writes them (positive controls)", () => {
  const long = "x".repeat(91);
  const found = (src) => jsTooltips(src).map((t) => t.text.length);
  assert.deepStrictEqual(found('el.title = "' + long + '";'), [91]);
  assert.deepStrictEqual(found("el.title = 'a' +\n  '" + long + "';"), [92], "joined across a +");
  assert.deepStrictEqual(found('b.setAttribute("title", "' + long + '");'), [91]);
  assert.deepStrictEqual(found('const X = { title: "' + long + '", deleteTxTitle: "short" };'), [91, 5]);
  assert.deepStrictEqual(found('const REMOVE_TITLE = "' + long + '";'), [91]);
  assert.deepStrictEqual(found('const VERB_TITLES = {\n  "a": "' + long + '",\n  b: "ok",\n};'), [91, 2]);
  assert.deepStrictEqual(found("html += '<button title=\"" + long + "\">Go</button>';"), [91]);
  assert.deepStrictEqual(found('// el.title = "' + long + '";\n/* el.title = "' + long + '"; */'), [], "comments are not read");
  assert.deepStrictEqual(found("el.title = name + \"" + long + "\";"), [], "a title built from a variable is not seen");
  assert.deepStrictEqual(tooLong(htmlTooltips('<b title="' + long + '">x</b>\n<!-- <b title="' + long + '"> -->')).length, 1);
  assert.deepStrictEqual(tooLong(htmlTooltips('<b title="' + "y".repeat(90) + '">x</b>')), []);
});

module.exports = { jsTooltips, htmlTooltips, MAX };
