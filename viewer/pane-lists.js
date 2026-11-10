"use strict";

/*
 * pane-lists.js: what the Timeline's pane lists (lane PANE, plan section
 * 11.2), the pure side; pane-lists.test.js drives it. The pane itself, its
 * tabs and its rows on screen, is views/timeline-pane.js.
 *
 * The Steps tab: every visible step of the main level in the order of the
 * process (runs-model.js buildRuns already holds each transaction's steps in
 * step-order.js processOrder), the steps without a time too. In a project
 * with marked transactions they are grouped under each transaction, the
 * reference transaction first, then the others in their order, then the
 * steps outside every transaction; a project of one transaction no marker
 * starts (C16) and a recording with none marked show one list.
 * A row says the step's number in its group, its name, its system (or "No
 * system yet") with what it still lacks, the Draft chip on a draft, and when
 * it starts.
 * The Notes tab: every note in the order of the clock. The Files tab: every
 * attached file.
 *
 * No DOM, no State: what it cannot read from the steps (a step's system,
 * whether its description is only the recorder's narration, the clock text
 * of a moment) is passed in.
 */

const RunsModel = require("./runs-model.js");
const Readiness = require("./readiness.js");
const AC = require("./analyst-content.js");

/* The words of the pane (lane PANE: the brief's text, word for word). */
const WORDS = {
  noSystem: "No system yet",
  noName: "no name yet",
  noDescription: "no description yet",
  noTime: "no time yet",
  open: "open",
  draft: "Draft",
  onStep: "On the step: ",
  atMoment: "At a moment, on no step",
  onProject: "On the whole project",
};

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

function _visible(list) { return (Array.isArray(list) ? list : []).filter((s) => s && typeof s === "object" && s.state !== "hidden"); }

/* Whether the project's transactions are marked: more than the one a
   project without a recording has until a Start is marked (its
   `implicitId`, analyst-content.js implicitRunId). */
function transactionsMarked(runs, implicitId) {
  const list = Array.isArray(runs) ? runs : [];
  if (!list.length) return false;
  return !(list.length === 1 && implicitId && list[0].caseId === implicitId);
}

/* The groups of the Steps tab: [{ key, run, isRef, steps }], `steps` the
   group's visible steps in the order of the process. `model` is
   RunsModel.buildRuns's { runs, outside }; `refCaseId` the reference
   transaction's case_id (null without one); `implicitId` as
   transactionsMarked. Unmarked: one group, key null, run null, every
   visible step (the transactions' in order, then those outside). */
function stepGroups(model, refCaseId, implicitId) {
  const m = model || {};
  const runs = Array.isArray(m.runs) ? m.runs : [];
  const outside = _visible(m.outside);
  if (!transactionsMarked(runs, implicitId)) {
    const steps = runs.flatMap((r) => _visible(r.visible || r.members)).concat(outside);
    return steps.length || runs.length ? [{ key: null, run: null, isRef: false, steps }] : [];
  }
  const ref = runs.find((r) => r.caseId === refCaseId) || null;
  const ordered = ref ? [ref].concat(runs.filter((r) => r !== ref)) : runs.slice();
  const out = ordered.map((r) => ({ key: r.caseId, run: r, isRef: r === ref && runs.length >= 2, steps: _visible(r.visible || r.members) }));
  if (outside.length) out.push({ key: "__outside__", run: null, isRef: false, steps: outside });
  return out;
}

/* Every step the Steps tab lists, in the tab's order. */
function listedSteps(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((g) => g.steps);
}

/* Whether a step has no name of its own yet: still "Step N" (what Add step
   and + Add step give, readiness.js hasNoOwnName), empty, or a drafted name
   nobody confirmed (a draft). */
function noNameYet(step) {
  return !!step && (Readiness.hasNoOwnName(step) || RunsModel.DRAFT_STATES.has(step.state));
}

/* Whether a step has no description yet: none, or only the recorder's
   narration (`narration`, step-facts.js isDraftedDescription), which the PDD
   leaves out. */
function noDescriptionYet(step, narration) {
  return !!step && (!_text(step.description) || !!narration);
}

/* The line under a row's name: the system, else "No system yet", then
   " · no name yet" and " · no description yet" where they apply. */
function metaLine(step, system, narration) {
  return (_text(system) || WORDS.noSystem) +
    (noNameYet(step) ? " · " + WORDS.noName : "") +
    (noDescriptionYet(step, narration) ? " · " + WORDS.noDescription : "");
}

/* When a row's step starts: its start on the one clock ("6:20"), "6:20 ·
   open" for the step being marked (nothing after it yet), "no time yet" for
   a step without a time. `startText`: the start as the clock reads it. */
function whenText(step, startText, open) {
  if (!AC.hasTime(step) || !_text(startText)) return WORDS.noTime;
  return startText + (open ? " · " + WORDS.open : "");
}

/* Whether a row offers Starts here: a step without a time that can be given
   one (analyst-content.js stepTimePlaceable), in a project with a video, not
   read only. */
function offersStartsHere(step, ctx) {
  const c = ctx || {};
  return !!c.hasVideo && !c.readOnly && AC.stepTimePlaceable(step);
}

/* A row of the Steps tab: { id, num, name, meta, draft, when, startsHere }.
   `look`: systemOf(step), narration(step), startText(step), isOpen(step);
   `ctx`: as offersStartsHere. */
