/*
 * Process Discovery Tracker -- Electron tray + hotkeys (CJS).
 *
 * Capture-side entry point. Runs in the worker's system tray. Manages
 * session lifecycle, registers global hotkeys for Start/End markers,
 * and shows a Spotlight-style label picker for Start markers.
 *
 * Patterns reused from pocket-tracker/desktop-tracker/main.js:
 *   - Single-instance lock, boot.log diagnostic, before-quit flush
 *   - Tray icon + context menu, optional BrowserWindow UI
 *   - nodeIntegration:true / contextIsolation:false in trusted internal
 *     BrowserWindows (label picker) -- acceptable for first-party HTML
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
  } catch (_e) {
    /* ignore -- boot logging is best-effort */
  }
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

/* v0 config -- hard-coded for the prototype. Per-session YAML config
   (§6.2 of the design) lands in iteration 2; for now we ship the
   process labels and hotkeys inline. */
const CONFIG = {
  engagementId: process.env.PDT_ENGAGEMENT || "default",
  baseDir: null, // set in whenReady (depends on app.getPath)
  processLabels: [
    "Order entry",
    "Ticket triage",
    "Refund flow",
    "Identity check",
    "Account setup",
  ],
  hotkeys: {
    startPicker: "Control+Shift+S",
    endInnermost: "Control+Shift+E",
  },
};

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

function startSession() {
  if (session) return session;
  fs.mkdirSync(CONFIG.baseDir, { recursive: true });
  session = createSession({
    baseDir: CONFIG.baseDir,
    engagementId: CONFIG.engagementId,
    config: {
      engagement_id: CONFIG.engagementId,
      process_labels: CONFIG.processLabels,
      hotkeys: CONFIG.hotkeys,
    },
  });
  tracker = startTracker({
    sessionId: session.sessionId,
    eventsFile: session.eventsFile,
    onTick: (status) => {
      lastStatus = status;
      refreshTray();
    },
  });
  lastStatus = tracker.getStatus();
  bootLog(`session started: ${session.sessionFolder}`);
  return session;
}

async function endSession() {
  if (!tracker) return null;
  await tracker.stop();
  closeSession({ sessionFolder: session.sessionFolder, status: "closed" });
  bootLog(`session ended: ${session.sessionFolder}`);
  const oldFolder = session.sessionFolder;
  tracker = null;
  session = null;
  lastStatus = null;
  return oldFolder;
}

function fireStartMarker(label) {
  if (!tracker) startSession();
  tracker.fireMarker({ markerType: "start", label: label || "(unlabeled)" });
  lastStatus = tracker.getStatus();
  refreshTray();
}

function fireEndMarker() {
  if (!tracker) return;
  if (!lastStatus || lastStatus.markerDepth === 0) return;
  tracker.fireMarker({ markerType: "end" });
  lastStatus = tracker.getStatus();
  refreshTray();
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
  labelPickerWindow.on("closed", () => {
    labelPickerWindow = null;
  });
  labelPickerWindow.on("blur", () => {
    if (labelPickerWindow && !labelPickerWindow.isDestroyed()) {
      labelPickerWindow.close();
    }
  });
}

function buildPickerHtml() {
  const labels = JSON.stringify(CONFIG.processLabels);
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
<div class="hint">Enter: fire · Esc: cancel · &uarr;&darr;: navigate</div>
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
  if (typed && !matched.includes(typed)) matched.push(typed + "  (new)");
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

ipcMain.handle("pdt:fireStart", (_e, label) => {
  fireStartMarker(label);
});

function statusLine() {
  if (!tracker) return "Idle -- right-click to start a session";
  if (lastStatus && lastStatus.paused) {
    return `Paused (${lastStatus.markerDepth} open)`;
  }
  const appName = (lastStatus && lastStatus.currentApp) || "(no window)";
  const depth = (lastStatus && lastStatus.markerDepth) || 0;
  return `Tracking: ${appName} - ${depth} open marker(s)`;
}

function buildMenu() {
  const items = [
    { label: statusLine(), enabled: false },
    { type: "separator" },
  ];
  if (!tracker) {
    items.push({
      label: "Start capture session",
      click: () => {
        startSession();
        refreshTray();
      },
    });
  } else {
    items.push({
      label: "Fire Start marker...",
      accelerator: CONFIG.hotkeys.startPicker,
      click: () => showLabelPicker(),
    });
    const quickStart = CONFIG.processLabels.map((label) => ({
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
      accelerator: CONFIG.hotkeys.endInnermost,
      enabled: !!innermost,
      click: () => fireEndMarker(),
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
    label: "Open sessions folder",
    click: () => shell.openPath(CONFIG.baseDir),
  });
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
  CONFIG.baseDir = path.join(app.getPath("userData"), "sessions");

  /* Recover orphaned sessions (§3.7 option a -- mark recovered;
     normalization layer reconciles open markers later). */
  const orphans = findOrphanedSessions(CONFIG.baseDir);
  for (const o of orphans) {
    markSessionRecovered({ sessionFolder: o.sessionFolder });
    bootLog(`marked orphan recovered: ${o.sessionFolder}`);
  }

  tray = new Tray(trayIconImage());
  tray.setToolTip("Process Discovery Tracker -- idle");
  refreshTray();
  tray.on("right-click", () => tray.popUpContextMenu());
  tray.on("click", () => tray.popUpContextMenu());

  const okStart = globalShortcut.register(CONFIG.hotkeys.startPicker, () => {
    if (!tracker) startSession();
    showLabelPicker();
  });
  const okEnd = globalShortcut.register(CONFIG.hotkeys.endInnermost, () => {
    fireEndMarker();
  });
  bootLog(`hotkeys: start=${okStart} end=${okEnd}`);
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
