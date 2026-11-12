/*
 * flow-view.js: the Timeline level of the Session view (data-level "flow").
 *
 * Owns session load + analysis (loadSessionIntoView / openSessionFlow / the
 * automatic analysis and its status line), the timeline and every lane,
 * range selection, the video <-> timeline sync, the event table, the
 * marker inserts. The pane beside the video (its tabs, the
 * step opened in place) is views/timeline-pane.js (lane PANE). The module wires its own controls at require()
 * time (the DOM is already parsed when renderer.js pulls this in).
 * Cross-surface glue that stays in the entry (rerenderActiveLevel,
 * addStepAtTimestamp) is injected by renderer.js via initFlowView().
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const { $, escapeHtml, formatDuration, toast, placeMenu, sinceStart, recordingStartMs, clock } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { resetUndoStack, captureBaseline, saveAnnotationsWithUndo, persistAnnotations } = require("../session.js");
const SaveState = require("../save-state.js");
const MarkerEdits = require("../marker-edits.js");
const AutoApply = require("../auto-apply.js");
const { isVideoCopy } = require("../analyst-files.js");
const AC = require("../analyst-content.js");
const { pushRecent } = require("../recent.js");
const { analysisNeed } = require("../normalize-result.js");
const { recentLabel } = require("../session-summary.js");
const Steps = require("./steps-view.js");
const { renderStepsLevel } = Steps;
const ShowHere = require("../show-here.js");
const { renderOverviewLevel, hasAnalysisBlocks } = require("./overview-view.js");
const Video = require("./flow-view-video.js");
const {
  setVideoOverlay, positionPlayhead, videoStartTs, videoTimeToSessionTs,
  seekToTimestamp, jumpToStepInFlow,
} = Video;
const { renderScreenshots, openScreenshot } = require("./flow-view-screenshots.js");
const FlowMarkers = require("./flow-view-markers.js");
const { effectiveLabel } = FlowMarkers;
const Timeline = require("./flow-view-timeline.js");
const {
  renderTimeline, renderTimelineSummary, restoreTimelineForCurrent,
  maybeAutoScrollToFirstCase, _wireTimelineScrollPersist, setLaneToggle, timelineDrawable,
} = Timeline;
const Transcript = require("./flow-view-transcript.js");
const AnalystUI = require("./analyst-ui.js");
const StepPanel = require("./step-panel.js");
const Pane = require("./timeline-pane.js");
const { ipcErrorText } = require("../project-folder.js");
const RO = require("../read-only.js");
const Handoff = require("../handoff.js");
const TimelineRow = require("../timeline-row.js");

/* Injected by renderer.js -- cross-surface glue kept in the thin entry.
   Lazy wrappers so hoisting / load order does not matter. */
let rerenderActiveLevel = () => {};
let addStepAtTimestamp = async () => {};

/* ============ The pane's tabs ===================================== */

/* The tab chosen stays chosen while the window lives (lane E, E3: the
   Transcript tab too); it is not saved to the project. Lane PANE: the pane
   is views/timeline-pane.js, and the Markers tab is gone: what opened it
   ("markers") opens the Steps tab, at the transaction's header when
   `caseId` names one. */
function activateAnnoTab(name, caseId) {
  if (name === "markers") Pane.showTransaction(caseId || null);
  else Pane.showTab(name);
}

/* The marker-edit resolution lives in flow-view-markers.js (god-file
   split). effectiveLabel is destructured at the top here; the marker-INSERT
   surfaces stay below. */

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await Ipc.openSessionFolder();
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

/* Lane MW: Open in a new window... (the Open menu), and the new-window
   button of a recent project (renderer.js): the project opens in a new
   window and the one on screen stays open. Read only there when another
   window has it open for editing (main.js). */
async function openInNewWindow(folder) {
  let r;
  try { r = await Ipc.openInNewWindow(folder); }
  catch (e) { r = { ok: false, error: ipcErrorText(e) }; }
  if (!r || !r.ok) toast("The project did not open: " + ((r && r.error) || "no reason was given"), "error");
}
async function openInNewWindowFlow() {
  const folder = await Ipc.openSessionFolder();
  if (!folder) return;
  await openInNewWindow(folder);
}
if ($("#btn-open-new-window")) $("#btn-open-new-window").addEventListener("click", openInNewWindowFlow);

/* Lane HV (C20): Open a hand-off (.zip). The zip an analyst handed off is
   extracted under userData and opens read only (main.js viewer:loadSession,
   handoff-open.js); Windows' folder dialog would not list it. */
async function openHandoffFlow() {
  const zip = await Ipc.openHandoffDialog();
  if (!zip) return;
  await loadSessionIntoView(zip);
}
if ($("#btn-open-handoff-hero")) $("#btn-open-handoff-hero").addEventListener("click", openHandoffFlow);
if ($("#btn-open-handoff")) $("#btn-open-handoff").addEventListener("click", openHandoffFlow);

/* 2.0.1: Open the demo project: a fresh copy of the finished demo that ships
   with the app (main.js viewer:openDemo), opened like any project. */
async function openDemoFlow() {
  let r;
  try { r = await Ipc.openDemo(); }
  catch (e) { r = { ok: false, error: ipcErrorText(e) }; }
  if (!r || !r.ok) { toast("The demo project did not open: " + ((r && r.error) || "no reason was given"), "error"); return; }
  await loadSessionIntoView(r.folder);
  toast("The demo project, a fresh copy in " + r.folder + ". Change anything: the next Open the demo project starts from the same demo again.", "success");
}
if ($("#btn-open-demo-hero")) $("#btn-open-demo-hero").addEventListener("click", openDemoFlow);
if ($("#btn-open-demo")) $("#btn-open-demo").addEventListener("click", openDemoFlow);

/* New project from a video / New empty project (C16; the New menu, AD-29):
   the main process asks for the video, then the project's name and folder,
   makes the folder and copies the video in; the project opens and is
   analyzed by itself (one implicit run, one transaction to the reader, until
   runs are marked). */
async function newProject(kind) {
  let r = await Ipc.chooseNewProject({ kind });
  if (!r) return;
  if (!r.ok) { toast("The project was not made: " + (r.error || "no reason was given"), "error"); return; }
  toast(kind === "video" ? "Copying the video into the new project..." : "Making the project...", "info");
  r = await Ipc.createProject();
  if (!r || !r.ok) { toast("The project was not made: " + ((r && r.error) || "no reason was given"), "error"); return; }
  await loadSessionIntoView(r.folder);
  if (kind === "video") {
    // A project made from a video opens where its work starts: its steps are
    // marked on the Timeline, at the moments of the video.
    const flow = document.querySelector('.view-mode-btn[data-level="flow"]');
    if (flow) flow.click();
    toast("Project made: " + path.basename(r.folder) + ". Play the video and press S, or click Add step, where each step starts.", "success");
    return;
  }
  toast("Project made: " + path.basename(r.folder) + ". Add its steps in Steps.", "success");
}
if ($("#btn-new-from-video")) $("#btn-new-from-video").addEventListener("click", () => newProject("video"));
if ($("#btn-new-blank")) $("#btn-new-blank").addEventListener("click", () => newProject("blank"));
// The page shown while no project is open offers the same two.
if ($("#btn-new-video-hero")) $("#btn-new-video-hero").addEventListener("click", () => newProject("video"));
if ($("#btn-new-blank-hero")) $("#btn-new-blank-hero").addEventListener("click", () => newProject("blank"));

/* ============ Analysis: it runs by itself (AD-22) ===================
   The pipeline runs on open when the recording has no analysis or one from an
   older version, after Apps outside the process and after a range is left out, inside
   Edit as the As-Is map and inside the PDD export, and a moment after a
   change to the transactions (D4: in every project, scheduleAutoApply).
   Help, Troubleshooting has Re-analyze for a stuck state. While a run lasts
   the top bar says so in one line with Cancel and the page stays as it is
   (main refuses annotation writes meanwhile, so no edit is lost to the run);
   the analysis log shows only when a run fails, its failure sentence first.
   Runs go one at a time. */

const UPDATING = "Updating steps and map...";
let _running = null;                 // the status line's text while a run lasts
let _runQueue = Promise.resolve();
let _pendingRuns = 0;                // runs asked for and not ended (queued or running)
const _analyzedOnOpen = new Set();   // folders analyzed as they opened, in this window

/* Whether a run is queued or running: from the moment it is asked for, so
   the Map (refmap-ui.js) never asks for a second one meanwhile. */
function analysisBusy() {
  return _pendingRuns > 0;
}

/* The analysis log: hidden unless the last run failed. */
function hideAnalysisLog() {
  const host = $("#log-host");
  if (host) host.style.display = "none";
}
function showAnalysisFailure(sentence) {
  const host = $("#log-host");
  if (!host) return;
  $("#log-failure").textContent = sentence;
  host.style.display = "";
  host.open = true;
}

/* The pages that wait for an analysis (the Overview's note, the Map's lock,
   the empty Steps list) say whether one is running, failed or was cancelled.
   They are rendered again when that changes, and only while the recording has
   no analysis to show (a rendered Overview is never replaced under the
   analyst's hands). */
function _rerenderWaiting() {
  const sess = State.getSession();
  if (sess && !hasAnalysisBlocks(sess.analysis)) rerenderActiveLevel();
}

/* Run normalize.py once, after any run in progress, with the status line
   showing `label`. Resolves the IPC result ({ ok, cancelled, error, ... }).
   A failed run shows the log; a cancelled one does not (nothing failed). */
