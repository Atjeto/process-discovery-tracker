/*
 * timeline-pane.js: the pane beside the video on the Timeline (lane PANE,
 * plan section 11.2; the owner: "The timeline is the core, the center of
 * edit"). One place with a tab for each kind of thing the project holds:
 *   Steps (n): every step in the order of the process, also the steps
 *     without a time, grouped by transaction where transactions are marked
 *     (each group's header carries the transaction's name, its times as
 *     Steps types them, Rename and Delete transaction: the acts of the
 *     Markers tab, which is gone). A row opens its step IN PLACE, drawn and
 *     saved by the Steps editor's own code (steps-view.js renderStepInto),
 *     with All steps, Previous, Next, "Step 3 of 7" and Open in Steps above
 *     it, and Steps' own Split..., Merge with next, Hide step and Delete
 *     under it. A step without a time offers Starts here (the act the
 *     Timeline's right-click "<step>" starts here does, on that step).
 *   Transcript: the transcript tab of lane E (flow-view-transcript.js).
 *   Screenshots (n): the grid and the gallery (flow-view-screenshots.js).
 *   Notes (n): every note in the order of the clock, with Edit and Delete.
 *   Files (n): every attached file, with Open and Remove.
 * A click on a lane's item opens its tab at that item (a step band, a
 * screenshot, a note; flow-view-timeline.js); a click in a tab goes to its
 * moment, a paused video staying paused. The tab chosen is kept while the
 * window lives; a project opens the pane on Steps. The step panel no longer
 * opens on this level (step-panel.js opensOn).
 *
 * The pure side (the rows, the counts, the hint line, the acts) is
 * pane-lists.js. Requires steps-view.js and flow-view.js lazily: they
 * require this module's neighbours.
 */

"use strict";

const State = require("../state.js");
const { escapeHtml, escapeAttr, recordingStartMs, sinceStart } = require("../dom.js");
const PL = require("../pane-lists.js");
const AC = require("../analyst-content.js");
const RO = require("../read-only.js");
const SPM = require("../sub-process-maps.js");
const StepOrder = require("../step-order.js");
const StepFacts = require("../step-facts.js");
const SystemNames = require("../system-names.js");
const MarkerEdits = require("../marker-edits.js");
const TE = require("../time-edits.js");
const { mapNodeLabel } = require("../process-map-levels.js");
const Video = require("./flow-view-video.js");
const AnalystUI = require("./analyst-ui.js");
const StepPanel = require("./step-panel.js");
const FlowMarkers = require("./flow-view-markers.js");
const { timelineScreenshots } = require("./flow-view-screenshots.js");

const Steps = () => require("./steps-view.js");

/* The tabs, in their order, and the names they read. */
const TABS = ["steps", "transcript", "screens", "notes", "files"];
const TAB_NAMES = { steps: "Steps", transcript: "Transcript", screens: "Screenshots", notes: "Notes", files: "Files" };

/* The words of the pane (lane PANE: the brief's text, word for word, and
   Steps' own for its acts). */
const TEXT = {
  rowTitle: "Opens this step.",
  startsHere: "Starts here",
  startsHereTitle: "Sets the start of this step to the moment the video shows now.",
  addStep: "Add step",
  addStepTitle: "Adds a step by hand, without a time.",
  allSteps: "All steps",
  previous: "Previous",
  previousTitle: "Opens the step before this one.",
  next: "Next",
  nextTitle: "Opens the step after this one.",
  openInSteps: "Open in Steps",
  openInStepsTitle: "Opens this step in Steps, where its flow and its sub-process are edited.",
  alsoIn: "Also happens in",
  goThere: "Go there",
  goThereTitle: "Opens this step in that transaction.",
  addNote: "Add note",
  addNoteTitle: "Adds a note at this moment. Notes stay out of the PDD.",
  noNotes: "No notes yet. A note sits on a step or at a moment, and stays out of the PDD.",
  attach: "Attach file...",
  attachTitle: "Copies a file into the project and lists it in the PDD.",
  noFiles: "No files attached yet. An attached file is copied into the project and listed in the PDD.",
  rename: "Rename",
  renameTitle: "Changes the name of this transaction.",
  deleteTx: "Delete transaction",
  deleteTxTitle: "Deletes this transaction: its stretch of the timeline is no longer a transaction of its own. Ctrl+Z brings it back.",
  reference: "Reference",
  referenceTitle: "The reference transaction: confirm it. Its step names carry over to the other transactions, which are compared with it.",
  outside: "Outside the transactions",
  now: "now",
  goToMoment: "Goes to this moment.",
  editNote: "Edit",
  editNoteTitle: "Changes the text of this note.",
  deleteNote: "Delete",
  deleteNoteTitle: "Deletes this note. Ctrl+Z brings it back.",
  openFile: "Open",
  openFileTitle: "Opens the file.",
  removeFile: "Remove",
  removeFileTitle: "Takes this file out of the project. Ctrl+Z brings it back.",
};

