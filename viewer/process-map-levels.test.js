"use strict";

/*
 * Unit tests for process-map-levels.js -- the step/phase DFG builder
 * (ADR-0010 C1b). Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildAnnotationDfg, dropRareEdges, processLabel,
  rollUpSteps, resolveStepGrainKeys, screenType, GRAIN_NOTCHES, DEFAULT_GRAIN,
} = require("./process-map-levels.js");

const GOLDEN = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "shared", "process-label-golden.json"), "utf8"));

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

test("processLabel matches the cross-language golden (Python twin must agree)", () => {
  // The same golden is asserted in normalization/test/test_process_label.py;
  // if these diverge, the live DFG and the mined BPMN/stats collapse differently.
  for (const [name, expected] of GOLDEN.cases) {
    assert.equal(processLabel(name), expected, JSON.stringify(name));
  }
});

/* ===== ADR-0024: view-time grain roll-up ============================== */

// A step carrying grain_keys (the stamped containment keys).
function gstep(id, name, caseId, startMs, grainKeys, phaseId) {
  return {
    step_id: id, name, case_id: caseId, phase_id: phaseId || null,
    state: "auto_suggested", grain_keys: grainKeys,
    process_label: processLabel(name),
    time_range: { start: new Date(startMs).toISOString(), end: new Date(startMs + 1000).toISOString() },
  };
}

// The committed Outlook corpus shape: 3 drafts (cases), 3 fields each, all on
// the vocab "compose" screen in OUTLOOK. The acceptance: element=9, screen=3.
function outlookCorpusSteps() {
  const steps = [];
  let t = 1000;
  ["c1", "c2", "c3"].forEach((cid) => {
    steps.push(gstep(cid + "-to", "Untitled: Enter " + cid + "@x in To (recipients)", cid, t += 1000, { element: "4117", screen: "compose", app: "OUTLOOK" }));
    steps.push(gstep(cid + "-cc", "Untitled: Enter records in Cc", cid, t += 1000, { element: "4126", screen: "compose", app: "OUTLOOK" }));
    steps.push(gstep(cid + "-su", "Untitled: Enter Order " + cid + " in Subject", cid, t += 1000, { element: "4101", screen: "compose", app: "OUTLOOK" }));
  });
  return steps;
}

test("rollUpSteps: element notch reproduces the fine count (detail never destroyed)", () => {
  const steps = outlookCorpusSteps();
  assert.equal(rollUpSteps(steps, "element").length, 9);   // every step shown
});

test("rollUpSteps: screen notch lands the sensible 'one step per screen' count", () => {
  const steps = outlookCorpusSteps();
  // 3 drafts, each To/Cc/Subject all on the 'compose' screen -> 1 per case -> 3.
  const groups = rollUpSteps(steps, "screen");
  assert.equal(groups.length, 3);
  for (const g of groups) {
    assert.equal(g.label, "compose");
    assert.equal(g.count, 3);                              // 3 fine steps folded
    assert.deepEqual(g.step_ids.length, 3);
  }
});

test("rollUpSteps: app and case notches both collapse the corpus to 3", () => {
  const steps = outlookCorpusSteps();
  assert.equal(rollUpSteps(steps, "app").length, 3);
  assert.equal(rollUpSteps(steps, "case").length, 3);
});

test("rollUpSteps: phase notch folds unphased runs per case", () => {
  const steps = outlookCorpusSteps();             // all unphased
  const g = rollUpSteps(steps, "phase");
  assert.equal(g.length, 3);                      // one '(unphased)' run per case
  assert.equal(g[0].label, "(unphased)");
});

test("rollUpSteps: collapse is run-based — a screen revisited after another screen is two groups", () => {
  // Same screen S1, then S2, then S1 again, all one case: 3 runs, not 2.
  const steps = [
    gstep("a", "x", "c1", 1000, { element: "e1", screen: "S1", app: "A" }),
    gstep("b", "y", "c1", 2000, { element: "e2", screen: "S2", app: "A" }),
    gstep("c", "z", "c1", 3000, { element: "e3", screen: "S1", app: "A" }),
  ];
  assert.equal(rollUpSteps(steps, "screen").length, 3);
});

test("rollUpSteps: hidden steps are excluded", () => {
  const steps = outlookCorpusSteps();
  steps[0].state = "hidden";
  assert.equal(rollUpSteps(steps, "element").length, 8);
});

test("rollUpSteps: falls back to resolving grain_keys from events when absent", () => {
  // No grain_keys on the steps -> resolve from the interaction map (old session).
  const evs = {
    "i1": { event_id: "i1", data: { kind: "value_changed", automation_id: "4117", screen_id: "compose", process_name: "OUTLOOK.exe" } },
    "i2": { event_id: "i2", data: { kind: "value_changed", automation_id: "4126", screen_id: "compose", process_name: "OUTLOOK.exe" } },
  };
  const steps = [
    { step_id: "a", case_id: "c1", state: "auto_suggested", name: "To", time_range: { start: new Date(1000).toISOString(), end: new Date(2000).toISOString() }, evidence: { interaction_event_ids: ["i1"] } },
    { step_id: "b", case_id: "c1", state: "auto_suggested", name: "Cc", time_range: { start: new Date(2000).toISOString(), end: new Date(3000).toISOString() }, evidence: { interaction_event_ids: ["i2"] } },
  ];
  const ctx = { interactionsById: evs };
  assert.equal(rollUpSteps(steps, "screen", ctx).length, 1);   // both 'compose'
  assert.equal(rollUpSteps(steps, "element", ctx).length, 2);  // distinct fields
});

