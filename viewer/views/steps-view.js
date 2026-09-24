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
 * draft_key remembers the name (main-process store, passed as --names on
 * every Analyze) and names the same-key drafts of the session at once.
 *
 * Lane L12b: a merge made in the pattern run carries to the same consecutive
 * drafts of the other runs (one undo), and a draft hidden there can be hidden
 * in all runs (a toast offers it). Every run is compared with its reference,
 * the pattern run or, while no pattern run is confirmed, the saved process
 * matched on open (run-differences.js, the algorithm the PDD's section 6.1
 * uses): an open run lists its differences, a run's meta counts them. Reopen
 * run takes Confirm run back; a drafted step is hidden, never deleted (the
 * next Analyze would draft it again); Save as this process stores the
 * confirmed pattern run, and the comparison line can forget a saved process;
 * the Remembered names dialog renames or forgets a remembered name.
 *
 * The model is runs-model.js (pure, unit-tested); this module renders it and
 * owns the step verbs (rename / save / split / merge / hide / delete / add /
 * bulk hide or delete / confirm run / reopen run / use as pattern / save as
 * this process) and the ignored-apps and remembered-names dialogs.
 * Cross-surface helpers (ensureAnnoShape, persistAnnotations,
 * jumpToStepInFlow, watchStep) are injected by
 * renderer.js via initStepsView().
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, cryptoRandomId, toast, placeMenu, recordingStartMs } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Session = require("../session.js");
const Ipc = require("../ipc.js");
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
const { processLabel, mapNodeLabel } = require("../process-map-levels.js");

const OUTSIDE = RunsModel.OUTSIDE;

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let jumpToStepInFlow = () => {};
let watchStep = () => {};
let analyze = async () => false;

/* A2: the analyst-chosen split boundary for the currently-selected step --
   { stepId, index } where index means "split AFTER this interaction". Null
   index when no boundary is picked (Split then falls back to the midpoint). */
let _splitAfter = { stepId: null, index: null };

/* The runs view's own state, per session folder: `open` is the group whose
   steps show (a run's case_id, OUTSIDE, or null for none; undefined until
   the first render opens the pattern run) and `showHidden` also lists the
   hidden steps of the open group. It survives level switches and a
   re-analysis of the same session (case ids are stable, C9), so a return to
   Steps finds the view as the analyst left it. `compare` is the saved process
   matched when the session opened ({ process, score }, C5) and
   `compareStopped` the analyst's Stop comparing. */
function _freshUi(folder) {
  return { folder, open: undefined, showHidden: false, compare: null, compareStopped: false };
}
let _ui = _freshUi(null);

/* Each session open starts one saved-process match; a later answer for a
   session that is no longer open is dropped. */
let _compareSeq = 0;

/* The remembered names (C4) behind the name suggestions: read from the main
   process once, then updated in place after each name is remembered. */
let _remembered = {};
let _rememberedLoad = null;

/* The one datalist the step name inputs (detail and inline rename) share. */
const NAME_LIST_ID = "step-name-suggestions";

/* The step the detail pane shows, so a redraw of the same step keeps the
   field being typed in. */
let _detailStepId = null;

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