/* The pane's own state: the tab shown, the step opened in place (null: the
   list), the row it was opened from (the focus goes back there), the row to
   focus after the next draw, and the project it belongs to. */
const _p = { tab: "steps", openId: null, fromId: null, focusId: null, folder: null };

const $ = (id) => document.getElementById(id);

function _sess() { return State.getSession(); }
function _onTimeline() { return State.getLevel() === "flow"; }
function _ro() { return RO.isReadOnly(_sess()); }

/* A step by id at any level, or null. */
function _hit(id) {
  const s = _sess();
  return id && s ? SPM.findStep((s.annotations && s.annotations.steps) || [], id) : null;
}
function _step(id) { const h = _hit(id); return h ? h.step : null; }

function _inter() {
  const m = {};
  for (const ev of ((_sess() && _sess().events) || [])) if (ev && ev.type === "interaction") m[ev.event_id] = ev;
  return m;
}

function _appNames() {
  const s = _sess();
  return (s && s.stats && s.stats.meta && s.stats.meta.app_names) || {};
}

/* A transaction's name as Steps' guide reads it: "Transaction 2 (Order
   #12)". */
function _txName(run, label) {
  const l = label != null ? label : run.label;
  return run.title + (l ? " (" + l + ")" : "");
}

/* The groups the Steps tab lists, and the project they are read from. */
function _groups() {
  const P = Steps().paneProject();
  return { P, groups: PL.stepGroups(P.model, P.refCaseId, P.implicitId) };
}

/* The steps beside a step, for Previous and Next: its group of the list;
   below the main level (a sub-step opened from its band), its level's
   visible steps of its transaction in the order of the process. */
function _siblings(groups, stepId) {
  const g = PL.groupOf(groups, stepId);
  if (g) return { group: g, steps: g.steps };
  const hit = _hit(stepId);
  if (!hit) return { group: null, steps: [] };
  const key = (x) => (x && typeof x.case_id === "string" && x.case_id ? x.case_id : null);
  const list = hit.list.filter((x) => x && x.state !== "hidden" && (hit.depth || key(x) === key(hit.step)));
  return { group: null, steps: StepOrder.processOrder(list) };
}

/* ---- The tabs ------------------------------------------------------------ */

function _tabEl(name) { return $("tp-tab-" + name); }

/* Show tab `name` (the chosen one stays chosen while the window lives).
   `focus`: the tab takes the focus (the arrow keys). */
