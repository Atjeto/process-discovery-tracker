/*
 * Pre-pilot readiness check (lab-phase §E1).
 *
 * Run before any pilot day -- the first session on a machine you are not
 * sitting at must not fail silently. Three checks:
 *
 *   1. Disk space on the session target AND on the temp drive (the
 *      C:-drive-full failure class: the self-contained recorder extracts
 *      ~200 MB to %TEMP%; with a full drive it starts, captures nothing,
 *      and the session ends with 0 interaction events).
 *   2. The recorder sidecar starts (its `ready` line arrives) and UI
 *      Automation is reachable (a window snapshot returns controls).
 *   3. Per-running-app trust tier -- rich / basic / minimal / wall --
 *      derived from a short UIA snapshot probe of each visible top-level
 *      window, using the same §11e identity/framework/confidence fields
 *      the recorder stamps on captured interactions. The tier tells the
 *      operator, BEFORE the pilot, which apps will capture richly and
 *      which are a wall (elevated, remote/terminal, UIA-dark).
 *
 * Pure scoring/summary helpers live here with injectable seams
 * (spawnRecorderFn / listWindowsFn / statfs) so the orchestration is
 * unit-testable without a live desktop; main.js supplies the real seams
 * for the tray item and the --readiness CLI.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

/* Session target below DISK_FAIL_GB free = not ready (screenshots + an
   8-hour events.jsonl need real headroom); below DISK_WARN_GB = warn.
   The temp drive only needs the recorder's ~200 MB self-extract, so its
   fail bar is lower. */
const DISK_FAIL_GB = 2;
const DISK_WARN_GB = 10;
const TEMP_FAIL_GB = 1;

const GB = 1024 * 1024 * 1024;

/* ---------------------------------------------------------------- disk */

/* The target may not exist yet (a first run's session dir, an extract
   dir .NET creates on demand) -- measure the volume via the nearest
   existing ancestor instead of failing on ENOENT. */
function nearestExistingAncestor(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return d;
}

function checkDisk(label, dir, { failGb, warnGb, statfs = fs.statfsSync } = {}) {
  try {
    const s = statfs(nearestExistingAncestor(dir));
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    const freeGb = Math.round((freeBytes / GB) * 10) / 10;
    let status = "ok";
    if (freeGb < failGb) status = "fail";
    else if (warnGb != null && freeGb < warnGb) status = "warn";
    const note =
      status === "fail"
        ? `only ${freeGb} GB free (< ${failGb} GB) -- a session here WILL lose data`
        : status === "warn"
          ? `${freeGb} GB free (< ${warnGb} GB) -- fine for one session, tight for a pilot week`
          : `${freeGb} GB free`;
    return { label, dir, status, free_gb: freeGb, note };
  } catch (e) {
    return {
      label, dir, status: "fail", free_gb: null,
      note: `could not stat: ${e && e.message}`,
    };
  }
}

/* ---------------------------------------------------- per-app trust tier */

/*
 * Tier a window's snapshot controls. Mirrors the recorder's own §11e
 * semantics (ADR-0023): the snapshot walker only emits identity-bearing
 * controls, each carrying identity_source (automation_id > name >
 * class_name), a confidence in [0,1] blended with the detected
 * framework, and the framework itself.
 *
 *   wall    -- nothing identifiable came back (elevated process, UIA-dark
 *              surface) or the surface is remote/terminal, where captured
 *              fields are proxies for the real (pixel) controls.
 *   minimal -- controls exist but identity is mostly class_name
 *              (mean confidence < 0.5): expect thin, low-trust capture.
 *   basic   -- accessible names dominate (typical Chromium web app):
 *              honest capture, but few stable automation_ids.
 *   rich    -- a real share of stable automation_ids at high confidence.
 */