function _findStep(stepId) {
  const s = State.getSession();
  return ((s && s.annotations && s.annotations.steps) || []).find((x) => x.step_id === stepId) || null;
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
  if (_ui.open === key) return;
  _ui.open = key;
  State.getMultiSelectedStepIds().clear();
  const s = _findStep(State.getSelectedStepId());
  if (s && (key == null || RunsModel.groupKeyOf(s, _model().runs) !== key)) State.setSelectedStepId(null);
  _markOpened(key);
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
  if (!anno || typeof caseId !== "string" || caseId === OUTSIDE) return;
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

/* Select a step and make sure it is on screen: its group opens, and hidden
   steps show when it is hidden. Used by the step context menu. */
function _selectAndReveal(stepId) {
  const s = _findStep(stepId);
  if (!s) return;
  _openGroup(RunsModel.groupKeyOf(s, _model().runs));
  if (s.state === "hidden") _ui.showHidden = true;
  State.setSelectedStepId(stepId);
}

function _ensureRememberedLoaded() {
  if (_rememberedLoad) return _rememberedLoad;
  _rememberedLoad = Promise.resolve()
    .then(() => Ipc.readRememberedNames())
    .then((r) => {
      if (r && r.ok) _remembered = r.names || {};
      else if (r && r.error) console.warn("[steps] the remembered names could not be read: " + r.error);
    })
    .catch((e) => console.warn("[steps] the remembered names could not be read:", e && e.message));
  return _rememberedLoad;
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

/* Fill the shared name datalist for `step` (C4 read side): remembered names
   of the same app, then the names already used in this session. */
function _fillNameList(step, interactionsById) {
  const s = State.getSession();
  const names = RunsModel.nameSuggestions((s && s.annotations && s.annotations.steps) || [], step,
    _remembered, interactionsById || _interactionsById());
  _nameListEl().innerHTML = names.map((n) => '<option value="' + escapeAttr(n) + '"></option>').join("");
}

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* ===== Saved processes on open, and what the runs are compared with ===== */

/* Match the session just opened with the saved processes (C5), when no
   pattern run of it is confirmed. The store is read in the main process, so
   this is asynchronous: the view renders again when a match arrives. A store
   that cannot be read is shown as an error, and the session is then not
   compared with a saved process. */
function _startCompareMatch(session) {
  const seq = ++_compareSeq;
  const folder = session.sessionFolder;
  const anno = session.annotations || {};
  const p = RunsModel.patternRun(anno, RunsModel.buildRuns(session.stats, anno.steps || []).runs);
  if (p.record && p.record.confirmed_at) return;
  const fail = (why) => toast("The saved processes could not be read, so this project is not compared with one: " + why, "error");
  Promise.resolve()
    .then(() => Ipc.readProcesses())
    .then((r) => {
      const cur = State.getSession();
      if (seq !== _compareSeq || !cur || cur.sessionFolder !== folder || _ui.folder !== folder) return;
      if (!r || !r.ok) { fail((r && r.error) || "no reason was given"); return; }
      const m = RunDiff.matchSavedProcess(r.processes || [], (cur.annotations && cur.annotations.steps) || []);
      if (!m) return;
      _ui.compare = m;
      renderStepsLevel();
    })
    .catch((e) => fail((e && e.message) || String(e)));
}

/* What the runs are compared with: the saved process matched on open, while
   no pattern run is confirmed and the analyst has not stopped comparing (then
   every run is compared with it); else the pattern run (every other run is
   compared with it). Null without a pattern run. */
function _reference(pattern) {
  const confirmed = !!(pattern.record && pattern.record.confirmed_at);
  if (_ui.compare && !_ui.compareStopped && !confirmed) {
    const pr = _ui.compare.process;
    return { kind: "saved", name: String(pr.name || ""), steps: Array.isArray(pr.steps) ? pr.steps : [],
      noun: RunDiff.SAVED_REFERENCE, caseId: null };
  }
  if (pattern.run) {
    return { kind: "pattern", steps: pattern.run.visible, noun: RunDiff.REFERENCE_RUN, caseId: pattern.run.caseId };
  }
  return null;
}

/* A run's differences from the reference (item 3), or null for the pattern
   run itself and without a reference. */
function _runDiffs(ref, run) {
  if (!ref || (ref.kind === "pattern" && run.caseId === ref.caseId)) return null;
  return RunDiff.differences(ref.steps, run.visible, { reference: ref.noun, unit: RunDiff.RUN_UNIT });
}

/* Stop comparing (the inverse of the comparison on open): the runs are
   compared with this session's pattern run for as long as it stays open. */
function stopComparingAction() {
  _ui.compareStopped = true;
  renderStepsLevel();
  toast("Stopped comparing: the transactions are compared with the reference transaction.", "success");
}

/* ===== The Steps level ================================================== */

function renderStepsLevel() {
  const session = State.getSession();
  if (!session || !PdtSteps) return;
  if (_ui.folder !== session.sessionFolder) {
    _ui = _freshUi(session.sessionFolder);
    _startCompareMatch(session);
  }
  _ensureRememberedLoaded();
  const anno = session.annotations || {};
  const allSteps = anno.steps || [];
  const interactionsById = _interactionsById();
  const model = RunsModel.buildRuns(session.stats, allSteps);
  const pattern = RunsModel.patternRun(anno, model.runs);
  const ref = _reference(pattern);

  // A Flow request to show the step at a moment ("Jump to step here"):
  // select the step containing it, else the nearest one, so a right-click in
  // a gap between steps still lands on a step.
  const pendingTs = State.consumePendingStepJump();
  if (pendingTs) {
    const targetMs = new Date(pendingTs).getTime();
    if (isFinite(targetMs) && allSteps.length) {
      let best = null, bestDist = Infinity;
      for (const s of allSteps) {
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
  // An ARRIVAL (Open in Steps, a jump, or a return to Steps with a surviving
  // selection) reveals the selected step: its group opens and, when it is
  // hidden, the hidden steps show; the row is scrolled into view below. The
  // one-shot flag is consumed here, so a later incidental re-render never
  // scrolls.
  const arriveReveal = State.consumePendingStepReveal();
  const revealStep = (pendingTs || arriveReveal) ? _findStep(State.getSelectedStepId()) : null;
  if (revealStep) {
    const key = RunsModel.groupKeyOf(revealStep, model.runs);
    if (_ui.open !== key) { _ui.open = key; State.getMultiSelectedStepIds().clear(); _markOpened(key); }
    if (revealStep.state === "hidden") _ui.showHidden = true;
  }
  const openIsGone = _ui.open === undefined ||
    (_ui.open === OUTSIDE ? !model.outside.length
      : _ui.open !== null && !model.runs.some((r) => r.caseId === _ui.open));
  if (openIsGone) _ui.open = _defaultOpen(model, pattern);
  // "Show hidden steps" lasts while the open group has hidden steps; with
  // none left (the last one unhidden, another group opened) it switches off,
  // so a step hidden later leaves the list as expected.
  const openMembers = _ui.open === OUTSIDE ? model.outside
    : ((model.runs.find((r) => r.caseId === _ui.open) || {}).members || []);
  if (!openMembers.some((s) => s.state === "hidden")) _ui.showHidden = false;

  const visible = RunsModel.groupSteps(model, _ui.open, _ui.showHidden);
  const visibleIds = new Set(visible.map((s) => s.step_id));
  // Ticks only ever stand on rows the analyst can see (RP-12).
  const multi = State.getMultiSelectedStepIds();
  for (const id of [...multi]) if (!visibleIds.has(id)) multi.delete(id);
  syncMultiSelectButtons();

  const pc = $("#runs-pane-count");
  if (pc) pc.textContent = String(model.runs.length);
  const pn = $("#runs-pane-note");
  if (pn) pn.textContent = transactionNote(session);
  _renderFlagSummary(allSteps);

  renderRunsList($("#step-list"), model, pattern, visible, session.stats, ref);

  const selId = State.getSelectedStepId();
  const selected = selId && visibleIds.has(selId) ? allSteps.find((s) => s.step_id === selId) : null;
  const title = $("#step-detail-title");
  // The name or the description being typed in keeps what was typed and the
  // cursor across a redraw (an autosave redraws the pane); leaving the field
  // then saves it, as always.
  const detail = $("#step-detail");
  const active = document.activeElement;
  const typing = selected && detail && active && detail.contains(active) && _detailStepId === selected.step_id &&
    (active.id === "step-name" || active.id === "step-desc" || active.id === "step-system" ||
      active.id === "step-only-when" || /^flow-link-when-\d+$/.test(active.id))
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  if (selected) {
    if (title) title.textContent = "Selected step";
    _fillNameList(selected, interactionsById);
    PdtSteps.renderStepDetail(detail, selected, stepDetailCallbacks(selected, interactionsById));
    _detailStepId = selected.step_id;
    const el = typing && document.getElementById(typing.id);
    if (el) {
      if (el.value !== typing.value) el.value = typing.value;
      el.focus();
      try { el.setSelectionRange(typing.start, typing.end); } catch (_) { /* not a text field */ }
    }
    // V2 item 4: the step panel beside the list follows the selected row.
    if (State.getLevel() === "steps") StepPanel.followSteps(selected);
  } else {
    _detailStepId = null;
    renderRunGuide(detail, model, pattern, ref);
  }

  if (revealStep && visibleIds.has(revealStep.step_id)) {
    setTimeout(() => {
      const row = _rowFor(revealStep.step_id);
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
}

/* What a transaction is, in the one line under the list's title (AD-29):
   in a recording the SME marks each one with the transaction key; a project
   without a recording (C16, manifest.source video or blank) is one
   transaction until the Timeline marks where each one starts. Pure. */
const NOTE_RECORDED = "One pass through the process: the SME presses the transaction key at the start of each.";
const NOTE_UNRECORDED = "The whole project is one transaction until you mark where each one starts on the Timeline.";
const NOTE_UNRECORDED_MARKED = "One pass through the process: each starts where you marked it on the Timeline.";
function transactionNote(session) {
  const m = (session && session.manifest) || {};
  const recorded = ((session && session.events) || []).length > 0 || !["video", "blank"].includes(m.source);
  if (recorded) return NOTE_RECORDED;
  return AC.implicitRunId(session && session.stats) || !((session && session.stats) || {}).case_stats
    ? NOTE_UNRECORDED : NOTE_UNRECORDED_MARKED;
}

/* A3: the waste-flagged step count on the toolbar. Waste is the only per-step
   flag (ADR-0027); the retired flags an older annotations.json may still
   carry are ignored here like everywhere else (C10). */
function _renderFlagSummary(allSteps) {
  const sumEl = $("#steps-summary");
  if (!sumEl) return;
  const waste = allSteps.filter((st) => st.flags && st.flags.waste).length;
  sumEl.textContent = waste ? "Flagged: " + waste + " waste" : "";
}

/* The list pane: the saved-process comparison line (when the runs are
   compared with a saved process), the runs (the open one with its steps),
   then the steps outside runs. */
function renderRunsList(host, model, pattern, visible, stats, ref) {
  if (!host) return;
  host.innerHTML = "";
  if (ref && ref.kind === "saved") {
    const line = document.createElement("div");
    line.className = "runs-compare";
    line.innerHTML = '<span class="runs-compare-text">Compared with saved process <strong>' + escapeHtml(ref.name) + "</strong></span>";
    line.appendChild(_actionBtn("stop-comparing", "Stop comparing", "",
      "Compare the transactions with this project's reference transaction instead", stopComparingAction));
    line.appendChild(_actionBtn("forget-process", "Forget this saved process", "",
      "Remove this saved process from this computer. The toast's Undo brings it back.", forgetProcessAction));
    host.appendChild(line);
  }
  if (!model.runs.length && !model.outside.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
        "<p><strong>No steps yet.</strong></p>" +
        "<p>Steps appear once the recording is analyzed: the app drafts each transaction's steps from it.</p>" +
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

const PATTERN_TITLE = "The reference transaction: confirm it. Its step names carry over to the other transactions, which are compared with it.";
const OTHER_RUN_TITLE = "Right-click to use this transaction as the reference transaction";

function _groupHead(isOpen, innerHtml, titleAttr) {
  return '<div class="run-row" role="button" tabindex="0" aria-expanded="' + (isOpen ? "true" : "false") + '"' +
    (titleAttr ? ' title="' + escapeAttr(titleAttr) + '"' : "") + ">" +
    '<span class="run-caret" aria-hidden="true">' + (isOpen ? "▾" : "▸") + "</span>" + innerHtml + "</div>";
}

function _wireHead(group, key) {
  const head = group.querySelector(".run-row");
  const toggle = () => {
    _openGroup(_ui.open === key ? null : key);
    renderStepsLevel();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); }
  });
}

/* The open group's steps and its "Show hidden steps (N)" switch. `baseline`
   is the chip class the run's status stands for (a row with that chip shows
   none, P1.9), null for the steps outside runs. */
function _groupBody(visible, hiddenCount, emptyText, baseline) {
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
      onBeginRename: (step) => _fillNameList(step),
      baseline: baseline || null,
    });
  return body;
}

function _runGroupEl(run, model, pattern, visible, stats, ref) {
  const isOpen = _ui.open === run.caseId;
  const isPattern = !!(pattern.run && pattern.run.caseId === run.caseId);
  const rec = isPattern ? pattern.record : null;
  const patternConfirmed = !!(rec && rec.confirmed_at);
  const g = document.createElement("div");
  g.className = "run-group" + (isOpen ? " open" : "") + (isPattern ? " pattern" : "");
  g.dataset.caseId = run.caseId;
  const n = run.visible.length;
  // Item 3: the run's differences from its reference, counted in its meta
  // (no count on the reference run the others are compared with).
  const diffs = _runDiffs(ref, run);
  const meta = _plural(n, "step", "steps") + (run.durationMs != null ? " · " + formatDuration(run.durationMs) : "") +
    (diffs ? " · " + (diffs.length ? _plural(diffs.length, "difference", "differences") : "no differences") : "");
  // AD-28: only the reference run is confirmed, so only it carries a status,
  // read from its confirmation (C3); the other runs are reviewed by opening
  // them. P3.8: "Use as reference run" is a once-a-session choice, so it
  // lives in the run's right-click menu, as the probe line of the confirmed
  // reference run does.
  const status = !isPattern ? null : !run.visible.length ? "empty" : patternConfirmed ? "confirmed" : "draft";
  const canUsePattern = !isPattern && run.members.length > 0;
  g.innerHTML = _groupHead(isOpen,
    '<span class="run-title">' + escapeHtml(run.title) + "</span>" +
    '<span class="run-label"' + (run.label ? ' title="' + escapeAttr(run.label) + '"' : "") + ">" + escapeHtml(run.label) + "</span>" +
    (isPattern ? '<span class="run-pattern-badge" title="' + escapeAttr(PATTERN_TITLE) + '">Reference</span>' : "") +
    (status ? '<span class="run-status run-status-' + status + '">' + escapeHtml(RunsModel.STATUS_LABELS[status]) + "</span>" : "") +
    '<span class="run-meta">' + escapeHtml(meta) + "</span>", canUsePattern ? OTHER_RUN_TITLE : "");
  _wireHead(g, run.caseId);
  if (canUsePattern || (isPattern && patternConfirmed)) {
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
      : "No steps yet: + Add step adds one after the selected step.", status || run.status);
  const acts = body.querySelector(".run-actions");
  const canConfirm = isPattern && !patternConfirmed && run.visible.length > 0;
  const buttons = [];
  if (canConfirm) {
    buttons.push(_actionBtn("confirm-run", "Confirm transaction", "primary",
      "Accept this transaction's remaining drafted steps as they are (Ctrl+Enter). Ctrl+Z undoes it.",
      () => confirmRunAction(run.caseId)));
  }
  if (isPattern && RunsModel.canReopen(run, rec, isPattern)) {
    buttons.push(_actionBtn("reopen-run", "Reopen transaction", "",
      "Turn this transaction's confirmed steps back into drafts; the steps you edited or added stay as they are. Ctrl+Z undoes it.",
      () => reopenRunAction(run.caseId)));
  }
  if (isPattern && patternConfirmed) {
    buttons.push(_actionBtn("save-process", "Save as this process", "",
      "Store this transaction's steps, so that a later project of the same process is compared with them when you open it.",
      () => saveAsProcessAction(run.caseId)));
  }
  for (const b of buttons.reverse()) acts.insertBefore(b, acts.firstChild);
  // One line per run says which names came from saved names (this computer's
  // or this recording's own, C4), in place of a tag on every row.
  const saved = run.visible.filter((s) => s.name_source === "remembered" &&
    (RunsModel.DRAFT_STATES.has(s.state) || s.state === "confirmed")).length;
  if (saved) {
    const line = document.createElement("p");
    line.className = "run-names-note";
    line.title = "These steps took the name you gave the same drafted step before, in this project or on this computer";
    line.textContent = "Names from saved names: " + saved + " of " + _plural(n, "step", "steps");
    acts.appendChild(line);
  }
  const after = acts;
  if (diffs && diffs.length) {
    const list = document.createElement("ul");
    list.className = "run-diffs";
    list.title = "How this transaction differs from " + (ref.kind === "saved" ? "the saved process" : "the reference transaction");
    for (const d of diffs) {
      const li = document.createElement("li");
      li.dataset.kind = d.kind;
      li.textContent = d.text;
      list.appendChild(li);
    }
    body.insertBefore(list, after.nextSibling);
  }
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
    "Steps that fall outside every marked transaction");
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
      ? "Drafted steps: the analysis file does not record how many steps it drafted, so this is the number of steps the transaction had when it became the reference transaction."
      : "The drafted step count is not recorded; Re-analyze in Help, Troubleshooting records it.";
  _runMenu([{ act: "copy-probe", label: "Copy: " + p.text, title: why + " Boundary fixes: the merges, splits, " +
    "added steps and hidden drafts made to the transaction from when it became the reference transaction until you confirmed it.",
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
const GUIDE_CARRY =
  "A merge carries to the same drafted steps in the other transactions, and every name you give is saved.";
const GUIDE_PATTERN_DONE = "This transaction is confirmed: the other transactions are compared with it.";
const GUIDE_OTHER = "Check how this transaction differs from the reference transaction, and fix a step where needed. It is not confirmed: the reference transaction is.";
// A transaction with no step that nothing compares it with: an empty
// project's one transaction before its first step (C16), or an empty
// reference transaction.
const GUIDE_FIRST_STEP = "Add the first step with + Add step.";
const GUIDE_OUTSIDE =
  "These steps fall outside every marked transaction. To bring them into a transaction, right-click the " +
  "Timeline where it starts, choose Start a transaction here, and click Apply marker changes.";

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
    const done = isPattern && pattern.record && pattern.record.confirmed_at;
    head = run ? run.title + (run.label ? " (" + run.label + ")" : "") : "Transaction";
    // No step yet and no reference transaction to compare it with (or it is
    // the reference): the one act is adding the first step.
    const firstStep = !!(run && !run.members.length && (!pattern.run || isPattern));
    paras = firstStep ? [GUIDE_FIRST_STEP]
      : isPattern ? (done ? [GUIDE_PATTERN_DONE] : [GUIDE_PATTERN, GUIDE_CARRY]) : [GUIDE_OTHER];
    const diffs = run && !firstStep ? _runDiffs(ref, run) : null;
    if (diffs && !diffs.length) {
      const noun = ref.kind === "saved" ? RunDiff.SAVED_REFERENCE : RunDiff.REFERENCE_RUN;
      paras.unshift("It has no differences from " + noun + ".");
    }
  } else {
    paras = [model.runs.length ? "Pick a transaction on the left to see its steps." : "Pick a step on the left."];
  }
  if (title) title.textContent = head || "Steps";
  host.innerHTML = '<div class="empty-pane run-guide">' + paras.map((p, i) =>
    "<p" + (i ? ' class="meta"' : "") + ">" + escapeHtml(p) + "</p>").join("") + "</div>";
}

/* The readable name of an application token: RunsModel.readableApp (shared
   with the Overview's Where the time goes). */
const readableApp = RunsModel.readableApp;

function _appNames() {
  const s = State.getSession();
  return (s && s.stats && s.stats.meta && s.stats.meta.app_names) || {};
}

/* C8: what the step editor's "Said during this step" shows: null without a
   transcript, else whether it is synced and the sentences of the step's
   window (transcript-model.js), timed from the recording's start. */
function _transcriptSaid(step) {
  const s = State.getSession();
  const placed = TM.forSession(s);
  if (!placed) return null;
  return { synced: placed.synced, sentences: placed.synced ? TM.sentencesForStep(placed.sentences, step) : [],
    originMs: recordingStartMs(s) };
}

/* The step pane's fact line, fields and description (companion critique,
   section 3), from the step's own fields and interactions: the system first
   (the one vocabulary, C14), the screen, the time, where a draft ends (its
   end_reason and commit) and where it is in the recording. */
function stepFacts(step, interactionsById) {
  const s = State.getSession();
  const origin = recordingStartMs(s);
  const datas = StepFacts.stepDatas(step, interactionsById);
  const known = ((step.evidence && step.evidence.interaction_event_ids) || [])
    .map((id) => interactionsById[id]).filter(Boolean).map((ev) => ev.data || {});
  const where = SystemNames.whereOfStep(step, interactionsById, _appNames());
  // The system the recording gives, the System field's placeholder (C16).
  const derived = SystemNames.whereOfStep(Object.assign({}, step, { system: "" }), interactionsById, _appNames()).system;
  const drafted = StepFacts.isDraftedDescription(step.description, datas);
  return {
    factLine: StepFacts.factLine({ system: where.system, screen: where.screen, duration: StepFacts.duration(step.time_range),
      ends: StepFacts.endsAt(step, datas || []), pointer: StepFacts.pointer(step, _model().runs, origin) }),
    fields: StepFacts.typedFields(known),
    // A draft's narration is the description's hint, never its text: the PDD
    // leaves it out, so the pane does not pretend it is written.
    description: drafted ? "" : (step.description || ""),
    descriptionHint: drafted ? String(step.description).trim() : "",
    system: where.system, derived, originMs: origin,
  };
}

/* The callbacks the per-step detail editor needs. */
function stepDetailCallbacks(selected, interactionsById) {
  const facts = stepFacts(selected, interactionsById);
  return {
    onRename: (stepId, name) => inlineRenameStep(stepId, name, false),
    onDescription: describeStepAction,
    onToggleWaste: (stepId) => toggleStepFlag(stepId, "waste"),
    onDelete: deleteStep,
    onSplit: splitStep,
    onMerge: mergeStepWithNext,
    onMergeSelected: mergeSelectedSteps,
    multiSelectedCount: State.getMultiSelectedStepIds().size,
    onJumpToFlow: (step) => jumpToStepInFlow(step),
    onWatchStep: (step) => watchStep(step),
    onToggleHide: toggleStepHidden,
    interactionsById,
    recordingAvailable: !!(State.getSession() && State.getSession().recordingAvailable),
    // A2: the chosen split boundary for this step (if any) + the picker.
    splitAfterIndex: (selected && _splitAfter.stepId === selected.step_id) ? _splitAfter.index : null,
    onPickSplit: (idx) => {
      if (!selected) return;
      if (_splitAfter.stepId === selected.step_id && _splitAfter.index === idx) {
        _splitAfter = { stepId: null, index: null };   // toggle the boundary off
      } else {
        _splitAfter = { stepId: selected.step_id, index: idx };
      }
      renderStepsLevel();
    },
    factLine: facts.factLine, fields: facts.fields, description: facts.description,
    descriptionHint: facts.descriptionHint, originMs: facts.originMs,
    // C16: the System field, then the step's screenshots (recorded and
    // added), notes and attachments (views/analyst-ui.js).
    systemHtml: AnalystUI.systemFieldHtml(selected, facts.derived),
    extrasHtml: AnalystUI.stepExtrasHtml(selected),
    wireExtras: (host, isRendering) => AnalystUI.wireStepPane(host, selected, isRendering),
    // C4: the name input suggests remembered and already-used names.
    nameListId: NAME_LIST_ID,
    transcriptSaid: _transcriptSaid(selected),
    // C17: the Flow line (its condition and its links) and its edits.
    flow: _flowFor(selected),
    onFlowCondition: (id, text) => _flowEdit(id, text ? "set the step's condition" : "remove the step's condition",
      (s) => StepFlow.setOnlyWhen(s, text)),
    onFlowAddLink: (id, to) => _flowEdit(id, "add a link", (s) => StepFlow.addLink(s, to, "")),
    onFlowLinkTarget: (id, i, to) => _flowEdit(id, "change a link", (s) => StepFlow.setLinkTarget(s, i, to)),
    onFlowLinkWhen: (id, i, when) => _flowEdit(id, "change a link", (s) => StepFlow.setLinkWhen(s, i, when)),
    onFlowRemoveLink: (id, i) => _flowEdit(id, "remove a link", (s) => StepFlow.removeLink(s, i)),
  };
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
  const run = model.runs.find((r) => r.caseId === RunsModel.groupKeyOf(step, model.runs));
  if (!run) return null;
  const list = run.visible;
  const inherited = [];
  if (!StepFlow.onlyWhen(step)) {
    const node = mapNodeLabel(step);
    for (const r of model.runs) {
      for (const s of r.visible) {
        const c = s.step_id !== step.step_id && mapNodeLabel(s) === node ? StepFlow.onlyWhen(s) : "";
        if (c && !inherited.some((x) => x.text === c)) inherited.push({ text: c, where: r.title });
      }
    }
  }
  return {
    onlyWhen: StepFlow.onlyWhen(step),
    inherited,
    links: StepFlow.links(step).map((l) => ({
      to: l.to, when: typeof l.when === "string" ? l.when : "",
      reading: StepFlow.linkReading(list, step, l),
      missing: StepFlow.linkPlace(list, step, l).kind === "missing",
    })),
    choices: StepFlow.linkChoices(list, step),
  };
}

/* One change of a step's flow is one undoable edit, and the step becomes the
   analyst's (a draft becomes edited). `edit(step)` returns true when it
   changed the step. */
async function _flowEdit(stepId, label, edit) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find((s) => s.step_id === stepId);
  if (!step || !edit(step)) return;
  _markEdited(step);
  try { await persistAnnotations(anno, label); } catch (_) { /* already shown */ }
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

/* ===== Names: rename, remember, propagate (C4) ======================== */

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
   name at once. Returns { key, propagated } (key: the draft_key to remember,
   or null). */
function _applyRename(anno, step, name) {
  step.name = name;
  _markEdited(step);
  const pl = (typeof step.draft_key === "string" && step.draft_key) ? String(name).trim() : processLabel(name);
  if (pl) step.process_label = pl;
  const key = typeof step.draft_key === "string" && step.draft_key ? step.draft_key : null;
  const propagated = key ? RunsModel.propagateName(anno.steps || [], step, name) : 0;
  return { key, propagated };
}

/* Remember `name` for `key` in the main-process store. A failed write is
   shown; the session rename is saved either way. */
async function _rememberName(key, name) {
  let r;
  try {
    r = await Ipc.rememberStepName({ draftKey: key, name });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (r && r.ok) {
    _remembered[key] = { name, updated_at: new Date().toISOString() };
    return true;
  }
  toast("The new name is saved in this project, but it could not be remembered for later analyses: " +
    ((r && r.error) || "no reason was given"), "error");
  return false;
}

function _renamedToast(propagated) {
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
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  // Tab moves on to the row below, in the list the analyst sees.
  const goNext = advance === true || advance === "next";
  const next = goNext ? RunsModel.nextInGroup(_model(), stepId, _ui.showHidden) : null;
  const { key, propagated } = _applyRename(anno, step, newName);
  let saved = true;
  try { await persistAnnotations(anno, "rename step"); } catch (_) { saved = false; }   // already shown
  if (key) await _rememberName(key, newName);
  if (saved && propagated) toast(_renamedToast(propagated), "success");
  if (next) {
    State.setSelectedStepId(next.step_id);
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
  }
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
  const step = anno.steps.find((s) => s.step_id === stepId);
  if (!step) return;
  step.description = text;
  _markEdited(step);
  try { await persistAnnotations(anno, "edit step description"); } catch (_) { /* already shown */ }
}

/* ===== Boundary verbs (counted on the pattern run, C3) ================ */

/* Taking a step out (hide or delete) is a dropped draft, or, for a step the
   analyst added, the add taken back. */
function _removalFix(state) {
  return state === "manually_authored" ? { kind: "add", delta: -1 } : { kind: "drop", delta: 1 };
}

/* Item 5: only a step the analyst added is deleted. Any other step came from
   the drafting, and the next Analyze would draft it again, so taking it out
   hides it instead (a hidden step stays out of every analysis). */
async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (step && step.state !== "manually_authored") {
    if (step.state !== "hidden") await toggleStepHidden(stepId);
    return;
  }
  const ok = await confirmModal({
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "You added this step by hand. Ctrl+Z restores it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (step && step.state !== "hidden") {
    const f = _removalFix(step.state);
    RunsModel.recordFix(anno, _model().runs, step.case_id, f.kind, f.delta);
  }
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
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
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  const runs = _model().runs;
  if (step.state === "hidden") {
    const prev = step._prev_state || "auto_suggested";
    const f = _removalFix(prev);
    RunsModel.recordFix(anno, runs, step.case_id, f.kind, -f.delta);
    step.state = prev;
    delete step._prev_state;
    await persistAnnotations(anno, "unhide step");
    toast("Step restored", "success");
  } else {
    const f = _removalFix(step.state);
    RunsModel.recordFix(anno, runs, step.case_id, f.kind, f.delta);
    step._prev_state = step.state;
    step.state = "hidden";
    // C17: the links that went to it go too, in the same edit.
    const dropped = StepFlow.dropLinksTo(anno.steps, [stepId]).length;
    if (State.getSelectedStepId() === stepId && !_ui.showHidden) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    const linksText = dropped ? " " + _linksDroppedText(dropped, false) : "";
    // Item 2: a draft hidden in the pattern run is offered for every run.
    const p = RunsModel.patternRun(anno, runs);
    const others = p.run && step.case_id === p.run.caseId
      ? RunsModel.sameKeyDraftsElsewhere(_model(), p.run.caseId, step.draft_key) : [];
    if (others.length) {
      toast("Step hidden." + linksText + " " + _plural(RunsModel.runCount(others), "other transaction has", "other transactions have") +
        " the same drafted step.", "success",
        { action: { label: "Hide in all transactions", act: "hide-all-runs", onClick: () => hideInAllRuns(stepId) } });
    } else {
      toast("Step hidden." + (linksText || ' "Show hidden steps" on its transaction lists it again.'), "success");
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
  const step = anno.steps.find((s) => s.step_id === stepId);
  const model = _model();
  const p = RunsModel.patternRun(anno, model.runs);
  if (!step || step.state !== "hidden" || !p.run || step.case_id !== p.run.caseId) return;
  const others = RunsModel.sameKeyDraftsElsewhere(model, p.run.caseId, step.draft_key);
  if (!others.length) return;
  RunsModel.hideSteps(others);
  const dropped = StepFlow.dropLinksTo(anno.steps, others.map((s) => s.step_id)).length;
  await persistAnnotations(anno, "hide in all transactions");
  toast("Hidden here and in " + _plural(RunsModel.runCount(others), "other transaction", "other transactions") + "." +
    (dropped ? " " + _linksDroppedText(dropped, true) : " Ctrl+Z undoes it."), "success");
}

async function splitStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === stepId);
  if (idx < 0) return;
  const s = anno.steps[idx];
  const ids = (s.evidence || {}).interaction_event_ids || [];   // a step may lack evidence
  if (ids.length < 2) { toast("Need ≥2 interactions to split", "error"); return; }
  // A2: split at the analyst-picked boundary (split AFTER index i -> first
  // chunk is [0..i]) when one is set for THIS step; else the midpoint.
  let mid;
  if (_splitAfter.stepId === stepId && Number.isInteger(_splitAfter.index)
      && _splitAfter.index >= 0 && _splitAfter.index < ids.length - 1) {
    mid = _splitAfter.index + 1;
  } else {
    mid = Math.floor(ids.length / 2);
  }
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(State.getSession().events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
  const firstEvents = firstIds.map(id => interMap[id]).filter(Boolean);
  const secondEvents = secondIds.map(id => interMap[id]).filter(Boolean);
  if (!firstEvents.length || !secondEvents.length) { toast("Could not split step", "error"); return; }
  RunsModel.recordFix(anno, _model().runs, s.case_id, "split");
  // G-4: splitting an already-split step must not stack suffixes
  // ("X (split 1) (split 1)") — strip any existing artifact first.
  const baseName = stripSplitSuffix(s.name);
  // Neither half is one draft any more: no draft identity (a rename of a
  // half is not remembered under the whole draft's key).
  const second = RunsModel.dropDraftIdentity({ ...s, step_id: cryptoRandomId(),
    name: baseName + " (split 2)",
    time_range: { start: secondEvents[0].timestamp, end: secondEvents[secondEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: secondIds },
    state: "edited" });
  const first = RunsModel.dropDraftIdentity({ ...s, name: baseName + " (split 1)",
    time_range: { start: firstEvents[0].timestamp, end: firstEvents[firstEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: firstIds },
    state: "edited" });
  // C17: the condition stays with the first half, the links leave the second.
  StepFlow.splitFlow(first, second);
  anno.steps.splice(idx, 1, first, second);
  _splitAfter = { stepId: null, index: null };
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
   it; on the pattern run the split and the add are counted fixes. */
async function addStepAtTimestamp(tsISO) {
  if (!State.getSession()) return;
  const t = new Date(tsISO).getTime();
  if (!isFinite(t)) { toast("Couldn't read the playhead position", "error"); return; }
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
    if (!span) { toast("No events to anchor a step to", "error"); return; }
    const before = inter.filter(e => new Date(e.timestamp).getTime() < t).map(e => e.event_id);
    const after = inter.filter(e => new Date(e.timestamp).getTime() >= t).map(e => e.event_id);
    anno.steps.push(
      makeStep("Step 1", new Date(span.startMs).toISOString(), tISO, before, runAt(span.startMs, t)),
      makeStep("Step 2", tISO, new Date(span.endMs).toISOString(), after, runAt(t, span.endMs)),
    );
    await persistAnnotations(anno, "Add step at playhead");
    toast('Created "Step 1" and "Step 2"', "success");
    return;
  }

  // Playhead inside a step: split that step at the playhead.
  const idx = anno.steps.findIndex(s => s.time_range
    && new Date(s.time_range.start).getTime() < t
    && new Date(s.time_range.end).getTime() > t);
  if (idx >= 0) {
    const s = anno.steps[idx];
    const ids = (s.evidence && s.evidence.interaction_event_ids) || [];
    const newName = nextStepName(anno.steps);
    RunsModel.recordFix(anno, runs, s.case_id, "split");
    const first = RunsModel.dropDraftIdentity({ ...s, time_range: { start: s.time_range.start, end: tISO },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) < t) },
      state: "edited" });
    const second = RunsModel.dropDraftIdentity({ ...s, step_id: cryptoRandomId(), name: newName,
      time_range: { start: tISO, end: s.time_range.end },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) >= t) },
      state: "edited" });
    StepFlow.splitFlow(first, second);   // C17, as in splitStep
    anno.steps.splice(idx, 1, first, second);
    await persistAnnotations(anno, "Add step at playhead");
    toast('Added "' + newName + '"', "success");
    return;
  }

  // Playhead in open space: new step from the playhead to the next boundary
  // (the next step's start, else the end of the run it is in, else the end
  // of the session).
  const span = getSpan();
  const inRun = RunsModel.runForRange(runs, t, t);
  const next = anno.steps
    .filter(s => s.time_range && s.time_range.start)
    .map(s => new Date(s.time_range.start).getTime())
    .filter(ms => ms >= t)
    .sort((a, b) => a - b)[0];
  let endMs = next != null ? next : (span ? span.endMs : t + 5000);
  if (inRun && inRun.endMs != null) endMs = Math.min(endMs, inRun.endMs);
  if (endMs - t <= 0) { toast("A step already starts here"); return; }
  const newName = nextStepName(anno.steps);
  const ids = inter
    .filter(e => { const et = new Date(e.timestamp).getTime(); return et >= t && et < endMs; })
    .map(e => e.event_id);
  const caseId = runAt(t, endMs);
  RunsModel.recordFix(anno, runs, caseId, "add");
  anno.steps.push(makeStep(newName, tISO, new Date(endMs).toISOString(), ids, caseId));
  await persistAnnotations(anno, "Add step at playhead");
  toast('Added "' + newName + '"', "success");
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
    state: "edited",
  });
  if (keys) merged.draft_keys = keys;
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
  RunsModel.recordFix(anno, model.runs, toMerge[0].case_id, "merge");
  const merged = mergeStepObjects(toMerge);
  const mergedIds = new Set(toMerge.map(s => s.step_id));
  anno.steps = anno.steps.filter(s => !mergedIds.has(s.step_id));
  anno.steps.push(merged);
  const idMap = new Map([...mergedIds].map((id) => [id, merged.step_id]));
  const carriedRuns = _carryMerge(anno, model.runs, model, merged, idMap);
  // C17: a link to a merged step goes to the step it became part of; one
  // between two steps of the same merge would point at its own step, so it
  // goes.
  const selfLinks = StepFlow.retargetLinks(anno.steps, idMap);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, undoLabel);
  return { merged, carriedRuns, selfLinks };
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
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) { toast("Step not found", "error"); return; }
  const next = RunsModel.nextInGroup(_model(), stepId, _ui.showHidden);
  if (!next) { toast("This is the last step of its transaction: there is no next step to merge with.", "error"); return; }
  const toMerge = [step, next];
  const r = await commitMerge(anno, toMerge, 'merge step with next');
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
  const toMerge = anno.steps.filter(s => multi.has(s.step_id)).sort(RunsModel.byStart);
  if (toMerge.length < 2) { toast("Select at least two steps to merge", "error"); return; }
  if (new Set(toMerge.map((s) => s.case_id || null)).size > 1) {
    toast("Select steps from one transaction to merge them.", "error");
    return;
  }
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
  for (const id of ["btn-delete-selected-steps", "btn-merge-selected"]) {
    const b = $("#" + id);
    if (b) b.hidden = n < 2;
  }
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
  const steps = ((s && s.annotations && s.annotations.steps) || []).filter((x) => ids.has(x.step_id));
  return {
    hide: steps.filter((x) => x.state !== "manually_authored" && x.state !== "hidden"),
    remove: steps.filter((x) => x.state === "manually_authored"),
  };
}

