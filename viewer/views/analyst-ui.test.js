"use strict";

/*
 * Unit tests for the pure rules of views/analyst-ui.js that lane E-1 added:
 * a step marked on a video takes its frame, and a frame that cannot be read
 * never fails the step or holds it up (settleFrame); the one link a step a
 * video covers offers while it shows no screenshot ("Use the video at
 * 0:11", useVideoText, offersVideoFrame).
 *
 * analyst-ui.js loads modules that touch the page at require() time, so a
 * permissive document and window are installed first (as
 * steps-view-split-merge-names.test.js does); the functions under test touch
 * neither.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

function makeEl() {
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === "style" || p === "dataset") return {};
      if (p === "children" || p === "childNodes") return [];
      return makeEl();
    },
    apply() { return makeEl(); },
    set() { return true; },
  });
}
if (typeof global.document === "undefined") {
  global.document = new Proxy({}, {
    get(_t, p) {
      if (p === "querySelectorAll") return () => [];
      if (p === "createElement" || p === "getElementById" || p === "querySelector") return () => makeEl();
      if (p === "body" || p === "documentElement" || p === "head") return makeEl();
      if (p === "addEventListener" || p === "removeEventListener") return () => {};
      return () => makeEl();
    },
  });
}
if (typeof global.window === "undefined") {
  global.window = new Proxy({}, { get() { return () => {}; } });
}

const AUI = require("./analyst-ui.js");

test("settleFrame: a frame read gives its image", async () => {
  assert.equal(await AUI.settleFrame(Promise.resolve("iVBORw0KGgo"), 500), "iVBORw0KGgo");
  // A value given at once (not a promise) settles too.
  assert.equal(await AUI.settleFrame("abc", 500), "abc");
});

test("settleFrame: no frame is no failure: a rejected read, an empty one or none at all gives null, never a rejection", async () => {
  assert.equal(await AUI.settleFrame(Promise.reject(new Error("the video could not be read")), 500), null);
  assert.equal(await AUI.settleFrame(Promise.resolve(null), 500), null);
  assert.equal(await AUI.settleFrame(Promise.resolve(""), 500), null);
  assert.equal(await AUI.settleFrame(Promise.resolve({ not: "an image" }), 500), null);
  assert.equal(await AUI.settleFrame(null, 500), null);
  assert.equal(await AUI.settleFrame(undefined, 500), null);
});

test("settleFrame: a read that never ends gives null after the wait, so the step is added without its picture", async () => {
  const t0 = Date.now();
  const r = await AUI.settleFrame(new Promise(() => {}), 120);
  const took = Date.now() - t0;
  assert.equal(r, null);
  assert.ok(took >= 100 && took < 2000, "settled after about the wait given, took " + took + " ms");
});

test("settleFrame: a frame that comes after the wait is not taken", async () => {
  const late = new Promise((res) => setTimeout(() => res("late-frame"), 300));
  assert.equal(await AUI.settleFrame(late, 50), null);
});

test("useVideoText: the link names the step's start on the one clock", () => {
  assert.equal(AUI.useVideoText("0:11"), "Use the video at 0:11");
  assert.equal(AUI.useVideoText("1:02:03"), "Use the video at 1:02:03");
  assert.equal(AUI.useVideoText(""), "", "no start, no link");
});

test("offersVideoFrame: a step with a start that a video covers, showing no screenshot, in a project that can change", () => {
  const timed = { step_id: "s1", time_range: { start: "2026-11-10T09:00:11.000Z", end: "2026-11-10T09:00:20.000Z" } };
  assert.equal(AUI.offersVideoFrame(timed, true, 0, false), true);
  assert.equal(AUI.offersVideoFrame(timed, false, 0, false), false, "no video covers its start");
  assert.equal(AUI.offersVideoFrame(timed, true, 1, false), false, "it shows a screenshot already");
  assert.equal(AUI.offersVideoFrame(timed, true, 0, true), false, "read only");
  assert.equal(AUI.offersVideoFrame({ step_id: "s2", time_range: null }, true, 0, false), false, "a step without a time");
  assert.equal(AUI.offersVideoFrame({ step_id: "s3", time_range: { start: "", end: "" } }, true, 0, false), false);
  assert.equal(AUI.offersVideoFrame(null, true, 0, false), false);
});

test("the link's text holds no dash punctuation", () => {
  const text = AUI.useVideoText("0:11");
  assert.ok(!/[\u2013\u2014]/.test(text) && !/ - |--/.test(text));
});
