"use strict";
// A hand-off opened read only (lane HV, contract C20): no write path is
// allowed. The renderer's one annotations.json write path refuses it without
// reaching the main process; the main process refuses every write into a
// folder under <userData>/handoffs, in every handler that writes a project
// folder or runs the analysis (checked on main.js's own source, so a new
// write handler without the guard fails here); the save state says "Read
// only" and no report changes it; the step pane's and the document's fields
// are made read only. And the hand-off's own take-back (session.js
// takeBackLastEdit). The real viewer on a real hand-off, writing nothing to
// disk, is in e2e/handoff-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Ipc = require("./ipc.js");
const Dom = require("./dom.js");
const toasts = [];
Dom.toast = (msg, kind) => { toasts.push({ msg, kind }); };
let saves = 0;
Ipc.saveAnnotations = async () => { saves += 1; return { ok: true }; };

const State = require("./state.js");
const Session = require("./session.js");
const SaveState = require("./save-state.js");
const RO = require("./read-only.js");

function load(folder, readOnly, annotations) {
  State.setSession({ sessionFolder: folder, manifest: { session_id: folder }, readOnly,
    annotations: annotations || { steps: [{ step_id: "a", name: "Log in", state: "confirmed" }] } });
  State.resetUndo();
  Session.captureBaseline();
}

test("the renderer never writes a hand-off opened read only: refused before the main process, no undo entry", async () => {
  load("H", true);
  saves = 0;
  toasts.length = 0;
  const anno = Session.ensureAnnoShape(State.getSession().annotations);
  anno.steps[0].name = "Changed";
  await assert.rejects(Session.saveAnnotationsWithUndo(anno, "rename step"), (e) => e.pdtSurfaced === true);
  await assert.rejects(Session.saveAnnotationsDirect(anno, "open a transaction"), (e) => e.pdtSurfaced === true);
  await assert.rejects(Session.writeAnnotations("H", anno, "edit"), (e) => e.pdtSurfaced === true);
  assert.equal(saves, 0, "Ipc.saveAnnotations was never called");
  assert.equal(State.canUndo("H"), false, "nothing to undo");
  assert.ok(toasts.length && toasts.every((t) => t.kind === "error" && /read only/.test(t.msg)));
  // The same session opened for work writes as always.
  load("W", false);
  await Session.saveAnnotationsWithUndo(Session.ensureAnnoShape(State.getSession().annotations), "edit");
  assert.equal(saves, 1);
  assert.equal(State.canUndo("W"), true);
});

