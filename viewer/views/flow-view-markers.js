/*
 * flow-view-markers.js: the Flow level's marker edits:
 *   - the per-marker move / delete / rename actions, for captured and
 *     inserted markers alike; moveMarker is also the move a transaction's
 *     edge dragged on the timeline makes (flow-view-timeline.js, 2.0.3),
 *     and renameMarker and deleteMarker the acts of a transaction's header
 *     in the Timeline's pane (views/timeline-pane.js; lane PANE: the
 *     Markers tab that listed the markers is gone). Every change shows at
 *     once, on the timeline, and the steps follow it a moment later, in
 *     every project (D4, flow-view.js scheduleAutoApply).
 *
 * Extracted from flow-view.js (god-file split). Requires flow-view-video.js
 * for timelineSpan (one-way), and never require()s
 * flow-view.js back.
 *
 * The marker-INSERT surfaces (showMarkerInsertMenu, queueSyntheticMarker,
 * queueMarkerDelete) stay in flow-view.js with their timeline-right-click /
 * summary triggers.
 */

"use strict";

const State = require("../state.js");
const { cryptoRandomId, toast, parseClock } = require("../dom.js");
const { confirmModal } = require("../modals.js");
const { persistAnnotations } = require("../session.js");
const { timelineSpan } = require("./flow-view-video.js");
const MarkerEdits = require("../marker-edits.js");
const AC = require("../analyst-content.js");
const TE = require("../time-edits.js");

/* The label shown for one captured marker event (renames applied). */
function effectiveLabel(markerEvent) {
  const view = MarkerEdits.sessionMarkerView(State.getSession());
  const row = view.find((m) => m.eventId === markerEvent.event_id);
  return row ? row.label : ((markerEvent.data || {}).label || null);
}

/* ============ Per-marker edits ===================================== */

/* The steps of the analyst's follow a marker change, in the same edit, read
   on the markers as they are with it (time-edits.js): a transaction's end,
   or the next one's start, ends the step that runs past it (2.0.3, the
   owner: "the duration is endless"); and (the owner: "you always add steps
   sequentially") a step side joined to a transaction's side goes with it
   when `change` moves it ({ type, fromMs, toMs }) or takes it out
   ({ type, fromMs, removed: true }). Returns how many steps changed. */
