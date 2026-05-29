"use strict";

/*
 * Pure consent-record logic (§11f) -- electron-free so it is unit-testable
 * under node:test. The consent *window* and the acknowledgement persistence
 * live in consent-window.js (which requires electron); this module only shapes
 * the `consent` record written onto manifest.json and decides, given the mode +
 * a remembered-acknowledgement flag, whether the worker must be prompted.
 *
 * Modes (config.consent.mode):
 *   "off"          -- no consent gate. manifest records required:false; the
 *                     recording starts unconditionally (the pre-feature behaviour).
 *   "per_session"  -- prompt at every session start; decline aborts the start.
 *   "once"         -- prompt once per (worker, consent version); the acknowledgement
 *                     is remembered in user-config so later sessions skip the prompt
 *                     (until the consent text/version changes). Decline aborts.
 */

const DEFAULT_CONSENT_TEXT =
  "This session records how you work: the applications and on-screen controls " +
  "you interact with, periodic screenshots, and (if enabled) screen video. It is " +
  "used only to map and improve this business process. Sensitive field values " +
  "(passwords, card numbers, and similar) are redacted automatically. Recording " +
  "stays on this device until an analyst collects the session folder; nothing is " +
  "sent over the network. You can end the recording at any time from the tray. " +
  "Do you consent to this recording?";

/* Whether the worker must be shown the consent window before this session
   starts. "off" never prompts; "per_session" always prompts; "once" prompts
   only when the (worker, version) pair has not been acknowledged yet. */
function needsPrompt(mode, alreadyAcknowledged) {
  const m = mode || "off";
  if (m === "off") return false;
  if (m === "once") return !alreadyAcknowledged;
  return true; // per_session (and any unknown mode -> prompt, fail safe)
}

/* The `consent` object stamped onto manifest.json. For "off" it is the
   not-required record; otherwise it captures the worker's decision. */
function consentRecord({ mode, version, workerId, granted, acknowledgedAt }) {
  const m = mode || "off";
  if (m === "off") {
    return { required: false, granted: null, mode: "off" };
  }
  return {
    required: true,
    granted: !!granted,
    mode: m,
    version: version || 1,
    worker_id: workerId || "unknown",
    acknowledged_at: granted ? (acknowledgedAt || new Date().toISOString()) : null,
  };
}

/* The key under which a remembered "once" acknowledgement is stored, so the
   prompt is re-shown when either the worker or the consent version changes. */
function acknowledgementKey(workerId, version) {
  return `${workerId || "unknown"}:${version || 1}`;
}

module.exports = {
  DEFAULT_CONSENT_TEXT,
  needsPrompt,
  consentRecord,
  acknowledgementKey,
};
