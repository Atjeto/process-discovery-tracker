/*
 * marker-edits.js: the markers the analyst sees, i.e. the captured marker
 * events with annotations.marker_edits laid over them. Pure; unit-tested.
 *
 * The analyst never changes events.jsonl. Inserting, moving, renaming or
 * deleting a marker queues an entry in annotations.marker_edits, which the
 * pipeline replays on every analysis (normalization/marker_edits.py) and keeps.
 * So an edit is PENDING until an analysis has run after it: it was made
 * (edit.ts) later than the last analysis (stats.meta.normalization_run_at),
 * or the session was never analyzed. Pending edits show at once in the
 * Markers list and on the timeline, with one call to action (Apply marker
 * changes);
 * applied edits read as ordinary markers. The timeline's case lane draws the
 * markers as they are now (2.0.3), a transaction the last analysis has not
 * seen drawn pending; the steps and the Transaction select follow what the
 * last analysis used.
 *
 * Mirrors the pipeline's replay: last write wins per marker and field, a
 * delete drops the marker, and an insert becomes a marker whose event id is
 * "insert-<edit id>" (an insert with no timestamp is skipped, as there).
 */

"use strict";

/* The time of the last analysis in epoch ms, or NaN when never analyzed. */
function lastAnalysisMs(session) {
  const meta = (session && session.stats && session.stats.meta) || {};
  const t = Date.parse(meta.normalization_run_at || "");
  return Number.isFinite(t) ? t : NaN;
}

/* Whether one marker edit still waits for an analysis. An edit without a
   time (older data) cannot be dated: once the session has an analysis it
   is taken as applied, since every analysis replays every edit. */
function isPendingEdit(edit, analyzedMs) {
  if (!Number.isFinite(analyzedMs)) return true;
  const t = Date.parse((edit && edit.ts) || "");
  return Number.isFinite(t) && t > analyzedMs;
}

function _validEdits(markerEdits) {
  return (Array.isArray(markerEdits) ? markerEdits : []).filter((e) =>
    e && typeof e === "object" && (e.op === "insert" ? !!e.timestamp : !!e.event_id));
}

/* One row per marker the analyst sees, sorted by the time shown:
     key            event id, or "insert-<edit id>" for an inserted marker
     eventId        the captured event id (null for an insert)
     editId         the insert edit's id (inserts only)
     markerType     "start" | "end"
     label, timestamp                 with every edit applied (what is shown)
     appliedLabel, appliedTimestamp   with only the applied edits (what the
                                      last analysis used)
     inserted, edited, deleted        what the edits did
     deletedApplied                   the delete was already analyzed
     pending                          some edit on it waits for an analysis
     applied                          the last analysis used it (at
                                      appliedTimestamp)
     reason                           the capture-time reason, if any
   An insert edit is its marker, changed in place: one the last analysis
   used, then moved or renamed (2.0.3: a transaction's side dragged or typed),
   keeps what that analysis used as applied_timestamp and applied_label
   (flow-view-markers.js keepApplied), so it is still that analysis's marker
   there until the change is applied. */
function markerView(events, markerEdits, analyzedMs) {
  const byEvent = new Map();
  const inserts = [];
  for (const e of _validEdits(markerEdits)) {
    const pending = isPendingEdit(e, analyzedMs);
    if (e.op === "insert") { inserts.push({ e, pending }); continue; }
    let s = byEvent.get(e.event_id);
    if (!s) { s = { pending: false, edited: false, deleted: false, deletedApplied: false }; byEvent.set(e.event_id, s); }
    if (pending) s.pending = true;
    if (e.op === "delete") {
      s.deleted = true;
      if (!pending) s.deletedApplied = true;
    } else if (e.field === "label") {
      s.edited = true; s.label = e.value;
      if (!pending) s.appliedLabel = e.value;
    } else if (e.field === "timestamp") {
      s.edited = true; s.timestamp = e.value;
      if (!pending) s.appliedTimestamp = e.value;
    }
  }
  const rows = [];
  for (const ev of (events || [])) {
    if (!ev || ev.type !== "marker") continue;
    const d = ev.data || {};
    const s = byEvent.get(ev.event_id) || {};
    rows.push({
      key: ev.event_id, eventId: ev.event_id, editId: null,
      markerType: d.marker_type === "end" ? "end" : "start",
      label: s.label !== undefined ? s.label : (d.label || null),
      appliedLabel: s.appliedLabel !== undefined ? s.appliedLabel : (d.label || null),
      timestamp: s.timestamp || ev.timestamp,
      appliedTimestamp: s.appliedTimestamp || ev.timestamp,
      inserted: false, edited: !!s.edited, deleted: !!s.deleted, deletedApplied: !!s.deletedApplied,
      pending: !!s.pending, applied: !s.deletedApplied, reason: d.reason || null,
    });
  }
  for (const { e, pending } of inserts) {
    // A pending change to an insert the last analysis used keeps what it used.
    const kept = pending && typeof e.applied_timestamp === "string" && !!e.applied_timestamp;
    rows.push({
      key: "insert-" + (e.id || ""), eventId: null, editId: e.id || null,
      markerType: e.marker_type === "end" ? "end" : "start",
      label: e.label || null,
      appliedLabel: kept && Object.prototype.hasOwnProperty.call(e, "applied_label") ? (e.applied_label || null) : (e.label || null),
      timestamp: e.timestamp, appliedTimestamp: kept ? e.applied_timestamp : e.timestamp,
      inserted: true, edited: false, deleted: false, deletedApplied: false,
      pending, applied: !pending || kept, reason: null,
    });
  }
  const t = (r) => { const v = Date.parse(r.timestamp); return Number.isFinite(v) ? v : Infinity; };
  return rows.sort((a, b) => t(a) - t(b));
}

/* How many marker edits wait for an analysis (the call to action's count). */
function pendingEditCount(markerEdits, analyzedMs) {
  return _validEdits(markerEdits).filter((e) => isPendingEdit(e, analyzedMs)).length;
}

/* The marker events the last analysis used (captured markers with the
   applied edits, plus applied inserts), shaped like captured marker events
   and sorted by time: the input of the timeline's case lane, so a case the
   analysis found is drawn, and one it has not seen yet is not. */
function appliedMarkerEvents(view) {
  return (view || [])
    .filter((m) => m.applied)
    .map((m) => ({ type: "marker", event_id: m.key, timestamp: m.appliedTimestamp,
      data: { marker_type: m.markerType, label: m.appliedLabel } }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/* The markers as they are now (2.0.3): every edit laid over them, applied or
   pending, a deleted one left out; shaped like captured marker events (the
   view's key as the event id) and sorted by time. The timeline's
   Transactions lane draws these, so a transaction the analyst adds or moves
   stands where it was put, drawn pending until Apply marker changes. */
function currentMarkerEvents(view) {
  return (view || [])
    .filter((m) => !m.deleted)
    .map((m) => ({ type: "marker", event_id: m.key, timestamp: m.timestamp,
      data: { marker_type: m.markerType, label: m.label } }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/* The session's view in one call (the viewer's usual entry point). */
function sessionMarkerView(session) {
  if (!session) return [];
  return markerView(session.events || [], (session.annotations || {}).marker_edits, lastAnalysisMs(session));
}

module.exports = {
  lastAnalysisMs, isPendingEdit, markerView, pendingEditCount, appliedMarkerEvents, currentMarkerEvents,
  sessionMarkerView,
};
