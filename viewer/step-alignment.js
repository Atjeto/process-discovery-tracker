"use strict";

/*
 * step-alignment.js -- intra-session repetition alignment (value-chain review
 * Decision 1, the core of "curate one ticket -> apply to all").
 *
 * When a session is segmented into cases (tickets) by the anchor detector, the
 * same task recurs once per case. This module groups "the same step across
 * cases" so the viewer can let the analyst curate ONE instance (rename, flag,
 * describe) and propagate to its siblings.
 *
 * The matching is by a VALUE-AGNOSTIC structural signature, so two "look up
 * serial" steps align even though the serial values differ:
 *   - a canonical_step_id wins outright (clean, when a template matched);
 *   - otherwise the signature is the set of (kind, control_type, element-id)
 *     tuples of the step's interactions -- never the typed values or visible
 *     names, which vary per ticket.
 *
 * Pure (no DOM): unit-testable, and the viewer wires it to the annotation
 * edit/propagate flow. The signature is deliberately simple; it will likely
 * need tuning (fuzzy/variant-aware matching) once a real multi-ticket capture
 * is available to calibrate against -- see the value-chain review's caveats.
 */

const { recognize } = require("./recognition.js");
const { processLabel } = require("./process-map-levels.js");

/** Stable, value-agnostic signature for one step. */
function stepSignature(step, interactionsById) {
  if (step && step.canonical_step_id) return "c:" + step.canonical_step_id;
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  const elems = new Set();
  for (const id of ids) {
    const d = ((interactionsById || {})[id] || {}).data || {};
    // Framework-aware semantic CATEGORY (recognition.js), not the opaque
    // automation_id -- so the same step aligns across tickets regardless of
    // per-ticket ids/values (ADR-0011).
    elems.add((d.kind || "") + ":" + recognize(d).category);
  }
  if (!elems.size) return "n:" + ((step && step.name) || (step && step.step_id) || "");
  return "s:" + [...elems].sort().join("|");
}

/**
 * Group steps that recur across cases.
 * @param {Array} steps  annotation steps (each with case_id + evidence)
 * @param {Object} interactionsById  event_id -> interaction event
 * @returns {{caseCount:number, groups:Array<{signature:string, members:Array<{caseId:string, stepId:string}>, caseSpan:number}>}}
 *   `groups` contains only signatures that appear in >1 case (i.e. genuinely
 *   repeated work). `caseSpan` is how many distinct cases the group touches.
 */
function alignSteps(steps, interactionsById) {
  const byCase = new Map();
  for (const s of steps || []) {
    if (!s || s.state === "hidden") continue;
    const cid = s.case_id || "__nocase__";
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(s);
  }

  const groups = new Map(); // signature -> members[]
  for (const [cid, caseSteps] of byCase) {
    for (const s of caseSteps) {
      const sig = stepSignature(s, interactionsById);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push({ caseId: cid, stepId: s.step_id });
    }
  }

  const aligned = [];
  for (const [signature, members] of groups) {
    const caseSpan = new Set(members.map((m) => m.caseId)).size;
    if (caseSpan > 1) aligned.push({ signature, members, caseSpan });
  }
  // Most-repeated first -- those are the highest-value to curate once.
  aligned.sort((a, b) => b.caseSpan - a.caseSpan);
  return { caseCount: byCase.size, groups: aligned };
}

/**
 * The alignment group a given step belongs to (for "apply my edit to the
 * other N instances"), or null when the step does not recur across cases.
 */
function groupForStep(stepId, steps, interactionsById) {
  const { groups } = alignSteps(steps, interactionsById);
  for (const g of groups) {
    if (g.members.some((m) => m.stepId === stepId)) return g;
  }
  return null;
}

// --- Ordered sequence alignment (ADR-0015 phase 1) -------------------------
// alignSteps (above) buckets recurring steps by signature, ignoring ORDER --
// enough for "this step recurs in N cases" badges. The build below aligns the
// per-case step SEQUENCES into a consensus backbone with per-position frequency,
// so an exception ticket (an extra or missing step) aligns to the backbone with
// a GAP rather than vanishing into the buckets. This supplies the "this path
// 10/12 times" frequencies and the curate-one -> propagate mapping (ADR-0015).

const _SEQ_SEP = String.fromCharCode(1);   // cannot occur in a step label

function _stepStartMs(s) {
  const t = s && s.time_range && s.time_range.start;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Value-free alignment token for a step: the persisted process_label (stamped
 *  at normalize), else the live strip of its name. Matches what the step map +
 *  stats group on, so the backbone reads in the same terms. */
function stepToken(step) {
  return (step && step.process_label) || processLabel((step && step.name) || "") || "(unnamed)";
}

/** Group annotation steps into per-case ordered token sequences (time order,
 *  hidden steps dropped) -- the input to alignCaseSequences. */
function caseSequences(steps) {
  const byCase = new Map();
  for (const s of steps || []) {
    if (!s || s.state === "hidden") continue;
    const cid = s.case_id || "__nocase__";
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(s);
  }
  const cases = [];
  for (const [caseId, caseSteps] of byCase) {
    caseSteps.sort((a, b) => _stepStartMs(a) - _stepStartMs(b));
    cases.push({ caseId, steps: caseSteps.map((s) => ({ stepId: s.step_id, token: stepToken(s) })) });
  }
  return cases;
}

/** Needleman-Wunsch global alignment of two token arrays. Returns the aligned
 *  index pairs [aIdx|null, bIdx|null] in order (null = a gap on that side). */
function _nwAlign(a, b) {
  const n = a.length, m = b.length;
  const GAP = -1, MATCH = 2, MISS = -1;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const bp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)); // 0 diag, 1 up, 2 left
  for (let i = 1; i <= n; i++) { dp[i][0] = i * GAP; bp[i][0] = 1; }
  for (let j = 1; j <= m; j++) { dp[0][j] = j * GAP; bp[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? MATCH : MISS);
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;
      let best = diag, dir = 0;
      if (up > best) { best = up; dir = 1; }
      if (left > best) { best = left; dir = 2; }
      dp[i][j] = best; bp[i][j] = dir;
    }
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const dir = (i > 0 && j > 0) ? bp[i][j] : (i > 0 ? 1 : 2);
    if (dir === 0) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (dir === 1) { pairs.push([i - 1, null]); i--; }
    else { pairs.push([null, j - 1]); j--; }
  }
  pairs.reverse();
  return pairs;
}

