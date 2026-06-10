/*
 * Close-out persistence tests (lab-phase §E3).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeSelfAnnotations, stampWorkerReview, countSelfAnnotations } = require("./persist.js");

function makeSessionDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-persist-"));
  fs.writeFileSync(path.join(dir, "events.jsonl"), '{"type":"system","data":{"kind":"session_start"}}\n');
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    session_id: "s-1", status: "closed", purpose: "process",
  }, null, 2));
  return dir;
}

function entry(answer) {
  return {
    self_annotation_id: "sa-test",
    template_key: "longest_segment",
    question: "What were you doing?",
    answer,
    is_exception: false,
    observed: {},
    manually_authored: true,
    created_at: "2026-06-10T10:00:00Z",
  };
}

test("writeSelfAnnotations creates annotations.json and appends on later calls", (t) => {
  const dir = makeSessionDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(writeSelfAnnotations(dir, [entry("Invoice matching")]), 1);
  assert.equal(writeSelfAnnotations(dir, [entry("Second pass")]), 2);

  const anno = JSON.parse(fs.readFileSync(path.join(dir, "annotations.json"), "utf-8"));
  assert.equal(anno.self_annotations.length, 2);
  assert.equal(anno.self_annotations[0].answer, "Invoice matching");
  assert.equal(anno.self_annotations[0].manually_authored, true);
});

test("writeSelfAnnotations preserves an existing annotations.json's other keys", (t) => {
  const dir = makeSessionDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({
    version: 1, notes: [{ id: "n1", text: "analyst note" }],
  }));
  writeSelfAnnotations(dir, [entry("A")]);
  const anno = JSON.parse(fs.readFileSync(path.join(dir, "annotations.json"), "utf-8"));
  assert.equal(anno.notes[0].text, "analyst note");
  assert.equal(anno.version, 1);
  assert.equal(anno.self_annotations.length, 1);
});

test("empty answers write nothing and report the existing count", (t) => {
  const dir = makeSessionDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(writeSelfAnnotations(dir, []), 0);
  assert.equal(fs.existsSync(path.join(dir, "annotations.json")), false);
  assert.equal(countSelfAnnotations(dir), 0);
});

test("stampWorkerReview records the explicit submit on the manifest", (t) => {
  const dir = makeSessionDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ok = stampWorkerReview(dir, { questionsAsked: 4, questionsAnswered: 3 });
  assert.equal(ok, true);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
  assert.equal(m.worker_review.submitted, true);
  assert.equal(m.worker_review.questions_asked, 4);
  assert.equal(m.worker_review.questions_answered, 3);
  assert.ok(m.worker_review.submitted_at);
  // The rest of the manifest is untouched.
  assert.equal(m.session_id, "s-1");
});

test("both writes refresh session-integrity.json so the new files are declared", (t) => {
  const dir = makeSessionDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeSelfAnnotations(dir, [entry("A")]);
  let integ = JSON.parse(fs.readFileSync(path.join(dir, "session-integrity.json"), "utf-8"));
  assert.ok(integ.files.some((f) => f.name === "annotations.json"));

  stampWorkerReview(dir, { questionsAsked: 1, questionsAnswered: 1 });
  integ = JSON.parse(fs.readFileSync(path.join(dir, "session-integrity.json"), "utf-8"));
  const manifestDecl = integ.files.find((f) => f.name === "manifest.json");
  assert.equal(manifestDecl.size, fs.statSync(path.join(dir, "manifest.json")).size);
});

test("stampWorkerReview on a folder without a manifest is a safe no-op", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-persist-empty-"));
  try {
    assert.equal(stampWorkerReview(dir, { questionsAsked: 0, questionsAnswered: 0 }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
