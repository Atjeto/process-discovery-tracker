/*
 * sub-process-verbs.js: the verbs that make and undo a sub-process (contract
 * C19, AD-33), the pure half. views/steps-view.js calls them on the live
 * annotations right before its one persistAnnotations write, so each verb is
 * one undoable edit (the undo snapshot holds the whole tree).
 *
 *   Open as a sub-process   every visible occurrence of a step's node at its
 *                           level, in every transaction, that has no
 *                           sub_steps gets one drafted sub-step per recorded
 *                           action (openAsSubProcess, draftSubSteps).
 *   Group into a sub-process  consecutive ticked steps of one transaction
 *                           move into a new group step, and every other
 *                           stretch of the same kinds of steps does too, in
 *                           every transaction (groupInto).
 *   Dissolve sub-process    a group gives its sub-steps back in its place; an
 *                           opened step drops its sub_steps (dissolve; what
 *                           goes: dissolveLoss).
 *   Rename                  a sub-process's name reaches every occurrence of
 *                           its node at its level (renameNode).
 *
 * A drafted sub-step (one recorded action): the shape of a step plus
 * `action_key` ("<app>|<screen>|enter:<field>" or "...|click:<control>"; the
 * app and the screen from the parent's draft_key when it has one, else from
 * the action's event) and name_source "action" (or "remembered": the C4 store
 * under "action|" + action_key), state auto_suggested, no draft_key. Its name
 * carries no typed value ("Enter Product code", "Click Save order"): it is
 * its map node, like a drafted step's (process-map-levels.mapNodeLabel); its
 * description is the phrase with the value (Entered "SKU-4471" into Product
 * code.). Consecutive events on one control are one action; a focus change,
 * a control with no name and an empty value are no action (the kinds the
 * step's Interactions list and FIELDS TYPED leave out).
 *
 * Pure: no DOM, no State. The maps and the tree helpers are
 * sub-process-maps.js.
 */

"use strict";

const { mapNodeLabel, processLabel, screenType, valueFree } = require("./process-map-levels.js");
const SPM = require("./sub-process-maps.js");
const { DRAFT_STATES } = require("./runs-model.js");
const StepFlow = require("./step-flow.js");
const AC = require("./analyst-content.js");

const NOISE = new Set(["null", "(null)", "undefined", "(undefined)"]);
const ELLIPSIS = String.fromCharCode(0x2026);

