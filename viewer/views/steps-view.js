/*
 * steps-view.js -- the Steps level of the Session view: the runs and their
 * steps (BA helper cycle, contracts C1 to C4). A person reads a run as a
 * "transaction" (AD-29): every word on this level says transaction, and the
 * list's header says in one line what a transaction is; code and data keep
 * the word run.
 *
 * The list pane shows the runs in time order (the cases from the markers).
 * One group is open at a time: a run, which lists its steps in time order,
 * or the collapsed-by-default "Outside runs" group for the steps no run
 * contains. The analyst confirms the REFERENCE run (annotations.pattern_run,
 * C3; fix its boundaries, name its steps, Confirm run); the other runs are
 * reviewed, never confirmed (AD-28): a run counts as reviewed once it was
 * opened (annotations.opened_runs). The app counts the boundary fixes made to
 * the reference run (merge, split, add, hide); once it is confirmed, the
 * probe line is in its right-click menu. Renaming a step that carries a
 * draft_key names the same-key drafts of the project at once. The step
 * pane's name field offers the activities of the step's system from the
 * project's activity library (contract C21, library.js): a pick names the
 * step from the library.
 *
 * Lane L12b: a merge made in the pattern run carries to the same consecutive
 * drafts of the other runs (one undo), and a draft hidden there can be hidden
 * in all runs (a toast offers it). Every other run is compared with the
 * pattern run (run-differences.js, the algorithm the PDD's section 6.1
 * uses): an open run lists its differences, a run's meta counts them. Undo
 * confirm takes Confirm run back; a drafted step is hidden, never deleted (the
 * next Analyze would draft it again). (Saved processes, contract C5, left the
 * app on 2026-09-24: a process is recorded once; the remembered step names,
 * C4, on 2026-09-25: the activity library names steps now.)
 *
 * Contract C19 (sub-processes): a step may carry sub_steps, at any depth. The
 * list shows one level at a time (State.mapPath, a path of map nodes; [] the
 * main level): inside a sub-process a breadcrumb names the way down and goes
 * up, and the list has one block per visit of the sub-process ("Transaction
 * 2", "Transaction 2, again"), the reference transaction's first visit marked
 * and compared with the others as a transaction is at the main level. A
 * sub-process row opens its level ("▸ N sub-steps"); Open as a sub-process,
 * Group into a sub-process and Dissolve sub-process make and undo one
 * (sub-process-verbs.js), and every verb here works at the level shown.
 *
 * The model is runs-model.js (pure, unit-tested); this module renders it and
 * owns the step verbs (rename / save / split / merge / hide / delete / add /
 * bulk hide or delete / confirm run / undo confirm / use as pattern / the
 * sub-process verbs, a pick from the library) and the Apps outside the
 * process dialog.
 * Cross-surface helpers (ensureAnnoShape, persistAnnotations,
 * jumpToStepInFlow, watchStep) are injected by
 * renderer.js via initStepsView().
 */

"use strict";

const { $, escapeHtml, escapeAttr, cryptoRandomId, toast, placeMenu, recordingStartMs, sinceStart, errorSince } = require("../dom.js");
// Lane A-2: a refused time says why beside its field.
const FieldRefusal = require("../field-refusal.js");
const { confirmModal, promptModal, chooseModal, holdFocus } = require("../modals.js");
const State = require("../state.js");
const Session = require("../session.js");
const PdtSteps = require("../step-editor.js");
const RunsModel = require("../runs-model.js");
const RunDiff = require("../run-differences.js");
const TM = require("../transcript-model.js");
const SystemNames = require("../system-names.js");
const StepFacts = require("../step-facts.js");
const StepPanel = require("./step-panel.js");
const AC = require("../analyst-content.js");
const AnalystUI = require("./analyst-ui.js");
const Video = require("./flow-view-video.js");
const StepFlow = require("../step-flow.js");
const PaneSplitter = require("../pane-splitter.js");
const SPM = require("../sub-process-maps.js");
const SPV = require("../sub-process-verbs.js");
const { processLabel, mapNodeLabel } = require("../process-map-levels.js");
const RO = require("../read-only.js");
const Library = require("../library.js");
const TE = require("../time-edits.js");
const MarkerEdits = require("../marker-edits.js");
const FlowMarkers = require("./flow-view-markers.js");
const StepOrder = require("../step-order.js");
const ShowHere = require("../show-here.js");
const LeftOut = require("../left-out.js");
const StepScope = require("../step-scope.js");
const StepInfo = require("../step-information.js");
// C27: the exceptions of a step.
const StepExc = require("../step-exceptions.js");

const OUTSIDE = RunsModel.OUTSIDE;

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let jumpToStepInFlow = () => {};
let watchStep = () => {};
let analyze = async () => false;

/* 2.0.1: where the two steps of the last Merge with next met, marked in the
   merged step's recorded actions ({ stepId, after }: after that action), so
   moving the line between two steps is Merge, then the scissors. */
let _mergedLine = { stepId: null, after: null };

/* Split never guesses where (it cut at the midpoint before 2.0.1). */
const SPLIT_WHERE = "Click the scissors after the action where the first part ends, under Recorded.";

/* The runs view's own state, per session folder: `open` is the group whose
   steps show (a run's case_id, OUTSIDE, or null for none; undefined until
   the first render opens the pattern run) and `showHidden` also lists the
   hidden steps of the open group. It survives level switches and a
   re-analysis of the same session (case ids are stable, C9), so a return to
   Steps finds the view as the analyst left it. Inside a sub-process (C19)
   `levelOpen` is the open block (a visit's key, see _containers) and
   `levelKey` the level it belongs to; `open` keeps the main level's. */
function _freshUi(folder) {
  return { folder, open: undefined, showHidden: false, levelOpen: undefined, levelKey: "" };
}
let _ui = _freshUi(null);

/* The datalist of a row's inline rename: the names used in the project. */
const NAME_LIST_ID = "step-name-suggestions";

/* The Timeline's span (the recording's events, or a video project's video). */
function getSpan() {
  return Video.timelineSpan();
}

function _interactionsById() {
  const m = {};
  for (const ev of ((State.getSession() && State.getSession().events) || [])) {
    if (ev.type === "interaction") m[ev.event_id] = ev;
  }
  return m;
}

/* The runs model of the loaded session: runs from stats.json, steps from the
   live annotations (so it reflects every edit made since the last analysis). */
function _model() {
  const s = State.getSession();
  return RunsModel.buildRuns(s && s.stats, (s && s.annotations && s.annotations.steps) || []);
}

/* A step by id at any level (C19), or null. */
function _findStep(stepId) {
  const loc = _locate(stepId);
  return loc ? loc.step : null;
}

/* Where a step is (sub-process-maps.findStep: its list, parent, depth and
   the path of its level), or null. */
function _locate(stepId) {
  const s = State.getSession();
  return SPM.findStep((s && s.annotations && s.annotations.steps) || [], stepId);
}

/* ===== A step's place in the process (contract C22, 2.0.5) ================
   The owner: a correction the SME shows late in a video belongs early in
   the process. A step's place in its transaction is its own
   (step.placed_after, step-order.js); its time stays where it was shown. */

function _caseKey(s) { return s && typeof s.case_id === "string" && s.case_id ? s.case_id : null; }

/* The place a step's order is kept in: its level's list (annotations.steps,
   or the sub_steps of its parent) and that list's visible steps that share
   its transaction (at the main level; a sub-step shares its parent's), in
   the list's order. null for a step not found. */
function _placeOf(stepId) {
  const loc = _locate(stepId);
  if (!loc) return null;
  const key = _caseKey(loc.step);
  const same = (s) => s && s.state !== "hidden" && (loc.depth || _caseKey(s) === key);
  return { loc, main: !loc.depth, steps: loc.list.filter(same), same };
}

/* Whether a step may go by its time again (deriveOrder's canBeFree): at the
   main level, a timed step whose start lies in its own transaction (C9's
   rule, runForRange); a step without a time, or below the main level, may. */
function _canBeFree(main, runs) {
  return (s) => {
    if (!main || !AC.hasTime(s)) return true;
    const r = RunsModel.runForRange(runs, Date.parse(s.time_range.start));
    return (r ? r.caseId : null) === _caseKey(s);
  };
}

/* The steps that came after `ids` keep their place while those leave it
   (hidden, deleted, merged away): each place they leave is kept. Call it
   before the steps change. Marks the steps whose place changed as the
   analyst's. */
function _handOver(ids) {
  const runs = _model().runs;
  const done = new Set();
  for (const id of ids || []) {
    const p = _placeOf(id);
    if (!p) continue;
    const key = (p.main ? "main:" + _caseKey(p.loc.step) : "sub:") + (p.main ? "" : String(p.loc.parent && p.loc.parent.step_id));
    if (done.has(key)) continue;
    done.add(key);
    const gone = (ids || []).filter((x) => p.steps.some((s) => s.step_id === x));
    for (const s of StepOrder.keepOrder(p.steps, gone, { canBeFree: _canBeFree(p.main, runs) })) AC.markEdited(s);
  }
}

/* The name a step goes by in a sentence. */
function _quoted(step) { return '"' + (String((step && step.name) || "").trim() || "this step") + '"'; }

/* What a placed step's mark says (the Steps row's tag, the Flow line, the
   Timeline band): where it comes in the process and where it stays on the
   timeline. "" for a step its time places, and for a step without a time
   (it has no time to be apart from: + Add step puts it after the selected
   step). */
function placedText(step, list) {
  const a = AC.hasTime(step) ? StepOrder.anchorOf(step, list) : null;
  if (!a) return "";
  const where = a === StepOrder.START ? "first in its transaction" : "after " + _quoted(a);
  const at = AC.hasTime(step) ? sinceStart(step.time_range.start, recordingStartMs(State.getSession())) : "";
  return "You placed this step in the process " + where + "." +
    (at ? " On the timeline it stays at " + at + ", where it was shown." : "");
}

/* ===== The level shown (contract C19) ==================================== */

/* The transactions' main-level steps, in transaction order: what the
   sub-process helpers take. */
function _txs(model) { return model.runs.map((r) => r.members); }

/* The reference transaction's index among them (0 without one). */
function _refIndex(model, pattern) {
  const i = pattern && pattern.run ? model.runs.indexOf(pattern.run) : -1;
  return i >= 0 ? i : 0;
}

/* The level shown: State.mapPath as far as its maps are still there (a
   sub-process dissolved, hidden or renamed since takes the level up). A
   level other than the last one shown starts with its default block open. */
function _levelPath(model) {
  const want = State.getMapPath();
  const path = SPM.validPath(_txs(model), want);
  if (!SPM.samePath(path, want)) State.setMapPath(path);
  const key = JSON.stringify(path);
  if (_ui.levelKey !== key) {
    _ui.levelKey = key;
    _ui.levelOpen = undefined;
    _ui.showHidden = false;
  }
  return path;
}

/* The open block's key at `path` (the main level's is _ui.open). */
function _openKeyAt(path) { return path.length ? _ui.levelOpen : _ui.open; }
function _setOpenKeyAt(path, key) { if (path.length) _ui.levelOpen = key; else _ui.open = key; }

/* The blocks of rows the list shows at level `path`: at the main level each
   transaction (key: its case_id) and the steps outside them (OUTSIDE);
   inside a sub-process one per visit of it (key: the case_id, "#" and the
   visit's number in its transaction, 0 the first). Each { key, run, index,
   members (every step, hidden ones too, in order), visible, parents (the
   steps whose sub_steps they are) }. */
function _containers(model, path) {
  if (!path.length) {
    const out = model.runs.map((r) => ({ key: r.caseId, run: r, index: 0, members: r.members, visible: r.visible, parents: [] }));
    if (model.outside.length) {
      out.push({ key: OUTSIDE, run: null, index: 0, members: model.outside,
        visible: model.outside.filter((s) => s.state !== "hidden"), parents: [] });
    }
    return out;
  }
  return SPM.levelVisits(_txs(model), path).map((v) => ({
    key: model.runs[v.t].caseId + "#" + v.index, run: model.runs[v.t], index: v.index,
    members: v.members, visible: v.visible, parents: v.parents,
  }));
}

function _containerOf(containers, stepId) {
  return containers.find((c) => c.members.some((s) => s.step_id === stepId)) || null;
}

/* The block of the level shown that holds a step, or null. */
function _containerNow(stepId) {
  const model = _model();
  return _containerOf(_containers(model, _levelPath(model)), stepId);
}

/* The name of the process, the first crumb: the document's title (C6, the
   PDD's title), else "Main process" (the Map's picker names it so too). */
function _processName() {
  const s = State.getSession();
  return SPM.mainMapName(s && s.annotations);
}

/* The name a level goes by (its node's first step's name). */
function _levelName(model, pattern, path) {
  return SPM.nodeName(_txs(model), path, _refIndex(model, pattern));
}

/* The rendered list row of a step, or null when it is not on screen (its
   group is closed, or it is hidden and hidden steps do not show). */
function _rowFor(stepId) {
  if (!stepId) return null;
  for (const r of document.querySelectorAll("#step-list .step-row")) {
    if (r.dataset.stepId === stepId) return r;
  }
  return null;
}

/* The group to open by default: the pattern run; without runs, the steps
   outside runs. With neither (a session not analyzed yet), undefined: the
   first render that has runs opens one (a new project opens before its
   analysis gives it its run). */
function _defaultOpen(model, pattern) {
  if (pattern && pattern.run) return pattern.run.caseId;
  if (model.runs.length) return model.runs[0].caseId;
  return model.outside.length ? OUTSIDE : undefined;
}

/* Open a group (a run's case_id, OUTSIDE, or null to close it). The
   multi-selection is cleared and a selected step outside the new group is
   deselected, so no verb or shortcut acts on a step the analyst no longer
   sees (RP-12). */
function _openGroup(key) {
  const model = _model();
  const path = _levelPath(model);
  if (_openKeyAt(path) === key) return;
  _setOpenKeyAt(path, key);
  State.getMultiSelectedStepIds().clear();
  const sel = State.getSelectedStepId();
  if (sel && _findStep(sel)) {
    const c = _containerOf(_containers(model, path), sel);
    if (key == null || !c || c.key !== key) State.setSelectedStepId(null);
  }
  if (!path.length) _markOpened(key);
}

/* AD-28: a run other than the reference run is reviewed once it has been
   opened after the reference run was confirmed (its differences from the
   confirmed steps show when it opens); it is not confirmed itself. The run
   is kept in annotations.opened_runs (its case_id), written directly: opening
   a run is not an edit, so it is not undone (session.js keeps the list across
   an undo) and the analysis keeps the key as it is (C10). Nothing is written
   while an analysis runs (it reloads the file when it ends). */
function _markOpened(caseId) {
  const s = State.getSession();
  const anno = s && s.annotations;
  // Lane HV: a hand-off opened read only records nothing, not even this.
  if (!anno || typeof caseId !== "string" || caseId === OUTSIDE || RO.isReadOnly(s)) return;
  const model = _model();
  const p = RunsModel.patternRun(anno, model.runs);
  if (!p.record || !p.record.confirmed_at) return;
  if (!model.runs.some((r) => r.caseId === caseId) || (p.run && p.run.caseId === caseId)) return;
  const opened = Array.isArray(anno.opened_runs) ? anno.opened_runs : [];
  if (opened.includes(caseId)) return;
  const run = State.getAnalysisRun();
  if (run && run.folder === s.sessionFolder && run.status === "running") return;
  anno.opened_runs = opened.concat([caseId]);
  Session.saveAnnotationsDirect(anno, "open a transaction").catch(() => { /* already shown */ });
}

/* Select a step and make sure it is on screen: its level shows, its group
   opens, and hidden steps show when it is hidden. Used by the step context
   menu. */
function _selectAndReveal(stepId) {
  const loc = _locate(stepId);
  if (!loc) return;
  if (!SPM.samePath(loc.path, State.getMapPath())) State.setMapPath(loc.path);
  const c = _containerNow(stepId);
  if (c) _openGroup(c.key);
  if (loc.step.state === "hidden") _ui.showHidden = true;
  State.setSelectedStepId(stepId);
}

function _nameListEl() {
  let dl = document.getElementById(NAME_LIST_ID);
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = NAME_LIST_ID;
    document.body.appendChild(dl);
  }
  return dl;
}

/* Fill the rename datalist: the names already used in this project. */
function _fillNameList() {
  const s = State.getSession();
  const names = RunsModel.nameSuggestions((s && s.annotations && s.annotations.steps) || []);
  _nameListEl().innerHTML = names.map((n) => '<option value="' + escapeAttr(n) + '"></option>').join("");
}

/* The project's activity library (C21): its library.json, else the app's,
   as the project was loaded (an empty library when there is none). */
function _library() {
  const s = State.getSession();
  return (s && s.library && s.library.library) || Library.emptyLibrary();
}

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* ===== What the runs are compared with ================================= */

/* The reference every other run is compared with: the pattern run, or null
   without one. */
function _reference(pattern) {
  if (!pattern.run) return null;
  return { kind: "pattern", steps: pattern.run.visible, noun: RunDiff.REFERENCE_RUN, caseId: pattern.run.caseId };
}

/* The stretches of `run` left out of the analysis (annotations.excluded_ranges
   cut to the run's span; run-differences.js leftOutStretches). */
function _leftOut(run) {
  // Lane E (E4): in a project without a recording a stretch put aside is not
  // part of the process, and Steps says nothing of it (left-out.js).
  const ranges = LeftOut.analysisRanges(State.getSession());
  return RunDiff.leftOutStretches(ranges, { startMs: run.startMs, endMs: run.endMs });
}

/* A run's differences from the reference (item 3), the one line on its
   stretches left out of the analysis first; null without a reference. The
   pattern run itself lists only that line (null when it has no stretch left
   out): it is compared with nothing. */
function _runDiffs(ref, run) {
  if (!ref) return null;
  const leftOut = _leftOut(run);
  const originMs = recordingStartMs(State.getSession());
  if (ref.kind === "pattern" && run.caseId === ref.caseId) {
    return leftOut.length ? [{ kind: "left_out", text: RunDiff.leftOutText(leftOut, originMs, RunDiff.RUN_UNIT) }] : null;
  }
  return RunDiff.differences(ref.steps, run.visible, { reference: ref.noun, unit: RunDiff.RUN_UNIT, leftOut, originMs,
    at: leftOut.length ? StepOrder.placeMoments(run.visible) : undefined });
}

/* A run's meta, its differences counted (not the left-out line, nor a Not
   done line), for a run compared with the reference. */
function _diffMeta(diffs, compared) {
  if (!diffs || !compared) return "";
  const n = RunDiff.differenceCount(diffs);
  return " · " + (n ? _plural(n, "difference", "differences") : "no differences");
}

/* The tooltip of the line on a stretch left out of the analysis. */
const NOTES_TITLE = "No difference: a part left out of the analysis, hatched on the Timeline";

/* A transaction's one line under its head, after `after` in `body`, when a
   stretch of it was left out of the analysis. 2.0.1 (the owner's review):
   its differences are on its rows (run-differences.js rowMarks, _groupBody),
   where they happen; the count in the head counts them (lane FX1). */
function _appendDiffLists(body, after, diffs) {
  const items = (diffs || []).filter((d) => d.kind === "left_out");
  if (!items.length) return;
  const list = document.createElement("ul");
  list.className = "run-notes";
  list.title = NOTES_TITLE;
  for (const d of items) {
    const li = document.createElement("li");
    li.dataset.kind = d.kind;
    li.textContent = d.text;
    list.appendChild(li);
  }
  body.insertBefore(list, after.nextSibling);
}

/* A run's differences placed on its rows, or null for a run compared with
   nothing (run-differences.js rowMarks). */
function _rowMarks(ref, run) {
  if (!ref || (ref.kind === "pattern" && run.caseId === ref.caseId)) return null;
  const leftOut = _leftOut(run);
  return RunDiff.rowMarks(ref.steps, run.visible, { reference: ref.noun, unit: RunDiff.RUN_UNIT,
    leftOut, originMs: recordingStartMs(State.getSession()), at: leftOut.length ? StepOrder.placeMoments(run.visible) : undefined });
}

/* ===== The Steps level ================================================== */

