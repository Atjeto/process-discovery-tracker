"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");

function resolveRecorderPath() {
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
  throw new Error("recorder.exe not found in any candidate path");
}

function spawnRecorder({ sessionId, recorderPath, onEvent, onWarning, onStats, onExit, bootLog }) {
  const exe = recorderPath || resolveRecorderPath();
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
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

  child.on("exit", (code, signal) => onExit && onExit({ code, signal }));
  /* Swallow EPIPE on stdin so a dead sidecar doesn't crash the parent
     when we try to send pause/resume/shutdown after-the-fact. */
  child.stdin.on("error", (e) => bootLog && bootLog(`[recorder.stdin] ${e && e.message}`));

  function safeWrite(obj) {
    try {
      if (child.stdin.writable) child.stdin.write(JSON.stringify(obj) + "\n");
    } catch (_) { /* sidecar already exited */ }
  }

  // Send hello
  safeWrite({ cmd: "hello", session_id: sessionId, schema_version: 1 });

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
