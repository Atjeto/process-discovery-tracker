"use strict";
/*
 * The activity library in the viewer (contract C21, library.js): where the
 * app's library is, reading a file (a missing or invalid one is an empty
 * library), the project's copy before the app's, the checks the pipeline
 * makes (normalization/library.py, mirrored), and what the step pane's
 * picker needs: the activities of a step's system, a pick, the code on the
 * fact line.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("./library.js");

const KEY_ORDER = "chrome|Salesforce - Order|Button:save-order";
const KEY_SEARCH = "chrome|Salesforce - Account lookup|Button:search";

/* A small valid library. */
function lib() {
  return {
    format: 1, version: "2026-09-25.1",
    applications: [
      { name: "Salesforce", activities: [
        { id: "sf-save-order", name: "Save the order", code: "SO-01", description: "Saves the sales order.", screens: [[KEY_ORDER]] },
        { id: "sf-find", name: "Find the customer", screens: [[KEY_SEARCH]] },
      ] },
      { name: "SAP", activities: [] },
      { name: "Phone", activities: [{ id: "call", name: "Call the customer", screens: [] }] },
    ],
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdt-library-test-"));
}

test("the app's library: PDT_LIBRARY when set, else library/activities.json beside the viewer's folder", () => {
  assert.equal(L.appLibraryPath({ PDT_LIBRARY: "  " + path.join("C:", "t", "lib.json") + " " }), path.resolve(path.join("C:", "t", "lib.json")));
  assert.equal(L.appLibraryPath({}), path.resolve(__dirname, "..", "library", "activities.json"));
  assert.equal(L.projectLibraryPath(path.join("D:", "p")), path.join("D:", "p", "library.json"));
});

test("readLibraryFile: a valid file reads as it is (texts trimmed); a missing one is empty and absent; one that is no JSON or fails a check is empty and says why", () => {
  const dir = tempDir();
  try {
    const good = path.join(dir, "good.json");
    const doc = lib();
    doc.applications[0].activities[1].code = "  ";
    doc.applications[0].name = " Salesforce ";
    fs.writeFileSync(good, "﻿" + JSON.stringify(doc));
    const r = L.readLibraryFile(good);
    assert.equal(r.status, "ok");
    assert.equal(r.error, null);
    assert.equal(r.library.applications[0].name, "Salesforce");
    assert.deepEqual(r.library.applications[0].activities[1], { id: "sf-find", name: "Find the customer", screens: [[KEY_SEARCH]] },
      "an empty code is left out");
    const absent = L.readLibraryFile(path.join(dir, "none.json"));
    assert.equal(absent.status, "absent");
    assert.deepEqual(absent.library, L.emptyLibrary());
    fs.writeFileSync(path.join(dir, "bad.json"), "{ not json");
    const bad = L.readLibraryFile(path.join(dir, "bad.json"));
    assert.equal(bad.status, "invalid");
    assert.match(bad.error, /^it is not JSON/);
    assert.deepEqual(bad.library.applications, []);
    fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify({ format: 2, applications: [] }));
    const old = L.readLibraryFile(path.join(dir, "old.json"));
    assert.equal(old.status, "invalid");
    assert.equal(old.error, "it is not a format 1 activity library");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("projectLibrary: the project's library.json when it has one, even one that cannot be used; else the app's", () => {
  const dir = tempDir();
  try {
    const app = path.join(dir, "app.json");
    fs.writeFileSync(app, JSON.stringify(lib()));
    const project = path.join(dir, "project");
    fs.mkdirSync(project);
    const fromApp = L.projectLibrary(project, app);
    assert.deepEqual([fromApp.source, fromApp.status, fromApp.library.version], ["app", "ok", "2026-09-25.1"]);
    const own = lib();
    own.version = "1";
    fs.writeFileSync(path.join(project, "library.json"), JSON.stringify(own));
    const fromProject = L.projectLibrary(project, app);
    assert.deepEqual([fromProject.source, fromProject.status, fromProject.library.version], ["project", "ok", "1"],
      "a project keeps the library it started with");
    fs.writeFileSync(path.join(project, "library.json"), "[]");
    const broken = L.projectLibrary(project, app);
    assert.deepEqual([broken.source, broken.status, broken.library.applications.length], ["project", "invalid", 0],
      "a project's library that cannot be used is an empty one, never the app's");
    const none = L.projectLibrary(path.join(dir, "other"), path.join(dir, "missing.json"));
    assert.deepEqual([none.source, none.status], ["app", "absent"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("problems: the pipeline's checks, the first one failed", () => {
  const with_ = (edit) => { const d = lib(); edit(d); return L.problems(d); };
  assert.deepEqual(L.problems(lib()), []);
  assert.deepEqual(L.problems(null), ["it is not a format 1 activity library"]);
  assert.deepEqual(with_((d) => { d.format = 2; }), ["it is not a format 1 activity library"]);
  assert.deepEqual(with_((d) => { d.applications = {}; }), ["its applications are not a list"]);
  assert.deepEqual(with_((d) => { d.applications[1].name = " "; }), ["application 2 has no name"]);
  assert.deepEqual(with_((d) => { d.applications[1].activities = "x"; }), ["the activities of SAP are not a list"]);
  assert.deepEqual(with_((d) => { delete d.applications[0].activities[1].id; }), ["activity 2 of Salesforce has no id or no name"]);
  assert.deepEqual(with_((d) => { d.applications[2].activities[0].id = "sf-find"; }), ["the activity id \"sf-find\" is used twice"]);
  assert.deepEqual(with_((d) => { d.applications[0].activities[1].name = "Save the order"; }), ["the name \"Save the order\" is used twice in Salesforce"]);
  assert.deepEqual(with_((d) => { d.applications[0].activities[1].code = 7; }), ["the code of the activity \"sf-find\" is not a text"]);
  assert.deepEqual(with_((d) => { d.applications[0].activities[1].screens = [[]]; }), ["the screens of the activity \"sf-find\" are not runs of draft keys"]);
  assert.deepEqual(with_((d) => { d.applications[0].activities[1].screens = [[KEY_ORDER, KEY_ORDER]]; }),
    ["one run of screens belongs to the activities \"sf-save-order\" and \"sf-find\""], "a repeat counts once");
  // What the pipeline allows: no version, no activities, no screens, the same
  // name in two applications, a null code, an application named twice.
  assert.deepEqual(with_((d) => { delete d.version; delete d.applications[1].activities; delete d.applications[2].activities[0].screens; }), []);
  assert.deepEqual(with_((d) => { d.applications[2].activities[0].name = "Save the order"; d.applications[2].activities[0].code = null; }), []);
  assert.deepEqual(with_((d) => { d.version = 3; }), []);
});

test("look-ups: an application by its system (case does not matter), an activity by id or by name, the code of a step named from the library", () => {
  const l = lib();
  assert.equal(L.applicationNamed(l, "salesforce").name, "Salesforce");
  assert.equal(L.applicationNamed(l, ""), null);
  assert.equal(L.findActivity(l, "call").application.name, "Phone");
  assert.equal(L.findActivity(l, "nope"), null);
  assert.equal(L.activityNamed(l, "Salesforce", " save THE order ").activity.id, "sf-save-order");
  assert.equal(L.activityNamed(l, "SAP", "Save the order"), null, "only the activities of the step's system");
  assert.equal(L.codeOf(l, { library_activity: "sf-save-order" }), "SO-01");
  assert.equal(L.codeOf(l, { library_activity: "sf-find" }), "", "an activity without a code");
  assert.equal(L.codeOf(l, { library_activity: "gone" }), "", "an activity the library does not have");
  assert.equal(L.codeOf(l, {}), "");
  assert.deepEqual(L.counts(l), { applications: 3, activities: 3 });
});

test("summaryLine: Help's line on the app's library", () => {
  const empty = { format: 1, version: "1", applications: Array.from({ length: 9 }, (_, i) => ({ name: "App " + i, activities: [] })) };
  assert.equal(L.summaryLine({ status: "ok", library: empty }), "Library 1: 9 applications, 0 activities");
  assert.equal(L.summaryLine({ status: "ok", library: lib() }), "Library 2026-09-25.1: 3 applications, 3 activities");
  assert.equal(L.summaryLine({ status: "ok", library: { version: "", applications: [{ name: "A", activities: [{ id: "a", name: "A" }] }] } }),
    "Library (no version): 1 application, 1 activity");
  assert.equal(L.summaryLine({ status: "absent" }), "Library: not found");
  assert.equal(L.summaryLine({ status: "invalid", error: "x" }), "Library: cannot be read");
  assert.equal(L.summaryLine(null), "Library: cannot be read");
});

test("pickerFor: the activities of the step's system, the one it is named from, and the one quiet line when there are none", () => {
  const l = lib();
  const p = L.pickerFor(l, "salesforce", { library_activity: "sf-find" });
  assert.equal(p.system, "Salesforce");
  assert.deepEqual(p.activities.map((a) => [a.id, a.name, a.code, a.description]), [
    ["sf-save-order", "Save the order", "SO-01", "Saves the sales order."], ["sf-find", "Find the customer", "", ""]]);
  assert.equal(p.current, "sf-find");
  assert.equal(p.note, "");
  assert.equal(L.pickerFor(l, "Salesforce", { library_activity: "call" }).current, null, "an activity of another system is not this one's");
  const none = L.pickerFor(l, "SAP", {});
  assert.deepEqual([none.activities.length, none.note], [0, "The library has no activities for SAP."]);
  const other = L.pickerFor(l, "Teams", {});
  assert.deepEqual([other.system, other.note], ["Teams", "The library has no activities for Teams."]);
  const byHand = L.pickerFor(l, "", { state: "manually_authored" });
  assert.deepEqual([byHand.activities.length, byHand.note], [0, "Set the system first: the library lists activities by system."]);
  assert.equal(L.pickerFor(L.emptyLibrary(), "Salesforce", {}).note, "The library has no activities for Salesforce.");
});

test("filterActivities: the activities whose name or code holds the text typed; all of them for none", () => {
  const acts = L.pickerFor(lib(), "Salesforce", {}).activities;
  assert.deepEqual(L.filterActivities(acts, "").map((a) => a.id), ["sf-save-order", "sf-find"]);
  assert.deepEqual(L.filterActivities(acts, "CUSTOMER").map((a) => a.id), ["sf-find"]);
  assert.deepEqual(L.filterActivities(acts, "so-0").map((a) => a.id), ["sf-save-order"], "by code");
  assert.deepEqual(L.filterActivities(acts, "nothing like it"), []);
  assert.deepEqual(L.filterActivities(null, "x"), []);
});

test("applyActivity: a pick sets the name, the system and library_activity, the description only when the step has none, and leaves the screens as they are", () => {
  const l = lib();
  const found = L.findActivity(l, "sf-save-order");
  const draft = { name: "Salesforce - Order: Save order", draft_key: KEY_ORDER, description: "entered 29 into Quantity; clicked Save order", state: "auto_suggested" };
  L.applyActivity(draft, found, { descriptionEmpty: true });
  assert.deepEqual([draft.name, draft.system, draft.library_activity, draft.description, draft.draft_key],
    ["Save the order", "Salesforce", "sf-save-order", "Saves the sales order.", KEY_ORDER]);
  const written = { name: "x", draft_keys: [KEY_ORDER, KEY_SEARCH], description: "What the analyst wrote." };
  L.applyActivity(written, found, { descriptionEmpty: false });
  assert.equal(written.description, "What the analyst wrote.");
  assert.deepEqual(written.draft_keys, [KEY_ORDER, KEY_SEARCH]);
  const plain = { name: "y", description: "" };
  L.applyActivity(plain, L.findActivity(l, "sf-find"), { descriptionEmpty: true });
  assert.equal(plain.description, "", "an activity without a description leaves the step's as it is");
  assert.equal(L.applyActivity(plain, null), plain);
});
