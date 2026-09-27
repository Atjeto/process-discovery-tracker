"use strict";

/* Lane MV: which picture the Map shows (map-view.js pick) and what its one
   header line says (line). The real Map, its analysis and its editor are in
   e2e/map-slim-smoke.js. */

const test = require("node:test");
const assert = require("node:assert");
const MV = require("./map-view.js");

const LIVE = { locked: false, drawable: true };
const FRESH = { exists: true, stale: false, plane: true };
const base = (o) => Object.assign({ want: "map", live: LIVE, copy: null, step: FRESH, busy: false, tried: false }, o);

test("the Map shows the process map (process_map_step.bpmn) by default, and the PDD prints it", () => {
  const p = MV.pick(base());
  assert.deepEqual(p, { view: "bpmn", source: "step", why: null, analyze: false, back: false });
  assert.deepEqual(MV.line(p, null, ""), {
    title: "Process map", note: "(the PDD prints this map)", edit: false, stale: "",
    toRuns: "Show how the transactions ran", toMap: "",
  });
});

test("an As-Is copy chosen for the PDD shows instead, with its Edit, and needs no analysis", () => {
  const p = MV.pick(base({ copy: { plane: true }, step: { exists: true, stale: true, plane: true } }));
  assert.deepEqual(p, { view: "bpmn", source: "copy", why: null, analyze: false, back: false });
  const l = MV.line(p, { plane: true }, "Order entry As-Is");
  assert.equal(l.title, "Order entry As-Is");
  assert.equal(l.note, "(edited; the PDD prints this map)");
  assert.equal(l.edit, true);
  assert.equal(MV.line(p, { plane: true }, "  ").title, "As-Is map");
  assert.equal(l.stale, "", "a copy made from the steps as they are says nothing more");
});

test("lane FX2: an As-Is copy made before the steps changed says so on the header line, before its Copy again", () => {
  const p = MV.pick(base({ copy: { plane: true, stale: true } }));
  assert.equal(p.source, "copy");
  const l = MV.line(p, { plane: true, stale: true }, "As-Is map");
  assert.equal(l.stale, "Made before the steps changed: check it, or");
  assert.equal(MV.RECOPY, "Copy again");
  assert.equal(l.edit, true);
  // Only the copy shown says it: the process map and the live view do not.
  assert.equal(MV.line(MV.pick(base({ copy: { plane: false, stale: true } })), { plane: false, stale: true }, "As-Is map").stale, "");
  assert.equal(MV.line(MV.pick(base({ want: "runs", copy: { plane: true, stale: true } })), { plane: true, stale: true }, "As-Is map").stale, "");
});

test("a copy not drawn yet is drawn first: whether it has the level's map is known then", () => {
  assert.equal(MV.pick(base({ copy: { plane: null } })).source, "copy");
});

test("C19: a copy with no map for the sub-process shown leaves it to the process map's, and says so", () => {
  const p = MV.pick(base({ copy: { plane: false } }));
  assert.equal(p.view, "bpmn");
  assert.equal(p.source, "step");
  assert.equal(p.why, MV.WHY.COPY_LACKS_STEP);
  assert.equal(MV.line(p, { plane: false }, "As-Is map").title, "Process map");
});

test("how the transactions ran is the analyst's second view, with the way back named by what shows", () => {
  const p = MV.pick(base({ want: "runs", step: { exists: true, stale: true, plane: true } }));
  assert.deepEqual(p, { view: "runs", source: null, why: null, analyze: false, back: true });
  const l = MV.line(p, null, "");
  assert.equal(l.title, "How the transactions ran");
  assert.match(l.note, /how often it was taken/);
  assert.match(l.note, /a dashed line is a path no transaction took/);
  assert.equal(l.toRuns, "");
  assert.equal(l.toMap, "Show the process map");
  assert.equal(MV.line(p, { plane: true }, "As-Is map").toMap, "Show the As-Is map");
  assert.equal(MV.line(p, { plane: false }, "As-Is map").toMap, "Show the process map");
});

