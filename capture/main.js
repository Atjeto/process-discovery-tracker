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
let obs = null;
let obsConnected = false;
let config = null;
let configSourcePath = null;
let baseDir = null;
let recoveredCount = 0;

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
  }
  lastTrackedApp = null;
  lastStatus = tracker.getStatus();
  startIdleMonitor();
  bootLog(`session started: ${session.sessionFolder}`);
  return session;
}

async function endSession() {
  if (!tracker) return null;
  stopIdleMonitor();

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
    backgroundColor: "#1a1a1f",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
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
<html><head><meta charset="utf-8"><title>Start marker</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px; background: #1a1a1f; color: #e8e8ea;
         font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; }
  h1 { font-size: 10px; margin: 0 0 10px; letter-spacing: 1.5px;
       text-transform: uppercase; color: #888; }
  input { width: 100%; padding: 10px; box-sizing: border-box; background: #25252c;
          border: 1px solid #38383f; color: #fff; border-radius: 4px;
          font-family: inherit; font-size: 14px; }
  input:focus { outline: none; border-color: #6a8caf; }
  ul { list-style: none; padding: 0; margin: 10px 0 0; max-height: 220px; overflow-y: auto; }
  li { padding: 8px 10px; border-radius: 4px; cursor: pointer; color: #c8c8d0; }
  li.sel { background: #2c3a48; color: #fff; }
  li:hover { background: #25252c; }
  .hint { font-size: 10px; color: #666; margin-top: 10px; }
</style></head><body>
<h1>Start marker</h1>
<input id="q" placeholder="Type label or pick from list, Enter to fire" autofocus />
<ul id="list"></ul>
<div class="hint">Enter: fire &middot; Esc: cancel &middot; &uarr;&darr;: navigate</div>
<script>
const { ipcRenderer } = require("electron");
const all = ${labels};
const q = document.getElementById("q");
const list = document.getElementById("list");
let sel = 0;
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
  list.innerHTML = items.map((l, i) =>
    '<li class="' + (i === sel ? 'sel' : '') + '" data-i="' + i + '">' + l + '</li>'
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

ipcMain.handle("pdt:status", () => {
  if (!tracker) {
    return {
      tracking: false,
      paused: false,
      obsConnected: false,
      idle: false,
      recovered: recoveredCount > 0,
      screenshotsEnabled: !!(config && config.screenshots && config.screenshots.enabled),
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
    elapsedMs: s.elapsedMs,
    recentEvents: s.recentEvents,
    screenshotsEnabled: !!(config && config.screenshots && config.screenshots.enabled),
  };
});

ipcMain.handle("pdt:togglePause", () => {
  if (!tracker) return null;
  const s = tracker.getStatus();
  if (s.paused) tracker.resume(); else tracker.pause();
  lastStatus = tracker.getStatus();
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

function toggleStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.close();
    statusWindow = null;
    return;
  }
  statusWindow = showStatusWindow();
  statusWindow.on("closed", () => { statusWindow = null; });
}

function statusLine() {
  if (!tracker) return "Idle -- right-click to start a session";
  if (lastStatus && lastStatus.paused) return `Paused (${lastStatus.markerDepth} open)`;
  const appName = (lastStatus && lastStatus.currentApp) || "(no window)";
  const depth = (lastStatus && lastStatus.markerDepth) || 0;
  const obsTag = obsConnected ? " - OBS" : "";
  const idleTag = isIdle ? " - idle" : "";
  return `Tracking: ${appName} - ${depth} open${obsTag}${idleTag}`;
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
    const quickStart = (config.process_labels || []).map((label) => ({
      label,
      click: () => fireStartMarker(label),
    }));
    items.push({ label: "Quick start", submenu: quickStart });
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
  items.push({ label: "Open sessions folder", click: () => shell.openPath(baseDir) });
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
  bootLog(`hotkeys: start=${okStart} end=${okEnd} shot=${okShot}`);
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
