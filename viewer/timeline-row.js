/*
 * timeline-row.js: the pure rules of the Timeline's first row (lane SCREEN,
 * plan section 11.3; the owner: "The timeline is the core, the center of
 * edit"). The row holds how to play and how to mark, in the process
 * manager's words, left to right: Play (only with a video), the clock (a
 * click types a time), the speed (only with a video, lane W2), Add step
 * (only with a video), Start transaction or End
 * transaction (one button in one place), Add note, the message area, Lanes,
 * zoom out, Show all, zoom in. While a stretch is
 * selected, the stretch's times and its acts take the place of the three
 * marking buttons.
 *
 * What this module decides: the words (labels and tooltips, "the video"
 * reading "the recording" in a recording without a video), which of the
 * marking buttons show and which can be clicked (rowState), which one the
 * transaction slot reads (transactionSlot), the clock's text (clockText),
 * what a typed time goes to (clockTarget) and the stretch's text
 * (stretchText). The DOM is views/flow-view.js (syncTimelineRow).
 *
 * Pure module: no DOM, no IPC. Unit-tested in timeline-row.test.js.
 */

"use strict";

const { clock, parseClock, formatDuration } = require("./dom.js");

/* The labels, word for word (lane SCREEN brief, item 5). */
const LABELS = {
  play: "Play",
  pause: "Pause",
  addStep: "Add step",
  start: "Start transaction",
  end: "End transaction",
  addNote: "Add note",
  notPart: "Not part of the process",
  leaveOut: "Leave out of the analysis",
  makeTx: "Make it a transaction",
  clear: "Clear selection",
  lanes: "Lanes",
  zoomOut: "Zoom out",
  showAll: "Show all",
  zoomIn: "Zoom in",
  clockField: "Go to a time",
  speed: "Speed",
};

/* Lane W2 (plan section 11.4): how fast the video plays, its choices in
   their order, the label each reads, and the key it is kept under on this
   computer. */
const SPEEDS = [1, 1.5, 2];
const SPEED_KEY = "pdt.playbackRate";
function speedLabel(rate) { return rate + "x"; }
/* The speed kept (a value read from storage), else 1x. */
function speedOf(value) {
  const n = Number(value);
  return SPEEDS.includes(n) ? n : 1;
}

/* What the row's moment is called: the video, or, in a recording without a
   video attached, the recording. */
function nounOf(hasVideo) {
  return hasVideo ? "the video" : "the recording";
}

/* The tooltips, one sentence each on what the click does (item 5). `noun`
   is nounOf(...). Clear selection has none. */
function titles(noun) {
  const n = noun || "the video";
  return {
    play: "Plays or pauses " + n + ". Key: Space",
    clock: "The time since the start of " + n + ". Click to type a time and go there.",
    speed: "How fast the video plays",
    addStep: "Adds a step at this moment of " + n + ". The step before it ends here. Key: S",
    start: "Starts a new transaction at this moment of " + n + ".",
    end: "Ends the transaction at this moment of " + n + ".",
    addNote: "Adds a note at this moment of " + n + ". Notes stay out of the PDD.",
    notPart: "Marks the selected stretch as not part of the process: playing skips it.",
    leaveOut: "Drafts the steps and the map again without this stretch: playing skips it.",
    makeTx: "Makes a transaction that starts and ends where the selection does.",
    // Lane LANES: the legend is in the Lanes menu.
    lanes: "Choose which lanes the timeline shows, and see what its marks mean",
    zoomOut: "Shows more of the timeline. Key: -",
    showAll: "Shows the whole length of the timeline. Key: 0",
    zoomIn: "Shows less of the timeline, larger. Key: +",
  };
}

/* The tooltip of a marking button that has no moment to mark at (a
   recording without a video, nothing clicked on the timeline yet). */
const NO_MOMENT = "There is no moment to mark yet: click the timeline, or click the clock and type a time.";

/* The message a time that cannot be read gives. */
const BAD_TIME = "Type a time such as 6:20.";

/* Which button the transaction slot shows at the moment `atMs`: "end" while
   that moment is inside a transaction whose end is not marked yet (its band
   runs on to the end: `dangling`), else "start". `runs` are the
   transactions as the markers now are ({ startMs, endMs, dangling }). A
   moment that cannot be read reads "start". */