test("a step map older than the steps is analyzed once, and the previous picture stays meanwhile", () => {
  const stale = { exists: true, stale: true, plane: true };
  const first = MV.pick(base({ step: stale }));
  assert.deepEqual(first, { view: "bpmn", source: "step", why: null, analyze: true, back: false });
  // While it runs (the Map's own, or any other queued or running).
  assert.deepEqual(MV.pick(base({ step: stale, busy: true })), { view: "bpmn", source: "step", why: null, analyze: false, back: false });
  // Never again for the same change: the live map says why.
  const after = MV.pick(base({ step: stale, tried: true }));
  assert.deepEqual(after, { view: "runs", source: null, why: MV.WHY.NOT_UPDATED, analyze: false, back: false });
  assert.deepEqual(MV.line(after, null, ""), {
    title: "How the transactions ran", note: MV.NOTE.RUNS, edit: false, stale: "", toRuns: "", toMap: "",
  });
});

test("no step map yet: it is drawn first (the live map says so meanwhile), and a failed attempt says so", () => {
  const none = { exists: false, stale: true, plane: null };
  assert.deepEqual(MV.pick(base({ step: none })), { view: "runs", source: null, why: MV.WHY.DRAWING, analyze: true, back: false });
  assert.deepEqual(MV.pick(base({ step: none, busy: true })), { view: "runs", source: null, why: MV.WHY.DRAWING, analyze: false, back: false });
  assert.deepEqual(MV.pick(base({ step: none, tried: true })), { view: "runs", source: null, why: MV.WHY.NOT_DRAWN, analyze: false, back: false });
});

test("a copy with no map for the level, and no process map to show, says both", () => {
  const p = MV.pick(base({ copy: { plane: false }, step: { exists: false, stale: true, plane: null }, tried: true }));
  assert.equal(p.view, "runs");
  assert.equal(p.why, MV.WHY.COPY_LACKS + " " + MV.WHY.NOT_DRAWN);
});

test("a step map with no map for the level: drawn again when an update runs, else said", () => {
  assert.equal(MV.pick(base({ step: { exists: true, stale: false, plane: false } })).why, MV.WHY.NO_PLANE);
  assert.equal(MV.pick(base({ step: { exists: true, stale: false, plane: false }, busy: true })).why, MV.WHY.DRAWING);
});

test("while the live map says why it draws nothing (locked, or no step), nothing else shows and nothing is analyzed", () => {
  const none = { view: "runs", source: null, why: null, analyze: false, back: false };
  const stale = { exists: true, stale: true, plane: true };
  assert.deepEqual(MV.pick(base({ live: { locked: true, drawable: false }, step: stale })), none);
  assert.deepEqual(MV.pick(base({ live: { locked: false, drawable: false }, step: stale, copy: { plane: true } })), none);
  assert.deepEqual(MV.pick(base({ live: { locked: false, drawable: false }, want: "runs" })), none);
});

test("the analyst's live view never analyzes", () => {
  const p = MV.pick(base({ want: "runs", step: { exists: false, stale: true, plane: null } }));
  assert.equal(p.analyze, false);
  assert.equal(p.back, true);
});

test("the Map's words carry no dash between clauses", () => {
  const texts = [].concat(Object.values(MV.WHY), Object.values(MV.TITLE), Object.values(MV.NOTE),
    [MV.TO_RUNS, MV.TO_STEP, MV.TO_COPY, MV.STALE, MV.STALE_LABELS, MV.RECOPY]);
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]| - |--");
  for (const t of texts) assert.doesNotMatch(t, dash, t);
});

test("2.0.1: a copy drawn in colours, before the system labels, says so before Copy again", () => {
  const p = { view: "bpmn", source: "copy" };
  assert.equal(MV.line(p, { plane: null, stale: "labels" }, "As-Is map").stale, MV.STALE_LABELS);
  assert.equal(MV.line(p, { plane: null, stale: true }, "As-Is map").stale, MV.STALE);
  assert.equal(MV.line(p, { plane: null, stale: false }, "As-Is map").stale, "");
});
