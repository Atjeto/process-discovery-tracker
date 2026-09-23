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
 * case_id it carries; every other step is "outside runs".
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
 */

"use strict";

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

function _ms(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function stepStartMs(s) { return _ms(s && s.time_range && s.time_range.start); }
function stepEndMs(s) { return _ms(s && s.time_range && s.time_range.end); }

/* Time order, stable on ties (step_id breaks them). A step without a readable
   start sorts last. */
function byStart(a, b) {
  const x = stepStartMs(a), y = stepStartMs(b);
  const xs = Number.isFinite(x) ? x : Infinity, ys = Number.isFinite(y) ? y : Infinity;
  if (xs !== ys) return xs < ys ? -1 : 1;
  return String((a && a.step_id) || "").localeCompare(String((b && b.step_id) || ""));
}

/** @returns {"draft"|"confirmed"|"empty"} */
function runStatus(members) {
  const vis = (members || []).filter((s) => s && s.state !== "hidden");
  if (!vis.length) return "empty";
  return vis.every((s) => ANALYST_STATES.has(s.state)) ? "confirmed" : "draft";
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
   (members: every step of the run in time order; visible: the non-hidden
   ones) and outside is the steps of no run, in time order. Without
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
        const wall = Number(c.wall_clock_ms);
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
    r.title = "Run " + r.ordinal;
    // The marker label shows next to the title unless it only repeats it
    // (the capture app labels runs "Run 1", "Run 2", ...).
    if (r.label && r.label.toLowerCase() === r.title.toLowerCase()) r.label = "";
    r.members.sort(byStart);
    r.visible = r.members.filter((s) => s.state !== "hidden");
    r.hiddenCount = r.members.length - r.visible.length;
    r.status = runStatus(r.members);
  });
  outside.sort(byStart);
  return { runs, outside };
}

/* The run that contains a time range (C9's rule, used for a step the viewer
   creates): start and end inside the run's span; a run left open spans to
   the end of the recording. When two runs contain it, the one that opened
   last wins. Returns the run or null. */
function runForRange(runs, startMs, endMs) {
  if (!Number.isFinite(startMs)) return null;
  const end = Number.isFinite(endMs) ? endMs : startMs;
  let best = null;
  for (const r of runs || []) {
    if (!Number.isFinite(r.startMs) || r.startMs > startMs) continue;
    if (r.endMs != null && end > r.endMs) continue;
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

/* The first run by start time that has at least one step. */
function defaultPatternRun(runs) {
  return (runs || []).find((r) => r.members && r.members.length > 0) || null;
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

/* "Confirm run" (C2, C3): the run's remaining draft steps become `confirmed`;
   for the pattern run, pattern_run.confirmed_at is set (kept when already
   set). Returns { converted, patternConfirmed }. */
function confirmRun(anno, runs, caseId, nowIso) {
  const p = patternRun(anno, runs);
  const isPattern = !!(p.run && p.run.caseId === caseId);
  const rec = isPattern ? (p.record || designatePattern(anno, p.run)) : null;
  let converted = 0;
  for (const s of (anno && anno.steps) || []) {
    if (s && s.case_id === caseId && DRAFT_STATES.has(s.state)) {
      s.state = "confirmed";
      converted++;
    }
  }
  if (rec && !rec.confirmed_at) rec.confirmed_at = nowIso;
  return { converted, patternConfirmed: isPattern };
}

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* The P1 probe line for the pattern run:
     "Run 1: 7 drafted steps, 1 boundary fix (merge 1, split 0, add 0, drop 0)"
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
  const text = (run ? run.title : "Run") + ": " +
    (drafted == null ? "drafted steps not recorded" : _plural(drafted, "drafted step", "drafted steps")) +
    ", " + _plural(total, "boundary fix", "boundary fixes") +
    " (merge " + f.merge + ", split " + f.split + ", add " + f.add + ", drop " + f.drop + ")";
  return { text, drafted, source, fixes: f, total };
}

/* ---- Names (C4) ------------------------------------------------------------ */

/* An analyst renamed `step` to `name`: every OTHER still-draft step of the
   session with the same draft_key takes the name at once, keeps state
   auto_suggested, and gets name_source "remembered" (and the pipeline's own
   process_label for a named draft: the name). The key is compared whole and
   never split: a screen label can contain "|". Returns how many steps took
   the name. */
function propagateName(steps, step, name) {
  const key = step && step.draft_key;
  const nm = typeof name === "string" ? name.trim() : "";
  if (typeof key !== "string" || !key || !nm) return 0;
  let n = 0;
  for (const s of steps || []) {
    if (!s || s === step || s.step_id === step.step_id) continue;
    if (s.state !== "auto_suggested" || s.draft_key !== key) continue;
    s.name = nm;
    s.name_source = "remembered";
    s.process_label = nm;
    n++;
  }
  return n;
}

/* The C1 app of a step: the process name of its first interaction that has
   one, lowercased, ".exe" stripped; "" when unknown. Read from the
   interactions, never by splitting the draft_key. */
function stepApp(step, interactionsById) {
  const ids = (step && step.evidence && step.evidence.interaction_event_ids) || [];
  for (const id of ids) {
    const ev = interactionsById && interactionsById[id];
    const p = ev && ev.data && ev.data.process_name;
    if (typeof p === "string" && p.trim()) {
      const a = p.trim().toLowerCase();
      return a.endsWith(".exe") ? a.slice(0, -4) : a;
    }
  }
  return "";
}

/* Names to suggest while naming `step`: remembered names whose draft_key is
   for the same app (the key starts with "<app>|"; an app is a process name,
   which cannot contain "|"), the most recently remembered first, then the
   names already used in this session (names the analyst gave first).
   Case-insensitive duplicates are dropped. */
function nameSuggestions(steps, step, remembered, interactionsById) {
  const out = [];
  const seen = new Set();
  const add = (n) => {
    const t = typeof n === "string" ? n.trim() : "";
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  const app = stepApp(step, interactionsById);
  if (app && remembered && typeof remembered === "object") {
    const prefix = app + "|";
    const same = Object.keys(remembered)
      .filter((key) => key.startsWith(prefix) && remembered[key] && typeof remembered[key] === "object")
      .map((key) => remembered[key])
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) ||
        String(a.name || "").localeCompare(String(b.name || "")));
    for (const e of same) add(e.name);
  }
  const live = (steps || []).filter((s) => s && s.state !== "hidden");
  for (const s of live) if (ANALYST_STATES.has(s.state)) add(s.name);
  for (const s of live) if (!ANALYST_STATES.has(s.state)) add(s.name);
  return out;
}

/* A merged or split step is no longer one draft: drop the C1 identity
   (draft_key, name_source, end_reason) so a later rename is not remembered
   under a key that no longer describes it. */
function dropDraftIdentity(step) {
  if (!step || typeof step !== "object") return step;
  delete step.draft_key;
  delete step.name_source;
  delete step.end_reason;
  return step;
}

module.exports = {
  ANALYST_STATES, DRAFT_STATES, FIX_KINDS, OUTSIDE, STATUS_LABELS,
  byStart, runStatus, stepChip, buildRuns, runForRange, groupKeyOf, groupSteps, nextInGroup,
  emptyFixes, defaultPatternRun, patternRun, designatePattern, usePattern, recordFix, confirmRun,
  probeLine, propagateName, stepApp, nameSuggestions, dropDraftIdentity,
};
