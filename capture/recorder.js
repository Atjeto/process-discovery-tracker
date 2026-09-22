"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");

function recorderExeCandidates() {
  /* The packaged layout varies by how electron-packager handles
     --extra-resource. The source --extra-resource=recorder/publish ends
     up at resources/publish/ (basename-of-source rule), so check both
     names. */
  return [
    process.env.PDT_RECORDER_PATH,
    path.join(process.resourcesPath || "", "recorder", "recorder.exe"),
    path.join(process.resourcesPath || "", "publish", "recorder.exe"),
    path.join(__dirname, "recorder", "publish", "recorder.exe"),
  ].filter(Boolean);
}

function recorderZipCandidates() {
  /* recorder.exe is too big for a single GitHub-tracked file (>100 MB
     compressed self-contained .NET single-file), so the build pipeline
     ships it as recorder.zip alongside where the .exe would land. */
  return recorderExeCandidates()
    .filter((c) => c && c !== process.env.PDT_RECORDER_PATH)
    .map((c) => c.replace(/recorder\.exe$/i, "recorder.zip"));
}

function findRecorderExe() {
  for (const c of recorderExeCandidates()) if (fs.existsSync(c)) return c;
  return null;
}

function findRecorderZip() {
  for (const z of recorderZipCandidates()) if (fs.existsSync(z)) return z;
  return null;
}

function resolveRecorderPath(bootLog) {
  const exe = findRecorderExe();
  if (exe) return exe;

  /* Fallback path for callers that didn't run `ensureRecorderExtracted`
     at app launch: do a one-shot synchronous extract. Normal session
     starts no longer hit this since main.js extracts during whenReady. */
  const zip = findRecorderZip();
  if (zip) {
    const targetDir = path.dirname(zip);
    if (bootLog) bootLog(`[recorder] sync-extracting ${zip} -> ${targetDir} (fallback path)`);
    const r = spawnSync("tar.exe", ["-xf", zip, "-C", targetDir], { windowsHide: true });
    if (r.status === 0) {
      const found = path.join(targetDir, "recorder.exe");
      if (fs.existsSync(found)) return found;
    }
    if (bootLog) bootLog(`[recorder] tar extract failed (status=${r.status}): ${(r.stderr || "").toString().slice(0, 200)}`);
  }

  throw new Error("recorder.exe not found in any candidate path (and no recorder.zip to extract)");
}

/* Asynchronously ensure recorder.exe is on disk. Returns:
   - { ok: true, alreadyPresent: true, exe }     — nothing to do
   - { ok: true, extracted: true, exe }          — extracted from zip
   - { ok: false, reason: "no-zip" }             — neither exe nor zip
                                                   (dev box without the
                                                   built recorder; OK)
   - { ok: false, reason: "extract-failed", ... } — tar exit != 0
   Called at app launch from main.js so the first session start never
   pays the multi-second extraction cost (recorder.zip is >100 MB). */
function ensureRecorderExtracted({ bootLog, onStart } = {}) {
  return new Promise((resolve) => {
    const exe = findRecorderExe();
    if (exe) { resolve({ ok: true, alreadyPresent: true, exe }); return; }
    const zip = findRecorderZip();
    if (!zip) { resolve({ ok: false, reason: "no-zip" }); return; }
    const targetDir = path.dirname(zip);
    if (bootLog) bootLog(`[recorder] async-extracting ${zip} -> ${targetDir}`);
    if (onStart) { try { onStart(); } catch (_) {} }
    const child = spawn("tar.exe", ["-xf", zip, "-C", targetDir], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => {
      if (bootLog) bootLog(`[recorder] tar spawn error: ${e && e.message}`);
      resolve({ ok: false, reason: "spawn-failed", error: String(e && e.message) });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        const found = path.join(targetDir, "recorder.exe");
        if (fs.existsSync(found)) {
          if (bootLog) bootLog(`[recorder] extracted ${found}`);
          resolve({ ok: true, extracted: true, exe: found });
          return;
        }
      }
      if (bootLog) bootLog(`[recorder] async tar extract failed (status=${code}): ${stderr.slice(0, 200)}`);
      resolve({ ok: false, reason: "extract-failed", status: code, stderr: stderr.slice(0, 200) });
    });
  });
}

