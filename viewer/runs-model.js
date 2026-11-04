/*
 * runs-model.js: the runs-and-steps model behind the Steps level (BA helper
 * cycle, contracts C1 to C4 in .claude/agent-findings/2026-09-23_ba-helper-contracts.md).
 *
 * Pure: no DOM, no State, no IPC, so the unit tests drive it directly
 * (runs-model.test.js). views/steps-view.js renders it and calls the mutators
 * on the live annotations object right before its one persistAnnotations
 * write, so every change here lands in the same undo entry as the edit that
 * caused it (Ctrl+Z of a merge also takes its count back).
 *
 * A run is a top-level case from the markers: a stats.json `case_stats` entry
 * with no parent_case_id, in start order (the order the pipeline's
 * meta.draft_summary.steps_per_run uses). A step belongs to the run whose
 * case_id it carries; every other step is "outside runs". A person reads a
 * run as a "transaction" (AD-29): its title is "Transaction N"; code and
 * data keep the word run.
 *
 * The pattern run (C3, annotations.pattern_run) is the run the analyst
 * confirms first. Until the analyst makes a change that needs the record,
 * the default pattern (the first run with a step) is computed, not stored:
 * rendering never writes. The record is
 *   { case_id, confirmed_at, draft_fixes: { merge, split, add, drop },
 *     drafted_steps }
 * where drafted_steps (additive to C3) is the run's drafted-step count at the
 * moment the run became the pattern: the fallback for the probe line when
 * stats.json has no meta.draft_summary.
 *
 * Boundary fixes carry (lane L12b): a merge of drafted steps keeps their
 * draft keys as `draft_keys` (the members' keys in order, a merged member's
 * flattened), and a merge made in the pattern run is repeated on the same
 * consecutive drafts of every other run (carriedMerges). A draft hidden in
 * the pattern run can be hidden in every run (sameKeyDraftsElsewhere).
 * Neither counts as a fix of the pattern run. Reopen run (reopenRun) is the
 * inverse of Confirm run.
 */

"use strict";

const { stepKeys } = require("./run-differences.js");
const StepOrder = require("./step-order.js");

/* A step in one of these states stands on an analyst decision (C2). */
const ANALYST_STATES = new Set(["confirmed", "edited", "manually_authored"]);
/* Draft states: the pipeline's output the analyst has not acted on yet.
   auto_matched is legacy (C2 retires it) and is read as a draft. */
const DRAFT_STATES = new Set(["auto_suggested", "auto_matched"]);
const FIX_KINDS = ["merge", "split", "add", "drop"];
/* The group key of the steps outside every run. */
const OUTSIDE = "__outside__";

const STATUS_LABELS = { draft: "Draft", confirmed: "Confirmed", empty: "No steps" };

const CHIPS = {
  auto_suggested: { label: "Draft", cls: "draft" },
  auto_matched: { label: "Draft", cls: "draft" },
  confirmed: { label: "Confirmed", cls: "confirmed" },
  edited: { label: "Edited", cls: "edited" },
  manually_authored: { label: "Added", cls: "added" },
  hidden: { label: "Hidden", cls: "hidden" },
};

/* A marker label that only numbers its run ("Run 2", as the capture app
   names an unnamed run, or "Transaction 2"): it says nothing the title does
   not, so it is not shown, whatever word the recorder wrote (AD-29). */
function numberOnlyLabel(label) {
  return /^(run|transaction)\s*#?\s*\d+$/i.test(String(label == null ? "" : label).trim());
}

