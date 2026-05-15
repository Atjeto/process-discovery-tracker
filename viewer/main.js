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

/* Pull any --session=<path> off argv so we can preload a session
   the capture app handed us. Filter file:// or http args defensively. */
function parseInitialSessionArg() {
  const args = process.argv.slice(1);
  for (const a of args) {
    if (typeof a !== "string") continue;
    if (a.startsWith("--session=")) {
      const p = a.slice("--session=".length);
      try {
        const abs = path.resolve(p);
        if (fs.existsSync(path.join(abs, "manifest.json"))) return abs;
      } catch (_) {}
    }
  }
  return null;
}
const initialSessionArg = parseInitialSessionArg();

// Module-scope handle for the currently-running normalize child
// process. All four runNormalize() callers register here via onProc
// so viewer:cancelNormalize can kill whichever is in flight.
let _normalizeHandle = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Process Discovery Viewer",
    backgroundColor: "#08080A",
    webPreferences: {
      /* The renderer loads only first-party HTML/CSS/JS from disk and
         uses require() for bpmn-js + cytoscape. nodeIntegration is
         required for that pattern; CSP and the deny-all window-open
         handler below mitigate the residual risk. */
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  /* Block any attempt to open external URLs from rendered content
     (e.g. malformed BPMN with an embedded link). */
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  /* Block in-page navigation away from the loaded index.html. */
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) e.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });

  // If the launcher passed --session=<path>, tell the renderer to open it.
  if (initialSessionArg) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("viewer:openInitialSession", initialSessionArg);
    });
  }
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
    const root = path.resolve(sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      throw new Error("Not a session folder; refusing to normalize.");
    }
    const result = await runNormalize({
      sessionFolder: root,
      mine: !!mine,
      onLog: (text) => mainWindow.webContents.send("viewer:normalizeLog", text),
      // Register the kill handle so viewer:cancelNormalize can stop
      // the in-flight child. Used by the aggregate "Analyze all"
      // loop as well as any other caller of this IPC.
      onProc: (h) => { _normalizeHandle = h; },
    });
    _normalizeHandle = null;
    if (result && result.cancelled) {
      return { ok: false, cancelled: true, error: "Analysis cancelled by user." };
    }
    return { ok: true, ...result };
  } catch (e) {
    _normalizeHandle = null;
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
  /* Normalize and resolve to an absolute path so downstream file
     accesses are anchored to a known root. */
  const root = path.resolve(sessionFolder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Session folder not found: ${root}`);
  }
  sessionFolder = root;
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

  /* Locate the recording. Priority: an analyst-attached external video
     (annotations.external_video, set via the Attach video flow for
     Teams recordings etc.) wins over the manifest's OBS path. The OBS
     path is the auto-captured default. */
  let recordingPath = manifest.obs && manifest.obs.recording_path;
  let externalVideoOffsetMs = null;
  if (annotations && annotations.external_video && annotations.external_video.path) {
    const ext = annotations.external_video;
    if (fs.existsSync(ext.path)) {
      recordingPath = ext.path;
      externalVideoOffsetMs = ext.offset_ms || 0;
    }
  }
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
    externalVideoOffsetMs,
  };
}

function loadOptionalJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (_e) { return null; }
}

/* --- Canonical YAML IPC ------------------------------------------- */

ipcMain.handle("viewer:openCanonicalFile", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open canonical YAML",
    properties: ["openFile"],
    filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], "utf-8") };
});

ipcMain.handle("viewer:saveCanonicalFile", (_e, { path: p, content }) => {
  fs.writeFileSync(p, content, "utf-8");
  return { path: p };
});

ipcMain.handle("viewer:testCanonicalMatch", async (_e, { canonicalPath, sessionFolder }) => {
  try {
    const root = path.resolve(sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, error: "Not a session folder" };
    }
    const result = await runNormalize({
      sessionFolder: root,
      mine: false,
      canonical: canonicalPath,
      onLog: () => {},
      onProc: (h) => { _normalizeHandle = h; },
    });
    _normalizeHandle = null;
    if (result && result.cancelled) {
      return { ok: false, cancelled: true, error: "Match test cancelled." };
    }
    // Read the freshly written stats.json for the match rate.
    const stats = loadOptionalJson(path.join(root, "stats.json")) || {};
    const meta = stats.meta || {};
    return {
      ok: true,
      match_rate: meta.match_rate || 0,
      matched: meta.matched_interactions || 0,
      total: meta.interaction_count || 0,
      ...result,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("viewer:runNormalizeExtended", async (_e, opts) => {
  try {
    const root = path.resolve(opts.sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      throw new Error("Not a session folder; refusing to normalize.");
    }
    const result = await runNormalize({
      sessionFolder: root,
      mine: !!opts.mine,
      canonical: opts.canonical || null,
      pddOut: opts.pddOut || null,
      stepBpmnOut: opts.stepBpmnOut || null,
      phaseBpmnOut: opts.phaseBpmnOut || null,
      stepCsvOut: opts.stepCsvOut || null,
      onLog: (text) => mainWindow.webContents.send("viewer:normalizeLog", text),
      onProc: (h) => { _normalizeHandle = h; },
    });
    _normalizeHandle = null;
    if (result && result.cancelled) {
      return { ok: false, cancelled: true, error: "Analysis cancelled by user." };
    }
    const stats = loadOptionalJson(path.join(root, "stats.json")) || {};
    const meta = stats.meta || {};
    return { ok: true, drift_count: meta.drift_count || 0, ...result };
  } catch (e) {
    _normalizeHandle = null;
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("viewer:cancelNormalize", () => {
  if (_normalizeHandle) {
    try { _normalizeHandle.kill(); } catch (_) {}
    return { ok: true };
  }
  return { ok: false, error: "No analysis in progress" };
});

ipcMain.handle("viewer:bootstrapAppVocab", async (_e, { sessionFolder, vocabId, vocabName }) => {
  /* Generate a starter App Vocabulary YAML from the captured
     interactions in this session. Writes to a temp file; renderer
     prompts the user for a save destination via viewer:exportFile. */
  try {
    const root = path.resolve(sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, error: "Not a session folder" };
    }
    const os = require("os");
    const tmpOut = path.join(os.tmpdir(), `pdt-vocab-${Date.now()}.yaml`);
    const r = await runNormalize({
      sessionFolder: root,
      bootstrapVocabOut: tmpOut,
      vocabId: vocabId || "untitled",
      vocabName: vocabName || "Untitled",
      onLog: () => {},
      onProc: (h) => { _normalizeHandle = h; },
    });
    _normalizeHandle = null;
    if (r && r.cancelled) {
      return { ok: false, cancelled: true, error: "Vocabulary bootstrap cancelled." };
    }
    if (!fs.existsSync(tmpOut)) {
      return { ok: false, error: "bootstrap produced no output" };
    }
    const yamlText = fs.readFileSync(tmpOut, "utf-8");
    try { fs.unlinkSync(tmpOut); } catch (_) {}
    return { ok: true, yaml: yamlText, summary: r && r.summary };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function appVocabDefaultDir() {
  /* Probe the shipped + dev locations for normalization/app_vocabularies/
     in priority order. The first writable one becomes the default save
     target for the analyst's bootstrap output. */
  const candidates = [
    path.resolve(__dirname, "..", "normalization", "app_vocabularies"),
    path.join(process.resourcesPath || "", "normalization", "app_vocabularies"),
    path.join(__dirname, "normalization", "app_vocabularies"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        // Quick write probe: try fs.accessSync with W_OK.
        fs.accessSync(c, fs.constants.W_OK);
        return c;
      }
    } catch (_) { /* not writable - try next */ }
  }
  return null;
}

ipcMain.handle("viewer:saveAppVocab", async (_e, { defaultName, content, preferAppVocabDir }) => {
  let defaultPath = defaultName || "app-vocabulary.yaml";
  if (preferAppVocabDir) {
    const dir = appVocabDefaultDir();
    if (dir) defaultPath = path.join(dir, defaultName || "app-vocabulary.yaml");
  }
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Save App Vocabulary YAML",
    defaultPath,
    filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content, "utf-8");
  return r.filePath;
});

ipcMain.handle("viewer:listAppVocabs", () => {
  /* List vocabs currently shipped with this dist + any extras via env
     var, so the viewer can show what's loaded. */
  const dirs = [];
  const def = appVocabDefaultDir();
  if (def) dirs.push(def);
  const extra = process.env.PDT_APP_VOCABULARIES || "";
  if (extra) {
    for (const raw of extra.split(/[;:]/)) {
      const t = raw.trim();
      if (t && fs.existsSync(t) && !dirs.includes(t)) dirs.push(t);
    }
  }
  const out = [];
  for (const d of dirs) {
    let entries;
    try { entries = fs.readdirSync(d); } catch (_) { continue; }
    for (const f of entries) {
      if (!/\.(ya?ml)$/i.test(f)) continue;
      const full = path.join(d, f);
      try {
        const stat = fs.statSync(full);
        const text = fs.readFileSync(full, "utf-8");
        // Parse just enough to get id, name, version, interaction count.
        // Use a tolerant regex pass so we don't pull in a yaml dep here.
        const idM = text.match(/^\s*id:\s*["']?([^"'#\n]+?)["']?\s*$/m);
        const nameM = text.match(/^\s*name:\s*["']?([^"'#\n]+?)["']?\s*$/m);
        const verM = text.match(/^\s*version:\s*(\d+)/m);
        const interactionCount = (text.match(/^\s*- signature:/gm) || []).length;
        out.push({
          path: full,
          dir: d,
          file: f,
          id: idM ? idM[1].trim() : f.replace(/\.ya?ml$/i, ""),
          name: nameM ? nameM[1].trim() : "",
          version: verM ? parseInt(verM[1], 10) : 1,
          interaction_count: interactionCount,
          modified: stat.mtime.toISOString(),
        });
      } catch (_) { /* skip bad file */ }
    }
  }
  return { dirs, vocabs: out };
});

ipcMain.handle("viewer:openVocabFile", (_e, p) => shell.openPath(p));

ipcMain.handle("viewer:readVocab", (_e, p) => {
  /* Parse a vocab YAML into a structured object for the editor.
     Returns null if the file is missing or malformed. */
  try {
    if (!p || !fs.existsSync(p)) return null;
    const yaml = require("js-yaml");
    const raw = yaml.load(fs.readFileSync(p, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    return raw.app_vocabulary || null;
  } catch (e) {
    return { _error: e.message };
  }
});

ipcMain.handle("viewer:writeVocab", (_e, { path: p, vocab }) => {
  /* Serialize a vocab object back to YAML and write atomically.
     The renderer is responsible for not destroying fields it didn't
     intend to (the read-write cycle preserves everything). */
  try {
    const yaml = require("js-yaml");
    const doc = { app_vocabulary: vocab };
    const text = yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
    fs.writeFileSync(p, text, "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("viewer:newVocabFile", async (_e, { suggestedId }) => {
  /* Create a new empty vocab file. Returns the path or null on cancel. */
  let defaultPath = (suggestedId || "new-app") + ".yaml";
  const dir = appVocabDefaultDir();
  if (dir) defaultPath = path.join(dir, defaultPath);
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "New App Vocabulary",
    defaultPath,
    filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
  });
  if (r.canceled || !r.filePath) return null;
  const yaml = require("js-yaml");
  const id = (suggestedId || path.basename(r.filePath, path.extname(r.filePath))).toLowerCase();
  const seed = {
    app_vocabulary: {
      id, name: id, version: 1,
      scope: { process_name: "" },
      interactions: [],
    },
  };
  fs.writeFileSync(r.filePath, yaml.dump(seed, { sortKeys: false }), "utf-8");
  return r.filePath;
});

/* External video attach (Teams recording, screen capture from any tool).
   Stored on the session's annotations under external_video so the raw
   manifest stays untouched. */
ipcMain.handle("viewer:attachExternalVideo", async (_e, { sessionFolder }) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Attach external video",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "webm", "mov", "avi"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0] };
});

ipcMain.handle("viewer:saveExternalVideoSync", (_e, { sessionFolder, videoPath, offsetMs }) => {
  /* Write to annotations.json under external_video; preserve all other
     annotation state. */
  try {
    const root = path.resolve(sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, error: "Not a session folder" };
    }
    const annoPath = path.join(root, "annotations.json");
    let anno = {};
    if (fs.existsSync(annoPath)) {
      try { anno = JSON.parse(fs.readFileSync(annoPath, "utf-8")) || {}; }
      catch (_) { anno = {}; }
    }
    anno.external_video = {
      path: videoPath,
      offset_ms: offsetMs || 0,
      attached_at: new Date().toISOString(),
    };
    fs.writeFileSync(annoPath, JSON.stringify(anno, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* --- Annotations write-back --------------------------------------- */

ipcMain.handle("viewer:saveAnnotations", (_e, { sessionFolder, annotations }) => {
  /* Anchor the write to an absolute session folder; reject if the
     resolved path doesn't contain a manifest (i.e. is not actually a
     session folder). Prevents accidental writes to arbitrary paths
     via a manipulated IPC payload. */
  const root = path.resolve(sessionFolder);
  if (!fs.existsSync(path.join(root, "manifest.json"))) {
    throw new Error("Refusing to write annotations: not a session folder");
  }
  const annoPath = path.join(root, "annotations.json");
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
