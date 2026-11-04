/*
 * run-differences.js: how a run differs from its reference (the pattern run),
 * in the Steps level's differences review. It is the
 * viewer half of ONE algorithm: normalization/pdd_export.py implements the
 * same rules for the PDD's section 4.1, and shared/run-differences-golden.json
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
 * two drafts even where the merge was not carried. Then (2.0.1) a step whose
 * own key the reference lacks, but whose name is a reference step's name
 * (whitespace collapsed, without case), is that step: the analyst named them
 * alike, and the map draws them as one box (namedAlike).
 *
 * Then the differences, one line each: every step of the run whose key the
 * reference lacks is an "Extra step" (where it sits: after the step before
 * it, or at the start of the run); every step both have that is outside a
 * longest common order is a "Different order"; every reference step whose key
 * the run lacks is "Skipped" (with its number in the reference), unless it
 * happens only under a condition (C17 only_when, on a reference step with
 * that key): then it reads "Not done: <name> (only when <condition>)." and
 * is no difference (lane FX1); last, every step the run does more often than
 * the reference, at least twice, is "Repeated: <name>, <n> times." at its
 * first time (lane FX1: rework reads the same in Steps and in the PDD).
 * Otherwise a key that repeats within a list counts at its first occurrence
 * only. differenceCount counts the differences: the left-out line and a Not
 * done line are not ones, so a transaction's head counts exactly the lines
 * the Steps level lists as its differences.
 *
 * A stretch of the run left out of the analysis (annotations.excluded_ranges,
 * cut to the run's span: leftOutStretches) drafts no step, so the reference
 * steps done in it would read as skipped. They are not: a stretch falls
 * between the run's steps (a unit is before it when it starts before the
 * stretch starts; a step without a time is after), and the reference steps
 * after the reference position of the nearest unit before it that the
 * reference has, and before that of the nearest such unit after it (the
 * reference's start and end when there is none), are left out of the Skipped
 * lines. Instead the run says once, first: "Part of this run was left out of
 * the analysis (1:10 to 1:45)." (the times since the recording started,
 * several stretches joined "a, b and c"; no times when the start of the
 * recording is not known).
 */

"use strict";

const { processLabel } = require("./process-map-levels.js");

const PATTERN_REFERENCE = "the pattern run";
/* The Steps level's words (AD-29): the run the others are compared with, and
   what a run is called in a line ("at the start of the transaction", "in
   this transaction after ..."). The shared golden (with pdd_export._differences,
   its pipeline half) keeps PATTERN_REFERENCE and "run" (the defaults below);
   the PDD words the same items for its reader (pdd_export._variation_lines). */
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
   folded into one unit (see the header). Steps are kept as they are. A
   folded unit keeps the run's steps it stands for under `members` (their
   times); the rule reads only its first member's start. */
/* A step's name as two names are compared (pdd_export._name_key). */
function _nameKey(name) {
  return String(name == null ? "" : name).split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/* `units` with each one whose own key the reference lacks, and whose name is
   a reference step's name, taken for that step (see the header): a unit
   carrying the reference step's name and identity and the run's steps it
   stands for under `members`. pdd_export._named_alike. */
function namedAlike(refSteps, units) {
  const refs = (refSteps || []).filter((r) => r && typeof r === "object");
  const keys = new Set(refs.map(alignKey));
  const byName = new Map();
  for (const r of refs) {
    const k = _nameKey(r.name);
    if (k && !byName.has(k)) byName.set(k, r);
  }
  return (units || []).map((u) => {
    const ref = u && typeof u === "object" ? byName.get(_nameKey(u.name)) : null;
    if (!ref || keys.has(alignKey(u))) return u;
    const unit = { name: ref.name, case_id: u.case_id, members: Array.isArray(u.members) && u.members.length ? u.members : [u] };
    if (typeof ref.draft_key === "string" && ref.draft_key) unit.draft_key = ref.draft_key;
    else if (_keyList(ref.draft_keys)) unit.draft_keys = _keyList(ref.draft_keys).slice();
    return unit;
  });
}

function collapseToReference(refSteps, runSteps) {
  const run = Array.isArray(runSteps) ? runSteps : [];
  const targets = _mergeTargets(refSteps);
  if (!targets.length) return namedAlike(refSteps, run.slice());
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
      out.push({ name: best.step.name, draft_keys: best.keys.slice(), members: run.slice(i, i + bestLen) });
      i += bestLen;
    } else {
      out.push(run[i]);
      i++;
    }
  }
  return namedAlike(refSteps, out);
}

