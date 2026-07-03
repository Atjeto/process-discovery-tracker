"use strict";

/*
 * work-items.js -- ADR-0028: the case-scoped screen visit, the analyst-facing
 * unit of work.
 *
 * A worker handling one ticket bounces TAMBA -> Excel -> TAMBA a dozen times.
 * ADR-0024's consecutive-run roll-up (process-map-levels.rollUpSteps) starts a
 * NEW group at every bounce, so a real 1h session shows ~500 rows. This module
 * folds the fragments of one screen-visit back together ACROSS bounces WITHIN a
 * case (non-consecutive merge), so the reading is "what I did on that ticket,
 * per screen".
 *
 * PURE: no DOM, no State, no cytoscape. It reuses the value-free screen-grain
 * machinery from process-map-levels.js (grainKey/grainLabel/screenType/
 * resolveStepGrainKeys) rather than reimplementing the key -- the same key the
 * map's screen axis and the Steps roll-up use, so the three agree.
 *
 * View-time only: the raw steps array is never mutated; slide the Detail grain
 * back to element to see every fragment (ADR-0024 -- detail is never destroyed).
 */

const { grainKey, grainLabel, screenType, resolveStepGrainKeys } = require("./process-map-levels.js");

const UNASSIGNED_CASE = "__unassigned__";

function _stepStart(st) {
  const t = (st && st.time_range && st.time_range.start) || null;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}
