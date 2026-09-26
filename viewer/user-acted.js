"use strict";

/*
 * user-acted.js: a program's own change in the recording.
 *
 * The recorder tells what the SME did from what a program does by itself (a
 * screen filling its fields as it loads, the Office ribbon echoing the
 * selected cell). It writes the second kind marked, "user_acted": false,
 * instead of dropping it, so a program it misjudges loses nothing in the raw
 * events.jsonl (the owner, 2026-09-26). The pipeline leaves marked
 * interactions out of the steps (recorder_noise.leave_out_not_the_users),
 * and the viewer leaves them out as it loads the recording, so both read the
 * same events.
 */

/* True for an interaction the recorder marked as a program's own change. */
function isProgramsOwnChange(ev) {
  return !!(ev && ev.type === "interaction" && ev.data && ev.data.user_acted === false);
}

module.exports = { isProgramsOwnChange };
