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

test("the files of a hand-off: the zip, and at its root the PDD, the Technical details, the map files and Start here.txt", () => {
  assert.deepEqual(H.fileNames("Order entry", 2), {
    stem: "Order entry v2", zip: "Order entry v2.zip",
    pdd: "Order entry v2 PDD.docx", tech: "Order entry v2 Technical details.xlsx",
    mapSvg: "Order entry v2 map.svg", mapBpmn: "Order entry v2 map.bpmn", startHere: "Start here.txt",
  });
  assert.equal(H.fileNames('Order: "entry"', 1).mapSvg, "Order entry v1 map.svg", "the name made safe, as the others");
});

const VIEWER_LINES = [
  "To look through the project (play each step, see its screenshots and what was said), open the",
  'Process Discovery Tracker viewer, choose Open, then "Open a zip...", and pick this',
  "zip. It opens read only.",
];

test("Start here.txt says what each file in the zip is, its second column lined up, in CRLF lines", () => {
  const text = H.startHereText({ base: "Order entry", version: 2, folder: "sess-0514",
    entry: { version: 2, handed_off_at: "2026-11-09T15:30:00.000Z", by: "rasha", note: "x" },
    has: { tech: true, mapSvg: true, mapBpmn: true } });
  assert.ok(text.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "every line ends in CRLF");
  assert.deepEqual(text.split("\r\n"), [
    "Order entry: version 2, handed off 2026-11-09 by rasha",
    "",
    "In this zip:",
    "  Order entry v2 PDD.docx                 The process written down. Read this first.",
    "  Order entry v2 Technical details.xlsx   For developers: the recorded controls, the data fields and the values of every transaction.",
    "  Order entry v2 map.svg                  The process map as a picture. It opens in a browser.",
    "  Order entry v2 map.bpmn                 The process map as BPMN 2.0, for ADONIS, Camunda, Bizagi and similar tools.",
    "  sess-0514\\                              The whole project: the video, the screenshots, the attachments and the work behind the document.",
    "",
  ].concat(VIEWER_LINES, [""]));
});

test("Start here.txt lists only the files the zip holds: without the Technical details and the maps, the PDD and the folder", () => {
  const text = H.startHereText({ base: "Call notes", version: 1, folder: "Call notes", entry: null, has: {} });
  assert.deepEqual(text.split("\r\n"), [
    "Call notes: version 1",
    "",
    "In this zip:",
    "  Call notes v1 PDD.docx   The process written down. Read this first.",
    "  Call notes\\              The whole project: the video, the screenshots, the attachments and the work behind the document.",
    "",
  ].concat(VIEWER_LINES, [""]));
  const maps = H.startHereText({ base: "Call notes", version: 1, folder: "Call notes", entry: null, has: { mapBpmn: true } });
  assert.ok(maps.includes("map.bpmn") && !maps.includes("map.svg") && !maps.includes("Technical details"));
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

test("the hand-off dialog says what the zip holds: the Technical details only where something was recorded", () => {
  const { detailLine } = require("./views/handoff-ui.js");
  assert.equal(detailLine("Order entry v2.zip", 2, true),
    "Order entry v2.zip is made next to the project folder: the whole project, with the PDD, the Technical details and the process map of version 2.");
  assert.equal(detailLine("Call v1.zip", 1, false),
    "Call v1.zip is made next to the project folder: the whole project, with the PDD and the process map of version 1.");
});

test("C26: the dialog counts the Technical details in where a step lists information, in a project without a recording too", () => {
  const { holdsTechDetails } = require("./views/handoff-ui.js");
  const video = (steps) => ({ manifest: { source: "video" }, events: [], annotations: { steps } });
  assert.equal(holdsTechDetails({ manifest: {}, events: [{ type: "interaction" }], annotations: {} }), true, "a recording");
  assert.equal(holdsTechDetails(video([{ state: "manually_authored", name: "Take the call" }])), false, "nothing typed");
  assert.equal(holdsTechDetails(video([{ state: "manually_authored", information: [{ name: "Customer number" }] }])), true);
  assert.equal(holdsTechDetails(video([{ state: "edited", sub_steps: [{ state: "edited", information: [{ name: "Unit price" }] }] }])), true,
    "a sub-step's line");
  assert.equal(holdsTechDetails(video([{ state: "hidden", information: [{ name: "Customer number" }] }])), false, "a hidden step prints nothing");
  assert.equal(holdsTechDetails(video([{ state: "edited", information: [{ name: "  " }] }])), false, "a line without a name is not kept");
});

/* Lane B-V2: what a reader of this version will miss, in the dialog. */
test("with nothing missing the hand-off dialog is exactly the dialog it was", () => {
  const { dialogOptions } = require("./views/handoff-ui.js");
  const want = {
    title: "Hand off version 1", message: "What changed in this version?",
    detail: "Order entry v1.zip is made next to the project folder: the whole project, with the PDD, the Technical details and the process map of version 1.",
    placeholder: "For example: the credit check added", defaultValue: "First hand-off", okLabel: "Hand off", required: true,
  };
  assert.deepEqual(dialogOptions({ version: 1, zipName: "Order entry v1.zip", recording: true, missing: [] }), want);
  assert.deepEqual(dialogOptions({ version: 1, zipName: "Order entry v1.zip", recording: true }), want);
  const v2 = dialogOptions({ version: 2, zipName: "Call v2.zip", recording: false, missing: [] });
  assert.equal(v2.defaultValue, "");
  assert.equal(v2.okLabel, "Hand off");
  assert.ok(!("list" in v2), "no list option");
});

test("with entries the dialog lists them under its line, the button reads Hand off anyway, and a pick leads to its entry", () => {
  const { dialogOptions } = require("./views/handoff-ui.js");
  const entries = (n) => Array.from({ length: n }, (_, i) => ({ key: "k" + i, text: "Entry " + i, lead: { kind: "map" } }));
  const picked = [];
  const six = dialogOptions({ version: 3, zipName: "P v3.zip", recording: true, missing: entries(6), onPick: (e) => picked.push(e.key) });
  assert.equal(six.okLabel, "Hand off anyway");
  assert.equal(six.list.lead, "A reader of version 3 will miss:");
  assert.deepEqual(six.list.items, ["Entry 0", "Entry 1", "Entry 2", "Entry 3", "Entry 4", "Entry 5"]);
  assert.equal(six.list.more, "");
  six.list.onPick(4);
  assert.deepEqual(picked, ["k4"]);
  // More than six: five lines, then "and N more" (six lines in all).
  const eight = dialogOptions({ version: 3, zipName: "P v3.zip", recording: true, missing: entries(8) });
  assert.deepEqual(eight.list.items, ["Entry 0", "Entry 1", "Entry 2", "Entry 3", "Entry 4"]);
  assert.equal(eight.list.more, "and 3 more");
  // The rest of the dialog is as it was.
  assert.equal(six.title, "Hand off version 3");
  assert.equal(six.message, "What changed in this version?");
  assert.equal(six.required, true);
});
