/*
 * Unit tests for analysis-aggregate.js -- the pure cross-session rollup
 * behind the Compare-Sessions Analysis panel.
 *
 * Automation candidacy is reported at the SEGMENT grain (ADR-0016): a
 * coherent run of work in one app within one case, identified by
 * `segment_signature`. Cross-session pooling groups by signature.
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

/* Segment-shaped automation candidate (ADR-0016). */
function segEntry(signature, opts) {
  opts = opts || {};
  return {
    segment_signature: signature,
    label: opts.label || "CRM — Search → Copy → Paste",
    app: opts.app || "salesforce.exe",
    step_labels: opts.step_labels || ["Search", "Copy", "Paste"],
    instance_count: opts.instance_count == null ? 1 : opts.instance_count,
    total_elapsed_ms: opts.total_elapsed_ms == null ? 5000 : opts.total_elapsed_ms,
    mean_elapsed_ms: opts.mean_elapsed_ms == null ? 5000 : opts.mean_elapsed_ms,
    case_ids: opts.case_ids || [],
    scores: opts.scores || { confidence: null, volume: 5000 },
    automation_confirmed: opts.confirmed === undefined ? null : opts.confirmed,
    data_sufficiency: (opts.instance_count == null ? 1 : opts.instance_count) >= 2
      ? "multi_instance" : "single_instance",
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

/* ---- aggregated automation (segment grain, ADR-0016) -------------- */

test("identical signatures across sessions pool to one segment row", () => {
  const r = aggregateAnalysis([
    session({ automation: [segEntry("sig-abc", { instance_count: 2, total_elapsed_ms: 6000 })] }),
    session({ automation: [segEntry("sig-abc", { instance_count: 3, total_elapsed_ms: 9000 })] }),
    session({ automation: [segEntry("sig-abc", { instance_count: 1, total_elapsed_ms: 3000 })] }),
  ]);
  assert.equal(r.automation.length, 1);
  const a = r.automation[0];
  assert.equal(a.sessions, 3);
  assert.equal(a.instance_count, 6);            // 2+3+1
  assert.equal(a.total_elapsed_ms, 18000);      // 6000+9000+3000
  assert.equal(a.mean_elapsed_ms, 3000);        // 18000 / 6
  assert.equal(a.data_sufficiency, "multi_instance");
});

test("distinct segment signatures stay as separate rows", () => {
  const r = aggregateAnalysis([
    session({ automation: [segEntry("sig-A", { instance_count: 2 })] }),
    session({ automation: [segEntry("sig-B", { instance_count: 2 })] }),
  ]);
  assert.equal(r.automation.length, 2);
});

test("a single instance is reported as single_instance", () => {
  const r = aggregateAnalysis([
    session({ automation: [segEntry("sig-once", { instance_count: 1 })] }),
  ]);
  assert.equal(r.automation[0].data_sufficiency, "single_instance");
});

test("confirmed and dismissed decisions roll up as counts", () => {
  const r = aggregateAnalysis([
    session({ automation: [segEntry("sig-s", { instance_count: 2, confirmed: true })] }),
    session({ automation: [segEntry("sig-s", { instance_count: 2, confirmed: true })] }),
    session({ automation: [segEntry("sig-s", { instance_count: 2, confirmed: false })] }),
  ]);
  assert.equal(r.automation[0].confirmed, 2);
  assert.equal(r.automation[0].dismissed, 1);
});

test("automation rows preserve the segment label and step sequence", () => {
  const r = aggregateAnalysis([
    session({
      automation: [segEntry("sig-1", {
        instance_count: 2,
        label: "salesforce — Search → Copy → Paste",
        app: "salesforce.exe",
        step_labels: ["Search", "Copy", "Paste"],
      })],
    }),
  ]);
  assert.equal(r.automation[0].label, "salesforce — Search → Copy → Paste");
  assert.equal(r.automation[0].app, "salesforce.exe");
  assert.deepEqual(r.automation[0].step_labels, ["Search", "Copy", "Paste"]);
});

test("automation rows are ranked by instance count then total time", () => {
  const r = aggregateAnalysis([
    session({ automation: [
      segEntry("sig-small", { instance_count: 2, total_elapsed_ms: 1000 }),
      segEntry("sig-big", { instance_count: 5, total_elapsed_ms: 50000 }),
    ]}),
  ]);
  assert.equal(r.automation[0].signature, "sig-big");
  assert.equal(r.automation[1].signature, "sig-small");
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
