"use strict";

/*
 * variant-divergence.js -- the `variant_divergence` detector (lab-phase
 * spec §D1): the cross-session, Tier-2 finding class the Compare surface
 * leads with.
 *
 * Given >= 2 loaded sessions of the SAME process -- same Process Template
 * (stats.meta.canonical_process_id) or the same accepted case anchor
 * (analysis.case_quality.anchor) -- it aligns the per-case step-label
 * sequences with the aligned-reading backbone (step-alignment.js, the
 * same Needleman-Wunsch consensus the Steps view's Aligned toggle uses)
 * and emits comparative findings:
 *
 *   "Worker A completes a case in N steps (median X); worker B in M
 *    (median Y); first divergence at step Z."
 *
 * The findings live in the AGGREGATE-level findings[] (additive, in the
 * in-memory aggregate payload the Compare surface renders -- nothing is
 * written into any session folder), in the same shape as the per-session
 * analysis.findings[] so the Overview's finding-card component renders
 * them unchanged. Claims are COMPARATIVE/FACTUAL, never normative -- the
 * detector reports who did what in how many steps; the analyst supplies
 * the judgment.
 *
 * Tier discipline: the detector is Tier 2 -- it only fires when every
 * participating session's case_quality.tier2_unlocked is true. Below the
 * gate it emits nothing (the Compare panel renders its locked note).
 *
 * Pure (no DOM): unit-testable under node:test; aggregate-view.js wires
 * it to the Compare findings feed and the multi-session report export.
 */

const crypto = require("crypto");
const { caseSequences } = require("./step-alignment.js");

/* Findings are a readable shortlist, not a log (mirrors findings.py). */
const MAX_PAIR_FINDINGS = 3;
/* A backbone position counts as a divergence when the two units' hit
   rates differ by at least this much (one side mostly does it, the
   other mostly doesn't). */
const DIVERGENCE_RATE_GAP = 0.5;

function _fid(detector, parts) {
  const raw = [detector].concat(parts.map(String)).join("\x1f");
  return detector + "-" +
    crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 12);
}

/* Compact human duration for claim sentences ("1h 12m", "3m 40s", "12s")
   -- mirrors findings.py _fmt_ms so the two feeds read the same. */
function _fmtMs(ms) {
  let s = Math.round((ms || 0) / 1000);
  if (s < 60) return s + "s";
  let m = Math.floor(s / 60); s = s % 60;
  if (m < 60) return s ? (m + "m " + String(s).padStart(2, "0") + "s") : (m + "m");
  const h = Math.floor(m / 60); m = m % 60;
  return h + "h " + String(m).padStart(2, "0") + "m";
}

