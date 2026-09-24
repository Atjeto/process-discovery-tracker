/*
 * flow-view-markers.js -- the Flow level's marker side-panel:
 *   - the markers list: captured markers with annotations.marker_edits laid
 *     over them (marker-edits.js), including markers the analyst inserted,
 *     each change shown at once and tagged "pending" until Apply marker
 *     changes applies it (the call to action lives in the top bar's status
 *     line, flow-view.js),
 *   - the per-marker move / delete / rename actions, for captured and
 *     inserted markers alike.
 *
 * Extracted from flow-view.js (god-file split). Requires flow-view-video.js
 * for seekToTimestamp / videoStartTs (one-way), and never require()s
 * flow-view.js back. flow-view.js consumes renderMarkersList (session load).
 *
 * The marker-INSERT surfaces (showMarkerInsertMenu, queueSyntheticMarker,
 * queueMarkerDelete) stay in flow-view.js with their timeline-right-click /
 * summary triggers.
 */

"use strict";

const State = require("../state.js");
const { $, escapeHtml, cryptoRandomId, toast, recordingStartMs, sinceStart, parseClock } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { persistAnnotations } = require("../session.js");
const { seekToTimestamp, videoStartTs } = require("./flow-view-video.js");
const MarkerEdits = require("../marker-edits.js");

/* The label shown for one captured marker event (renames applied). */
function effectiveLabel(markerEvent) {
  const view = MarkerEdits.sessionMarkerView(State.getSession());
  const row = view.find((m) => m.eventId === markerEvent.event_id);
  return row ? row.label : ((markerEvent.data || {}).label || null);
}

/* ============ Markers list + per-marker edits ===================== */

const APPLY_NOTE = "it applies to the transactions when you click Apply marker changes";

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const all = MarkerEdits.sessionMarkerView(State.getSession());
  if (!all.length) {
    host.innerHTML = '<p class="hint">No markers yet. To mark a transaction, right-click the timeline where it starts and choose Start a transaction here.</p>';
    return;
  }
  // Story order: by the time shown (moves applied), the time since the
  // recording started (the one clock). How to edit them is the list's
  // tooltip (index.html).
  const moveTitle = State.getSession().recordingAvailable
    ? "Move to the current video time" : "Move to another time";
  const origin = recordingStartMs(State.getSession());
  for (const m of all) {
    const row = document.createElement("div");
    row.className = "marker-row " + m.markerType + (m.deleted ? " deleted" : "") +
      (m.pending ? " pending" : "") + (m.inserted ? " inserted" : "");
    row.dataset.markerKey = m.key;
    // An End carries no label: it says what it is. A Start without one too.
    const lbl = m.label || (m.markerType === "end" ? "End" : "Start");
    const notes =
      (m.inserted ? ' <span class="meta">· added</span>' : (m.edited ? ' <span class="meta">· edited</span>' : "")) +
      (m.deleted ? ' <span class="meta bad">· deleted</span>' : "") +
      (m.pending ? ' <span class="meta pending-tag" title="Not applied yet: Apply marker changes, in the top bar, applies it">· pending</span>' : "");
    row.innerHTML =
      '<span class="ts">' + escapeHtml(sinceStart(m.timestamp, origin)) + '</span>' +
      '<span class="dir">' + (m.markerType === "start" ? "▶" : "■") + '</span>' +
      '<span class="lbl">' + escapeHtml(lbl) +
        (m.reason ? ' <span class="meta">(' + escapeHtml(m.reason) + ')</span>' : '') +
        notes +
      '</span>' +
      '<span class="marker-actions">' +
        '<button class="icon-btn xs" data-act="adjust" title="' + moveTitle + '">◷</button>' +
        '<button class="icon-btn xs" data-act="delete" title="Delete marker (from the analysis)">✕</button>' +
      '</span>';
    row.addEventListener("click", (e) => {
      if (e.target.closest(".marker-actions")) return;
      seekToTimestamp(m.timestamp);
    });
    if (m.markerType === "start") {
      row.addEventListener("dblclick", async (e) => {
        if (e.target.closest(".marker-actions")) return;
        const current = m.label || "";
        const next = await promptModal({ title: "Rename marker", message: "New label", defaultValue: current, okLabel: "Rename" });
        if (next == null || next.trim() === "" || next === current) return;
        await renameMarker(m, next.trim());
      });
    }
    row.querySelector('[data-act="adjust"]').addEventListener("click", () => adjustMarkerToVideoTime(m));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => deleteMarker(m));
    host.appendChild(row);
  }
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