function showTab(name, opts) {
  const want = TABS.includes(name) ? name : "steps";
  _p.tab = want;
  for (const t of TABS) {
    const tab = _tabEl(t);
    const panel = $("tp-panel-" + t);
    const on = t === want;
    if (tab) {
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    if (panel) panel.style.display = on ? "" : "none";
  }
  if (opts && opts.focus && _tabEl(want)) _tabEl(want).focus();
  if (want === "transcript") require("./flow-view-transcript.js").tickTab(true);
  render();
}

/* The counts in the tabs' labels; where the five do not fit on one line,
   the counts drop (the names stay). */
function _syncTabs(counts) {
  for (const t of TABS) {
    const tab = _tabEl(t);
    if (!tab) continue;
    const n = counts[t];
    const name = tab.querySelector(".tp-tab-name");
    const count = tab.querySelector(".tp-count");
    if (name && name.textContent !== TAB_NAMES[t]) name.textContent = TAB_NAMES[t];
    if (count) {
      const text = Number.isFinite(n) ? " (" + n + ")" : "";
      if (count.textContent !== text) count.textContent = text;
    }
    tab.setAttribute("aria-label", PL.tabLabel(TAB_NAMES[t], n));
  }
  _fitTabs();
}
function _fitTabs() {
  const list = $("tp-tabs");
  if (!list || !list.offsetParent) return;
  list.classList.remove("short");
  if (list.scrollWidth > list.clientWidth + 1) list.classList.add("short");
}

/* ---- Drawing --------------------------------------------------------------- */

/* Draw the pane (only while the Timeline shows; elsewhere the step opened in
   place lets the editor go, so Steps can draw it in its own pane). */
function render() {
  const s = _sess();
  if (!s) return;
  if (s.sessionFolder !== _p.folder) {
    _p.folder = s.sessionFolder;
    _p.openId = null; _p.fromId = null; _p.focusId = null;
    _p.tab = "steps";
    showTab("steps");
    return;
  }
  const editor = $("tp-editor");
  if (!_onTimeline()) {
    if (editor && editor.childElementCount) { editor.innerHTML = ""; delete editor.dataset.stepId; }
    return;
  }
  const { P, groups } = _groups();
  const listed = PL.listedSteps(groups);
  _listed = listed;
  const notes = PL.noteRows((s.annotations || {}).analyst_notes, _step);
  const files = PL.fileRows((s.annotations || {}).attachments, _step);
  _syncTabs({ steps: listed.length, screens: timelineScreenshots(s).length, notes: notes.length, files: files.length });
  if (_p.tab === "steps") _renderSteps(P, groups, listed);
  else if (_p.tab === "notes") _renderNotes(notes);
  else if (_p.tab === "files") _renderFiles(files);
  _markScreens();
}

/* ---- The Steps tab: the list ----------------------------------------------- */

function _look() {
  const s = _sess();
  const inter = _inter();
  const names = _appNames();
  const origin = recordingStartMs(s);
  return {
    systemOf: (st) => SystemNames.whereOfStep(st, inter, names).system,
    narration: (st) => StepFacts.isDraftedDescription(st.description, StepFacts.stepDatas(st, inter)),
    startText: (st) => (AC.hasTime(st) ? sinceStart(st.time_range.start, origin) : ""),
    isOpen: (st) => Steps().isStepOpen(st),
  };
}

function _btn(cls, text, title, data) {
  return '<button type="button" class="' + cls + '"' + (title ? ' title="' + escapeAttr(title) + '"' : "") +
    Object.entries(data || {}).map(([k, v]) => " data-" + k + '="' + escapeAttr(v) + '"').join("") + ">" + escapeHtml(text) + "</button>";
}

function _rowHtml(row, current) {
  const selected = row.id === State.getSelectedStepId();
  return '<li class="tp-item" data-step-id="' + escapeAttr(row.id) + '">' +
    '<button type="button" class="tp-row' + (row.id === current ? " now" : "") + '" data-step-id="' + escapeAttr(row.id) + '" tabindex="-1"' +
      ' title="' + escapeAttr(TEXT.rowTitle) + '"' + (selected ? ' aria-current="true"' : "") + ">" +
      '<span class="tp-num">' + row.num + "</span>" +
      '<span class="tp-main"><span class="tp-name">' + escapeHtml(row.name) + "</span>" +
        '<span class="tp-meta">' + escapeHtml(row.meta) + "</span></span>" +
      (row.draft ? '<span class="step-chip step-chip-draft tp-draft">' + escapeHtml(PL.WORDS.draft) + "</span>" : "") +
      '<span class="tp-when">' + escapeHtml(row.when) + "</span>" +
      '<span class="tp-now">' + escapeHtml(TEXT.now) + "</span>" +
    "</button>" +
    (row.startsHere ? _btn("tp-here", TEXT.startsHere, TEXT.startsHereTitle, { here: row.id }).replace("<button", '<button tabindex="-1"') : "") +
    "</li>";
}

/* A transaction's header: its name, Reference, its times (Steps' own
   fields, steps-view.js _runTimesEl), Rename and Delete transaction, and why
   the capture app ended it when it did so by itself. */
function _headerEl(g, sess) {
  const run = g.run;
  const sides = TE.runSides(run, MarkerEdits.sessionMarkerView(sess));
  const start = sides.start;
  const label = start && start.pending ? (start.label || "") : run.label;
  const why = sides.end ? FlowMarkers.markerReasonText(sides.end.reason) : "";
  const el = document.createElement("div");
  el.className = "tp-tx-head";
  el.dataset.caseId = run.caseId;
  const editable = !_ro() && !!start;
  el.innerHTML =
    '<div class="tp-tx-line">' +
      '<span class="tp-tx-name" role="heading" aria-level="3">' + escapeHtml(_txName(run, label)) + "</span>" +
      (g.isRef ? '<span class="run-pattern-badge" title="' + escapeAttr(TEXT.referenceTitle) + '">' + escapeHtml(TEXT.reference) + "</span>" : "") +
      (editable ? _btn("link-btn tp-tx-rename", TEXT.rename, TEXT.renameTitle) + _btn("link-btn tp-tx-delete", TEXT.deleteTx, TEXT.deleteTxTitle) : "") +
    "</div>" +
    (why ? '<p class="tp-tx-why">' + escapeHtml("Ended by itself: " + why + ".") + "</p>" : "");
  const times = Steps().runTimesEl(run);
  if (times) el.appendChild(times);
  if (editable) {
    el.querySelector(".tp-tx-rename").addEventListener("click", () => _beginRename(el, start));
    el.querySelector(".tp-tx-delete").addEventListener("click", () => FlowMarkers.deleteMarker(start));
  }
  return el;
}

/* Rename: the name becomes a field; Enter (or leaving it) saves, Escape
   leaves it as it was. */
function _beginRename(head, start) {
  const name = head.querySelector(".tp-tx-name");
  if (!name || head.querySelector(".tp-tx-input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tp-tx-input";
  input.value = start.label || "";
  input.setAttribute("aria-label", "Name of this transaction");
  input.title = "The name of this transaction. Saved when you press Enter or leave the field";
  name.replaceWith(input);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== (start.label || "")) FlowMarkers.renameMarker(start, v);
    else render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  input.select();
}

function _renderSteps(P, groups, listed) {
  const host = $("tp-steps");
  if (!host) return;
  // The step opened in place, while it is still there and shown; a step
  // merged away gives its place to the step Steps selected.
  if (_p.openId) {
    let st = _step(_p.openId);
    if (!st || st.state === "hidden") {
      const sel = _step(State.getSelectedStepId());
      _p.openId = sel && sel.state !== "hidden" ? sel.step_id : null;
      st = _p.openId ? sel : null;
    }
    if (st) { _renderOpened(host, st, groups); return; }
  }
  _renderList(host, P, groups, listed);
}

function _renderList(host, P, groups, listed) {
  const s = _sess();
  const ro = _ro();
  const hasVideo = !!s.recordingAvailable;
  const recorded = AC.hasRecording(s);
  const keepScroll = host.querySelector(".tp-scroll");
  const scrollTop = keepScroll ? keepScroll.scrollTop : 0;
  const hadFocus = host.contains(document.activeElement) ? (document.activeElement.closest("[data-step-id]") || {}).dataset : null;
  const acts = PL.listActs({ readOnly: ro, hasVideo, recorded, canConfirm: P.canConfirm, canUndoConfirm: P.canUndoConfirm });
  const SV = Steps();
  const tools = [
    acts.pasteNotes ? _btn("tp-paste", "Paste notes...", document.getElementById("btn-paste-notes") ? document.getElementById("btn-paste-notes").title : "") : "",
    acts.addStep ? _btn("tp-add", TEXT.addStep, TEXT.addStepTitle) : "",
    acts.confirm ? _btn("primary tp-confirm", "Confirm transaction", SV.ACT_TITLES.confirm) : "",
    acts.undoConfirm ? _btn("link-btn tp-undo-confirm", "Undo confirm", SV.ACT_TITLES.undoConfirm) : "",
  ].filter(Boolean).join("");
  const hint = PL.stepsHint({ hasVideo, recorded, total: listed.length, untimed: PL.untimedCount(listed) });
  const current = (PL.stepAt(listed, Video.playheadMs()) || {}).step_id || null;
  const look = _look();
  const ctx = { hasVideo, readOnly: ro };
  host.innerHTML = (tools ? '<div class="tp-tools">' + tools + "</div>" : "") +
    (hint ? '<p class="tp-hint">' + escapeHtml(hint) + "</p>" : "") +
    '<div class="tp-scroll"></div>';
  const scroll = host.querySelector(".tp-scroll");
  const marked = groups.some((g) => g.run);
  for (const g of groups) {
    const box = document.createElement("div");
    box.className = "tp-group" + (g.isRef ? " ref" : "");
    if (g.run) box.appendChild(_headerEl(g, s));
    else if (marked && g.key === "__outside__") {
      box.innerHTML = '<div class="tp-tx-head"><div class="tp-tx-line"><span class="tp-tx-name" role="heading" aria-level="3">' +
        escapeHtml(TEXT.outside) + "</span></div></div>";
    }
    const ul = document.createElement("ul");
    ul.className = "tp-list";
    ul.setAttribute("aria-label", g.run ? _txName(g.run) : "Steps");
    ul.innerHTML = g.steps.map((st, i) => _rowHtml(PL.stepRow(st, i, look, ctx), current)).join("");
    box.appendChild(ul);
    scroll.appendChild(box);
  }
  // One Tab stop: the row it was on, else the selected one, else the first.
  const rows = Array.from(host.querySelectorAll(".tp-row"));
  const want = _p.focusId || (hadFocus && hadFocus.stepId) || State.getSelectedStepId();
  const stop = rows.find((r) => r.dataset.stepId === want) || rows[0] || null;
  if (stop) _setStop(stop);
  scroll.scrollTop = scrollTop;
  const focusNow = _p.focusId || (hadFocus && hadFocus.stepId && !hadFocus.here ? hadFocus.stepId : null);
  _p.focusId = null;
  if (focusNow && stop && stop.dataset.stepId === focusNow) {
    stop.focus({ preventScroll: true });
    stop.scrollIntoView({ block: "nearest" });
  }
}

/* The roving Tab stop of the list: one row, and its Starts here. */
function _setStop(row) {
  const host = $("tp-steps");
  if (!host) return;
  for (const b of host.querySelectorAll(".tp-row, .tp-here")) b.tabIndex = -1;
  row.tabIndex = 0;
  const here = row.parentElement && row.parentElement.querySelector(".tp-here");
  if (here) here.tabIndex = 0;
}

/* The "now" mark follows the clock, read on the steps the last draw listed
   (the video ticks several times a second). */
let _listed = [];
function tickNow() {
  if (!_onTimeline() || _p.tab !== "steps" || _p.openId) return;
  const host = $("tp-steps");
  if (!host) return;
  const cur = (PL.stepAt(_listed, Video.playheadMs()) || {}).step_id || null;
  for (const r of host.querySelectorAll(".tp-row")) r.classList.toggle("now", r.dataset.stepId === cur);
}

/* ---- The Steps tab: a step opened in place --------------------------------- */

/* "Also happens in": the other transactions the step happens in (the step
   panel's rule, step-panel.js occurrences), each with Go there. In a
   recording only. */
function _alsoHtml(step) {
  const s = _sess();
  if (!AC.hasRecording(s)) return "";
  const hit = _hit(step.step_id);
  const runs = Steps().paneProject().model.runs;
  const occ = StepPanel.occurrences(mapNodeLabel(step), runs, step, hit ? hit.path : [])
    .filter((o) => o.run && o.step.step_id !== step.step_id);
  if (!occ.length) return "";
  const origin = recordingStartMs(s);
  return '<div class="tp-also" role="group" aria-label="' + escapeAttr(TEXT.alsoIn) + '"><div class="step-lead">' + escapeHtml(TEXT.alsoIn) + "</div>" +
    '<ul class="tp-also-list">' + occ.map((o) => '<li><span>' + escapeHtml(_txName(o.run) +
      (AC.hasTime(o.step) ? " at " + sinceStart(o.step.time_range.start, origin) : ", " + PL.WORDS.noTime)) + "</span>" +
      _btn("link-btn tp-go", TEXT.goThere, TEXT.goThereTitle, { go: o.step.step_id }) + "</li>").join("") + "</ul></div>";
}

const VERBS = [
  ["split", "btn-step-split", "Split…"], ["merge", "btn-step-merge", "Merge with next"],
  ["hide", "btn-step-hide", "Hide step"], ["delete", "btn-step-delete", "Delete"],
];

function _renderOpened(host, step, groups) {
  const ro = _ro();
  const sib = _siblings(groups, step.step_id);
  const nb = PL.neighbours(sib.steps, step.step_id) || { index: 0, count: 1, prevId: null, nextId: null };
  let nav = host.querySelector(".tp-nav");
  let editor = $("tp-editor");
  let verbs = host.querySelector(".tp-verbs");
  if (!nav || !editor || !host.contains(editor)) {
    host.innerHTML = '<div class="tp-nav"></div>' +
      '<div id="tp-editor" class="editor-detail-pane tp-editor" tabindex="-1"></div>' +
      '<div class="tp-verbs"></div>';
    nav = host.querySelector(".tp-nav");
    editor = $("tp-editor");
    verbs = host.querySelector(".tp-verbs");
  }
  const dis = (on) => (on ? "" : ' aria-disabled="true"');
  nav.innerHTML = '<button type="button" class="tp-back">‹ ' + escapeHtml(TEXT.allSteps) + "</button>" +
    '<button type="button" class="tp-prev" title="' + escapeAttr(TEXT.previousTitle) + '"' + dis(!!nb.prevId) + ">" + escapeHtml(TEXT.previous) + "</button>" +
    '<button type="button" class="tp-next" title="' + escapeAttr(TEXT.nextTitle) + '"' + dis(!!nb.nextId) + ">" + escapeHtml(TEXT.next) + "</button>" +
    '<span class="tp-pos">Step ' + (nb.index + 1) + " of " + nb.count + "</span>" +
    '<button type="button" class="link-btn tp-open-steps" title="' + escapeAttr(TEXT.openInStepsTitle) + '">' + escapeHtml(TEXT.openInSteps) + "</button>";
  nav.dataset.prev = nb.prevId || "";
  nav.dataset.next = nb.nextId || "";
  Steps().renderStepInto(editor, step, { onTimeline: true, recordingAvailable: false, afterFactsHtml: _alsoHtml(step) });
  if (ro) { verbs.innerHTML = ""; verbs.hidden = true; return; }
  const states = Steps().stepVerbStates(step);
  verbs.hidden = false;
  verbs.innerHTML = VERBS.map(([k, , label]) => '<button type="button" class="tp-verb' + (k === "delete" ? " danger" : "") +
    '" data-verb="' + k + '">' + escapeHtml(label) + "</button>").join("");
  for (const [k, id] of VERBS) Steps().applyVerbState(verbs.querySelector('[data-verb="' + k + '"]'), states[id]);
}

/* Open a step in place: it is selected (everywhere: its band is outlined),
   the Steps tab shows it, and (`seek`, the default) the clock goes to its
   start, a paused video staying paused. `focusName`: its name takes the
   focus, selected (a step just marked while the video is paused). */
function openStep(stepId, opts) {
  const o = opts || {};
  const st = _step(stepId);
  if (!st) return;
  if (!_p.openId || o.from) _p.fromId = o.from || stepId;
  _p.openId = stepId;
  State.setSelectedStepId(stepId);
  _outlineBand(stepId);
  if (o.seek !== false && AC.hasTime(st)) seekTo(Date.parse(st.time_range.start));
  if (_p.tab !== "steps") showTab("steps"); else render();
  if (o.focusName) {
    const el = $("tp-editor") && $("tp-editor").querySelector("#step-name");
    if (el && !el.readOnly) { el.focus(); el.select(); }
  } else if (o.focusEditor) {
    const ed = $("tp-editor");
    if (ed) ed.focus({ preventScroll: true });
  }
}

/* Back to the list, the focus on the row the step was opened from. */
function backToList() {
  const from = _p.fromId || _p.openId;
  _p.openId = null;
  _p.fromId = null;
  _p.focusId = from;
  render();
}

/* The step's band outlined on the timeline, as a click on it outlines it. */
function _outlineBand(stepId) {
  const tl = $("timeline");
  if (!tl) return;
  tl.querySelectorAll(".tl-step-band.tl-step-selected").forEach((b) => b.classList.remove("tl-step-selected"));
  const band = tl.querySelector('.tl-step-band[data-step-id="' + CSS.escape(stepId) + '"]');
  if (band) band.classList.add("tl-step-selected");
}

/* The clock goes to `ms`; a playing video plays on, a paused one stays
   paused; where no video shows the moment, the timeline's playhead goes
   there (the Transcript tab's own rule). */
function seekTo(ms) {
  if (!Number.isFinite(ms)) return;
  const at = Video.clipAtMs(ms);
  if (at && at.clip.file) Video.seekClock(ms);
  else Video.movePlayheadToTimestamp(new Date(ms).toISOString());
}

/* ---- Notes and Files --------------------------------------------------------- */

function _renderNotes(rows) {
  const host = $("tp-notes");
  if (!host) return;
  const s = _sess();
  const ro = _ro();
  const origin = recordingStartMs(s);
  const canAdd = !ro && Video.playheadMs() != null;
  const scroll = host.querySelector(".tp-scroll");
  const top = scroll ? scroll.scrollTop : 0;
  host.innerHTML = (canAdd ? '<div class="tp-tools">' + _btn("tp-add-note", TEXT.addNote, TEXT.addNoteTitle) + "</div>" : "") +
    (rows.length ? '<div class="tp-scroll"><ul class="tp-rows">' + rows.map((r) => '<li class="tp-note-row" data-note-id="' + escapeAttr(r.id) + '">' +
      (Number.isFinite(r.ms)
        ? _btn("link-btn tp-at", sinceStart(new Date(r.ms).toISOString(), origin), TEXT.goToMoment, { ms: String(r.ms) })
        : '<span class="tp-at-none">' + escapeHtml(PL.WORDS.noTime) + "</span>") +
      '<div class="tp-main"><span class="tp-text">' + escapeHtml(r.text) + "</span>" +
        '<span class="tp-meta">' + escapeHtml(r.where) + "</span></div>" +
      (ro ? "" : '<span class="tp-acts">' + _btn("link-btn tp-note-edit", TEXT.editNote, TEXT.editNoteTitle) +
        _btn("link-btn tp-note-delete", TEXT.deleteNote, TEXT.deleteNoteTitle) + "</span>") +
      "</li>").join("") + "</ul></div>"
      : '<p class="tp-hint">' + escapeHtml(TEXT.noNotes) + "</p>");
  const sc = host.querySelector(".tp-scroll");
  if (sc) sc.scrollTop = top;
  _markItem(host, ".tp-note-row", "noteId");
}

function _renderFiles(rows) {
  const host = $("tp-files");
  if (!host) return;
  const ro = _ro();
  host.innerHTML = (ro ? "" : '<div class="tp-tools">' + _btn("tp-attach", TEXT.attach, TEXT.attachTitle) + "</div>") +
    (rows.length ? '<div class="tp-scroll"><ul class="tp-rows">' + rows.map((r) => '<li class="tp-file-row" data-att-id="' + escapeAttr(r.id) + '">' +
      '<div class="tp-main"><span class="tp-text" title="' + escapeAttr(r.file) + '">' + escapeHtml(r.name) + "</span>" +
        (r.stepId ? _btn("link-btn tp-meta tp-file-step", r.where, TEXT.rowTitle, { step: r.stepId }) : '<span class="tp-meta">' + escapeHtml(r.where) + "</span>") +
      "</div>" +
      '<span class="tp-acts">' + _btn("link-btn tp-file-open", TEXT.openFile, TEXT.openFileTitle) +
        (ro ? "" : _btn("link-btn tp-file-remove", TEXT.removeFile, TEXT.removeFileTitle)) + "</span>" +
      "</li>").join("") + "</ul></div>"
      : '<p class="tp-hint">' + escapeHtml(TEXT.noFiles) + "</p>");
}

/* The item a lane's click opened its tab at: marked, and in view. */
let _marked = { kind: null, id: null };
function _markItem(host, sel, key) {
  for (const el of host.querySelectorAll(sel)) {
    const on = _marked.kind === key && el.dataset[key] === _marked.id;
    el.classList.toggle("tp-here-item", on);
    if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
  }
}
function _markScreens() {
  const grid = $("screenshots-grid");
  if (!grid) return;
  for (const el of grid.querySelectorAll(".thumb")) {
    const on = _marked.kind === "rel" && el.dataset.rel === _marked.id;
    el.classList.toggle("tp-here-item", on);
    if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
  }
}

/* A lane's screenshot clicked: the Screenshots tab at that screenshot. */
function showScreenshot(rel) {
  _marked = { kind: "rel", id: rel };
  showTab("screens");
  const grid = $("screenshots-grid");
  const el = grid && Array.from(grid.querySelectorAll(".thumb")).find((t) => t.dataset.rel === rel);
  if (el) el.scrollIntoView({ block: "nearest" });
}

/* A lane's note clicked: the Notes tab at that note. */
function showNote(id) {
  _marked = { kind: "noteId", id };
  showTab("notes");
  const host = $("tp-notes");
  const el = host && Array.from(host.querySelectorAll(".tp-note-row")).find((r) => r.dataset.noteId === id);
  if (el) el.scrollIntoView({ block: "nearest" });
}

/* Everything that opened the Markers tab opens the Steps tab at that
   transaction's header (`caseId`; none: the list). */
function showTransaction(caseId) {
  _p.openId = null;
  showTab("steps");
  const host = $("tp-steps");
  const head = caseId && host ? Array.from(host.querySelectorAll(".tp-tx-head")).find((h) => h.dataset.caseId === caseId) : null;
  if (head) head.scrollIntoView({ block: "nearest" });
}

/* ---- Wiring ------------------------------------------------------------------- */

/* The open step's verbs: Steps' own acts. */
function _verb(kind, stepId) {
  const SV = Steps();
  if (kind === "split") SV.beginSplit(stepId);
  else if (kind === "merge") SV.mergeStepWithNext(stepId);
  else if (kind === "hide") SV.toggleStepHidden(stepId);
  else if (kind === "delete") SV.deleteStep(stepId);
}

/* Add step (a project with no video and no recording): Steps' + Add step;
   the step it adds opens in place, its description to write. */
async function _addStep() {
  const before = State.getSelectedStepId();
  await Steps().addManualStep();
  const now = State.getSelectedStepId();
  if (now && now !== before && _step(now)) {
    openStep(now, { seek: false });
    const d = $("tp-editor") && $("tp-editor").querySelector("#step-desc");
    if (d) d.focus();
  }
}

/* Paste notes...: Steps' own; the focus goes to the first step it made. */
async function _paste() {
  const before = State.getSelectedStepId();
  await Steps().pasteNotes();
  const now = State.getSelectedStepId();
  if (now && now !== before) { _p.focusId = now; render(); }
}

/* Starts here on a row: the act the Timeline's "<step>" starts here does,
   on this step, at the moment the video shows (flow-view.js showHereAt). */
async function _startsHere(stepId) {
  _p.focusId = stepId;
  await require("./flow-view.js").showHereAt(stepId, Video.playheadMs(), { select: "self" });
  _p.focusId = stepId;
  render();
}

function _menuOpen() {
  if (document.getElementById("shot-src-menu") || document.getElementById("tl-ctx-menu") ||
      document.getElementById("step-ctx-menu")) return true;
  const list = document.querySelector("#tp-editor .step-activity-list:not([hidden])");
  if (list) return true;
  return Array.from(document.querySelectorAll(".modal-backdrop")).some((m) => getComputedStyle(m).display !== "none");
}

(function wire() {
  const tabs = $("tp-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (e) => {
    const t = e.target.closest("[role=tab]");
    if (t && t.dataset.anno) { _marked = { kind: null, id: null }; showTab(t.dataset.anno); }
  });
  tabs.addEventListener("keydown", (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.indexOf(_p.tab);
    const n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1
      : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    showTab(TABS[n], { focus: true });
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => _fitTabs()).observe(tabs);

  const steps = $("tp-steps");
  // A press on the pane's own buttons around the opened step keeps the
  // focus where it is until the click: a field left on the press (the name's
  // quiet library line going) would move the button from under the pointer.
  // The click then leaves the field first, which saves it.
  const OWN = ".tp-go, .tp-verb, .tp-nav button";
  steps.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest(OWN)) e.preventDefault();
  });
  steps.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest(OWN)) {
      const a = document.activeElement;
      const ed = $("tp-editor");
      if (a && ed && ed.contains(a) && typeof a.blur === "function") a.blur();
    }
    const here = t.closest(".tp-here");
    if (here) { _startsHere(here.dataset.here); return; }
    const row = t.closest(".tp-row");
    if (row) { openStep(row.dataset.stepId, { from: row.dataset.stepId, focusEditor: true }); return; }
    if (t.closest(".tp-paste")) { _paste(); return; }
    if (t.closest(".tp-add")) { _addStep(); return; }
    if (t.closest(".tp-confirm")) { const P = Steps().paneProject(); if (P.refCaseId) Steps().confirmRunAction(P.refCaseId); return; }
    if (t.closest(".tp-undo-confirm")) { const P = Steps().paneProject(); if (P.refCaseId) Steps().reopenRunAction(P.refCaseId); return; }
    if (t.closest(".tp-back")) { backToList(); return; }
    const nav = t.closest(".tp-nav");
    if (nav && t.closest(".tp-prev, .tp-next")) {
      const b = t.closest(".tp-prev, .tp-next");
      if (b.getAttribute("aria-disabled") === "true") return;
      const id = b.classList.contains("tp-prev") ? nav.dataset.prev : nav.dataset.next;
      if (id) { openStep(id); b.focus(); const again = steps.querySelector(b.classList.contains("tp-prev") ? ".tp-prev" : ".tp-next"); if (again) again.focus(); }
      return;
    }
    if (t.closest(".tp-open-steps")) {
      const id = _p.openId;
      if (!id) return;
      State.consumePendingStepJump();
      State.setSelectedStepId(id);
      State.setPendingStepReveal();
      const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
      if (btn) btn.click();
      return;
    }
    const go = t.closest(".tp-go");
    if (go) { openStep(go.dataset.go, { focusEditor: true }); return; }
    const verb = t.closest(".tp-verb");
    if (verb && !verb.disabled && _p.openId) _verb(verb.dataset.verb, _p.openId);
  });
  steps.addEventListener("keydown", (e) => {
    const row = e.target.closest && e.target.closest(".tp-row");
    if (!row || (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Home" && e.key !== "End")) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = Array.from(steps.querySelectorAll(".tp-row"));
    const i = rows.indexOf(row);
    const j = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    const to = rows[j];
    if (!to) return;
    _setStop(to);
    to.focus();
  });
  // Escape in a step opened in place goes back to the list (a menu, the
  // name's list of activities or a dialog closes first). Read before the
  // field's own Escape handler, acted on after it (it puts the field back).
  steps.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !_p.openId || _menuOpen()) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && steps.contains(a) && typeof a.blur === "function") a.blur();
      if (_p.openId) backToList();
    }, 0);
  }, true);

  // A press anywhere outside the opened step leaves its field (saving it),
  // even where the press keeps the focus from moving (a side dragged on the
  // Timeline), so the page's keys (S, Space, Ctrl+Z) answer again (the step
  // panel's rule, lane E-1).
  document.addEventListener("mousedown", (e) => {
    const ed = $("tp-editor");
    const a = document.activeElement;
    if (!ed || !a || !ed.contains(a) || ed.contains(e.target) || (e.target.closest && e.target.closest(OWN))) return;
    if (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") a.blur();
  }, true);

  const notes = $("tp-notes");
  notes.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest(".tp-add-note")) {
      const at = Video.playheadMs();
      if (at != null) AnalystUI.addNote(null, new Date(at).toISOString());
      return;
    }
    const row = t.closest(".tp-note-row");
    if (!row) return;
    _marked = { kind: "noteId", id: row.dataset.noteId };
    const at = t.closest(".tp-at");
    if (at) { seekTo(Number(at.dataset.ms)); _markItem(notes, ".tp-note-row", "noteId"); return; }
    if (t.closest(".tp-note-edit")) AnalystUI.editNote(row.dataset.noteId);
    else if (t.closest(".tp-note-delete")) AnalystUI.deleteNote(row.dataset.noteId);
  });

  const files = $("tp-files");
  files.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest(".tp-attach")) { AnalystUI.attachFile(null); return; }
    const row = t.closest(".tp-file-row");
    if (!row) return;
    const step = t.closest(".tp-file-step");
    if (step) { openStep(step.dataset.step); return; }
    if (t.closest(".tp-file-open")) AnalystUI.openAttachment(row.dataset.attId);
    else if (t.closest(".tp-file-remove")) AnalystUI.removeAttachment(row.dataset.attId);
  });

  // The counts and the lists follow every change.
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  };
  for (const topic of ["steps", "markers", "timeline", "analysis", "session", "level"]) State.subscribe(topic, queue);
  const video = $("video");
  if (video) for (const ev of ["timeupdate", "seeked"]) video.addEventListener(ev, tickNow);
})();

module.exports = {
  showTab, openStep, backToList, showScreenshot, showNote, showTransaction, render, tickNow, seekTo,
  TABS, TEXT,
};
