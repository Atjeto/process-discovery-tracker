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

/* The normalize.py command line (after the interpreter) for one run. Pure, so
   the unit tests pin it. `libraryPath` is the app's activity library
   (contract C21): the first analysis of a project copies it into the project
   folder, and the drafts are named from the project's copy.
   `pddMapImages` is the manifest of the sub-processes' map pictures
   (contract C19). `techOut` is the Technical details workbook and `handoff`
   the hand-off version the PDD and the workbook are made for (contract C20,
   lane HV). `pddAttachments` is the folder beside the PDD its attachments
   travel in (2.0.1): the PDD links their names there. */
function buildNormalizeArgs(script, opts) {
  const {
    sessionFolder, taxonomyPath, mine, pddOut, pddMapImage, pddTobeImage, pddMapImages, libraryPath,
    techOut, handoff, pddAttachments,
  } = opts || {};
  const args = [script, sessionFolder];
  if (taxonomyPath) args.push("--taxonomy", taxonomyPath);
  if (mine) args.push("--mine");
  if (pddOut) args.push("--pdd-out", pddOut);
  if (pddMapImage) args.push("--pdd-map-image", pddMapImage);
  if (pddTobeImage) args.push("--pdd-tobe-image", pddTobeImage);
  if (pddMapImages) args.push("--pdd-map-images", pddMapImages);
  if (techOut) args.push("--tech-out", techOut);
  if (Number.isInteger(handoff) && handoff >= 1) args.push("--handoff", String(handoff));
  if (pddOut && pddAttachments) args.push("--pdd-attachments", pddAttachments);
  if (libraryPath) args.push("--library", libraryPath);
  return args;
}

/* Whether the normalize.py at `script` takes the command line flag `flag`
   ("--library"): its source defines it. Read once per script. The viewer
   passes --library only to a pipeline that has it (lane LIB-V was built
   before the pipeline's lane LIB-P was merged). */
const _flags = new Map();
function scriptTakesFlag(script, flag) {
  const k = String(script) + "\n" + flag;
  if (!_flags.has(k)) {
    let has = false;
    try { has = fs.readFileSync(script, "utf8").includes('"' + flag + '"'); } catch (_) { has = false; }
    _flags.set(k, has);
  }
  return _flags.get(k);
}

function runNormalize(opts) {
  const { taxonomyPath, onLog, onProc } = opts || {};
  /* onProc(child) fires once with the spawned process handle so the
     caller can install a cancel button. We DON'T expose the promise
     resolver because we want consistent semantics: cancellation
     resolves with a special `{cancelled: true}` result rather than
     rejecting -- callers can decide what to surface to the user. */
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    const script = resolveNormalizeScript();
    const tax = taxonomyPath || resolveDefaultTaxonomy();
    // C21: the library goes only to a pipeline that takes it (scriptTakesFlag).
    const libraryPath = opts && opts.libraryPath && scriptTakesFlag(script, "--library") ? opts.libraryPath : null;
    const args = buildNormalizeArgs(script, Object.assign({}, opts, { taxonomyPath: tax, libraryPath }));

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
    proc.on("close", (code, signal) => {
      if (cancelled) {
        resolve({ cancelled: true, stdout, stderr });
        return;
      }
      if (code !== 0) {
        // Contract C13: any non-zero exit is a failure. The exit code and the
        // full stderr ride on the error so the caller can show the pipeline's
        // "[normalize] ERROR:" line (normalize-result.js), not a stack dump.
        const err = new Error(code === null
          ? `normalize.py was stopped (${signal || "no exit code"})`
          : `normalize.py exited ${code}`);
        err.exitCode = code;
        err.signal = signal || null;
        err.stderr = stderr;
        reject(err);
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

/* Contract C8: transcript_import.py sits beside normalize.py (the dev tree
   and the package's resources/normalization alike). */
function resolveTranscriptScript() {
  return path.join(path.dirname(resolveNormalizeScript()), "transcript_import.py");
}

/* Run `transcript_import.py <sessionFolder> <file>` with the interpreter
   normalize.py uses. Resolves { code, signal, stdout, stderr } (the script
   prints UTF-8); rejects only when Python cannot be started. */
function runTranscriptImport(opts) {
  const { sessionFolder, file } = opts || {};
  return new Promise((resolve, reject) => {
    const script = resolveTranscriptScript();
    const proc = spawn(resolvePython(), [script, sessionFolder, file], {
      cwd: path.dirname(script), env: process.env, windowsHide: true,
    });
    const out = [], err = [];
    proc.stdout.on("data", (b) => out.push(b));
    proc.stderr.on("data", (b) => err.push(b));
    proc.on("error", (e) => reject(new Error("Python could not be started: " + e.message)));
    proc.on("close", (code, signal) => resolve({
      code, signal: signal || null,
      stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"),
    }));
  });
}

const TRANSCRIPT_ERROR_PREFIX = "[transcript] ERROR:";

/* The viewer:importTranscript result for one run of the script. Exit 0:
   { ok: true, summary } (the stdout line). Otherwise { ok: false, code,
   error } where error is the script's "[transcript] ERROR:" line without
   that prefix, or, when it printed none (a crash), what it did print. */
function transcriptImportResult(run) {
  const r = run || {};
  const lines = (s) => String(s || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (r.code === 0) {
    const out = lines(r.stdout);
    return { ok: true, summary: out.length ? out[out.length - 1] : "" };
  }
  const errLines = lines(r.stderr);
  const tagged = errLines.filter((l) => l.startsWith(TRANSCRIPT_ERROR_PREFIX)).pop();
  const error = tagged
    ? tagged.slice(TRANSCRIPT_ERROR_PREFIX.length).trim()
    : "the transcript import stopped (" + (r.code == null ? "no exit code" : "exit " + r.code) + ")" +
      (errLines.length ? ": " + errLines[errLines.length - 1] : "");
  return { ok: false, code: r.code == null ? null : r.code, error };
}

module.exports = {
  runNormalize, buildNormalizeArgs, scriptTakesFlag, resolvePython, resolveNormalizeScript, resolveDefaultTaxonomy,
  resolveTranscriptScript, runTranscriptImport, transcriptImportResult,
};
