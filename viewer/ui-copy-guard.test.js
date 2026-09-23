"use strict";
/* Lab Phase F3 — UI copy guard.
 *
 * Business users read every string this app renders; the v1.1.0 walk-through
 * showed the internal vocabulary ("off-contract", "Tier 2", "unsegmented")
 * does not survive contact with them. This guard scans the USER-FACING string
 * literals in the viewer and the capture windows for that vocabulary and
 * fails on regression — the language contract lives in
 * docs/architecture/DESIGN-SYSTEM.md ("UI copy style guide"), which documents
 * each banned term and its approved replacement.
 *
 * Scope: string literals in app .js (comments stripped) + the window HTML.
 * Code identifiers, JSON keys, and comments are deliberately out of scope —
 * `tier2_unlocked` stays; the *rendered* "Tier 2" does not.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const VIEWER = __dirname;
const REPO = path.join(__dirname, "..");

/* The banned vocabulary, each with its approved plain replacement (the same
   table is documented in DESIGN-SYSTEM.md — keep the two in sync). The test
   for any new string: would a business analyst with zero process-mining
   background understand it on first read? */
const BANNED_COPY = [
  { re: /\bcanon\b/i, term: "canon", instead: "say what the view shows in plain words" },
  { re: /fact(?:[- ]level)? authority/i, term: "fact authority", instead: "“treat as exploration, not evidence”" },
  { re: /\boff-contract\b/i, term: "off-contract", instead: "“advanced” / “exploration, not evidence”" },
  { re: /\btier[\s-][123]\b/i, term: "Tier 1/2/3", instead: "say what it means (“needs confirmed cases” / “measured”)" },
  { re: /inductive[- ]miner/i, term: "inductive-miner", instead: "“auto-generated process model”" },
  { re: /taxonomy-classified/i, term: "taxonomy-classified", instead: "“by app category”" },
  // space-separated only: the slider's grain-notch CSS class/id are code, not copy
  { re: /grain notch/i, term: "grain notch", instead: "“detail level”" },
  { re: /\bvalue-free\b/i, term: "value-free", instead: "“with ticket/order values stripped out”" },
  { re: /cargo[- ]cult/i, term: "cargo-cult", instead: "keep in code comments/docs only" },
  { re: /\bmotifs?\b/i, term: "motif", instead: "“repeated sequence”" },
  { re: /\bsegment-grain\b/i, term: "segment-grain", instead: "“step sequence”" },
  { re: /\bheuristics?\b/i, term: "heuristic", instead: "“estimate” / “automatic guess” / “by default”" },
  { re: /\bprovisional\b/i, term: "provisional", instead: "“estimate — review before relying on it”" },
  { re: /\bunsegmented\b/i, term: "unsegmented", instead: "“no cases identified yet”" },
  { re: /\bpostures?\b/i, term: "posture", instead: "“data sharing mode”" },
  { re: /\bmodal pattern\b/i, term: "modal pattern", instead: "“usual pattern”" },
  { re: /case[\s-]segmented/i, term: "case-segmented", instead: "“cases identified”" },
];

/* "anchor" is banned only in WORKER-facing copy (the capture app): a worker
   is told about "the field that identifies the ticket/order". The analyst-
   side viewer may keep the term with a plain-words tooltip, so viewer files
   are exempt. */
const BANNED_CAPTURE_ONLY = [
  { re: /\banchor/i, term: "anchor", instead: "“the field that identifies the ticket/order”" },
];

/* Allowlist: file (repo-relative, forward slashes) -> [term, ...] with the
   justification next to each entry. An entry must name a GENUINE false
   positive (an internal value that never renders), not user-facing copy. */
const ALLOW = {
  // Machine values, never rendered: renderer.js and overview-view.js compare
  // analysis.case_quality.mode === "unsegmented". The rendered copy says
  // "no cases identified yet".
  "viewer/renderer.js": ["unsegmented"],
  "viewer/views/overview-view.js": ["unsegmented"],
};

const SKIP_DIRS = new Set(["node_modules", "python", "fonts", "recorder", "test", "dist"]);

function appFiles(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith("dist")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) appFiles(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith(".test.js")) acc.push(p);
  }
  return acc;
}

/* Strip JS comments line-wise (crude but sufficient: full-line // and block
   comments), then pull out every string literal's content. */
