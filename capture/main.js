/*
 * Process Discovery Tracker -- capture-side Electron main process.
 *
 * Wires up:
 *   - Tray menu, the recording bar and the end summary; global keys (the
 *     one start: start recording or the next transaction; end transaction;
 *     screenshot). The SME reads "transaction" for a run (AD-29).
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

const { startTracker, normalizeTitle } = require("./tracker.js");
const {
  createSession,
  closeSession,
  markSessionRecovered,
  findOrphanedSessions,
  listRecentSessions,
  writeSessionIntegrity,
  setSessionLabel,
  updateManifest,
  isRecordingFolder,
} = require("./session.js");
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
const recordingBar = require("./recording-bar.js");
const { showEndSummaryWindow } = require("./end-summary-window.js");
const { describeZipError } = require("./zip-folder.js");
const { zipRecording } = require("./recording-zip.js");
const { createBrowserWatchdog } = require("./browser-watchdog.js");
const { createScreenshotGate, isAppSwitch, isScreenChange } = require("./screenshot-gate.js");
const { createRecordingControl } = require("./recording-control.js");
const guidance = require("./capture-guidance.js");
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
const { createWindowManager } = require("./window-manager.js");
const { createSessionStorage } = require("./session-storage.js");
const { appLogger } = require("./log.js");

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
/* help, settings, profile, sessionConfig and one end summary per
   recording: single-instance windows. The recording bar keeps its own
   (recording-bar.js), because it opens without taking the focus. */
const windows = createWindowManager();
let obs = null;
let obsConnected = false;
let config = null;
let configSourcePath = null;
let baseDir = null;
/* The session's recorder supervisor (recorder.js superviseRecorder); its
   current() is the live recorder, null while restarting or after death. */
let recorder = null;
let recorderPermanentlyDead = false;
/* Lane LF-SME (live finding 15): the recorder's launch-time warm-up (a
   promise, null when clicks and typing are off), and whether a recording's
   recorder is still starting (the bar says "Starting the recorder..."). A
   stop while it starts moves recorderEpoch on, and the late start stands
   down. */
let recorderWarmUp = null;
let recorderStarting = false;
let recorderEpoch = 0;

/* The keys actually registered at launch: a key another program holds
   falls back to its Ctrl+Alt variant, or is not registered at all. The
   bar, the welcome, the help and the tray name these, never the configured
   ones. Null until registration ran (the configured keys stand in). */
let activeKeys = null;
function keyFor(name) {
  if (activeKeys) return activeKeys[name] || "";
  const hk = (config && config.hotkeys) || {};
  return { start: hk.start_picker, end: hk.end_innermost, shot: hk.manual_screenshot }[name] || "";
}

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

// App-switch and screen-change screenshot tracking
let lastTrackedApp = null;
let lastTrackedScreen = null;   // { app, screen }: the window seen at the last tick

const { notifyUser, trayIconImage, trayWarningImage } = require("./notify.js");
const { createDeadManMonitor } = require("./dead-man.js");
const { runReadinessProbe, summarizeReadiness } = require("./readiness.js");

/* Session disk-usage accounting + the delete / prune flows. */
const sessionStorage = createSessionStorage({
  getBaseDir: () => baseDir,
  getActiveSessionFolder: () => (session ? session.sessionFolder : null),
  refreshTray: () => refreshTray(),
});

/* Leading-edge debounce: a burst of triggers (an app switch plus a
   marker start/end landing together) collapses to a single capture, and
   nothing new starts while a capture is still being taken (screenshot-gate.js,
   live finding 21). Manual shots pass { force: true } and are never
   suppressed. */
const SCREENSHOT_MIN_INTERVAL_MS = 2000;
const shotGate = createScreenshotGate({ minIntervalMs: SCREENSHOT_MIN_INTERVAL_MS });
let screenshotFailureNotified = false;
/* The screenshots still being taken: a Stop waits for them (up to a few
   seconds), so the last one lands in the recording before session_end and
   in its integrity file, instead of failing against a closed recording and
   telling the SME "Screenshots are failing" after the Stop. */
const shotsInFlight = new Set();
const SHOT_DRAIN_MS = 3000;

function fireScreenshot(kind, opts) {
  if (!tracker || !session || !config.screenshots.enabled) return Promise.resolve();
  if (!shotGate.begin(!!(opts && opts.force))) {
    bootLog(`screenshot coalesced (${Math.round(shotGate.msSinceLast())}ms since last, kind=${kind})`);
    return Promise.resolve();
  }
  const job = takeScreenshot(kind, tracker, session).finally(() => {
    shotsInFlight.delete(job);
    shotGate.end();
  });
  shotsInFlight.add(job);
  return job;
}

