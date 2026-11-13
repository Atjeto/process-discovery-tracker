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
  // Machine values, never rendered: overview-view.js compares
  // analysis.case_quality.mode === "unsegmented" (the Overview and the Map
  // lock message). The rendered copy says "no runs marked".
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
const DASH_ALLOW = {};

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

/* ---- Lane A-2: one name per act, and words a PM never reads -------------
   One act has one name everywhere (audit A20): Play plays a step, Show on
   timeline goes from Steps or the step panel to the Timeline, Open in Steps
   goes to Steps. The names they had before are retired. And three words of
   the code never reach a process manager: "playhead" (say the clock's
   moment, or the moment the video shows), "pending" (say what waits), and
   "marker" in Help's words (say a transaction's start or end; the guard
   reads "marker" in index.html only, the JS keeps it in code).

   Scope: the viewer's JS string literals that read as words (a literal of
   one code token, such as "tl-playhead" or " pending", or of class names
   with a hyphen, such as "flow-link pending", is code and not read), and
   index.html's text and its title, aria-label, placeholder and alt values
   (class, id and data-* values are code). Comments are never read. */
const RETIRED_NAMES = [
  { re: /^\s*Watch\s*$/, term: "Watch", instead: "Play" },
  { re: /select \+ seek/i, term: "Select + seek here", instead: "Play" },
  { re: /\bjump to\b/i, term: "Jump to ...", instead: "Show on timeline, Open in Steps, or Go to its start" },
  { re: /^\s*\+ step\s*$/i, term: "+ step", instead: "Add step here" },
  { re: /\bseek\b/i, term: "seek", instead: "go to (a moment)" },
];
const PM_WORDS = [
  { re: /\bplayhead\b/i, term: "playhead", instead: "the clock's moment, or the moment the video shows" },
  { re: /\bpending\b/i, term: "pending", instead: "say what waits" },
];
const HTML_ONLY_WORDS = [
  { re: /\bmarkers?\b/i, term: "marker", instead: "a transaction's start or end" },
];

/* A literal that is code, not words: one token, or tokens that are all
   lower case code names, at least one of them with a hyphen, underscore,
   dot, slash or hash (class lists, ids, selectors, paths). */
function isCodeLiteral(text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    const t = tokens[0] || "";
    return /^[#.]?[\w./#:@$-]*$/.test(t) && (/^[#.]?[a-z0-9_$@:]/.test(t) || /[-_./#]/.test(t) || t === "");
  }
  return tokens.every((t) => /^[#.]?[a-z0-9][\w./#:-]*$/.test(t)) && tokens.some((t) => /[-_./#]/.test(t));
}

/* index.html's words: the text between tags and the values of title,
   aria-label, placeholder, alt and label, comments, scripts and styles
   taken out. [{ text, line }] */
function htmlCopy(src) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const s = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, blank);
  const out = [];
  const lineAt = (i) => s.slice(0, i).split("\n").length;
  for (const m of s.matchAll(/<[^>]*>/g)) {
    for (const a of m[0].matchAll(/\s(title|aria-label|placeholder|alt|label)="([^"]*)"/g)) out.push({ text: a[2], line: lineAt(m.index) });
  }
  const text = s.replace(/<[^>]*>/g, (t) => blank(t));
  text.split("\n").forEach((t, k) => { if (t.trim()) out.push({ text: t, line: k + 1 }); });
  return out;
}

/* Allowlist: file -> texts (trimmed, whole) excused, each with its reason. */
const WORD_ALLOW = {
  // The Raw events table's filter names the kinds of event as the recording
  // writes them, the same words as its Kind column (the recorded data).
  "viewer/index.html": ["marker"],
};

