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
  writeSessionIntegrity,
  setSessionLabel,
} = require("./session.js");
const { spawn } = require("node:child_process");
const { loadConfig, writeConfigSnapshot, validateConfig, deepMerge } = require("./config.js");
const userConfig = require("./user-config.js");
const {
  connectOBS,
  ensureScene,
  startRecording,
  stopRecording,
  writeSyncFile,
} = require("./obs.js");
const { captureScreenshot } = require("./screenshots.js");
const { showHelpWindow } = require("./help-window.js");
const { showOperatorPanel } = require("./operator-panel.js");
const { showSessionConfigWindow } = require("./session-config-window.js");
const { showSettingsWindow } = require("./settings-window.js");
const { showProfileWindow } = require("./profile-window.js");
const { needsPrompt, consentRecord } = require("./consent.js");
const {
  showConsentWindow,
  hasAcknowledged,
  rememberAcknowledgement,
} = require("./consent-window.js");
const welcomeWin = require("./welcome-window.js");
const hotkeyOverlay = require("./hotkey-overlay.js");
const { createWindowManager } = require("./window-manager.js");
const { createSessionStorage } = require("./session-storage.js");
const { appLogger } = require("./log.js");
const { jsonForScript } = require("./json-for-script.js");
const { injectTokens } = require("./ui/tokens.js");
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
/* D3: the last foreground-window bounds that belong to a real work window
   (never one of our own recorder windows). Screenshots aim at the display
   containing this rect, so firing a marker from the recorder -- which moves
   focus to the recorder's monitor -- still captures the worker's monitor. */
let lastWorkBounds = null;
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

/* §E2 dead-man monitor: during an active session with interactions
   enabled, no interaction event AND no recorder_health for >2 minutes
   means the recorder died silently -- go loud (tray warning + toast +
   a durable recorder_silent system event). State lives in the pure
   dead-man.js module; this is just the wiring. */
let deadMan = null;
let deadManHandle = null;
let trayWarning = false;

// Idle monitor state
let idleMonitorHandle = null;
let isIdle = false;
let idleStartMs = null;
/* H-7: the auto-end-on-idle branch fires from a 5s interval. Without a
   latch it re-fires every tick for the whole idle stretch -- hundreds of
   duplicate boundary system events. This flag gates it to once per idle
   stretch; it is reset on idle_end so the next idle stretch can fire. */
let autoEndedThisIdle = false;

// App-switch screenshot tracking
let lastTrackedApp = null;

const { notifyUser, trayIconImage, trayWarningImage } = require("./notify.js");
const { createDeadManMonitor } = require("./dead-man.js");
const { runReadinessProbe, summarizeReadiness } = require("./readiness.js");
const { showCloseoutWizard } = require("./self-annotation/wizard-window.js");

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
      foregroundBounds: lastWorkBounds || (lastStatus ? lastStatus.currentBounds : null),
      // D3: our own always-on-top windows are the only BrowserWindows in this
      // process; screenshots.js dims them during the grab so they don't
      // occlude the capture on a single monitor.
      occludingWindows: BrowserWindow.getAllWindows(),
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

/* Browser-foreground-no-events watchdog (ADR-0001 footnote: Chrome /
   Edge expose web content via UIA, but only after the AXTree is woken
   up). The recorder's own wake-up poller closes most of the gap, but
   if Chrome is foreground for >= BROWSER_NO_EVENTS_MS and zero
   interactions have been forwarded from a browser process in the same
   window, surface a once-per-session toast so the analyst knows the
   session is rolling but the browser is invisible to UIA. */
const BROWSER_FOREGROUND_NAMES = new Set([
  "chrome.exe", "msedge.exe", "brave.exe", "iexplore.exe", "opera.exe",
  "vivaldi.exe", "Google Chrome", "Microsoft Edge", "Brave",
]);
const BROWSER_NO_EVENTS_MS = 8000;
let _browserForegroundSinceMs = 0;
let _lastBrowserInteractionMs = 0;
let _browserToastShownThisSession = false;
function _isBrowserName(app) {
  if (!app) return false;
  return BROWSER_FOREGROUND_NAMES.has(app);
}
function _noteBrowserInteractionIfApplicable(data) {
  // Called from the recorder's onEvent hook for every interaction the
  // recorder emits; if the source app is a browser, refresh the
  // timestamp so the watchdog stays quiet.
  const proc = (data && data.process_name) || "";
  if (_isBrowserName(proc)) _lastBrowserInteractionMs = Date.now();
}
function _checkBrowserForegroundWatchdog() {
  if (!session || !tracker || _browserToastShownThisSession) return;
  const status = lastStatus;
  if (!status || !_isBrowserName(status.currentApp)) {
    _browserForegroundSinceMs = 0;
    return;
  }
  if (_browserForegroundSinceMs === 0) _browserForegroundSinceMs = Date.now();
  const since = Date.now() - _browserForegroundSinceMs;
  const sinceLastInt = Date.now() - _lastBrowserInteractionMs;
  if (since >= BROWSER_NO_EVENTS_MS && sinceLastInt >= BROWSER_NO_EVENTS_MS) {
    _browserToastShownThisSession = true;
    notifyUser(
      "Process Discovery Tracker",
      status.currentApp + " is foreground but no interactions are reaching the " +
      "recorder. Chrome / Edge may be blocking accessibility (UIA). Try closing " +
      "and re-opening the browser, or enabling the AccessibilityModeEnabled " +
      "registry policy. The session is still recording markers + screenshots.",
      { urgency: "normal" }
    );
  }
}