async function takeScreenshot(kind, shotTracker, shotSession) {
  try {
    // Pass the foreground window bounds so multi-monitor "active"
    // mode can pick the right display. lastStatus is refreshed every
    // tick via onTickHandler; if we don't have it yet (e.g. fire just
    // after session_start), screenshots.js falls back to cursor pos
    // then primary.
    const result = await captureScreenshot({
      screenshotsFolder: path.join(shotSession.sessionFolder, "screenshots"),
      quality: config.screenshots.quality,
      mode: config.screenshots.display,
      foregroundBounds: lastWorkBounds || (lastStatus ? lastStatus.currentBounds : null),
      // D3: our own always-on-top windows are the only BrowserWindows in this
      // process; screenshots.js dims them during the grab so they don't
      // occlude the capture on a single monitor.
      occludingWindows: BrowserWindow.getAllWindows(),
    });
    if (!result) return;
    // The recording stopped meanwhile (a Stop waits a few seconds at most):
    // nothing is written after its session_end.
    if (shotTracker.getStatus().stopped) return;
    // captureScreenshot returns string|string[]. Emit one system
    // event per file so the timeline shows a dot for each display
    // when display="all".
    const paths = Array.isArray(result) ? result : [result];
    for (const p of paths) shotTracker.fireSystem(kind || "screenshot", { path: p });
  } catch (e) {
    bootLog(`screenshot failed: ${e && e.message}`);
    if (!screenshotFailureNotified && tracker === shotTracker) {
      screenshotFailureNotified = true;
      notifyUser(
        "Process Discovery Tracker",
        "Screenshots are failing. Transactions, clicks and typing are still recorded. To get screenshots back, stop the recording and start a new one.",
        { urgency: "normal" }
      );
    }
  }
}

/* Wait for the screenshots still being taken, at most SHOT_DRAIN_MS. */
function drainScreenshots() {
  if (!shotsInFlight.size) return Promise.resolve();
  return Promise.race([
    Promise.allSettled([...shotsInFlight]),
    new Promise((resolve) => setTimeout(resolve, SHOT_DRAIN_MS)),
  ]);
}

/* Browser watchdog (ADR-0001 footnote: Chrome / Edge expose web content via
   UIA, but only after the AXTree is woken up). The recorder's own wake-up
   poller closes most of the gap; browser-watchdog.js decides when the SME is
   told it did not: a browser in front, the SME active, 30 s in all, and
   nothing from that browser recorded in this recording. One toast per
   recording (lane LF-SME, live finding 14). */
let browserWatch = null;
function checkBrowserWatchdog(status) {
  if (!session || !tracker || !browserWatch) return;
  let idleMs = Infinity;
  try { idleMs = powerMonitor.getSystemIdleTime() * 1000; } catch (_) { /* no idle time: not counted */ }
  const warn = browserWatch.tick({
    foregroundApp: status && status.currentApp,
    userIdleMs: idleMs,
    paused: !!(status && status.paused),
    recorderOn: recorderStateLabel(false) === "on",
  });
  if (!warn) return;
  // One plain line for the SME; the IT fix (the browser's
  // AccessibilityModeEnabled policy) is in docs/architecture/CAPTURE.md.
  notifyUser(
    "Process Discovery Tracker",
    "Clicks and typing in " + guidance.friendlyAppName(status.currentApp) +
    " are not being recorded. Keep going and tell the analyst; transactions and " +
    "screenshots are still recorded.",
    { urgency: "normal" }
  );
}

async function onTickHandler(status) {
  lastStatus = status;
  /* D3: remember the last work-window bounds, excluding our own recorder
     windows. While a recorder window (panel / status) holds focus,
     BrowserWindow.getFocusedWindow() is non-null -- skip the update so a
     marker screenshot keeps targeting the worker's monitor, not the
     recorder's. (Single-monitor occlusion -- the panel physically covering
     the work app -- is handled in screenshots.js, which dims our own windows
     to opacity 0 for the duration of the grab.) */
  if (status && status.currentBounds && !BrowserWindow.getFocusedWindow()) {
    lastWorkBounds = status.currentBounds;
  }
  refreshTray();
  checkBrowserWatchdog(status);
  /* App-switch screenshot trigger -- detect new currentApp value and
     fire a screenshot. lastTrackedApp persists across ticks. The first
     program of the recording is not a switch: Transaction 1's screenshot
     shows it (live finding 21: this check used to run after lastTrackedApp
     had been overwritten, so it never skipped). */
  if (
    config &&
    config.screenshots.enabled &&
    config.screenshots.on_app_switch &&
    status.currentApp &&
    status.currentApp !== lastTrackedApp
  ) {
    const switched = isAppSwitch(lastTrackedApp, status.currentApp);
    lastTrackedApp = status.currentApp;
    if (switched) fireScreenshot("screenshot");
  }
  /* Screen-change screenshot trigger (lane LF-SHOT): another window title
     in the same program is another screen, and the PDD prints a
     screenshot under each step. Not while one of our own windows (the
     bar) is in front: the grab would show what is behind it. */
  if (config && config.screenshots.enabled && config.screenshots.on_screen_change && status.currentApp) {
    const screen = { app: status.currentApp, screen: normalizeTitle(status.currentTitle) };
    const changed = isScreenChange(lastTrackedScreen, screen);
    lastTrackedScreen = screen;
    if (changed && !BrowserWindow.getFocusedWindow()) fireScreenshot("screenshot");
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
      "Clicks and typing are not being recorded",
      "Nothing has been recorded for over 2 minutes. Transactions and screenshots " +
      "still work. Stop the recording, start a new one, and tell the analyst.",
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

async function setupOBS() {
  /* Connects to OBS for the video. Without OBS the recording simply goes
     on without video and says nothing: SME laptops usually have no OBS,
     and the analyst can add a video (a Teams recording) later. Only a
     setup that requires OBS (obs.required) stops the start, with a
     dialog. */
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
        "Recording not started",
        "This setup needs OBS for the video, and OBS could not be reached " +
          `(${eff.websocket_url}: ${e && e.message}).\n\n` +
          "Start OBS with its WebSocket server on, then start recording again. " +
          "A password for OBS goes in Setup (analyst), Settings."
      );
      return false;
    }
    return true; // go on without video
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
    // #7: atomic update so this background-OBS write can't clobber a concurrent
    // manifest update (e.g. the display-geometry write). The awaited `sync` is
    // computed BEFORE the read-modify-write, so the mutate touches a fresh copy.
    updateManifest(session.sessionFolder, (m) => {
      m.obs = m.obs || {};
      m.obs.recording_path = sync.recording_path;
      m.obs.recording_start_ts = sync.obs_recording_start_ts;
      m.obs.offset_ms = sync.offset_ms;
    });
    return true;
  } catch (e) {
    bootLog(`OBS startRecording failed: ${e && e.message}`);
    appLogger().error("OBS startRecording failed", e);
    return false;
  }
}