function _ms(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function stepStartMs(s) { return _ms(s && s.time_range && s.time_range.start); }
function stepEndMs(s) { return _ms(s && s.time_range && s.time_range.end); }

/* A step's place in its run (contract C16, the pipeline's step_sort_key):
   [0, start] for a step with a time, [1, order] for a step without one that
   has an order, [2, 0] for a step with neither. */
function _placeKey(s) {
  const t = stepStartMs(s);
  if (Number.isFinite(t)) return [0, t];
  const o = s && s.order;
  return typeof o === "number" && Number.isFinite(o) ? [1, o] : [2, 0];
}

/* The base order of a run's steps: the steps with a time in time order, then
   the steps without one by their `order`, then any step with neither. Steps
   that start at one moment keep their list order (the sort is stable), as the
   PDD's do (pdd_export._start_key; lane FX1: a tie once went by step_id, so
   Steps and the PDD could number two such steps apart). A run's members are
   in its process order (contract C22, step-order.js processOrder), which
   starts from this one and puts a step the analyst placed after the step it
   comes after. */
function byStart(a, b) {
  const x = _placeKey(a), y = _placeKey(b);
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  return 0;
}

/* Contract C19: a step may carry sub_steps (a sub-process), each the shape
   of a step, at any depth. Call fn(step) for every step of `steps` and of
   their sub_steps; `visibleOnly` leaves a hidden step out with everything
   under it. */
function _walk(steps, fn, visibleOnly) {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s !== "object" || (visibleOnly && s.state === "hidden")) continue;
    fn(s);
    if (Array.isArray(s.sub_steps)) _walk(s.sub_steps, fn, visibleOnly);
  }
}

/* The visible steps of `steps` at every level (C19). */
function visibleTree(steps) {
  const out = [];
  _walk(steps, (s) => out.push(s), true);
  return out;
}

/* True when a visible step at any level of `steps` is still a draft: then
   the transaction does not read confirmed (C19). */
function holdsDraft(steps) {
  return visibleTree(steps).some((s) => DRAFT_STATES.has(s.state));
}

/* A run's status; it reads confirmed only when no level holds a draft (C19).
   @returns {"draft"|"confirmed"|"empty"} */
function runStatus(members) {
  const vis = (members || []).filter((s) => s && s.state !== "hidden");
  if (!vis.length) return "empty";
  return visibleTree(vis).every((s) => ANALYST_STATES.has(s.state)) ? "confirmed" : "draft";
}

/* The pattern run reads confirmed: it was confirmed (C3, its record) and no
   level below the main one holds a draft since (C19: opening a step as a
   sub-process drafts its sub-steps, and Confirm transaction then accepts
   them). The main level reads its record as before. */
function patternConfirmed(record, run) {
  if (!(record && record.confirmed_at)) return false;
  const below = ((run && run.members) || []).filter((s) => s && s.state !== "hidden" && Array.isArray(s.sub_steps))
    .flatMap((s) => s.sub_steps);
  return !holdsDraft(below);
}

/** The chip shown on a step row: { label, cls }. */
function stepChip(state) {
  return CHIPS[state] || { label: "Draft", cls: "draft" };
}

/* The runs of a session, in start order, each with its steps.
     stats: the session's stats.json (case_stats, meta.draft_summary), or null
     steps: annotations.steps
   Returns { runs, outside } where each run is
     { caseId, ordinal, title, label, startMs, endMs, durationMs, members,
       visible, hiddenCount, status }
   (members: every step of the run in its process order, C22: time order,
   a step the analyst placed after the step it comes after; visible: the
   non-hidden ones) and outside is the steps of no run, in the same order. Without
   case_stats (a session analyzed before the cases were written) the runs
   come from the steps' own case ids. */