function computeAppTier(controls) {
  const list = Array.isArray(controls) ? controls : [];
  const n = list.length;
  if (n === 0) {
    return {
      tier: "wall", n_controls: 0, share_automation_id: 0,
      mean_confidence: 0, dominant_framework: null,
      note: "the recorder couldn't see any controls in this window -- the app may run as administrator or block accessibility tools",
    };
  }
  const fwTally = {};
  let aid = 0;
  let confSum = 0;
  for (const c of list) {
    const fw = (c && c.framework) || "unknown";
    fwTally[fw] = (fwTally[fw] || 0) + 1;
    if (c && c.identity_source === "automation_id") aid += 1;
    confSum += (c && typeof c.confidence === "number") ? c.confidence : 0;
  }
  const dominant = Object.keys(fwTally).sort((a, b) => fwTally[b] - fwTally[a])[0];
  const shareAid = aid / n;
  const meanConf = Math.round((confSum / n) * 100) / 100;
  const base = {
    n_controls: n,
    share_automation_id: Math.round(shareAid * 100) / 100,
    mean_confidence: meanConf,
    dominant_framework: dominant,
  };
  if (dominant === "remote" || dominant === "terminal") {
    return {
      tier: "wall", ...base,
      note: `a ${dominant} window -- the recorder sees only the window frame, not the controls inside; plan markers + video here`,
    };
  }
  if (shareAid >= 0.25 && meanConf >= 0.6) {
    return { tier: "rich", ...base, note: "controls are reliably identifiable -- best capture quality" };
  }
  if (meanConf >= 0.5) {
    return { tier: "basic", ...base, note: "controls have readable names but few stable ids -- capture works, with some detail lost" };
  }
  return { tier: "minimal", ...base, note: "controls are mostly anonymous -- expect thin detail from this app" };
}

/* ----------------------------------------------- window enumeration seam */

/*
 * Visible top-level windows via PowerShell (Get-Process). Used only by
 * the readiness probe -- a pre-pilot tool, not the capture hot path.
 * Resolves [] on any failure; never rejects.
 */
function listTopWindows({ spawnFn = spawn, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child;
    try {
      child = spawnFn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | " +
        "Select-Object Name, Id, MainWindowTitle, @{n='hwnd';e={[int64]$_.MainWindowHandle}} | " +
        "ConvertTo-Json -Compress",
      ], { windowsHide: true });
    } catch (_e) {
      finish([]);
      return;
    }
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", () => finish([]));
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} finish([]); }, timeoutMs);
    child.on("exit", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out || "[]");
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        finish(arr
          .filter((w) => w && w.hwnd && w.MainWindowTitle)
          .map((w) => ({
            app: `${w.Name}.exe`,
            pid: w.Id,
            title: String(w.MainWindowTitle),
            hwnd: Number(w.hwnd),
          })));
      } catch (_e) {
        finish([]);
      }
    });
  });
}

/* -------------------------------------------------------- orchestration */

/*
 * Run the full readiness probe. All side-effectful seams are injectable:
 *   sessionTarget    -- the sessions base dir (disk check + report home)
 *   tempDir          -- recorder self-extract target (default os.tmpdir())
 *   hostExeName      -- our own exe, excluded from the app probe
 *   spawnRecorderFn  -- recorder.js spawnRecorder (or a fake in tests)
 *   listWindowsFn    -- listTopWindows (or a fake)
 *   statfs           -- fs.statfsSync (or a fake)
 * Returns the report object; never throws for a failing CHECK (failures
 * land in the report), only for programmer error.
 */