function renderStepsLevel() {
  const session = State.getSession();
  if (!session || !PdtSteps) return;
  if (_ui.folder !== session.sessionFolder) _ui = _freshUi(session.sessionFolder);
  const anno = session.annotations || {};
  const allSteps = anno.steps || [];
  const interactionsById = _interactionsById();
  const model = RunsModel.buildRuns(session.stats, allSteps);
  const pattern = RunsModel.patternRun(anno, model.runs);
  const ref = _reference(pattern);

  // An ARRIVAL (Open in Steps, a jump, or a return to Steps with a surviving
  // selection) reveals the selected step: its level shows (C19), its group
  // opens and, when it is hidden, the hidden steps show; the row is scrolled
  // into view below. The one-shot flags are consumed here, so a later
  // incidental re-render never scrolls.
  const pendingTs = State.consumePendingStepJump();
  const arriveReveal = State.consumePendingStepReveal();
  if (arriveReveal && !pendingTs) {
    const loc = SPM.findStep(allSteps, State.getSelectedStepId());
    if (loc && !SPM.samePath(loc.path, State.getMapPath())) State.setMapPath(loc.path);
  }
  const path = _levelPath(model);
  const containers = _containers(model, path);

  // A Flow request to show the step at a moment ("Jump to step here"):
  // select the step of the level shown containing it, else the nearest one,
  // so a right-click in a gap between steps still lands on a step.
  if (pendingTs) {
    const levelSteps = path.length ? containers.flatMap((c) => c.members) : allSteps;
    const targetMs = new Date(pendingTs).getTime();
    if (isFinite(targetMs) && levelSteps.length) {
      let best = null, bestDist = Infinity;
      for (const s of levelSteps) {
        const tr = s.time_range; if (!tr) continue;
        const a = new Date(tr.start).getTime();
        const b = new Date(tr.end).getTime();
        if (!isFinite(a) || !isFinite(b)) continue;
        if (a <= targetMs && targetMs <= b) { best = s; break; }
        const dist = Math.min(Math.abs(targetMs - a), Math.abs(targetMs - b));
        if (dist < bestDist) { best = s; bestDist = dist; }
      }
      if (best) State.setSelectedStepId(best.step_id);
    }
  }
  const revealStep = (pendingTs || arriveReveal) ? _findStep(State.getSelectedStepId()) : null;
  if (revealStep) {
    const c = _containerOf(containers, revealStep.step_id);
    const key = c ? c.key : (path.length ? undefined : RunsModel.groupKeyOf(revealStep, model.runs));
    if (key !== undefined && _openKeyAt(path) !== key) {
      _setOpenKeyAt(path, key);
      State.getMultiSelectedStepIds().clear();
      if (!path.length) _markOpened(key);
    }
    if (revealStep.state === "hidden") _ui.showHidden = true;
  }
  let open = _openKeyAt(path);
  if (open === undefined || (open !== null && !containers.some((c) => c.key === open))) {
    open = path.length ? _defaultVisit(containers, pattern) : _defaultOpen(model, pattern);
    _setOpenKeyAt(path, open);
  }
  const openC = containers.find((c) => c.key === open) || null;
  // "Show hidden steps" lasts while the open group has hidden steps; with
  // none left (the last one unhidden, another group opened) it switches off,
  // so a step hidden later leaves the list as expected.
  if (!openC || !openC.members.some((s) => s.state === "hidden")) _ui.showHidden = false;

  const visible = !openC ? [] : _ui.showHidden ? openC.members.slice() : openC.visible.slice();
  const visibleIds = new Set(visible.map((s) => s.step_id));
  // Ticks only ever stand on rows the analyst can see (RP-12).
  const multi = State.getMultiSelectedStepIds();
  for (const id of [...multi]) if (!visibleIds.has(id)) multi.delete(id);
  syncMultiSelectButtons();
  _syncAppsOutside(session);

  const pc = $("#runs-pane-count");
  if (pc) pc.textContent = String(model.runs.length);
  _renderCrumbs(model, pattern, path);

  if (path.length) renderLevelList($("#step-list"), model, pattern, containers, open, visible);
  else renderRunsList($("#step-list"), model, pattern, visible, session.stats, ref);

  const selId = State.getSelectedStepId();
  const selected = selId && visibleIds.has(selId) ? _findStep(selId) : null;
  _syncStepVerbs(selected);
  const title = $("#step-detail-title");
  const detail = $("#step-detail");
  if (State.getLevel() === "flow") {
    // Lane PANE: on the Timeline the step editor is in the pane beside the
    // video (views/timeline-pane.js), and the editor's parts carry ids: one
    // host holds it at a time. Steps draws it again when it shows.
    if (detail) { detail.innerHTML = ""; delete detail.dataset.stepId; }
  } else if (selected) {
    // 2.0.1: the step's name is the editor's title.
    if (title) title.textContent = "";
    renderStepInto(detail, selected, null, interactionsById);
    // V2 item 4: the step panel beside the editor follows the selected row
    // (plan D2: from 1440 px of window width; below, only Play opens it).
    if (State.getLevel() === "steps") StepPanel.followSteps(selected);
  } else {
    if (detail) delete detail.dataset.stepId;
    if (path.length) renderLevelGuide(detail, model, pattern, containers, open, path);
    else renderRunGuide(detail, model, pattern, ref);
  }

  if (revealStep && visibleIds.has(revealStep.step_id)) {
    setTimeout(() => {
      const row = _rowFor(revealStep.step_id);
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
}

/* Inside a sub-process (C19): the block open by default, the reference
   transaction's first visit, else the first block. */
function _defaultVisit(containers, pattern) {
  const ref = _refVisit(containers, pattern);
  return ref ? ref.key : containers.length ? containers[0].key : null;
}

/* The block the others are compared with inside a sub-process: the
   reference transaction's first visit, or null when it has none there. */
function _refVisit(containers, pattern) {
  if (!pattern || !pattern.run) return null;
  return containers.find((c) => c.run === pattern.run && c.index === 0) || null;
}

/* The breadcrumb over the list inside a sub-process (C19): the way down from
   the main process, each crumb but the last going up to its level, and
   Dissolve sub-process beside it. Hidden at the main level. */
function _renderCrumbs(model, pattern, path) {
  const nav = $("#steps-crumbs");
  if (!nav) return;
  nav.hidden = !path.length;
  nav.innerHTML = "";
  if (!path.length) return;
  const names = [_processName()].concat(path.map((_, d) => _levelName(model, pattern, path.slice(0, d + 1))));
  const trail = document.createElement("span");
  trail.className = "crumb-trail";
  names.forEach((n, d) => {
    if (d < path.length) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "crumb";
      b.dataset.depth = String(d);
      b.title = "Go up to " + n;
      b.textContent = n;
      b.addEventListener("click", () => goToLevel(path.slice(0, d)));
      trail.appendChild(b);
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      trail.appendChild(sep);
    } else {
      const here = document.createElement("span");
      here.className = "crumb crumb-here";
      here.setAttribute("aria-current", "location");
      here.title = n;
      here.textContent = n;
      trail.appendChild(here);
    }
  });
  nav.appendChild(trail);
  const dissolve = document.createElement("button");
  dissolve.type = "button";
  dissolve.className = "crumb-dissolve";
  dissolve.id = "btn-dissolve-level";
  dissolve.title = "Put the steps of this sub-process back in the steps above it, in every transaction";
  dissolve.textContent = "Dissolve sub-process";
  dissolve.addEventListener("click", () => dissolveAction(path.slice(0, -1), path[path.length - 1]));
  nav.appendChild(dissolve);
}

/* The list inside a sub-process (C19): one block per visit, in transaction
   order, the reference transaction's first visit marked and compared with
   the others. */
function renderLevelList(host, model, pattern, containers, open, visible) {
  if (!host) return;
  host.innerHTML = "";
  const refVisit = _refVisit(containers, pattern);
  for (const c of containers) host.appendChild(_visitGroupEl(c, pattern, refVisit, open, visible));
}

/* A visit's time: from its first step's start to its last step's end (the
   steps whose sub-steps it lists), or null. */
function _visitDuration(c) {
  const a = c.parents.map((p) => Date.parse(p.time_range && p.time_range.start)).filter(Number.isFinite);
  const b = c.parents.map((p) => Date.parse(p.time_range && (p.time_range.end || p.time_range.start))).filter(Number.isFinite);
  return a.length && b.length ? Math.max(0, Math.max(...b) - Math.min(...a)) : null;
}

/* One visit of the sub-process: a transaction's block, with the same facts
   as at the main level (its steps, its time, its differences from the
   reference visit) and, on the reference transaction's first visit, its
   status and Confirm transaction (C19: it confirms every level). */
function _visitGroupEl(c, pattern, refVisit, open, visible) {
  const run = c.run;
  const isOpen = open === c.key;
  const isRef = c === refVisit;
  const rec = isRef ? pattern.record : null;
  const confirmed = isRef && RunsModel.patternConfirmed(rec, run);
  const g = document.createElement("div");
  g.className = "run-group run-visit" + (isOpen ? " open" : "") + (isRef ? " pattern" : "");
  g.dataset.caseId = run.caseId;
  g.dataset.visit = c.key;
  const n = c.visible.length;
  const diffs = refVisit && !isRef
    ? RunDiff.differences(refVisit.visible, c.visible, { reference: RunDiff.REFERENCE_RUN, unit: RunDiff.RUN_UNIT }) : null;
  const dur = _visitDuration(c);
  const meta = _plural(n, "step", "steps") + (dur != null ? " · " + StepFacts.formatMs(dur) : "") +
    _diffMeta(diffs, !!diffs);
  // As at the main level: Confirm only while the transaction holds a draft.
  const owed = isRef && RunsModel.holdsDraft(run.members);
  const status = !isRef ? null : !n ? "empty" : confirmed ? "confirmed" : owed ? "draft" : null;
  const rm = refVisit && !isRef
    ? RunDiff.rowMarks(refVisit.visible, c.visible, { reference: RunDiff.REFERENCE_RUN, unit: RunDiff.RUN_UNIT }) : null;
  g.innerHTML = _groupHead(isOpen,
    '<span class="run-title">' + escapeHtml(run.title + (c.index ? ", again" : "")) + "</span>" +
    '<span class="run-label"' + (run.label ? ' title="' + escapeAttr(run.label) + '"' : "") + ">" + escapeHtml(run.label) + "</span>" +
    _badges(isRef, status) +
    '<span class="run-meta">' + escapeHtml(meta) + "</span>", "");
  _wireHead(g, c.key);
  if (!isOpen) return g;
  if (isRef && RunsModel.canReopen(run, rec, true)) {
    _addUndoConfirm(g, UNDO_CONFIRM_LEVEL_TITLE, () => reopenRunAction(run.caseId));
  }
  const hidden = c.members.length - n;
  const body = _groupBody(visible, hidden,
    hidden ? "Every step here is hidden." : "No steps yet: + Add step adds one here.",
    status || RunsModel.runStatus(c.members), rm);
  const acts = body.querySelector(".run-actions");
  const buttons = [];
  if (isRef && !confirmed && owed && run.visible.length > 0) {
    buttons.push(_actionBtn("confirm-run", "Confirm transaction", "primary",
      "Accept the remaining drafted steps of this transaction, at every level (Ctrl+Enter).",
      () => confirmRunAction(run.caseId)));
  }
  for (const b of buttons.reverse()) acts.insertBefore(b, acts.firstChild);
  _appendDiffLists(body, acts, diffs);
  g.appendChild(body);
  return g;
}

/* The detail pane inside a sub-process when no step is selected. */
const GUIDE_LEVEL = "The steps of this sub-process in this transaction. + Add step adds one here.";
function renderLevelGuide(host, model, pattern, containers, open, path) {
  if (!host) return;
  const title = $("#step-detail-title");
  const c = containers.find((x) => x.key === open) || null;
  const head = c ? c.run.title + (c.index ? ", again" : "") : _levelName(model, pattern, path);
  const ro = RO.isReadOnly(State.getSession());
  const paras = c ? [ro ? GUIDE_READ_ONLY[GUIDE_LEVEL] : GUIDE_LEVEL]
    : ["Pick a transaction on the left to see its steps in this sub-process."];
  if (title) title.textContent = head;
  host.innerHTML = '<div class="empty-pane run-guide">' + paras.map((p, i) =>
    "<p" + (i ? ' class="meta"' : "") + ">" + escapeHtml(p) + "</p>").join("") + "</div>";
}

/* Show another level of the Steps list (C19): `path` from the main map
   down. Going up selects the step the level left was inside, so the list
   shows where the analyst came from; `opts.openAt` (a step id) opens the
   block of the new level whose steps are that step's sub-steps. The step
   panel and the Timeline's steps lane follow the level. */
function goToLevel(path, opts) {
  const o = opts || {};
  const session = State.getSession();
  if (!session) return;
  const root = (session.annotations && session.annotations.steps) || [];
  const model = _model();
  const from = _levelPath(model);
  const leaving = from.length ? (_containers(model, from).find((c) => c.key === _ui.levelOpen) || null) : null;
  State.setMapPath(path);
  const to = _levelPath(model);
  State.getMultiSelectedStepIds().clear();
  const containers = _containers(model, to);
  let open;
  let select = null;
  if (o.openAt) {
    const c = containers.find((x) => x.parents.some((p) => p.step_id === o.openAt));
    if (c) open = c.key;
  } else if (leaving && leaving.parents.length && to.length < from.length) {
    // Going up: the step this level was inside, at the level shown now.
    const loc = SPM.findStep(root, leaving.parents[0].step_id);
    const chain = loc ? loc.ancestors.concat([loc.step]) : [];
    select = chain[to.length] || null;
    const c = select ? _containerOf(containers, select.step_id) : null;
    if (c) open = c.key;
  }
  if (open !== undefined) _setOpenKeyAt(to, open);
  if (!to.length && open !== undefined) _markOpened(open);
  const sel = State.getSelectedStepId();
  if (select) {
    State.setSelectedStepId(select.step_id);
    State.setPendingStepReveal();
  } else if (sel && !_containerOf(containers, sel)) {
    State.setSelectedStepId(null);
  }
  renderStepsLevel();
  StepPanel.refresh();
  State.emit("timeline");
}

/* The list pane: the runs (the open one with its steps), then the steps
   outside runs. */
function renderRunsList(host, model, pattern, visible, stats, ref) {
  if (!host) return;
  host.innerHTML = "";
  if (!model.runs.length && !model.outside.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
        "<p><strong>No steps yet.</strong></p>" +
      "</div>";
    return;
  }
  if (!model.runs.length) {
    const ov = require("./overview-view.js");
    const note = document.createElement("div");
    note.className = "runs-none";
    note.innerHTML = "<p>" + escapeHtml(ov.NO_RUNS_MARKED + " " + ov.MARK_RUNS_INSTRUCTION) + "</p>" +
      '<button type="button" class="primary" id="btn-steps-mark-runs">' + escapeHtml(ov.MARK_RUNS_BUTTON) + "</button>";
    note.querySelector("button").addEventListener("click", () => ov.openMarkersInFlow());
    host.appendChild(note);
  }
  for (const run of model.runs) host.appendChild(_runGroupEl(run, model, pattern, visible, stats, ref));
  if (model.outside.length) host.appendChild(_outsideGroupEl(model, visible));
}

const OTHER_RUN_TITLE = "Right-click to use this transaction as the reference transaction";
// Undo confirm, the inverse of Confirm transaction (it read Reopen
// transaction until the owner's review).
const UNDO_CONFIRM_TITLE = "Turn the confirmed steps back into drafts; your edited and added steps stay.";
const UNDO_CONFIRM_LEVEL_TITLE = "Turn the confirmed steps back into drafts at every level; your own steps stay.";

/* The reference transaction's badges in its head, Reference and its status,
   as one unit (`.run-badges`) that Undo confirm joins: where the head is too
   narrow for one line, they go under the name together. "" when there is
   neither. */
function _badges(isRef, status) {
  if (!isRef && !status) return "";
  return '<span class="run-badges">' +
    (isRef ? '<span class="run-pattern-badge">Reference</span>' : "") +
    (status ? '<span class="run-status run-status-' + status + '">' + escapeHtml(RunsModel.STATUS_LABELS[status]) + "</span>" : "") +
    "</span>";
}

/* Undo confirm on the open reference transaction: a quiet link beside its
   Confirmed badge in the head (right after the status, in the badges' unit).
   The head opens and closes the transaction, so the link keeps its click and
   its keys to itself. */
function _addUndoConfirm(group, title, onClick) {
  const head = group.querySelector(".run-row .run-badges");
  if (!head) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link-btn run-undo-confirm";
  b.dataset.act = "reopen-run";
  b.title = title;
  b.textContent = "Undo confirm";
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
  head.appendChild(b);
}

function _groupHead(isOpen, innerHtml, titleAttr) {
  return '<div class="run-row" role="button" tabindex="0" aria-expanded="' + (isOpen ? "true" : "false") + '"' +
    (titleAttr ? ' title="' + escapeAttr(titleAttr) + '"' : "") + ">" +
    '<span class="run-caret" aria-hidden="true">' + (isOpen ? "▾" : "▸") + "</span>" + innerHtml + "</div>";
}

function _wireHead(group, key) {
  const head = group.querySelector(".run-row");
  const toggle = () => {
    _openGroup(_openKeyAt(State.getMapPath()) === key ? null : key);
    renderStepsLevel();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); }
  });
}

/* The open group's steps and its "Show hidden steps (N)" switch. `baseline`
   is the chip class the run's status stands for (a row with that chip shows
   none, P1.9), null for the steps outside runs. `rm`: its differences from
   the reference on its rows (2.0.1, run-differences.js rowMarks), or null. */
function _groupBody(visible, hiddenCount, emptyText, baseline, rm) {
  const body = document.createElement("div");
  body.className = "run-body";
  const acts = document.createElement("div");
  acts.className = "run-actions";
  if (hiddenCount) {
    const lbl = document.createElement("label");
    lbl.className = "run-show-hidden";
    lbl.title = "List the steps you hid, so you can check or unhide them";
    lbl.innerHTML = '<input type="checkbox" data-act="show-hidden"' + (_ui.showHidden ? " checked" : "") + "> " +
      escapeHtml("Show hidden steps (" + hiddenCount + ")");
    lbl.querySelector("input").addEventListener("change", (e) => {
      _ui.showHidden = !!e.target.checked;
      renderStepsLevel();
    });
    acts.appendChild(lbl);
  }
  body.appendChild(acts);
  const list = document.createElement("div");
  list.className = "run-steps";
  body.appendChild(list);
  if (!visible.length) {
    list.innerHTML = '<p class="run-steps-empty">' + escapeHtml(emptyText) + "</p>";
    return body;
  }
  PdtSteps.renderStepList(list, visible, State.getSelectedStepId(),
    // A click on the row that is already selected changes nothing, so it
    // does not re-render (a double-click keeps its row).
    (sid) => { if (State.getSelectedStepId() === sid) return; State.setSelectedStepId(sid); renderStepsLevel(); },
    (sid) => {
      const m = State.getMultiSelectedStepIds();
      if (m.has(sid)) m.delete(sid); else m.add(sid);
      syncMultiSelectButtons();
      // Re-render so the tick shows; Ctrl+click would feel broken otherwise.
      renderStepsLevel();
    },
    inlineRenameStep,
    State.getMultiSelectedStepIds(),
    showStepContextMenu,
    {
      nameListId: NAME_LIST_ID,
      onBeginRename: () => _fillNameList(),
      baseline: baseline || null,
      // Lane HV: a hand-off opened read only renames nothing.
      readOnly: RO.isReadOnly(State.getSession()),
      // C19: a sub-process row opens its level ("▸ N sub-steps").
      subSteps: (step) => (SPM.isSubProcess(step) ? step.sub_steps.filter((x) => x && x.state !== "hidden").length : null),
      onOpenSub: (step) => openSubProcessAction(step.step_id),
      // 2.0.1: each row shows when its step starts, on the one clock.
      originMs: recordingStartMs(State.getSession()),
      // 2.0.1: the differences from the reference, where they happen.
      marks: rm ? rm.marks : null,
      ghosts: rm ? rm.ghosts : null,
      // C22: the steps placed elsewhere in the process than their time.
      placed: _placedMap(visible),
    });
  return body;
}

/* C22: { step id => what its mark says } for the rows of steps placed
   elsewhere in the process than their time puts them. */
function _placedMap(rows) {
  const out = new Map();
  for (const s of rows || []) {
    if (!s || s.state === "hidden" || s.placed_after == null) continue;
    const p = _placeOf(s.step_id);
    const text = p ? placedText(s, p.steps) : "";
    if (text) out.set(s.step_id, text + " Back to its time, in its menu, puts it there again.");
  }
  return out;
}

function _runGroupEl(run, model, pattern, visible, stats, ref) {
  const isOpen = _ui.open === run.caseId;
  const isPattern = !!(pattern.run && pattern.run.caseId === run.caseId);
  const rec = isPattern ? pattern.record : null;
  const patternConfirmed = !!(rec && rec.confirmed_at);
  // C19: it reads confirmed only while no level below holds a draft.
  const reads = isPattern && RunsModel.patternConfirmed(rec, run);
  const g = document.createElement("div");
  g.className = "run-group" + (isOpen ? " open" : "") + (isPattern ? " pattern" : "");
  g.dataset.caseId = run.caseId;
  const n = run.visible.length;
  // Item 3: the run's differences from its reference, counted in its meta
  // (no count on the reference run the others are compared with), and on
  // its rows (2.0.1).
  const diffs = _runDiffs(ref, run);
  const rm = _rowMarks(ref, run);
  const meta = _plural(n, "step", "steps") + (run.durationMs != null ? " · " + StepFacts.formatMs(run.durationMs) : "") +
    _diffMeta(diffs, !isPattern);
  // AD-28: only the reference run is confirmed, so only it carries a status,
  // read from its confirmation (C3); the other runs are reviewed by opening
  // them. P3.8: "Use as reference run" is a once-a-session choice, so it
  // lives in the run's right-click menu, as the probe line of the confirmed
  // reference run does.
  // Only a reference run that holds a draft has something to confirm: one
  // whose steps were all added or edited by the analyst reads neither
  // confirmed nor a draft, and offers no Confirm transaction.
  const owed = isPattern && RunsModel.holdsDraft(run.members);
  const status = !isPattern ? null : !run.visible.length ? "empty" : reads ? "confirmed" : owed ? "draft" : null;
  // Lane HV: a hand-off opened read only offers none of the run's acts.
  const ro = RO.isReadOnly(State.getSession());
  const canUsePattern = !ro && !isPattern && run.members.length > 0;
  g.innerHTML = _groupHead(isOpen,
    '<span class="run-title">' + escapeHtml(run.title) + "</span>" +
    '<span class="run-label"' + (run.label ? ' title="' + escapeAttr(run.label) + '"' : "") + ">" + escapeHtml(run.label) + "</span>" +
    // Lane E-1: a project of one transaction has nothing it is the reference
    // among, so its one transaction carries no Reference badge.
    _badges(isPattern && model.runs.length >= 2, status) +
    '<span class="run-meta">' + escapeHtml(meta) + "</span>", canUsePattern ? OTHER_RUN_TITLE : "");
  _wireHead(g, run.caseId);
  if (!ro && isOpen && isPattern && RunsModel.canReopen(run, rec, isPattern)) {
    _addUndoConfirm(g, UNDO_CONFIRM_TITLE, () => reopenRunAction(run.caseId));
  }
  if (canUsePattern || (!ro && isPattern && patternConfirmed)) {
    g.querySelector(".run-row").addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (canUsePattern) showRunContextMenu(run.caseId, e.clientX, e.clientY);
      else _showProbeMenu(RunsModel.probeLine(stats, model.runs, run, rec), e.clientX, e.clientY);
    });
  }
  if (!isOpen) return g;

  const recorded = ((State.getSession() || {}).events || []).length > 0;
  const body = _groupBody(visible, run.hiddenCount,
    run.hiddenCount ? "Every step of this transaction is hidden." : recorded ? "No steps in this transaction."
      : "No steps yet: + Add step adds one, and Paste notes... adds one for each line of your notes.", status || run.status, rm);
  const acts = body.querySelector(".run-actions");
  const canConfirm = !ro && isPattern && !reads && owed && run.visible.length > 0;
  const buttons = [];
  if (canConfirm) {
    buttons.push(_actionBtn("confirm-run", "Confirm transaction", "primary", ACT_TITLES.confirm,
      () => confirmRunAction(run.caseId)));
  }
  // Its inverse, Undo confirm, is beside the Confirmed badge (_addUndoConfirm).
  for (const b of buttons.reverse()) acts.insertBefore(b, acts.firstChild);
  // 2.0.3: when it starts and ends, typed.
  const times = _runTimesEl(run);
  if (times) acts.insertBefore(times, acts.firstChild);
  _appendDiffLists(body, acts, diffs);
  g.appendChild(body);
  return g;
}

function _outsideGroupEl(model, visible) {
  const isOpen = _ui.open === OUTSIDE;
  const vis = model.outside.filter((s) => s.state !== "hidden");
  const hidden = model.outside.length - vis.length;
  const g = document.createElement("div");
  g.className = "run-group run-group-outside" + (isOpen ? " open" : "");
  g.dataset.group = "outside";
  g.innerHTML = _groupHead(isOpen,
    '<span class="run-title">Outside the transactions</span><span class="run-label"></span>' +
    '<span class="run-meta">' + escapeHtml(_plural(vis.length, "step", "steps")) + "</span>",
    "Steps that start outside every marked transaction");
  _wireHead(g, OUTSIDE);
  if (isOpen) g.appendChild(_groupBody(visible, hidden, "Every step outside the transactions is hidden.", null));
  return g;
}