/* ---- the stretches left out of the analysis ---------------------------------------- */

/* An ISO time in ms, NaN when it cannot be read. A time without a zone is
   read as UTC, as the pipeline's parser reads it (_dt.parse_ts), so the two
   sides place a hand-edited range the same way. */
function _ms(iso) {
  if (typeof iso !== "string" || !iso.trim()) return NaN;
  const s = iso.trim();
  const zoned = /T.*([zZ]|[+-]\d{2}:?\d{2})$/.test(s) || !s.includes("T");
  const t = Date.parse(zoned ? s : s + "Z");
  return Number.isFinite(t) ? t : NaN;
}

/* When a unit starts (ms), NaN when it has no time: a folded unit starts with
   its first member. `at` (C22, step-order.js placeMoments): the moment each
   step counts at, a step the analyst placed elsewhere at the step its place
   hangs from. */
function _unitStart(unit, at) {
  const u = Array.isArray(unit && unit.members) && unit.members.length ? unit.members[0] : unit;
  if (at && at.has(u)) return at.get(u);
  return _ms(u && u.time_range && u.time_range.start);
}

/* The stretches of one run left out of the analysis: each excluded range
   ({ start, end }, ISO) cut to the run's span ({ startMs, endMs }, endMs
   null or missing for a run left open), in time order, overlapping ones
   joined; a range outside the span, or one that cannot be read, is dropped.
   No span start: nothing can be placed in the run. [{ startMs, endMs }]. */
function leftOutStretches(ranges, span) {
  const lo = span && Number.isFinite(span.startMs) ? span.startMs : NaN;
  if (!Number.isFinite(lo)) return [];
  const hi = span && Number.isFinite(span.endMs) ? span.endMs : Infinity;
  const cut = [];
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const a = _ms(r && r.start), b = _ms(r && r.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const s = Math.max(a, lo), e = Math.min(b, hi);
    if (e > s) cut.push({ startMs: s, endMs: e });
  }
  cut.sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs);
  const out = [];
  for (const c of cut) {
    const last = out[out.length - 1];
    if (last && c.startMs <= last.endMs) last.endMs = Math.max(last.endMs, c.endMs);
    else out.push({ startMs: c.startMs, endMs: c.endMs });
  }
  return out;
}

/* A time since the recording started, "0:19", "12:05", "1:02:03"; "" when it
   cannot be said (unknown, or before the start). step_context.clock's rule. */
