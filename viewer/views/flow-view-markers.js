/*
 * flow-view-markers.js -- the Flow level's marker side-panel:
 *   - marker-edit resolution (effective label / timestamp / deleted state
 *     over annotations.json.marker_edits),
 *   - the side-panel markers list,
 *   - the per-marker adjust / delete / rename actions.
 *
 * Extracted from flow-view.js (god-file split). Requires flow-view-video.js
 * for seekToTimestamp / videoStartTs (one-way), and never require()s
 * flow-view.js back. flow-view.js and flow-view-timeline.js consume
 * effectiveLabel (the timeline marker labels) and renderMarkersList
 * (session load).
 *
 * The marker-INSERT surfaces (showMarkerInsertMenu, queueSyntheticMarker,
 * queueMarkerDelete) stay in flow-view.js with their timeline-right-click /
 * summary triggers.
 */

"use strict";

const State = require("../state.js");
const { $, escapeHtml, cryptoRandomId, toast } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { persistAnnotations } = require("../session.js");
const { seekToTimestamp, videoStartTs } = require("./flow-view-video.js");

/* ============ Marker-edit resolution ============================== */

function getMarkerEdit(eventId) {
  /* Returns the latest pending edit (e.g. rename) for a given marker
     event_id, or null. Edits live in annotations.json under marker_edits. */
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === eventId) latest = e; // last write wins
  }
  return latest;
}

function effectiveLabel(markerEvent) {
  const edit = getMarkerEdit(markerEvent.event_id);
  if (edit && edit.field === "label") return edit.value;
  return markerEvent.data.label;
}

function isDeletedMarker(eventId) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  return edits.some((e) => e.event_id === eventId && e.op === "delete");
}

function effectiveTimestamp(markerEvent) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === markerEvent.event_id && e.field === "timestamp") latest = e.value;
  }
  return latest || markerEvent.timestamp;
}

/* ============ Markers list + per-marker edits ===================== */

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const sess = State.getSession();
  const allMarkers = (sess.events || []).filter((e) => e.type === "marker");
  if (!allMarkers.length) {
    host.innerHTML = '<p class="hint">No markers yet. To mark a run, right-click the timeline at its first moment and choose Insert Start marker here.</p>';
    return;
  }
  const f = State.getListFilters().marker;
  const query = (f.text || "").toLowerCase();
  const markers = query
    ? allMarkers.filter(m => (effectiveLabel(m) || "").toLowerCase().includes(query)
        || (m.data.reason || "").toLowerCase().includes(query))
    : allMarkers;
  const meta = $("#marker-filter-meta");
  if (meta) {
    meta.textContent = markers.length === allMarkers.length
      ? `${allMarkers.length} markers`
      : `${markers.length} of ${allMarkers.length}`;
  }
  if (!markers.length) {
    host.innerHTML = '<p class="hint">No markers match the filter.</p>';
    return;
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Double-click a Start to rename. Use the row buttons to adjust the timestamp or delete. Edits save to annotations.json; re-run normalization to apply downstream.";
  host.appendChild(hint);

  // Story order: by effective (possibly adjusted) timestamp.
  const ordered = markers.slice().sort((a, b) =>
    new Date(effectiveTimestamp(a)).getTime() - new Date(effectiveTimestamp(b)).getTime());

  let depth = 0;
  for (const m of ordered) {
    const row = document.createElement("div");
    const deleted = isDeletedMarker(m.event_id);
    row.className = "marker-row " + m.data.marker_type + (deleted ? " deleted" : "");
    if (m.data.marker_type === "end") depth = Math.max(0, depth - 1);
    const lbl = effectiveLabel(m) || "(unlabeled)";
    const editedNote = (getMarkerEdit(m.event_id) || effectiveTimestamp(m) !== m.timestamp)
      ? ' <span class="meta">· edited</span>' : '';
    const deletedNote = deleted ? ' <span class="meta bad">· deleted</span>' : '';
    row.innerHTML =
      '<span class="ts">' + escapeHtml(effectiveTimestamp(m).slice(11, 19)) + '</span>' +
      '<span class="dir">' + (m.data.marker_type === "start" ? "▶" : "■") + '</span>' +
      '<span class="lbl">' + escapeHtml(lbl) +
        (m.data.reason ? ' <span class="meta">(' + escapeHtml(m.data.reason) + ')</span>' : '') +
        editedNote + deletedNote +
      '</span>' +
      '<span class="depth">L' + depth + '</span>' +
      '<span class="marker-actions">' +
        '<button class="icon-btn xs" data-act="adjust" title="Adjust to current video time">◷</button>' +
        '<button class="icon-btn xs" data-act="delete" title="Delete marker (from normalization)">✕</button>' +
      '</span>';
    if (m.data.marker_type === "start") depth += 1;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".marker-actions")) return;
      seekToTimestamp(effectiveTimestamp(m));
    });
    if (m.data.marker_type === "start") {
      row.addEventListener("dblclick", async (e) => {
        if (e.target.closest(".marker-actions")) return;
        const current = effectiveLabel(m) || "";
        const next = await promptModal({ title: "Rename marker", message: "New label", defaultValue: current, okLabel: "Rename" });
        if (next == null || next.trim() === "" || next === current) return;
        await renameMarker(m, next.trim());
      });
    }
    row.querySelector('[data-act="adjust"]').addEventListener("click", () =>
      adjustMarkerToVideoTime(m));
    row.querySelector('[data-act="delete"]').addEventListener("click", () =>
      deleteMarker(m));
    host.appendChild(row);
  }
}

