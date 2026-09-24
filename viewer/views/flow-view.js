/*
 * flow-view.js: the Timeline level of the Session view (data-level "flow").
 *
 * Owns session load + analysis (loadSessionIntoView / openSessionFlow / the
 * automatic analysis and its status line), the timeline and every lane, the minimap,
 * range selection, the video <-> timeline sync, the event table, the
 * screenshots / markers side panel (incl. the screenshot gallery and marker
 * CRUD), and case scope. The module wires its own controls at require()
 * time (the DOM is already parsed when renderer.js pulls this in).
 * Cross-surface glue that stays in the entry (rerenderActiveLevel,
 * addStepAtTimestamp) is injected by renderer.js via initFlowView().
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const { $, $$, escapeHtml, formatDuration, toast, placeMenu } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { resetUndoStack, captureBaseline, saveAnnotationsWithUndo, persistAnnotations } = require("../session.js");
const SaveState = require("../save-state.js");
const MarkerEdits = require("../marker-edits.js");
const RunsModel = require("../runs-model.js");
const SPM = require("../sub-process-maps.js");
const { caseScopeOptionsHtml } = require("../case-scope.js");
const { pushRecent } = require("../recent.js");
const { analysisNeed } = require("../normalize-result.js");
const { recentLabel } = require("../session-summary.js");
const { renderStepsLevel } = require("./steps-view.js");
const { renderOverviewLevel, hasAnalysisBlocks } = require("./overview-view.js");
const { appColor, appLabel, renderLegend } = require("./flow-view-apps.js");
const Video = require("./flow-view-video.js");
const {
  setVideoOverlay, positionPlayhead, videoStartTs, videoTimeToSessionTs,
  seekToTimestamp, jumpToStepInFlow,
} = Video;
const { renderScreenshots, openScreenshot } = require("./flow-view-screenshots.js");
const FlowMarkers = require("./flow-view-markers.js");
const {
  effectiveLabel, renderMarkersList,
} = FlowMarkers;
const Timeline = require("./flow-view-timeline.js");
const {
  renderTimeline, renderTimelineSummary, restoreTimelineForCurrent,
  maybeAutoScrollToFirstCase, _wireTimelineScrollPersist, setLaneToggle,
} = Timeline;
const Transcript = require("./flow-view-transcript.js");
const AnalystUI = require("./analyst-ui.js");

/* Injected by renderer.js -- cross-surface glue kept in the thin entry.
   Lazy wrappers so hoisting / load order does not matter. */
let rerenderActiveLevel = () => {};
let addStepAtTimestamp = async () => {};

/* ============ Annotation sub-tabs ================================= */

function activateAnnoTab(name) {
  $$(".anno-tab").forEach((t) => t.classList.toggle("active", t.dataset.anno === name));
  $$(".anno-panel").forEach((p) =>
    p.style.display = p.dataset.panel === name ? "" : "none"
  );
}

$$(".anno-tab").forEach((tab) => {
  tab.addEventListener("click", () => activateAnnoTab(tab.dataset.anno));
});

/* ============ Case scope ========================================== */

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

/* Build the canonical list of cases for the loaded session. Pairs
   step.case_id ranges (the data-side source of truth) with marker
   labels (the user-recognizable name) so the dropdown shows e.g.
   "Order #12345" instead of "c001". */
function deriveCases(session) {
  if (!session) return [];
  const steps = (session.annotations && session.annotations.steps) || [];
  // The markers the last analysis used (renames applied), in time order.
  const markers = MarkerEdits.appliedMarkerEvents(MarkerEdits.sessionMarkerView(session));

  const byCase = new Map();
  for (const s of steps) {
    if (!s.case_id || !s.time_range) continue;
    const startMs = new Date(s.time_range.start).getTime();
    const endMs = new Date(s.time_range.end).getTime();
    if (!byCase.has(s.case_id)) {
      byCase.set(s.case_id, { id: s.case_id, label: s.case_id, startMs, endMs });
    } else {
      const c = byCase.get(s.case_id);
      c.startMs = Math.min(c.startMs, startMs);
      c.endMs = Math.max(c.endMs, endMs);
    }
  }

  // Best-effort marker-label enrichment: match a case whose range begins
  // within 5s of a start marker, adopt the marker's label. Runs never nest
  // (the pipeline's rule, case_assignment.py): every Start opens a run, ended
  // by its End or by the next Start, so each Start names its own run.
  for (const ev of markers) {
    if (ev.data.marker_type !== "start" || !ev.data.label) continue;
    const t = new Date(ev.timestamp).getTime();
    for (const c of byCase.values()) {
      if (Math.abs(c.startMs - t) < 5000) c.label = ev.data.label;
    }
  }

  return Array.from(byCase.values()).sort((a, b) => a.startMs - b.startMs);
}

