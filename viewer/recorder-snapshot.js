/*
 * recorder-snapshot.js -- drive the C# recorder's one-shot `snapshot`
 * command from the viewer (ADR-0025 in-app vocabulary discovery).
 *
 * The viewer already spawns the bundled Python (python-runner.js); this
 * spawns the recorder the same way and speaks just enough of the stdio
 * protocol to run a two-pass window snapshot: send `{cmd:"snapshot",...}`,
 * collect every `snapshot_control` line, and resolve once `snapshot_done`
 * has fired for every pass. No `hello` is needed -- the snapshot path is
 * independent of the interaction-subscription lifecycle.
 *
 * The snapshot is transient: nothing is written to disk, nothing leaves the
 * box. It runs entirely on the analyst's machine, like normalization.
 */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");

/* Where the recorder.exe lives. The viewer and capture are separate apps,
   so we probe the dev-tree capture build and the packaged resource layouts,
   plus an explicit PDT_RECORDER_PATH override (matches capture/recorder.js). */
function resolveRecorderExe() {
  const candidates = [
    process.env.PDT_RECORDER_PATH,
    path.resolve(__dirname, "..", "capture", "recorder", "publish", "recorder.exe"),
    path.join(process.resourcesPath || "", "recorder", "recorder.exe"),
    path.join(process.resourcesPath || "", "publish", "recorder.exe"),
    path.join(__dirname, "recorder", "recorder.exe"),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return null;
}

/* Run a two-pass snapshot of the target window. Resolves with
   { controls: [...], window_title, passes } or rejects on a hard failure.
   `target` is "foreground" or a decimal HWND string; `passes` defaults to 2
   (two passes >=1s apart so the picker can diff for volatile ids). */
function snapshotWindow({ target = "foreground", passes = 2, timeoutMs = 30000, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const exe = resolveRecorderExe();
    if (!exe) {
      reject(new Error("recorder.exe not found (build it with `npm run build:recorder` in capture/, or set PDT_RECORDER_PATH)"));
      return;
    }
    const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const controls = [];
    let windowTitle = null;
    let donePasses = 0;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child.stdin.writable) child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n"); } catch (_) {}
      // Give the recorder a moment to drain, then ensure it's gone.
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 400);
      if (err) reject(err); else resolve(value);
    };

    const timer = setTimeout(
      () => finish(new Error(`snapshot timed out after ${timeoutMs}ms (${donePasses}/${passes} passes)`)),
      timeoutMs);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { return; }
      if (msg.v !== 1) return;
      if (msg.type === "snapshot_control" && msg.data) {
        controls.push(msg.data);
      } else if (msg.type === "snapshot_done") {
        donePasses++;
        if (msg.data && msg.data.window_title) windowTitle = msg.data.window_title;
        if (donePasses >= passes) finish(null, { controls, window_title: windowTitle, passes });
      } else if (msg.type === "ready") {
        // Recorder is up; ask for the snapshot now.
        try {
          child.stdin.write(JSON.stringify({ cmd: "snapshot", target, passes }) + "\n");
        } catch (e) { finish(new Error("failed to send snapshot command: " + e.message)); }
      }
    });

    const rlErr = readline.createInterface({ input: child.stderr });
    rlErr.on("line", (l) => { if (onLog) onLog(`[recorder.stderr] ${l}`); });

    child.on("error", (e) => finish(new Error("failed to spawn recorder: " + e.message)));
    child.on("exit", (code) => {
      if (settled) return;
      // Exited before completing the passes -> report what we have.
      if (donePasses > 0) finish(null, { controls, window_title: windowTitle, passes: donePasses });
      else finish(new Error(`recorder exited (code ${code}) before any snapshot pass`));
    });
    child.stdin.on("error", () => { /* swallow EPIPE if the recorder died */ });
  });
}

module.exports = { snapshotWindow, resolveRecorderExe };
