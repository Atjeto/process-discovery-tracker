"use strict";

/*
 * read-only.js: a hand-off opened read only (lane HV, contract C20), in the
 * renderer.
 *
 * main.js extracts a hand-off zip under <userData>/handoffs (handoff-open.js)
 * and loads its project with `readOnly: true`. Everything can be looked at
 * and played (every level, the step panel, the video, the transcript, the
 * maps, the PDD it came with); nothing can change: no editing control, no
 * save, no analysis, no Undo entry. The way the unreadable annotations.json
 * page hides its controls (lane FX2) is the way here: one class on the page,
 * `.read-only` (flow-view.js loadSessionIntoView), and the rules in
 * styles.css beside FX2's hide every editing control. On top of it:
 *   - the verbs that are reachable without a control (a shortcut, a
 *     right-click, a double-click, opening a transaction, a paste) check
 *     isReadOnly first;
 *   - lockInputs makes the text fields, lists and ticks of the step pane and
 *     the document readable only;
 *   - session.js refuses every annotations.json write for a read-only
 *     project, and main.js refuses every write into the folder, so a
 *     control that slips through changes nothing.
 * Pure: no electron here, and the DOM only where a host is given.
 */

/* The filters of the Overview's transcript list: they change what the list
   shows, never the project, so they stay usable. */
const VIEW_ONLY = [".ov-tr-search", ".ov-tr-speaker", ".ov-tr-during-cb"];

/* The sentence a refused change says. */
const READ_ONLY_REASON = "this is a hand-off opened read only, so nothing in it can change.";

/* Whether `session` (State.getSession()) is a hand-off opened read only. */
function isReadOnly(session) {
  return !!(session && session.readOnly === true);
}

/* Make the fields inside `host` readable only: a text field or a text area
   read only, a list or a tick disabled; the transcript's filters stay. */
function lockInputs(host) {
  if (!host || typeof host.querySelectorAll !== "function") return;
  host.querySelectorAll("input, textarea, select").forEach((el) => {
    if (VIEW_ONLY.some((sel) => el.matches(sel))) return;
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "SELECT" || type === "checkbox" || type === "radio") el.disabled = true;
    else el.readOnly = true;
  });
}

module.exports = { isReadOnly, lockInputs, READ_ONLY_REASON, VIEW_ONLY };