/* The moment a typed time since the recording started ("1:05", "1:02:03",
   as the timeline and this list show it) names, as an ISO string; null when
   the text is not such a time. Pure (exported for the unit tests). */
function sinceStartToIso(originMs, text) {
  const ms = parseClock(text);
  return ms != null && isFinite(originMs) ? new Date(originMs + ms).toISOString() : null;
}

async function adjustMarkerToVideoTime(m) {
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  let newTs;
  if (obsStartTs && video && video.src) {
    newTs = new Date(new Date(obsStartTs).getTime() + (video.currentTime || 0) * 1000).toISOString();
  } else {
    // No video to take the time from: ask for the time since the recording
    // started, as the timeline shows it.
    const origin = recordingStartMs(State.getSession());
    const now = sinceStart(m.timestamp, origin);
    const input = await promptModal({ title: "Move marker", message: "New time",
      detail: "The time since the recording started, as the timeline shows it, for example " + now + ".",
      defaultValue: now, okLabel: "Move" });
    if (input == null) return;
    newTs = sinceStartToIso(origin, input);
    if (!newTs) { toast("Type a time such as " + now + ".", "error"); return; }
  }
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    // An inserted marker IS its insert edit: move the edit itself.
    const e = _insertEdit(anno, m);
    if (!e) { toast("This added marker could not be found in the project's changes.", "error"); return; }
    e.timestamp = newTs;
    e.ts = now;
  } else {
    anno.marker_edits.push({
      id: cryptoRandomId(), event_id: m.eventId, field: "timestamp",
      value: newTs, previous: m.timestamp, ts: now,
    });
  }
  await persistAnnotations(anno, 'move marker', ["markers", "timeline"]);
  toast("Marker moved; " + APPLY_NOTE + ".", "success");
}

async function deleteMarker(m) {
  if (!State.getSession()) return;
  const ok = await confirmModal({
    title: "Delete marker?",
    message: m.inserted
      ? `Remove this added ${m.markerType} marker?`
      : `Delete this ${m.markerType} marker from the analysis?`,
    detail: "The recording itself is not changed; the change is saved with the project and " +
      APPLY_NOTE + ". Ctrl+Z restores it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    const e = _insertEdit(anno, m);
    if (!e) { toast("This added marker could not be found in the project's changes.", "error"); return; }
    anno.marker_edits = anno.marker_edits.filter((x) => x !== e);
    // An insert the last analysis already applied needs one more Analyze to
    // take it out again: a delete of its marker id keeps that change pending
    // (the pipeline ignores a delete whose marker no longer exists).
    if (!MarkerEdits.isPendingEdit(e, MarkerEdits.lastAnalysisMs(State.getSession()))) {
      anno.marker_edits.push({ id: cryptoRandomId(), event_id: m.key, op: "delete", ts: now });
    }
  } else {
    anno.marker_edits.push({ id: cryptoRandomId(), event_id: m.eventId, op: "delete", ts: now });
  }
  await persistAnnotations(anno, 'delete marker', ["markers", "timeline"]);
  toast("Marker deleted; " + APPLY_NOTE + ".", "success");
}

async function renameMarker(m, newLabel) {
  if (!State.getSession()) return;
  const anno = _annotations();
  const now = new Date().toISOString();
  if (m.inserted) {
    const e = _insertEdit(anno, m);
    if (!e) { toast("This added marker could not be found in the project's changes.", "error"); return; }
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
  await persistAnnotations(anno, 'rename marker', ["markers", "timeline"]);
  toast("Marker renamed; " + APPLY_NOTE + ".", "success");
}

module.exports = {
  effectiveLabel, renderMarkersList, sinceStartToIso,
};
