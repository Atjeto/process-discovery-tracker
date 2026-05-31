"use strict";

/*
 * Property-based fuzzer for the intra-session aligner (ADR-0015). Instead of a
 * few hand-built cases, generate thousands of randomized multi-case sessions --
 * variants, insertions, deletions, substitutions, shuffled times, hidden steps,
 * null case_ids -- and assert the invariants the aligned reading MUST hold,
 * whatever the input. Deterministic (seeded), so a failure is reproducible.
 *
 * The load-bearing invariant: the aligned reading is the analyst's whole view of
 * the repeating work, so NO non-hidden step may silently vanish -- every one must
 * surface as exactly one backbone member OR one exception. If a step is neither,
 * the analyst can neither curate-propagate it nor see it as divergent: a
 * meaning-leak, invisible to the hand-written tests. Run with `npm test`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { alignCases, representativeCuration } = require("./step-alignment.js");

/* Small, fast, seeded PRNG (mulberry32) so every run is identical + a failing
   seed is reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One randomized session: N cases that are mutated variants of a shared base
   sequence, drawn from a deliberately small alphabet so token repeats + clashes
   are common (the cases that stress alignment hardest). */
function genScenario(rng) {
  const ALPHA = "ABCDEFGH".split("");
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const nCases = 1 + Math.floor(rng() * 25);
  const baseLen = 1 + Math.floor(rng() * 12);
  const base = Array.from({ length: baseLen }, () => pick(ALPHA));
  const steps = [];
  let clock = 1000, sid = 0;
  for (let ci = 0; ci < nCases; ci++) {
    const caseId = rng() < 0.12 ? null : "c" + ci;   // sometimes the no-case bucket
    const seq = base.slice();
    const nMut = Math.floor(rng() * 5);
    for (let m = 0; m < nMut; m++) {
      const op = rng();
      if (seq.length && op < 0.34) seq.splice(Math.floor(rng() * seq.length), 1);                 // delete
      else if (op < 0.67) seq.splice(Math.floor(rng() * (seq.length + 1)), 0, pick(ALPHA));        // insert
      else if (seq.length) seq[Math.floor(rng() * seq.length)] = pick(ALPHA);                      // substitute
    }
    for (const tok of seq) {
      const hidden = rng() < 0.07;
      steps.push({
        step_id: "s" + (sid++), case_id: caseId,
        process_label: tok, name: tok,
        state: hidden ? "hidden" : "edited",
        time_range: { start: new Date(clock += 1000 + Math.floor(rng() * 5)).toISOString() },
        flags: {},
      });
    }
  }
  // Shuffle so the aligner must re-order by time within a case itself.
  for (let i = steps.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = steps[i]; steps[i] = steps[j]; steps[j] = tmp;
  }
  return steps;
}

function inspect(steps, r) {
  const expected = new Set(steps.filter((s) => s.state !== "hidden").map((s) => s.step_id));
  const memberIds = [];
  let freqErr = null;
  for (const b of r.backbone) {
    for (const m of b.members) memberIds.push(m.stepId);
    if (b.members.length !== b.frequency) freqErr = "members.length(" + b.members.length + ") != frequency(" + b.frequency + ")";
    if (!(b.frequency >= 1 && b.frequency <= r.caseCount)) freqErr = "frequency " + b.frequency + " outside [1," + r.caseCount + "]";
    const cids = b.members.map((m) => m.caseId);
    if (new Set(cids).size !== cids.length) freqErr = "two members from the same case at one backbone position";
  }
  const excIds = r.exceptions.map((e) => e.stepId);
  const seen = memberIds.concat(excIds);
  return {
    dup: new Set(seen).size !== seen.length,
    missing: [...expected].filter((id) => !seen.includes(id)),
    extra: seen.filter((id) => !expected.has(id)),
    freqErr,
    backboneLen: r.backbone.length,
  };
}

test("fuzz: every non-hidden step surfaces as exactly one member XOR exception", () => {
  const rng = mulberry32(0x9e3779b9);
  for (let i = 0; i < 4000; i++) {
    const steps = genScenario(rng);
    let r;
    assert.doesNotThrow(() => { r = alignCases(steps); }, "alignCases threw on iteration " + i);
    const inv = inspect(steps, r);
    assert.ok(!inv.dup, "iter " + i + ": a step is counted twice (member+exception, or repeated)");
    assert.ok(!inv.freqErr, "iter " + i + ": " + inv.freqErr);
    assert.equal(inv.extra.length, 0, "iter " + i + ": alignment referenced a hidden/unknown step: " + inv.extra.slice(0, 3));
    assert.equal(inv.missing.length, 0,
      "iter " + i + ": " + inv.missing.length + " non-hidden step(s) vanished (neither member nor exception)");
  }
});

test("fuzz: backbone never longer than the longest case, freq never exceeds caseCount", () => {
  const rng = mulberry32(0x1234567);
  for (let i = 0; i < 2000; i++) {
    const steps = genScenario(rng);
    const r = alignCases(steps);
    // longest non-hidden per-case length
    const byCase = new Map();
    for (const s of steps) {
      if (s.state === "hidden") continue;
      const k = s.case_id || "__nocase__";
      byCase.set(k, (byCase.get(k) || 0) + 1);
    }
    const maxLen = Math.max(0, ...byCase.values());
    assert.ok(r.backbone.length <= maxLen, "iter " + i + ": backbone " + r.backbone.length + " > longest case " + maxLen);
    for (const b of r.backbone) assert.ok(b.frequency <= r.caseCount, "iter " + i + ": freq > caseCount");
  }
});

test("fuzz: representativeCuration never throws and returns a boolean waste flag", () => {
  const rng = mulberry32(0xC0FFEE);
  // Feed the RETIRED flag keys too (ADR-0027) to prove the impl ignores them
  // gracefully and only ever emits `waste`.
  const FLAGS = ["conditional", "exception_path", "waste", "automation_candidate"];
  for (let i = 0; i < 2000; i++) {
    const n = Math.floor(rng() * 6);
    const members = Array.from({ length: n }, () => {
      if (rng() < 0.15) return null;                       // tolerate holes
      const flags = {};
      for (const k of FLAGS) if (rng() < 0.5) flags[k] = true;
      return { description: rng() < 0.4 ? "d" + Math.floor(rng() * 5) : "", flags };
    });
    let out;
    assert.doesNotThrow(() => { out = representativeCuration(members); });
    assert.equal(typeof out.flags.waste, "boolean", "waste flag not boolean");
    assert.equal(typeof out.description, "string");
  }
});