function _t(v) { return typeof v === "string" ? v.trim() : ""; }
function _clip(v, n) { return v.length > n ? v.slice(0, n - 1) + ELLIPSIS : v; }
/* An analyst's text as one line (the step flow's rule). */
function _line(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

function _newId(opts) {
  if (opts && typeof opts.newId === "function") return opts.newId();
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  return c && typeof c.randomUUID === "function" ? c.randomUUID() : "step-" + Math.random().toString(36).slice(2);
}

/* ---- One recorded action ------------------------------------------------------ */

/* A control's words without values: its meaningful name, else its name. */
function _label(d) { return valueFree(d.meaningful_name) || valueFree(d.name); }
/* A field's words without values, its automation_id last. */
function _field(d) { return _label(d) || valueFree(d.automation_id); }
/* A field as the recording names it (a description may carry values). */
function _rawField(d) { return _t(d.meaningful_name) || _t(d.name) || _t(d.automation_id); }
/* The control in an action_key: the C1 identity ladder (automation_id, else
   name, else class_name), each without values, else "?". */
function _identity(d) {
  for (const k of ["automation_id", "name", "class_name"]) {
    const v = valueFree(d[k]);
    if (v) return v;
  }
  return "?";
}
function _app(d) {
  let p = _t(d.process_name).toLowerCase();
  if (p.endsWith(".exe")) p = p.slice(0, -4);
  return p || "(app)";
}
function _screen(d) {
  return _t(d.screen_id) || (_t(d.window_title) ? screenType(d.window_title) : "") || "(screen)";
}

/* The "<app>|<screen>" of an event's action. */
function eventPrefix(d) { return _app(d || {}) + "|" + _screen(d || {}); }

/* The "<app>|<screen>" of a parent's actions: its draft_key without the
   commit part, or null when it has no draft_key. The commit part is the one
   the drafting wrote ("(visit)", or "<control type>:<identity>" of its last
   interaction); the key is never split on a "|" a screen may hold. */
function parentPrefix(parent, datas) {
  const dk = _t(parent && parent.draft_key);
  if (!dk) return null;
  const tail = (part) => (dk.endsWith("|" + part) ? dk.slice(0, dk.length - part.length - 1) : null);
  const visit = tail("(visit)");
  if (visit) return visit;
  const last = datas && datas.length ? datas[datas.length - 1] : null;
  const commit = last ? tail((_t(last.control_type) || "?") + ":" + _identity(last)) : null;
  if (commit) return commit;
  const i = dk.lastIndexOf("|");
  return i > 0 ? dk.slice(0, i) : null;
}

/* The action of one interaction: { key, name, description }, or null for a
   focus change, a control with no name or an empty value. */
function actionOf(data, prefix) {
  const d = data || {};
  const pre = prefix || eventPrefix(d);
  const kind = _t(d.kind);
  const ct = _t(d.control_type);
  if (kind === "value_changed" || kind === "text_changed") {
    const secret = d.value_redacted === true;
    const value = _t(d.value);
    if (!secret && (!value || NOISE.has(value.toLowerCase()))) return null;
    const field = _field(d);
    if (!field) return null;
    const raw = _rawField(d);
    const description = secret ? "Entered a secret value into " + raw + "."
      : /^«[^»]*»$/.test(value) ? "Entered a masked value into " + raw + "."
        : "Entered \"" + _clip(value, 160) + "\" into " + raw + ".";
    return { key: pre + "|enter:" + _identity(d), name: "Enter " + field, description };
  }
  if (kind === "selection_changed") {
    const sel = _t(d.selected_value);
    const named = _t(d.meaningful_name) || _t(d.name);
    if (ct === "TabItem" || ct === "Tab") {
      const tab = valueFree(sel) || _label(d);
      if (!tab) return null;
      return { key: pre + "|click:" + _identity(d), name: "Switch to " + tab, description: "Switched to " + (sel || named) + "." };
    }
    if (sel) {
      const field = _field(d);
      if (!field) return null;
      return { key: pre + "|enter:" + _identity(d), name: "Enter " + field,
        description: "Selected \"" + _clip(sel, 160) + "\" in " + _rawField(d) + "." };
    }
    const label = _label(d);
    if (!label) return null;
    return { key: pre + "|click:" + _identity(d), name: "Change selection in " + label,
      description: "Changed selection in " + named + "." };
  }
  if (kind === "invoked") {
    const raw = _t(d.meaningful_name) || _t(d.name);
    if (!raw) return null;
    const label = _label(d);
    const [verb, past, noun] = ct === "MenuItem" ? ["Open", "Opened", "a menu item"]
      : ct === "Hyperlink" ? ["Follow", "Followed", "a link"]
        : ["Click", "Clicked", ct === "Button" ? "a button" : "a control"];
    return { key: pre + "|click:" + _identity(d), name: verb + " " + (label || noun), description: past + " " + raw + "." };
  }
  if (kind === "toggle_changed") {
    const field = _field(d);
    if (!field) return null;
    const raw = _rawField(d);
    const state = _t(d.toggle_state).toLowerCase();
    const description = state === "on" ? "Turned " + raw + " on."
      : state === "off" ? "Turned " + raw + " off."
        : state === "indeterminate" ? "Set " + raw + " to indeterminate." : "Toggled " + raw + ".";
    return { key: pre + "|click:" + _identity(d), name: "Toggle " + field, description };
  }
  // A focus change, or a kind the recorder does not write.
  return null;
}

/* The actions of a list of interaction events, in order: consecutive events
   on one control (one action_key) are one action, named by its first event
   and described by its last (the value the field ended with).
   [{ key, name, description, events }] */
function actionsOf(events, prefix) {
  const out = [];
  for (const ev of events || []) {
    if (!ev || !ev.timestamp) continue;
    const a = actionOf(ev.data || {}, prefix);
    if (!a) continue;
    const last = out[out.length - 1];
    if (last && last.key === a.key) { last.events.push(ev); last.description = a.description; }
    else out.push(Object.assign({ events: [ev] }, a));
  }
  return out;
}

function _events(step, interactionsById) {
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  return ids.map((id) => interactionsById && interactionsById[id]).filter((ev) => ev && ev.timestamp);
}

/* A remembered name (C4 store shape: { key: { name } }), or "". */
function _remembered(store, key) {
  const e = store && typeof store === "object" ? store[key] : null;
  return e && typeof e.name === "string" ? e.name.trim() : "";
}

/* The names this project's own sub-steps give their actions (lane FX2,
   validation pass 1: C4's name precedence, F1, for drafted sub-steps, as
   step_suggest.session_names gives drafts theirs): { action_key: name } from
   the sub-steps with an action_key at every level, first the names the
   analyst typed (states edited and manually_authored), then the names
   accepted (confirmed); hidden sub-steps name nothing; within each, the
   reference transaction's first (`patternCaseId`), then time order. The
   names travel with the folder, so Open as a sub-process drafts the same
   names on another computer. */
function projectActionNames(steps, patternCaseId) {
  const all = [];
  SPM.eachStep(steps, (s, _list, _i, ancestors) => {
    if (!ancestors.length || s.state === "hidden" || ancestors.some((a) => a.state === "hidden")) return;
    const key = _t(s.action_key), name = _t(s.name);
    if (key && name) all.push({ s, key, name, n: all.length });
  });
  const rank = (s) => (s.state === "edited" || s.state === "manually_authored" ? 0 : s.state === "confirmed" ? 1 : 9);
  const start = (s) => { const t = Date.parse(s.time_range && s.time_range.start); return Number.isFinite(t) ? t : Infinity; };
  const out = {};
  all.filter((x) => rank(x.s) < 9)
    .sort((a, b) => (rank(a.s) - rank(b.s)) ||
      ((a.s.case_id === patternCaseId ? 0 : 1) - (b.s.case_id === patternCaseId ? 0 : 1)) ||
      (start(a.s) - start(b.s)) || (a.n - b.n))
    .forEach((x) => { if (!(x.key in out)) out[x.key] = x.name; });
  return out;
}

/**
 * The drafted sub-steps of `parent`: one per recorded action in its
 * evidence.interaction_event_ids, [] when it has none (a step added by hand,
 * a project without a recording).
 * @param {object} parent
 * @param {Object<string, object>} interactionsById  event_id -> interaction event
 * @param {{newId?: Function, remembered?: object, projectNames?: object, shotTimes?: Object<string, string>}} opts
 *   projectNames: the names the project's own sub-steps give their actions
 *   (projectActionNames), which come first (C4's precedence, lane FX2);
 *   remembered: the C4 store's names; shotTimes: screenshot path -> the time
 *   it was taken (the recording's screenshot events).
 */
function draftSubSteps(parent, interactionsById, opts) {
  const o = opts || {};
  const events = _events(parent, interactionsById);
  const actions = actionsOf(events, parentPrefix(parent, events.map((ev) => ev.data || {})));
  const hidden = new Set(Array.isArray(parent && parent.hidden_screenshots) ? parent.hidden_screenshots : []);
  const shots = ((parent && parent.evidence && parent.evidence.screenshot_refs) || [])
    .filter((r) => typeof r === "string" && r && !hidden.has(r));
  const takenAt = (ref) => Date.parse(((o.shotTimes || {})[ref]) || "");
  return actions.map((a, i) => {
    const isLast = i === actions.length - 1;
    const start = a.events[0].timestamp;
    // To the next action's first event; the last ends at its own last event.
    const end = isLast ? a.events[a.events.length - 1].timestamp : actions[i + 1].events[0].timestamp;
    const s0 = Date.parse(start), s1 = Date.parse(end);
    const own = o.projectNames && typeof o.projectNames[a.key] === "string" ? _t(o.projectNames[a.key]) : "";
    const saved = own || _remembered(o.remembered, "action|" + a.key);
    const name = saved || a.name;
    return {
      step_id: _newId(o),
      session_id: (parent && parent.session_id) || "",
      case_id: parent && parent.case_id != null ? parent.case_id : null,
      name,
      description: a.description,
      time_range: { start, end },
      evidence: {
        interaction_event_ids: a.events.map((ev) => ev.event_id),
        screenshot_refs: shots.filter((r) => {
          const t = takenAt(r);
          return Number.isFinite(t) && t >= s0 && (isLast ? t <= s1 : t < s1);
        }),
        video_timecode_range: null,
        manual_notes: "",
      },
      state: "auto_suggested",
      canonical_step_id: null,
      flags: { waste: false },
      phase_id: null,
      action_key: a.key,
      name_source: saved ? "remembered" : "action",
      process_label: name,
    };
  });
}

/* The name and the description the drafting gives a drafted sub-step, from
   its own events: { name, description }, "" each when they cannot be told.
   The Remembered step names dialog's Forget gives the name back; Dissolve tells a
   description the analyst wrote from the drafted one. */
function draftedAction(step, interactionsById) {
  const events = _events(step, interactionsById);
  const key = _t(step && step.action_key);
  const prefix = key.includes("|enter:") ? key.slice(0, key.lastIndexOf("|enter:"))
    : key.includes("|click:") ? key.slice(0, key.lastIndexOf("|click:")) : null;
  const acts = actionsOf(events, prefix);
  if (!acts.length) return { name: "", description: "" };
  return { name: acts[0].name, description: acts[acts.length - 1].description };
}

/* ---- Open as a sub-process ----------------------------------------------------- */

/* Open `step` as a sub-process (C19): every visible occurrence of its node at
   level `path`, in every transaction, that has no sub_steps gets them (the
   step itself too), and a draft becomes edited. Returns { steps, subSteps }:
   the steps opened and how many sub-steps were drafted. */
function openAsSubProcess(transactions, path, step, interactionsById, opts) {
  const node = mapNodeLabel(step);
  const targets = [];
  if (step && step.state !== "hidden" && !SPM.isSubProcess(step)) targets.push(step);
  for (const v of SPM.levelVisits(transactions, path)) {
    for (const s of v.visible) {
      if (mapNodeLabel(s) === node && !SPM.isSubProcess(s) && !targets.includes(s)) targets.push(s);
    }
  }
  let subSteps = 0;
  for (const s of targets) {
    s.sub_steps = draftSubSteps(s, interactionsById, opts);
    subSteps += s.sub_steps.length;
    AC.markEdited(s);
  }
  return { steps: targets, subSteps };
}

/* ---- Group into a sub-process ------------------------------------------------- */

function _span(members) {
  const timed = members.filter((s) => AC.hasTime(s));
  if (!timed.length) return null;
  const last = timed[timed.length - 1].time_range;
  return { start: timed[0].time_range.start, end: last.end || last.start };
}

/* A group (C19) around `members` (in order, hidden ones included). */
function _group(members, opts) {
  const o = opts || {};
  const first = members[0];
  const name = _t(o.name);
  const g = {
    step_id: _newId(o),
    session_id: first.session_id || o.sessionId || "",
    case_id: first.case_id != null ? first.case_id : null,
    name,
    description: "",
    time_range: _span(members),
    evidence: {
      interaction_event_ids: members.flatMap((s) => (s.evidence && s.evidence.interaction_event_ids) || []),
      screenshot_refs: members.flatMap((s) => (s.evidence && s.evidence.screenshot_refs) || []),
      video_timecode_range: null,
      manual_notes: "",
    },
    state: "manually_authored",
    group: true,
    canonical_step_id: null,
    flags: { waste: false },
    phase_id: null,
    // No draft_key: its node is the main rule's (C19).
    process_label: processLabel(name) || name,
  };
  if (!g.time_range && typeof first.order === "number" && Number.isFinite(first.order)) g.order = first.order;
  const systems = new Set(members.filter((s) => s.state !== "hidden")
    .map((s) => _t(typeof o.systemOf === "function" ? o.systemOf(s) : s.system)).filter(Boolean));
  if (systems.size === 1) g.system = [...systems][0];
  return g;
}

/* Keep each (to, when) once and drop a link to the step's own id. A link
   kept once for several members (lane FX2) remembers every member it was
   lifted from. */
function _cleanLinks(stepId, links) {
  const out = [];
  for (const l of links || []) {
    if (!l || typeof l.to !== "string" || !l.to || l.to === stepId) continue;
    const same = out.find((x) => x.to === l.to && _line(x.when) === _line(l.when));
    if (same) {
      const from = _liftedFrom(l);
      if (from.length) {
        const i = out.indexOf(same);
        out[i] = Object.assign({}, same, { lifted_from: [...new Set(_liftedFrom(same).concat(from))] });
      }
      continue;
    }
    out.push(l);
  }
  return out;
}

/* Lane FX2 (validation pass 2, F5): Group remembers where a link it moves
   came from, so Dissolve gives it back there. On a link the group took from
   a member: `lifted_from`, the member's step id (the members', when two had
   the same link); on a link it pointed at the group instead of a member:
   `pointed_to`, that member's step id. Readers of the flow read `to` and
   `when` only (C17), so both keys ride along unread until Dissolve. */
function _liftedFrom(link) {
  return Array.isArray(link && link.lifted_from) ? link.lifted_from.filter((id) => typeof id === "string" && id) : [];
}
function _without(link, key) {
  const out = Object.assign({}, link);
  delete out[key];
  return out;
}
function _setLinks(step, links) { if (links.length) step.links = links; else delete step.links; }

/**
 * Group into a sub-process (C19). The ticked steps must be two or more
 * consecutive visible steps of one place at level `path` (one transaction at
 * the main level, one visit below it); they move, with any hidden steps
 * between them, into a new group in their place. In every transaction, each
 * other stretch of consecutive visible steps whose nodes are all among the
 * ticked steps' nodes becomes an occurrence of the same group. Links: a link
 * from outside to a grouped step points at its group; a grouped step's link
 * that leaves its group (to a step outside it, or to End) moves to the
 * group; links among its members stay.
 * @param {Array} root  annotations.steps (the lists that change are in it)
 * @param {Array<Array>} transactions  each transaction's main-level steps
 * @param {string[]} path  the level
 * @param {string[]} tickedIds
 * @param {{name: string, newId?: Function, sessionId?: string, systemOf?: Function}} opts
 * @returns {{error?: string, groups?: Array, transactions?: number}}
 *   error: "none" (no ticked step here), "places" (in more than one place),
 *   "hidden" (a ticked step is hidden), "few" (fewer than two) or "gap" (not
 *   one after the other).
 */
function groupInto(root, transactions, path, tickedIds, opts) {
  const check = groupCheck(transactions, path, tickedIds);
  if (check.error) return { error: check.error };
  const made = check.stretches.map((st) => {
    const m = st.pl.members;
    const members = m.slice(m.indexOf(st.pl.visible[st.a]), m.indexOf(st.pl.visible[st.b]) + 1);
    return { group: _group(members, opts), members, t: st.pl.t, ticked: st.ticked };
  });
  const groupOf = new Map();
  for (const x of made) for (const s of x.members) groupOf.set(s.step_id, x.group);

  // Links from outside a group to its members point at the group, and
  // remember the member (pointed_to, lane FX2).
  const toGroup = (l) => Object.assign({}, l, { to: groupOf.get(l.to).step_id, pointed_to: l.to });
  for (const s of SPM.allSteps(root)) {
    if (groupOf.has(s.step_id) || !Array.isArray(s.links) || !s.links.some((l) => l && groupOf.has(l.to))) continue;
    const next = s.links.map((l) => (l && groupOf.has(l.to) ? toGroup(l) : l));
    _setLinks(s, _cleanLinks(s.step_id, next));
  }
  // A member's link that leaves its group moves to the group, and remembers
  // the member it came from (lifted_from, lane FX2).
  for (const x of made) {
    const own = new Set(x.members.map((s) => s.step_id));
    const moved = [];
    for (const s of x.members) {
      if (!Array.isArray(s.links)) continue;
      const keep = s.links.filter((l) => l && own.has(l.to));
      for (const l of s.links) if (l && !own.has(l.to)) moved.push(Object.assign({}, l, { lifted_from: [s.step_id] }));
      if (keep.length !== s.links.length) _setLinks(s, keep);
    }
    const out = moved.map((l) => (groupOf.has(l.to) ? toGroup(l) : l));
    _setLinks(x.group, _cleanLinks(x.group.step_id, out));
  }

  // Each group takes its first member's place; the members move into it.
  for (const x of made) {
    const loc = SPM.findStep(root, x.members[0].step_id);
    if (loc) loc.list.splice(loc.index, 0, x.group);
    else root.push(x.group);
    SPM.removeSteps(root, new Set(x.members.map((s) => s.step_id)));
    x.group.sub_steps = x.members;
  }
  return { groups: made.map((x) => x.group), ticked: (made.find((x) => x.ticked) || {}).group || null,
    transactions: new Set(made.map((x) => x.t)).size };
}

/* Whether the ticked steps can be grouped (groupInto's rule), before the
   name is asked: { error } (see groupInto), or { stretches, groups,
   transactions } where each stretch is { pl (the place, as levelVisits
   gives it), a, b (its first and last visible index), ticked } and
   transactions counts the transactions that get a group. */
function groupCheck(transactions, path, tickedIds) {
  const ids = new Set(tickedIds || []);
  const places = SPM.levelVisits(transactions, path);
  const home = places.filter((p) => p.members.some((s) => ids.has(s.step_id)));
  if (!home.length) return { error: "none" };
  if (home.length > 1) return { error: "places" };
  const place = home[0];
  const ticked = place.members.filter((s) => ids.has(s.step_id));
  if (ticked.length !== ids.size) return { error: "places" };
  const idx = ticked.map((s) => place.visible.indexOf(s)).sort((a, b) => a - b);
  if (idx.some((i) => i < 0)) return { error: "hidden" };
  if (idx.length < 2) return { error: "few" };
  if (idx[idx.length - 1] - idx[0] !== idx.length - 1) return { error: "gap" };
  const nodes = new Set(ticked.map(mapNodeLabel));
  // The ticked stretch, and every other stretch of the same kinds of steps.
  const stretches = [];
  for (const pl of places) {
    const v = pl.visible;
    const taken = pl === place ? [idx[0], idx[idx.length - 1]] : null;
    let i = 0;
    while (i < v.length) {
      if (taken && i === taken[0]) { stretches.push({ pl, a: taken[0], b: taken[1], ticked: true }); i = taken[1] + 1; continue; }
      if (!nodes.has(mapNodeLabel(v[i]))) { i++; continue; }
      let j = i;
      while (j + 1 < v.length && nodes.has(mapNodeLabel(v[j + 1])) && !(taken && j + 1 === taken[0])) j++;
      stretches.push({ pl, a: i, b: j, ticked: false });
      i = j + 1;
    }
  }
  return { stretches, groups: stretches.length, transactions: new Set(stretches.map((s) => s.pl.t)).size };
}

function _count(n, one, many) { return n + " " + (n === 1 ? one : many); }
const _WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function _say(n) { return _WORDS[n] || String(n); }

/* What Group into a sub-process will do, said before it is done (lane FX2,
   validation pass 2, F16): how many ticked steps, where the same steps are
   grouped too, how many groups that makes, and where a group takes another
   number of steps than the ticked ones (the same steps one after the other
   there). `check`: groupCheck's answer (no error); `ticked`: how many steps
   are ticked. The places are transactions at the main level, and a
   transaction's visits of a sub-process below it (their `t`). Pure. */
function groupPromptText(check, ticked) {
  const stretches = (check && check.stretches) || [];
  const mine = stretches.find((st) => st.ticked) || null;
  const others = stretches.filter((st) => !st.ticked);
  const size = (st) => st.b - st.a + 1;
  let text = "Groups these " + _count(ticked, "step", "steps");
  if (others.length) {
    const home = mine ? mine.pl.t : -1;
    const txs = new Set(others.map((st) => st.pl.t));
    const where = others.length === txs.size && !txs.has(home)
      ? _count(txs.size, "other transaction", "other transactions")
      : _count(others.length, "other place", "other places") +
        (txs.size === 1 && txs.has(home) ? " of this transaction" : ", in " + _count(txs.size, "transaction", "transactions"));
    text += " and the same steps in " + where;
  }
  text += " (" + _count(stretches.length || 1, "group", "groups") + ").";
  const odd = others.filter((st) => size(st) !== ticked)
    .map((st) => "In transaction " + (st.pl.t + 1) + " a group takes " + _say(size(st)) + " steps, the same steps one after the other there.");
  return odd.length ? text + " " + odd.join(" ") : text;
}

/* ---- Dissolve sub-process ------------------------------------------------------ */

/* The sub-process occurrences of `node` at level `path` (hidden ones too). */
function _dissolveTargets(transactions, path, node) {
  return SPM.levelStepsOfNode(transactions, path, node).filter(SPM.isSubProcess);
}

/* A description the analyst wrote: one that is not empty and is not the one
   the drafting gave the step. */
function _written(step, interactionsById) {
  const d = _t(step && step.description);
  if (!d) return false;
  if (step.action_key) return d !== _t(draftedAction(step, interactionsById).description);
  return true;
}

/* What a dissolve of `node` at level `path` takes away: a group gives every
   sub-step back, an opened step drops its sub-steps at every depth, with the
   descriptions the analyst wrote on them and their flow (their conditions
   and links). { occurrences, groups, opened, subSteps, descriptions, flow } */
function dissolveLoss(transactions, path, node, interactionsById) {
  const out = { occurrences: 0, groups: 0, opened: 0, subSteps: 0, descriptions: 0, flow: 0 };
  for (const s of _dissolveTargets(transactions, path, node)) {
    out.occurrences++;
    if (s.group === true) { out.groups++; continue; }
    out.opened++;
    for (const d of SPM.descendants(s)) {
      out.subSteps++;
      if (_written(d, interactionsById)) out.descriptions++;
      if (StepFlow.onlyWhen(d)) out.flow++;
      out.flow += StepFlow.links(d).length;
    }
  }
  return out;
}

/* Point every link to `fromId` (at any level) at `toId`, or drop it when
   toId is null. A link that pointed at a member before Group (pointed_to,
   lane FX2) goes back to that member when `back` has it. */
function _retarget(root, fromId, toId, back) {
  for (const s of SPM.allSteps(root)) {
    if (!Array.isArray(s.links) || !s.links.some((l) => l && l.to === fromId)) continue;
    const target = (l) => (back && back.has(l.pointed_to) ? l.pointed_to : toId);
    const next = s.links.filter((l) => l && (l.to !== fromId || target(l)))
      .map((l) => (l.to === fromId ? _without(Object.assign({}, l, { to: target(l) }), "pointed_to") : l));
    _setLinks(s, _cleanLinks(s.step_id, next));
  }
}

/* The analyst's screenshots, notes and attachments on the steps `fromIds`
   move to the step `toId`. */
function _moveContent(anno, fromIds, toId) {
  for (const key of ["analyst_screenshots", "analyst_notes", "attachments"]) {
    for (const x of Array.isArray(anno[key]) ? anno[key] : []) {
      if (x && fromIds.has(x.step_id)) x.step_id = toId;
    }
  }
}

function _dissolveGroup(anno, transactions, path, g) {
  const root = anno.steps;
  const loc = SPM.findStep(root, g.step_id);
  if (!loc) return;
  const subs = SPM.inOrder(g.sub_steps);
  const vis = subs.filter((s) => s.state !== "hidden");
  const first = vis[0] || subs[0] || null;
  const last = vis[vis.length - 1] || subs[subs.length - 1] || null;
  // The step that followed the group at its level (End when it was last).
  const place = SPM.placeOf(transactions, path, g.step_id);
  const at = place ? place.visible.indexOf(g) : -1;
  const after = at >= 0 && at + 1 < place.visible.length ? place.visible[at + 1].step_id : StepFlow.END;
  // A link to the group points at the member it pointed at before Group
  // (lane FX2), else at its first sub-step.
  const members = new Set(subs.map((s) => s.step_id));
  _retarget(root, g.step_id, first ? first.step_id : null, members);
  // A sub-step's link to End points at the step that followed the group.
  if (after !== StepFlow.END) {
    for (const s of subs) {
      if (!Array.isArray(s.links)) continue;
      _setLinks(s, _cleanLinks(s.step_id, s.links.map((l) => (l && l.to === StepFlow.END ? Object.assign({}, l, { to: after }) : l))));
    }
  }
  if (first) {
    // Its Only when goes to its first sub-step; a link it took from a member
    // goes back to that member (lane FX2), and its own links to its last.
    const cond = StepFlow.onlyWhen(g);
    if (cond) first.only_when = StepFlow.onlyWhen(first) ? cond + " and " + StepFlow.onlyWhen(first) : cond;
    const back = new Map();
    for (const l of StepFlow.links(g)) {
      const from = _liftedFrom(l).filter((id) => members.has(id));
      for (const id of from.length ? from : last ? [last.step_id] : []) {
        back.set(id, (back.get(id) || []).concat([_without(l, "lifted_from")]));
      }
    }
    for (const s of subs) {
      if (back.has(s.step_id)) _setLinks(s, _cleanLinks(s.step_id, StepFlow.links(s).concat(back.get(s.step_id))));
    }
    // What the analyst put on the group goes to its first sub-step.
    _moveContent(anno, new Set([g.step_id]), first.step_id);
    const desc = _t(g.description);
    if (desc) first.description = _t(first.description) ? _t(first.description) + "\n\n" + desc : desc;
    if (g.pdd_screenshot && !first.pdd_screenshot) first.pdd_screenshot = g.pdd_screenshot;
    if (g.flags && g.flags.waste === true) first.flags = Object.assign({}, first.flags, { waste: true });
  }
  // Untimed sub-steps take the group's place among the untimed steps.
  const untimed = subs.filter((s) => !AC.hasTime(s));
  if (untimed.length && typeof g.order === "number" && Number.isFinite(g.order)) {
    const shift = untimed.length - 1;
    for (const s of loc.list) {
      if (s !== g && s.case_id === g.case_id && !AC.hasTime(s) && typeof s.order === "number" && s.order > g.order) s.order += shift;
    }
    untimed.forEach((s, k) => { s.order = g.order + k; });
  }
  loc.list.splice(loc.list.indexOf(g), 1, ...subs);
}

/* Dissolve sub-process (C19), in every transaction, every occurrence of
   `node` at level `path`: a group is replaced by its sub-steps in place (see
   _dissolveGroup for the links, the condition and the content), an opened
   step loses its sub_steps and the analyst's screenshots, notes and
   attachments on them move to the step. Returns { groups, opened }. */
function dissolve(anno, transactions, path, node) {
  let groups = 0, opened = 0;
  for (const s of _dissolveTargets(transactions, path, node)) {
    if (s.group === true) {
      _dissolveGroup(anno, transactions, path, s);
      groups++;
    } else {
      _moveContent(anno, new Set(SPM.descendants(s).map((d) => d.step_id)), s.step_id);
      delete s.sub_steps;
      opened++;
    }
  }
  return { groups, opened };
}

/* ---- A moment on the clock (+ Step at the playhead) ------------------------------ */

/* Where + Step at the moment `t` (ms) goes (lane FX2, validation pass 3,
   F15): { kind: "split", list, index, parent } when a step with a time holds
   the moment (it is split there), else { kind: "open", list, parent } (a new
   step from the moment on, in `list`). A sub-process holding the moment is
   entered (C19: its steps take the moment, never the sub-process itself), at
   any depth: `parent` is the sub-process whose sub_steps `list` is, null at
   the main level. So a sub-step gets a time the way a main-level step does. */
function momentPlace(steps, t) {
  let list = Array.isArray(steps) ? steps : [], parent = null;
  for (;;) {
    const i = list.findIndex((s) => s && s.time_range &&
      Date.parse(s.time_range.start) < t && Date.parse(s.time_range.end) > t);
    if (i < 0) return { kind: "open", list, parent };
    const s = list[i];
    if (!SPM.isSubProcess(s)) return { kind: "split", list, index: i, parent };
    parent = s;
    list = s.sub_steps;
  }
}

/* ---- Rename ------------------------------------------------------------------- */

/* A sub-process renamed (C19): every other step of its node at level `path`
   takes the name, whatever its state, so the node and its map stay one. A
   draft keeps its state (its name is a saved one); another step becomes the
   analyst's (AC.markEdited). Returns how many steps took the name. */
function renameNode(transactions, path, node, name, except) {
  const nm = _t(name);
  if (!nm) return 0;
  let n = 0;
  for (const s of SPM.levelStepsOfNode(transactions, path, node)) {
    if (s === except) continue;
    s.name = nm;
    s.process_label = (s.draft_key || s.action_key) ? nm : (processLabel(nm) || nm);
    if (DRAFT_STATES.has(s.state)) s.name_source = "remembered";
    else AC.markEdited(s);
    n++;
  }
  return n;
}

module.exports = {
  actionOf, actionsOf, eventPrefix, parentPrefix, draftSubSteps, draftedAction, projectActionNames,
  openAsSubProcess, groupCheck, groupPromptText, groupInto, dissolveLoss, dissolve, renameNode, momentPlace,
};
