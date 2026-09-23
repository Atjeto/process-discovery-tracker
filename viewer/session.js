/*
 * session.js -- the annotations persistence + undo/redo layer.
 *
 * Step / marker / note edits all route through here:
 * saveAnnotationsWithUndo snapshots the previous annotations.json blob
 * (so Ctrl+Z reverts one operation at a time), persistAnnotations
 * persists + emits the change topics for targeted re-render, and
 * performUndo/performRedo revert in place without a full session
 * reload (issue S6). ensureAnnoShape normalizes the annotations object.
 *
 * renderAnnotations / renderSessionPills (flow-view surfaces refreshed
 * after an in-place revert) are injected by renderer.js via
 * initSession().
 */

"use strict";

const State = require("./state.js");
const Ipc = require("./ipc.js");
const { toast } = require("./dom.js");

/* Injected by renderer.js. */
let renderAnnotations = () => {};
let renderSessionPills = () => {};

function resetUndoStack() { State.resetUndo(); }
function canUndo() {
  const s = State.getSession();
  return !!s && State.canUndo(s.sessionFolder);
}
function canRedo() {
  const s = State.getSession();
  return !!s && State.canRedo(s.sessionFolder);
}
function emptyAnnotationsShape() {
  return { steps: [], phases: [], annotations: [], notes: [], marker_edits: [], drift_markers: [], excluded_ranges: [], reference_maps: [] };
}
function snapshotAnnotations(a) {
  // Never push null/undefined onto the stack -- a later undo/redo
  // would write null into annotations.json. Clone defensively.
  if (!a) return emptyAnnotationsShape();
  try { return JSON.parse(JSON.stringify(a)); }
  catch (_) { return emptyAnnotationsShape(); }
}

/* The last COMMITTED annotations state (as loaded, or after the last
   persist / undo / redo). Edit handlers mutate session.annotations IN PLACE
   (ensureAnnoShape hands back the live object), so by the time
   saveAnnotationsWithUndo runs, session.annotations is ALREADY the new state --
   snapshotting it there would record the POST-edit state and make Ctrl+Z a
   no-op. _baseline keeps the pre-edit state; captureBaseline() refreshes it on
   every session load. */
let _baseline = null;
function captureBaseline() {
  const s = State.getSession();
  _baseline = snapshotAnnotations(s && s.annotations);
}
async function saveAnnotationsWithUndo(annotations, label) {
  const session = State.getSession();
  if (!session || !session.sessionFolder) return null;
  const sf = session.sessionFolder;
  // Record the PRE-edit state. The handler already mutated session.annotations
  // in place, so the pre-edit state is _baseline (the last-committed snapshot),
  // NOT snapshotAnnotations(session.annotations) -- that is the post-edit state,
  // which would make undo a no-op. Fall back defensively if the load hook never
  // ran (no worse than the old behaviour, and never writes null).
  const prev = _baseline !== null ? _baseline : snapshotAnnotations(session.annotations);
  State.recordEdit({ label: label || "edit", annotations: prev, sessionFolder: sf });
  _baseline = snapshotAnnotations(annotations);   // this edit is now the committed state
  return await Ipc.saveAnnotations({
    sessionFolder: sf,
    annotations,
  });
}
/* Undo / redo revert one edit by writing the saved annotations blob
   back to disk and refreshing the affected views IN PLACE. The old
   implementation reloaded the whole session -- a viewer:loadSession
   round-trip plus a repaint of every surface -- just to revert one
   edit (issue S6). */