function _actionBtn(act, label, cls, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.act = act;
  if (cls) b.className = cls;
  b.title = title;
  b.textContent = label;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/* The probe line (the owner's P1 instrument), in the confirmed reference
   run's right-click menu: the line itself, which a click copies. */
function _showProbeMenu(p, x, y) {
  const why = p.source === "analysis"
    ? "Drafted steps: how many steps the analysis drafted for this transaction."
    : p.source === "designation"
      ? "Drafted steps: the steps it had when it became the reference transaction."
      : "The drafted step count is not recorded.";
  // Lane A-2: what a boundary fix is, the P1 runbook says
  // (docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md); the tooltip says what the count is.
  _runMenu([{ act: "copy-probe", label: "Copy: " + p.text, title: why,
  run: () => { if (_copyText(p.text)) toast("Copied: " + p.text, "success"); else toast("Could not copy the line.", "error"); } }], x, y);
}

function _copyText(text) {
  try {
    const { clipboard } = require("electron");
    if (clipboard && typeof clipboard.writeText === "function") { clipboard.writeText(text); return true; }
  } catch (_) { /* not in Electron: try the web clipboard */ }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return true; }
  } catch (_) { /* no clipboard at all */ }
  return false;
}

/* The detail pane when no step is selected: what to do with the open group. */
const GUIDE_PATTERN =
  "This is the reference transaction. Check its steps against the video or the screenshots, fix the boundaries " +
  "(merge, split, add, hide) and name the steps, then click Confirm transaction.";
const GUIDE_PATTERN_DONE = "This transaction is confirmed.";
// A reference transaction with no drafted step: nothing to confirm.
const GUIDE_PATTERN_OWN = "This is the reference transaction.";
const GUIDE_OTHER = "Check how this transaction differs from the reference transaction, and fix a step where needed.";
// A transaction with no step that nothing compares it with: an empty
// project's one transaction before its first step (C16), or an empty
// reference transaction.
const GUIDE_FIRST_STEP = "Add the first step with + Add step.";
// 2.0.3: how a step comes in, when its transaction starts just after it.
const GUIDE_OUTSIDE =
  "These steps start outside every marked transaction. To bring one in, open its transaction and type an " +
  "earlier start at Starts at, or select a step you added " +
  "and type a start inside the transaction. On the Timeline you can drag either instead. Where no transaction " +
  "is marked yet, right-click the Timeline where it starts and choose Start a transaction here.";
/* Lane HV: the guides of a hand-off opened read only, which say what shows
   and never what to change. */
const GUIDE_READ_ONLY = {
  [GUIDE_PATTERN]: "This is the reference transaction. It was not confirmed when this version was handed off.",
  [GUIDE_OTHER]: "",
  [GUIDE_FIRST_STEP]: "This transaction has no steps.",
  [GUIDE_OUTSIDE]: "These steps start outside every marked transaction.",
  [GUIDE_LEVEL]: "The steps of this sub-process in this transaction.",
};
/* Lane MW: the same, for a project open for editing in another window,
   which is no handed off version. */
const GUIDE_ELSEWHERE = Object.assign({}, GUIDE_READ_ONLY, {
  [GUIDE_PATTERN]: "This is the reference transaction. It is not confirmed yet.",
});

function renderRunGuide(host, model, pattern, ref) {
  if (!host) return;
  const key = _ui.open;
  const title = $("#step-detail-title");
  let head = "", paras = [];
  if (key === OUTSIDE) {
    head = "Outside the transactions";
    paras = [GUIDE_OUTSIDE];
  } else if (key) {
    const run = model.runs.find((r) => r.caseId === key);
    const isPattern = !!(run && pattern.run && pattern.run.caseId === key);
    const done = isPattern && RunsModel.patternConfirmed(pattern.record, run);
    head = run ? run.title + (run.label ? " (" + run.label + ")" : "") : "Transaction";
    // No step yet and no reference transaction to compare it with (or it is
    // the reference): the one act is adding the first step.
    const firstStep = !!(run && !run.members.length && (!pattern.run || isPattern));
    paras = firstStep ? [GUIDE_FIRST_STEP]
      : isPattern ? (done ? [GUIDE_PATTERN_DONE] : !RunsModel.holdsDraft(run.members) ? [GUIDE_PATTERN_OWN]
        : [GUIDE_PATTERN]) : [GUIDE_OTHER];
    const diffs = run && !firstStep && !isPattern ? _runDiffs(ref, run) : null;
    if (diffs && !RunDiff.differenceCount(diffs)) {
      paras.unshift("It has no differences from " + RunDiff.REFERENCE_RUN + ".");
    }
  } else {
    paras = [model.runs.length ? "Pick a transaction on the left to see its steps." : "Pick a step on the left."];
  }
  if (title) title.textContent = head || "Steps";
  // Lane HV: a hand-off opened read only is looked at, not worked on (lane
  // MW: and so is a project open for editing in another window).
  if (RO.isReadOnly(State.getSession())) {
    const guides = RO.isOpenElsewhere(State.getSession()) ? GUIDE_ELSEWHERE : GUIDE_READ_ONLY;
    paras = paras.map((p) => (p in guides ? guides[p] : p)).filter(Boolean);
  }
  host.innerHTML = '<div class="empty-pane run-guide">' + paras.map((p, i) =>
    "<p" + (i ? ' class="meta"' : "") + ">" + escapeHtml(p) + "</p>").join("") + "</div>";
}

/* The readable name of an application token: RunsModel.readableApp. */
const readableApp = RunsModel.readableApp;

function _appNames() {
  const s = State.getSession();
  return (s && s.stats && s.stats.meta && s.stats.meta.app_names) || {};
}

/* The steps of a step's own level, in order: at the main level its
   transaction's, inside a sub-process its visit's (C19). */
function _levelSteps(step) {
  const loc = _locate(step.step_id);
  const places = _containers(_model(), loc ? loc.path : []).filter((c) => c.run);
  const place = _containerOf(places, step.step_id);
  return place ? place.visible : [];
}

/* C8: what the step editor's "Said during this step" shows: null without a
   transcript, else whether it is synced and the sentences said during the
   step (transcript-model.js: 2.0.1, the step before it bounds its window),
   timed from the recording's start. */
function _transcriptSaid(step) {
  const s = State.getSession();
  const placed = TM.forSession(s);
  if (!placed) return null;
  // Lane E: what was said in a stretch put aside is not listed.
  return { synced: placed.synced, sentences: placed.synced
    ? LeftOut.saidOutside(TM.sentencesForStep(placed.sentences, step, _levelSteps(step)), s.annotations) : [],
    originMs: recordingStartMs(s) };
}

/* What the step editor says about the step (2.0.1, the owner's review: each
   fact once, in words), from its own fields and interactions: the library
   code beside the name; the head's line of facts after the system (the
   screen, where the step is, how long it took, in how many transactions it
   happens: its map box's occurrences, step-panel.js); the Recorded line (how
   many actions, where a draft ends: its end_reason and commit) and the
   description. */
function stepFacts(step, interactionsById) {
  const s = State.getSession();
  const origin = recordingStartMs(s);
  const datas = StepFacts.stepDatas(step, interactionsById);
  const where = SystemNames.whereOfStep(step, interactionsById, _appNames());
  // The system the recording gives, the System field's placeholder (C16).
  const derived = SystemNames.whereOfStep(Object.assign({}, step, { system: "" }), interactionsById, _appNames()).system;
  const drafted = StepFacts.isDraftedDescription(step.description, datas);
  const runs = _model().runs;
  const loc = _locate(step.step_id);
  const occ = StepPanel.occurrences(mapNodeLabel(step), runs, step, loc ? loc.path : []);
  const inRuns = new Set(occ.filter((o) => o.run).map((o) => o.run.caseId)).size;
  // The step being marked (nothing after it yet) is open, not as long as the
  // rest of the video (the owner: "you always add steps sequentially").
  const open = _stepOpen(step);
  const took = open ? "" : StepFacts.duration(step.time_range);
  const inAll = runs.length > 1 && inRuns ? "in " + inRuns + " of " + runs.length + " transactions" : "";
  // Item 2 (lane D6): in two transactions or more the words are a link to
  // the step panel's rows (step-editor.js occurrencesHtml), not a fact.
  const occurrences = inRuns >= 2 && inAll ? { text: inAll, n: inRuns } : null;
  const inN = occurrences ? "" : inAll;
  // 2.0.3: a step whose time is the analyst's shows it as two fields.
  const timeHtml = _stepTimeHtml(step, runs, origin, took);
  return {
    // C21: a step named from the library shows its code beside its name.
    code: Library.codeOf(_library(), step),
    facts: [where.screen, StepFacts.pointer(step, runs, origin), took ? "took " + took : open ? "open" : "", inN],
    factsHtml: timeHtml ? [escapeHtml(where.screen || ""), timeHtml, escapeHtml(inN)].filter(Boolean).join(" · ") : "",
    occurrences,
    // C26: the recorded fields of the step, from its recorded actions.
    recordedInfo: StepInfo.recordedRows(datas || [], (d) => {
      const w = SystemNames.whereData(d.process_name, d.window_title, _appNames());
      return [String(step.system || "").trim() || w.system, w.screen].filter(Boolean).join(", ");
    }),
    recorded: StepFacts.recordedLine({ actions: ((step.evidence && step.evidence.interaction_event_ids) || []).length,
      ends: StepFacts.endsAt(step, datas || []) }),
    // A draft's narration is never the description: the PDD leaves it out,
    // so the pane does not pretend it is written (its actions are Recorded).
    description: drafted ? "" : (step.description || ""),
    system: where.system, derived, originMs: origin,
    // What the step's own description is: nothing the analyst wrote (C21: a
    // pick from the library fills it then).
    descriptionEmpty: drafted || !String(step.description || "").trim(),
  };
}

/* The callbacks the per-step detail editor needs. The verbs that change the
   step's shape are the toolbar's (_syncStepVerbs), the scissors excepted. */
function stepDetailCallbacks(selected, interactionsById) {
  const facts = stepFacts(selected, interactionsById);
  return {
    onRename: (stepId, name) => inlineRenameStep(stepId, name, false),
    onDescription: describeStepAction,
    // C25: whether the step is no longer needed, and who does it.
    onToggleWaste: (stepId, on) => setNotNeededAction(stepId, on),
    onDoneBy: (stepId, text) => setDoneByAction(stepId, text),
    doneBy: { placeholder: StepScope.doneByPlaceholder(_manifest()), role: StepScope.recordingRole(_manifest()) },
    onSplitAt: (after) => { if (selected) splitStep(selected.step_id, after); },
    onJumpToFlow: (step) => jumpToStepInFlow(step),
    // Play: the step in the step panel's video (it opens the panel again
    // when it was closed).
    onWatchStep: (step) => watchStep(step),
    // Item 2 (lane D6): "in N of M transactions" opens the step panel at the
    // step, its rows one per transaction (a project without a video has no
    // Play).
    occurrences: facts.occurrences,
    onShowOccurrences: (step) => StepPanel.showOccurrences(step),
    recordingAvailable: !!(State.getSession() && State.getSession().recordingAvailable),
    interactionsById,
    mergedAfterIndex: (selected && _mergedLine.stepId === selected.step_id) ? _mergedLine.after : null,
    code: facts.code, recorded: facts.recorded, description: facts.description, facts: facts.facts,
    factsHtml: facts.factsHtml, originMs: facts.originMs,
    // C26: the information the step uses or enters, each change one
    // undoable edit.
    information: { recorded: facts.recordedInfo },
    onInfoAdd: (id, entry) => _infoEdit(id, "add information", (s) => StepInfo.addEntry(s, entry)),
    onInfoField: (id, i, key, value) => _infoField(id, i, key, value),
    onInfoRemove: (id, i) => _infoEdit(id, "remove information", (s) => StepInfo.removeEntry(s, i)),
    // C27: the exceptions of the step, each change one undoable edit.
    onExcAdd: (id, entry) => _infoEdit(id, "add an exception", (s) => StepExc.addEntry(s, entry)),
    onExcField: (id, i, key, value) => _excField(id, i, key, value),
    onExcRemove: (id, i) => _infoEdit(id, "remove an exception", (s) => StepExc.removeEntry(s, i)),
    // Lane HV: a hand-off opened read only shows its recorded actions open.
    readOnly: RO.isReadOnly(State.getSession()),
    // C16: the System field (first on the line of facts), the step's
    // screenshots (recorded and added) and what is attached to it: its
    // attachments, notes and the adds (views/analyst-ui.js).
    systemHtml: AnalystUI.systemFieldHtml(selected, facts.derived),
    shotsHtml: AnalystUI.stepShotsHtml(selected),
    attachedHtml: AnalystUI.stepAttachedHtml(selected),
    wireExtras: (host, isRendering) => {
      AnalystUI.wireStepPane(host, selected, isRendering);
      _wireStepTimes(host, selected, isRendering);   // 2.0.3
    },
    // C21: the name field offers the activities of the step's system from
    // the project's library; a pick names the step from it.
    picker: Library.pickerFor(_library(), facts.system, selected),
    onPickActivity: pickActivityAction,
    transcriptSaid: _transcriptSaid(selected),
    // C17: the Flow line (its condition and its links) and its edits.
    flow: _flowFor(selected),
    onFlowCondition: (id, text) => _flowEdit(id, text ? "set the step's condition" : "remove the step's condition",
      (s) => StepFlow.setOnlyWhen(s, text)),
    onFlowAddLink: (id, to) => _flowEdit(id, "add a link", (s) => StepFlow.addLink(s, to, "")),
    onFlowLinkTarget: (id, i, to) => _flowEdit(id, "change a link", (s) => StepFlow.setLinkTarget(s, i, to)),
    onFlowLinkWhen: (id, i, when) => _flowEdit(id, "change a link", (s) => StepFlow.setLinkWhen(s, i, when)),
    onFlowRemoveLink: (id, i) => _flowEdit(id, "remove a link", (s) => StepFlow.removeLink(s, i)),
    // C22: its place in the process.
    onPlaceAfter: (id) => placeStepAfterAction(id),
    onBackToTime: (id) => backToTimeAction(id),
    // C19: a sub-process has no scissors (its steps are split, inside it).
    subProcess: SPM.isSubProcess(selected)
      ? { count: selected.sub_steps.filter((x) => x && x.state !== "hidden").length, group: selected.group === true } : null,
  };
}

/* Lane E-1: what the step panel needs to edit a step's name, system and
   description where the video is, on the Timeline and the Map: the editor's
   own handlers and rules (stepDetailCallbacks), so there is one save path
   (a rename names the same drafted step in the other transactions, a pick
   from the library, one undoable edit, a draft becoming edited). */
function panelFieldCallbacks(step) {
  const facts = stepFacts(step, _interactionsById());
  return {
    onRename: (stepId, name) => inlineRenameStep(stepId, name, false),
    onDescription: describeStepAction,
    picker: Library.pickerFor(_library(), facts.system, step),
    onPickActivity: pickActivityAction,
    derived: facts.derived,
    description: facts.description,
  };
}

/* The ids of the editor's fields whose typing survives a redraw. */
function _keepsTyping(id) {
  return id === "step-name" || id === "step-desc" || id === "step-system" || id === "step-done-by" ||
    id === "step-start" || id === "step-end" ||
    id === "step-only-when" || /^flow-link-when-\d+$/.test(id) ||
    /^info-(name|example|where)-(\d+|new)$/.test(id) ||   // C26
    /^exc-(when|then)-(\d+|new)$/.test(id);   // C27
}

/* Draw the step editor for `step` into `host`: the Steps level's pane
   (#step-detail), or (lane PANE) the step opened in the Timeline's pane
   (views/timeline-pane.js), with the same callbacks, so every field saves
   through the same handlers. One host holds the editor at a time (its parts
   carry ids): drawn into another host, the Steps pane is emptied (Steps
   draws it again when it shows). `extra` is laid over the callbacks (the
   Timeline's pane: onTimeline, afterFactsHtml). The name or the description
   being typed in keeps what was typed and the cursor across a redraw (an
   autosave redraws the pane); leaving the field then saves it, as always. */
function renderStepInto(host, step, extra, interactionsById) {
  if (!host || !step) return;
  const steps = document.getElementById("step-detail");
  if (steps && steps !== host) { steps.innerHTML = ""; delete steps.dataset.stepId; }
  const active = document.activeElement;
  const typing = active && host.contains(active) && host.dataset.stepId === step.step_id && _keepsTyping(active.id)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  const inter = interactionsById || _interactionsById();
  PdtSteps.renderStepDetail(host, step, Object.assign(stepDetailCallbacks(step, inter), extra || {}));
  host.dataset.stepId = step.step_id;
  // Lane HV: in a hand-off opened read only the pane's fields are read, not
  // typed in (its acts are hidden, styles.css .read-only).
  if (RO.isReadOnly(State.getSession())) RO.lockInputs(host);
  const el = typing && host.querySelector("#" + typing.id);
  if (el) {
    if (el.value !== typing.value) el.value = typing.value;
    el.focus();
    try { el.setSelectionRange(typing.start, typing.end); } catch (_) { /* not a text field */ }
  }
}

/* 2.0.1 (the owner's review of the Steps page): the verbs that change a
   step's shape are the toolbar's, acting on the selected step: Split...,
   Merge with next, Hide step or Unhide, Open as a sub-process or Open
   sub-process and Dissolve sub-process, and Delete on a step added by hand.
   With two or more steps ticked the toolbar offers the verbs on the ticked
   ones instead (syncMultiSelectButtons). A verb that cannot act is disabled
   and says why in its title. */
const VERB_TITLES = {
  "btn-step-split": "Split this step: under Recorded, click the scissors where the first part ends (S)",
  "btn-step-merge": "Merge this step with the next step of its transaction (M)",
  "btn-step-make-sub": "Give this step its own steps, one per action recorded in it, in every transaction",
};
function _syncStepVerbs(selected) {
  const bar = $("#step-verbs");
  if (!bar) return;
  bar.hidden = !selected || State.getMultiSelectedStepIds().size >= 2;
  if (bar.hidden) return;
  const states = stepVerbStates(selected);
  for (const id of Object.keys(states)) applyVerbState($("#" + id), states[id]);
}

/* Lane PANE: what each verb on the selected step is for `selected`, keyed
   by the Steps toolbar's ids: { show, why (the reason it cannot act, "" when
   it can), title, label (when it changes) }. The Steps toolbar and the step
   opened in the Timeline's pane read the same states. */
function stepVerbStates(selected) {
  const isSub = SPM.isSubProcess(selected);
  const hidden = selected.state === "hidden";
  const out = {};
  const set = (id, show, why, title, label) => { out[id] = { show: !!show, why: why || "", title: why || title || VERB_TITLES[id] || "", label }; };
  set("btn-step-split", !isSub, PdtSteps.splitBlocker(selected));
  set("btn-step-merge", !isSub, "");
  set("btn-step-hide", true, "", hidden ? "Bring this step back into the list"
    : "Take this step out; Show hidden steps on its transaction lists it again.", hidden ? "Unhide" : "Hide step");
  set("btn-step-make-sub", !isSub && !hidden && _inTransaction(selected), _oneAction(selected));
  const count = isSub ? selected.sub_steps.filter((x) => x && x.state !== "hidden").length : 0;
  set("btn-step-open-sub", isSub, "", "Show the " + _plural(count, "step", "steps") + " of this sub-process, in every transaction that goes through it");
  set("btn-step-dissolve", isSub, "", selected.group === true
    ? "Put its steps back in its place, in every transaction. Ctrl+Z undoes it."
    : "Drop its sub-steps in every transaction; what you added to them moves to this step.");
  set("btn-step-delete", selected.state === "manually_authored", "",
    isSub && selected.group === true ? "Delete this sub-process you made, with its steps" : "Delete this step you added");
  return out;
}

/* Show a verb's button as its state says (stepVerbStates). */
function applyVerbState(b, st) {
  if (!b || !st) return;
  b.hidden = !st.show;
  b.disabled = !!st.why;
  b.title = st.title;
  if (st.label) b.textContent = st.label;
}

/* Split where the analyst chooses (2.0.1): Recorded opens (and stays open,
   as a click on it keeps it), its first scissors take the focus, and one
   line says what to click. */
function beginSplit(stepId) {
  if (State.getSelectedStepId() !== stepId) {
    State.setSelectedStepId(stepId);
    renderStepsLevel();
  }
  const rec = document.getElementById("step-recorded");
  if (rec) {
    if (!rec.open) { rec.open = true; PdtSteps.keepRecordedOpen(true); }
    rec.scrollIntoView({ block: "nearest" });
    const first = rec.querySelector(".si-split-btn");
    if (first) first.focus();
  }
  toast(SPLIT_WHERE, "success");
}

/* A step of a transaction, at any level (a sub-step has its parent's
   case_id): the sub-process verbs and the step flow need one. */
function _inTransaction(step) {
  const model = _model();
  return !!(step && typeof step.case_id === "string" && model.runs.some((r) => r.caseId === step.case_id));
}

/* Why Open as a sub-process has nothing to open for `step` (2.0.1): its
   recording holds fewer than two actions, so its one sub-step would repeat
   it; "" when there is something to open. */
const ONE_ACTION = "This step has one recorded action, so it has no steps of its own to open.";
function _oneAction(step, interactionsById) {
  if (!step || !((step.evidence && step.evidence.interaction_event_ids) || []).length) return "";
  return SPV.draftSubSteps(step, interactionsById || _interactionsById(), {}).length < 2 ? ONE_ACTION : "";
}

/* ===== Step flow (C17) ================================================= */

/* The Flow line of a step: its condition, its links (each with the sentence
   it reads) and the steps a link can go to, its transaction's visible steps
   in order. A condition holds for the step's box in every transaction, so a
   step without one of its own lists the ones set on its box elsewhere
   (`inherited`). Null for a step outside every transaction: the map draws
   the transactions. */
