"use strict";

/*
 * library-builder.js: the Library builder's model (contract C21; the owner's
 * tool, Help, Build the library...). The dialog is
 * views/library-builder-ui.js; the files are main.js's (the projects and the
 * hand-off zips read, annotations.json and manifest.json only; the library
 * saved).
 *
 * The builder starts from the app's library and lists, by application (a
 * step's system), the steps the analysts named in the projects added:
 * confirmed, edited or added by hand. One row per name in a system, with its
 * screens (its draft_keys; none for a step added by hand), how many times and
 * in which projects it appears. Rows that share screens, or a name, sit next
 * to each other: the same screens named differently are a conflict, and the
 * owner ticks the one to keep. The ticked rows make the new library; ticked
 * rows of one name in a system are one activity, so a name the library has
 * already adds its screens to that activity.
 *
 * Pure: no DOM, no files.
 */

const Library = require("./library.js");
const SystemNames = require("./system-names.js");
const { stepKeys } = require("./run-differences.js");
const { visibleTree } = require("./runs-model.js");

/* The states of a step the analyst named. */
const NAMED = new Set(["confirmed", "edited", "manually_authored"]);

function _text(v) { return typeof v === "string" ? v.trim() : ""; }
function _key(v) { return _text(v).toLowerCase(); }
/* A run of screens as text, its repeats taken out (the pipeline compares
   runs so, library.js collapse). */
function _runText(run) { return JSON.stringify(Library.collapse(run)); }
function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* The steps of one project's annotations the analyst named: visible, at every
   level, with a name, except a sub-process made by Group into a sub-process
   (it holds steps, it is none) and the drafted sub-steps of an opened step
   (one recorded action each, no screens). Each { system, name, run }: its
   system (the one it was set to, else the one its screens name), its screens
   (its draft_keys, a repeat once; null for a step added by hand). */
function namedSteps(annotations) {
  const out = [];
  for (const s of visibleTree((annotations && annotations.steps) || [])) {
    if (!NAMED.has(s.state) || s.group === true || _text(s.action_key)) continue;
    const name = _text(s.name);
    if (!name) continue;
    const keys = stepKeys(s);
    const run = keys ? Library.collapse(keys) : null;
    // A merge keeps draft_keys only: its first screen tells the system.
    const probe = run && !_text(s.draft_key) ? Object.assign({}, s, { draft_key: run[0] }) : s;
    const system = SystemNames.whereOfStep(probe, {}, {}).system;
    out.push({ system, name, run });
  }
  return out;
}

/* The projects' named steps, one entry per system and name (case does not
   matter): { system, name, runs (each run once), count, projects (their
   names, each once) }, in the order first met. `sources`: [{ name,
   annotations }]. The named steps without a system are only counted
   (`noSystem`): the library lists activities by system. */
function collect(sources) {
  const byKey = new Map();
  let noSystem = 0;
  for (const src of sources || []) {
    const project = _text(src && src.name) || "Project";
    for (const st of namedSteps(src && src.annotations)) {
      if (!st.system) { noSystem++; continue; }
      const key = _key(st.system) + "\n" + _key(st.name);
      let e = byKey.get(key);
      if (!e) {
        e = { system: st.system, name: st.name, runs: [], count: 0, projects: [] };
        byKey.set(key, e);
      }
      e.count++;
      if (st.run && !e.runs.some((r) => _runText(r) === _runText(st.run))) e.runs.push(st.run);
      if (!e.projects.includes(project)) e.projects.push(project);
    }
  }
  return { entries: [...byKey.values()], noSystem };
}

/* The same project added again (its session_id, else its path) replaces the
   earlier copy; the others are kept, in the order added. `added`: [{ path,
   sessionId, ... }]. Returns { sources, replaced } (replaced counts the
   copies taken out). */