async function performUndo() {
  const session = State.getSession();
  if (!session) return;
  const popped = State.popUndo(session.sessionFolder);
  if (!popped) { toast("Nothing to undo"); return; }
  // Push the CURRENT state onto the redo stack before reverting.
  State.pushRedo({
    label: popped.label,
    annotations: _baseline !== null ? _baseline : snapshotAnnotations(session.annotations),
    sessionFolder: popped.sessionFolder,
  });
  _baseline = snapshotAnnotations(popped.annotations);   // the reverted state is now committed
  await Ipc.saveAnnotations({
    sessionFolder: popped.sessionFolder,
    annotations: popped.annotations,
  });
  applyRevertedAnnotations(popped.annotations);
  toast("Undone: " + popped.label);
}
async function performRedo() {
  const session = State.getSession();
  if (!session) return;
  const popped = State.popRedo(session.sessionFolder);
  if (!popped) { toast("Nothing to redo"); return; }
  // Push current state to undo so the user can flip back.
  State.pushUndo({
    label: popped.label,
    annotations: _baseline !== null ? _baseline : snapshotAnnotations(session.annotations),
    sessionFolder: popped.sessionFolder,
  });
  _baseline = snapshotAnnotations(popped.annotations);   // the redone state is now committed
  await Ipc.saveAnnotations({
    sessionFolder: popped.sessionFolder,
    annotations: popped.annotations,
  });
  applyRevertedAnnotations(popped.annotations);
  toast("Redone: " + popped.label);
}
/* Swap a reverted annotations blob into the loaded session and refresh
   every annotation-derived surface -- the in-place alternative to a
   full session reload. */
function applyRevertedAnnotations(annotations) {
  State.getSession().annotations = ensureAnnoShape(annotations);
  State.batch(() => {
    State.emit("steps");
    State.emit("timeline");
    State.emit("markers");
    State.emit("analysis");
  });
  renderAnnotations();
  renderSessionPills();
}

function ensureAnnoShape(anno) {
  const a = anno || {};
  a.version = 1;
  a.steps = a.steps || [];
  a.phases = a.phases || [];
  a.annotations = a.annotations || [];
  a.notes = a.notes || [];
  a.marker_edits = a.marker_edits || [];
  a.drift_markers = a.drift_markers || [];
  a.excluded_ranges = a.excluded_ranges || [];
  // ADR-0019: analyst-authored reference maps (decoupled editable BPMN copies).
  a.reference_maps = a.reference_maps || [];
  a.step_filters = a.step_filters || { ignored_processes: [], ignored_window_titles: [] };
  if (!Array.isArray(a.step_filters.ignored_processes)) a.step_filters.ignored_processes = [];
  // ADR-0028: case-scoped work-item annotations (name/notes/waste/hidden keyed
  // by {case_id, screen_key}). Additive; pipeline-preserved-not-consumed.
  a.group_annotations = a.group_annotations || [];
  const _sess = State.getSession();
  if (_sess) {
    a.session_id = (_sess.manifest && _sess.manifest.session_id) || a.session_id || "";
    _sess.annotations = a;   // guard: don't deref a null session (was an unguarded crash)
  }
  return a;
}

const DEFAULT_EDIT_TOPICS = ["steps", "timeline"];

async function persistAnnotations(anno, undoLabel, topics) {
  /* Step / marker edits route through here: persist via the
     undo helper (so Ctrl+Z reverts) then emit the change topics so the
     affected views re-render themselves -- no full-session reload.
     `topics` defaults to the safe superset; marker edits pass a
     narrower set. */
  await saveAnnotationsWithUndo(anno, undoLabel || "marker edit");
  State.getSession().annotations = anno;
  State.batch(() => {
    for (const t of (topics || DEFAULT_EDIT_TOPICS)) State.emit(t);
  });
}

/* deps = { renderAnnotations, renderSessionPills }. Call once at boot. */
function initSession(deps) {
  renderAnnotations = deps.renderAnnotations || (() => {});
  renderSessionPills = deps.renderSessionPills || (() => {});
}

module.exports = {
  initSession, resetUndoStack, captureBaseline, canUndo, canRedo,
  saveAnnotationsWithUndo, performUndo, performRedo, applyRevertedAnnotations,
  ensureAnnoShape, persistAnnotations,
};