function runPipeline(opts, label) {
  const folder = opts.sessionFolder;
  // Lane HV: a hand-off opened read only keeps the analysis it came with
  // (lane MW: and so does a project open for editing in another window).
  const open = State.getSession();
  if (RO.isReadOnly(open) && open.sessionFolder === folder) {
    return Promise.resolve({ ok: false, error: "The analysis does not run here: " + RO.reasonFor(open) });
  }
  _pendingRuns += 1;
  const job = _runQueue.then(async () => {
    _running = label || UPDATING;
    hideAnalysisLog();
    $("#normalize-log").textContent = "";
    State.setAnalysisRun({ folder, status: "running" });
    renderSessionPills();
    _rerenderWaiting();
    let r;
    try { r = await Ipc.runNormalizeExtended(opts); }
    catch (e) { r = { ok: false, error: "Analysis could not start: " + ((e && e.message) || String(e)) }; }
    if (!r) r = { ok: false, error: "The analysis did not answer." };
    _running = null;
    const onScreen = !!(State.getSession() && State.getSession().sessionFolder === folder);
    if (r.cancelled) {
      State.setAnalysisRun({ folder, status: "cancelled" });
    } else if (!r.ok) {
      State.setAnalysisRun({ folder, status: "failed" });
      // r.error is the full sentence from main.js: for a failed normalize run
      // it carries the pipeline's "[normalize] ERROR:" line (C13).
      if (onScreen) showAnalysisFailure(r.error || "The analysis failed without a reason.");
    } else {
      State.setAnalysisRun(null);
    }
    renderSessionPills();
    if (onScreen) _rerenderWaiting();
    return r;
  });
  job.then(() => { _pendingRuns -= 1; }, () => { _pendingRuns -= 1; });
  _runQueue = job.catch(() => {});
  return job;
}

/* What the one deliberate analysis asks first: Re-analyze, when the
   recording has steps. */
const CONFIRMS = {
  reanalyze: () => ({
    title: "Re-analyze",
    message: "Draft the steps and the map again from the recording?",
    detail: "Your confirmed, edited, added and hidden steps are kept.",
    okLabel: "Re-analyze",
  }),
};

/* Analyze the recording on screen: run the pipeline (always writing the
   process map's BPMN file, the file the Map's edit act copies) and reload the
   recording. Resolves true when it ran and the recording was reloaded.
   opts.confirm: "reanalyze" (Help's Re-analyze) asks first when the
   recording has steps; the automatic runs (on open, Apps outside the
   process, a range left out, the Map's edit act, a change to the
   transactions) never ask. opts.auto: the run a change to the transactions
   makes (scheduleAutoApply), which says nothing when it worked. */
async function analyzeSession(opts) {
  const sess = State.getSession();
  // Lane HV: nothing is analyzed in a hand-off opened read only.
  if (!sess || RO.isReadOnly(sess)) return false;
  const auto = !!(opts && opts.auto);
  const kind = opts && opts.confirm;
  const steps = (sess.annotations && sess.annotations.steps) || [];
  if (kind && CONFIRMS[kind] && steps.length > 0) {
    const ok = await confirmModal(CONFIRMS[kind]());
    if (!ok) return false;
  }
  const folder = sess.sessionFolder;
  const r = await runPipeline({ sessionFolder: folder, mine: true }, UPDATING);
  const onScreen = !!(State.getSession() && State.getSession().sessionFolder === folder);
  if (!onScreen) return false;
  // D4: a run cancelled or failed leaves the changes to the transactions
  // waiting, with Update the steps in the top bar, until the next change.
  _held = AutoApply.holdAfter(r, auto && _autoYielding);
  if (r.cancelled) {
    // An automatic run that gave way to a change says nothing: it runs
    // again once the change is saved.
    if (!(auto && _autoYielding)) toast("Update cancelled: the steps and the map are as they were.");
    renderSessionPills();
    return false;
  }
  if (!r.ok) { toast(r.error, "error"); renderSessionPills(); return false; }
  // D4: the run a change makes says nothing when it worked (the steps show
  // it); the other runs say so.
  if (!auto) toast("Steps and map updated.", "success");
  await loadSessionIntoView(folder, { afterAnalysis: true });
  return true;
}

/* 2.0.3 (the owner: a new project's transaction had no end to type until
   its marker change was applied), and D4 (the owner, 2026-11-10: "apply by
   itself", in a recording too): a transaction added, moved, ended, renamed
   or deleted reaches the steps by itself, in every project open for editing
   (auto-apply.js). It is applied once the analyst pauses: AUTO_APPLY_MS
   after the change, with no dialog open, no key pressed for that long, no
   side being dragged and no field holding typing not saved yet (else it
   waits again). A save while it runs stops it first (a stopped run leaves
   the project as it was; main refuses a save while a project is analyzed)
   and it runs again after, so it never refuses the analyst a change. In a
   recording the run drafts the drafts again; the analyst's confirmed,
   edited, added and hidden steps are kept, and a draft keeps its step id
   where it covers the same actions (step_suggest._merge_steps).
   A run the analyst cancels, or one that fails, holds the changes
   (`_held`): the top bar offers Update the steps, and the next change runs
   it again too. An undo or a redo of a change the last analysis had used
   leaves no edit newer than it, so it marks the markers `_stale`
   (markersReverted, from session.js). */
const AUTO_APPLY_MS = 1200;
let _autoTimer = null;
let _autoRunning = false;
let _autoYielding = false;
let _held = false;
let _staleMarkers = false;

function _waiting(sess) {
  return { applies: AutoApply.appliesItself(sess, RO.isReadOnly(sess)),
    pending: sess ? MarkerEdits.pendingEditCount((sess.annotations || {}).marker_edits, MarkerEdits.lastAnalysisMs(sess)) : 0,
    stale: _staleMarkers, held: _held, running: !!_running };
}
function _autoApplies(sess) {
  return AutoApply.runDue(_waiting(sess));
}

/* An undo or a redo changed the markers (session.js applyRevertedAnnotations):
   the steps follow, as after the change itself. */
function markersReverted() {
  _staleMarkers = true;
}

/* The analyst is in the middle of something: a dialog is open, a side is
   being dragged, a key was pressed a moment ago, or the field with the
   keyboard holds typing not saved yet (a field merely left focused does not
   hold the update back). */
let _lastKeyAt = 0;
if (typeof document !== "undefined") document.addEventListener("keydown", () => { _lastKeyAt = Date.now(); }, true);
function _analystBusy() {
  if ([...document.querySelectorAll(".modal-backdrop")].some((m) => m.getClientRects().length > 0)) return true;
  // A side being dragged on the Timeline (flow-view-timeline.js wireEdgeDrag).
  if (document.body.classList.contains("tl-edge-dragging")) return true;
  if (Date.now() - _lastKeyAt < AUTO_APPLY_MS) return true;
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && !a.readOnly && !a.disabled &&
    typeof a.defaultValue === "string" && a.value !== a.defaultValue;
}

/* Apply the marker changes once the analyst pauses (see above). Called after
   every change (opts.changed: it releases a hold, so the next change runs it
   again), as a project opens and after a run gave way to a save; nothing
   happens where nothing waits. */
function scheduleAutoApply(opts) {
  if (opts && opts.changed) _held = false;
  if (_autoTimer) clearTimeout(_autoTimer);
  _autoTimer = _autoApplies(State.getSession()) ? setTimeout(_autoApplyNow, AUTO_APPLY_MS) : null;
}
/* Update the steps (the top bar, after a cancelled or failed run): the same
   run, at once. */
function updateStepsNow() {
  _held = false;
  if (_autoTimer) clearTimeout(_autoTimer);
  _autoTimer = null;
  renderSessionPills();
  return _autoApplyNow();
}
async function _autoApplyNow() {
  _autoTimer = null;
  if (!_autoApplies(State.getSession())) return;
  if (_analystBusy() || analysisBusy()) { _autoTimer = setTimeout(_autoApplyNow, AUTO_APPLY_MS); return; }
  _autoRunning = true;
  try { await analyzeSession({ auto: true }); } finally { _autoRunning = false; }
}

/* Before anything is saved: an automatic run under way stops, so the save
   goes through, and runs again after it (session.js writeAnnotations). */
async function yieldAutoApply() {
  if (!_autoRunning || !_running) return;
  _autoYielding = true;
  try {
    await Ipc.cancelNormalize();
    await _runQueue;   // the stopped run has ended
  } finally { _autoYielding = false; }
  scheduleAutoApply();
}

/* The status line in the top bar (#session-pills): while a run lasts, what it
   does and Cancel; else, after a cancelled or failed run while changes wait,
   Update the steps. Delegated once, since each render replaces the buttons. */
(function wireStatusLine() {
  const host = $("#session-pills");
  if (!host) return;
  host.addEventListener("click", async (e) => {
    if (e.target.closest("#btn-cancel-normalize")) {
      e.preventDefault();
      await Ipc.cancelNormalize();
      toast("Cancelling the update...");
    } else if (e.target.closest("#btn-update-steps")) {
      updateStepsNow();
    }
  });
})();

