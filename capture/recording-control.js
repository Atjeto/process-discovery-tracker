"use strict";

/*
 * recording-control.js: the one start.
 *
 * Every way of starting (the Start recording button on the recording bar,
 * the tray item, the welcome's Start recording and the run key) calls
 * start(). When nothing is recording it starts the recording and then
 * Run 1; while recording, each start() is the next run. The tracker ends
 * the open run first (tracker.startRun), so runs never nest. stop() ends
 * the recording. A recording without a run is therefore not a state the
 * SME can reach by starting.
 *
 * Presses that arrive while a start or a stop is still in progress (the
 * consent window open, OBS connecting, the recorder draining its last
 * values) are absorbed, not queued: a second press must not open a second
 * consent window, start a second recording, or write a run after the
 * recording ended.
 *
 * Pure: the recording is injected, so the rule is unit-tested without
 * Electron (test/recording-control.test.js).
 *   isRecording()     true while a recording runs
 *   startRecording()  starts one; resolves truthy when it started (falsy
 *                     when consent was declined or a required part failed)
 *   startRun(label)   starts the next run of the running recording and
 *                     returns its name ("Run N", or the named run)
 *   stopRecording()   stops the running recording
 */
function createRecordingControl({ isRecording, startRecording, startRun, stopRecording }) {
  let busy = null; // "starting" | "stopping" | null

  /* Resolves { started, run, newRecording }: `run` is the run's name,
     `newRecording` is true when this start began the recording (Run 1). */
  async function start(label) {
    if (busy) return { started: false, reason: busy };
    let newRecording = false;
    if (!isRecording()) {
      busy = "starting";
      let ok = false;
      try {
        ok = await startRecording();
      } finally {
        busy = null;
      }
      if (!ok || !isRecording()) return { started: false, reason: "not_started" };
      newRecording = true;
    }
    return { started: true, run: startRun(label), newRecording };
  }

  async function stop() {
    if (busy) return { stopped: false, reason: busy };
    if (!isRecording()) return { stopped: false, reason: "not_recording" };
    busy = "stopping";
    try {
      return { stopped: true, result: await stopRecording() };
    } finally {
      busy = null;
    }
  }

  return { start, stop, busy: () => busy };
}

module.exports = { createRecordingControl };
