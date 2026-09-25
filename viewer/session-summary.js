"use strict";

/*
 * session-summary.js: pure derivations for the Overview's one-line
 * session summary (overview-view.js).
 *
 * No DOM, no requires: every function takes plain data and returns plain
 * data, so the rendering code and the node:test suite share the same logic.
 * Formatting (durations, dates, HTML) is the caller's job; this module only
 * computes.
 */

/* Wall-clock span between the first and last event, in ms. Assumes the
   event list is timestamp-ordered (it is: single-writer append on
   capture, defensive sort in normalization). */
function eventSpanMs(events) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const first = Date.parse(events[0].timestamp);
  const last = Date.parse(events[events.length - 1].timestamp);
  if (!isFinite(first) || !isFinite(last)) return 0;
  return Math.max(0, last - first);
}

/* The facts behind the summary line: which recording this is, who recorded
   it, how long it is, and when it was analyzed. Returns null when the session
   has not been analyzed yet (no stats.json); the Overview then shows its
   "No analysis yet" note instead. */
function computeSummary(session) {
  if (!session || !session.stats || !session.stats.meta) return null;
  const meta = session.stats.meta || {};
  const events = Array.isArray(session.events) ? session.events : [];
  const manifest = session.manifest || {};
  return {
    /* The request code entered at setup (AD-30), null when the capture
       app's default was left (lane FX1: it is never shown as a name). */
    engagement: requestCode(manifest),
    /* D4: the request name entered at setup (AD-30). Prefer the top-level
       field (new sessions) and fall back to the config snapshot (sessions
       captured before the field was lifted out of config). Null when never
       set, and when the capture app's default name was left ("Default
       engagement", lane FX1), as requestOf. */
    engagementName: requestName(manifest),
    worker:
      meta.worker_id ||
      (manifest.config && manifest.config.worker && manifest.config.worker.id) ||
      "unknown worker",
    /* The SME's name: the display name set in the capture app's Profile
       window (manifest config.worker.name), when it says more than the
       Windows login; else null and the login stands in. */
    smeName: smeName(manifest),
    durationMs: eventSpanMs(events),
    analyzedAt: meta.normalization_run_at || null,
  };
}

/* The name the capture app's Profile recorded for the SME (config.worker.name,
   the display name; id is the Windows login), or null when none was set or it
   only repeats the login. */
function smeName(manifest) {
  const w = (manifest && manifest.config && manifest.config.worker) || {};
  const name = typeof w.name === "string" ? w.name.trim() : "";
  const login = typeof w.id === "string" ? w.id.trim() : "";
  return name && name.toLowerCase() !== login.toLowerCase() ? name : null;
}

/* The capture app's defaults for the request (capture/config.js): a
   recording made without setting one shows no request, and never the
   default's name (lane FX1). */
const DEFAULT_REQUEST_NAME = "Default engagement";
const DEFAULT_REQUEST_CODE = "default";

function _text(v) { return typeof v === "string" ? v.trim() : ""; }

/* The request name set in the capture app's Recording setup (the top-level
   field, else the config snapshot), or null when none was set or the
   default was left. */
function requestName(manifest) {
  const m = manifest || {};
  const name = _text(m.engagement_name) || _text(m.config && m.config.engagement_name);
  return name && name !== DEFAULT_REQUEST_NAME ? name : null;
}

/* The request code set in the capture app's Recording setup, or null when
   none was set or the default was left. */
function requestCode(manifest) {
  const code = _text((manifest || {}).engagement_id);
  return code && code !== DEFAULT_REQUEST_CODE ? code : null;
}

/* The capture's request (AD-30): the engagement set in the capture app's
   Recording setup, shown as its Request code and Request name so that
   "project" only ever means what the analyst opens. "Order intake (ENG-7)",
   the name or the code alone, or null when the capture app's defaults were
   left (the PDD's Request row follows the same rule, pdd_export request). */
function requestOf(manifest) {
  const name = requestName(manifest) || "";
  const code = requestCode(manifest) || "";
  if (name && code && name !== code) return name + " (" + code + ")";
  return name || code || null;
}

/* The name a project goes by before the document names it: the request's
   name, else its code, else the project folder's name (`folderName`), else
   "This project"; never the capture app's defaults (lane FX1). */
function projectName(manifest, folderName) {
  return requestName(manifest) || requestCode(manifest) || _text(folderName) || "This project";
}

/* The Recents entry's name: the document title once it is written, else the
   name given at the end of the recording (manifest.label), else the request
   code (AD-30) and the folder name, else the folder name alone (the capture
   app's default code is no request, lane FX1). `folderName` is the session
   folder's last part. */
function recentLabel(session, folderName) {
  const doc = session && session.annotations && session.annotations.document;
  const title = doc && typeof doc.title === "string" ? doc.title.trim() : "";
  if (title) return title;
  const m = (session && session.manifest) || {};
  if (typeof m.label === "string" && m.label.trim()) return m.label.trim();
  const code = requestCode(m);
  return code ? code + " · " + folderName : folderName;
}

/* Walk the marker stream and flag the three problems an analyst inherits
   from an imperfect Start/End recording:
   - dangling_start: a Start that never got a matching End.
   - orphan_end:     an End with no open Start to close.
   - short_case:     a Start/End pair shorter than `shortCaseMs` (default
                     5s) -- usually an accidental double-press.
   Returns plain objects; the caller renders the message and any fix. */
function detectMarkerProblems(events, opts) {
  opts = opts || {};
  const shortCaseMs = typeof opts.shortCaseMs === "number" ? opts.shortCaseMs : 5000;
  const markers = (Array.isArray(events) ? events : []).filter(
    (e) => e && e.type === "marker");
  const problems = [];
  const stack = [];
  for (const m of markers) {
    const mt = m.data && m.data.marker_type;
    if (mt === "start") {
      stack.push(m);
    } else if (mt === "end") {
      if (stack.length) {
        const start = stack.pop();
        const startMs = Date.parse(start.timestamp);
        const endMs = Date.parse(m.timestamp);
        if (isFinite(startMs) && isFinite(endMs) && endMs - startMs < shortCaseMs) {
          problems.push({
            kind: "short_case",
            label: (start.data && start.data.label) || null,
            timestamp: start.timestamp,
            durationMs: endMs - startMs,
          });
        }
      } else {
        problems.push({
          kind: "orphan_end",
          timestamp: m.timestamp,
          eventId: m.event_id || null,
        });
      }
    }
  }
  for (const start of stack) {
    problems.push({
      kind: "dangling_start",
      label: (start.data && start.data.label) || null,
      timestamp: start.timestamp,
      eventId: start.event_id || null,
    });
  }
  return problems;
}

module.exports = {
  eventSpanMs,
  computeSummary,
  smeName,
  requestOf,
  requestName,
  requestCode,
  projectName,
  recentLabel,
  detectMarkerProblems,
};