function stringLiterals(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = noBlocks.split("\n").filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*"));
  });
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const line of lines) {
    let m;
    while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

function htmlText(src) {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

function scan(files, rules) {
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(REPO, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");
    const haystacks = file.endsWith(".html") ? [htmlText(src)] : stringLiterals(src);
    for (const rule of rules) {
      if ((ALLOW[rel] || []).includes(rule.term)) continue;
      if (haystacks.some((h) => rule.re.test(h))) {
        offenders.push(`${rel}: "${rule.term}" — use ${rule.instead}`);
      }
    }
  }
  return offenders;
}

test("UI copy guard: no internal vocabulary in viewer user-facing strings", () => {
  const files = appFiles(VIEWER, [".js", ".html"]);
  const offenders = scan(files, BANNED_COPY);
  assert.deepStrictEqual(offenders, [],
    "Banned vocabulary in user-facing copy (see DESIGN-SYSTEM.md §UI copy " +
    "style guide). Rewrite the string; only allowlist a genuine non-rendered " +
    "value:\n  " + offenders.join("\n  "));
});

test("UI copy guard: no internal vocabulary in capture window strings", () => {
  const captureDir = path.join(REPO, "capture");
  const files = appFiles(captureDir, [".js", ".html"]);
  const offenders = scan(files, BANNED_COPY.concat(BANNED_CAPTURE_ONLY));
  assert.deepStrictEqual(offenders, [],
    "Banned vocabulary in worker-facing capture copy (see DESIGN-SYSTEM.md " +
    "§UI copy style guide):\n  " + offenders.join("\n  "));
});

/* ---- The owner's standing rule: no em dash, no en dash ------------------
   Nothing a person reads may contain an em dash (U+2014) or an en dash
   (U+2013); use a colon, a comma, parentheses or a plain hyphen instead.

   Scope: every string literal in the viewer and capture app .js files, the
   text of their .html files, and their .css outside comments (a `content:`
   value renders). Code comments are NOT in scope, so the JS scan uses a small
   tokenizer instead of the line-wise extraction above: it tracks comments,
   quoted strings, template literals (with ${} nesting) and regex literals,
   so a dash in a trailing `// comment` or a block comment is never flagged
   while one in any string is. HTML: comments are removed, and inline
   <script> / <style> bodies go through the JS / CSS rules. Known gap: a
   regex literal is told from a division by the token before the slash (the
   usual heuristic), which is right for this codebase but is not a parser. */
const DASH_RE = /[\u2013\u2014]/;

/* The text of every string literal in a JS source, each as { text, line }. */
function jsStringLiterals(src) {
  const out = [];
  const n = src.length;
  const tpl = [];            // brace depth at each open template ${ } expression
  let i = 0, line = 1, depth = 0;
  let prev = "", prevWord = "";
  const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete",
    "void", "throw", "case", "do", "else", "yield", "await"]);
  const step = () => { if (src[i] === "\n") line++; i++; };
  function readQuoted(q) {
    const at = line; let s = ""; step();
    while (i < n && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") { s += src[i]; step(); if (i < n) { s += src[i]; step(); } continue; }
      s += src[i]; step();
    }
    if (src[i] === q) step();
    out.push({ text: s, line: at });
  }
  function readTemplateChunk() {   // from just after ` or after the } closing ${ }
    const at = line; let s = "";
    while (i < n) {
      if (src[i] === "\\") { s += src[i]; step(); if (i < n) { s += src[i]; step(); } continue; }
      if (src[i] === "`") { step(); out.push({ text: s, line: at }); prev = "`"; prevWord = ""; return; }
      if (src[i] === "$" && src[i + 1] === "{") {
        step(); step(); out.push({ text: s, line: at }); tpl.push(depth); prev = "{"; prevWord = ""; return;
      }
      s += src[i]; step();
    }
    out.push({ text: s, line: at });
  }
  function regexAllowed() {
    if (!prev) return true;
    if (/[\w$]/.test(prev)) return REGEX_AFTER_WORD.has(prevWord);
    return !/[)\]}]/.test(prev);   // after ) ] } a slash divides
  }
  function skipRegex() {
    let inClass = false; step();
    while (i < n && src[i] !== "\n") {
      const c = src[i];
      if (c === "\\") { step(); step(); continue; }
      if (inClass) { if (c === "]") inClass = false; }
      else if (c === "[") inClass = true;
      else if (c === "/") { step(); while (i < n && /[a-z]/i.test(src[i])) step(); return; }
      step();
    }
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") step(); continue; }
    if (c === "/" && d === "*") { step(); step(); while (i < n && !(src[i] === "*" && src[i + 1] === "/")) step(); step(); step(); continue; }
    if (c === '"' || c === "'") { readQuoted(c); prev = c; prevWord = ""; continue; }
    if (c === "`") { step(); readTemplateChunk(); continue; }
    if (c === "/" && regexAllowed()) { skipRegex(); prev = "/"; prevWord = ""; continue; }
    if (c === "}" && tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); step(); readTemplateChunk(); continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (/\s/.test(c)) { step(); continue; }
    if (/[\w$]/.test(c)) {
      let w = "";
      while (i < n && /[\w$]/.test(src[i])) { w += src[i]; step(); }
      prev = w[w.length - 1]; prevWord = w; continue;
    }
    prev = c; prevWord = ""; step();
  }
  return out;
}

