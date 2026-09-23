/*
 * Process Discovery Viewer -- Electron main process.
 *
 * One surface: the Session view (one session, video synced with the
 * timeline, steps, map, and exports).
 *
 * Renderer talks to main via IPC for file open dialogs, normalization
 * runs, and session file loads.
 */

"use strict";

const _electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/* Under a plain `node` process (e.g. the node:test runner pulling this
   module in to unit-test the pure helpers) require("electron") returns a
   path string, not the API object. Shim app/ipcMain/etc. to no-ops so
   the top-level handler registration below doesn't throw -- the real
   Electron runtime always provides the genuine objects. */
const _underElectron = _electron && typeof _electron === "object" && _electron.ipcMain;
const _noopIpc = { handle() {}, on() {} };
// whenReady() returns a never-resolving promise under the shim so the
// .then(createMainWindow) lifecycle hook never fires outside Electron.
const _noopApp = { whenReady() { return new Promise(() => {}); }, on() {}, quit() {} };
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = _underElectron
  ? _electron
  : { app: _noopApp, BrowserWindow: { getAllWindows: () => [] }, ipcMain: _noopIpc, dialog: {}, shell: {}, Menu: { setApplicationMenu() {} } };
const { runNormalize } = _underElectron ? require("./python-runner.js") : { runNormalize: async () => ({}) };
const AnnoStore = require("./annotations-store.js");
const NamesStore = require("./names-store.js");
const { resultFromRunnerError } = require("./normalize-result.js");

/* Contract C4: the remembered-names store, one per analyst machine, under the
   viewer's userData folder (an e2e run's throwaway profile gets its own). */
function namesStorePath() {
  return NamesStore.namesStorePath(app.getPath("userData"));
}

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
// process. The runNormalize() caller registers here via onProc
// so viewer:cancelNormalize can kill the one in flight.
let _normalizeHandle = null;

/* Set of session-folder roots the main process has loaded (resolved,
   absolute). The session folder is UNTRUSTED input, so renderer-supplied
   paths to open are validated against these known roots -- the renderer
   cannot be trusted to confine a path itself (nodeIntegration = full RCE
   on a renderer compromise). Populated by loadSessionData(). */
const _knownSessionRoots = new Set();

/* Image extensions the screenshot-open flow is allowed to launch. A
   captured `events.jsonl` could name `Invoice.png.exe` to ride the
   "open screenshot" click into arbitrary-program execution via Windows
   file association; only these resolve through shell.openPath(). */
const _ALLOWED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

/* Validate a renderer-supplied path before it reaches shell.openPath().
   Returns { ok: true, path } with the resolved absolute path when SAFE,
   or { ok: false, error } otherwise. Safe means: a non-empty string, no
   `..` traversal segment, resolves under one of the known session roots'
   `screenshots/` directory, and carries an allowed image extension.
   `roots` defaults to the live set; tests pass an explicit set. */
function validateScreenshotOpen(p, roots = _knownSessionRoots) {
  if (typeof p !== "string" || !p) return { ok: false, error: "Path must be a non-empty string." };
  // Reject explicit traversal segments outright (belt-and-braces; the
  // containment check below also catches escapes, but this is clearer
  // and rejects before any path math).
  const segments = p.split(/[\\/]+/);
  if (segments.some((s) => s === "..")) return { ok: false, error: "Path traversal is not allowed." };
  const resolved = path.resolve(p);
  const ext = path.extname(resolved).toLowerCase();
  if (!_ALLOWED_IMAGE_EXTS.has(ext)) return { ok: false, error: `Not an allowed image type: ${ext || "(none)"}` };
  for (const root of roots) {
    const shotsDir = path.resolve(root, "screenshots");
    const rel = path.relative(shotsDir, resolved);
    // rel must stay inside shotsDir: not empty, not starting with ".."
    // (escape), and not itself absolute (different drive on Windows).
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return { ok: true, path: resolved };
    }
  }
  return { ok: false, error: "Path is outside the active session's screenshots folder." };
}

/* Diagram files the "Open" affordance is allowed to launch. The mined maps are
   process_map.bpmn at the session root and process_maps/*.bpmn -- both under a
   known session root. Kept separate from the image sink so the screenshot
   guard never has to allow an executable-adjacent extension, and so the BPMN
   button stops misusing the image sink (which always refused .bpmn). */
