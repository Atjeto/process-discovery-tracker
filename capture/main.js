/*
 * Process Discovery Tracker -- capture-side Electron main process.
 *
 * Wires up:
 *   - Tray UI + global hotkeys (label picker, end marker, manual screenshot)
 *   - Session lifecycle with per-session config (YAML)
 *   - Active-window polling (tracker.js)
 *   - Idle detection via powerMonitor.getSystemIdleTime (§3.3)
 *   - Auto-end of open markers on long idle (§3.3)
 *   - Event-triggered screenshots (§3.4)
 *   - OBS recording lifecycle via obs-websocket (§4)
 *
 * Patterns reused from pocket-tracker/desktop-tracker (§3.6).
 */

"use strict";

const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  nativeImage,
  shell,
  dialog,
  globalShortcut,
  ipcMain,
  powerMonitor,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const { startTracker } = require("./tracker.js");
const {
  createSession,
  closeSession,
  markSessionRecovered,
  findOrphanedSessions,
  listRecentSessions,
} = require("./session.js");
const { spawn } = require("node:child_process");
const { loadConfig, writeConfigSnapshot } = require("./config.js");
const {
  connectOBS,
  ensureScene,
  startRecording,
  stopRecording,
  writeSyncFile,
} = require("./obs.js");
const { captureScreenshot } = require("./screenshots.js");
const { showStatusWindow } = require("./status-window.js");
const { showHelpWindow } = require("./help-window.js");
const { showOperatorPanel } = require("./operator-panel.js");
const { showObsSettingsWindow } = require("./obs-settings-window.js");
const crypto = require("node:crypto");

const DEBUG = process.env.PDT_DEBUG === "1";
function bootLog(msg) {
  if (!DEBUG) return;
  try {
    const dir = app.getPath("userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "boot.log"),
      `${new Date().toISOString()} ${msg}\n`
    );
  } catch (_e) { /* best-effort */ }
}
process.on("uncaughtException", (e) =>
  bootLog(`uncaughtException: ${(e && e.stack) || e}`)
);
process.on("unhandledRejection", (e) =>
  bootLog(`unhandledRejection: ${(e && e.stack) || e}`)
);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
if (process.platform === "darwin" && app.dock) app.dock.hide();

let tray = null;
let tracker = null;
let session = null;
let lastStatus = null;
let labelPickerWindow = null;
let statusWindow = null;
let helpWindow = null;
let operatorWindow = null;
let obs = null;
let obsConnected = false;
let config = null;
let configSourcePath = null;
let baseDir = null;
let recoveredCount = 0;
let recorder = null;
let recorderRestartCount = 0;
let recorderPermanentlyDead = false;

// Idle monitor state
let idleMonitorHandle = null;
let isIdle = false;
let idleStartMs = null;

// App-switch screenshot tracking
let lastTrackedApp = null;

function trayIconImage() {
  const candidates = [
    path.join(process.resourcesPath || "", "tray-icon.png"),
    path.join(__dirname, "tray-icon.png"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      const img = nativeImage.createFromPath(c);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

/* --- Session disk-usage helpers + prune ---------------------------- */

function folderBytes(folder) {
  let total = 0;
  let stack = [folder];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch (_) { /* unreadable file -- skip */ }
    }
  }
  return total;
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + " " + units[i];
}

function folderSizeHuman(folder) {
  return humanSize(folderBytes(folder));
}

/* Tray menu rebuilds on every status tick (5s by default), so the
   sessions-total enumeration is cached for a minute and invalidated
   after any delete. Worst case the displayed total is 60s stale --
   fine for an info line. */
let _sessionsCache = null;
let _sessionsCacheUntil = 0;

function getSessionsTotal() {
  const now = Date.now();
  if (_sessionsCache && now < _sessionsCacheUntil) return _sessionsCache;
  let count = 0;
  let bytes = 0;
  if (baseDir && fs.existsSync(baseDir)) {
    for (const eng of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!eng.isDirectory()) continue;
      const engDir = path.join(baseDir, eng.name);
      let subs;
      try { subs = fs.readdirSync(engDir, { withFileTypes: true }); }
      catch (_) { continue; }
      for (const s of subs) {
        if (!s.isDirectory()) continue;
        const sFolder = path.join(engDir, s.name);
        if (!fs.existsSync(path.join(sFolder, "manifest.json"))) continue;
        count++;
        bytes += folderBytes(sFolder);
      }
    }
  }
  _sessionsCache = { count, bytes };
  _sessionsCacheUntil = now + 60_000;
  return _sessionsCache;
}

function invalidateSessionsCache() {
  _sessionsCache = null;
  _sessionsCacheUntil = 0;
}

