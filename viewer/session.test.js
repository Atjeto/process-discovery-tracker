"use strict";
/*
 * Regression test for the undo baseline (session.js).
 *
 * The bug: edit handlers (steps-view) call
 * ensureAnnoShape(session.annotations) -- which returns the LIVE object -- and
 * mutate it in place before calling persistAnnotations. So by the time
 * saveAnnotationsWithUndo ran, session.annotations was ALREADY the post-edit
 * state; snapshotting it there pushed the NEW state onto the undo stack, making
 * Ctrl+Z a no-op and leaving the pristine loaded state unrecoverable. The fix
 * records the pre-edit state from _baseline (captureBaseline on load) instead.
 *
 * This had zero coverage before -- state.test.js exercises the stack mechanics
 * with hand-built entries, never the live mutate-then-snapshot path.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

/* ipc.js does `require("electron")`, which in plain node yields a path string,
   so ipcRenderer is undefined but nothing calls it at load. Stub the single IPC
   session.js invokes. session.js calls `Ipc.saveAnnotations(...)` by property
   access on the shared module object, so this reassignment is seen by it. */
const Ipc = require("./ipc.js");
const SAVE_OK = async () => ({ ok: true });
Ipc.saveAnnotations = SAVE_OK;

/* dom.js's toast needs a document; session.js calls it as Dom.toast, so a
   capture stub stands in (the failure tests read what the analyst saw). */
const Dom = require("./dom.js");
const toasts = [];
Dom.toast = (msg, kind) => { toasts.push({ msg, kind }); };

const State = require("./state.js");
const Session = require("./session.js");

function loadFakeSession(folder, steps) {
  State.setSession({
    sessionFolder: folder,
    manifest: { session_id: folder },
    annotations: { steps, phases: [] },
  });
  State.resetUndo();
  Session.captureBaseline();   // the load hook (loadSessionIntoView calls this)
}

/* Mimic an edit handler: ensureAnnoShape hands back the live object, the
   handler mutates it in place, then persists. */
async function editStepNameInPlace(newName, label) {
  const anno = Session.ensureAnnoShape(State.getSession().annotations);
  anno.steps[0].name = newName;
  await Session.saveAnnotationsWithUndo(anno, label);
}

test("saveAnnotationsWithUndo records the PRE-edit state (undo is not a no-op)", async () => {
  loadFakeSession("S", [{ step_id: "a", name: "orig", state: "edited" }]);
  await editStepNameInPlace("edited-name", "rename step");

  const popped = State.popUndo("S");
  assert.ok(popped, "an undo entry was recorded");
  assert.equal(popped.annotations.steps[0].name, "orig",
    "undo snapshot must be the pre-edit name, not the edited one");
});

test("each edit records the prior state; the pristine loaded state stays reachable", async () => {
  loadFakeSession("S2", [{ step_id: "a", name: "v0" }]);
  await editStepNameInPlace("v1", "edit 1");
  await editStepNameInPlace("v2", "edit 2");

  // Undo stack top -> bottom: [pre-edit2 = v1, pre-edit1 = v0].
  const top = State.popUndo("S2");
  assert.equal(top.annotations.steps[0].name, "v1", "most recent undo -> state before edit 2");
  const next = State.popUndo("S2");
  assert.equal(next.annotations.steps[0].name, "v0", "next undo -> the pristine loaded state");
});

/* ---- RP-04: a failed save is surfaced and never recorded as done --------- */

test("a failed save is shown to the analyst, rejects, and records no undo entry", async () => {
  loadFakeSession("F1", [{ step_id: "a", name: "orig" }]);
  toasts.length = 0;
  Ipc.saveAnnotations = async () => ({ ok: false, error: "EPERM: operation not permitted, rename" });
  try {
    await assert.rejects(editStepNameInPlace("lost?", "rename step"),
      (e) => e.pdtSurfaced === true && /rename step/.test(e.message) && /EPERM/.test(e.message));
  } finally {
    Ipc.saveAnnotations = SAVE_OK;
  }
  const shown = toasts[toasts.length - 1];
  assert.ok(shown && shown.kind === "error", "an error toast was shown");
  assert.match(shown.msg, /was not saved: EPERM: operation not permitted/);
  assert.equal(State.canUndo("F1"), false, "an unsaved edit must not become undoable");
  assert.equal(State.getSession().annotations.steps[0].name, "lost?",
    "the edit stays in memory (and on screen), so the next save still writes it");
});

test("the undo baseline does not advance on a failed save", async () => {
  loadFakeSession("F2", [{ step_id: "a", name: "orig" }]);
  Ipc.saveAnnotations = async () => ({ ok: false, error: "ENOSPC: no space left on device" });
  await assert.rejects(editStepNameInPlace("v1", "edit 1"));
  const written = [];
  Ipc.saveAnnotations = async (p) => { written.push(JSON.parse(JSON.stringify(p.annotations))); return { ok: true }; };
  try {
    await editStepNameInPlace("v2", "edit 2");
  } finally {
    Ipc.saveAnnotations = SAVE_OK;
  }
  assert.equal(written[0].steps[0].name, "v2", "the successful save writes the in-memory state");
  const top = State.popUndo("F2");
  assert.equal(top.annotations.steps[0].name, "orig",
    "undo returns to the last state that was on disk, not the unsaved v1");
  assert.equal(State.popUndo("F2"), null, "exactly one undo entry: the failed save recorded none");
});