function _flowFor(step) {
  const model = _model();
  // C19: the steps of the step's own level: at the main level its
  // transaction's, inside a sub-process its visit's (a link stays in its
  // level; End ends the sub-process).
  const loc = _locate(step.step_id);
  const path = loc ? loc.path : [];
  const places = _containers(model, path).filter((c) => c.run);
  const place = _containerOf(places, step.step_id);
  if (!place) return null;
  const list = place.visible;
  const others = _otherSteps(places, list);
  const inherited = [];
  if (!StepFlow.onlyWhen(step)) {
    const node = mapNodeLabel(step);
    for (const c of places) {
      for (const s of c.visible) {
        const cond = s.step_id !== step.step_id && mapNodeLabel(s) === node ? StepFlow.onlyWhen(s) : "";
        if (cond && !inherited.some((x) => x.text === cond)) inherited.push({ text: cond, where: c.run.title + (c.index ? ", again" : "") });
      }
    }
  }
  return {
    onlyWhen: StepFlow.onlyWhen(step),
    inherited,
    links: StepFlow.links(step).map((l) => ({
      to: l.to, when: typeof l.when === "string" ? l.when : "",
      reading: StepFlow.linkReading(list, step, l, others),
      // 2.0.1: the words before the row's fields.
      verb: StepFlow.linkVerb(list, step, l, others),
      missing: StepFlow.linkPlace(list, step, l, others).kind === "missing",
    })),
    choices: StepFlow.linkChoices(list, step, [...others].map(([value, name]) => ({ value, name }))),
    next: StepFlow.nextLine(list, step),
    // C22: where it comes in the process when that is not where its time
    // puts it, and the way back; read only offers neither.
    ..._placeLine(step),
  };
}

/* The Flow line's part on the step's place in the process (C22). */
function _placeLine(step) {
  const ro = RO.isReadOnly(State.getSession());
  const p = _placeOf(step.step_id);
  const text = p ? placedText(step, p.steps) : "";
  return { placed: text, canBack: !ro && !!text && AC.hasTime(step), canPlace: !ro && step.state !== "hidden" };
}

/* The process's steps (one per map box) that the transaction `list` did
   not do, at the same level: a Decision can point at one (the other side of
   a choice, 2.0.1). Map of step_id to name. */
function _otherSteps(places, list) {
  const here = new Set((list || []).map((s) => mapNodeLabel(s)));
  const out = new Map();
  for (const c of places) {
    for (const s of c.visible) {
      const node = mapNodeLabel(s);
      if (here.has(node)) continue;
      here.add(node);
      out.set(s.step_id, String(s.name || "").trim() || node);
    }
  }
  return out;
}

/* One change of a step's flow is one undoable edit, and the step becomes the
   analyst's (a draft becomes edited). `edit(step)` returns true when it
   changed the step. */
async function _flowEdit(stepId, label, edit) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step || !edit(step)) return;
  _markEdited(step);
  try { await persistAnnotations(anno, label); } catch (_) { /* already shown */ }
}

/* C26: one edit of a step's information (step-information.js marks a
   draft edited), one undoable edit. */
async function _infoEdit(stepId, label, edit) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const anno = ensureAnnoShape(sess.annotations);
  const step = _findStep(stepId);
  if (!step || !edit(step)) return false;
  try { await persistAnnotations(anno, label); } catch (_) { return false; }
  return true;
}

/* C26: a field of a line changed; a line whose name was emptied goes, and
   the message says so. */
async function _infoField(stepId, i, key, value) {
  let result = "";
  const saved = await _infoEdit(stepId, key === "name" && !String(value || "").trim() ? "remove information" : "change information",
    (s) => { result = StepInfo.setField(s, i, key, value); return !!result; });
  if (saved && result === "removed") toast(StepInfo.WORDS.emptyName, "info");
}

/* C27: a field of an exception changed (one undoable edit, as C26's); an
   entry whose When was emptied goes, and the message says so. */
async function _excField(stepId, i, key, value) {
  let result = "";
  const saved = await _infoEdit(stepId, key === "when" && !String(value || "").trim() ? "remove an exception" : "change an exception",
    (s) => { result = StepExc.setField(s, i, key, value); return !!result; });
  if (saved && result === "removed") toast(StepExc.WORDS.emptyWhen, "info");
}

/* The toast's sentence when taking steps out dropped the links that went to
   them (C17: said once; Undo brings the steps and the links back). "" when
   none was dropped. */
function _linksDroppedText(n, several) {
  if (!n) return "";
  const to = several ? "them" : "it";
  return (n === 1 ? "The link to " + to + " was removed" : "The " + n + " links to " + to + " were removed") +
    "; Ctrl+Z brings " + (n === 1 && !several ? "both" : "them") + " back.";
}

/* ===== Names: rename, the library, propagate ============================= */

/* The one rename rule, for every entry point (inline rename, the detail
   form): the step becomes an analyst state and its grouping label follows the
   name the way the pipeline stamps it (step_suggest._step_process_label): a
   drafted step (it carries a draft_key) is labelled by its name as typed, the
   name the analyst chose for every step with that key (C4), so the value
   rules never cut it ("Salesforce - Order: Save order" is not "Salesforce");
   any other step keeps the value rules. The same-key drafts that take the
   name (propagateName) get the same label, so the renamed step and its
   siblings group together before the next Analyze stamps them again. When it
   carries a draft_key, every other still-draft step with that key takes the
   name at once, at every level. C19: a drafted sub-step (action_key) is
   labelled by its name too, and its name reaches the drafted sub-steps of
   its action_key; a sub-process's
   name reaches every occurrence of its node at its level, whatever their
   state, so the node and its map stay one (the level shown follows it).
   C21: a name that is an activity of the step's system in the project's
   library (`found`, a pick; else looked up by the name) names the step from
   the library (library.js applyActivity: its name, its system,
   library_activity, and the activity's description when the step has none of
   its own); any other name leaves the library. Returns { propagated,
   occurrences, fromLibrary }. */
function _applyRename(anno, step, name, found) {
  const loc = SPM.findStep(anno.steps || [], step.step_id);
  const path = loc ? loc.path : [];
  const oldNode = mapNodeLabel(step);
  const model = _model();
  const txs = _txs(model);
  const subNode = SPM.isSubProcessNode(txs, path, oldNode);
  const inter = _interactionsById();
  const facts = stepFacts(step, inter);
  const hit = found || Library.activityNamed(_library(), facts.system, name);
  const oldName = step.name;
  step.name = name;
  if (hit) Library.applyActivity(step, hit, { descriptionEmpty: facts.descriptionEmpty });
  else delete step.library_activity;
  _markEdited(step);
  name = step.name;
  const keyed = (typeof step.draft_key === "string" && step.draft_key) || (typeof step.action_key === "string" && step.action_key);
  const pl = keyed ? String(name).trim() : processLabel(name);
  if (pl) step.process_label = pl;
  const propagated = step.draft_key ? RunsModel.propagateName(anno.steps || [], step, name)
    : step.action_key ? RunsModel.propagateActionName(anno.steps || [], step, name)
    : RunsModel.propagateMergedName(anno.steps || [], step, oldName, name);
  let occurrences = 0;
  if (subNode) {
    occurrences = SPV.renameNode(txs, path, oldNode, name, step);
    const cur = State.getMapPath();
    if (cur.length > path.length && SPM.samePath(cur.slice(0, path.length), path) && cur[path.length] === oldNode) {
      cur[path.length] = mapNodeLabel(step);
      State.setMapPath(cur);
    }
  }
  return { propagated, occurrences, fromLibrary: !!hit };
}

function _renamedToast(propagated, occurrences) {
  if (occurrences) return "Renamed in every transaction: " + _plural(occurrences, "other occurrence", "other occurrences") + " took the name too.";
  return propagated
    ? "Renamed. " + _plural(propagated, "matching drafted step", "matching drafted steps") + " took the name too."
    : "Renamed";
}

async function inlineRenameStep(stepId, newName, advance) {
  // Special command: "open-next:<id>" means just re-render and trigger
  // the next row's rename without modifying any data.
  if (typeof advance === "string" && advance.startsWith("open-next:")) {
    const nextId = advance.slice("open-next:".length);
    State.setSelectedStepId(nextId);
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
    return;
  }
  if (!State.getSession() || !stepId || !newName) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step) return;
  // Tab moves on to the row below, in the list the analyst sees.
  const goNext = advance === true || advance === "next";
  const next = goNext ? _nextRow(stepId) : null;
  const { propagated, occurrences, fromLibrary } = _applyRename(anno, step, newName);
  let saved = true;
  try { await persistAnnotations(anno, fromLibrary ? "name the step from the library" : "rename step"); } catch (_) { saved = false; }   // already shown
  if (saved && fromLibrary) toast(_libraryToast(propagated, occurrences), "success");
  else if (saved && (propagated || occurrences)) toast(_renamedToast(propagated, occurrences), "success");
  if (next) {
    State.setSelectedStepId(next.step_id);
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
  }
}

/* The toast after a step was named from the library. */
function _libraryToast(propagated, occurrences) {
  return "Named from the library." + (occurrences || propagated ? " " + _renamedToast(propagated, occurrences).replace(/^Renamed(\.| in every transaction:) ?/, "") : "");
}

/* C21: an activity picked in the step pane's name field names the step from
   the library, even when the step already carries its name. One undoable
   edit. */
async function pickActivityAction(stepId, activityId) {
  const session = State.getSession();
  if (!session || RO.isReadOnly(session)) return;
  const anno = ensureAnnoShape(session.annotations);
  const step = _findStep(stepId);
  const found = Library.findActivity(_library(), activityId);
  if (!step || !found) return;
  const { propagated, occurrences } = _applyRename(anno, step, found.activity.name, found);
  let saved = true;
  try { await persistAnnotations(anno, "name the step from the library"); } catch (_) { saved = false; }   // already shown
  if (saved) toast(_libraryToast(propagated, occurrences), "success");
}

/* Start the inline rename of the selected step, when its row is on screen. */
function beginRenameOnSelected() {
  const row = _rowFor(State.getSelectedStepId());
  const nameEl = row && row.querySelector(".step-name");
  if (!nameEl) return;
  row.scrollIntoView({ block: "nearest" });
  nameEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

/* A step the analyst changed is theirs (edited; one they added stays
   added). A hidden step stays hidden, and Unhide brings it back edited. */
const _markEdited = AC.markEdited;

/* The description, saved when its field is left (no Save button): one
   undoable edit, the text the PDD prints under the step (C7). */
async function describeStepAction(stepId, text) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step) return;
  step.description = text;
  _markEdited(step);
  try { await persistAnnotations(anno, "edit step description"); } catch (_) { /* already shown */ }
}

/* C25: tick or untick No longer needed on a step (its waste flag), one
   undoable edit; a draft becomes edited. */
async function setNotNeededAction(stepId, on) {
  if (!State.getSession() || RO.isReadOnly(State.getSession())) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step || !StepScope.setNotNeeded(step, on)) return;
  _markEdited(step);
  try {
    await persistAnnotations(anno, on ? "mark the step as no longer needed" : "mark the step as needed");
    toast(on ? "Marked as no longer needed." : "Marked as needed.", "success");
  } catch (_) { /* already shown */ }
}

/* C25: who does a step (Done by), one undoable edit; emptied, the
   recording's role again. A draft becomes edited. */
async function setDoneByAction(stepId, text) {
  if (!State.getSession() || RO.isReadOnly(State.getSession())) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step || !StepScope.setDoneBy(step, text)) return;
  _markEdited(step);
  const role = StepScope.recordingRole(_manifest());
  try {
    await persistAnnotations(anno, "set who does the step");
    toast(step.done_by ? "Done by: " + step.done_by + "."
      : role ? "Done by: " + role + "." : "Nobody is named for this step.", "success");
  } catch (_) { /* already shown */ }
}

/* The loaded project's manifest.json ({} without one). */
function _manifest() {
  const s = State.getSession();
  return (s && s.manifest) || {};
}

/* ===== Boundary verbs (counted on the pattern run, C3) ================ */

/* Taking a step out (hide or delete) is a dropped draft, or, for a step the
   analyst added, the add taken back. */
function _removalFix(state) {
  return state === "manually_authored" ? { kind: "add", delta: -1 } : { kind: "drop", delta: 1 };
}

/* The draft-fix counter (the P1 probe) counts the main level only, and a
   group (C19) is no add: taking one out or back counts nothing. */
function _counts(step) {
  const loc = step && _locate(step.step_id);
  return !!(loc && loc.depth === 0 && step.group !== true);
}

/* C19: what a sub-process cannot take, in one line. */
const SUBPROCESS_NO_MERGE = "A sub-process is not merged or split: dissolve it first, or work on its steps inside.";

/* The row below a step in the block of the level shown (hidden rows count
   when they show). */
function _nextRow(stepId) {
  const model = _model();
  const path = _levelPath(model);
  if (!path.length) return RunsModel.nextInGroup(model, stepId, _ui.showHidden);
  const c = _containerOf(_containers(model, path), stepId);
  if (!c) return null;
  const list = _ui.showHidden ? c.members : c.visible;
  const i = list.findIndex((s) => s.step_id === stepId);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

/* Lane E-1: a step deleted takes the screenshots added to it with it (a
   frame it took as it was marked has no other place); Ctrl+Z brings both
   back, the files too. `ids`: the steps deleted, their sub-steps among them. */
function _dropAddedShots(anno, ids) {
  if (!Array.isArray(anno.analyst_screenshots) || !ids.size) return;
  anno.analyst_screenshots = anno.analyst_screenshots.filter((x) => !(x && ids.has(x.step_id)));
}

/* Item 5: only a step the analyst added is deleted. Any other step came from
   the drafting, and the next Analyze would draft it again, so taking it out
   hides it instead (a hidden step stays out of every analysis). */
async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (step && step.state !== "manually_authored") {
    if (step.state !== "hidden") await toggleStepHidden(stepId);
    return;
  }
  // C19: removing a group removes its steps too; Dissolve keeps them.
  const inside = step && step.group === true ? SPM.descendants(step).length : 0;
  const ok = await confirmModal(inside ? {
    title: "Delete the sub-process?",
    message: `Delete "${step.name || "(unnamed)"}" and its ${_plural(inside, "step", "steps")}?`,
    detail: "To keep its steps, choose Dissolve sub-process instead. Ctrl+Z restores it.",
    okLabel: "Delete",
    danger: true,
  } : {
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "You added this step by hand. Ctrl+Z restores it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (step && step.state !== "hidden" && _counts(step)) {
    const f = _removalFix(step.state);
    RunsModel.recordFix(anno, _model().runs, step.case_id, f.kind, f.delta);
  }
  // The owner: "you always add steps sequentially": a step of the analyst's
  // taken out gives its time back to the step before it, as before it was
  // added (time-edits.js handBack).
  const loc = _locate(stepId);
  const back = loc && !loc.parent && AC.stepTimeMovable(step)
    ? TE.handBack(_mainSpans(anno.steps, (s) => AC.stepTimeMovable(s)), _span(step), _markerMoments()) : null;
  // C22: the steps placed after it keep their place.
  _handOver([stepId]);
  if (step) _dropAddedShots(anno, new Set(SPM.allSteps([step]).map((s) => s.step_id)));
  SPM.removeSteps(anno.steps, [stepId]);
  if (back) {
    const prev = anno.steps.find((s) => s && s.step_id === back.id);
    prev.time_range = { start: prev.time_range.start, end: new Date(back.endMs).toISOString() };
    AC.markEdited(prev);
  }
  // C17: the links that went to it go too (Ctrl+Z brings both back).
  const dropped = StepFlow.dropLinksTo(anno.steps, [stepId]).length;
  if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
  await persistAnnotations(anno, 'delete step');
  toast(dropped ? "Step deleted. " + _linksDroppedText(dropped, false) : "Step deleted", "success");
}

/* Toggle a step's "hidden" state. Hidden steps drop out of the list (unless
   the run's "Show hidden steps" is on) and survive re-analyze via
   _merge_steps. The pre-hide state is stashed on `_prev_state` so unhiding
   restores it. On the pattern run, hiding a draft counts as a drop and
   unhiding it takes the drop back. */
async function toggleStepHidden(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const loc = _locate(stepId);
  const step = loc && loc.step;
  if (!step) return;
  const runs = _model().runs;
  const counts = _counts(step);
  if (step.state === "hidden") {
    const prev = step._prev_state || "auto_suggested";
    const f = _removalFix(prev);
    if (counts) RunsModel.recordFix(anno, runs, step.case_id, f.kind, -f.delta);
    step.state = prev;
    delete step._prev_state;
    await persistAnnotations(anno, "unhide step");
    toast("Step restored", "success");
  } else {
    const f = _removalFix(step.state);
    if (counts) RunsModel.recordFix(anno, runs, step.case_id, f.kind, f.delta);
    // C22: a hidden step is no step another comes after: the steps placed
    // after it keep their place.
    _handOver([stepId]);
    step._prev_state = step.state;
    step.state = "hidden";
    // C17: the links that went to it go too, in the same edit.
    const dropped = StepFlow.dropLinksTo(anno.steps, [stepId]).length;
    if (State.getSelectedStepId() === stepId && !_ui.showHidden) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    const linksText = dropped ? " " + _linksDroppedText(dropped, false) : "";
    // Item 2: a draft hidden in the pattern run is offered for every run
    // (at the main level, where the drafts of the other runs are).
    const p = RunsModel.patternRun(anno, runs);
    const others = p.run && step.case_id === p.run.caseId && loc.depth === 0
      ? RunsModel.sameKeyDraftsElsewhere(_model(), p.run.caseId, step.draft_key) : [];
    // C19: a sub-process hides with its steps.
    const inside = SPM.isSubProcess(step) ? SPM.descendants(step).length : 0;
    const what = inside ? "Sub-process hidden with its " + _plural(inside, "step", "steps") + "." : "Step hidden.";
    if (others.length) {
      toast(what + linksText + " " + _plural(RunsModel.runCount(others), "other transaction has", "other transactions have") +
        " the same drafted step.", "success",
        { action: { label: "Hide in all transactions", act: "hide-all-runs", onClick: () => hideInAllRuns(stepId) } });
    } else {
      toast(what + (linksText || ' "Show hidden steps" on its transaction lists it again.'), "success");
    }
  }
}

/* "Hide in all runs" (item 2): the other runs' still-draft steps with the
   same draft_key as the pattern-run draft `stepId` (hidden a moment ago) are
   hidden too, in one edit (one Ctrl+Z). They are not fixes of the pattern
   run. Does nothing once the pattern step is no longer hidden (the offer
   outlived an undo). */
async function hideInAllRuns(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = (anno.steps || []).find((s) => s.step_id === stepId);
  const model = _model();
  const p = RunsModel.patternRun(anno, model.runs);
  if (!step || step.state !== "hidden" || !p.run || step.case_id !== p.run.caseId) return;
  const others = RunsModel.sameKeyDraftsElsewhere(model, p.run.caseId, step.draft_key);
  if (!others.length) return;
  _handOver(others.map((s) => s.step_id));
  RunsModel.hideSteps(others);
  const dropped = StepFlow.dropLinksTo(anno.steps, others.map((s) => s.step_id)).length;
  await persistAnnotations(anno, "hide in all transactions");
  toast("Hidden here and in " + _plural(RunsModel.runCount(others), "other transaction", "other transactions") + "." +
    (dropped ? " " + _linksDroppedText(dropped, true) : " Ctrl+Z undoes it."), "success");
}

async function splitStep(stepId, after) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const loc = _locate(stepId);
  if (!loc) return;
  const s = loc.step;
  if (SPM.isSubProcess(s)) { toast(SUBPROCESS_NO_MERGE, "error"); return; }
  const ids = (s.evidence || {}).interaction_event_ids || [];   // a step may lack evidence
  // Lane FX3 (validation pass 3, F16): why it cannot, in the analyst's words.
  const why = PdtSteps.splitBlocker(s);
  if (why) { toast(why, "error"); return; }
  // Split after the action the analyst chose (the first part is [0..after]);
  // without one (S, Split..., the step menu), the scissors say where.
  if (!Number.isInteger(after) || after < 0 || after >= ids.length - 1) {
    beginSplit(stepId);
    return;
  }
  const mid = after + 1;
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(State.getSession().events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
  const firstEvents = firstIds.map(id => interMap[id]).filter(Boolean);
  const secondEvents = secondIds.map(id => interMap[id]).filter(Boolean);
  if (!firstEvents.length || !secondEvents.length) {
    toast("This step could not be split: the actions recorded in it are not in this project.", "error");
    return;
  }
  if (_counts(s)) RunsModel.recordFix(anno, _model().runs, s.case_id, "split");
  // G-4: splitting an already-split step must not stack suffixes
  // ("X (split 1) (split 1)") — strip any existing artifact first.
  const baseName = stripSplitSuffix(s.name);
  // Neither half is one draft any more: no draft identity (a rename of a
  // half is not remembered under the whole draft's key). A step the analyst
  // added gives two added steps (lane FX2).
  const state = AC.derivedState([s]);
  const second = RunsModel.dropDraftIdentity({ ...s, step_id: cryptoRandomId(),
    name: baseName + " (split 2)",
    time_range: { start: secondEvents[0].timestamp, end: secondEvents[secondEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: secondIds },
    state });
  const first = RunsModel.dropDraftIdentity({ ...s, name: baseName + " (split 1)",
    time_range: { start: firstEvents[0].timestamp, end: firstEvents[firstEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: firstIds },
    state });
  // C17: the condition stays with the first half, the links leave the second.
  StepFlow.splitFlow(first, second);
  StepInfo.splitInformation(first, second);   // C26: the lines stay with the first half
  StepExc.splitExceptions(first, second);   // C27: the exceptions too
  loc.list.splice(loc.list.indexOf(s), 1, first, second);
  _splitPlace(first, second, true);   // C22
  await persistAnnotations(anno, 'split step');
  toast("Step split", "success");
}

/* "Add step here" from the Flow video playhead -- always adds a step,
   never refuses:
     - playhead inside a step -> split that step at the playhead
       (a boundary inside a step necessarily cuts it in two);
     - playhead in open space -> new step from the playhead to the
       next step's start (or the end of the run it is in, or the
       session end);
     - no steps yet           -> carve the session into "Step 1" /
       "Step 2" at the playhead.
   Distinct from splitStep(), which cuts a selected step at its
   interaction-count midpoint. A new step belongs to the run that contains
   it; on the pattern run the split and the add are counted fixes.
   Lane E-1: `opts.frame` (a promise of the video's frame at that moment, a
   base64 image or null, AnalystUI.frameAtMoment) makes that frame the new
   step's added screenshot, in the same undoable edit as the step (one
   Ctrl+Z takes both, the file too). A frame that cannot be read leaves the
   step without one, and nothing is said. Resolves the id of the step that
   starts at the moment, or null when none was added. */
async function addStepAtTimestamp(tsISO, opts) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return null;
  const t = new Date(tsISO).getTime();
  if (!isFinite(t)) { toast("No step was added: the moment could not be read.", "error"); return null; }
  // What would be added is known before the frame is written, so a step
  // that cannot be added leaves no file behind.
  const pre = _stepAt(t, true);
  if (pre.refuse) { toast(pre.refuse, pre.error ? "error" : undefined); return null; }
  let shot = null;
  if (opts && opts.frame) {
    const data = await AnalystUI.settleFrame(opts.frame, AnalystUI.FRAME_WAIT_MS + 1000);
    if (data) shot = await AnalystUI.writeFrame(data);
    if (State.getSession() !== sess) return null;
  }
  // No await from here to the save: the step and its picture are one edit.
  const r = _stepAt(t, false);
  if (r.refuse) { toast(r.refuse, r.error ? "error" : undefined); return null; }
  const anno = ensureAnnoShape(sess.annotations);
  if (shot && r.stepId) {
    if (!Array.isArray(anno.analyst_screenshots)) anno.analyst_screenshots = [];
    anno.analyst_screenshots.push(AnalystUI.frameEntry(shot, r.stepId, new Date(t).toISOString()));
  }
  try { await persistAnnotations(anno, "Add step"); } catch (_) { return null; }   // already shown
  toast(r.toast, "success");
  return r.stepId || null;
}

/* The step at the moment `t` (addStepAtTimestamp): with `dry`, what would
   happen and nothing changed ({ ok } or { refuse, error }); else the change
   made in memory, not saved: { stepId (the step that starts at `t`), toast }
   or { refuse, error }. Every refusal comes before any change. */
function _stepAt(t, dry) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const runs = _model().runs;
  const inter = State.getSession().events.filter(e => e.type === "interaction");
  const interMap = Object.fromEntries(inter.map(e => [e.event_id, e]));
  const evTime = (id) => interMap[id] ? new Date(interMap[id].timestamp).getTime() : NaN;
  const tISO = new Date(t).toISOString();
  const runAt = (a, b) => { const r = RunsModel.runForRange(runs, a, b); return r ? r.caseId : null; };

  // No steps yet in a recording: carve the whole session in two at the
  // playhead. (A video project gets one step from the playhead, below.)
  if (!anno.steps.length && (State.getSession().events || []).length) {
    const span = getSpan();
    if (!span) return { refuse: "No events to anchor a step to", error: true };
    if (dry) return { ok: true };
    const before = inter.filter(e => new Date(e.timestamp).getTime() < t).map(e => e.event_id);
    const after = inter.filter(e => new Date(e.timestamp).getTime() >= t).map(e => e.event_id);
    const second = makeStep("Step 2", tISO, new Date(span.endMs).toISOString(), after, runAt(t, span.endMs));
    anno.steps.push(
      makeStep("Step 1", new Date(span.startMs).toISOString(), tISO, before, runAt(span.startMs, t)),
      second,
    );
    return { stepId: second.step_id, toast: 'Created "Step 1" and "Step 2"' };
  }

  // Playhead inside a step: split that step at the playhead. C19 and lane
  // FX2 (validation pass 3, F15): inside a sub-process its steps take the
  // moment, at any depth (never the sub-process itself), so a sub-step gets
  // a time the way a main-level step does.
  const place = SPV.momentPlace(anno.steps, t);
  if (place.kind === "split") {
    if (dry) return { ok: true };
    const s = place.list[place.index];
    const ids = (s.evidence && s.evidence.interaction_event_ids) || [];
    const newName = nextStepName(SPM.allSteps(anno.steps));
    // The draft-fix counter counts the main level only (C19).
    if (!place.parent) RunsModel.recordFix(anno, runs, s.case_id, "split");
    // A step the analyst added stays added in both halves (lane FX2).
    const state = AC.derivedState([s]);
    // 2.0.3: a step of the analyst's at the main level is cut without either
    // part running over a transaction boundary, and the new part belongs to
    // the transaction its start is in.
    const own = !place.parent && AC.stepTimeMovable(s)
      ? TE.cutForNewStep({ startMs: Date.parse(s.time_range.start), endMs: Date.parse(s.time_range.end) }, t, _markerMoments()) : null;
    const first = RunsModel.dropDraftIdentity({ ...s,
      time_range: { start: s.time_range.start, end: own ? new Date(own.before.endMs).toISOString() : tISO },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) < t) },
      state });
    const second = RunsModel.dropDraftIdentity({ ...s, step_id: cryptoRandomId(), name: newName,
      time_range: { start: tISO, end: own ? new Date(own.after.endMs).toISOString() : s.time_range.end },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) >= t) },
      state });
    if (own) {
      second.case_id = runAt(t, own.after.endMs);
      // Lane E-1: marked one after another, the new step is the next step,
      // written afresh in the step panel: it takes none of what was written
      // on the step before it (its description, its library activity, its
      // screenshot choices, its waste flag, the label its name gave it, which
      // would put it in that step's map box and panel). Its system stays.
      second.description = "";
      second.flags = { waste: false };
      for (const k of ["library_activity", "pdd_screenshot", "hidden_screenshots", "process_label"]) delete second[k];
    }
    StepFlow.splitFlow(first, second);   // C17, as in splitStep
    StepInfo.splitInformation(first, second);   // C26, as in splitStep
    StepExc.splitExceptions(first, second);   // C27, as in splitStep
    place.list.splice(place.index, 1, first, second);
    // C22: a step of the analyst's cut here is the step being marked and
    // the new one the next step, which its time places; a recorded step's two
    // parts are one step's, the second right after the first.
    _splitPlace(first, second, !own);
    return { stepId: second.step_id, toast: 'Added "' + newName + '"' + (place.parent ? ' inside "' + (place.parent.name || "") + '"' : "") };
  }

  // Playhead inside a sub-process, between its steps: a new sub-step from
  // the playhead to its next step's start, or to the sub-process's end.
  if (place.parent) {
    const parent = place.parent;
    const parentEnd = new Date(parent.time_range.end).getTime();
    const nextSub = place.list.filter((s) => s && s.time_range && s.time_range.start)
      .map((s) => new Date(s.time_range.start).getTime()).filter((ms) => ms >= t).sort((a, b) => a - b)[0];
    const endMs = Math.min(nextSub != null ? nextSub : parentEnd, parentEnd);
    if (!(endMs - t > 0)) return { refuse: "A step already starts here" };
    if (dry) return { ok: true };
    const newName = nextStepName(SPM.allSteps(anno.steps));
    const own = new Set((parent.evidence && parent.evidence.interaction_event_ids) || []);
    const ids = inter.filter((e) => { const et = new Date(e.timestamp).getTime(); return own.has(e.event_id) && et >= t && et < endMs; })
      .map((e) => e.event_id);
    const sub = makeStep(newName, tISO, new Date(endMs).toISOString(), ids, parent.case_id != null ? parent.case_id : null);
    place.list.push(sub);
    return { stepId: sub.step_id, toast: 'Added "' + newName + '" inside "' + (parent.name || "") + '"' };
  }

  // Playhead in open space: new step from the playhead to the next boundary
  // (the next step's start, else, 2.0.3, the next transaction boundary as
  // the markers now are: a Start or an End, else the end of the session).
  const span = getSpan();
  const next = anno.steps
    .filter(s => s.time_range && s.time_range.start)
    .map(s => new Date(s.time_range.start).getTime())
    .filter(ms => ms >= t)
    .sort((a, b) => a - b)[0];
  let endMs = next != null ? next : (span ? span.endMs : t + 5000);
  const boundary = TE.nextBoundary(_markerMoments(), t);
  if (boundary != null) endMs = Math.min(endMs, boundary);
  if (endMs - t <= 0) return { refuse: "A step already starts here" };
  if (dry) return { ok: true };
  const newName = nextStepName(anno.steps);
  const ids = inter
    .filter(e => { const et = new Date(e.timestamp).getTime(); return et >= t && et < endMs; })
    .map(e => e.event_id);
  const caseId = runAt(t, endMs);
  RunsModel.recordFix(anno, runs, caseId, "add");
  const added = makeStep(newName, tISO, new Date(endMs).toISOString(), ids, caseId);
  anno.steps.push(added);
  return { stepId: added.step_id, toast: 'Added "' + newName + '"' };
}

