"use strict";

/*
 * screenshot-gate.js: when a screenshot trigger takes a screenshot.
 *
 * Triggers that land together (a transaction start and an app switch) make
 * one screenshot: a leading-edge debounce of 2 s, and nothing new while a
 * screenshot is still being taken. A screenshot taken by hand is never
 * held back. The first program of a recording is not an app switch: the
 * transaction start's screenshot shows it.
 *
 * Lane LF-SME, live finding 21: the first recording saved the same frame
 * twice, 12 ms apart. The first poll of the foreground window took a
 * screenshot as an app switch (the "first program" rule was checked after
 * it had been overwritten), and with the capture app busy starting the
 * recorder, that trigger came more than 2 s after the transaction start's
 * screenshot had begun, while it was still being taken.
 *
 * Pure, with an injected clock: unit-tested in test/screenshot-gate.test.js.
 */

function createScreenshotGate({ minIntervalMs = 2000, now = Date.now } = {}) {
  let lastMs = -Infinity;
  let inFlight = 0;
  return {
    /* Whether to take one now; when true, end() must follow it. */
    begin(force) {
      const t = now();
      if (!force && (inFlight > 0 || t - lastMs < minIntervalMs)) return false;
      lastMs = t;
      inFlight += 1;
      return true;
    },
    end() {
      if (inFlight > 0) inFlight -= 1;
    },
    msSinceLast() {
      return now() - lastMs;
    },
  };
}

/* An app switch: the foreground program changed, and it is not the first
   one seen in the recording. */
function isAppSwitch(previousApp, currentApp) {
  return !!currentApp && previousApp != null && currentApp !== previousApp;
}

module.exports = { createScreenshotGate, isAppSwitch };
