/*
 * flow-view-markers.js -- the Flow level's marker side-panel and the
 * unbracketed-session recovery surfaces:
 *   - marker-edit resolution (effective label / timestamp / deleted state
 *     over annotations.json.marker_edits),
 *   - the side-panel markers list (captured + suggested, interleaved),
 *   - suggested markers (ADR-0017): accept -> marker_edits[] op:insert,
 *     dismiss -> marker_suggestions_dismissed[],
 *   - anchor candidates (ADR-0018): accept -> case_anchor_override,
 *     dismiss -> anchor_candidates_dismissed[], clear (the inverse),
 *   - the per-marker adjust / delete / rename actions.
 *
 * Extracted from flow-view.js (god-file split). Requires flow-view-video.js
 * for seekToTimestamp / videoStartTs (one-way). renderTimeline (re-rendered
 * after an accept/dismiss so the dashed bars update) is injected via
 * initMarkers() so this module never require()s flow-view.js back. flow-view.js
 * consumes effectiveLabel + visibleMarkerSuggestions (the timeline marker
 * overlay) and renderMarkersList + renderAnchorCandidates (session load).
 *
 * The marker-INSERT surfaces (showMarkerInsertMenu, queueSyntheticMarker,
 * queueMarkerDelete) stay in flow-view.js with their timeline-right-click /
 * summary triggers.
 */

"use strict";

const State = require("../state.js");
const { $, escapeHtml, cryptoRandomId, toast } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { saveAnnotationsWithUndo, persistAnnotations } = require("../session.js");
const { seekToTimestamp, videoStartTs } = require("./flow-view-video.js");

/* Injected by flow-view.js via initMarkers() -- re-render the timeline after
   an accept/dismiss so the dashed suggested-marker bars update. Injected
   rather than require()d to avoid a flow-view <-> markers cycle. */
let renderTimeline = () => {};

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

/* ============ Suggested markers (ADR-0017) ======================== */

/* The Python detector (normalization/marker_suggest.py) writes candidate
   case boundaries into annotations.json:marker_suggestions[]. Each
   suggestion has a stable `signature` so accepts (recorded as
   `derived_from_signature` on the resulting marker_edits[] op:insert) and
   dismisses (recorded in marker_suggestions_dismissed[]) survive
   re-normalize.

   The helper below filters the live render so a suggestion that's already
   been Accepted (its signature appears as derived_from_signature on an
   op:insert) doesn't render twice for the few seconds before its row is
   dropped. */
function acceptedSuggestionSignatures(annotations) {
  const out = new Set();
  for (const e of ((annotations && annotations.marker_edits) || [])) {
    if (e && e.op === "insert" && typeof e.derived_from_signature === "string"
        && e.derived_from_signature) {
      out.add(e.derived_from_signature);
    }
  }
  return out;
}

function visibleMarkerSuggestions(annotations) {
  const sugs = (annotations && annotations.marker_suggestions) || [];
  if (!sugs.length) return [];
  const accepted = acceptedSuggestionSignatures(annotations);
  return sugs.filter((s) => s && s.signature && !accepted.has(s.signature));
}