/* CSS text outside comments, as { text, line } per line. */
function cssText(src, lineOffset = 0) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noComments.split("\n").map((text, k) => ({ text, line: lineOffset + k + 1 }));
}

/* HTML: text with comments removed (lines kept); <script> and <style> bodies
   through the JS and CSS rules. */
function htmlReadable(src) {
  const out = [];
  const blanked = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  const lineAt = (idx) => blanked.slice(0, idx).split("\n").length;
  const rest = blanked.replace(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, body, idx) => {
    const bodyStart = idx + m.indexOf(body);
    const first = lineAt(bodyStart) - 1;
    if (tag.toLowerCase() === "script") {
      for (const lit of jsStringLiterals(body)) out.push({ text: lit.text, line: first + lit.line });
    } else {
      out.push(...cssText(body, first));
    }
    return m.replace(/[^\n]/g, " ");
  });
  rest.split("\n").forEach((text, k) => out.push({ text, line: k + 1 }));
  return out.sort((a, b) => a.line - b.line);
}

/* Allowlist: file -> literal texts excused, each with its reason. Only a
   string this lane may not edit belongs here, never new copy. */
const DASH_ALLOW = {
  // viewer/map-controller.js is a guarded map file that the next map lane
  // replaces wholesale (BA-helper cycle, 2026-09-23); its one dashed empty-
  // state string is reported to that lane rather than edited here.
  "viewer/map-controller.js": ['" \u2014 it has a single '],
};

function dashOffenders(dirs) {
  const offenders = [];
  for (const dir of dirs) {
    for (const file of appFiles(dir, [".js", ".html", ".css"])) {
      const rel = path.relative(REPO, file).replace(/\\/g, "/");
      const src = fs.readFileSync(file, "utf8");
      const pieces = file.endsWith(".html") ? htmlReadable(src)
        : file.endsWith(".css") ? cssText(src) : jsStringLiterals(src);
      for (const p of pieces) {
        if (!DASH_RE.test(p.text)) continue;
        if ((DASH_ALLOW[rel] || []).includes(p.text)) continue;
        offenders.push(rel + ":" + p.line + ": " + JSON.stringify(p.text.trim().slice(0, 90)));
      }
    }
  }
  return offenders;
}

test("the dash scanner flags strings but never comments (tokenizer control)", () => {
  // The fixtures spell the dashes as \u escapes so this file itself carries
  // none; at run time `src` holds the real characters.
  const EM = "\u2014", EN = "\u2013";
  const src = [
    "// a comment " + EM + " never flagged",
    "/* block " + EM + " never flagged */",
    "const a = x / 2; // trailing " + EM + " comment with it's quote",
    'const b = "string ' + EM + ' flagged";',
    "const re = /[\"']" + EM + "/g; // a regex literal is not a string",
    "const c = `template ${ fn('inner " + EN + " flagged') } tail " + EM + " flagged`;",
    "const d = { k: 'plain' }; const e = y / z / w;",
  ].join("\n");
  const flagged = jsStringLiterals(src).filter((l) => DASH_RE.test(l.text)).map((l) => [l.line, l.text]);
  assert.deepStrictEqual(flagged, [
    [4, "string " + EM + " flagged"],
    [6, "inner " + EN + " flagged"],
    [6, " tail " + EM + " flagged"],
  ]);
  const html = htmlReadable("<p>Text " + EM + " flagged</p>\n<!-- comment " + EM + " not -->\n" +
    "<style>/* css " + EM + " not */ .x::before { content: \"" + EN + "\"; }</style>\n" +
    "<script>// js " + EM + " not\nconst s = \"js " + EM + " flagged\";</script>");
  assert.deepStrictEqual(html.filter((p) => DASH_RE.test(p.text)).map((p) => p.line), [1, 3, 5]);
});

test("UI copy guard: no em dash or en dash in viewer or capture user-facing strings", () => {
  const offenders = dashOffenders([VIEWER, path.join(REPO, "capture")]);
  assert.deepStrictEqual(offenders, [],
    "Em dash (U+2014) or en dash (U+2013) in text a person reads. Use a colon, a comma, " +
    "parentheses or a plain hyphen instead:\n  " + offenders.join("\n  "));
});

module.exports = { BANNED_COPY, BANNED_CAPTURE_ONLY, DASH_RE, jsStringLiterals };
