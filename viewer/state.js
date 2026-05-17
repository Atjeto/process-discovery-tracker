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
 * Note: getListFilters / getCanonicalState / getVocabState / and
 * getMultiSelectedStepIds return the live object so existing
 * field-level mutation keeps working. Mutating those bypasses the bus;
 * the paths that must notify go through emit()/batch() explicitly.
 */

"use strict";

/** @typedef {"flow"|"steps"|"phases"|"analysis"} Level */

/**
 * Renderable concerns a view can subscribe to. An edit emits the
 * topics it touched; every function subscribed to that topic re-runs.
 * @typedef {"steps"|"phases"|"timeline"|"markers"} ChangeTopic
 */

/**
 * @typedef {Object} ListFilters
 * @property {{ text: string, states: Set<string> }} step
 * @property {{ text: string }} phase
 * @property {{ text: string }} marker
 */

/**
 * @typedef {Object} CanonicalState
 * @property {string|null} path
 * @property {string|null} content
 * @property {*} parsed
 * @property {string|null} exemplarFolder
 */

/**
 * @typedef {Object} VocabState
 * @property {*[]} list
 * @property {string|null} selectedPath
 * @property {*} current
 * @property {boolean} dirty
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
 * @property {*[]} aggregateSessions    Sessions loaded for the Aggregate surface.
 * @property {Level} currentLevel       Active session sub-view.
 * @property {string|null} selectedStepId
 * @property {Set<string>} multiSelectedStepIds
 * @property {string|null} selectedPhaseId
 * @property {ListFilters} listFilters
 * @property {string} currentCaseScope  Session-wide case filter; "" = all cases.
 * @property {number} stepZoom
 * @property {number} phaseZoom
 * @property {number} zoomFactor        Flow timeline zoom.
 * @property {*} selectionRange         Flow timeline drag-selected range, or null.
 * @property {Level} aggregateLevel
 * @property {CanonicalState} canonicalState
 * @property {VocabState} vocabState
 * @property {string} aggregateFilter
 * @property {string} aggregateFromDate
 * @property {string} aggregateToDate
 * @property {UndoEntry[]} undoStack
 * @property {UndoEntry[]} redoStack
 */

/** @type {ViewerState} */
const _s = {
  currentSession: null,
  aggregateSessions: [],
  currentLevel: "flow",
  selectedStepId: null,
  multiSelectedStepIds: new Set(),
  selectedPhaseId: null,
  listFilters: {
    step:   { text: "", states: new Set() },
    phase:  { text: "" },
    marker: { text: "" },
  },
  currentCaseScope: "",
  stepZoom: 1,
  phaseZoom: 1,
  zoomFactor: 1,
  selectionRange: null,
  aggregateLevel: "flow",
  canonicalState: { path: null, content: null, parsed: null, exemplarFolder: null },
  vocabState: { list: [], selectedPath: null, current: null, dirty: false },
  aggregateFilter: "",
  aggregateFromDate: "",
  aggregateToDate: "",
  undoStack: [],
  redoStack: [],
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
function getAggregateSessions() { return _s.aggregateSessions; }
/** @param {*[]} v */
function setAggregateSessions(v) { _s.aggregateSessions = v; }

/* Level */
/** @returns {Level} */
function getLevel() { return _s.currentLevel; }
/** @param {Level} v */
function setLevel(v) { _s.currentLevel = v; }
/** @returns {Level} */
function getAggregateLevel() { return _s.aggregateLevel; }
/** @param {Level} v */
function setAggregateLevel(v) { _s.aggregateLevel = v; }

/* Selection */
function getSelectedStepId() { return _s.selectedStepId; }
/** @param {string|null} v */
function setSelectedStepId(v) { _s.selectedStepId = v; }
function getSelectedPhaseId() { return _s.selectedPhaseId; }
/** @param {string|null} v */
function setSelectedPhaseId(v) { _s.selectedPhaseId = v; }
/** @returns {Set<string>} the live set */
function getMultiSelectedStepIds() { return _s.multiSelectedStepIds; }
/** @param {Set<string>} v */
function setMultiSelectedStepIds(v) { _s.multiSelectedStepIds = v; }

/* Filters & case scope */
/** @returns {ListFilters} the live object */
function getListFilters() { return _s.listFilters; }
function getCaseScope() { return _s.currentCaseScope; }
/** @param {string} v */
function setCaseScope(v) { _s.currentCaseScope = v; }

/* Zoom */
function getZoomFactor() { return _s.zoomFactor; }
/** @param {number} v */
function setZoomFactor(v) { _s.zoomFactor = v; }
function getStepZoom() { return _s.stepZoom; }
/** @param {number} v */
function setStepZoom(v) { _s.stepZoom = v; }
function getPhaseZoom() { return _s.phaseZoom; }
/** @param {number} v */
function setPhaseZoom(v) { _s.phaseZoom = v; }

/* Flow timeline range selection */
function getSelectionRange() { return _s.selectionRange; }
/** @param {*} v */
function setSelectionRange(v) { _s.selectionRange = v; }

/* Aggregate filters */
function getAggregateFilter() { return _s.aggregateFilter; }
/** @param {string} v */
function setAggregateFilter(v) { _s.aggregateFilter = v; }
function getAggregateFromDate() { return _s.aggregateFromDate; }
/** @param {string} v */
function setAggregateFromDate(v) { _s.aggregateFromDate = v; }
function getAggregateToDate() { return _s.aggregateToDate; }
/** @param {string} v */
function setAggregateToDate(v) { _s.aggregateToDate = v; }

/* Process Template & Vocabulary editors */
/** @returns {CanonicalState} the live object */
function getCanonicalState() { return _s.canonicalState; }
/** @returns {VocabState} the live object */
function getVocabState() { return _s.vocabState; }

module.exports = {
  // change-notification bus
  subscribe, emit, batch,
  // undo / redo
  recordEdit, popUndo, popRedo, pushUndo, pushRedo, resetUndo, canUndo, canRedo, UNDO_MAX,
  // session
  getSession, setSession, getAggregateSessions, setAggregateSessions,
  // level
  getLevel, setLevel, getAggregateLevel, setAggregateLevel,
  // selection
  getSelectedStepId, setSelectedStepId, getSelectedPhaseId, setSelectedPhaseId,
  getMultiSelectedStepIds, setMultiSelectedStepIds,
  // filters & case scope
  getListFilters, getCaseScope, setCaseScope,
  // zoom
  getZoomFactor, setZoomFactor, getStepZoom, setStepZoom, getPhaseZoom, setPhaseZoom,
  // flow timeline range selection
  getSelectionRange, setSelectionRange,
  // aggregate filters
  getAggregateFilter, setAggregateFilter,
  getAggregateFromDate, setAggregateFromDate, getAggregateToDate, setAggregateToDate,
  // template & vocab editors
  getCanonicalState, getVocabState,
};
