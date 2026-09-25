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
 * renderSessionPills (the flow-view surface refreshed after an in-place
 * revert) is injected by renderer.js via initSession().
 *
 * RP-04: every annotations.json write in the renderer goes through
 * writeAnnotations() here (the undo-recording save, persistAnnotations,
 * undo/redo and the direct settings save), in call order. A write that fails
 * is surfaced to the analyst (an error toast naming the problem) and
 * REJECTS, so the caller's success path (its "saved" toast, its reload)
 * never runs; the undo stack and the baseline stay at the last state that is
 * actually on disk, so nothing is recorded as done that was not saved. The
 * edit itself stays in memory (and on screen), so the next successful save
 * still writes it: a failure never throws the analyst's work away.
 */

"use strict";

const State = require("./state.js");
const Ipc = require("./ipc.js");
// Property access (not destructuring) so the unit tests can stub Dom.toast.
const Dom = require("./dom.js");

/* Injected by renderer.js. */
let renderSessionPills = () => {};
let reloadSession = async () => {};
let analyzeSession = async () => {};

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
  return { steps: [], annotations: [], notes: [], marker_edits: [], excluded_ranges: [], reference_maps: [] };
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

/* Writes run one at a time, in call order: each save's undo entry must hold
   the state the PREVIOUS save committed, which is only known once that save
   has succeeded or failed. */
let _writeChain = Promise.resolve();
function _serial(fn) {
  const run = _writeChain.then(fn, fn);
  _writeChain = run.catch(() => {});   // one failure must not block later saves
  return run;
}

/* An error the analyst has already been shown (see the unhandledrejection
   hook below). */
function _surfacedError(message) {
  const err = new Error(message);
  err.pdtSurfaced = true;
  return err;
}

/* Called, and awaited, before every annotations write: the Overview's rows
   refresh stops first (overview-view.js), since the analysis it runs would
   refuse the write. */
let _beforeWrite = null;
function setBeforeWrite(fn) { _beforeWrite = typeof fn === "function" ? fn : null; }

/* The one renderer write path for annotations.json (RP-04). Resolves to the
   main-process result ({ ok: true, path }) or rejects with an error that has
   ALREADY been shown to the analyst as an error toast. `what` names the edit
   in that message. */