function _median(xs) {
  const v = (xs || []).filter((x) => typeof x === "number" && isFinite(x))
    .slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function _sessionName(s) {
  const base = String((s && s.sessionFolder) || "").split(/[\\/]/).filter(Boolean).pop();
  return base || ((s && s.manifest && s.manifest.session_id) || "session");
}

/* Worker who recorded a session -- same precedence as aggregate-view.js. */
function _worker(s) {
  const meta = (s && s.stats && s.stats.meta) || {};
  const m = (s && s.manifest) || {};
  return meta.worker_id ||
    (m.config && m.config.worker && m.config.worker.id) ||
    m.worker || "unknown worker";
}

/* ---- Process identity ---------------------------------------------------
   Two sessions are "the same process" when they share a Process Template id
   OR the same accepted case anchor (the anchor a template carries and the
   anchor an analyst accepted on a template-less session compare EQUAL --
   that equality is the flywheel: session 2 arrives self-segmented by the
   anchor session 1's curation exported). */

function _identityKeys(s) {
  const keys = [];
  const meta = (s && s.stats && s.stats.meta) || {};
  if (meta.canonical_process_id) keys.push("tpl:" + meta.canonical_process_id);
  const cq = (s && s.analysis && s.analysis.case_quality) || {};
  if (cq.mode === "anchor" && cq.anchor) {
    const a = cq.anchor;
    if (a.field_property || a.field_value) {
      keys.push("anchor:" + (a.field_property || "") + "=" + (a.field_value || ""));
    }
  }
  return keys;
}

/** True when the session's case segmentation is trustworthy (Tier 2). */
function _tier2(s) {
  const cq = (s && s.analysis && s.analysis.case_quality) || {};
  return cq.tier2_unlocked === true;
}

/**
 * Group the loaded sessions into same-process groups: sessions sharing ANY
 * identity key (template id / anchor identity) coalesce. Only Tier-2
 * sessions participate -- the detector is case-based.
 * @returns {Array<{key:string, sessions:Array}>} groups with >= 2 sessions.
 */
function sameProcessGroups(sessions) {
  const eligible = (sessions || []).filter((s) => s && _tier2(s) && _identityKeys(s).length);
  const groups = [];           // { keys:Set, sessions:[] }
  for (const s of eligible) {
    const keys = _identityKeys(s);
    let home = null;
    for (const g of groups) {
      if (keys.some((k) => g.keys.has(k))) { home = g; break; }
    }
    if (!home) { home = { keys: new Set(), sessions: [] }; groups.push(home); }
    for (const k of keys) home.keys.add(k);
    home.sessions.push(s);
  }
  return groups
    .filter((g) => g.sessions.length >= 2)
    .map((g) => ({ key: [...g.keys].sort().join("|"), sessions: g.sessions }));
}

/* ---- Per-unit sequence statistics --------------------------------------- */

/* The cases of one session as ordered token sequences, with per-case
   measured durations. Caseless steps (the __nocase__ bucket) are excluded
   -- this is a per-case comparison. Durations prefer the measured
   stats.case_stats active_ms; a case without a stats row falls back to
   its step span. */
function _sessionCases(s) {
  const steps = ((s.annotations || {}).steps) || [];
  const seqs = caseSequences(steps).filter((c) => c.caseId !== "__nocase__");
  const activeByCase = new Map();
  for (const r of (((s.stats || {}).case_stats) || [])) {
    if (r && r.case_id && !r.parent_case_id &&
        typeof r.active_ms === "number") {
      activeByCase.set(r.case_id, r.active_ms);
    }
  }
  const stepById = new Map();
  for (const st of steps) if (st && st.step_id) stepById.set(st.step_id, st);
  return seqs.map((c) => {
    let dur = activeByCase.get(c.caseId);
    if (typeof dur !== "number") {
      // Step-span fallback: first step start -> last step end.
      const first = stepById.get(c.steps[0] && c.steps[0].stepId);
      const last = stepById.get(c.steps[c.steps.length - 1] && c.steps[c.steps.length - 1].stepId);
      const a = first && first.time_range && Date.parse(first.time_range.start);
      const b = last && last.time_range && Date.parse(last.time_range.end);
      dur = (isFinite(a) && isFinite(b) && b > a) ? (b - a) : 0;
    }
    return { caseId: c.caseId, tokens: c.steps.map((x) => x.token), duration_ms: dur };
  }).filter((c) => c.tokens.length);
}

/* A comparison unit: one worker's pooled sessions -- or, when every
   session reports the same worker id (the lab's single-operator demo
   corpus), one unit per session so the comparison still has two sides. */
function _units(groupSessions) {
  const byWorker = new Map();
  for (const s of groupSessions) {
    const w = _worker(s);
    if (!byWorker.has(w)) byWorker.set(w, []);
    byWorker.get(w).push(s);
  }
  let units;
  if (byWorker.size >= 2) {
    units = [...byWorker.entries()].map(([w, ss]) => ({
      label: w,
      worker: w,
      sessions: ss,
    }));
  } else {
    units = groupSessions.map((s) => ({
      label: _worker(s) + " (" + _sessionName(s) + ")",
      worker: _worker(s),
      sessions: [s],
    }));
  }
  for (const u of units) {
    u.session_names = u.sessions.map(_sessionName);
    u.cases = u.sessions.flatMap(_sessionCases);
    u.case_count = u.cases.length;
    u.median_steps = Math.round(_median(u.cases.map((c) => c.tokens.length)));
    u.median_case_ms = Math.round(_median(u.cases.map((c) => c.duration_ms)));
    u.variants = new Set(u.cases.map((c) => c.tokens.join("\x1f"))).size;
  }
  return units.filter((u) => u.case_count >= 1);
}

/* ---- Pairwise alignment -------------------------------------------------- */

/* Align two units' pooled cases on one consensus backbone and read off
   where they diverge. Reuses the Steps view's aligned-reading engine
   (alignCaseSequences) so the Compare reading and this detector cannot
   tell two different stories. */
function _alignPair(a, b) {
  const { alignCaseSequences } = require("./step-alignment.js");
  const tag = (unitIdx, c, i) => ({
    caseId: unitIdx + ":" + i + ":" + c.caseId,
    steps: c.tokens.map((t, j) => ({ stepId: unitIdx + ":" + i + ":" + j, token: t })),
  });
  const pooled = a.cases.map((c, i) => tag(0, c, i))
    .concat(b.cases.map((c, i) => tag(1, c, i)));
  const aligned = alignCaseSequences(pooled);
  const unitOf = (caseId) => Number(String(caseId).split(":")[0]);

  const positions = aligned.backbone.map((entry, idx) => {
    let hitsA = 0, hitsB = 0;
    const seen = new Set();
    for (const m of entry.members) {
      if (seen.has(m.caseId)) continue;   // count a case once per position
      seen.add(m.caseId);
      if (unitOf(m.caseId) === 0) hitsA++; else hitsB++;
    }
    return {
      position: idx,
      token: entry.token,
      hits_a: hitsA,
      hits_b: hitsB,
      rate_a: a.case_count ? hitsA / a.case_count : 0,
      rate_b: b.case_count ? hitsB / b.case_count : 0,
    };
  });
  const divergence = positions.find((p) =>
    Math.abs(p.rate_a - p.rate_b) >= DIVERGENCE_RATE_GAP) || null;

  // Off-backbone extra work, attributed per unit (deduped tokens).
  const extraA = new Set(), extraB = new Set();
  for (const ex of aligned.exceptions) {
    (unitOf(ex.caseId) === 0 ? extraA : extraB).add(ex.token);
  }
  return {
    backbone_len: aligned.backbone.length,
    positions,
    divergence,
    extra_a: [...extraA],
    extra_b: [...extraB],
  };
}

function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

function _pairClaim(a, b, al) {
  let claim =
    "Worker " + a.label + " completes a case in " + a.median_steps +
    " steps (median " + _fmtMs(a.median_case_ms) + " active, " +
    a.case_count + " case" + (a.case_count === 1 ? "" : "s") + "); worker " +
    b.label + " in " + b.median_steps + " steps (median " +
    _fmtMs(b.median_case_ms) + ", " + b.case_count + " case" +
    (b.case_count === 1 ? "" : "s") + ").";
  if (al.divergence) {
    const d = al.divergence;
    claim += " First divergence at step \"" + d.token + "\" -- " +
      a.label + " includes it in " + d.hits_a + "/" + a.case_count +
      " cases, " + b.label + " in " + d.hits_b + "/" + b.case_count + ".";
  } else if (al.extra_a.length || al.extra_b.length) {
    // An "extra" is an off-backbone OCCURRENCE -- the same step done again
    // out of consensus position counts here too, so don't call it a step
    // the other worker lacks.
    const extrasOf = (u, extras) => u.label + ": \"" + extras[0] + "\"" +
      (extras.length > 1 ? " (+" + (extras.length - 1) + " more)" : "");
    const parts = [];
    if (al.extra_a.length) parts.push(extrasOf(a, al.extra_a));
    if (al.extra_b.length) parts.push(extrasOf(b, al.extra_b));
    claim += " The shared backbone agrees; off-backbone step occurrences for " +
      parts.join("; ") + ".";
  } else {
    claim += " Both follow the same " + al.backbone_len + "-step sequence.";
  }
  return claim;
}

/**
 * The aggregate-level findings (lab-phase §D1). Same shape as the
 * per-session analysis.findings[] so finding-cards renders them as-is.
 * Empty when no two Tier-2 sessions share a process identity.
 */
function detectVariantDivergence(sessions) {
  const findings = [];
  for (const group of sameProcessGroups(sessions)) {
    const units = _units(group.sessions);
    if (units.length < 2) continue;
    let pairs = 0;
    for (let i = 0; i < units.length && pairs < MAX_PAIR_FINDINGS; i++) {
      for (let j = i + 1; j < units.length && pairs < MAX_PAIR_FINDINGS; j++) {
        const a = units[i], b = units[j];
        let al;
        try { al = _alignPair(a, b); }
        catch (_) { continue; }   // one bad pair never costs the rest
        if (!al.backbone_len) continue;
        const evidence = {
          process: group.key,
          per_unit: [a, b].map((u) => ({
            label: u.label,
            worker: u.worker,
            sessions: u.session_names,
            case_count: u.case_count,
            median_steps: u.median_steps,
            median_case_ms: u.median_case_ms,
            variant_count: u.variants,
          })),
          backbone_len: al.backbone_len,
          divergence: al.divergence,
          extra_steps: { [a.label]: al.extra_a, [b.label]: al.extra_b },
        };
        findings.push({
          id: _fid("variant_divergence", [group.key, a.label, b.label]),
          detector: "variant_divergence",
          claim: _pairClaim(a, b, al),
          evidence,
          tier: 2,
          confidence_note: "Aligned on value-free step labels across the " +
            "loaded sessions' cases (the same consensus backbone as the " +
            "Aligned reading); a renamed step reads as divergence -- " +
            "verify in the Aligned reading below.",
        });
        pairs++;
      }
    }
  }
  return findings;
}

/* ---- Aligned reading across the loaded sessions (lab-phase §D2) ----------
   The Compare default for template-matched sessions: the pooled consensus
   backbone with per-unit hit counts, so "how the sessions read" comes
   before the merged map. Render-ready plain data; null when no group. */
function pooledAlignment(sessions) {
  const groups = sameProcessGroups(sessions);
  if (!groups.length) return null;
  const group = groups[0];   // the dominant (first) same-process group
  const units = _units(group.sessions);
  if (units.length < 2) return null;
  const { alignCaseSequences } = require("./step-alignment.js");
  const pooled = [];
  units.forEach((u, ui) => {
    u.cases.forEach((c, i) => pooled.push({
      caseId: ui + ":" + i + ":" + c.caseId,
      steps: c.tokens.map((t, j) => ({ stepId: ui + ":" + i + ":" + j, token: t })),
    }));
  });
  const aligned = alignCaseSequences(pooled);
  const unitOf = (caseId) => Number(String(caseId).split(":")[0]);
  const backbone = aligned.backbone.map((entry) => {
    const hits = units.map(() => 0);
    const seen = new Set();
    for (const m of entry.members) {
      if (seen.has(m.caseId)) continue;
      seen.add(m.caseId);
      hits[unitOf(m.caseId)]++;
    }
    return { token: entry.token, frequency: seen.size, per_unit_hits: hits };
  });
  const exceptionsByUnit = units.map(() => []);
  for (const ex of aligned.exceptions) {
    exceptionsByUnit[unitOf(ex.caseId)].push(ex.token);
  }
  return {
    process: group.key,
    case_count: pooled.length,
    units: units.map((u, i) => ({
      label: u.label,
      case_count: u.case_count,
      session_names: u.session_names,
      exceptions: exceptionsByUnit[i],
    })),
    backbone,
  };
}

module.exports = {
  detectVariantDivergence, sameProcessGroups, pooledAlignment,
  // internals exported for unit tests
  _units, _alignPair, _median, _fmtMs,
};