function currentScopeRange() {
  if (!State.getCaseScope() || !State.getSession()) return null;
  const cases = deriveCases(State.getSession());
  return cases.find(c => c.id === State.getCaseScope()) || null;
}

function populateCaseScope() {
  const sel = document.getElementById("case-scope-select");
  if (!sel) return;
  const sess = State.getSession();
  const cases = sess ? deriveCases(sess) : [];
  const evs = (sess && sess.events) || [];
  // AD-29: each option carries the Steps level's title for its run
  // ("Transaction 1 · Order #10900"). P2.8 duplicate-label suffixes + RP-34
  // escaping: case-scope.js (pure).
  const runs = sess ? RunsModel.buildRuns(sess.stats, (sess.annotations && sess.annotations.steps) || []).runs : [];
  const titled = cases.map((c) => {
    const run = runs.find((r) => r.caseId === c.id);
    return run ? Object.assign({}, c, { title: run.title }) : c;
  });
  sel.innerHTML = caseScopeOptionsHtml(titled, State.getCaseScope(),
    evs.length ? new Date(evs[0].timestamp).getTime() : NaN);
  // Wrapper picks up the visual cue that scoping is active.
  const wrap = sel.closest(".case-scope");
  if (wrap) wrap.classList.toggle("scoped", !!State.getCaseScope());
}

(function wireCaseScope() {
  const sel = document.getElementById("case-scope-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    State.setCaseScope(sel.value || "");
    const wrap = sel.closest(".case-scope");
    if (wrap) wrap.classList.toggle("scoped", !!State.getCaseScope());
    // Re-render whatever's currently on screen
    rerenderActiveLevel();
  });
})();

/* The markers side-panel and the marker-edit resolution live in
   flow-view-markers.js (god-file split). effectiveLabel and renderMarkersList
   are destructured at the top here; the marker-INSERT surfaces stay below. */

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await Ipc.openSessionFolder();
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

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
  toast("Project made: " + path.basename(r.folder) + ". Add its steps in Steps.", "success");
}
if ($("#btn-new-from-video")) $("#btn-new-from-video").addEventListener("click", () => newProject("video"));
if ($("#btn-new-blank")) $("#btn-new-blank").addEventListener("click", () => newProject("blank"));

/* ============ Analysis: it runs by itself (AD-22) ===================
   The pipeline runs on open when the recording has no analysis or one from an
   older version, after Leave apps out and after a range is left out, inside
   Edit as the As-Is map and inside the PDD export. The one manual act is
   Apply N marker changes (it redrafts the changed runs, so it asks first);
   Help, Troubleshooting has Re-analyze for a stuck state. While a run lasts
   the top bar says so in one line with Cancel and the page stays as it is
   (main refuses annotation writes meanwhile, so no edit is lost to the run);
   the analysis log shows only when a run fails, its failure sentence first.
   Runs go one at a time. */

const UPDATING = "Updating steps and map...";
let _running = null;                 // the status line's text while a run lasts
let _runQueue = Promise.resolve();
const _analyzedOnOpen = new Set();   // folders analyzed as they opened, in this window

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
  _runQueue = job.catch(() => {});
  return job;
}