async function confirmAndDeleteSession(sessionFolder, label) {
  /* Never delete the currently active session. */
  if (session && session.sessionFolder === sessionFolder) {
    await dialog.showMessageBox({
      type: "info",
      title: "Cannot delete",
      message: "This session is currently being recorded. End it first via the tray menu.",
      buttons: ["OK"],
    });
    return;
  }
  const bytes = folderBytes(sessionFolder);
  const r = await dialog.showMessageBox({
    type: "warning",
    title: "Delete session?",
    message: "Delete this session folder?",
    detail: `${label || sessionFolder}\n${sessionFolder}\n\nFrees ${humanSize(bytes)}. This cannot be undone.`,
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0) return;
  try {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
    invalidateSessionsCache();
    refreshTray();
    bootLog(`deleted session ${sessionFolder} (${bytes} bytes)`);
  } catch (e) {
    dialog.showErrorBox("Delete failed", `${e && e.message}\n\nThe folder may still exist; check Explorer.`);
  }
}

async function confirmAndPruneByAge(days) {
  if (!baseDir || !fs.existsSync(baseDir)) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const candidates = [];
  let totalBytes = 0;
  for (const r of listRecentSessions(baseDir, Number.MAX_SAFE_INTEGER)) {
    if (session && r.sessionFolder === session.sessionFolder) continue;  // never the active one
    const startMs = r.started_at ? new Date(r.started_at).getTime() : 0;
    if (!startMs || startMs >= cutoff) continue;
    const b = folderBytes(r.sessionFolder);
    candidates.push({ ...r, bytes: b });
    totalBytes += b;
  }
  if (!candidates.length) {
    await dialog.showMessageBox({
      type: "info",
      title: "Nothing to prune",
      message: `No sessions older than ${days} days.`,
      buttons: ["OK"],
    });
    return;
  }
  const sample = candidates.slice(0, 8).map(c => `  ${c.label}  (${humanSize(c.bytes)})`).join("\n");
  const more = candidates.length > 8 ? `\n  ...and ${candidates.length - 8} more` : "";
  const r = await dialog.showMessageBox({
    type: "warning",
    title: "Prune old sessions?",
    message: `Delete ${candidates.length} session${candidates.length === 1 ? "" : "s"} older than ${days} days?`,
    detail: `Frees ${humanSize(totalBytes)} total. This cannot be undone.\n\n${sample}${more}`,
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0) return;
  let deleted = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      fs.rmSync(c.sessionFolder, { recursive: true, force: true });
      deleted++;
    } catch (e) {
      failed++;
      bootLog(`prune failed for ${c.sessionFolder}: ${e && e.message}`);
    }
  }
  invalidateSessionsCache();
  refreshTray();
  await dialog.showMessageBox({
    type: failed ? "warning" : "info",
    title: "Prune complete",
    message: failed
      ? `Deleted ${deleted}, ${failed} failed (see boot.log if PDT_DEBUG=1).`
      : `Deleted ${deleted} session${deleted === 1 ? "" : "s"}.`,
    buttons: ["OK"],
  });
}

async function fireScreenshot(kind) {
  if (!tracker || !session || !config.screenshots.enabled) return;
  try {
    const relPath = await captureScreenshot({
      screenshotsFolder: path.join(session.sessionFolder, "screenshots"),
      quality: config.screenshots.quality,
    });
    if (relPath) tracker.fireSystem(kind || "screenshot", { path: relPath });
  } catch (e) {
    bootLog(`screenshot failed: ${e && e.message}`);
  }
}

async function onTickHandler(status) {
  lastStatus = status;
  refreshTray();
  /* App-switch screenshot trigger -- detect new currentApp value and
     fire a screenshot. lastTrackedApp persists across ticks. */
  if (
    config &&
    config.screenshots.enabled &&
    config.screenshots.on_app_switch &&
    status.currentApp &&
    status.currentApp !== lastTrackedApp
  ) {
    lastTrackedApp = status.currentApp;
    /* skip the very first set so we don't take a screenshot at session
       start for every session; the manual launch is well-known */
    if (lastTrackedApp !== null) fireScreenshot("screenshot");
  }
}

function startIdleMonitor() {
  stopIdleMonitor();
  idleMonitorHandle = setInterval(() => {
    if (!tracker) return;
    if (lastStatus && lastStatus.paused) return;
    const idleSecs = powerMonitor.getSystemIdleTime();
    const threshold = config.idle_threshold_seconds || 60;
    const autoEndSecs = (config.auto_end_idle_minutes || 30) * 60;

    if (!isIdle && idleSecs >= threshold) {
      isIdle = true;
      idleStartMs = Date.now();
      tracker.fireSystem("idle_start", { idle_seconds: idleSecs });
      bootLog(`idle_start at ${idleSecs}s`);
    } else if (isIdle && idleSecs < threshold) {
      isIdle = false;
      const durationSecs = Math.round((Date.now() - idleStartMs) / 1000);
      tracker.fireSystem("idle_end", { duration_seconds: durationSecs });
      idleStartMs = null;
      bootLog(`idle_end after ${durationSecs}s`);
      const minResume =
        (config.screenshots.on_idle_resume_minutes || 5) * 60;
      if (durationSecs >= minResume) fireScreenshot("screenshot");
    } else if (isIdle && idleSecs >= autoEndSecs) {
      /* Auto-close any open markers and log the cause (§3.3). */
      while (lastStatus && lastStatus.markerDepth > 0) {
        tracker.fireMarker({ markerType: "end", reason: "auto_end_idle" });
        lastStatus = tracker.getStatus();
      }
      tracker.fireSystem("auto_end_idle", { idle_seconds: idleSecs });
      refreshTray();
    }
  }, 5000);
}

function stopIdleMonitor() {
  if (idleMonitorHandle) clearInterval(idleMonitorHandle);
  idleMonitorHandle = null;
  isIdle = false;
  idleStartMs = null;
}

