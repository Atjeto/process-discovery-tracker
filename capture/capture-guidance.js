"use strict";

/*
 * capture-guidance.js -- R4 (APPROACHABILITY-REDESIGN-2026-07-03 §5): the
 * capture control panel's single status-driven guidance line.
 *
 * One sentence that tells the worker what to do NOW, driven by the existing
 * session state machine (no new state, zero behaviour change). The marker
 * hotkey is read from the existing config so the line always names the real
 * key, never a hardcoded default.
 *
 * The panel's states (from pdt:status): not tracking = "not recording";
 * tracking && !paused = "recording"; tracking && paused = "paused". Anything
 * else falls back to the not-recording guidance.
 *
 * Pure module: no DOM, no Electron, no IPC. Unit-tested in
 * test/capture-guidance.test.js and injected into ui/operator-panel.html.
 */

/* Normalise an Electron accelerator to the worker-facing form the hotkey
   overlay uses ("Ctrl+Shift+S", not "Control+Shift+S"). Mirrors the overlay's
   plain rendering so the guidance line and the overlay agree. */
function formatHotkey(accel) {
  if (typeof accel !== "string" || !accel.trim()) return "";
  return accel
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (/^Control$/i.test(p)) return "Ctrl";
      if (/^CommandOrControl$/i.test(p) || /^CmdOrCtrl$/i.test(p)) return "Ctrl";
      if (/^Command$/i.test(p) || /^Cmd$/i.test(p) || /^Meta$/i.test(p) || /^Super$/i.test(p)) return "Cmd";
      return p;
    })
    .join("+");
}

/* Derive the coarse guidance state from a pdt:status snapshot. Returns one of
   "not-recording" | "recording" | "paused". Unknown/absent status → not-recording
   (the safe "nothing is running yet" guidance). */
function guidanceState(status) {
  const s = status || {};
  if (!s.tracking) return "not-recording";
  if (s.paused) return "paused";
  return "recording";
}

/* The guidance sentence for the current state. `hotkey` is the raw marker
   (start) accelerator from config.hotkeys.start_picker; it is formatted here
   and named in the recording-state sentence so the worker knows the real key.

   `opts.state` may be passed directly (already-derived); otherwise `opts.status`
   is a pdt:status snapshot this function derives the state from. */
function guidanceLine(opts) {
  const o = opts || {};
  const state = o.state || guidanceState(o.status);
  const key = formatHotkey(o.hotkey);
  const keyPhrase = key ? " (" + key + ")" : "";
  switch (state) {
    case "recording":
      return "Recording — fire a marker when a new case starts" + keyPhrase + ".";
    case "paused":
      return "Paused — resume when the worker starts again; markers you fire wait until then.";
    case "not-recording":
    default:
      return "Not recording — start capture when the worker begins.";
  }
}

module.exports = { formatHotkey, guidanceState, guidanceLine };