Ipc.onNormalizeLog((text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

async function loadSessionIntoView(folder, opts) {
  const prevFolder = State.getSession() ? State.getSession().sessionFolder : null;
  let loaded;
  try {
    loaded = await Ipc.loadSession(folder);
  } catch (e) {
    // Lane FX2 (validation pass 3, F7): the reason in its own words, never
    // the IPC call's.
    toast("The project did not open: " + ipcErrorText(e), "error");
    return;
  }
  // The folder that opened: the one chosen, or the one recording folder it
  // holds (the SME's zip unzipped, main.js loadSessionData).
  const asked = folder;
  folder = (loaded && loaded.sessionFolder) || folder;
  State.setSession(loaded);
  // Lane FX2 (validation pass 3, F3): the step panel belongs to the project
  // it showed: another project closes it (the same one draws it again).
  StepPanel.refresh();
  if (RO.isOpenElsewhere(loaded)) {
    // Lane MW: another window has this project open for editing.
    toast("This project is open in another window, so it opens read only here.", "info");
  } else if (loaded && loaded.openedZip && RO.isReadOnly(loaded)) {
    // Lane HV: a hand-off zip opens read only.
    const line = Handoff.handedOffLine(Handoff.latest(loaded.annotations));
    toast("Opened " + (line ? line.charAt(0).toLowerCase() + line.slice(1) : "the hand-off") +
      ", read only: nothing here can change.", "info");
  } else if (path.resolve(String(asked)) !== path.resolve(String(folder))) {
    toast("Opened the recording in the folder you chose: " + path.basename(folder) + ".", "info");
  }
  // Reset undo when switching to a different session. Undo/redo
  // stack entries are pinned to a sessionFolder so they'd be unusable
  // anyway, but cleaning here avoids unbounded memory growth across
  // many session switches.
  if (prevFolder !== folder) resetUndoStack();
  // C19: another project opens at its main level.
  if (prevFolder !== folder) State.setMapPath([]);
  // Capture the loaded annotations as the undo baseline on EVERY load (including
  // a same-folder re-analyze), so the first edit records the true pre-edit state.
  captureBaseline();
  $("#session-empty").style.display = "none";
  $("#session-loaded").style.display = "";
  // The top bar's levels, status line and Export show once a recording is open.
  const shell = document.querySelector(".app");
  if (shell) shell.classList.add("has-session");
  // Lane HV: a hand-off opened read only shows no editing control
  // (read-only.js, styles.css .read-only). Lane MW: nor does a project open
  // for editing in another window, whose Export has no hand-off files either
  // (.open-elsewhere).
  if (shell) shell.classList.toggle("read-only", RO.isReadOnly(State.getSession()));
  if (shell) shell.classList.toggle("open-elsewhere", RO.isOpenElsewhere(State.getSession()));
  // A hand-off whose zip came without the Technical details offers none.
  if (shell) shell.classList.toggle("handoff-no-tech", RO.isReadOnly(State.getSession()) && State.getSession().handoffTech === false);
  renderAnnotationsErrorBanner();
  // The top bar's save state follows the project on screen (save-state.js).
  SaveState.projectOpened(State.getSession());
  // A failed run's log belongs to the recording it ran on.
  const _run = State.getAnalysisRun();
  if (!_run || _run.folder !== State.getSession().sessionFolder || _run.status !== "failed") hideAnalysisLog();
  /* The Recents entry is named by the document title once it is written,
     else by the name given at the end of the recording, else by its project
     and folder (session-summary.recentLabel). */
  const label = recentLabel(State.getSession(), path.basename(folder));
  // Lane HV: a hand-off opened read only says which version it is.
  const handed = RO.isReadOnly(State.getSession()) && !RO.isOpenElsewhere(State.getSession())
    ? Handoff.latest(State.getSession().annotations) : null;
  pushRecent(folder, handed ? label + " · version " + handed.version + ", read only" : label);
  // Lane MW: each window is named after its project, so the taskbar and
  // Alt+Tab tell the windows apart.
  document.title = Handoff.projectName(State.getSession()) +
    (RO.isReadOnly(State.getSession()) ? " (read only)" : "") + " · Process Discovery Viewer";

  // D4: a project opened (not one read back after its run) starts with
  // nothing held; what an undo left for the analysis waits until it ran.
  if (!(opts && opts.afterAnalysis)) _held = false;
  if (prevFolder !== folder || (opts && opts.afterAnalysis)) _staleMarkers = false;
  renderSessionPills();
  // C8: the transcript's menu items follow the loaded file.
  Transcript.onSessionLoaded();
  // Item 1: when no recording is linked, the tall black video stage
  // collapses to a slim one-line band and the freed space goes to the
  // timeline + notes; the slim band keeps an "Attach video..." affordance so
  // the inverse verb survives (flow-view-video.js loadPlayer sets it).
  // Lane FX3 (validation pass 3, F16): a project with no recording and no
  // video draws no timeline; the line in its place carries Attach video, so
  // the video band (a second Attach video) is not shown.
  const workspace = document.getElementById("lower-workspace");
  if (workspace) workspace.classList.toggle("no-timeline", !timelineDrawable(State.getSession()));
  // D4: the run a change makes reads the project back; a moment the clock
  // was at that no video shows (a recording without a video) is kept, so
  // End transaction, after Start transaction, still has its moment.
  const keptMoment = opts && opts.afterAnalysis && prevFolder === folder ? Video.playheadMs() : null;
  // C23 (2.0.6): the player shows the video of the chain at the playhead
  // (the first one's start for a project just opened), else the band.
  Video.loadPlayer();
  syncVideoControls();
  // The #video timeupdate/loadedmetadata listeners are wired ONCE at module
  // init (see wireVideoListeners below) -- adding them here ran on every
  // session load and leaked a fresh loadedmetadata arrow each time.
  // The video's corner says "loading…" until its length is known, then
  // nothing (lane SCREEN: the time is the row's clock, on the one clock).
  setVideoOverlay(State.getSession().recordingAvailable ? "loading…" : "");

  renderTimeline();
  if (keptMoment != null && Video.playheadMs() == null) Video.movePlayheadToTimestamp(new Date(keptMoment).toISOString());
  renderEventTable();
  syncRawEventsShown();
  renderScreenshots();
  renderTimelineSummary();
  // Phase B+ surfaces. 2.0.3: the step selected stays selected when the
  // same project comes back from an analysis (a transaction's change applied
  // by itself must not take the analyst off the step being worked on).
  if (prevFolder !== folder || !(opts && opts.afterAnalysis)) State.setSelectedStepId(null);
  State.setMultiSelectedStepIds(new Set());
  renderStepsLevel();
  // The Overview is the default level on load; it reads the freshly loaded
  // analysis.json, so drawing it here covers the Checklist, the project line
  // and the document.
  renderOverviewLevel();
  // P1.10: restore persisted timeline zoom + scroll for this session.
  _wireTimelineScrollPersist();
  restoreTimelineForCurrent();
  maybeAutoScrollToFirstCase();
  // P1.1: clear any range selection from the previous session.
  if (prevFolder !== folder) clearSelectionRange();
  installRangeSelection();
  // AD-22: a recording with no analysis, or one from an older version, is
  // analyzed as it opens, while the page stays readable. Once per folder in
  // this window (a failing analysis does not start again on every reload;
  // Help's Re-analyze is there for that), never from an analysis's own reload,
  // and not while annotations.json cannot be read (the banner says why, and
  // the pipeline would refuse).
  const opened = State.getSession();
  if (!(opts && opts.afterAnalysis) && !opened.annotationsError && !RO.isReadOnly(opened) && analysisNeed(opened) &&
      !_analyzedOnOpen.has(opened.sessionFolder)) {
    _analyzedOnOpen.add(opened.sessionFolder);
    analyzeSession().catch((e) => console.error("[flow-view] the automatic analysis failed:", e));
  }
  // The Map is drawn only while it shows: a project opened, or reloaded after
  // an analysis, while the Map is on screen is drawn again (after the
  // analysis above is asked for, so the Map does not ask for another).
  if (State.getLevel() === "map") rerenderActiveLevel();
  // 2.0.3, D4: marker changes left waiting run a moment later.
  scheduleAutoApply();
  syncTimelineRow();
}

/* The controls that act on the video show only while one is linked: Sync
   video in the video pane's header (the timeline's row shows Play and Add
   step then, syncTimelineRow). Without a video they could only answer with
   an error. */
function syncVideoControls() {
  const sess = State.getSession();
  const hasVideo = !!(sess && sess.recordingAvailable);
  const syncBtn = document.getElementById("btn-sync-video");
  if (syncBtn) syncBtn.hidden = !hasVideo;
  syncTimelineRow();
  // A video project (C16) has nothing to sync the video with: the Timeline is the video.
  const sync = document.getElementById("btn-sync-video");
  if (sync && !(sess && (sess.events || []).length)) sync.hidden = true;
  // Remove video, Attach video's inverse: only for a video the analyst
  // attached (C23: the one in the player).
  const remove = document.getElementById("btn-video-remove");
  if (remove) {
    const clip = Video.currentClip();
    remove.hidden = !Video.attachedVideoShown(sess) || !clip || clip.obs;
    if (!remove.hidden) {
      const many = Video.addedClips(sess).length > 1;
      remove.title = "Take " + (many ? Video.clipName(clip) : "the video") + " out of this project" +
        (isVideoCopy(clip.path) ? ": its copy in the project's video folder is deleted." : ".") +
        " Ctrl+Z brings it back.";
    }
  }
}

/* RP-04: an annotations.json that exists but cannot be read is an error the
   analyst must see, never an empty session. main.js reports it as
   session.annotationsError ({ file, reason, backups, newest, message }); this
   persistent banner names the file, what it means, and the backups. Saves
   and Analyze are refused in main while it lasts. Lane CC: when a backup can
   be read, the banner offers Restore the newest backup
   (#btn-restore-annotations): it asks first, naming the backup's time, keeps
   the unreadable file beside it and opens the project again. */
function annotationsErrorBannerHtml(err) {
  if (!err || !err.message) return "";
  return '<strong>The annotations for this project cannot be read.</strong> ' + escapeHtml(err.message) +
    (err.newest && err.newest.name
      ? ' <button type="button" class="primary anno-error-restore" id="btn-restore-annotations" title="' +
        escapeHtml("Put back " + err.newest.name + ", saved " + backupSaved(err.newest) +
          ". The file that cannot be read is kept beside it.") + '">Restore the newest backup</button>'
      : "");
}
function renderAnnotationsErrorBanner() {
  const el = document.getElementById("annotations-error-banner");
  if (!el) return;
  const html = annotationsErrorBannerHtml(State.getSession() && State.getSession().annotationsError);
  el.innerHTML = html;
  el.style.display = html ? "" : "none";
  // Lane FX2 (validation pass 3, F12): while the file cannot be read, the
  // banner is all the page shows: no level, no editing control, no Export
  // (styles.css .annotations-unreadable), so the project never looks empty
  // and nothing offers an edit the main process would refuse. New, Open,
  // Help and the theme stay.
  const shell = document.querySelector(".app");
  if (shell) shell.classList.toggle("annotations-unreadable", !!html);
  const btn = el.querySelector("#btn-restore-annotations");
  if (btn) btn.addEventListener("click", () => restoreNewestBackup());
}

/* When the newest backup was saved, in the words the banner's message uses
   (main writes it once, so the banner, its confirm and the toast agree). */
function backupSaved(newest) {
  return (newest && newest.saved) || new Date(newest && newest.mtimeMs).toLocaleString();
}

/* Restore the newest backup (the unreadable banner's act): asks first,
   naming the backup and when it was saved; then main keeps the unreadable
   file as annotations.unreadable-<time>.json, puts the backup in its place,
   and the project opens again with it. */
async function restoreNewestBackup() {
  const sess = State.getSession();
  const err = sess && sess.annotationsError;
  if (!err || !err.newest) return;
  const when = backupSaved(err.newest);
  const ok = await confirmModal({
    title: "Restore the newest backup?",
    message: "Put back the backup saved " + when + " (" + err.newest.name + ") as this project's annotations.",
    detail: "The file that cannot be read is kept beside it, renamed annotations.unreadable with the time. " +
      "What was changed after " + when + " is not in the backup.",
    okLabel: "Restore",
  });
  if (!ok || State.getSession() !== sess) return;
  let r;
  try { r = await Ipc.restoreAnnotationsBackup({ sessionFolder: sess.sessionFolder, expect: err.newest.name }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The backup was not restored: " + ((r && r.error) || "no reason was given"), "error");
    return;
  }
  await loadSessionIntoView(sess.sessionFolder);
  toast("Restored the backup saved " + when + ". The file that could not be read is kept as " + r.keptAs + "." +
    restoredFilesLine(r.listed, r.screenshots), "success");
}

/* What Restore the newest backup did with the files added after that backup
   (lane FX3, validation pass 3, F27): the attachments are listed again under
   the document's attachments on the Overview; screenshots stay in the
   folder. "" when there were none. Pure. */
function restoredFilesLine(listed, screenshots) {
  const files = Array.isArray(listed) ? listed : [];
  const shots = Array.isArray(screenshots) ? screenshots : [];
  let out = "";
  if (files.length) {
    out += " " + (files.length === 1 ? "A file attached after that backup is" : files.length + " files attached after that backup are") +
      " listed again with the document's attachments on the Overview: " + files.join(", ") + ".";
  }
  if (shots.length) {
    out += " " + (shots.length === 1 ? "A screenshot added after that backup stays" : shots.length + " screenshots added after that backup stay") +
      " in the project's screenshots/analyst folder, on no step.";
  }
  return out;
}

/* Wire the video element's listeners ONCE. loadSessionIntoView runs on every
   session load; adding these there re-bound a new loadedmetadata arrow each
   time (timeupdate dedups by reference, loadedmetadata did not) -> a listener
   leak across sessions. #video is a stable element in index.html. */
(function wireVideoListeners() {
  const video = document.getElementById("video");
  if (!video) return;
  video.addEventListener("timeupdate", positionPlayhead);
  // Lane FX3 (validation pass 2, item 19): once the video is loaded its
  // corner says nothing ("loading..." goes). Lane SCREEN: the video's own
  // time no longer shows there; the row's clock says the moment. An empty
  // overlay is not drawn.
  video.addEventListener("loadedmetadata", () => setVideoOverlay(""));
  // C16: a video project's Timeline runs on its video's length.
  const lengthKnown = () => {
    if (Video.noteVideoLength(video)) { renderTimeline(); renderTimelineSummary(); positionPlayhead(); }
  };
  video.addEventListener("loadedmetadata", lengthKnown);
  video.addEventListener("durationchange", lengthKnown);
})();

/* The top bar's status line (#session-pills): while the pipeline runs, one
   line saying so with Cancel; else, while changes to the transactions wait
   after a cancelled or failed run (D4, auto-apply.js updateShows), Update
   the steps, visible from every level. The clicks are delegated
   (wireStatusLine). */
function renderSessionPills() {
  const host = $("#session-pills");
  if (!host) return;
  if (_running) {
    host.innerHTML = '<span class="run-status" id="run-status"><span class="run-status-dot" aria-hidden="true"></span>' +
      escapeHtml(_running) + "</span>" +
      '<button type="button" class="link-btn run-cancel" id="btn-cancel-normalize" ' +
      'title="Stop the update: the steps and the map stay as they were">Cancel</button>';
    return;
  }
  const sess = State.getSession();
  // Lane HV: nothing is applied in a hand-off opened read only.
  host.innerHTML = sess && AutoApply.updateShows(_waiting(sess))
    ? '<button type="button" class="update-cta" id="btn-update-steps" title="' + escapeHtml(AutoApply.UPDATE_TITLE) + '">' +
      escapeHtml(AutoApply.UPDATE_LABEL) + "</button>"
    : "";
}

/* Queue a marker deletion into annotations.json.marker_edits (the Overview's
   Remove this end). Mirrors queueSyntheticMarker; the steps follow a moment
   later (scheduleAutoApply). Resolves true when it was saved (a failed save
   has already been shown to the analyst by session.js). */
async function queueMarkerDelete(eventId) {
  if (!State.getSession() || !eventId) return false;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  a.marker_edits.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    event_id: eventId,
    op: "delete",
    ts: new Date().toISOString(),
  });
  try {
    await persistAnnotations(a, "delete marker", ["markers", "timeline"]);
  } catch (_) {
    return false;
  }
  toast("End removed.", "success");
  return true;
}

/* ============ Timeline ============================================ */

/* appColor / appLabel / renderLegend live in flow-view-apps.js (god-file
   split); the timeline module reads them, this one does not. */

/* Timeline zoom/scroll persistence, the bar of the whole length, the lane
   toggles, the
   timeline summary, and renderTimeline itself live in flow-view-timeline.js
   (god-file split). The entry points flow-view drives (renderTimeline,
   renderTimelineSummary, restoreTimelineForCurrent, maybeAutoScrollToFirstCase,
   _wireTimelineScrollPersist, setLaneToggle) are destructured at the top. */

/* "Add step here" -- splits/creates a step at the video playhead so the
   analyst can annotate without leaving Flow view. Also bound to the S
   key (see renderer.js). Enables the per-step lane so the new boundary
   is visible immediately. */
async function addStepAtPlayhead() {
  if (!State.getSession()) return;
  // C23: the playhead is a moment on the clock, whichever video shows it.
  const at = Video.playheadMs();
  const tsISO = at != null ? new Date(at).toISOString() : null;
  if (!tsISO) { toast("No video timing: can't place a step at the playhead", "error"); return; }
  await addStepAt(tsISO);
}

/* A step at the moment `tsISO` (Add step and S at the clock's moment, and
   2.0.1 the Timeline's right-click Add a step here), with the steps lane
   shown so the new step is seen at once; the message says where it starts
   on the clock ("Step added at 6:20.", lane SCREEN). Lane E-1: the video's frame at that moment is
   the step's picture (read first, while it is the frame on screen), and
   (lane PANE) the new step opens in the pane beside the video; with the
   video paused its name takes the focus, selected, so typing names it;
   while the video plays nothing takes the focus, so the next S marks the
   next step. */
async function addStepAt(tsISO) {
  const playing = Video.isPlaying();
  const frame = AnalystUI.frameAtMoment(Date.parse(tsISO));
  setLaneToggle("steps", true);
  const cb = document.querySelector('#lanes-popup input[data-lane="steps"]');
  if (cb) cb.checked = true;
  const id = await addStepAtTimestamp(tsISO, { frame });
  if (!id) return;
  const origin = recordingStartMs(State.getSession());
  if (Number.isFinite(origin)) toast("Step added at " + clock(Date.parse(tsISO) - origin) + ".", "success");
  if (State.getLevel() !== "flow") return;
  Pane.openStep(id, { seek: false, focusName: StepPanel.nameTakesFocus({ playing, readOnly: RO.isReadOnly(State.getSession()) }) });
}

// The zoom buttons are wired in flow-view-timeline.js (god-file split); Add
// step, with the rest of the timeline's row, in wireTimelineRow.

/* ---- "<step>" starts here (lane E, item E5) ----------------------------------
   A step written first gets the moment of the video: lane PANE, on its row
   in the pane's Steps tab (Starts here, at the moment the video shows), and
   in the Timeline's right-click menu, at the moment clicked, on the step
   show-here.js targetOf names (the selected step when its time is the
   analyst's to set, else the first step without a time in the process
   order). The toolbar's button left: the act sits on the step. */
function _showHereLabel(step, max) {
  const name = ShowHere.nameOf(step);
  return max && name.length > max ? name.slice(0, max - 1).trimEnd() + "…" : name;
}

/* `stepId` gets the moment `atMs`; then the next step without a time is
   selected (none: nothing is), so the menu names it; `opts.select`
   "self" (the pane's Starts here, on its row) keeps this step selected. */
async function showHereAt(stepId, atMs, opts) {
  const sess = State.getSession();
  if (!sess) return;
  if (!Number.isFinite(atMs)) { toast("The video's moment could not be read.", "error"); return; }
  const hit = (sess.annotations && sess.annotations.steps || []).find((s) => s && s.step_id === stepId);
  // The frame is read at once, while it is the one on screen; only for a
  // step without a picture.
  const frame = hit && !AC.stepShots(hit, (sess.annotations || {}).analyst_screenshots).length
    ? AnalystUI.frameAtMoment(atMs) : null;
  setLaneToggle("steps", true);
  const cb = document.querySelector('#lanes-popup input[data-lane="steps"]');
  if (cb) cb.checked = true;
  const ok = await Steps.showStepAt(stepId, atMs, { frame });
  if (!ok || State.getSession() !== sess) return;
  const ordered = Steps.stepsInProcessOrder();
  const done = ordered.find((s) => s.step_id === stepId) || null;
  const next = opts && opts.select === "self" ? done : ShowHere.nextAfter(done, ordered);
  State.setSelectedStepId(next ? next.step_id : null);
  renderTimeline();
  renderStepsLevel();
}


/* P1.1: range selection on the timeline. Shift and a drag across the
   timeline's background select a stretch; lane SCREEN: the timeline's row
   then shows its times and its acts (syncTimelineRow), nothing floats over
   the lanes. The range survives view-mode switches but clears on session
   change. Escape clears it, once a menu, a dialog or a field had the
   Escape. */
function clearSelectionRange() {
  State.setSelectionRange(null);
  const ov = document.getElementById("tl-selection-overlay");
  if (ov) ov.remove();
}
function installRangeSelection() {
  const host = document.getElementById("timeline");
  if (!host || host._pdtSelWired) return;
  host._pdtSelWired = true;
  let startX = null, startMs = null, overlay = null;
  function spanInfo() {
    const sp = Video.timelineSpan();
    if (!sp) return null;
    return { first: sp.startMs, last: sp.endMs, span: Math.max(1, sp.endMs - sp.startMs) };
  }
  function pxToMs(clientX) {
    const info = spanInfo();
    if (!info) return null;
    const rect = host.getBoundingClientRect();
    const frac = (clientX + host.scrollLeft - rect.left) / Math.max(1, rect.width);
    return info.first + frac * info.span;
  }
  host.addEventListener("mousedown", (e) => {
    // Only pure-background drag starts a selection — clicks on bands /
    // markers / dots / labels stay normal click-to-seek. Lane LANES: a
    // stretch set aside is hatched through every lane, under the marks; a
    // Shift-drag may start on it as on the background.
    if (e.target !== host && !(e.target.classList && e.target.classList.contains("tl-left-out"))) return;
    if (e.button !== 0) return;
    if (!e.shiftKey) return;  // require Shift so plain click-to-seek is unaffected
    e.preventDefault();
    startX = e.clientX;
    startMs = pxToMs(e.clientX);
    if (startMs == null) return;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "tl-selection-overlay";
      overlay.id = "tl-selection-overlay";
      host.appendChild(overlay);
    }
    const info = spanInfo();
    const x = ((startMs - info.first) / info.span) * 100;
    overlay.style.left = x + "%";
    overlay.style.width = "0%";
  });
  document.addEventListener("mousemove", (e) => {
    if (startX == null || !overlay) return;
    const info = spanInfo();
    if (!info) return;
    const curMs = pxToMs(e.clientX);
    if (curMs == null) return;
    const lo = Math.min(startMs, curMs);
    const hi = Math.max(startMs, curMs);
    overlay.style.left  = (((lo - info.first) / info.span) * 100) + "%";
    overlay.style.width = (((hi - lo) / info.span) * 100) + "%";
  });
  document.addEventListener("mouseup", () => {
    if (startX == null) return;
    if (!overlay) { startX = null; return; }
    const info = spanInfo();
    if (!info) { startX = null; return; }
    // Read the overlay's geometry to derive the final range.
    const leftPct  = parseFloat(overlay.style.left)  || 0;
    const widthPct = parseFloat(overlay.style.width) || 0;
    if (widthPct < 0.1) {
      // Tiny drag — treat as cancel.
      clearSelectionRange();
      startX = null;
      return;
    }
    const startSel = info.first + (leftPct / 100) * info.span;
    const endSel   = startSel + (widthPct / 100) * info.span;
    State.setSelectionRange({ startMs: startSel, endMs: endSel });
    startX = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !State.getSelectionRange() || e.defaultPrevented) return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const shown = (el) => !!el && el.getClientRects().length > 0;
    if ([...document.querySelectorAll('.modal-backdrop, .lanes-popup, .project-menu-popup, #tl-ctx-menu')].some(shown)) return;
    clearSelectionRange();
  });
}

