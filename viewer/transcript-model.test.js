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

test("sentencesForStep: the overlap edges of the window, in time order", () => {
  const step = { time_range: { start: "2026-05-14T09:00:29Z", end: "2026-05-14T09:00:37Z" } };
  const list = [
    placed("inside", "09:00:32", "09:00:36"),
    placed("lead-in", "09:00:20", "09:00:24"),
    placed("ends-at-window-start", "09:00:15", "09:00:19"),
    { ...placed("ends-just-before", "09:00:15", "09:00:19"), endMs: at("09:00:19") - 1 },
    placed("starts-at-step-end", "09:00:37", "09:00:40"),
    { ...placed("starts-just-after", "09:00:37", "09:00:40"), startMs: at("09:00:37") + 1 },
    placed("spans-the-step", "09:00:10", "09:00:50"),
    { id: "unplaced", startMs: null, endMs: null },
  ];
  assert.deepEqual(TM.sentencesForStep(list, step).map((s) => s.id),
    ["spans-the-step", "ends-at-window-start", "lead-in", "inside", "starts-at-step-end"]);
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
    "Transcript attached: 1 sentence, no speaker names. Sync it in Flow to place it on the timeline.");
});

test("sentenceRowHtml escapes what the transcript says", () => {
  const html = TM.sentenceRowHtml({ startS: 61, speaker: "A<b>", text: "x & y" });
  assert.equal(html, '<span class="tr-time">1:01</span><span class="tr-speaker">A&lt;b&gt;</span>' +
    '<span class="tr-text">x &amp; y</span>');
});
