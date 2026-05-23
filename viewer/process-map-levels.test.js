"use strict";

/*
 * Unit tests for process-map-levels.js -- the step/phase DFG builder
 * (ADR-0010 C1b). Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnnotationDfg, dropRareEdges } = require("./process-map-levels.js");

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

test("step level: value-laden names collapse to one node per step type (live)", () => {
  // Each case's order # / customer id makes the raw name unique; without
  // stripping the step-level DFG explodes into one node per instance. The
  // viewer strips the values live (processLabel) so the flow collapses
  // without a re-analyze.
  const s = sess([
    step("a1", "Salesforce: Search — CUST-10101", "c1", 1000),
    step("b1", "Salesforce: Enter 25 in Quantity", "c1", 2000),
    step("a2", "Salesforce: Search — CUST-10102", "c2", 3000),
    step("b2", "Salesforce: Enter 30 in Quantity", "c2", 4000),
  ]);
  const dfg = buildAnnotationDfg([s], "step");
  const edge = dfg.edges.find((e) => e.source === "Salesforce: Search");
  assert.equal(edge.target, "Salesforce: Enter Quantity");
  assert.equal(edge.frequency, 2);          // both cases share the transition
  assert.equal(dfg.start_activities["Salesforce: Search"], 2);
  assert.equal(Object.keys(dfg.start_activities).length, 1);
});

test("step level: a persisted process_label wins over the live strip", () => {
  const steps = [step("a", "raw name — Value-1", "c1", 1000)];
  steps[0].process_label = "Canonical step";
  const dfg = buildAnnotationDfg([sess(steps)], "step");
  assert.deepEqual(dfg.start_activities, { "Canonical step": 1 });
});

test("step level: value-free names are left untouched", () => {
  const dfg = buildAnnotationDfg(
    [sess([step("a", "Salesforce: Fill Customer ID field", "c1", 1000)])], "step");
  assert.deepEqual(dfg.start_activities, { "Salesforce: Fill Customer ID field": 1 });
});

test("step level: a phase filter scopes the map to that phase's steps (drill-down)", () => {
  const s = sess([
    step("a", "Search", "c1", 1000, "p1"),
    step("b", "Validate", "c1", 2000, "p1"),
    step("c", "Resolve", "c1", 3000, "p2"),
  ], [
    { phase_id: "p1", name: "Intake" },
    { phase_id: "p2", name: "Closeout" },
  ]);
  // Unscoped: Search -> Validate -> Resolve (2 edges across both phases).
  assert.equal(buildAnnotationDfg([s], "step").edges.length, 2);
  // Scoped to "Intake": only its two steps remain -> one edge.
  const scoped = buildAnnotationDfg([s], "step", { phaseName: "Intake" });
  assert.equal(scoped.edges.length, 1);
  assert.equal(scoped.edges[0].source, "Search");
  assert.equal(scoped.edges[0].target, "Validate");
  assert.deepEqual(scoped.start_activities, { "Search": 1 });
  assert.deepEqual(scoped.end_activities, { "Validate": 1 });
});

test("step level: an unphased filter scopes to steps with no phase", () => {
  const s = sess([
    step("a", "Open", "c1", 1000, "p1"),
    step("b", "Loose A", "c1", 2000),       // no phase
    step("c", "Loose B", "c1", 3000),       // no phase
  ], [{ phase_id: "p1", name: "Intake" }]);
  const scoped = buildAnnotationDfg([s], "step", { phaseName: "(unphased)" });
  assert.equal(scoped.edges.length, 1);
  assert.equal(scoped.edges[0].source, "Loose A");
  assert.equal(scoped.edges[0].target, "Loose B");
});

test("dropRareEdges hides one-off paths but keeps the dominant flow", () => {
  const dfg = {
    edges: [
      { source: "A", target: "B", frequency: 5 },
      { source: "B", target: "C", frequency: 4 },
      { source: "B", target: "X", frequency: 1 },   // one-off deviation
    ],
    start_activities: { A: 5 },
    end_activities: { C: 4, X: 1 },
  };
  const r = dropRareEdges(dfg);
  assert.equal(r.hidden, 1);
  assert.equal(r.dfg.edges.length, 2);
  assert.ok(!r.dfg.edges.some((e) => e.target === "X"));
  // X lost its only edge, so it drops out of the end markers too.
  assert.deepEqual(r.dfg.end_activities, { C: 4 });
});

test("dropRareEdges is a no-op when every edge is a singleton (no spread)", () => {
  const dfg = {
    edges: [
      { source: "A", target: "B", frequency: 1 },
      { source: "B", target: "C", frequency: 1 },
      { source: "C", target: "D", frequency: 1 },
    ],
    start_activities: { A: 1 },
    end_activities: { D: 1 },
  };
  const r = dropRareEdges(dfg);
  assert.equal(r.hidden, 0);
  assert.equal(r.dfg.edges.length, 3);   // never blank the map
});

test("dropRareEdges cutoff: minFreq=3 keeps only edges seen >= 3 times", () => {
  const dfg = {
    edges: [
      { source: "A", target: "B", frequency: 5 },
      { source: "B", target: "C", frequency: 3 },
      { source: "B", target: "X", frequency: 2 },
      { source: "X", target: "Y", frequency: 1 },
    ],
    start_activities: { A: 5 },
    end_activities: { C: 3, Y: 1 },
  };
  const r = dropRareEdges(dfg, 3);
  assert.equal(r.cutoff, 3);
  assert.equal(r.maxFreq, 5);
  assert.equal(r.hidden, 2);                            // the freq-2 and freq-1 edges
  assert.deepEqual(r.dfg.edges.map((e) => e.target).sort(), ["B", "C"]);
  assert.deepEqual(r.dfg.end_activities, { C: 3 });     // Y dropped with its edge
});

test("dropRareEdges cutoff: minFreq=1 shows every path (no-op)", () => {
  const dfg = {
    edges: [
      { source: "A", target: "B", frequency: 5 },
      { source: "B", target: "C", frequency: 1 },
      { source: "B", target: "X", frequency: 1 },
    ],
    start_activities: { A: 5 },
    end_activities: { C: 1, X: 1 },
  };
  const r = dropRareEdges(dfg, 1);
  assert.equal(r.hidden, 0);
  assert.equal(r.cutoff, 1);
  assert.equal(r.dfg.edges.length, 3);
});

test("dropRareEdges cutoff is clamped so the map is never blanked", () => {
  const dfg = {
    edges: [
      { source: "A", target: "B", frequency: 3 },
      { source: "B", target: "C", frequency: 2 },
      { source: "B", target: "X", frequency: 1 },
    ],
    start_activities: { A: 3 },
    end_activities: { C: 2, X: 1 },
  };
  // A cutoff above the busiest edge clamps to maxFreq (3), keeping just A->B.
  const r = dropRareEdges(dfg, 99);
  assert.equal(r.cutoff, 3);
  assert.equal(r.maxFreq, 3);
  assert.equal(r.dfg.edges.length, 1);
  assert.equal(r.dfg.edges[0].source, "A");
  assert.equal(r.dfg.edges[0].target, "B");
});