function wordOffenders(files, rules, htmlRules) {
  const out = [];
  for (const file of files) {
    const rel = path.relative(REPO, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");
    const html = file.endsWith(".html");
    const pieces = (html ? htmlCopy(src) : jsStringLiterals(src).filter((l) => !isCodeLiteral(l.text)))
      .filter((p) => !(WORD_ALLOW[rel] || []).includes(p.text.trim())).sort((a, b) => a.line - b.line);
    for (const p of pieces) {
      for (const r of rules.concat(html ? htmlRules : [])) {
        if (r.re.test(p.text)) out.push(rel + ":" + p.line + ': "' + r.term + '" in ' + JSON.stringify(p.text.trim().slice(0, 80)) + ", use " + r.instead);
      }
    }
  }
  return out;
}

test("lane A-2: one name per act, and no playhead, pending or marker in what a PM reads", () => {
  const files = appFiles(VIEWER, [".js", ".html"]);
  const bad = wordOffenders(files, RETIRED_NAMES.concat(PM_WORDS), HTML_ONLY_WORDS);
  assert.deepStrictEqual(bad, [], "A retired name or a word of the code in the viewer's copy:\n  " + bad.join("\n  "));
});

test("lane A-2: the word guard reads copy, not code (positive controls)", () => {
  assert.strictEqual(isCodeLiteral("tl-playhead"), true);
  assert.strictEqual(isCodeLiteral("#tl-playhead"), true);
  assert.strictEqual(isCodeLiteral(" pending"), true);
  assert.strictEqual(isCodeLiteral("flow-link pending"), true);
  assert.strictEqual(isCodeLiteral("../marker-edits.js"), true);
  assert.strictEqual(isCodeLiteral("Add step at playhead"), false);
  assert.strictEqual(isCodeLiteral("a change pending"), false);
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "copy-guard-"));
  try {
    const js = path.join(dir, "x.js");
    fs.writeFileSync(js, [
      "const a = 'tl-playhead'; // the playhead in a comment",
      "addItem(\"Watch\", f);",
      "label: \"Jump to step here\",",
      "toast(\"Add a step at the video's playhead\");",
      "el.className = 'row' + (open ? ' pending' : '');",
    ].join("\n"));
    const html = path.join(dir, "x.html");
    fs.writeFileSync(html, '<div class="tl-bar-playhead" id="pending-x"></div>\n<!-- a marker -->\n<h3>Working with markers</h3>\n<b title="Seek the video">x</b>');
    const got = wordOffenders([js, html], RETIRED_NAMES.concat(PM_WORDS), HTML_ONLY_WORDS).map((o) => o.replace(/^.*?(x\.\w+:\d+): "([^"]+)".*$/, "$1 $2"));
    assert.deepStrictEqual(got.map((g) => g.replace(/^.*[\\/]/, "")), ["x.js:2 Watch", "x.js:3 Jump to ...", "x.js:4 playhead", "x.html:3 marker", "x.html:4 seek"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- Lane no-narration: the screens never explain the tool --------------
   The owner (2026-11-13): a line on a screen is the PM's content, an act
   (with a tooltip that says what the click does), or a fact the PM acts on.
   A line that explains how PDT works, who fills what, what the PDD or the
   analysis does with something, or points at Help, was cut; these are the
   retired lines, word for word or by a phrase only they held, so none comes
   back. Help keeps its prose: the viewer's Help (#help-modal in index.html)
   and the capture app's How to record window are not read. */
const RETIRED_NARRATION = [
  // Overview
  "You write these. The PDD prints them.",
  "The analyst wrote these. The PDD prints them.",
  "the PDD prints what you write in place of its placeholders",
  "The PDD prints each field you write",
  "Written from the SME's answer.",
  "waits under its field",
  "In the PDD: ",
  "ticked once",
  "Steps opens with the first step that has no name",
  "What the PDD of the next version leaves out",
  "Help, Troubleshooting",
  "The process map is not shown because it draws how the transactions flow",
  "if it fails again, the analysis log names",
  // Map
  "(the PDD prints this map)",
  "(edited; the PDD prints this map)",
  "hover a line for how often it was taken",
  "it shows here when the update is done",
  "and the Map says why",
  "the As-Is map the PDD prints stays as it is",
  "so the copy carries your latest step names",
  ", the map the PDD prints",
  "for example to start the To-Be map from it",
  "with a chapter of its own in the PDD",
  "so the PDD has no chapter for it",
  "Steps shows the same level",
  // Notes, files, fields
  "Notes stay in the app: the PDD does not print them.",
  "Notes stay out of the PDD",
  "stays out of the PDD",
  "lists it in the PDD",
  "listed in the PDD",
  "the PDD lists it",
  "The PDD lists the files you attach here.",
  "The label the PDD prints for this file",
  "The text the PDD prints under this step",
  "Saved when you press Enter or leave the field",
  "Saved when you leave the field",
  "Your edits are saved as you make them",
  "Every change saves itself to the project folder",
  "and the PDD says so",
  // Steps
  "The reference transaction: you confirm it, and the others are compared with it.",
  "A merge carries to the same drafted steps in the other transactions",
  "the PDD prints its steps, and the other transactions are compared with it",
  "It is not confirmed: the reference transaction is.",
  "confirmed: the other transactions are compared with it",
  "its differences are listed on the left",
  "fix and name them as at the main level",
  "Confirm transaction accepts them with the rest of the transaction.",
  "One block per time a transaction goes through this sub-process.",
  "The whole project is one transaction",
  "Steps appear once the recording is analyzed",
  "the recorder drafted this step, and nobody has checked it yet",
  "you accepted the drafted step as it is",
  "Edited: you changed this step",
  "Added: you added this step by hand.",
  "Hidden: you took this step out.",
  "The code of the library activity this step is named from",
  "which lists every time it happened",
  "Read from the actions recorded in this step.",
  "empty, the recording's role",
  "(from the recording)",
  ", the recording's role.",
  "You can edit it there.",
  "The scissors after an action split the step there.",
  "(the inverse of Split)",
  // Timeline and its pane
  "where its flow and its sub-process are edited",
  "A note sits on a step or at a moment",
  "An attached file is copied into the project",
  "open: it ends where you add the next step, or where its transaction ends",
  "the Timeline then follows it",
  "Its sentences are placed from that video's start, and move with it.",
  "The recording itself is not changed; the change is saved with the project and the transactions follow it.",
  // The library builder
  "the steps their analysts named are listed by system",
  "its screens are added to that activity",
  "a step named from it takes it when it has none",
  "their annotations.json and manifest.json are read",
  "each is read where it is, not unzipped",
  "the app's own library file is offered first",
  // The top bar and the page shown while no project is open
  "you add its steps by hand in Steps",
  "confirm transaction 1, then review the others",
  "each export opens its folder with the file selected",
  "It says which version it is.",
  "to see every part of PDT on a finished example",
  "the next Open the demo project starts from the same demo again",
  "for a how-to-use guide",
  // The capture app
  "Who is recording. Saved with every recording",
  "Shown in the viewer so people can tell recordings apart",
  "Helps the analyst when several people record the same process.",
  "Kept on this computer for every recording.",
  "menu shows the size of all recordings and flags it above this limit",
  "Edit a field, then click Save.",
  "The zip holds the recording, your answers and the example files.",
];

/* What a person reads in `file`: the JS string literals, or the HTML's
   text, script literals and styles; Help is left out. [{ text, line }] */
function readableWithoutHelp(file) {
  const src = fs.readFileSync(file, "utf8");
  if (!file.endsWith(".html")) return jsStringLiterals(src);
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const noHelp = src.replace(/<div class="modal-backdrop" id="help-modal"[\s\S]*?<!-- ADR-0019: Reference Maps editor overlay/, blank);
  return htmlReadable(noHelp);
}

function narrationOffenders(files) {
  const out = [];
  for (const file of files) {
    const rel = path.relative(REPO, file).replace(/\\/g, "/");
    if (rel === "capture/ui/help-window.html") continue;   // the capture app's Help
    for (const p of readableWithoutHelp(file)) {
      for (const line of RETIRED_NARRATION) {
        if (p.text.includes(line)) out.push(rel + ":" + p.line + ": " + JSON.stringify(line));
      }
    }
  }
  return out;
}

test("lane no-narration: no retired line that explains the tool is back on a screen", () => {
  const files = appFiles(VIEWER, [".js", ".html"]).concat(appFiles(path.join(REPO, "capture"), [".js", ".html"]));
  const bad = narrationOffenders(files);
  assert.deepStrictEqual(bad, [], "A line that explains the tool, cut by the no-narration lane, is back:\n  " + bad.join("\n  "));
});

test("lane no-narration: the guard reads screens and leaves Help out (positive controls)", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "narration-guard-"));
  try {
    const js = path.join(dir, "x.js");
    fs.writeFileSync(js, "// You write these. The PDD prints them. (a comment)\nconst t = \"You write these. The PDD prints them.\";\n");
    const html = path.join(dir, "x.html");
    fs.writeFileSync(html, '<p>Notes stay out of the PDD</p>\n<div class="modal-backdrop" id="help-modal">Notes stay out of the PDD</div>\n' +
      "<!-- ADR-0019: Reference Maps editor overlay -->\n");
    const got = narrationOffenders([js, html]).map((o) => o.replace(/^.*[\\/]/, ""));
    assert.deepStrictEqual(got, ['x.js:2: "You write these. The PDD prints them."', 'x.html:1: "Notes stay out of the PDD"']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

module.exports = { BANNED_COPY, BANNED_CAPTURE_ONLY, DASH_RE, jsStringLiterals, RETIRED_NAMES, PM_WORDS, isCodeLiteral };
