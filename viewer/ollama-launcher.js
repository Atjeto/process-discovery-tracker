/*
 * PDT 1.0 Ollama launcher — starts the bundled local LLM server on viewer
 * boot, stops it on viewer exit.
 *
 * PDT-1.0-SPEC §3.2, ADR-0028: the Naming Layer is local-first. The
 * release ships with ollama.exe + a small instruct model bundled under
 * viewer/ollama/ so the AI naming works on machines where Ollama is NOT
 * installed (the analyst's locked-down laptop). This module:
 *
 *   1. Detects the bundle (viewer/ollama/bin/ollama.exe + BUNDLE.json).
 *   2. Picks a free localhost port in the high range to avoid clashing
 *      with any pre-existing Ollama install on the dev box.
 *   3. Starts ollama.exe as a hidden child process, pointed at the
 *      bundled models directory via OLLAMA_MODELS / OLLAMA_HOME.
 *   4. Exposes process.env.PDT_OLLAMA_URL so the Python pipeline (the
 *      embedded interpreter spawned by the renderer) talks to OUR server,
 *      not whatever else is bound to localhost:11434.
 *   5. Cleans the process up on viewer quit / SIGTERM / crash.
 *
 * If the bundle is missing (e.g. dev launch with viewer/ollama/ empty),
 * we fall through to whatever is on the host — the Python backend probe
 * in normalization/naming/llm_client.py handles graceful degrade.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

/* Bundle location resolution:
   - Dev launch: viewer/ollama/ next to the renderer files.
   - Packaged: process.resourcesPath/ollama/ (electron-packager extraResource).
   We probe both and pick whichever exists. */
function _resolveBundleDir() {
  const candidates = [
    path.join(__dirname, "ollama"),
    process.resourcesPath ? path.join(process.resourcesPath, "ollama") : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "bin", "ollama.exe"))) return c;
  }
  return candidates[0];   // first candidate, even if empty (for the "no bundle" branch)
}
const BUNDLE_DIR = _resolveBundleDir();
const BIN = path.join(BUNDLE_DIR, "bin", "ollama.exe");
const MODELS = path.join(BUNDLE_DIR, "models");
const BUNDLE_MARKER = path.join(BUNDLE_DIR, "BUNDLE.json");

let _child = null;
let _port = null;
let _readyPromise = null;

function isBundlePresent() {
  return fs.existsSync(BIN) && fs.existsSync(BUNDLE_MARKER);
}

function readBundleInfo() {
  if (!fs.existsSync(BUNDLE_MARKER)) return null;
  try {
    return JSON.parse(fs.readFileSync(BUNDLE_MARKER, "utf-8"));
  } catch (_) {
    return null;
  }
}

/* Pick a free port. We start in the 11434+ range so a stale Ollama on
   11434 (the dev box default) doesn't trip us up. */
function pickFreePort(start = 11500, end = 11600) {
  return new Promise((resolve, reject) => {
    const tryNext = (p) => {
      if (p > end) {
        reject(new Error("no free port in " + start + "-" + end));
        return;
      }
      const srv = net.createServer();
      srv.once("error", () => tryNext(p + 1));
      srv.once("listening", () => {
        srv.close(() => resolve(p));
      });
      srv.listen(p, "127.0.0.1");
    };
    tryNext(start);
  });
}

function _waitForReady(port, timeoutMs = 30_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("ollama not ready after " + timeoutMs + "ms"));
          return;
        }
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

/**
 * Start the bundled Ollama server. Returns { port, url, model, child } on
 * success, or null when no bundle is present (host-side fallback).
 * Idempotent: a second call returns the cached state.
 */
async function start() {
  if (_child && !_child.killed && _port) {
    return {
      port: _port,
      url: "http://127.0.0.1:" + _port,
      model: (readBundleInfo() || {}).bundled_model,
      child: _child,
      bundled: true,
    };
  }
  if (!isBundlePresent()) {
    console.log("[ollama] no bundle at " + BUNDLE_DIR + " — falling back to host Ollama (or NullBackend)");
    return null;
  }

  const info = readBundleInfo() || {};
  _port = await pickFreePort();
  const url = "http://127.0.0.1:" + _port;
  const env = Object.assign({}, process.env, {
    OLLAMA_MODELS: MODELS,
    OLLAMA_HOME: path.join(BUNDLE_DIR, "data"),
    OLLAMA_HOST: "127.0.0.1:" + _port,
    // We host-net only: never expose the bundle to the LAN.
    OLLAMA_ORIGINS: "http://127.0.0.1," + url,
  });
  // Make sure data dir exists (writable for ollama's runtime state).
  try { fs.mkdirSync(env.OLLAMA_HOME, { recursive: true }); } catch (_) {}

  console.log("[ollama] starting bundled server: " + BIN + " serve");
  console.log("[ollama]   PORT  = " + _port);
  console.log("[ollama]   MODELS = " + MODELS);
  console.log("[ollama]   MODEL  = " + (info.bundled_model || "(unknown)"));

  _child = spawn(BIN, ["serve"], {
    cwd: BUNDLE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
  _child.stdout.on("data", (b) => process.stdout.write("[ollama] " + b.toString()));
  _child.stderr.on("data", (b) => process.stderr.write("[ollama] " + b.toString()));
  _child.on("exit", (code, sig) => {
    console.log("[ollama] server exited code=" + code + " sig=" + sig);
    _child = null;
    _port = null;
    _readyPromise = null;
  });

  _readyPromise = _waitForReady(_port).then(() => {
    console.log("[ollama] ready on " + url);
    // Export so the embedded Python sees our endpoint.
    process.env.PDT_OLLAMA_URL = url;
    if (info.bundled_model) {
      process.env.PDT_OLLAMA_MODEL = info.bundled_model;
    }
    // PDT-1.0-SPEC §3.1 semantic clustering: bundled embedding model.
    if (info.bundled_embed_model) {
      process.env.PDT_OLLAMA_EMBED_MODEL = info.bundled_embed_model;
    }
  }).catch((e) => {
    console.error("[ollama] readiness probe failed:", e.message);
    stop();
    throw e;
  });
  await _readyPromise;

  return {
    port: _port,
    url,
    model: info.bundled_model,
    child: _child,
    bundled: true,
  };
}

function stop() {
  if (_child && !_child.killed) {
    console.log("[ollama] stopping server pid=" + _child.pid);
    try { _child.kill(); } catch (_) {}
  }
  _child = null;
  _port = null;
  _readyPromise = null;
}

function isRunning() {
  return !!(_child && !_child.killed);
}

function getUrl() {
  return _port ? "http://127.0.0.1:" + _port : null;
}

module.exports = {
  start,
  stop,
  isRunning,
  isBundlePresent,
  readBundleInfo,
  getUrl,
};