function clipStepsToTransactions(anno, change) {
  const sess = State.getSession();
  if (!sess || !anno) return 0;
  const view = MarkerEdits.markerView(sess.events || [], anno.marker_edits, MarkerEdits.lastAnalysisMs(sess));
  const moments = TE.markerMoments(MarkerEdits.currentMarkerEvents(view));
  const main = (anno.steps || []).filter((s) => s && s.state !== "hidden" && AC.hasTime(s));
  const span = (s) => ({ id: s.step_id, startMs: Date.parse(s.time_range.start), endMs: Date.parse(s.time_range.end) });
  const others = main.map(span).filter((o) => Number.isFinite(o.startMs) && Number.isFinite(o.endMs));
  const mine = main.filter((s) => AC.stepTimeMovable(s));
  const byId = new Map(mine.map((s) => [s.step_id, s]));
  const changed = new Set();
  const set = (id, startMs, endMs) => {
    const s = byId.get(id);
    s.time_range = { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
    AC.markEdited(s);
    changed.add(id);
  };
  if (change && Number.isFinite(change.fromMs)) {
    const sp = timelineSpan();
    const moves = change.removed
      ? TE.followRemoval(mine.map(span), others, change.fromMs, moments, sp ? sp.endMs : NaN)
      : TE.followMarker(mine.map(span), others, change.type, change.fromMs, change.toMs);
    for (const m of moves) set(m.id, m.startMs, m.endMs);
  }
  for (const c of TE.cutAtBoundaries(mine.map(span), moments)) set(c.id, Date.parse(byId.get(c.id).time_range.start), c.endMs);
  return changed.size;
}

/* The topics a marker change draws again: the steps too when it cut one. */
function _topics(topics, cut) {
  const t = topics || ["markers", "timeline"];
  return cut && !t.includes("steps") ? t.concat("steps") : t;
}

/* Why the capture app ended a transaction by itself, in plain words (lane
   FX3, validation pass 3, F20): the next transaction started (the SME's key
   or Next transaction ends the open one first), or a long idle stretch
   ended it. A reason the app does not know is not shown: never a raw code. */
const END_REASONS = {
  auto_close_for_sibling: "the next transaction started",
  auto_end_idle: "after a long idle stretch",
};
function markerReasonText(reason) {
  return (typeof reason === "string" && END_REASONS[reason]) || "";
}

function _annotations() {
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  return anno;
}

/* The insert edit behind an inserted marker row (its id is the row's editId). */
function _insertEdit(anno, m) {
  return m.editId ? anno.marker_edits.find((e) => e && e.op === "insert" && e.id === m.editId) || null : null;
}

/* 2.0.3: an insert edit is its marker, changed in place. Before one the
   last analysis used is moved or renamed, it keeps what that analysis used
   (applied_timestamp, applied_label; marker-edits.js markerView reads them
   while the change waits), so the transaction it starts or ends stays the
   analysis's until the change is applied. Pure on the edit. */
function keepApplied(e, analyzedMs) {
  if (!e || MarkerEdits.isPendingEdit(e, analyzedMs)) return;
  e.applied_timestamp = e.timestamp;
  e.applied_label = e.label == null ? null : e.label;
}

/* Whether the last analysis used an inserted marker's edit (as it was, or
   as it kept it before a change that waits). */
function _insertApplied(e, analyzedMs) {
  return !MarkerEdits.isPendingEdit(e, analyzedMs) || (typeof e.applied_timestamp === "string" && !!e.applied_timestamp);
}

/* The moment a typed time since the recording started ("1:05", "1:02:03",
   as the timeline and this list show it) names, as an ISO string; null when
   the text is not such a time. Pure (exported for the unit tests). */
function sinceStartToIso(originMs, text) {
  const ms = parseClock(text);
  return ms != null && isFinite(originMs) ? new Date(originMs + ms).toISOString() : null;
}

/* Move one marker (a row of the marker view) to `newTs`, an ISO time: the
   2.0.3, a transaction's side dragged on the
   timeline or typed in Steps. An inserted marker IS its insert edit, which
   moves itself; a captured marker gets a timestamp edit, or, while an earlier
   move of it still waits for the analysis, that edit takes the new time (a
   marker dragged three times is one change to apply). One undoable
   edit; `topics` the views drawn again (the markers and the timeline by
   default). Resolves true when saved. */
async function moveMarker(m, newTs, topics) {
  if (!State.getSession() || !m) return false;
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    const e = _insertEdit(anno, m);
    if (!e) { toast("This start or end of a transaction could not be found in the project's changes.", "error"); return false; }
    keepApplied(e, MarkerEdits.lastAnalysisMs(State.getSession()));
    e.timestamp = newTs;
    e.ts = now;
  } else {
    const analyzed = MarkerEdits.lastAnalysisMs(State.getSession());
    const waiting = anno.marker_edits.filter((e) => e && e.event_id === m.eventId && e.field === "timestamp" &&
      MarkerEdits.isPendingEdit(e, analyzed)).pop();
    if (waiting) {
      waiting.value = newTs;
      waiting.ts = now;
    } else {
      anno.marker_edits.push({
        id: cryptoRandomId(), event_id: m.eventId, field: "timestamp",
        value: newTs, previous: m.timestamp, ts: now,
      });
    }
  }
  const cut = clipStepsToTransactions(anno, { type: m.markerType, fromMs: Date.parse(m.timestamp), toMs: Date.parse(newTs) });
  await persistAnnotations(anno, "move a transaction's start or end", _topics(topics, cut));
  return true;
}

/* Markers added (2.0.3: an End or a Start typed in Steps, an end dragged
   on the Timeline), with no question asked: `adds` [{ type, ts, label }],
   insert edits the next analysis applies. One undoable edit. Resolves
   true when saved. */
