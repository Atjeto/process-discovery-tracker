"use strict";
/*
 * What the analyst adds (contract C16), the pure half (analyst-content.js),
 * and the order rule the viewer shares with the pipeline: the steps with a
 * time in time order, then the steps without one by `order`, then any step
 * with neither (runs-model byStart, process-map-levels).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const AC = require("./analyst-content.js");
const RunsModel = require("./runs-model.js");
const { buildAnnotationDfg } = require("./process-map-levels.js");

const t = (sec) => new Date(Date.UTC(2026, 8, 24, 10, 0, sec)).toISOString();
const timed = (id, a, b) => ({ step_id: id, name: id, state: "manually_authored", time_range: { start: t(a), end: t(b) } });
const untimed = (id, order) => Object.assign({ step_id: id, name: id, state: "manually_authored", time_range: null },
  order == null ? {} : { order });

test("the order rule: time, then order, then neither in list order (runs-model and the map)", () => {
  const steps = [untimed("n1"), untimed("o2", 2), timed("t2", 20, 25), untimed("o1", 1), timed("t1", 5, 9), untimed("n2")];
  assert.deepEqual(steps.slice().sort(RunsModel.byStart).map((s) => s.step_id), ["t1", "t2", "o1", "o2", "n1", "n2"]);
  const members = RunsModel.buildRuns({ case_stats: [{ case_id: "c", start_ts: t(0), end_ts: null }] },
    steps.map((s) => Object.assign({ case_id: "c" }, s))).runs[0].members;
  assert.deepEqual(members.map((s) => s.step_id), ["t1", "t2", "o1", "o2", "n1", "n2"]);
  const dfg = buildAnnotationDfg([steps]);
  assert.deepEqual(dfg.start_activities, { t1: 1 });
  assert.deepEqual(dfg.end_activities, { n2: 1 });
  assert.deepEqual(dfg.edges.map((e) => e.source + ">" + e.target), ["t1>t2", "t2>o1", "o1>o2", "o2>n1", "n1>n2"]);
});

test("an open run (the implicit run of a session without a recording) has no duration, not 0", () => {
  const runs = RunsModel.buildRuns({ case_stats: [{ case_id: "imp", start_ts: t(0), end_ts: null, wall_clock_ms: null, implicit: true }] }, []).runs;
  assert.equal(runs[0].durationMs, null);
});

test("a step added without a time goes right after the selected step, first after the timed ones, or at the end", () => {
  const a = timed("a", 0, 5), b = untimed("b", 1), c = untimed("c", 2);
  const members = [a, b, c];
  const x = untimed("x");
  AC.placeUntimed(members, x, b);
  assert.deepEqual([b.order, x.order, c.order], [1, 2, 3]);
  const y = untimed("y");
  AC.placeUntimed([a, b, x, c], y, a);
  assert.deepEqual([y.order, b.order, x.order, c.order], [1, 2, 3, 4]);
  const z = untimed("z");
  AC.placeUntimed([a, y, b, x, c], z, null);
  assert.equal(z.order, 5);
  assert.equal(a.order, undefined, "a timed step gets no order");
});

test("moving a step without a time swaps it with the next one the list shows, and renumbers the run", () => {
  const a = timed("a", 0, 5), b = untimed("b", 1), h = Object.assign(untimed("h", 2), { state: "hidden" }), c = untimed("c", 3);
  const members = [a, b, h, c];
  const shown = (s) => s.state !== "hidden";
  assert.equal(AC.moveUntimed(members, c, -1, shown), true);
  assert.deepEqual([c.order, b.order, h.order], [1, 2, 3], "c goes above b, the step the list shows above it");
  const again = [a, c, b, h];
  assert.equal(AC.moveUntimed(again, c, -1, shown), false, "the first one cannot move up");
  assert.equal(AC.moveUntimed(again, b, 1, shown), false, "the last one the list shows cannot move down");
  assert.equal(AC.moveUntimed(members, a, 1, shown), false, "a timed step does not move");
});

test("a step shows its recorder screenshots less the hidden ones, then the ones the analyst added to it", () => {
  const step = { step_id: "s1", evidence: { screenshot_refs: ["screenshots/a.jpg", "screenshots/b.jpg"] },
    hidden_screenshots: ["screenshots/b.jpg"] };
  const shots = [{ id: "i1", file: "i1.png", step_id: "s1", at: t(3) }, { id: "i2", file: "i2.png", step_id: "other" },
    { id: "i3", file: "..\\evil.png", step_id: "s1" }];
  assert.deepEqual(AC.stepShots(step, shots), [
    { kind: "recorder", ref: "screenshots/a.jpg", rel: "screenshots/a.jpg", at: null },
    { kind: "analyst", ref: "i1", rel: "screenshots/analyst/i1.png", at: t(3) },
    { kind: "analyst", ref: "i3", rel: "screenshots/analyst/evil.png", at: null },
  ]);
  assert.equal(AC.hiddenShotCount(step), 1);
});

test("a step shows its own notes and the notes pinned to a moment inside it; the lane shows the moments", () => {
  const step = timed("s1", 10, 20);
  const notes = [{ id: "a", text: "on the step", step_id: "s1", at: null }, { id: "b", text: "inside", step_id: null, at: t(15) },
    { id: "c", text: "outside", step_id: null, at: t(25) }, { id: "d", text: "other step", step_id: "s2", at: null }];
  assert.deepEqual(AC.notesForStep(notes, step).map((n) => n.id), ["a", "b"]);
  assert.deepEqual(AC.notesForStep(notes, untimed("s2")).map((n) => n.id), ["d"]);
  assert.deepEqual(AC.momentNotes(notes).map((n) => n.id), ["b", "c"]);
});

test("a changed step is the analyst's; the implicit run id and the System choices", () => {
  const draft = { state: "auto_suggested" }, hidden = { state: "hidden", _prev_state: "auto_suggested" }, added = { state: "manually_authored" };
  AC.markEdited(draft); AC.markEdited(hidden); AC.markEdited(added);
  assert.deepEqual([draft.state, hidden.state, hidden._prev_state, added.state], ["edited", "hidden", "edited", "manually_authored"]);
  assert.equal(AC.implicitRunId({ case_stats: [{ case_id: "r1" }, { case_id: "imp", implicit: true }] }), "imp");
  assert.equal(AC.implicitRunId({ case_stats: [{ case_id: "r1" }] }), null);
  assert.deepEqual(AC.systemChoices(["SAP", "Phone"], ["Salesforce", "sap", "Excel"]), ["SAP", "Phone", "Salesforce", "Excel"]);
});

test("lane FX2: the Timeline's screenshots are the recording's and the ones the analyst added with a moment, in time order", () => {
  const ev = (ts, kind, p) => ({ type: "system", timestamp: ts, data: { kind, path: p } });
  const events = [
    ev("2026-05-14T09:00:19Z", "screenshot", "screenshots/shot_01.png"),
    { type: "activity", timestamp: "2026-05-14T09:00:20Z", data: {} },
    ev("2026-05-14T09:00:40Z", "screenshot_manual", "screenshots/shot_02.png"),
    ev("2026-05-14T09:00:41Z", "idle_start", "x.png"),
  ];
  const added = [
    { id: "a1", file: "a1.png", step_id: "s3", at: "2026-05-14T09:00:31Z", source: "video_frame" },
    { id: "a2", file: "a2.png", step_id: "s4", at: null, source: "file" },
    { id: "a3", file: "../../a3.png", step_id: null, at: "2026-05-14T09:00:50Z", source: "paste" },
    { id: "", file: "a4.png", at: "2026-05-14T09:00:55Z" },
  ];
  assert.deepEqual(AC.timelineShots(events, added), [
    { ts: "2026-05-14T09:00:19Z", rel: "screenshots/shot_01.png", kind: "recorded", stepId: null },
    { ts: "2026-05-14T09:00:31Z", rel: "screenshots/analyst/a1.png", kind: "added", stepId: "s3" },
    { ts: "2026-05-14T09:00:40Z", rel: "screenshots/shot_02.png", kind: "manual", stepId: null },
    { ts: "2026-05-14T09:00:50Z", rel: "screenshots/analyst/a3.png", kind: "added", stepId: null },
  ], "one without a moment, or without an id, is not on the Timeline; a file is read by its name only");
  assert.deepEqual(AC.timelineShots(null, null), []);
});
