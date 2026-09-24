"use strict";

/*
 * Unit tests for sub-process-maps.js (contract C19): the maps a project
 * holds, pinned by shared/sub-process-maps-golden.json (the pipeline's
 * normalization/sub_process_maps.py pins the same file), and the helpers the
 * Steps level works with at one level. Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SPM = require("./sub-process-maps.js");
const { buildAnnotationDfg, flowEdges, START, END } = require("./process-map-levels.js");

const GOLDEN = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "shared", "sub-process-maps-golden.json"), "utf8"));

/* Steps from the golden's fixtures: a step is named by its map node (its
   process_label is its name), has no time and takes its place from `order`;
   a link names its target by name within its own list (the same sub_steps
   list, or the same transaction at the main level), as the golden says. */
function build(list, prefix, caseId) {
  const ids = new Map();
  list.forEach((s, i) => { if (!ids.has(s.name)) ids.set(s.name, prefix + i); });
  return list.map((s, i) => {
    const st = { step_id: prefix + i, name: s.name, process_label: s.name, case_id: caseId,
      state: s.state || "manually_authored", time_range: null, order: i + 1 };
    if (s.only_when) st.only_when = s.only_when;
    if (s.links) st.links = s.links.map((l) => ({ to: l.to === "end" ? "end" : (ids.get(l.to) || l.to), when: l.when }));
    if (Array.isArray(s.sub_steps)) st.sub_steps = build(s.sub_steps, st.step_id + ".", caseId);
    return st;
  });
}
function transactionsOf(c) {
  return c.transactions.map((tx, t) => build(tx, "t" + t + "s", "t" + t));
}

/* A map's edges as the golden writes them (the flow-links golden's form). */
function goldenEdges(traces) {
  const name = (n) => (n === START ? "start" : n === END ? "end" : n);
  return flowEdges(buildAnnotationDfg(traces))
    .map((e) => ({ from: name(e.from), to: name(e.to), label: e.label, observed: e.observed }))
    .sort((a, b) => (a.from + ">" + a.to).localeCompare(b.from + ">" + b.to));
}

test("C19: mapTree matches every case of the shared sub-process maps golden (paths, numbers, traces and edges)", () => {
  assert.ok(GOLDEN.cases.length >= 12, "precondition: the golden has its cases");
  for (const c of GOLDEN.cases) {
    const got = SPM.mapTree(transactionsOf(c), { reference: c.reference });
    const want = c.expected_maps;
    assert.deepEqual(got.map((m) => m.path), want.map((m) => m.path), c.name + ": the maps, depth first");
    got.forEach((m, i) => {
      const w = want[i];
      assert.equal(m.number, w.number, c.name + " " + JSON.stringify(w.path) + ": number");
      assert.deepEqual(m.traces.map((tr) => tr.map((s) => s.name)), w.traces, c.name + " " + JSON.stringify(w.path) + ": traces");
      const edges = w.edges.slice().sort((a, b) => (a.from + ">" + a.to).localeCompare(b.from + ">" + b.to));
      assert.deepEqual(goldenEdges(m.traces), edges, c.name + " " + JSON.stringify(w.path) + ": edges");
    });
  }
});

test("C19 (the golden's thirteenth case at merge): a sub-process node is ordered and numbered by its first appearance at its level, even a visit without sub_steps", () => {
  const txs = transactionsOf({ transactions: [
    [{ name: "B" }, { name: "A", sub_steps: [{ name: "a1" }] }, { name: "B", sub_steps: [{ name: "b1" }] }],
  ] });
  const maps = SPM.mapTree(txs, { reference: 0 });
  assert.deepEqual(maps.map((m) => [m.path, m.number, m.traces.map((tr) => tr.map((s) => s.name))]), [
    [[], null, [["B", "A", "B"]]],
    [["B"], "1", [["b1"]]],
    [["A"], "2", [["a1"]]],
  ]);
  assert.deepEqual(goldenEdges(maps[0].traces).map((e) => e.from + ">" + e.to).sort(),
    ["A>B", "B>A", "B>end", "start>B"].sort());
});

