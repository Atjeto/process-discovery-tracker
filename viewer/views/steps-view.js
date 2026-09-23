/*
 * steps-view.js -- the Steps level of the Session view: the runs and their
 * steps (BA helper cycle, contracts C1 to C4).
 *
 * The list pane shows the runs in time order (the cases from the markers).
 * One group is open at a time: a run, which lists its steps in time order,
 * or the collapsed-by-default "Outside runs" group for the steps no run
 * contains. The analyst confirms the PATTERN run first (fix its boundaries,
 * name its steps, Confirm run); the app counts the boundary fixes made to it
 * (merge, split, add, drop) and, once it is confirmed, shows the probe line.
 * Renaming a step that carries a draft_key remembers the name (main-process
 * store, passed as --names on every Analyze) and names the same-key drafts of
 * the session at once. The Detail slider does not change this view.
 *
 * The model is runs-model.js (pure, unit-tested); this module renders it and
 * owns the step verbs (rename / save / split / merge / hide / delete / add /
 * bulk-delete / confirm run / use as pattern) and the ignored-apps dialog.
 * Cross-surface helpers (ensureAnnoShape, persistAnnotations,
 * videoTimeToSessionTs, jumpToStepInFlow, watchStep) are injected by
 * renderer.js via initStepsView().
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Session = require("../session.js");
const Ipc = require("../ipc.js");
const PdtSteps = require("../step-editor.js");
const RunsModel = require("../runs-model.js");
const { screenType, resolveStepGrainKeys, processLabel } = require("../process-map-levels.js");

const OUTSIDE = RunsModel.OUTSIDE;

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let videoTimeToSessionTs = () => null;
let jumpToStepInFlow = () => {};
let watchStep = () => {};

/* A2: the analyst-chosen split boundary for the currently-selected step --
   { stepId, index } where index means "split AFTER this interaction". Null
   index when no boundary is picked (Split then falls back to the midpoint). */
let _splitAfter = { stepId: null, index: null };

/* The runs view's own state, per session folder: `open` is the group whose
   steps show (a run's case_id, OUTSIDE, or null for none; undefined until
   the first render opens the pattern run) and `showHidden` also lists the
   hidden steps of the open group. It survives level switches and a
   re-analysis of the same session (case ids are stable, C9), so a return to
   Steps finds the view as the analyst left it. */
let _ui = { folder: null, open: undefined, showHidden: false };

/* The remembered names (C4) behind the name suggestions: read from the main
   process once, then updated in place after each name is remembered. */
let _remembered = {};
let _rememberedLoad = null;

/* The one datalist the step name inputs (detail and inline rename) share. */
const NAME_LIST_ID = "step-name-suggestions";

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
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
   outside runs. */
function _defaultOpen(model, pattern) {
  if (pattern && pattern.run) return pattern.run.caseId;
  if (model.runs.length) return model.runs[0].caseId;
  return model.outside.length ? OUTSIDE : null;
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
}

/* Select a step and make sure it is on screen: its group opens, and hidden
   steps show when it is hidden. Used by the clicks that reach a step from
   outside the list (the step timeline, the context menu). */
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

/* ===== The Steps level ================================================== */