test("resolveStepGrainKeys mirrors the Python rules (typed field wins over nav)", () => {
  const evs = {
    "tab": { event_id: "tab", data: { kind: "selection_changed", name: "Message", process_name: "OUTLOOK.exe" } },
    "to": { event_id: "to", data: { kind: "value_changed", automation_id: "4117", name: "To", screen_id: "compose", process_name: "OUTLOOK.exe" } },
  };
  const step = { evidence: { interaction_event_ids: ["tab", "to"] } };
  const k = resolveStepGrainKeys(step, evs);
  assert.equal(k.element, "4117");      // typed field beats the Message tab
  assert.equal(k.screen, "compose");
  assert.equal(k.app, "OUTLOOK");
});

test("buildAnnotationDfg: screen notch collapses the corpus to a single screen node", () => {
  const dfg = buildAnnotationDfg([{ annotations: { steps: outlookCorpusSteps() } }], "screen");
  // All steps on 'compose' -> one node, no edges; start/end count the 3 cases.
  assert.equal(dfg.edges.length, 0);
  assert.deepEqual(dfg.start_activities, { compose: 3 });
  assert.deepEqual(dfg.end_activities, { compose: 3 });
});

test("buildAnnotationDfg: 'step' and 'element' notches are equivalent (back-compat)", () => {
  const s = [{ annotations: { steps: outlookCorpusSteps() } }];
  assert.deepEqual(buildAnnotationDfg(s, "step"), buildAnnotationDfg(s, "element"));
});

test("GRAIN_NOTCHES ladder + default are exported", () => {
  assert.deepEqual(GRAIN_NOTCHES, ["element", "screen", "app", "phase", "case"]);
  assert.equal(DEFAULT_GRAIN, "screen");
});

/* ADR-0024 regression: a window-title screen key embeds the case value
 * ("Salesforce - Order #10900"), so grouping on the raw title made the same
 * logical screen a distinct node PER CASE -- the default screen-grain map fanned
 * out into a per-case hairball. screenType strips the embedded record values so
 * the screen axis collapses value-free, like process_label. */
test("screenType strips embedded record values but keeps the screen name", () => {
  assert.equal(screenType("Salesforce - Order #10900"), "Salesforce - Order");
  assert.equal(screenType("Salesforce - Order #11412"), "Salesforce - Order");
  assert.equal(screenType("Outlook - Order #10852 confirmation"), "Outlook - Order confirmation");
  // Genuinely different screens stay apart.
  assert.equal(screenType("Salesforce - Account lookup"), "Salesforce - Account lookup");
  assert.equal(screenType("Salesforce - Credit check"), "Salesforce - Credit check");
  // Short transaction codes survive (digit-run threshold is 3+).
  assert.equal(screenType("va01"), "va01");
  // Id-like tokens (CUST-10852) are stripped.
  assert.equal(screenType("Search — CUST-10852"), "Search");
  // A blank / all-value title never collapses to "".
  assert.equal(screenType(""), "");
  assert.ok(screenType("#10900").length > 0);
});

test("screen notch collapses per-case window titles to ONE value-free node (no fan-out)", () => {
  // Two cases on the SAME 3 logical screens, each title carrying its order #.
  const mk = (id, scr, cid, t) => ({
    step_id: id, case_id: cid, state: "auto_suggested",
    grain_keys: { element: "f", screen: scr, app: "chrome" },
    time_range: { start: new Date(t).toISOString(), end: new Date(t + 100).toISOString() },
  });
  const steps = [
    mk("a1", "Salesforce - Account lookup", "c1", 1000),
    mk("a2", "Salesforce - Order #10900", "c1", 2000),
    mk("a3", "Outlook - Order #10900 confirmation", "c1", 3000),
    mk("b1", "Salesforce - Account lookup", "c2", 4000),
    mk("b2", "Salesforce - Order #10901", "c2", 5000),
    mk("b3", "Outlook - Order #10901 confirmation", "c2", 6000),
  ];
  const dfg = buildAnnotationDfg([{ annotations: { steps } }], "screen");
  const nodes = new Set();
  for (const e of dfg.edges) { nodes.add(e.source); nodes.add(e.target); }
  // 3 logical screens, not 5 (the two #-suffixed titles per case would otherwise
  // each be their own node). One linear chain, one start, one end.
  assert.equal(nodes.size, 3);
  assert.deepEqual(Object.keys(dfg.start_activities), ["Salesforce - Account lookup"]);
  assert.deepEqual(Object.keys(dfg.end_activities), ["Outlook - Order confirmation"]);
  // The shared transition is frequency 2 (both cases follow the same path).
  const e = dfg.edges.find((x) => x.source === "Salesforce - Account lookup");
  assert.equal(e.target, "Salesforce - Order");
  assert.equal(e.frequency, 2);
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
