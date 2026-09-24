/*
 * analysis-view.js: the Overview's Observations (step-back review 4.4). Two
 * items, each a collapsible module whose one-line takeaway shows while it is
 * closed (closed by default; the analyst's choice persists per item under
 * the pdt.analysis.* keys):
 *
 *   Data typed twice: the re-keyed data, said per field where the recording
 *     says which field a value went into ("Product code in Salesforce typed
 *     again as Material number in SAP"), each place named by its system (the
 *     one vocabulary, C14). Read from the
 *     pipeline's re-typed values finding and the events it names; when the
 *     events do not name the fields, the finding's own sentence stands.
 *   Where the time goes: per step, its average time per run and in how many
 *     runs it happened; then the same per system (C14), where the automation
 *     candidates fold in (the time each system takes in a run). Computed from
 *     the runs' visible steps as they are now, grouped the way the map groups
 *     them (process-map-levels.mapNodeLabel), so a rename shows at once.
 *
 * Nothing here chooses what the PDD prints: each item has its own place in
 * the document (the re-keyed data with the data, the times with the steps and
 * the applications). No dot strip, no total over the runs, no judgment
 * editor: the business-required split was cut with the findings ticks.
 */

"use strict";

const { escapeHtml, escapeAttr, formatDuration } = require("../dom.js");
const RunsModel = require("../runs-model.js");
const { mapNodeLabel } = require("../process-map-levels.js");
const SystemNames = require("../system-names.js");

const STAGE_NOT_RUN = "This check could not run on this recording";

/* ---- Collapsible modules ------------------------------------------------- */

const _MODULE_KEY_PREFIX = "pdt.analysis.";
function _moduleOpen(key) {
  try { return localStorage.getItem(_MODULE_KEY_PREFIX + key) === "1"; }
  catch (_) { return false; }
}
function _setModuleOpen(key, open) {
  try { localStorage.setItem(_MODULE_KEY_PREFIX + key, open ? "1" : "0"); }
  catch (_) {}
}

/* One item: a title, a takeaway that shows while it is closed, a body. */
function _moduleShell(key, mod) {
  const open = _moduleOpen(key);
  return '<details class="analysis-section analysis-module ov-obs-item" data-module="' +
      escapeAttr(key) + '"' + (open ? " open" : "") + ">" +
    '<summary class="analysis-module-head">' +
      '<span class="analysis-module-title">' + escapeHtml(mod.title) + "</span>" +
      '<span class="analysis-module-takeaway">' + escapeHtml(mod.takeaway || "") + "</span>" +
      '<span class="analysis-module-chevron" aria-hidden="true"></span>' +
    "</summary>" +
    '<div class="analysis-module-body">' + (mod.body || "") + "</div>" +
  "</details>";
}

/* ---- Data typed twice ------------------------------------------------------ */

function _appKey(app) {
  const k = String(app || "").trim().toLowerCase();
  return k.endsWith(".exe") ? k.slice(0, -4) : k;
}

function _fieldName(data) {
  const n = typeof data.name === "string" ? data.name.trim() : "";
  if (n) return n;
  return typeof data.automation_id === "string" ? data.automation_id.trim() : "";
}

/* The re-keyed data as lines, per field where the events allow. Returns
   { status, lines }: status "not-run" when the findings stage failed (C12:
   null with a stage_errors entry, said, never read as "none"), "nothing"
   when there was nothing to check (C16: null without an entry, a session
   without a recording), "none" when nothing was typed twice, else "ok".
   Pure. */
