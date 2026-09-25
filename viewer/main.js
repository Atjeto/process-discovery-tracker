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
const { runTranscriptImport, transcriptImportResult } = require("./python-runner.js");
const AnnoStore = require("./annotations-store.js");
const TranscriptStore = require("./transcript-store.js");
const Library = require("./library.js");
const VideoPath = require("./video-path.js");
const AnalystFiles = require("./analyst-files.js");
const NewProject = require("./new-project.js");
const ProjectZip = require("./project-zip.js");
const ProjectFolder = require("./project-folder.js");
const HandoffZip = require("./handoff-zip.js");
const HandoffOpen = require("./handoff-open.js");
const { resultFromRunnerError } = require("./normalize-result.js");
const { clearStaged } = require("./staged-outputs.js");

/* Lane HV (contract C20): a hand-off zip opens read only, extracted under
   <userData>/handoffs (handoff-open.js), and so does a hand-off unzipped by
   hand (its PDD and Technical details beside the project folder). Each
   handler below that writes a project folder, or runs the analysis that
   rewrites one, refuses such a folder first, before any dialog and before
   the save state hears of a write. The renderer shows no editing control
   there; this is the sink that holds even when one slips through. */
function _userData() {
  return typeof app.getPath === "function" ? app.getPath("userData") : null;
}
const READ_ONLY_ERROR = "this is a hand-off opened read only: nothing in it can change.";
function _refuseReadOnly(sessionFolder) {
  const root = path.resolve(String(sessionFolder || ""));
  return sessionFolder && HandoffOpen.isReadOnlyProject(_userData(), root)
    ? { ok: false, code: "READ_ONLY", error: READ_ONLY_ERROR } : null;
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
// The session folder that run is analyzing (resolved), or null. The analysis
// starts by itself (on open, after Apps outside the process, inside the As-Is act and
// the PDD export), so a run can be under way while the analyst works: the
// pipeline reads annotations.json when it starts and replaces it when it
// drafts, so a save in between would be lost (or would overwrite the new
// drafts). The annotations writers below refuse while it lasts.
let _normalizeFolder = null;
const ANALYSIS_RUNNING_ERROR = "the steps and the map are being updated. Make the change again once the update is done.";
function _refuseWhileAnalyzing(root) {
  return _normalizeFolder !== null && _normalizeFolder === root
    ? { ok: false, code: "ANALYSIS_RUNNING", error: ANALYSIS_RUNNING_ERROR } : null;
}

/* The save state in the top bar (save-state.js). Each write of a project
   folder says when it starts and how it ended, on viewer:projectWrite:
   { folder, channel, phase: "start" }, then { folder, channel, phase: "end",
   ok, error, code }. channel: "annotations", "video", "transcript",
   "screenshot" or "attachment". A handler that asks for a file first starts
   its write once the file is chosen, so a cancelled dialog writes nothing and
   says nothing. The analysis and the exports report nothing. */
const NO_PROJECT = { code: "NO_PROJECT" };
function _projectWrite(sessionFolder, channel) {
  const folder = path.resolve(String(sessionFolder || ""));
  let started = false;
  const send = (msg) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("viewer:projectWrite", Object.assign({ folder, channel }, msg));
  };
  const w = {
    start() {
      if (!started) { started = true; send({ phase: "start" }); }
    },
    /* Report the handler's result and hand it back as it is. `err`: what
       failed, for its code (a file-system code such as EPERM, or NO_PROJECT). */
    end(result, err) {
      w.start();
      const ok = !!(result && result.ok);
      send({
        phase: "end", ok,
        error: ok ? null : String((result && result.error) || (err && err.message) || "no reason was given"),
        code: ok ? null : ((err && err.code) || (result && result.code) || null),
      });
      return result;
    },
  };
  return w;
}

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
    title: "Open project",
    properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

/* Lane HV: Open a hand-off (.zip). Windows' folder dialog, the one Open
   project shows, lists folders only, so a hand-off zip is picked here. */
