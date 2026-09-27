"use strict";

/*
 * map-view.js: which picture the Map level shows (lane MV; contracts C15,
 * C18, C19). The Map shows the map the PDD prints: the As-Is copy chosen for
 * the PDD, else process_map_step.bpmn, the map the analysis writes, both
 * drawn by bpmn-js (asis-view.js) and linked alike. How the transactions ran
 * (the live map, dfg-viewer.js, with how often each path was taken and the
 * paths no transaction took) is the second view, one click away.
 *
 * A sub-process's map (C19) is the copy's plane for it when the copy has
 * one, else the process map's, as the PDD prints it. process_map_step.bpmn
 * changes only when the project is analyzed, so the Map analyzes first when
 * annotations.json is newer (refmap-ui.js), once per change, and keeps the
 * picture it had meanwhile. What cannot be drawn leaves the level to the
 * live map with one line saying why.
 *
 * Pure: refmap-ui.js gathers the facts, draws what `pick` decides and fills
 * the Map's one header line from `line`.
 */

/* The one line over the map when the picture the PDD prints does not show. */
const WHY = {
  DRAWING: "The process map is being drawn: it shows here when the update is done.",
  NOT_DRAWN: "The process map could not be drawn. Help, Troubleshooting has Re-analyze.",
  NOT_UPDATED: "The process map could not be updated with your latest changes. Help, Troubleshooting has Re-analyze.",
  NO_PLANE: "The process map has no map for this sub-process.",
  COPY_LACKS: "Your As-Is map has no map for this sub-process.",
  COPY_LACKS_STEP: "Your As-Is map has no map for this sub-process, so this is the process map's.",
};

/* The header line's words. */
const TITLE = { STEP: "Process map", COPY: "As-Is map", RUNS: "How the transactions ran" };
const NOTE = {
  STEP: "(the PDD prints this map)",
  COPY: "(edited; the PDD prints this map)",
  RUNS: "(hover a line for how often it was taken; a dashed line is a path no transaction took)",
};
const TO_RUNS = "Show how the transactions ran";
const TO_STEP = "Show the process map";
const TO_COPY = "Show the As-Is map";
/* Lane FX2: the chosen As-Is copy was made before the steps changed
   (asis-freshness.js); the header says so, before its Copy again. */
const STALE = "Made before the steps changed: check it, or";
/* 2.0.1: a copy drawn in colours, before the system labels. */
const STALE_LABELS = "Drawn in colours, before the system labels:";
const RECOPY = "Copy again";

/* What the Map shows. `o`:
     want    "map" (the default) or "runs": the view the analyst chose for
             this project in this window;
     live    { locked, drawable }: locked while the Map says why it draws no
             map at all (not analyzed, no transaction marked, a failed
             check); drawable when the level shown has a step to draw;
     copy    null, or the As-Is copy chosen for the PDD (its file on disk):
             { plane } true or false when it is known whether it has a map
             for the level shown, null until it has been drawn;
     step    process_map_step.bpmn: { exists, stale (older than
             annotations.json, or missing), plane (as for the copy) };
     busy    an analysis of this project is queued or running;
     tried   the Map already analyzed for annotations.json as it is.
   Returns { view, source, why, analyze, back }:
     view    "bpmn" (the picture the PDD prints) or "runs" (the live map);
     source  "copy" or "step" for view "bpmn", else null;
     why     the line over the map, or null;
     analyze the Map starts an analysis now (the step map is needed, stale,
             and none runs or ran for this change);
     back    for view "runs": whether the header offers the way back (the
             analyst chose this view; a live map shown because the picture
             cannot be drawn offers none, its line says why). */
function pick(o) {
  const input = o || {};
  const live = input.live || {};
  const none = { view: "runs", source: null, why: null, analyze: false, back: false };
  // The live map's own message says why nothing is drawn.
  if (live.locked || !live.drawable) return none;
  const copy = input.copy || null;
  const step = input.step || {};
  if (input.want === "runs") return { view: "runs", source: null, why: null, analyze: false, back: true };
  const copyShows = !!copy && copy.plane !== false;
  if (copyShows) return { view: "bpmn", source: "copy", why: null, analyze: false, back: false };
  const analyze = !!step.stale && !input.busy && !input.tried;
  // While an update runs the previous picture stays (when there is one).
  const updating = !!input.busy || analyze;
  let stepWhy = null;
  if (!step.exists) stepWhy = updating ? WHY.DRAWING : WHY.NOT_DRAWN;
  else if (step.stale && !updating) stepWhy = WHY.NOT_UPDATED;
  else if (step.plane === false) stepWhy = updating ? WHY.DRAWING : WHY.NO_PLANE;
  if (!stepWhy) return { view: "bpmn", source: "step", why: copy ? WHY.COPY_LACKS_STEP : null, analyze, back: false };
  return { view: "runs", source: null, why: copy ? WHY.COPY_LACKS + " " + stepWhy : stepWhy, analyze, back: false };
}

/* The Map's one header line for a pick: { title, note, edit (the copy's
   Edit shows), stale (lane FX2: the words before Copy again while the copy
   shown was made before the steps changed, "" otherwise), toRuns (the link
   to the live map, "" for none), toMap (the way back, "" for none) }.
   `copy` and `copyName` as for pick: the chosen copy ({ plane, stale }) and
   the name the analyst gave it. */
function line(p, copy, copyName) {
  const r = p || {};
  if (r.view === "bpmn" && r.source === "copy") {
    return { title: String(copyName || "").trim() || TITLE.COPY, note: NOTE.COPY, edit: true,
      stale: copy && copy.stale ? (copy.stale === "labels" ? STALE_LABELS : STALE) : "", toRuns: TO_RUNS, toMap: "" };
  }
  if (r.view === "bpmn") return { title: TITLE.STEP, note: NOTE.STEP, edit: false, stale: "", toRuns: TO_RUNS, toMap: "" };
  const toMap = !r.back ? "" : copy && copy.plane !== false ? TO_COPY : TO_STEP;
  return { title: TITLE.RUNS, note: NOTE.RUNS, edit: false, stale: "", toRuns: "", toMap };
}

module.exports = { WHY, TITLE, NOTE, TO_RUNS, TO_STEP, TO_COPY, STALE, STALE_LABELS, RECOPY, pick, line };
