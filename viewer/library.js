"use strict";

/*
 * library.js: the activity library (contract C21), the viewer's half.
 *
 * The app's library is one file: library/activities.json at the repo root,
 * resources/library/activities.json in the package (build-package.js ships
 * the library/ folder), or the file the environment variable PDT_LIBRARY
 * names (for tests). A project keeps the library it started with: its first
 * analysis copies the app's library into the project folder as library.json
 * (the pipeline, lane LIB-P), and from then on the viewer reads that copy.
 *
 *   { "format": 1, "version": "<text>", "applications": [ { "name": <system>,
 *     "activities": [ { "id", "name", "code"?, "description"?,
 *                       "screens": [ [<draft_key>, ...], ... ] } ] } ] }
 *
 * An application is named as shared/system-names.json names the system; the
 * order of the applications is the order of their colours on the map. An
 * activity's screens are runs of screens (one draft_key each, in order); an
 * activity for steps added by hand has none.
 *
 * Here: where the files are, reading one (a missing or invalid file is an
 * empty library, and says why), the checks a library must pass (the
 * pipeline's own, mirrored), and what the step pane needs: the activities of
 * a step's system, an activity by id or by name, the code of a step named
 * from the library. The file reads run in the main process; the rest is pure.
 */

const fs = require("node:fs");
const path = require("node:path");

const FORMAT = 1;
/* The project's copy, in the project folder. */
const PROJECT_FILE = "library.json";

/* An empty library: what a missing or invalid file reads as. */
function emptyLibrary() {
  return { format: FORMAT, version: "", applications: [] };
}

/* The app's library: PDT_LIBRARY when set, else library/activities.json
   beside the viewer's folder (the repo root in the dev tree; resources/ in
   the package, where the viewer's folder is resources/app.asar). */
function appLibraryPath(env) {
  const e = env || process.env;
  const own = e && typeof e.PDT_LIBRARY === "string" ? e.PDT_LIBRARY.trim() : "";
  return own ? path.resolve(own) : path.resolve(__dirname, "..", "library", "activities.json");
}

function projectLibraryPath(folder) {
  return path.join(String(folder || ""), PROJECT_FILE);
}

function _text(v) { return typeof v === "string" ? v.trim() : ""; }
function _key(v) { return _text(v).toLowerCase(); }

/* A run of screens with its repeats taken out: a screen equal to the one
   before it counts once (the pipeline's library.collapse). */
function collapse(run) {
  const out = [];
  for (const k of Array.isArray(run) ? run : []) if (!out.length || out[out.length - 1] !== k) out.push(k);
  return out;
}

function _isRun(v) {
  return Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === "string" && k !== "");
}

/* The version text: a text or a whole number, trimmed; "" for none. */
function _version(v) {
  return typeof v === "string" ? v.trim() : Number.isInteger(v) ? String(v) : "";
}

/* What is wrong with a library document: the first check it fails, in one
   sentence, as the only entry; [] when it is a valid library. The pipeline's
   checks (normalization/library.py parse_library, lane LIB-P), mirrored: the
   format number; applications a list, each with a name; an application's
   activities, when it has any, a list, each with an id and a name; no id
   twice in the library; no name twice in one application; a code and a
   description, when present, text; screens, when present, runs of screens
   (each a list of one or more draft keys); and no run of screens (its
   repeats taken out) in two activities. The version is optional. */
function problems(doc) {
  const fail = (msg) => [msg];
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.format !== FORMAT) {
    return fail("it is not a format " + FORMAT + " activity library");
  }
  if (!Array.isArray(doc.applications)) return fail("its applications are not a list");
  const ids = new Set();
  const runs = new Map();   // a run's text (repeats taken out) -> the id of its activity
  for (let i = 0; i < doc.applications.length; i++) {
    const app = doc.applications[i];
    if (!app || typeof app !== "object" || Array.isArray(app) || !_text(app.name)) return fail("application " + (i + 1) + " has no name");
    const appName = _text(app.name);
    const acts = app.activities == null ? [] : app.activities;
    if (!Array.isArray(acts)) return fail("the activities of " + appName + " are not a list");
    const used = new Set();
    for (let j = 0; j < acts.length; j++) {
      const a = acts[j];
      if (!a || typeof a !== "object" || Array.isArray(a) || !_text(a.id) || !_text(a.name)) {
        return fail("activity " + (j + 1) + " of " + appName + " has no id or no name");
      }
      const id = _text(a.id), name = _text(a.name);
      if (ids.has(id)) return fail("the activity id \"" + id + "\" is used twice");
      ids.add(id);
      if (used.has(name)) return fail("the name \"" + name + "\" is used twice in " + appName);
      used.add(name);
      for (const field of ["code", "description"]) {
        if (a[field] != null && typeof a[field] !== "string") return fail("the " + field + " of the activity \"" + id + "\" is not a text");
      }
      const screens = a.screens == null ? [] : a.screens;
      if (!Array.isArray(screens) || !screens.every(_isRun)) return fail("the screens of the activity \"" + id + "\" are not runs of draft keys");
      for (const run of screens) {
        const text = JSON.stringify(collapse(run));
        const other = runs.get(text);
        if (other !== undefined && other !== id) {
          return fail("one run of screens belongs to the activities \"" + other + "\" and \"" + id + "\"");
        }
        runs.set(text, id);
      }
    }
  }
  return [];
}

/* A valid document as the viewer keeps it: the texts trimmed, an empty code
   or description left out, the optional lists present. */
function _clean(doc) {
  return {
    format: FORMAT,
    version: _version(doc.version),
    applications: doc.applications.map((app) => ({
      name: _text(app.name),
      activities: (app.activities || []).map((a) => {
        const out = { id: _text(a.id), name: _text(a.name) };
        if (_text(a.code)) out.code = _text(a.code);
        if (_text(a.description)) out.description = _text(a.description);
        out.screens = (a.screens || []).map((run) => run.slice());
        return out;
      }),
    })),
  };
}

