"use strict";

/* sme-gives.js: what the SME gives at the end (contract C24, lane C). */

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./sme-gives.js");

const ALL = { trigger: "An order mail in the shared mailbox", result: "A sales order in SAP",
  effort: "About 30 a day, 4 minutes each", exceptions: "A new customer: I create them first" };

test("which answers wait: none without sme_answers", () => {
  assert.deepEqual(G.waitingAnswers({}, {}), []);
  assert.deepEqual(G.waitingAnswers({ sme_answers: null }, { document: {} }), []);
  assert.deepEqual(G.waitingAnswers(null, null), []);
  assert.equal(G.waitingLine(0), "");
});

test("which answers wait: all four, in the order of the Overview's fields (positive control)", () => {
  const w = G.waitingAnswers({ sme_answers: ALL }, { document: {} });
  assert.deepEqual(w.map((x) => x.key), ["trigger", "result", "exceptions", "effort"]);
  assert.equal(w[0].answer, ALL.trigger);
  assert.equal(G.waitingLine(w.length), "The SME answered 4 questions: each waits under its field.");
  assert.equal(G.waitingLine(1), "The SME answered 1 question: it waits under its field.");
});

test("which answers wait: a field that holds the answer has none waiting; other text keeps it", () => {
  const doc = { trigger: "  " + ALL.trigger + "\n", result: "Something the analyst wrote" };
  const w = G.waitingAnswers({ sme_answers: ALL }, { document: doc });
  assert.deepEqual(w.map((x) => x.key), ["result", "exceptions", "effort"]);
  assert.equal(G.holdsAnswer(doc.trigger, ALL.trigger), true);
  assert.equal(G.holdsAnswer("", ""), false, "an empty field never holds an empty answer");
});

test("which answers wait: a dismissed key waits no more", () => {
  const w = G.waitingAnswers({ sme_answers: ALL }, { document: {}, sme_answers_dismissed: ["exceptions", 7] });
  assert.deepEqual(w.map((x) => x.key), ["trigger", "result", "effort"]);
  assert.deepEqual(G.withDismissed({ sme_answers_dismissed: ["exceptions"] }, "exceptions"), ["exceptions"]);
  assert.deepEqual(G.withDismissed({}, "trigger"), ["trigger"]);
});

test("Use writes the answer and dismisses its key in one edit: an edit after it brings no line back; its undo brings both back", () => {
  const manifest = { sme_answers: ALL };
  const before = { document: { trigger: "What the analyst wrote", purpose: "Why" }, sme_answers_dismissed: ["effort"] };
  const snapshot = JSON.parse(JSON.stringify(before));   // what one Ctrl+Z writes back
  const used = G.usedAnswer(before, "trigger", ALL.trigger);
  assert.deepEqual(used, { document: { trigger: ALL.trigger, purpose: "Why" }, sme_answers_dismissed: ["effort", "trigger"] });
  assert.deepEqual(before, snapshot, "pure: the annotations given are not changed");
  const after = Object.assign({}, before, used);
  assert.deepEqual(G.waitingAnswers(manifest, after).map((x) => x.key), ["result", "exceptions"]);
  assert.equal(G.holdsAnswer(after.document.trigger, ALL.trigger), true, "written from the answer while it is exactly the answer");
  // The analyst edits the field: the line stays gone, and it is no longer the answer.
  after.document = Object.assign({}, after.document, { trigger: ALL.trigger + ", or a call" });
  assert.deepEqual(G.waitingAnswers(manifest, after).map((x) => x.key), ["result", "exceptions"]);
  assert.equal(G.holdsAnswer(after.document.trigger, ALL.trigger), false);
  // One Ctrl+Z puts the state before Use back: the old text and the line.
  assert.equal(snapshot.document.trigger, "What the analyst wrote");
  assert.deepEqual(G.waitingAnswers(manifest, snapshot).map((x) => x.key), ["trigger", "result", "exceptions"]);
  assert.deepEqual(G.usedAnswer({}, "result", "x"), { document: { result: "x" }, sme_answers_dismissed: ["result"] });
});

test("the document's line read only says only how many", () => {
  assert.equal(G.waitingLine(4, true), "The SME answered 4 questions.");
  assert.equal(G.waitingLine(1, true), "The SME answered 1 question.");
  assert.equal(G.waitingLine(0, true), "");
});

