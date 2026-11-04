"use strict";
/*
 * transcript-model.js: the time rule every transcript surface uses, the step
 * window, talk outside the runs, and the "added" and append rules for pulling
 * a sentence into a text field (contract C8, plan section 7).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const TM = require("./transcript-model.js");

const STARTED = "2026-05-14T09:00:00Z";
const BASE = Date.parse(STARTED);
const at = (hms) => Date.parse("2026-05-14T" + hms + "Z");
const seg = (id, start, end, speaker, text) => ({ id, start_s: start, end_s: end, speaker, text });
const transcript = (segments, offsetMs) => ({ version: 1, source_file: "transcript/m.vtt", format: "vtt",
  clock: "own", offset_ms: offsetMs === undefined ? null : offsetMs, segments });
/* A placed sentence from wall times, the shape placeTranscript returns. */
const placed = (id, from, to, speaker) => ({ id, startS: 0, endS: 0, speaker: speaker || null, text: id,
  startMs: at(from), endMs: at(to) });

test("effectiveOffsetMs: the transcript's own offset wins, including 0 and a negative one", () => {
  const video = { external_video: { path: "D:/v.mp4", offset_ms: 7000 } };
  assert.equal(TM.effectiveOffsetMs(transcript([], -30000), video), -30000);
  assert.equal(TM.effectiveOffsetMs(transcript([], 0), video), 0);
});

test("effectiveOffsetMs: with no offset of its own the transcript takes the attached video's clock", () => {
  assert.equal(TM.effectiveOffsetMs(transcript([]), { external_video: { path: "D:/v.mp4", offset_ms: 7000 } }), 7000);
  // An attached video with no offset starts with the session (the player's rule).
  assert.equal(TM.effectiveOffsetMs(transcript([]), { external_video: { path: "D:/v.mp4" } }), 0);
  // A string is not a synced offset: the video clock applies.
  assert.equal(TM.effectiveOffsetMs({ offset_ms: "5" }, { external_video: { path: "v.mp4", offset_ms: 12 } }), 12);
});

test("effectiveOffsetMs: no offset and no attached video means not synced", () => {
  assert.equal(TM.effectiveOffsetMs(transcript([]), {}), null);
  assert.equal(TM.effectiveOffsetMs(transcript([]), null), null);
  assert.equal(TM.effectiveOffsetMs(transcript([]), { external_video: { path: "  ", offset_ms: 5 } }), null);
});

test("placeTranscript: wall time = session start + effective offset + start_s", () => {
  const t = transcript([seg("t1", 50, 54, "SME", "Now I search."), seg("t2", 12.345, 13, null, "Hello")], -30000);
  const p = TM.placeTranscript(t, {}, STARTED);
  assert.equal(p.synced, true);
  assert.equal(p.offsetMs, -30000);
  assert.deepEqual([p.sentences[0].startMs, p.sentences[0].endMs], [at("09:00:20"), at("09:00:24")]);
  assert.equal(p.sentences[1].startMs, BASE - 30000 + 12345);
  // The video clock places the same way.
  const v = TM.placeTranscript(transcript([seg("t1", 50, 54, "SME", "x")]), { external_video: { path: "v", offset_ms: 1000 } }, STARTED);
  assert.equal(v.sentences[0].startMs, BASE + 1000 + 50000);
});

test("placeTranscript: not synced places nothing in time", () => {
  const p = TM.placeTranscript(transcript([seg("t1", 1, 2, "SME", "x")]), {}, STARTED);
  assert.equal(p.synced, false);
  assert.equal(p.offsetMs, null);
  assert.equal(p.sentences.length, 1);
  assert.equal(p.sentences[0].startMs, null);
  // A session without a start time cannot be placed either.
  assert.equal(TM.placeTranscript(transcript([], 0), {}, undefined).synced, false);
});

test("segmentsOf keeps usable segments only and reads a missing end as the start", () => {
  const segs = TM.segmentsOf(transcript([seg("a", 1, 2, " Ana ", " text "), seg("b", "x", 2, null, "t"),
    seg("c", 3, 3, "", ""), { id: "d", start_s: 5, speaker: null, text: "no end" }]));
  assert.deepEqual(segs.map((s) => [s.id, s.startS, s.endS, s.speaker, s.text]),
    [["a", 1, 2, "Ana", "text"], ["d", 5, 5, null, "no end"]]);
});

test("validateTranscript: a version 1 object with a segments list", () => {
  assert.equal(TM.validateTranscript(transcript([])), null);
  assert.match(TM.validateTranscript({ version: 2, segments: [] }), /version 1/);
  assert.match(TM.validateTranscript({ version: 1 }), /no list of sentences/);
  assert.ok(TM.validateTranscript([]));
  assert.ok(TM.validateTranscript(null));
});

