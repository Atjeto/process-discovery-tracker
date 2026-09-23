"use strict";

/*
 * Unit tests for process-map-levels.js: the one process map, built from the
 * runs' steps. Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildAnnotationDfg, mapNodeLabel, processLabel,
  resolveStepGrainKeys, screenType,
} = require("./process-map-levels.js");

const GOLDEN = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "shared", "process-label-golden.json"), "utf8"));
const SCREEN_GOLDEN = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "shared", "screen-label-golden.json"), "utf8"));

// An em dash, built from its code so this file itself carries none.
const EM = String.fromCharCode(0x2014);

function step(id, name, caseId, startMs) {
  return {
    step_id: id, name, case_id: caseId,
    state: "edited",
    time_range: { start: new Date(startMs).toISOString(), end: new Date(startMs + 1000).toISOString() },
  };
}

/* A drafted step (contract C1): it carries a draft_key, and its name is the
   drafted name (or the analyst's rename). */
function draft(id, name, caseId, startMs, state) {
  return Object.assign(step(id, name, caseId, startMs), {
    state: state || "auto_suggested",
    draft_key: "app|" + name + "|Button:save",
  });
}

test("one run yields a linear chain of step-name edges", () => {
  const dfg = buildAnnotationDfg([[
    step("a", "Open ticket", "c1", 1000),
    step("b", "Look up serial", "c1", 2000),
    step("c", "Write resolution", "c1", 3000),
  ]]);
  assert.equal(dfg.edges.length, 2);
  assert.deepEqual(dfg.start_activities, { "Open ticket": 1 });
  assert.deepEqual(dfg.end_activities, { "Write resolution": 1 });
  // names with spaces survive the edge keying
  const e0 = dfg.edges.find((e) => e.source === "Open ticket");
  assert.equal(e0.target, "Look up serial");
});

test("repeated runs give edges a frequency > 1", () => {
  // two runs, same 2-step shape -> the A->B edge has frequency 2
  const dfg = buildAnnotationDfg([
    [step("a1", "Search", "c1", 1000), step("b1", "Resolve", "c1", 2000)],
    [step("a2", "Search", "c2", 3000), step("b2", "Resolve", "c2", 4000)],
  ]);
  const edge = dfg.edges.find((e) => e.source === "Search" && e.target === "Resolve");
  assert.equal(edge.frequency, 2);
  assert.equal(dfg.start_activities["Search"], 2);
  assert.equal(dfg.end_activities["Resolve"], 2);
});

test("edges join consecutive steps WITHIN a run, never across runs", () => {
  // Run 1 ends on Resolve and run 2 starts on Search: no Resolve->Search edge.
  const dfg = buildAnnotationDfg([
    [step("a1", "Search", "c1", 1000), step("b1", "Resolve", "c1", 2000)],
    [step("a2", "Search", "c2", 3000), step("b2", "Resolve", "c2", 4000)],
  ]);
  assert.equal(dfg.edges.length, 1);
  assert.ok(!dfg.edges.some((e) => e.source === "Resolve" && e.target === "Search"));
});

test("a run's steps are ordered by start time (as the Steps list shows them)", () => {
  const dfg = buildAnnotationDfg([[
    step("b", "Resolve", "c1", 2000),
    step("a", "Search", "c1", 1000),
  ]]);
  assert.deepEqual(dfg.start_activities, { "Search": 1 });
  assert.equal(dfg.edges[0].source, "Search");
});

test("§B2: edges accumulate transition time across traversals (total_ms)", () => {
  // Per traversal the edge carries entering(source) -> entering(target).
  // run 1: Search@1s -> Resolve@2s (1000ms); run 2: Search@3s -> Resolve@7s (4000ms).
  const dfg = buildAnnotationDfg([
    [step("a1", "Search", "c1", 1000), step("b1", "Resolve", "c1", 2000)],
    [step("a2", "Search", "c2", 3000), step("b2", "Resolve", "c2", 7000)],
  ]);
  const edge = dfg.edges.find((e) => e.source === "Search" && e.target === "Resolve");
  assert.equal(edge.frequency, 2);
  assert.equal(edge.total_ms, 1000 + 4000);
});

