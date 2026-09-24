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
    engagement: manifest.engagement_id || "-",
    /* D4: the analyst-entered project name. Prefer the top-level field (new
       sessions) and fall back to the config snapshot (sessions captured before
       the field was lifted out of config). Null when never set. */
    engagementName: manifest.engagement_name
      || (manifest.config && manifest.config.engagement_name) || null,
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

/* The Recents entry's name: the document title once it is written, else the
   name given at the end of the recording (manifest.label), else the project
   and the folder name. `folderName` is the session folder's last part. */
function recentLabel(session, folderName) {
  const doc = session && session.annotations && session.annotations.document;
  const title = doc && typeof doc.title === "string" ? doc.title.trim() : "";
  if (title) return title;
  const m = (session && session.manifest) || {};
  if (typeof m.label === "string" && m.label.trim()) return m.label.trim();
  return (m.engagement_id || folderName) + " · " + folderName;
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
  recentLabel,
  detectMarkerProblems,
};
