"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const AA = require("./auto-apply.js");

const REC = { events: [{ type: "marker" }], annotations: {} };   // a recording
const VIDEO = { events: [], manifest: { source: "video" }, annotations: {} };

test("appliesItself: every project open for editing applies its changes itself, a recording too (D4)", () => {
  assert.equal(AA.appliesItself(REC, false), true, "a recording");
  assert.equal(AA.appliesItself(VIDEO, false), true, "a project made from a video");
  assert.equal(AA.appliesItself(REC, true), false, "a hand-off or a project open in another window: read only");
  assert.equal(AA.appliesItself(Object.assign({}, REC, { annotationsError: { message: "x" } }), false), false,
    "annotations.json cannot be read");
  assert.equal(AA.appliesItself(null, false), false);
});

test("runDue: a change waits and nothing holds it back; a cancelled or failed run holds it until the next change", () => {
  // The positive control: a recording with one change waiting is due.
  assert.equal(AA.runDue({ applies: true, pending: 1, stale: false, held: false }), true);
  assert.equal(AA.runDue({ applies: true, pending: 0, stale: true, held: false }), true, "an undone change the analysis had used");
  assert.equal(AA.runDue({ applies: true, pending: 0, stale: false, held: false }), false, "nothing waits");
  assert.equal(AA.runDue({ applies: true, pending: 2, stale: false, held: true }), false, "the last run was cancelled or failed");
  assert.equal(AA.runDue({ applies: false, pending: 2, stale: false, held: false }), false, "read only");
  assert.equal(AA.runDue(null), false);
});

test("updateShows: Update the steps shows only while changes wait after a cancelled or failed run, never during a run", () => {
  // The positive control.
  assert.equal(AA.updateShows({ applies: true, pending: 1, held: true, running: false }), true);
  assert.equal(AA.updateShows({ applies: true, pending: 0, stale: true, held: true, running: false }), true);
  assert.equal(AA.updateShows({ applies: true, pending: 1, held: false, running: false }), false,
    "a change waiting for its run a moment later shows no button");
  assert.equal(AA.updateShows({ applies: true, pending: 1, held: true, running: true }), false, "the status line shows instead");
  assert.equal(AA.updateShows({ applies: true, pending: 0, held: true, running: false }), false, "nothing waits");
  assert.equal(AA.updateShows({ applies: false, pending: 1, held: true, running: false }), false, "read only");
  assert.equal(AA.UPDATE_LABEL, "Update the steps");
  assert.equal(AA.UPDATE_TITLE, "Updates the transactions, their steps and the map with your latest changes.");
});

test("holdAfter: a cancel or a failure holds the changes, a run stopped for a save or one that worked does not", () => {
  assert.equal(AA.holdAfter({ ok: false, cancelled: true }, false), true, "the analyst clicked Cancel");
  assert.equal(AA.holdAfter({ ok: false, error: "x" }, false), true, "it failed");
  assert.equal(AA.holdAfter({ ok: false, cancelled: true }, true), false, "it gave way to a save and runs again after it");
  assert.equal(AA.holdAfter({ ok: true }, false), false, "it worked");
  assert.equal(AA.holdAfter(null, false), true, "no answer is a failure");
});