/* "+ Add step" (C16): a step added by hand has no time (a time range is read
   as measured). It goes into the open run (else the implicit run of a
   session without a recording, else outside the runs), right after the
   selected step, or at the end; its `order` places it among the run's steps
   without a time. The Timeline's + Step places one at the video playhead. */
async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add step", message: "Name this step", placeholder: "For example: Search customer in CRM", okLabel: "Add step" });
  if (!name || !name.trim() || !State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const model = _model();
  const open = model.runs.find((r) => r.caseId === _ui.open);
  const caseId = open ? open.caseId : _ui.open === OUTSIDE ? null : AC.implicitRunId(State.getSession().stats);
  const members = caseId ? ((model.runs.find((r) => r.caseId === caseId) || {}).members || []) : model.outside;
  const step = makeStep(name.trim(), null, null, [], caseId);
  AC.placeUntimed(members, step, members.find((s) => s.step_id === State.getSelectedStepId()) || null);
  RunsModel.recordFix(anno, model.runs, caseId, "add");
  anno.steps.push(step);
  if (caseId && _ui.open !== caseId) _openGroup(caseId);
  State.setSelectedStepId(step.step_id);
  await persistAnnotations(anno, 'add step');
  toast("Step added", "success");
}

/* Move a step without a time up (-1) or down (+1) in its run (the step menu,
   Alt+Up and Alt+Down): its `order` and its neighbours' are written again.
   A step with a time keeps its place (its time orders it). */