test("stepWindow starts 10 s before the step and ends with it", () => {
  const w = TM.stepWindow({ time_range: { start: "2026-05-14T09:00:29Z", end: "2026-05-14T09:00:37Z" } });
  assert.deepEqual(w, { startMs: at("09:00:19"), endMs: at("09:00:37") });
  assert.equal(TM.STEP_LEAD_MS, 10000);
  assert.equal(TM.stepWindow({ time_range: {} }), null);
});

test("sentencesForStep: the sentences that start in the window, its edges included, in time order", () => {
  const step = { time_range: { start: "2026-05-14T09:00:29Z", end: "2026-05-14T09:00:37Z" } };
  const list = [
    placed("inside", "09:00:32", "09:00:36"),
    placed("lead-in", "09:00:20", "09:00:24"),
    placed("starts-at-window-start", "09:00:19", "09:00:21"),
    { ...placed("starts-just-before", "09:00:19", "09:00:21"), startMs: at("09:00:19") - 1 },
    placed("starts-at-step-end", "09:00:37", "09:00:40"),
    { ...placed("starts-just-after", "09:00:37", "09:00:40"), startMs: at("09:00:37") + 1 },
    placed("started-before-the-lead", "09:00:10", "09:00:50"),
    { id: "unplaced", startMs: null, endMs: null },
  ];
  assert.deepEqual(TM.sentencesForStep(list, step).map((s) => s.id),
    ["starts-at-window-start", "lead-in", "inside", "starts-at-step-end"]);
});

test("2.0.1: the step before bounds the lead, so a sentence shows under one step only", () => {
  const a = { step_id: "a", time_range: { start: "2026-05-14T09:00:20Z", end: "2026-05-14T09:00:27Z" } };
  const b = { step_id: "b", time_range: { start: "2026-05-14T09:00:29Z", end: "2026-05-14T09:00:37Z" } };
  const added = { step_id: "x", time_range: null };
  const steps = [a, added, b];
  assert.equal(TM.prevEndMs(steps, b), at("09:00:27"), "the timed step before, past one without a time");
  assert.ok(Number.isNaN(TM.prevEndMs(steps, a)), "nothing before the first");
  assert.deepEqual(TM.stepWindow(b, undefined, at("09:00:27")), { startMs: at("09:00:27") + 1, endMs: at("09:00:37") });
  // A step that starts before the one before it ends keeps its own start.
  assert.deepEqual(TM.stepWindow(b, undefined, at("09:00:31")), { startMs: at("09:00:29"), endMs: at("09:00:37") });
  const said = [
    placed("before-a", "09:00:12", "09:00:14"),
    placed("during-a", "09:00:24", "09:00:30"),
    placed("at-a-end", "09:00:27", "09:00:28"),
    placed("between", "09:00:28", "09:00:29"),
    placed("during-b", "09:00:33", "09:00:34"),
  ];
  assert.deepEqual(TM.sentencesForStep(said, a, steps).map((s) => s.id), ["before-a", "during-a", "at-a-end"]);
  assert.deepEqual(TM.sentencesForStep(said, b, steps).map((s) => s.id), ["between", "during-b"]);
  // Without the list, the lead is the full 10 s.
  assert.deepEqual(TM.sentencesForStep(said, b).map((s) => s.id), ["during-a", "at-a-end", "between", "during-b"]);
});

test("outsideRuns: before, between and after the runs are outside; a boundary spanned is inside", () => {
  const runs = [
    { startMs: at("09:00:19"), endMs: at("09:01:02") },
    { startMs: at("09:01:46"), endMs: at("09:02:39") },
  ];
  const spans = TM.runSpans(runs);
  const list = [
    placed("before-the-recording", "08:59:32", "08:59:36"),
    placed("before", "09:00:04", "09:00:11"),
    placed("inside", "09:00:20", "09:00:24"),
    placed("spans-a-start", "09:00:15", "09:00:21"),
    placed("between", "09:01:18", "09:01:25"),
    placed("spans-an-end", "09:02:35", "09:02:45"),
    placed("touches-a-start", "09:01:40", "09:01:46"),
    { ...placed("ends-just-before-a-start", "09:01:40", "09:01:46"), endMs: at("09:01:46") - 1 },
    placed("after", "09:05:20", "09:05:26"),
  ];
  assert.deepEqual(TM.outsideRuns(list, spans).map((s) => s.id),
    ["before-the-recording", "before", "between", "ends-just-before-a-start", "after"]);
});

test("runSpans: a run left open ends at its duration, else at the end of the recording", () => {
  assert.deepEqual(TM.runSpans([{ startMs: 100, endMs: null, durationMs: 50 }]), [{ startMs: 100, endMs: 150 }]);
  assert.deepEqual(TM.runSpans([{ startMs: 100, endMs: null, durationMs: null }], 900), [{ startMs: 100, endMs: 900 }]);
  assert.deepEqual(TM.runSpans([{ startMs: NaN, endMs: 5 }]), []);
});