function _since(ms, originMs) {
  const d = ms - originMs;
  if (!Number.isFinite(d) || d < 0) return "";
  const total = Math.floor(d / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

/* "a", "a and b", "a, b and c" (pdd_export._joined). */
function _joined(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

/* The one line a run with stretches left out says (see the header); "" for
   none. `originMs`: when the recording started. */
function leftOutText(stretches, originMs, unit) {
  const list = Array.isArray(stretches) ? stretches : [];
  if (!list.length) return "";
  const spans = list.map((s) => [_since(s.startMs, originMs), _since(s.endMs, originMs)]);
  const times = spans.every(([a, b]) => a && b) ? " (" + _joined(spans.map(([a, b]) => a + " to " + b)) + ")" : "";
  return "Part of this " + (unit || "run") + " was left out of the analysis" + times + ".";
}

/* The indexes in the reference of the steps inside the stretches (see the
   header): a Skipped line is not written for them. `units`: the run after
   folding; `refIndex`: key => the index of its first step in the reference. */
function _insideStretches(units, refIndex, refLength, stretches, moments) {
  const inside = new Set();
  for (const s of stretches) {
    let at = 0;
    for (const u of units) if (_unitStart(u, moments) < s.startMs) at++;
    let lo = -1, hi = refLength;
    for (let i = at - 1; i >= 0; i--) {
      const k = alignKey(units[i]);
      if (refIndex.has(k)) { lo = refIndex.get(k); break; }
    }
    for (let i = at; i < units.length; i++) {
      const k = alignKey(units[i]);
      if (refIndex.has(k)) { hi = refIndex.get(k); break; }
    }
    for (let j = lo + 1; j < hi; j++) inside.add(j);
  }
  return inside;
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

/* The C17 condition (one line) of the first reference step with the key
   `key` that has one, "" when none (pdd_export._condition_of_key). */
function _conditionOf(refSteps, key) {
  for (const s of refSteps) {
    if (!s || typeof s !== "object" || alignKey(s) !== key) continue;
    const c = typeof s.only_when === "string" ? s.only_when.replace(/\s+/g, " ").trim() : "";
    if (c) return c;
  }
  return "";
}

/* An analyst's condition inside a sentence: no full stop at its end
   (pdd_export._clause). */
function _clause(c) {
  return String(c || "").replace(/\s+$/, "").replace(/\.+$/, "").replace(/\s+$/, "");
}

/* How many times each alignment key occurs in `steps`. */
function _keyCounts(steps) {
  const m = new Map();
  for (const s of steps || []) { const k = alignKey(s); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

/* The kinds of line that are differences (pdd_export.COUNTED_KINDS). */
const COUNTED = new Set(["extra", "order", "skipped", "repeated"]);

/* The differences of a run from its reference, each as
     { kind: "left_out" | "extra" | "order" | "skipped" | "not_done" | "repeated",
       name?, where?, number?, condition?, times?, text }
   in the PDD's order: the one line on the stretches left out (when the run
   has any), the run's extra and reordered steps in run order, then the
   reference steps the run skipped or did not do (a step that happens only
   under a condition), then the steps the run did more often than the
   reference, in run order. `text` is the line pdd_export._differences
   writes; opts.reference names the reference in a Skipped line ("the pattern run" by
   default; the Steps level passes REFERENCE_RUN) and opts.unit what a run is
   called in the other lines ("run" by default; the Steps level passes
   RUN_UNIT). opts.leftOut: the run's stretches left out of the analysis
   (leftOutStretches), opts.originMs when the recording started, opts.at the
   moment each step counts at among them (C22, step-order.js placeMoments;
   each step's own start without it). Both lists are the visible steps in
   the order of a transaction (runs-model buildRuns: its process order, C22;
   steps that start at one moment keep their list order). */
function differences(refSteps, runSteps, opts) {
  const reference = (opts && opts.reference) || PATTERN_REFERENCE;
  const unit = (opts && opts.unit) || "run";
  const stretches = (opts && Array.isArray(opts.leftOut)) ? opts.leftOut : [];
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
  if (stretches.length) {
    out.push({ kind: "left_out", text: leftOutText(stretches, opts && opts.originMs, unit) });
  }
  for (const { key, step, index } of run) {
    const where = index ? "after " + stepName(units[index - 1]) : "at the start of the " + unit;
    const name = stepName(step);
    if (!patSet.has(key)) {
      out.push({ kind: "extra", name, where, text: "Extra step: " + name + " (" + where + ")." });
    } else if (!inOrder.has(key)) {
      out.push({ kind: "order", name, where, text: "Different order: " + name + " (in this " + unit + " " + where + ")." });
    }
  }
  const inside = stretches.length
    ? _insideStretches(units, new Map(pat.map((x) => [x.key, x.index])), ref.length, stretches, opts && opts.at) : new Set();
  for (const { key, step, index } of pat) {
    if (runSet.has(key) || inside.has(index)) continue;
    const name = stepName(step);
    const condition = _conditionOf(ref, key);
    if (condition) {
      out.push({ kind: "not_done", name, number: index + 1, condition,
        text: "Not done: " + name + " (only when " + _clause(condition) + ")." });
    } else {
      out.push({ kind: "skipped", name, number: index + 1,
        text: "Skipped: " + name + " (step " + (index + 1) + " of " + reference + ")." });
    }
  }
  const patCount = _keyCounts(ref), runCount = _keyCounts(units);
  for (const { key, step } of run) {
    const n = runCount.get(key) || 0;
    if (n >= 2 && n > (patCount.get(key) || 0)) {
      const name = stepName(step);
      out.push({ kind: "repeated", name, times: n, text: "Repeated: " + name + ", " + n + " times." });
    }
  }
  return out;
}

/* The run's steps a unit stands for, as step ids: a folded or named-alike
   unit stands for its members. */
function _unitIds(unit) {
  const list = Array.isArray(unit && unit.members) && unit.members.length ? unit.members : [unit];
  return list.map((m) => m && m.step_id).filter((id) => typeof id === "string" && id);
}

/* The differences of a run placed on its rows (2.0.1, the owner's review:
   the Steps list marks them where they happen, in place of a list of lines
   above the rows). The same alignment as `differences`, so a row's mark and
   the PDD's 4.1 line never disagree: { marks, ghosts }
     marks   Map of step id => { kind: "extra" | "order" | "repeated", text }:
             every run step a unit stands for carries its unit's mark; a
             repeated step carries "repeated" on each time past the
             reference's own count (its first time keeps "extra" when the
             reference lacks it);
     ghosts  [{ after, kind: "skipped" | "not_done", name, text }]: a
             reference step the run did not do, shown after the run's step
             `after` (a step id; null before the first row): the place of
             the nearest earlier reference step the run did.
   `text` is the line `differences` writes for it. Same opts; a stretch left
   out of the analysis is the caller's one line (leftOutText). */
function rowMarks(refSteps, runSteps, opts) {
  const reference = (opts && opts.reference) || PATTERN_REFERENCE;
  const unit = (opts && opts.unit) || "run";
  const stretches = (opts && Array.isArray(opts.leftOut)) ? opts.leftOut : [];
  const ref = Array.isArray(refSteps) ? refSteps : [];
  const units = collapseToReference(ref, runSteps);
  const pat = firstOccurrences(ref);
  const run = firstOccurrences(units);
  const patSet = new Set(pat.map((x) => x.key));
  const runSet = new Set(run.map((x) => x.key));
  const inOrder = commonOrder(pat.map((x) => x.key), run.map((x) => x.key));
  const marks = new Map();
  const mark = (u, m) => { for (const id of _unitIds(u)) if (!marks.has(id)) marks.set(id, m); };
  for (const { key, step, index } of run) {
    const where = index ? "after " + stepName(units[index - 1]) : "at the start of the " + unit;
    const name = stepName(step);
    if (!patSet.has(key)) mark(step, { kind: "extra", text: "Extra step: " + name + " (" + where + ")." });
    else if (!inOrder.has(key)) mark(step, { kind: "order", text: "Different order: " + name + " (in this " + unit + " " + where + ")." });
  }
  const patCount = _keyCounts(ref), runCount = _keyCounts(units);
  const seen = new Map();
  for (const u of units) {
    const key = alignKey(u);
    const n = runCount.get(key) || 0;
    const k = seen.get(key) || 0;
    seen.set(key, k + 1);
    if (n >= 2 && n > (patCount.get(key) || 0) && k >= Math.max(1, patCount.get(key) || 0)) {
      mark(u, { kind: "repeated", text: "Repeated: " + stepName(run.find((x) => x.key === key).step) + ", " + n + " times." });
    }
  }
  const inside = stretches.length
    ? _insideStretches(units, new Map(pat.map((x) => [x.key, x.index])), ref.length, stretches, opts && opts.at) : new Set();
  const firstUnit = new Map(run.map((x) => [x.key, x.step]));
  const ghosts = [];
  pat.forEach(({ key, step, index }, i) => {
    if (runSet.has(key) || inside.has(index)) return;
    let after = null;
    for (let j = i - 1; j >= 0; j--) {
      const u = firstUnit.get(pat[j].key);
      if (u) { const ids = _unitIds(u); after = ids.length ? ids[ids.length - 1] : null; break; }
    }
    const name = stepName(step);
    const condition = _conditionOf(ref, key);
    ghosts.push(condition
      ? { after, kind: "not_done", name, text: "Not done: " + name + " (only when " + _clause(condition) + ")." }
      : { after, kind: "skipped", name, text: "Skipped: " + name + " (step " + (index + 1) + " of " + reference + ")." });
  });
  return { marks, ghosts };
}

/* How many of `diffs` are differences: the left-out line and a Not done line
   are not (pdd_export.difference_count). */
function differenceCount(diffs) {
  return (Array.isArray(diffs) ? diffs : []).filter((d) => d && COUNTED.has(d.kind)).length;
}

/* Whether a line of `differences` is a difference (else it is said about
   the comparison: the left-out line, a Not done line). */
function isDifference(d) {
  return !!(d && COUNTED.has(d.kind));
}

module.exports = {
  PATTERN_REFERENCE, REFERENCE_RUN, RUN_UNIT,
  stepKeys, mergeKey, alignKey, stepName, collapseToReference, namedAlike, firstOccurrences, commonOrder, differences, rowMarks,
  leftOutStretches, leftOutText, differenceCount, isDifference, isoMs: _ms,
};
