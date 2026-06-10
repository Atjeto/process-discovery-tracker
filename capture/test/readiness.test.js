/*
 * Readiness-check tests (lab-phase §E1). The disk, recorder, and UIA
 * seams are all faked -- no live desktop, no real sidecar.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkDisk,
  computeAppTier,
  runReadinessProbe,
  summarizeReadiness,
} = require("../readiness.js");

const GB = 1024 * 1024 * 1024;

function fakeStatfs(freeBytes) {
  return () => ({ bavail: freeBytes / 4096, bsize: 4096 });
}

/* ------------------------------------------------------------- disk */

test("checkDisk: ok / warn / fail by free space", () => {
  assert.equal(checkDisk("t", "D:\\x", { failGb: 2, warnGb: 10, statfs: fakeStatfs(50 * GB) }).status, "ok");
  assert.equal(checkDisk("t", "D:\\x", { failGb: 2, warnGb: 10, statfs: fakeStatfs(5 * GB) }).status, "warn");
  assert.equal(checkDisk("t", "D:\\x", { failGb: 2, warnGb: 10, statfs: fakeStatfs(1 * GB) }).status, "fail");
});

test("checkDisk: unstattable target is a fail, not a throw (the C:-full class must surface)", () => {
  const r = checkDisk("t", "Z:\\nope", {
    failGb: 2, warnGb: 10,
    statfs: () => { throw new Error("ENOENT"); },
  });
  assert.equal(r.status, "fail");
  assert.match(r.note, /could not stat/);
});

/* --------------------------------------------------------- app tiers */

function controls(n, { identity = "automation_id", confidence = 0.95, framework = "winforms" } = {}) {
  return Array.from({ length: n }, () => ({ identity_source: identity, confidence, framework }));
}

test("computeAppTier: zero controls = wall", () => {
  const t = computeAppTier([]);
  assert.equal(t.tier, "wall");
  assert.equal(t.n_controls, 0);
});

test("computeAppTier: remote/terminal dominant framework = wall even with identity", () => {
  const t = computeAppTier(controls(40, { identity: "name", confidence: 0.3, framework: "remote" }));
  assert.equal(t.tier, "wall");
  assert.match(t.note, /remote/);
});

test("computeAppTier: automation-id-rich window = rich", () => {
  const t = computeAppTier(controls(30, { identity: "automation_id", confidence: 0.95 }));
  assert.equal(t.tier, "rich");
  assert.equal(t.share_automation_id, 1);
});

test("computeAppTier: name-identified web app = basic (mirrors coverage_hint)", () => {
  const t = computeAppTier(controls(50, { identity: "name", confidence: 0.7, framework: "chromium" }));
  assert.equal(t.tier, "basic");
  assert.equal(t.dominant_framework, "chromium");
});

test("computeAppTier: class_name-only window = minimal", () => {
  const t = computeAppTier(controls(20, { identity: "class_name", confidence: 0.4, framework: "win32" }));
  assert.equal(t.tier, "minimal");
});

/* ----------------------------------------------------- orchestration */

/* A fake spawnRecorder: reports ready, then answers each snapshot with
   the canned controls for that window (keyed by hwnd), like the real
   sidecar but synchronously via setImmediate. */
function fakeRecorderFactory(byHwnd, { ready = true } = {}) {
  return ({ onReady, onSnapshotControl, onSnapshotDone }) => {
    if (ready) setImmediate(() => onReady && onReady());
    return {
      snapshot: ({ target }) => {
        setImmediate(() => {
          for (const c of byHwnd[target] || []) onSnapshotControl(c);
          onSnapshotDone({ count: (byHwnd[target] || []).length, pass: 1 });
        });
      },
      stop: async () => {},
    };
  };
}

test("runReadinessProbe: full pass -- per-app tiers, ok checks, ready overall", async () => {
  const byHwnd = {
    "101": controls(30, { identity: "automation_id", confidence: 0.95, framework: "winforms" }),
    "102": controls(40, { identity: "name", confidence: 0.7, framework: "chromium" }),
    "103": [],
  };
  const report = await runReadinessProbe({
    sessionTarget: "D:\\sessions",
    tempDir: "D:\\temp",
    hostExeName: "electron.exe",
    statfs: fakeStatfs(100 * GB),
    spawnRecorderFn: fakeRecorderFactory(byHwnd),
    listWindowsFn: async () => [
      { app: "erp.exe", pid: 1, title: "ERP main", hwnd: 101 },
      { app: "chrome.exe", pid: 2, title: "ServiceNow", hwnd: 102 },
      { app: "legacy.exe", pid: 3, title: "Old thing", hwnd: 103 },
      { app: "electron.exe", pid: 4, title: "PDT itself", hwnd: 104 },
    ],
    perWindowTimeoutMs: 500,
    readyTimeoutMs: 500,
  });
  assert.equal(report.overall, "ready");
  assert.equal(report.checks.recorder.status, "ok");
  assert.equal(report.checks.uia.status, "ok");
  // Own exe excluded; three apps probed with the right tiers.
  assert.equal(report.apps.length, 3);
  assert.deepEqual(report.apps.map((a) => a.tier), ["rich", "basic", "wall"]);
});

test("runReadinessProbe: recorder spawn failure fails the check, not the probe", async () => {
  const report = await runReadinessProbe({
    sessionTarget: "D:\\sessions",
    statfs: fakeStatfs(100 * GB),
    spawnRecorderFn: () => { throw new Error("recorder.exe not found"); },
    listWindowsFn: async () => [],
  });
  assert.equal(report.overall, "not_ready");
  assert.equal(report.checks.recorder.status, "fail");
  assert.match(report.checks.recorder.note, /not found/);
});

test("runReadinessProbe: no ready line within the timeout = recorder fail", async () => {
  const report = await runReadinessProbe({
    sessionTarget: "D:\\sessions",
    statfs: fakeStatfs(100 * GB),
    spawnRecorderFn: fakeRecorderFactory({}, { ready: false }),
    listWindowsFn: async () => [],
    readyTimeoutMs: 50,
  });
  assert.equal(report.checks.recorder.status, "fail");
  assert.equal(report.overall, "not_ready");
});

test("runReadinessProbe: full session-target disk fails the run (the 0-events class)", async () => {
  const report = await runReadinessProbe({
    sessionTarget: "C:\\sessions",
    statfs: fakeStatfs(0.5 * GB),
    spawnRecorderFn: fakeRecorderFactory({ "7": controls(10) }),
    listWindowsFn: async () => [{ app: "a.exe", pid: 1, title: "A", hwnd: 7 }],
    perWindowTimeoutMs: 500,
    readyTimeoutMs: 500,
  });
  assert.equal(report.overall, "not_ready");
  assert.equal(report.checks.disk_session_target.status, "fail");
});

test("summarizeReadiness: human summary carries verdict, checks, and tier lines", () => {
  const text = summarizeReadiness({
    overall: "ready_with_warnings",
    checks: {
      disk_session_target: { label: "session target", status: "warn", note: "5 GB free" },
      disk_temp: { label: "temp", status: "ok", note: "90 GB free" },
      recorder: { status: "ok", note: "ready" },
      uia: { status: "ok", note: "reachable" },
    },
    apps: [{ app: "erp.exe", tier: "rich", n_controls: 30, mean_confidence: 0.95, dominant_framework: "winforms", note: "stable ids" }],
  });
  assert.match(text, /READY \(with warnings\)/);
  assert.match(text, /\[warn\] session target/);
  assert.match(text, /rich\s+erp\.exe/);
});
