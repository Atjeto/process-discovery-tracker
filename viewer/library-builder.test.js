"use strict";
/*
 * The Library builder's model (contract C21, library-builder.js): the steps
 * the analysts named in the projects, one row per name in a system with its
 * screens and where it was found; the same screens named differently side by
 * side; the library the ticked rows make (a name the library has adds its
 * screens to that activity), valid by the pipeline's checks; the version.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./library-builder.js");
const L = require("./library.js");

const K_ORDER = "chrome|Salesforce - Order|Button:save-order";
const K_SEARCH = "chrome|Salesforce - Account lookup|Button:search";
const K_QTY = "chrome|Salesforce - Order|(visit)";
const K_SAP = "sapgui|va01|Button:create-sales-order";
const K_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";

function st(id, state, name, more) {
  return Object.assign({ step_id: id, state, name, case_id: "c1" }, more || {});
}

/* Order intake: every kind of step the builder reads or leaves out. */
function projectA() {
  return { name: "Order intake", annotations: { steps: [
    st("a1", "confirmed", "Save the order", { draft_key: K_ORDER }),
    st("a2", "edited", "Find the customer", { draft_key: K_SEARCH }),
    st("a3", "auto_suggested", "A draft nobody named", { draft_key: K_EXCEL }),
    st("a4", "hidden", "Hidden", { draft_key: K_EXCEL, _prev_state: "edited" }),
    st("a5", "manually_authored", "Call the customer", { system: "Phone" }),
    st("a6", "manually_authored", "Note it down"),
    st("a7", "edited", "Enter and save", { draft_keys: [K_QTY, K_QTY, K_ORDER] }),
    st("g1", "manually_authored", "Order entry", { group: true, sub_steps: [
      st("g1a", "confirmed", "Create the sales order", { draft_key: K_SAP }),
      st("g1b", "edited", "Type the quantity", { action_key: "sapgui|va01|enter:qty" }),
    ] }),
  ] } };
}

/* Order call: the same screens named differently, the same name again. */
function projectB() {
  return { name: "Order call", annotations: { steps: [
    st("b1", "edited", "Book the order", { draft_key: K_ORDER }),
    st("b2", "confirmed", "save the ORDER", { draft_key: K_ORDER, case_id: "c2" }),
    st("b3", "edited", "Update the tracker", { draft_key: K_EXCEL }),
  ] } };
}

test("namedSteps: confirmed, edited and added steps with a name; no draft, hidden step, group or drafted sub-step; the screens a repeat once", () => {
  const got = B.namedSteps(projectA().annotations);
  assert.deepEqual(got.map((s) => [s.system, s.name, s.run]), [
    ["Salesforce", "Save the order", [K_ORDER]],
    ["Salesforce", "Find the customer", [K_SEARCH]],
    ["Phone", "Call the customer", null],
    ["", "Note it down", null],
    ["Salesforce", "Enter and save", [K_QTY, K_ORDER]],
    ["SAP", "Create the sales order", [K_SAP]],
  ]);
  assert.deepEqual(B.namedSteps(null), []);
});

test("collect: one entry per system and name (case does not matter), how often, in which projects, each run once; the steps without a system only counted", () => {
  const { entries, noSystem } = B.collect([projectA(), projectB()]);
  assert.equal(noSystem, 1);
  const save = entries.find((e) => e.name === "Save the order");
  assert.deepEqual([save.system, save.count, save.projects, save.runs], ["Salesforce", 2, ["Order intake", "Order call"], [[K_ORDER]]]);
  assert.deepEqual(entries.map((e) => e.name), ["Save the order", "Find the customer", "Call the customer", "Enter and save",
    "Create the sales order", "Book the order", "Update the tracker"]);
});

test("mergeSources: the same project added again (its session id, else its path) replaces the earlier copy", () => {
  const a = { path: "D:/p/a", sessionId: "s1" }, b = { path: "D:/p/b", sessionId: null };
  const first = B.mergeSources([], [a, b]);
  assert.deepEqual([first.sources.length, first.replaced], [2, 0]);
  const again = B.mergeSources(first.sources, [{ path: "D:/zips/a v2.zip", sessionId: "s1" }, { path: "d:/P/B", sessionId: null }]);
  assert.deepEqual(again.sources.map((s) => s.path), ["D:/zips/a v2.zip", "d:/P/B"]);
  assert.equal(again.replaced, 2);
});

test("rows: the library's activities first and ticked, the projects' names after them, by application; the same screens named differently side by side as one conflict", () => {
  const base = { format: 1, version: "1", applications: [
    { name: "SAP", activities: [] },
    { name: "Salesforce", activities: [{ id: "sf-save", name: "Save the order", code: "SO-01", screens: [[K_ORDER]] }] },
  ] };
  const { entries } = B.collect([projectA(), projectB()]);
  const rows = B.rows(base, entries);
  const sf = rows.filter((r) => r.application === "Salesforce");
  assert.deepEqual(rows.map((r) => r.application).filter((a, i, all) => all.indexOf(a) === i), ["SAP", "Salesforce", "Phone", "Excel"],
    "the library's order, then the systems it lacks as first met");
  assert.deepEqual(sf.map((r) => [r.source, r.name, r.ticked, r.conflict]), [
    ["library", "Save the order", true, true],
    ["projects", "Save the order", false, true],
    ["projects", "Book the order", false, true],
    ["projects", "Enter and save", false, false],
    ["projects", "Find the customer", false, false],
  ], "the library's activity, the same name found and the other name of its screens are one cluster, side by side; a longer run of screens is another");
  const cluster = new Set(sf.slice(0, 3).map((r) => r.cluster));
  assert.equal(cluster.size, 1);
  assert.notEqual(sf[3].cluster, sf[0].cluster);
  assert.equal(sf[1].inLibrary, true, "named as in the library");
  assert.deepEqual([sf[1].count, sf[1].projects], [2, ["Order intake", "Order call"]]);
  assert.equal(rows.find((r) => r.name === "Create the sales order").conflict, false);
});

