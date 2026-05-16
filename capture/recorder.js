"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");

function resolveRecorderPath(bootLog) {
  /* The packaged layout varies by how electron-packager handles
     --extra-resource. The source --extra-resource=recorder/publish ends
     up at resources/publish/ (basename-of-source rule), so check both
     names. */
  const candidates = [
    process.env.PDT_RECORDER_PATH,
    path.join(process.resourcesPath || "", "recorder", "recorder.exe"),
    path.join(process.resourcesPath || "", "publish", "recorder.exe"),
    path.join(__dirname, "recorder", "publish", "recorder.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;

  /* recorder.exe is too big for a single GitHub-tracked file (>100 MB
     compressed self-contained .NET single-file), so the build pipeline
     ships it as recorder.zip alongside where the .exe would land. On
     first run, extract it in place. Win10+ bundles tar.exe with libarchive,
     which handles .zip without third-party deps. */
  const zipCandidates = candidates
    .filter((c) => c && c !== process.env.PDT_RECORDER_PATH)
    .map((c) => c.replace(/recorder\.exe$/i, "recorder.zip"));
  for (const zip of zipCandidates) {
    if (!fs.existsSync(zip)) continue;
    const targetDir = path.dirname(zip);
    if (bootLog) bootLog(`[recorder] extracting ${zip} -> ${targetDir}`);
    const r = spawnSync("tar.exe", ["-xf", zip, "-C", targetDir], { windowsHide: true });
    if (r.status === 0) {
      const exe = path.join(targetDir, "recorder.exe");
      if (fs.existsSync(exe)) return exe;
    }
    if (bootLog) bootLog(`[recorder] tar extract failed (status=${r.status}): ${(r.stderr || "").toString().slice(0, 200)}`);
  }

  throw new Error("recorder.exe not found in any candidate path (and no recorder.zip to extract)");
}

function spawnRecorder({ sessionId, recorderPath, verbose, onEvent, onWarning, onStats, onExit, bootLog }) {
  const exe = recorderPath || resolveRecorderPath(bootLog);
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  const rl = readline.createInterface({ input: child.stdout });
  let lastLineMs = Date.now();
  rl.on("line", (line) => {
    lastLineMs = Date.now();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_e) {
      if (onWarning) onWarning({ msg: "malformed sidecar line", detail: line.slice(0, 200) });
      return;
    }
    if (msg.v !== 1) {
      if (onWarning) onWarning({ msg: "unknown protocol version", detail: String(msg.v) });
      return;
    }
    if (msg.type === "interaction" && onEvent) onEvent(msg.data);
    else if (msg.type === "warning" && onWarning) onWarning(msg);
    else if (msg.type === "stats" && onStats) onStats(msg.data);
    else if (msg.type === "ready" && bootLog) bootLog("[recorder] ready");
  });

  const rlErr = readline.createInterface({ input: child.stderr });
  rlErr.on("line", (line) => bootLog && bootLog(`[recorder.stderr] ${line}`));

  /* Liveness watchdog. The C# sidecar emits a stats line every 30s
     regardless of UI activity, so a stdout silent far longer than that
     means the sidecar is wedged (hung, not exited). Kill it and let the
     exit handler run the parent's normal restart path. */
  const RECORDER_QUIET_TIMEOUT_MS = 90_000;
  let exited = false;
  const watchdog = setInterval(() => {
    if (exited) return;
    const quietMs = Date.now() - lastLineMs;
    if (quietMs > RECORDER_QUIET_TIMEOUT_MS) {
      if (onWarning) onWarning({ msg: "recorder unresponsive", detail: `${quietMs}ms since last line; terminating` });
      try { child.kill(); } catch (_) { /* already gone */ }
    }
  }, 30_000);
  watchdog.unref();

  child.on("exit", (code, signal) => {
    exited = true;
    clearInterval(watchdog);
    if (onExit) onExit({ code, signal });
  });
  /* Swallow EPIPE on stdin so a dead sidecar doesn't crash the parent
     when we try to send pause/resume/shutdown after-the-fact. */
  child.stdin.on("error", (e) => bootLog && bootLog(`[recorder.stdin] ${e && e.message}`));

  function safeWrite(obj) {
    try {
      if (child.stdin.writable) child.stdin.write(JSON.stringify(obj) + "\n");
    } catch (_) { /* sidecar already exited */ }
  }

  // Send hello. `verbose: true` opts into the raw firehose (focus_changed,
  // text_changed, per-keystroke value_changed) for forensic debugging.
  safeWrite({
    cmd: "hello",
    session_id: sessionId,
    schema_version: 1,
    verbose: !!verbose,
  });

  return {
    child,
    pause: () => safeWrite({ cmd: "pause" }),
    resume: () => safeWrite({ cmd: "resume" }),
    stop: (opts) => new Promise((resolve) => {
      const drainMs = (opts && opts.drainTimeoutMs) || 1500;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      child.on("exit", finish);
      safeWrite({ cmd: "shutdown" });
      setTimeout(() => {
        if (done) return;
        try { child.kill("SIGTERM"); } catch (_) {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} finish(); }, 500);
      }, drainMs);
    }),
  };
}

module.exports = { spawnRecorder, resolveRecorderPath };