async function insertMarkers(adds, topics) {
  if (!State.getSession() || !(adds || []).length) return false;
  const anno = _annotations();
  const now = new Date().toISOString();
  for (const a of adds) {
    anno.marker_edits.push({
      id: cryptoRandomId(), op: "insert", marker_type: a.type === "end" ? "end" : "start",
      label: a.label || null, timestamp: a.ts, ts: now,
    });
  }
  const cut = clipStepsToTransactions(anno);
  await persistAnnotations(anno, adds.length === 1 ? (adds[0].type === "end" ? "end a transaction" : "start a transaction")
    : "mark transactions", _topics(topics, cut));
  return true;
}
function insertMarker(markerType, ts, label, topics) {
  return insertMarkers([{ type: markerType, ts, label }], topics);
}

/* Take one marker out (a row of the marker view): an added one's insert edit
   goes (with a delete of its id when the last analysis already applied it),
   a captured one gets a delete edit. Delete transaction, after its
   question, and (2.0.3) an End cleared in Steps. One undoable edit. Resolves
   true when saved. */
async function removeMarker(m, topics) {
  if (!State.getSession() || !m) return false;
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    const e = _insertEdit(anno, m);
    if (!e) { toast("This start or end of a transaction could not be found in the project's changes.", "error"); return false; }
    anno.marker_edits = anno.marker_edits.filter((x) => x !== e);
    // An insert the last analysis already applied needs one more analysis to
    // take it out again: a delete of its marker id is that change, newer
    // than the analysis (the pipeline ignores a delete whose marker no longer
    // exists).
    if (_insertApplied(e, MarkerEdits.lastAnalysisMs(State.getSession()))) {
      anno.marker_edits.push({ id: cryptoRandomId(), event_id: m.key, op: "delete", ts: now });
    }
  } else {
    anno.marker_edits.push({ id: cryptoRandomId(), event_id: m.eventId, op: "delete", ts: now });
  }
  const cut = clipStepsToTransactions(anno, { type: m.markerType, fromMs: Date.parse(m.timestamp), removed: true });
  await persistAnnotations(anno, "take out a transaction's start or end", _topics(topics, cut));
  return true;
}

/* Delete transaction, on a transaction's header in the Timeline's pane (lane
   PANE): `m` is its Start (the marker view's row). Asks first; the steps
   follow a moment later (D4). The messages name the transaction, not its
   marker. */
async function deleteMarker(m) {
  if (!State.getSession() || !m) return;
  const ok = await confirmModal({
    title: "Delete transaction?",
    message: "Its stretch of the timeline will no longer be a transaction of its own.",
    detail: "Ctrl+Z restores it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (await removeMarker(m)) toast("Transaction deleted.", "success");
}

async function renameMarker(m, newLabel) {
  if (!State.getSession()) return;
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    const e = _insertEdit(anno, m);
    if (!e) { toast("This start or end of a transaction could not be found in the project's changes.", "error"); return; }
    keepApplied(e, MarkerEdits.lastAnalysisMs(State.getSession()));
    e.label = newLabel;
    e.ts = now;
  } else {
    anno.marker_edits.push({
      id: cryptoRandomId(), event_id: m.eventId, field: "label",
      value: newLabel, previous: m.label, ts: now,
    });
  }
  // Route through persistAnnotations like the other marker edits so the
  // rename lands on the undo stack (Ctrl+Z reverts it) and refreshes the
  // _baseline -- a raw saveAnnotations bypassed undo and left a stale
  // baseline that made the NEXT edit's undo also revert this rename (H-5).
  // The "markers"/"timeline" topics re-render the side panel and the
  // marker labels on the timeline.
  await persistAnnotations(anno, "rename a transaction", ["markers", "timeline"]);
  toast("Transaction renamed.", "success");
}

module.exports = {
  effectiveLabel, sinceStartToIso, markerReasonText, moveMarker, insertMarker, insertMarkers, removeMarker,
  // Lane PANE: a transaction's header in the Timeline's pane.
  renameMarker, deleteMarker,
  keepApplied, clipStepsToTransactions,
};