/* Read one library file: { status, path, library, error }. status "ok";
   "absent" (no file: an empty library, error null); "invalid" (it cannot be
   read or fails a check: an empty library, error the first reason). */
function readLibraryFile(p) {
  const file = String(p || "");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "absent", path: file, library: emptyLibrary(), error: null };
    return { status: "invalid", path: file, library: emptyLibrary(), error: "it cannot be read (" + ((e && e.message) || e) + ")" };
  }
  let doc;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { status: "invalid", path: file, library: emptyLibrary(), error: "it is not JSON (" + e.message + ")" };
  }
  const bad = problems(doc);
  if (bad.length) return { status: "invalid", path: file, library: emptyLibrary(), error: bad[0] };
  return { status: "ok", path: file, library: _clean(doc), error: null };
}

/* The library a project reads: its own library.json when the project has
   one (even an invalid one: a project keeps the library it started with),
   else the app's. The result of readLibraryFile plus `source`, "project" or
   "app". */
function projectLibrary(folder, appPath) {
  const own = readLibraryFile(projectLibraryPath(folder));
  if (own.status !== "absent") return Object.assign({ source: "project" }, own);
  return Object.assign({ source: "app" }, readLibraryFile(appPath || appLibraryPath()));
}

/* ---- Look-ups (pure) ---------------------------------------------------------- */

function _apps(lib) {
  return lib && Array.isArray(lib.applications) ? lib.applications : [];
}

/* The application named `system` (case does not matter), or null. */
function applicationNamed(lib, system) {
  const k = _key(system);
  if (!k) return null;
  return _apps(lib).find((a) => _key(a.name) === k) || null;
}

/* { application, activity } of the activity with id `id`, or null. */
function findActivity(lib, id) {
  const want = _text(id);
  if (!want) return null;
  for (const application of _apps(lib)) {
    const activity = (application.activities || []).find((a) => a.id === want);
    if (activity) return { application, activity };
  }
  return null;
}

/* { application, activity } of the activity of `system` named `name` (case
   and the spaces around it do not matter), or null. */
function activityNamed(lib, system, name) {
  const app = applicationNamed(lib, system);
  const k = _key(name);
  if (!app || !k) return null;
  const activity = (app.activities || []).find((a) => _key(a.name) === k);
  return activity ? { application: app, activity } : null;
}

/* The code of the activity a step is named from, or "". */
function codeOf(lib, step) {
  const hit = step && findActivity(lib, step.library_activity);
  return hit && hit.activity.code ? hit.activity.code : "";
}

/* { applications, activities } counted. */
function counts(lib) {
  const apps = _apps(lib);
  return { applications: apps.length, activities: apps.reduce((n, a) => n + ((a.activities || []).length), 0) };
}

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* Help's line on the app's library (a readLibraryFile result):
   "Library 1: 9 applications, 0 activities"; "Library: not found" or
   "Library: cannot be read" when there is none to count. */
function summaryLine(read) {
  const r = read || {};
  if (r.status === "absent") return "Library: not found";
  if (r.status !== "ok") return "Library: cannot be read";
  const c = counts(r.library);
  return "Library " + (r.library.version || "(no version)") + ": " + _plural(c.applications, "application", "applications") + ", " +
    _plural(c.activities, "activity", "activities");
}

/* ---- The step pane's picker (pure) ----------------------------------------------- */

/* What the step pane's name field offers for a step whose system is
   `system`: { system, activities: [{ id, name, code, description }],
   current (the id of the activity the step is named from, or null), note }.
   `note` is the one quiet line said instead of a list: no system yet (a step
   added by hand picks its system first), or no activities for it. */
function pickerFor(lib, system, step) {
  const sys = _text(system);
  const app = applicationNamed(lib, sys);
  const activities = app ? app.activities.map((a) => ({
    id: a.id, name: a.name, code: a.code || "", description: a.description || "",
  })) : [];
  const own = step && _text(step.library_activity);
  const current = own && activities.some((a) => a.id === own) ? own : null;
  let note = "";
  if (!sys) note = "Set the system first: the library lists activities by system.";
  else if (!activities.length) note = "The library has no activities for " + sys + ".";
  return { system: app ? app.name : sys, activities, current, note };
}

/* The activities whose name or code holds `text` (case does not matter);
   every one when `text` is blank. */
function filterActivities(activities, text) {
  const q = _key(text);
  const list = Array.isArray(activities) ? activities : [];
  if (!q) return list.slice();
  return list.filter((a) => _key(a.name).includes(q) || _key(a.code).includes(q));
}

/* Name `step` from the library (a pick in the step pane, or a name typed that
   is an activity's): its name, its system (the application's name) and
   library_activity; the activity's description too when the step's own is
   empty (`descriptionEmpty`: nothing the analyst wrote). The step's screens
   (its draft_key or draft_keys) stay as they are. Returns the step. */
function applyActivity(step, found, opts) {
  if (!step || !found || !found.activity || !found.application) return step;
  step.name = found.activity.name;
  step.system = found.application.name;
  step.library_activity = found.activity.id;
  if (opts && opts.descriptionEmpty && found.activity.description) step.description = found.activity.description;
  return step;
}

module.exports = {
  FORMAT, PROJECT_FILE,
  emptyLibrary, appLibraryPath, projectLibraryPath, collapse, problems, readLibraryFile, projectLibrary,
  applicationNamed, findActivity, activityNamed, codeOf, counts, summaryLine,
  pickerFor, filterActivities, applyActivity,
};