test("every main-process handler that writes a project folder, or runs the analysis, refuses a read-only folder first", () => {
  const src = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const handlers = [...src.matchAll(/ipcMain\.handle\("(viewer:[A-Za-z]+)"/g)].map((m) => ({ name: m[1], at: m.index }));
  const body = (i) => src.slice(handlers[i].at, i + 1 < handlers.length ? handlers[i + 1].at : src.length);
  // What writes a project folder: the save state's report of a write, the
  // analysis, a zip beside the folder, a video copy.
  const WRITES = /_projectWrite\(|runNormalize\(|zipProject\(|writeHandoffZip\(|copyFile\(|attachExternalVideo/;
  const writers = handlers.map((h, i) => ({ name: h.name, text: body(i) })).filter((h) => WRITES.test(h.text));
  const names = writers.map((h) => h.name).sort();
  for (const expected of ["viewer:saveAnnotations", "viewer:restoreAnnotationsBackup", "viewer:copyVideoIn",
    "viewer:attachExternalVideo", "viewer:importTranscript", "viewer:removeTranscript", "viewer:restoreTranscript",
    "viewer:saveTranscriptSync", "viewer:addScreenshot", "viewer:addAttachment", "viewer:runNormalizeExtended",
    "viewer:exportProjectZip", "viewer:exportHandoffZip"]) {
    assert.ok(names.includes(expected), expected + " is found as a writer");
  }
  for (const h of writers) {
    const guard = h.text.indexOf("_refuseReadOnly(");
    assert.ok(guard > 0, h.name + " refuses a hand-off opened read only");
    const first = h.text.search(/_projectWrite\(|runNormalize\(|dialog\.show|zipProject\(|writeHandoffZip\(|AnnoStore\.write/);
    assert.ok(first === -1 || guard < first, h.name + " refuses before it asks, reports or writes anything");
  }
  // The rule itself: a folder under <userData>/handoffs, or a hand-off
  // unzipped by hand (handoff-open.js isReadOnlyProject), for the refusal and
  // for the loaded session's readOnly alike.
  assert.equal((src.match(/HandoffOpen\.isReadOnlyProject\(_userData\(\), root\)/g) || []).length, 2);
});

test("the save state of a hand-off opened read only reads Read only, with its version, and no report changes it", () => {
  const entry = { version: 2, handed_off_at: "2026-09-25T10:00:00Z", by: "rasha", note: "x" };
  const el = { textContent: "", title: "", dataset: {}, classList: { remove() {}, add() {} }, offsetWidth: 0 };
  SaveState.mount(el, { subscribe: null });
  SaveState.projectOpened({ sessionFolder: "D:\\h\\p", readOnly: true, annotations: { handoffs: [entry] } });
  assert.equal(el.textContent, "Read only");
  assert.equal(el.dataset.state, "readonly");
  assert.match(el.title, /^Version 2, handed off 2026-09-25 by rasha, opened read only: nothing here can change/);
  SaveState.noteWrite({ folder: "D:\\h\\p", channel: "annotations", phase: "end", ok: false, error: "x" });
  assert.equal(el.textContent, "Read only");
  // A project the analyst works on is saved as always.
  SaveState.projectOpened({ sessionFolder: "D:\\w\\p", annotations: {} });
  assert.equal(el.textContent, "Saved");
});

test("lockInputs makes a pane's fields read only and leaves the transcript's filters usable", () => {
  const el = (tagName, type, cls) => ({ tagName, readOnly: false, disabled: false,
    getAttribute: (k) => (k === "type" ? type : null), matches: (sel) => !!cls && sel === "." + cls });
  const fields = [el("INPUT", "text"), el("TEXTAREA", null), el("SELECT", null), el("INPUT", "checkbox"),
    el("INPUT", "search", "ov-tr-search"), el("SELECT", null, "ov-tr-speaker")];
  RO.lockInputs({ querySelectorAll: () => fields });
  assert.deepEqual(fields.map((f) => [f.readOnly, f.disabled]), [
    [true, false], [true, false], [false, true], [false, true], [false, false], [false, false]]);
  RO.lockInputs(null);   // nothing to lock, nothing thrown
  assert.equal(RO.isReadOnly({ readOnly: true }), true);
  assert.equal(RO.isReadOnly({ readOnly: "yes" }), false);
  assert.equal(RO.isReadOnly(null), false);
});

test("a hand-off that did not finish takes its version entry back, only while it is still the last edit", async () => {
  load("T", false, { steps: [], handoffs: [] });
  saves = 0;
  const anno = Session.ensureAnnoShape(State.getSession().annotations);
  anno.handoffs = [{ version: 1, handed_off_at: "t1", by: "r", note: "n" }];
  await Session.saveAnnotationsWithUndo(anno, "Hand off version 1 (the zip file stays)", { tag: "handoff:t1" });
  assert.equal(await Session.takeBackLastEdit("handoff:other"), false, "another tag is not taken back");
  assert.equal(State.canUndo("T"), true, "and its entry stays");
  assert.equal(await Session.takeBackLastEdit("handoff:t1"), true);
  assert.deepEqual(State.getSession().annotations.handoffs, [], "the entry is gone");
  assert.equal(State.canUndo("T"), false, "no undo entry is left");
  assert.equal(State.canRedo("T"), false, "and no redo: the hand-off never happened");
  // An edit after the hand-off: it is not the last edit, so it is not taken back.
  const a2 = Session.ensureAnnoShape(State.getSession().annotations);
  a2.handoffs = [{ version: 1, handed_off_at: "t2", by: "r", note: "n" }];
  await Session.saveAnnotationsWithUndo(a2, "Hand off version 1", { tag: "handoff:t2" });
  a2.document = { title: "Later" };
  await Session.saveAnnotationsWithUndo(a2, "edit document field Title");
  assert.equal(await Session.takeBackLastEdit("handoff:t2"), false);
  assert.equal(State.getSession().annotations.handoffs.length, 1);
});
