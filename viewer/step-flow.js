/*
 * step-flow.js: the step flow the analyst sets on a step (contract C17), the
 * pure half. A step may carry `only_when` (a condition: the step happens only
 * then) and `links` ([{ to: step_id | "end", when }]: after the step, when
 * the condition holds, the process goes back to an earlier step, skips to a
 * later one or ends). Here: what the step pane's Flow line and the step panel
 * say, the steps a link can go to, the edits, and the repairs when a target
 * step is hidden, removed, merged or split. No DOM, no State:
 * views/steps-view.js, step-editor.js and views/step-panel.js use it; the
 * unit tests drive it. The map's edges are process-map-levels.js's.
 */

"use strict";

const { stepLinks } = require("./process-map-levels.js");

/* A link's `to` for the end of the process. */
const END = "end";

const DEFAULT_LINE = "Then: the next step";

/* The analyst's text as one line, whitespace collapsed, as the map and the
   pipeline read it. */
function _text(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

/* The step's condition, or "". */
function onlyWhen(step) { return _text(step && step.only_when); }

/* The step's links (C17), the well-formed ones. */
function links(step) { return stepLinks(step); }

/* Nothing set on the step: the Flow line reads DEFAULT_LINE. */
function isDefault(step) { return !onlyWhen(step) && !links(step).length; }

/* ---- Where a link goes ---------------------------------------------------- */

/* The Flow line of a step with nothing set, naming where the process goes
   next (2.0.1): "Then: Save order", "Then: the end". */
function nextLine(list, step) {
  const steps = list || [];
  const i = steps.findIndex((s) => s && step && s.step_id === step.step_id);
  if (i < 0) return DEFAULT_LINE;
  const next = steps[i + 1];
  return next ? "Then: " + (_text(next.name) || "(unnamed step)") : "Then: the end";
}

/* The steps a link of `step` can go to: the transaction's steps in order
   (`list`: its visible steps, as the Steps list shows them), numbered from 1,
   the step itself left out, each an earlier one (`kind` "back") or a later
   one ("ahead"); then `others`, the process's steps this transaction did not
   do ([{ value, name }], "other", 2.0.1: the other side of a choice).
   [{ value: step_id, number, name, label, kind }] */
function linkChoices(list, step, others) {
  const out = [];
  const at = (list || []).findIndex((s) => s && step && s.step_id === step.step_id);
  (list || []).forEach((s, i) => {
    if (!s || !step || s.step_id === step.step_id) return;
    const name = _text(s.name) || "(unnamed step)";
    out.push({ value: s.step_id, number: i + 1, name, label: (i + 1) + ". " + name,
      kind: at >= 0 && i < at ? "back" : "ahead" });
  });
  for (const o of others || []) {
    if (!o || !o.value || out.some((c) => c.value === o.value)) continue;
    const name = _text(o.name) || "(unnamed step)";
    out.push({ value: o.value, number: null, name, label: name, kind: "other" });
  }
  return out;
}

/* Where `link` of `step` goes in the transaction `list`:
     { kind: "end" }                         the end of the process
     { kind: "back" | "next" | "skip", number, name }   an earlier step, the
                                             step right after, a later one
     { kind: "to", number, name }            a step of the list while the
                                             step itself is not in it (hidden)
     { kind: "other", name }                 a step of the process this
                                             transaction did not do (`others`,
                                             a Map of step_id to name)
     { kind: "missing" }                     a step no longer in the list */
function linkPlace(list, step, link, others) {
  if (link && link.to === END) return { kind: "end" };
  const steps = list || [];
  const t = steps.findIndex((s) => s && link && s.step_id === link.to);
  if (t < 0) {
    const name = others && link && typeof others.get === "function" ? _text(others.get(link.to)) : "";
    return name ? { kind: "other", name } : { kind: "missing" };
  }
  if (step && steps[t].step_id === step.step_id) return { kind: "missing" };
  const name = _text(steps[t].name) || "(unnamed step)";
  const i = steps.findIndex((s) => s && step && s.step_id === step.step_id);
  const kind = i < 0 ? "to" : t < i ? "back" : t === i + 1 ? "next" : "skip";
  return { kind, number: t + 1, name };
}

const VERB = { back: "Goes back to", next: "Goes on to", skip: "Skips to", to: "Goes to" };

/* The sentence a link row reads: "Goes back to step 4, Enter the sales order
   in SAP, when the check fails", "Skips to step 6, ..., when ...", "Ends here
   when ...". Without its `when` the sentence stops before it. */
function linkReading(list, step, link, others) {
  const p = linkPlace(list, step, link, others);
  const when = _text(link && link.when);
  if (p.kind === "end") return "Ends here" + (when ? " when " + when : "");
  if (p.kind === "other") return "Goes to " + p.name + (when ? ", when " + when : "");
  if (p.kind === "missing") return "Goes to a step no longer in this transaction" + (when ? ", when " + when : "");
  return VERB[p.kind] + " step " + p.number + ", " + p.name + (when ? ", when " + when : "");
}

/* The short form (the step panel): "Goes back to step 2 when the check fails". */
function linkShort(list, step, link, others) {
  const p = linkPlace(list, step, link, others);
  const when = _text(link && link.when);
  const head = p.kind === "end" ? "Ends here"
    : p.kind === "other" ? "Goes to " + p.name
    : p.kind === "missing" ? "Goes to a step no longer in this transaction"
      : VERB[p.kind] + " step " + p.number;
  return head + (when ? " when " + when : "");
}

/* A condition holds for its step's box in every transaction (C17), so a step
   with none of its own takes the one set on the same step elsewhere:
   `inherited` is [{ text, where }] (where: the transaction's title). The
   Flow line then reads "Only when X (set in Transaction 1) · then the next
   step"; "" when there is none. */
function inheritedLine(inherited) {
  const list = (inherited || []).filter((x) => x && _text(x.text));
  if (!list.length) return "";
  const where = new Set(list.map((x) => x.where));
  return "Only when " + list.map((x) => _text(x.text)).join(" or ") +
    " (set in " + (where.size === 1 ? list[0].where : "other transactions") + ") · then the next step";
}

/* The step panel's one line: "Only when X · Goes back to step 2 when Y", or
   "" when nothing is set. The panel shows a map box, so `conditions` (when
   given) are the ones set on any of its steps; the links are the step's. */
function panelLine(list, step, conditions, others) {
  const conds = Array.isArray(conditions) ? conditions.map(_text).filter(Boolean) : [onlyWhen(step)].filter(Boolean);
  const parts = [];
  if (conds.length) parts.push("Only when " + [...new Set(conds)].join(" or "));
  for (const l of links(step)) parts.push(linkShort(list, step, l, others));
  return parts.join(" · ");
}

/* ---- Edits (each returns true when the step changed) ---------------------- */

/* The condition, or none for an empty text. */
function setOnlyWhen(step, text) {
  const v = _text(text);
  if (!step || v === onlyWhen(step)) return false;
  if (v) step.only_when = v; else delete step.only_when;
  return true;
}

function _setLinks(step, list) {
  if (list.length) step.links = list; else delete step.links;
}

/* A link to `to` (a step_id other than the step's own, or END). */
function addLink(step, to, when) {
  if (!step || typeof to !== "string" || !to || to === step.step_id) return false;
  _setLinks(step, links(step).concat([{ to, when: _text(when) }]));
  return true;
}

/* Link `i` goes to `to` instead. */
function setLinkTarget(step, i, to) {
  const list = links(step);
  if (!list[i] || typeof to !== "string" || !to || to === step.step_id || list[i].to === to) return false;
  list[i] = Object.assign({}, list[i], { to });
  // It goes elsewhere now: the member it pointed at before a Group is not its
  // target any more (sub-process-verbs.js, lane FX2).
  delete list[i].pointed_to;
  _setLinks(step, list);
  return true;
}

/* Link `i` holds when `when`. */
function setLinkWhen(step, i, when) {
  const list = links(step);
  const v = _text(when);
  if (!list[i] || _text(list[i].when) === v) return false;
  list[i] = Object.assign({}, list[i], { when: v });
  _setLinks(step, list);
  return true;
}

function removeLink(step, i) {
  const list = links(step);
  if (!list[i]) return false;
  list.splice(i, 1);
  _setLinks(step, list);
  return true;
}

/* ---- Repairs ---------------------------------------------------------------- */

/* Every step of `steps` and of their sub_steps (contract C19: a link stays
   inside its level, and step ids are unique, so a repair over the whole tree
   is a repair per level). */
function _tree(steps) {
  const out = [];
  const walk = (list) => {
    for (const st of Array.isArray(list) ? list : []) {
      if (!st || typeof st !== "object") continue;
      out.push(st);
      if (Array.isArray(st.sub_steps)) walk(st.sub_steps);
    }
  };
  walk(steps);
  return out;
}

/* A target step hidden or removed (C17, Removal): the links pointing at one
   of `ids` are dropped, at every level. Returns [{ step, link }], the links
   dropped. */
function dropLinksTo(steps, ids) {
  const gone = ids instanceof Set ? ids : new Set(ids || []);
  const dropped = [];
  for (const st of _tree(steps)) {
    if (!Array.isArray(st.links)) continue;
    const keep = st.links.filter((l) => !(l && gone.has(l.to)));
    if (keep.length === st.links.length) continue;
    for (const l of st.links) if (l && gone.has(l.to)) dropped.push({ step: st, link: l });
    _setLinks(st, keep);
  }
  return dropped;
}

/* Steps merged into one: `idMap` maps each merged step's id to the merged
   step's, and a link to one of them goes to the merged step, at every level.
   A link that would then point at its own step is dropped, and a link
   repeated by the merge is kept once. Returns the number of links dropped. */
function retargetLinks(steps, idMap) {
  let dropped = 0;
  for (const st of _tree(steps)) {
    if (!Array.isArray(st.links)) continue;
    const out = [];
    let changed = false;
    for (const l of st.links) {
      if (!l) { changed = true; continue; }
      const to = idMap.has(l.to) ? idMap.get(l.to) : l.to;
      if (to === st.step_id) { dropped += 1; changed = true; continue; }
      if (out.some((x) => x.to === to && _text(x.when) === _text(l.when))) { changed = true; continue; }
      if (to !== l.to) changed = true;
      out.push(to === l.to ? l : Object.assign({}, l, { to }));
    }
    if (changed) _setLinks(st, out);
  }
  return dropped;
}

/* A step split in two: the condition stays on the first half (it says when
   the step starts) and the links go to the second (they say where the
   process goes after the step). Both halves are copies of the step. */
function splitFlow(first, second) {
  if (first) delete first.links;
  if (second) delete second.only_when;
}

/* The links of steps merged into one, in their order: they leave the merged
   step (retargetLinks then points links among them at it, or drops them). */
function mergedLinks(members) {
  const out = [];
  for (const s of members || []) for (const l of links(s)) out.push(Object.assign({}, l));
  return out;
}

module.exports = {
  END, DEFAULT_LINE, onlyWhen, links, isDefault, nextLine,
  linkChoices, linkPlace, linkReading, linkShort, inheritedLine, panelLine,
  setOnlyWhen, addLink, setLinkTarget, setLinkWhen, removeLink,
  dropLinksTo, retargetLinks, splitFlow, mergedLinks,
};
