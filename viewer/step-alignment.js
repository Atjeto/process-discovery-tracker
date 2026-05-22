"use strict";

/*
 * step-alignment.js -- intra-session repetition alignment (value-chain review
 * Decision 1, the core of "curate one ticket -> apply to all").
 *
 * When a session is segmented into cases (tickets) by the anchor detector, the
 * same task recurs once per case. This module groups "the same step across
 * cases" so the viewer can let the analyst curate ONE instance (rename, flag,
 * describe) and propagate to its siblings.
 *
 * The matching is by a VALUE-AGNOSTIC structural signature, so two "look up
 * serial" steps align even though the serial values differ:
 *   - a canonical_step_id wins outright (clean, when a template matched);
 *   - otherwise the signature is the set of (kind, control_type, element-id)
 *     tuples of the step's interactions -- never the typed values or visible
 *     names, which vary per ticket.
 *
 * Pure (no DOM): unit-testable, and the viewer wires it to the annotation
 * edit/propagate flow. The signature is deliberately simple; it will likely
 * need tuning (fuzzy/variant-aware matching) once a real multi-ticket capture
 * is available to calibrate against -- see the value-chain review's caveats.
 */

const { recognize } = require("./recognition.js");

/** Stable, value-agnostic signature for one step. */
function stepSignature(step, interactionsById) {
  if (step && step.canonical_step_id) return "c:" + step.canonical_step_id;
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  const elems = new Set();
  for (const id of ids) {
    const d = ((interactionsById || {})[id] || {}).data || {};
    // Framework-aware semantic CATEGORY (recognition.js), not the opaque
    // automation_id -- so the same step aligns across tickets regardless of
    // per-ticket ids/values (ADR-0011).
    elems.add((d.kind || "") + ":" + recognize(d).category);
  }
  if (!elems.size) return "n:" + ((step && step.name) || (step && step.step_id) || "");
  return "s:" + [...elems].sort().join("|");
}

/**
 * Group steps that recur across cases.
 * @param {Array} steps  annotation steps (each with case_id + evidence)
 * @param {Object} interactionsById  event_id -> interaction event
 * @returns {{caseCount:number, groups:Array<{signature:string, members:Array<{caseId:string, stepId:string}>, caseSpan:number}>}}
 *   `groups` contains only signatures that appear in >1 case (i.e. genuinely
 *   repeated work). `caseSpan` is how many distinct cases the group touches.
 */
function alignSteps(steps, interactionsById) {
  const byCase = new Map();
  for (const s of steps || []) {
    if (!s || s.state === "hidden") continue;
    const cid = s.case_id || "__nocase__";
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(s);
  }

  const groups = new Map(); // signature -> members[]
  for (const [cid, caseSteps] of byCase) {
    for (const s of caseSteps) {
      const sig = stepSignature(s, interactionsById);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push({ caseId: cid, stepId: s.step_id });
    }
  }

  const aligned = [];
  for (const [signature, members] of groups) {
    const caseSpan = new Set(members.map((m) => m.caseId)).size;
    if (caseSpan > 1) aligned.push({ signature, members, caseSpan });
  }
  // Most-repeated first -- those are the highest-value to curate once.
  aligned.sort((a, b) => b.caseSpan - a.caseSpan);
  return { caseCount: byCase.size, groups: aligned };
}

/**
 * The alignment group a given step belongs to (for "apply my edit to the
 * other N instances"), or null when the step does not recur across cases.
 */
function groupForStep(stepId, steps, interactionsById) {
  const { groups } = alignSteps(steps, interactionsById);
  for (const g of groups) {
    if (g.members.some((m) => m.stepId === stepId)) return g;
  }
  return null;
}

module.exports = { stepSignature, alignSteps, groupForStep };
