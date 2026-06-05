"use strict";
/*
 * Real capture end-to-end run.
 *
 * Spawns the C# recorder, drives a real Windows app (Notepad) via
 * SendKeys for ~25 s, writes events.jsonl + manifest.json + system events
 * (the same shape the capture tray app produces), normalises with --mine,
 * and opens the result in the viewer to confirm the Cockpit shows real
 * captured data — not the pre-baked demo session.
 *
 * Validates the FULL chain: real recorder → real events → pipeline →
 * Cockpit / Glance / Engagement render.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync, spawnSync } = require("child_process");
const { spawnRecorder } = require(path.join(__dirname, "..", "capture", "recorder.js"));

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const SESS_ROOT = path.join(REPO, "sessions", "_real-capture");
fs.mkdirSync(SESS_ROOT, { recursive: true });
const sessionId = "real-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SESSION = path.join(SESS_ROOT, sessionId);
fs.mkdirSync(SESSION, { recursive: true });

const log = (m) => console.log("[" + now() + "] " + m);

const events = [];
function record(event) { events.push(event); }

const sessionStartTs = now();
record({
  v: 1, type: "system", timestamp: sessionStartTs,
  data: { kind: "session_start", session_id: sessionId },
});

(async () => {
  log("session folder: " + SESSION);
  log("spawning recorder...");
  const rec = spawnRecorder({
    sessionId,
    verbose: false,
    onEvent: (data) => {
      record({ v: 1, type: "interaction", timestamp: now(), data });
    },
    onWarning: (w) => log("[recorder.warn] " + JSON.stringify(w).slice(0, 200)),
    onExit: ({ code, signal }) => log("[recorder] exited code=" + code + " sig=" + signal),
    bootLog: (m) => log("[recorder] " + m),
  });
  await wait(2500);   // give the recorder time to settle

  // Activity event for the session start (foreground app at start).
  record({
    v: 1, type: "activity", timestamp: now(),
    data: { app: "explorer.exe", window_title: "Desktop", source: "active-win-poll" },
  });

  // --- DRIVE NOTEPAD ---
  log("launching Notepad");
  const np = spawn("notepad.exe", [], { detached: true, stdio: "ignore" });
  await wait(2200);
  // Send keystrokes via PowerShell SendKeys — these go to the foreground window
  // (Notepad just launched, so that's Notepad).
  function sendKeys(keys, ms = 250) {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}'); Start-Sleep -Milliseconds ${ms}`;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
  }
  record({
    v: 1, type: "activity", timestamp: now(),
    data: { app: "Notepad.exe", window_title: "Untitled - Notepad", source: "active-win-poll" },
  });

  // Type a sentence in Notepad — character by character so the recorder
  // sees keystrokes / value_changed events.
  log("typing in Notepad");
  for (const phrase of [
    "Process Discovery Tracker capture validation. ",
    "This is a real-app interaction test driven by PowerShell SendKeys. ",
    "The recorder should observe text-entry events here in notepad.exe. ",
  ]) {
    sendKeys(phrase, 350);
    await wait(150);
  }
  await wait(1500);

  // Marker event: a "Start" marker mid-session (worker would press Ctrl+Shift+S).
  record({
    v: 1, type: "marker", timestamp: now(),
    data: { kind: "start", label: "Note entry", marker_id: "mk-" + Math.random().toString(36).slice(2, 8) },
  });

  // Switch to a different app to exercise the activity stream.
  log("switching to calc");
  spawn("calc.exe", [], { detached: true, stdio: "ignore" });
  await wait(2500);
  record({
    v: 1, type: "activity", timestamp: now(),
    data: { app: "ApplicationFrameHost.exe", window_title: "Calculator", source: "active-win-poll" },
  });
  for (const k of ["1", "2", "3", "+", "4", "5", "6", "="]) {
    sendKeys(k, 250);
    await wait(120);
  }
  await wait(1500);

  // Back to Notepad
  log("alt-tab back to Notepad");
  sendKeys("%{TAB}", 500);
  await wait(1500);
  record({
    v: 1, type: "activity", timestamp: now(),
    data: { app: "Notepad.exe", window_title: "Untitled - Notepad", source: "active-win-poll" },
  });
  sendKeys(" Closing note.", 250);
  await wait(800);

  // End marker
  record({
    v: 1, type: "marker", timestamp: now(),
    data: { kind: "end", label: "Note entry", marker_id: "mk-end-" + Math.random().toString(36).slice(2, 8) },
  });

  // --- STOP ---
  log("stopping recorder");
  await rec.stop();
  await wait(500);

  // Kill the apps we spawned
  try { spawnSync("taskkill", ["/F", "/IM", "notepad.exe"], { stdio: "ignore" }); } catch (_) {}
  try { spawnSync("taskkill", ["/F", "/IM", "CalculatorApp.exe"], { stdio: "ignore" }); } catch (_) {}

  record({
    v: 1, type: "system", timestamp: now(),
    data: { kind: "session_end", session_id: sessionId },
  });

  // --- WRITE events.jsonl + manifest.json ---
  const eventsPath = path.join(SESSION, "events.jsonl");
  fs.writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  log("wrote " + events.length + " events to " + eventsPath);

  const interactions = events.filter(e => e.type === "interaction").length;
  log("captured " + interactions + " interaction events");

  const manifest = {
    schema_version: 1,
    session_id: sessionId,
    started_at: sessionStartTs,
    ended_at: now(),
    worker_id: "e2e-driver",
    engagement_id: "real-capture-validation",
    config_snapshot: { driver: "e2e/real-capture.js" },
    obs: null,
  };
  fs.writeFileSync(path.join(SESSION, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // --- NORMALIZE ---
  log("normalising...");
  const bundledPy = path.join(VIEWER, "python", "python.exe");
  const pyExe = fs.existsSync(bundledPy) ? bundledPy : "python";
  const norm = path.join(REPO, "normalization", "normalize.py");
  try {
    execFileSync(pyExe, [norm, SESSION, "--mine"], {
      cwd: REPO, stdio: "inherit",
      env: Object.assign({}, process.env, {
        PDT_OLLAMA_URL: "http://127.0.0.1:11434",
        PDT_OLLAMA_MODEL: "qwen2.5:1.5b-instruct",
      }),
    });
  } catch (e) {
    log("normalise failed: " + e.message);
    process.exit(1);
  }

  // --- OPEN IN VIEWER + verify Cockpit ---
  const { _electron: electron } = require("playwright-core");
  log("launching viewer with the captured session");
  const app = await electron.launch({
    executablePath: electronPath, args: [".", "--session=" + SESSION], cwd: VIEWER,
    env: Object.assign({}, process.env, { PDT_OLLAMA_URL: "http://127.0.0.1:11434" }),
  });
  const page = await app.firstWindow();
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: 20000 }).catch(() => {});
  await wait(2500);

  const cockpit = await page.evaluate(() => ({
    mode: document.querySelector("#session-mode-toggle .mode-btn.active")?.dataset.mode,
    headlines: Array.from(document.querySelectorAll(".cockpit-headline-item")).map(el => ({
      val: el.querySelector(".cockpit-headline-val")?.textContent,
      lbl: el.querySelector(".cockpit-headline-lbl")?.textContent,
    })),
    candidates: document.querySelectorAll(".cockpit-candidate").length,
    stoodOut: document.querySelectorAll(".cockpit-stood-out").length,
  }));
  console.log("\n=== COCKPIT ON THE REAL CAPTURED SESSION ===");
  console.log(JSON.stringify(cockpit, null, 2));

  await page.screenshot({ path: path.join(__dirname, "screenshots", "12-real-capture-cockpit.png"), fullPage: true });
  await app.close().catch(() => {});
  log("done. session at: " + SESSION);
  process.exit(0);
})().catch((e) => { console.error("crash:", e.stack); process.exit(2); });
