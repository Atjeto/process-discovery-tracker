"use strict";
/* Wave 0 / 6b — Node-side egress guard (capture).
 *
 * The renderer windows are CSP-locked (connect-src 'none'); this test guards the
 * MAIN / Node side, where a future backend transport would otherwise slip in
 * unguarded. It fails if any app .js imports a raw network module / fetch /
 * WebSocket / XHR outside the sanctioned allowlist — keeping the air-gap moat
 * provable in code, not just by convention. See PDT-ROADMAP-CODEBASE-FIT.md §6b. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Files permitted a network client, with justification. Adding to this list is a
// deliberate act: confirm the addition cannot break the air-gapped deployment tier.
const ALLOW = {
  "obs.js": "obs-websocket-js to ws://127.0.0.1 (localhost OBS only) — the one sanctioned client",
};

const FORBIDDEN = [
  /require\(\s*['"](?:node:)?(?:http|https|net|tls|dgram|dns|http2|inspector)['"]\s*\)/,
  /require\(\s*['"](?:axios|node-fetch|got|undici|ws|superagent|request|needle)['"]\s*\)/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bXMLHttpRequest\b/,
  /require\(\s*['"]obs-websocket-js['"]\s*\)/,
  // Electron's own HTTP client (electron.net) bypasses the renderer CSP, so it
  // is an egress vector too -- forbid both the property access and the destructure.
  /require\(\s*['"]electron['"]\s*\)\s*\.\s*net\b/,
  /\{[^}]*\bnet\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/,
];

const SKIP_DIRS = new Set(["node_modules", "test", "python", "fonts", "recorder"]);

function appJsFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith("dist")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) appJsFiles(p, acc);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) acc.push(p);
  }
  return acc;
}

test("Node-side egress guard: no network client outside the allowlist", () => {
  const offenders = [];
  for (const file of appJsFiles(ROOT)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");
    if (FORBIDDEN.some((re) => re.test(src)) && !(rel in ALLOW)) offenders.push(rel);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    "New network-egress vector(s) in capture code. If intentional, add to ALLOW with " +
      "justification (and confirm it can't break the air-gapped tier):\n  " +
      offenders.join("\n  ")
  );
});
