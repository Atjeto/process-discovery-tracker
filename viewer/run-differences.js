/*
 * run-differences.js: how a run differs from its reference (the pattern run),
 * in the Steps level's differences review. It is the
 * viewer half of ONE algorithm: normalization/pdd_export.py implements the
 * same rules for the PDD's section 6.1, and shared/run-differences-golden.json
 * pins both (run-differences.test.js here, test_run_differences_golden.py
 * there). Change one side only together with the other and the golden.
 *
 * Pure: no DOM, no State, no IPC.
 *
 * The alignment key of a step (how a step is matched across runs):
 *   a step with a draft_key        "draft:" + draft_key
 *   a step with draft_keys         "merge:" + the keys in order, as a JSON
 *                                  array (JSON.stringify here, json.dumps with
 *                                  ensure_ascii=False and separators (",", ":")
 *                                  in Python: the same text)
 *   any other step                 "label:" + processLabel(name)
 * draft_keys is what a merge of drafted steps keeps (item 1): the ordered
 * draft keys of its members, a merged member's keys flattened in place.
 *
 * Before a run is aligned, every stretch of at least two consecutive run
 * steps whose draft keys, read in order, are exactly the draft_keys of a
 * merged reference step is folded into one unit carrying that reference
 * step's name and draft_keys (so it matches it). At each position the merged
 * reference step with the most keys wins; among equals, the first one in the
 * reference. So two drafts in run 2 match the pattern run's merge of the same
 * two drafts even where the merge was not carried.
 *
 * Then the differences, one line each: every step of the run whose key the
 * reference lacks is an "Extra step" (where it sits: after the step before
 * it, or at the start of the run); every step both have that is outside a
 * longest common order is a "Different order"; every reference step whose key
 * the run lacks is "Skipped" (with its number in the reference). A key that
 * repeats within a list counts at its first occurrence only.
 */

"use strict";

const { processLabel } = require("./process-map-levels.js");

const PATTERN_REFERENCE = "the pattern run";
/* The Steps level's words (AD-29): the run the others are compared with, and
   what a run is called in a line ("at the start of the transaction", "in
   this transaction after ..."). The shared golden and the PDD still print
   PATTERN_REFERENCE and "run" (the defaults below). */
const REFERENCE_RUN = "the reference transaction";
const RUN_UNIT = "transaction";

/* A list of draft keys: a non-empty array of non-empty strings, else null. */
function _keyList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === "string" && k !== "") ? v : null;
}

/* The draft keys a step stands for: [draft_key] for a drafted step, its
   draft_keys for merged drafts, null for a step with no draft identity (added
   by hand, or a split half). */
function stepKeys(step) {
  if (!step || typeof step !== "object") return null;
  if (typeof step.draft_key === "string" && step.draft_key) return [step.draft_key];
  const keys = _keyList(step.draft_keys);
  return keys ? keys.slice() : null;
}

function mergeKey(keys) {
  return "merge:" + JSON.stringify(keys);
}

/* The alignment key (see the header). */
function alignKey(step) {
  const s = step && typeof step === "object" ? step : {};
  if (typeof s.draft_key === "string" && s.draft_key) return "draft:" + s.draft_key;
  const keys = _keyList(s.draft_keys);
  if (keys) return mergeKey(keys);
  return "label:" + processLabel(String(s.name || ""));
}

function stepName(step) {
  const n = step && step.name;
  return typeof n === "string" && n.trim() ? n.trim() : "(unnamed step)";
}

/* How many steps from run[i] on read exactly `keys`, or 0. */
function _stretchAt(run, i, keys) {
  let k = 0, j = i;
  while (k < keys.length) {
    if (j >= run.length) return 0;
    const sk = stepKeys(run[j]);
    if (!sk) return 0;
    for (const key of sk) {
      if (k >= keys.length || key !== keys[k]) return 0;
      k++;
    }
    j++;
  }
  return j - i;
}

