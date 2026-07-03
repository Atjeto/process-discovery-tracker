"use strict";

/*
 * next-act-rail.js -- R4 (APPROACHABILITY-REDESIGN-2026-07-03 §5): the
 * next-act rail, the Overview's resident answer to "what is the next most
 * valuable act on this session".
 *
 * A five-act checklist derived ENTIRELY from data the viewer already has --
 * nothing here computes a new analysis or runs a detector. Exactly ONE act is
 * highlighted (the first unmet one, in order); the acts before it read as done,
 * the ones after it as pending. Each act is one plain-English sentence, a state
 * tick, and one button that points AT an existing surface/CTA (the rail never
 * bypasses a tier gate and never auto-runs anything).
 *
 * The five acts, in the analyst's sequence (name the labels -> mark the cases
 * -> walk the story -> judge the time sinks -> assemble the memo):
 *
 *   1. name        unmet when the R2 advisory matcher reports UNNAMED distinct
 *                  controls > 0 for any in-session app that has (or could have)
 *                  a vocab. The count is ADVISORY (from vocab-match.js, a mirror
 *                  of the pipeline) so it is labelled "~N" and "so far".
 *   2. cases       unmet when the session has no cases -- the EXACT condition the
 *                  R3 no-cases fallback uses (work-items.buildWorkItems().hasCases
 *                  === false: no step carries a case_id, i.e. no markers and no
 *                  accepted anchor). Mentions a waiting candidate field when one
 *                  exists.
 *   3. story       unmet when NO analyst edit exists anywhere in the session (no
 *                  manually_authored / edited steps, no group_annotations, no
 *                  marker edits, no memo selection, no analysis overrides, no
 *                  phases-by-hand). A soft nudge -- done the moment anyone touches
 *                  it.
 *   4. judge       unmet when zero business-required judgments exist AND
 *                  "Where the time goes" has rows (analysis.time_study). A
 *                  business-required judgment is an analysis_overrides[] entry
 *                  carrying a bnva_ms (the same signal the Analysis view reads).
 *   5. memo        unmet when findings exist and none is included-in-memo yet
 *                  (annotations.memo_selection[] empty).
 *
 * Pure module: no DOM, no IPC, no State. `buildRail(input)` takes a plain
 * snapshot and returns the five acts + which one is active. The Overview wires
 * the buttons and supplies the advisory unnamed count (fetched async). Unit-
 * tested in next-act-rail.test.js.
 */

/* The five act ids, in sequence. The FIRST unmet act (in this order) is the one
   highlighted; everything before it is done, everything after is pending. */
const ACT_IDS = ["name", "cases", "story", "judge", "memo"];

/* Does the session carry ANY analyst-authored edit? (act 3, "walk the story").
   Kept deliberately broad -- any recorded human touch counts as "someone has
   started". Mirrors the shapes the rest of the viewer writes. */
function hasAnyAnalystEdit(input) {
  const anno = input.annotations || {};
  const steps = anno.steps || [];
  const stepTouched = steps.some(
    (s) => s && (s.manually_authored === true || s.edited === true ||
      s.state === "confirmed" || (Array.isArray(s.flags) && s.flags.length)));
  const groupAnnos = Array.isArray(anno.group_annotations) && anno.group_annotations.length > 0;
  const markerEdits = Array.isArray(anno.marker_edits) && anno.marker_edits.length > 0;
  const memoSel = Array.isArray(anno.memo_selection) && anno.memo_selection.length > 0;
  const overrides = Array.isArray(anno.analysis_overrides) && anno.analysis_overrides.length > 0;
  const notes = Array.isArray(anno.notes) && anno.notes.length > 0;
  const handPhases = (anno.phases || []).some((p) => p && p.manually_authored === true);
  const excluded = Array.isArray(anno.excluded_ranges) && anno.excluded_ranges.length > 0;
  const starred = Array.isArray(anno.starred_screenshots) && anno.starred_screenshots.length > 0;
  const refMaps = Array.isArray(anno.reference_maps) && anno.reference_maps.length > 0;
  return !!(stepTouched || groupAnnos || markerEdits || memoSel || overrides ||
    notes || handPhases || excluded || starred || refMaps);
}

/* Do any business-required judgments exist? (act 4). A judgment is an
   analysis_overrides[] entry with a bnva_ms set -- the SAME signal
   analysis-view.js reads to show "N business-required" on a time-goes row. */
function hasBusinessRequiredJudgment(input) {
  const overrides = (input.annotations || {}).analysis_overrides || [];
  return overrides.some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
}

/* The anchor candidates the session carries, from either the annotations
   sidecar (where Accept/Dismiss live) or analysis.json (where the detector
   writes them). Used only to enrich act 2's copy -- "a candidate field is
   waiting". */
function anchorCandidateCount(input) {
  const fromAnno = ((input.annotations || {}).anchor_candidates || []).length;
  const fromAnalysis = ((input.analysis || {}).anchor_candidates || []).length;
  return Math.max(fromAnno, fromAnalysis);
}

/* Build the five acts from a plain snapshot. `input`:
 *   { annotations, analysis, hasCases (bool -- work-items.hasCases),
 *     unnamedControls (number|null -- advisory count; null = not computed yet),
 *     findingCount (number) }
 * Returns { acts: [{ id, title, sentence, done, active, button }], activeId }.
 * `button` = { label, target } where target is a symbolic destination the
 * Overview maps to a click (never a URL). */
