/*
 * Dead-man monitor tests (lab-phase §E2). The health-event gap is FAKED
 * via an injected clock -- no real 2-minute waits.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeadManMonitor, DEAD_MAN_SILENCE_MS } = require("../dead-man.js");

function fakeClock(startMs = 0) {
  let t = startMs;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test("stays quiet inside the silence threshold", () => {
  const now = fakeClock();
  const dm = createDeadManMonitor({ now });
  now.advance(DEAD_MAN_SILENCE_MS - 1);
  const r = dm.check();
  assert.equal(r.transition, null);
  assert.equal(r.silent, false);
  assert.equal(dm.isSilent(), false);
});

test("goes silent once past the threshold, and only transitions once", () => {
  const now = fakeClock();
  const dm = createDeadManMonitor({ now });
  now.advance(DEAD_MAN_SILENCE_MS + 1_000);
  const first = dm.check();
  assert.equal(first.transition, "went_silent");
  assert.equal(first.silent, true);
  assert.ok(first.silentForMs >= DEAD_MAN_SILENCE_MS);
  // Subsequent checks report silent but do NOT re-fire the transition
  // (one alert per silence stretch, not one per poll).
  now.advance(15_000);
  const second = dm.check();
  assert.equal(second.transition, null);
  assert.equal(second.silent, true);
  assert.equal(dm.isSilent(), true);
});

test("any signal (interaction or health) resets the gap", () => {
  const now = fakeClock();
  const dm = createDeadManMonitor({ now });
  // 90s quiet, then a recorder_health signal lands...
  now.advance(90_000);
  dm.noteSignal();
  // ...so 90s later (180s total since start) we are still under the
  // threshold measured from the LAST signal.
  now.advance(90_000);
  const r = dm.check();
  assert.equal(r.silent, false);
});

test("recovery transitions once with the true signal-to-signal gap", () => {
  const now = fakeClock(1_000_000);
  const dm = createDeadManMonitor({ now });
  now.advance(DEAD_MAN_SILENCE_MS + 30_000);
  assert.equal(dm.check().transition, "went_silent");
  // The recorder comes back 10s after detection.
  now.advance(10_000);
  dm.noteSignal();
  const r = dm.check();
  assert.equal(r.transition, "recovered");
  assert.equal(r.silent, false);
  // Gap = silence start (last heard signal) -> recovery signal.
  assert.equal(r.gapMs, DEAD_MAN_SILENCE_MS + 30_000 + 10_000);
  assert.equal(dm.isSilent(), false);
});

test("a second silence stretch alarms again", () => {
  const now = fakeClock();
  const dm = createDeadManMonitor({ now });
  now.advance(DEAD_MAN_SILENCE_MS + 1);
  assert.equal(dm.check().transition, "went_silent");
  dm.noteSignal();
  assert.equal(dm.check().transition, "recovered");
  now.advance(DEAD_MAN_SILENCE_MS + 1);
  assert.equal(dm.check().transition, "went_silent");
});

test("custom silenceMs is honored", () => {
  const now = fakeClock();
  const dm = createDeadManMonitor({ now, silenceMs: 5_000 });
  now.advance(5_001);
  assert.equal(dm.check().transition, "went_silent");
});
