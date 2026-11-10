"use strict";
/*
 * Lane W0 (plan 11.1 and 11.4): the top bar's next act of the Checklist and
 * its Undo and Redo. The next act is named from the Checklist's own stages
 * and counts (overview-view.js pathState, nextActText), never from a second
 * rule; top-bar-acts.js says what shows where. The DOM half (the click that
 * lands on the Checklist's button, the buttons following the stacks, the
 * widths) is pinned by e2e/overview-smoke.js on the real viewer.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathState, nextActText } = require("./views/overview-view.js");
const { topBarActs, nextTitle, NEXT_TITLE, UNDO_LABEL, REDO_LABEL, UNDO_TITLE, REDO_TITLE } = require("./top-bar-acts.js");

const t = (min) => new Date(Date.UTC(2026, 4, 17, 9, min)).toISOString();

/* A recording: three transactions of drafted steps. */
function recording(over) {
  const step = (id, caseId, min) => ({ step_id: id, case_id: caseId, state: "auto_suggested", name: "Step " + id,
    draft_key: "app|screen|Button:" + id, time_range: { start: t(min), end: t(min + 1) } });
  return Object.assign({
    sessionFolder: null,
    analysis: { case_quality: { mode: "markers", case_count: 3, coverage: 1 } },
    stats: { meta: {}, case_stats: [
      { case_id: "c1", start_ts: t(0), end_ts: t(10) },
      { case_id: "c2", start_ts: t(20), end_ts: t(30) },
      { case_id: "c3", start_ts: t(40), end_ts: t(50) },
    ] },
    annotations: { steps: [step("a", "c1", 1), step("b", "c1", 3), step("c", "c2", 21), step("d", "c2", 23), step("e", "c3", 41)] },
    manifest: { engagement_id: "eng-1" },
    events: [{ type: "activity", timestamp: t(0) }, { type: "activity", timestamp: t(50) }],
  }, over || {});
}

/* A project made from a video (or, `video: false`, from nothing). */
function hand(opts) {
  const o = opts || {};
  const anno = { steps: o.steps || [] };
  if (o.video !== false) anno.external_videos = [{ id: "v1", path: "video/call.mp4", offset_ms: 0, in_ms: 0, out_ms: null, length_ms: 600000 }];
  return recording({
    stats: { meta: {}, case_stats: [{ case_id: "imp", start_ts: t(0), end_ts: null, implicit: true }] },
    manifest: { source: o.video === false ? "blank" : "video" }, events: [], annotations: anno,
  });
}
const handStep = (id, min, name, description) => ({ step_id: id, case_id: "imp", state: "manually_authored", name,
  description: description || "", time_range: { start: t(min), end: t(min + 1) } });

const FULL_DOC = { title: "Order intake", purpose: "Why", scope: "What", trigger: "An order e-mail",
  result: "A sales order", contacts: "Who", business_rules: "Rules", exceptions: "Exceptions",
  effort: "About 40 a day", improvement: "Automate the lookup", notes: "" };

const next = (sess) => nextActText(pathState(sess));

test("a recording: the next act names the Checklist's stage, its first letter in lower case", () => {
  const stripped = recording({ stats: { meta: {}, case_stats: [] } });
  for (const s of stripped.annotations.steps) s.case_id = null;
  assert.equal(next(stripped), "Next: mark the transactions");
  const sess = recording();
  assert.equal(next(sess), "Next: confirm the reference transaction");
  for (const s of sess.annotations.steps) if (s.case_id === "c1") s.state = "confirmed";
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T10:00:00Z" };
  assert.equal(pathState(sess).next, "review");
  assert.equal(next(sess), "Next: review the other transactions");
  sess.annotations.opened_runs = ["c2", "c3"];
  assert.equal(next(sess), "Next: write the document (0 of 10)");
});

test("a project from a video: add the steps, then write the steps with the Checklist's own count", () => {
  const sess = hand();
  assert.equal(next(sess), "Next: add the steps");
  sess.annotations.steps.push(handStep("s1", 1, "Step 1"), handStep("s2", 3, "Step 2"), handStep("s3", 5, "Step 3"));
  assert.equal(next(sess), "Next: write the steps (0 of 3)");
  // A name of its own is not enough: the description too, as the Checklist counts.
  sess.annotations.steps[0].name = "Check the customer";
  assert.equal(next(sess), "Next: write the steps (0 of 3)");
  sess.annotations.steps[0].description = "Look the customer up.";
  assert.equal(next(sess), "Next: write the steps (1 of 3)");
  const st = pathState(sess);
  assert.equal(st.refStepCount - st.unwritten.length, 1, "the count is the Checklist's");
  // An empty project reads the same.
  assert.equal(next(hand({ video: false })), "Next: add the steps");
});