function mergeSources(current, added) {
  const id = (s) => _text(s && s.sessionId) || "path:" + _key(s && s.path);
  const out = (current || []).slice();
  let replaced = 0;
  for (const s of added || []) {
    const i = out.findIndex((x) => id(x) === id(s));
    if (i >= 0) { out.splice(i, 1); replaced++; }
    out.push(s);
  }
  return { sources: out, replaced };
}

/* The builder's rows: the app library's activities (ticked: they are in),
   then the entries (not ticked), by application: the library's order, then
   the systems it lacks in the order first met. Within an application the
   rows that share a run of screens or a name stay together (a cluster, the
   library's rows first, then the entries most used first); a cluster whose
   rows share screens under different names is a conflict. Each row:
   { key, source ("library" or "projects"), application, id (the library
   activity's, else null), name, code, description, runs, count, projects,
   ticked, cluster (its number), conflict, inLibrary (an entry named as a
   library activity of its application) }. */
function rows(library, entries) {
  const apps = [];
  const appOf = new Map();
  const place = (name) => {
    const k = _key(name);
    if (!appOf.has(k)) { const a = { name: _text(name), rows: [] }; appOf.set(k, a); apps.push(a); }
    return appOf.get(k);
  };
  for (const app of (library && library.applications) || []) {
    const a = place(app.name);
    for (const act of app.activities || []) {
      a.rows.push({
        key: "lib:" + act.id, source: "library", application: a.name, id: act.id, name: act.name,
        code: act.code || "", description: act.description || "", runs: (act.screens || []).map((r) => r.slice()),
        count: 0, projects: [], ticked: true,
      });
    }
  }
  const found = (entries || []).slice().sort((x, y) => (y.count - x.count) || _key(x.name).localeCompare(_key(y.name)));
  for (const e of found) {
    const a = place(e.system);
    const inLibrary = a.rows.some((r) => r.source === "library" && _key(r.name) === _key(e.name));
    a.rows.push({
      key: "found:" + _key(e.system) + "\n" + _key(e.name), source: "projects", application: a.name, id: null,
      name: e.name, code: "", description: "", runs: e.runs.map((r) => r.slice()), count: e.count,
      projects: e.projects.slice(), ticked: false, inLibrary,
    });
  }
  const out = [];
  let clusterNo = 0;
  for (const a of apps) {
    // Union the rows that share a run of screens or a name.
    const parent = a.rows.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const join = (i, j) => { const ri = root(i), rj = root(j); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj); };
    const seen = new Map();
    a.rows.forEach((r, i) => {
      for (const k of ["name:" + _key(r.name)].concat(r.runs.map((run) => "run:" + _runText(run)))) {
        if (seen.has(k)) join(seen.get(k), i); else seen.set(k, i);
      }
    });
    const groups = new Map();
    a.rows.forEach((r, i) => {
      const g = root(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    });
    for (const g of [...groups.keys()].sort((x, y) => x - y)) {
      const members = groups.get(g);
      const n = ++clusterNo;
      const conflict = members.some((r, i) => members.some((q, j) => j > i && _key(q.name) !== _key(r.name) &&
        r.runs.some((run) => q.runs.some((other) => _runText(other) === _runText(run)))));
      for (const r of members) out.push(Object.assign(r, { cluster: n, conflict }));
    }
  }
  return out;
}

/* A new activity's id: its application and name in lower case, words joined
   by a hyphen ("salesforce-create-sales-order"), with a number after it when
   the library has that id already. */
function newId(application, name, taken) {
  const base = (String(application || "") + " " + String(name || "")).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "activity";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = base + "-" + n;
  taken.add(id);
  return id;
}

/* The library the ticked rows make (`rowList` as rows() gives them, with the
   owner's ticks and texts): format 1, `version`, the base library's
   applications in its order (each kept, even with nothing ticked in it),
   then the new applications with a ticked row. In an application the ticked
   rows of one name (case does not matter) make one activity: the library's
   id when one of them is the library's, else a new one; the name, code and
   description of its first row that has one; the screens of them all, each
   run once. */