/* `spawnFn` is child_process.spawn; the unit tests pass a fake child. */
function spawnRecorder({ sessionId, recorderPath, verbose, debounceMs, ocr, onEvent, onWarning, onStats, onExit, onSnapshotControl, onSnapshotDone, onReady, bootLog, spawnFn = spawn }) {
  const exe = recorderPath || resolveRecorderPath(bootLog);
  const child = spawnFn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

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
    // ADR-0025 in-app vocabulary discovery: a one-shot `snapshot` command
    // streams snapshot_control lines (one per identifiable control) then a
    // snapshot_done per pass. Transient -- never written to events.jsonl.
    else if (msg.type === "snapshot_control" && onSnapshotControl) onSnapshotControl(msg.data);
    else if (msg.type === "snapshot_done" && onSnapshotDone) onSnapshotDone(msg.data);
    else if (msg.type === "ready") {
      if (bootLog) bootLog("[recorder] ready");
      // §E1 readiness probe: positive confirmation the sidecar came up.
      if (onReady) { try { onReady(); } catch (_) {} }
    }
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

  /* The end of the process is reported to onExit exactly once. RP-22: a
     spawn failure (bad path, blocked by policy) emits 'error' and never
     'exit' -- with no 'error' listener it was an uncaught exception and the
     caller never heard of it (no recorder_died, no restart), while
     events.jsonl already said recorder_start. */
  let exitReported = false;
  function reportExit(info) {
    if (exitReported) return;
    exitReported = true;
    exited = true;
    clearInterval(watchdog);
    if (onExit) onExit(info);
  }
  child.on("exit", (code, signal) => reportExit({ code, signal }));
  child.on("error", (err) => {
    if (bootLog) bootLog(`[recorder] process error: ${err && err.message}`);
    // No pid = the process never started. (A failed kill() after a
    // successful spawn also emits 'error'; that process is still alive and
    // its 'exit' reports the real end.)
    if (child.pid === undefined) {
      reportExit({ code: null, signal: null, error: String(err && err.message) });
    }
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
  // `debounce_ms` tunes the value_changed coalescing window; the recorder
  // falls back to its own default when the field is absent. `ocr: true`
  // enables the §11e OCR last-resort rung for known low-UIA apps (default
  // off -- trades latency on identityless elements for a recovered label).
  safeWrite({
    cmd: "hello",
    session_id: sessionId,
    schema_version: 1,
    verbose: !!verbose,
    debounce_ms: debounceMs,
    ocr: !!ocr,
    // The capture app's own exe so the recorder never records PDT's OWN windows
    // (operator panel / dialogs) as interactions. All of PDT's
    // Electron processes share this exe name. Normalization is the analyst-side
    // safety net (process_filter) for sessions captured before this existed.
    host_process: require("node:path").basename(process.execPath),
  });

  return {
    child,
    pause: () => safeWrite({ cmd: "pause" }),
    resume: () => safeWrite({ cmd: "resume" }),
    // ADR-0025: ask the recorder to walk the target window's UIA subtree and
    // stream every control (per pass). `target` is "foreground" or a decimal
    // HWND; `passes` (default 2) walks twice ≥1s apart so the picker can diff
    // for volatile automation_ids. Results arrive via the onSnapshotControl /
    // onSnapshotDone callbacks above.
    snapshot: ({ target = "foreground", passes = 2 } = {}) =>
      safeWrite({ cmd: "snapshot", target, passes }),
    stop: (opts) => new Promise((resolve) => {
      const drainMs = (opts && opts.drainTimeoutMs) || 1500;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      // RP-23: 'close', not 'exit' -- 'close' fires after the stdio streams
      // have ended, so every line the recorder flushed on shutdown (the last
      // typed values) has reached onEvent before the caller moves on.
      child.on("close", finish);
      safeWrite({ cmd: "shutdown" });
      setTimeout(() => {
        if (done) return;
        try { child.kill("SIGTERM"); } catch (_) {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} finish(); }, 500);
      }, drainMs);
    }),
  };
}

/*
 * Per-session supervision of the recorder sidecar (RP-20). Spawns it and, on
 * a crash -- a non-zero or signalled exit, or a spawn failure (RP-22) --
 * re-spawns it after restartDelayMs, at most maxRestarts times. The restart
 * budget belongs to this supervisor, which main.js creates once per session:
 * a successful re-spawn never refills it, so a crash-looping recorder reaches
 * the cap and onDead fires. (Before RP-20 main.js reset the count on every
 * successful spawn, auto-restarts included, so the cap was never reached and
 * recorder_dead_permanent never fired.)
 *
 * The first spawn throws to the caller exactly like spawnRecorder (no
 * recorder.exe); a re-spawn that throws counts as one more crash.
 */
function superviseRecorder({
  spawnOpts, autoRestart, maxRestarts, restartDelayMs = 5000, schedule = setTimeout,
  onStarted, onDied, onDead,
}) {
  let current = null;
  let restartCount = 0;
  let stopped = false;

  function launch() {
    current = spawnRecorder({ ...spawnOpts, onExit: handleExit });
    onStarted();
  }

  function relaunch() {
    if (stopped) return;
    try {
      launch();
    } catch (e) {
      if (spawnOpts.bootLog) spawnOpts.bootLog(`[recorder] re-spawn failed: ${e && e.message}`);
      handleExit({ code: null, signal: null, error: String(e && e.message) });
    }
  }

  function handleExit(info) {
    current = null;
    if (stopped) return;                           // the session is ending
    if (info.code === 0 && !info.signal) return;   // a clean shutdown
    onDied({ code: info.code, signal: info.signal, restart_count: restartCount });
    if (autoRestart && restartCount < maxRestarts) {
      restartCount += 1;
      schedule(relaunch, restartDelayMs);
    } else {
      onDead();
    }
  }

  launch();
  return {
    /* The live recorder handle, or null while restarting / after death. */
    current: () => current,
    restartCount: () => restartCount,
    async stop(opts) {
      stopped = true;
      const child = current;
      current = null;
      if (child) await child.stop(opts);
    },
  };
}

module.exports = { spawnRecorder, superviseRecorder, resolveRecorderPath, ensureRecorderExtracted };