/* What the two deliberate analyses ask first, when the recording has steps. */
const CONFIRMS = {
  markers: (n) => ({
    title: "Apply " + n + " marker change" + (n === 1 ? "" : "s"),
    message: "Update the drafts of the changed transactions?",
    detail: "Your confirmed, edited, added and hidden steps are kept.",
    okLabel: "Apply",
  }),
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
   opts.confirm: "markers" (Apply N marker changes) or "reanalyze" (Help's
   Re-analyze) asks first when the recording has steps; the automatic runs
   (on open, Leave apps out, a range left out, the Map's edit act) never ask. */
async function analyzeSession(opts) {
  const sess = State.getSession();
  if (!sess) return false;
  const kind = opts && opts.confirm;
  if (kind && CONFIRMS[kind] && ((sess.annotations && sess.annotations.steps) || []).length) {
    const n = MarkerEdits.pendingEditCount((sess.annotations || {}).marker_edits, MarkerEdits.lastAnalysisMs(sess));
    const ok = await confirmModal(CONFIRMS[kind](n));
    if (!ok) return false;
  }
  const folder = sess.sessionFolder;
  const r = await runPipeline({ sessionFolder: folder, mine: true }, UPDATING);
  const onScreen = !!(State.getSession() && State.getSession().sessionFolder === folder);
  if (!onScreen) return false;
  if (r.cancelled) { toast("Update cancelled: the steps and the map are as they were."); return false; }
  if (!r.ok) { toast(r.error, "error"); return false; }
  toast("Steps and map updated.", "success");
  await loadSessionIntoView(folder, { afterAnalysis: true });
  return true;
}

/* The status line in the top bar (#session-pills): while a run lasts, what it
   does and Cancel; else the one call to action that applies pending marker
   changes. Delegated once, since each render replaces the buttons. */
(function wireStatusLine() {
  const host = $("#session-pills");
  if (!host) return;
  host.addEventListener("click", async (e) => {
    if (e.target.closest("#btn-cancel-normalize")) {
      e.preventDefault();
      await Ipc.cancelNormalize();
      toast("Cancelling the update...");
    } else if (e.target.closest("#btn-apply-marker-edits")) {
      analyzeSession({ confirm: "markers" });
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
  try {
    State.setSession(await Ipc.loadSession(folder));
  } catch (e) {
    toast("Failed to load: " + (e.message || e), "error");
    return;
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
  renderAnnotationsErrorBanner();
  // The top bar's save state follows the project on screen (save-state.js).
  SaveState.projectOpened(State.getSession());
  // A failed run's log belongs to the recording it ran on.
  const _run = State.getAnalysisRun();
  if (!_run || _run.folder !== State.getSession().sessionFolder || _run.status !== "failed") hideAnalysisLog();
  /* The Recents entry is named by the document title once it is written,
     else by the name given at the end of the recording, else by its project
     and folder (session-summary.recentLabel). */
  pushRecent(folder, recentLabel(State.getSession(), path.basename(folder)));

  renderSessionPills();
  // C8: the transcript's menu items follow the loaded file.
  Transcript.onSessionLoaded();
  // Wire video. Toggle the no-video card explicitly since the
  // sibling-selector CSS only fires when [src] is present.
  const video = $("#video");
  const noVid = $("#no-video");
  const overlay = $("#video-overlay");
  // Item 1: when no recording is linked, collapse the tall black video stage
  // to a slim one-line band and give the freed space to the timeline + notes.
  // The `no-recording` class on the workspace drives the CSS collapse; the
  // slim band keeps a "Link recording…" affordance so the inverse verb
  // survives. When a recording IS linked, behaviour is unchanged.
  const workspace = document.getElementById("lower-workspace");
  const pane = document.getElementById("video-pane");
  if (State.getSession().recordingAvailable && State.getSession().recordingPath) {
    video.src = "file:///" + State.getSession().recordingPath.replace(/\\/g, "/");
    video.style.display = "";
    noVid.style.display = "none";
    overlay.style.display = "";
    if (workspace) workspace.classList.remove("no-recording");
    if (pane) pane.classList.remove("no-recording");
  } else {
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
    noVid.style.display = "";
    overlay.style.display = "none";
    if (workspace) workspace.classList.add("no-recording");
    if (pane) pane.classList.add("no-recording");
  }
  syncVideoControls();
  // The #video timeupdate/loadedmetadata listeners are wired ONCE at module
  // init (see wireVideoListeners below) -- adding them here ran on every
  // session load and leaked a fresh loadedmetadata arrow each time.
  setVideoOverlay(State.getSession().recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderScreenshots();
  renderMarkersList();
  renderTimelineSummary();
  // Phase B+ surfaces
  State.setSelectedStepId(null);
  State.setMultiSelectedStepIds(new Set());
  renderStepsLevel();
  // The Overview level (lab-phase §A5) is the default on load; it reads the
  // freshly-loaded analysis.json blocks and (R4) renders the Evidence modules
  // that the retired Analysis level used to own, so refreshing it here covers
  // the what-is-left line, the session summary, the findings and the Evidence.
  renderOverviewLevel();
  // Refresh case-scope dropdown -- clear scope if the new session no
  // longer contains the previously-selected case.
  populateCaseScope();
  const cases = deriveCases(State.getSession()).map(c => c.id);
  if (State.getCaseScope() && !cases.includes(State.getCaseScope())) {
    State.setCaseScope("");
    populateCaseScope();
  }
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
  if (!(opts && opts.afterAnalysis) && !opened.annotationsError && analysisNeed(opened) &&
      !_analyzedOnOpen.has(opened.sessionFolder)) {
    _analyzedOnOpen.add(opened.sessionFolder);
    analyzeSession().catch((e) => console.error("[flow-view] the automatic analysis failed:", e));
  }
}

/* The controls that act on the video show only while one is linked: the
   Timeline toolbar's + Step (a step at the playhead) and Sync video in the
   video pane's header. Without a video they could only answer with an error. */
function syncVideoControls() {
  const sess = State.getSession();
  const hasVideo = !!(sess && sess.recordingAvailable);
  for (const id of ["btn-add-step", "btn-sync-video"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = !hasVideo;
  }
  // A video project (C16) has nothing to sync the video with: the Timeline is the video.
  const sync = document.getElementById("btn-sync-video");
  if (sync && !(sess && (sess.events || []).length)) sync.hidden = true;
}

/* RP-04: an annotations.json that exists but cannot be read is an error the
   analyst must see, never an empty session. main.js reports it as
   session.annotationsError ({ file, reason, backups, message }); this
   persistent banner names the file, what it means, and the backups to
   restore. Saves and Analyze are refused in main while it lasts. */
function annotationsErrorBannerHtml(err) {
  if (!err || !err.message) return "";
  return '<strong>The annotations for this project cannot be read.</strong> ' + escapeHtml(err.message);
}
function renderAnnotationsErrorBanner() {
  const el = document.getElementById("annotations-error-banner");
  if (!el) return;
  const html = annotationsErrorBannerHtml(State.getSession() && State.getSession().annotationsError);
  el.innerHTML = html;
  el.style.display = html ? "" : "none";
}

/* Wire the video element's listeners ONCE. loadSessionIntoView runs on every
   session load; adding these there re-bound a new loadedmetadata arrow each
   time (timeupdate dedups by reference, loadedmetadata did not) -> a listener
   leak across sessions. #video is a stable element in index.html. */
(function wireVideoListeners() {
  const video = document.getElementById("video");
  if (!video) return;
  video.addEventListener("timeupdate", positionPlayhead);
  // A video without a length in its file (a recorded .webm) reports Infinity.
  video.addEventListener("loadedmetadata", () =>
    setVideoOverlay(isFinite(video.duration) ? `${formatDuration(video.duration * 1000)} loaded` : "loaded"));
  // C16: a video project's Timeline runs on its video's length.
  const lengthKnown = () => {
    if (Video.noteVideoLength(video)) { renderTimeline(); renderTimelineSummary(); positionPlayhead(); }
  };
  video.addEventListener("loadedmetadata", lengthKnown);
  video.addEventListener("durationchange", lengthKnown);
})();

/* The top bar's status line (#session-pills): while the pipeline runs, one
   line saying so with Cancel; else, when marker changes wait (item 6), the
   ONE call to action that applies them, visible from every level. It goes
   once an analysis applied them. The clicks are delegated (wireStatusLine). */
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
  if (!sess) { host.innerHTML = ""; return; }
  // Marker changes that wait for an analysis (marker-edits.js). They already
  // show in the Markers list and on the timeline as pending.
  const pending = MarkerEdits.pendingEditCount((sess.annotations || {}).marker_edits,
    MarkerEdits.lastAnalysisMs(sess));
  host.innerHTML = pending > 0
    ? '<button type="button" class="pending-cta" id="btn-apply-marker-edits" title="' +
      escapeHtml("Your marker changes already show on the timeline and in the Markers list. " +
        "The transactions, the steps and the map use them once you apply them.") + '">' +
      escapeHtml("Apply " + pending + " marker change" + (pending === 1 ? "" : "s")) +
      "</button>"
    : "";
}

/* Queue a marker deletion into annotations.json.marker_edits. Mirrors
   queueSyntheticMarker; the edit applies on the next normalization, and
   shows at once as pending (item 6). Resolves true when it was saved (a
   failed save has already been shown to the analyst by session.js). */
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
  toast("Marker deleted. Click Apply marker changes to update the transactions.", "success");
  return true;
}

/* ============ Timeline ============================================ */

/* appColor / appLabel / renderLegend live in flow-view-apps.js (god-file
   split) and are destructured at the top of this module. */

/* Timeline zoom/scroll persistence, the minimap, the lane toggles, the
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
  const video = $("#video");
  const tsISO = video ? videoTimeToSessionTs(video.currentTime) : null;
  if (!tsISO) { toast("No video timing: can't place a step at the playhead", "error"); return; }
  setLaneToggle("steps", true);
  const cb = document.querySelector('#lanes-popup input[data-lane="steps"]');
  if (cb) cb.checked = true;
  await addStepAtTimestamp(tsISO);
}

// The zoom buttons are wired in flow-view-timeline.js (god-file split).
$("#btn-add-step").addEventListener("click", addStepAtPlayhead);

/* P1.1: range selection on the timeline. Drag across the activity
   lane to select a time range; a stats card pops up summarizing what
   happened (duration, event count, top apps, contained markers). The
   range survives view-mode switches but clears on session change.
   Esc / click outside clears. */
function clearSelectionRange() {
  State.setSelectionRange(null);
  const ov = document.getElementById("tl-selection-overlay");
  if (ov) ov.remove();
  const card = document.getElementById("tl-selection-stats");
  if (card) card.remove();
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
    // markers / dots / labels stay normal click-to-seek.
    if (e.target !== host) return;
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
    renderSelectionStats();
    startX = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && State.getSelectionRange()) clearSelectionRange();
  });
}
function renderSelectionStats() {
  if (!State.getSelectionRange() || !State.getSession()) return;
  let card = document.getElementById("tl-selection-stats");
  if (!card) {
    card = document.createElement("div");
    card.className = "selection-stats";
    card.id = "tl-selection-stats";
    // Place above the legend so it doesn't crowd the timeline.
    const legend = document.getElementById("timeline-legend");
    if (legend && legend.parentNode) legend.parentNode.insertBefore(card, legend);
  }
  const evs = State.getSession().events;
  const inRange = evs.filter((ev) => {
    const t = new Date(ev.timestamp).getTime();
    return t >= State.getSelectionRange().startMs && t <= State.getSelectionRange().endMs;
  });
  const appCounts = {};
  let markerCount = 0, screenshotCount = 0;
  const appNames = ((State.getSession().stats || {}).meta || {}).app_names || {};
  for (const ev of inRange) {
    if (ev.type === "activity") {
      // Counted by system (C14): a Chrome window on Salesforce is Salesforce.
      const system = appLabel(ev.data.app, ev.data.title, appNames);
      appCounts[system] = (appCounts[system] || 0) + 1;
    } else if (ev.type === "marker") markerCount++;
    else if (ev.type === "system" &&
             (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      screenshotCount++;
    }
  }
  const topApps = Object.entries(appCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([system, n]) => system + " (" + n + ")")
    .join(", ");
  const dur = State.getSelectionRange().endMs - State.getSelectionRange().startMs;
  card.innerHTML =
    '<h4>Selection</h4>' +
    '<div class="row"><span>Duration</span><span>' + escapeHtml(formatDuration(dur)) + '</span></div>' +
    '<div class="row"><span>Events</span><span>' + inRange.length + '</span></div>' +
    '<div class="row"><span>Markers</span><span>' + markerCount + '</span></div>' +
    '<div class="row"><span>Screenshots</span><span>' + screenshotCount + '</span></div>' +
    (topApps ? '<div class="row"><span>Systems</span><span>' + escapeHtml(topApps) + '</span></div>' : '') +
    '<button class="summary-fix" id="tl-selection-case">Insert transaction from selection</button>' +
    '<button class="summary-fix" id="tl-selection-exclude" title="Draft the steps and the map again without the events in this range.">Exclude from analysis</button>' +
    '<span class="clear-link" id="tl-selection-clear">× Clear selection</span>';
  document.getElementById("tl-selection-clear").addEventListener("click", clearSelectionRange);
  document.getElementById("tl-selection-case").addEventListener("click", queueCaseFromSelection);
  document.getElementById("tl-selection-exclude").addEventListener("click", queueExcludeRange);
}

/* The screenshot surfaces (hover thumb, grid, gallery, openScreenshot)
   live in flow-view-screenshots.js (god-file split). */

/* renderMinimap / syncMinimapViewport / the minimap + middle-drag-pan
   wiring and renderTimelineSummary live in flow-view-timeline.js. */

/* Pop a tiny context menu at (x, y) offering to queue a synthetic marker
   insert into annotations.json.marker_edits at timestamp `ts`. The edit
   only takes effect on the next normalization run. */
function showMarkerInsertMenu(x, y, ts) {
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

  // AD-29: a Start marker starts a transaction, an End marker ends it.
  addItem("Start a transaction here…", () => queueSyntheticMarker(ts, "start"));
  addItem("End the transaction here",  () => queueSyntheticMarker(ts, "end"));
  // C16: a note pinned to this moment (the Notes lane; never printed).
  addItem("Add note here…",            () => AnalystUI.addNote(null, ts));
  addItem("Jump to step here",         () => {
    State.setPendingStepJump(ts);
    const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
    // Defer the synthetic click out of the menu's own click handler so
    // the view switch lands in a clean event-loop tick -- a direct
    // btn.click() from inside the menu handler was being swallowed
    // (the pending jump was set and consumed but the view didn't swap).
    if (btn) setTimeout(() => btn.click(), 0);
  });

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
  if (e.target.closest(".tl-activity, .tl-case-band, .tl-marker, .tl-screenshot, .tl-note")) return;
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

/* Item 6: an inserted marker shows AT ONCE, marked pending, in the Markers
   list (brought forward) and on the timeline, and the top bar offers the one
   call to action that applies it (Apply marker changes). Resolves true when
   saved. */
async function queueSyntheticMarker(ts, markerType) {
  if (!State.getSession()) return false;
  let label = null;
  if (markerType === "start") {
    label = await promptModal({
      title: "Start a transaction here",
      message: "Label for the new transaction (its Start marker)",
      detail: "It shows at once as pending, and applies to the transactions when you click Apply marker changes.",
      placeholder: "For example: Order #10900",
      okLabel: "Insert",
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
  try {
    await persistAnnotations(a, `insert ${markerType} marker`, ["markers", "timeline"]);
  } catch (_) {
    return false;
  }
  activateAnnoTab("markers");
  toast(`${markerType === "start" ? "Start" : "End"} marker added. Click Apply marker changes to update the transactions.`, "success");
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
  let label = await promptModal({
    title: "Insert transaction from selection",
    message: "Label for the new transaction",
    detail: "Adds a Start and an End marker. They show at once as pending, and apply to the transactions when you click Apply marker changes.",
    placeholder: "For example: Order #10900",
    okLabel: "Insert transaction",
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
  try {
    await persistAnnotations(a, "insert transaction from selection", ["markers", "timeline"]);
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  activateAnnoTab("markers");
  toast("Transaction markers added. Click Apply marker changes to update the transactions.", "success");
}

/* H6: mark the current timeline range as excluded from analysis. The
   range is stored in annotations.json.excluded_ranges; the analysis skips
   every event inside it when it drafts the steps and computes the
   statistics. Lets the analyst cut a lunch break or an unrelated detour out
   of a long passive recording without touching the raw event log. The steps
   depend on it, so the analysis runs by itself right after (AD-22), as it
   does after Leave apps out. */
async function queueExcludeRange() {
  const range = State.getSelectionRange();
  if (!range || !State.getSession()) return;
  const ok = await confirmModal({
    title: "Exclude this range from analysis?",
    message: "The steps and the map are drafted again without the events in the selected range.",
    detail: "The recording itself keeps them.",
    okLabel: "Exclude range",
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
    await saveAnnotationsWithUndo(a, "exclude range from analysis");
    State.getSession().annotations = a;
  } catch (err) {
    return;   // already shown to the analyst by session.js
  }
  toast("Range excluded.", "success");
  clearSelectionRange();
  analyzeSession();
}

/* The timeline lane toggles, renderTimeline (the lane stack), its lane
   helpers (layoutCaseLanes / isUserActivityEvent / monitorBadgeFor), and
   the minimap all live in flow-view-timeline.js (god-file split). */

/* Right-click on a run band: jump to its start or end (the Run select in the
   timeline header dims the other runs). Uses the same context-menu
   construction pattern as showMarkerInsertMenu. */
function showCaseContextMenu(x, y, c) {
  const prior = document.getElementById("tl-ctx-menu");
  if (prior) prior.remove();
  const menu = document.createElement("div");
  menu.id = "tl-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);" +
    "min-width:240px;cursor:default;user-select:none;";
  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", () => { menu.remove(); handler(); });
    menu.appendChild(item);
  }
  addItem("Jump to start", () => seekToTimestamp(new Date(c.startMs).toISOString()));
  if (!c.dangling) {
    addItem("Jump to end", () => seekToTimestamp(new Date(c.endMs).toISOString()));
  }
  document.body.appendChild(menu);
  placeMenu(menu, x, y);   // at (x, y), kept inside the window
  function dismiss(e) {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  }
  function onKey(e) {
    if (e.key === "Escape") {
      menu.remove();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  }
  document.addEventListener("click", dismiss, true);
  document.addEventListener("keydown", onKey, true);
}

/* Video playback, the playhead, seeking, watch-a-step, and the
   interactive video re-sync flow live in flow-view-video.js (god-file
   split). The helpers used here (videoStartTs / seekToTimestamp /
   videoTimeToSessionTs / setVideoOverlay / positionPlayhead) are
   destructured at the top of this module. */

/* ============ Event table ========================================= */

function renderEventTable() {
  const filter = ($("#event-filter").value || "").toLowerCase();
  const showAct = $("#cb-show-activity").checked;
  const showMark = $("#cb-show-marker").checked;
  const showSys = $("#cb-show-system").checked;
  const showInter = $("#cb-show-interaction") ? $("#cb-show-interaction").checked : true;
  const tbody = $("#event-table tbody");
  tbody.innerHTML = "";
  let count = 0;
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
    const t = new Date(ev.timestamp);
    tr.appendChild(td("t-time",
      String(t.getHours()).padStart(2, "0") + ":" +
      String(t.getMinutes()).padStart(2, "0") + ":" +
      String(t.getSeconds()).padStart(2, "0") + "." +
      String(t.getMilliseconds()).padStart(3, "0")));
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

/* Per-row action cell for the raw events table: jump to the event,
   spin a new step off it, or attach it to the selected step. */
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
  cell.appendChild(mkBtn("+ step", "Create a step at this event's time",
    () => addStepAtTimestamp(ev.timestamp)));
  if (ev.type === "interaction" && ev.event_id) {
    cell.appendChild(mkBtn("+ to step", "Add this interaction to the selected step",
      () => addEventToSelectedStep(ev)));
  }
  return cell;
}

/* Append an interaction event to the currently-selected step's
   evidence and stretch the step's time range to cover it. */
async function addEventToSelectedStep(ev) {
  if (!State.getSession()) return;
  const sid = State.getSelectedStepId();
  if (!sid) { toast("Select a step in the Steps view first", "error"); return; }
  const anno = State.getSession().annotations || {};
  anno.steps = anno.steps || [];
  // C19: the selected step may be a sub-step, at any level.
  const found = SPM.findStep(anno.steps, sid);
  const step = found && found.step;
  if (!step) { toast("The selected step no longer exists", "error"); return; }
  if (Array.isArray(step.sub_steps)) {
    toast('"' + (step.name || "The step") + '" is a sub-process: add the interaction to one of its steps inside it, or dissolve it first.', "error");
    return;
  }
  step.evidence = step.evidence || { interaction_event_ids: [], screenshot_refs: [] };
  step.evidence.interaction_event_ids = step.evidence.interaction_event_ids || [];
  if (step.evidence.interaction_event_ids.includes(ev.event_id)) {
    toast("That event is already in this step", "");
    return;
  }
  step.evidence.interaction_event_ids.push(ev.event_id);
  const tr = step.time_range || (step.time_range = { start: ev.timestamp, end: ev.timestamp });
  if (!tr.start || ev.timestamp < tr.start) tr.start = ev.timestamp;
  if (!tr.end || ev.timestamp > tr.end) tr.end = ev.timestamp;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await saveAnnotationsWithUndo(anno, "add event to step");
  State.getSession().annotations = anno;
  renderStepsLevel();
  toast('Added event to "' + (step.name || "step") + '"', "success");
}

$("#event-filter").addEventListener("input", () => renderEventTable());
$("#cb-show-activity").addEventListener("change", () => renderEventTable());
$("#cb-show-marker").addEventListener("change", () => renderEventTable());
$("#cb-show-system").addEventListener("change", () => renderEventTable());
if ($("#cb-show-interaction")) $("#cb-show-interaction").addEventListener("change", () => renderEventTable());

/* NAV-AUDIT §D13/§I: the Raw events drawer sits below the Flow layout (P2.10:
   it shows on Flow only, renderer.js applyLevel). Opening it shifted its OWN
   summary up by 24 px because the growable layout above (.session-layout's
   .lower-workspace, flex:1) shrank to make room instead of the page growing.
   The cure: on open, freeze the Flow layout's height so the drawer content
   grows the page (the Session view's overflow:auto scrolls) and the toggle
   stays put; release on close so tall monitors still fill.

   CI-3: the freeze is a flex BASIS (flex: 0 0 <closed height>), never a fixed
   `height`, so the layout still grows to fit new content (its automatic
   minimum size: it deliberately has no min-height:0, see styles.css). */
(function wireRawEventsLocality() {
  const drawer = document.querySelector(".event-table-host");
  if (!drawer) return;
  const layoutSel = "#session-layout-flow";
  let _frozen = null;
  let _snap = null;   // { el, h } captured BEFORE the drawer expands
  const snap = () => {
    if (drawer.open) { _snap = null; return; }
    const layout = Array.from(document.querySelectorAll(layoutSel))
      .find((el) => el.offsetParent !== null);
    _snap = layout ? { el: layout, h: Math.round(layout.getBoundingClientRect().height) } : null;
  };
  const summary = drawer.querySelector("summary");
  // Capture-phase snapshot: the `toggle` event fires after the layout above has
  // already shrunk, so read its CLOSED height on the summary click first.
  if (summary) summary.addEventListener("click", snap, true);
  drawer.addEventListener("toggle", () => {
    if (drawer.open) {
      const s = _snap;
      if (s && s.el && s.h > 0) {
        s.el.style.flex = "0 0 " + s.h + "px";
        _frozen = s.el;
      }
    } else if (_frozen) {
      _frozen.style.flex = "";
      _frozen = null;
    }
  });
})();

/* ============ Screenshots / markers ================================ */

/* renderScreenshots / the screenshot gallery / openScreenshot live in
   flow-view-screenshots.js (god-file split);
   renderScreenshots + openScreenshot are destructured at the top here. */

/* getMarkerEdit / effectiveLabel / effectiveTimestamp / isDeletedMarker,
   renderMarkersList, and the per-marker adjust / delete /
   rename actions live in flow-view-markers.js (god-file split). */

/* deps = { rerenderActiveLevel, addStepAtTimestamp }: the cross-surface
   glue kept in renderer.js. Call once at boot. */
function initFlowView(deps) {
  rerenderActiveLevel    = deps.rerenderActiveLevel    || (() => {});
  addStepAtTimestamp     = deps.addStepAtTimestamp     || (async () => {});
  // Hand the video module the session (re)loader it calls after a re-sync,
  // injected rather than require()d to avoid a flow-view <-> video cycle.
  Video.initVideo({ loadSessionIntoView });
  // Hand the timeline module the flow-view-resident glue its lanes call
  // (case-scope dimming + the two context menus), injected to keep the
  // timeline <-> flow-view graph acyclic.
  Timeline.initTimeline({
    currentScopeRange, showMarkerInsertMenu, showCaseContextMenu,
  });
  // The transcript's menu actions reload the session; its sync redraws the lane.
  Transcript.initTranscript({ loadSessionIntoView, renderTimeline });
}

module.exports = {
  initFlowView,
  loadSessionIntoView, renderTimeline, renderMarkersList,
  // The analysis: automatic runs, the deliberate ones (confirm), and the
  // pipeline runner the exports share (one status line, one log).
  renderSessionPills, analyzeSession, runPipeline, UPDATING,
  seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow,
  activateAnnoTab, addStepAtPlayhead, deriveCases,
  // The Overview's marker-problem fixes (overview-view.js).
  queueSyntheticMarker, queueMarkerDelete,
};
