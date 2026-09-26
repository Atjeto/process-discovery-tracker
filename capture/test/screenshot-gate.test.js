"use strict";
// When a screenshot trigger takes a screenshot (screenshot-gate.js, lane
// LF-SME, live finding 21: the same frame was saved twice, 12 ms apart).

const test = require("node:test");
const assert = require("node:assert");
const { createScreenshotGate, isAppSwitch } = require("../screenshot-gate.js");

function clock() {
  let t = 5_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("triggers within 2 s make one screenshot; later ones make another", () => {
  const c = clock();
  const g = createScreenshotGate({ now: c.now });
  assert.strictEqual(g.begin(false), true);
  g.end();
  c.advance(600);
  assert.strictEqual(g.begin(false), false, "an app switch landing with the transaction start");
  c.advance(1500);
  assert.strictEqual(g.begin(false), true);
  g.end();
});

test("nothing new starts while a screenshot is still being taken, however long it takes", () => {
  const c = clock();
  const g = createScreenshotGate({ now: c.now });
  assert.strictEqual(g.begin(false), true);   // the transaction start's screenshot, slow
  c.advance(3500);
  assert.strictEqual(g.begin(false), false, "the first poll's trigger while the first capture runs");
  g.end();
  c.advance(10);
  assert.strictEqual(g.begin(false), true, "after it, triggers work again");
  g.end();
});

test("a screenshot taken by hand is never held back", () => {
  const c = clock();
  const g = createScreenshotGate({ now: c.now });
  assert.strictEqual(g.begin(false), true);
  assert.strictEqual(g.begin(true), true, "while one is in flight");
  g.end();
  g.end();
  assert.strictEqual(g.begin(true), true, "within 2 s of the last");
  g.end();
});

test("the first program of a recording is not an app switch; a change after it is", () => {
  assert.strictEqual(isAppSwitch(null, "Google Chrome"), false);
  assert.strictEqual(isAppSwitch("Google Chrome", "Google Chrome"), false);
  assert.strictEqual(isAppSwitch("Google Chrome", "Microsoft Excel"), true);
  assert.strictEqual(isAppSwitch("Google Chrome", null), false);
});
