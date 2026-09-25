"use strict";
// Hand-off versions (lane HV, contract C20): the version bump, the entry a
// hand-off adds, the one line a version says (the PDD's words,
// normalization/handoff_versions.py), and the names of a hand-off's files.
// The zip itself and the read-only open are in handoff-zip.test.js; the
// read-only mode's write paths in read-only.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./handoff.js");
const { buildNormalizeArgs } = require("./python-runner.js");

const V1 = { version: 1, handed_off_at: "2026-09-20T08:00:00.000Z", by: "rasha", note: "First hand-off" };
const V2 = { version: 2, handed_off_at: "2026-09-25T10:14:03.120Z", by: "rasha", note: "The credit check added" };

test("the version goes up by one: 1 first, then one more than the highest", () => {
  assert.equal(H.nextVersion({}), 1);
  assert.equal(H.nextVersion(null), 1);
  assert.equal(H.nextVersion({ handoffs: [] }), 1);
  assert.equal(H.nextVersion({ handoffs: [V1] }), 2);
  assert.equal(H.nextVersion({ handoffs: [V2, V1] }), 3);
  // A gap left by an entry taken back and made again is not filled: the
  // highest counts; entries that are no version are passed over.
  assert.equal(H.nextVersion({ handoffs: [V1, { version: 5 }, { version: "7" }, { version: 0 }, null, { version: true }] }), 6);
});

test("the entries are the valid ones, in version order; the later of two with one version counts", () => {
  assert.deepEqual(H.entries({ handoffs: [V2, { note: "x" }, V1] }).map((e) => e.version), [1, 2]);
  const again = Object.assign({}, V1, { note: "Again" });
  assert.equal(H.entries({ handoffs: [V1, again] })[0].note, "Again");
  assert.equal(H.latest({ handoffs: [V2, V1] }).version, 2);
  assert.equal(H.latest({}), null);
});

test("a hand-off's entry: its version, the time, the Windows user and the note, trimmed", () => {
  assert.deepEqual(H.newEntry({ version: 3, note: "  Credit check  ", by: " rasha ", now: "2026-09-25T10:00:00.000Z" }),
    { version: 3, handed_off_at: "2026-09-25T10:00:00.000Z", by: "rasha", note: "Credit check" });
  assert.equal(H.FIRST_NOTE, "First hand-off");
});

test("the line a version says, in the PDD's words, and the read-only project line", () => {
  assert.equal(H.handedOffLine(V2), "Version 2, handed off 2026-09-25 by rasha");
  assert.equal(H.readOnlyLine(V2), "Version 2, handed off 2026-09-25 by rasha · Read only");
  assert.equal(H.handedOffLine({ version: 3, handed_off_at: "", by: "" }), "Version 3");
  assert.equal(H.handedOffLine({ version: 3, handed_off_at: "later", by: "ana" }), "Version 3, handed off by ana");
  assert.equal(H.handedOffLine({ version: 3, handed_off_at: "2026-01-02T23:59:00Z", by: "" }), "Version 3, handed off 2026-01-02");
  assert.equal(H.entryDate(V1), "2026-09-20");
  assert.equal(H.readOnlyLine(null), "Read only");
});

test("the files of a hand-off: the zip, and at its root the PDD and the Technical details", () => {
  assert.deepEqual(H.fileNames("Order entry", 2), {
    stem: "Order entry v2", zip: "Order entry v2.zip",
    pdd: "Order entry v2 PDD.docx", tech: "Order entry v2 Technical details.xlsx",
  });
});

test("a project name is made safe for Windows: no refused character, no dot or space at the end, not too long", () => {
  assert.equal(H.safeBase('Order: "entry" <A/B>|C?*'), "Order entry A B C");
  assert.equal(H.safeBase("  Invoices...  "), "Invoices");
  assert.equal(H.safeBase("a\u0001b\tc"), "a b c");
  assert.equal(H.safeBase("", "sess-2026-0514"), "sess-2026-0514");
  assert.equal(H.safeBase("???", ""), "Project");
  assert.equal(H.safeBase("x".repeat(200)).length, H.MAX_BASE);
});

test("the project's name is the one the app shows: the title, the recording's name, the request, else the folder", () => {
  const folder = "D:\\work\\sess-2026-0514-0900";
  assert.equal(H.projectName({ sessionFolder: folder, manifest: {}, annotations: { document: { title: " Order entry " } } }), "Order entry");
  assert.equal(H.projectName({ sessionFolder: folder, manifest: { label: "Call with Ana" }, annotations: {} }), "Call with Ana");
  assert.equal(H.projectName({ sessionFolder: folder, manifest: { engagement_name: "Invoice review", engagement_id: "REQ-1" } }), "Invoice review");
  assert.equal(H.projectName({ sessionFolder: folder, manifest: { engagement_name: "Default engagement", engagement_id: "default" } }), "sess-2026-0514-0900");
});

test("the analysis run for a hand-off passes the workbook and the version, --library still last", () => {
  assert.deepEqual(
    buildNormalizeArgs("n.py", { sessionFolder: "S", pddOut: "o.docx", techOut: "t.xlsx", handoff: 2, libraryPath: "L" }),
    ["n.py", "S", "--pdd-out", "o.docx", "--tech-out", "t.xlsx", "--handoff", "2", "--library", "L"]);
  const plain = buildNormalizeArgs("n.py", { sessionFolder: "S", handoff: 0 });
  assert.ok(!plain.includes("--handoff") && !plain.includes("--tech-out"), "no version 0, no workbook asked for");
});