test("§B2: a consecutive same-node run contributes its FULL dwell to the outgoing edge", () => {
  // Two Search steps collapse to one visit; the edge to Resolve carries the
  // time from entering the FIRST Search to entering Resolve.
  const dfg = buildAnnotationDfg([[
    step("a1", "Search", "c1", 1000),
    step("a2", "Search", "c1", 4000),     // same node (consecutive duplicate)
    step("b1", "Resolve", "c1", 9000),
  ]]);
  assert.equal(dfg.edges.length, 1);
  assert.equal(dfg.edges[0].frequency, 1);
  assert.equal(dfg.edges[0].total_ms, 8000);
});

test("§B2: a missing timestamp contributes 0 to total_ms, never a guess", () => {
  const steps = [
    step("a", "Search", "c1", 1000),
    step("b", "Resolve", "c1", 2000),
  ];
  delete steps[1].time_range;            // hand-authored step, no times
  const edge = buildAnnotationDfg([steps]).edges[0];
  assert.equal(edge.frequency, 1);
  assert.equal(edge.total_ms, 0);
});

test("hidden steps are excluded", () => {
  const steps = [
    step("a", "Keep", "c1", 1000),
    step("b", "Drop", "c1", 2000),
  ];
  steps[1].state = "hidden";
  const dfg = buildAnnotationDfg([steps]);
  // only one node, no edges
  assert.equal(dfg.edges.length, 0);
  assert.deepEqual(dfg.start_activities, { "Keep": 1 });
  assert.deepEqual(dfg.end_activities, { "Keep": 1 });
});

test("no runs, or runs without steps, yield an empty graph", () => {
  for (const runs of [[], [[]], undefined]) {
    const dfg = buildAnnotationDfg(runs);
    assert.deepEqual(dfg.edges, []);
    assert.deepEqual(dfg.start_activities, {});
    assert.deepEqual(dfg.end_activities, {});
  }
});

/* ---- The node key rule ------------------------------------------------- */

test("node rule: a drafted step is its own name, which the value rules would cut", () => {
  // processLabel's value-tail rule cuts a window-derived screen label down to
  // the app ("Salesforce - Order: Save order" -> "Salesforce"). A drafted name
  // is value-free by construction, so the map keeps it whole: two different
  // drafted Salesforce steps are two nodes, not one "Salesforce" blob.
  assert.equal(processLabel("Salesforce - Order: Save order"), "Salesforce", "precondition: the rule would cut it");
  const dfg = buildAnnotationDfg([[
    draft("a", "Salesforce - Account lookup: Search", "c1", 1000),
    draft("b", "Salesforce - Order: Save order", "c1", 2000),
  ]]);
  assert.equal(dfg.edges.length, 1);
  assert.equal(dfg.edges[0].source, "Salesforce - Account lookup: Search");
  assert.equal(dfg.edges[0].target, "Salesforce - Order: Save order");
});

test("node rule: a drafted step's name wins in every state, over a stale process_label", () => {
  // An edited draft (renamed after the last analysis) still carries the
  // process_label the pipeline stamped; the map shows the name the analyst
  // gave, which is what the next analysis stamps (43d307b).
  for (const state of ["auto_suggested", "confirmed", "edited"]) {
    const s = draft("a", "Look up the customer", "c1", 1000, state);
    s.process_label = "Salesforce";
    assert.equal(mapNodeLabel(s), "Look up the customer", state);
  }
});

test("node rule: a step without a draft_key groups by its process_label", () => {
  const stamped = step("a", "raw name, Value-1", "c1", 1000);
  stamped.process_label = "Canonical step";
  assert.equal(mapNodeLabel(stamped), "Canonical step", "the stamped label wins");
  // Unstamped: the shared value rules, live, so repeated work collapses.
  assert.equal(mapNodeLabel(step("b", "Salesforce: Search " + EM + " CUST-10101", "c1", 1000)), "Salesforce: Search");
  assert.equal(mapNodeLabel(step("c", "Salesforce: Fill Customer ID field", "c1", 1000)),
    "Salesforce: Fill Customer ID field", "a value-free name is left as it is");
  assert.equal(mapNodeLabel({ state: "manually_authored" }), "(unnamed step)");
});

