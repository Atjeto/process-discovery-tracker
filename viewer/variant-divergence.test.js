"use strict";

/*
 * Unit tests for variant-divergence.js -- the §D1 cross-session
 * divergence detector. Run with `npm test` (node:test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectVariantDivergence, sameProcessGroups, pooledAlignment,
  _median, _fmtMs,
} = require("./variant-divergence.js");

/* Build a loaded-session object the detector consumes. `cases` is a list
   of {id, tokens[], active_ms}; each token becomes one step with a
   process_label (the value-free alignment token). */
let _sid = 0;
function mkSession({ folder, worker, templateId, anchor, tier2 = true, cases }) {
  const steps = [];
  const caseStats = [];
  let t = Date.parse("2026-06-01T09:00:00Z") + _sid++ * 10_000_000;
  for (const c of cases || []) {
    caseStats.push({ case_id: c.id, label: c.id, parent_case_id: null,
      active_ms: c.active_ms || 60000, wall_clock_ms: (c.active_ms || 60000) * 2 });
    for (const tok of c.tokens) {
      const start = new Date(t).toISOString();
      t += 30000;
      const end = new Date(t).toISOString();
      steps.push({
        step_id: "s" + _sid + "-" + steps.length,
        case_id: c.id,
        name: tok,
        process_label: tok,
        state: "auto_suggested",
        time_range: { start, end },
        evidence: { interaction_event_ids: [] },
      });
    }
  }
  const cq = { mode: anchor ? "anchor" : "markers",
    case_count: (cases || []).length, coverage: 0.95, tier2_unlocked: tier2 };
  if (anchor) cq.anchor = anchor;
  return {
    sessionFolder: "C:\\tmp\\" + folder,
    manifest: { session_id: folder, config: { worker: { id: worker } } },
    stats: { meta: { worker_id: worker, canonical_process_id: templateId || null },
      case_stats: caseStats },
    analysis: { case_quality: cq },
    annotations: { steps },
  };
}

const ANCHOR = { field_property: "customer-id-field", field_value: "" };

test("sameProcessGroups: template id groups sessions; tier2-locked excluded", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "order-proc",
    cases: [{ id: "c1", tokens: ["Search", "Create"] }] });
  const b = mkSession({ folder: "b", worker: "bob", templateId: "order-proc",
    cases: [{ id: "c2", tokens: ["Search", "Create"] }] });
  const locked = mkSession({ folder: "x", worker: "eve", templateId: "order-proc",
    tier2: false, cases: [{ id: "c3", tokens: ["Search"] }] });
  const other = mkSession({ folder: "y", worker: "yo", templateId: "different",
    cases: [{ id: "c4", tokens: ["Search"] }] });
  const groups = sameProcessGroups([a, b, locked, other]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sessions.length, 2);
  assert.ok(groups[0].key.includes("tpl:order-proc"));
});

test("sameProcessGroups: a template session and an anchor session of the same process coalesce", () => {
  // The flywheel pair: session 1 segmented by an ACCEPTED anchor, session 2
  // by a template that CARRIES that anchor (so both expose the same anchor
  // identity even though only one names the template).
  const s1 = mkSession({ folder: "s1", worker: "w", anchor: ANCHOR,
    cases: [{ id: "c1", tokens: ["Search", "Create"] }] });
  const s2 = mkSession({ folder: "s2", worker: "w", templateId: "order-proc",
    anchor: ANCHOR, cases: [{ id: "c2", tokens: ["Search", "Create"] }] });
  const groups = sameProcessGroups([s1, s2]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sessions.length, 2);
});

test("detector: silent below 2 same-process Tier-2 sessions", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "t1",
    cases: [{ id: "c1", tokens: ["Search"] }] });
  assert.deepEqual(detectVariantDivergence([a]), []);
  const lockedPair = [
    mkSession({ folder: "b", worker: "b", templateId: "t1", tier2: false,
      cases: [{ id: "c2", tokens: ["Search"] }] }),
    mkSession({ folder: "c", worker: "c", templateId: "t1", tier2: false,
      cases: [{ id: "c3", tokens: ["Search"] }] }),
  ];
  assert.deepEqual(detectVariantDivergence(lockedPair), []);
});