function stepRow(step, index, look, ctx) {
  const l = look || {};
  const call = (fn, d) => (typeof fn === "function" ? fn(step) : d);
  return {
    id: step.step_id,
    num: index + 1,
    name: _text(step.name) || "(unnamed step)",
    meta: metaLine(step, call(l.systemOf, ""), call(l.narration, false)),
    draft: RunsModel.DRAFT_STATES.has(step.state),
    when: whenText(step, call(l.startText, ""), call(l.isOpen, false)),
    startsHere: offersStartsHere(step, ctx),
  };
}

/* How many listed steps have no time, and the one hint line under the
   tab's acts (lane PANE, the brief's text), "" when none applies. */
function untimedCount(steps) {
  return (Array.isArray(steps) ? steps : []).filter((s) => s && !AC.hasTime(s)).length;
}
function stepsHint(ctx) {
  const c = ctx || {};
  const total = Number(c.total) || 0;
  const untimed = Number(c.untimed) || 0;
  if (!total) {
    if (c.recorded) return "";
    return c.hasVideo
      ? "No steps yet. Play the video and click Add step where each step starts, or paste your notes."
      : "No steps yet. Add step adds one, and Paste notes... adds one for each line of your notes.";
  }
  if (c.hasVideo && untimed > 0) {
    return (untimed === 1 ? "1 step has" : untimed + " steps have") +
      " no time yet. Go to the moment a step starts in the video, then click Starts here on that step.";
  }
  return "";
}

/* The acts above the Steps tab's list: Paste notes... (not read only), Add
   step (no video and no recording, not read only), Confirm transaction and
   Undo confirm (where Steps offers them: `canConfirm`, `canUndoConfirm`, a
   recording, not read only). */
function listActs(ctx) {
  const c = ctx || {};
  const ro = !!c.readOnly;
  return {
    pasteNotes: !ro,
    addStep: !ro && !c.hasVideo && !c.recorded,
    confirm: !ro && !!c.recorded && !!c.canConfirm,
    undoConfirm: !ro && !!c.recorded && !!c.canUndoConfirm,
  };
}

/* Where an opened step is in its group: { index, count, prevId, nextId }
   (Previous and Next: the steps before and after it; null at the ends), or
   null when the group does not hold it. */
function neighbours(steps, stepId) {
  const list = Array.isArray(steps) ? steps : [];
  const i = list.findIndex((s) => s && s.step_id === stepId);
  if (i < 0) return null;
  return {
    index: i, count: list.length,
    prevId: i > 0 ? list[i - 1].step_id : null,
    nextId: i < list.length - 1 ? list[i + 1].step_id : null,
  };
}

/* The group that holds a step, or null. */
function groupOf(groups, stepId) {
  return (Array.isArray(groups) ? groups : []).find((g) => g.steps.some((s) => s && s.step_id === stepId)) || null;
}

/* The step at the moment `ms` of the clock: the first listed step with a
   time whose span holds it, else null. */
function stepAt(steps, ms) {
  if (!Number.isFinite(ms)) return null;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || !AC.hasTime(s)) continue;
    const a = Date.parse(s.time_range.start), b = Date.parse(s.time_range.end);
    if (Number.isFinite(a) && ms >= a && (Number.isFinite(b) ? ms < b || (b === a && ms === a) : true)) return s;
  }
  return null;
}

/* A note's moment in ms: its own, else its step's start; NaN without one. */
function noteMs(note, stepOf) {
  const own = Date.parse(note && note.at);
  if (Number.isFinite(own)) return own;
  const st = note && note.step_id && typeof stepOf === "function" ? stepOf(note.step_id) : null;
  return st && AC.hasTime(st) ? Date.parse(st.time_range.start) : NaN;
}

/* The rows of the Notes tab, in the order of the clock (a note without a
   moment last, in the order it was added): [{ id, ms, text, where,
   stepId }]. `stepOf(id)`: the step of that id, or null. */
function noteRows(notes, stepOf) {
  const list = (Array.isArray(notes) ? notes : []).filter((n) => n && n.id && _text(n.text));
  const rows = list.map((n, i) => {
    const st = n.step_id && typeof stepOf === "function" ? stepOf(n.step_id) : null;
    return {
      id: n.id, ms: noteMs(n, stepOf), text: _text(n.text), i,
      stepId: st ? st.step_id : null,
      where: st ? WORDS.onStep + (_text(st.name) || "(unnamed step)") : WORDS.atMoment,
    };
  });
  rows.sort((a, b) => {
    const x = Number.isFinite(a.ms), y = Number.isFinite(b.ms);
    if (x !== y) return x ? -1 : 1;
    if (x && a.ms !== b.ms) return a.ms - b.ms;
    return a.i - b.i;
  });
  return rows.map(({ i, ...r }) => r);
}

/* The rows of the Files tab, in the order they were attached: [{ id, name,
   file, where, stepId }]. */
function fileRows(attachments, stepOf) {
  return (Array.isArray(attachments) ? attachments : []).filter((a) => a && a.id).map((a) => {
    const st = a.step_id && typeof stepOf === "function" ? stepOf(a.step_id) : null;
    return {
      id: a.id, name: _text(a.label) || _text(a.file) || "(unnamed file)", file: _text(a.file),
      stepId: st ? st.step_id : null,
      where: st ? WORDS.onStep + (_text(st.name) || "(unnamed step)") : WORDS.onProject,
    };
  });
}

/* A tab's label: its name and, for a tab that counts, "(n)". */
function tabLabel(name, n) {
  return Number.isFinite(n) ? name + " (" + n + ")" : name;
}

module.exports = {
  WORDS, transactionsMarked, stepGroups, listedSteps, noNameYet, noDescriptionYet, metaLine, whenText, offersStartsHere,
  stepRow, untimedCount, stepsHint, listActs, neighbours, groupOf, stepAt, noteMs, noteRows, fileRows, tabLabel,
};