ipcMain.handle("viewer:openHandoffDialog", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open a hand-off",
    properties: ["openFile"],
    filters: [{ name: "Hand-off zip", extensions: ["zip"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

/* A project folder, or (lane HV) a hand-off zip: extracted under
   <userData>/handoffs, or found where it was extracted before
   (handoff-open.js), and its project folder opened read only. The result
   then carries openedZip (the zip) and handoffReused. */
ipcMain.handle("viewer:loadSession", async (_e, sessionFolder) => {
  const chosen = String(sessionFolder || "");
  let isZip = false;
  try { isZip = /\.zip$/i.test(chosen) && fs.statSync(chosen).isFile(); } catch (_) { isZip = false; }
  if (!isZip) return loadSessionData(chosen);
  const opened = await HandoffOpen.openHandoffZip(chosen, _userData());
  return Object.assign(loadSessionData(opened.folder), { openedZip: path.resolve(chosen), handoffReused: opened.reused });
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

/* Export, Whole project (.zip): the open project's folder as one zip next to
   it, "<name>.zip" or "<name> (2).zip", ... (project-zip.js), to hand the
   project to someone. The renderer then shows it in its folder, like every
   export. Not while the project's analysis runs: the pipeline replaces files
   in the folder through temporary files, which a zip must not catch halfway.
   One zip of a project at a time. Result { ok: true, path, bytes, size,
   entries } or { ok: false, error } (a sentence). */
const _zipping = new Set();
ipcMain.handle("viewer:exportProjectZip", async (_e, { sessionFolder } = {}) => {
  const root = _sessionRoot(sessionFolder);
  if (!root || !_knownSessionRoots.has(root)) return { ok: false, error: "This is not an open project." };
  if (_refuseReadOnly(root)) return { ok: false, code: "READ_ONLY", error: "A hand-off opened read only is not zipped again: the zip you opened is its zip." };
  if (_normalizeFolder !== null && _normalizeFolder === root) {
    return { ok: false, error: "The steps and the map are being updated: make the zip once the update is done." };
  }
  if (_zipping.has(root)) return { ok: false, error: "A zip of this project is being made already." };
  _zipping.add(root);
  try {
    const r = await ProjectZip.zipProject(root);
    return { ok: true, path: r.zipPath, bytes: r.bytes, size: ProjectZip.humanSize(r.bytes), entries: r.entries };
  } catch (e) {
    console.error("[viewer:exportProjectZip] not made:", e && (e.stack || e.message));
    return { ok: false, error: ProjectZip.describeZipError(e) };
  } finally {
    _zipping.delete(root);
  }
});

/* Export, Hand off... (lane HV, contract C20): "<project> v<N>.zip" next to
   the project folder, holding the folder and, at its root, the PDD and the
   Technical details the renderer had the pipeline write for this version
   (handoff-zip.js). The version is recorded in annotations.json before
   (handoff-ui.js). Not while the project's analysis runs, one zip of a
   project at a time (with the Whole project zip), and never for a hand-off
   opened read only. Result { ok: true, path, bytes, size, entries } or
   { ok: false, error } (a sentence). */
ipcMain.handle("viewer:exportHandoffZip", async (_e, { sessionFolder, base, version, pdd, tech } = {}) => {
  const root = _sessionRoot(sessionFolder);
  if (!root || !_knownSessionRoots.has(root)) return { ok: false, error: "This is not an open project." };
  const ro = _refuseReadOnly(root);
  if (ro) return ro;
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "The version number is missing." };
  for (const f of [pdd, tech]) {
    if (typeof f !== "string" || !fs.existsSync(f)) return { ok: false, error: "The PDD or the Technical details were not written." };
  }
  if (_normalizeFolder !== null && _normalizeFolder === root) {
    return { ok: false, error: "The steps and the map are being updated: hand off once the update is done." };
  }
  if (_zipping.has(root)) return { ok: false, error: "A zip of this project is being made already." };
  _zipping.add(root);
  try {
    const r = await HandoffZip.writeHandoffZip(root, { base: String(base || ""), version, pdd, tech });
    return { ok: true, path: r.zipPath, bytes: r.bytes, size: ProjectZip.humanSize(r.bytes), entries: r.entries };
  } catch (e) {
    console.error("[viewer:exportHandoffZip] not made:", e && (e.stack || e.message));
    return { ok: false, error: ProjectZip.describeZipError(e) };
  } finally {
    _zipping.delete(root);
  }
});

/* Lane HV: the PDD or the Technical details (kind "pdd" or "tech") a
   hand-off opened read only came with, opened in its program (Word, Excel).
   Result { ok: true, path } or { ok: false, error }. */
ipcMain.handle("viewer:openHandoffFile", async (_e, { sessionFolder, kind } = {}) => {
  const root = _sessionRoot(sessionFolder);
  if (!root || !_knownSessionRoots.has(root) || !_refuseReadOnly(root)) return { ok: false, error: "this is not a hand-off opened read only." };
  const file = HandoffOpen.handoffFile(root, kind);
  if (!file) return { ok: false, error: "the hand-off came without that file." };
  const err = await shell.openPath(file);
  return err ? { ok: false, error: err } : { ok: true, path: file };
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

/* --- Session loading ---------------------------------------------- */

function loadSessionData(sessionFolder) {
  /* Normalize and resolve to an absolute path so downstream file
     accesses are anchored to a known root. Lane FX2 (validation pass 3,
     F7): the folder Windows' Extract All makes of the SME's zip holds the
     recording folder; that one opens (project-folder.js). A folder that is
     no project and holds none is refused with a sentence saying what to
     open. The session's sessionFolder is the folder that opened. */
  const root = ProjectFolder.resolveProjectFolder(sessionFolder).folder;
  sessionFolder = root;
  // Track this resolved root so viewer:openExternal can confine
  // renderer-supplied screenshot paths to a session we actually loaded.
  _knownSessionRoots.add(root);
  const manifestPath = path.join(sessionFolder, "manifest.json");
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
  // Lane HV: a hand-off opened read only (under <userData>/handoffs, or
  // unzipped by hand).
  const readOnly = HandoffOpen.isReadOnlyProject(_userData(), root);
  // C21: the activity library the project reads, its own library.json once
  // its first analysis made it, else the app's ({ source, status, path,
  // library, error }; a missing or invalid file is an empty library).
  const library = Library.projectLibrary(root);
  if (library.status === "invalid") console.warn("[viewer:loadSession] the library " + library.path + " is not used: " + library.error);
  // RP-04: an annotations.json that exists but cannot be read is reported
  // (annotationsError, shown as a banner naming the file and its backups),
  // never treated as absent; the writers below refuse to replace it.
  const annoRead = AnnoStore.readAnnotationsFile(sessionFolder);
  const annotations = annoRead.status === "ok" ? annoRead.annotations : null;
  const annotationsError = AnnoStore.annotationsLoadError(annoRead, sessionFolder);
  if (annotationsError) console.warn("[viewer:loadSession] " + annotationsError.message);
  const obsSync = loadOptionalJson(path.join(sessionFolder, "obs", "sync.json"));
  const analysis = loadOptionalJson(path.join(sessionFolder, "analysis.json"));
  // C8: the parsed meeting transcript, or null. A file that exists but cannot
  // be used is reported in one line (transcriptError) and otherwise ignored.
  const transcriptRead = TranscriptStore.readTranscriptFile(sessionFolder);
  const transcript = transcriptRead.status === "ok" ? transcriptRead.transcript : null;
  const transcriptError = transcriptRead.status === "unreadable" ? transcriptRead.error : null;
  if (transcriptError) console.warn("[viewer:loadSession] transcript.json not used: " + transcriptError);

  /* Locate the recording. Priority: an analyst-attached external video
     (annotations.external_video, set via the Attach video flow for
     Teams recordings etc.) wins over the manifest's OBS path. The OBS
     path is the auto-captured default. V2 item 5: the stored path is
     relative to the folder when the video travels in it; an absolute one
     still works, and a missing one falls back to a file of its name in the
     folder (video-path.js). */
  let recordingPath = manifest.obs && manifest.obs.recording_path;
  let externalVideoOffsetMs = null;
  if (annotations && annotations.external_video && annotations.external_video.path) {
    const ext = annotations.external_video;
    const found = VideoPath.resolveStored(sessionFolder, ext.path, fs.existsSync);
    if (found) {
      recordingPath = found;
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
    analysis,
    annotations,
    annotationsError,
    obsSync,
    recordingPath,
    recordingAvailable,
    externalVideoOffsetMs,
    integrity,
    transcript,
    transcriptError,
    readOnly,
    library,
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
  [/KeyError: ['"]case_ids['"]/, "The transactions could not be found: check that the recording has its Start and End markers."],
  [/InductiveMiner|inductive_miner/, "Process-map mining ran into trouble: try putting noisy apps among the Apps outside the process (the Steps toolbar) to cut complexity."],
  [/FileNotFoundError.*events\.jsonl/, "The events file is missing: was the project folder copied completely?"],
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

/* One analysis at a time per viewer: while it runs, _normalizeFolder names its
   session folder (the annotations writers refuse to write there, see above).
   Result contract for the renderer: { ok: true, ...runner result } on
   success; { ok: false, error } on failure, where `error` is the full sentence
   to show the analyst (for a non-zero normalize.py exit it carries the
   pipeline's "[normalize] ERROR:" line, see normalize-result.js), plus `code`
   (the exit code, or null) and `cancelled` when the analyst cancelled. */
ipcMain.handle("viewer:runNormalizeExtended", async (_e, opts) => {
  let root;
  try {
    root = path.resolve(opts.sessionFolder);
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      return { ok: false, code: null, error: "Analysis could not start: this is not a project folder (no manifest.json)." };
    }
    // Lane HV: the analysis rewrites the project's outputs; a hand-off opened
    // read only keeps the ones it came with.
    if (_refuseReadOnly(root)) return { ok: false, code: null, error: "Analysis does not run here: " + READ_ONLY_ERROR };
    // RP-04: normalize.py rewrites annotations.json. Never launch it over an
    // unreadable one (the pipeline's own check is C13 exit code 2; this guard
    // also covers a pipeline that predates it).
    AnnoStore.assertWritable(root);
  } catch (e) {
    return { ok: false, code: e.code === "ANNOTATIONS_UNREADABLE" ? 2 : null,
      error: e.code === "ANNOTATIONS_UNREADABLE" ? "Analysis stopped, nothing was changed: " + e.message
        : "Analysis could not start: " + e.message };
  }
  // C21: every analysis gets the app's activity library when there is one;
  // the first analysis of a project copies it into the project folder, and
  // from then on the pipeline reads the project's copy.
  const appLibrary = Library.appLibraryPath();
  const libraryPath = fs.existsSync(appLibrary) ? appLibrary : null;
  _normalizeFolder = root;
  try {
    const result = await runNormalize({
      sessionFolder: root,
      mine: !!opts.mine,
      pddOut: opts.pddOut || null,
      pddMapImage: opts.pddMapImage || null,
      pddTobeImage: opts.pddTobeImage || null,
      // C19: the manifest of the sub-processes' map pictures.
      pddMapImages: opts.pddMapImages || null,
      // C20: the Technical details workbook, and the hand-off version both
      // documents are made for.
      techOut: opts.techOut || null,
      handoff: Number.isInteger(opts.handoff) && opts.handoff >= 1 ? opts.handoff : null,
      libraryPath,
      onLog: (text) => mainWindow.webContents.send("viewer:normalizeLog", translatePipelineError(text)),
      onProc: (h) => { _normalizeHandle = h; },
    });
    if (result && result.cancelled) {
      // Lane FX1: the killed run moved nothing into the project (normalize.py
      // does that as its very last act), so its outputs are as they were;
      // what it staged goes too, and the project is exactly as before.
      clearStaged(root);
      return { ok: false, cancelled: true, error: "Analysis cancelled by user." };
    }
    return { ok: true, ...result };
  } catch (e) {
    // A run stopped from outside (a signal) leaves its staged files as a
    // cancelled one does; a run that failed removed its own.
    if (e && e.signal) clearStaged(root);
    return resultFromRunnerError(e);
  } finally {
    _normalizeHandle = null;
    _normalizeFolder = null;
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
ipcMain.handle("viewer:attachExternalVideo", async (_e, { sessionFolder } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Attach external video",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "webm", "mov", "avi"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0] };
});

ipcMain.handle("viewer:copyVideoIn", async (_e, { sessionFolder, videoPath } = {}) => {
  /* Attach, Replace and Sync video (lane CC): the video the project is to
     play, kept in the folder. V2 item 5: a video outside the folder is copied
     into its video/ folder and stored relative to the folder, so the folder
     carries it; when the copy fails, the absolute path is stored and the
     result says why (copyError). The renderer then writes
     annotations.external_video as one undoable edit (flow-view-video.js), so
     Undo takes an attach, a replace or a sync back, and the save moves a
     replaced copy out of video/ for that Undo (analyst-files.js). Refused
     before anything is copied while annotations.json cannot be read (RP-04),
     and (lane FX2) while the project's analysis runs, which would refuse the
     entry's save and leave the copy in video/ unlisted.
     Result { ok, stored, copied, copyError } or { ok: false, error }. */
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "video");
  w.start();
  try {
    const root = path.resolve(String(sessionFolder || ""));
    if (!sessionFolder || !fs.existsSync(path.join(root, "manifest.json"))) {
      return w.end({ ok: false, error: "Not a project folder" }, NO_PROJECT);
    }
    const busy = _refuseWhileAnalyzing(root);
    if (busy) return w.end(busy);
    AnnoStore.assertWritable(root);
    const plan = VideoPath.storePlan(root, videoPath, {
      exists: fs.existsSync,
      size: (p) => { try { return fs.statSync(p).size; } catch (_) { return null; } },
    });
    let stored = plan.stored, copyError = null;
    if (plan.copyTo) {
      try {
        await fs.promises.mkdir(path.dirname(plan.copyTo), { recursive: true });
        await fs.promises.copyFile(videoPath, plan.copyTo);
      } catch (e) {
        copyError = (e && e.message) || String(e);
        stored = path.resolve(videoPath);
        try { fs.unlinkSync(plan.copyTo); } catch (_) { /* nothing was written */ }
      }
    }
    return w.end({ ok: true, stored, copied: !!plan.copyTo && !copyError, copyError });
  } catch (e) {
    return w.end({ ok: false, error: e.message }, e);
  }
});

/* --- Meeting transcript (C8) --------------------------------------- */

/* The resolved session folder, or null when the path is not one (no
   manifest.json): the transcript writers never act outside a session. */
function _sessionRoot(sessionFolder) {
  const root = path.resolve(String(sessionFolder || ""));
  return sessionFolder && fs.existsSync(path.join(root, "manifest.json")) ? root : null;
}

/* Attach or replace the transcript: an open dialog, then transcript_import.py
   on the chosen file (the Python normalize.py uses). Result null (cancelled),
   { ok: true, summary }, or { ok: false, code, error } (error: the script's
   reason; exit 2 and 3 leave the previous transcript in place). */
ipcMain.handle("viewer:importTranscript", async (_e, { sessionFolder } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "transcript");
  const root = _sessionRoot(sessionFolder);
  if (!root) return w.end({ ok: false, code: null, error: "this is not a project folder." }, NO_PROJECT);
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Attach transcript",
    properties: ["openFile"],
    filters: [{ name: "Teams transcript", extensions: ["vtt", "docx"] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  w.start();
  try {
    return w.end(transcriptImportResult(await runTranscriptImport({ sessionFolder: root, file: r.filePaths[0] })));
  } catch (e) {
    return w.end({ ok: false, code: null, error: (e && e.message) || String(e) }, e);
  }
});

/* Remove transcript (lane CC): transcript.json and the originals under
   transcript/ leave the folder together, parked for an Undo (the holding
   folder of removed files, analyst-files.js parkFiles). Result { ok: true,
   removed, tag, files } (tag and files: what restoreTranscript puts back) or
   { ok: false, error }. */
ipcMain.handle("viewer:removeTranscript", (_e, { sessionFolder } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "transcript");
  w.start();
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    const files = TranscriptStore.transcriptFiles(root);
    const tag = "transcript-" + Date.now() + "-" + require("node:crypto").randomBytes(3).toString("hex");
    const r = AnalystFiles.parkFiles(root, files, _holdDir(root), tag);
    if (r.errors.length) {
      // Put back what moved: a removal is whole or not at all.
      AnalystFiles.restoreParked(root, r.parked, _holdDir(root), tag);
      return w.end({ ok: false, error: "the transcript's files could not be moved: " + r.errors.join("; ") });
    }
    return w.end({ ok: true, removed: r.parked.includes(TranscriptStore.FILE), tag, files: r.parked });
  } catch (e) {
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* Undo of Remove transcript: the files parked under `tag` come back (a file
   of the same name attached since is kept). Result { ok: true, restored,
   kept } or { ok: false, error }. */
ipcMain.handle("viewer:restoreTranscript", (_e, { sessionFolder, tag, files } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "transcript");
  w.start();
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    const r = AnalystFiles.restoreParked(root, Array.isArray(files) ? files : [], _holdDir(root), String(tag || ""));
    if (r.errors.length) return w.end({ ok: false, error: "the transcript's files could not be put back: " + r.errors.join("; ") });
    return w.end({ ok: true, restored: r.restored, kept: r.kept });
  } catch (e) {
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* Sync: rewrites transcript.json's offset_ms (atomically) and nothing else.
   Result { ok: true } or { ok: false, error }. */
ipcMain.handle("viewer:saveTranscriptSync", (_e, { sessionFolder, offsetMs } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "transcript");
  w.start();
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    TranscriptStore.saveTranscriptOffset(root, offsetMs);
    return w.end({ ok: true });
  } catch (e) {
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* --- Projects without a recording, and what the analyst adds (C16) --- */

const VIDEO_FILTER = [{ name: "Video", extensions: ["mp4", "mkv", "webm", "mov", "avi"] }];

/* Where removed screenshots and attachments of one session wait for an Undo
   (outside the folder; emptied when the viewer starts). */
function _holdDir(root) {
  const key = require("node:crypto").createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 16);
  return path.join(app.getPath("userData"), "pdt-removed", key);
}

/* The project chosen by the last chooseNewProject, made by createProject. */
let _newProjectPlan = null;

/* New project from a video / New empty project: the video (for a video
   project), then one save dialog for the project's name and where its folder
   goes (default: a folder named after the video next to it, or in the
   user's Documents). Result null (cancelled), { ok: true, name, folder } or
   { ok: false, error }. Nothing is made until createProject. */
ipcMain.handle("viewer:chooseNewProject", async (_e, { kind } = {}) => {
  _newProjectPlan = null;
  const video = kind === "video";
  let videoPath = null;
  if (video) {
    const r = await dialog.showOpenDialog(mainWindow, { title: "New project from a video: choose the video", properties: ["openFile"], filters: VIDEO_FILTER });
    if (r.canceled || !r.filePaths.length) return null;
    videoPath = r.filePaths[0];
  }
  const base = video ? path.dirname(videoPath) : app.getPath("documents");
  const s = await dialog.showSaveDialog(mainWindow, {
    title: "Name the project: its folder is made here",
    defaultPath: path.join(base, video ? path.parse(videoPath).name : "New process"),
    buttonLabel: "Create",
  });
  if (s.canceled || !s.filePath) return null;
  const folder = path.resolve(s.filePath);
  const why = NewProject.folderProblem(folder);
  if (why) return { ok: false, error: why + " (" + folder + ")." };
  _newProjectPlan = { kind: video ? "video" : "blank", videoPath, folder, name: path.basename(folder) };
  return { ok: true, name: _newProjectPlan.name, folder };
});

/* Make the project chosen last (the renderer passes no path). Result
   { ok: true, folder } or { ok: false, error }. */
ipcMain.handle("viewer:createProject", async () => {
  const plan = _newProjectPlan;
  _newProjectPlan = null;
  if (!plan) return { ok: false, error: "no project was chosen." };
  try {
    const r = await NewProject.createProject(Object.assign({ id: require("node:crypto").randomUUID(), now: new Date().toISOString() }, plan));
    return { ok: true, folder: r.folder };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

/* Add a screenshot to the session: source "file" (a PNG or JPEG chosen
   here), or "video_frame" / "paste" with `data` (the image, base64). It is
   written as screenshots/analyst/<id>.<png|jpg>. Result null (cancelled),
   { ok: true, id, file } or { ok: false, error }. The renderer then adds the
   analyst_screenshots entry (an undoable edit). Lane FX2: refused before
   anything is asked or written while the project's analysis runs (the
   entry's save would be refused, and the file left in the folder unlisted). */
ipcMain.handle("viewer:addScreenshot", async (_e, { sessionFolder, source, data } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "screenshot");
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    const busy = _refuseWhileAnalyzing(root);
    if (busy) return w.end(busy);
    let buf;
    if (source === "file") {
      const r = await dialog.showOpenDialog(mainWindow, { title: "Add a screenshot", properties: ["openFile"],
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }] });
      if (r.canceled || !r.filePaths.length) return null;
      w.start();
      buf = fs.readFileSync(r.filePaths[0]);
    } else if (source === "video_frame" || source === "paste") {
      w.start();
      buf = Buffer.from(String(data || ""), "base64");
    } else {
      return w.end({ ok: false, error: "unknown screenshot source." });
    }
    const id = require("node:crypto").randomUUID();
    const shot = AnalystFiles.writeScreenshot(root, id, buf);
    return w.end({ ok: true, id, file: shot.file });
  } catch (e) {
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* Attach a file: an open dialog, then a copy into attachments/ (a numeric
   suffix when the name is taken). Result null (cancelled), { ok: true, file,
   label } (label: the original file name) or { ok: false, error }. Lane
   FX2: refused before the dialog while the project's analysis runs. */
ipcMain.handle("viewer:addAttachment", async (_e, { sessionFolder } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "attachment");
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    const busy = _refuseWhileAnalyzing(root);
    if (busy) return w.end(busy);
    const r = await dialog.showOpenDialog(mainWindow, { title: "Attach a file", properties: ["openFile"] });
    if (r.canceled || !r.filePaths.length) return null;
    w.start();
    const c = AnalystFiles.copyAttachment(root, r.filePaths[0]);
    return w.end({ ok: true, file: c.file, label: path.basename(r.filePaths[0]) });
  } catch (e) {
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* Open an attachment of a loaded session: a document, image or mail opens in
   its program; any other type is shown in its folder. Result { ok, shown }
   or { ok: false, error }. */
ipcMain.handle("viewer:openAttachment", async (_e, { sessionFolder, file } = {}) => {
  const root = _sessionRoot(sessionFolder);
  if (!root || !_knownSessionRoots.has(root)) return { ok: false, error: "this is not an open project." };
  const t = AnalystFiles.attachmentTarget(root, file, fs.existsSync);
  if (!t.ok) return t;
  if (!t.open) { shell.showItemInFolder(t.path); return { ok: true, shown: true }; }
  const err = await shell.openPath(t.path);
  return err ? { ok: false, error: err } : { ok: true, shown: false };
});

/* --- Annotations write-back --------------------------------------- */

/* H8 + RP-04: every save keeps five versions (annotations.json.2 newest to
   .5 oldest) by COPYING the current file, then writes the new content to a
   temp file and renames it over annotations.json, so a failed write leaves
   the previous file in place (annotations-store.js). An unreadable file is
   recovered from the banner: Restore the newest backup
   (viewer:restoreAnnotationsBackup, below).

   Result contract: { ok: true, path, backupError } or { ok: false, code,
   error } (code "ANNOTATIONS_UNREADABLE" when the current file cannot be
   read and was therefore left untouched). Never throws across IPC, so the
   renderer always gets a readable reason (session.js surfaces it). */
ipcMain.handle("viewer:saveAnnotations", (_e, { sessionFolder, annotations }) => {
  /* Anchor the write to an absolute session folder; reject if the
     resolved path doesn't contain a manifest (i.e. is not actually a
     session folder). Prevents accidental writes to arbitrary paths
     via a manipulated IPC payload. Lane HV: never in a hand-off opened
     read only. */
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "annotations");
  w.start();
  try {
    const root = path.resolve(String(sessionFolder || ""));
    if (!sessionFolder || !fs.existsSync(path.join(root, "manifest.json"))) {
      return w.end({ ok: false, code: null, error: "Refusing to write annotations: not a project folder." }, NO_PROJECT);
    }
    const busy = _refuseWhileAnalyzing(root);
    if (busy) return w.end(busy);
    const before = AnnoStore.readAnnotationsFile(root);
    const r = AnnoStore.writeAnnotationsFile(root, annotations);
    if (r.backupError) console.warn("[viewer:saveAnnotations] saved, but the backup copy failed: " + r.backupError);
    // C16: a screenshot or attachment the analyst removed leaves the folder;
    // Undo (a save that names it again) brings it back (analyst-files.js).
    // A file that could not be moved (open in another program, no room) is
    // reported with the save (filesError), which the renderer shows.
    let filesError = null;
    if (before.status === "ok") {
      const moved = AnalystFiles.moveRemoved(root, AnalystFiles.namedFiles(before.annotations),
        AnalystFiles.namedFiles(annotations), _holdDir(root));
      if (moved.errors.length) {
        filesError = moved.errors.join("; ");
        console.warn("[viewer:saveAnnotations] files not moved: " + filesError);
      }
    }
    return w.end({ ok: true, path: r.path, backupError: r.backupError, filesError });
  } catch (e) {
    console.error("[viewer:saveAnnotations] not saved:", e && e.message);
    return w.end({ ok: false, code: (e && e.code) || null, error: (e && e.message) || String(e) }, e);
  }
});

/* The unreadable banner's Restore the newest backup (RP-04, lane CC): the
   unreadable annotations.json is kept beside it as
   annotations.unreadable-<time>.json and the newest backup that can be read
   is copied into place (annotations-store.js restoreNewestBackup). `expect`
   is the backup the analyst confirmed; another newest backup refuses. Not
   while the project's analysis runs. Result { ok: true, backup, mtimeMs,
   keptAs } or { ok: false, error } (a sentence). */
ipcMain.handle("viewer:restoreAnnotationsBackup", (_e, { sessionFolder, expect } = {}) => {
  const ro = _refuseReadOnly(sessionFolder);
  if (ro) return ro;
  const w = _projectWrite(sessionFolder, "annotations");
  w.start();
  try {
    const root = _sessionRoot(sessionFolder);
    if (!root) return w.end({ ok: false, error: "this is not a project folder." }, NO_PROJECT);
    const busy = _refuseWhileAnalyzing(root);
    if (busy) return w.end(busy);
    const r = AnnoStore.restoreNewestBackup(root, { expect: typeof expect === "string" ? expect : null });
    // Lane FX3 (validation pass 3, F27): a file attached after that backup is
    // still in attachments/, named by no entry: it is listed again on the
    // project (the safe way: shown, removable, never deleted unseen). A
    // screenshot added since is only counted: it belongs to no step now.
    let listed = [], screenshots = [];
    try {
      const read = AnnoStore.readAnnotationsFile(root);
      if (read.status === "ok") {
        const left = AnalystFiles.unlistedFiles(root, read.annotations);
        screenshots = left.screenshots;
        if (left.attachments.length) {
          AnalystFiles.relistAttachments(read.annotations, left.attachments,
            { newId: () => require("node:crypto").randomUUID(), nowIso: new Date().toISOString() });
          AnnoStore.writeAnnotationsFile(root, read.annotations);
          listed = left.attachments;
        }
      }
    } catch (e) {
      console.error("[viewer:restoreAnnotationsBackup] the files added since the backup were not listed:", e && e.message);
    }
    return w.end({ ok: true, backup: r.backup, mtimeMs: r.mtimeMs, keptAs: r.keptAs, listed, screenshots });
  } catch (e) {
    console.error("[viewer:restoreAnnotationsBackup] not restored:", e && e.message);
    return w.end({ ok: false, error: (e && e.message) || String(e) }, e);
  }
});

/* --- The activity library (contract C21) ------------------------------ */

/* The app's library, read: { status, path, library, error } (library.js
   readLibraryFile; a missing or invalid file reads as an empty library). */
ipcMain.handle("viewer:readAppLibrary", () => Library.readLibraryFile(Library.appLibraryPath()));

/* One project for the Library builder: its manifest.json and annotations.json
   and nothing else. A project without annotations.json has no named step. */
function _libraryProjectFolder(dir) {
  const folder = ProjectFolder.resolveProjectFolder(dir).folder;
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8").replace(/^﻿/, ""));
  const read = AnnoStore.readAnnotationsFile(folder);
  if (read.status === "unreadable") throw new Error("its annotations.json cannot be read (" + read.error + ")");
  return { path: folder, manifest, annotations: read.status === "ok" ? read.annotations : { steps: [] } };
}

/* The builder's sources from the paths picked, each read by `readOne`:
   { sources: [{ path, sessionId, manifest, annotations }], failed:
   [{ path, error }] }. */
async function _librarySources(paths, readOne) {
  const sources = [], failed = [];
  for (const p of paths) {
    try {
      const src = await readOne(p);
      sources.push(Object.assign(src, { sessionId: (src.manifest && src.manifest.session_id) || null }));
    } catch (e) {
      failed.push({ path: p, error: (e && e.message) || String(e) });
    }
  }
  return { sources, failed };
}

/* Help, Build the library...: Add projects... Result as _librarySources, or
   null when the dialog was cancelled. */
ipcMain.handle("viewer:libraryAddProjects", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Add projects to the library",
    properties: ["openDirectory", "multiSelections"],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
  return _librarySources(r.filePaths, _libraryProjectFolder);
});

/* Add hand-off zips...: each zip read where it is, never extracted
   (handoff-open.js readProjectZip). */
ipcMain.handle("viewer:libraryAddZips", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Add hand-off zips to the library",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Hand-off (.zip)", extensions: ["zip"] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
  return _librarySources(r.filePaths, async (zip) => {
    const got = await HandoffOpen.readProjectZip(zip);
    return { path: zip, manifest: got.manifest, annotations: got.annotations || { steps: [] } };
  });
});

/* Save library...: the library the builder made (payload { library }),
   checked, then written where the owner says, the app's own library file by
   default, so he can replace it. Written whole or not at all (a temporary
   file renamed). Result { ok: true, path }, { ok: false, cancelled: true },
   or { ok: false, error }. */
ipcMain.handle("viewer:saveLibrary", async (_e, payload) => {
  const doc = payload && payload.library;
  const bad = Library.problems(doc);
  if (bad.length) return { ok: false, error: "The library was not saved: " + bad[0] + "." };
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Save the library",
    defaultPath: Library.appLibraryPath(),
    filters: [{ name: "Library (.json)", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  const file = path.resolve(r.filePath);
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + "." + process.pid + ".tmp");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf-8");
    AnnoStore.renameWithRetry(fs, tmp, file);
    return { ok: true, path: file };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nothing was left */ }
    return { ok: false, error: "The library was not saved: " + ((e && e.message) || String(e)) };
  }
});

/* --- App lifecycle ----------------------------------------------- */

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Removed screenshots and attachments waited there for an Undo of the
  // last run; its undo history is gone (C16, analyst-files.js).
  try { fs.rmSync(path.join(app.getPath("userData"), "pdt-removed"), { recursive: true, force: true }); }
  catch (e) { console.warn("[viewer] the removed files of the last run were not cleared: " + e.message); }
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
module.exports = { validateScreenshotOpen, _knownSessionRoots, loadSessionData, READ_ONLY_ERROR };