function buildRuns(stats, steps) {
  const all = (Array.isArray(steps) ? steps : []).filter((s) => s && typeof s === "object");
  const cs = stats && Array.isArray(stats.case_stats) ? stats.case_stats : null;
  let runs;
  if (cs) {
    runs = cs
      .filter((c) => c && typeof c.case_id === "string" && c.case_id && !c.parent_case_id)
      .map((c) => {
        const startMs = _ms(c.start_ts);
        const endMs = _ms(c.end_ts);
        // An open run (C16: the implicit run, a run with no end) has none: null is not 0.
        const wall = c.wall_clock_ms == null ? NaN : Number(c.wall_clock_ms);
        return {
          caseId: c.case_id,
          label: typeof c.label === "string" ? c.label.trim() : "",
          startMs, endMs: Number.isFinite(endMs) ? endMs : null,
          durationMs: Number.isFinite(wall) && wall >= 0 ? wall
            : (Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null),
        };
      });
  } else {
    const byCase = new Map();
    for (const s of all) {
      if (typeof s.case_id !== "string" || !s.case_id) continue;
      const a = stepStartMs(s), b = stepEndMs(s);
      const r = byCase.get(s.case_id) || { caseId: s.case_id, label: "", startMs: Infinity, endMs: -Infinity };
      if (Number.isFinite(a)) r.startMs = Math.min(r.startMs, a);
      if (Number.isFinite(b)) r.endMs = Math.max(r.endMs, b);
      byCase.set(s.case_id, r);
    }
    runs = [...byCase.values()].map((r) => {
      const startMs = Number.isFinite(r.startMs) ? r.startMs : NaN;
      const endMs = Number.isFinite(r.endMs) ? r.endMs : null;
      return { caseId: r.caseId, label: "", startMs, endMs,
        durationMs: Number.isFinite(startMs) && endMs != null ? Math.max(0, endMs - startMs) : null };
    });
  }
  // The pipeline's draft_summary orders runs by (start, case_id), a start it
  // cannot read counting as the epoch; the ordinals must match it.
  runs.sort((a, b) => {
    const x = Number.isFinite(a.startMs) ? a.startMs : 0, y = Number.isFinite(b.startMs) ? b.startMs : 0;
    if (x !== y) return x - y;
    return a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0;
  });
  const byId = new Map(runs.map((r) => [r.caseId, r]));
  for (const r of runs) r.members = [];
  const outside = [];
  for (const s of all) {
    const r = typeof s.case_id === "string" ? byId.get(s.case_id) : null;
    if (r) r.members.push(s); else outside.push(s);
  }
  runs.forEach((r, i) => {
    r.ordinal = i + 1;
    r.title = "Transaction " + r.ordinal;
    // The marker label shows next to the title unless it only repeats it or
    // only numbers the run (the capture app labels runs "Run 1", "Run 2", ...).
    if (r.label && (r.label.toLowerCase() === r.title.toLowerCase() || numberOnlyLabel(r.label))) r.label = "";
    r.members = StepOrder.processOrder(r.members);
    r.visible = r.members.filter((s) => s.state !== "hidden");
    r.hiddenCount = r.members.length - r.visible.length;
    r.status = runStatus(r.members);
  });
  return { runs, outside: StepOrder.processOrder(outside) };
}

/* The run that holds a step's start (C9's rule as lane FX1 amended it, the
   pipeline's restamp_preserved_case_ids; used for a step the viewer
   creates): the step's start inside the run's span, whatever its end; a run
   left open spans to the end of the recording. When two runs hold it (a
   start on their boundary), the one that opened last wins. A step that runs
   on past the run's end still belongs to the run it started in, so a
   caller's third argument (the step's end) is not read. Returns the run or
   null. */
function runForRange(runs, startMs) {
  if (!Number.isFinite(startMs)) return null;
  let best = null;
  for (const r of runs || []) {
    if (!Number.isFinite(r.startMs) || r.startMs > startMs) continue;
    if (r.endMs != null && startMs > r.endMs) continue;
    if (!best || r.startMs >= best.startMs) best = r;
  }
  return best;
}

/* The group key of a step: its run's case_id, or OUTSIDE. */
function groupKeyOf(step, runs) {
  const cid = step && step.case_id;
  return (typeof cid === "string" && (runs || []).some((r) => r.caseId === cid)) ? cid : OUTSIDE;
}

/* The steps a group shows, in time order: a run's steps, or the steps outside
   every run; hidden ones only when showHidden. */
function groupSteps(model, key, showHidden) {
  if (!model || key == null) return [];
  let list;
  if (key === OUTSIDE) list = model.outside || [];
  else {
    const r = (model.runs || []).find((x) => x.caseId === key);
    list = r ? r.members : [];
  }
  return showHidden ? list.slice() : list.filter((s) => s.state !== "hidden");
}

