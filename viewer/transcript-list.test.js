"use strict";

// Lane E (E3): the list of the Timeline's Transcript tab.
const test = require("node:test");
const assert = require("node:assert/strict");
const TL = require("./transcript-list.js");
const LO = require("./left-out.js");

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const say = (id, sec, speaker, text, file) => ({ id, startS: sec, endS: sec + 2, startMs: T0 + sec * 1000,
  endMs: T0 + sec * 1000 + 2000, speaker, text, file: file || "transcript.json" });

test("tabModel: the placed sentences of every transcript on one clock, the speaker where it changes, the unplaced ones named", () => {
  const parts = [
    { file: "transcript.json", number: 1, synced: true, sentences: [say("a", 10, "Ana", "Open the order"), say("b", 40, "Ana", "Then the invoice")] },
    { file: "transcript-2.json", number: 2, synced: true, sentences: [say("t2:x", 20, "Ben", "Which customer?", "transcript-2.json"),
      say("t2:y", 50, "Ana", "Send it", "transcript-2.json")] },
    { file: "transcript-3.json", number: 3, synced: false, sentences: [{ id: "t3:z", startMs: null, text: "later" }] },
  ];
  const m = TL.tabModel(parts, []);
  assert.deepEqual(m.rows.map((r) => r.s.id), ["a", "t2:x", "b", "t2:y"]);
  assert.deepEqual(m.rows.map((r) => r.speakerShown), [true, true, true, false]);
  assert.deepEqual(m.speakers, ["Ana", "Ben"]);
  assert.deepEqual(m.unplaced, [{ file: "transcript-3.json", number: 3 }]);
  assert.equal(m.total, 4);
});

test("tabModel: a stretch put aside stands in one row for what was said in it, and the speaker shows again after it", () => {
  const parts = [{ file: "transcript.json", number: 1, synced: true, sentences: [
    say("a", 10, "Ana", "one"), say("b", 70, "Ana", "two"), say("c", 80, "Ana", "three"), say("d", 130, "Ana", "four")] }];
  const stretches = LO.stretchesOf({ excluded_ranges: [{ start: new Date(T0 + 60000).toISOString(), end: new Date(T0 + 120000).toISOString() }] });
  const m = TL.tabModel(parts, stretches);
  assert.deepEqual(m.rows.map((r) => (r.kind === "gap" ? "gap" : r.s.id)), ["a", "gap", "d"]);
  assert.equal(m.rows[2].speakerShown, true);
  assert.equal(m.total, 2);
});

test("currentIndex: the last sentence started at or before the moment, by binary search", () => {
  const starts = [10, 20, 20, 35, 50];
  assert.equal(TL.currentIndex(starts, 5), -1);
  assert.equal(TL.currentIndex(starts, 10), 0);
  assert.equal(TL.currentIndex(starts, 19), 0);
  assert.equal(TL.currentIndex(starts, 20), 2);
  assert.equal(TL.currentIndex(starts, 49), 3);
  assert.equal(TL.currentIndex(starts, 500), 4);
  assert.equal(TL.currentIndex(starts, NaN), -1);
  assert.equal(TL.currentIndex([], 10), -1);
});

test("sentenceIndexAt: the tab's sentence at this moment, none inside a stretch put aside", () => {
  const starts = [10, 20, 35];
  const aside = [{ startMs: 30, endMs: 40 }];
  // A positive control: outside the stretch, the tab's currentIndex.
  assert.equal(TL.sentenceIndexAt(starts, 25, aside), 1);
  assert.equal(TL.sentenceIndexAt(starts, 32, aside), -1);
  assert.equal(TL.sentenceIndexAt(starts, 41, aside), 2);
  assert.equal(TL.sentenceIndexAt(starts, 5, []), -1);
});

test("sayingAt: the caption shows the tab's sentence while it is said, and nothing between two sentences", () => {
  const sentences = [say("a", 1, "Ana", "So this is how"), say("b", 5, "Ben", "Which mailbox?")];
  const starts = sentences.map((x) => x.startMs);
  // A positive control: inside the first sentence (1 s to 3 s).
  assert.equal(TL.sayingAt(sentences, starts, T0 + 2000, []), 0);
  // Between them (3 s to 5 s): none, though the tab still marks the first.
  assert.equal(TL.sayingAt(sentences, starts, T0 + 4000, []), -1);
  assert.equal(TL.sentenceIndexAt(starts, T0 + 4000, []), 0);
  // At a sentence's end: over; at the next one's start: that one.
  assert.equal(TL.sayingAt(sentences, starts, T0 + 3000, []), -1);
  assert.equal(TL.sayingAt(sentences, starts, T0 + 5000, []), 1);
  // Before the first, and inside a stretch put aside: none.
  assert.equal(TL.sayingAt(sentences, starts, T0, []), -1);
  assert.equal(TL.sayingAt(sentences, starts, T0 + 2000, [{ startMs: T0 + 1500, endMs: T0 + 2500 }]), -1);
  // A sentence without an end shows until the next one starts.
  const open = [Object.assign({}, sentences[0], { endMs: null }), sentences[1]];
  assert.equal(TL.sayingAt(open, starts, T0 + 4000, []), 0);
});

test("shows, markedHtml and countText: the search and the speaker", () => {
  const s = { speaker: "Ana", text: "Check  the INVOICE, then the invoice <total>" };
  const q = TL.queryOf("  Invoice ");
  assert.equal(q, "invoice");
  assert.equal(TL.shows(s, q, ""), true);
  assert.equal(TL.shows(s, q, "Ben"), false);
  assert.equal(TL.shows(s, "", "Ana"), true);
  assert.equal(TL.shows(s, "order", ""), false);
  assert.equal(TL.markedHtml(s.text, q), "Check the <mark>INVOICE</mark>, then the <mark>invoice</mark> &lt;total&gt;");
  assert.equal(TL.markedHtml(s.text, ""), "Check the INVOICE, then the invoice &lt;total&gt;");
  assert.equal(TL.countText(12, 340, true), "12 of 340");
  assert.equal(TL.countText(340, 340, false), "340 sentences");
  assert.equal(TL.countText(1, 1, false), "1 sentence");
});