/* C22: the place in the process of a step split in two (`first` keeps its
   step_id). `together`: the parts are one step's (a split at a recorded
   action), so the second comes right after the first and a step placed
   after the step comes after both; else (a new step marked inside a step of
   the analyst's, the owner's sequential marking) the new part is the next
   step, which its time places. */
function _splitPlace(first, second, together) {
  delete second.placed_after;
  if (!together) return;
  const p = _placeOf(first.step_id);
  if (!p) return;
  for (const s of p.loc.list) if (s && s !== second && s.placed_after === first.step_id) s.placed_after = second.step_id;
  if (StepOrder.isPlaced(first, p.steps)) second.placed_after = first.step_id;
}

/* 2.0.3 (a process manager's report): a step's start or end dragged on the
   Timeline or typed in Steps, and with it the side of a step back to back
   with it. `changes` = [{ stepId, startMs, endMs, place }], each a step no
   recorded action times (AC.stepTimeMovable), or with `place` a step without
   a time given one (AC.stepTimePlaceable). A step of the main level then
   belongs to the transaction that holds its new start (C9's rule,
   RunsModel.runForRange), or to none: Outside the transactions. One
   undoable edit. Resolves true when saved. */
async function setStepTimes(changes) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const anno = ensureAnnoShape(sess.annotations);
  if (!_applyStepTimes(anno, changes)) return false;
  try { await persistAnnotations(anno, "change the step's time"); } catch (_) { return false; }   // already shown
  return true;
}

/* setStepTimes's change, made in memory and not saved (lane E, E5: Show
   "<step>" here saves it with the order and the picture as one edit).
   False, and nothing changed, when a change cannot be made. */
function _applyStepTimes(anno, changes) {
  const runs = _model().runs;
  const todo = [];
  for (const c of Array.isArray(changes) ? changes : []) {
    const hit = SPM.findStep(anno.steps, c && c.stepId);
    if (!hit || !(c.place ? AC.stepTimePlaceable(hit.step) : AC.stepTimeMovable(hit.step))) return false;
    if (!Number.isFinite(c.startMs) || !Number.isFinite(c.endMs) || c.endMs < c.startMs) return false;
    todo.push({ hit, c });
  }
  if (!todo.length) return false;
  for (const { hit, c } of todo) {
    const s = hit.step;
    s.time_range = { start: new Date(c.startMs).toISOString(), end: new Date(c.endMs).toISOString() };
    // A step with a time is ordered by it, not by the place it had without one.
    if (c.place) delete s.order;
    // A sub-step keeps its parent's transaction (C19). C22: a step placed
    // after another stays in that one's transaction.
    if (!hit.parent && !StepOrder.isPlaced(s, (_placeOf(s.step_id) || {}).steps || [])) {
      const run = RunsModel.runForRange(runs, c.startMs);
      s.case_id = run ? run.caseId : null;
    }
    AC.markEdited(s);
  }
  // C22: the steps placed after a step that changed transaction go with it.
  StepOrder.followTransaction(anno.steps);
  return true;
}

/* ---- "<step>" starts here (lane E, item E5) ------------------------------------
   Steps written first have no time: each gets the playhead's moment as its
   start, by the rules of a start typed for a step without one
   (commitStepTime): it runs until the next step starts or its transaction
   ends, and inside a step of the analyst's that step ends there, as + Step
   cuts it. Its place in the process stays where it was in the list (C22:
   the fewest placements, deriveOrder), unless its moment puts it in another
   transaction, which it then joins. A step without a picture takes the
   video's frame at that moment. One undoable edit. */

/* The main level's visible steps in their process order: the transactions
   in their order, then the steps outside them (show-here.js targetOf). */
function stepsInProcessOrder() {
  const model = _model();
  return [...model.runs.flatMap((r) => StepOrder.processOrder(r.visible)),
    ...(model.outside || []).filter((s) => s && s.state !== "hidden")];
}

/* The step "<step>" starts here acts on now (show-here.js targetOf), or null. */
function showHereTarget() {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return null;
  return ShowHere.targetOf(_findStep(State.getSelectedStepId()), stepsInProcessOrder());
}

/* The changes that give `hit`'s step the start `at` (absolute ms), or {
   refuse } with the reason: a start typed's rules (commitStepTime). */
function _showChanges(hit, at) {
  const sess = State.getSession();
  const fmt = (x) => TE.fieldTime(x, recordingStartMs(sess));
  const stepId = hit.step.step_id;
  const place = !AC.hasTime(hit.step);
  const { others, outer } = _stepNeighbours(hit);
  const moments = _markerMoments();
  const p = TE.placeUntimed(at, others, outer, TE.nextBoundary(moments, at));
  if (p.outside) return { refuse: "This moment is outside the video: go to a moment from " + fmt(outer.startMs) + "." };
  if (p.inside) {
    const o = p.inside;
    if (!o.movable) {
      return { refuse: (o.name || "Another step") + " runs from " + fmt(o.startMs) + " to " + fmt(o.endMs) +
        " and its recorded actions give it its time: go to a moment outside it." };
    }
    const cut = TE.cutForNewStep(o, at, moments);
    return { changes: [{ stepId: o.id, startMs: cut.before.startMs, endMs: cut.before.endMs },
      { stepId, startMs: cut.after.startMs, endMs: cut.after.endMs, place }] };
  }
  if (p.tooShort) return { refuse: "Another step starts right there: go to an earlier moment." };
  return { changes: [{ stepId, startMs: at, endMs: p.endMs, place }] };
}

/* "<step>" starts here: `stepId` gets the moment `atMs` (absolute) as its
   start. `opts.frame`: a promise of the video's frame there (AnalystUI
   frameAtMoment), the step's picture when it has none. Resolves true when
   saved. */
async function showStepAt(stepId, atMs, opts) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess) || !Number.isFinite(atMs)) return false;
  const find = () => {
    const hit = SPM.findStep((sess.annotations && sess.annotations.steps) || [], stepId);
    return hit && !hit.parent && ShowHere.canShow(hit.step) ? hit : null;
  };
  const pre = find();
  if (!pre) return false;
  // What would change is known before the frame is written, so a refusal
  // leaves no file behind.
  const dry = _showChanges(pre, atMs);
  if (dry.refuse) { toast(dry.refuse, "error"); return false; }
  let shot = null;
  if (opts && opts.frame && !AC.stepShots(pre.step, (sess.annotations || {}).analyst_screenshots).length) {
    const data = await AnalystUI.settleFrame(opts.frame, AnalystUI.FRAME_WAIT_MS + 1000);
    if (data) shot = await AnalystUI.writeFrame(data);
    if (State.getSession() !== sess) return false;
  }
  // No await from here to the save: the time, the order and the picture are
  // one edit.
  const hit = find();
  const r = hit && _showChanges(hit, atMs);
  if (!r || r.refuse) { if (r) toast(r.refuse, "error"); return false; }
  const anno = ensureAnnoShape(sess.annotations);
  const step = hit.step;
  const before = _placeOf(stepId);
  const wanted = StepOrder.processOrder(before.steps);
  const caseBefore = _caseKey(step);
  if (!_applyStepTimes(anno, r.changes)) return false;
  const after = _placeOf(stepId);
  if (after && _caseKey(step) === caseBefore) {
    for (const s of ShowHere.keepPlace(wanted, after.steps, step, _canBeFree(after.main, _model().runs))) AC.markEdited(s);
  }
  if (shot) {
    if (!Array.isArray(anno.analyst_screenshots)) anno.analyst_screenshots = [];
    anno.analyst_screenshots.push(AnalystUI.frameEntry(shot, stepId, new Date(atMs).toISOString()));
  }
  try { await persistAnnotations(anno, "show the step here"); } catch (_) { return false; }   // already shown
  toast(ShowHere.doneText(step, sinceStart(step.time_range.start, recordingStartMs(sess))), "success");
  return true;
}

/* ---- Times typed in Steps (2.0.3) ------------------------------------------
   A process manager's report: a transaction started a few pixels after the
   step it was meant to hold, and neither could be moved or given a time.
   The selected step's line of facts shows its start and end as fields when
   its time is the analyst's, and a start field when it has no time yet; an
   open transaction shows Starts at and Ends at. A field reads and is typed on
   the one clock, to a tenth of a second where the time has one (time-edits.js
   fieldTime); the rules are the Timeline's drag's (time-edits.js). */

/* The markers as they now are (every change laid over them, a deleted one
   left out), as moments: where transactions start and end. */
function _markerMoments() {
  return TE.markerMoments(MarkerEdits.currentMarkerEvents(MarkerEdits.sessionMarkerView(State.getSession())));
}

/* A timed step's { id, startMs, endMs }. */
function _span(s) {
  return { id: s.step_id, startMs: Date.parse(s.time_range.start), endMs: Date.parse(s.time_range.end) };
}

/* The main level's timed steps (hidden ones left out) that `keep` keeps, as
   spans. */
function _mainSpans(steps, keep) {
  return (steps || []).filter((s) => s && s.state !== "hidden" && AC.hasTime(s) && (!keep || keep(s))).map(_span)
    .filter((o) => Number.isFinite(o.startMs) && Number.isFinite(o.endMs));
}

/* Whether a step of the analyst's is open (time-edits.js isOpen, the owner:
   "you always add steps sequentially"): the one being marked, nothing
   marked after it yet, so it runs to the end and has no length to show. At
   the main level only: a sub-step ends with its sub-process. */
function _stepOpen(step) {
  const sess = State.getSession();
  if (!sess || !AC.stepTimeMovable(step)) return false;
  const loc = _locate(step.step_id);
  return !!loc && !loc.parent && TE.isOpen(_span(step), _timelineSpan(sess).endMs, _markerMoments());
}

/* Whether the project has a timeline to give a time on: a recording, or a
   video (a project with neither has no time to give). */
function _hasTimeline(sess) {
  return !!sess && (((sess.events || []).length > 0) || !!sess.recordingAvailable);
}

/* The span a time may take: the Timeline's (the recording, or the video once
   its length is known). */
function _timelineSpan(sess) {
  const sp = Video.timelineSpan();
  const origin = recordingStartMs(sess);
  return sp ? { startMs: sp.startMs, endMs: sp.endMs } : { startMs: origin, endMs: Infinity };
}

/* A time field: its time on the one clock, what it is for, what typing does. */
function _timeFieldHtml(id, valueText, label, title, extra) {
  const o = extra || {};
  return '<input type="text" class="time-field"' + (id ? ' id="' + id + '"' : "") +
    (o.side ? ' data-side="' + o.side + '"' : "") + ' value="' + escapeAttr(valueText) + '"' +
    (o.placeholder ? ' placeholder="' + escapeAttr(o.placeholder) + '"' : "") + (o.disabled ? " disabled" : "") +
    ' aria-label="' + escapeAttr(label) + '" title="' + escapeAttr(title) + '" spellcheck="false" autocomplete="off">';
}
/* Lane A-2: how to type a time is said in Help (Change when a transaction
   or a step starts or ends); a field's tooltip says what it holds. */
const NOT_A_TIME = "That is not a time: type it the way the timeline shows it, for example 0:09 or 1:05.5.";

/* The time part of the selected step's line of facts, as HTML, or "" when its
   time is not the analyst's (a recorded step reads "Transaction 1 at 0:19").
   A step whose time is the analyst's: "Transaction 1 · [0:09.6] to [0:31.9] ·
   took 22s", or, the step being marked, "Transaction 1 · [0:09.6] to [open]";
   one without a time, in a project with a timeline: "Transaction 1 · no time
   yet: [ ] to [ ]", its end waiting for its start. */
function _stepTimeHtml(step, runs, origin, took) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess) || !_hasTimeline(sess)) return "";
  const run = runs.find((r) => r.caseId === step.case_id);
  const where = escapeHtml(run ? run.title : "Outside the transactions");
  if (AC.stepTimeMovable(step)) {
    const a = Date.parse(step.time_range.start), b = Date.parse(step.time_range.end);
    return where + " · " +
      _timeFieldHtml("step-start", TE.fieldTime(a, origin), "Start of this step", "When this step starts: type a time, for example 0:09, and press Enter.") + " to " +
      (_stepOpen(step)
        ? _timeFieldHtml("step-end", "", "End of this step", "Open: it ends where you add the next step. Type a time to end it there.",
          { placeholder: "open" })
        : _timeFieldHtml("step-end", TE.fieldTime(b, origin), "End of this step", "When this step ends; empty, it runs until the next step starts.")) +
      (took ? " · took " + escapeHtml(took) : "");
  }
  if (AC.stepTimePlaceable(step)) {
    return (run ? where + " · " : "") + "no time yet: " +
      _timeFieldHtml("step-start", "", "Start of this step", "Type when this step starts, for example 1:05, and press Enter.",
        { placeholder: "0:00" }) + " to " +
      _timeFieldHtml("step-end", "", "End of this step", "Type when it starts first; it then ends where the next step starts.",
        { disabled: true });
  }
  return "";
}

/* Wire one time field: Enter saves it and leaves it, Escape puts back what it
   showed, Up and Down change it by a second, and leaving it saves a change.
   `commit(ms)` gets the time typed, in ms since the recording started (null
   for an emptied field), and resolves false when it did not take it (it said
   why): the field then shows its time again, and (lane A-2) the reason stays
   under its line until the field is edited again (field-refusal.js; `key`
   names the field and what it is for, so a field drawn again shows it too). */
function _wireTimeField(el, commit, isRendering, key) {
  const shown = el.value;
  FieldRefusal.renew(el, key);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); el.value = shown; el.blur(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const ms = TE.parseFieldTime(el.value.trim() || el.placeholder);
      if (ms == null) return;
      e.preventDefault();
      el.value = TE.fieldTime(Math.max(0, ms + (e.key === "ArrowUp" ? 1000 : -1000)), 0);
      FieldRefusal.clear(el, key);
    }
  });
  el.addEventListener("blur", async () => {
    if ((isRendering && isRendering()) || !el.isConnected) return;
    const text = el.value.trim();
    if (text === shown.trim()) return;
    const ms = text ? TE.parseFieldTime(text) : null;
    if (text && ms == null) {
      toast(NOT_A_TIME, "error");
      el.value = shown;
      FieldRefusal.show(el, NOT_A_TIME, key);
      return;
    }
    const asked = Date.now();
    let ok = false;
    try { ok = await commit(ms); } catch (_) { ok = false; }   // a failed save has been shown
    if (ok) { FieldRefusal.clear(el, key); return; }
    const why = errorSince(asked);
    if (el.isConnected) {
      el.value = shown;
      if (why) FieldRefusal.show(el, why, key);
    } else if (why && key) {
      // Drawn again meanwhile: the new field shows it (renew).
      FieldRefusal.show(null, why, key);
    }
  });
}

/* The selected step's time fields. */
function _wireStepTimes(host, step, isRendering) {
  for (const [id, edge] of [["step-start", "start"], ["step-end", "end"]]) {
    const el = host.querySelector("#" + id);
    if (el) _wireTimeField(el, (ms) => commitStepTime(step.step_id, edge, ms), isRendering, "step:" + step.step_id + ":" + edge);
  }
}