function retypedLines(analysis, events, appNames) {
  const findings = analysis ? analysis.findings : undefined;
  if (findings === null) {
    const failed = (Array.isArray(analysis.stage_errors) ? analysis.stage_errors : []).some((e) => e && e.stage === "findings");
    return { status: failed ? "not-run" : "nothing", lines: [] };
  }
  const f = (Array.isArray(findings) ? findings : []).find((x) => x && x.detector === "rekey_transfer");
  if (!f) return { status: "none", lines: [] };
  const values = Array.isArray((f.evidence || {}).values) ? f.evidence.values : [];
  const lines = [];
  for (const v of values) {
    if (!v || typeof v.value !== "string") continue;
    const apps = new Set((v.apps || []).map(_appKey));
    const entries = (Array.isArray(events) ? events : [])
      .filter((e) => e && e.type === "interaction" && e.data && e.data.value === v.value &&
        apps.has(_appKey(e.data.process_name)))
      .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    // Each place the value went into, in the order it was typed there.
    const places = [];
    for (const e of entries) {
      const field = _fieldName(e.data);
      const name = SystemNames.systemName(e.data.process_name, e.data.window_title, appNames) || String(e.data.process_name || "");
      const where = name.toLowerCase();
      if (!places.some((p) => p.field === field && p.where === where)) places.push({ field, where, name });
    }
    const first = places[0];
    for (const p of places.slice(1)) {
      if (!first || p.where === first.where) continue;
      const line = first.field && p.field
        ? first.field + " in " + first.name + " typed again as " + p.field + " in " + p.name
        : "A value typed in " + first.name + " typed again in " + p.name;
      if (!lines.includes(line)) lines.push(line);
    }
  }
  // The events did not name the places: the finding's own sentence stands.
  if (!lines.length && typeof f.claim === "string" && f.claim.trim()) lines.push(f.claim.trim());
  return { status: lines.length ? "ok" : "none", lines };
}

function _retypedItem(sess) {
  const appNames = (sess.stats && sess.stats.meta && sess.stats.meta.app_names) || {};
  const r = retypedLines(sess.analysis, sess.events, appNames);
  if (r.status === "not-run") {
    return { title: "Data typed twice", takeaway: STAGE_NOT_RUN,
      body: '<p class="analysis-note ov-stage-not-run">' + escapeHtml(STAGE_NOT_RUN +
        ", so it cannot say whether data was typed twice.") + "</p>" };
  }
  if (r.status === "nothing") {
    return { title: "Data typed twice", takeaway: "Nothing recorded",
      body: '<p class="analysis-note">Nothing was recorded in this session, so there is no typed data to compare.</p>' };
  }
  if (r.status === "none") {
    return { title: "Data typed twice", takeaway: "None seen in this recording",
      body: '<p class="analysis-note">No value was typed into more than one application in this recording.</p>' };
  }
  return {
    title: "Data typed twice",
    takeaway: r.lines[0] + (r.lines.length > 1 ? " (+" + (r.lines.length - 1) + " more)" : ""),
    body: '<ul class="ov-retyped">' + r.lines.map((l) => "<li>" + escapeHtml(l) + "</li>").join("") + "</ul>",
  };
}

/* ---- Where the time goes ----------------------------------------------------- */

function _stepMs(st) {
  const tr = (st && st.time_range) || {};
  const a = Date.parse(tr.start || ""), b = Date.parse(tr.end || "");
  return (Number.isFinite(a) && Number.isFinite(b) && b > a) ? b - a : 0;
}

/* Per step (the map's grouping) and per system (C14): the time in each run
   that has it, averaged over those runs, and how many runs they are. A step
   without a time range has no time (C16) and is left out, and so are rows
   with no measured time; the most time first. Pure.
   `interactionsById` (optional) names a step's system from its own
   interactions, else from its grain keys.
   Returns { runCount, steps: [row], apps: [row] }, row = { label, avgMs,
   runs, totalMs }. */