function transactionSlot(runs, atMs) {
  if (!Number.isFinite(atMs)) return "start";
  for (const r of runs || []) {
    if (r && r.dangling && Number.isFinite(r.startMs) && atMs >= r.startMs) return "end";
  }
  return "start";
}

/* The clock: the moment and the length, on the one clock ("6:20 / 1:02:00").
   Without a moment its place reads "-:--". `originMs` is the start of the
   clock (dom.js recordingStartMs); `endMs` the end of the timeline. */
function clockText(atMs, endMs, originMs) {
  const len = Number.isFinite(endMs) && Number.isFinite(originMs) ? clock(Math.max(0, endMs - originMs)) : "";
  const at = Number.isFinite(atMs) && Number.isFinite(originMs) ? clock(atMs - originMs) : "-:--";
  return len ? at + " / " + len : at;
}

/* What a time typed in the clock goes to: { ms } (absolute, kept inside the
   timeline: a time before its start goes to its start, one after its end to
   its end), or { error } with the message to show. `span` = { startMs,
   endMs } the timeline's. */
function clockTarget(text, originMs, span) {
  const rel = parseClock(text);
  if (rel == null || !Number.isFinite(originMs)) return { error: BAD_TIME };
  let ms = originMs + rel;
  if (span && Number.isFinite(span.startMs)) ms = Math.max(span.startMs, ms);
  if (span && Number.isFinite(span.endMs)) ms = Math.min(span.endMs, ms);
  return { ms };
}

/* The selected stretch, as the row reads it: "0:40 to 1:10 · 30s". */
function stretchText(startMs, endMs, originMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(originMs)) return "";
  return clock(startMs - originMs) + " to " + clock(endMs - originMs) + " · " + formatDuration(endMs - startMs);
}

/* What the row shows. `o` = {
     drawable: a timeline is drawn (a recording or a video),
     hasVideo: a video is attached (Play, Add step),
     recording: the project is a recording (false: made from a video or
       from nothing, where Add step is the row's filled button),
     readOnly: a hand-off opened read only, or a project open in another window,
     atMs: the row's moment (the clock), or null,
     runs: the transactions as the markers now are (transactionSlot),
     stretch: { startMs, endMs } selected, or null,
     aside: what a stretch is set aside as: "not-part" (a project without a
       recording), "leave-out" (a recording with events), or null (none),
   }. Returns { play, clock, speed, addStep, tx, addNote, stretch, filled }
   where each marking button is { shown, enabled } (tx also { kind: "start" |
   "end" }), play, clock and speed (lane W2: with a video, as Play) are
   booleans, and stretch is null or { acts: [...], filled }
   (acts in their order: "aside" when offered, "makeTx", "clear"). The filled
   button: Add step in a project without a recording ("addStep"), the
   stretch's first act while one is selected, else none (null). */
function rowState(o) {
  const s = o || {};
  const drawable = !!s.drawable;
  const edit = drawable && !s.readOnly;
  const moment = Number.isFinite(s.atMs);
  const stretch = drawable && s.stretch && Number.isFinite(s.stretch.startMs) && Number.isFinite(s.stretch.endMs) ? s.stretch : null;
  const marking = edit && !stretch;
  const out = {
    play: drawable && !!s.hasVideo,
    clock: drawable,
    speed: drawable && !!s.hasVideo,
    addStep: { shown: marking && !!s.hasVideo, enabled: moment },
    tx: { shown: marking, enabled: moment, kind: transactionSlot(s.runs, s.atMs) },
    addNote: { shown: marking, enabled: moment },
    stretch: null,
    filled: null,
  };
  if (stretch) {
    const acts = [];
    if (edit && (s.aside === "not-part" || s.aside === "leave-out")) acts.push("aside");
    if (edit) acts.push("makeTx");
    acts.push("clear");
    out.stretch = { acts };
    out.filled = acts[0] === "clear" ? null : acts[0];
  } else if (out.addStep.shown && s.recording === false) {
    out.filled = "addStep";
  }
  return out;
}

module.exports = { LABELS, SPEEDS, SPEED_KEY, speedLabel, speedOf, nounOf, titles, NO_MOMENT, BAD_TIME, transactionSlot,
  clockText, clockTarget, stretchText, rowState };