function resolveViewerExe() {
  /* The viewer ships either as a sibling app folder (in a packaged dist)
     or as `npm start` in viewer/ (in dev). Probe a couple of layouts. */
  const candidates = [
    process.env.PDT_VIEWER_EXE,
    // Sibling dist layout: dist/capture/... and dist/viewer/Process Discovery Viewer.exe
    path.resolve(path.dirname(process.execPath), "..", "viewer", "Process Discovery Viewer.exe"),
    // electron-packager layout: capture/dist/Process Discovery Tracker-win32-x64/... and viewer/dist/Process Discovery Viewer-win32-x64/...
    path.resolve(path.dirname(process.execPath), "..", "..", "..", "viewer", "dist", "Process Discovery Viewer-win32-x64", "Process Discovery Viewer.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function openInViewer(sessionFolder) {
  const exe = resolveViewerExe();
  if (!exe) {
    dialog.showMessageBox({
      type: "info",
      title: "Viewer not found",
      message: "Couldn't locate Process Discovery Viewer.exe.",
      detail:
        `Open it manually and pick the session folder:\n${sessionFolder}\n\n` +
        `Set PDT_VIEWER_EXE to the viewer's executable path to enable one-click launch.`,
      buttons: ["OK"],
    });
    return;
  }
  try {
    const child = spawn(exe, [`--session=${sessionFolder}`], {
      detached: true, stdio: "ignore", windowsHide: false,
    });
    child.unref();
    bootLog(`launched viewer with session: ${sessionFolder}`);
  } catch (e) {
    bootLog(`viewer launch failed: ${e && e.message}`);
    dialog.showErrorBox("Could not launch viewer", e && e.message);
  }
}

function obsSettingsPath() {
  return path.join(app.getPath("userData"), "obs-settings.json");
}
function loadObsSettings() {
  try {
    const p = obsSettingsPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf-8")) || {};
  } catch (_e) { return {}; }
}
function saveObsSettings(s) {
  try {
    const p = obsSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  } catch (e) { bootLog(`obs-settings write failed: ${e && e.message}`); }
}
function effectiveObsCfg() {
  /* Layered config: per-session YAML provides defaults; userData
     obs-settings.json overrides URL and password since those are
     workstation-specific and the user can edit them from the tray. */
  const base = (config && config.obs) || {};
  const override = loadObsSettings();
  return {
    ...base,
    websocket_url: override.url || base.websocket_url || "ws://127.0.0.1:4455",
    websocket_password: override.password || base.websocket_password || null,
  };
}

let obsSettingsWindow = null;
function showObsSetupDialog() {
  if (obsSettingsWindow && !obsSettingsWindow.isDestroyed()) {
    obsSettingsWindow.show();
    obsSettingsWindow.focus();
    return;
  }
  obsSettingsWindow = showObsSettingsWindow();
  obsSettingsWindow.on("closed", () => { obsSettingsWindow = null; });
}

ipcMain.handle("pdt:obsGet", () => {
  const eff = effectiveObsCfg();
  return { url: eff.websocket_url, password: eff.websocket_password || "" };
});

ipcMain.handle("pdt:obsTest", async (_e, { url, password }) => {
  try {
    const probe = await connectOBS({ websocketUrl: url, password: password || undefined });
    try { await probe.disconnect(); } catch (_x) {}
    return { ok: true, message: `Reachable at ${url}. Scene control and recording will work.` };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, message: msg };
  }
});

ipcMain.handle("pdt:obsSave", (_e, { url, password }) => {
  saveObsSettings({ url, password });
  bootLog("obs-settings saved");
  return { saved: true };
});

async function setupOBS() {
  const eff = effectiveObsCfg();
  if (!eff.websocket_url) return false;
  try {
    obs = await connectOBS({
      websocketUrl: eff.websocket_url,
      password: eff.websocket_password,
    });
    obsConnected = true;
    bootLog("OBS connected");
    if (config.obs.auto_create_scene) {
      try {
        await ensureScene(obs, config.obs.scene_name);
        bootLog(`scene ensured: ${config.obs.scene_name}`);
      } catch (e) {
        bootLog(`scene bootstrap failed: ${e && e.message}`);
      }
    }
    return true;
  } catch (e) {
    bootLog(`OBS connect failed: ${e && e.message}`);
    obs = null;
    obsConnected = false;
    if (config.obs.required) {
      dialog.showErrorBox(
        "OBS not reachable",
        `Could not connect to OBS at ${eff.websocket_url}.\n\n` +
          `${e && e.message}\n\n` +
          `Per session config, OBS is required. Launch OBS (with WebSocket enabled) and try again.\n\n` +
          `If OBS has authentication enabled, set the password via tray menu -> Set up OBS recording.`
      );
      return false;
    }
    return true; // proceed without OBS in non-strict mode
  }
}

function promptForAppName() {
  /* Tiny modal prompt window. The label picker pattern is overkill;
     this is one input + Start/Cancel. Returns a promise that resolves
     to the typed app name or null on cancel. */
  return new Promise((resolve) => {
    let resolved = false;
    const w = new BrowserWindow({
      width: 460,
      height: 280,
      title: "Prep app vocabulary",
      resizable: false, frame: true,
      autoHideMenuBar: true,
      backgroundColor: "#1a1a1a",
      modal: false,
      webPreferences: {
        nodeIntegration: true, contextIsolation: false, sandbox: false,
        webSecurity: true, allowRunningInsecureContent: false,
        experimentalFeatures: false, spellcheck: false,
      },
    });
    w.removeMenu();
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
      <style>
        :root{color-scheme:dark;--bg:#1a1a1a;--bg-2:#232323;--bg-3:#2c2c2c;
          --border:#3a3a3a;--fg:#e6e6e6;--fg-2:#a8a8a8;--fg-3:#6e6e6e;--accent:#3a86ff}
        *{box-sizing:border-box}
        html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);
          font-family:-apple-system,"Segoe UI",system-ui,sans-serif;font-size:13px;line-height:1.5}
        body{padding:20px 22px;display:flex;flex-direction:column;gap:14px}
        h1{font-size:14px;margin:0;font-weight:600}
        .sub{color:var(--fg-3);font-size:12px}
        label{display:block;font-size:11px;color:var(--fg-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px}
        input{width:100%;padding:9px 11px;background:var(--bg-2);border:1px solid var(--border);
          color:var(--fg);border-radius:3px;font-size:13px;outline:none}
        input:focus{border-color:var(--accent)}
        .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}
        button{padding:8px 16px;background:var(--bg-3);color:var(--fg);
          border:1px solid var(--border);border-radius:3px;cursor:pointer;font-family:inherit;font-size:12px}
        button:hover{background:#363636;border-color:var(--accent)}
        button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
        button.primary:hover{filter:brightness(1.1)}
        .hint{color:var(--fg-3);font-size:11px}
      </style></head><body>
      <div>
        <h1>Prep app vocabulary</h1>
        <div class="sub">Capture a session focused on one app. Click through every button, menu, and form field you want named. When you end the session, the viewer will offer to bootstrap an App Vocabulary YAML.</div>
      </div>
      <div>
        <label for="app">App name</label>
        <input id="app" placeholder="e.g., Salesforce, Outlook, SAP" autofocus>
        <p class="hint">Plain English. The id (lower-case, hyphenated) is derived automatically.</p>
      </div>
      <div class="actions">
        <button id="cancel">Cancel</button>
        <button id="start" class="primary">Start prep session</button>
      </div>
      <script>
        const { ipcRenderer } = require("electron");
        const ip = document.getElementById("app");
        document.getElementById("start").addEventListener("click", () => {
          const v = (ip.value || "").trim();
          if (!v) return;
          ipcRenderer.send("pdt:prepAppResult", v);
          window.close();
        });
        document.getElementById("cancel").addEventListener("click", () => {
          ipcRenderer.send("pdt:prepAppResult", null);
          window.close();
        });
        ip.addEventListener("keydown", (e) => {
          if (e.key === "Enter") document.getElementById("start").click();
          else if (e.key === "Escape") document.getElementById("cancel").click();
        });
      </script></body></html>`;
    w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const handler = (_e, value) => {
      if (resolved) return;
      resolved = true;
      try { ipcMain.removeListener("pdt:prepAppResult", handler); } catch (_) {}
      resolve(value);
    };
    ipcMain.on("pdt:prepAppResult", handler);
    w.on("closed", () => {
      if (!resolved) { resolved = true; resolve(null); }
      try { ipcMain.removeListener("pdt:prepAppResult", handler); } catch (_) {}
    });
  });
}

async function startAppPrepSession() {
  const appName = await promptForAppName();
  if (!appName) return null;
  const prepApp = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  const s = await startSession({ purpose: "app_prep", prepApp });
  if (!s) return null;
  /* Helpful starter marker so the analyst sees clear timeline boundaries
     during the prep walkthrough. */
  try {
    tracker.fireMarker({ markerType: "start", label: `Prep: ${appName}` });
    lastStatus = tracker.getStatus();
  } catch (_e) {}
  dialog.showMessageBox({
    type: "info",
    title: "Prep session started",
    message: `Recording app vocabulary prep for "${appName}"`,
    detail:
      "Click through every button, menu, and form field in the app that you want named.\n\n" +
      "When you're done, end the session from the tray. The viewer will offer to bootstrap " +
      "the App Vocabulary YAML automatically.",
    buttons: ["OK"],
  });
  return s;
}

async function startSession(opts) {
  if (session) return session;
  fs.mkdirSync(baseDir, { recursive: true });

  /* OBS preflight before creating the session folder so a failed OBS
     start in strict mode doesn't litter the filesystem. */
  if (config.obs && config.obs.required) {
    const ok = await setupOBS();
    if (!ok) return null;
  } else if (config.obs && config.obs.websocket_url) {
    await setupOBS(); // best effort
  }

  /* App-prep sessions get parked under engagement_id="vocab-prep" so
     they don't pollute the engagement's process captures. The prep_app
     name is recorded on the manifest for downstream auto-naming. */
  const isPrep = !!(opts && opts.purpose === "app_prep");
  session = createSession({
    baseDir,
    engagementId: isPrep ? "vocab-prep" : config.engagement_id,
    config,
    purpose: opts && opts.purpose,
    prepApp: opts && opts.prepApp,
  });
  writeConfigSnapshot(session.sessionFolder, config);

  /* Start OBS recording after the folder exists so we can write sync.json
     immediately. */
  if (obsConnected && obs) {
    try {
      const sync = await startRecording(obs);
      writeSyncFile(path.join(session.sessionFolder, "obs"), sync);
      const manifestFile = path.join(session.sessionFolder, "manifest.json");
      const m = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
      m.obs.recording_path = sync.recording_path;
      m.obs.recording_start_ts = sync.obs_recording_start_ts;
      m.obs.offset_ms = sync.offset_ms;
      fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));
    } catch (e) {
      bootLog(`OBS startRecording failed: ${e && e.message}`);
    }
  }

  tracker = startTracker({
    sessionId: session.sessionId,
    eventsFile: session.eventsFile,
    onTick: onTickHandler,
  });
  if (obsConnected) {
    tracker.fireSystem("obs_recording_start");
  } else if (config.obs && config.obs.websocket_url && !config.obs.required) {
    /* One-time info hint: tell the user the session is running without
       video and how to enable it. The flag lives in a tiny JSON file in
       userData so it persists across sessions and only fires once. */
    try {
      const flagPath = path.join(app.getPath("userData"), "obs-hint-shown.json");
      if (!fs.existsSync(flagPath)) {
        fs.writeFileSync(flagPath, JSON.stringify({ shown_at: new Date().toISOString() }));
        dialog.showMessageBox({
          type: "info",
          title: "Recording without OBS video",
          message: "This session is running without video.",
          detail:
            "You'll still get a full timeline, screenshots, and interaction events. " +
            "If you'd like screen recording too:\n\n" +
            "1. Install OBS Studio (obsproject.com).\n" +
            "2. Tools -> WebSocket Server Settings -> tick Enable, leave port 4455.\n" +
            "3. End this session, then start a new one with OBS running.\n\n" +
            "You can also click 'Set up OBS recording...' in the tray menu any time.\n\n" +
            "This hint only shows once.",
          buttons: ["OK"],
        });
      }
    } catch (_e) { /* best-effort */ }
  }
  lastTrackedApp = null;
  lastStatus = tracker.getStatus();
  startIdleMonitor();

  if (config.interactions && config.interactions.enabled) {
    const ok = await startRecorderForSession();
    if (!ok && config.interactions.required) {
      // Strict mode: required recorder failed - tear down the session.
      await endSession();
      return null;
    }
  }

  bootLog(`session started: ${session.sessionFolder}`);
  return session;
}

async function startRecorderForSession() {
  try {
    recorder = require("./recorder.js").spawnRecorder({
      sessionId: session.sessionId,
      verbose: !!(config.interactions && config.interactions.verbose),
      onEvent: (data) => {
        if (!tracker) return;
        try { tracker.fireInteraction(data); }
        catch (e) { bootLog(`fireInteraction failed: ${e && e.message}`); }
      },
      onWarning: (w) => bootLog(`[recorder] ${w.msg || ""}: ${w.detail || ""}`),
      onStats: (s) => bootLog(`[recorder.stats] queued=${s.queued} dropped=${s.dropped_total} emitted=${s.emitted_total}`),
      onExit: (info) => handleRecorderExit(info),
      bootLog,
    });
    if (tracker) tracker.fireSystem("recorder_start");
    recorderRestartCount = 0;
    recorderPermanentlyDead = false;
    return true;
  } catch (e) {
    bootLog(`recorder spawn failed: ${e && e.message}`);
    if (config.interactions.required) {
      dialog.showErrorBox(
        "Interaction recorder unavailable",
        `${e && e.message}\n\nPer session config the recorder is required.`
      );
      return false;
    }
    return false;
  }
}

function handleRecorderExit(info) {
  if (!tracker) {
    recorder = null;
    return;
  }
  tracker.fireSystem("recorder_died", {
    code: info.code, signal: info.signal, restart_count: recorderRestartCount,
  });
  recorder = null;
  if (
    config.interactions &&
    config.interactions.auto_restart &&
    recorderRestartCount < (config.interactions.max_restarts_per_session || 3)
  ) {
    recorderRestartCount += 1;
    setTimeout(() => {
      if (!tracker) return;
      startRecorderForSession();
    }, 5000);
  } else {
    recorderPermanentlyDead = true;
    tracker.fireSystem("recorder_dead_permanent");
  }
}

async function endSession() {
  if (!tracker) return null;
  stopIdleMonitor();

  if (recorder) {
    try { tracker.fireSystem("recorder_stop"); } catch (_e) {}
    try { await recorder.stop({ drainTimeoutMs: 1500 }); } catch (_e) {}
    recorder = null;
  }
  recorderRestartCount = 0;
  recorderPermanentlyDead = false;

  if (obsConnected && obs) {
    try {
      tracker.fireSystem("obs_recording_stop");
      const r = await stopRecording(obs);
      if (r && r.outputPath) {
        /* If OBS reported a final path after stop, update the manifest. */
        const manifestFile = path.join(session.sessionFolder, "manifest.json");
        try {
          const m = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
          m.obs.recording_path = r.outputPath;
          fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));
        } catch (_e) {}
      }
    } catch (e) {
      bootLog(`OBS stopRecording failed: ${e && e.message}`);
    }
    try { await obs.disconnect(); } catch (_e) {}
    obs = null;
    obsConnected = false;
  }

  await tracker.stop();
  closeSession({ sessionFolder: session.sessionFolder, status: "closed" });
  bootLog(`session ended: ${session.sessionFolder}`);
  const oldFolder = session.sessionFolder;
  tracker = null;
  session = null;
  lastStatus = null;
  invalidateSessionsCache();  // new session lands in the count + size
  return oldFolder;
}

async function fireStartMarker(label) {
  if (!tracker) {
    const s = await startSession();
    if (!s) return;
  }
  tracker.fireMarker({ markerType: "start", label: label || "(unlabeled)" });
  if (config.screenshots.enabled && config.screenshots.on_marker_fire) {
    fireScreenshot("screenshot");
  }
  lastStatus = tracker.getStatus();
  refreshTray();
}

function fireEndMarker() {
  if (!tracker) return;
  if (!lastStatus || lastStatus.markerDepth === 0) return;
  tracker.fireMarker({ markerType: "end" });
  if (config.screenshots.enabled && config.screenshots.on_marker_fire) {
    fireScreenshot("screenshot");
  }
  lastStatus = tracker.getStatus();
  refreshTray();
}

function fireManualScreenshot() {
  if (!tracker || !session) return;
  fireScreenshot("screenshot_manual");
}

function showLabelPicker() {
  if (labelPickerWindow && !labelPickerWindow.isDestroyed()) {
    labelPickerWindow.show();
    labelPickerWindow.focus();
    return;
  }
  labelPickerWindow = new BrowserWindow({
    width: 420,
    height: 360,
    title: "Start marker",
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: false,
    backgroundColor: "#1a1a1a",
    webPreferences: {
      /* Trusted first-party HTML loaded via a data: URL. CSP in the
         page restricts what the renderer can do. */
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  labelPickerWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  labelPickerWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  labelPickerWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildPickerHtml())
  );
  labelPickerWindow.on("closed", () => { labelPickerWindow = null; });
  labelPickerWindow.on("blur", () => {
    if (labelPickerWindow && !labelPickerWindow.isDestroyed()) {
      labelPickerWindow.close();
    }
  });
}

function buildPickerHtml() {
  const labels = JSON.stringify(config.process_labels || []);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Start marker</title>
<style>
  :root {
    color-scheme: dark;
    --bg:       #1a1a1a;
    --bg-2:     #232323;
    --bg-3:     #2c2c2c;
    --bg-hover: #363636;
    --border:   #3a3a3a;
    --fg:       #e6e6e6;
    --fg-2:     #a8a8a8;
    --fg-3:     #6e6e6e;
    --accent:   #3a86ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
         font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; }
  .lbl { font-size: 11px; margin: 0 0 8px; color: var(--fg-3); }
  input { width: 100%; padding: 9px 11px; background: var(--bg-2);
          border: 1px solid var(--border); color: var(--fg);
          border-radius: 3px; font-family: inherit; font-size: 13px; outline: none; }
  input:focus { border-color: var(--accent); }
  input::placeholder { color: var(--fg-3); }
  ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 220px; overflow-y: auto; }
  li { padding: 7px 10px; border-radius: 3px; cursor: pointer; color: var(--fg-2); font-size: 13px; }
  li.sel { background: var(--accent); color: #fff; }
  li:hover:not(.sel) { background: var(--bg-3); color: var(--fg); }
  .hint { font-size: 11px; color: var(--fg-3); margin-top: 10px; }
</style></head><body>
<div class="lbl">Start marker</div>
<input id="q" placeholder="Type a label, Enter to fire" autofocus />
<ul id="list"></ul>
<div class="hint">Enter to fire · Esc to cancel · ↑↓ to navigate</div>
<script>
const { ipcRenderer } = require("electron");
const all = ${labels};
const q = document.getElementById("q");
const list = document.getElementById("list");
let sel = 0;
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function filtered() {
  const term = q.value.toLowerCase();
  const matched = all.filter(l => l.toLowerCase().includes(term));
  const typed = q.value.trim();
  if (typed && !matched.some(l => l.toLowerCase() === typed.toLowerCase())) {
    matched.push(typed + "  (new)");
  }
  return matched;
}
function render() {
  const items = filtered();
  if (sel >= items.length) sel = items.length - 1;
  if (sel < 0) sel = 0;
  /* XSS guard: labels come from user typing and from config; both are
     escaped before being injected via innerHTML. */
  list.innerHTML = items.map((l, i) =>
    '<li class="' + (i === sel ? 'sel' : '') + '" data-i="' + i + '">' + esc(l) + '</li>'
  ).join('');
  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => { sel = Number(li.dataset.i); fire(); });
  });
}
function fire() {
  const items = filtered();
  let label = items[sel] || q.value.trim();
  label = label.replace(/  \\(new\\)$/, "");
  if (!label) return;
  ipcRenderer.invoke("pdt:fireStart", label);
  window.close();
}
q.addEventListener("input", () => { sel = 0; render(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); fire(); }
  else if (e.key === "Escape") { window.close(); }
  else if (e.key === "ArrowDown") { sel++; render(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel--; render(); e.preventDefault(); }
});
render();
</script></body></html>`;
}

ipcMain.handle("pdt:fireStart", (_e, label) => fireStartMarker(label));

/* --- Status window IPC -------------------------------------------- */

function recorderStateLabel(paused) {
  if (!config || !config.interactions || !config.interactions.enabled) return "disabled";
  if (recorderPermanentlyDead) return "dead";
  if (!recorder) return "off";
  return paused ? "paused" : "on";
}

ipcMain.handle("pdt:status", () => {
  if (!tracker) {
    return {
      tracking: false,
      paused: false,
      obsConnected: false,
      idle: false,
      recovered: recoveredCount > 0,
      screenshotsEnabled: !!(config && config.screenshots && config.screenshots.enabled),
      recorder_state: recorderStateLabel(false),
      interactionCount: 0,
    };
  }
  const s = tracker.getStatus();
  return {
    tracking: true,
    paused: s.paused,
    obsConnected,
    idle: isIdle,
    recovered: recoveredCount > 0,
    currentApp: s.currentApp,
    currentTitle: s.currentTitle,
    openMarkers: s.openMarkers,
    markerDepth: s.markerDepth,
    eventCount: s.eventCount,
    markerCount: s.markerCount,
    screenshotCount: s.screenshotCount,
    interactionCount: s.interactionCount || 0,
    elapsedMs: s.elapsedMs,
    recentEvents: s.recentEvents,
    screenshotsEnabled: !!(config && config.screenshots && config.screenshots.enabled),
    recorder_state: recorderStateLabel(s.paused),
  };
});

ipcMain.handle("pdt:togglePause", () => {
  if (!tracker) return null;
  const s = tracker.getStatus();
  if (s.paused) tracker.resume(); else tracker.pause();
  lastStatus = tracker.getStatus();
  if (recorder) {
    try { lastStatus.paused ? recorder.pause() : recorder.resume(); } catch (_e) {}
  }
  refreshTray();
  return lastStatus;
});

ipcMain.handle("pdt:manualScreenshot", () => fireManualScreenshot());
ipcMain.handle("pdt:startSession", async () => {
  const s = await startSession();
  refreshTray();
  return s ? { sessionFolder: s.sessionFolder } : null;
});
ipcMain.handle("pdt:endSession", async () => {
  const f = await endSession();
  refreshTray();
  return f;
});

ipcMain.handle("pdt:fireEnd", () => { fireEndMarker(); });

ipcMain.handle("pdt:fireSync", (_e, syncId) => {
  /* Cross-machine sync marker (§13). Workers fire this at agreed
     moments (transaction handoffs, hourly ticks). The shared sync_id
     lets the analyst correlate timelines across machines later. */
  if (!tracker) return null;
  const id = (syncId && String(syncId).trim()) ||
    `sync-${new Date().toISOString().replace(/[:.]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  tracker.fireSystem("sync_marker", { sync_id: id });
  return id;
});

function toggleStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.close();
    statusWindow = null;
    return;
  }
  statusWindow = showStatusWindow();
  statusWindow.on("closed", () => { statusWindow = null; });
}

function showHelp() {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.show();
    helpWindow.focus();
    return;
  }
  helpWindow = showHelpWindow();
  helpWindow.on("closed", () => { helpWindow = null; });
}

function toggleOperatorPanel() {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.close();
    operatorWindow = null;
    return;
  }
  operatorWindow = showOperatorPanel(config);
  operatorWindow.on("closed", () => { operatorWindow = null; });
}

function statusLine() {
  if (!tracker) return "Idle -- right-click to start a session";
  if (lastStatus && lastStatus.paused) return `Paused (${lastStatus.markerDepth} open)`;
  const appName = (lastStatus && lastStatus.currentApp) || "(no window)";
  const depth = (lastStatus && lastStatus.markerDepth) || 0;
  const obsTag = obsConnected ? " - OBS" : "";
  const idleTag = isIdle ? " - idle" : "";
  let recTag = "";
  if (config && config.interactions && config.interactions.enabled) {
    if (recorderPermanentlyDead) recTag = " - recorder DEAD";
    else if (!recorder) recTag = " - recorder OFF";
  }
  return `Tracking: ${appName} - ${depth} open${obsTag}${idleTag}${recTag}`;
}

function buildMenu() {
  const items = [
    { label: statusLine(), enabled: false },
    { type: "separator" },
  ];
  if (!tracker) {
    items.push({
      label: "Start capture session",
      click: async () => { await startSession(); refreshTray(); },
    });
    items.push({
      label: "Start app vocabulary prep session...",
      click: async () => { await startAppPrepSession(); refreshTray(); },
    });
  } else {
    items.push({
      label: "Fire Start marker...",
      accelerator: config.hotkeys.start_picker,
      click: () => showLabelPicker(),
    });
    if (config.process_labels && config.process_labels.length) {
      const quickStart = config.process_labels.map((label) => ({
        label,
        click: () => fireStartMarker(label),
      }));
      items.push({ label: "Quick start", submenu: quickStart });
    }
    const innermost =
      lastStatus && lastStatus.markerDepth > 0
        ? lastStatus.openMarkers[lastStatus.openMarkers.length - 1]
        : null;
    items.push({
      label: innermost ? `Fire End marker (closes "${innermost}")` : "Fire End marker",
      accelerator: config.hotkeys.end_innermost,
      enabled: !!innermost,
      click: () => fireEndMarker(),
    });
    items.push({
      label: "Manual screenshot",
      accelerator: config.hotkeys.manual_screenshot,
      enabled: !!config.screenshots.enabled,
      click: () => fireManualScreenshot(),
    });
    items.push({ type: "separator" });
    items.push({
      label: lastStatus && lastStatus.paused ? "Resume polling" : "Pause polling",
      click: () => {
        if (!tracker) return;
        if (lastStatus && lastStatus.paused) tracker.resume();
        else tracker.pause();
        lastStatus = tracker.getStatus();
        if (recorder) {
          try { lastStatus.paused ? recorder.pause() : recorder.resume(); } catch (_e) {}
        }
        refreshTray();
      },
    });
    items.push({
      label: "End capture session",
      click: async () => {
        const folder = await endSession();
        const r = await dialog.showMessageBox({
          type: "info",
          message: "Session ended.",
          detail: folder ? `Saved to: ${folder}` : "",
          buttons: folder ? ["Open in viewer", "Close"] : ["OK"],
          defaultId: 0,
          cancelId: folder ? 1 : 0,
        });
        if (folder && r.response === 0) openInViewer(folder);
        refreshTray();
      },
    });
  }
  items.push({ type: "separator" });
  items.push({
    label: statusWindow ? "Hide status window" : "Show status window",
    click: () => toggleStatusWindow(),
  });
  items.push({
    label: operatorWindow ? "Hide operator panel" : "Show operator panel",
    click: () => toggleOperatorPanel(),
  });
  // Recent sessions submenu -- each session gets a nested submenu so
  // the worker can open in viewer, reveal in Explorer, or delete the
  // folder from the locked-down work laptop where Python isn't
  // available to run scripts/prune-sessions.py.
  const recent = listRecentSessions(baseDir, 8);
  const activeFolder = session ? session.sessionFolder : null;
  if (recent.length) {
    const recentItems = recent.map((r) => {
      const when = (r.started_at || "").slice(0, 19).replace("T", " ");
      const status = r.status === "active" ? "  (active)" : (r.status === "recovered" ? "  (recovered)" : "");
      const size = folderSizeHuman(r.sessionFolder);
      const isCurrent = r.sessionFolder === activeFolder;
      const childItems = [
        { label: "Open in viewer", click: () => openInViewer(r.sessionFolder) },
        { label: "Reveal in folder", click: () => shell.showItemInFolder(r.sessionFolder) },
        { type: "separator" },
        {
          label: isCurrent ? "Delete... (currently recording)" : "Delete...",
          enabled: !isCurrent,
          click: () => confirmAndDeleteSession(r.sessionFolder, r.label),
        },
      ];
      return {
        label: when + "  " + r.engagement + status + "  (" + size + ")",
        submenu: childItems,
      };
    });
    recentItems.push({ type: "separator" });
    recentItems.push({ label: "Open sessions folder", click: () => shell.openPath(baseDir) });
    items.push({ label: "Recent sessions", submenu: recentItems });
  } else {
    items.push({ label: "Open sessions folder", click: () => shell.openPath(baseDir) });
  }
  // Aggregate disk-usage line + prune-by-age submenu.
  const totals = getSessionsTotal();
  items.push({
    label: `Sessions on disk: ${totals.count} / ${humanSize(totals.bytes)}`,
    enabled: false,
  });
  if (totals.count > 0) {
    items.push({
      label: "Prune sessions older than...",
      submenu: [
        { label: "30 days", click: () => confirmAndPruneByAge(30) },
        { label: "90 days", click: () => confirmAndPruneByAge(90) },
        { label: "365 days", click: () => confirmAndPruneByAge(365) },
      ],
    });
  }
  items.push({ label: "Set up OBS recording...", click: () => showObsSetupDialog() });
  items.push({ label: "Help - How to use", click: () => showHelp() });
  if (configSourcePath) {
    items.push({
      label: `Config: ${path.basename(configSourcePath)}`,
      enabled: false,
    });
  } else {
    items.push({ label: "Config: defaults (set PDT_CONFIG to override)", enabled: false });
  }
  items.push({ type: "separator" });
  items.push({
    label: "Quit",
    click: async () => {
      if (tracker) await endSession();
      globalShortcut.unregisterAll();
      app.quit();
    },
  });
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(statusLine());
  tray.setContextMenu(buildMenu());
}

app.whenReady().then(() => {
  bootLog("app ready");
  baseDir = path.join(app.getPath("userData"), "sessions");

  const cfgPath = process.env.PDT_CONFIG || null;
  const loaded = loadConfig(cfgPath);
  config = loaded.config;
  configSourcePath = loaded.sourcePath;
  bootLog(`config loaded from ${configSourcePath || "(defaults)"}`);

  const orphans = findOrphanedSessions(baseDir);
  recoveredCount = orphans.length;
  for (const o of orphans) {
    markSessionRecovered({ sessionFolder: o.sessionFolder });
    bootLog(`marked orphan recovered: ${o.sessionFolder}`);
  }

  tray = new Tray(trayIconImage());
  tray.setToolTip("Process Discovery Tracker -- idle");
  refreshTray();
  tray.on("right-click", () => tray.popUpContextMenu());
  tray.on("click", () => tray.popUpContextMenu());

  const okStart = globalShortcut.register(config.hotkeys.start_picker, async () => {
    if (!tracker) {
      const s = await startSession();
      if (!s) return;
    }
    showLabelPicker();
  });
  const okEnd = globalShortcut.register(config.hotkeys.end_innermost, () => fireEndMarker());
  const okShot = globalShortcut.register(config.hotkeys.manual_screenshot, () => fireManualScreenshot());
  let okSync = false;
  if (config.hotkeys.sync_marker) {
    okSync = globalShortcut.register(config.hotkeys.sync_marker, () => {
      if (!tracker) return;
      const id = `sync-${new Date().toISOString().replace(/[:.]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
      tracker.fireSystem("sync_marker", { sync_id: id });
    });
  }
  bootLog(`hotkeys: start=${okStart} end=${okEnd} shot=${okShot} sync=${okSync}`);
}).catch((e) => bootLog(`whenReady failed: ${(e && e.stack) || e}`));

app.on("window-all-closed", (e) => {
  if (e && e.preventDefault) e.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

let _quitting = false;
app.on("before-quit", async (e) => {
  if (_quitting) return;
  if (tracker) {
    e.preventDefault();
    _quitting = true;
    bootLog("before-quit: stopping tracker");
    try { await endSession(); } catch (err) { bootLog(`stop error: ${err}`); }
    app.quit();
  }
});