function buildRail(input) {
  input = input || {};
  const anno = input.annotations || {};
  const analysis = input.analysis || {};
  const unnamed = input.unnamedControls;         // number | null (pending)
  const findingCount = input.findingCount || (analysis.findings || []).length;
  const hasCases = !!input.hasCases;
  const timeRows = (analysis.time_study || []).length;
  const memoSel = (anno.memo_selection || []).length;
  const cands = anchorCandidateCount(input);

  // --- Per-act unmet signals (each labelled with the condition it reads) ---
  // 1. name: advisory unnamed controls > 0. `null` = still being counted, so
  //    the act is not yet judged unmet (it reads as pending-but-not-active until
  //    the count lands; a null never spuriously highlights the rail).
  const nameCounted = typeof unnamed === "number";
  const nameUnmet = nameCounted && unnamed > 0;

  // 2. cases: the EXACT R3 no-cases fallback condition (hasCases === false).
  const casesUnmet = !hasCases;

  // 3. story: no analyst edit exists anywhere yet.
  const storyUnmet = !hasAnyAnalystEdit(input);

  // 4. judge: no business-required judgment AND there are time-goes rows to judge.
  const judgeUnmet = timeRows > 0 && !hasBusinessRequiredJudgment(input);

  // 5. memo: findings exist and none is included in the memo yet.
  const memoUnmet = findingCount > 0 && memoSel === 0;

  const unmetById = {
    name: nameUnmet,
    cases: casesUnmet,
    story: storyUnmet,
    judge: judgeUnmet,
    memo: memoUnmet,
  };

  // The active act = the first unmet in sequence. When the name count is still
  // pending (null) act 1 is neither done nor active -- it holds the "counting"
  // state, and the highlight falls to the first LATER unmet act so the rail is
  // never blank while the advisory count resolves.
  let activeId = null;
  for (const id of ACT_IDS) {
    if (unmetById[id]) { activeId = id; break; }
  }

  const acts = ACT_IDS.map((id) =>
    _actView(id, {
      unmet: unmetById[id],
      active: id === activeId,
      unnamed, nameCounted, cands, hasCases, findingCount, timeRows,
    }));

  return { acts, activeId };
}

/* One act's view object: title, the plain sentence for its current state, the
   done/active flags, and the single button. The sentence adapts to done vs.
   unmet so a completed act reads as a confirmation, not a stale ask. */
function _actView(id, s) {
  const done = !s.unmet && !(id === "name" && !s.nameCounted && s.active);
  switch (id) {
    case "name": {
      const countPhrase = typeof s.unnamed === "number"
        ? "~" + s.unnamed + " control" + (s.unnamed === 1 ? "" : "s")
        : "some controls";
      const sentence = !s.nameCounted
        ? "Checking how many recorded controls still need a business name…"
        : (s.unmet
            ? "The recording has " + countPhrase + " with no business name yet (estimated) — naming them makes every later view read in plain words."
            : "Every recorded control the App Library covers already has a business name.");
      return {
        id, title: "Name what the recorder saw",
        sentence, done: s.nameCounted && !s.unmet, active: s.active,
        button: { label: "Open the App Library", target: "app-library" },
      };
    }
    case "cases": {
      const waiting = s.cands > 0
        ? " A field that could identify each ticket/order is waiting for you to confirm it."
        : "";
      const sentence = s.unmet
        ? "This recording isn't split into cases yet — marking them (or confirming the field that identifies each one) unlocks the case-by-case numbers." + waiting
        : "The recording is split into cases.";
      return {
        id, title: "Mark the cases",
        sentence, done: !s.unmet, active: s.active,
        // "Review the candidate field" only when the act is UNMET and a
        // candidate is actually waiting; a done act just points back to markers.
        button: { label: (s.unmet && s.cands > 0) ? "Review the candidate field" : "Open markers", target: "markers" },
      };
    }
    case "story": {
      const sentence = s.unmet
        ? "Nobody has touched this session yet — open the timeline and walk through what happened once, top to bottom."
        : "You've started working through this session.";
      return {
        id, title: "Walk the story",
        sentence, done: !s.unmet, active: s.active,
        button: { label: "Open the timeline", target: "flow" },
      };
    }
    case "judge": {
      const sentence = s.timeRows === 0
        ? "No measured step times to judge yet."
        : (s.unmet
            ? "The time is measured but not yet judged — mark how much of the biggest time sinks is business-required so the numbers mean something."
            : "You've judged how much of the top time sinks is business-required.");
      return {
        id, title: "Judge the top time sinks",
        sentence, done: !s.unmet, active: s.active,
        button: { label: "Judge the time sinks", target: "time-goes" },
      };
    }
    case "memo": {
      const sentence = s.findingCount === 0
        ? "No findings to assemble into a memo yet."
        : (s.unmet
            ? "Findings are ready but none is in the memo yet — tick the ones worth reporting, then export the 2-page memo."
            : "You've picked findings for the memo — export it when you're ready.");
      return {
        id, title: "Assemble the memo",
        sentence, done: !s.unmet, active: s.active,
        button: { label: "Go to findings", target: "findings" },
      };
    }
    default:
      return { id, title: id, sentence: "", done: false, active: false, button: null };
  }
}

module.exports = {
  ACT_IDS,
  buildRail,
  hasAnyAnalystEdit,
  hasBusinessRequiredJudgment,
  anchorCandidateCount,
};
