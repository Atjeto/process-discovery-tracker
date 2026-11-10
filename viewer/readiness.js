"use strict";

/*
 * readiness.js: what a reader of the next version will miss (lane B-V2). The
 * hand-off zip is the deliverable; before it is made, the Overview (once its
 * Checklist is ready, or once a version was handed off) and the Hand off...
 * dialog say in plain words what the PDD of this version leaves out, each
 * line leading to the place where it is fixed. It never blocks a hand-off.
 *
 * Pure: no DOM, no State. What it cannot read from the steps themselves (the
 * screenshots a step shows, the system it is done in, whether its
 * description is only the recorder's narration, the document's status,
 * whether the As-Is map is stale) is passed in.
 *
 * The steps looked at: the visible steps of the reference transaction, at
 * every level (a sub-process's steps too: the PDD prints them in chapters of
 * their own), in process order, a parent before its sub-steps. A hidden step
 * is left out with everything under it; the other transactions are not
 * looked at.
 */

const RunsModel = require("./runs-model.js");
const StepOrder = require("./step-order.js");
const StepFlow = require("./step-flow.js");

/* The name + Step and + Add step give a new step ("Step 12", steps-view.js
   nextStepName): no name of its own. The Overview's Write the steps reads
   the same pattern (overview-view.js). */
const NUMBERED_STEP = /^Step (\d+)$/;

/* The order of the entries, as a person reads them. */
const KEYS = ["drafts", "names", "descriptions", "pictures", "systems", "conditions", "document", "asis"];

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* A step's name as the list shows it. */
function _nameOf(step) { return _text(step && step.name) || "Unnamed step"; }

/* The first three names, then "and N more". */
function _names(steps) {
  const shown = steps.slice(0, 3).map(_nameOf).join(", ");
  return steps.length > 3 ? shown + " and " + (steps.length - 3) + " more" : shown;
}

/* Whether a step has no name of its own: empty, or the one + Step gives. */
function hasNoOwnName(step) {
  const name = _text(step && step.name);
  return !name || NUMBERED_STEP.test(name);
}

/* The visible steps of the reference transaction, each followed by its own
   visible sub-steps (C19) in process order, at every depth. The main level
   keeps the transaction's own order (buildRuns: its process order). */
function _visibleTree(run) {
  const out = [];
  const visible = (steps) => (Array.isArray(steps) ? steps : []).filter((s) => s && typeof s === "object" && s.state !== "hidden");
  const walk = (ordered) => {
    for (const s of ordered) {
      out.push(s);
      if (Array.isArray(s.sub_steps)) walk(StepOrder.processOrder(visible(s.sub_steps)));
    }
  };
  walk(visible(Array.isArray(run.visible) ? run.visible : run.members));
  return out;
}

/**
 * What a reader of the next version will miss, in the order a person reads
 * it; each entry only when its count is above zero.
 *
 * @param {object} project
 *   annotations: annotations.json (its steps and pattern_run);
 *   runs: the transactions as RunsModel.buildRuns gives them;
 *   reference: the reference transaction (one of `runs`); when absent it is
 *     read from the annotations (RunsModel.patternRun).
 * @param {object} lookups
 *   shotCount(step): how many screenshots the step shows (the step pane's
 *     count, analyst-ui.js shotsOf);
 *   systemOf(step): the system the step is done in, "" when none is known
 *     (system-names.js whereOfStep);
 *   isNarration(step): true when the step's description is only the
 *     recorder's narration (step-facts.js isDraftedDescription);
 *   document: the document's status ({ missing: [labels], firstEmpty: key },
 *     overview-view.js documentStatus);
 *   asIsStale: true while the As-Is map the PDD prints was made before the
 *     steps changed (asis-freshness.js chosenAsIsStale).
 * @returns {Array<{key, count, text, lead}>} `lead` is where the entry
 *   leads: { kind: "step", stepId } (the entry's first step),
 *   { kind: "document", field } (the first empty field) or { kind: "map" }.
 *   A step is counted under every lack it has (a draft without a
 *   description is under `drafts` and `descriptions`). A sub-process that
 *   only groups steps (`group: true`) is not asked for a picture or a system:
 *   the PDD prints neither for it.
 */
function missing(project, lookups) {
  const p = project || {};
  const look = lookups || {};
  const anno = p.annotations || {};
  const runs = Array.isArray(p.runs) ? p.runs : [];
  const reference = p.reference !== undefined ? p.reference : RunsModel.patternRun(anno, runs).run;
  const steps = reference ? _visibleTree(reference) : [];
  const shotCount = typeof look.shotCount === "function" ? look.shotCount : () => 0;
  const systemOf = typeof look.systemOf === "function" ? look.systemOf : () => "";
  const isNarration = typeof look.isNarration === "function" ? look.isNarration : () => false;
  const asked = (s) => s.group !== true;

  const drafts = steps.filter((s) => RunsModel.DRAFT_STATES.has(s.state));
  const names = steps.filter(hasNoOwnName);
  const descriptions = steps.filter((s) => !_text(s.description) || !!isNarration(s));
  const pictures = steps.filter((s) => asked(s) && !(Number(shotCount(s)) > 0));
  const systems = steps.filter((s) => asked(s) && !_text(systemOf(s)));
  const conditions = steps.filter((s) => StepFlow.links(s).some((l) => !_text(l.when)));
  const doc = look.document || {};
  const docMissing = Array.isArray(doc.missing) ? doc.missing : [];

  const out = [];
  const stepEntry = (key, list, text) => {
    if (list.length) out.push({ key, count: list.length, text, lead: { kind: "step", stepId: list[0].step_id } });
  };
  const n = (list, one, many) => _plural(list.length, one, many);
  stepEntry("drafts", drafts, drafts.length === 1 ? "1 step is still a draft, and the PDD says so."
    : drafts.length + " steps are still drafts, and the PDD says so.");
  stepEntry("names", names, n(names, "step has no name of its own", "steps have no name of their own") + ": " + _names(names) + ".");
  stepEntry("descriptions", descriptions, n(descriptions, "step has", "steps have") + " no description: " + _names(descriptions) + ".");
  stepEntry("pictures", pictures, n(pictures, "step has", "steps have") + " no picture: " + _names(pictures) + ".");
  stepEntry("systems", systems, n(systems, "step has", "steps have") + " no system: " + _names(systems) + ".");
  stepEntry("conditions", conditions, (conditions.length === 1 ? "1 decision does not say when: "
    : conditions.length + " decisions do not say when: ") + _names(conditions) + ".");
  if (docMissing.length) {
    out.push({ key: "document", count: docMissing.length,
      text: _plural(docMissing.length, "document field is empty", "document fields are empty") + ": " + docMissing.join(", ") + ".",
      lead: { kind: "document", field: doc.firstEmpty || null } });
  }
  if (look.asIsStale) {
    out.push({ key: "asis", count: 1, text: "The As-Is map was made before the steps changed.", lead: { kind: "map" } });
  }
  return out;
}

/* "A reader of the next version will miss 3 things" (the Overview's line). */
function overviewLine(entries) {
  return "A reader of the next version will miss " + _plural((entries || []).length, "thing", "things");
}

/* "A reader of version 2 will miss:" (the Hand off... dialog's line). */
function dialogLead(version) {
  return "A reader of version " + version + " will miss:";
}

module.exports = { missing, hasNoOwnName, overviewLine, dialogLead, NUMBERED_STEP, KEYS };