test("mapTree names the transaction each trace came from", () => {
  const txs = transactionsOf({ transactions: [
    [{ name: "A", sub_steps: [{ name: "a1" }] }, { name: "C" }, { name: "A", sub_steps: [{ name: "a2" }] }],
    [{ name: "C" }],
    [{ name: "A", sub_steps: [{ name: "a3" }] }],
  ] });
  const maps = SPM.mapTree(txs);
  assert.deepEqual(maps.map((m) => m.transactions), [[0, 1, 2], [0, 0, 2]]);
});

test("mapTree: no transaction is one main map with no traces; a reference out of range is the first transaction", () => {
  assert.deepEqual(SPM.mapTree([]), [{ path: [], number: null, traces: [], transactions: [] }]);
  const txs = transactionsOf({ transactions: [[{ name: "A", sub_steps: [{ name: "a1" }] }]] });
  assert.deepEqual(SPM.mapTree(txs, { reference: 7 }).map((m) => [m.path, m.number]), [[[], null], [["A"], "1"]]);
});

test("a timed sub-step orders by its time, whatever its place in the list", () => {
  const txs = transactionsOf({ transactions: [[{ name: "A", sub_steps: [{ name: "late" }, { name: "early" }] }]] });
  const subs = txs[0][0].sub_steps;
  subs[0].time_range = { start: "2026-05-14T09:00:10Z", end: "2026-05-14T09:00:11Z" };
  subs[1].time_range = { start: "2026-05-14T09:00:01Z", end: "2026-05-14T09:00:02Z" };
  assert.deepEqual(SPM.mapTree(txs)[1].traces.map((t) => t.map((s) => s.name)), [["early", "late"]]);
});

test("steps that start at the same moment keep their list order (two recorded actions can share a second)", () => {
  const same = { start: "2026-05-14T09:04:40Z", end: "2026-05-14T09:04:40Z" };
  const subs = [{ step_id: "zz", name: "first" }, { step_id: "aa", name: "second" }, { step_id: "mm", name: "third" }]
    .map((s) => Object.assign(s, { time_range: same }));
  assert.deepEqual(SPM.inOrder(subs).map((s) => s.name), ["first", "second", "third"], "not by id");
});

/* ---- The tree finder and the level helpers --------------------------------- */

function sample() {
  return transactionsOf({ transactions: [
    [{ name: "A" }, { name: "B", sub_steps: [{ name: "b1" }, { name: "b2", state: "hidden" }, { name: "b3", sub_steps: [{ name: "z" }] }] }, { name: "C" }, { name: "B", sub_steps: [{ name: "b4" }] }],
    [{ name: "A" }, { name: "B" }, { name: "C" }],
    [{ name: "B", sub_steps: [] }, { name: "C" }],
  ] });
}

test("findStep finds a step at any depth, with the list that holds it, its parent and the path of its level", () => {
  const txs = sample();
  const root = txs.flat();
  const z = SPM.findStep(root, "t0s1.2.0");
  assert.equal(z.step.name, "z");
  assert.equal(z.parent.name, "b3");
  assert.equal(z.list, root[1].sub_steps[2].sub_steps, "the very array that holds it");
  assert.equal(z.index, 0);
  assert.equal(z.depth, 2);
  assert.deepEqual(z.path, ["B", "b3"]);
  const top = SPM.findStep(root, "t1s2");
  assert.deepEqual([top.step.name, top.parent, top.depth, top.path], ["C", null, 0, []]);
  assert.equal(top.list, root);
  assert.equal(SPM.findStep(root, "nope"), null);
  assert.equal(SPM.findStep(root, ""), null);
});

test("allSteps and descendants walk every depth, parents first", () => {
  const txs = sample();
  assert.deepEqual(SPM.descendants(txs[0][1]).map((s) => s.name), ["b1", "b2", "b3", "z"]);
  assert.deepEqual(SPM.descendants(txs[0][0]), []);
  assert.equal(SPM.allSteps(txs.flat()).length, 9 + 5);
});

test("removeSteps takes steps out of the lists that hold them, in place", () => {
  const txs = sample();
  const root = txs.flat();
  const subs = root[1].sub_steps;
  const taken = SPM.removeSteps(root, new Set(["t0s1.0", "t0s1.2.0", "t2s1"]));
  assert.deepEqual(taken.map((s) => s.name).sort(), ["C", "b1", "z"]);
  assert.equal(root[1].sub_steps, subs, "the parent keeps its array");
  assert.deepEqual(subs.map((s) => s.name), ["b2", "b3"]);
  assert.deepEqual(subs[1].sub_steps, []);
});