async function adjustMarkerToVideoTime(markerEvent) {
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  let newTs;
  if (obsStartTs && video && video.src) {
    newTs = new Date(new Date(obsStartTs).getTime() + (video.currentTime || 0) * 1000).toISOString();
  } else {
    const input = await promptModal({ title: "Adjust marker timestamp", message: "New ISO 8601 timestamp", detail: "e.g., 2026-05-14T09:23:11.482Z", defaultValue: effectiveTimestamp(markerEvent), okLabel: "Save" });
    if (!input) return;
    newTs = input.trim();
  }
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "timestamp",
    value: newTs,
    previous: markerEvent.timestamp,
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'adjust marker timestamp', ["markers", "timeline"]);
  toast("Marker timestamp adjusted", "success");
}

async function deleteMarker(markerEvent) {
  if (!State.getSession()) return;
  const ok = await confirmModal({
    title: "Delete marker?",
    message: `Delete this ${markerEvent.data.marker_type} marker from normalization output?`,
    detail: "Raw events.jsonl is not touched; the delete is recorded in annotations.json. Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    op: "delete",
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'delete marker', ["markers", "timeline"]);
  toast("Marker marked for deletion (re-run normalization)", "success");
}

async function renameMarker(markerEvent, newLabel) {
  if (!State.getSession()) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "label",
    value: newLabel,
    previous: markerEvent.data.label,
    ts: new Date().toISOString(),
  });
  // Route through persistAnnotations like the other marker edits so the
  // rename lands on the undo stack (Ctrl+Z reverts it) and refreshes the
  // _baseline -- a raw saveAnnotations bypassed undo and left a stale
  // baseline that made the NEXT edit's undo also revert this rename (H-5).
  // The "markers"/"timeline" topics re-render the side panel and the
  // marker labels on the timeline.
  await persistAnnotations(anno, 'rename marker', ["markers", "timeline"]);
  toast("Marker renamed (re-run normalization to apply downstream)", "success");
}

/* The marker-list filter box (debounced) re-renders the list in place.
   Wired at require() time -- the DOM is parsed when flow-view.js pulls
   this in. */
(function wireMarkerFilter() {
  const txt = document.getElementById("marker-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().marker.text = txt.value.trim();
        if (State.getSession()) renderMarkersList();
      }, 120);
    });
  }
})();

module.exports = {
  effectiveLabel, renderMarkersList,
};