/* The steps beside a step (at its level, shown and timed) and the span its
   time stays in (the timeline, or its sub-process). */
function _stepNeighbours(hit) {
  const sess = State.getSession();
  const line = _timelineSpan(sess);
  const pr = hit.parent && hit.parent.time_range;
  const pa = Date.parse(pr && pr.start), pb = Date.parse(pr && pr.end);
  const outer = Number.isFinite(pa) && Number.isFinite(pb)
    ? { startMs: Math.max(line.startMs, pa), endMs: Math.min(line.endMs, pb) } : line;
  const others = (hit.list || []).filter((o) => o && o !== hit.step && o.state !== "hidden" && AC.hasTime(o)).map((o) => ({
    id: o.step_id, name: o.name || "", startMs: Date.parse(o.time_range.start), endMs: Date.parse(o.time_range.end),
    movable: AC.stepTimeMovable(o),
  })).filter((o) => Number.isFinite(o.startMs) && Number.isFinite(o.endMs));
  return { others, outer };
}

/* A step's start or end typed (`ms` since the recording started): by the
   rules of a drag, or, for a step without a time, from there until the next
   step starts or its transaction ends. An end emptied (`ms` null) runs on
   to there again. Says why when it cannot be. */
async function commitStepTime(stepId, edge, ms) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const origin = recordingStartMs(sess);
  const fmt = (x) => TE.fieldTime(x, origin);
  const hit = SPM.findStep((sess.annotations && sess.annotations.steps) || [], stepId);
  if (!hit) return false;
  const { others, outer } = _stepNeighbours(hit);
  if (ms == null) {
    // The inverse of an end typed: until the next step starts or its
    // transaction ends (open while nothing is marked after it).
    if (edge !== "end" || !AC.stepTimeMovable(hit.step)) return false;
    const own = _span(hit.step);
    const endMs = TE.naturalEnd(own, others, hit.parent ? [] : _markerMoments(), outer.endMs);
    if (!Number.isFinite(endMs) || endMs === own.endMs || endMs - own.startMs < TE.MIN_SPAN_MS) return false;
    return setStepTimes([{ stepId, startMs: own.startMs, endMs }]);
  }
  const at = origin + ms;
  if (!AC.hasTime(hit.step)) {
    // 2.0.3: until the next step starts or the next transaction boundary.
    const moments = hit.parent ? [] : _markerMoments();
    const place = TE.placeUntimed(at, others, outer, TE.nextBoundary(moments, at));
    if (place.outside) {
      toast("Type a start from " + fmt(outer.startMs) + (Number.isFinite(outer.endMs) ? " to " + fmt(outer.endMs) : "") + ".", "error");
      return false;
    }
    if (place.inside) {
      const o = place.inside;
      // Inside a step of the analyst's: that step ends here, as + Step cuts it.
      if (o.movable) {
        const cut = TE.cutForNewStep(o, at, moments);
        return setStepTimes([{ stepId: o.id, startMs: cut.before.startMs, endMs: cut.before.endMs },
          { stepId, startMs: cut.after.startMs, endMs: cut.after.endMs, place: true }]);
      }
      toast((o.name || "Another step") + " runs from " + fmt(o.startMs) + " to " + fmt(o.endMs) +
        " and its recorded actions give it its time: type a start outside it.", "error");
      return false;
    }
    if (place.tooShort) { toast("Another step starts right there: type an earlier start.", "error"); return false; }
    return setStepTimes([{ stepId, startMs: at, endMs: place.endMs, place: true }]);
  }
  const own = { startMs: Date.parse(hit.step.time_range.start), endMs: Date.parse(hit.step.time_range.end) };
  if (at === own[edge === "start" ? "startMs" : "endMs"]) return true;
  const side = TE.stepSide(own, edge, others, outer);
  if (at < side.lo || at > side.hi) {
    toast("The " + edge + " of this step can be from " + fmt(side.lo) + " to " + fmt(side.hi) +
      ": a step does not run over the steps beside it.", "error");
    return false;
  }
  return setStepTimes(TE.stepSideChanges(stepId, own, edge, side.link, at));
}

/* An open transaction's times, first among its acts: "Starts at [0:09.7]
   Ends at [0:31.9]". Its start is its Start marker; its end its own End, or,
   greyed, where the next transaction starts or the timeline ends (typing one
   adds its End). A change shows as typed and the steps follow it a moment
   later (D4, flow-view.js scheduleAutoApply). The transaction no marker starts yet
   (the one of a project without a recording) shows both fields too, as the
   markers now are: typing its start marks it, typing its end marks it from
   the start of the video. Read only: the times as text. null without a
   timeline, or for a transaction whose markers cannot be found. */
function _runTimesEl(run) {
  const sess = State.getSession();
  if (!sess || !_hasTimeline(sess)) return null;
  const origin = recordingStartMs(sess);
  const fmt = (x) => TE.fieldTime(x, origin);
  const line = _timelineSpan(sess);
  let sides = TE.runSides(run, MarkerEdits.sessionMarkerView(sess));
  const implicit = !sides.start && run.caseId === AC.implicitRunId(sess.stats);
  if (!sides.start && !implicit) return null;
  if (implicit) {
    // Its markers wait for the analysis: its sides are the first Start as the
    // markers now are, and what follows it.
    const i = sides.now.findIndex((r) => r.markerType === "start");
    const after = i >= 0 ? sides.now[i + 1] || null : null;
    sides = { start: i >= 0 ? sides.now[i] : null, end: after && after.markerType === "end" ? after : null,
      next: after && after.markerType === "start" ? after : null, now: sides.now, index: i };
  }
  const ro = RO.isReadOnly(sess);
  const startMs = sides.start ? Date.parse(sides.start.timestamp) : NaN;
  const endMs = sides.end ? Date.parse(sides.end.timestamp) : NaN;
  const untilMs = sides.next ? Date.parse(sides.next.timestamp) : line.endMs;
  const untilWhat = sides.next ? "It ends where the next transaction starts"
    : "Open: it runs to the end of the " + (AC.hasRecording(sess) ? "recording" : "video");
  const el = document.createElement("div");
  el.className = "run-times";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "When " + run.title + " starts and ends");
  if (ro) {
    el.textContent = "Starts at " + (sides.start ? fmt(startMs) : fmt(line.startMs)) + " · " +
      (sides.end ? "ends at " + fmt(endMs) : sides.next ? "ends at " + fmt(untilMs) : "open, no end marked");
    return el;
  }
  el.innerHTML =
    "<label>Starts at " + (sides.start
      ? _timeFieldHtml(null, fmt(startMs), "Start of " + run.title, "Where this transaction starts: type a time, for example 0:09, and press Enter.",
        { side: "start" })
      : _timeFieldHtml(null, "", "Start of " + run.title, "Type where this transaction starts; until then it is the whole project.",
        { side: "start", placeholder: fmt(line.startMs) })) + "</label>" +
    "<label>Ends at " + (sides.end
      ? _timeFieldHtml(null, fmt(endMs), "End of " + run.title, "Where this transaction ends; empty the field to take its end out.", { side: "end" })
      : _timeFieldHtml(null, "", "End of " + run.title, untilWhat + ". Type an earlier time to end it there.",
        { side: "end", placeholder: sides.next ? fmt(untilMs) : "open" })) + "</label>";
  const times = sides.now.map((r) => Date.parse(r.timestamp));
  const topics = ["markers", "timeline", "steps"];
  const iso = (ms) => new Date(ms).toISOString();
  const refuse = (what, lo, hi, why) => {
    toast("The " + what + " can be from " + fmt(lo) + " to " + (fmt(hi) || "the end") + (why ? ": " + why : "") + ".", "error");
    return false;
  };
  const startEl = el.querySelector('[data-side="start"]'), endEl = el.querySelector('[data-side="end"]');
  _wireTimeField(startEl, async (ms) => {
    if (ms == null) return false;
    const at = origin + ms;
    if (!sides.start) {
      if (at < line.startMs || at >= line.endMs) return refuse("start", line.startMs, line.endMs);
      return FlowMarkers.insertMarker("start", iso(at), null, topics);
    }
    const b = TE.markerDragBounds(times, sides.index, line.startMs, line.endMs);
    if (at < b.lo || at > b.hi) return refuse("start", b.lo, b.hi, "the transactions keep their order");
    return FlowMarkers.moveMarker(sides.start, iso(at), topics);
  }, null, "run:" + run.caseId + ":start");
  if (endEl) {
    _wireTimeField(endEl, async (ms) => {
      if (sides.end) {
        if (ms == null) return FlowMarkers.removeMarker(sides.end, topics);
        const at = origin + ms;
        const b = TE.markerDragBounds(times, sides.index + 1, line.startMs, line.endMs);
        if (at < b.lo || at > b.hi) return refuse("end", b.lo, b.hi, "the transactions keep their order");
        return FlowMarkers.moveMarker(sides.end, iso(at), topics);
      }
      if (ms == null) return true;
      const at = origin + ms;
      if (!sides.start) {
        // The unmarked transaction ended: marked from the start of the video.
        if (at <= line.startMs + TE.MIN_SPAN_MS || at > line.endMs) return refuse("end", line.startMs + TE.MIN_SPAN_MS, line.endMs);
        return FlowMarkers.insertMarkers([{ type: "start", ts: iso(line.startMs) }, { type: "end", ts: iso(at) }], topics);
      }
      const lo = startMs + TE.MIN_SPAN_MS;
      const hi = Number.isFinite(untilMs) ? untilMs - (sides.next ? TE.MIN_SPAN_MS : 0) : Infinity;
      if (at < lo || at > hi) return refuse("end", lo, hi, sides.next ? "the next transaction starts at " + fmt(untilMs) : "");
      return FlowMarkers.insertMarker("end", iso(at), null, topics);
    }, null, "run:" + run.caseId + ":end");
  }
  return el;
}