test("levelVisits: one place per transaction at the main level; below it one per visit of the node, with its hidden steps", () => {
  const txs = sample();
  const main = SPM.levelVisits(txs, []);
  assert.deepEqual(main.map((v) => [v.t, v.index, v.members.length]), [[0, 0, 4], [1, 0, 3], [2, 0, 2]]);
  const inB = SPM.levelVisits(txs, ["B"]);
  // Transaction 0 visits B twice; transaction 1's B has no sub-steps (no
  // place); transaction 2's B is an empty sub-process (a place with none).
  assert.deepEqual(inB.map((v) => [v.t, v.index, v.members.map((s) => s.name), v.visible.map((s) => s.name)]), [
    [0, 0, ["b1", "b2", "b3"], ["b1", "b3"]],
    [0, 1, ["b4"], ["b4"]],
    [2, 0, [], []],
  ]);
  assert.deepEqual(inB[0].parents.map((p) => p.step_id), ["t0s1"]);
  assert.deepEqual(SPM.levelVisits(txs, ["B", "b3"]).map((v) => v.members.map((s) => s.name)), [["z"]]);
  assert.equal(SPM.placeOf(txs, ["B"], "t0s3.0").index, 1, "the place that holds a step");
  assert.equal(SPM.placeOf(txs, ["B"], "t0s0"), null);
});

test("nodeVisits and levelStepsOfNode: every visit of a node at a level, in transaction order", () => {
  const txs = sample();
  assert.deepEqual(SPM.nodeVisits(txs, [], "B").map((v) => [v.t, v.index, v.steps.map((s) => s.step_id)]),
    [[0, 0, ["t0s1"]], [0, 1, ["t0s3"]], [1, 0, ["t1s1"]], [2, 0, ["t2s0"]]]);
  assert.deepEqual(SPM.nodeVisits(txs, ["B"], "b3").map((v) => v.steps.map((s) => s.step_id)), [["t0s1.2"]]);
  assert.deepEqual(SPM.levelStepsOfNode(txs, ["B"], "b2").map((s) => s.step_id), ["t0s1.1"], "hidden steps too");
});

test("validPath keeps the start of a path whose maps are still there", () => {
  const txs = sample();
  assert.deepEqual(SPM.validPath(txs, ["B", "b3"]), ["B", "b3"]);
  assert.deepEqual(SPM.validPath(txs, ["B", "b1"]), ["B"], "b1 is no sub-process");
  assert.deepEqual(SPM.validPath(txs, ["C"]), []);
  txs[0][1].sub_steps[2].state = "hidden";
  assert.deepEqual(SPM.validPath(txs, ["B", "b3"]), ["B"], "a hidden sub-process has no map");
  assert.equal(SPM.isSubProcessNode(txs, [], "B"), true);
  assert.equal(SPM.isSubProcessNode(txs, [], "A"), false);
});

test("nodeName: a level goes by the name of its node's first step, the reference transaction's first", () => {
  const txs = sample();
  txs[2][0].name = "B in transaction 3";
  assert.equal(SPM.nodeName(txs, ["B"], 0), "B");
  assert.equal(SPM.nodeName(txs, ["B"], 2), "B in transaction 3");
  assert.equal(SPM.nodeName(txs, ["B", "b3"], 0), "b3");
  assert.equal(SPM.nodeName(txs, [], 0), "");
});

test("numberOf: the hierarchical number of a map through the reference transaction", () => {
  const txs = sample();
  assert.equal(SPM.numberOf(txs, ["B"], 0), "2");
  assert.equal(SPM.numberOf(txs, ["B", "b3"], 0), "2.2", "b3 is the second visible step of B's first visit");
  assert.equal(SPM.numberOf(txs, ["B"], 2), "1");
  assert.equal(SPM.numberOf(txs, [], 0), null);
  assert.equal(SPM.numberOf(txs, ["Q"], 0), null);
});