test("which answers wait: an empty answer is none, unknown keys are ignored", () => {
  const w = G.waitingAnswers({ sme_answers: { trigger: "   ", result: "", effort: 12, exceptions: "x", note: "a note", purpose: "Why" } },
    { document: {} });
  assert.deepEqual(w, [{ key: "exceptions", answer: "x" }]);
  assert.deepEqual(Object.keys(G.answersOf({ sme_answers: { note: "a", trigger: "t" } })), ["trigger"]);
});

const IN_FOLDER = new Set(["Order 10900.msg", "Price list 2026.xlsx"]);
const exists = (f) => IN_FOLDER.has(f);
const NOW = "2026-11-12T10:00:00.000Z";

test("the SME's files: none listed, none added", () => {
  assert.deepEqual(G.filesToAdopt({}, {}, exists, NOW), { add: [], missing: [] });
  assert.deepEqual(G.filesToAdopt({ sme_files: "x" }, {}, exists, NOW), { add: [], missing: [] });
});

test("the SME's files: one new is added on the whole project, from the SME (positive control)", () => {
  const r = G.filesToAdopt({ sme_files: [{ file: "Order 10900.msg", label: "Order 10900.msg", added_at: "2026-11-12T09:00:00Z" }] },
    { attachments: [] }, exists, NOW);
  assert.deepEqual(r.add, [{ file: "Order 10900.msg", label: "Order 10900.msg", step_id: null,
    added_at: "2026-11-12T09:00:00Z", from: "sme" }]);
  assert.deepEqual(r.missing, []);
  const anno = { attachments: [{ id: "a0", file: "mine.pdf", label: "mine.pdf", step_id: null }] };
  let n = 0;
  assert.equal(G.adoptFiles(anno, r.add, () => "id" + (++n)), 1);
  assert.deepEqual(anno.attachments.map((a) => [a.id, a.file, a.from]), [["a0", "mine.pdf", undefined], ["id1", "Order 10900.msg", "sme"]]);
  assert.deepEqual(anno.sme_files_adopted, ["Order 10900.msg"]);
  assert.equal(G.fromSme(anno.attachments[1]), true);
  assert.equal(G.fromSme(anno.attachments[0]), false);
});

test("the SME's files: one already adopted is not added twice, nor one taken before and removed since", () => {
  const manifest = { sme_files: [{ file: "Order 10900.msg", label: "Order 10900.msg" }, { file: "Price list 2026.xlsx", label: "Price list 2026.xlsx" }] };
  const once = G.filesToAdopt(manifest, { attachments: [{ id: "x", file: "Order 10900.msg", from: "sme" }] }, exists, NOW);
  assert.deepEqual(once.add.map((a) => a.file), ["Price list 2026.xlsx"]);
  assert.equal(once.add[0].added_at, NOW, "an entry without its own time gets the moment it is taken");
  // Removed by the analyst: no entry, the file gone from the folder, named taken.
  const removed = G.filesToAdopt(manifest, { attachments: [], sme_files_adopted: ["Order 10900.msg", "Price list 2026.xlsx"] },
    (f) => f === "Price list 2026.xlsx", NOW);
  assert.deepEqual(removed, { add: [], missing: [] });
});

test("the SME's files: a file listed but missing from the folder is not added and is said", () => {
  const r = G.filesToAdopt({ sme_files: [{ file: "Order 10900 (2).msg", label: "Order 10900.msg" }, { file: "Price list 2026.xlsx", label: "" }] },
    {}, exists, NOW);
  assert.deepEqual(r.add.map((a) => [a.file, a.label]), [["Price list 2026.xlsx", "Price list 2026.xlsx"]]);
  assert.deepEqual(r.missing, ["Order 10900.msg"]);
  assert.equal(G.missingLine(r.missing[0]), "The SME's file Order 10900.msg is not in the project folder.");
});

test("the SME's files: a name that is not a plain file name in attachments/ is ignored, a repeat once", () => {
  const r = G.filesToAdopt({ sme_files: [{ file: "../events.jsonl" }, { file: "sub/x.txt" }, { file: "C:x" }, { file: ".." },
    { file: " Order 10900.msg" }, null, { file: "Order 10900.msg" }, { file: "Order 10900.msg" }] }, {}, exists, NOW);
  assert.deepEqual(r.add.map((a) => a.file), ["Order 10900.msg"]);
  assert.deepEqual(r.missing, []);
});
