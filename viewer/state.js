/*
 * Central state store for the viewer renderer (ADR-0003 Phase 2).
 *
 * The renderer's ~20 scattered module-level `let`s move here behind
 * explicit getters/setters. A tiny topic-based pub/sub bus lets a view
 * re-render itself when something it cares about changes -- replacing
 * the per-edit full-session reload.
 *
 * No framework, no reactivity: getters return values, setters store
 * them, and `emit` / `subscribe` are the only notification mechanism.
 * Loaded via CommonJS `require("./state.js")`, like timeline-core.js.
 *
 * Note: getMultiSelectedStepIds returns the live set so existing
 * field-level mutation keeps working. Mutating it bypasses the bus; the
 * paths that must notify go through emit()/batch() explicitly.
 */

"use strict";

/** @typedef {"overview"|"flow"|"steps"|"map"|"analysis"} Level */

/**
 * Renderable concerns a view can subscribe to. An edit emits the
 * topics it touched; every function subscribed to that topic re-runs.
 * @typedef {"steps"|"timeline"|"markers"} ChangeTopic
 */

/**
 * One reversible edit: the annotations blob as it was BEFORE the edit,
 * pinned to the session folder it belongs to.
 * @typedef {Object} UndoEntry
 * @property {string} label
 * @property {*} annotations
 * @property {string} sessionFolder
 */

/**
 * @typedef {Object} ViewerState
 * @property {*} currentSession         The loaded single session, or null.
 * @property {Level} currentLevel       Active session sub-view.
 * @property {string|null} selectedStepId
 * @property {Set<string>} multiSelectedStepIds
 * @property {string} currentCaseScope  Session-wide case filter; "" = all cases.
 * @property {number} zoomFactor        Flow timeline zoom.
 * @property {*} selectionRange         Flow timeline drag-selected range, or null.
 * @property {UndoEntry[]} undoStack
 * @property {UndoEntry[]} redoStack
 */

/** @type {ViewerState} */
const _s = {
  currentSession: null,
  // Lab-phase §A5: the Overview level (case-quality badge → facts →
  // findings → Export PDD) is the default surface a loaded session opens on.
  currentLevel: "overview",
  selectedStepId: null,
  multiSelectedStepIds: new Set(),
  currentCaseScope: "",
  zoomFactor: 1,
  selectionRange: null,
  undoStack: [],
  redoStack: [],
  pendingStepJumpTs: null,
  // One-shot: reveal the already-selected step row on the NEXT Steps render.
  // Set on arrival at the Steps level (e.g. returning from a Flow jump) so the
  // surviving selection is scrolled back into view -- an arrival, not an
  // incidental re-render (select/rename/flag never set this, so they never
  // scroll). Mirrors pendingStepJumpTs's consume-once discipline.
  pendingStepReveal: false,
  // Contract C19: the level the Steps level (and later the Map) shows, a
  // path of map nodes from the main map down; [] is the main map. The step
  // panel and the Timeline's steps lane follow it.
  mapPath: [],
  // The analysis of the recording on screen: { folder, status } while it runs
  // ("running") or after it did not finish ("failed", "cancelled"); null when
  // none ran or the last one succeeded. The pages that wait for an analysis
  // (the Overview's note, the Map's lock) say which it is.
  analysisRun: null,
};

/* ---- change-notification bus ------------------------------------- */

/** @type {Map<ChangeTopic, Set<() => void>>} */
const _subs = new Map();
/** @type {Set<ChangeTopic>} */
const _pending = new Set();
let _batchDepth = 0;

/**
 * Register `fn` to run whenever `topic` is emitted.
 * @param {ChangeTopic} topic
 * @param {() => void} fn
 * @returns {() => void} an unsubscribe function
 */
function subscribe(topic, fn) {
  let set = _subs.get(topic);
  if (!set) { set = new Set(); _subs.set(topic, set); }
  set.add(fn);
  return () => { const s = _subs.get(topic); if (s) s.delete(fn); };
}

/**
 * Run every subscriber of `topic`. Inside `batch()`, the topic is
 * queued and flushed once when the outermost batch ends.
 * @param {ChangeTopic} topic
 */
function emit(topic) {
  if (_batchDepth > 0) { _pending.add(topic); return; }
  const set = _subs.get(topic);
  if (!set) return;
  for (const fn of [...set]) {       // copy: a callback may (un)subscribe
    try { fn(); }
    catch (e) { console.error("[state] subscriber for '" + topic + "' threw:", e); }
  }
}

/**
 * Coalesce the emits inside `fn` so each affected topic fires once,
 * after `fn` returns -- a multi-topic edit repaints each view once.
 * @param {() => void} fn
 */
function batch(fn) {
  _batchDepth++;
  try { fn(); }
  finally {
    _batchDepth--;
    if (_batchDepth === 0 && _pending.size) {
      const topics = [..._pending];
      _pending.clear();
      for (const t of topics) emit(t);
    }
  }
}

/* ---- undo / redo ------------------------------------------------- */

const UNDO_MAX = 50;

/** @param {UndoEntry[]} stack */
function _trim(stack) { while (stack.length > UNDO_MAX) stack.shift(); }

/**
 * Pop the topmost entry matching `folder` (and only that session).
 * @param {UndoEntry[]} stack
 * @param {string} folder
 * @returns {UndoEntry|null}
 */
