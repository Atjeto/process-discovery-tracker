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

/* The ordered recorder.exe paths to probe. Pure (no fs/process reads of its
   own) so it can be unit-tested against a synthetic layout. The viewer and
   capture are SEPARATE packaged apps, so a deployed viewer finds the recorder in
   a SIBLING capture folder (the recommended deploy: extract viewer/ and capture/
   side by side); the dev tree finds it via the repo's capture/ sibling; and
   PDT_RECORDER_PATH overrides everything. Order = precedence. */
function recorderExeCandidates({ env = {}, dirname, resourcesPath = null, readdir } = {}) {
  const out = [
    env.PDT_RECORDER_PATH,
    // Dev tree: viewer/ and capture/ are siblings in the repo.
    path.resolve(dirname, "..", "capture", "recorder", "publish", "recorder.exe"),
    // Recorder bundled into the viewer's own resources (not the default build).
    resourcesPath ? path.join(resourcesPath, "recorder", "recorder.exe") : null,
    resourcesPath ? path.join(resourcesPath, "publish", "recorder.exe") : null,
    path.join(dirname, "recorder", "recorder.exe"),
  ];
  // Packaged viewer + a SIBLING packaged capture app. The capture dist bundles
  // the recorder at <capture>/resources/publish/recorder.exe; with viewer/ and
  // capture/ deployed side by side, <viewer>/../capture/... resolves to it.
  if (resourcesPath) {
    const appRoot = path.dirname(resourcesPath);   // <deploy>/viewer
    const parent = path.dirname(appRoot);          // <deploy>
    // The conventional dist/ folder name first.
    out.push(path.join(parent, "capture", "resources", "publish", "recorder.exe"));
    // Then any OTHER sibling app folder carrying a bundled recorder, so the two
    // dist folders still pair up even if renamed on the destination PC.
    let names = [];
    try { if (typeof readdir === "function") names = readdir(parent) || []; } catch (_) { names = []; }
    for (const name of names) {
      const dir = path.join(parent, name);
      if (path.resolve(dir) === path.resolve(appRoot)) continue;   // skip self
      out.push(path.join(dir, "resources", "publish", "recorder.exe"));
      out.push(path.join(dir, "resources", "recorder", "recorder.exe"));
    }
  }
  // De-dup, preserving order: the explicit capture/ path and the sibling scan
  // overlap, and a bundled-in-viewer path can repeat the scan's self entry.
  return [...new Set(out.filter(Boolean))];
}

/* First existing recorder.exe among the candidate paths, or null. */
function resolveRecorderExe() {
  const candidates = recorderExeCandidates({
    env: process.env,
    dirname: __dirname,
    resourcesPath: process.resourcesPath || null,
    readdir: (d) => fs.readdirSync(d),
  });
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
      reject(new Error("recorder.exe not found. On a deployed machine, place the capture app folder beside the viewer (extract capture/ next to viewer/), or set PDT_RECORDER_PATH. In a dev tree, build it with `npm run build:recorder` in capture/."));
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

/* ADR-0025 point-and-click window pick. Spawns the recorder, enters its `pick`
   standby, and resolves with { hwnd, window_title, process_id } once the operator
   clicks a window — or { cancelled, reason } on Esc/timeout. The viewer shows a
   confirmation and then calls snapshotWindow({ target: hwnd }). This replaces the
   foreground snapshot, whose own button click stole the foreground. */
function pickWindow({ timeoutMs = 35000, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const exe = resolveRecorderExe();
    if (!exe) {
      reject(new Error("recorder.exe not found. On a deployed machine, place the capture app folder beside the viewer (extract capture/ next to viewer/), or set PDT_RECORDER_PATH. In a dev tree, build it with `npm run build:recorder` in capture/."));
      return;
    }
    const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child.stdin.writable) child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n"); } catch (_) {}
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 300);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`window pick timed out after ${timeoutMs}ms`)), timeoutMs);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { return; }
      if (msg.v !== 1) return;
      if (msg.type === "ready") {
        // Ask the recorder to wait for the click; give it slightly less than our
        // own timer so it self-cancels first and we get a clean pick_cancelled.
        try {
          child.stdin.write(JSON.stringify({ cmd: "pick", timeout_ms: Math.max(1000, timeoutMs - 3000) }) + "\n");
        } catch (e) { finish(new Error("failed to send pick command: " + e.message)); }
      } else if (msg.type === "picked" && msg.data) {
        finish(null, {
          hwnd: String(msg.data.hwnd),
          window_title: msg.data.window_title || "",
          process_id: msg.data.process_id,
        });
      } else if (msg.type === "pick_cancelled") {
        finish(null, { cancelled: true, reason: (msg.data && msg.data.reason) || "cancelled" });
      }
    });
    const rlErr = readline.createInterface({ input: child.stderr });
    rlErr.on("line", (l) => { if (onLog) onLog(`[recorder.stderr] ${l}`); });

    child.on("error", (e) => finish(new Error("failed to spawn recorder: " + e.message)));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`recorder exited (code ${code}) before a window was picked`));
    });
    child.stdin.on("error", () => { /* swallow EPIPE if the recorder died */ });
  });
}

module.exports = { snapshotWindow, pickWindow, resolveRecorderExe, recorderExeCandidates };