async function onTickHandler(status) {
  lastStatus = status;
  /* D3: remember the last work-window bounds, excluding our own recorder
     windows. While a recorder window (panel / picker / status) holds focus,
     BrowserWindow.getFocusedWindow() is non-null -- skip the update so a
     marker screenshot keeps targeting the worker's monitor, not the
     recorder's. (Single-monitor occlusion -- the panel physically covering
     the work app -- is handled in screenshots.js, which dims our own windows
     to opacity 0 for the duration of the grab.) */
  if (status && status.currentBounds && !BrowserWindow.getFocusedWindow()) {
    lastWorkBounds = status.currentBounds;
  }
  refreshTray();
  _checkBrowserForegroundWatchdog();
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

/* §E1: pre-pilot readiness check. Shared by the tray item and the
   --readiness CLI: runs the probe with the real seams, writes
   readiness-report.json next to the sessions, returns everything the
   caller needs to present it. Never throws -- failures live IN the
   report. */
async function runReadinessAndWrite() {
  fs.mkdirSync(baseDir, { recursive: true });
  const report = await runReadinessProbe({
    sessionTarget: baseDir,
    /* The single-file recorder self-extracts to DOTNET_BUNDLE_EXTRACT_BASE_DIR
       when set (the documented fix for a constrained C:), else %TEMP% --
       check the drive it will actually extract to. */
    tempDir: process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR || require("node:os").tmpdir(),
    hostExeName: path.basename(process.execPath),
    spawnRecorderFn: require("./recorder.js").spawnRecorder,
    bootLog,
  });
  const summary = summarizeReadiness(report);
  const reportPath = path.join(baseDir, "readiness-report.json");
  try { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
  catch (e) { bootLog(`readiness-report write failed: ${e && e.message}`); }
  bootLog(`readiness: ${report.overall} (report at ${reportPath})`);
  return { report, summary, reportPath };
}

/* The tray flow: toast that it's running (the probe takes ~10-20s),
   then a summary dialog. Idle-only -- the probe spawns its own sidecar
   and must not run beside a live session's recorder. */
async function showReadinessDialog() {
  notifyUser("Readiness check running", "Probing disk, recorder, and the open app windows (~15 s)...", { urgency: "low", silent: true });
  try {
    const { report, summary, reportPath } = await runReadinessAndWrite();
    await dialog.showMessageBox({
      type: report.overall === "ready" ? "info" : "warning",
      title: "Capture readiness",
      message: report.overall === "ready" ? "Ready to capture."
        : report.overall === "ready_with_warnings" ? "Ready, with warnings."
          : "NOT ready to capture.",
      detail: summary + `\n\nFull report: ${reportPath}`,
      buttons: ["OK"],
    });
  } catch (e) {
    bootLog(`readiness check crashed: ${e && (e.stack || e.message)}`);
    dialog.showErrorBox("Readiness check failed", String(e && e.message));
  }
}

/* §E2: tray warning state -- amber-badged icon while the dead-man
   monitor says the recorder is silent; the plain icon otherwise. */
function setTrayWarning(on) {
  if (trayWarning === !!on) return;
  trayWarning = !!on;
  if (tray) {
    try { tray.setImage(trayWarning ? trayWarningImage() : trayIconImage()); }
    catch (e) { bootLog(`tray setImage failed: ${e && e.message}`); }
  }
}

function startDeadManMonitor() {
  stopDeadManMonitor();
  /* Only meaningful when interactions are expected at all -- with the
     recorder disabled by config there is nothing to go silent. */
  if (!(config && config.interactions && config.interactions.enabled)) return;
  deadMan = createDeadManMonitor();
  deadManHandle = setInterval(checkDeadMan, 15_000);
}

function stopDeadManMonitor() {
  if (deadManHandle) clearInterval(deadManHandle);
  deadManHandle = null;
  deadMan = null;
  setTrayWarning(false);
}

function checkDeadMan() {
  if (!tracker || !deadMan) return;
  const r = deadMan.check();
  if (r.transition === "went_silent") {
    bootLog(`dead-man: recorder silent for ${r.silentForMs}ms`);
    try { tracker.fireSystem("recorder_silent", { silent_for_ms: r.silentForMs }); }
    catch (e) { bootLog(`recorder_silent emit failed: ${e && e.message}`); }
    setTrayWarning(true);
    refreshTray();
    notifyUser(
      "Recorder silent -- check capture",
      "No UI interactions and no recorder heartbeat for over 2 minutes. " +
      "The session is still rolling (markers, screenshots), but interaction " +
      "capture looks dead. Open the tray and restart the session if this persists.",
      { urgency: "critical" }
    );
  } else if (r.transition === "recovered") {
    bootLog(`dead-man: recorder signal resumed after ${r.gapMs}ms gap`);
    try { tracker.fireSystem("recorder_silent_end", { gap_ms: r.gapMs }); }
    catch (e) { bootLog(`recorder_silent_end emit failed: ${e && e.message}`); }
    setTrayWarning(false);
    refreshTray();
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
      /* I23: "at desk" = the recorder forwarded an interaction within
         the last 30s, so the worker was active even though the OS idle
         timer (mouse/keyboard) crossed the threshold -- e.g. a Citrix /
         RDP session whose input the host idle timer cannot see. */
      const st = tracker.getStatus();
      const atDesk = !!st.lastInteractionMs &&
        (Date.now() - st.lastInteractionMs) < 30000;
      tracker.fireSystem("idle_start", { idle_seconds: idleSecs, at_desk: atDesk });
      bootLog(`idle_start at ${idleSecs}s (at_desk=${atDesk})`);
    } else if (isIdle && idleSecs < threshold) {
      isIdle = false;
      autoEndedThisIdle = false;   // H-7: re-arm for the next idle stretch
      const durationSecs = Math.round((Date.now() - idleStartMs) / 1000);
      tracker.fireSystem("idle_end", { duration_seconds: durationSecs });
      idleStartMs = null;
      bootLog(`idle_end after ${durationSecs}s`);
      const minResume =
        config.screenshots.on_idle_resume_minutes * 60;
      if (durationSecs >= minResume) fireScreenshot("screenshot");
    } else if (isIdle && idleSecs >= autoEndSecs && config.auto_end_on_idle && !autoEndedThisIdle) {
      /* H-7: fire at most once per idle stretch. Without the
         autoEndedThisIdle latch this branch re-ran every 5s tick for the
         whole idle stretch, emitting hundreds of duplicate auto_end_idle
         boundaries. (Not actually ending the session here is by design;
         only the re-fire was the bug.) */
      autoEndedThisIdle = true;
      /* Auto-close any open markers and log the cause (§3.3). Bounded by
         the known marker depth so a future change to fireMarker can't
         spin this into an infinite loop on mutated tracker state. */
      const openDepth = (lastStatus && lastStatus.markerDepth) || 0;
      for (let i = 0; i < openDepth; i += 1) {
        if (tracker.getStatus().markerDepth <= 0) break;
        tracker.fireMarker({ markerType: "end", reason: "auto_end_idle" });
      }
      lastStatus = tracker.getStatus();
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
  autoEndedThisIdle = false;
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

function effectiveObsCfg() {
  /* The whole `obs` slice (url, password, scene, required, auto-create)
     is now merged into `config.obs` from the user-config overlay at
     launch, so the in-memory config is already the truth. The legacy
     `obs-settings.json` carrier was migrated on first run by
     user-config.js -- this helper just reads `config.obs` with a sane
     fallback URL. */
  const base = (config && config.obs) || {};
  return {
    ...base,
    websocket_url: base.websocket_url || "ws://127.0.0.1:4455",
    websocket_password: base.websocket_password || null,
  };
}

/* Used by the Settings window's "Test OBS connection" button. The old
   standalone OBS-setup window is gone -- everything that wrote OBS
   creds (pdt:obsGet/Save) is subsumed by pdt:settingsGet/Save. */
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

function showSettingsDialog() {
  windows.show("settings", () => showSettingsWindow());
}

function showProfileDialog() {
  windows.show("profile", () => showProfileWindow());
}

/* The Profile window edits only the worker identity slice. Identity is
   stamped onto every session manifest via the config snapshot, so saves
   take effect for the next session start. */
ipcMain.handle("pdt:profileGet", () => {
  const w = (config && config.worker) || {};
  return { id: w.id || null, name: w.name || null, role: w.role || null, bu: w.bu || null };
});

ipcMain.handle("pdt:profileSave", (_e, profile) => {
  try {
    const clean = {
      id:   (profile && profile.id)   || null,
      name: (profile && profile.name) || null,
      role: (profile && profile.role) || null,
      bu:   (profile && profile.bu)   || null,
    };
    userConfig.saveUserConfig({ worker: clean });
    config = deepMerge(config, { worker: clean });
    bootLog(`profile saved: ${clean.id || "(blank)"}`);
    return { saved: true };
  } catch (e) {
    bootLog(`profile save failed: ${e && e.message}`);
    return { saved: false, error: String(e && e.message) };
  }
});

/* The Settings window edits everything persistent across sessions:
   hotkeys, OBS, screenshots, storage / lifecycle limits. Profile (worker
   identity) and Session setup (engagement + labels) have their own
   windows. Returns ONLY the slices Settings owns -- the renderer fills
   the form from this. */
ipcMain.handle("pdt:settingsGet", () => {
  return {
    hotkeys: (config && config.hotkeys) || {},
    obs: (config && config.obs) || {},
    screenshots: (config && config.screenshots) || {},
    storage_warn_gb: (config && config.storage_warn_gb) || 50,
    auto_end_idle_minutes: (config && config.auto_end_idle_minutes) || 30,
    auto_end_on_idle: !(config && config.auto_end_on_idle === false),
  };
});

ipcMain.handle("pdt:settingsSave", (_e, partial) => {
  try {
    if (!partial || typeof partial !== "object") {
      return { saved: false, error: "empty settings payload" };
    }
    /* Persist to userData/user-config.json AND mirror into the live
       config so screenshots / obs / storage limits take effect without
       a relaunch. Hotkeys still require restart (global shortcuts were
       registered at app launch and aren't re-registered here). */
    userConfig.saveUserConfig(partial);
    config = deepMerge(config, partial);
    bootLog(`settings saved: ${Object.keys(partial).join(",")}`);
    refreshTray();
    return { saved: true };
  } catch (e) {
    bootLog(`settings save failed: ${e && e.message}`);
    return { saved: false, error: String(e && e.message) };
  }
});

async function setupOBS(opts) {
  /* `opts.silent` suppresses the per-failure toast -- used by the
     background best-effort path in startSession(), which owns its own
     once-only "no OBS" messaging so the operator doesn't get a fresh
     "OBS not reachable" toast on every session start. Strict mode
     still surfaces the failure (the operator opted into fail-fast). */
  const silent = !!(opts && opts.silent);
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
          `If OBS has authentication enabled, set the password via tray menu -> Settings.`
      );
      return false;
    }
    if (!silent) {
      notifyUser(
        "Process Discovery Tracker",
        `OBS not reachable at ${eff.websocket_url}. Recording will continue without video.`,
        { urgency: "low" }
      );
    }
    return true; // proceed without OBS in non-strict mode
  }
}

/* Wire the OBS recording into the live session: kick off the actual
   recording, write the video-sync record, and stamp the manifest with
   the resulting paths. Used both from the strict-mode startSession path
   (where obs was already connected) and from the background best-effort
   path that connects after the session is already running. Guarded so a
   late-arriving connect after endSession is a no-op. */
async function attachObsRecording() {
  if (!session || !tracker || !obsConnected || !obs) return false;
  try {
    const sync = await startRecording(obs);
    writeSyncFile(path.join(session.sessionFolder, "obs"), sync);
    const manifestFile = path.join(session.sessionFolder, "manifest.json");
    const m = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    m.obs.recording_path = sync.recording_path;
    m.obs.recording_start_ts = sync.obs_recording_start_ts;
    m.obs.offset_ms = sync.offset_ms;
    fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));
    return true;
  } catch (e) {
    bootLog(`OBS startRecording failed: ${e && e.message}`);
    appLogger().error("OBS startRecording failed", e);
    return false;
  }
}

