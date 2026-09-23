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
   side Machine surfaces (Markers panel, Template view) may keep the term
   with a plain-words tooltip, so viewer files are exempt. */
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

module.exports = { BANNED_COPY, BANNED_CAPTURE_ONLY };
