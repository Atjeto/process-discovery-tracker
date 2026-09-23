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
Ipc.saveAnnotations = async () => ({ ok: true });

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