/* The step after `stepId` in its group's list (the row below it). */
function nextInGroup(model, stepId, showHidden) {
  const all = [...(model.runs || []).flatMap((r) => r.members), ...(model.outside || [])];
  const step = all.find((s) => s.step_id === stepId);
  if (!step) return null;
  const list = groupSteps(model, groupKeyOf(step, model.runs), showHidden);
  const i = list.findIndex((s) => s.step_id === stepId);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

/* ---- The pattern run (C3) ------------------------------------------------ */

function emptyFixes() { return { merge: 0, split: 0, add: 0, drop: 0 }; }

function _fixes(raw) {
  const f = emptyFixes();
  for (const k of FIX_KINDS) {
    const v = raw && Number(raw[k]);
    if (Number.isFinite(v) && v > 0) f[k] = Math.floor(v);
  }
  return f;
}

/* The first run by start time that has at least one visible step: a run
   whose every step is hidden is passed over, as the PDD passes it over
   (pdd_export._Session._pick_pattern; lane FX1, pinned by the
   reference_cases of shared/run-differences-golden.json). */
function defaultPatternRun(runs) {
  return (runs || []).find((r) => (r.members || []).some((s) => s && s.state !== "hidden")) || null;
}

/* { run, record }: the stored pattern run when its case_id is a current run,
   else the default pattern run with no record yet (record null). */
function patternRun(anno, runs) {
  const pr = anno && anno.pattern_run;
  if (pr && typeof pr === "object" && typeof pr.case_id === "string") {
    const run = (runs || []).find((r) => r.caseId === pr.case_id);
    if (run) return { run, record: pr };
  }
  return { run: defaultPatternRun(runs), record: null };
}

/* Make `run` the pattern run: a fresh record with the counters at zero and
   the run's drafted-step count now (its steps the analyst did not add). */
function designatePattern(anno, run) {
  anno.pattern_run = {
    case_id: run.caseId,
    confirmed_at: null,
    draft_fixes: emptyFixes(),
    drafted_steps: (run.members || []).filter((s) => s.state !== "manually_authored").length,
  };
  return anno.pattern_run;
}

/* "Use as pattern": make the run with `caseId` the pattern run. Choosing the
   current pattern again changes nothing (its counters are kept). Returns the
   record, or null for an unknown run. */
function usePattern(anno, runs, caseId) {
  const run = (runs || []).find((r) => r.caseId === caseId);
  if (!run) return null;
  const p = patternRun(anno, runs);
  if (p.record && p.run && p.run.caseId === caseId) return p.record;
  return designatePattern(anno, run);
}

/* Count one boundary fix of `kind` (merge, split, add, drop) made to the run
   `caseId`: +1, or -1 for an inverse (unhide, removing an added step), never
   below zero. Counted only while that run is the pattern run and it is not
   confirmed yet; the first counted fix on the default pattern run creates its
   record. Renames are never counted (no kind for them). Returns true when the
   counter moved. */
function recordFix(anno, runs, caseId, kind, delta) {
  const d = delta === undefined ? 1 : delta;
  if (!FIX_KINDS.includes(kind) || typeof caseId !== "string" || !caseId || !d) return false;
  const p = patternRun(anno, runs);
  if (!p.run || p.run.caseId !== caseId) return false;
  let rec = p.record;
  if (!rec) {
    if (d < 0) return false;
    rec = designatePattern(anno, p.run);
  }
  if (rec.confirmed_at) return false;
  const f = _fixes(rec.draft_fixes);
  const before = f[kind];
  f[kind] = Math.max(0, before + d);
  rec.draft_fixes = f;
  return f[kind] !== before;
}

/* The steps of run `caseId` at every level (C19: a sub-step has its
   parent's case_id; the main-level step decides). */
function _runTree(anno, caseId) {
  const out = [];
  for (const s of (anno && anno.steps) || []) {
    if (s && s.case_id === caseId) _walk([s], (x) => out.push(x), false);
  }
  return out;
}

/* "Confirm run" (C2, C3): the run's remaining draft steps become `confirmed`,
   at every level (C19); for the pattern run, pattern_run.confirmed_at is set
   (kept when already set). Returns { converted, patternConfirmed }. */
function confirmRun(anno, runs, caseId, nowIso) {
  const p = patternRun(anno, runs);
  const isPattern = !!(p.run && p.run.caseId === caseId);
  const rec = isPattern ? (p.record || designatePattern(anno, p.run)) : null;
  let converted = 0;
  for (const s of _runTree(anno, caseId)) {
    if (DRAFT_STATES.has(s.state)) {
      s.state = "confirmed";
      converted++;
    }
  }
  if (rec && !rec.confirmed_at) rec.confirmed_at = nowIso;
  return { converted, patternConfirmed: isPattern };
}

/* "Reopen run" (the viewer's Undo confirm), the inverse of Confirm run: the
   run's confirmed steps are drafts again at every level (C19; a hidden step
   that was confirmed unhides as a draft), while the steps the analyst edited
   or added keep their state; on the pattern run, confirmed_at goes back to
   null and its draft-fix counts are kept. Returns { reopened,
   patternReopened }. */
function reopenRun(anno, runs, caseId) {
  const p = patternRun(anno, runs);
  const isPattern = !!(p.run && p.run.caseId === caseId);
  let reopened = 0;
  for (const s of _runTree(anno, caseId)) {
    if (s.state === "confirmed") {
      s.state = "auto_suggested";
      reopened++;
    } else if (s.state === "hidden" && s._prev_state === "confirmed") {
      s._prev_state = "auto_suggested";
    }
  }
  const patternReopened = !!(isPattern && p.record && p.record.confirmed_at);
  if (patternReopened) p.record.confirmed_at = null;
  return { reopened, patternReopened };
}

/* Whether Reopen run applies to `run`: a confirmed pattern run, or another
   run that reads Confirmed and has confirmed steps to turn back. */
function canReopen(run, patternRecord, isPattern) {
  if (!run) return false;
  if (isPattern) return !!(patternRecord && patternRecord.confirmed_at);
  return run.status === "confirmed" && visibleTree(run.members).some((s) => s.state === "confirmed");
}

/* ---- Carried boundary fixes (lane L12b) -------------------------------------- */

/* The draft keys a merge of `steps` keeps: each member's draft_key, or a
   merged member's draft_keys, in order. Null when a member has no draft
   identity (a step added by hand, a split half): the merge then keeps none. */
function mergedDraftKeys(steps) {
  const out = [];
  for (const s of steps || []) {
    const keys = stepKeys(s);
    if (!keys) return null;
    out.push(...keys);
  }
  return out.length ? out : null;
}

/* How many visible steps from list[i] on are still drafts that read exactly
   `keys` in order, or 0. */
function _draftStretchAt(list, i, keys) {
  let k = 0, j = i;
  while (k < keys.length) {
    const s = list[j];
    if (!s || !DRAFT_STATES.has(s.state)) return 0;
    const sk = stepKeys(s);
    if (!sk) return 0;
    for (const key of sk) {
      if (k >= keys.length || key !== keys[k]) return 0;
      k++;
    }
    j++;
  }
  return j - i;
}

/* Where a merge made in the pattern run carries (item 2): in every other run,
   each stretch of at least two consecutive visible steps, all still drafts,
   whose draft keys read exactly `keys` (left to right, never overlapping).
   Returns [{ caseId, steps }], one entry per stretch; a run can have two. */
function carriedMerges(model, patternCaseId, keys) {
  const out = [];
  if (!Array.isArray(keys) || keys.length < 2) return out;
  for (const run of (model && model.runs) || []) {
    if (run.caseId === patternCaseId) continue;
    const list = run.visible || [];
    let i = 0;
    while (i < list.length) {
      const n = _draftStretchAt(list, i, keys);
      if (n >= 2) {
        out.push({ caseId: run.caseId, steps: list.slice(i, i + n) });
        i += n;
      } else {
        i++;
      }
    }
  }
  return out;
}

/* What "Hide in all runs" hides with a pattern-run draft (item 2): every
   other run's visible, still-draft steps with the same draft_key. */
function sameKeyDraftsElsewhere(model, patternCaseId, draftKey) {
  const out = [];
  if (typeof draftKey !== "string" || !draftKey) return out;
  for (const run of (model && model.runs) || []) {
    if (run.caseId === patternCaseId) continue;
    for (const s of run.visible || []) {
      if (DRAFT_STATES.has(s.state) && s.draft_key === draftKey) out.push(s);
    }
  }
  return out;
}

/* Hide steps: each keeps its state in _prev_state, so Unhide restores it. */
function hideSteps(steps) {
  for (const s of steps || []) {
    if (!s || s.state === "hidden") continue;
    s._prev_state = s.state;
    s.state = "hidden";
  }
}

/* How many distinct runs a list of steps (or of { caseId }) touches. */
function runCount(items) {
  return new Set((items || []).map((x) => (x && (x.caseId || x.case_id)) || null)).size;
}

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* The P1 probe line for the pattern run:
     "Transaction 1: 7 drafted steps, 1 boundary fix (merge 1, split 0, add 0, hide 0)"
   "hide" is the stored `drop` count: the button that takes a draft out says
   Hide, so the line says it too (P2.9).
   N is the run's entry in stats.json meta.draft_summary.steps_per_run (the
   drafts the pipeline produced); when the stats lack it, the count stored when
   the run became the pattern (source "designation"). Structure only: the run
   is named by its number, never by its marker label. */