function renderStepsLevel() {
  const session = State.getSession();
  if (!session || !PdtSteps) return;
  if (_ui.folder !== session.sessionFolder) _ui = { folder: session.sessionFolder, open: undefined, showHidden: false };
  _ensureRememberedLoaded();
  const anno = session.annotations || {};
  const allSteps = anno.steps || [];
  const interactionsById = _interactionsById();
  const model = RunsModel.buildRuns(session.stats, allSteps);
  const pattern = RunsModel.patternRun(anno, model.runs);

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
    if (_ui.open !== key) { _ui.open = key; State.getMultiSelectedStepIds().clear(); }
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

  $("#steps-badge").textContent = String(allSteps.length);
  const pc = $("#runs-pane-count");
  if (pc) pc.textContent = String(model.runs.length);
  _renderFlagSummary(allSteps);

  renderRunsList($("#step-list"), model, pattern, visible, session.stats);

  const selId = State.getSelectedStepId();
  const selected = selId && visibleIds.has(selId) ? allSteps.find((s) => s.step_id === selId) : null;
  const title = $("#step-detail-title");
  if (selected) {
    if (title) title.textContent = "Selected step";
    _fillNameList(selected, interactionsById);
    PdtSteps.renderStepDetail($("#step-detail"), selected, stepDetailCallbacks(selected, interactionsById, model));
  } else {
    renderRunGuide($("#step-detail"), model, pattern);
  }
  _renderStepsMiniTimeline(allSteps, visibleIds);

  if (revealStep && visibleIds.has(revealStep.step_id)) {
    setTimeout(() => {
      const row = _rowFor(revealStep.step_id);
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
}

/* A3: the flagged-step count on the toolbar (waste and the legacy flags an
   older annotations.json may still carry). */
function _renderFlagSummary(allSteps) {
  const sumEl = $("#steps-summary");
  if (!sumEl) return;
  const fc = { waste: 0, automation_candidate: 0, conditional: 0, exception_path: 0 };
  for (const st of allSteps) {
    const fl = st.flags || {};
    for (const k of Object.keys(fc)) if (fl[k]) fc[k]++;
  }
  const parts = [];
  if (fc.waste) parts.push(fc.waste + " waste");
  if (fc.automation_candidate) parts.push(fc.automation_candidate + " automatable");
  if (fc.conditional) parts.push(fc.conditional + " conditional");
  if (fc.exception_path) parts.push(fc.exception_path + " exception");
  sumEl.textContent = parts.length ? ("Flagged: " + parts.join(" · ")) : "";
}

/* The list pane: the runs (the open one with its steps), then the steps
   outside runs. */
function renderRunsList(host, model, pattern, visible, stats) {
  if (!host) return;
  host.innerHTML = "";
  if (!model.runs.length && !model.outside.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
        "<p><strong>No steps yet.</strong></p>" +
        "<p>Steps appear after you click <em>Analyze session</em>: the app drafts each run's steps from the recording.</p>" +
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
  for (const run of model.runs) host.appendChild(_runGroupEl(run, model, pattern, visible, stats));
  if (model.outside.length) host.appendChild(_outsideGroupEl(model, visible));
}

const PATTERN_TITLE = "The pattern run: confirm it first. Its step names carry over to the other runs.";
const FIXES_TITLE = "Merges, splits, added steps and hidden or deleted drafts you make to the pattern run " +
  "before you confirm it. Renames are not counted. Ctrl+Z takes a fix back.";

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

/* The open group's steps and its "Show hidden steps (N)" switch. */
function _groupBody(visible, hiddenCount, emptyText) {
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
    });
  return body;
}

function _runGroupEl(run, model, pattern, visible, stats) {
  const isOpen = _ui.open === run.caseId;
  const isPattern = !!(pattern.run && pattern.run.caseId === run.caseId);
  const rec = isPattern ? pattern.record : null;
  const patternConfirmed = !!(rec && rec.confirmed_at);
  const g = document.createElement("div");
  g.className = "run-group" + (isOpen ? " open" : "") + (isPattern ? " pattern" : "");
  g.dataset.caseId = run.caseId;
  const n = run.visible.length;
  const meta = _plural(n, "step", "steps") + (run.durationMs != null ? " · " + formatDuration(run.durationMs) : "");
  g.innerHTML = _groupHead(isOpen,
    '<span class="run-title">' + escapeHtml(run.title) + "</span>" +
    '<span class="run-label"' + (run.label ? ' title="' + escapeAttr(run.label) + '"' : "") + ">" + escapeHtml(run.label) + "</span>" +
    (isPattern ? '<span class="run-pattern-badge" title="' + escapeAttr(PATTERN_TITLE) + '">Pattern</span>' : "") +
    '<span class="run-status run-status-' + run.status + '">' + escapeHtml(RunsModel.STATUS_LABELS[run.status]) + "</span>" +
    '<span class="run-meta">' + escapeHtml(meta) + "</span>");
  _wireHead(g, run.caseId);

  // The P1 probe line sits on the pattern run once it is confirmed, open or
  // not: the number the owner reads and copies.
  if (isPattern && patternConfirmed) g.appendChild(_probeEl(stats, model, run, rec));
  if (!isOpen) return g;

  const body = _groupBody(visible, run.hiddenCount,
    run.hiddenCount ? "Every step of this run is hidden." : "No steps in this run.");
  const acts = body.querySelector(".run-actions");
  const canConfirm = run.status === "draft" || (isPattern && !patternConfirmed && run.visible.length > 0);
  const buttons = [];
  if (canConfirm) {
    buttons.push(_actionBtn("confirm-run", "Confirm run", "primary",
      "Accept this run's remaining drafted steps as they are (Ctrl+Enter). Ctrl+Z undoes it.",
      () => confirmRunAction(run.caseId)));
  }
  if (!isPattern && run.members.length) {
    buttons.push(_actionBtn("use-pattern", "Use as pattern", "",
      "Make this the run you confirm first. The boundary fix count starts again at zero.",
      () => usePatternAction(run.caseId)));
  }
  for (const b of buttons.reverse()) acts.insertBefore(b, acts.firstChild);
  if (isPattern && !patternConfirmed) {
    const f = RunsModel.probeLine(stats, model.runs, run, rec);
    const line = document.createElement("div");
    line.className = "run-fixes";
    line.title = FIXES_TITLE;
    line.textContent = "Boundary fixes so far: " + f.total + " (merge " + f.fixes.merge + ", split " +
      f.fixes.split + ", add " + f.fixes.add + ", drop " + f.fixes.drop + ")";
    body.insertBefore(line, acts.nextSibling);
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
    '<span class="run-title">Outside runs</span><span class="run-label"></span>' +
    '<span class="run-meta">' + escapeHtml(_plural(vis.length, "step", "steps")) + "</span>",
    "Steps that fall outside every marked run");
  _wireHead(g, OUTSIDE);
  if (isOpen) g.appendChild(_groupBody(visible, hidden, "Every step outside the runs is hidden."));
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

/* The probe line, readable and copyable (the owner's P1 instrument). */
function _probeEl(stats, model, run, rec) {
  const p = RunsModel.probeLine(stats, model.runs, run, rec);
  const why = p.source === "analysis"
    ? "Drafted steps: how many steps the analysis drafted for this run."
    : p.source === "designation"
      ? "Drafted steps: the analysis file does not record how many steps it drafted, so this is the number of steps the run had when it became the pattern."
      : "The drafted step count is not recorded; analyze the session again to record it.";
  const box = document.createElement("div");
  box.className = "run-probe";
  box.innerHTML = '<span class="run-probe-text" title="' + escapeAttr(why + " Boundary fixes: the merges, splits, " +
    "added steps and dropped drafts made to the run from when it became the pattern until you confirmed it.") + '">' +
    escapeHtml(p.text) + "</span>";
  box.appendChild(_actionBtn("copy-probe", "Copy", "run-probe-copy", "Copy this line",
    () => { if (_copyText(p.text)) toast("Copied: " + p.text, "success"); else toast("Could not copy the line.", "error"); }));
  return box;
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
  "This is the pattern run: confirm it first. Check its drafted steps against the video or the screenshots. " +
  "Where a boundary is wrong, merge, split, add or hide steps, and give the steps the names you want in the " +
  "document. Then click Confirm run. The app counts the boundary fixes; renames are not counted.";
const GUIDE_REMEMBER =
  "Every name you give is remembered: the matching drafted steps in the other runs take it at once, and the " +
  "next analysis drafts with it.";
const GUIDE_PATTERN_DONE =
  "The pattern run is confirmed. The other runs keep their drafted steps; a name you give a step there is " +
  "remembered the same way.";
const GUIDE_OTHER =
  "Pick a step to rename it, fix its boundaries, or flag it as waste. Confirm run accepts the drafted steps " +
  "that are left.";
const GUIDE_OUTSIDE =
  "These steps fall outside every marked run. To bring them into a run, add a start marker in Flow and " +
  "analyze the session.";

function renderRunGuide(host, model, pattern) {
  if (!host) return;
  const key = _ui.open;
  const title = $("#step-detail-title");
  let head = "", paras = [];
  if (key === OUTSIDE) {
    head = "Outside runs";
    paras = [GUIDE_OUTSIDE];
  } else if (key) {
    const run = model.runs.find((r) => r.caseId === key);
    const isPattern = !!(run && pattern.run && pattern.run.caseId === key);
    const done = isPattern && pattern.record && pattern.record.confirmed_at;
    head = run ? run.title + (run.label ? " (" + run.label + ")" : "") : "Run";
    paras = isPattern ? (done ? [GUIDE_PATTERN_DONE] : [GUIDE_PATTERN, GUIDE_REMEMBER]) : [GUIDE_OTHER, GUIDE_REMEMBER];
  } else {
    paras = [model.runs.length ? "Pick a run on the left to see its steps." : "Pick a step on the left."];
  }
  if (title) title.textContent = head || "Steps";
  host.innerHTML = '<div class="empty-pane run-guide">' + paras.map((p, i) =>
    "<p" + (i ? ' class="meta"' : "") + ">" + escapeHtml(p) + "</p>").join("") + "</div>";
}

/* The Steps mini-timeline: the full set as context, the steps the list does
   not show dimmed, so the open run stands out. */
function _renderStepsMiniTimeline(allSteps, visibleIds) {
  const span = getSpan();
  if (!span) return;
  const dimmedIds = new Set();
  if (_ui.open != null) for (const s of allSteps) if (!visibleIds.has(s.step_id)) dimmedIds.add(s.step_id);
  PdtSteps.renderStepTimeline($("#timeline-steps"), allSteps,
    State.getSession().events.filter(e => e.type === "interaction"), span, {
      zoom: State.getStepZoom(),
      selectedId: State.getSelectedStepId(),
      dimmedIds,
      onSelect: (sid) => { _selectAndReveal(sid); renderStepsLevel(); },
      onContextMenu: (sid, x, y) => showStepContextMenu(sid, x, y),
    });
  const range = $("#steps-timeline-range");
  if (range) {
    const fmt = (ms) => new Date(ms).toLocaleTimeString();
    range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
  }
}

/* R1 triage economics: a resident "App / Screen" fact for the step detail
   panel's fact line. Prefers the pipeline-stamped grain_keys (screen already
   value-freed at stamp time is not guaranteed, so re-apply screenType -- the
   same read-only helper the map's screen axis uses, imported but never
   mutated here); falls back to resolving live from the step's interactions
   for older sessions/hand-authored steps (mirrors process-map-levels' own
   _containmentKeys fallback). Never touches process-map-levels.js. */
function stepAppScreenFact(step, interactionsById) {
  if (!step) return "";
  const keys = (step.grain_keys && typeof step.grain_keys === "object")
    ? step.grain_keys
    : resolveStepGrainKeys(step, interactionsById || {});
  const app = (keys.app || "").trim();
  const screen = screenType(keys.screen || "").trim();
  if (app && screen && screen !== "(screen)") return app + " - " + screen;
  return app || (screen && screen !== "(screen)" ? screen : "");
}

/* The run a step belongs to, as the detail pane names it. */
function _runLabelFor(step, model) {
  const run = step && model.runs.find((r) => r.caseId === step.case_id);
  if (!run) return "Outside runs";
  return run.title + (run.label ? " (" + run.label + ")" : "");
}

/* The callbacks the per-step detail editor needs. */
function stepDetailCallbacks(selected, interactionsById, model) {
  return {
    onSave: saveStep,
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
    // R1 triage economics: resident one-line facts (duration/start/end already
    // came from time_range; these two are the added app/screen + run facts).
    appScreenFact: stepAppScreenFact(selected, interactionsById),
    runLabel: _runLabelFor(selected, model || _model()),
    // C4: the name input suggests remembered and already-used names.
    nameListId: NAME_LIST_ID,
  };
}

/* ===== Names: rename, remember, propagate (C4) ======================== */

/* The one rename rule, for every entry point (inline rename, the detail
   form): the step becomes an analyst state and its map label follows the
   name; when it carries a draft_key, every other still-draft step with that
   key takes the name at once. Returns { key, propagated } (key: the
   draft_key to remember, or null). */
function _applyRename(anno, step, name) {
  step.name = name;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  const pl = processLabel(name);
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
  toast("The new name is saved in this session, but it could not be remembered for later analyses: " +
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

async function saveStep(updatedStep) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  const before = idx >= 0 ? anno.steps[idx] : null;
  const newName = String(updatedStep.name || "").trim();
  const renamed = !!(before && newName && newName !== String(before.name || "").trim());
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  const r = renamed ? _applyRename(anno, updatedStep, newName) : { key: null, propagated: 0 };
  let saved = true;
  try { await persistAnnotations(anno, 'save step'); } catch (_) { saved = false; }   // already shown
  if (r.key) await _rememberName(r.key, newName);
  if (saved) toast(renamed ? "Step saved. " + _renamedToast(r.propagated) : "Step saved", "success");
}

/* ===== Boundary verbs (counted on the pattern run, C3) ================ */

/* Taking a step out (hide or delete) is a dropped draft, or, for a step the
   analyst added, the add taken back. */
function _removalFix(state) {
  return state === "manually_authored" ? { kind: "add", delta: -1 } : { kind: "drop", delta: 1 };
}

async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  const ok = await confirmModal({
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "Ctrl+Z will restore it. To keep a drafted step out of the next analysis too, hide it instead.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (step && step.state !== "hidden") {
    const f = _removalFix(step.state);
    RunsModel.recordFix(anno, _model().runs, step.case_id, f.kind, f.delta);
  }
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
  if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
  await persistAnnotations(anno, 'delete step');
  toast("Step deleted", "success");
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
    if (State.getSelectedStepId() === stepId && !_ui.showHidden) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    toast('Step hidden. "Show hidden steps" on its run lists it again.', "success");
  }
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

  // No steps yet: carve the whole session in two at the playhead.
  if (!anno.steps.length) {
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
    time_range: { start: startISO, end: endISO },
    evidence: { interaction_event_ids: eventIds, screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
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
   must not produce a paragraph. The merged step is no longer one draft, so
   it carries no draft identity. */
function mergeStepObjects(toMerge) {
  const first = toMerge[0];
  const last = toMerge[toMerge.length - 1];
  const parts = [];
  for (const s of toMerge) {
    const n = stripSplitSuffix(s.name);
    if (n && !parts.includes(n)) parts.push(n);
  }
  let mergedName = parts.join(" + ") || stripSplitSuffix(first.name);
  if (mergedName.length > 120) mergedName = mergedName.slice(0, 119) + "…";
  return RunsModel.dropDraftIdentity({
    ...first,
    name: mergedName,
    time_range: { start: first.time_range.start, end: last.time_range.end },
    evidence: {
      ...first.evidence,
      interaction_event_ids: toMerge.flatMap(s => (s.evidence && s.evidence.interaction_event_ids) || []),
      screenshot_refs: toMerge.flatMap(s => (s.evidence && s.evidence.screenshot_refs) || []),
    },
    state: "edited",
  });
}

async function commitMerge(anno, toMerge, undoLabel) {
  RunsModel.recordFix(anno, _model().runs, toMerge[0].case_id, "merge");
  const merged = mergeStepObjects(toMerge);
  const mergedIds = new Set(toMerge.map(s => s.step_id));
  anno.steps = anno.steps.filter(s => !mergedIds.has(s.step_id));
  anno.steps.push(merged);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, undoLabel);
  return merged;
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
  if (!next) { toast("This is the last step of its run: there is no next step to merge with.", "error"); return; }
  const toMerge = [step, next];
  await commitMerge(anno, toMerge, 'merge step with next');
  toast('Merged "' + toMerge[0].name + '" + "' + toMerge[1].name + '"', "success");
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
    toast("Select steps from one run to merge them.", "error");
    return;
  }
  const merged = await commitMerge(anno, toMerge, 'merge selected steps');
  multi.clear();
  syncMultiSelectButtons();
  toast('Merged ' + toMerge.length + ' steps into "' + merged.name + '"', "success");
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
}

/* Where a step added from the toolbar goes when no video playhead places
   it: into the open run, right after the selected step (or after the run's
   last step), ending before the next step so it never covers a drafted
   step. Returns { startMs, endMs, caseId } or null. */
function _anchorInOpenRun(model) {
  const run = model.runs.find((r) => r.caseId === _ui.open);
  if (!run) return null;
  const list = run.visible;
  const after = list.find((s) => s.step_id === State.getSelectedStepId()) || list[list.length - 1] || null;
  let startMs = after ? new Date(after.time_range && after.time_range.end).getTime() : run.startMs;
  if (!isFinite(startMs)) startMs = run.startMs;
  if (!isFinite(startMs)) return null;
  const later = run.members
    .map((s) => new Date(s.time_range && s.time_range.start).getTime())
    .filter((ms) => isFinite(ms) && ms > startMs);
  let endMs = startMs + 5000;
  if (later.length) endMs = Math.min(endMs, Math.min(...later));
  if (run.endMs != null) endMs = Math.min(endMs, run.endMs);
  return { startMs, endMs: Math.max(startMs, endMs), caseId: run.caseId };
}

async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add step", message: "Name this step", placeholder: "For example: Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const model = _model();
  const video = $("#video");
  const tsNow = video ? videoTimeToSessionTs(video.currentTime) : null;   // #video may be absent
  let startMs, endMs, caseId;
  if (tsNow) {
    // The video playhead places it; it belongs to the run that contains it.
    startMs = new Date(tsNow).getTime();
    endMs = startMs + 5000;
    const r = RunsModel.runForRange(model.runs, startMs, endMs);
    caseId = r ? r.caseId : null;
  } else {
    const a = _anchorInOpenRun(model);
    if (a) {
      ({ startMs, endMs, caseId } = a);
    } else {
      // No video and no open run: drop the step at the end of the recorded
      // span (after any existing step) rather than wall-clock now, which
      // would land far past the timeline.
      const span = getSpan();
      startMs = span ? span.endMs : Date.now();
      for (const s of anno.steps) {
        const end = s.time_range && s.time_range.end && new Date(s.time_range.end).getTime();
        if (end && end > startMs) startMs = end;
      }
      endMs = startMs + 5000;
      caseId = null;
    }
  }
  const step = makeStep(name.trim(), new Date(startMs).toISOString(), new Date(endMs).toISOString(), [], caseId);
  RunsModel.recordFix(anno, model.runs, caseId, "add");
  anno.steps.push(step);
  if (caseId && _ui.open !== caseId) _openGroup(caseId);
  State.setSelectedStepId(step.step_id);
  await persistAnnotations(anno, 'add step');
  toast("Step added", "success");
}

/* Bulk-delete the ticked steps. One confirm for the whole set; Ctrl+Z
   restores. */
async function deleteSelectedSteps() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  const ok = await confirmModal({
    title: "Delete " + ids.length + " steps?",
    message: "Delete the " + ids.length + " selected steps?",
    detail: "Ctrl+Z restores them all.",
    okLabel: "Delete " + ids.length,
    danger: true,
  });
  if (!ok) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idSet = new Set(ids);
  const runs = _model().runs;
  for (const s of anno.steps) {
    if (!idSet.has(s.step_id) || s.state === "hidden") continue;
    const f = _removalFix(s.state);
    RunsModel.recordFix(anno, runs, s.case_id, f.kind, f.delta);
  }
  anno.steps = anno.steps.filter(s => !idSet.has(s.step_id));
  if (idSet.has(State.getSelectedStepId())) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  await persistAnnotations(anno, "delete " + ids.length + " steps");
  syncMultiSelectButtons();
  toast(ids.length + " steps deleted", "success");
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
  try { await persistAnnotations(anno, "confirm run"); } catch (_) { return; }   // already shown
  toast(run.title + " confirmed" +
    (r.converted ? ": " + _plural(r.converted, "drafted step", "drafted steps") + " accepted" : "") +
    ". Ctrl+Z undoes it.", "success");
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
      title: "Use " + run.title + " as the pattern?",
      message: cur.run.title + " is the pattern run now. Its boundary fix count" +
        (cur.record.confirmed_at ? " and its confirmation are" : " is") + " replaced.",
      detail: "Ctrl+Z undoes it.",
      okLabel: "Use as pattern",
    });
    if (!ok) return;
  }
  RunsModel.usePattern(anno, model.runs, caseId);
  try { await persistAnnotations(anno, "use run as pattern"); } catch (_) { return; }   // already shown
  toast(run.title + " is now the pattern run. The boundary fix count starts at zero.", "success");
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

/* ===== Ignored apps (step-noise denylist) =====
   Apps the analyst checks here are written to annotations.json under
   step_filters.ignored_processes; step_suggest.py drops their
   interactions before step suggestion. Saving re-analyzes the session
   so the step list refreshes immediately. */
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
  if (!State.getSession()) { toast("Open a session first.", ""); return; }
  const apps = distinctSessionApps();
  if (!apps.length) {
    toast("No interaction data in this session: nothing to filter.", "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal modal-simple" role="dialog">' +
      '<header class="modal-header"><h2>Ignored apps</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta" style="margin-top:0">Apps you tick here are left out of step suggestions: useful for OBS, the tracker itself, or anything that isn\'t part of the process you\'re mapping. Saving re-analyzes the session.</p>' +
        '<div id="ia-list" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button id="ia-cancel">Cancel</button>' +
        '<button id="ia-save" class="primary">Save &amp; re-analyze</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  const list = backdrop.querySelector("#ia-list");
  list.innerHTML = apps.map((a, i) => {
    const checked = current.has(a.proc.toLowerCase()) ? " checked" : "";
    return '<label class="cb" style="display:flex;gap:8px;padding:5px 4px;align-items:center">' +
      '<input type="checkbox" data-proc="' + escapeHtml(a.proc) + '"' + checked + ' />' +
      '<span style="flex:1">' + escapeHtml(a.proc) + '</span>' +
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
      ? "Ignoring " + picked.length + " app(s): re-analyzing..."
      : "No apps ignored: re-analyzing...", "success");
    // Re-analyze so the step list reflects the new denylist.
    const normBtn = $("#btn-normalize");
    if (normBtn) normBtn.click();
  });
}

/* Wire the Steps surface. deps = { ensureAnnoShape, persistAnnotations,
   videoTimeToSessionTs, jumpToStepInFlow, watchStep }. Call once at boot. */
function initStepsView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  videoTimeToSessionTs = deps.videoTimeToSessionTs;
  jumpToStepInFlow = deps.jumpToStepInFlow;
  watchStep = deps.watchStep || (() => {});

  if ($("#btn-add-manual-step")) $("#btn-add-manual-step").addEventListener("click", addManualStep);
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-merge-selected")) $("#btn-merge-selected").addEventListener("click", mergeSelectedSteps);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
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
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, (step.flags[flagKey] ? "flag " : "unflag ") + flagKey);
  toast(step.flags[flagKey] ? "Flagged" : "Flag cleared", "success");
}

/* A5: right-click context menu for a step, from its list row or its block
   on the step timeline. Mirrors the inline-styled menu pattern used by the
   Flow timeline (flow-view.js showMarkerInsertMenu) for visual consistency.
   The step is revealed first (its run opens), so every item acts on a step
   the list shows. */
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
  menu.style.left = x + "px";
  menu.style.top = y + "px";

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
  addItem(step.state === "hidden" ? "Unhide" : "Hide as noise", () => toggleStepHidden(stepId));
  addItem("Jump to in Flow", () => {
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
  addItem(flags.automation_candidate ? "Clear automation flag" : "Flag as automation candidate",
    () => toggleStepFlag(stepId, "automation_candidate"));

  document.body.appendChild(menu);
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
  visibleSelectedStepId, moveSelection, renameSelectedStep, confirmOpenRun,
  // G-4 label hygiene -- pure, exported for unit testing.
  stripSplitSuffix, mergeStepObjects,
};
