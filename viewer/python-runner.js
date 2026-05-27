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
  /* The canonical taxonomy.yaml wins over sample-taxonomy.yaml when
     present, in both the dev tree and a packaged build. The sample is
     kept only as a last-resort fallback so a fresh checkout still
     classifies something. */
  const candidates = [
    path.resolve(__dirname, "..", "normalization", "taxonomy.yaml"),
    path.join(process.resourcesPath || "", "normalization", "taxonomy.yaml"),
    path.resolve(__dirname, "..", "normalization", "sample-taxonomy.yaml"),
    path.join(process.resourcesPath || "", "normalization", "sample-taxonomy.yaml"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function runNormalize(opts) {
  const {
    sessionFolder, taxonomyPath, mine, onLog, onProc,
    canonical, pddOut, pddMapImage, stepBpmnOut, phaseBpmnOut, stepCsvOut,
    bootstrapVocabOut, vocabId, vocabName,
  } = opts || {};
  /* onProc(child) fires once with the spawned process handle so the
     caller can install a cancel button. We DON'T expose the promise
     resolver because we want consistent semantics: cancellation
     resolves with a special `{cancelled: true}` result rather than
     rejecting -- callers can decide what to surface to the user. */
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    const script = resolveNormalizeScript();
    const tax = taxonomyPath || resolveDefaultTaxonomy();
    const args = [script];
    if (bootstrapVocabOut) {
      args.push(sessionFolder);
      args.push("--bootstrap-vocab-out", bootstrapVocabOut);
      if (vocabId) args.push("--vocab-id", vocabId);
      if (vocabName) args.push("--vocab-name", vocabName);
    } else {
      args.push(sessionFolder);
      if (tax) args.push("--taxonomy", tax);
      if (mine) args.push("--mine");
      // A remembered Process Template path can go stale (a session matched on
      // another machine, then handed off). Skip a missing file rather than
      // handing normalize.py a dead --canonical path that would crash it.
      if (canonical && fs.existsSync(canonical)) {
        args.push("--canonical", canonical);
      } else if (canonical) {
        try { onLog && onLog(`[viewer] Process Template not found, analyzing without it: ${canonical}\n`); } catch (_) {}
      }
      if (pddOut) args.push("--pdd-out", pddOut);
      if (pddMapImage) args.push("--pdd-map-image", pddMapImage);
      if (stepBpmnOut) args.push("--step-bpmn-out", stepBpmnOut);
      if (phaseBpmnOut) args.push("--phase-bpmn-out", phaseBpmnOut);
      if (stepCsvOut) args.push("--step-csv-out", stepCsvOut);
    }

    const proc = spawn(python, args, {
      cwd: path.dirname(script),
      env: process.env,
      windowsHide: true,
    });
    let cancelled = false;
    // Expose the proc handle so the caller can install a cancel
    // button. The wrapper kill() flips a flag so the close-handler
    // resolves with {cancelled:true} rather than rejecting.
    if (onProc) {
      try {
        onProc({
          kill: () => {
            cancelled = true;
            try { proc.kill("SIGTERM"); } catch (_) {}
            // SIGTERM may not stop a wedged Python on Windows -- give
            // it 500ms then SIGKILL.
            setTimeout(() => { try { proc.kill("SIGKILL"); } catch (_) {} }, 500);
          },
        });
      } catch (_) { /* caller-side error -- ignore */ }
    }
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
      if (cancelled) {
        resolve({ cancelled: true, stdout, stderr });
        return;
      }
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
      resolve({ summary, clusters: summary && summary.clusters, stdout, stderr });
    });
  });
}

module.exports = { runNormalize, resolvePython, resolveNormalizeScript, resolveDefaultTaxonomy };