/* Once-only "recording without video" toast for best-effort mode when
   OBS isn't reachable. The flag lives in userData/obs-hint-shown.json
   so it persists across launches. Replaces the previous blocking
   dialog.showMessageBox on the session-start path. */
function showOnceNoObsHint() {
  try {
    const flagPath = path.join(app.getPath("userData"), "obs-hint-shown.json");
    if (fs.existsSync(flagPath)) return;
    fs.writeFileSync(flagPath, JSON.stringify({ shown_at: new Date().toISOString() }));
    notifyUser(
      "Recording without OBS video",
      "You'll still get a full timeline, screenshots, and interactions. " +
      "To add screen recording: install OBS Studio, enable Tools → WebSocket Server, " +
      "then end this session and start a new one. Settings → Video/OBS in the tray.",
      { urgency: "low" }
    );
  } catch (_e) { /* best-effort */ }
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
          font-family:var(--font-ui);font-size:13px;line-height:1.5}
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
    w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(injectTokens(html)));
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

  /* B2: pre-flight config sanity check. Non-blocking now -- the start
     path used to halt with a "Start anyway / Cancel" modal that froze
     the worker in front of a recording they wanted. Surface problems
     as a low-urgency toast and proceed; the operator can address them
     between recordings via tray -> Session setup / Settings. */
  if (!(opts && opts.purpose === "app_prep")) {
    const problems = validateConfig(config, baseDir);
    if (problems.length) {
      notifyUser("Check the recording setup", problems.join(" "), { urgency: "low" });
    }
  }

  /* Strict-mode OBS preflight: connect synchronously so a failed
     required-OBS doesn't create a half-baked session on disk. */
  if (config.obs && config.obs.required) {
    const ok = await setupOBS();
    if (!ok) return null;
  }

  /* App-prep sessions get parked under engagement_id="vocab-prep" so
     they don't pollute the engagement's process captures. The prep_app
     name is recorded on the manifest for downstream auto-naming. */
  const isPrep = !!(opts && opts.purpose === "app_prep");

  /* Worker consent gate (§11f). Off by default; when configured, the worker
     must consent before any recording starts -- declining aborts the start.
     The decision is recorded on the manifest. App-prep (vocab curation) is the
     operator's own desktop, so it is exempt. */
  const cmode = (config.consent && config.consent.mode) || "off";
  const cversion = (config.consent && config.consent.version) || 1;
  const cworker = (config.worker && config.worker.id) || "unknown";
  let consent = consentRecord({ mode: "off" });
  if (!isPrep && cmode !== "off") {
    let granted = false;
    if (cmode === "once" && hasAcknowledged(cworker, cversion)) {
      granted = true;
    } else {
      const res = await showConsentWindow({
        text: (config.consent && config.consent.text) || "",
        version: cversion,
      });
      granted = !!(res && res.granted);
      if (granted && cmode === "once") rememberAcknowledgement(cworker, cversion);
    }
    consent = consentRecord({ mode: cmode, version: cversion, workerId: cworker, granted });
    if (!granted) {
      notifyUser("Recording not started", "Consent was declined.", { urgency: "normal" });
      bootLog("session start aborted: consent declined");
      return null;
    }
  }

  session = createSession({
    baseDir,
    engagementId: isPrep ? "vocab-prep" : config.engagement_id,
    config,
    purpose: opts && opts.purpose,
    prepApp: opts && opts.prepApp,
    consent,
  });
  writeConfigSnapshot(session.sessionFolder, config);

  /* If strict mode succeeded above, attach the OBS recording now -- the
     folder exists, so sync.json + manifest writes can land. */
  if (obsConnected && obs) {
    await attachObsRecording();
  }

  tracker = startTracker({
    sessionId: session.sessionId,
    eventsFile: session.eventsFile,
    onTick: onTickHandler,
    interactionsExpected: !!(config.interactions && config.interactions.enabled),
    onNotice: handleTrackerNotice,
  });
  // Reset browser-foreground-no-events watchdog state for the new session.
  _browserForegroundSinceMs = 0;
  _lastBrowserInteractionMs = 0;
  _browserToastShownThisSession = false;
  if (obsConnected) {
    tracker.fireSystem("obs_recording_start");
  }

  /* Best-effort OBS: connect in the background so a missing/idle OBS
     no longer freezes session start by the WebSocket connect timeout
     (~5s). The session is already live and recording markers/screens/
     interactions; if OBS connects, attachObsRecording() wires in the
     video-sync record and fires obs_recording_start. If it fails, the
     once-only friendly hint is surfaced as a toast (not a modal). */
  if (!obsConnected && config.obs && config.obs.websocket_url && !config.obs.required) {
    const sessionAtStart = session;
    setupOBS({ silent: true }).then(async () => {
      if (!session || session !== sessionAtStart || !tracker) {
        /* User ended the session before OBS finished connecting --
           disconnect the now-orphaned client so we don't leak it. */
        if (obsConnected && obs) {
          try { await obs.disconnect(); } catch (_) {}
          obs = null;
          obsConnected = false;
        }
        return;
      }
      if (obsConnected && obs) {
        const ok = await attachObsRecording();
        if (ok) {
          try { tracker.fireSystem("obs_recording_start"); } catch (_) {}
        }
      } else {
        showOnceNoObsHint();
      }
    }).catch((e) => bootLog(`background OBS connect failed: ${e && e.message}`));
  }

  lastTrackedApp = null;
  screenshotFailureNotified = false;
  lastStatus = tracker.getStatus();
  startIdleMonitor();

  /* I43: stamp the display geometry onto the manifest so the viewer can
     badge which monitor each captured window was on. Read-modify-write
     so it sits alongside the fields createSession already wrote. */
  try {
    const { screen } = require("electron");
    const mf = path.join(session.sessionFolder, "manifest.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf-8"));
    m.displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }));
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  } catch (e) { bootLog(`display geometry write failed: ${e && e.message}`); }

  if (config.interactions && config.interactions.enabled) {
    const ok = await startRecorderForSession();
    if (!ok && config.interactions.required) {
      // Strict mode: required recorder failed - tear down the session.
      await endSession({ skipCloseout: true });
      return null;
    }
  }

  /* §E2: arm the dead-man monitor. Deliberately armed even when the
     recorder failed to spawn (non-required mode) -- interactions were
     expected, nothing will flow, and that is exactly the silent failure
     the alarm exists for. */
  startDeadManMonitor();

  bootLog(`session started: ${session.sessionFolder}`);
  return session;
}

