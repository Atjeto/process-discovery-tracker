"use strict";
/* timeline-row.js: the Timeline's first row (lane SCREEN). */

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./timeline-row.js");

const T0 = Date.parse("2026-11-10T09:00:00.000Z");
const s = (n) => T0 + n * 1000;

test("the transaction slot reads End transaction only inside a transaction whose end is not marked yet", () => {
  const closed = { startMs: s(5), endMs: s(20), dangling: false };
  const open = { startMs: s(30), endMs: s(60), dangling: true };
  // Positive control: inside the open one.
  assert.equal(R.transactionSlot([closed, open], s(40)), "end");
  assert.equal(R.transactionSlot([closed, open], s(30)), "end", "at its start");
  // Inside a closed one, before the open one, with none, or no moment: Start.
  assert.equal(R.transactionSlot([closed, open], s(10)), "start");
  assert.equal(R.transactionSlot([closed, open], s(25)), "start");
  assert.equal(R.transactionSlot([], s(10)), "start");
  assert.equal(R.transactionSlot([open], null), "start");
  assert.equal(R.transactionSlot(null, s(40)), "start");
});

test("the clock reads the moment and the length on the one clock, and -:-- without a moment", () => {
  assert.equal(R.clockText(s(380), s(3720), T0), "6:20 / 1:02:00");
  assert.equal(R.clockText(s(2), s(31), T0), "0:02 / 0:31");
  assert.equal(R.clockText(null, s(342), T0), "-:-- / 5:42");
  assert.equal(R.clockText(s(2), NaN, T0), "0:02");
});

test("a time typed in the clock goes to that moment, kept inside the timeline; one that cannot be read says how to type it", () => {
  const span = { startMs: s(0), endMs: s(31) };
  assert.deepEqual(R.clockTarget("0:10", T0, span), { ms: s(10) });
  assert.deepEqual(R.clockTarget(" 0:10 ", T0, span), { ms: s(10) });
  assert.deepEqual(R.clockTarget("5:00", T0, span), { ms: s(31) }, "after the end: the end");
  assert.deepEqual(R.clockTarget("1:02:00", T0, { startMs: s(0), endMs: s(4000) }), { ms: s(3720) });
  for (const bad of ["", "abc", "6:2", "6:75", "10"]) {
    assert.deepEqual(R.clockTarget(bad, T0, span), { error: "Type a time such as 6:20." }, bad);
  }
  assert.equal(R.BAD_TIME, "Type a time such as 6:20.");
});

test("the stretch reads its start, its end and its length", () => {
  assert.equal(R.stretchText(s(40), s(70), T0), "0:40 to 1:10 · 30s");
  assert.equal(R.stretchText(s(8), s(16.4), T0), "0:08 to 0:16 · 8s");
  assert.equal(R.stretchText(s(0), s(3725), T0), "0:00 to 1:02:05 · 1h 02m");
  assert.equal(R.stretchText(NaN, s(1), T0), "");
});

test("the words: the video, or the recording in a recording without a video; the copy table word for word", () => {
  assert.equal(R.nounOf(true), "the video");
  assert.equal(R.nounOf(false), "the recording");
  const v = R.titles(R.nounOf(true));
  assert.equal(v.play, "Plays or pauses the video. Key: Space");
  assert.equal(v.clock, "The time since the start of the video. Click to type a time and go there.");
  assert.equal(v.addStep, "Adds a step at this moment of the video. The step before it ends here. Key: S");
  assert.equal(v.start, "Starts a new transaction at this moment of the video.");
  assert.equal(v.end, "Ends the transaction at this moment of the video.");
  assert.equal(v.addNote, "Adds a note at this moment of the video.");
  assert.equal(v.notPart, "Marks the selected stretch as not part of the process: playing skips it.");
  assert.equal(v.leaveOut, "Drafts the steps and the map again without this stretch: playing skips it.");
  assert.equal(v.makeTx, "Makes a transaction that starts and ends where the selection does.");
  assert.equal(v.lanes, "Choose which lanes the timeline shows, and see what its marks mean");
  assert.equal(v.zoomOut, "Shows more of the timeline. Key: -");
  assert.equal(v.showAll, "Shows the whole length of the timeline. Key: 0");
  assert.equal(v.zoomIn, "Shows less of the timeline, larger. Key: +");
  const r = R.titles(R.nounOf(false));
  assert.equal(r.start, "Starts a new transaction at this moment of the recording.");
  // Lane A-2: every tooltip of the row is 90 characters or fewer, in both words.
  for (const set of [v, r]) for (const k of Object.keys(set)) assert.ok(set[k].length <= 90, k + ": " + set[k]);
  assert.equal(r.clock, "The time since the start of the recording. Click to type a time and go there.");
  assert.deepEqual([R.LABELS.addStep, R.LABELS.start, R.LABELS.end, R.LABELS.addNote, R.LABELS.notPart, R.LABELS.leaveOut,
    R.LABELS.makeTx, R.LABELS.clear, R.LABELS.lanes, R.LABELS.showAll],
  ["Add step", "Start transaction", "End transaction", "Add note", "Not part of the process", "Leave out of the analysis",
    "Make it a transaction", "Clear selection", "Lanes", "Show all"]);
});