test("a main process that throws instead of answering is surfaced the same way", async () => {
  loadFakeSession("F3", [{ step_id: "a", name: "orig" }]);
  toasts.length = 0;
  Ipc.saveAnnotations = async () => { throw new Error("Error invoking remote method 'viewer:saveAnnotations'"); };
  try {
    await assert.rejects(Session.persistAnnotations(State.getSession().annotations, "delete step"),
      (e) => e.pdtSurfaced === true);
  } finally {
    Ipc.saveAnnotations = SAVE_OK;
  }
  assert.equal(toasts[toasts.length - 1].kind, "error");
  assert.equal(State.canUndo("F3"), false);
});

test("an undo whose write fails puts the entry back and changes nothing", async () => {
  loadFakeSession("F4", [{ step_id: "a", name: "orig" }]);
  await editStepNameInPlace("edited", "rename step");
  assert.equal(State.canUndo("F4"), true);
  toasts.length = 0;
  Ipc.saveAnnotations = async () => ({ ok: false, error: "EBUSY: resource busy or locked" });
  try {
    await Session.performUndo();
  } finally {
    Ipc.saveAnnotations = SAVE_OK;
  }
  assert.equal(State.canUndo("F4"), true, "the undo entry is back on the stack");
  assert.equal(State.canRedo("F4"), false, "nothing was pushed to redo");
  assert.equal(State.getSession().annotations.steps[0].name, "edited", "the session was not reverted");
  assert.ok(toasts.some((t) => t.kind === "error" && /EBUSY/.test(t.msg)), "the failure was shown");
  // And with the disk back, the same undo now works.
  await Session.performUndo();
  assert.equal(State.getSession().annotations.steps[0].name, "orig");
});

test("saves run in call order: each undo entry holds the state the previous save committed", async () => {
  loadFakeSession("F5", [{ step_id: "a", name: "v0" }]);
  let calls = 0;
  Ipc.saveAnnotations = async () => {
    calls++;
    // The first write is slow, the second fast: without serialization the
    // second save would record its undo entry before the first committed.
    if (calls === 1) await new Promise((r) => setTimeout(r, 60));
    return { ok: true };
  };
  try {
    const anno = Session.ensureAnnoShape(State.getSession().annotations);
    anno.steps[0].name = "v1";
    const first = Session.saveAnnotationsWithUndo(anno, "edit 1");
    anno.steps[0].name = "v2";
    const second = Session.saveAnnotationsWithUndo(anno, "edit 2");
    await Promise.all([first, second]);
  } finally {
    Ipc.saveAnnotations = SAVE_OK;
  }
  assert.equal(State.popUndo("F5").annotations.steps[0].name, "v1", "edit 2's undo returns to edit 1's state");
  assert.equal(State.popUndo("F5").annotations.steps[0].name, "v0", "edit 1's undo returns to the loaded state");
});
test("a save still queued when another session opens leaves the new session's undo state alone", async () => {
  loadFakeSession("G1", [{ step_id: "a", name: "old" }]);
  let release;
  Ipc.saveAnnotations = () => new Promise((resolve) => { release = () => resolve({ ok: true }); });
  const anno = Session.ensureAnnoShape(State.getSession().annotations);
  anno.steps[0].name = "old-edited";
  const queued = Session.saveAnnotationsWithUndo(anno, "edit in G1");
  await new Promise((r) => setImmediate(r));          // the write is now in flight
  loadFakeSession("G2", [{ step_id: "b", name: "new" }]);
  release();
  await queued;
  Ipc.saveAnnotations = SAVE_OK;
  await editStepNameInPlace("new-edited", "edit in G2");
  const top = State.popUndo("G2");
  assert.equal(top.annotations.steps[0].name, "new", "G2's undo returns to G2's loaded state, not G1's edit");
});

/* ---- keys of cut features: not seeded, kept when present (C10) ----------- */

test("ensureAnnoShape seeds no key of a cut feature and keeps an older file's keys as they are", () => {
  State.setSession(null);
  const fresh = Session.ensureAnnoShape({ steps: [] });
  assert.ok(!("phases" in fresh), "phases is not seeded");
  assert.ok(!("drift_markers" in fresh), "drift_markers is not seeded");
  const older = {
    steps: [],
    phases: [{ phase_id: "p1", step_ids: ["s1"] }],
    drift_markers: [{ marker_id: "d1" }],
  };
  const kept = Session.ensureAnnoShape(JSON.parse(JSON.stringify(older)));
  assert.deepEqual(kept.phases, older.phases, "an existing phases key round-trips untouched");
  assert.deepEqual(kept.drift_markers, older.drift_markers, "an existing drift_markers key round-trips untouched");
});