async function acceptMarkerSuggestion(sugg) {
  if (!State.getSession() || !sugg) return;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  if (!Array.isArray(a.marker_suggestions)) a.marker_suggestions = [];
  a.marker_edits.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    op: "insert",
    marker_type: sugg.marker_type,
    label: sugg.label,
    timestamp: sugg.timestamp,
    derived_from_signature: sugg.signature,
    ts: new Date().toISOString(),
  });
  a.marker_suggestions = a.marker_suggestions.filter(
    (s) => s && s.signature !== sugg.signature);
  try {
    await saveAnnotationsWithUndo(a, "accept suggested marker");
    State.getSession().annotations = a;
    toast(
      `${sugg.marker_type === "start" ? "Start" : "End"} marker accepted — re-run normalization to apply`,
      "success",
    );
    renderTimeline();
    renderMarkersList();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

async function dismissMarkerSuggestion(sugg) {
  if (!State.getSession() || !sugg) return;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_suggestions_dismissed)) a.marker_suggestions_dismissed = [];
  if (!Array.isArray(a.marker_suggestions)) a.marker_suggestions = [];
  a.marker_suggestions_dismissed.push({
    signature: sugg.signature,
    marker_type: sugg.marker_type,
    approximate_timestamp: sugg.timestamp,
    dismissed_at: new Date().toISOString(),
  });
  a.marker_suggestions = a.marker_suggestions.filter(
    (s) => s && s.signature !== sugg.signature);
  try {
    await saveAnnotationsWithUndo(a, "dismiss suggested marker");
    State.getSession().annotations = a;
    toast("Suggestion dismissed", "");
    renderTimeline();
    renderMarkersList();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

/* ============ Anchor candidates (ADR-0018) ======================== */

/* The Python detector (normalization/anchor_suggest.py) writes pattern-mined
   candidate case anchors into annotations.json:anchor_candidates[]. Each
   candidate has a stable `signature` over (field_property, field_value,
   window_title) so accepts (written into case_anchor_override with
   `_accepted_signature`) and dismisses (written into
   anchor_candidates_dismissed[]) survive re-normalize.

   acceptAnchorCandidate writes a session-level anchor override that
   normalize.py consults BEFORE the marker-mode fallback. dismiss suppresses
   re-suggestion. clearAnchorOverride removes a previously accepted override
   (the inverse). */
async function acceptAnchorCandidate(cand) {
  if (!State.getSession() || !cand) return;
  const a = State.getSession().annotations || {};
  a.case_anchor_override = Object.assign({}, cand.anchor_config, {
    _accepted_signature: cand.signature,
    _accepted_at: new Date().toISOString(),
  });
  if (!Array.isArray(a.anchor_candidates)) a.anchor_candidates = [];
  a.anchor_candidates = a.anchor_candidates.filter(
    (c) => c && c.signature !== cand.signature);
  try {
    await saveAnnotationsWithUndo(a, "accept anchor candidate");
    State.getSession().annotations = a;
    toast(
      `Anchor set to ${cand.display && cand.display.field_value} — re-run Analyze to apply`,
      "success",
    );
    renderAnchorCandidates();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

async function dismissAnchorCandidate(cand) {
  if (!State.getSession() || !cand) return;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.anchor_candidates_dismissed)) a.anchor_candidates_dismissed = [];
  if (!Array.isArray(a.anchor_candidates)) a.anchor_candidates = [];
  a.anchor_candidates_dismissed.push({
    signature: cand.signature,
    dismissed_at: new Date().toISOString(),
  });
  a.anchor_candidates = a.anchor_candidates.filter(
    (c) => c && c.signature !== cand.signature);
  try {
    await saveAnnotationsWithUndo(a, "dismiss anchor candidate");
    State.getSession().annotations = a;
    toast("Anchor candidate dismissed", "");
    renderAnchorCandidates();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

async function clearAnchorOverride() {
  if (!State.getSession()) return;
  const a = State.getSession().annotations || {};
  if (!a.case_anchor_override) return;
  delete a.case_anchor_override;
  try {
    await saveAnnotationsWithUndo(a, "clear anchor override");
    State.getSession().annotations = a;
    toast("Anchor cleared — re-run Analyze to apply", "");
    renderAnchorCandidates();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

function renderAnchorCandidates() {
  const host = document.getElementById("anchor-candidates-panel");
  if (!host) return;
  const sess = State.getSession();
  const anno = (sess && sess.annotations) || {};
  const cands = Array.isArray(anno.anchor_candidates) ? anno.anchor_candidates : [];
  const override = anno.case_anchor_override;

  if (!cands.length && !override) {
    host.style.display = "none";
    host.innerHTML = "";
    host.classList.remove("ac-active");
    return;
  }

  host.style.display = "";
  if (override) {
    host.classList.add("ac-active");
    const sig = override._accepted_signature || "";
    const label = override.equals || override.recognized || "(custom)";
    host.innerHTML =
      '<div class="ac-header" title="The case anchor is the field that identifies each ticket/order — the app uses it to split the recording into cases">Active case anchor</div>' +
      '<div class="ac-active-row">' +
        '<span class="ac-active-label">' + escapeHtml(String(override.field || "recognized")) +
        ' = ' + escapeHtml(String(label)) + '</span>' +
        '<span class="ac-samples">re-run Analyze to apply</span>' +
        '<span class="ac-actions">' +
          '<button class="icon-btn xs" data-act="clear" title="Undo Accept — go back to having no case anchor">↺</button>' +
        '</span>' +
      '</div>';
    const clearBtn = host.querySelector('[data-act="clear"]');
    if (clearBtn) clearBtn.addEventListener("click", () => clearAnchorOverride());
    return;
  }

  // Render the live candidate list.
  host.classList.remove("ac-active");
  const rows = cands.map((c) => {
    const d = c.display || {};
    const m = c.metrics || {};
    const samples = (d.sample_values || []).slice(0, 3).join(", ");
    const fieldKey = (d.field_property || "") + " = " + (d.field_value || "");
    const meta = `${m.case_count || "?"} cases · ${
      (m.coverage != null ? (m.coverage * 100).toFixed(0) + "%" : "?")
    } coverage · score ${(c.score != null ? c.score.toFixed(2) : "?")}`;
    return (
      '<div class="ac-row" data-sig="' + escapeHtml(c.signature || "") + '">' +
        '<span class="ac-field">' + escapeHtml(fieldKey) +
          ' <span class="ac-meta">' + escapeHtml(meta) + '</span></span>' +
        '<span class="ac-samples">' + (samples ? "e.g. " + escapeHtml(samples) : "") + '</span>' +
        '<span class="ac-actions">' +
          '<button class="icon-btn xs" data-act="accept" title="Use this field to split the recording into cases — re-run Analyze to apply">✓</button>' +
          '<button class="icon-btn xs" data-act="dismiss" title="Hide this suggestion — it stays hidden on future analyses">✕</button>' +
        '</span>' +
      '</div>'
    );
  }).join("");
  host.innerHTML =
    '<div class="ac-header" title="The case anchor is the field that identifies each ticket/order — the app uses it to split the recording into cases">Anchor candidates</div>' +
    '<div class="ac-hint">This session has ' + cands.length +
      ' field' + (cands.length === 1 ? "" : "s") +
      ' that could identify each case. Accept one and the next Analyze splits the recording into cases.</div>' +
    rows;

  // Wire the per-row buttons by walking each .ac-row and resolving its
  // signature back to the live candidate object (so we pass the current
  // shape, not a stale closure).
  host.querySelectorAll(".ac-row").forEach((row) => {
    const sig = row.dataset.sig;
    const cand = cands.find((c) => c.signature === sig);
    if (!cand) return;
    const accept = row.querySelector('[data-act="accept"]');
    if (accept) accept.addEventListener("click", () => acceptAnchorCandidate(cand));
    const dismiss = row.querySelector('[data-act="dismiss"]');
    if (dismiss) dismiss.addEventListener("click", () => dismissAnchorCandidate(cand));
  });
}

/* ============ Markers list + per-marker edits ===================== */

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const sess = State.getSession();
  const allMarkers = (sess.events || []).filter((e) => e.type === "marker");
  const allSuggestions = sess ? visibleMarkerSuggestions(sess.annotations) : [];
  if (!allMarkers.length && !allSuggestions.length) {
    host.innerHTML = '<p class="hint">No markers fired in this session.</p>';
    return;
  }
  const f = State.getListFilters().marker;
  const query = (f.text || "").toLowerCase();
  const markers = query
    ? allMarkers.filter(m => (effectiveLabel(m) || "").toLowerCase().includes(query)
        || (m.data.reason || "").toLowerCase().includes(query))
    : allMarkers;
  const suggestions = query
    ? allSuggestions.filter(s => (s.label || "").toLowerCase().includes(query)
        || (s.reason || "").toLowerCase().includes(query))
    : allSuggestions;
  const meta = $("#marker-filter-meta");
  if (meta) {
    const totalAll = allMarkers.length + allSuggestions.length;
    const totalShown = markers.length + suggestions.length;
    const sNote = allSuggestions.length
      ? ` (incl. ${allSuggestions.length} suggested)` : "";
    meta.textContent = totalShown === totalAll
      ? `${totalAll} markers${sNote}`
      : `${totalShown} of ${totalAll}${sNote}`;
  }
  if (!markers.length && !suggestions.length) {
    host.innerHTML = '<p class="hint">No markers match the filter.</p>';
    return;
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = allSuggestions.length
    ? "Dashed rows are suggested markers (change-point candidates). Accept to insert, Dismiss to suppress on re-normalize. Double-click a captured Start to rename. Edits save to annotations.json; re-run Analyze to apply downstream."
    : "Double-click a Start to rename. Use the row buttons to adjust the timestamp or delete. Edits save to annotations.json; re-run normalization to apply downstream.";
  host.appendChild(hint);

  // Interleave captured + suggested by effective timestamp so the
  // analyst reads them in story order, not segregated by kind.
  const tsOf = (e) => e._isSuggested ? new Date(e.timestamp).getTime()
                                     : new Date(effectiveTimestamp(e)).getTime();
  const combined = []
    .concat(markers.map(m => ({...m, _isSuggested: false})))
    .concat(suggestions.map(s => ({...s, _isSuggested: true})));
  combined.sort((a, b) => tsOf(a) - tsOf(b));

  let depth = 0;
  for (const item of combined) {
    if (item._isSuggested) {
      const row = document.createElement("div");
      row.className = "marker-row " + item.marker_type + " suggested";
      const lbl = item.label || (item.marker_type === "start" ? "(suggested case)" : "(suggested end)");
      const reasonChip = item.reason
        ? ' <span class="meta suggested">' + escapeHtml(_humanReason(item)) + '</span>' : '';
      row.innerHTML =
        '<span class="ts">' + escapeHtml((item.timestamp || "").slice(11, 19)) + '</span>' +
        '<span class="dir">' + (item.marker_type === "start" ? "▶" : "■") + '</span>' +
        '<span class="lbl">' + escapeHtml(lbl) + reasonChip + '</span>' +
        '<span class="depth">·</span>' +
        '<span class="marker-actions">' +
          '<button class="icon-btn xs" data-act="accept" title="Accept (insert as real marker, re-run Analyze to apply)">✓</button>' +
          '<button class="icon-btn xs" data-act="dismiss" title="Dismiss (suppress on re-normalize)">✕</button>' +
        '</span>';
      row.addEventListener("click", (e) => {
        if (e.target.closest(".marker-actions")) return;
        seekToTimestamp(item.timestamp);
      });
      row.querySelector('[data-act="accept"]').addEventListener("click", () =>
        acceptMarkerSuggestion(item));
      row.querySelector('[data-act="dismiss"]').addEventListener("click", () =>
        dismissMarkerSuggestion(item));
      host.appendChild(row);
      continue;
    }
    const m = item;
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

/* Human label for a marker_suggestions[] row's reason chip. Mirrors the
   detector's `reason` enum -- update both together when adding a new
   signal in normalization/marker_suggest.py. */
function _humanReason(s) {
  switch (s.reason) {
    case "transaction_id_typed": return "txn id: " + (s.label || "?");
    case "home_app_return":     return "home-app return";
    case "idle_gap":            return "idle gap";
    case "app_cluster_boundary": return "app boundary";
    default:                    return s.reason || "suggested";
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

/* deps = { renderTimeline } -- injected by flow-view.js at boot. */
function initMarkers(deps) {
  renderTimeline = (deps && deps.renderTimeline) || (() => {});
}

module.exports = {
  initMarkers,
  effectiveLabel, visibleMarkerSuggestions,
  renderMarkersList, renderAnchorCandidates,
  // The Overview level's anchor hero (lab-phase spec §A5) REUSES this
  // accept/dismiss wiring -- exported, not duplicated, so the override /
  // dismiss-list semantics stay in one place.
  acceptAnchorCandidate, dismissAnchorCandidate, clearAnchorOverride,
};