async function startRecorderForSession() {
  try {
    recorder = require("./recorder.js").spawnRecorder({
      sessionId: session.sessionId,
      verbose: !!(config.interactions && config.interactions.verbose),
      debounceMs: config.interactions && config.interactions.debounce_ms,
      ocr: !!(config.interactions && config.interactions.ocr),
      onEvent: (data) => {
        if (!tracker) return;
        try { tracker.fireInteraction(data); }
        catch (e) { bootLog(`fireInteraction failed: ${e && e.message}`); }
        // Feed the browser-no-events watchdog so we don't alarm on a
        // browser that is actually producing UIA traffic.
        try { _noteBrowserInteractionIfApplicable(data); } catch (_) {}
        // §E2: an interaction proves the recorder is alive.
        if (deadMan) deadMan.noteSignal();
      },
      onWarning: (w) => bootLog(`[recorder] ${w.msg || ""}: ${w.detail || ""}`),
      onStats: (s) => {
        bootLog(`[recorder.stats] queued=${s.queued} dropped=${s.dropped_total} emitted=${s.emitted_total} errors=${s.errors || 0}`);
        // Land recorder health in events.jsonl so the analyst sees drops
        // and errors against the session timeline, not only in boot.log.
        if (tracker) {
          try { tracker.fireSystem("recorder_health", s); }
          catch (e) { bootLog(`recorder_health emit failed: ${e && e.message}`); }
        }
        // §E2: a stats heartbeat also proves the recorder is alive.
        if (deadMan) deadMan.noteSignal();
      },
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
  // recorder_died has "the recorder failed" semantics per the schema --
  // every session log used to carry one even on a clean session-end
  // shutdown (the tracker emits `recorder_stop`, the C# process exits
  // with code 0, and we used to unconditionally fire recorder_died
  // here). Treat an exit code of 0 as a clean shutdown; only fire the
  // failure event when the recorder actually crashed.
  const cleanExit = info && info.code === 0 && !info.signal;
  if (!cleanExit) {
    tracker.fireSystem("recorder_died", {
      code: info.code, signal: info.signal, restart_count: recorderRestartCount,
    });
  }
  recorder = null;
  // Only auto-restart on a non-clean exit. A clean exit is the result
  // of endSession() asking the recorder to stop -- restarting would
  // race the rest of the shutdown.
  if (
    !cleanExit &&
    config.interactions &&
    config.interactions.auto_restart &&
    recorderRestartCount < config.interactions.max_restarts_per_session
  ) {
    recorderRestartCount += 1;
    setTimeout(() => {
      if (!tracker) return;
      startRecorderForSession();
    }, 5000);
  } else if (!cleanExit) {
    recorderPermanentlyDead = true;
    tracker.fireSystem("recorder_dead_permanent");
    notifyUser(
      "Process Discovery Tracker",
      "Interaction recorder stopped. The session is still recording markers and screenshots, but no UI interaction events will be captured until you restart the session.",
      { urgency: "critical" }
    );
  }
}

/* Tracker-side notices that warrant a desktop toast. Currently only
   uncaptured_app: a foreground app the recorder produced no interaction
   events for -- commonly an elevated process, or one with no UIA surface. */
function handleTrackerNotice(kind, payload) {
  if (kind === "write_error") {
    // H-6: a durability-critical batch (markers/system events) failed to
    // write and was re-queued for retry. Surface it loudly -- the durable
    // record is at risk and the worker should know before they walk away.
    bootLog(`tracker write_error notice: ${JSON.stringify(payload)}`);
    notifyUser(
      "Process Discovery Tracker",
      "Couldn't write to the session log -- retrying. If this keeps happening, check the session folder's disk/permissions before relying on this recording."
    );
    return;
  }
  if (kind !== "uncaptured_app") return;
  // Stay quiet when there is no live recorder -- its own failure toast
  // (or the required-recorder dialog) already told the user.
  if (!recorder || recorderPermanentlyDead) return;
  const app = (payload && payload.app) || "An application";
  notifyUser(
    "Process Discovery Tracker",
    `${app} interactions aren't being recorded -- it may be running as administrator or may not expose UI Automation. Markers, screenshots and video are unaffected.`
  );
}

/* §E3: whether the last endSession() showed the worker close-out wizard
   -- callers that pop their own post-end dialog (the tray item) read it
   to avoid stacking two surfaces. */
let lastCloseoutShown = false;

async function endSession(opts) {
  opts = opts || {};
  if (!tracker) return null;
  lastCloseoutShown = false;
  stopIdleMonitor();
  stopDeadManMonitor();   // §E2: a clean end is not a silent death
  const hadVideo = obsConnected;  // B1: captured before the OBS teardown clears it

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

  const finalStatus = await tracker.stop();
  closeSession({ sessionFolder: session.sessionFolder, status: "closed" });
  /* B5: integrity manifest, written last so it captures the final
     manifest.json and events.jsonl sizes. */
  try { writeSessionIntegrity(session.sessionFolder); }
  catch (e) { bootLog(`session-integrity write failed: ${e && e.message}`); }

  /* I25: at session end, warn once if total session storage has grown
     large -- a nudge toward the tray's prune tool. */
  try {
    const total = sessionStorage.getSessionsTotal();
    const warnGb = config.storage_warn_gb || 50;
    if (total.bytes > warnGb * 1024 * 1024 * 1024) {
      const { Notification } = require("electron");
      if (Notification.isSupported()) {
        new Notification({
          title: "Session storage is getting large",
          body: `Recorded sessions now use ${sessionStorage.humanSize(total.bytes)}. ` +
                `Consider the tray "Prune old sessions" tool to free space.`,
        }).show();
      }
    }
  } catch (e) { bootLog(`storage check failed: ${e && e.message}`); }

  /* B1: hand the operator a post-session summary if the Live Session
     window is open -- a harmless no-op when it is not. */
  const opPanel = windows.get("operator");
  if (opPanel && !opPanel.isDestroyed()) {
    opPanel.webContents.send("pdt:sessionSummary", {
      sessionFolder: session.sessionFolder,
      durationMs: finalStatus.elapsedMs,
      events: finalStatus.eventCount,
      markers: finalStatus.markerCount,
      screenshots: finalStatus.screenshotCount,
      interactions: finalStatus.interactionCount,
      hadVideo,
    });
  }
  bootLog(`session ended: ${session.sessionFolder}`);
  const oldFolder = session.sessionFolder;
  const purpose = (session.manifest && session.manifest.purpose) || "process";
  tracker = null;
  session = null;
  lastStatus = null;
  sessionStorage.invalidateSessionsCache();  // new session lands in the count + size

  /* §E3: worker close-out -- the self-annotation wizard + the review
     handover ("Submit session"). Skipped for app-prep sessions (the
     operator's own throwaway vocab walkthrough) and on paths that must
     not pop UI (quit, a failed-start teardown). Fire-and-forget: its
     writes are additive sidecar/metadata via persist.js, and a wizard
     problem must never break session end. */
  if (!opts.skipCloseout && purpose !== "app_prep") {
    lastCloseoutShown = true;
    showCloseoutWizard({
      sessionFolder: oldFolder,
      summary: {
        durationMs: finalStatus.elapsedMs,
        events: finalStatus.eventCount,
        markers: finalStatus.markerCount,
        screenshots: finalStatus.screenshotCount,
        interactions: finalStatus.interactionCount,
        hadVideo,
      },
    }).catch((e) => bootLog(`closeout wizard failed: ${e && e.message}`));
  }
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
       when they pressed Start the second time. Bounded by the known
       open-marker depth so a future fireMarker change can't infinite-
       loop on mutated tracker state. */
    const openDepth = stat.markerDepth;
    for (let i = 0; i < openDepth; i += 1) {
      if (tracker.getStatus().markerDepth <= 0) break;
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
  // D1: keep the picker above full-screen / always-on-top apps so the
  // operator can actually see it to type a label.
  labelPickerWindow.setAlwaysOnTop(true, "screen-saver");
  labelPickerWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  labelPickerWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  labelPickerWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(injectTokens(buildPickerHtml()))
  );
  labelPickerWindow.on("closed", () => { labelPickerWindow = null; });
  labelPickerWindow.on("blur", () => {
    if (labelPickerWindow && !labelPickerWindow.isDestroyed()) {
      labelPickerWindow.close();
    }
  });
}

function buildPickerHtml() {
  // jsonForScript (not bare JSON.stringify): these strings are interpolated
  // into an inline <script>, so a label containing "</script>..." would break
  // out and -- with nodeIntegration:true -- execute. See json-for-script.js.
  const labels = jsonForScript(config.process_labels || []);
  // Pass current marker stack so we can show "Will close: <innermost>"
  // hint, and the initial nest mode requested by the caller.
  const stack = lastStatus && lastStatus.openMarkers ? lastStatus.openMarkers : [];
  const stackJson = jsonForScript(stack);
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
         font-family: var(--font-ui); font-size: 13px; }
  .lbl { font-size: 11px; margin: 0 0 8px; color: var(--fg-3); letter-spacing: 0.5px; text-transform: uppercase; }
  .stack-hint { font-size: 11px; color: var(--warn); margin: 0 0 8px; padding: 5px 8px;
                background: rgba(160, 128, 80, 0.10); border-radius: 4px; }
  .stack-hint code { font-family: var(--font-mono); color: var(--fg-2); }
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
ipcMain.handle("pdt:setSessionLabel", (_e, sessionFolder, label) => {
  try { setSessionLabel(sessionFolder, label); }
  catch (e) { bootLog(`setSessionLabel failed: ${e && e.message}`); }
});

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
    else if (deadMan && deadMan.isSilent()) recTag = " - recorder SILENT";
  }
  return `Tracking: ${appName} - ${depth} open${obsTag}${idleTag}${recTag}`;
}

// Quick-start nesting preference (clutter pass): instead of a parallel "Quick
// start (nested)" submenu duplicating every label, one submenu carries a
// "Nest under current" checkbox that flips this flag.
let quickStartNest = false;
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
    // When a marker is already open the label picker itself still offers
    // nesting (Shift+Enter / its stack hint), so we no longer carry a separate
    // "Fire Start (nest under current)" item. Quick-start nesting folds into
    // ONE submenu via a "Nest under current" checkbox (clutter pass: was two
    // parallel submenus duplicating every label).
    const hasOpen = lastStatus && lastStatus.markerDepth > 0;
    if (config.process_labels && config.process_labels.length) {
      const quickStart = [];
      if (hasOpen) {
        quickStart.push({
          label: "Nest under current marker",
          type: "checkbox",
          checked: quickStartNest,
          click: () => { quickStartNest = !quickStartNest; refreshTray(); },
        });
        quickStart.push({ type: "separator" });
      } else if (quickStartNest) {
        // No open marker -> nothing to nest under; reset so the next session
        // starts un-nested.
        quickStartNest = false;
      }
      for (const label of config.process_labels) {
        quickStart.push({
          label,
          click: () => fireStartMarker(label, { nest: hasOpen && quickStartNest }),
        });
      }
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
      click: () => togglePause(),
    });
    items.push({
      label: "End capture session",
      click: async () => {
        const folder = await endSession();
        /* §E3: when the close-out wizard opened, it IS the post-end
           surface -- don't stack a second dialog on top of it. */
        if (!lastCloseoutShown) {
          const r = await dialog.showMessageBox({
            type: "info",
            message: "Session ended.",
            detail: folder ? `Saved to: ${folder}` : "",
            buttons: folder ? ["Open in viewer", "Close"] : ["OK"],
            defaultId: 0,
            cancelId: folder ? 1 : 0,
          });
          if (folder && r.response === 0) openInViewer(folder);
        }
        refreshTray();
      },
    });
  }
  items.push({ type: "separator" });
  /* When idle, surface the per-session setup right next to "Start
     capture session" -- it's where the operator is looking when they're
     about to record. Hidden mid-session (edits only apply at next
     launch, so showing it would just confuse). Persistent Settings and
     Profile live further down and are reachable in either state. */
  if (!tracker) {
    items.push({
      label: "Session setup...",
      click: () => showSessionConfigDialog(),
    });
    /* §E1: run before any pilot day -- disk, recorder, UIA, per-app
       trust tiers. Idle-only (spawns its own probe sidecar). */
    items.push({
      label: "Run readiness check...",
      click: () => showReadinessDialog(),
    });
  }
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

  /* Top-level Settings + Profile -- the IA polish moved these out of
     the old "Help & config" submenu so they're discoverable in one
     click. Settings covers everything persistent (hotkeys, OBS,
     screenshots, storage limits); Profile is just worker identity. */
  items.push({ type: "separator" });
  items.push({ label: "Settings...", click: () => showSettingsDialog() });
  items.push({ label: "Profile...",  click: () => showProfileDialog() });

  // === Help submenu (config no longer lives here) ===
  const helpItems = [
    { label: "How to use...", click: () => showHelp() },
    { label: "Show welcome screen", click: () => welcomeWin.showWelcomeWindow({ hotkeys: config && config.hotkeys }) },
    { type: "separator" },
    {
      label: configSourcePath
        ? `Per-session YAML: ${path.basename(configSourcePath)}`
        : "Per-session YAML: defaults (set PDT_CONFIG to override)",
      enabled: false,
    },
  ];
  items.push({ label: "Help", submenu: helpItems });

  items.push({ type: "separator" });
  items.push({
    label: "Quit",
    click: async () => {
      // skipCloseout: the app is quitting -- a wizard window would be
      // torn down mid-question. The session data is intact either way.
      if (tracker) await endSession({ skipCloseout: true });
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

  /* §E1 CLI mode: `<capture> --readiness` runs the readiness probe,
     writes readiness-report.json next to the sessions, prints the human
     summary to stdout, and exits -- no tray, no hotkeys, no windows.
     Exit codes: 0 ready (warnings included), 2 not ready, 3 crashed. */
  if (process.argv.includes("--readiness")) {
    runReadinessAndWrite()
      .then(({ report, summary, reportPath }) => {
        // eslint-disable-next-line no-console
        console.log(summary + `\n\nFull report: ${reportPath}`);
        app.exit(report.overall === "not_ready" ? 2 : 0);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`readiness check crashed: ${e && (e.stack || e.message)}`);
        app.exit(3);
      });
    return;
  }

  let cfgPath = process.env.PDT_CONFIG || null;
  if (!cfgPath) {
    const qc = path.join(app.getPath("userData"), "quick-config.yaml");
    if (fs.existsSync(qc)) cfgPath = qc;
  }
  const loaded = loadConfig(cfgPath);
  /* User-edited Profile + Settings live as a partial-config overlay at
     `userData/user-config.json`; merge it ON TOP of the YAML so the UI
     always wins for the fields it owns (worker identity, hotkeys, OBS,
     screenshots, storage limits). Migrates the legacy obs-settings.json
     on first load -- see user-config.js. */
  const overlay = userConfig.loadUserConfig();
  config = deepMerge(loaded.config, overlay || {});
  configSourcePath = loaded.sourcePath;
  bootLog(
    `config loaded from ${configSourcePath || "(defaults)"} ` +
    `+ overlay (${Object.keys(overlay || {}).join(",") || "empty"})`
  );

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
  // D1: during an active session a left-click brings the Live Session window
  // to the front (opening it if needed) so the operator can always get back
  // to it -- to fire a marker or end the session -- without hunting for it
  // behind other apps or falling back to hotkeys. Outside a session there is
  // no panel to show, so left-click opens the tray menu (to start one).
  // Right-click always opens the menu.
  tray.on("click", () => {
    if (tracker) {
      windows.show("operator", () => showOperatorPanel(config));
    } else if (trayMenu) {
      tray.popUpContextMenu(trayMenu);
    }
  });
  tray.on("right-click", () => { if (trayMenu) tray.popUpContextMenu(trayMenu); });

  /* B3: register a global shortcut, falling back from a Control+Shift+X
     binding to Control+Alt+X when the primary is already taken by
     another app. Returns { ok, key, fellBack }. */
  function registerHotkey(accelerator, handler) {
    if (!accelerator) return { ok: false, key: accelerator, fellBack: false };
    if (globalShortcut.register(accelerator, handler)) {
      return { ok: true, key: accelerator, fellBack: false };
    }
    const fallback = accelerator.replace(/\bShift\b/i, "Alt");
    if (fallback !== accelerator && globalShortcut.register(fallback, handler)) {
      return { ok: true, key: fallback, fellBack: true };
    }
    return { ok: false, key: accelerator, fellBack: false };
  }

  const startHK = registerHotkey(config.hotkeys.start_picker, async () => {
    if (!tracker) {
      const s = await startSession();
      if (!s) return;
    }
    showLabelPicker();
  });
  const endHK = registerHotkey(config.hotkeys.end_innermost, () => fireEndMarker());
  const shotHK = registerHotkey(config.hotkeys.manual_screenshot, () => fireManualScreenshot());
  let syncHK = { ok: false, key: config.hotkeys.sync_marker, fellBack: false };
  if (config.hotkeys.sync_marker) {
    syncHK = registerHotkey(config.hotkeys.sync_marker, () => {
      if (!tracker) return;
      const id = `sync-${new Date().toISOString().replace(/[:.]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
      tracker.fireSystem("sync_marker", { sync_id: id });
    });
  }
  bootLog(`hotkeys: start=${startHK.ok}(${startHK.key}) end=${endHK.ok}(${endHK.key}) shot=${shotHK.ok}(${shotHK.key}) sync=${syncHK.ok}(${syncHK.key})`);

  /* P2.10 + B3: surface hotkey trouble to the operator via a toast --
     both bindings that fell back to an alternate, and bindings that
     could not be registered at all (boot.log alone is too quiet; some
     screen-recorder / password-manager combos grab Ctrl+Shift+S). */
  const hotkeyInfo = [
    ["Start picker", config.hotkeys.start_picker, startHK],
    ["End marker", config.hotkeys.end_innermost, endHK],
    ["Screenshot", config.hotkeys.manual_screenshot, shotHK],
  ];
  if (config.hotkeys.sync_marker) {
    hotkeyInfo.push(["Sync marker", config.hotkeys.sync_marker, syncHK]);
  }
  const fellBack = hotkeyInfo.filter((h) => h[2].fellBack);
  const failed = hotkeyInfo.filter((h) => !h[2].ok);
  if (fellBack.length) {
    const list = fellBack.map((h) => `${h[0]}: ${h[1]} was taken, using ${h[2].key}`).join("; ");
    notifyUser("Hotkey reassigned", list, { urgency: "low" });
  }
  if (failed.length) {
    const list = failed.map((h) => `${h[0]} (${h[1]})`).join(", ");
    notifyUser(
      "Hotkey conflict",
      `Couldn't register: ${list}. Another app is using these shortcuts. Use the tray menu, or change the bindings in tray → Settings → Hotkeys.`,
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

  /* First-run recorder extraction. recorder.zip ships at >100 MB and was
     historically extracted synchronously the first time startSession()
     ran -- a multi-second freeze on first capture. Do it async here at
     launch so the first session start is instant. Quiet no-op when the
     exe is already present or the zip isn't shipped (dev box). */
  if (config.interactions && config.interactions.enabled) {
    const { ensureRecorderExtracted } = require("./recorder.js");
    let notif = null;
    ensureRecorderExtracted({
      bootLog,
      onStart: () => {
        try {
          const { Notification } = require("electron");
          if (Notification.isSupported()) {
            notif = new Notification({
              title: "Preparing interaction recorder",
              body: "Unpacking the recorder sidecar on first launch -- this takes a few seconds.",
              silent: true,
            });
            notif.show();
          }
        } catch (_) {}
      },
    }).then((r) => {
      if (notif) { try { notif.close(); } catch (_) {} }
      if (r.ok && r.extracted) {
        notifyUser(
          "Process Discovery Tracker",
          "Interaction recorder ready.",
          { urgency: "low" }
        );
      } else if (!r.ok && r.reason !== "no-zip") {
        notifyUser(
          "Interaction recorder",
          "Could not unpack recorder.exe. Markers and screenshots will still work; interactions will not be captured. See boot.log.",
          { urgency: "normal" }
        );
      }
      /* reason === "no-zip" on a dev box is fine -- a hand-built
         recorder/publish/recorder.exe is already on disk, or the user
         doesn't have one yet. */
    }).catch((e) => bootLog(`recorder extraction failed: ${e && e.message}`));
  }
}).catch((e) => bootLog(`whenReady failed: ${(e && e.stack) || e}`));

// Welcome-window CTA dispatcher
ipcMain.handle("pdt:welcomeAction", (_e, action) => {
  if (action === "operator") {
    toggleOperatorPanel();   // existing helper that handles show/hide + IPC
  } else if (action === "help") {
    showHelp();
  } else if (action === "profile") {
    showProfileDialog();
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