function probeLine(stats, runs, run, record) {
  const ds = stats && stats.meta && stats.meta.draft_summary;
  const per = ds && Array.isArray(ds.steps_per_run) ? ds.steps_per_run : null;
  let drafted = null, source = null;
  if (per && per.length === (runs || []).length && run && Number.isInteger(per[run.ordinal - 1])) {
    drafted = per[run.ordinal - 1];
    source = "analysis";
  } else if (record && Number.isInteger(record.drafted_steps)) {
    drafted = record.drafted_steps;
    source = "designation";
  }
  const f = _fixes(record && record.draft_fixes);
  const total = f.merge + f.split + f.add + f.drop;
  const text = (run ? run.title : "Transaction") + ": " +
    (drafted == null ? "drafted steps not recorded" : _plural(drafted, "drafted step", "drafted steps")) +
    ", " + _plural(total, "boundary fix", "boundary fixes") +
    " (merge " + f.merge + ", split " + f.split + ", add " + f.add + ", hide " + f.drop + ")";
  return { text, drafted, source, fixes: f, total };
}

/* ---- Names ------------------------------------------------------------------ */

/* An analyst renamed `step` to `name`: every OTHER still-draft step of the
   session with the same draft_key takes the name at once, at every level
   (C19: a group keeps its drafts as sub-steps), keeps state auto_suggested,
   and gets name_source "remembered" (and the pipeline's own process_label
   for a named draft: the name). The key is compared whole and never split: a
   screen label can contain "|". Returns how many steps took the name. */
