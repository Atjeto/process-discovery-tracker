/*
 * Process Discovery Viewer -- Electron main process.
 *
 * Two surfaces (§9):
 *   - Session view: one session, video synced with timeline + annotations
 *   - Aggregate view: N sessions, mined map, statistics, BPMN export
 *
 * Main window is a tabbed shell. Renderer talks to main via IPC for
 * file open dialogs, normalization runs, and session file loads.
 */

"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { runNormalize } = require("./python-runner.js");

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Process Discovery Viewer",
    backgroundColor: "#13121A",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

/* --- IPC handlers ------------------------------------------------- */

ipcMain.handle("viewer:openSessionFolder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open session folder",
    properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle("viewer:openMultipleSessions", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open one or more session folders (or an engagement folder)",
    properties: ["openDirectory", "multiSelections"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  /* Auto-expand if the user picked an engagement folder containing
     session subfolders. A session folder is identified by the presence
     of events.jsonl. */
  const expanded = [];
  for (const p of r.filePaths) {
    if (fs.existsSync(path.join(p, "events.jsonl"))) {
      expanded.push(p);
    } else {
      try {
        for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          const sub = path.join(p, ent.name);
          if (fs.existsSync(path.join(sub, "events.jsonl"))) expanded.push(sub);
        }
      } catch (_e) {}
    }
  }
  return expanded;
});

ipcMain.handle("viewer:loadSession", (_e, sessionFolder) => {
  return loadSessionData(sessionFolder);
});

ipcMain.handle("viewer:loadMultipleSessions", (_e, folders) => {
  return folders.map((f) => {
    try { return loadSessionData(f); } catch (e) { return { error: e.message, sessionFolder: f }; }
  });
});

ipcMain.handle("viewer:runNormalize", async (_e, { sessionFolder, mine }) => {
  try {
    const result = await runNormalize({
      sessionFolder,
      mine: !!mine,
      onLog: (text) => mainWindow.webContents.send("viewer:normalizeLog", text),
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("viewer:exportFile", async (_e, { sourcePath, suggestedName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Export",
    defaultPath: suggestedName || path.basename(sourcePath),
  });
  if (r.canceled || !r.filePath) return null;
  fs.copyFileSync(sourcePath, r.filePath);
  return r.filePath;
});

ipcMain.handle("viewer:revealFile", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("viewer:openExternal", (_e, p) => shell.openPath(p));

/* --- Session loading ---------------------------------------------- */

function loadSessionData(sessionFolder) {
  const manifestPath = path.join(sessionFolder, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Not a session folder (no manifest.json): ${sessionFolder}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  /* Stream events.jsonl in. JSONL is line-delimited; we parse each
     line and skip malformed lines. */
  const eventsFile = path.join(sessionFolder, "events.jsonl");
  const events = [];
  if (fs.existsSync(eventsFile)) {
    const lines = fs.readFileSync(eventsFile, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try { events.push(JSON.parse(t)); } catch (_e) {}
    }
    events.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  }

  const stats = loadOptionalJson(path.join(sessionFolder, "stats.json"));
  const dfg = loadOptionalJson(path.join(sessionFolder, "dfg.json"));
  const annotations = loadOptionalJson(path.join(sessionFolder, "annotations.json"));
  const obsSync = loadOptionalJson(path.join(sessionFolder, "obs", "sync.json"));

  /* Locate the OBS recording. The manifest may point at an absolute
     path written by OBS; if missing or unreachable, the viewer renders
     the timeline without video. */
  let recordingPath = manifest.obs && manifest.obs.recording_path;
  let recordingAvailable = !!(recordingPath && fs.existsSync(recordingPath));

  return {
    sessionFolder,
    manifest,
    events,
    stats,
    dfg,
    annotations,
    obsSync,
    recordingPath,
    recordingAvailable,
  };
}

function loadOptionalJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (_e) { return null; }
}

/* --- Annotations write-back --------------------------------------- */

ipcMain.handle("viewer:saveAnnotations", (_e, { sessionFolder, annotations }) => {
  const annoPath = path.join(sessionFolder, "annotations.json");
  fs.writeFileSync(annoPath, JSON.stringify(annotations, null, 2));
  return annoPath;
});

/* --- App lifecycle ----------------------------------------------- */

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