/* ============ The timeline's first row (lane SCREEN) =============== */

/* The row holds how to play and how to mark, left to right (plan section
   11.3): Play, the clock, Add step, Start transaction or End transaction,
   Add note, the message area, Lanes and the zoom.
   The marking buttons act at the clock's moment (the player's, or the
   moment a click on the timeline or a typed time put it at); without one
   they are there but cannot be clicked, their tooltip saying why. A project
   opened read only shows none of them. While a stretch is selected (Shift
   and a drag) its times and its acts take their place. timeline-row.js
   decides what shows and the words; this draws it, after every change of
   the clock, the transactions, the selection and the level. A click on a
   button of the row leaves the focus where it was, so Space goes on playing
   the video; the keyboard reaches each control with Tab and works it with
   Enter or Space. */

/* The transactions as the markers now are (the Transactions lane's). */
function _runsNow(sess) {
  const sp = Video.timelineSpan();
  if (!sess || !sp) return [];
  const rows = MarkerEdits.sessionMarkerView(sess);
  return Timeline.layoutCaseLanes(MarkerEdits.currentMarkerEvents(rows), sp.startMs, sp.endMs).cases;
}

/* What a selected stretch is set aside as: left out of the analysis in a
   recording that holds events, not part of the process in a project
   without a recording; a recording that holds no event has nothing to
   leave out. */
