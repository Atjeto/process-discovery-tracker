"use strict";

/*
 * asis-freshness.js: whether an edited copy of the process map (an As-Is or
 * To-Be map, ADR-0019) was made from the steps as they are now (lane FX2;
 * validation pass 2, F1). A copy never follows the steps: it is the
 * analyst's. So the app says when the steps changed after it was made: on
 * the Map's header line, under its row in the edited maps and on the
 * Overview's Checklist, and the PDD never prints an As-Is map older than its
 * own step list without the analyst being told.
 *
 * A copy made from now on keeps the signature of the maps its steps drew
 * (stepsMapSignature, stored on its reference_maps row as
 * forked_from_steps), taken from the steps themselves, so a rename is seen
 * at once, not only after the next analysis writes process_map_step.bpmn
 * again. The signature covers what the step map draws from the steps
 * (contracts C17 to C19): every map of the project (the main one and one per
 * sub-process), its boxes and lines (the flow rule of the live map, with the
 * conditions on the lines, the paths no transaction took and how often each
 * was taken), each box's notes, files, the system set on its steps, whether
 * it is done outside every system (the hand marker), whether it is a
 * sub-process and whether it is flagged as waste, and the Trigger and the
 * Result that name the start and the end. A confirmed transaction, a
 * description, a screenshot or the reference transaction draw nothing on
 * the map, so they change nothing here.
 *
 * A copy made before the signature was kept compares the process of
 * process_map_step.bpmn as it is now with the one it was made from
 * (reference-maps.js isStale), the edited maps' check since ADR-0019: it
 * sees a change of the steps once they are analyzed.
 *
 * Pure but for reading that file (node:crypto, node:fs through
 * reference-maps.js).
 */

const crypto = require("node:crypto");
const path = require("node:path");
const RunsModel = require("./runs-model.js");
const SPM = require("./sub-process-maps.js");
const RefStore = require("./reference-maps.js");
const { buildAnnotationDfg, flowEdges, mapNodeLabel } = require("./process-map-levels.js");

/* An analyst's text as one line ("" for a non string). */
function _line(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

/* A document field's first line, as the step map names its start and end. */
function _firstLine(doc, key) {
  const v = doc && typeof doc === "object" && typeof doc[key] === "string" ? doc[key] : "";
  return _line(v.split(/\r?\n/).find((l) => l.trim()) || "");
}

function _sorted(list) { return [...new Set(list)].sort(); }

/* What one box of a map shows beside its name, from the steps it stands
   for: [notes, files, systems, manual, sub-process, waste]. */
function _boxFacts(steps, notesBy, filesBy) {
  const ids = steps.map((s) => s.step_id);
  const notes = _sorted(ids.flatMap((id) => notesBy.get(id) || []));
  const files = _sorted(ids.flatMap((id) => filesBy.get(id) || []));
  const systems = _sorted(steps.map((s) => _line(s.system)).filter(Boolean));
  const manual = steps.every((s) => s.state === "manually_authored" &&
    !((s.evidence && s.evidence.interaction_event_ids) || []).length && !_line(s.system));
  return [notes, files, systems, manual, steps.some(SPM.isSubProcess), steps.some((s) => !!(s.flags && s.flags.waste))];
}

/**
 * The signature of the maps the steps draw (see the header).
 * @param {object} annotations  annotations.json as the project holds it
 * @param {object|null} stats   stats.json (its case_stats give the transactions)
 * @returns {string} a SHA-256 hex digest
 */
function stepsMapSignature(annotations, stats) {
  const anno = annotations && typeof annotations === "object" ? annotations : {};
  const runs = RunsModel.buildRuns(stats || null, Array.isArray(anno.steps) ? anno.steps : []).runs;
  const txs = runs.map((r) => r.members);
  const notesBy = new Map(), filesBy = new Map();
  const add = (map, id, v) => { if (typeof id === "string" && v) map.set(id, (map.get(id) || []).concat([v])); };
  for (const n of Array.isArray(anno.analyst_notes) ? anno.analyst_notes : []) if (n) add(notesBy, n.step_id, _line(n.text));
  for (const a of Array.isArray(anno.attachments) ? anno.attachments : []) if (a) add(filesBy, a.step_id, _line(a.label) || _line(a.file));
  const maps = SPM.mapTree(txs).map((m) => {
    const edges = flowEdges(buildAnnotationDfg(m.traces))
      .map((e) => [e.from, e.to, e.label || "", e.observed, e.frequency])
      .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    const byBox = new Map();
    for (const st of m.traces.flat()) {
      const node = mapNodeLabel(st);
      byBox.set(node, (byBox.get(node) || []).concat([st]));
    }
    const boxes = [...byBox.keys()].sort().map((node) => [node, _boxFacts(byBox.get(node), notesBy, filesBy)]);
    return [m.path, edges, boxes];
  }).sort((a, b) => JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1);
  const doc = anno.document;
  const text = JSON.stringify([maps, _firstLine(doc, "trigger"), _firstLine(doc, "result")]);
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/* Whether the copy on the reference_maps row `entry` was made from other
   steps than `sess`'s now: its steps' signature when it kept one, else the
   process of process_map_step.bpmn against the one it was copied from (a
   copy made from another map than the step map claims nothing). */
function copyStale(sess, entry) {
  if (!sess || !entry) return false;
  if (typeof entry.forked_from_steps === "string" && entry.forked_from_steps) {
    return entry.forked_from_steps !== stepsMapSignature(sess.annotations, sess.stats);
  }
  if (!entry.source || entry.source.level !== "step" || !sess.sessionFolder) return false;
  const now = RefStore.sourceMarks(path.join(sess.sessionFolder, "process_map_step.bpmn"));
  return !!now && RefStore.isStale(entry, now.hash, now.sig);
}

/* The As-Is copy chosen for the PDD, when its file is on disk, or null. */
function chosenAsIs(sess) {
  const e = sess ? RefStore.pddPick(sess.annotations, "as_is") : null;
  return e && sess.sessionFolder && RefStore.fileExists(sess.sessionFolder, e) ? e : null;
}

/* Whether the As-Is copy the PDD prints was made before the steps changed. */
function chosenAsIsStale(sess) {
  const e = chosenAsIs(sess);
  return !!e && copyStale(sess, e);
}

module.exports = { stepsMapSignature, copyStale, chosenAsIs, chosenAsIsStale };
