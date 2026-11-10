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