async function moveStep(stepId, delta) {
  if (!State.getSession()) return false;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find((s) => s.step_id === stepId);
  if (!step) return false;
  const model = _model();
  const key = RunsModel.groupKeyOf(step, model.runs);
  const members = key === OUTSIDE ? model.outside : (model.runs.find((r) => r.caseId === key) || {}).members;
  if (!AC.moveUntimed(members || [], step, delta, (s) => _ui.showHidden || s.state !== "hidden")) {
    toast(AC.hasTime(step) ? "A step with a time keeps its place: its time orders it."
      : delta < 0 ? "It cannot move further up." : "It cannot move further down.");
    return false;
  }
  await persistAnnotations(anno, delta < 0 ? "move step up" : "move step down");
  return true;
}

/* Alt+Up / Alt+Down on the Steps level: move the selected step when its row
   is on screen. Returns true when the key was used. */
function moveSelectedStep(delta) {
  const sid = visibleSelectedStepId();
  if (!sid) return false;
  const step = _findStep(sid);
  if (!step || AC.hasTime(step)) return false;
  moveStep(sid, delta);
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
  const ok = await confirmModal({
    title: what.charAt(0).toUpperCase() + what.slice(1) + "?",
    message: "Take the " + (hide.length + remove.length) + " selected steps out: " + what + ".",
    detail: "A hidden step stays out of every analysis. Ctrl+Z restores them all.",
    okLabel: !remove.length ? "Hide " + hide.length : !hide.length ? "Delete " + remove.length : "Hide and delete",
    danger: remove.length > 0,
  });
  if (!ok || !State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  ({ hide, remove } = _removalSplit(new Set(ids)));   // the live steps, after the dialog
  const runs = _model().runs;
  for (const s of hide.concat(remove)) {
    const f = _removalFix(s.state);
    RunsModel.recordFix(anno, runs, s.case_id, f.kind, f.delta);
  }
  RunsModel.hideSteps(hide);
  const removeIds = new Set(remove.map((s) => s.step_id));
  anno.steps = anno.steps.filter(s => !removeIds.has(s.step_id));
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

/* "Reopen run" (item 4), the inverse of Confirm run: the run's confirmed
   steps are drafts again, edited and added ones stay; on the pattern run the
   confirmation (and its probe line) goes until the run is confirmed again,
   and the draft-fix counts are kept. One edit, so Ctrl+Z undoes it. */
async function reopenRunAction(caseId) {
  const session = State.getSession();
  if (!session) return;
  const anno = ensureAnnoShape(session.annotations);
  const model = _model();
  const run = model.runs.find((r) => r.caseId === caseId);
  if (!run) return;
  const r = RunsModel.reopenRun(anno, model.runs, caseId);
  if (!r.reopened && !r.patternReopened) return;
  try { await persistAnnotations(anno, "reopen transaction"); } catch (_) { return; }   // already shown
  toast(run.title + " reopened" +
    (r.reopened ? ": " + _plural(r.reopened, "step is a draft", "steps are drafts") + " again" : "") +
    ". Ctrl+Z undoes it.", "success");
}

/* "Save as this process" (item 7, contract C5): the confirmed pattern run's
   visible steps, in time order, are stored under a name in the saved
   processes of this computer, so that a later session of the same process is
   compared with them when it opens. A name already saved is replaced. The
   toast's Undo takes the save back (the replaced process returns). */
async function saveAsProcessAction(caseId) {
  const session = State.getSession();
  if (!session) return;
  const anno = session.annotations || {};
  const model = _model();
  const p = RunsModel.patternRun(anno, model.runs);
  if (!p.run || p.run.caseId !== caseId || !p.record || !p.record.confirmed_at) return;
  const steps = RunDiff.processStepsFrom(p.run.visible);
  if (!steps.length) { toast("This transaction has no steps to save.", "error"); return; }
  const docTitle = anno.document && typeof anno.document.title === "string" ? anno.document.title.trim() : "";
  const name = await promptModal({
    title: "Save as this process",
    message: "Name the process",
    detail: "A later project of this process is compared with these " + _plural(steps.length, "step", "steps") +
      " when you open it. Saving under a name already saved replaces that process.",
    placeholder: "For example: Order entry",
    defaultValue: docTitle,
    okLabel: "Save",
  });
  if (!name || !name.trim()) return;
  let r;
  try {
    r = await Ipc.saveProcess({
      name: name.trim(),
      sourceSessionId: (session.manifest && session.manifest.session_id) || "",
      steps,
    });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (!r || !r.ok) {
    toast("The process was not saved: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  toast((r.previous ? "Replaced" : "Saved") + ' the process "' + name.trim() + '".', "success",
    { action: { label: "Undo", act: "undo-save-process", onClick: () => _undoSaveProcess(r) } });
}

async function _undoSaveProcess(saved) {
  let r;
  try {
    r = await Ipc.undoSaveProcess({ id: saved.id, previous: saved.previous || null });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (r && r.ok) toast(saved.previous ? "The saved process is back as it was." : "The process is no longer saved.", "success");
  else toast("The save could not be taken back: " + ((r && r.error) || "no reason was given"), "error");
}

/* "Forget this saved process" (P3.11), the inverse of Save as this process
   where the saved process shows (the comparison line): it leaves this
   computer's saved processes, the runs are compared with the session's own
   pattern run, and the toast's Undo brings it back, with the comparison. */
async function forgetProcessAction() {
  const match = _ui.compare;
  const proc = match && match.process;
  if (!proc || !proc.id) return;
  let r;
  try {
    r = await Ipc.forgetProcess({ id: proc.id });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (!r || !r.ok) {
    toast("The saved process was not forgotten: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  const folder = _ui.folder;
  _ui.compare = null;
  renderStepsLevel();
  toast('Forgot the saved process "' + proc.name + '".', "success",
    { action: { label: "Undo", act: "undo-forget-process", onClick: () => _undoForgetProcess(r.removed, match, folder) } });
}

async function _undoForgetProcess(removed, match, folder) {
  let r;
  try {
    r = removed ? await Ipc.undoSaveProcess({ id: removed.id, previous: removed }) : { ok: false, error: "nothing was forgotten" };
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  if (!r || !r.ok) {
    toast("The saved process could not be brought back: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  if (_ui.folder === folder) { _ui.compare = match; _ui.compareStopped = false; renderStepsLevel(); }
  toast("The saved process is back.", "success");
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
  const key = _ui.open;
  if (!key || key === OUTSIDE) return false;
  const group = [...document.querySelectorAll("#step-list .run-group")].find((g) => g.dataset.caseId === key);
  if (!group || !group.querySelector('[data-act="confirm-run"]')) return false;
  confirmRunAction(key);
  return true;
}

/* ===== Leave apps out (step-noise denylist) =====
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

function openIgnoredAppsDialog() {
  if (!State.getSession()) { toast("Open a project first.", ""); return; }
  const apps = distinctSessionApps();
  if (!apps.length) {
    toast("No interaction data in this project: nothing to filter.", "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal modal-simple" role="dialog">' +
      '<header class="modal-header"><h2>Leave apps out</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta" style="margin-top:0">The apps you tick are left out of the drafted steps: for example the recorder itself, or anything that is not part of the process you are mapping. Saving updates the steps and the map.</p>' +
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
  list.innerHTML = apps.map((a) => {
    const checked = current.has(a.proc.toLowerCase()) ? " checked" : "";
    return '<label class="cb" style="display:flex;gap:8px;padding:5px 4px;align-items:center" title="' + escapeAttr(a.proc) + '">' +
      '<input type="checkbox" data-proc="' + escapeHtml(a.proc) + '"' + checked + ' />' +
      '<span style="flex:1">' + escapeHtml(readableApp(a.proc, names) || a.proc) + '</span>' +
      '<span class="meta">' + a.count + ' interactions</span>' +
      '</label>';
  }).join("");

  function close() { backdrop.remove(); }
  backdrop.querySelector("#ia-close").addEventListener("click", close);
  backdrop.querySelector("#ia-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#ia-save").addEventListener("click", async () => {
    const picked = Array.from(list.querySelectorAll("input[type=checkbox]"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.proc);
    anno.step_filters.ignored_processes = picked;
    // Settings change -- written directly (not via the undo stack), through
    // the one write path (RP-04): a failed save has already been shown as an
    // error, so keep the dialog open and do not re-analyze.
    try {
      await Session.saveAnnotationsDirect(anno, "ignored apps");
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

/* ===== Saved names (item 8, C4; the button reads Saved names...) =====
   The names this computer remembers for drafted steps, those whose draft key
   occurs in this session first. Rename changes the remembered name and the
   session's steps with that key that carry it (its drafts, and the steps
   named with it); Forget removes it from the store and gives those steps
   their drafted names back. Both are one undoable edit of the session: the
   next analysis names drafts with the session's own names first (C4). */
function openRememberedNamesDialog() {
  if (!State.getSession()) { toast("Open a project first.", ""); return; }
  const prior = document.getElementById("remembered-names-dialog");
  if (prior) prior.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "remembered-names-dialog";
  backdrop.innerHTML =
    '<div class="modal modal-simple" role="dialog" aria-label="Saved names">' +
      '<header class="modal-header"><h2>Saved names</h2>' +
        '<button class="icon-btn modal-close" data-act="close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta rn-intro">Names you gave drafted steps. Every analysis names the same drafted steps with them.</p>' +
        '<div class="rn-list"></div>' +
      "</div>" +
      '<div class="modal-footer"><button class="primary" data-act="close">Close</button></div>' +
    "</div>";
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector(".rn-list");
  for (const b of backdrop.querySelectorAll('[data-act="close"]')) b.addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

  let names = {};
  async function render() {
    let r;
    try { r = await Ipc.readRememberedNames(); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!backdrop.isConnected) return;
    if (!r || !r.ok) {
      list.innerHTML = '<p class="rn-error">' + escapeHtml("The saved names cannot be read: " +
        ((r && r.error) || "no reason was given")) + "</p>";
      return;
    }
    names = r.names || {};
    _remembered = Object.assign({}, names);
    const s = State.getSession();
    const rows = RunsModel.rememberedNameRows(names, (s && s.annotations && s.annotations.steps) || []);
    if (!rows.length) {
      list.innerHTML = '<p class="meta">No names are remembered yet. When you rename a drafted step, its name is remembered.</p>';
      return;
    }
    list.innerHTML = rows.map((row) =>
      '<div class="rn-row" data-key="' + escapeAttr(row.key) + '" title="' + escapeAttr(row.key) + '">' +
        '<div class="rn-text"><span class="rn-name">' + escapeHtml(row.name) + "</span>" +
        '<span class="rn-where">' + escapeHtml(row.inSession
          ? _plural(row.inSession, "step in this project", "steps in this project") : "Not in this project") + "</span></div>" +
        '<button type="button" data-act="rename-name">Rename</button>' +
        '<button type="button" data-act="forget-name">Forget</button>' +
      "</div>").join("");
    for (const rowEl of list.querySelectorAll(".rn-row")) {
      const key = rowEl.dataset.key;
      rowEl.querySelector('[data-act="rename-name"]').addEventListener("click", () => renameRemembered(key));
      rowEl.querySelector('[data-act="forget-name"]').addEventListener("click", () => forgetRemembered(key));
    }
  }

  async function renameRemembered(key) {
    const cur = (names[key] && names[key].name) || "";
    const next = await promptModal({ title: "Rename a saved name", message: 'New name for "' + cur + '"',
      defaultValue: cur, okLabel: "Rename" });
    const nm = typeof next === "string" ? next.trim() : "";
    if (!nm || nm === cur || !State.getSession()) return;
    let r;
    try { r = await Ipc.rememberStepName({ draftKey: key, name: nm }); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || !r.ok) { toast("The name was not renamed: " + ((r && r.error) || "no reason was given"), "error"); return; }
    _remembered[key] = { name: nm, updated_at: new Date().toISOString() };
    // The session's own steps with that name take the new one too: the next
    // analysis names drafts with this session's names first (C4).
    const anno = ensureAnnoShape(State.getSession().annotations);
    const n = RunsModel.renameSavedName(anno.steps, key, cur, nm);
    let saved = true;
    if (n) { try { await persistAnnotations(anno, "rename a saved name"); } catch (_) { saved = false; } }   // already shown
    if (saved) {
      toast("Renamed" + (n ? ": " + _plural(n, "step in this project took", "steps in this project took") +
        " the new name" : "") + ".", "success");
    }
    await render();
  }

  async function forgetRemembered(key) {
    const cur = (names[key] && names[key].name) || "";
    const ok = await confirmModal({ title: "Forget this name?", message: 'Forget "' + cur + '"?',
      detail: "The steps of this project with this name get their drafted names back, and later analyses no longer use it. Ctrl+Z gives this project its names back.",
      okLabel: "Forget" });
    if (!ok || !State.getSession()) return;
    let r;
    try { r = await Ipc.forgetStepName({ draftKey: key }); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || !r.ok) { toast("The name was not forgotten: " + ((r && r.error) || "no reason was given"), "error"); return; }
    delete _remembered[key];
    // Otherwise the next analysis names the drafts with this session's own
    // steps that still carry it (C4).
    const anno = ensureAnnoShape(State.getSession().annotations);
    const inter = _interactionsById();
    const n = RunsModel.forgetSavedName(anno.steps, key, cur,
      (s) => StepFacts.draftedName(s, StepFacts.stepDatas(s, inter)));
    let saved = true;
    if (n) { try { await persistAnnotations(anno, "forget a saved name"); } catch (_) { saved = false; } }   // already shown
    if (saved) {
      toast('Forgot "' + cur + '".' + (n ? " " + _plural(n, "step in this project has its drafted name",
        "steps in this project have their drafted names") + " again." : ""), "success");
    }
    await render();
  }

  render();
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
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-merge-selected")) $("#btn-merge-selected").addEventListener("click", mergeSelectedSteps);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
  if ($("#btn-remembered-names")) $("#btn-remembered-names").addEventListener("click", openRememberedNamesDialog);
}

/* A2/A5: toggle one boolean flag on a step and persist. Shared by the step
   timeline context menu and any other quick-flag affordance. */
async function toggleStepFlag(stepId, flagKey) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = (anno.steps || []).find(s => s.step_id === stepId);
  if (!step) return;
  step.flags = step.flags || {};
  step.flags[flagKey] = !step.flags[flagKey];
  _markEdited(step);
  await persistAnnotations(anno, (step.flags[flagKey] ? "flag " : "unflag ") + flagKey);
  toast(step.flags[flagKey] ? "Flagged" : "Flag cleared", "success");
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
    title: "Make this the transaction you confirm, the one the other transactions are compared with. The boundary fix count starts again at zero.",
    run: () => usePatternAction(caseId) }], x, y);
}

/* A5: right-click context menu for a step, from its list row. Mirrors the
   inline-styled menu pattern used by the Flow timeline (flow-view.js
   showMarkerInsertMenu) for visual consistency. The step is revealed first
   (its run opens), so every item acts on a step the list shows. */
function showStepContextMenu(stepId, x, y) {
  const prior = document.getElementById("step-ctx-menu");
  if (prior) prior.remove();
  const session = State.getSession();
  const anno = session && session.annotations;
  const step = anno && (anno.steps || []).find(s => s.step_id === stepId);
  if (!step) return;
  _selectAndReveal(stepId);

  const menu = document.createElement("div");
  menu.id = "step-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);min-width:210px;cursor:default;user-select:none;";

  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => { item.style.background = "var(--accent)"; });
    item.addEventListener("mouseleave", () => { item.style.background = ""; });
    item.addEventListener("click", async () => { menu.remove(); await handler(); });
    menu.appendChild(item);
  }
  function addSep() {
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;margin:4px 0;background:var(--rule);";
    menu.appendChild(sep);
  }

  const flags = step.flags || {};
  addItem("Split at interaction…", () => {
    renderStepsLevel();
    toast("Click the scissors on an interaction, then Split", "success");
  });
  addItem("Merge with next", () => mergeStepWithNext(stepId));
  // P0.1: the selection-aware merge is a distinct item, shown only when a
  // multi-selection exists -- so its label can name the count it acts on.
  const _multiSel = State.getMultiSelectedStepIds();
  if (_multiSel && _multiSel.size >= 2) {
    addItem("Merge " + _multiSel.size + " selected steps", () => mergeSelectedSteps());
  }
  addItem("Rename", () => { renderStepsLevel(); setTimeout(() => beginRenameOnSelected(), 30); });
  // C16: a step without a time moves among its run's steps (Alt+Up, Alt+Down).
  if (!AC.hasTime(step)) {
    addItem("Move up", () => moveStep(stepId, -1));
    addItem("Move down", () => moveStep(stepId, 1));
  }
  addItem(step.state === "hidden" ? "Unhide" : "Hide step", () => toggleStepHidden(stepId));
  addItem("Show on timeline", () => {
    const s = (anno.steps || []).find(x => x.step_id === stepId);
    if (s) jumpToStepInFlow(s);
  });
  if (session && session.recordingAvailable) {
    addItem("Watch", () => {
      const s = (anno.steps || []).find(x => x.step_id === stepId);
      if (s) watchStep(s);
    });
  }
  addSep();
  addItem(flags.waste ? "Clear waste flag" : "Flag as waste",
    () => toggleStepFlag(stepId, "waste"));

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
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
  renderStepsLevel();   // reflect the new selection immediately
}

module.exports = {
  initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep,
  deleteSelectedSteps, splitStep, mergeStepWithNext, mergeSelectedSteps,
  addStepAtTimestamp,
  // Keyboard: act only on what the list shows (RP-12).
  visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun, moveSelectedStep, moveStep,
  // G-4 label hygiene -- pure, exported for unit testing.
  stripSplitSuffix, mergeStepObjects,
};