const _ALLOWED_DIAGRAM_EXTS = new Set([".bpmn"]);

/* Validate a renderer-supplied diagram path before shell.openPath(). Returns
   { ok: true, path } when SAFE (non-empty string, no `..` segment, a .bpmn
   extension, resolves under a known session root), else { ok: false, error }.
   Mirrors validateScreenshotOpen but confines to the session ROOT (not the
   screenshots/ subdir) since maps live at the root and under process_maps/. */
function validateDiagramOpen(p, roots = _knownSessionRoots) {
  if (typeof p !== "string" || !p) return { ok: false, error: "Path must be a non-empty string." };
  const segments = p.split(/[\\/]+/);
  if (segments.some((s) => s === "..")) return { ok: false, error: "Path traversal is not allowed." };
  const resolved = path.resolve(p);
  const ext = path.extname(resolved).toLowerCase();
  if (!_ALLOWED_DIAGRAM_EXTS.has(ext)) return { ok: false, error: `Not an allowed diagram type: ${ext || "(none)"}` };
  for (const root of roots) {
    const base = path.resolve(root);
    const rel = path.relative(base, resolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return { ok: true, path: resolved };
    }
  }
  return { ok: false, error: "Path is outside the active session folder." };
}

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

ipcMain.handle("viewer:loadSession", (_e, sessionFolder) => {
  return loadSessionData(sessionFolder);
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

ipcMain.handle("viewer:saveSvgFile", async (_e, { content, suggestedName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Export process map as SVG",
    defaultPath: suggestedName || "process-map.svg",
    filters: [{ name: "SVG image", extensions: ["svg"] }],
  });
  if (r.canceled || !r.filePath) return null;
  try {
    fs.writeFileSync(r.filePath, content, "utf-8");
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("viewer:revealFile", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("viewer:openExternal", (_e, p) => {
  // SECURITY: `p` originates from untrusted session data (a screenshot
  // path in events.jsonl). Confine it to the active session's
  // screenshots/ dir and require an image extension before handing it to
  // the OS shell -- otherwise a planted `Invoice.png.exe` would launch
  // on a screenshot click. Defense lives here at the sink because the
  // renderer cannot be trusted (nodeIntegration).
  const v = validateScreenshotOpen(p);
  if (!v.ok) {
    console.warn("[viewer:openExternal] refused to open path:", v.error, JSON.stringify(p));
    return { ok: false, error: v.error };
  }
  return shell.openPath(v.path);
});

/* Open a mined diagram (.bpmn) through its OWN guarded sink. Returns a string
   error (or null on success) so the renderer can `toast("..." + err)` without
   the [object Object] the screenshot sink produced when it refused .bpmn. */
ipcMain.handle("viewer:openDiagram", async (_e, p) => {
  const v = validateDiagramOpen(p);
  if (!v.ok) {
    console.warn("[viewer:openDiagram] refused to open path:", v.error, JSON.stringify(p));
    return v.error;
  }
  const r = await shell.openPath(v.path);   // "" on success, else an error string
  return r || null;
});

/* --- Session loading ---------------------------------------------- */

function loadSessionData(sessionFolder) {
  /* Normalize and resolve to an absolute path so downstream file
     accesses are anchored to a known root. */
  const root = path.resolve(sessionFolder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Session folder not found: ${root}`);
  }
  sessionFolder = root;
  // Track this resolved root so viewer:openExternal can confine
  // renderer-supplied screenshot paths to a session we actually loaded.
  _knownSessionRoots.add(root);
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
  // RP-04: an annotations.json that exists but cannot be read is reported
  // (annotationsError, shown as a banner naming the file and its backups),
  // never treated as absent; the writers below refuse to replace it.
  const annoRead = AnnoStore.readAnnotationsFile(sessionFolder);
  const annotations = annoRead.status === "ok" ? annoRead.annotations : null;
  const annotationsError = AnnoStore.annotationsLoadError(annoRead, sessionFolder);
  if (annotationsError) console.warn("[viewer:loadSession] " + annotationsError.message);
  const obsSync = loadOptionalJson(path.join(sessionFolder, "obs", "sync.json"));
  const analysis = loadOptionalJson(path.join(sessionFolder, "analysis.json"));

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

  /* B5: when the session carries an integrity manifest, flag any files
     that did not survive the copy from the capture machine. */
  let integrity = null;
  const integrityPath = path.join(sessionFolder, "session-integrity.json");
  if (fs.existsSync(integrityPath)) {
    try {
      const declared = JSON.parse(fs.readFileSync(integrityPath, "utf-8")).files || [];
      const missing = declared
        .filter((f) => f && f.name && !fs.existsSync(path.join(sessionFolder, f.name)))
        .map((f) => f.name);
      integrity = { missing };
    } catch (_e) { /* malformed integrity file -- ignore */ }
  }

  return {
    sessionFolder,
    manifest,
    events,
    stats,
    dfg,
    analysis,
    annotations,
    annotationsError,
    obsSync,
    recordingPath,
    recordingAvailable,
    externalVideoOffsetMs,
    integrity,
  };
}

function loadOptionalJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (_e) { return null; }
}

/* I24: map a few common Python pipeline failures to plain-language
   guidance for the analyst. The original technical line is kept below
   the translation so an engineer can still read it. */
const PIPELINE_ERROR_TRANSLATIONS = [
  [/KeyError: ['"]timestamp['"]/, "Some events are missing timestamps: the capture may have been interrupted."],
  [/KeyError: ['"]case_ids['"]/, "Case assignment failed: check that Start/End markers are present in the session."],
  [/InductiveMiner|inductive_miner/, "Process-map mining ran into trouble: try adding noisy apps to the ignored list to cut complexity."],
  [/FileNotFoundError.*events\.jsonl/, "The events file is missing: was the session folder copied completely?"],
  [/yaml\.scanner\.ScannerError|yaml\.parser\.ParserError/, "A YAML file has a syntax error: check its indentation."],
  [/ModuleNotFoundError|ImportError/, "A Python package the pipeline needs is missing from the bundled runtime."],
];
function translatePipelineError(text) {
  if (!text) return text;
  for (const [pattern, message] of PIPELINE_ERROR_TRANSLATIONS) {
    if (pattern.test(text)) {
      return "ℹ " + message + "\n   Technical detail: " + text;
    }
  }
  return text;
}

/* Result contract for the renderer: { ok: true, ...runner result } on
   success; { ok: false, error } on failure, where `error` is the full sentence
   to show the analyst (for a non-zero normalize.py exit it carries the
   pipeline's "[normalize] ERROR:" line, see normalize-result.js), plus `code`
   (the exit code, or null) and `cancelled` when the analyst cancelled. */
ipcMain.handle("viewer:runNormalizeExtended", async (_e, opts) => {
  let root;
  try {
    root = path.resolve(opts.sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, code: null, error: "Analysis could not start: this is not a session folder (no manifest.json)." };
    }
    // RP-04: normalize.py rewrites annotations.json. Never launch it over an
    // unreadable one (the pipeline's own check is C13 exit code 2; this guard
    // also covers a pipeline that predates it).
    AnnoStore.assertWritable(root);
  } catch (e) {
    return { ok: false, code: e.code === "ANNOTATIONS_UNREADABLE" ? 2 : null,
      error: e.code === "ANNOTATIONS_UNREADABLE" ? "Analysis stopped, nothing was changed: " + e.message
        : "Analysis could not start: " + e.message };
  }
  // C4: every analysis the viewer runs drafts with the remembered names when
  // the store exists (a missing store simply means no names yet). Analyze,
  // the PDD export and the step-map export all re-draft, so all pass it.
  let namesPath = null;
  try {
    const p = namesStorePath();
    if (fs.existsSync(p)) namesPath = p;
  } catch (e) {
    console.warn("[viewer:runNormalizeExtended] the remembered names store could not be located: " + e.message);
  }
  try {
    const result = await runNormalize({
      sessionFolder: root,
      mine: !!opts.mine,
      pddOut: opts.pddOut || null,
      pddMapImage: opts.pddMapImage || null,
      pddTobeImage: opts.pddTobeImage || null,
      namesPath,
      onLog: (text) => mainWindow.webContents.send("viewer:normalizeLog", translatePipelineError(text)),
      onProc: (h) => { _normalizeHandle = h; },
    });
    _normalizeHandle = null;
    if (result && result.cancelled) {
      return { ok: false, cancelled: true, error: "Analysis cancelled by user." };
    }
    return { ok: true, ...result };
  } catch (e) {
    _normalizeHandle = null;
    return resultFromRunnerError(e);
  }
});

ipcMain.handle("viewer:cancelNormalize", () => {
  if (_normalizeHandle) {
    try { _normalizeHandle.kill(); } catch (_) {}
    return { ok: true };
  }
  return { ok: false, error: "No analysis in progress" };
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
     annotation state. A read-modify-write: RP-04 refuses it when the current
     file exists but cannot be read (it used to start from {} and replace the
     analyst's work), and writes through the same backup + atomic path as
     every other save. */
  try {
    const root = path.resolve(sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, error: "Not a session folder" };
    }
    const current = AnnoStore.assertWritable(root);
    const anno = current.status === "ok" ? current.annotations : {};
    anno.external_video = {
      path: videoPath,
      offset_ms: offsetMs || 0,
      attached_at: new Date().toISOString(),
    };
    AnnoStore.writeAnnotationsFile(root, anno);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* --- Annotations write-back --------------------------------------- */

/* H8 + RP-04: every save keeps five versions (annotations.json.2 newest to
   .5 oldest) by COPYING the current file, then writes the new content to a
   temp file and renames it over annotations.json, so a failed write leaves
   the previous file in place (annotations-store.js). Recovery is manual: the
   analyst copies a .N file back over annotations.json.

   Result contract: { ok: true, path, backupError } or { ok: false, code,
   error } (code "ANNOTATIONS_UNREADABLE" when the current file cannot be
   read and was therefore left untouched). Never throws across IPC, so the
   renderer always gets a readable reason (session.js surfaces it). */
ipcMain.handle("viewer:saveAnnotations", (_e, { sessionFolder, annotations }) => {
  /* Anchor the write to an absolute session folder; reject if the
     resolved path doesn't contain a manifest (i.e. is not actually a
     session folder). Prevents accidental writes to arbitrary paths
     via a manipulated IPC payload. */
  try {
    const root = path.resolve(String(sessionFolder || ""));
    if (!sessionFolder || !fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, code: null, error: "Refusing to write annotations: not a session folder." };
    }
    const r = AnnoStore.writeAnnotationsFile(root, annotations);
    if (r.backupError) console.warn("[viewer:saveAnnotations] saved, but the backup copy failed: " + r.backupError);
    return { ok: true, path: r.path, backupError: r.backupError };
  } catch (e) {
    console.error("[viewer:saveAnnotations] not saved:", e && e.message);
    return { ok: false, code: (e && e.code) || null, error: (e && e.message) || String(e) };
  }
});

/* --- Remembered names (C4) ---------------------------------------- */

/* The analyst renamed a step that carries a draft_key: remember the name for
   that key. Payload { draftKey, name }. Result { ok: true, path } or
   { ok: false, code, error, path }; never throws across IPC. The write is
   atomic and never replaces an unreadable store (names-store.js). */
ipcMain.handle("viewer:rememberStepName", (_e, payload) => {
  let p = null;
  try {
    p = namesStorePath();
    const { draftKey, name } = payload || {};
    const r = NamesStore.rememberName(p, draftKey, name);
    return { ok: true, path: r.path };
  } catch (e) {
    console.error("[viewer:rememberStepName] not remembered:", e && e.message);
    return { ok: false, code: (e && e.code) || null, error: (e && e.message) || String(e), path: p };
  }
});

/* The remembered names, for the name suggestions. Result
   { ok: true, path, status: "absent" | "ok", names } or
   { ok: false, path, error } (the store exists but cannot be read). */
ipcMain.handle("viewer:readRememberedNames", () => {
  let p = null;
  try {
    p = namesStorePath();
    const r = NamesStore.readNamesFile(p);
    if (r.status === "unreadable") return { ok: false, path: p, error: r.error };
    return { ok: true, path: p, status: r.status, names: r.names };
  } catch (e) {
    return { ok: false, path: p, error: (e && e.message) || String(e) };
  }
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

/* Exported for unit tests (the security helper is pure and validated in
   isolation). Importing this module under plain node is made safe by the
   Electron shim near the top. */
module.exports = { validateScreenshotOpen, validateDiagramOpen, _knownSessionRoots, loadSessionData };
