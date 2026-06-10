/*
 * posture.js -- the engagement data-posture setting (lab-phase spec §C4).
 *
 * Three postures govern whether session-derived material may leave the
 * viewer as a reviewable artifact (the "Copy for LLM" export, §C3):
 *
 *   sealed     -- nothing leaves. The Copy-for-LLM buttons are REMOVED
 *                 from the DOM (not hidden/disabled): the egress promise
 *                 is enforced by code, mirroring the egress-guard
 *                 philosophy (an allowlist that doesn't exist can't be
 *                 misconfigured).
 *   reviewable -- (default) derived, PII-masked exports are allowed,
 *                 shown for line-by-line review before copy/save.
 *   open       -- same surface as reviewable; the posture label simply
 *                 records that the engagement permits open sharing.
 *
 * Persisted in the viewer user-config (localStorage, like pdt.theme).
 * A leaf module: depends only on localStorage (guarded, so node:test can
 * require it headlessly) and a change-notification bus so the Overview
 * header and the App Library toolbar re-render on change.
 */

"use strict";

const POSTURE_KEY = "pdt.dataPosture";

const POSTURES = ["sealed", "reviewable", "open"];
const DEFAULT_POSTURE = "reviewable";

/* What each posture means, for the selector's tooltip / legend. */
const POSTURE_LABELS = {
  sealed: "Sealed — nothing leaves this machine; the Copy-for-LLM export is removed from the UI entirely",
  reviewable: "Reviewable — derived, PII-masked exports allowed after line-by-line review (default)",
  open: "Open — derived exports allowed; the engagement permits open sharing",
};

/* In-memory fallback so the module works where localStorage is absent
   (node:test) and degrades safely if storage is unavailable. */
let _mem = null;

function _read() {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(POSTURE_KEY);
      if (POSTURES.includes(v)) return v;
      return DEFAULT_POSTURE;
    }
  } catch (_) { /* fall through to memory */ }
  return POSTURES.includes(_mem) ? _mem : DEFAULT_POSTURE;
}

function _write(v) {
  _mem = v;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(POSTURE_KEY, v);
  } catch (_) { /* memory copy already holds it */ }
}

const _listeners = [];

/** The current data posture: "sealed" | "reviewable" | "open". */
function getDataPosture() {
  return _read();
}

/** True when the posture permits the Copy-for-LLM surface to EXIST. */
function copyForLlmAllowed() {
  return _read() !== "sealed";
}

/** Set the posture (no-op on an unknown value) and notify subscribers. */
function setDataPosture(v) {
  if (!POSTURES.includes(v) || v === _read()) return;
  _write(v);
  for (const fn of _listeners.slice()) {
    try { fn(v); } catch (_) { /* one bad listener never blocks the rest */ }
  }
}

/** Subscribe to posture changes (Overview header, App Library toolbar). */
function onPostureChange(fn) {
  if (typeof fn === "function") _listeners.push(fn);
}

module.exports = {
  POSTURES, DEFAULT_POSTURE, POSTURE_LABELS,
  getDataPosture, setDataPosture, copyForLlmAllowed, onPostureChange,
};
