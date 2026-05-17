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
const { showSessionConfigWindow } = require("./session-config-window.js");
const welcomeWin = require("./welcome-window.js");
const hotkeyOverlay = require("./hotkey-overlay.js");
const { createWindowManager } = require("./window-manager.js");
const { createSessionStorage } = require("./session-storage.js");
const { appLogger } = require("./log.js");
const crypto = require("node:crypto");

const { bootLog } = require("./boot-log.js");
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
let trayMenu = null;  // rebuilt by refreshTray(); shown via popUpContextMenu
let tracker = null;
let session = null;
let lastStatus = null;
let labelPickerWindow = null;
/* status, help, operator, obsSettings, sessionConfig — all single-instance
   tray windows; the picker stays separate (blur-close + nest IPC). */
const windows = createWindowManager();
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

const { notifyUser, trayIconImage } = require("./notify.js");

/* Session disk-usage accounting + the delete / prune flows. */
const sessionStorage = createSessionStorage({
  getBaseDir: () => baseDir,
  getActiveSessionFolder: () => (session ? session.sessionFolder : null),
  refreshTray: () => refreshTray(),
});

/* Leading-edge debounce: a burst of triggers (an app switch plus a
   marker start/end landing together) collapses to a single capture.
   Manual shots pass { force: true } and are never suppressed. */
const SCREENSHOT_MIN_INTERVAL_MS = 2000;
let lastScreenshotMs = 0;
let screenshotFailureNotified = false;

async function fireScreenshot(kind, opts) {
  if (!tracker || !session || !config.screenshots.enabled) return;
  const now = Date.now();
  if (!(opts && opts.force) && now - lastScreenshotMs < SCREENSHOT_MIN_INTERVAL_MS) {
    bootLog(`screenshot coalesced (${now - lastScreenshotMs}ms since last, kind=${kind})`);
    return;
  }
  lastScreenshotMs = now;
  try {
    // Pass the foreground window bounds so multi-monitor "active"
    // mode can pick the right display. lastStatus is refreshed every
    // tick via onTickHandler; if we don't have it yet (e.g. fire just
    // after session_start), screenshots.js falls back to cursor pos
    // then primary.
    const result = await captureScreenshot({
      screenshotsFolder: path.join(session.sessionFolder, "screenshots"),
      quality: config.screenshots.quality,
      mode: config.screenshots.display,
      foregroundBounds: lastStatus ? lastStatus.currentBounds : null,
    });
    if (!result) return;
    // captureScreenshot returns string|string[]. Emit one system
    // event per file so the timeline shows a dot for each display
    // when display="all".
    const paths = Array.isArray(result) ? result : [result];
    for (const p of paths) tracker.fireSystem(kind || "screenshot", { path: p });
  } catch (e) {
    bootLog(`screenshot failed: ${e && e.message}`);
    if (!screenshotFailureNotified) {
      screenshotFailureNotified = true;
      notifyUser(
        "Process Discovery Tracker",
        "Screenshots are failing. The session is still recording markers, video, and interactions, but screenshots will be missing until you restart the session.",
        { urgency: "normal" }
      );
    }
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
    const threshold = config.idle_threshold_seconds;
    const autoEndSecs = config.auto_end_idle_minutes * 60;

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
        config.screenshots.on_idle_resume_minutes * 60;
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

function showObsSetupDialog() {
  windows.show("obsSettings", () => showObsSettingsWindow());
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

function quickConfigPath() {
  return path.join(app.getPath("userData"), "quick-config.yaml");
}

ipcMain.handle("pdt:sessionConfigGet", () => {
  const p = quickConfigPath();
  if (!fs.existsSync(p)) return { yaml: "", path: null };
  try { return { yaml: fs.readFileSync(p, "utf-8"), path: p }; }
  catch (e) { return { yaml: "", path: p, error: String(e && e.message) }; }
});

ipcMain.handle("pdt:sessionConfigSave", (_e, { yaml: text }) => {
  const p = quickConfigPath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, text || "", "utf-8");
    bootLog(`quick-config saved to ${p}`);
    appLogger().info(`quick-config saved to ${p}`);
    return { saved: true, path: p };
  } catch (e) {
    return { saved: false, path: p, error: String(e && e.message) };
  }
});

function showSessionConfigDialog() {
  windows.show("sessionConfig", () => showSessionConfigWindow());
}

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
    appLogger().info(`OBS connected at ${eff.websocket_url}`);
    if (config.obs.auto_create_scene) {
      try {
        await ensureScene(obs, config.obs.scene_name);
        bootLog(`scene ensured: ${config.obs.scene_name}`);
      } catch (e) {
        bootLog(`scene bootstrap failed: ${e && e.message}`);
        appLogger().warn(`OBS scene bootstrap failed for "${config.obs.scene_name}"`, e);
      }
    }
    return true;
  } catch (e) {
    bootLog(`OBS connect failed: ${e && e.message}`);
    appLogger().error(`OBS connect failed at ${eff.websocket_url}`, e);
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
    // Non-strict mode: surface a non-blocking toast instead of failing
    // silently. This is the most common cause of "I captured a session
    // and there's no video" -- the user genuinely didn't realise OBS
    // wasn't connected.
    notifyUser(
      "Process Discovery Tracker",
      `OBS not reachable at ${eff.websocket_url}. Recording will continue without video.`,
      { urgency: "low" }
    );
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
      backgroundColor: "#14141A",
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
        :root{color-scheme:dark;--bg:#14141A;--bg-2:#22222A;--bg-3:#2E2E37;--bg-4:#3A3A44;
          --border:#424250;--fg:#D8D6CE;--fg-2:#A8A69E;--fg-3:#807E78;
          --accent:#6E8A66;--accent-2:#5A7488}
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
        button:hover{background:var(--bg-4);border-color:var(--accent)}
        button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg)}
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
      appLogger().error("OBS startRecording failed", e);
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
  screenshotFailureNotified = false;
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
    recorderRestartCount < config.interactions.max_restarts_per_session
  ) {
    recorderRestartCount += 1;
    setTimeout(() => {
      if (!tracker) return;
      startRecorderForSession();
    }, 5000);
  } else {
    recorderPermanentlyDead = true;
    tracker.fireSystem("recorder_dead_permanent");
    notifyUser(
      "Process Discovery Tracker",
      "Interaction recorder stopped. The session is still recording markers and screenshots, but no UI interaction events will be captured until you restart the session.",
      { urgency: "critical" }
    );
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
      appLogger().error("OBS stopRecording failed", e);
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
  sessionStorage.invalidateSessionsCache();  // new session lands in the count + size
  return oldFolder;
}

