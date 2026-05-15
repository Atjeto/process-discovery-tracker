/*
 * Project / engagement layer.
 *
 * A project bundles the things an analyst is currently working on across
 * the four viewer tabs into a single saveable file:
 *   - the loaded aggregate session set
 *   - the current focus session
 *   - the active process template
 *   - the set of opened app vocabularies
 *   - the current tab + view-mode + case scope
 *
 * Renderer.js owns the live state; this module knows how to snapshot it,
 * persist it, and restore it. Collector callbacks keep this module
 * decoupled from renderer.js's specific variable names so the layout
 * can evolve without churn here.
 *
 * File format: JSON, single-file, suffixed `.pdt-project.json`. The
 * format / version pair lets us migrate or reject old shapes cleanly
 * if we ever need to.
 *
 * No-users-yet means we don't preserve any prior storage shape -- the
 * old `pdt.recentSessions` localStorage key is left untouched (still
 * used by the standalone-session flow), and `pdt.recentProjects` lives
 * alongside it as a parallel list.
 */

"use strict";

const path = require("node:path");

const PROJECT_FORMAT = "pdt-project";
const PROJECT_VERSION = 1;
const PROJECT_FILE_EXT = ".pdt-project.json";
const RECENT_PROJECTS_KEY = "pdt.recentProjects";
const RECENT_PROJECTS_MAX = 8;

let _activeProject = null;

function activeProject() { return _activeProject; }

function setActiveProject(p) {
  _activeProject = p;
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("pdt:projectChanged", { detail: p }));
  }
}

function newProjectShape(name) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    name: name || "Untitled project",
    aggregateSessions: [],
    currentSessionFolder: null,
    templatePath: null,
    vocabularies: [],
    currentTab: "session",
    viewMode: "flow",
    currentCaseScope: null,
    timeline: { zoomFactor: 1, scrollLeft: 0 },
    sessionTimelines: {},
  };
}

/* Capture current renderer state into a serializable project blob.
   Each collector is an optional function; missing collectors leave the
   default shape in place. Defensive against thrown collector errors so
   one broken collector doesn't tank the whole save. */
function captureFromCollectors(collectors, opts) {
  const proj = newProjectShape((opts && opts.name) || (_activeProject && _activeProject.name));
  proj.savedAt = new Date().toISOString();

  function safe(name, dflt) {
    if (!collectors || typeof collectors[name] !== "function") return dflt;
    try { const v = collectors[name](); return v == null ? dflt : v; }
    catch (_) { return dflt; }
  }

  proj.currentSessionFolder = safe("currentSessionFolder", null);
  proj.aggregateSessions    = safe("aggregateSessions", []);
  proj.templatePath         = safe("templatePath", null);
  proj.vocabularies         = safe("vocabularies", []);
  proj.currentTab           = safe("currentTab", "session");
  proj.viewMode             = safe("viewMode", "flow");
  proj.currentCaseScope     = safe("currentCaseScope", null);
  proj.timeline             = safe("timeline", { zoomFactor: 1, scrollLeft: 0 });
  proj.sessionTimelines     = safe("sessionTimelines", {});
  return proj;
}

/* Validate a parsed project file. Returns { ok: true, project } or
   { ok: false, error }. Rejects unknown formats / future versions so
   we don't silently misload. */
function validateProject(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Empty or non-object project file" };
  if (raw.format !== PROJECT_FORMAT) {
    return { ok: false, error: "Not a Process Discovery project file (format=" + raw.format + ")" };
  }
  if (typeof raw.version !== "number" || raw.version > PROJECT_VERSION) {
    return { ok: false, error: "Project file version " + raw.version + " is newer than supported (max=" + PROJECT_VERSION + ")" };
  }
  // Backfill the shape so callers can read any field without guarding.
  const def = newProjectShape(raw.name || "Untitled project");
  const project = Object.assign({}, def, raw);
  if (!Array.isArray(project.aggregateSessions)) project.aggregateSessions = [];
  if (!Array.isArray(project.vocabularies)) project.vocabularies = [];
  if (!project.timeline || typeof project.timeline !== "object") {
    project.timeline = { zoomFactor: 1, scrollLeft: 0 };
  }
  if (!project.sessionTimelines || typeof project.sessionTimelines !== "object") {
    project.sessionTimelines = {};
  }
  return { ok: true, project };
}

/* Serialize for write. Pretty-print so analysts can diff project files
   in version control if they ever choose to. */
function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

/* ===== Recent projects (localStorage) ===== */

function getRecentProjects() {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    return raw ? (JSON.parse(raw) || []) : [];
  } catch (_) { return []; }
}
function setRecentProjects(list) {
  try { localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list)); }
  catch (_) {}
}
function pushRecentProject(filePath, name) {
  if (!filePath) return;
  let list = getRecentProjects().filter((r) => r.path !== filePath);
  list.unshift({
    path: filePath,
    name: name || path.basename(filePath, PROJECT_FILE_EXT),
    ts: Date.now(),
  });
  list = list.slice(0, RECENT_PROJECTS_MAX);
  setRecentProjects(list);
}
function removeRecentProject(filePath) {
  setRecentProjects(getRecentProjects().filter((r) => r.path !== filePath));
}
function clearRecentProjects() {
  setRecentProjects([]);
}

module.exports = {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  PROJECT_FILE_EXT,
  RECENT_PROJECTS_KEY,
  RECENT_PROJECTS_MAX,
  newProjectShape,
  captureFromCollectors,
  validateProject,
  serializeProject,
  activeProject,
  setActiveProject,
  getRecentProjects,
  setRecentProjects,
  pushRecentProject,
  removeRecentProject,
  clearRecentProjects,
};