function buildLibrary(base, rowList, version) {
  const apps = [];
  const appOf = new Map();
  const place = (name) => {
    const k = _key(name);
    if (!appOf.has(k)) { const a = { name: _text(name), groups: [], byName: new Map() }; appOf.set(k, a); apps.push(a); }
    return appOf.get(k);
  };
  for (const app of (base && base.applications) || []) place(app.name);
  const taken = new Set();
  for (const app of (base && base.applications) || []) for (const act of app.activities || []) taken.add(act.id);
  for (const r of rowList || []) {
    if (!r || !r.ticked || !_text(r.name) || !_text(r.application)) continue;
    const a = place(r.application);
    const k = _key(r.name);
    let g = a.byName.get(k);
    if (!g) { g = []; a.byName.set(k, g); a.groups.push(g); }
    g.push(r);
  }
  const applications = apps.filter((a) => a.groups.length || ((base && base.applications) || []).some((b) => _key(b.name) === _key(a.name)))
    .map((a) => ({
      name: a.name,
      activities: a.groups.map((g) => {
        const lib = g.find((r) => r.source === "library" && _text(r.id));
        const first = (field) => { const r = g.find((x) => _text(x[field])); return r ? _text(r[field]) : ""; };
        const name = _text((lib || g[0]).name);
        const act = { id: lib ? _text(lib.id) : newId(a.name, name, taken), name };
        if (first("code")) act.code = first("code");
        if (first("description")) act.description = first("description");
        const screens = [];
        for (const r of g) for (const run of r.runs || []) {
          if (Array.isArray(run) && run.length && !screens.some((s) => _runText(s) === _runText(run))) screens.push(Library.collapse(run));
        }
        act.screens = screens;
        return act;
      }),
    }));
  return { format: Library.FORMAT, version: _text(version), applications };
}

function _pad(n) { return String(n).padStart(2, "0"); }

/* The version text of a new library: the day and a counter,
   "2026-09-25.1"; the counter after the current version's when that one is
   of the same day. */
function nextVersion(current, now) {
  const d = now instanceof Date ? now : new Date();
  const day = d.getFullYear() + "-" + _pad(d.getMonth() + 1) + "-" + _pad(d.getDate());
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(_text(current));
  return day + "." + (m && m[1] === day ? Number(m[2]) + 1 : 1);
}

/* A screen (one draft_key, "<app>|<screen>|<commit>") in words: the screen,
   then the control that ended the step ("Salesforce - Order · save-order"),
   or the screen alone for a step that ended without one. */
function screenLabel(draftKey) {
  const k = String(draftKey || "");
  const first = k.indexOf("|"), last = k.lastIndexOf("|");
  if (first < 0 || last <= first) return k;
  const screen = k.slice(first + 1, last).trim();
  const commit = k.slice(last + 1).trim();
  const control = commit === "(visit)" ? "" : commit.slice(commit.indexOf(":") + 1).trim();
  const parts = [screen === "(screen)" ? "" : screen, control].filter(Boolean);
  return parts.length ? parts.join(" · ") : k;
}

/* A row's screens in words: its runs, one after the other, the screens of a
   run joined by "then"; "" without screens. */
function screensText(runs) {
  return (runs || []).map((run) => run.map(screenLabel).join(" then ")).join("; ");
}

/* How often and where a row's name was found: "Once, in Order intake";
   "3 times in 2 projects: Order intake, Order call". */
function usesText(row) {
  const n = (row && row.count) || 0;
  const ps = (row && row.projects) || [];
  if (!n) return "";
  const where = ps.length === 1 ? "in " + ps[0] : "in " + _plural(ps.length, "project", "projects") + ": " + ps.join(", ");
  return (n === 1 ? "Once, " : n + " times ") + where;
}

module.exports = {
  NAMED, namedSteps, collect, mergeSources, rows, buildLibrary, nextVersion, newId,
  screenLabel, screensText, usesText,
};