test("isAdded compares whitespace-normalized text, case as written", () => {
  assert.equal(TM.isAdded("Notes:\nAnything over  ten\nthousand needs a manager.", "Anything over ten thousand needs a manager."), true);
  assert.equal(TM.isAdded("anything over ten thousand needs a manager.", "Anything over ten thousand needs a manager."), false);
  assert.equal(TM.isAdded("", "x"), false);
  assert.equal(TM.isAdded("anything", "   "), false);
});

test("appendText puts the sentence on a new line of a field that has text", () => {
  assert.equal(TM.appendText("", "Now I  search."), "Now I search.");
  assert.equal(TM.appendText("  \n", "Now I search."), "Now I search.");
  assert.equal(TM.appendText("First.", "Second."), "First.\nSecond.");
  assert.equal(TM.appendText("First.\n\n", "Second."), "First.\nSecond.");
  assert.equal(TM.appendText("Kept as is ", "  "), "Kept as is ");
  assert.equal(TM.isAdded(TM.appendText("First.", "Second  one."), "Second one."), true);
});

test("formatClock reads time from the transcript's start", () => {
  assert.equal(TM.formatClock(0), "0:00");
  assert.equal(TM.formatClock(65.9), "1:05");
  assert.equal(TM.formatClock(3725), "1:02:05");
});

test("speakersOf and filterSentences: speaker, then text (case-insensitive)", () => {
  const list = [placed("a", "09:00:00", "09:00:01", "Analyst"), placed("b", "09:00:02", "09:00:03", "SME"),
    placed("c", "09:00:04", "09:00:05", "Analyst")];
  list[1].text = "Anything over ten thousand needs a Manager.";
  assert.deepEqual(TM.speakersOf(list), ["Analyst", "SME"]);
  assert.deepEqual(TM.filterSentences(list, "Analyst", "").map((s) => s.id), ["a", "c"]);
  assert.deepEqual(TM.filterSentences(list, "", "  manager ").map((s) => s.id), ["b"]);
  assert.deepEqual(TM.filterSentences(list, "Analyst", "manager"), []);
});

test("offsetForSync puts the chosen sentence at the clicked moment", () => {
  assert.equal(TM.offsetForSync(at("09:00:20"), STARTED, 50), -30000);
  const t = transcript([seg("t4", 50, 54, "SME", "x")], TM.offsetForSync(at("09:00:20"), STARTED, 50));
  assert.equal(TM.placeTranscript(t, {}, STARTED).sentences[0].startMs, at("09:00:20"));
  assert.equal(TM.offsetForSync(NaN, STARTED, 50), null);
});

test("attachedMessage counts sentences and speakers, and points at Sync when not synced", () => {
  const t = transcript([seg("a", 1, 2, "SME", "x"), seg("b", 3, 4, "Analyst", "y"), seg("c", 5, 6, "SME", "z")]);
  assert.equal(TM.attachedMessage(t, true), "Transcript attached: 3 sentences, 2 speakers.");
  assert.equal(TM.attachedMessage(transcript([seg("a", 1, 2, null, "x")]), false),
    "Transcript attached: 1 sentence, no speaker names. Sync it on the Timeline to place it.");
});

test("sentenceRowHtml escapes what the transcript says", () => {
  const html = TM.sentenceRowHtml({ startS: 61, speaker: "A<b>", text: "x & y" });
  assert.equal(html, '<span class="tr-time">1:01</span><span class="tr-speaker">A&lt;b&gt;</span>' +
    '<span class="tr-text">x &amp; y</span>');
});

test("AD-29: a sentence said before the recording started says how long before, never a negative time", () => {
  const origin = Date.parse("2026-05-14T09:00:00Z");
  const at = (ms) => ({ startS: 0, startMs: origin + ms, text: "x" });
  assert.equal(TM.sentenceClock(at(-28000), origin), "0:28 before");
  assert.equal(TM.sentenceClock(at(-3725000), origin), "1:02:05 before");
  assert.equal(TM.sentenceClock(at(-1000), origin), "0:01 before");
  assert.equal(TM.sentenceClock(at(-999), origin), "0:00", "within a second of the start reads as the start");
  assert.equal(TM.sentenceClock(at(19000), origin), "0:19");
  assert.equal(TM.sentenceRowHtml(at(-28000), origin),
    '<span class="tr-time" title="Said 0:28 before the recording started">0:28 before</span><span class="tr-text">x</span>');
  assert.equal(TM.sentenceRowHtml(at(19000), origin), '<span class="tr-time">0:19</span><span class="tr-text">x</span>');
  for (const ms of [-28000, -3725000, -1000, -999, -1]) {
    assert.ok(!TM.sentenceClock(at(ms), origin).startsWith("-"), "no minus sign at " + ms);
  }
  assert.equal(TM.sentenceClock({ startS: 12, startMs: null }, origin), "0:12", "unplaced: the transcript's own time");
});