async function runReadinessProbe({
  sessionTarget,
  tempDir = os.tmpdir(),
  hostExeName = null,
  spawnRecorderFn,
  listWindowsFn = listTopWindows,
  statfs = fs.statfsSync,
  maxApps = 6,
  perWindowTimeoutMs = 5_000,
  readyTimeoutMs = 10_000,
  bootLog = () => {},
} = {}) {
  const checks = {};
  checks.disk_session_target = checkDisk("session target", sessionTarget, {
    failGb: DISK_FAIL_GB, warnGb: DISK_WARN_GB, statfs,
  });
  checks.disk_temp = checkDisk("temp (recorder self-extract)", tempDir, {
    failGb: TEMP_FAIL_GB, warnGb: null, statfs,
  });

  /* Probe state shared with the recorder callbacks. `sink` collects
     snapshot_control lines for the window currently being probed;
     snapshots are issued strictly sequentially so attribution is by
     time, not by id (the sidecar's snapshot lines carry no target id). */
  let sink = null;
  let doneResolve = null;
  let readyResolve = null;
  const readyPromise = new Promise((res) => { readyResolve = res; });

  let rec = null;
  try {
    rec = spawnRecorderFn({
      sessionId: "readiness-probe",
      onReady: () => { if (readyResolve) readyResolve(true); },
      onSnapshotControl: (c) => { if (sink) sink.push(c); },
      onSnapshotDone: () => { if (doneResolve) doneResolve(true); },
      onExit: () => {
        if (readyResolve) readyResolve(false);
        if (doneResolve) doneResolve(false);
      },
      bootLog,
    });
  } catch (e) {
    checks.recorder = { status: "fail", note: `the recording engine did not start: ${e && e.message}` };
    checks.uia = { status: "fail", note: "not checked (the recording engine is unavailable)" };
    return finishReport({ checks, apps: [] });
  }

  const ready = await withTimeout(readyPromise, readyTimeoutMs, false);
  checks.recorder = ready
    ? { status: "ok", note: "the recording engine started and reported ready" }
    : { status: "fail", note: `the recording engine did not become ready within ${readyTimeoutMs / 1000}s -- check temp disk space / antivirus` };

  const apps = [];
  let anyControls = false;
  if (ready) {
    let windows = await listWindowsFn();
    if (hostExeName) {
      const own = String(hostExeName).toLowerCase();
      windows = windows.filter((w) =>
        w.app.toLowerCase() !== own && w.app.toLowerCase() !== "recorder.exe");
    }
    windows = windows.slice(0, maxApps);
    for (const w of windows) {
      sink = [];
      const done = new Promise((res) => { doneResolve = res; });
      try { rec.snapshot({ target: String(w.hwnd), passes: 1 }); }
      catch (_e) { /* sidecar gone; the timeout below reports it */ }
      const completed = await withTimeout(done, perWindowTimeoutMs, false);
      const tierInfo = computeAppTier(sink);
      if (tierInfo.n_controls > 0) anyControls = true;
      apps.push({
        app: w.app, pid: w.pid, window_title: w.title,
        ...tierInfo,
        ...(completed ? {} : { probe_timed_out: true }),
      });
      sink = null;
      doneResolve = null;
    }
    checks.uia = anyControls
      ? { status: "ok", note: `the recorder can read app windows (${apps.length} probed)` }
      : {
          status: apps.length ? "fail" : "warn",
          note: apps.length
            ? "no probed window showed a single identifiable control -- the recorder looks blocked on this machine"
            : "no visible app windows to probe (open the pilot apps and re-run)",
        };
    try { await rec.stop({ drainTimeoutMs: 1000 }); } catch (_e) {}
  } else {
    checks.uia = { status: "fail", note: "not checked (the recording engine did not become ready)" };
    try { await rec.stop({ drainTimeoutMs: 500 }); } catch (_e) {}
  }

  return finishReport({ checks, apps });
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((res) => { const t = setTimeout(() => res(fallback), ms); t.unref && t.unref(); }),
  ]);
}

function finishReport({ checks, apps }) {
  const statuses = Object.values(checks).map((c) => c.status);
  const overall = statuses.includes("fail") ? "not_ready"
    : statuses.includes("warn") ? "ready_with_warnings" : "ready";
  return { generated_at: new Date().toISOString(), overall, checks, apps };
}

/* ------------------------------------------------------------- summary */

const TIER_GLYPH = { rich: "++", basic: "+", minimal: "~", wall: "X" };

function summarizeReadiness(report) {
  const lines = [];
  const head = report.overall === "ready" ? "READY"
    : report.overall === "ready_with_warnings" ? "READY (with warnings)"
      : "NOT READY";
  lines.push(`Capture readiness: ${head}`);
  lines.push("");
  for (const key of ["disk_session_target", "disk_temp", "recorder", "uia"]) {
    const c = report.checks[key];
    if (!c) continue;
    const mark = c.status === "ok" ? "[ok]  " : c.status === "warn" ? "[warn]" : "[FAIL]";
    lines.push(`${mark} ${c.label || key}: ${c.note}`);
  }
  if (report.apps && report.apps.length) {
    lines.push("");
    lines.push("How much detail the recorder can see, per app (++ full / + good / ~ thin / X blocked):");
    for (const a of report.apps) {
      const g = TIER_GLYPH[a.tier] || "?";
      lines.push(
        `  ${g.padEnd(2)} ${a.tier.padEnd(7)} ${a.app}  (${a.n_controls} controls, ` +
        `conf ${a.mean_confidence}, ${a.dominant_framework || "-"}) -- ${a.note}`
      );
    }
  }
  return lines.join("\n");
}

module.exports = {
  checkDisk,
  computeAppTier,
  listTopWindows,
  runReadinessProbe,
  summarizeReadiness,
  DISK_FAIL_GB,
  DISK_WARN_GB,
  TEMP_FAIL_GB,
};