function _stepEnd(st) {
  const t = (st && st.time_range && st.time_range.end) || null;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

/* The group-annotation for a (case_id, screen_key), or null. `groupAnnos` is the
 * annotations.json `group_annotations[]` array; the lookup is by the exact
 * composite key ADR-0028 defines. Pure -- exported so callers and tests share
 * the one lookup rule. A null case_id is matched against a null-or-absent
 * case_id in the entry (the Unassigned pseudo-case). */
function findGroupAnnotation(groupAnnos, caseId, screenKey) {
  if (!Array.isArray(groupAnnos)) return null;
  const cid = caseId == null ? null : caseId;
  for (const g of groupAnnos) {
    if (!g) continue;
    const gcid = g.case_id == null ? null : g.case_id;
    if (gcid === cid && g.screen_key === screenKey) return g;
  }
  return null;
}

/* Build a groupName(case_id, screen_key) resolver from a group_annotations[]
 * array -- the ctx hook grainLabel consults at the screen notch so a named work
 * item flows its name down to its member fragments (ADR-0028 §3). Returns "" (a
 * falsy no-name) when there is no entry or no name, so grainLabel falls back to
 * the value-free screen label. */
function groupNameResolver(groupAnnos) {
  return (caseId, screenKey) => {
    const g = findGroupAnnotation(groupAnnos, caseId, screenKey);
    return (g && typeof g.name === "string" && g.name.trim()) ? g.name.trim() : "";
  };
}

/**
 * Fold a session's steps into case-scoped screen-visit work items (ADR-0028).
 *
 * @param {Array}  steps            the annotation steps[] (raw shape preserved).
 * @param {Object} [ctx]           resolvers: `interactionsById` (the view-time
 *   grain-key fallback for steps lacking persisted grain_keys), `caseLabel(id)`
 *   (a friendly per-case label), `groupAnnotations` (the group_annotations[]
 *   array so a named/waste/hidden work item is reflected).
 * @returns {{ cases: Array, hasCases: boolean }}
 *   `hasCases` is false when NO step carries a case_id -- the no-cases fallback
 *   signal (ADR-0028 §5: the caller keeps the ADR-0024 roll-up + a CTA). Each
 *   `cases[]` entry: { case_id, case_label, work_items[] } where a work item is
 *   { screen_key, label, case_id, step_ids (chronological), steps, total_ms,
 *     visit_count, fragment_count, waste, hidden, group_annotation }.
 *   The Unassigned pseudo-case (case_id null) sorts LAST.
 */
function buildWorkItems(steps, ctx) {
  const c = ctx || {};
  const groupAnnos = c.groupAnnotations || [];
  const nameFor = groupNameResolver(groupAnnos);
  const labelCtx = {
    interactionsById: c.interactionsById || {},
    caseLabel: c.caseLabel,
  };

  const valid = (steps || []).filter((st) => st && st.state !== "hidden");

  // Real cases are steps with a case_id; steps without one collect in the
  // Unassigned pseudo-case. hasCases reflects the REAL cases only.
  let sawRealCase = false;
  const byCase = new Map();   // case_id (or UNASSIGNED_CASE) -> [steps]
  for (const st of valid) {
    const hasCid = st.case_id != null && st.case_id !== "";
    if (hasCid) sawRealCase = true;
    const cid = hasCid ? st.case_id : UNASSIGNED_CASE;
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(st);
  }

  const cases = [];
  for (const [cid, caseSteps] of byCase.entries()) {
    caseSteps.sort((a, b) => _stepStart(a) - _stepStart(b));
    const realCid = cid === UNASSIGNED_CASE ? null : cid;

    // NON-CONSECUTIVE merge: one work item per distinct screen key in the case,
    // however many separate runs the work bounced into it. visit_count counts
    // the runs (bounces); fragment_count counts the folded steps.
    const items = new Map();       // screen_key -> work item accumulator
    let lastKey = null;
    for (const st of caseSteps) {
      const key = grainKey(st, "screen", labelCtx);
      if (!items.has(key)) {
        items.set(key, {
          screen_key: key,
          case_id: realCid,
          steps: [],
          step_ids: [],
          visit_count: 0,
          _firstStart: _stepStart(st),
        });
      }
      const it = items.get(key);
      it.steps.push(st);
      it.step_ids.push(st.step_id);
      // A new run (bounce into this screen) whenever the key changes.
      if (key !== lastKey) it.visit_count += 1;
      lastKey = key;
    }

    const workItems = [...items.values()].map((it) => {
      // The screen label (value-free), then let a group annotation's name win.
      const first = it.steps[0];
      const screenLabel = grainLabel(first, "screen", labelCtx);
      const ga = findGroupAnnotation(groupAnnos, realCid, it.screen_key);
      const nm = nameFor(realCid, it.screen_key);
      // Duration = sum of member step durations (hidden steps are already
      // excluded above, so they contribute 0 and never inflate the total),
      // NOT wall-clock span -- interleaved bounces would otherwise double-count
      // the gaps that belong to the OTHER screen's visits.
      let total_ms = 0;
      for (const st of it.steps) {
        const d = _stepEnd(st) - _stepStart(st);
        if (Number.isFinite(d) && d > 0) total_ms += d;
      }
      return {
        screen_key: it.screen_key,
        label: nm || screenLabel,
        case_id: realCid,
        step_ids: it.step_ids,
        steps: it.steps,
        total_ms,
        visit_count: it.visit_count,
        fragment_count: it.steps.length,
        waste: !!(ga && ga.waste),
        hidden: !!(ga && ga.hidden),
        group_annotation: ga || null,
        _firstStart: it._firstStart,
      };
    });
    // Order work items by first appearance within the case.
    workItems.sort((a, b) => a._firstStart - b._firstStart);
    workItems.forEach((w) => { delete w._firstStart; });

    cases.push({
      case_id: realCid,
      case_label: realCid == null
        ? "Unassigned"
        : ((labelCtx.caseLabel && labelCtx.caseLabel(realCid)) || realCid),
      work_items: workItems,
      _firstStart: caseSteps.length ? _stepStart(caseSteps[0]) : Infinity,
    });
  }

  // Real cases in chronological order; the Unassigned pseudo-case always last.
  cases.sort((a, b) => {
    if (a.case_id == null && b.case_id != null) return 1;
    if (a.case_id != null && b.case_id == null) return -1;
    return a._firstStart - b._firstStart;
  });
  cases.forEach((cs) => { delete cs._firstStart; });

  return { cases, hasCases: sawRealCase };
}

module.exports = {
  buildWorkItems, findGroupAnnotation, groupNameResolver,
  UNASSIGNED_CASE,
};
