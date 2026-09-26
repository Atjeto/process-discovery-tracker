/*
 * system-names.js: the one vocabulary of systems (contract C14, AD-28), the
 * viewer's half of normalization/app_names.py and step_context.py. The rules
 * in shared/system-names.json turn an application and a window title into
 * the business system the work happened in: "Salesforce" for a Chrome window
 * on Salesforce, "SAP", "Excel". The timeline legend and bands, the step fact
 * line, the map boxes and the step panel name systems through here, the PDD
 * through app_names.system_name: the same list.
 *
 * One difference from step_context: the viewer loads no app vocabularies, so
 * a screen is always the value-free window title (a vocabulary's own screen
 * name, such as "Create Sales Order (VA01)", is the PDD's only).
 *
 * Pure: no DOM, no State (the unit tests drive it directly).
 */

"use strict";

const path = require("node:path");
const { screenType } = require("./process-map-levels.js");

const _doc = require(path.join(__dirname, "..", "shared", "system-names.json"));

/* An application token's comparison key: lowercased, ".exe" stripped. */
function appKey(app) {
  const s = String(app == null ? "" : app).trim().toLowerCase();
  return s.endsWith(".exe") ? s.slice(0, -4) : s;
}

/* The rules in order: { keys, rx, system }. A rule without applications or
   a name, or with a pattern that does not compile, is skipped. */
const RULES = [];
for (const r of (_doc && Array.isArray(_doc.rules)) ? _doc.rules : []) {
  if (!r || typeof r !== "object") continue;
  const procs = typeof r.process === "string" ? [r.process] : (Array.isArray(r.process) ? r.process : []);
  const keys = new Set(procs.filter((p) => typeof p === "string" && p.trim()).map(appKey));
  const system = typeof r.system === "string" ? r.system.trim() : "";
  let rx = null;
  if (typeof r.title === "string" && r.title) {
    try { rx = new RegExp(r.title, "i"); } catch (_) { continue; }
  }
  if (keys.size && system) RULES.push({ keys, rx, system });
}

/* The executable name without ".exe", capitalized when it is all one case. */
function fallbackName(app) {
  let s = String(app == null ? "" : app).trim();
  if (s.toLowerCase().endsWith(".exe")) s = s.slice(0, -4);
  return (s === s.toUpperCase() || s === s.toLowerCase()) ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function _applicationRule(key) {
  for (const r of RULES) if (!r.rx && r.keys.has(key)) return r.system;
  return "";
}

/* The readable name of one application (app_names.display_name): the
   recording's own name for it (stats.json meta.app_names), else the rule
   without a title, else the capitalized executable name. */
function displayName(app, names) {
  const raw = String(app == null ? "" : app).trim();
  if (!raw) return "";
  const map = names && typeof names === "object" ? names : {};
  if (typeof map[raw] === "string" && map[raw].trim()) return map[raw].trim();
  const key = appKey(raw);
  for (const [exe, nm] of Object.entries(map)) {
    if (appKey(exe) === key && typeof nm === "string" && nm.trim()) return nm.trim();
  }
  return _applicationRule(key) || fallbackName(raw);
}

/* The business system of one application and window title
   (app_names.system_name): the first rule whose applications include the
   application and whose title pattern, when it has one, finds the title;
   else the application's readable name. "" without an application. */
function systemName(app, title, names) {
  const raw = String(app == null ? "" : app).trim();
  if (!raw) return "";
  const key = appKey(raw);
  const text = typeof title === "string" ? title : "";
  for (const r of RULES) {
    if (r.keys.has(key) && (!r.rx || r.rx.test(text))) return r.system;
  }
  return displayName(raw, names);
}

/* The separators between a window title's segments: a spaced hyphen, pipe,
   en dash or em dash (as code points), or "::". */
const TITLE_SPLIT = /\s+(?:[-|\u2013\u2014]|::)\s+/;

/* True when a title segment is (part of) a system name, as whole words. */
function _names(segment, name) {
  const seg = String(segment).trim().toLowerCase(), nm = String(name).trim().toLowerCase();
  if (seg.length < 3 || !nm) return false;
  return new RegExp("(?<![\\w])" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])").test(nm);
}

/* The screen of a window title (step_context.screen_of): its value-free
   segments that do not name the system, joined by ", ". */
function screenOf(title, systemNames) {
  let label = screenType(title || "");
  if (!label || label === "(screen)") return "";
  label = label.replace(/\s*(?:\(\s*\)|\[\s*\])/g, "").split(/\s+/).filter(Boolean).join(" ");
  const names = (systemNames || []).filter(Boolean);
  return label.split(TITLE_SPLIT).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !names.some((n) => _names(s, n))).join(", ");
}