function _popForFolder(stack, folder) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].sessionFolder === folder) return stack.splice(i, 1)[0];
  }
  return null;
}

/**
 * Record a new edit's pre-state: push to undo, drop the oldest past
 * the cap, and invalidate the redo stack.
 * @param {UndoEntry} entry
 */
function recordEdit(entry) {
  _s.undoStack.push(entry);
  _trim(_s.undoStack);
  _s.redoStack = [];
}

/**
 * Pop the topmost undo entry for a session (used by Undo).
 * @param {string} folder
 * @returns {UndoEntry|null}
 */
function popUndo(folder) { return _popForFolder(_s.undoStack, folder); }

/**
 * Pop the topmost redo entry for a session (used by Redo).
 * @param {string} folder
 * @returns {UndoEntry|null}
 */
function popRedo(folder) { return _popForFolder(_s.redoStack, folder); }

/**
 * Push an entry onto the undo stack WITHOUT clearing redo (used by
 * Redo, which must leave the rest of the redo stack intact).
 * @param {UndoEntry} entry
 */
function pushUndo(entry) { _s.undoStack.push(entry); _trim(_s.undoStack); }

/**
 * Push an entry onto the redo stack (used by Undo to make the edit
 * redoable).
 * @param {UndoEntry} entry
 */
function pushRedo(entry) { _s.redoStack.push(entry); _trim(_s.redoStack); }

/** Clear both stacks -- called when a different session is opened. */
function resetUndo() { _s.undoStack = []; _s.redoStack = []; }

/** @param {string} folder @returns {boolean} */
function canUndo(folder) { return _s.undoStack.some(e => e.sessionFolder === folder); }

/** @param {string} folder @returns {boolean} */
function canRedo(folder) { return _s.redoStack.some(e => e.sessionFolder === folder); }

/* ---- accessors --------------------------------------------------- */

/* Session */
function getSession() { return _s.currentSession; }
/** @param {*} v */
function setSession(v) { _s.currentSession = v; }

/* Level */
/** @returns {Level} */
function getLevel() { return _s.currentLevel; }
/** @param {Level} v */
function setLevel(v) { _s.currentLevel = v; }

/* Selection */
function getSelectedStepId() { return _s.selectedStepId; }
/** @param {string|null} v */
function setSelectedStepId(v) { _s.selectedStepId = v; }
/** @returns {Set<string>} the live set */
function getMultiSelectedStepIds() { return _s.multiSelectedStepIds; }
/** @param {Set<string>} v */
function setMultiSelectedStepIds(v) { _s.multiSelectedStepIds = v; }

/* Case scope */
function getCaseScope() { return _s.currentCaseScope; }
/** @param {string} v */
function setCaseScope(v) { _s.currentCaseScope = v; }

/* Cross-view step-jump request: a Flow seek (band click, marker click,
   right-click "Jump to step here", ...) parks the requested timestamp
   here; the next Steps view render consumes it once to focus on the
   step containing that timestamp. */
/** @param {string} ts */
function setPendingStepJump(ts) { _s.pendingStepJumpTs = ts; }
/** @returns {string|null} */
function consumePendingStepJump() {
  const ts = _s.pendingStepJumpTs;
  _s.pendingStepJumpTs = null;
  return ts;
}
/* One-shot "reveal the selected step on the next Steps render" flag (arrival
   reveal for a surviving selection). Consume-once, same as the jump above. */
function setPendingStepReveal() { _s.pendingStepReveal = true; }
/** @returns {boolean} */
function consumePendingStepReveal() {
  const v = _s.pendingStepReveal;
  _s.pendingStepReveal = false;
  return v;
}

/* Zoom */
function getZoomFactor() { return _s.zoomFactor; }
/** @param {number} v */
function setZoomFactor(v) { _s.zoomFactor = v; }

/* Flow timeline range selection */
function getSelectionRange() { return _s.selectionRange; }
/** @param {*} v */
function setSelectionRange(v) { _s.selectionRange = v; }

/* The current level (C19): a copy of the path of map nodes ([] the main map). */
/** @returns {string[]} */
function getMapPath() { return _s.mapPath.slice(); }
/** @param {string[]} v */
function setMapPath(v) { _s.mapPath = Array.isArray(v) ? v.filter((n) => typeof n === "string") : []; }

/* The analysis run of a recording: { folder, status } or null (see _s). */
function getAnalysisRun() { return _s.analysisRun; }
/** @param {*} v */
function setAnalysisRun(v) { _s.analysisRun = v || null; }

module.exports = {
  // change-notification bus
  subscribe, emit, batch,
  // undo / redo
  recordEdit, popUndo, popRedo, pushUndo, pushRedo, resetUndo, canUndo, canRedo, UNDO_MAX,
  // session
  getSession, setSession,
  // level
  getLevel, setLevel,
  // selection
  getSelectedStepId, setSelectedStepId,
  getMultiSelectedStepIds, setMultiSelectedStepIds,
  // case scope
  getCaseScope, setCaseScope,
  // cross-view step-jump request
  setPendingStepJump, consumePendingStepJump,
  setPendingStepReveal, consumePendingStepReveal,
  // zoom
  getZoomFactor, setZoomFactor,
  // flow timeline range selection
  getSelectionRange, setSelectionRange,
  // the current level (C19)
  getMapPath, setMapPath,
  // the analysis run of the recording on screen
  getAnalysisRun, setAnalysisRun,
};