function _asideOf(sess) {
  if ((sess.events || []).length) return "leave-out";
  return AC.hasRecording(sess) ? null : "not-part";
}

let _clockEditing = false;

function _show(el, shown) {
  if (el && el.hidden !== !shown) el.hidden = !shown;
}
/* A button of the row: shown or not, clickable or not (aria-disabled, so it
   keeps its tooltip and its place in the Tab order), its tooltip, and
   whether it is the filled one. */
function _button(el, shown, enabled, title, filled) {
  if (!el) return;
  _show(el, shown);
  const dis = String(!enabled);
  if (el.getAttribute("aria-disabled") !== dis) el.setAttribute("aria-disabled", dis);
  if (el.title !== title) el.title = title;
  el.classList.toggle("primary", !!filled);
}

function syncTimelineRow() {
  const sess = State.getSession();
  const row = document.getElementById("tl-row");
  if (!row || !sess) return;
  const hasVideo = !!sess.recordingAvailable;
  const sp = Video.timelineSpan();
  const origin = recordingStartMs(sess);
  const at = Video.playheadMs();
  const range = State.getSelectionRange();
  const aside = _asideOf(sess);
  const st = TimelineRow.rowState({
    drawable: timelineDrawable(sess) && !!sp, hasVideo, recording: AC.hasRecording(sess),
    readOnly: RO.isReadOnly(sess), atMs: at, runs: _runsNow(sess), stretch: range, aside,
  });
  const words = TimelineRow.titles(TimelineRow.nounOf(hasVideo));
  const L = TimelineRow.LABELS;
  // Play / Pause.
  const play = document.getElementById("btn-tl-play");
  _show(play, st.play);
  if (play) {
    const playing = Video.isPlaying();
    const name = playing ? L.pause : L.play;
    if (play.getAttribute("aria-label") !== name) play.setAttribute("aria-label", name);
    if (play.title !== words.play) play.title = words.play;
    const icons = [play.querySelector(".tl-icon-play"), play.querySelector(".tl-icon-pause")];
    if (icons[0]) icons[0].style.display = playing ? "none" : "";
    if (icons[1]) icons[1].style.display = playing ? "" : "none";
  }
  // The clock, or its field while a time is typed.
  const clockBtn = document.getElementById("btn-tl-clock");
  const field = document.getElementById("tl-clock-field");
  if (!st.clock && _clockEditing) _endClockEdit(false);
  _show(clockBtn, st.clock && !_clockEditing);
  _show(field, st.clock && _clockEditing);
  if (clockBtn) {
    const text = TimelineRow.clockText(at, sp ? sp.endMs : NaN, origin);
    if (clockBtn.textContent !== text) clockBtn.textContent = text;
    if (clockBtn.title !== words.clock) clockBtn.title = words.clock;
  }
  // The marking buttons: Add step, Start or End transaction, Add note.
  _button(document.getElementById("btn-add-step"), st.addStep.shown, st.addStep.enabled,
    st.addStep.enabled ? words.addStep : TimelineRow.NO_MOMENT, st.filled === "addStep");
  const tx = document.getElementById("btn-tl-transaction");
  _button(tx, st.tx.shown, st.tx.enabled,
    !st.tx.enabled ? TimelineRow.NO_MOMENT : st.tx.kind === "end" ? words.end : words.start, false);
  if (tx) {
    const label = st.tx.kind === "end" ? L.end : L.start;
    if (tx.textContent !== label) tx.textContent = label;
    tx.dataset.kind = st.tx.kind;
  }
  _button(document.getElementById("btn-tl-note"), st.addNote.shown, st.addNote.enabled,
    st.addNote.enabled ? words.addNote : TimelineRow.NO_MOMENT, false);
  // A selected stretch: its times, then its acts.
  const sel = document.getElementById("tl-selection");
  _show(sel, !!st.stretch);
  if (st.stretch) {
    const times = document.getElementById("tl-selection-times");
    const text = TimelineRow.stretchText(range.startMs, range.endMs, origin);
    if (times && times.textContent !== text) times.textContent = text;
    const acts = st.stretch.acts;
    const ex = document.getElementById("tl-selection-exclude");
    const exLabel = aside === "leave-out" ? L.leaveOut : L.notPart;
    if (ex && ex.textContent !== exLabel) ex.textContent = exLabel;
    _button(ex, acts.includes("aside"), true, aside === "leave-out" ? words.leaveOut : words.notPart, st.filled === "aside");
    _button(document.getElementById("tl-selection-case"), acts.includes("makeTx"), true, words.makeTx, st.filled === "makeTx");
  }
  _show(row.querySelector(".tl-sep"), st.clock && (st.addStep.shown || st.tx.shown || st.addNote.shown || !!st.stretch));
  // Lanes and the zoom: their words follow the copy table (lane LANES: the
  // Lanes menu also says what the marks mean, and its button says so).
  const lanes = document.getElementById("btn-lanes");
  if (lanes && lanes.title !== words.lanes) lanes.title = words.lanes;
}