function makeStep(name, startISO, endISO, eventIds, caseId) {
  return {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: caseId || null,
    name,
    description: "",
    // C16: a step added without a time has none (its `order` places it).
    time_range: startISO ? { start: startISO, end: endISO } : null,
    evidence: { interaction_event_ids: eventIds, screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    // Waste is the only per-step flag (ADR-0027): the retired ones are not
    // written.
    flags: { waste: false },
    phase_id: null,
  };
}

function nextStepName(steps) {
  let max = 0;
  for (const s of steps) {
    const m = /^Step (\d+)$/.exec(s.name || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "Step " + (max + 1);
}

/* G-4: "(split N)" suffixes are split-tool artifacts; they stack and then
   ride along into merged names ("X (split 1) (split 1) + Y" — the owner's
   real session). Strip them whenever a name is reused as a building block. */
function stripSplitSuffix(name) {
  return String(name || "").replace(/(\s*\(split \d+\))+/g, "").trim() || String(name || "").trim();
}

/* Fold an ordered list of steps into one. The first step's identity +
   metadata wins; the time range stretches to cover the last; evidence is
   concatenated. Shared by both merge entry points so they cannot diverge.
   The merged name dedupes the parts (merging "X (split 1)" + "X (split 2)"
   reads "X", not "X + X") and caps its length — a merge of long auto names
   must not produce a paragraph. The merged step is no longer one draft: it
   carries no draft_key, and when every member was drafted it keeps their
   keys in order as draft_keys (item 1), so it still matches the same drafts
   in the other runs. C17: it keeps the first member's condition and every
   member's links (commitMerge then points the links to the members at the
   merged step). */
function mergeStepObjects(toMerge) {
  const first = toMerge[0];
  const parts = [];
  for (const s of toMerge) {
    const n = stripSplitSuffix(s.name);
    if (n && !parts.includes(n)) parts.push(n);
  }
  let mergedName = parts.join(" + ") || stripSplitSuffix(first.name);
  if (mergedName.length > 120) mergedName = mergedName.slice(0, 119) + "…";
  const keys = RunsModel.mergedDraftKeys(toMerge);
  // C16: the timed members' span; with none timed, no time (the first
  // member's order keeps the place).
  const timedMembers = toMerge.filter((s) => AC.hasTime(s));
  const merged = RunsModel.dropDraftIdentity({
    ...first,
    name: mergedName,
    time_range: timedMembers.length ? { start: timedMembers[0].time_range.start,
      end: (timedMembers[timedMembers.length - 1].time_range.end || timedMembers[timedMembers.length - 1].time_range.start) } : null,
    evidence: {
      ...first.evidence,
      interaction_event_ids: toMerge.flatMap(s => (s.evidence && s.evidence.interaction_event_ids) || []),
      screenshot_refs: toMerge.flatMap(s => (s.evidence && s.evidence.screenshot_refs) || []),
    },
    // Steps the analyst added merge into an added step (lane FX2).
    state: AC.derivedState(toMerge),
  });
  if (keys) merged.draft_keys = keys;
  // C26: every member's lines, once each.
  StepInfo.putJoined(merged, toMerge);
  // C27: every member's exceptions, once each.
  StepExc.putJoined(merged, toMerge);
  const links = StepFlow.mergedLinks(toMerge);
  if (links.length) merged.links = links; else delete merged.links;
  return merged;
}

/* Item 2: a merge of drafts made in the pattern run is repeated on every
   other run's consecutive still-draft steps with the same keys; each carried
   merge takes the pattern step's name. It is part of the same edit (one
   Ctrl+Z) and not a fix of the pattern run. Each merged step's id goes into
   `idMap` (C17). Returns how many runs took it. */
function _carryMerge(anno, runs, model, merged, idMap) {
  const p = RunsModel.patternRun(anno, runs);
  if (!p.run || merged.case_id !== p.run.caseId || !merged.draft_keys) return 0;
  const stretches = RunsModel.carriedMerges(model, p.run.caseId, merged.draft_keys);
  for (const st of stretches) {
    const m = mergeStepObjects(st.steps);
    m.name = merged.name;
    const ids = new Set(st.steps.map((s) => s.step_id));
    for (const id of ids) idMap.set(id, m.step_id);
    anno.steps = anno.steps.filter((s) => !ids.has(s.step_id));
    anno.steps.push(m);
  }
  return RunsModel.runCount(stretches);
}

async function commitMerge(anno, toMerge, undoLabel) {
  const model = _model();
  // C19: below the main level the merged step takes the first step's place
  // in its list; the counter and the carry are the main level's.
  const loc = _locate(toMerge[0].step_id);
  const main = !loc || loc.depth === 0;
  if (main) RunsModel.recordFix(anno, model.runs, toMerge[0].case_id, "merge");
  const merged = mergeStepObjects(toMerge);
  const mergedIds = new Set(toMerge.map(s => s.step_id));
  if (main) {
    anno.steps = anno.steps.filter(s => !mergedIds.has(s.step_id));
    anno.steps.push(merged);
  } else {
    loc.list.splice(loc.list.indexOf(toMerge[0]), 0, merged);
    SPM.removeSteps(anno.steps, mergedIds);
  }
  const idMap = new Map([...mergedIds].map((id) => [id, merged.step_id]));
  const carriedRuns = main ? _carryMerge(anno, model.runs, model, merged, idMap) : 0;
  // Lane E-1: the screenshots added to a merged step go to the step it
  // became part of.
  for (const x of Array.isArray(anno.analyst_screenshots) ? anno.analyst_screenshots : []) {
    if (x && idMap.has(x.step_id)) x.step_id = idMap.get(x.step_id);
  }
  // C22: a step placed after a merged step comes after the step it became
  // part of.
  for (const st of SPM.allSteps(anno.steps)) {
    if (typeof st.placed_after === "string" && idMap.has(st.placed_after)) st.placed_after = idMap.get(st.placed_after);
    if (st.placed_after && st.placed_after === st.step_id) delete st.placed_after;
  }
  // C17: a link to a merged step goes to the step it became part of; one
  // between two steps of the same merge would point at its own step, so it
  // goes.
  const selfLinks = StepFlow.retargetLinks(anno.steps, idMap);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, undoLabel);
  return { merged, carriedRuns, selfLinks };
}

/* C22: why steps cannot be merged, "" when they can: one of them was placed
   elsewhere in the process and another step lies between them on the
   timeline, where a merged step runs from the first one's start to the last
   one's end. */
function _mergeApart(members) {
  const p = members[0] && _placeOf(members[0].step_id);
  if (!p || !members.some((m) => StepOrder.isPlaced(m, p.steps))) return "";
  const x = StepOrder.apartOnTimeline(members, p.steps);
  return x ? "These steps are apart on the Timeline (" + _quoted(x) + " lies between them), and a merged step runs from the " +
    "first one's start to the last one's end there. Put the step you placed elsewhere back to its time first, or copy what " +
    "it says into the other step's Description." : "";
}

/* The one-line toast of a merge that carried to other runs (item 2). */
function _carriedToast(carriedRuns) {
  return "Merged here and in " + _plural(carriedRuns, "other transaction", "other transactions") + ". Ctrl+Z undoes it.";
}

/* C17: a merge that dropped links between its own steps says so. */
function _selfLinksText(n) {
  return n ? " " + (n === 1 ? "A link between the merged steps was removed." : n + " links between the merged steps were removed.") : "";
}

/* P0.1: merge the clicked step with the NEXT step of the same run, the row
   below it in the list -- always, regardless of any multi-selection, and
   never across runs or with a step the list does not show. The
   selection-aware merge is a separate, explicitly-labelled action
   (mergeSelectedSteps) so one control never does two things on hidden state
   (the "merged the wrong pair" defect). */
async function mergeStepWithNext(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = _findStep(stepId);
  if (!step) { toast("Step not found", "error"); return; }
  const next = _nextRow(stepId);
  if (!next) { toast("This is the last step of its transaction: there is no next step to merge with.", "error"); return; }
  if (SPM.isSubProcess(step) || SPM.isSubProcess(next)) { toast(SUBPROCESS_NO_MERGE, "error"); return; }
  const toMerge = [step, next];
  const apart = _mergeApart(toMerge);
  if (apart) { toast(apart, "error"); return; }
  const firstCount = ((step.evidence && step.evidence.interaction_event_ids) || []).length;
  const r = await commitMerge(anno, toMerge, 'merge step with next');
  if (r && r.merged && firstCount) {
    _mergedLine = { stepId: r.merged.step_id, after: firstCount - 1 };
    renderStepsLevel();
  }
  toast((r.carriedRuns ? _carriedToast(r.carriedRuns) : 'Merged "' + toMerge[0].name + '" + "' + toMerge[1].name + '"') +
    _selfLinksText(r.selfLinks), "success");
}

/* P0.1: merge exactly the ticked steps (time order), the inverse of split for
   an arbitrary set. Acts on the user's actual selection -- never falls back
   to "next" -- and only within one run. */
async function mergeSelectedSteps() {
  if (!State.getSession()) return;
  const multi = State.getMultiSelectedStepIds();
  if (!multi || multi.size < 2) { toast("Tick 2+ steps to merge", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const ticked = SPM.allSteps(anno.steps).filter(s => multi.has(s.step_id));
  // Below the main level (C19) steps that start together keep their order.
  const toMerge = ticked.some((s) => (_locate(s.step_id) || {}).depth) ? SPM.inOrder(ticked) : ticked.sort(RunsModel.byStart);
  if (toMerge.length < 2) { toast("Select at least two steps to merge", "error"); return; }
  const blocks = new Set(toMerge.map((s) => { const c = _containerNow(s.step_id); return c ? c.key : null; }));
  if (new Set(toMerge.map((s) => s.case_id || null)).size > 1 || blocks.size > 1) {
    toast("Select steps from one transaction to merge them.", "error");
    return;
  }
  if (toMerge.some(SPM.isSubProcess)) { toast(SUBPROCESS_NO_MERGE, "error"); return; }
  // C22: in their process order, and never across the steps between them on
  // the timeline when one was placed elsewhere.
  const block = _containerNow(toMerge[0].step_id);
  if (block) toMerge.splice(0, toMerge.length, ...block.members.filter((s) => multi.has(s.step_id)));
  const apart = _mergeApart(toMerge);
  if (apart) { toast(apart, "error"); return; }
  const r = await commitMerge(anno, toMerge, 'merge selected steps');
  multi.clear();
  syncMultiSelectButtons();
  toast((r.carriedRuns ? _carriedToast(r.carriedRuns) : 'Merged ' + toMerge.length + ' steps into "' + r.merged.name + '"') +
    _selfLinksText(r.selfLinks), "success");
}

/* Keep the two multi-selection toolbar actions (delete / merge) in lockstep
   with the selection size, from one place so they cannot drift. They are
   HIDDEN until 2+ steps are ticked -- a permanently-disabled button is just
   noise in the toolbar (clutter pass); it appears only when it can be used. */
function syncMultiSelectButtons() {
  const n = State.getMultiSelectedStepIds().size;
  for (const id of ["btn-delete-selected-steps", "btn-merge-selected", "btn-group-selected"]) {
    const b = $("#" + id);
    if (b) b.hidden = n < 2;
  }
  // 2.0.1: the verbs on the ticked steps say how many they act on.
  const merge = $("#btn-merge-selected");
  if (merge && n >= 2) merge.textContent = "Merge " + n + " selected";
  const group = $("#btn-group-selected");
  if (group && n >= 2) group.textContent = "Group " + n + " into a sub-process…";
  const bar = $("#step-verbs");
  if (bar && n >= 2) bar.hidden = true;
  // Item 5: the ticked drafted steps are hidden, the added ones deleted; the
  // button says which.
  const del = $("#btn-delete-selected-steps");
  if (del && n >= 2) {
    const { hide, remove } = _removalSplit(State.getMultiSelectedStepIds());
    del.textContent = !remove.length ? "Hide selected" : !hide.length ? "Delete selected" : "Hide or delete selected";
    del.title = !remove.length ? "Hide the ticked steps: every analysis keeps them out"
      : !hide.length ? "Delete the ticked steps you added"
        : "Hide the ticked drafted steps and delete the ticked steps you added";
  }
}

/* The ticked steps split by what taking them out does (item 5): steps the
   analyst added are deleted, every other visible step is hidden. */
function _removalSplit(ids) {
  const s = State.getSession();
  const steps = SPM.allSteps((s && s.annotations && s.annotations.steps) || []).filter((x) => ids.has(x.step_id));
  return {
    hide: steps.filter((x) => x.state !== "manually_authored" && x.state !== "hidden"),
    remove: steps.filter((x) => x.state === "manually_authored"),
  };
}

/* "+ Add step" (C16): a step added by hand has no time (a time range is read
   as measured). It goes into the open run (else the implicit run of a
   session without a recording, else outside the runs), right after the
   selected step, or at the end; its `order` places it among the run's steps
   without a time, and (C22, 2.0.5) after a selected step that has a time it
   is placed right after that step, not after every step with a time. The
   Timeline's + Step places one at the video playhead. */
async function addManualStep() {
  if (!State.getSession() || RO.isReadOnly(State.getSession())) return;
  const name = await promptModal({ title: "Add step", message: "Name this step", placeholder: "For example: Search customer in CRM", okLabel: "Add step" });
  if (!name || !name.trim() || !State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  _addManualSteps(anno, [{ name: name.trim(), description: "" }]);
  await persistAnnotations(anno, 'add step');
  toast("Step added", "success");
}

/* The steps + Add step makes, into `anno` (not saved): `entries` ([{ name,
   description }]) one after another where + Add step puts one, each after
   the one before as if it had been selected (lane E1: Paste notes... makes
   many at once by this one rule). The last one made is selected; returns
   the steps made, in order. */
function _addManualSteps(anno, entries) {
  const model = _model();
  const path = _levelPath(model);
  const made = [];
  if (path.length) {
    for (const e of entries) {
      const s = _addSubStep(anno, model, path, e.name);
      if (!s) break;
      if (e.description) s.description = e.description;
      made.push(s);
    }
    return made;
  }
  const open = model.runs.find((r) => r.caseId === _ui.open);
  const caseId = open ? open.caseId : _ui.open === OUTSIDE ? null : AC.implicitRunId(State.getSession().stats);
  const members = (caseId ? ((model.runs.find((r) => r.caseId === caseId) || {}).members || []) : model.outside).slice();
  let after = members.find((s) => s.step_id === State.getSelectedStepId()) || null;
  for (const e of entries) {
    const step = makeStep(e.name, null, null, [], caseId);
    if (e.description) step.description = e.description;
    AC.placeUntimed(members, step, after);
    RunsModel.recordFix(anno, model.runs, caseId, "add");
    anno.steps.push(step);
    members.push(step);
    _placeNewAfter(step, after);
    made.push(step);
    after = step;
  }
  if (caseId && _ui.open !== caseId) _openGroup(caseId);
  if (made.length) State.setSelectedStepId(made[made.length - 1].step_id);
  return made;
}

/* Paste notes... (lane E1): one dialog takes the notes the analyst already
   has (notes-paste.js reads them: a line a step, the text after its first
   colon its description, a line that starts with a document field's name
   that field's text), says under the box what it will make, and OK makes
   it all as ONE undoable edit: the steps where + Add step puts one, in the
   order pasted, and the field texts after what the fields hold. The first
   new step is selected. */
async function pasteNotes() {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return;
  const NotesPaste = require("../notes-paste.js");
  const { DOC_FIELDS } = require("./overview-view.js");
  const read = (t) => NotesPaste.parseNotes(t, DOC_FIELDS);
  const text = await promptModal({
    title: "Paste notes",
    message: "Paste or type your notes: each line becomes a step, the text after its first colon its description.",
    detail: "A line that starts with a document field's name and a colon (Trigger:, Volume:) goes to that field. " +
      "A line indented under another adds to it. List marks and numbers are dropped.",
    multiline: true,
    placeholder: "Open the order mail: from the shared inbox\nFind the customer in SAP\nTrigger: an order arrives by mail",
    okLabel: "Add",
    preview: (t) => { const p = read(t); return { text: NotesPaste.summary(p), ok: p.steps.length + p.fields.length > 0 }; },
  });
  if (text == null || State.getSession() !== sess) return;
  const parsed = read(text);
  if (!parsed.steps.length && !parsed.fields.length) return;
  const anno = ensureAnnoShape(sess.annotations);
  const made = parsed.steps.length ? _addManualSteps(anno, parsed.steps) : [];
  if (parsed.fields.length) anno.document = NotesPaste.mergeDocument(anno.document, parsed.fields, DOC_FIELDS);
  if (made.length) State.setSelectedStepId(made[0].step_id);
  try {
    await persistAnnotations(anno, "paste notes");
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  // The Recents entry is named by the document title once it is written.
  if (parsed.fields.some((f) => f.key === "title")) {
    const base = String(sess.sessionFolder || "").split(/[\\/]/).filter(Boolean).pop() || "";
    require("../recent.js").pushRecent(sess.sessionFolder, require("../session-summary.js").recentLabel(sess, base));
  }
  toast("Added " + NotesPaste.summary(parsed) + ". Ctrl+Z takes it all back.", "success");
}

/* + Add step inside a sub-process (C19): a step without a time in the open
   visit, right after the selected step (in its list) or at the end of the
   visit; it belongs to the visit's transaction. Not a fix of the main level.
   (The Timeline's + Step puts one at the video's playhead, with its time,
   lane FX2.) */
function _addSubStep(anno, model, path, name) {
  const containers = _containers(model, path);
  const c = containers.find((x) => x.key === _ui.levelOpen) || containers[0];
  if (!c) return null;
  const sel = State.getSelectedStepId();
  const selLoc = sel && c.members.some((s) => s.step_id === sel) ? SPM.findStep(anno.steps, sel) : null;
  const parent = (selLoc && selLoc.parent) || c.parents[c.parents.length - 1];
  const step = makeStep(name, null, null, [], parent.case_id != null ? parent.case_id : null);
  AC.placeUntimed(parent.sub_steps, step, selLoc ? selLoc.step : null);
  parent.sub_steps.push(step);
  _placeNewAfter(step, selLoc ? selLoc.step : null);
  _ui.levelOpen = c.key;
  State.setSelectedStepId(step.step_id);
  return step;
}

/* C22: a step added without a time right after `after`, when `after` is
   ordered by a time or a placement (a step without one follows the steps
   without a time by its `order`): it is placed there. */
function _placeNewAfter(step, after) {
  if (!after || after.state === "hidden") return;
  const p = _placeOf(step.step_id);
  if (!p || !p.steps.includes(after)) return;
  if (!AC.hasTime(after) && !StepOrder.isPlaced(after, p.steps)) return;
  const order = StepOrder.processOrder(p.steps).filter((s) => s !== step);
  order.splice(order.indexOf(after) + 1, 0, step);
  StepOrder.deriveOrder(p.steps, order, { moved: step, canBeFree: _canBeFree(p.main, _model().runs) });
}

/* Move a step up (-1) or down (+1) among the steps its list shows (the step
   menu, Alt+Up and Alt+Down). Two steps without a time swap their `order`, as
   they always did; any other move is a move in the process (C22, 2.0.5: the
   owner's report, a correction the SME shows late in a video belongs early
   in the process): the step takes its new place there, and its band, its
   video and its time stay where they are on the Timeline. The fewest
   placements give the new order (step-order.js deriveOrder): a step moved
   back where its time puts it is no longer placed. */
async function moveStep(stepId, delta) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const anno = ensureAnnoShape(sess.annotations);
  const loc = _locate(stepId);
  const step = loc && loc.step;
  if (!step) return false;
  if (step.state === "hidden") { toast("A hidden step has no place in the process: unhide it first."); return false; }
  const model = _model();
  const key = RunsModel.groupKeyOf(step, model.runs);
  // C19: below the main level a step moves in the list that holds it.
  const members = loc.depth ? loc.list
    : key === OUTSIDE ? model.outside : (model.runs.find((r) => r.caseId === key) || {}).members;
  const p = _placeOf(stepId);
  const order = StepOrder.processOrder(p.steps);
  const i = order.indexOf(step), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) {
    toast(delta < 0 ? "It cannot move further up: it is first." : "It cannot move further down: it is last.");
    return false;
  }
  const other = order[j];
  const wasPlaced = StepOrder.isPlaced(step, p.steps);
  if (!AC.hasTime(step) && !AC.hasTime(other) && !wasPlaced && !StepOrder.isPlaced(other, p.steps)) {
    if (!AC.moveUntimed(members || [], step, delta, (s) => _ui.showHidden || s.state !== "hidden")) {
      toast(delta < 0 ? "It cannot move further up." : "It cannot move further down.");
      return false;
    }
  } else {
    const wanted = order.slice();
    wanted.splice(i, 1);
    wanted.splice(j, 0, step);
    for (const s of StepOrder.deriveOrder(p.steps, wanted, { moved: step, canBeFree: _canBeFree(p.main, model.runs) })) AC.markEdited(s);
  }
  try { await persistAnnotations(anno, delta < 0 ? "move step up" : "move step down"); } catch (_) { return false; }
  // The first move that takes a timed step away from its time says where
  // it stays.
  const now = _placeOf(stepId);
  if (now && !wasPlaced && AC.hasTime(step) && StepOrder.isPlaced(step, now.steps)) {
    toast("Moved in the process: on the Timeline it stays at " + sinceStart(step.time_range.start, recordingStartMs(sess)) +
      ", where it was shown. Back to its time, in its menu, puts it there again.", "success");
  }
  return true;
}

/* Alt+Up / Alt+Down on the Steps level: move the selected step when its row
   is on screen. Returns true when the key was used. */
function moveSelectedStep(delta) {
  const sid = visibleSelectedStepId();
  if (!sid) return false;
  const step = _findStep(sid);
  if (!step) return false;
  moveStep(sid, delta);
  return true;
}

/* The steps a step can be placed after (Place after a step...): at the main
   level each transaction's visible steps in their process order, its own
   transaction first, each list opened by "First in <transaction>"; below
   it, the steps of its own list. The step itself is left out. Groups for
   chooseModal: values "after:<step_id>" and "first:<case_id>". */
function _placeChoices(step) {
  const p = _placeOf(step.step_id);
  if (!p) return [];
  const origin = recordingStartMs(State.getSession());
  const item = (s, n) => ({ value: "after:" + s.step_id,
    label: n + ". " + (String(s.name || "").trim() || "(unnamed step)") + (AC.hasTime(s) ? " (" + sinceStart(s.time_range.start, origin) + ")" : ""),
    title: "Comes after this step" });
  if (!p.main) {
    const list = StepOrder.processOrder(p.steps);
    return [{ label: "In this sub-process", items: [{ value: "first:", label: "First in this sub-process" }]
      .concat(list.map((s, i) => [s, i + 1]).filter(([s]) => s !== step).map(([s, n]) => item(s, n))) }];
  }
  const runs = _model().runs;
  const own = runs.find((r) => r.caseId === _caseKey(step));
  const ordered = own ? [own].concat(runs.filter((r) => r !== own)) : runs;
  return ordered.map((r) => ({
    label: r.title + (r.label ? " · " + r.label : ""),
    items: [{ value: "first:" + r.caseId, label: "First in " + r.title }]
      .concat(r.visible.map((s, i) => [s, i + 1]).filter(([s]) => s !== step).map(([s, n]) => item(s, n))),
  }));
}

/* "Place after a step..." (C22, the step menu in Steps and on the
   Timeline, and the Flow line): the step comes right after the step chosen,
   in that step's transaction, or first in a transaction; its band and its
   time stay where they are on the Timeline. One undoable edit. */
async function placeStepAfterAction(stepId) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const step = _findStep(stepId);
  if (!step) return false;
  if (step.state === "hidden") { toast("A hidden step has no place in the process: unhide it first."); return false; }
  const p = _placeOf(stepId);
  const a = StepOrder.anchorOf(step, p.steps);
  const current = a === StepOrder.START ? "first:" + (p.main ? _caseKey(step) || "" : "")
    : a ? "after:" + a.step_id : (() => {
      const order = StepOrder.processOrder(p.steps), i = order.indexOf(step);
      return i > 0 ? "after:" + order[i - 1].step_id : "first:" + (p.main ? _caseKey(step) || "" : "");
    })();
  const at = AC.hasTime(step) ? sinceStart(step.time_range.start, recordingStartMs(sess)) : "";
  const choice = await chooseModal({
    title: "Place after a step",
    message: "In the process, " + _quoted(step) + " comes right after the step you choose." +
      (at ? " On the Timeline it stays at " + at + ", where it was shown." : ""),
    detail: "Choose a step of another transaction to move it there. Ctrl+Z undoes it.",
    listLabel: "The step it comes after",
    groups: _placeChoices(step), value: current, okLabel: "Place here",
  });
  if (!choice || !State.getSession()) return false;
  return placeStepAt(stepId, choice);
}

/* The step `stepId` placed where `choice` says ("after:<step_id>" or
   "first:<case_id>"). Exported for the Timeline's menu. */
async function placeStepAt(stepId, choice) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const anno = ensureAnnoShape(sess.annotations);
  const step = _findStep(stepId);
  const p = step && _placeOf(stepId);
  if (!p) return false;
  const m = /^(after|first):(.*)$/.exec(String(choice || ""));
  if (!m) return false;
  const anchor = m[1] === "after" ? _findStep(m[2]) : null;
  if (m[1] === "after" && (!anchor || anchor === step)) return false;
  const runs = _model().runs;
  const caseTo = !p.main ? _caseKey(step) : anchor ? _caseKey(anchor) : (m[2] || null);
  if (p.main && caseTo !== _caseKey(step)) {
    // It leaves its transaction: the steps after it there keep their place.
    for (const s of StepOrder.keepOrder(p.steps, [step.step_id], { canBeFree: _canBeFree(true, runs) })) AC.markEdited(s);
    step.case_id = caseTo;
  }
  const q = _placeOf(stepId);
  const order = StepOrder.processOrder(q.steps).filter((s) => s !== step);
  const k = anchor ? order.indexOf(anchor) + 1 : 0;
  if (anchor && k === 0) return false;
  order.splice(k, 0, step);
  for (const s of StepOrder.deriveOrder(q.steps, order, { moved: step, canBeFree: _canBeFree(q.main, runs) })) AC.markEdited(s);
  AC.markEdited(step);
  if (p.main) {
    const run = runs.find((r) => r.caseId === caseTo);
    if (caseTo && _ui.open !== caseTo && run) _openGroup(caseTo);
  }
  State.setSelectedStepId(step.step_id);
  try { await persistAnnotations(anno, "place the step"); } catch (_) { return false; }
  const where = anchor ? "after " + _quoted(anchor) : "first in its transaction";
  const at = AC.hasTime(step) ? sinceStart(step.time_range.start, recordingStartMs(sess)) : "";
  toast("Placed " + where + (at ? ". On the Timeline it stays at " + at + "." : ".") + " Ctrl+Z undoes it.", "success");
  return true;
}

/* "Back to its time" (C22), the inverse of a move in the process: the step
   goes where its time puts it, in the transaction its start is in (C9's
   rule), and the steps placed after it keep their place. One undoable
   edit. */
async function backToTimeAction(stepId) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return false;
  const anno = ensureAnnoShape(sess.annotations);
  const step = _findStep(stepId);
  const p = step && _placeOf(stepId);
  if (!p || !AC.hasTime(step)) return false;
  if (!StepOrder.isPlaced(step, p.steps)) { toast("It already is where its time puts it."); return false; }
  const runs = _model().runs;
  for (const s of StepOrder.keepOrder(p.steps, [step.step_id], { canBeFree: _canBeFree(p.main, runs) })) AC.markEdited(s);
  delete step.placed_after;
  if (p.main) {
    const run = RunsModel.runForRange(runs, Date.parse(step.time_range.start));
    step.case_id = run ? run.caseId : null;
    const key = run ? run.caseId : OUTSIDE;
    if (_ui.open !== key) _openGroup(key);
  }
  AC.markEdited(step);
  State.setSelectedStepId(step.step_id);
  try { await persistAnnotations(anno, "put the step back to its time"); } catch (_) { return false; }
  toast("Back where its time puts it, at " + sinceStart(step.time_range.start, recordingStartMs(sess)) + ". Ctrl+Z undoes it.", "success");
  return true;
}

/* Take the ticked steps out (item 5): the drafted ones are hidden (the next
   Analyze would draft a deleted one again), the ones the analyst added are
   deleted. One confirm for the whole set; Ctrl+Z restores them all. */
async function deleteSelectedSteps() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  let { hide, remove } = _removalSplit(new Set(ids));
  if (!hide.length && !remove.length) return;
  const what = [hide.length ? "hide " + _plural(hide.length, "drafted step", "drafted steps") : "",
    remove.length ? "delete " + _plural(remove.length, "step you added", "steps you added") : ""].filter(Boolean).join(" and ");
  // C19: a group taken out takes its steps with it.
  const inside = remove.filter((x) => x.group === true).reduce((n, g) => n + SPM.descendants(g).length, 0);
  const ok = await confirmModal({
    title: what.charAt(0).toUpperCase() + what.slice(1) + "?",
    message: "Take the " + (hide.length + remove.length) + " selected steps out: " + what + ".",
    detail: (inside ? "The sub-processes among them go with their " + _plural(inside, "step", "steps") +
      " (Dissolve sub-process keeps them). " : "") + "A hidden step stays out of every analysis. Ctrl+Z restores them all.",
    okLabel: !remove.length ? "Hide " + hide.length : !hide.length ? "Delete " + remove.length : "Hide and delete",
    danger: remove.length > 0,
  });
  if (!ok || !State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  ({ hide, remove } = _removalSplit(new Set(ids)));   // the live steps, after the dialog
  const runs = _model().runs;
  for (const s of hide.concat(remove)) {
    if (!_counts(s)) continue;
    const f = _removalFix(s.state);
    RunsModel.recordFix(anno, runs, s.case_id, f.kind, f.delta);
  }
  _handOver(hide.concat(remove).map((s) => s.step_id));
  RunsModel.hideSteps(hide);
  const removeIds = new Set(remove.map((s) => s.step_id));
  _dropAddedShots(anno, new Set(SPM.allSteps(remove).map((s) => s.step_id)));
  SPM.removeSteps(anno.steps, removeIds);
  // C17: the links that went to them go too, in the same edit.
  const dropped = StepFlow.dropLinksTo(anno.steps, hide.concat(remove).map((s) => s.step_id)).length;
  const idSet = new Set(ids);
  if (idSet.has(State.getSelectedStepId()) && !_ui.showHidden) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  await persistAnnotations(anno, what);
  syncMultiSelectButtons();
  toast([hide.length ? _plural(hide.length, "step", "steps") + " hidden" : "",
    remove.length ? _plural(remove.length, "step", "steps") + " deleted" : ""].filter(Boolean).join(", ") +
    (dropped ? ". " + _linksDroppedText(dropped, true) : ""), "success");
}

/* ===== Run verbs: confirm, use as pattern (C2, C3) ==================== */

async function confirmRunAction(caseId) {
  const session = State.getSession();
  if (!session) return;
  const anno = ensureAnnoShape(session.annotations);
  const model = _model();
  const run = model.runs.find((r) => r.caseId === caseId);
  if (!run) return;
  const r = RunsModel.confirmRun(anno, model.runs, caseId, new Date().toISOString());
  try { await persistAnnotations(anno, "confirm transaction"); } catch (_) { return; }   // already shown
  toast(run.title + " confirmed" +
    (r.converted ? ": " + _plural(r.converted, "drafted step", "drafted steps") + " accepted" : "") +
    ". Ctrl+Z undoes it.", "success");
}

/* "Undo confirm" (item 4; it read Reopen transaction until the owner's
   review), the inverse of Confirm run: the run's confirmed steps are drafts
   again, edited and added ones stay; on the pattern run the confirmation
   (and its probe line) goes until the run is confirmed again, and the
   draft-fix counts are kept. One edit, so Ctrl+Z confirms it again. */
async function reopenRunAction(caseId) {
  const session = State.getSession();
  if (!session) return;
  const anno = ensureAnnoShape(session.annotations);
  const model = _model();
  const run = model.runs.find((r) => r.caseId === caseId);
  if (!run) return;
  const r = RunsModel.reopenRun(anno, model.runs, caseId);
  if (!r.reopened && !r.patternReopened) return;
  try { await persistAnnotations(anno, "undo confirm"); } catch (_) { return; }   // already shown
  toast(run.title + " is no longer confirmed" +
    (r.reopened ? ": " + _plural(r.reopened, "step is a draft", "steps are drafts") + " again" : "") +
    ". Ctrl+Z confirms it again.", "success");
}

async function usePatternAction(caseId) {
  const session = State.getSession();
  if (!session) return;
  const anno = ensureAnnoShape(session.annotations);
  const model = _model();
  const run = model.runs.find((r) => r.caseId === caseId);
  if (!run) return;
  const cur = RunsModel.patternRun(anno, model.runs);
  if (cur.run && cur.run.caseId === caseId && cur.record) return;
  // Something to lose: the current pattern's count or its confirmation.
  const f = cur.record ? RunsModel.probeLine(session.stats, model.runs, cur.run, cur.record) : null;
  if (cur.record && cur.run && (cur.record.confirmed_at || (f && f.total > 0))) {
    const ok = await confirmModal({
      title: "Use " + run.title.toLowerCase() + " as the reference transaction?",
      message: cur.run.title + " is the reference transaction now. Its boundary fix count" +
        (cur.record.confirmed_at ? " and its confirmation are" : " is") + " replaced.",
      detail: "Ctrl+Z undoes it.",
      okLabel: "Use as reference transaction",
    });
    if (!ok) return;
  }
  RunsModel.usePattern(anno, model.runs, caseId);
  try { await persistAnnotations(anno, "use as reference transaction"); } catch (_) { return; }   // already shown
  toast(run.title + " is now the reference transaction. The boundary fix count starts at zero.", "success");
}

/* ===== Keyboard (renderer.js) ========================================= */

/* The selected step when its row is on screen in the list, else null. The
   Steps shortcuts act only on a step the analyst can see (RP-12: a shortcut
   once mutated a selection that was not on screen). */
function visibleSelectedStepId() {
  const sid = State.getSelectedStepId();
  return sid && _rowFor(sid) ? sid : null;
}

/* Up / Down (J / K): move the selection to the neighbouring row of the open
   group; with no row selected, to the first (Down) or last (Up) row. Returns
   false when the open group shows no rows. */
function moveSelection(delta) {
  const rows = [...document.querySelectorAll("#step-list .run-steps .step-row")];
  if (!rows.length) return false;
  const i = rows.findIndex((r) => r.dataset.stepId === State.getSelectedStepId());
  const j = i < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + delta));
  if (i !== j) {
    State.setSelectedStepId(rows[j].dataset.stepId);
    renderStepsLevel();
  }
  const row = _rowFor(State.getSelectedStepId());
  if (row) row.scrollIntoView({ block: "nearest" });
  return true;
}

/* Enter: rename the selected step (only when its row is on screen). */
function renameSelectedStep() {
  if (!visibleSelectedStepId()) return false;
  beginRenameOnSelected();
  return true;
}

/* Ctrl+Enter: confirm the open run, when it is on screen and has something
   to confirm. */
function confirmOpenRun() {
  // The open block, at any level (C19: a visit of the reference transaction
  // carries Confirm transaction too).
  const group = document.querySelector("#step-list .run-group.open");
  if (!group || !group.dataset.caseId || !group.querySelector('[data-act="confirm-run"]')) return false;
  confirmRunAction(group.dataset.caseId);
  return true;
}