function timePerStep(stats, steps, appNames, interactionsById) {
  const runs = RunsModel.buildRuns(stats, steps).runs;
  const byStep = new Map(), byApp = new Map();
  const add = (map, key, ms) => {
    const cur = map.get(key) || { total: 0, runs: 0 };
    cur.total += ms;
    cur.runs += 1;
    map.set(key, cur);
  };
  for (const r of runs) {
    const stepMs = new Map(), appMs = new Map();
    for (const st of r.visible) {
      if (!Number.isFinite(Date.parse((st.time_range || {}).start))) continue;
      const ms = _stepMs(st);
      const label = mapNodeLabel(st);
      stepMs.set(label, (stepMs.get(label) || 0) + ms);
      const system = SystemNames.whereOfStep(st, interactionsById || {}, appNames).system;
      if (system) appMs.set(system, (appMs.get(system) || 0) + ms);
    }
    for (const [k, ms] of stepMs) add(byStep, k, ms);
    for (const [k, ms] of appMs) add(byApp, k, ms);
  }
  const rows = (map, name) => [...map.entries()]
    .map(([k, v]) => ({ label: name(k), totalMs: v.total, runs: v.runs, avgMs: Math.round(v.total / v.runs) }))
    .filter((row) => row.totalMs > 0)
    .sort((a, b) => (b.totalMs - a.totalMs) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return {
    runCount: runs.length,
    steps: rows(byStep, (k) => k),
    apps: rows(byApp, (k) => k),
  };
}

function _timeTable(caption, rows, runCount) {
  return '<table class="ov-time">' +
    "<thead><tr><th>" + escapeHtml(caption) + '</th><th class="num">Per run</th><th>Runs</th></tr></thead><tbody>' +
    rows.map((row) => "<tr>" +
      '<td class="ov-time-name" title="' + escapeAttr(row.label) + '">' + escapeHtml(row.label) + "</td>" +
      '<td class="num">' + escapeHtml(formatDuration(row.avgMs)) + "</td>" +
      "<td>in " + row.runs + " of " + runCount + " run" + (runCount === 1 ? "" : "s") + "</td></tr>").join("") +
    "</tbody></table>";
}

function _timeItem(sess) {
  const appNames = (sess.stats && sess.stats.meta && sess.stats.meta.app_names) || {};
  const inter = {};
  for (const ev of sess.events || []) if (ev && ev.type === "interaction" && ev.event_id) inter[ev.event_id] = ev;
  const t = timePerStep(sess.stats, (sess.annotations || {}).steps || [], appNames, inter);
  if (!t.runCount) {
    return { title: "Where the time goes", takeaway: "No runs are marked yet",
      body: '<p class="analysis-note">The time per step is measured in the runs; mark the runs first.</p>' };
  }
  if (!t.steps.length) {
    return { title: "Where the time goes", takeaway: "No step has a measured time yet",
      body: '<p class="analysis-note">The runs have no steps with a measured time.</p>' };
  }
  const top = t.steps[0];
  return {
    title: "Where the time goes",
    takeaway: "Most in " + top.label + ": " + formatDuration(top.avgMs) + " per run",
    body: _timeTable("Step", t.steps, t.runCount) +
      (t.apps.length ? _timeTable("System", t.apps, t.runCount) : ""),
  };
}

/* ---- The block ------------------------------------------------------------- */

/* The Observations block of the Overview for one session. Pure (no DOM, no
   State): the unit tests render fixture sessions through it. */
function observationsHtml(sess) {
  if (!sess) return "";
  return '<section class="ov-section ov-observations" id="ov-observations">' +
    '<div class="ov-section-title">Observations</div>' +
    _moduleShell("retyped", _retypedItem(sess)) +
    _moduleShell("time", _timeItem(sess)) +
    "</section>";
}

/* Wire the per-analyst open state after a render. */
function wireObservations(host) {
  if (!host) return;
  host.querySelectorAll("#ov-observations details.analysis-module[data-module]").forEach((d) => {
    d.addEventListener("toggle", () => _setModuleOpen(d.dataset.module, d.open));
  });
}

module.exports = { observationsHtml, wireObservations, retypedLines, timePerStep };