/* The clock: a click turns it into a field to type a time; Enter goes
   there, Escape (or leaving the field) leaves it as it was; a time that
   cannot be read says so in the message area and the field stays. */
function _startClockEdit() {
  const sess = State.getSession();
  const field = document.getElementById("tl-clock-field");
  if (!sess || !field) return;
  const at = Video.playheadMs();
  const origin = recordingStartMs(sess);
  field.value = Number.isFinite(at) && Number.isFinite(origin) ? clock(at - origin) : "";
  _clockEditing = true;
  syncTimelineRow();
  field.focus();
  field.select();
}
function _endClockEdit(refocus) {
  _clockEditing = false;
  syncTimelineRow();
  const btn = document.getElementById("btn-tl-clock");
  if (refocus && btn && !btn.hidden) btn.focus();
}
function _goToTypedTime() {
  const sess = State.getSession();
  const field = document.getElementById("tl-clock-field");
  if (!sess || !field) return;
  const r = TimelineRow.clockTarget(field.value, recordingStartMs(sess), Video.timelineSpan());
  if (r.error) { toast(r.error, "error"); field.select(); return; }
  _goToMoment(r.ms);
  _endClockEdit(true);
}
/* The clock to the moment `ms`: the video showing it goes there (playing on
   if it was); a moment no video shows puts the timeline's moment there. */
function _goToMoment(ms) {
  const at = Video.clipAtMs(ms);
  if (at && at.clip && at.clip.file) { Video.seekClock(ms); return; }
  const video = document.getElementById("video");
  if (video && !video.paused) video.pause();
  Video.movePlayheadToTimestamp(new Date(ms).toISOString());
}

/* The row's acts, at the clock's moment. */
function _rowMomentIso() {
  const at = Video.playheadMs();
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
const _usable = (el) => !!el && !el.hidden && el.getAttribute("aria-disabled") !== "true";

async function startOrEndTransactionHere() {
  const btn = document.getElementById("btn-tl-transaction");
  const iso = _rowMomentIso();
  if (!_usable(btn) || !iso) return;
  const kind = btn.dataset.kind === "end" ? "end" : "start";
  const sess = State.getSession();
  const origin = recordingStartMs(sess);
  const ok = await queueSyntheticMarker(iso, kind, {
    title: TimelineRow.LABELS.start, okLabel: TimelineRow.LABELS.start,
    message: "The name of the new transaction (you can leave it empty)",
    detail: "It starts at " + clock(Date.parse(iso) - origin) + ".",
    said: (kind === "start" ? "Transaction started at " : "Transaction ended at ") + clock(Date.parse(iso) - origin) + ".",
  });
  if (ok) syncTimelineRow();
}

function addNoteHere() {
  const iso = _rowMomentIso();
  if (!_usable(document.getElementById("btn-tl-note")) || !iso) return;
  AnalystUI.addNote(null, iso);
}

(function wireTimelineRow() {
  const row = document.getElementById("tl-row");
  if (!row) return;
  // A click leaves the focus where it was (Space goes on playing); the
  // keyboard still reaches every control with Tab.
  row.addEventListener("mousedown", (e) => {
    const b = e.target.closest && e.target.closest("button");
    if (b && row.contains(b) && !b.closest("#lanes-menu")) e.preventDefault();
  });
  const video = document.getElementById("video");
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("btn-tl-play", () => {
    if (!video || !video.src) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  });
  on("btn-tl-clock", _startClockEdit);
  const field = document.getElementById("tl-clock-field");
  if (field) {
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); _goToTypedTime(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); _endClockEdit(true); }
    });
    field.addEventListener("blur", () => { if (_clockEditing) _endClockEdit(false); });
  }
  on("btn-add-step", () => { if (_usable(document.getElementById("btn-add-step"))) addStepAtPlayhead(); });
  on("btn-tl-transaction", startOrEndTransactionHere);
  on("btn-tl-note", addNoteHere);
  on("tl-selection-exclude", queueExcludeRange);
  on("tl-selection-case", queueCaseFromSelection);
  on("tl-selection-clear", clearSelectionRange);
  // A click on the video plays or pauses it (it has no controls of its own;
  // while a sync shows them, they do).
  if (video) {
    video.addEventListener("click", () => {
      if (!video.src || video.controls) return;
      if (video.paused) video.play().catch(() => {}); else video.pause();
    });
    for (const evt of ["play", "pause", "timeupdate", "seeked", "loadedmetadata", "durationchange", "emptied"]) {
      video.addEventListener(evt, syncTimelineRow);
    }
  }
  for (const topic of ["session", "level", "markers", "timeline", "selection"]) State.subscribe(topic, syncTimelineRow);
})();

/* The screenshot surfaces (hover thumb, grid, gallery, openScreenshot)
   live in flow-view-screenshots.js (god-file split). */

/* The bar of the whole length (syncBar), the middle-drag-pan wiring and
   renderTimelineSummary live in flow-view-timeline.js. */

/* Pop a tiny context menu at (x, y) offering to queue a synthetic marker
   insert into annotations.json.marker_edits at timestamp `ts`. The edit
   only takes effect on the next normalization run. `band` ({ title, items:
   [[label, act], ...] }), a band right-clicked: its own items follow, under
   its name. The owner, after 2.0.3: "you always add steps sequentially", so
   the next step is right-clicked where the band of the one before it runs
   on: every right-click on the Timeline marks there, band or not. */
function showMarkerInsertMenu(x, y, ts, band) {
  /* Tear down any prior menu */
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();

  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);" +
    "min-width:200px;cursor:default;user-select:none;";

  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", async () => {
      close();
      await handler();
    });
    menu.appendChild(item);
  }

  // Lane HV: a hand-off opened read only offers only the way to the step.
  if (!RO.isReadOnly(State.getSession())) {
    // 2.0.3: a transaction or a step starts at the side drawn, or at the
    // playhead, a few pixels from the click (a process manager's report: a
    // transaction started just after the step it was meant to hold).
    const atMarker = Timeline.snapMoment(ts, "marker"), atStep = Timeline.snapMoment(ts, "step");
    // AD-29: a Start marker starts a transaction, an End marker ends it.
    addItem("Start a transaction here…", () => queueSyntheticMarker(atMarker, "start"));
    addItem("End the transaction here",  () => queueSyntheticMarker(atMarker, "end"));
    // C16: a note pinned to this moment (the Notes lane; never printed).
    addItem("Add note here…",            () => AnalystUI.addNote(null, ts));
    // 2.0.1: the step at this moment, as + Step adds one at the playhead.
    addItem("Add a step here",           () => addStepAt(atStep));
    // Lane E (E5): the step written first, given this moment.
    const target = State.getSession() && State.getSession().recordingAvailable ? Steps.showHereTarget() : null;
    if (target) {
      const at = Date.parse(ts);
      addItem('"' + _showHereLabel(target, 40) + '" starts here', () => showHereAt(target.step_id, at));
      menu.lastChild.title = ShowHere.titleOf(target, true);
    }
  }
  if (!band) {
    addItem("Jump to step here",         () => {
      State.setPendingStepJump(ts);
      const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
      // Defer the synthetic click out of the menu's own click handler so
      // the view switch lands in a clean event-loop tick -- a direct
      // btn.click() from inside the menu handler was being swallowed
      // (the pending jump was set and consumed but the view didn't swap).
      if (btn) setTimeout(() => btn.click(), 0);
    });
  } else {
    if (menu.children.length) {
      const rule = document.createElement("hr");
      rule.style.cssText = "border:0;border-top:1px solid var(--rule);margin:4px 0;";
      menu.appendChild(rule);
    }
    const head = document.createElement("p");
    head.className = "tl-ctx-head";
    head.textContent = band.title;
    head.style.cssText = "margin:0;padding:2px 14px 4px;font-size:11px;color:var(--fg-3);max-width:260px;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    menu.appendChild(head);
    for (const [label, act] of band.items) addItem(label, act);
  }

  document.body.appendChild(menu);
  placeMenu(menu, x, y);   // at (x, y), kept inside the window
  /* Dismiss on outside click / escape. A press ON the menu is a choice, not a
     dismissal: removing the menu on its own item's mousedown swallowed the
     click, so "Start a transaction here" never ran for a real mouse (item 6;
     only synthetic click events, which have no mousedown, got through). */
  function close() {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  }
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    // The menu's Escape closes the menu only (a selected stretch stays).
    if (e.type === "keydown") e.preventDefault();
    close();
  };
  /* Defer to avoid immediately catching the right-click's own mousedown */
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
}