function propagateName(steps, step, name) {
  return _propagate(steps, step, name, "draft_key");
}

/* C19: a drafted sub-step renamed: the session's other drafted sub-steps
   with the same action_key take the name, as propagateName does for a
   draft_key. Returns how many took it. */
function propagateActionName(steps, step, name) {
  return _propagate(steps, step, name, "action_key");
}

/* A merged step renamed (its screens in draft_keys, no draft_key): the
   project's other steps with the same screens in the same order that still
   carry its old name (a merge carried to the other transactions takes the
   name the merge had) take the new name too, so the map keeps one box.
   Returns how many took it. */
function propagateMergedName(steps, step, oldName, name) {
  const keys = step && Array.isArray(step.draft_keys) ? step.draft_keys : null;
  const nm = typeof name === "string" ? name.trim() : "";
  const was = typeof oldName === "string" ? oldName.trim() : "";
  if (!keys || !keys.length || !nm || !was || nm === was) return 0;
  const same = (k) => Array.isArray(k) && k.length === keys.length && k.every((x, i) => x === keys[i]);
  let n = 0;
  _walk(steps, (s) => {
    if (s === step || s.step_id === step.step_id || s.state === "hidden") return;
    if (!same(s.draft_keys) || String(s.name || "").trim() !== was) return;
    s.name = nm;
    s.process_label = nm;
    n++;
  });
  return n;
}