/* The merged steps of a reference, as { keys, step }, in reference order. A
   step with a draft_key is matched by that key, never as a merge. */
function _mergeTargets(refSteps) {
  const out = [];
  for (const r of refSteps || []) {
    if (!r || typeof r !== "object" || (typeof r.draft_key === "string" && r.draft_key)) continue;
    const keys = _keyList(r.draft_keys);
    if (keys && keys.length >= 2) out.push({ keys, step: r });
  }
  return out;
}

/* The run's steps with each stretch that spells a merged reference step
   folded into one unit (see the header). Steps are kept as they are. */
function collapseToReference(refSteps, runSteps) {
  const run = Array.isArray(runSteps) ? runSteps : [];
  const targets = _mergeTargets(refSteps);
  if (!targets.length) return run.slice();
  const out = [];
  let i = 0;
  while (i < run.length) {
    let best = null, bestLen = 0;
    for (const t of targets) {
      if (best && t.keys.length <= best.keys.length) continue;
      const n = _stretchAt(run, i, t.keys);
      if (n >= 2) { best = t; bestLen = n; }
    }
    if (best) {
      out.push({ name: best.step.name, draft_keys: best.keys.slice() });
      i += bestLen;
    } else {
      out.push(run[i]);
      i++;
    }
  }
  return out;
}

/* { key, step, index } for the first step of each alignment key. */
function firstOccurrences(steps) {
  const seen = new Set();
  const out = [];
  (steps || []).forEach((step, index) => {
    const key = alignKey(step);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, step, index });
  });
  return out;
}

/* The keys of a longest common subsequence of two key lists (each key at most
   once per list): the steps both did in the same order. Ties resolve the way
   pdd_export._common_order resolves them. */
function commonOrder(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keys = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keys.add(a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return keys;
}

/* The differences of a run from its reference, each as
     { kind: "extra" | "order" | "skipped", name, where?, number?, text }
   in the PDD's order: the run's extra and reordered steps in run order, then
   the reference steps the run skipped. `text` is the line pdd_export writes;
   opts.reference names the reference in a Skipped line ("the pattern run" by
   default; the Steps level passes REFERENCE_RUN) and opts.unit what a run is
   called in the other lines ("run" by default; the Steps level passes
   RUN_UNIT). Both lists are the visible steps in time order. */
function differences(refSteps, runSteps, opts) {
  const reference = (opts && opts.reference) || PATTERN_REFERENCE;
  const unit = (opts && opts.unit) || "run";
  const ref = Array.isArray(refSteps) ? refSteps : [];
  const units = collapseToReference(ref, runSteps);
  const pat = firstOccurrences(ref);
  const run = firstOccurrences(units);
  const patKeys = pat.map((x) => x.key);
  const runKeys = run.map((x) => x.key);
  const patSet = new Set(patKeys);
  const runSet = new Set(runKeys);
  const inOrder = commonOrder(patKeys, runKeys);
  const out = [];
  for (const { key, step, index } of run) {
    const where = index ? "after " + stepName(units[index - 1]) : "at the start of the " + unit;
    const name = stepName(step);
    if (!patSet.has(key)) {
      out.push({ kind: "extra", name, where, text: "Extra step: " + name + " (" + where + ")." });
    } else if (!inOrder.has(key)) {
      out.push({ kind: "order", name, where, text: "Different order: " + name + " (in this " + unit + " " + where + ")." });
    }
  }
  for (const { key, step, index } of pat) {
    if (runSet.has(key)) continue;
    const name = stepName(step);
    out.push({ kind: "skipped", name, number: index + 1,
      text: "Skipped: " + name + " (step " + (index + 1) + " of " + reference + ")." });
  }
  return out;
}

module.exports = {
  PATTERN_REFERENCE, REFERENCE_RUN, RUN_UNIT,
  stepKeys, mergeKey, alignKey, stepName, collapseToReference, firstOccurrences, commonOrder, differences,
};