/* Right-click on the Flow timeline background (anywhere not covered by
   a case/activity/marker/screenshot band) opens the same marker-insert
   menu as right-clicking an activity band, so the "right-click for
   menu" legend hint is always actionable. The band-specific contextmenu
   handlers stopPropagation, so they still take precedence on bands. */
document.addEventListener("contextmenu", (e) => {
  const tl = document.getElementById("timeline");
  if (!tl || !tl.contains(e.target)) return;
  if (e.target.closest(".tl-activity, .tl-case-band, .tl-screenshot, .tl-note")) return;
  if (!State.getSession()) return;
  const sp = Video.timelineSpan();
  if (!sp) return;
  const rect = tl.getBoundingClientRect();
  if (rect.width <= 0) return;
  const first = sp.startMs;
  const span = sp.endMs - first;
  if (span <= 0) return;
  e.preventDefault();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const ts = first + (x / rect.width) * span;
  showMarkerInsertMenu(e.clientX, e.clientY, new Date(ts).toISOString());
});

/* Item 6: an inserted marker shows AT ONCE on the timeline, the pane's Steps
   tab brought forward, and (D4) the steps follow it a moment later
   (scheduleAutoApply). Resolves true when saved. `words` (lane SCREEN: the
   timeline row's Start transaction and End
   transaction, whose question and message are in the button's words):
   { title, message, detail, okLabel, said }. A start asks for the
   transaction's name only while the video is paused (the rule Add step
   follows, step-panel.js nameTakesFocus): while it plays the start is added
   at once with no name and no question, so marking goes on; Rename, on the
   transaction's header beside the video, names it afterwards. One rule for
   the row's button and the right-click's Start a transaction here. */
async function queueSyntheticMarker(ts, markerType, words) {
  if (!State.getSession()) return false;
  let label = null;
  // The moment in the words of the one clock: "Transaction started at 0:05."
  const at = clock(Date.parse(ts) - recordingStartMs(State.getSession()));
  const asks = StepPanel.nameTakesFocus({ playing: Video.isPlaying(), readOnly: RO.isReadOnly(State.getSession()) });
  if (markerType === "start" && asks) {
    label = await promptModal({
      title: (words && words.title) || "Start a transaction here",
      message: (words && words.message) || "The name of the new transaction (you can leave it empty)",
      detail: (words && words.detail) || "It starts at " + at + ".",
      placeholder: "For example: Order #10900",
      okLabel: (words && words.okLabel) || TimelineRow.LABELS.start,
    });
    if (label === null) return false;     // cancelled
    label = (label || "").trim();
    if (!label) label = null;
  }
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  a.marker_edits.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    op: "insert",
    marker_type: markerType,
    label,
    timestamp: ts,
    ts: new Date().toISOString(),
  });
  // 2.0.3: a transaction's end cuts a step of the analyst's that runs past it.
  const cut = FlowMarkers.clipStepsToTransactions(a);
  try {
    await persistAnnotations(a, `insert ${markerType} marker`, cut ? ["markers", "timeline", "steps"] : ["markers", "timeline"]);
  } catch (_) {
    return false;
  }
  activateAnnoTab("markers");
  toast(words && words.said ? words.said : (markerType === "start" ? "Transaction started at " : "Transaction ended at ") + at + ".", "success");
  return true;
}

/* G4: turn the current timeline range selection into a run: queue a
   synthetic Start at the range start and an End at the range end, in one
   save so undo reverts the pair. Applied on the next normalization run.
   Lets the analyst bracket process instances in an 8-hour passive
   recording after the fact, without capture-time markers. */
async function queueCaseFromSelection() {
  const range = State.getSelectionRange();
  if (!range || !State.getSession()) return;
  const origin = recordingStartMs(State.getSession());
  let label = await promptModal({
    title: "Make it a transaction",
    message: "The name of the new transaction (you can leave it empty)",
    detail: "It starts and ends where the selection does: " + TimelineRow.stretchText(range.startMs, range.endMs, origin) + ".",
    placeholder: "For example: Order #10900",
    okLabel: "Make it a transaction",
  });
  if (label === null) return;     // cancelled
  label = (label || "").trim() || null;

  const newId = () =>
    (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
  const editedAt = new Date().toISOString();
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  a.marker_edits.push({
    id: newId(),
    op: "insert",
    marker_type: "start",
    label,
    timestamp: new Date(range.startMs).toISOString(),
    ts: editedAt,
  });
  a.marker_edits.push({
    id: newId(),
    op: "insert",
    marker_type: "end",
    label: null,
    timestamp: new Date(range.endMs).toISOString(),
    ts: editedAt,
  });
  const cut = FlowMarkers.clipStepsToTransactions(a);
  try {
    await persistAnnotations(a, "Make it a transaction", cut ? ["markers", "timeline", "steps"] : ["markers", "timeline"]);
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  clearSelectionRange();
  activateAnnoTab("markers");
  toast("Transaction made from " + TimelineRow.stretchText(range.startMs, range.endMs, origin) + ".", "success");
}

/* H6: Leave out of the analysis: the current timeline range goes into
   annotations.json.excluded_ranges; the analysis skips every event inside it
   when it drafts the steps, and the statistics cut its time out of the
   activity rows (lane FX1).
   Lets the analyst cut a lunch break or an unrelated detour out of a
   recording without touching the raw event log. The steps depend on it, so
   the analysis runs by itself right after (AD-22), as it does after Apps
   outside the process. The Timeline draws the stretch hatched over the
   Systems lane (flow-view-timeline.js); a click on it offers Include again
   (includeRangeAgain, the inverse). Undo takes either back and analyzes
   again (session.js applyRevertedAnnotations). */
async function queueExcludeRange() {
  const range = State.getSelectionRange();
  if (!range || !State.getSession()) return;
  if (!AC.hasRecording(State.getSession())) return putAside(range);
  const ok = await confirmModal({
    title: "Leave this stretch out of the analysis?",
    message: "The steps and the map are drafted again without what was recorded in the selected stretch.",
    detail: "The recording keeps it. The Timeline shows the stretch hatched: click it to include it again.",
    okLabel: "Leave out",
  });
  if (!ok) return;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.excluded_ranges)) a.excluded_ranges = [];
  a.excluded_ranges.push({
    start: new Date(range.startMs).toISOString(),
    end: new Date(range.endMs).toISOString(),
    reason: "manual",
  });
  try {
    await saveAnnotationsWithUndo(a, "Leave out of the analysis");
    State.getSession().annotations = a;
  } catch (err) {
    return;   // already shown to the analyst by session.js
  }
  toast("Left out of the analysis: the Timeline shows the stretch hatched.", "success");
  clearSelectionRange();
  renderTimeline();
  Transcript.refreshTab();
  analyzeSession();
}

/* Lane E (E4): Not part of the process, in a project without a recording
   (C16): the selected stretch (a detour of the call) goes into the same
   annotations.excluded_ranges, one undoable edit and no question. Nothing
   is analyzed: no step, no map and no PDD reads it there (left-out.js
   analysisRanges); playing skips it and the Transcript tab leaves out what
   was said in it. Include again, on the stretch, is the inverse. */