function _propagate(steps, step, name, field) {
  const key = step && step[field];
  const nm = typeof name === "string" ? name.trim() : "";
  if (typeof key !== "string" || !key || !nm) return 0;
  let n = 0;
  _walk(steps, (s) => {
    if (s === step || s.step_id === step.step_id) return;
    if (s.state !== "auto_suggested" || s[field] !== key) return;
    s.name = nm;
    s.name_source = "remembered";
    s.process_label = nm;
    n++;
  }, false);
  return n;
}

/* The readable name of an application token ("chrome", "chrome.exe",
   "EXCEL.EXE"): the recording's own name for it (stats.json meta.app_names,
   the names the PDD and the capture detail use), else the executable name without
   its extension, capitalized when it is a machine token. Mirrors
   normalization/app_names.display_name. Used by the Steps level. */
function readableApp(app, names) {
  const raw = String(app || "").trim();
  if (!raw || raw === "(app)") return "";
  const map = (names && typeof names === "object") ? names : {};
  if (typeof map[raw] === "string" && map[raw].trim()) return map[raw].trim();
  const key = (v) => { const k = String(v || "").trim().toLowerCase(); return k.endsWith(".exe") ? k.slice(0, -4) : k; };
  for (const [exe, nm] of Object.entries(map)) {
    if (key(exe) === key(raw) && typeof nm === "string" && nm.trim()) return nm.trim();
  }
  const bare = raw.toLowerCase().endsWith(".exe") ? raw.slice(0, -4) : raw;
  return (bare === bare.toUpperCase() || bare === bare.toLowerCase())
    ? bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase() : bare;
}

/* Names to suggest while renaming a step in its row: the names already used
   in this project, the names the analyst gave first. Case-insensitive
   duplicates are dropped. (The step pane's name field offers the activities
   of the library instead: library.js pickerFor.) */
function nameSuggestions(steps) {
  const out = [];
  const seen = new Set();
  const add = (n) => {
    const t = typeof n === "string" ? n.trim() : "";
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  const live = (steps || []).filter((s) => s && s.state !== "hidden");
  for (const s of live) if (ANALYST_STATES.has(s.state)) add(s.name);
  for (const s of live) if (!ANALYST_STATES.has(s.state)) add(s.name);
  return out;
}

/* A merged or split step is no longer one draft: drop the C1 identity
   (draft_key, name_source, end_reason) and a merge's draft_keys, so a later
   rename does not name the drafts of a key that no longer describes it. A
   merge of drafts then sets its own draft_keys (mergedDraftKeys). */
function dropDraftIdentity(step) {
  if (!step || typeof step !== "object") return step;
  delete step.draft_key;
  delete step.draft_keys;
  delete step.name_source;
  delete step.end_reason;
  // C19: a merged or split sub-step is no longer one drafted action either.
  delete step.action_key;
  // C21: nor is it named from the library ("A + B", "A (split 1)").
  delete step.library_activity;
  return step;
}

module.exports = {
  ANALYST_STATES, DRAFT_STATES, FIX_KINDS, OUTSIDE, STATUS_LABELS,
  byStart, runStatus, visibleTree, holdsDraft, patternConfirmed, stepChip, buildRuns, numberOnlyLabel, runForRange,
  groupKeyOf, groupSteps, nextInGroup,
  emptyFixes, defaultPatternRun, patternRun, designatePattern, usePattern, recordFix, confirmRun,
  reopenRun, canReopen,
  probeLine, propagateName, propagateActionName, propagateMergedName, readableApp, nameSuggestions, dropDraftIdentity,
  mergedDraftKeys, carriedMerges, sameKeyDraftsElsewhere, hideSteps, runCount,
};
