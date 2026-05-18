/*
 * Unit tests for analysis-aggregate.js -- the pure cross-session rollup
 * behind the Compare-Sessions Analysis panel.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateAnalysis } = require("./analysis-aggregate.js");

/* Build a loaded-session shape with just the fields aggregateAnalysis
   reads. `worker` rides in the manifest config block. */
function session(opts) {
  return {
    sessionFolder: "C:/sessions/" + (opts.name || "s"),
    manifest: {
      started_at: opts.startedAt || null,
      config: { worker: { id: opts.worker || "w1" } },
    },
    stats: { meta: {} },
    analysis: {
      time_study: opts.time_study || [],
      automation_candidates: opts.automation || [],
      efficiency: opts.efficiency || {},
    },
  };
}

function tsEntry(mean, instances, canonical, name) {
  return {
    canonical_step_id: canonical === undefined ? "c1" : canonical,
    name: name || "Enter order",
    instances,
    cycle_ms: { mean, min: mean, max: mean },
    active_ms: mean * instances,
    waiting_ms: 0,
    switching_ms: 0,
  };
}

function autoEntry(signature, opts) {
  opts = opts || {};
  return {
    canonical_step_id: "c1",
    name: "Lookup customer",
    instances: opts.instances || 1,
    scores: { repetitiveness: null, rule_based: null, volume: opts.volume || 1000 },
    sequence_signature: signature,
    estimated_savings_ms: null,
    automation_confirmed: opts.confirmed === undefined ? null : opts.confirmed,
    data_sufficiency: "single_instance",
  };
}

/* ---- empty / skip behaviour --------------------------------------- */

test("empty input yields a zero-session result", () => {
  const r = aggregateAnalysis([]);
  assert.equal(r.sessionCount, 0);
  assert.deepEqual(r.time_study, []);
  assert.deepEqual(r.automation, []);
  assert.deepEqual(r.efficiency_trend, []);
});

test("sessions without an analysis sidecar are ignored", () => {
  const r = aggregateAnalysis([
    { sessionFolder: "x", manifest: {} },
    session({ efficiency: { process_efficiency_ratio: 0.6 } }),
  ]);
  assert.equal(r.sessionCount, 1);
});

/* ---- cross-session time study ------------------------------------- */

test("time study pools instances across sessions by canonical id", () => {
  const r = aggregateAnalysis([
    session({ time_study: [tsEntry(100, 2)] }),
    session({ time_study: [tsEntry(200, 3)] }),
  ]);
  assert.equal(r.time_study.length, 1);
  const g = r.time_study[0];
  assert.equal(g.sessions, 2);
  assert.equal(g.instances, 5);
  // Pooled mean = (100*2 + 200*3) / 5 = 800 / 5 = 160.
  assert.equal(g.cycle_ms.mean, 160);
});

test("steps with no canonical id pool by name", () => {
  const r = aggregateAnalysis([
    session({ time_study: [tsEntry(50, 1, null, "Review")] }),
    session({ time_study: [tsEntry(70, 1, null, "Review")] }),
  ]);
  assert.equal(r.time_study.length, 1);
  assert.equal(r.time_study[0].sessions, 2);
});

/* ---- per-worker comparison ---------------------------------------- */

test("per-worker comparison groups time study by worker", () => {
  const r = aggregateAnalysis([
    session({ worker: "alice", time_study: [tsEntry(100, 1)] }),
    session({ worker: "bob", time_study: [tsEntry(300, 1)] }),
  ]);
  assert.equal(r.by_worker.length, 2);
  const alice = r.by_worker.find((w) => w.worker === "alice");
  assert.equal(alice.steps[0].mean_cycle_ms, 100);
  const bob = r.by_worker.find((w) => w.worker === "bob");
  assert.equal(bob.steps[0].mean_cycle_ms, 300);
});

/* ---- aggregated automation ---------------------------------------- */

test("identical signatures across sessions score full repetitiveness", () => {
  const r = aggregateAnalysis([
    session({ automation: [autoEntry("abc")] }),
    session({ automation: [autoEntry("abc")] }),
    session({ automation: [autoEntry("abc")] }),
  ]);
  assert.equal(r.automation.length, 1);
  const a = r.automation[0];
  assert.equal(a.sessions, 3);
  assert.equal(a.instances, 3);
  assert.equal(a.repetitiveness, 1);
  assert.equal(a.data_sufficiency, "multi_instance");
});

test("varied signatures lower the aggregated rule-based score", () => {
  const r = aggregateAnalysis([
    session({ automation: [autoEntry("abc")] }),
    session({ automation: [autoEntry("xyz")] }),
  ]);
  // Two distinct signatures across two sessions -> rule_based = 1/2.
  assert.equal(r.automation[0].rule_based, 0.5);
});

test("a single session leaves automation scores null", () => {
  const r = aggregateAnalysis([session({ automation: [autoEntry("abc")] })]);
  assert.equal(r.automation[0].repetitiveness, null);
  assert.equal(r.automation[0].rule_based, null);
});

test("confirmed and dismissed decisions roll up as counts", () => {
  const r = aggregateAnalysis([
    session({ automation: [autoEntry("s", { confirmed: true })] }),
    session({ automation: [autoEntry("s", { confirmed: true })] }),
    session({ automation: [autoEntry("s", { confirmed: false })] }),
  ]);
  assert.equal(r.automation[0].confirmed, 2);
  assert.equal(r.automation[0].dismissed, 1);
});

/* ---- efficiency trend --------------------------------------------- */

test("efficiency trend is ordered by session start time", () => {
  const r = aggregateAnalysis([
    session({ name: "later", startedAt: "2026-05-10T00:00:00Z",
              efficiency: { process_efficiency_ratio: 0.8 } }),
    session({ name: "earlier", startedAt: "2026-05-01T00:00:00Z",
              efficiency: { process_efficiency_ratio: 0.5 } }),
  ]);
  assert.equal(r.efficiency_trend.length, 2);
  assert.equal(r.efficiency_trend[0].ratio, 0.5);
  assert.equal(r.efficiency_trend[1].ratio, 0.8);
});

test("sessions with no efficiency ratio drop out of the trend", () => {
  const r = aggregateAnalysis([
    session({ efficiency: {} }),
    session({ efficiency: { process_efficiency_ratio: 0.7 } }),
  ]);
  assert.equal(r.efficiency_trend.length, 1);
});
