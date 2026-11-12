"use strict";

/*
 * timeline-screen.js: the screen of a recording without a video (lane W2,
 * plan section 11.1 and 11.6). The stage's left side is "the screen at this
 * moment": a recording without a video has screenshots of that screen, so
 * the video pane shows the screenshot taken last at or before the clock's
 * moment, with one line under it. Pure; timeline-screen.test.js drives it,
 * views/flow-view-screenshots.js draws it.
 *
 * Which screenshot shows (screenAt): the last one taken at or before the
 * moment; of two taken at one moment, the later in the list (the Screenshots
 * tab's order: the recording's first, then the ones added); none before the
 * first, and none while there is no moment. A screenshot taken in a stretch
 * set aside still shows: the hatch on the timeline says the stretch is set
 * aside, the screen says what was on it.
 */

/* The words of the screen, word for word. */
const WORDS = {
  noVideo: "No video in this project.",
  before: "No screenshot before this moment.",
  noMoment: "Click the timeline to see the screen at that moment.",
  picTitle: "Opens this screenshot in the gallery, full size.",
};

/* The line a screenshot whose file is not in the project shows in its place. */
function missingLine(file) {
  return "The screenshot file is missing: " + String(file || "");
}

/* The line under the screenshot: "Screenshot at 1:42" and, when it has a
   step, " · <step name>". `at` is its moment on the one clock ("1:42"). */
function shotLine(at, stepName) {
  const name = typeof stepName === "string" ? stepName.trim() : "";
  return "Screenshot at " + at + (name ? " · " + name : "");
}

/* The index in `shots` (screenshot events: { timestamp, ... }, in time
   order as the Timeline lists them) of the screenshot the screen shows at
   the moment `ms`: the last one taken at or before it, of two at one moment
   the later in the list; -1 before the first, or when `ms` is unknown. */
function screenAt(shots, ms) {
  if (!Number.isFinite(ms) || !Array.isArray(shots)) return -1;
  let best = -1, bestMs = -Infinity;
  shots.forEach((s, i) => {
    const t = Date.parse(s && s.timestamp);
    if (Number.isFinite(t) && t <= ms && t >= bestMs) { best = i; bestMs = t; }
  });
  return best;
}

/* The file's own name, for the missing line. */
function fileName(rel) {
  return String(rel || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

module.exports = { WORDS, missingLine, shotLine, screenAt, fileName };
