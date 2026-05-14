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
} = require("./session.js");
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

async function showObsSetupDialog() {
  const obsCfg = (config && config.obs) || {};
  const url = obsCfg.websocket_url || "ws://127.0.0.1:4455";
  let testResult = "Click 'Test connection' to verify OBS is reachable.";
  /* Try a quick test first so the dialog has live state on open. */
  try {
    const probe = await connectOBS({
      websocketUrl: url,
      password: obsCfg.websocket_password,
    });
    try { await probe.disconnect(); } catch (_e) {}
    testResult = `OBS reachable at ${url}. You're all set - start a capture session and recording begins automatically.`;
  } catch (e) {
    testResult = `OBS NOT reachable at ${url}: ${e && e.message}\n\nFollow the steps below.`;
  }
  const detail =
    `Status:\n${testResult}\n\n` +
    `Setup steps (one time):\n` +
    `1. Install OBS Studio 28+ from obsproject.com.\n` +
    `2. In OBS, open Tools -> WebSocket Server Settings.\n` +
    `3. Tick "Enable WebSocket server", leave port at 4455.\n` +
    `4. Click OK. Leave OBS running.\n` +
    `5. Start a capture session here. Recording starts automatically.\n\n` +
    `You don't need to click record in OBS. You also don't need to keep OBS in the foreground.\n\n` +
    `If you set a WebSocket password, copy it into your per-session config under obs.websocket_password.\n\n` +
    `To require OBS (fail-fast on connect error), set obs.required: true in your config.yaml.`;
  await dialog.showMessageBox({
    type: "info",
    title: "OBS recording setup",
    message: "How to record your captured sessions with OBS",
    detail,
    buttons: ["Close"],
    defaultId: 0,
  });
}

async function setupOBS() {
  if (!config.obs || !config.obs.websocket_url) return false;
  try {
    obs = await connectOBS({
      websocketUrl: config.obs.websocket_url,
      password: config.obs.websocket_password,
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
        `Could not connect to OBS at ${config.obs.websocket_url}.\n\n` +
          `${e && e.message}\n\n` +
          `Per session config, OBS is required. Launch OBS (with WebSocket enabled) and try again.`
      );
      return false;
    }
    return true; // proceed without OBS in non-strict mode
  }
}

async function startSession() {
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

  session = createSession({
    baseDir,
    engagementId: config.engagement_id,
    config,
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
        dialog.showMessageBox({
          type: "info",
          message: "Session ended.",
          detail: folder ? `Output: ${folder}` : "",
          buttons: ["OK"],
        });
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
  items.push({ label: "Open sessions folder", click: () => shell.openPath(baseDir) });
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
