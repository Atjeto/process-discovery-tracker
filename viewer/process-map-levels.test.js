"use strict";

/*
 * Unit tests for process-map-levels.js -- the step/phase DFG builder
 * (ADR-0010 C1b). Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnnotationDfg } = require("./process-map-levels.js");

function step(id, name, caseId, startMs, phaseId) {
  return {
    step_id: id, name, case_id: caseId, phase_id: phaseId || null,
    state: "edited",
    time_range: { start: new Date(startMs).toISOString(), end: new Date(startMs + 1000).toISOString() },
  };
}

function sess(steps, phases) {
  return { annotations: { steps, phases: phases || [] } };
}

test("step level: one case yields a linear chain of step-name edges", () => {
  const s = sess([
    step("a", "Open ticket", "c1", 1000),
    step("b", "Look up serial", "c1", 2000),
    step("c", "Write resolution", "c1", 3000),
  ]);
  const dfg = buildAnnotationDfg([s], "step");
  assert.equal(dfg.edges.length, 2);
  assert.deepEqual(dfg.start_activities, { "Open ticket": 1 });
  assert.deepEqual(dfg.end_activities, { "Write resolution": 1 });
  // names with spaces survive the edge keying
  const e0 = dfg.edges.find((e) => e.source === "Open ticket");
  assert.equal(e0.target, "Look up serial");
});

test("step level: repeated cases give edges a frequency > 1", () => {
  // two tickets, same 2-step shape -> the A->B edge has frequency 2
  const s = sess([
    step("a1", "Search", "c1", 1000),
    step("b1", "Resolve", "c1", 2000),
    step("a2", "Search", "c2", 3000),
    step("b2", "Resolve", "c2", 4000),
  ]);
  const dfg = buildAnnotationDfg([s], "step");
  const edge = dfg.edges.find((e) => e.source === "Search" && e.target === "Resolve");
  assert.equal(edge.frequency, 2);
  assert.equal(dfg.start_activities["Search"], 2);
  assert.equal(dfg.end_activities["Resolve"], 2);
});

test("phase level: collapses consecutive steps in the same phase to one node", () => {
  const s = sess([
    step("a", "s1", "c1", 1000, "p1"),
    step("b", "s2", "c1", 2000, "p1"),   // same phase as a -> collapses
    step("c", "s3", "c1", 3000, "p2"),
  ], [
    { phase_id: "p1", name: "Validate" },
    { phase_id: "p2", name: "Resolve" },
  ]);
  const dfg = buildAnnotationDfg([s], "phase");
  // Validate -> Resolve, single edge (the two p1 steps collapsed)
  assert.equal(dfg.edges.length, 1);
  assert.equal(dfg.edges[0].source, "Validate");
  assert.equal(dfg.edges[0].target, "Resolve");
});

test("hidden steps are excluded", () => {
  const steps = [
    step("a", "Keep", "c1", 1000),
    step("b", "Drop", "c1", 2000),
  ];
  steps[1].state = "hidden";
  const dfg = buildAnnotationDfg([sess(steps)], "step");
  // only one node, no edges
  assert.equal(dfg.edges.length, 0);
  assert.deepEqual(dfg.start_activities, { "Keep": 1 });
  assert.deepEqual(dfg.end_activities, { "Keep": 1 });
});

test("no steps yields an empty graph", () => {
  const dfg = buildAnnotationDfg([sess([])], "step");
  assert.deepEqual(dfg.edges, []);
  assert.deepEqual(dfg.start_activities, {});
});