async function startSession() {
  if (session) return session;
  fs.mkdirSync(baseDir, { recursive: true });

  /* B2: the pre-flight check, non-blocking: a recordings folder that
     cannot be written to is told in a toast and the start goes on. The
     default request code is no longer announced at every start. */
  const problems = validateConfig(config, baseDir);
  if (problems.length) {
    notifyUser("The recording may not be saved", problems.join(" ") + " Tell the analyst.", { urgency: "normal" });
  }

  /* Strict-mode OBS preflight: connect synchronously so a failed
     required-OBS doesn't create a half-baked session on disk. */
  if (config.obs && config.obs.required) {
    const ok = await setupOBS();
    if (!ok) return null;
  }

  /* Worker consent gate (§11f). Off by default; when configured, the worker
     must consent before any recording starts -- declining aborts the start.
     The decision is recorded on the manifest. */
  const cmode = (config.consent && config.consent.mode) || "off";
  const cversion = (config.consent && config.consent.version) || 1;
  const cworker = (config.worker && config.worker.id) || "unknown";
  let consent = consentRecord({ mode: "off" });
  if (cmode !== "off") {
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
      notifyUser("Recording not started", "Consent was declined, so nothing is recorded.", { urgency: "normal" });
      bootLog("session start aborted: consent declined");
      return null;
    }
  }

  session = createSession({
    baseDir,
    engagementId: config.engagement_id,
    config,
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
  // A fresh browser watchdog for the new recording.
  browserWatch = createBrowserWatchdog();
  if (obsConnected) {
    tracker.fireSystem("obs_recording_start");
  }

  /* Best-effort OBS: connect in the background so a missing/idle OBS
     no longer freezes session start by the WebSocket connect timeout
     (~5s). The session is already live and recording markers/screens/
     interactions; if OBS connects, attachObsRecording() wires in the
     video-sync record and fires obs_recording_start. If it fails, the
     recording goes on without video, silently. */
  if (!obsConnected && config.obs && config.obs.websocket_url && !config.obs.required) {
    const sessionAtStart = session;
    setupOBS().then(async () => {
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
      }
    }).catch((e) => bootLog(`background OBS connect failed: ${e && e.message}`));
  }

  lastTrackedApp = null;
  lastTrackedScreen = null;
  screenshotFailureNotified = false;
  lastStatus = tracker.getStatus();
  startIdleMonitor();

  /* I43: stamp the display geometry onto the manifest so the viewer can
     badge which monitor each captured window was on. #7: atomic update so it
     sits alongside the fields createSession + the background OBS write touch,
     without a stale read clobbering them. */
  try {
    const { screen } = require("electron");
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }));
    updateManifest(session.sessionFolder, (m) => { m.displays = displays; });
  } catch (e) { bootLog(`display geometry write failed: ${e && e.message}`); }

  recorderPermanentlyDead = false;   // RP-20: recorder state resets per session only
  if (config.interactions && config.interactions.enabled) {
    if (config.interactions.required) {
      const ok = await startRecorderForSession();
      if (!ok) {
        // Strict mode: the required recorder failed, so the session goes.
        await endSession({ skipCloseout: true });
        return null;
      }
    } else {
      /* Lane LF-SME (live finding 15): the recording and Transaction 1
         start now, and the recorder joins as soon as it is ready; until
         then the bar says "Starting the recorder...". */
      startRecorderForSession().catch((e) => bootLog(`recorder start failed: ${e && e.message}`));
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

/* The recorder for this session, under recorder.js's superviseRecorder: it
   restarts a crashed recorder after 5 s, at most
   interactions.max_restarts_per_session times per session (RP-20: the
   budget is the supervisor's, created here once per session, and never
   refilled by a successful re-spawn). A clean exit (code 0, what endSession
   asks for) is not a death: no recorder_died, no restart.
   Lane LF-SME (live finding 15): it waits for the launch-time warm-up first
   (without blocking: the bar says "Starting the recorder..."), so the spawn
   itself is quick; a stop meanwhile cancels it. */
async function startRecorderForSession() {
  const epoch = recorderEpoch;
  if (recorderWarmUp) {
    recorderStarting = true;
    try { await recorderWarmUp; } catch (_) { /* the spawn below reports its own failure */ }
    recorderStarting = false;
    if (epoch !== recorderEpoch || !session || !tracker) return false;   // stopped meanwhile
  }
  try {
    recorder = require("./recorder.js").superviseRecorder({
      spawnOpts: {
        sessionId: session.sessionId,
        verbose: !!(config.interactions && config.interactions.verbose),
        debounceMs: config.interactions && config.interactions.debounce_ms,
        ocr: !!(config.interactions && config.interactions.ocr),
        onEvent: (data) => {
          if (!tracker) return;
          try { tracker.fireInteraction(data); }
          catch (e) { bootLog(`fireInteraction failed: ${e && e.message}`); }
          // The browser watchdog: something from this program was recorded.
          if (browserWatch) browserWatch.noteRecorded(data && data.process_name);
          // §E2: an interaction proves the recorder is alive.
          if (deadMan) deadMan.noteSignal();
        },
        // Typing the recorder saw and has not written yet: recorded input for
        // the browser watchdog, and a sign of life (never written to disk).
        onActivity: (data) => {
          if (!tracker) return;
          if (browserWatch) browserWatch.noteRecorded(data && data.process_name);
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
        bootLog,
      },
      autoRestart: !!config.interactions.auto_restart,
      maxRestarts: config.interactions.max_restarts_per_session,
      onStarted: () => { if (tracker) tracker.fireSystem("recorder_start"); },
      onDied: (info) => { if (tracker) tracker.fireSystem("recorder_died", info); },
      onDead: () => {
        recorderPermanentlyDead = true;
        if (tracker) tracker.fireSystem("recorder_dead_permanent");
        notifyUser(
          "Process Discovery Tracker",
          "Clicks and typing are no longer recorded. Transactions and screenshots still are. To fix it, stop the recording and start a new one.",
          { urgency: "critical" }
        );
      },
    });
    // Paused while the recorder was starting: it starts paused too.
    const live = recorder.current();
    if (live && tracker && tracker.getStatus().paused) live.pause();
    return true;
  } catch (e) {
    bootLog(`recorder spawn failed: ${e && e.message}`);
    if (config.interactions.required) {
      dialog.showErrorBox(
        "Recording not started",
        "Clicks and typing cannot be recorded on this computer, and this setup " +
          `requires them (${e && e.message}).\n\nTell the analyst.`
      );
      return false;
    }
    return false;
  }
}

/* Tracker-side notices that warrant a desktop toast: write_error,
   events_dropped, and uncaptured_app (a foreground app the recorder produced
   no interaction events for -- commonly an elevated process, or one with no
   UIA surface). */
function handleTrackerNotice(kind, payload) {
  if (kind === "events_dropped") {
    // RP-21: a batch of clicks/typing could not be written and was dropped;
    // the tracker records the gap as an events_dropped system event. Told
    // once per loss stretch, not per failed flush.
    bootLog(`tracker events_dropped notice: ${JSON.stringify(payload)}`);
    notifyUser(
      "Process Discovery Tracker",
      "Some clicks and typing could not be saved. The gap is noted in the recording. If this keeps happening, tell the analyst (the disk may be full)."
    );
    return;
  }
  if (kind === "write_error") {
    // H-6: a durability-critical batch (markers/system events) failed to
    // write and was re-queued for retry. Surface it loudly: the durable
    // record is at risk and the SME should know before walking away.
    bootLog(`tracker write_error notice: ${JSON.stringify(payload)}`);
    notifyUser(
      "Process Discovery Tracker",
      "The recording could not be saved to disk; trying again. If this keeps happening, stop and tell the analyst (the disk may be full)."
    );
    return;
  }
  if (kind !== "uncaptured_app") return;
  // Stay quiet when there is no live recorder: its own failure toast
  // (or the required-recorder dialog) already told the user.
  if (!recorder || !recorder.current() || recorderPermanentlyDead) return;
  notifyUser(
    "Process Discovery Tracker",
    "Clicks and typing in " + guidance.friendlyAppName(payload && payload.app) +
    " are not being recorded. Keep going and tell the analyst; transactions and screenshots are still recorded."
  );
}

/* The one-screen end summary (end-summary-window.js): "Recording saved",
   the transactions and the duration, a warning when no transaction was
   marked, the folder
   with Show the folder and Make a zip for the analyst, and an optional
   name. One window per recording, so a summary still open from an earlier
   recording keeps its unsaved name. */
function showEndSummary(summary) {
  const model = guidance.summaryModel({ ...summary, hotkey: keyFor("start") });
  try {
    windows.show("summary:" + summary.sessionFolder, () => showEndSummaryWindow(model));
  } catch (e) {
    bootLog(`end summary: could not open it: ${e && (e.stack || e.message)}`);
  }
}

/* Stopping is single-flight: a second stop (the bar and the tray at once,
   or Quit during a stop) waits for the first instead of tearing the
   recording down twice. */
let endingPromise = null;
function endSession(opts) {
  if (!endingPromise) {
    endingPromise = endSessionNow(opts || {}).finally(() => { endingPromise = null; });
  }
  return endingPromise;
}

async function endSessionNow(opts) {
  if (!tracker) return null;
  recorderEpoch += 1;     // a recorder still starting for this recording stands down
  stopIdleMonitor();
  stopDeadManMonitor();   // §E2: a clean end is not a silent death

  if (recorder) {
    // recorder_stop only when a recorder is live (not mid-restart or dead).
    if (recorder.current()) {
      try { tracker.fireSystem("recorder_stop"); } catch (_e) {}
    }
    // Resolves once the recorder's output has closed (RP-23), so its final
    // flushed values reach the tracker before tracker.stop() below.
    try { await recorder.stop({ drainTimeoutMs: 1500 }); } catch (_e) {}
    recorder = null;
  }
  recorderPermanentlyDead = false;

  if (obsConnected && obs) {
    try {
      tracker.fireSystem("obs_recording_stop");
      const r = await stopRecording(obs);
      if (r && r.outputPath) {
        /* If OBS reported a final path after stop, update the manifest (#7:
           atomic; the awaited stop result is computed before the write). */
        updateManifest(session.sessionFolder, (m) => {
          m.obs = m.obs || {};
          m.obs.recording_path = r.outputPath;
        });
      }
    } catch (e) {
      bootLog(`OBS stopRecording failed: ${e && e.message}`);
      appLogger().error("OBS stopRecording failed", e);
    }
    try { await obs.disconnect(); } catch (_e) {}
    obs = null;
    obsConnected = false;
  }

  // A screenshot still being taken lands before session_end.
  await drainScreenshots();
  const finalStatus = await tracker.stop();
  closeSession({ sessionFolder: session.sessionFolder, status: "closed" });
  /* B5: integrity manifest, written last so it captures the final
     manifest.json and events.jsonl sizes. */
  try { writeSessionIntegrity(session.sessionFolder); }
  catch (e) { bootLog(`session-integrity write failed: ${e && e.message}`); }

  /* The storage size is no longer a toast at the end of every recording:
     the Setup (analyst) menu shows it and flags it over the limit. */
  bootLog(`session ended: ${session.sessionFolder}`);
  const oldFolder = session.sessionFolder;
  tracker = null;
  session = null;
  lastStatus = null;
  sessionStorage.invalidateSessionsCache();  // new session lands in the count + size

  /* The bar belongs to the recording and closes with it. The end summary
     follows, except on paths that must not pop UI (quit, a failed-start
     teardown). */
  recordingBar.closeBar();
  if (!opts.skipCloseout) {
    showEndSummary({
      sessionFolder: oldFolder,
      runs: finalStatus.startMarkerCount,
      durationMs: finalStatus.elapsedMs,
      pausedMs: finalStatus.pausedMs,
    });
  }
  return oldFolder;
}

/* The next run: "Transaction N", or a named run's label. tracker.startRun ends a
   run that is still open first, so runs never nest. Reached only through
   the one start below, which starts the recording first when nothing
   records. Returns the run's name. */
function startRunNow(label) {
  const ev = tracker.startRun(label);
  if (config.screenshots.enabled && config.screenshots.on_marker_fire) {
    fireScreenshot("screenshot");
  }
  lastStatus = tracker.getStatus();
  refreshTray();
  return ev && ev.data ? ev.data.label : null;
}

/* The one start (recording-control.js). The Start recording button on the
   bar, the tray item, the welcome's button, the transaction key and pdt:startSession
   all call startFromUi: with nothing recording it starts the recording with
   Transaction 1, while recording it starts the next one. Presses during a start or
   a stop are absorbed. */
const control = createRecordingControl({
  isRecording: () => !!tracker,
  startRecording: async () => {
    const s = await startSession();
    refreshTray();
    return !!(s && tracker);
  },
  startRun: (label) => startRunNow(label),
  stopRecording: async () => {
    const folder = await endSession();
    refreshTray();
    return folder;
  },
});

async function startFromUi(label) {
  let r;
  try {
    r = await control.start(typeof label === "string" && label ? label : undefined);
  } catch (e) {
    bootLog(`start failed: ${e && (e.stack || e.message)}`);
    return { started: false, reason: "error" };
  }
  if (r.started && r.newRecording) openRecordingBar();
  if (!r.started) bootLog(`start absorbed: ${r.reason}`);
  refreshTray();
  return r;
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

ipcMain.handle("pdt:fireStart", (_e, label) => startFromUi(label));

/* --- Status for the recording bar and the tray -------------------- */

function recorderStateLabel(paused) {
  if (!config || !config.interactions || !config.interactions.enabled) return "disabled";
  if (recorderPermanentlyDead) return "dead";
  if (recorderStarting && tracker) return "starting";
  if (!recorder || !recorder.current()) return "off";
  return paused ? "paused" : "on";
}

/* One status snapshot for the bar (pdt:status) and the tray's first line.
   Only what they show: no counters, no program names, no window titles. */
function currentStatus() {
  if (!tracker) {
    return { tracking: false, paused: false, recorder_state: recorderStateLabel(false) };
  }
  const s = tracker.getStatus();
  return {
    tracking: true,
    paused: s.paused,
    idle: isIdle,
    obsConnected,
    openMarkers: s.openMarkers,
    markerDepth: s.markerDepth,
    runCount: s.startMarkerCount,
    elapsedMs: s.elapsedMs,
    pausedMs: s.pausedMs,
    currentPauseMs: s.currentPauseMs,
    screenshotsEnabled: !!(config && config.screenshots && config.screenshots.enabled),
    recorder_state: recorderStateLabel(s.paused),
    recorder_silent: !!(deadMan && deadMan.isSilent()),
  };
}

function hasNamedRuns() {
  return !!(config && Array.isArray(config.process_labels) && config.process_labels.length);
}

/* What the bar paints (capture-guidance.barModel), sent with every status. */
function barView(status) {
  return guidance.barModel({
    status: status || currentStatus(),
    hotkey: keyFor("start"),
    namedRuns: hasNamedRuns(),
  });
}

ipcMain.handle("pdt:status", () => {
  const status = currentStatus();
  status.view = barView(status);
  return status;
});

function togglePause() {
  if (!tracker) return null;
  const s = tracker.getStatus();
  if (s.paused) tracker.resume(); else tracker.pause();
  // After Resume the browser watchdog counts afresh (live finding 14).
  if (s.paused && browserWatch) browserWatch.restart();
  lastStatus = tracker.getStatus();
  const live = recorder && recorder.current();
  if (live) {
    try { lastStatus.paused ? live.pause() : live.resume(); } catch (_e) {}
  }
  refreshTray();
  return lastStatus;
}

ipcMain.handle("pdt:togglePause", () => togglePause());

/* Kept for drivers that start a recording over IPC: the same one start (the
   recording, then Transaction 1), never a recording without a run. */
ipcMain.handle("pdt:startSession", async () => {
  const r = await startFromUi();
  return r.started && session ? { sessionFolder: session.sessionFolder } : null;
});
ipcMain.handle("pdt:endSession", async () => {
  const r = await control.stop();
  refreshTray();
  return r.stopped ? r.result : null;
});

ipcMain.handle("pdt:fireEnd", () => { fireEndMarker(); });

/* The end summary's acts. Each acts only on a recording folder under the
   recordings folder (session.isRecordingFolder), never on another path. */
ipcMain.handle("pdt:setSessionLabel", (_e, sessionFolder, label) => {
  if (!isRecordingFolder(baseDir, sessionFolder)) return false;
  try {
    setSessionLabel(sessionFolder, label);
    return true;
  } catch (e) {
    bootLog(`setSessionLabel failed: ${e && e.message}`);
    return false;
  }
});

ipcMain.handle("pdt:showFolder", (_e, sessionFolder) => {
  if (!isRecordingFolder(baseDir, sessionFolder)) return false;
  shell.showItemInFolder(path.resolve(sessionFolder));
  return true;
});

/* "Make a zip for the analyst": a zip next to the folder, named after the
   recording (recording-zip.js; the time stamp when it has no name), then
   Explorer with the zip selected, for the SME to attach to an email or a
   Teams message by hand. Nothing is sent from here. */
ipcMain.handle("pdt:zipFolder", async (_e, sessionFolder) => {
  if (!isRecordingFolder(baseDir, sessionFolder)) {
    return { ok: false, error: "This is not a recording folder." };
  }
  if (session && path.resolve(session.sessionFolder) === path.resolve(sessionFolder)) {
    return { ok: false, error: "This recording is still running." };
  }
  try {
    const r = await zipRecording(sessionFolder);
    shell.showItemInFolder(r.zipPath);
    sessionStorage.invalidateSessionsCache();
    bootLog(`zip written: ${r.zipPath} (${r.bytes} bytes, ${r.entries} entries)`);
    return { ok: true, zipName: path.basename(r.zipPath), size: sessionStorage.humanSize(r.bytes) };
  } catch (e) {
    bootLog(`zip failed for ${sessionFolder}: ${e && (e.stack || e.message)}`);
    return { ok: false, error: describeZipError(e) };
  }
});

/* The recording bar: its height follows its content (a problem line), and
   the caret next to Next transaction offers the named ones. */
ipcMain.handle("pdt:barResize", (_e, size) => {
  recordingBar.fitHeight(size && size.height);
});
ipcMain.handle("pdt:namedRunMenu", (e) => {
  if (!hasNamedRuns()) return;
  const menu = Menu.buildFromTemplate(config.process_labels.map((label) => ({
    label,
    click: () => { startFromUi(label); },
  })));
  menu.popup({ window: BrowserWindow.fromWebContents(e.sender) || undefined });
});

function showHelp() {
  windows.show("help", () => showHelpWindow({
    keys: { start: keyFor("start"), end: keyFor("end"), shot: keyFor("shot") },
    folder: baseDir,
  }));
}

function openRecordingBar() {
  return recordingBar.openBar(barView(), { namedRuns: hasNamedRuns() });
}

function toggleRecordingBar() {
  if (recordingBar.isOpen()) recordingBar.closeBar();
  else openRecordingBar();
  refreshTray();
}

function openRecordingsFolder() {
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch (_e) { /* openPath reports it */ }
  shell.openPath(baseDir);
}

/* The tray's first line and tooltip: "Not recording", "Recording: Transaction 2". */
function statusLine() {
  return guidance.trayStatusLine(currentStatus());
}

/* "2026-09-24 10:15" in local time (started_at is stored in UTC). */
function localStamp(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Everything the analyst (or IT) sets up, in one submenu: the recording
   setup, settings, profile, the readiness check, and the recordings on
   this computer. The recording setup and the readiness check are offered
   only while nothing records (setup applies at the next launch; the check
   runs its own recorder). */
function buildSetupMenu() {
  const items = [];
  if (!tracker) items.push({ label: "Recording setup...", click: () => showSessionConfigDialog() });
  items.push({ label: "Settings...", click: () => showSettingsDialog() });
  items.push({ label: "Profile...", click: () => showProfileDialog() });
  if (!tracker) items.push({ label: "Readiness check...", click: () => showReadinessDialog() });
  items.push({ type: "separator" });

  const recent = listRecentSessions(baseDir, 8);
  const activeFolder = session ? session.sessionFolder : null;
  if (recent.length) {
    items.push({
      label: "Recent recordings",
      submenu: recent.map((r) => {
        const when = localStamp(r.started_at);
        const state = r.status === "active" ? "  (recording)" : (r.status === "recovered" ? "  (recovered)" : "");
        const isCurrent = r.sessionFolder === activeFolder;
        return {
          label: when + "  " + r.engagement + state + "  (" + sessionStorage.folderSizeHuman(r.sessionFolder) + ")",
          submenu: [
            { label: "Show in folder", click: () => shell.showItemInFolder(r.sessionFolder) },
            { type: "separator" },
            {
              label: isCurrent ? "Delete... (still recording)" : "Delete...",
              enabled: !isCurrent,
              click: () => sessionStorage.confirmAndDeleteSession(r.sessionFolder, r.label),
            },
          ],
        };
      }),
    });
  }
  /* The storage warning lives here now (not a toast at every stop). */
  const totals = sessionStorage.getSessionsTotal();
  const limitGb = (config && config.storage_warn_gb) || 50;
  const over = totals.bytes > limitGb * 1024 * 1024 * 1024;
  items.push({
    label: `Recordings on this computer: ${totals.count}, ${sessionStorage.humanSize(totals.bytes)}` +
      (over ? ` (over the ${limitGb} GB limit)` : ""),
    enabled: false,
  });
  if (totals.count > 0) {
    items.push({
      label: "Delete recordings older than",
      submenu: [30, 90, 365].map((days) => ({
        label: `${days} days`,
        click: () => sessionStorage.confirmAndPruneByAge(days),
      })),
    });
  }
  return items;
}

function buildMenu() {
  const items = [
    { label: statusLine(), enabled: false },
    { type: "separator" },
  ];
  if (!tracker) {
    items.push({
      label: "Start recording",
      accelerator: keyFor("start") || undefined,
      click: () => { startFromUi(); },
    });
  } else {
    items.push({
      label: "Next transaction",
      accelerator: keyFor("start") || undefined,
      click: () => { startFromUi(); },
    });
    // Named transactions from the recording setup (process_labels). Like
    // the transaction key, each ends the open run first; runs never nest.
    if (hasNamedRuns()) {
      items.push({
        label: "Start a named transaction",
        submenu: config.process_labels.map((label) => ({
          label,
          click: () => { startFromUi(label); },
        })),
      });
    }
    const openRun =
      lastStatus && lastStatus.markerDepth > 0
        ? lastStatus.openMarkers[lastStatus.openMarkers.length - 1]
        : null;
    items.push({
      label: openRun ? `End transaction (${openRun})` : "End transaction",
      accelerator: keyFor("end") || undefined,
      enabled: !!openRun,
      click: () => fireEndMarker(),
    });
    items.push({
      label: "Take a screenshot",
      accelerator: keyFor("shot") || undefined,
      enabled: !!config.screenshots.enabled,
      click: () => fireManualScreenshot(),
    });
    items.push({ type: "separator" });
    items.push({
      label: lastStatus && lastStatus.paused ? "Resume recording" : "Pause recording",
      click: () => togglePause(),
    });
    items.push({
      label: "Stop recording",
      // The end summary follows the stop.
      click: () => { control.stop().then(() => refreshTray()); },
    });
    items.push({ type: "separator" });
  }
  items.push({ label: "Open recordings folder", click: () => openRecordingsFolder() });
  if (!tracker) items.push({ type: "separator" });
  items.push({
    label: recordingBar.isOpen() ? "Hide recording bar" : "Show recording bar",
    click: () => toggleRecordingBar(),
  });
  items.push({ label: "Help", click: () => showHelp() });
  items.push({ label: "Setup (analyst)", submenu: buildSetupMenu() });

  items.push({ type: "separator" });
  items.push({
    label: "Quit",
    click: async () => {
      // skipCloseout: the app is quitting, the end summary would be torn
      // down with it. The recording is intact either way.
      if (tracker) await endSession({ skipCloseout: true });
      globalShortcut.unregisterAll();
      app.quit();
    },
  });
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip("Process Discovery Tracker · " + statusLine());
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
  for (const o of orphans) {
    markSessionRecovered({ sessionFolder: o.sessionFolder });
    bootLog(`marked orphan recovered: ${o.sessionFolder}`);
  }

  tray = new Tray(trayIconImage());
  tray.setToolTip("Process Discovery Tracker · Not recording");
  refreshTray();
  // Left- and right-click both open the menu, symmetrically. Driven
  // explicitly (not via setContextMenu) so right-click does not
  // double-fire -- see refreshTray().
  // D1: while recording, a left-click shows the recording bar again (if
  // it was hidden) so the SME can always reach Next transaction, Pause and Stop.
  // When nothing records, a left-click opens the menu (to start). Right
  // click always opens the menu.
  tray.on("click", () => {
    if (tracker) {
      openRecordingBar();
      refreshTray();
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

  // The one start: the recording with Transaction 1, then one press per
  // transaction.
  const startHK = registerHotkey(config.hotkeys.start_picker, () => { startFromUi(); });
  const endHK = registerHotkey(config.hotkeys.end_innermost, () => fireEndMarker());
  const shotHK = registerHotkey(config.hotkeys.manual_screenshot, () => fireManualScreenshot());
  bootLog(`hotkeys: start=${startHK.ok}(${startHK.key}) end=${endHK.ok}(${endHK.key}) shot=${shotHK.ok}(${shotHK.key})`);
  activeKeys = {
    start: startHK.ok ? startHK.key : "",
    end: endHK.ok ? endHK.key : "",
    shot: shotHK.ok ? shotHK.key : "",
  };
  refreshTray();

  /* P2.10 + B3: surface hotkey trouble to the operator via a toast --
     both bindings that fell back to an alternate, and bindings that
     could not be registered at all (boot.log alone is too quiet; some
     screen-recorder / password-manager combos grab Ctrl+Shift+S). */
  const hotkeyInfo = [
    ["Start recording and the next transaction", config.hotkeys.start_picker, startHK],
    ["End transaction", config.hotkeys.end_innermost, endHK],
    ["Take a screenshot", config.hotkeys.manual_screenshot, shotHK],
  ];
  const fmt = guidance.formatHotkey;
  const fellBack = hotkeyInfo.filter((h) => h[2].fellBack);
  const failed = hotkeyInfo.filter((h) => !h[2].ok);
  if (fellBack.length) {
    const list = fellBack
      .map((h) => `${h[0]}: ${fmt(h[2].key)} (another program uses ${fmt(h[1])})`)
      .join("; ");
    notifyUser("Keys changed", list + ".", { urgency: "low" });
  }
  if (failed.length) {
    const list = failed.map((h) => `${h[0]} (${fmt(h[1])})`).join(", ");
    notifyUser(
      "Keys not available",
      `Another program uses these keys: ${list}. Use the recording bar or the tray menu instead.`,
      { urgency: "low" }
    );
  }

  // First-run welcome. shouldShowOnLaunch() returns true once per
  // machine (gated by userData/welcome-shown.json).
  if (welcomeWin.shouldShowOnLaunch()) {
    welcomeWin.showWelcomeWindow({ keys: { start: keyFor("start") } });
  }

  /* First-run recorder extraction. recorder.zip ships at >100 MB and was
     historically extracted synchronously the first time startSession()
     ran -- a multi-second freeze on first capture. Do it async here at
     launch so the first session start is instant. Quiet no-op when the
     exe is already present or the zip isn't shipped (dev box).
     Then the warm-up (lane LF-SME, live finding 15): the recorder runs once,
     in a worker thread, so Windows' check of the 187 MB exe and its first
     unpacking happen now and not at the SME's first Start. A Start before
     it is done waits for it without freezing (startRecorderForSession). */
  if (config.interactions && config.interactions.enabled) {
    const { ensureRecorderExtracted, warmUpRecorder } = require("./recorder.js");
    // Quiet unless it fails: unpacking is not the SME's business.
    recorderWarmUp = ensureRecorderExtracted({ bootLog }).then((r) => {
      if (!r.ok && r.reason !== "no-zip") {
        notifyUser(
          "Process Discovery Tracker",
          "Clicks and typing cannot be recorded on this computer. Transactions and screenshots still work; tell the analyst.",
          { urgency: "normal" }
        );
      }
      /* reason === "no-zip" on a dev box is fine: a hand-built
         recorder/publish/recorder.exe is already on disk, or the user
         doesn't have one yet. */
      if (!r.ok || !r.exe) return null;
      return warmUpRecorder(r.exe).then((w) => {
        bootLog(`[recorder] warm-up: ${JSON.stringify(w)}`);
        return w;
      });
    }).catch((e) => { bootLog(`recorder extraction failed: ${e && e.message}`); return null; });
  }
}).catch((e) => bootLog(`whenReady failed: ${(e && e.stack) || e}`));

// The welcome's buttons (and drivers): "start" is the one start.
ipcMain.handle("pdt:welcomeAction", async (_e, action) => {
  if (action === "start") return startFromUi();
  if (action === "help") showHelp();
  else if (action === "bar") openRecordingBar();
  return null;
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
    // skipCloseout: no end summary on the way out; the recording is intact.
    try { await endSession({ skipCloseout: true }); } catch (err) { bootLog(`stop error: ${err}`); }
    app.quit();
  }
});
