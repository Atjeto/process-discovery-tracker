"use strict";

const test = require("node:test");
const assert = require("node:assert");
const G = require("../capture-guidance.js");

test("formatHotkey: Control+Shift+S -> Ctrl+Shift+S", () => {
  assert.equal(G.formatHotkey("Control+Shift+S"), "Ctrl+Shift+S");
});

test("formatHotkey: CommandOrControl folds to Ctrl", () => {
  assert.equal(G.formatHotkey("CommandOrControl+Shift+M"), "Ctrl+Shift+M");
});

test("formatHotkey: empty/absent -> empty string", () => {
  assert.equal(G.formatHotkey(""), "");
  assert.equal(G.formatHotkey(null), "");
  assert.equal(G.formatHotkey(undefined), "");
});

test("guidanceState: not tracking -> not-recording", () => {
  assert.equal(G.guidanceState({ tracking: false }), "not-recording");
  assert.equal(G.guidanceState({}), "not-recording");
  assert.equal(G.guidanceState(null), "not-recording");
});

test("guidanceState: tracking + not paused -> recording", () => {
  assert.equal(G.guidanceState({ tracking: true, paused: false }), "recording");
});

test("guidanceState: tracking + paused -> paused", () => {
  assert.equal(G.guidanceState({ tracking: true, paused: true }), "paused");
});

test("guidanceLine: not-recording is the requested copy", () => {
  const line = G.guidanceLine({ state: "not-recording" });
  assert.equal(line, "Not recording — start capture when the worker begins.");
});

test("guidanceLine: recording names the REAL marker hotkey from config", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "Control+Shift+S" });
  assert.match(line, /^Recording — fire a marker when a new case starts/);
  assert.match(line, /\(Ctrl\+Shift\+S\)/);   // the real key, not hardcoded
});

test("guidanceLine: a different configured hotkey is reflected verbatim", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "Control+Alt+M" });
  assert.match(line, /\(Ctrl\+Alt\+M\)/);
});

test("guidanceLine: recording with no configured hotkey omits the key phrase cleanly", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "" });
  assert.equal(line, "Recording — fire a marker when a new case starts.");
  assert.ok(!/\(\)/.test(line));   // no empty parens
});

test("guidanceLine: paused state has its own analogous guidance", () => {
  const line = G.guidanceLine({ state: "paused" });
  assert.match(line, /^Paused/);
});

test("guidanceLine: derives the state from a raw status snapshot when state is absent", () => {
  assert.equal(
    G.guidanceLine({ status: { tracking: false }, hotkey: "Control+Shift+S" }),
    "Not recording — start capture when the worker begins.");
  assert.match(
    G.guidanceLine({ status: { tracking: true, paused: false }, hotkey: "Control+Shift+S" }),
    /^Recording/);
  assert.match(
    G.guidanceLine({ status: { tracking: true, paused: true } }),
    /^Paused/);
});