async function putAside(range) {
  const sess = State.getSession();
  if (!sess || RO.isReadOnly(sess)) return;
  const a = sess.annotations || {};
  if (!Array.isArray(a.excluded_ranges)) a.excluded_ranges = [];
  a.excluded_ranges.push({
    start: new Date(range.startMs).toISOString(),
    end: new Date(range.endMs).toISOString(),
    reason: "manual",
  });
  try {
    await saveAnnotationsWithUndo(a, "Not part of the process");
    sess.annotations = a;
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  toast("Marked as not part of the process.", "success");
  clearSelectionRange();
  renderTimeline();
  Transcript.refreshTab();
}

/* Include again (a click on a stretch left out, on the Timeline): the range
   leaves annotations.excluded_ranges and the analysis runs again, as it does
   after leaving one out; its steps are drafted again. One undoable edit. */
async function includeRangeAgain(range) {
  const sess = State.getSession();
  if (!sess || !range) return;
  const a = sess.annotations || {};
  const list = Array.isArray(a.excluded_ranges) ? a.excluded_ranges : [];
  const i = list.findIndex((r) => r && r.start === range.start && r.end === range.end);
  if (i === -1) return;
  list.splice(i, 1);
  a.excluded_ranges = list;
  try {
    await saveAnnotationsWithUndo(a, "Include again");
    sess.annotations = a;
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  renderTimeline();
  Transcript.refreshTab();
  // Lane E (E4): a stretch that was not part of the process (a project
  // without a recording) changed nothing that an analysis makes.
  if (!AC.hasRecording(sess)) {
    toast("Included again.", "success");
    return;
  }
  toast("Included again: its steps are drafted again.", "success");
  analyzeSession();
}

/* The timeline lane toggles, renderTimeline (the lane stack), its lane
   helpers (layoutCaseLanes / isUserActivityEvent / monitorBadgeFor), and
   the bar of the whole length all live in flow-view-timeline.js (god-file
   split). */

/* Right-click on a run band: jump to its start or end (lane LANES: a
   double-click on it shows only that transaction). Uses the same
   context-menu construction pattern as showMarkerInsertMenu. */
/* A transaction's band right-clicked at `ts`: what marks there (Start a
   transaction, End the transaction, Add a step: an open transaction's band
   runs on to the end, over where its next marks go), then its own jumps. */
function showCaseContextMenu(x, y, c, ts) {
  const items = [["Jump to start", () => seekToTimestamp(new Date(c.startMs).toISOString())]];
  if (!c.dangling) items.push(["Jump to end", () => seekToTimestamp(new Date(c.endMs).toISOString())]);
  showMarkerInsertMenu(x, y, ts || new Date(c.startMs).toISOString(),
    { title: c.title + (c.label && c.label !== c.title ? " · " + c.label : ""), items });
}

/* Video playback, the playhead, seeking, watch-a-step, and the
   interactive video re-sync flow live in flow-view-video.js (god-file
   split). The helpers used here (videoStartTs / seekToTimestamp /
   videoTimeToSessionTs / setVideoOverlay / positionPlayhead) are
   destructured at the top of this module. */

/* ============ Event table ========================================= */

/* The Raw events drawer (the machine layer, P2.10) shows on the Timeline
   only, and (lane FX3, validation pass 3, F16) only when the project has
   events: a project made from a video or from nothing has none, and an
   empty table with its filters said nothing. */
function syncRawEventsShown() {
  const host = document.querySelector(".event-table-host");
  if (!host) return;
  const sess = State.getSession();
  host.style.display = State.getLevel() === "flow" && sess && (sess.events || []).length ? "" : "none";
}

function renderEventTable() {
  const filter = ($("#event-filter").value || "").toLowerCase();
  const showAct = $("#cb-show-activity").checked;
  const showMark = $("#cb-show-marker").checked;
  const showSys = $("#cb-show-system").checked;
  const showInter = $("#cb-show-interaction") ? $("#cb-show-interaction").checked : true;
  const tbody = $("#event-table tbody");
  tbody.innerHTML = "";
  let count = 0;
  // The one clock (AD-26): the time since the recording started, as every
  // other time in the viewer reads (lane FX1: this table once printed the
  // time of day).
  const origin = recordingStartMs(State.getSession());
  for (const ev of State.getSession().events) {
    if (ev.type === "activity" && !showAct) continue;
    if (ev.type === "marker" && !showMark) continue;
    if (ev.type === "system" && !showSys) continue;
    if (ev.type === "interaction" && !showInter) continue;
    const lbl = ev.type === "activity"
      ? (ev.data.activity_label || ev.data.app || "")
      : ev.type === "marker"
        ? (ev.data.marker_type + ": " + (ev.data.label || ""))
      : ev.type === "interaction"
        ? ((ev.data.kind || "") + ": " + (ev.data.name || ev.data.automation_id || ev.data.control_type || ""))
        : (ev.data.kind || "");
    const detail = ev.type === "activity"
      ? (ev.data.title || "")
      : ev.type === "marker"
        ? (ev.data.reason ? "reason: " + ev.data.reason : "")
      : ev.type === "interaction"
        ? ((ev.data.window_title || "") + (ev.data.process_name ? " · " + ev.data.process_name : ""))
        : JSON.stringify(ev.data).slice(0, 120);
    if (filter && !lbl.toLowerCase().includes(filter) && !detail.toLowerCase().includes(filter)) continue;
    const tr = document.createElement("tr");
    tr.className = "t-" + ev.type;
    const td = (cls, text) => {
      const c = document.createElement("td");
      if (cls) c.className = cls;
      c.textContent = text || "";
      return c;
    };
    tr.appendChild(td("t-time", sinceStart(ev.timestamp, origin)));
    tr.appendChild(td("t-type", ev.type));
    tr.appendChild(td("", lbl));
    tr.appendChild(td("", detail));
    tr.appendChild(td("", ev.type === "activity" ? formatDuration(ev.data.duration_ms) : ""));
    tr.appendChild(buildEventActions(ev));
    tr.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    tbody.appendChild(tr);
    count += 1;
  }
  $("#event-count").textContent = String(count);
}

/* Per-row action cell for the raw events table: jump to the event, or
   start a step at its time. (A step's boundaries are set in Steps: Split,
   Merge and + Add step; the table adds no event to a step.) */
function buildEventActions(ev) {
  const cell = document.createElement("td");
  cell.className = "t-actions";
  const mkBtn = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ev-act";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  cell.appendChild(mkBtn("jump", "Seek the video and timeline to this event",
    () => seekToTimestamp(ev.timestamp)));
  // Lane HV: no step is added in a hand-off opened read only.
  if (!RO.isReadOnly(State.getSession())) {
    cell.appendChild(mkBtn("+ step", "Create a step at this event's time",
      () => addStepAtTimestamp(ev.timestamp)));
  }
  return cell;
}

$("#event-filter").addEventListener("input", () => renderEventTable());
$("#cb-show-activity").addEventListener("change", () => renderEventTable());
$("#cb-show-marker").addEventListener("change", () => renderEventTable());
$("#cb-show-system").addEventListener("change", () => renderEventTable());
if ($("#cb-show-interaction")) $("#cb-show-interaction").addEventListener("change", () => renderEventTable());

/* NAV-AUDIT §D13/§I, lane SCREEN: the Raw events drawer sits under the
   timeline (P2.10: it shows on the Timeline only, renderer.js applyLevel).
   The page does not scroll on this level: opened, the drawer's table shows
   above its own line (styles.css .view.on-timeline .event-table-host), so
   the line stays where it was and the stage gives way. */

/* ============ Screenshots / markers ================================ */

/* renderScreenshots / the screenshot gallery / openScreenshot live in
   flow-view-screenshots.js (god-file split);
   renderScreenshots + openScreenshot are destructured at the top here. */

/* getMarkerEdit / effectiveLabel / effectiveTimestamp / isDeletedMarker,
   and the per-marker move / delete / rename actions live in
   flow-view-markers.js (god-file split). */

/* deps = { rerenderActiveLevel, addStepAtTimestamp }: the cross-surface
   glue kept in renderer.js. Call once at boot. */
function initFlowView(deps) {
  rerenderActiveLevel    = deps.rerenderActiveLevel    || (() => {});
  addStepAtTimestamp     = deps.addStepAtTimestamp     || (async () => {});
  // Hand the video module the session (re)loader it calls after a re-sync,
  // injected rather than require()d to avoid a flow-view <-> video cycle.
  Video.initVideo({ loadSessionIntoView, onPlayhead: syncTimelineRow });
  // Hand the timeline module the flow-view-resident glue its lanes call
  // (the two context menus, Include again), injected to keep the
  // timeline <-> flow-view graph acyclic.
  Timeline.initTimeline({
    showMarkerInsertMenu, showCaseContextMenu,
    includeAgain: (range) => includeRangeAgain(range),
  });
  // The transcript's menu actions reload the session; its sync redraws the lane.
  // Lane E (E3): the Transcript tab adds a step where S would, and includes
  // a stretch again as the Timeline's band does.
  Transcript.initTranscript({ loadSessionIntoView, renderTimeline, addStepAt,
    includeAgain: (range) => includeRangeAgain(range) });
}

module.exports = {
  initFlowView,
  loadSessionIntoView, renderTimeline,
  // Lane MW: a project in a new window (the Open menu's recent projects).
  openInNewWindow,
  // The analysis: automatic runs, the deliberate ones (confirm), and the
  // pipeline runner the exports share (one status line, one log).
  renderSessionPills, analyzeSession, analysisBusy, runPipeline, UPDATING,
  // 2.0.3, D4: marker changes that apply themselves, in every project.
  scheduleAutoApply, yieldAutoApply, markersReverted,
  seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow,
  activateAnnoTab, addStepAtPlayhead,
  // Lane PANE: Starts here on a row of the pane's Steps tab.
  showHereAt,
  // Lane SCREEN: the timeline's first row.
  syncTimelineRow,
  // The Overview's marker-problem fixes (overview-view.js).
  queueSyntheticMarker, queueMarkerDelete,
  // Lane FX3: the Raw events drawer's rule (renderer.js applyLevel), and
  // what a restored backup says about the files added after it.
  syncRawEventsShown, restoredFilesLine,
};