test("write the document counts the Overview's own fields, and Check the As-Is map keeps its capitals", () => {
  const sess = hand({ steps: [handStep("s1", 1, "Check the customer", "Look up.")] });
  sess.annotations.document = { purpose: "Why", scope: "What", notes: "not counted" };
  assert.equal(next(sess), "Next: write the document (2 of 10)");
  // The stage's label, from the same list the Checklist draws.
  assert.equal(nextActText({ next: "asis", done: { asis: false } }), "Next: check the As-Is map");
});

test("hand off is named while no version exists; once one is handed off and nothing is left, nothing shows", () => {
  const sess = hand({ steps: [handStep("s1", 1, "Check the customer", "Look up.")] });
  sess.annotations.document = Object.assign({}, FULL_DOC);
  assert.equal(next(sess), "Next: hand off");
  sess.annotations.handoffs = [{ version: 1, handed_off_at: "2026-11-02T09:00:00.000Z", by: "rasha", note: "First" }];
  assert.equal(next(sess), null);
  // A version does not tick the acts before it: an emptied field is named again.
  sess.annotations.document.purpose = "";
  assert.equal(next(sess), "Next: write the document (9 of 10)");
});

const SHOWN = { session: true, readOnly: false, unreadable: false, level: "flow", checklist: true, mapEditorOpen: false,
  nextText: "Next: add the steps", canUndo: true, canRedo: false };

test("the next act shows on the Timeline, Steps and the Map, and not on the Overview", () => {
  for (const level of ["flow", "steps", "map"]) {
    const v = topBarActs(Object.assign({}, SHOWN, { level }));
    assert.deepEqual(v.next, { shown: true, text: "Next: add the steps" }, level);
  }
  assert.equal(topBarActs(Object.assign({}, SHOWN, { level: "overview" })).next.shown, false);
  assert.equal(topBarActs(Object.assign({}, SHOWN, { level: "overview" })).undo.shown, true, "Undo shows on every level");
});

test("nothing shows in a read-only project, with no project open, or while annotations.json cannot be read", () => {
  for (const over of [{ readOnly: true }, { session: false }, { unreadable: true }]) {
    const v = topBarActs(Object.assign({}, SHOWN, over));
    assert.equal(v.next.shown, false, JSON.stringify(over));
    assert.equal(v.undo.shown, false, JSON.stringify(over));
    assert.equal(v.redo.shown, false, JSON.stringify(over));
  }
});

test("while the map editor is open, Undo and Redo are hidden (the keys are the map's), and so is the next act", () => {
  const v = topBarActs(Object.assign({}, SHOWN, { level: "map", mapEditorOpen: true }));
  assert.equal(v.undo.shown, false);
  assert.equal(v.redo.shown, false);
  assert.equal(v.next.shown, false);
});

test("the next act is hidden before the first analysis (no Checklist) and once nothing is left", () => {
  assert.equal(topBarActs(Object.assign({}, SHOWN, { checklist: false })).next.shown, false);
  assert.equal(topBarActs(Object.assign({}, SHOWN, { nextText: null })).next.shown, false);
});

test("Undo and Redo follow the stacks: shown, and enabled only with something to undo or redo", () => {
  let v = topBarActs(SHOWN);
  assert.deepEqual(v.undo, { shown: true, enabled: true });
  assert.deepEqual(v.redo, { shown: true, enabled: false });
  v = topBarActs(Object.assign({}, SHOWN, { canUndo: false, canRedo: true }));
  assert.deepEqual(v.undo, { shown: true, enabled: false });
  assert.deepEqual(v.redo, { shown: true, enabled: true });
});

test("the words are the plan's (11.4), and a cut text reads whole in the tooltip", () => {
  assert.equal(NEXT_TITLE, "Opens the Checklist.");
  assert.equal(UNDO_LABEL, "Undo");
  assert.equal(REDO_LABEL, "Redo");
  assert.equal(UNDO_TITLE, "Undoes the last change. Key: Ctrl+Z");
  assert.equal(REDO_TITLE, "Does the undone change again. Key: Ctrl+Y");
  assert.equal(nextTitle("Next: write the steps (1 of 7)", false), "Opens the Checklist.");
  assert.equal(nextTitle("Next: write the steps (1 of 7)", true), "Opens the Checklist. Next: write the steps (1 of 7)");
});
