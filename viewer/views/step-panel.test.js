"use strict";

/*
 * Unit tests for the pure rules of views/step-panel.js that lane E-1 added:
 * when a step just marked on the Timeline puts the cursor in its name
 * (nameTakesFocus: paused yes, playing never, read only never) and where the
 * panel's head is fields (headEditable: the Map, never on Steps beside the
 * editor, never read only; lane PANE: opensOn, the panel never opens on the
 * Timeline); and views/flow-view-video.js
 * isPlaying, which says "playing".
 *
 * step-panel.js wires its page at require() time, so a permissive document
 * and window are installed first; #video answers with a fake player the
 * tests set.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let fakeVideo = null;
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
global.document = new Proxy({}, {
  get(_t, p) {
    if (p === "querySelectorAll") return () => [];
    if (p === "querySelector" || p === "getElementById") {
      return (sel) => ((sel === "#video" || sel === "video") && fakeVideo ? fakeVideo : makeEl());
    }
    if (p === "createElement") return () => makeEl();
    if (p === "body" || p === "documentElement" || p === "head") return makeEl();
    if (p === "addEventListener" || p === "removeEventListener") return () => {};
    return () => makeEl();
  },
});
global.window = new Proxy({}, { get() { return () => {}; } });

const SP = require("./step-panel.js");
const Video = require("./flow-view-video.js");

test("nameTakesFocus: with the video paused the name of the step just marked takes the focus", () => {
  assert.equal(SP.nameTakesFocus({ playing: false, readOnly: false }), true);
  assert.equal(SP.nameTakesFocus({}), true, "no video playing (a right-click, + Step while paused)");
});

test("nameTakesFocus: while the video plays nothing takes the focus, so the next S marks the next step", () => {
  assert.equal(SP.nameTakesFocus({ playing: true, readOnly: false }), false);
  assert.equal(SP.nameTakesFocus({ playing: true }), false);
});

test("nameTakesFocus: never in a project open read only", () => {
  assert.equal(SP.nameTakesFocus({ playing: false, readOnly: true }), false);
});

test("headEditable: the panel's head is fields on the Map only, and never read only", () => {
  assert.equal(SP.headEditable("flow", false), false, "lane PANE: the panel no longer opens on the Timeline");
  assert.equal(SP.headEditable("map", false), true);
  assert.equal(SP.headEditable("steps", false), false, "on Steps the editor beside it is where the step is written");
  assert.equal(SP.headEditable("overview", false), false);
  assert.equal(SP.headEditable("flow", true), false);
  assert.equal(SP.headEditable("map", true), false);
});

test("lane PANE: the panel opens on the Map and on Steps, never on the Timeline or the Overview", () => {
  assert.equal(SP.opensOn("map"), true);
  assert.equal(SP.opensOn("steps"), true);
  assert.equal(SP.opensOn("flow"), false, "a step opens in the pane beside the video there");
  assert.equal(SP.opensOn("overview"), false);
});

test("the head's fields have ids of their own, never the editor's", () => {
  const ids = Object.values(SP.HEAD_IDS);
  for (const own of ["step-name", "step-system", "step-desc", "step-activity-list", "step-system-list", "step-lib-note"]) {
    assert.ok(!ids.includes(own), own + " is the editor's");
  }
});

test("isPlaying: a video in the player, not paused and not at its end, is playing; paused, ended or none is not", () => {
  fakeVideo = { src: "file:///v.webm", paused: false, ended: false };
  assert.equal(Video.isPlaying(), true);
  fakeVideo = { src: "file:///v.webm", paused: true, ended: false };
  assert.equal(Video.isPlaying(), false);
  fakeVideo = { src: "file:///v.webm", paused: false, ended: true };
  assert.equal(Video.isPlaying(), false);
  fakeVideo = { src: "", paused: false, ended: false };
  assert.equal(Video.isPlaying(), false, "no video in the player");
  fakeVideo = null;
});
