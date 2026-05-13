/*
 * Spawns the Python normalization service as a subprocess.
 *
 * Resolution order for the Python interpreter:
 *   1. PDT_PYTHON env var (explicit override)
 *   2. python-embeddable folder shipped alongside the viewer (§11.5 option a)
 *   3. system "python" on PATH (developer convenience)
 *
 * The contract is: pass a session folder + taxonomy path, get the
 * normalized outputs written into the same session folder. Returns a
 * Promise that resolves with stdout + parsed result on success.
 */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function resolvePython() {
  if (process.env.PDT_PYTHON && fs.existsSync(process.env.PDT_PYTHON)) {
    return process.env.PDT_PYTHON;
  }
  /* Sibling python-embeddable folder. We probe a couple of common
     layout names for forward-compatibility with however the embeddable
     gets shipped. */
  const candidates = [
    path.join(__dirname, "python", "python.exe"),
    path.join(__dirname, "python-embeddable", "python.exe"),
    path.join(process.resourcesPath || "", "python", "python.exe"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "python";
}

function resolveNormalizeScript() {
  /* In dev: ../normalization/normalize.py. In packaged build: shipped
     next to the executable under resources/. */
  const candidates = [
    path.resolve(__dirname, "..", "normalization", "normalize.py"),
    path.join(process.resourcesPath || "", "normalization", "normalize.py"),
    path.join(__dirname, "normalization", "normalize.py"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error("normalize.py not found in any expected location");
}

function resolveDefaultTaxonomy() {
  const candidates = [
    path.resolve(__dirname, "..", "normalization", "sample-taxonomy.yaml"),
    path.join(process.resourcesPath || "", "normalization", "sample-taxonomy.yaml"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function runNormalize({ sessionFolder, taxonomyPath, mine, onLog }) {
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    const script = resolveNormalizeScript();
    const tax = taxonomyPath || resolveDefaultTaxonomy();
    const args = [script, sessionFolder];
    if (tax) args.push("--taxonomy", tax);
    if (mine) args.push("--mine");

    const proc = spawn(python, args, {
      cwd: path.dirname(script),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => {
      const text = b.toString();
      stdout += text;
      if (onLog) onLog(text);
    });
    proc.stderr.on("data", (b) => {
      const text = b.toString();
      stderr += text;
      if (onLog) onLog(text);
    });
    proc.on("error", (e) => reject(new Error(`failed to spawn python: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`normalize.py exited ${code}: ${stderr}`));
        return;
      }
      /* The final JSON summary is the trailing block of stdout. */
      const trimmed = stdout.trim();
      const lastBrace = trimmed.lastIndexOf("{");
      let summary = null;
      if (lastBrace >= 0) {
        try {
          summary = JSON.parse(trimmed.slice(lastBrace));
        } catch (_e) { /* keep null */ }
      }
      resolve({ summary, stdout, stderr });
    });
  });
}

module.exports = { runNormalize, resolvePython, resolveNormalizeScript, resolveDefaultTaxonomy };
