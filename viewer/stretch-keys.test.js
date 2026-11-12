"use strict";

/*
 * stretch-keys.test.js: I and O select a stretch (stretch-keys.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./stretch-keys.js");

const T0 = Date.parse("2026-11-10T09:00:00.000Z");
const s = (n) => T0 + n * 1000;
const NONE = { startMs: null, endMs: null };

test("I then O: the stretch from I to O, nothing left pressed", () => {
  // A positive control: the pair the right way round.
  const a = K.press(NONE, "i", s(5));
  assert.deepEqual(a, { pending: { startMs: s(5), endMs: null }, range: null, say: "starts" });
  const b = K.press(a.pending, "o", s(12));
  assert.deepEqual(b.range, { startMs: s(5), endMs: s(12) });
  assert.equal(b.say, null, "the row shows the stretch; nothing is said");
  assert.equal(K.isPending(b.pending), false);
});

test("O then I: the pair the right way round", () => {
  const a = K.press(NONE, "o", s(12));
  assert.deepEqual(a, { pending: { startMs: null, endMs: s(12) }, range: null, say: "ends" });
  const b = K.press(a.pending, "i", s(5));
  assert.deepEqual(b.range, { startMs: s(5), endMs: s(12) });
  assert.equal(K.isPending(b.pending), false);
});

test("O at a moment before the start: the start is the earlier moment", () => {
  const a = K.press(NONE, "i", s(40));
  const b = K.press(a.pending, "o", s(10));
  assert.deepEqual(b.range, { startMs: s(10), endMs: s(40) });
});

test("a second I moves the start", () => {
  const a = K.press(NONE, "i", s(5));
  const b = K.press(a.pending, "i", s(8));
  assert.deepEqual(b.pending, { startMs: s(8), endMs: null });
  assert.equal(b.say, "starts");
  const c = K.press(b.pending, "o", s(12));
  assert.deepEqual(c.range, { startMs: s(8), endMs: s(12) });
});

test("I and O at one moment: no stretch, the message, and the start stays for another O", () => {
  const a = K.press(NONE, "i", s(5));
  const b = K.press(a.pending, "o", s(5));
  assert.equal(b.range, null);
  assert.equal(b.say, "same");
  assert.deepEqual(b.pending, { startMs: s(5), endMs: null });
  assert.equal(K.WORDS.same, "A stretch needs a start and an end at two moments.");
  const c = K.press(b.pending, "o", s(9));
  assert.deepEqual(c.range, { startMs: s(5), endMs: s(9) });
});

test("no moment to press at, and keys that are not I or O, change nothing", () => {
  const a = K.press(NONE, "i", null);
  assert.equal(a.say, "noMoment");
  assert.equal(K.isPending(a.pending), false);
  const pressed = { startMs: s(5), endMs: null };
  assert.deepEqual(K.press(pressed, "x", s(9)), { pending: pressed, range: null, say: null });
  // The key's case does not matter (Caps Lock).
  assert.deepEqual(K.press(pressed, "O", s(9)).range, { startMs: s(5), endMs: s(9) });
});

test("the words", () => {
  assert.equal(K.WORDS.starts("0:40"), "Stretch starts at 0:40.");
  assert.equal(K.WORDS.startMark, "Start of a stretch");
});