/* Default semantics: pressing Start with a marker already open
   should CLOSE the current one and open the new one as a sibling.
   The previous default (always nest) was producing sessions like
   "4 starts, 0 ends, all chained" because users had no obvious way
   to end markers. To still allow intentional nesting, callers pass
   `nest: true` (operator panel offers a Shift+Click button, label
   picker offers a "Nest under current" submenu). */
async function fireStartMarker(label, opts) {
  opts = opts || {};
  if (!tracker) {
    const s = await startSession();
    if (!s) return;
  }
  const stat = tracker.getStatus();
  if (!opts.nest && stat.markerDepth > 0) {
    /* Close any currently-open markers (innermost first) before
       starting the new one. Mirrors what the worker probably meant
       when they pressed Start the second time. */
    while (tracker.getStatus().markerDepth > 0) {
      tracker.fireMarker({ markerType: "end", reason: "auto_close_for_sibling" });
    }
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
  fireScreenshot("screenshot_manual", { force: true });
}

/* Picker semantics: if a marker is already open and the caller doesn't
   force nest, the picker shows "Nest" as a secondary action so the
   user can flip semantics on the fly. The default (Enter, primary
   button) closes-and-opens, matching the new fireStartMarker default. */
let _pickerNest = false;
function showLabelPicker(opts) {
  opts = opts || {};
  _pickerNest = !!opts.nest;
  if (labelPickerWindow && !labelPickerWindow.isDestroyed()) {
    // Reload with the current nest mode so the secondary button text
    // and the hint update.
    labelPickerWindow.webContents.send("pdt:setNest", _pickerNest);
    labelPickerWindow.show();
    labelPickerWindow.focus();
    return;
  }
  labelPickerWindow = new BrowserWindow({
    width: 460,
    height: 400,
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
  // Pass current marker stack so we can show "Will close: <innermost>"
  // hint, and the initial nest mode requested by the caller.
  const stack = lastStatus && lastStatus.openMarkers ? lastStatus.openMarkers : [];
  const stackJson = JSON.stringify(stack);
  const initialNest = _pickerNest ? "true" : "false";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Start marker</title>
<style>
  :root {
    color-scheme: dark;
    --bg:       #14141A;
    --bg-2:     #22222A;
    --bg-3:     #2E2E37;
    --border:   #424250;
    --fg:       #D8D6CE;
    --fg-2:     #A8A69E;
    --fg-3:     #807E78;
    --accent:   #6E8A66;
    --warn:     #A08050;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px 16px; background: var(--bg); color: var(--fg);
         font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; }
  .lbl { font-size: 11px; margin: 0 0 8px; color: var(--fg-3); letter-spacing: 0.5px; text-transform: uppercase; }
  .stack-hint { font-size: 11px; color: var(--warn); margin: 0 0 8px; padding: 5px 8px;
                background: rgba(160, 128, 80, 0.10); border-radius: 4px; }
  .stack-hint code { font-family: "IBM Plex Mono", Consolas, monospace; color: var(--fg-2); }
  input { width: 100%; padding: 9px 11px; background: var(--bg-2);
          border: 1px solid var(--border); color: var(--fg);
          border-radius: 4px; font-family: inherit; font-size: 13px; outline: none; }
  input:focus { border-color: var(--accent); }
  input::placeholder { color: var(--fg-3); }
  ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 200px; overflow-y: auto; }
  li { padding: 7px 10px; border-radius: 4px; cursor: pointer; color: var(--fg-2); font-size: 13px; }
  li.sel { background: var(--accent); color: var(--bg); }
  li:hover:not(.sel) { background: var(--bg-3); color: var(--fg); }
  .row { display: flex; gap: 6px; margin-top: 10px; }
  .row button { flex: 1; padding: 7px 10px; background: var(--bg-2); color: var(--fg-2);
                border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
                font-family: inherit; font-size: 12px; }
  .row button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 500; }
  .row button:hover:not(:disabled) { background: var(--bg-3); color: var(--fg); }
  .row button.primary:hover { background: #8AAB7E; border-color: #8AAB7E; }
  .hint { font-size: 11px; color: var(--fg-3); margin-top: 8px; line-height: 1.4; }
</style></head><body>
<div class="lbl">Start marker</div>
<div id="stack-hint" class="stack-hint" style="display:none"></div>
<input id="q" placeholder="Type a label, Enter to fire" autofocus />
<ul id="list"></ul>
<div class="row">
  <button id="btn-fire" class="primary">Fire</button>
  <button id="btn-fire-nest">Nest under current</button>
</div>
<div class="hint">Enter to fire · Esc to cancel · ↑↓ navigate · Shift+Enter to nest</div>
<script>
const { ipcRenderer } = require("electron");
const all = ${labels};
const stack = ${stackJson};
let nestMode = ${initialNest};
const q = document.getElementById("q");
const list = document.getElementById("list");
const stackHint = document.getElementById("stack-hint");
const btnFire = document.getElementById("btn-fire");
const btnNest = document.getElementById("btn-fire-nest");
let sel = 0;
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function refreshChrome() {
  if (stack.length > 0) {
    const innermost = stack[stack.length - 1];
    stackHint.innerHTML = nestMode
      ? 'Will nest <strong>under</strong> <code>' + esc(innermost) + '</code> (closes nothing).'
      : 'Will <strong>close</strong> <code>' + esc(innermost) + '</code>' +
        (stack.length > 1 ? ' (and ' + (stack.length - 1) + ' parent' + (stack.length > 2 ? 's' : '') + ')' : '') +
        ' before firing.';
    stackHint.style.display = 'block';
    btnFire.textContent = 'Fire (close current)';
    btnNest.disabled = false;
    btnNest.style.display = '';
    if (nestMode) {
      btnFire.classList.remove('primary');
      btnNest.classList.add('primary');
    } else {
      btnFire.classList.add('primary');
      btnNest.classList.remove('primary');
    }
  } else {
    stackHint.style.display = 'none';
    btnFire.textContent = 'Fire';
    btnNest.style.display = 'none';
  }
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
    li.addEventListener('click', () => { sel = Number(li.dataset.i); fire(nestMode); });
  });
}
function fire(nest) {
  const items = filtered();
  let label = items[sel] || q.value.trim();
  label = label.replace(/  \\(new\\)$/, "");
  if (!label) return;
  ipcRenderer.invoke("pdt:fireStart", label, { nest: !!nest });
  window.close();
}
q.addEventListener("input", () => { sel = 0; render(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fire(e.shiftKey ? !nestMode : nestMode);
  }
  else if (e.key === "Escape") { window.close(); }
  else if (e.key === "ArrowDown") { sel++; render(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel--; render(); e.preventDefault(); }
});
btnFire.addEventListener("click", () => fire(false));
btnNest.addEventListener("click", () => fire(true));
refreshChrome();
render();
</script></body></html>`;
}

ipcMain.handle("pdt:fireStart", (_e, label, opts) => fireStartMarker(label, opts || {}));

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

function togglePause() {
  if (!tracker) return null;
  const s = tracker.getStatus();
  if (s.paused) tracker.resume(); else tracker.pause();
  lastStatus = tracker.getStatus();
  if (recorder) {
    try { lastStatus.paused ? recorder.pause() : recorder.resume(); } catch (_e) {}
  }
  refreshTray();
  return lastStatus;
}

ipcMain.handle("pdt:togglePause", () => togglePause());

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
  windows.toggle("status", () => showStatusWindow());
}

function showHelp() {
  windows.show("help", () => showHelpWindow());
}

function toggleOperatorPanel() {
  windows.toggle("operator", () => showOperatorPanel(config));
}

function statusLine() {
  if (!tracker) return "Idle -- click to start a session";
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
    // When a marker is already open, surface explicit nest-vs-sibling
    // semantics. Default press of Start (above) closes-and-opens; this
    // submenu lets the user choose nesting per-fire.
    const hasOpen = lastStatus && lastStatus.markerDepth > 0;
    if (hasOpen) {
      items.push({
        label: "Fire Start (nest under current)...",
        click: () => showLabelPicker({ nest: true }),
      });
    }
    if (config.process_labels && config.process_labels.length) {
      const quickStart = config.process_labels.map((label) => ({
        label,
        click: () => fireStartMarker(label),
      }));
      items.push({ label: "Quick start", submenu: quickStart });
      if (hasOpen) {
        const quickNest = config.process_labels.map((label) => ({
          label,
          click: () => fireStartMarker(label, { nest: true }),
        }));
        items.push({ label: "Quick start (nested)", submenu: quickNest });
      }
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
      click: () => togglePause(),
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
  // P2.13: group everything beyond the muscle-memory action items
  // (Fire Start / End / Pause / End session) into named submenus so
  // the flat tray fits even at small DPI.

  // === Live status submenu ===
  items.push({
    label: "Live status",
    submenu: [
      {
        label: windows.isOpen("operator") ? "Hide Live Session window" : "Show Live Session window",
        click: () => toggleOperatorPanel(),
      },
      {
        label: windows.isOpen("status") ? "Hide status window (legacy)" : "Show status window (legacy)",
        click: () => toggleStatusWindow(),
      },
      {
        label: hotkeyOverlay.isVisible() ? "Hide hotkey overlay" : "Show hotkey overlay",
        click: () => {
          hotkeyOverlay.toggleOverlay(config && config.hotkeys);
          refreshTray();
        },
      },
    ],
  });

  // === Storage submenu ===
  const recent = listRecentSessions(baseDir, 8);
  const activeFolder = session ? session.sessionFolder : null;
  const totals = sessionStorage.getSessionsTotal();
  const storageItems = [];
  if (recent.length) {
    const recentItems = recent.map((r) => {
      const when = (r.started_at || "").slice(0, 19).replace("T", " ");
      const status = r.status === "active" ? "  (active)" : (r.status === "recovered" ? "  (recovered)" : "");
      const size = sessionStorage.folderSizeHuman(r.sessionFolder);
      const isCurrent = r.sessionFolder === activeFolder;
      const childItems = [
        { label: "Open in viewer", click: () => openInViewer(r.sessionFolder) },
        { label: "Reveal in folder", click: () => shell.showItemInFolder(r.sessionFolder) },
        { type: "separator" },
        {
          label: isCurrent ? "Delete... (currently recording)" : "Delete...",
          enabled: !isCurrent,
          click: () => sessionStorage.confirmAndDeleteSession(r.sessionFolder, r.label),
        },
      ];
      return {
        label: when + "  " + r.engagement + status + "  (" + size + ")",
        submenu: childItems,
      };
    });
    storageItems.push({ label: "Recent sessions", submenu: recentItems });
  }
  storageItems.push({ label: "Open sessions folder", click: () => shell.openPath(baseDir) });
  storageItems.push({
    label: `On disk: ${totals.count} / ${sessionStorage.humanSize(totals.bytes)}`,
    enabled: false,
  });
  if (totals.count > 0) {
    storageItems.push({
      label: "Prune sessions older than...",
      submenu: [
        { label: "30 days", click: () => sessionStorage.confirmAndPruneByAge(30) },
        { label: "90 days", click: () => sessionStorage.confirmAndPruneByAge(90) },
        { label: "365 days", click: () => sessionStorage.confirmAndPruneByAge(365) },
      ],
    });
  }
  items.push({ label: "Storage", submenu: storageItems });

  // === Help & config submenu ===
  const helpItems = [
    { label: "How to use...", click: () => showHelp() },
    { label: "Show welcome screen", click: () => welcomeWin.showWelcomeWindow({ hotkeys: config && config.hotkeys }) },
    { type: "separator" },
    { label: "Set up OBS recording...", click: () => showObsSetupDialog() },
    { label: "Set up a recording session...", click: () => showSessionConfigDialog() },
    { type: "separator" },
    {
      label: configSourcePath
        ? `Config: ${path.basename(configSourcePath)}`
        : "Config: defaults (set PDT_CONFIG to override)",
      enabled: false,
    },
  ];
  items.push({ label: "Help & config", submenu: helpItems });

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
  /* Keep the menu in a variable; the click handlers show it via
     popUpContextMenu. We deliberately do NOT call setContextMenu --
     on Windows that auto-shows the menu on right-click, which then
     double-fires against our own right-click handler and leaves
     right-click doing nothing. */
  trayMenu = buildMenu();
}

app.whenReady().then(() => {
  bootLog("app ready");
  baseDir = path.join(app.getPath("userData"), "sessions");

  let cfgPath = process.env.PDT_CONFIG || null;
  if (!cfgPath) {
    const qc = path.join(app.getPath("userData"), "quick-config.yaml");
    if (fs.existsSync(qc)) cfgPath = qc;
  }
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
  // Left- and right-click both open the menu, symmetrically. Driven
  // explicitly (not via setContextMenu) so right-click does not
  // double-fire -- see refreshTray().
  tray.on("click", () => { if (trayMenu) tray.popUpContextMenu(trayMenu); });
  tray.on("right-click", () => { if (trayMenu) tray.popUpContextMenu(trayMenu); });

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

  // P2.10: surface any hotkey-registration failures to the operator
  // via a Windows toast. Today the failure is only in boot.log, so a
  // user with a conflicting global shortcut (some screen-recorder /
  // password-manager combos grab Ctrl+Shift+S) discovers the problem
  // by pressing the hotkey and seeing nothing happen.
  const failed = [];
  if (!okStart) failed.push(["Start picker", config.hotkeys.start_picker]);
  if (!okEnd)   failed.push(["End marker",   config.hotkeys.end_innermost]);
  if (!okShot)  failed.push(["Screenshot",   config.hotkeys.manual_screenshot]);
  if (config.hotkeys.sync_marker && !okSync) {
    failed.push(["Sync marker", config.hotkeys.sync_marker]);
  }
  if (failed.length) {
    const list = failed.map(([name, key]) => `${name} (${key})`).join(", ");
    notifyUser(
      "Hotkey conflict",
      `Couldn't register: ${list}. Another app is using these shortcuts. Use the tray menu, or change the bindings via the "Set up a recording session" window.`,
      { urgency: "low" }
    );
  }

  // First-run welcome. shouldShowOnLaunch() returns true once per
  // machine (gated by userData/welcome-shown.json).
  if (welcomeWin.shouldShowOnLaunch()) {
    welcomeWin.showWelcomeWindow({ hotkeys: config.hotkeys });
  }

  // Hotkey overlay -- restore if previously visible.
  if (hotkeyOverlay.shouldRestoreOnLaunch()) {
    hotkeyOverlay.showOverlay(config.hotkeys);
  }
}).catch((e) => bootLog(`whenReady failed: ${(e && e.stack) || e}`));

// Welcome-window CTA dispatcher
ipcMain.handle("pdt:welcomeAction", (_e, action) => {
  if (action === "operator") {
    toggleOperatorPanel();   // existing helper that handles show/hide + IPC
  } else if (action === "help") {
    showHelp();
  }
});

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