test("node rule: value-laden hand-made names collapse to one node per step type across runs", () => {
  const dfg = buildAnnotationDfg([
    [step("a1", "Salesforce: Search " + EM + " CUST-10101", "c1", 1000), step("b1", "Salesforce: Enter 25 in Quantity", "c1", 2000)],
    [step("a2", "Salesforce: Search " + EM + " CUST-10102", "c2", 3000), step("b2", "Salesforce: Enter 30 in Quantity", "c2", 4000)],
  ]);
  const edge = dfg.edges.find((e) => e.source === "Salesforce: Search");
  assert.equal(edge.target, "Salesforce: Enter Quantity");
  assert.equal(edge.frequency, 2);          // both runs share the transition
  assert.deepEqual(Object.keys(dfg.start_activities), ["Salesforce: Search"]);
});

test("the same drafted step in several runs is one node (runs join into one graph)", () => {
  // Three runs of drafted steps; run 2 takes a detour and run 3 ends early.
  // Every run shares its first steps, so the map is one connected graph.
  const names = ["Account lookup: Search", "Order: Save order", "Tracker: Save workbook", "Confirmation: Send"];
  const run = (cid, t0, seq) => seq.map((i, k) => draft(cid + k, names[i], cid, t0 + k * 1000));
  const dfg = buildAnnotationDfg([
    run("r1", 1000, [0, 1, 2, 3]),
    run("r2", 20000, [0, 1, 2, 1, 2, 3]),
    run("r3", 40000, [0, 1, 2]),
  ]);
  const nodes = new Set();
  for (const e of dfg.edges) { nodes.add(e.source); nodes.add(e.target); }
  assert.equal(nodes.size, 4);
  assert.deepEqual(dfg.start_activities, { "Account lookup: Search": 3 });
  assert.deepEqual(dfg.end_activities, { "Confirmation: Send": 2, "Tracker: Save workbook": 1 });
  // A frequency counts traversals: run 2 takes Order -> Tracker twice (its detour).
  assert.equal(dfg.edges.find((e) => e.source === "Order: Save order" && e.target === "Tracker: Save workbook").frequency, 4);
});

/* ---- Shared value rules (the Steps level uses these too) ---------------- */

test("processLabel matches the cross-language golden (Python twin must agree)", () => {
  // The same golden is asserted in normalization/test/test_process_label.py;
  // if these diverge, the live map and the stats collapse differently.
  for (const [name, expected] of GOLDEN.cases) {
    assert.equal(processLabel(name), expected, JSON.stringify(name));
  }
});

test("screenType matches the cross-language screen-label golden (Python twin must agree)", () => {
  // The same golden is asserted in normalization/test/test_screen_label.py.
  for (const [name, expected] of SCREEN_GOLDEN.cases) {
    assert.equal(screenType(name), expected, JSON.stringify(name));
  }
});

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
  assert.equal(screenType("Search " + EM + " CUST-10852"), "Search");
  // A blank / all-value title never collapses to "".
  assert.equal(screenType(""), "");
  assert.ok(screenType("#10900").length > 0);
});

test("resolveStepGrainKeys mirrors the Python rules (typed field wins over nav)", () => {
  const evs = {
    "tab": { event_id: "tab", data: { kind: "selection_changed", name: "Message", process_name: "OUTLOOK.exe" } },
    "to": { event_id: "to", data: { kind: "value_changed", automation_id: "4117", name: "To", screen_id: "compose", process_name: "OUTLOOK.exe" } },
  };
  const s = { evidence: { interaction_event_ids: ["tab", "to"] } };
  const k = resolveStepGrainKeys(s, evs);
  assert.equal(k.element, "4117");      // typed field beats the Message tab
  assert.equal(k.screen, "compose");
  assert.equal(k.app, "OUTLOOK");
});