/* ===== Sub-processes (contract C19) ===================================== */

/* Screenshot path -> the time it was taken (the recording's screenshot
   events): a drafted sub-step takes the parent's screenshots of its span. */
function _shotTimes() {
  const out = {};
  for (const ev of ((State.getSession() && State.getSession().events) || [])) {
    if (ev && ev.type === "system" && ev.data && typeof ev.data.path === "string") out[ev.data.path] = ev.timestamp;
  }
  return out;
}

/* Open as a sub-process (the step pane, the step menu): every visible
   occurrence of the step's node at its level, in every transaction, that has
   no sub-steps gets one drafted sub-step per recorded action; then the list
   shows the new level, at this step's visit. One undoable edit. */
async function openAsSubProcessAction(stepId) {
  const session = State.getSession();
  if (!session) return;
  const anno = ensureAnnoShape(session.annotations);
  const loc = _locate(stepId);
  if (!loc || SPM.isSubProcess(loc.step) || loc.step.state === "hidden") return;
  if (!_inTransaction(loc.step)) {
    toast("A step outside the transactions is not opened as a sub-process: bring it into a transaction first.", "error");
    return;
  }
  const model = _model();
  const node = mapNodeLabel(loc.step);
  // Lane FX2: the names this project's own sub-steps give their actions.
  const pattern = RunsModel.patternRun(anno, model.runs);
  const r = SPV.openAsSubProcess(_txs(model), loc.path, loc.step, _interactionsById(),
    { newId: cryptoRandomId, shotTimes: _shotTimes(),
      projectNames: SPV.projectActionNames(anno.steps, pattern.run ? pattern.run.caseId : null) });
  // The new level shows at once, open at this step's visit.
  State.setMapPath(loc.path.concat([node]));
  const next = _levelPath(_model());
  const c = _containers(_model(), next).find((x) => x.parents.some((p) => p.step_id === stepId));
  if (c) _ui.levelOpen = c.key;
  State.getMultiSelectedStepIds().clear();
  State.setSelectedStepId(null);
  try { await persistAnnotations(anno, "open as a sub-process"); } catch (_) { return; }   // already shown
  StepPanel.refresh();
  const where = RunsModel.runCount(r.steps);
  toast(r.subSteps
    ? "Opened as a sub-process" + (where > 1 ? " in " + _plural(where, "transaction", "transactions") : "") + ": " +
      _plural(r.subSteps, "step", "steps") + " drafted from the recorded actions. Ctrl+Z undoes it."
    : "Opened as a sub-process. Nothing was recorded in it: + Add step adds its steps.", "success");
}

/* Show a sub-process's level (its row's "▸ N sub-steps", the step pane, the
   step menu, the step panel), at the visit of that step. */
function openSubProcessAction(stepId) {
  const loc = _locate(stepId);
  if (!loc || !SPM.isSubProcess(loc.step)) return;
  goToLevel(loc.path.concat([mapNodeLabel(loc.step)]), { openAt: stepId });
}

/* Dissolve sub-process from its step (the step pane, the step menu). */
function dissolveStepAction(stepId) {
  const loc = _locate(stepId);
  if (!loc || !SPM.isSubProcess(loc.step)) return;
  return dissolveAction(loc.path, mapNodeLabel(loc.step));
}

/* Dissolve sub-process (C19), in every transaction, every occurrence of
   `node` at level `path`: a group gives its steps back in its place, an
   opened step drops its sub-steps (what the analyst added to them moves to
   the step). One confirm names what goes, when anything the analyst wrote
   does; the list then shows the level above. One undoable edit. */
async function dissolveAction(path, node) {
  const session = State.getSession();
  if (!session) return;
  const model = _model();
  const pattern = RunsModel.patternRun(session.annotations || {}, model.runs);
  const loss = SPV.dissolveLoss(_txs(model), path, node, _interactionsById());
  if (!loss.occurrences) return;
  const name = _levelName(model, pattern, path.concat([node]));
  if (loss.descriptions || loss.flow) {
    const lost = [loss.descriptions ? _plural(loss.descriptions, "description", "descriptions") + " you wrote" : "",
      loss.flow ? _plural(loss.flow, "flow setting", "flow settings") + " (Only when, Go to)" : ""].filter(Boolean).join(" and ");
    const ok = await confirmModal({
      title: "Dissolve the sub-process?",
      message: '"' + name + '" loses its ' + _plural(loss.subSteps, "step", "steps") +
        (loss.opened > 1 ? " in " + _plural(loss.opened, "transaction", "transactions") : "") + ", with " + lost + ".",
      detail: "The screenshots, notes, files and information you added to them move to the step. Ctrl+Z brings everything back.",
      okLabel: "Dissolve",
      danger: true,
    });
    if (!ok || !State.getSession()) return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const r = SPV.dissolve(anno, _txs(_model()), path, node);
  // Inside it (or deeper), the list goes up to where it was.
  const cur = State.getMapPath();
  if (cur.length > path.length && SPM.samePath(cur.slice(0, path.length + 1), path.concat([node]))) State.setMapPath(path);
  if (!_findStep(State.getSelectedStepId())) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  try { await persistAnnotations(anno, "dissolve a sub-process"); } catch (_) { return; }   // already shown
  StepPanel.refresh();
  toast((r.groups
    ? 'Dissolved: the steps of "' + name + '" are back where it was' + (r.groups > 1 ? ", in " + _plural(r.groups, "place", "places") : "")
    : 'Dissolved: "' + name + '" has no steps of its own any more') + ". Ctrl+Z undoes it.", "success");
}

/* The words for a Group that cannot be made. */
const GROUP_REFUSED = {
  none: "Tick the steps to group in the list.",
  places: "Tick steps of one transaction to group them.",
  hidden: "A hidden step is not grouped: untick it, or unhide it first.",
  few: "Tick two or more steps to group them.",
  gap: "Tick steps that follow one another to group them.",
  // C22: a sub-process runs from its first step's start to its last one's end.
  apart: "A step you placed elsewhere in the process is apart from the others on the timeline, and a sub-process runs from its first step to its last there: put it back to its time first, or group the steps without it.",
};

/* Group into a sub-process... (C19; the toolbar with two or more ticked
   steps, the step menu): the ticked steps, one after the other in one
   transaction at the level shown, move into a new sub-process named here,
   and every other stretch of the same steps in every transaction too. One
   undoable edit. */
async function groupSelectedAction() {
  const session = State.getSession();
  if (!session) return;
  const multi = State.getMultiSelectedStepIds();
  const ids = [...multi];
  let model = _model();
  const path = _levelPath(model);
  const check = SPV.groupCheck(_txs(model), path, ids);
  if (check.error) { toast(GROUP_REFUSED[check.error] || GROUP_REFUSED.none, "error"); return; }
  // Lane FX2: the prompt says exactly what will happen, counted before it does.
  const name = await promptModal({
    title: "Group into a sub-process",
    message: "Name the sub-process",
    detail: SPV.groupPromptText(check, ids.length) + " Ctrl+Z undoes it.",
    placeholder: "For example: Create the sales order",
    okLabel: "Group",
  });
  if (!name || !name.trim() || !State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const inter = _interactionsById();
  model = _model();
  const r = SPV.groupInto(anno.steps, _txs(model), _levelPath(model), ids, {
    name: name.trim(), newId: cryptoRandomId,
    sessionId: (session.manifest && session.manifest.session_id) || "",
    systemOf: (s) => SystemNames.whereOfStep(s, inter, _appNames()).system,
  });
  if (r.error) { toast(GROUP_REFUSED[r.error] || GROUP_REFUSED.none, "error"); return; }
  multi.clear();
  syncMultiSelectButtons();
  if (r.ticked) State.setSelectedStepId(r.ticked.step_id);
  try { await persistAnnotations(anno, "group into a sub-process"); } catch (_) { return; }   // already shown
  toast('Grouped into "' + name.trim() + '"' +
    (r.groups.length > 1 ? " here and in " + _plural(r.groups.length - 1, "other place", "other places") : "") +
    ". Ctrl+Z undoes it.", "success");
}

/* ===== Apps outside the process (step-noise denylist; the button read
   Leave apps out... until the owner's review) =====
   Apps the analyst ticks here are written to annotations.json under
   step_filters.ignored_processes; step_suggest.py drops their
   interactions before step suggestion. Saving analyzes the recording again
   by itself (AD-22), so the step list refreshes at once. */
function distinctSessionApps() {
  const counts = new Map();
  for (const ev of (State.getSession() && State.getSession().events) || []) {
    if (ev.type !== "interaction") continue;
    const proc = (ev.data && ev.data.process_name) || "(unknown)";
    counts.set(proc, (counts.get(proc) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([proc, n]) => ({ proc, count: n }))
    .sort((a, b) => b.count - a.count);
}

/* Lane FX3 (validation pass 3, F16): Apps outside the process leaves out
   the apps whose clicks and typing were recorded. A project without a
   recording (C16) has none, so it is not offered there; a recording without
   one click or field typed offers it disabled, with the reason. */
const NO_APPS = "No clicks or typing were recorded in this project, so there is no app to leave out.";
const APPS_TITLE = "Pick the apps that are not part of the process, such as Teams used during the call.";
function _syncAppsOutside(session) {
  const btn = $("#btn-ignored-apps");
  if (!btn) return;
  const apps = distinctSessionApps().length > 0;
  btn.style.display = apps || AC.hasRecording(session) ? "" : "none";
  btn.disabled = !apps;
  btn.title = apps ? APPS_TITLE : NO_APPS;
}

function openIgnoredAppsDialog() {
  if (!State.getSession()) { toast("Open a project first.", ""); return; }
  const apps = distinctSessionApps();
  if (!apps.length) {
    toast(NO_APPS, "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal modal-simple" role="dialog" aria-label="Apps outside the process">' +
      '<header class="modal-header"><h2>Apps outside the process</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close" aria-label="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta" style="margin-top:0">Tick the apps that are not part of the process you are mapping, for example Teams or Outlook used during the call, or the recorder itself. Their clicks and typing are left out of the steps and the map. Saving analyzes the project again.</p>' +
        '<div id="ia-list" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button id="ia-cancel">Cancel</button>' +
        '<button id="ia-save" class="primary">Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  const list = backdrop.querySelector("#ia-list");
  const names = _appNames();
  // Lane FX2: each app is named by the business systems it stands for here
  // (Salesforce, not Google Chrome), the app beside them when its own name
  // differs (ticking it leaves all of it out).
  const systems = SystemNames.appSystems((State.getSession() || {}).events, names);
  list.innerHTML = apps.map((a) => {
    const checked = current.has(a.proc.toLowerCase()) ? " checked" : "";
    const app = readableApp(a.proc, names) || a.proc;
    const sys = systems[a.proc] || [];
    const label = sys.length ? sys.join(", ") : app;
    return '<label class="cb" style="display:flex;gap:8px;padding:5px 4px;align-items:center" title="' + escapeAttr(a.proc) + '">' +
      '<input type="checkbox" data-proc="' + escapeHtml(a.proc) + '"' + checked + ' />' +
      '<span style="flex:1"><span class="ia-system">' + escapeHtml(label) + "</span>" +
        (sys.length && !sys.includes(app) ? ' <span class="meta ia-app">(' + escapeHtml(app) + ")</span>" : "") + "</span>" +
      '<span class="meta">' + a.count + ' interactions</span>' +
      '</label>';
  }).join("");

  // Lane A-2: a dialog keeps the keyboard (modals.js holdFocus): Tab stays
  // inside, Escape closes it, and the focus goes back to what opened it.
  const releaseFocus = holdFocus(backdrop.querySelector(".modal"));
  function close() { backdrop.remove(); releaseFocus(); }
  backdrop.querySelector("#ia-close").addEventListener("click", close);
  backdrop.querySelector("#ia-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  setTimeout(() => { const first = list.querySelector("input[type=checkbox]") || backdrop.querySelector("#ia-save"); if (first) first.focus(); }, 0);

  backdrop.querySelector("#ia-save").addEventListener("click", async () => {
    const picked = Array.from(list.querySelectorAll("input[type=checkbox]"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.proc);
    anno.step_filters.ignored_processes = picked;
    // Settings change -- written directly (not via the undo stack), through
    // the one write path (RP-04): a failed save has already been shown as an
    // error, so keep the dialog open and do not re-analyze.
    try {
      await Session.saveAnnotationsDirect(anno, "apps outside the process");
    } catch (_) {
      return;
    }
    close();
    toast(picked.length
      ? "Leaving " + _plural(picked.length, "app", "apps") + " out."
      : "No app is left out.", "success");
    // The steps depend on it: the analysis runs by itself (the status line
    // in the top bar says so), and the step list follows.
    analyze();
  });
}

/* Wire the Steps surface. deps = { ensureAnnoShape, persistAnnotations,
   jumpToStepInFlow, watchStep, analyze }. Call once at
   boot. */
function initStepsView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  jumpToStepInFlow = deps.jumpToStepInFlow;
  watchStep = deps.watchStep || (() => {});
  analyze = deps.analyze || (async () => false);

  if ($("#btn-add-manual-step")) $("#btn-add-manual-step").addEventListener("click", addManualStep);
  // Lane E1: the analyst's notes, in one paste.
  if ($("#btn-paste-notes")) $("#btn-paste-notes").addEventListener("click", pasteNotes);
  // 2.0.1: the toolbar's verbs on the selected step (_syncStepVerbs).
  const onSelected = (id, fn) => {
    const b = $("#" + id);
    if (b) b.addEventListener("click", () => { const sid = visibleSelectedStepId(); if (sid) fn(sid); });
  };
  onSelected("btn-step-split", beginSplit);
  onSelected("btn-step-merge", mergeStepWithNext);
  onSelected("btn-step-hide", toggleStepHidden);
  onSelected("btn-step-make-sub", openAsSubProcessAction);
  onSelected("btn-step-open-sub", openSubProcessAction);
  onSelected("btn-step-dissolve", dissolveStepAction);
  onSelected("btn-step-delete", deleteStep);
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-merge-selected")) $("#btn-merge-selected").addEventListener("click", mergeSelectedSteps);
  if ($("#btn-group-selected")) $("#btn-group-selected").addEventListener("click", groupSelectedAction);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
  // The divider between the transactions and the selected step.
  if ($("#steps-splitter")) PaneSplitter.wire($("#steps-splitter"));
}

/* A run's right-click menu (P3.8): on another run "Use as reference run",
   the once-a-session choice; on the confirmed reference run its probe line.
   items = [{ act, label, title, run }]. The same inline-styled menu as the
   step menu below. */
function _runMenu(items, x, y) {
  const prior = document.getElementById("run-ctx-menu");
  if (prior) prior.remove();
  const menu = document.createElement("div");
  menu.id = "run-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);min-width:180px;max-width:560px;cursor:default;user-select:none;";
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    // A press ON the menu is a choice, not a dismissal (the Flow menus' rule).
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    close();
  };
  for (const it of items) {
    const item = document.createElement("div");
    item.dataset.act = it.act;
    item.textContent = it.label;
    item.title = it.title;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => { item.style.background = "var(--accent)"; });
    item.addEventListener("mouseleave", () => { item.style.background = ""; });
    item.addEventListener("click", async () => { close(); await it.run(); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  placeMenu(menu, x, y);   // at (x, y), kept inside the window
  // At once: the right-click's own mousedown came before its contextmenu
  // event, and an Escape pressed right away must close the menu.
  document.addEventListener("mousedown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
}

function showRunContextMenu(caseId, x, y) {
  _runMenu([{ act: "use-pattern", label: "Use as reference transaction",
    title: "Make this the transaction you confirm, the one the others are compared with.",
    run: () => usePatternAction(caseId) }], x, y);
}

/* Lane HV: the step menu's items a hand-off opened read only keeps. */
const READ_ONLY_ITEMS = new Set(["Open sub-process", "Show on timeline", "Play"]);

/* A5: right-click context menu for a step, from its list row. Mirrors the
   inline-styled menu pattern used by the Flow timeline (flow-view.js
   showMarkerInsertMenu) for visual consistency. The step is revealed first
   (its run opens), so every item acts on a step the list shows. */
function showStepContextMenu(stepId, x, y) {
  const prior = document.getElementById("step-ctx-menu");
  if (prior) prior.remove();
  const session = State.getSession();
  const step = session ? _findStep(stepId) : null;
  if (!step) return;
  _selectAndReveal(stepId);

  const menu = document.createElement("div");
  menu.id = "step-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);min-width:210px;cursor:default;user-select:none;";

  // Lane HV: in a hand-off opened read only, only the items that look at
  // the step are offered.
  const ro = RO.isReadOnly(session);
  function addItem(label, handler) {
    if (ro && !READ_ONLY_ITEMS.has(label)) return;
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => { item.style.background = "var(--accent)"; });
    item.addEventListener("mouseleave", () => { item.style.background = ""; });
    item.addEventListener("click", async () => { menu.remove(); await handler(); });
    menu.appendChild(item);
  }
  function addSep() {
    if (ro) return;
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;margin:4px 0;background:var(--rule);";
    menu.appendChild(sep);
  }

  const isSub = SPM.isSubProcess(step);
  // C19: a sub-process opens and dissolves; it is not split or merged.
  if (isSub) {
    addItem("Open sub-process", () => openSubProcessAction(stepId));
    addItem("Dissolve sub-process", () => dissolveStepAction(stepId));
  } else {
    // Lane FX3 (F16): offered only on a step with two recorded actions to
    // split between, in the analyst's words.
    if (!PdtSteps.splitBlocker(step)) {
      addItem("Split at a recorded action…", () => beginSplit(stepId));
    }
    addItem("Merge with next", () => mergeStepWithNext(stepId));
  }
  // P0.1: the selection-aware merge is a distinct item, shown only when a
  // multi-selection exists -- so its label can name the count it acts on.
  const _multiSel = State.getMultiSelectedStepIds();
  if (_multiSel && _multiSel.size >= 2) {
    addItem("Merge " + _multiSel.size + " selected steps", () => mergeSelectedSteps());
    addItem("Group " + _multiSel.size + " selected steps into a sub-process…", () => groupSelectedAction());
  }
  if (!isSub && step.state !== "hidden" && _inTransaction(step) && !_oneAction(step)) {
    addItem("Open as a sub-process", () => openAsSubProcessAction(stepId));
  }
  addItem("Rename", () => { renderStepsLevel(); setTimeout(() => beginRenameOnSelected(), 30); });
  // C16: a step moves among its run's steps (Alt+Up, Alt+Down); C22: a step
  // with a time moves in the process, its band staying where it is on the
  // Timeline, and Place after a step... takes it further.
  if (step.state !== "hidden") {
    addItem("Move up", () => moveStep(stepId, -1));
    addItem("Move down", () => moveStep(stepId, 1));
    addItem("Place after a step…", () => placeStepAfterAction(stepId));
    const placeAt = _placeOf(stepId);
    if (AC.hasTime(step) && placeAt && StepOrder.isPlaced(step, placeAt.steps)) addItem("Back to its time", () => backToTimeAction(stepId));
  }
  addItem(step.state === "hidden" ? "Unhide" : "Hide step", () => toggleStepHidden(stepId));
  addItem("Show on timeline", () => {
    const s = _findStep(stepId);
    if (s) jumpToStepInFlow(s);
  });
  if (session && session.recordingAvailable) {
    // Lane A-2: one name per act (it read "Watch").
    addItem("Play", () => {
      const s = _findStep(stepId);
      if (s) watchStep(s);
    });
  }
  // C25: the step editor's No longer needed (the waste flag), and its inverse.
  addSep();
  const notNeeded = StepScope.isNotNeeded(step);
  addItem(notNeeded ? "Mark as needed" : "Mark as no longer needed",
    () => setNotNeededAction(stepId, !notNeeded));

  document.body.appendChild(menu);
  placeMenu(menu, x, y);   // at (x, y), kept inside the window
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    // A press ON the menu is a choice, not a dismissal (the Flow menus' rule).
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  // At once, as the transaction menu does (_runMenu): the right-click's own
  // mousedown came before its contextmenu event, and an Escape pressed right
  // away must close the menu (lane FX3: armed a moment later, an early
  // Escape left it open over the list).
  document.addEventListener("mousedown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
  renderStepsLevel();   // reflect the new selection immediately
}

/* Lane PANE: what the Timeline's pane (views/timeline-pane.js) lists and
   offers, read as Steps reads it: the runs model, the reference transaction,
   and whether Confirm transaction and Undo confirm show (_runGroupEl's
   rules, the transaction open or not). */
function paneProject() {
  const sess = State.getSession();
  const model = _model();
  const pattern = RunsModel.patternRun((sess && sess.annotations) || {}, model.runs);
  const run = pattern.run || null;
  const rec = pattern.record || null;
  const ro = RO.isReadOnly(sess);
  const reads = !!run && RunsModel.patternConfirmed(rec, run);
  return {
    model, pattern, refCaseId: run ? run.caseId : null, implicitId: AC.implicitRunId(sess && sess.stats),
    canConfirm: !ro && !!run && !reads && RunsModel.holdsDraft(run.members) && run.visible.length > 0,
    canUndoConfirm: !ro && !!run && RunsModel.canReopen(run, rec, true),
  };
}

/* The titles of Steps' own acts, for the pane's buttons of the same acts. */
const ACT_TITLES = {
  confirm: "Accept this transaction's remaining drafted steps as they are (Ctrl+Enter).",
  undoConfirm: UNDO_CONFIRM_TITLE,
};

module.exports = {
  // Lane PANE: the Timeline's pane draws and edits a step with the editor's
  // own code, and offers Steps' own acts.
  renderStepInto, stepVerbStates, applyVerbState, paneProject, ACT_TITLES, confirmRunAction, reopenRunAction,
  beginSplit, toggleStepHidden, runTimesEl: (run) => _runTimesEl(run), isStepOpen: (s) => _stepOpen(s),
  initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep, pasteNotes,
  deleteSelectedSteps, deleteStep, splitStep, mergeStepWithNext, mergeSelectedSteps,
  addStepAtTimestamp, setStepTimes,
  // Lane E (E5): "<step>" starts here, on the Timeline.
  showHereTarget, showStepAt, stepsInProcessOrder,
  // Lane E-1: the step panel edits a step with the editor's own handlers.
  panelFieldCallbacks,
  // C22: a step's place in the process (the Timeline's band menu).
  placeStepAfterAction, placeStepAt, backToTimeAction, placedText,
  // C19: the level shown, and the way into a sub-process (the step panel).
  goToLevel, openSubProcessAction,
  // Keyboard: act only on what the list shows (RP-12).
  visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun, moveSelectedStep, moveStep,
  // G-4 label hygiene -- pure, exported for unit testing.
  stripSplitSuffix, mergeStepObjects,
};