/* ---- C23 (2.0.6): several transcripts, each with its video ----------------- */

const T0 = "2026-11-04T10:00:00.000Z";
const at0 = (ms) => Date.parse(T0) + ms;
const doc = (extra, segs) => Object.assign({ version: 1, offset_ms: null, segments: segs || [{ id: "s1", start_s: 2, end_s: 3, text: "Hello" }] }, extra);
const chain = () => ({ external_videos: [
  { id: "v1", path: "a.mp4", offset_ms: 0, in_ms: 0, out_ms: null, length_ms: 60000 },
  { id: "v2", path: "b.mp4", offset_ms: 60000, in_ms: 0, out_ms: null, length_ms: 40000 },
] });

test("C23: a transcript of a video counts from that video's start and moves with it; its video gone, it is not placed", () => {
  const anno = chain();
  assert.equal(TM.effectiveOffsetMs(doc({ video_id: "v2" }), anno), 60000);
  assert.equal(TM.effectiveOffsetMs(doc({ video_id: "v2", offset_ms: -1500 }), anno), 58500);
  anno.external_videos[1].offset_ms = 50000;   // a trim before it moved v2 up
  assert.equal(TM.effectiveOffsetMs(doc({ video_id: "v2" }), anno), 50000);
  assert.equal(TM.effectiveOffsetMs(doc({ video_id: "gone" }), anno), null);
  // One of an older project: its own offset, else the first video's.
  assert.equal(TM.effectiveOffsetMs(doc({ offset_ms: 7000 }), anno), 7000);
  assert.equal(TM.effectiveOffsetMs(doc({}), anno), 0);
  assert.equal(TM.effectiveOffsetMs(doc({}), { external_video: { path: "x.mp4", offset_ms: 3000 } }), 3000);
  // A sync stores the offset from its video's start.
  assert.equal(TM.storedOffsetFor(doc({ video_id: "v2" }), chain(), 61000), 1000);
  assert.equal(TM.storedOffsetFor(doc({}), chain(), 61000), 61000);
});

test("C23: forSession places every transcript and merges them, each sentence id one sentence", () => {
  const sess = { manifest: { started_at: T0 }, annotations: chain(), transcripts: [
    { file: "transcript.json", transcript: doc({ video_id: "v1" }) },
    { file: "transcript-2.json", transcript: doc({ video_id: "v2" }, [{ id: "s1", start_s: 5, end_s: 6, text: "Second" }]) },
  ] };
  const placed = TM.forSession(sess);
  assert.equal(placed.synced, true);
  assert.deepEqual(placed.sentences.map((x) => [x.id, x.file, x.startMs - at0(0)]),
    [["s1", "transcript.json", 2000], ["transcript-2:s1", "transcript-2.json", 65000]]);
  assert.deepEqual(placed.parts.map((p) => [p.file, p.number, p.videoId]), [["transcript.json", 1, "v1"], ["transcript-2.json", 2, "v2"]]);
  // An older session object, one transcript.
  assert.equal(TM.forSession({ manifest: { started_at: T0 }, annotations: {}, transcript: doc({ offset_ms: 0 }) }).sentences.length, 1);
  assert.equal(TM.forSession({ manifest: { started_at: T0 }, annotations: {} }), null);
});

test("C23: before the chain moves, a transcript placed without a video is tied to the one showing its first sentence, where it is", () => {
  const len = (c) => c.length_ms;
  const sess = { manifest: { started_at: T0 }, annotations: chain(), transcripts: [
    { file: "transcript.json", transcript: doc({ offset_ms: 61000 }) },   // its first sentence at 63 s: on v2
    { file: "transcript-2.json", transcript: doc({}) },                      // follows the first video
    { file: "transcript-3.json", transcript: doc({ video_id: "v2" }) },     // tied already
  ] };
  assert.deepEqual(TM.bindsBeforeChainEdit(sess, len, true),
    [{ file: "transcript.json", videoId: "v2", offsetMs: 1000 }, { file: "transcript-2.json", videoId: "v1", offsetMs: 0 }]);
  // In a recording a transcript synced by itself keeps the recording's clock.
  assert.deepEqual(TM.bindsBeforeChainEdit(sess, len, false), [{ file: "transcript-2.json", videoId: "v1", offsetMs: 0 }]);
  assert.deepEqual(TM.bindsBeforeChainEdit({ manifest: { started_at: T0 }, annotations: {}, transcripts: sess.transcripts }, len, true), []);
});