test("buildLibrary: the ticked rows; a name the library has adds its screens to that activity (its id and code kept); new names get new ids; new systems come after the library's; valid by the pipeline's checks", () => {
  const base = { format: 1, version: "1", applications: [
    { name: "SAP", activities: [] },
    { name: "Salesforce", activities: [{ id: "sf-save", name: "Save the order", code: "SO-01", screens: [[K_SEARCH]] }] },
  ] };
  const rows = B.rows(base, B.collect([projectA(), projectB()]).entries);
  const tick = (name, more) => { const r = rows.find((x) => x.name === name && x.source === "projects"); Object.assign(r, { ticked: true }, more || {}); };
  tick("Save the order");
  tick("Create the sales order", { code: "VA01", description: "Creates the sales order in SAP." });
  tick("Call the customer");
  tick("Update the tracker");
  const doc = B.buildLibrary(base, rows, "2026-09-25.1");
  assert.deepEqual(L.problems(doc), []);
  assert.equal(doc.version, "2026-09-25.1");
  assert.deepEqual(doc.applications.map((a) => a.name), ["SAP", "Salesforce", "Phone", "Excel"]);
  assert.deepEqual(doc.applications[1].activities, [
    { id: "sf-save", name: "Save the order", code: "SO-01", screens: [[K_SEARCH], [K_ORDER]] }]);
  assert.deepEqual(doc.applications[0].activities, [
    { id: "sap-create-the-sales-order", name: "Create the sales order", code: "VA01", description: "Creates the sales order in SAP.", screens: [[K_SAP]] }]);
  assert.deepEqual(doc.applications[2].activities, [{ id: "phone-call-the-customer", name: "Call the customer", screens: [] }]);
  assert.deepEqual(doc.applications[3].activities.map((a) => a.id), ["excel-update-the-tracker"]);
  // A library activity unticked leaves the library; its application stays.
  rows.find((r) => r.source === "library").ticked = false;
  rows.find((r) => r.name === "Save the order" && r.source === "projects").ticked = false;
  const less = B.buildLibrary(base, rows, "2026-09-25.2");
  assert.deepEqual(less.applications[1], { name: "Salesforce", activities: [] });
});

test("buildLibrary: two names ticked for the same screens make a library the checks refuse; a renamed row joins the activity of its new name", () => {
  const base = { format: 1, version: "1", applications: [] };
  const rows = B.rows(base, B.collect([projectB()]).entries);
  for (const r of rows) if (r.application === "Salesforce") r.ticked = true;
  const both = B.buildLibrary(base, rows, "v");
  assert.match(L.problems(both)[0], /^one run of screens belongs to the activities/);
  rows.find((r) => r.name === "Book the order").name = "Save the order";
  const one = B.buildLibrary(base, rows, "v");
  assert.deepEqual(L.problems(one), []);
  assert.deepEqual(one.applications[0].activities.map((a) => [a.name, a.screens]), [["Save the order", [[K_ORDER]]]],
    "one activity, named as its first row");
});

test("newId: the application and the name in lower case, joined by hyphens; a number after it when taken", () => {
  const taken = new Set(["salesforce-save-the-order"]);
  assert.equal(B.newId("Salesforce", "Save the order!", taken), "salesforce-save-the-order-2");
  assert.equal(B.newId("Salesforce", "Save the order", taken), "salesforce-save-the-order-3");
  assert.equal(B.newId("", "  ", new Set()), "activity");
});

test("nextVersion: the day and a counter, after the current version's counter when it is of the same day", () => {
  const day = new Date(2026, 8, 25, 14, 0, 0);
  assert.equal(B.nextVersion("1", day), "2026-09-25.1");
  assert.equal(B.nextVersion("2026-09-25.1", day), "2026-09-25.2");
  assert.equal(B.nextVersion("2026-09-25.9", day), "2026-09-25.10");
  assert.equal(B.nextVersion("2026-09-24.3", day), "2026-09-25.1");
  assert.equal(B.nextVersion("", day), "2026-09-25.1");
});

test("the rows' words: a screen as its screen and control, a run with then, where a name was found", () => {
  assert.equal(B.screenLabel(K_ORDER), "Salesforce - Order · save-order");
  assert.equal(B.screenLabel("notepad|Notepad - x.txt|(visit)"), "Notepad - x.txt");
  assert.equal(B.screenLabel("app|Case | Queue|Button:ok"), "Case | Queue · ok", "a bar in the screen stays");
  assert.equal(B.screenLabel("odd"), "odd");
  assert.equal(B.screensText([[K_QTY, K_ORDER], [K_SEARCH]]),
    "Salesforce - Order then Salesforce - Order · save-order; Salesforce - Account lookup · search");
  assert.equal(B.usesText({ count: 1, projects: ["Order intake"] }), "Once, in Order intake");
  assert.equal(B.usesText({ count: 3, projects: ["Order intake", "Order call"] }), "3 times in 2 projects: Order intake, Order call");
  assert.equal(B.usesText({ count: 0, projects: [] }), "");
});