async function writeAnnotations(sessionFolder, annotations, what) {
  if (_beforeWrite) {
    try { await _beforeWrite(sessionFolder); }
    catch (e) { console.error("[session] before the write:", e); }
  }
  let r;
  try {
    r = await Ipc.saveAnnotations({ sessionFolder, annotations });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (!r || r.ok !== true) {
    const reason = (r && r.error) || "no reason was given";
    // While the steps and the map are updated (ANALYSIS_RUNNING) the page is
    // reloaded when the update ends, so the change does not stay on screen.
    const msg = "Your change" + (what ? " (" + what + ")" : "") + " was not saved: " + reason +
      (r && (r.code === "ANNOTATIONS_UNREADABLE" || r.code === "ANALYSIS_RUNNING")
        ? ""
        : " The change is still on screen; it is saved with your next change once the problem is fixed.");
    console.error("[session] annotations.json not saved:", reason);
    Dom.toast(msg, "error");
    throw _surfacedError(msg);
  }
  if (r.backupError) Dom.toast("Saved, but the backup copy of annotations.json failed: " + r.backupError, "error");
  // A file the change takes out of the folder, or an undo brings back, that
  // main could not move: said, and held over the act's own success message.
  if (r.filesError) {
    Dom.toast("Saved, but a file was not moved out of the project folder or back into it (" + r.filesError +
      "). A file open in another program cannot be moved.", "error", { hold: true });
  }
  return r;
}

async function saveAnnotationsWithUndo(annotations, label) {
  const session = State.getSession();
  if (!session || !session.sessionFolder) return null;
  const sf = session.sessionFolder;
  const snap = snapshotAnnotations(annotations);
  return _serial(async () => {
    const r = await writeAnnotations(sf, annotations, label);
    // Only a save that reached the disk becomes undoable and moves the
    // baseline. Record the PRE-edit state: the handler already mutated
    // session.annotations in place, so the pre-edit state is _baseline (the
    // last-committed snapshot), NOT snapshotAnnotations(session.annotations)
    // -- that is the post-edit state, which would make undo a no-op. Fall
    // back defensively if the load hook never ran (never writes null).
    // A save still queued when another session was opened has written its
    // own folder; it records no undo entry (the switch cleared that stack)
    // and must not move the new session's baseline.
    if (State.getSession() !== session) return r;
    const prev = _baseline !== null ? _baseline : snapshotAnnotations(session.annotations);
    State.recordEdit({ label: label || "edit", annotations: prev, sessionFolder: sf });
    _baseline = snap;   // this edit is now the committed state
    return r;
  });
}

/* A settings write that is deliberately NOT undoable (the caller re-analyzes
   right after), through the same surfaced-failure path. On success it is the
   committed state, so the baseline follows it. */
async function saveAnnotationsDirect(annotations, what) {
  const session = State.getSession();
  if (!session || !session.sessionFolder) return null;
  const sf = session.sessionFolder;
  const snap = snapshotAnnotations(annotations);
  return _serial(async () => {
    const r = await writeAnnotations(sf, annotations, what);
    if (State.getSession() === session) _baseline = snap;
    return r;
  });
}

/* Undo / redo revert one edit by writing the saved annotations blob
   back to disk and refreshing the affected views IN PLACE. The old
   implementation reloaded the whole session -- a viewer:loadSession
   round-trip plus a repaint of every surface -- just to revert one
   edit (issue S6). A failed write puts the popped entry back and changes
   nothing (writeAnnotations has already shown the error). */
function performUndo() { return _revert("undo"); }
function performRedo() { return _revert("redo"); }

/* A change of the project's files that is not an annotations edit, made
   undoable (lane CC: Remove transcript, whose files are not named by
   annotations.json). `act` = { undo: async () => bool, redo: async () =>
   bool }: each puts the files back or takes them out again and says whether
   it did (a failure has been shown to the analyst). The entry holds the
   annotations as they are, so an undo past it leaves them alone. */
function recordFileAct(label, act) {
  const session = State.getSession();
  if (!session || !session.sessionFolder || !act) return Promise.resolve();
  // After the saves already queued, so the entries keep the order of the acts.
  return _serial(async () => {
    if (State.getSession() !== session) return;
    State.recordEdit({ label: label || "edit", sessionFolder: session.sessionFolder,
      annotations: _baseline !== null ? _baseline : snapshotAnnotations(session.annotations), fileAct: act });
  });
}

function _revert(which) {
  const session = State.getSession();
  if (!session) return Promise.resolve();
  return _serial(async () => {
    if (State.getSession() !== session) return;   // another session was opened meanwhile
    const popped = which === "undo" ? State.popUndo(session.sessionFolder) : State.popRedo(session.sessionFolder);
    if (!popped) { Dom.toast(which === "undo" ? "Nothing to undo" : "Nothing to redo"); return; }
    if (popped.fileAct) {
      let ok = false;
      try { ok = !!(await (which === "undo" ? popped.fileAct.undo() : popped.fileAct.redo())); }
      catch (e) { console.error("[session] the " + which + " of " + popped.label + " failed:", e); }
      if (!ok) {
        if (which === "undo") State.pushUndo(popped); else State.pushRedo(popped);
        return;
      }
      if (which === "undo") State.pushRedo(popped); else State.pushUndo(popped);
      Dom.toast((which === "undo" ? "Undone: " : "Redone: ") + popped.label);
      return;
    }
    // Opening a run is not an edit (steps-view.js _markOpened): the runs
    // opened so far stay opened across an undo or a redo.
    const opened = (session.annotations && session.annotations.opened_runs) || [];
    if (opened.length && popped.annotations) {
      popped.annotations.opened_runs = [...new Set([...(popped.annotations.opened_runs || []), ...opened])];
    }
    try {
      await writeAnnotations(popped.sessionFolder, popped.annotations, which + ": " + popped.label);
    } catch (_) {
      // Already shown to the analyst; put the entry back so nothing moved.
      if (which === "undo") State.pushUndo(popped); else State.pushRedo(popped);
      return;
    }
    // Push the CURRENT (pre-revert) state onto the opposite stack so the
    // analyst can flip back.
    const current = {
      label: popped.label,
      annotations: _baseline !== null ? _baseline : snapshotAnnotations(session.annotations),
      sessionFolder: popped.sessionFolder,
    };
    if (which === "undo") State.pushRedo(current); else State.pushUndo(current);
    _baseline = snapshotAnnotations(popped.annotations);   // the reverted state is now committed
    applyRevertedAnnotations(popped.annotations);
    Dom.toast((which === "undo" ? "Undone: " : "Redone: ") + popped.label);
  });
}
/* What an undo or a redo from `before` to `after` needs beyond the in-place
   refresh: "analyze" when the stretches left out of the analysis changed
   (the steps and the statistics depend on them, so Leave out of the analysis
   and Include again are undone with the analysis they ran), "reload" when the
   attached video changed (where the video is, and its sync, are read when the
   project loads), else null. Pure. */
function revertFollowUp(before, after) {
  const same = (k) => JSON.stringify((before && before[k]) || null) === JSON.stringify((after && after[k]) || null);
  const ranges = (a) => JSON.stringify((a && Array.isArray(a.excluded_ranges) && a.excluded_ranges.length) ? a.excluded_ranges : []);
  if (ranges(before) !== ranges(after)) return "analyze";
  if (!same("external_video")) return "reload";
  return null;
}

/* Swap a reverted annotations blob into the loaded session and refresh
   every annotation-derived surface -- the in-place alternative to a
   full session reload. An undo that changes what the analysis reads, or the
   video, then analyzes or reloads (revertFollowUp). */
function applyRevertedAnnotations(annotations) {
  const sess = State.getSession();
  const follow = revertFollowUp(sess.annotations, annotations);
  sess.annotations = ensureAnnoShape(annotations);
  State.batch(() => {
    State.emit("steps");
    State.emit("timeline");
    State.emit("markers");
    State.emit("analysis");
  });
  renderSessionPills();
  // Not awaited: the write chain this runs in must not wait for an analysis
  // (which reloads the project when it ends).
  if (follow === "analyze") Promise.resolve(analyzeSession()).catch((e) => console.error("[session] the analysis after the undo failed:", e));
  else if (follow === "reload") Promise.resolve(reloadSession(sess.sessionFolder)).catch((e) => console.error("[session] the reload after the undo failed:", e));
}

function ensureAnnoShape(anno) {
  const a = anno || {};
  a.version = 1;
  a.steps = a.steps || [];
  a.annotations = a.annotations || [];
  a.notes = a.notes || [];
  a.marker_edits = a.marker_edits || [];
  a.excluded_ranges = a.excluded_ranges || [];
  // Keys of cut features (phases, drift_markers, ...) are not seeded; an
  // older file keeps them as they are (C10).
  // ADR-0019: analyst-authored reference maps (decoupled editable BPMN copies).
  a.reference_maps = a.reference_maps || [];
  a.step_filters = a.step_filters || { ignored_processes: [], ignored_window_titles: [] };
  if (!Array.isArray(a.step_filters.ignored_processes)) a.step_filters.ignored_processes = [];
  // group_annotations (the removed Steps case tree, ADR-0028) is no longer
  // written; an older file keeps the key as it is (C10).
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
     narrower set. A failed save still re-renders (the screen shows what is
     in memory, which the next successful save writes) and then rejects, so
     the caller's success message never follows an unsaved edit. */
  const session = State.getSession();
  try {
    await saveAnnotationsWithUndo(anno, undoLabel || "marker edit");
  } finally {
    // Only the session the edit belongs to (another may have been opened
    // while the save was queued).
    if (session && State.getSession() === session) {
      session.annotations = anno;
      State.batch(() => {
        for (const t of (topics || DEFAULT_EDIT_TOPICS)) State.emit(t);
      });
    }
  }
}

/* A rejected save has already been shown to the analyst (writeAnnotations);
   a caller that does not catch it would ALSO print an "Uncaught (in
   promise)" page error for the same failure. Mark only those as handled;
   every other rejection is left alone. */
if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
  window.addEventListener("unhandledrejection", (e) => {
    if (e && e.reason && e.reason.pdtSurfaced) e.preventDefault();
  });
}

/* deps = { renderSessionPills, reloadSession(folder), analyzeSession() }.
   Call once at boot. */
function initSession(deps) {
  renderSessionPills = deps.renderSessionPills || (() => {});
  reloadSession = deps.reloadSession || (async () => {});
  analyzeSession = deps.analyzeSession || (async () => {});
}

module.exports = {
  initSession, resetUndoStack, captureBaseline, canUndo, canRedo,
  writeAnnotations, saveAnnotationsWithUndo, saveAnnotationsDirect, recordFileAct, setBeforeWrite,
  performUndo, performRedo, applyRevertedAnnotations, revertFollowUp,
  ensureAnnoShape, persistAnnotations,
};