/**
 * Align case step-sequences into a consensus backbone.
 * @param {Array<{caseId:string, steps:Array<{stepId:string, token:string}>}>} cases
 * @returns {{caseCount:number,
 *   backbone:Array<{token:string, frequency:number, members:Array<{caseId:string, stepId:string}>}>,
 *   exceptions:Array<{caseId:string, stepId:string, token:string}>}}
 *   backbone = the modal sequence; `frequency` is how many cases hit that
 *   position (the n/N the step map shows); `members` are the aligned sibling
 *   steps (curate one -> propagate to these). `exceptions` are steps a case has
 *   that the backbone does not -- an exception ticket's extra work.
 */
function alignCaseSequences(cases) {
  const valid = (cases || []).filter((c) => c && Array.isArray(c.steps) && c.steps.length);
  const caseCount = valid.length;
  if (!caseCount) return { caseCount: 0, backbone: [], exceptions: [] };

  // Backbone = the modal exact token sequence (ties -> the longer one).
  const bySeq = new Map();
  for (const c of valid) {
    const key = c.steps.map((s) => s.token).join(_SEQ_SEP);
    if (!bySeq.has(key)) bySeq.set(key, []);
    bySeq.get(key).push(c);
  }
  let backboneSteps = valid[0].steps, bestN = -1;
  for (const members of bySeq.values()) {
    const n = members.length, len = members[0].steps.length;
    if (n > bestN || (n === bestN && len > backboneSteps.length)) { bestN = n; backboneSteps = members[0].steps; }
  }
  const backboneTokens = backboneSteps.map((s) => s.token);
  const backbone = backboneTokens.map((t) => ({ token: t, frequency: 0, members: [] }));
  const exceptions = [];

  for (const c of valid) {
    const caseTokens = c.steps.map((s) => s.token);
    for (const [bi, cj] of _nwAlign(backboneTokens, caseTokens)) {
      if (bi != null && cj != null && backboneTokens[bi] === caseTokens[cj]) {
        backbone[bi].frequency++;
        backbone[bi].members.push({ caseId: c.caseId, stepId: c.steps[cj].stepId });
      } else if (cj != null) {
        // Any unmatched case step is divergent work the consensus lacks at this
        // point -> an exception. This is BOTH a backbone-side gap (bi == null)
        // AND a substitution (bi != null but the tokens differ: NW aligned cj
        // diagonally onto a different backbone token). The substitution case
        // must NOT fall through silently -- the step would vanish from both the
        // backbone and the exceptions, hiding divergent work from the analyst.
        exceptions.push({ caseId: c.caseId, stepId: c.steps[cj].stepId, token: caseTokens[cj] });
      }
      // bi present, cj null = this case SKIPS backbone[bi] (its frequency stays
      // lower, signalling a not-universal step); no separate record needed.
    }
  }
  return { caseCount, backbone, exceptions };
}

/** Viewer entry: annotation steps -> aligned backbone (group by case, order by
 *  time, tokenise, align). */
function alignCases(steps) {
  return alignCaseSequences(caseSequences(steps));
}

/**
 * Seed values for curating a backbone step (ADR-0015 phase 3). The value-free
 * name (the token) is supplied by the caller; this summarises the rest from the
 * step's aligned instances: the description of the first instance that has one,
 * and each flag set when a STRICT MAJORITY of instances carry it -- so the
 * curate form reflects the current consensus before the analyst applies. Pure.
 * @param {Array} memberSteps  the annotation steps aligned at one backbone position
 * @returns {{description:string, flags:Object}}
 */
function representativeCuration(memberSteps) {
  const steps = (memberSteps || []).filter(Boolean);
  let description = "";
  for (const s of steps) { if (s.description && String(s.description).trim()) { description = s.description; break; } }
  // Only `waste` is a per-step flag now (ADR-0027 retired conditional /
  // exception_path / automation_candidate as mis-scoped per-step toggles).
  const FLAGS = ["waste"];
  const flags = {};
  const n = steps.length;
  for (const k of FLAGS) {
    const c = steps.reduce((acc, s) => acc + ((s.flags && s.flags[k]) ? 1 : 0), 0);
    flags[k] = n > 0 && c * 2 > n;   // strict majority
  }
  return { description, flags };
}

module.exports = {
  stepSignature, alignSteps, groupForStep,
  stepToken, caseSequences, alignCaseSequences, alignCases,
  representativeCuration,
};
