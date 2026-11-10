"use strict";

// Lane E (E4): the stretches put aside, read by the player, the Transcript
// tab and the readers of the analysis.
const test = require("node:test");
const assert = require("node:assert/strict");
const LO = require("./left-out.js");

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const range = (a, b) => ({ start: at(a), end: at(b), reason: "manual" });

test("stretchesOf: readable entries in time order, overlapping and touching ones joined, each with its entries", () => {
  const a = range(10, 20), b = range(15, 30), c = range(30, 40), d = range(60, 70);
  const out = LO.stretchesOf({ excluded_ranges: [d, { start: "x", end: at(5) }, b, a, c, range(50, 50), null] });
  assert.deepEqual(out.map((s) => [(s.startMs - T0) / 1000, (s.endMs - T0) / 1000]), [[10, 40], [60, 70]]);
  assert.deepEqual(out[0].ranges, [a, b, c]);
  assert.deepEqual(out[1].ranges, [d]);
  assert.deepEqual(LO.stretchesOf(undefined), []);
  assert.deepEqual(LO.stretchesOf({ excluded_ranges: "no" }), []);
});

test("analysisRanges: a recording's entries; none in a project made from a video or from nothing", () => {
  const list = [range(1, 2)];
  assert.deepEqual(LO.analysisRanges({ events: [{}], manifest: {}, annotations: { excluded_ranges: list } }), list);
  assert.deepEqual(LO.analysisRanges({ events: [], manifest: { source: "video" }, annotations: { excluded_ranges: list } }), []);
  assert.deepEqual(LO.analysisRanges({ events: [], manifest: { source: "blank" }, annotations: { excluded_ranges: list } }), []);
  assert.deepEqual(LO.analysisRanges(null), []);
});

test("skipTo: playing that runs into a stretch's start goes on at its end; a seek inside it plays it to its end", () => {
  const s = LO.stretchesOf({ excluded_ranges: [range(60, 120), range(200, 260)] });
  const ms = (x) => T0 + x * 1000;
  // Ran into the start, on the start itself, or a moment after it.
  assert.equal(LO.skipTo(s, ms(59.8), ms(60.1)), ms(120));
  assert.equal(LO.skipTo(s, ms(59.8), ms(60)), ms(120));
  // Played from a moment inside it (a seek there): no skip, it plays on.
  assert.equal(LO.skipTo(s, ms(61), ms(61.25)), null);
  assert.equal(LO.skipTo(s, ms(119.9), ms(120.1)), null);
  // Before it, after it, backwards, unknown.
  assert.equal(LO.skipTo(s, ms(50), ms(59.9)), null);
  assert.equal(LO.skipTo(s, ms(130), ms(131)), null);
  assert.equal(LO.skipTo(s, ms(61), ms(59)), null);
  assert.equal(LO.skipTo(s, null, ms(60.1)), null);
  // The second stretch too.
  assert.equal(LO.skipTo(s, ms(199.9), ms(200.2)), ms(260));
  assert.equal(LO.skipTo([], ms(1), ms(2)), null);
});

test("nextStart and inside", () => {
  const s = LO.stretchesOf({ excluded_ranges: [range(60, 120), range(200, 260)] });
  assert.equal(LO.nextStart(s, T0), T0 + 60000);
  assert.equal(LO.nextStart(s, T0 + 60000), T0 + 200000);
  assert.equal(LO.nextStart(s, T0 + 300000), null);
  assert.equal(LO.inside(s, T0 + 60000), true);
  assert.equal(LO.inside(s, T0 + 119999), true);
  assert.equal(LO.inside(s, T0 + 120000), false);
  assert.equal(LO.inside(s, NaN), false);
});

test("omitSentences: what was said in a stretch is left out, one gap in its place; a sentence without a time stays", () => {
  const s = LO.stretchesOf({ excluded_ranges: [range(60, 120), range(300, 310)] });
  const say = (id, sec) => ({ id, startMs: Number.isFinite(sec) ? T0 + sec * 1000 : null });
  const items = LO.omitSentences([say("a", 10), say("b", 60), say("c", 90), say("d", 120), say("e", null), say("f", 400)], s);
  assert.deepEqual(items.map((x) => (x.gap ? "gap:" + (x.gap.startMs - T0) / 1000 : x.sentence.id)), ["a", "gap:60", "d", "e", "f"]);
  // A stretch nothing was said in has no row.
  assert.ok(!items.some((x) => x.gap && x.gap.startMs === T0 + 300000));
  assert.deepEqual(LO.omitSentences([say("a", 10)], []).map((x) => x.sentence.id), ["a"]);
});

test("saidOutside: the step panel's Said list leaves out what was said in a stretch", () => {
  const anno = { excluded_ranges: [range(60, 120)] };
  const say = (id, sec) => ({ id, startMs: T0 + sec * 1000 });
  assert.deepEqual(LO.saidOutside([say("a", 50), say("b", 60), say("c", 119), say("d", 120)], anno).map((x) => x.id), ["a", "d"]);
  assert.deepEqual(LO.saidOutside([say("a", 70)], {}).map((x) => x.id), ["a"]);
});

test("wordsFor: the mark in a recording's words and in a project without one", () => {
  assert.equal(LO.wordsFor(true).act, "Leave out of the analysis");
  assert.equal(LO.wordsFor(true).legend, "left out of the analysis");
  assert.equal(LO.wordsFor(false).act, "Not part of the process");
  assert.equal(LO.wordsFor(false).band, "Not part of the process");
  assert.equal(LO.wordsFor(false).legend, "not part of the process");
});
