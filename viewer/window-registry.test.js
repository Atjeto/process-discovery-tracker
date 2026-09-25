"use strict";
// Several windows (lane MW): the rule that keeps one project open for
// editing in one window only (window-registry.js), the --session of a second
// start of the viewer (main.js sessionArg), and main.js's handlers refusing
// the writes of a window that shows its project read only (checked on
// main.js's own source, so a new write handler without it fails here). The
// real viewer with several windows is in e2e/windows-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRegistry, folderKey } = require("./window-registry.js");
const { sessionArg } = require("./main.js");

const A = "D:\\work\\Order entry";
const B = "D:\\work\\Invoices";

test("a project opens for editing in one window; another window gets it read only, told why", () => {
  const r = createRegistry();
  assert.deepEqual(r.open(1, A, false), { readOnly: false, elsewhere: false });
  assert.deepEqual(r.open(2, B, false), { readOnly: false, elsewhere: false }, "another project: both edit");
  assert.deepEqual(r.open(3, A, false), { readOnly: true, elsewhere: true });
  assert.equal(r.readOnlyHere(3, A), true, "main refuses window 3's writes into A");
  assert.equal(r.readOnlyHere(1, A), false, "and never window 1's");
  assert.equal(r.readOnlyHere(3, B), false, "only for the project it shows");
  assert.equal(r.editorOf(A), 1);
  assert.equal(r.editorOf(B), 2);
  assert.equal(r.size(), 3);
});

test("a folder is one project whatever its case, slashes or trailing slash", () => {
  const r = createRegistry();
  r.open(1, A, false);
  assert.equal(r.open(2, "d:/WORK/order entry/", false).elsewhere, true);
  assert.equal(folderKey("D:\\work\\Order entry\\"), folderKey("d:/work/order entry"));
});

test("the window that edits a project opens it again for editing (a reload after an analysis)", () => {
  const r = createRegistry();
  r.open(1, A, false);
  assert.deepEqual(r.open(1, A, false), { readOnly: false, elsewhere: false });
  assert.equal(r.editorOf(A), 1);
});

test("closing the editing window, or opening another project in it, lets the project go", () => {
  const r = createRegistry();
  r.open(1, A, false);
  r.open(2, A, false);                       // read only here
  r.close(1);
  assert.equal(r.editorOf(A), null, "nobody edits A once window 1 closed");
  assert.equal(r.readOnlyHere(2, A), true, "the window opened read only stays read only");
  assert.deepEqual(r.open(3, A, false), { readOnly: false, elsewhere: false }, "a read-only window holds nothing");
  r.open(3, B, false);                       // window 3 switches to B
  assert.equal(r.editorOf(A), null);
  assert.deepEqual(r.open(4, A, false), { readOnly: false, elsewhere: false });
  r.close(2); r.close(3); r.close(4);
  assert.equal(r.size(), 0, "nothing is held after the windows closed");
  r.close(99);                               // a window that held nothing
  assert.equal(r.size(), 0);
});

test("a hand-off opens read only in every window and never counts as open for editing", () => {
  const r = createRegistry();
  const H = "C:\\Users\\a\\AppData\\Roaming\\pdt\\handoffs\\Order entry v2\\order-entry";
  assert.deepEqual(r.open(1, H, true), { readOnly: true, elsewhere: false });
  assert.deepEqual(r.open(2, H, true), { readOnly: true, elsewhere: false });
  assert.equal(r.editorOf(H), null);
  assert.equal(r.readOnlyHere(1, H), false, "a hand-off is refused by its own rule (handoff-open.js), not this one");
});

test("sessionArg: the --session of a command line, resolved in the folder it started in, only when it is a project", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-session-arg-"));
  try {
    const proj = path.join(base, "proj");
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, "manifest.json"), "{}");
    fs.mkdirSync(path.join(base, "empty"));
    assert.equal(sessionArg(["viewer.exe", "--session=" + proj], "C:\\"), proj);
    assert.equal(sessionArg(["viewer.exe", "--allow-file-access", "--session=proj"], base), proj, "relative to its folder");
    assert.equal(sessionArg(["viewer.exe", "--session=empty"], base), null, "a folder without manifest.json");
    assert.equal(sessionArg(["viewer.exe", "--session=file:///C:/x"], base), null);
    assert.equal(sessionArg(["viewer.exe", "."], base), null, "no --session");
    assert.equal(sessionArg(null, base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("every main-process handler that writes a project folder refuses a window that shows it read only", () => {
  const src = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const handlers = [...src.matchAll(/ipcMain\.handle\("(viewer:[A-Za-z]+)"/g)].map((m) => ({ name: m[1], at: m.index }));
  const body = (i) => src.slice(handlers[i].at, i + 1 < handlers.length ? handlers[i + 1].at : src.length);
  // The same writers read-only.test.js finds: a write report, the analysis,
  // a zip beside the folder, a video copy.
  const WRITES = /_projectWrite\(|runNormalize\(|zipProject\(|writeHandoffZip\(|copyFile\(|attachExternalVideo/;
  const writers = handlers.map((h, i) => ({ name: h.name, text: body(i) })).filter((h) => WRITES.test(h.text));
  assert.ok(writers.length >= 13, "the writers are found (" + writers.length + ")");
  for (const h of writers) {
    const calls = [...h.text.matchAll(/_refuseReadOnly\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(calls.length && calls.every((args) => /,\s*(_e\.sender|sender)\s*$/.test(args)),
      h.name + " refuses with the window that asked (" + calls.join(" | ") + ")");
  }
  // A write report goes to the window that wrote, never to one window kept aside.
  assert.equal(/\bmainWindow\b/.test(src), false, "no single main window is left in main.js");
  const reports = [...src.matchAll(/(?<!function )_projectWrite\(([^,)]*),/g)].map((m) => m[1].trim());
  assert.ok(reports.length > 0 && reports.every((a) => a === "_e.sender"), reports.join(" | "));
});