test("detector: divergence at a step one worker skips", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "t1",
    cases: [
      { id: "a1", tokens: ["Search", "Validate", "Create", "Email"], active_ms: 240000 },
      { id: "a2", tokens: ["Search", "Validate", "Create", "Email"], active_ms: 250000 },
    ] });
  const b = mkSession({ folder: "b", worker: "bob", templateId: "t1",
    cases: [
      { id: "b1", tokens: ["Search", "Create", "Email"], active_ms: 180000 },
      { id: "b2", tokens: ["Search", "Create", "Email"], active_ms: 170000 },
    ] });
  const fs = detectVariantDivergence([a, b]);
  assert.equal(fs.length, 1);
  const f = fs[0];
  assert.equal(f.detector, "variant_divergence");
  assert.equal(f.tier, 2);
  assert.match(f.claim, /Worker alice completes a case in 4 steps/);
  assert.match(f.claim, /worker bob in 3 steps/);
  assert.match(f.claim, /First divergence at step "Validate"/);
  assert.match(f.claim, /alice includes it in 2\/2 cases, bob in 0\/2/);
  // Evidence carries the measured numbers for both units.
  assert.equal(f.evidence.per_unit.length, 2);
  assert.equal(f.evidence.per_unit[0].median_steps, 4);
  assert.equal(f.evidence.per_unit[1].median_steps, 3);
  assert.equal(f.evidence.per_unit[0].median_case_ms, 245000);
  assert.equal(f.evidence.divergence.token, "Validate");
  // Stable id across re-runs.
  assert.equal(detectVariantDivergence([a, b])[0].id, f.id);
});

test("detector: identical sequences still yield one comparative finding", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "t1",
    cases: [{ id: "a1", tokens: ["Search", "Create"], active_ms: 100000 }] });
  const b = mkSession({ folder: "b", worker: "bob", templateId: "t1",
    cases: [{ id: "b1", tokens: ["Search", "Create"], active_ms: 200000 }] });
  const fs = detectVariantDivergence([a, b]);
  assert.equal(fs.length, 1);
  assert.match(fs[0].claim, /Both follow the same 2-step sequence/);
  assert.match(fs[0].claim, /median 1m 40s/);
  assert.match(fs[0].claim, /median 3m 20s/);
});

test("detector: same worker id falls back to per-session units", () => {
  const a = mkSession({ folder: "sess-a", worker: "demo-worker", templateId: "t1",
    cases: [{ id: "a1", tokens: ["Search", "Create"] }] });
  const b = mkSession({ folder: "sess-b", worker: "demo-worker", templateId: "t1",
    cases: [{ id: "b1", tokens: ["Search", "Email", "Create"] }] });
  const fs = detectVariantDivergence([a, b]);
  assert.equal(fs.length, 1);
  assert.match(fs[0].claim, /demo-worker \(sess-a\)/);
  assert.match(fs[0].claim, /demo-worker \(sess-b\)/);
});

test("detector: claims are comparative, never normative", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "t1",
    cases: [{ id: "a1", tokens: ["Search", "Validate", "Create"] }] });
  const b = mkSession({ folder: "b", worker: "bob", templateId: "t1",
    cases: [{ id: "b1", tokens: ["Search", "Create"] }] });
  for (const f of detectVariantDivergence([a, b])) {
    assert.doesNotMatch(f.claim, /\b(should|too (slow|fast|many|few)|inefficient|wrong|bad|better|worse)\b/i);
  }
});

test("pooledAlignment: backbone with per-unit hit counts for the Compare reading", () => {
  const a = mkSession({ folder: "a", worker: "alice", templateId: "t1",
    cases: [
      { id: "a1", tokens: ["Search", "Validate", "Create"] },
      { id: "a2", tokens: ["Search", "Validate", "Create"] },
    ] });
  const b = mkSession({ folder: "b", worker: "bob", templateId: "t1",
    cases: [{ id: "b1", tokens: ["Search", "Create"] }] });
  const pa = pooledAlignment([a, b]);
  assert.ok(pa);
  assert.equal(pa.case_count, 3);
  assert.equal(pa.units.length, 2);
  const validate = pa.backbone.find((r) => r.token === "Validate");
  assert.ok(validate);
  assert.deepEqual(validate.per_unit_hits, [2, 0]);
  const search = pa.backbone.find((r) => r.token === "Search");
  assert.deepEqual(search.per_unit_hits, [2, 1]);
  // No group -> null (not a throw).
  assert.equal(pooledAlignment([a]), null);
});

test("helpers: _median and _fmtMs", () => {
  assert.equal(_median([1, 3, 2]), 2);
  assert.equal(_median([1, 2, 3, 4]), 2.5);
  assert.equal(_median([]), 0);
  assert.equal(_fmtMs(12000), "12s");
  assert.equal(_fmtMs(220000), "3m 40s");
  assert.equal(_fmtMs(4380000), "1h 13m");
});