/* { system, screen } of one application and window title. */
function whereData(app, title, names) {
  const a = typeof app === "string" ? app.trim() : "";
  const t = typeof title === "string" ? title.trim() : "";
  if (!a) return { system: "", screen: screenOf(t, []) };
  const system = systemName(a, t, names);
  return { system, screen: screenOf(t, [system, displayName(a, names), appKey(a)]) };
}

function _mostCommon(values) {
  const counts = new Map();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = "", n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/* { system, screen } of a step (step_context.where): its interactions' most
   common application and window title (its grain_keys' where they carry
   none: the pipeline filled in the window a click lost, lane LF-PIPE);
   without interactions, its grain_keys, else its draft_key. A system the analyst set on the step (step.system, C16:
   a step added by hand) wins over the one derived here. { "", "" } when
   unknown. */
function whereOfStep(step, interactionsById, names) {
  const where = _derivedWhere(step, interactionsById, names);
  const own = step && typeof step.system === "string" ? step.system.trim() : "";
  return own ? { system: own, screen: where.screen } : where;
}

function _derivedWhere(step, interactionsById, names) {
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  const datas = ids.map((id) => interactionsById && interactionsById[id]).filter(Boolean).map((ev) => ev.data || {});
  let a = "", t = "";
  const gk = step && step.grain_keys;
  if (gk && typeof gk === "object") {
    a = typeof gk.app === "string" && gk.app !== "(app)" ? gk.app : "";
    t = typeof gk.screen === "string" && gk.screen !== "(screen)" ? gk.screen : "";
  }
  // Lane LF-PIPE: a click that changed the page lost its window and program
  // in the recording; the pipeline filled them in, and the step's grain keys
  // carry them (the raw events here do not).
  const app = _mostCommon(datas.map((d) => d.process_name)) || (datas.length ? a : "");
  const title = _mostCommon(datas.map((d) => d.window_title)) || (datas.length ? t : "");
  if (app || title) return whereData(app, title, names);
  const dk = step && step.draft_key;
  if (!a && !t && typeof dk === "string" && dk.split("|").length >= 3) {
    const first = dk.indexOf("|"), last = dk.lastIndexOf("|");
    a = dk.slice(0, first);
    t = dk.slice(first + 1, last);
    if (a === "(app)") a = "";
    if (t === "(screen)") t = "";
  }
  return (a || t) ? whereData(a, t, names) : { system: "", screen: "" };
}

/* The systems each application of a recording stands for (lane FX2,
   validation pass 2, F10: the Apps outside the process dialog names the
   business system, Salesforce, not the browser): { process name: [systems] }
   from its interactions' window titles, the most used first (a tie keeps
   the first seen). `interactions`: the recording's interaction events. */
function appSystems(interactions, names) {
  const counts = new Map();
  for (const ev of interactions || []) {
    const d = ev && ev.type === "interaction" && ev.data;
    const proc = d && typeof d.process_name === "string" ? d.process_name : "";
    if (!proc) continue;
    const system = systemName(proc, d.window_title, names);
    if (!system) continue;
    const per = counts.get(proc) || new Map();
    per.set(system, (per.get(system) || 0) + 1);
    counts.set(proc, per);
  }
  const out = {};
  for (const [proc, per] of counts) {
    out[proc] = [...per].map((e, i) => [e[0], e[1], i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map((e) => e[0]);
  }
  return out;
}

/* Every system the shared list names, each once, in its order (the step
   pane's System field offers them, C16). */
function knownSystems() {
  return [...new Set(RULES.map((r) => r.system))];
}

/* True when a step's name already names its system, as whole words,
   ignoring case ("orders.xlsx - Excel: Save" names Excel). The pipeline's
   step_context.names_system. */
function namesSystem(name, system) {
  const nm = typeof name === "string" ? name : "";
  const sys = typeof system === "string" ? system.trim() : "";
  if (!sys || !nm) return false;
  return new RegExp("(?<![\\w])" + sys.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])", "i").test(nm);
}

/* The line a map box shows under its step's name (AD-28): the system, or
   "" when the name already names it (lane LF-PIPE, #24: "Account |
   Salesforce: Save" over "Salesforce" said it twice). */
function systemLine(name, system) {
  const sys = typeof system === "string" ? system.trim() : "";
  return sys && !namesSystem(name, sys) ? sys : "";
}

module.exports = {
  appKey, displayName, systemName, screenOf, whereData, whereOfStep, fallbackName, knownSystems, appSystems,
  namesSystem, systemLine,
};
