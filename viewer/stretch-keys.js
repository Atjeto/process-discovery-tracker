"use strict";

/*
 * stretch-keys.js: I and O select a stretch on the Timeline (lane W2, plan
 * section 11.3 and 11.5), as video tools do: I where it starts, O where it
 * ends, by the keyboard and while the video plays. Pure;
 * stretch-keys.test.js drives it, views/flow-view.js holds what is pressed
 * and draws it.
 *
 * The pair: I puts the start at the clock's moment, O the end. With both
 * set the stretch is selected, the earlier moment its start, so O before I,
 * or O at a moment before the start, gives the pair the right way round. A
 * second I moves the start (a second O before any I, the end). I and O at
 * one moment make no stretch: it says so, and what was pressed first stays,
 * so the other key at another moment still makes the stretch.
 */

/* The words, word for word. */
const WORDS = {
  starts: (at) => "Stretch starts at " + at + ".",
  ends: (at) => "Stretch ends at " + at + ".",
  same: "A stretch needs a start and an end at two moments.",
  startMark: "Start of a stretch",
  endMark: "End of a stretch",
};

/* Two moments closer than this are one moment. */
const SAME_MS = 1;

function _ms(v) { return Number.isFinite(v) ? v : null; }

/* `pending` = { startMs, endMs } what was pressed and not paired yet (either
   null), `key` "i" or "o", `ms` the clock's moment. Returns { pending, range,
   say }: what is still pressed, the stretch selected ({ startMs, endMs },
   start before end) or null, and what the message area says: "starts" (the
   start set), "ends" (an end set before any start), "same" (both at one
   moment), "noMoment" (no moment to press at), or null (a stretch selected:
   the row shows it). */
function press(pending, key, ms) {
  const p = { startMs: _ms(pending && pending.startMs), endMs: _ms(pending && pending.endMs) };
  const k = String(key || "").toLowerCase();
  if (k !== "i" && k !== "o") return { pending: p, range: null, say: null };
  if (!Number.isFinite(ms)) return { pending: p, range: null, say: "noMoment" };
  const other = k === "i" ? p.endMs : p.startMs;
  if (other == null) {
    // The first of the pair: a second I (or O) moves it.
    return { pending: k === "i" ? { startMs: ms, endMs: null } : { startMs: null, endMs: ms }, range: null,
      say: k === "i" ? "starts" : "ends" };
  }
  if (Math.abs(ms - other) < SAME_MS) return { pending: p, range: null, say: "same" };
  return { pending: { startMs: null, endMs: null }, range: { startMs: Math.min(ms, other), endMs: Math.max(ms, other) }, say: null };
}

/* Whether anything is pressed and not paired yet. */
function isPending(pending) {
  return !!pending && (Number.isFinite(pending.startMs) || Number.isFinite(pending.endMs));
}

module.exports = { WORDS, SAME_MS, press, isPending };
