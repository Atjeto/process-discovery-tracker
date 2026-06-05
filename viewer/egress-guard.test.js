"use strict";
/* Wave 0 / 6b — Node-side egress guard (viewer).
 *
 * The renderer is CSP-locked (connect-src 'none'); this test guards the MAIN /
 * Node side and the renderer alike, failing if any app .js imports a raw network
 * module / fetch / WebSocket / XHR. The viewer has NO sanctioned network client
 * (it spawns the bundled Python over stdio, no sockets) — so the allowlist is
 * empty. Keeps the air-gap moat provable in code. See PDT-ROADMAP-CODEBASE-FIT.md §6b. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

// PDT-1.0-SPEC §3.2 / ADR-0028: the bundled-Ollama launcher binds a localhost
// loopback port and is the SOLE sanctioned network module. It is loopback-only
// (127.0.0.1, listener pinned) and never reaches off-box — the air-gap moat
// holds. The `net` import is for picking a free local port; no outbound HTTP.
const ALLOW = {
  "ollama-launcher.js": "loopback-only bundled-LLM launcher (ADR-0028)",
};

const FORBIDDEN = [
  /require\(\s*['"](?:node:)?(?:http|https|net|tls|dgram|dns|http2|inspector)['"]\s*\)/,
  /require\(\s*['"](?:axios|node-fetch|got|undici|ws|superagent|request|needle)['"]\s*\)/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bXMLHttpRequest\b/,
  // Electron's own HTTP client (electron.net) bypasses the renderer CSP, so it
  // is an egress vector too -- forbid both the property access and the destructure.
  /require\(\s*['"]electron['"]\s*\)\s*\.\s*net\b/,
  /\{[^}]*\bnet\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/,
];

const SKIP_DIRS = new Set(["node_modules", "python", "fonts"]);

function appJsFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith("dist")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) appJsFiles(p, acc);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) acc.push(p);
  }
  return acc;
}

test("Node-side egress guard: viewer imports no network client", () => {
  const offenders = [];
  for (const file of appJsFiles(ROOT)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");
    if (FORBIDDEN.some((re) => re.test(src)) && !(rel in ALLOW)) offenders.push(rel);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    "Network-egress vector(s) in viewer code. If intentional, add to ALLOW with " +
      "justification (and confirm it can't break the air-gapped tier):\n  " +
      offenders.join("\n  ")
  );
});
