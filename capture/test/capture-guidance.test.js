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

test("guidanceLine: not-recording without a hotkey is the plain copy", () => {
  const line = G.guidanceLine({ state: "not-recording" });
  assert.equal(line, "Not recording: start recording, then start your first run.");
});

test("guidanceLine: not-recording names the run hotkey (it also starts recording)", () => {
  const line = G.guidanceLine({ state: "not-recording", hotkey: "Control+Shift+S" });
  assert.equal(line, "Not recording: press Ctrl+Shift+S to start recording and your first run.");
});

test("guidanceLine: recording names the REAL run hotkey from config", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "Control+Shift+S" });
  assert.equal(line, "Recording: press Ctrl+Shift+S at the start of each run.");   // the real key, not hardcoded
});

test("guidanceLine: a different configured hotkey is reflected verbatim", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "Control+Alt+M" });
  assert.match(line, /press Ctrl\+Alt\+M /);
});

test("guidanceLine: recording with no configured hotkey points at the panel button", () => {
  const line = G.guidanceLine({ state: "recording", hotkey: "" });
  assert.equal(line, "Recording: press Start next run at the start of each run.");
  assert.ok(!/\(\)/.test(line));   // no empty parens
});

test("guidanceLine: worker-facing copy speaks of runs, never markers or cases", () => {
  for (const state of ["not-recording", "recording", "paused"]) {
    for (const hotkey of ["Control+Shift+S", ""]) {
      const line = G.guidanceLine({ state, hotkey });
      assert.ok(!/marker|\bcases?\b/i.test(line), `${state}/${hotkey || "no key"}: ${line}`);
    }
  }
});

test("guidanceLine: paused state has its own analogous guidance", () => {
  const line = G.guidanceLine({ state: "paused" });
  assert.match(line, /^Paused/);
});

test("guidanceLine: derives the state from a raw status snapshot when state is absent", () => {
  assert.equal(
    G.guidanceLine({ status: { tracking: false }, hotkey: "Control+Shift+S" }),
    "Not recording: press Ctrl+Shift+S to start recording and your first run.");
  assert.match(
    G.guidanceLine({ status: { tracking: true, paused: false }, hotkey: "Control+Shift+S" }),
    /^Recording/);
  assert.match(
    G.guidanceLine({ status: { tracking: true, paused: true } }),
    /^Paused/);
});