const VIDEO = { drawable: true, hasVideo: true, recording: false, readOnly: false, atMs: s(10), runs: [], stretch: null, aside: "not-part" };

test("the row in a video project: Play, the clock, Add step (the filled one), Start transaction and Add note", () => {
  const st = R.rowState(VIDEO);
  assert.equal(st.play, true);
  assert.equal(st.clock, true);
  assert.deepEqual(st.addStep, { shown: true, enabled: true });
  assert.deepEqual(st.tx, { shown: true, enabled: true, kind: "start" });
  assert.deepEqual(st.addNote, { shown: true, enabled: true });
  assert.equal(st.stretch, null);
  assert.equal(st.filled, "addStep");
  // Lane W2: the speed, with a video only.
  assert.equal(st.speed, true);
  // Inside an open transaction the slot reads End transaction.
  assert.equal(R.rowState({ ...VIDEO, runs: [{ startMs: s(5), endMs: s(31), dangling: true }] }).tx.kind, "end");
});

test("read only: no marking button and no act on a stretch, the stretch's times and Clear selection only", () => {
  // Positive control: the same project, editable, offers them.
  assert.equal(R.rowState(VIDEO).tx.shown, true);
  const ro = R.rowState({ ...VIDEO, readOnly: true });
  assert.equal(ro.addStep.shown, false);
  assert.equal(ro.tx.shown, false);
  assert.equal(ro.addNote.shown, false);
  assert.equal(ro.play, true, "playing is not an edit");
  assert.equal(ro.filled, null);
  const sel = R.rowState({ ...VIDEO, readOnly: true, stretch: { startMs: s(8), endMs: s(16) } });
  assert.deepEqual(sel.stretch, { acts: ["clear"] });
  assert.equal(sel.filled, null);
});

test("a recording without a video: no Play and no Add step; with no moment yet the marking buttons are there but cannot be clicked", () => {
  const rec = { drawable: true, hasVideo: false, recording: true, readOnly: false, atMs: null, runs: [], stretch: null, aside: "leave-out" };
  const st = R.rowState(rec);
  assert.equal(st.play, false);
  assert.equal(st.speed, false, "no video, no speed");
  assert.equal(st.addStep.shown, false);
  assert.deepEqual(st.tx, { shown: true, enabled: false, kind: "start" });
  assert.deepEqual(st.addNote, { shown: true, enabled: false });
  assert.equal(st.filled, null, "in a recording the filled button is Confirm transaction, in the pane");
  assert.equal(R.rowState({ ...rec, atMs: s(3) }).tx.enabled, true);
  assert.equal(R.NO_MOMENT, "There is no moment to mark yet: click the timeline, or click the clock and type a time.");
});

test("a stretch selected: its acts take the place of the marking buttons, the first one filled", () => {
  const sel = R.rowState({ ...VIDEO, stretch: { startMs: s(8), endMs: s(16) } });
  assert.equal(sel.addStep.shown, false);
  assert.equal(sel.tx.shown, false);
  assert.equal(sel.addNote.shown, false);
  assert.deepEqual(sel.stretch, { acts: ["aside", "makeTx", "clear"] });
  assert.equal(sel.filled, "aside");
  // A recording that holds no event has nothing to leave out.
  const none = R.rowState({ ...VIDEO, recording: true, aside: null, stretch: { startMs: s(8), endMs: s(16) } });
  assert.deepEqual(none.stretch, { acts: ["makeTx", "clear"] });
  assert.equal(none.filled, "makeTx");
});

test("lane W2: the speed's choices, their words, and the one kept on this computer", () => {
  assert.deepEqual(R.SPEEDS.map(R.speedLabel), ["1x", "1.5x", "2x"]);
  assert.equal(R.titles(R.nounOf(true)).speed, "How fast the video plays");
  // A positive control: a kept choice is read back.
  assert.equal(R.speedOf("2"), 2);
  assert.equal(R.speedOf("1.5"), 1.5);
  // Nothing kept, or a value that is not a choice: 1x.
  assert.equal(R.speedOf(null), 1);
  assert.equal(R.speedOf("3"), 1);
  assert.equal(R.speedOf("fast"), 1);
  assert.equal(R.SPEED_KEY, "pdt.playbackRate");
});

test("no timeline drawn (a project with no video and no recording): the row offers nothing to play or mark", () => {
  const st = R.rowState({ drawable: false, hasVideo: false, recording: false, atMs: null, stretch: { startMs: s(1), endMs: s(2) } });
  assert.equal(st.play, false);
  assert.equal(st.clock, false);
  assert.equal(st.addStep.shown || st.tx.shown || st.addNote.shown, false);
  assert.equal(st.stretch, null);
});
