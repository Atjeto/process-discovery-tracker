/*
 * Dead-man monitor for the interaction recorder (lab-phase §E2).
 *
 * The C# sidecar emits a stats line every ~30s (landed in events.jsonl as
 * `recorder_health`) and interactions as the worker works. If BOTH go
 * quiet for longer than the threshold during an active session, the
 * recorder is presumed silently dead -- the failure mode where a session
 * keeps rolling (markers, screenshots) while UI interactions are lost,
 * discovered only hours later at analysis time. The monitor's verdict
 * drives a tray warning state + an OS notification in main.js, so the
 * silent death is loud within ~2 minutes instead of invisible all day.
 *
 * Pure state machine with an injectable clock so the >2-minute gap is
 * unit-testable without real waits. main.js feeds it from the recorder's
 * onEvent (interaction) and onStats (health) hooks and polls check() on
 * a short interval.
 */

"use strict";

/* No interaction AND no recorder_health for this long => silent. The
   recorder's own liveness watchdog kills a stdout-quiet sidecar at 90s,
   so 2 minutes spans one kill+restart cycle without a false alarm --
   anything quieter than that is genuinely dead (or never started). */
const DEAD_MAN_SILENCE_MS = 120_000;

function createDeadManMonitor({ silenceMs = DEAD_MAN_SILENCE_MS, now = Date.now } = {}) {
  let lastSignalMs = now();   // armed at creation (session start)
  let silent = false;
  let silenceStartedAtMs = null;

  return {
    /* Any recorder signal -- an interaction event or a recorder_health
       stats line -- proves the sidecar is alive. */
    noteSignal() {
      lastSignalMs = now();
    },

    /* Poll the state machine. Returns:
       - { transition: "went_silent", silent: true,  silentForMs }  once per stretch
       - { transition: "recovered",   silent: false, gapMs }        once on recovery
       - { transition: null,          silent, silentForMs }         otherwise */
    check() {
      const t = now();
      const sinceMs = t - lastSignalMs;
      const isSilent = sinceMs > silenceMs;
      if (isSilent && !silent) {
        silent = true;
        silenceStartedAtMs = lastSignalMs;   // the silence began at the last heard signal
        return { transition: "went_silent", silent: true, silentForMs: sinceMs };
      }
      if (!isSilent && silent) {
        silent = false;
        const gapMs = lastSignalMs - silenceStartedAtMs;
        silenceStartedAtMs = null;
        return { transition: "recovered", silent: false, gapMs };
      }
      return { transition: null, silent: isSilent, silentForMs: isSilent ? sinceMs : 0 };
    },

    isSilent() {
      return silent;
    },
  };
}

module.exports = { createDeadManMonitor, DEAD_MAN_SILENCE_MS };
