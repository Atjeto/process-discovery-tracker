/*
 * flow-view.js -- the Flow level of the Session view.
 *
 * Owns session load + analyze (loadSessionIntoView / openSessionFlow /
 * the normalize buttons), the Flow timeline and every lane, the minimap,
 * range selection, the video <-> timeline sync, the event table, the
 * annotations / screenshots / markers side panel (incl. the screenshot
 * gallery and marker CRUD), case scope, and the Ctrl+K command-palette
 * provider. The module wires its own controls at require() time (the DOM
 * is already parsed when renderer.js pulls this in). Cross-surface glue
 * that stays in the entry (renderShortcutsOverlay, rerenderActiveLevel,
 * applyLevel, activateTab) is injected by renderer.js via initFlowView().
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const PdtPalette = require("../command-palette.js");
const { $, $$, escapeHtml, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { resetUndoStack, captureBaseline, saveAnnotationsWithUndo, persistAnnotations, ensureAnnoShape } = require("../session.js");
const { pushRecent } = require("../recent.js");
const { renderStepsLevel } = require("./steps-view.js");
const { renderPhasesLevel } = require("./phases-view.js");
const { renderOverviewLevel } = require("./overview-view.js");
const SessionSummary = require("../session-summary.js");
const PdtProject = require("../project.js");
const { appColor, appLabel, renderLegend } = require("./flow-view-apps.js");
const Video = require("./flow-view-video.js");
const {
  setVideoOverlay, positionPlayhead, videoStartTs, videoTimeToSessionTs,
  seekToTimestamp, jumpToStepInFlow, watchStep,
} = Video;
const { renderScreenshots, openScreenshot } = require("./flow-view-screenshots.js");
const FlowMarkers = require("./flow-view-markers.js");
const {
  effectiveLabel, visibleMarkerSuggestions, renderMarkersList, renderAnchorCandidates,
} = FlowMarkers;
const Timeline = require("./flow-view-timeline.js");
const {
  renderTimeline, renderTimelineSummary, restoreTimelineForCurrent,
  maybeAutoScrollToFirstCase, _wireTimelineScrollPersist, setLaneToggle,
} = Timeline;

/* Injected by renderer.js -- cross-surface glue kept in the thin entry.
   Lazy wrappers so hoisting / load order does not matter. */
let renderShortcutsOverlay = () => {};
let rerenderActiveLevel = () => {};
let applyLevel = () => {};
let activateTab = () => {};
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
  const markers = (session.events || []).filter(e => e.type === "marker");

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

  // Best-effort marker-label enrichment: match a case whose range
  // begins within 5s of a start-marker, adopt the marker's label.
  const stack = [];
  for (const ev of markers) {
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      stack.push({ label: ev.data.label, startMs: t });
    } else if (ev.data.marker_type === "end" && stack.length) {
      const opened = stack.pop();
      if (!opened.label) continue;
      for (const c of byCase.values()) {
        if (Math.abs(c.startMs - opened.startMs) < 5000) {
          c.label = opened.label;
        }
      }
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
  const cases = State.getSession() ? deriveCases(State.getSession()) : [];
  // P2.8: dedup duplicate labels with a [H:MM:SS] timecode suffix so
  // analysts can tell "Send email" #2 from "Send email" #5 etc.
  const labelCounts = {};
  for (const c of cases) {
    const k = c.label || c.id;
    labelCounts[k] = (labelCounts[k] || 0) + 1;
  }
  function timecode(ms) {
    if (!ms) return "";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
  }
  const opts = ['<option value="">All cases</option>']
    .concat(cases.map(c => {
      const baseLabel = c.label && c.label !== c.id ? c.label : c.id;
      const needsSuffix = labelCounts[baseLabel] > 1;
      const offsetMs = c.startMs && State.getSession().events.length
        ? c.startMs - new Date(State.getSession().events[0].timestamp).getTime()
        : 0;
      const label = needsSuffix
        ? `${baseLabel} [${timecode(offsetMs)}]`
        : baseLabel;
      return `<option value="${c.id}"${c.id === State.getCaseScope() ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }));
  // Cases are derived from analyzed steps. An unanalyzed session has
  // none -- spell that out rather than showing a lone "All cases".
  if (!cases.length) {
    opts.push('<option value="" disabled>(no cases yet — click Analyze session first)</option>');
  }
  sel.innerHTML = opts.join("");
  // Wrapper picks up the visual cue that scoping is active.
  const wrap = sel.closest(".case-scope");
  if (wrap) wrap.classList.toggle("scoped", !!State.getCaseScope());
}

/* P2.8: scope-to-marker-at-playhead. Finds the innermost case whose
   range contains the current video time and selects it as the scope.
   Falls back to a toast if there's no video / no marker at playhead. */
function scopeToMarkerAtPlayhead() {
  if (!State.getSession()) return;
  const video = document.getElementById("video");
  const startTs = videoStartTs();
  if (!video || !startTs) {
    toast("No video to anchor to playhead.", "error");
    return;
  }
  const playheadMs = new Date(startTs).getTime() + video.currentTime * 1000;
  const cases = deriveCases(State.getSession());
  // Innermost case: smallest range containing playheadMs.
  let best = null;
  let bestSize = Infinity;
  for (const c of cases) {
    if (playheadMs < c.startMs || playheadMs > c.endMs) continue;
    const size = c.endMs - c.startMs;
    if (size < bestSize) { best = c; bestSize = size; }
  }
  if (!best) { toast("No case at the current playhead.", ""); return; }
  State.setCaseScope(best.id);
  populateCaseScope();
  rerenderActiveLevel();
  toast("Scoped to: " + (best.label || best.id), "success");
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
  const btn = document.getElementById("btn-scope-to-playhead");
  if (btn) btn.addEventListener("click", scopeToMarkerAtPlayhead);
})();

/* Command palette provider: union of cases / steps / markers /
   commands, scored by case-insensitive substring match. Capped per
   bucket so a single huge session doesn't drown out the commands. */
function commandPaletteProvider(rawQuery) {
  const q = (rawQuery || "").toLowerCase().trim();
  const out = [];

  function pushIfMatch(label, hint, type, run, score) {
    if (q && !label.toLowerCase().includes(q) && !(hint || "").toLowerCase().includes(q)) return;
    out.push({ label, hint, type, run, _score: score });
  }

  // 1) Cases -- prominent navigation primitive
  if (State.getSession()) {
    const cases = deriveCases(State.getSession());
    for (const c of cases) {
      const dur = c.endMs - c.startMs;
      const durStr = dur < 60000 ? `${Math.round(dur / 1000)}s`
                    : dur < 3600000 ? `${Math.round(dur / 60000)}m`
                    : `${(dur / 3600000).toFixed(1)}h`;
      pushIfMatch(c.label, durStr, "case", () => {
        State.setCaseScope(c.id);
        populateCaseScope();
        rerenderActiveLevel();
      }, 5);
    }
  }

  // 2) Steps -- the long-tail surface that needs find-by-name most
  if (State.getSession()) {
    const allSteps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
    let n = 0;
    for (const s of allSteps) {
      if (n >= 80) break;
      const time = s.time_range && s.time_range.start ? s.time_range.start.slice(11, 19) : "";
      if (q && !(s.name || "").toLowerCase().includes(q)) continue;
      out.push({
        type: "step",
        label: s.name || s.step_id,
        hint: `${s.state || ""}${time ? " · " + time : ""}`,
        run: () => {
          State.setSelectedStepId(s.step_id);
          applyLevel("steps");
          // Activate the steps view-mode button so the UI catches up
          const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
          if (btn && !btn.classList.contains("active")) btn.click();
        },
        _score: 3,
      });
      n++;
    }
  }

  // 3) Markers -- case boundaries by label
  if (State.getSession()) {
    const markers = (State.getSession().events || []).filter(e => e.type === "marker" && e.data.marker_type === "start");
    let n = 0;
    for (const m of markers) {
      if (n >= 40) break;
      const lbl = (m.data && m.data.label) || "(unlabeled)";
      if (q && !lbl.toLowerCase().includes(q)) continue;
      const time = m.timestamp ? m.timestamp.slice(11, 19) : "";
      out.push({
        type: "marker",
        label: lbl,
        hint: time,
        run: () => {
          const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
          if (flowBtn) flowBtn.click();
          seekToTimestamp(m.timestamp);
        },
        _score: 2,
      });
      n++;
    }
  }

  // 4) Top-level commands -- always available
  const commands = [
    { label: "Analyze session", hint: "Re-run normalize", run: () => $("#btn-normalize") && $("#btn-normalize").click() },
    { label: "Match Process Template…", hint: "", run: () => $("#btn-match-template") && $("#btn-match-template").click() },
    { label: "Open another session…", hint: "", run: () => $("#btn-open-session") && $("#btn-open-session").click() },
    { label: "Switch to Aggregate", hint: "Tab 2", run: () => activateTab("aggregate") },
    { label: "Switch to Session", hint: "Tab 1", run: () => activateTab("session") },
    // R1 (APPROACHABILITY-REDESIGN-2026-07-03 §5): Process Template moved out
    // of the resident tab row (it's "More ▾" now) and its "3" hotkey retired
    // -- Vocabularies is Tab 3. The palette still finds Template by name/search.
    { label: "Switch to Process Template", hint: "", run: () => activateTab("canonical") },
    { label: "Switch to Vocabularies", hint: "Tab 3", run: () => activateTab("vocabularies") },
    { label: "Clear case scope", hint: "Show all cases", run: () => {
        State.setCaseScope("");
        populateCaseScope();
        rerenderActiveLevel();
      } },
    { label: "Open help", hint: "?", run: () => $("#btn-help") && $("#btn-help").click() },
  ];
  for (const cmd of commands) {
    pushIfMatch(cmd.label, cmd.hint, "command", cmd.run, 1);
  }

  // Sort by score (cases first, then steps/markers, commands last on ties)
  out.sort((a, b) => (b._score || 0) - (a._score || 0));
  return out.slice(0, 50);
}

if (PdtPalette) {
  PdtPalette.registerProvider("flow", commandPaletteProvider);
}

function uniqueCaseIds(steps) {
  const seen = new Map();
  for (const s of (steps || [])) {
    if (s.case_id && !seen.has(s.case_id)) seen.set(s.case_id, s.case_id);
  }
  return Array.from(seen.values());
}

function syncCaseDropdown(selectEl, cases, currentValue) {
  if (!selectEl) return;
  const want = ['<option value="">All cases</option>']
    .concat(cases.map(c => `<option value="${c}"${c === currentValue ? " selected" : ""}>${c}</option>`))
    .join("");
  if (selectEl.innerHTML !== want) selectEl.innerHTML = want;
}

/* The markers side-panel + its filter box, marker-edit resolution,
   suggested markers (ADR-0017), and anchor candidates (ADR-0018) live in
   flow-view-markers.js (god-file split). effectiveLabel /
   visibleMarkerSuggestions (the timeline marker overlay) and
   renderMarkersList / renderAnchorCandidates are destructured at the top
   here; the marker-INSERT surfaces stay below. */

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await Ipc.openSessionFolder();
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);
const _btnClassify = document.getElementById("btn-classify-activities");
if (_btnClassify) _btnClassify.addEventListener("click", () => showClassifyManager());

/* Wire normalize button so the analysis-in-progress UI is visible:
   log host expands (already open by default in the HTML), Cancel
   button shows while running. Cancellation flows through
   viewer:cancelNormalize which kills the python child. */
function setAnalysisRunning(running) {
  $("#btn-normalize").disabled = running;
  const cancelBtn = $("#btn-cancel-normalize");
  if (cancelBtn) cancelBtn.style.display = running ? "" : "none";
  const logHost = $("#log-host");
  if (logHost) {
    if (running) {
      logHost.style.display = "";
      logHost.open = true;
    }
  }
}

const btnCancelNormalize = $("#btn-cancel-normalize");
if (btnCancelNormalize) {
  btnCancelNormalize.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await Ipc.cancelNormalize();
    toast("Cancelling analysis...");
  });
}

$("#btn-normalize").addEventListener("click", async () => {
  if (!State.getSession()) return;
  /* H7: a re-analysis regenerates auto-detected steps and clears the
     undo stack. Warn before that happens -- but only when the session
     already has steps, so a first-ever Analyze runs straight through. */
  const _steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  if (_steps.length) {
    const _auto = _steps.filter((s) =>
      s.state === "auto_suggested" || s.state === "auto_matched").length;
    const _kept = _steps.length - _auto;
    const ok = await confirmModal({
      title: "Re-analyze this session?",
      message: `Re-analyzing regenerates the ${_auto} auto-detected step(s) and clears the undo history.`,
      detail: _kept
        ? `Your ${_kept} confirmed step(s) are kept.`
        : "There are no confirmed steps to keep.",
      okLabel: "Re-analyze",
    });
    if (!ok) return;
  }
  const mine = $("#cb-mine").checked;
  setAnalysisRunning(true);
  $("#normalize-log").textContent = "";
  // If a Process Template was previously matched, re-use its path automatically.
  const remembered = (State.getSession().annotations &&
    State.getSession().annotations.matched_against &&
    State.getSession().annotations.matched_against.template_path) || null;
  const r = await Ipc.runNormalizeExtended({
    sessionFolder: State.getSession().sessionFolder,
    mine,
    canonical: remembered,
  });
  setAnalysisRunning(false);
  if (r.cancelled) {
    $("#normalize-log").textContent += "\n[cancelled by user]";
    toast("Analysis cancelled");
    return;
  }
  if (!r.ok) {
    $("#normalize-log").textContent += "\nERROR: " + r.error;
    toast("Analysis failed: " + r.error, "error");
    return;
  }
  toast(remembered ? "Re-analyzed with template" : "Analysis complete", "success");
  await loadSessionIntoView(State.getSession().sessionFolder);
});

const btnMatchTemplate = $("#btn-match-template");
if (btnMatchTemplate) {
  btnMatchTemplate.addEventListener("click", async () => {
    if (!State.getSession()) return;
    const r = await Ipc.openCanonicalFile();
    if (!r) return;
    btnMatchTemplate.disabled = true;
    $("#btn-normalize").disabled = true;
    $("#log-host").style.display = "";
    $("#normalize-log").textContent = "";
    const mine = $("#cb-mine").checked;
    const result = await Ipc.runNormalizeExtended({
      sessionFolder: State.getSession().sessionFolder,
      mine,
      canonical: r.path,
    });
    btnMatchTemplate.disabled = false;
    $("#btn-normalize").disabled = false;
    if (!result || !result.ok) {
      toast("Template match failed: " + ((result && result.error) || "unknown"), "error");
      return;
    }
    // Reload FIRST: the normalize just rewrote annotations.json (matched
    // steps, suggestions, drift). Saving the pre-normalize in-memory copy
    // here used to clobber that file — on a raw session it wiped the
    // freshly auto_matched steps entirely (caught by flywheel-smoke §D4).
    await loadSessionIntoView(State.getSession().sessionFolder);
    // Persist template path into the FRESH annotations so future
    // re-analyses remember it (the pipeline writes only id + version).
    try {
      const a = State.getSession().annotations || {};
      a.matched_against = a.matched_against || {};
      a.matched_against.template_path = r.path;
      await Ipc.saveAnnotations({
        sessionFolder: State.getSession().sessionFolder,
        annotations: a,
      });
      State.getSession().annotations = a;
    } catch (_) {}
    toast("Matched against Process Template", "success");
  });
}

Ipc.onNormalizeLog((text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

async function loadSessionIntoView(folder) {
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
  // Capture the loaded annotations as the undo baseline on EVERY load (including
  // a same-folder re-analyze), so the first edit records the true pre-edit state.
  captureBaseline();
  $("#session-empty").style.display = "none";
  $("#session-loaded").style.display = "";
  $("#btn-normalize").disabled = false;
  /* B1: a worker-given manifest label (set in the capture post-session
     summary) names the Recents entry; else fall back to engagement. */
  const _m = State.getSession().manifest || {};
  const recentLabel = _m.label
    ? _m.label
    : (_m.engagement_id || path.basename(folder)) + " · " + path.basename(folder);
  pushRecent(folder, recentLabel);

  renderSessionPills();
  renderSessionSummary();
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
  // The #video timeupdate/loadedmetadata listeners are wired ONCE at module
  // init (see wireVideoListeners below) -- adding them here ran on every
  // session load and leaked a fresh loadedmetadata arrow each time.
  setVideoOverlay(State.getSession().recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderScreenshots();
  renderMarkersList();
  renderAnchorCandidates();
  renderTimelineSummary();
  // Phase B+ surfaces
  State.setSelectedStepId(null);
  State.setSelectedPhaseId(null);
  State.setMultiSelectedStepIds(new Set());
  if ($("#btn-group-into-phase")) $("#btn-group-into-phase").disabled = true;
  renderStepsLevel();
  renderPhasesLevel();
  // The Overview level (lab-phase §A5) is the default on load; it reads the
  // freshly-loaded analysis.json blocks and (R4) renders the Evidence modules
  // that the retired Analysis level used to own, so refreshing it here covers
  // both the memo surface and the analytical trio.
  renderOverviewLevel();
  // The map's "N nodes / Open / Reveal" status line is now driven by the map
  // controller's onRender (renderer._syncMapStatus), so it always reflects the
  // file actually displayed at the current grain -- no stale process_map.bpmn
  // count set here on load.
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
  // P2.4: shortcuts overlay updates with session state.
  renderShortcutsOverlay();
  // Phase F: apply project-level knowledge to the freshly-loaded session.
  applyProjectDenylist();
  maybeApplyStepTemplate();
}

/* ===== Phase F: project knowledge applied on session load ===== */

function _eventSpan(events) {
  const evs = Array.isArray(events) ? events : [];
  if (!evs.length) return null;
  const a = Date.parse(evs[0].timestamp);
  const b = Date.parse(evs[evs.length - 1].timestamp);
  if (!isFinite(a) || !isFinite(b) || b <= a) return null;
  return { startMs: a, endMs: b };
}

/* F3: a project can carry a team-wide step-suggestion denylist. Apply
   it to a freshly-loaded session that has none of its own -- never
   override a denylist the analyst already set on the session. */
function applyProjectDenylist() {
  const proj = PdtProject.activeProject();
  const session = State.getSession();
  if (!proj || !session) return;
  const defaults = proj.default_ignored_processes || [];
  if (!defaults.length) return;
  const anno = session.annotations || {};
  const sf = anno.step_filters || {};
  if ((sf.ignored_processes || []).length) return;  // session has its own
  anno.step_filters = Object.assign({}, sf, { ignored_processes: defaults.slice() });
  session.annotations = anno;
  Ipc.saveAnnotations({ sessionFolder: session.sessionFolder, annotations: anno });
  toast("Applied the project's team denylist (" + defaults.length + " app(s))");
}

/* F5: a project can name a "step template" session. When a session
   with no steps is opened under such a project, offer to seed it with
   the template's step structure, each step positioned at the same
   fraction of the session's elapsed time. The analyst then adjusts. */
async function maybeApplyStepTemplate() {
  const proj = PdtProject.activeProject();
  const session = State.getSession();
  if (!proj || !session || !proj.step_template_session) return;
  if (((session.annotations || {}).steps || []).length) return;
  let template;
  try { template = await Ipc.loadSession(proj.step_template_session); }
  catch (_) { return; }
  const tSteps = ((template && template.annotations) || {}).steps || [];
  const tSpan = _eventSpan(template && template.events);
  const nSpan = _eventSpan(session.events);
  if (!tSteps.length || !tSpan || !nSpan) return;
  const ok = await confirmModal({
    title: "Apply step structure?",
    message: "Seed this session with the step structure from the project's template?",
    detail: tSteps.length + " step(s) from " + path.basename(proj.step_template_session) +
      ". You can adjust, split, or merge them afterwards.",
    okLabel: "Apply", cancelLabel: "Skip",
  });
  if (!ok || State.getSession() !== session) return;  // session may have changed
  const nDur = nSpan.endMs - nSpan.startMs;
  const tDur = (tSpan.endMs - tSpan.startMs) || 1;
  const frac = (iso) => {
    const t = Date.parse(iso);
    if (!isFinite(t)) return 0;
    return Math.max(0, Math.min(1, (t - tSpan.startMs) / tDur));
  };
  const sid = (session.manifest || {}).session_id || "";
  const anno = session.annotations || {};
  anno.steps = tSteps.map((ts, i) => {
    const tr = ts.time_range || {};
    const startMs = nSpan.startMs + frac(tr.start) * nDur;
    const endMs = nSpan.startMs + frac(tr.end) * nDur;
    return {
      step_id: cryptoRandomId(),
      session_id: sid,
      case_id: null,
      name: ts.name || ("Step " + (i + 1)),
      description: ts.description || "",
      time_range: {
        start: new Date(startMs).toISOString(),
        end: new Date(Math.max(startMs, endMs)).toISOString(),
      },
      evidence: { interaction_event_ids: [], screenshot_refs: [],
        video_timecode_range: [0, 0], manual_notes: "" },
      state: "manually_authored",
      canonical_step_id: null,
      flags: { conditional: false, condition_text: null,
        exception_path: false, waste: false, automation_candidate: false },
      phase_id: null,
    };
  });
  session.annotations = anno;
  await saveAnnotationsWithUndo(anno, "apply step template");
  renderStepsLevel();
  toast("Applied " + anno.steps.length + " template step(s)", "success");
}

/* The "N nodes / Open / Reveal" status line + per-case picker used to live here
   (updateProcessMapStatus, pinned to the activity-level process_map.bpmn). It is
   now driven by the map controller's onRender (renderer._syncMapStatus), which
   reports the file ACTUALLY rendered at the current grain, so the count can
   never drift from the displayed map and the line hides on the live Flow
   diagram. The Open / Reveal handlers below read the dataset.bpmnPath that
   _syncMapStatus sets. */

/* Wire the video element's listeners ONCE. loadSessionIntoView runs on every
   session load; adding these there re-bound a new loadedmetadata arrow each
   time (timeupdate dedups by reference, loadedmetadata did not) -> a listener
   leak across sessions. #video is a stable element in index.html. */
(function wireVideoListeners() {
  const video = document.getElementById("video");
  if (!video) return;
  video.addEventListener("timeupdate", positionPlayhead);
  video.addEventListener("loadedmetadata", () =>
    setVideoOverlay(`${formatDuration(video.duration * 1000)} loaded`));
})();

(function wireProcessMapButtons() {
  const open = document.getElementById("btn-open-bpmn");
  const reveal = document.getElementById("btn-reveal-bpmn");
  function currentBpmnPath() {
    const wrap = document.getElementById("process-map-status");
    return wrap && wrap.dataset.bpmnPath;
  }
  if (open) open.addEventListener("click", async () => {
    const p = currentBpmnPath();
    if (!p) return;
    // Use the dedicated diagram sink (not the screenshot image sink, which
    // always refused .bpmn and returned an object that rendered as
    // "[object Object]"). openDiagram resolves to a string error or null.
    const err = await Ipc.openDiagram(p);
    if (err) toast("Could not open: " + err, "error");
  });
  if (reveal) reveal.addEventListener("click", () => {
    const p = currentBpmnPath();
    if (p) Ipc.revealFile(p);
  });
})();

/* Item 9: the session chip row (events / status / video / analyzed / vocabs)
   is STATIC session metadata, not something that changes while the analyst
   works — so it no longer rides the toolbar as a resident row. renderSessionPills
   computes it and stashes it here; renderSessionSummary folds it into the
   collapsed SESSION SUMMARY band (a one-line summary when collapsed, the chip
   row when expanded). The one genuinely dynamic chip — pending marker edits —
   is surfaced separately so it stays visible. */
let _sessionPills = [];

function _sessionPillsHtml(pills) {
  return pills.map((p) =>
    '<div class="pill' + (p.cls ? " " + p.cls : "") + '"' +
    (p.title ? ' title="' + escapeHtml(p.title) + '"' : "") + '><span class="dot"></span>' +
    '<span class="lbl">' + escapeHtml(p.label) + '</span>' + escapeHtml(String(p.val)) + '</div>'
  ).join("");
}

function renderSessionPills() {
  const m = State.getSession().manifest || {};
  const pills = [];
  pills.push({ label: "events", val: State.getSession().events.length, cls: "ok" });
  pills.push({ label: "status", val: m.status || "?",
    cls: m.status === "recovered" ? "warn" : (m.status === "closed" ? "ok" : "") });
  if (m.obs && m.obs.recording_path) pills.push({ label: "video", val: "OBS linked", cls: "ok" });
  else pills.push({ label: "video", val: "no recording" });
  if (State.getSession().stats) {
    pills.push({ label: "analyzed", val: "✓", cls: "ok" });
    const meta = State.getSession().stats.meta || {};
    if (meta.taxonomy_version) {
      pills.push({ label: "taxonomy", val: meta.taxonomy_version });
    }
    if (meta.canonical_process_id) {
      pills.push({ label: "template", val: meta.canonical_process_id, cls: "ok" });
    }
    const vocabs = meta.app_vocabularies || [];
    if (vocabs.length) {
      const hits = meta.app_vocabulary_matches || 0;
      // Clutter pass: show count + hits, not the full app-name list (which ran
      // very wide on the facts row). The full list lives in the title tooltip.
      pills.push({
        label: vocabs.length === 1 ? "vocab" : "vocabs",
        val: `${vocabs.length} · ${hits} hits`,
        title: "App Library vocabularies applied: " + vocabs.map(v => v.id).join(", "),
        cls: hits > 0 ? "ok" : "",
      });
    }
  } else {
    pills.push({ label: "analyzed", val: "no", cls: "warn" });
  }
  const editCount = ((State.getSession().annotations || {}).marker_edits || []).length;
  if (editCount > 0) pills.push({ label: "edits", val: editCount, cls: "warn" });
  // Stash for the summary band (item 9). The toolbar chip row is retired:
  // the static metadata lives in SESSION SUMMARY now. Only the dynamic
  // "pending edits" chip stays on the toolbar so an in-progress edit is
  // never hidden behind a collapsed band.
  _sessionPills = pills;
  const dynamic = pills.filter((p) => p.label === "edits");
  const toolbar = $("#session-pills");
  if (toolbar) toolbar.innerHTML = _sessionPillsHtml(dynamic);

  // Show onboarding card until the session is analyzed.
  const onboarding = $("#onboarding-card");
  if (onboarding) {
    onboarding.style.display = State.getSession().stats ? "none" : "";
  }

  /* Prep-session CTA: when the manifest tags this as an app-vocab prep
     capture, replace the generic onboarding with a one-button path to
     bootstrap the vocabulary. The button below the toolbar is dedicated
     to this so the analyst doesn't have to hunt for it. */
  const prepCta = $("#prep-session-cta");
  const isPrep = m.purpose === "app_prep" && m.prep_app;
  if (prepCta) {
    if (isPrep) {
      prepCta.style.display = "";
      const appName = m.prep_app
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      $("#prep-app-name").textContent = appName;
      $("#prep-app-id").textContent = m.prep_app;
      if (onboarding) onboarding.style.display = "none"; // CTA replaces generic onboarding
    } else {
      prepCta.style.display = "none";
    }
  }

  // Update the Match button label to reflect a remembered template.
  const btnMatch = $("#btn-match-template");
  if (btnMatch) {
    const tmpl = (State.getSession().annotations &&
      State.getSession().annotations.matched_against &&
      State.getSession().annotations.matched_against.template_path);
    if (tmpl) {
      btnMatch.textContent = "Change Process Template...";
      btnMatch.title = "Currently matched against: " + tmpl;
    } else {
      btnMatch.textContent = "Match Process Template...";
      btnMatch.title = "Pick a Process Template YAML and match this session against it.";
    }
  }
}

/* Phase A: the post-analysis orientation panel. Sits above the
   view-mode bar and answers "what happened here" before the analyst
   scrolls the timeline. Hidden until the session has a stats.json
   (the onboarding card covers the unanalyzed state). All derivations
   are pure functions in session-summary.js; this only renders. */
function renderSessionSummary() {
  const panel = $("#session-summary");
  if (!panel) return;
  const session = State.getSession();
  const s = SessionSummary.computeSummary(session);
  if (!s) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.style.display = "";

  const pct = (f) => Math.round(f * 100) + "%";
  const analyzed = s.analyzedAt ? new Date(s.analyzedAt).toLocaleString() : "—";

  const tiles = [
    { label: "Cases", value: s.caseCount, sub: "" },
    { label: "Events", value: s.eventCount,
      sub: `${s.activityCount} activities · ${s.interactionCount} interactions` },
    { label: "Steps", value: s.stepCount,
      sub: `${s.autoSteps} to review · ${s.confirmedSteps} confirmed` },
  ];
  // Honesty gate (lab-phase §A5, same condition as the Analysis view's
  // efficiency block): while bnva_ms is the heuristic 0 everywhere, the
  // ratio is an artifact of that default (typically a fact-shaped "100%"),
  // so the summary tile is withheld until an analyst has judged
  // business-required time on at least one step type.
  const _hasBnva = ((State.getSession().annotations || {}).analysis_overrides || [])
    .some((ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  if (s.efficiencyRatio != null && _hasBnva) {
    tiles.push({ label: "Efficiency", value: pct(s.efficiencyRatio),
      sub: "value-add share (default estimate)" });
  }
  if (s.hasTemplate || s.matchedInteractions > 0) {
    tiles.push({ label: "Template match", value: pct(s.matchRate || 0),
      sub: `${s.matchedInteractions} interactions` });
  }
  if (s.vocabCoverage) {
    tiles.push({ label: "Vocab coverage", value: s.vocabCoverage.overallPct + "%",
      sub: s.vocabCoverage.apps
        .map((a) => appLabel(a.app) + " " + Math.round(a.pct) + "%").join(" · ") });
  }
  const tilesHtml = tiles.map((t) =>
    '<div class="summary-tile">' +
      `<span class="t-label">${escapeHtml(t.label)}</span>` +
      `<span class="t-value">${escapeHtml(String(t.value))}</span>` +
      (t.sub ? `<span class="t-sub">${escapeHtml(t.sub)}</span>` : "") +
    "</div>"
  ).join("");

  let activityHtml = "";
  if (s.topActivities.length) {
    const bars = s.topActivities.map((a) =>
      '<div class="summary-bar-row">' +
        `<span class="b-name" title="${escapeHtml(a.label)}">${escapeHtml(a.label)}</span>` +
        '<span class="summary-bar-track">' +
          `<span class="summary-bar-fill" style="width:${(a.pct * 100).toFixed(1)}%"></span>` +
        "</span>" +
        `<span class="b-value">${pct(a.pct)} · ${escapeHtml(formatDuration(a.ms))}</span>` +
      "</div>"
    ).join("");
    const stretch = s.longestStretch.app
      ? `${appLabel(s.longestStretch.app)} ${formatDuration(s.longestStretch.ms)}`
      : "—";
    const metaLine =
      `${s.appSwitches} app switch${s.appSwitches === 1 ? "" : "es"} · ` +
      `longest single-app stretch: ${stretch}`;
    activityHtml =
      '<div class="summary-section">' +
        '<div class="summary-section-title">Where the time went</div>' +
        `<div class="summary-bars">${bars}</div>` +
        `<div class="summary-meta-line">${escapeHtml(metaLine)}</div>` +
      "</div>";
  }

  let casesHtml = "";
  if (s.topCases.length) {
    const line = s.topCases
      .map((c) => `${escapeHtml(c.label)} (${escapeHtml(formatDuration(c.ms))})`)
      .join(" · ");
    casesHtml =
      '<div class="summary-section">' +
        '<div class="summary-section-title">Longest cases</div>' +
        `<div class="summary-meta-line">${line}</div>` +
      "</div>";
  }

  const problems = SessionSummary.detectMarkerProblems((session && session.events) || []);
  let problemsHtml = "";
  if (problems.length) {
    const rows = problems.map((p) => {
      const time = (p.timestamp || "").slice(11, 19);
      let text = "";
      let fix = "";
      if (p.kind === "dangling_start") {
        text = `Start ${p.label ? '"' + escapeHtml(p.label) + '"' : "(unlabeled)"} ` +
               `at ${time} has no matching End.`;
        fix = '<button class="summary-fix" data-fix="close-start">Close at session end</button>';
      } else if (p.kind === "orphan_end") {
        text = `End marker at ${time} has no open Start to close.`;
        if (p.eventId) {
          fix = '<button class="summary-fix" data-fix="delete-end" ' +
                `data-event-id="${escapeHtml(p.eventId)}">Remove this marker</button>`;
        }
      } else if (p.kind === "short_case") {
        const secs = Math.round((p.durationMs || 0) / 1000);
        text = `Case ${p.label ? '"' + escapeHtml(p.label) + '"' : "(unlabeled)"} ` +
               `at ${time} is only ${secs}s long — accidental?`;
      }
      return `<div class="summary-problem"><span class="p-text">⚠ ${text}</span>${fix}</div>`;
    }).join("");
    problemsHtml =
      '<div class="summary-section">' +
        `<div class="summary-section-title">Marker problems (${problems.length})</div>` +
        `<div class="summary-problems">${rows}</div>` +
      "</div>";
  }

  let bannerHtml = "";
  if (s.stepCount > 0 && s.confirmedSteps === 0 && s.autoSteps > 0) {
    bannerHtml =
      '<div class="summary-banner">Review the ' +
      '<span class="summary-link" data-go="steps">Steps</span> tab — ' +
      `${s.autoSteps} step${s.autoSteps === 1 ? " was" : "s were"} ` +
      "auto-detected and may need editing.</div>";
  } else if (s.stepCount > 0 && s.phaseCount === 0) {
    bannerHtml =
      '<div class="summary-banner">Group your reviewed steps into ' +
      '<span class="summary-link" data-go="phases">Phases</span> to organize the process.</div>';
  }

  let driftHtml = "";
  if (s.canonicalDrift && s.canonicalDrift.warning) {
    const cur = Math.round((s.canonicalDrift.current_rate || 0) * 100);
    const prev = Math.round((s.canonicalDrift.previous_rate || 0) * 100);
    driftHtml =
      '<div class="summary-banner warn">⚠ Canonical match rate dropped from ' +
      `${prev}% to ${cur}% since the last analysis — the target application ` +
      "may have changed its fields.</div>";
  }

  /* B5: flag files that did not survive the copy from the capture box. */
  let integrityHtml = "";
  const _integ = State.getSession() && State.getSession().integrity;
  if (_integ && _integ.missing && _integ.missing.length) {
    const n = _integ.missing.length;
    const names = _integ.missing.slice(0, 6).map(escapeHtml).join(", ");
    integrityHtml =
      '<div class="summary-banner warn">⚠ ' +
      `${n} file${n === 1 ? "" : "s"} recorded in this session ${n === 1 ? "is" : "are"} ` +
      `missing — the session may have been copied incompletely: ${names}` +
      `${n > 6 ? ", …" : ""}.</div>`;
  }

  // C1a: warn when most activity is unclassified -- the application-level
  // process map and the app lane stay near-empty until the taxonomy has rules
  // for these apps. The Step/Phase maps work without taxonomy.
  let taxonomyHtml = "";
  {
    const acts = (State.getSession() && State.getSession().stats
      && State.getSession().stats.activity_stats) || [];
    let tot = 0, uncl = 0;
    for (const a of acts) {
      const f = a.frequency || 0; tot += f;
      if (/^Unclassified/i.test(a.activity_label || "")) uncl += f;
    }
    if (tot > 0 && uncl / tot > 0.5) {
      const pct = Math.round((uncl / tot) * 100);
      taxonomyHtml =
        '<div class="summary-banner warn">⚠ ' + pct + '% of activity is unclassified, ' +
        'so the application-level process map is mostly empty. Use “Classify activities…” ' +
        'in the top bar to label your apps (or right-click an activity band below). ' +
        'The Step and Phase process maps work without taxonomy.</div>';
    }
  }

  const hint = (s.caseCount > 0 && s.stepCount > 0)
    ? '<div class="summary-hint">Cases are time ranges marked during recording. ' +
      "Steps are logical actions identified during analysis — the two are independent.</div>"
    : "";

  // D4: lead with the project name the operator typed at setup; keep the
  // engagement id alongside it for reference when a name is present.
  const engLabel = s.engagementName || s.engagement;
  // Item 9: the static session-metadata chips fold into this band. The teaser
  // carries a compact text summary of them so a collapsed band still states
  // the metadata; the full chip row shows inside the expanded body.
  const pillsHtml = _sessionPills.length
    ? `<div class="summary-section"><div class="summary-section-title">Session</div>` +
      `<div class="session-pills summary-pills">${_sessionPillsHtml(_sessionPills)}</div></div>`
    : "";
  const pillTeaser = _sessionPills
    .map((p) => `${p.label} ${p.val}`).join(" · ");
  const teaser = `${engLabel} · ${formatDuration(s.durationMs)} · ` +
    `${s.caseCount} case${s.caseCount === 1 ? "" : "s"}` +
    (pillTeaser ? ` · ${pillTeaser}` : "");

  panel.innerHTML =
    '<summary><span class="summary-label">Session summary</span>' +
      `<span class="summary-teaser">${escapeHtml(teaser)}</span></summary>` +
    '<div class="summary-body">' +
      '<div class="summary-head">Engagement ' +
        `<strong>${escapeHtml(engLabel)}</strong>` +
        (s.engagementName ? ` <span class="meta">(${escapeHtml(s.engagement)})</span>` : "") +
        ` · worker ` +
        `<strong>${escapeHtml(s.worker)}</strong> · ` +
        `<strong>${escapeHtml(formatDuration(s.durationMs))}</strong> · ` +
        `analyzed ${escapeHtml(analyzed)}</div>` +
      pillsHtml +
      `<div class="summary-tiles">${tilesHtml}</div>` +
      activityHtml + casesHtml + driftHtml + integrityHtml + taxonomyHtml + problemsHtml + hint + bannerHtml +
    '</div>';

  // Collapsible: remember the analyst's open/closed choice across sessions.
  try { panel.open = localStorage.getItem("pdt.summaryOpen") !== "0"; }
  catch (_) { panel.open = true; }
  if (!panel._pdtToggleWired) {
    panel._pdtToggleWired = true;
    panel.addEventListener("toggle", () => {
      try { localStorage.setItem("pdt.summaryOpen", panel.open ? "1" : "0"); }
      catch (_) {}
    });
  }

  panel.querySelectorAll(".summary-fix").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (btn.dataset.fix === "close-start") {
        const evs = (State.getSession() && State.getSession().events) || [];
        if (evs.length) await queueSyntheticMarker(evs[evs.length - 1].timestamp, "end");
      } else if (btn.dataset.fix === "delete-end") {
        await queueMarkerDelete(btn.dataset.eventId);
      }
      btn.textContent = "Queued — re-analyze to apply";
    });
  });
  panel.querySelectorAll(".summary-link[data-go]").forEach((link) => {
    link.addEventListener("click", () => {
      const b = document.querySelector(`.view-mode-btn[data-level="${link.dataset.go}"]`);
      if (b) b.click();
    });
  });
}

/* Queue a marker deletion into annotations.json.marker_edits. Mirrors
   queueSyntheticMarker; the edit applies on the next normalization. */
async function queueMarkerDelete(eventId) {
  if (!State.getSession() || !eventId) return;
  const a = State.getSession().annotations || {};
  if (!Array.isArray(a.marker_edits)) a.marker_edits = [];
  a.marker_edits.push({
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    event_id: eventId,
    op: "delete",
    ts: new Date().toISOString(),
  });
  try {
    await saveAnnotationsWithUndo(a, "delete marker");
    toast("Marker removal queued — re-run normalization to apply", "success");
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
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
  if (!tsISO) { toast("No video timing — can't place a step at the playhead", "error"); return; }
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
    if (!State.getSession() || !State.getSession().events.length) return null;
    const first = new Date(State.getSession().events[0].timestamp).getTime();
    const last  = new Date(State.getSession().events[State.getSession().events.length - 1].timestamp).getTime();
    return { first, last, span: Math.max(1, last - first) };
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
  for (const ev of inRange) {
    if (ev.type === "activity") {
      const app = ev.data.app || "unknown";
      appCounts[app] = (appCounts[app] || 0) + 1;
    } else if (ev.type === "marker") markerCount++;
    else if (ev.type === "system" &&
             (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      screenshotCount++;
    }
  }
  const topApps = Object.entries(appCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([app, n]) => appLabel(app) + " (" + n + ")")
    .join(", ");
  const dur = State.getSelectionRange().endMs - State.getSelectionRange().startMs;
  card.innerHTML =
    '<h4>Selection</h4>' +
    '<div class="row"><span>Duration</span><span>' + escapeHtml(formatDuration(dur)) + '</span></div>' +
    '<div class="row"><span>Events</span><span>' + inRange.length + '</span></div>' +
    '<div class="row"><span>Markers</span><span>' + markerCount + '</span></div>' +
    '<div class="row"><span>Screenshots</span><span>' + screenshotCount + '</span></div>' +
    (topApps ? '<div class="row"><span>Top apps</span><span>' + escapeHtml(topApps) + '</span></div>' : '') +
    '<button class="summary-fix" id="tl-selection-case">Insert case from selection</button>' +
    '<button class="summary-fix" id="tl-selection-exclude" title="Skip the events in this range during step suggestion and statistics on the next analysis.">Exclude from analysis</button>' +
    '<span class="clear-link" id="tl-selection-clear">× Clear selection</span>';
  document.getElementById("tl-selection-clear").addEventListener("click", clearSelectionRange);
  document.getElementById("tl-selection-case").addEventListener("click", queueCaseFromSelection);
  document.getElementById("tl-selection-exclude").addEventListener("click", queueExcludeRange);
}

/* The screenshot surfaces (hover thumb, grid, gallery, openScreenshot)
   live in flow-view-screenshots.js (god-file split). */

/* renderMinimap / syncMinimapViewport / the minimap + middle-drag-pan
   wiring and renderTimelineSummary live in flow-view-timeline.js. */

/* C1a: classify the app under an activity band in place. Writes a
   rule-scoped classification override (every window of this app -> the
   chosen label) and re-analyzes, so the activity map + lane pick it up.
   Same override mechanism the aggregate map's Reclassify uses. */
async function classifyApp(app) {
  if (!app || !State.getSession()) return;
  const label = await promptModal({
    title: "Classify this app",
    message: 'Give every "' + app + '" window an activity label. Adds a taxonomy ' +
      "rule for this session and re-analyzes.",
    placeholder: "e.g. TAMBA — Ticket system",
    okLabel: "Classify & re-analyze",
  });
  const clean = (label || "").trim();
  if (!clean) return;
  const override = {
    override_id: cryptoRandomId(),
    scope: "rule",
    match: { app, title_regex: ".*" },
    label: clean,
    created_at: new Date().toISOString(),
  };
  try {
    const r = await Ipc.addClassificationOverride({
      sessionFolder: State.getSession().sessionFolder, override,
    });
    if (!r || !r.ok) { toast("Could not save the classification", "error"); return; }
  } catch (e) {
    toast("Could not save the classification: " + (e && e.message), "error");
    return;
  }
  toast('Classified "' + app + '" — re-analyzing…', "success");
  const btn = document.getElementById("btn-normalize");
  if (btn) btn.click();
}

/* Phase 3: in-app classification manager. Lists every application observed in
   the session and lets the analyst give each a meaningful activity label in
   one place (a rule-scoped classification override -- every window of that app
   -> the label). Saving re-analyzes so the map + lane pick the labels up. The
   see-everything companion to the per-band classifyApp. Uses persistAnnotations
   (in-memory + disk in one write) so the in-memory annotations stay consistent. */
function showClassifyManager() {
  if (!State.getSession()) return;
  const prior = document.getElementById("classify-mgr-backdrop");
  if (prior) prior.remove();

  // Distinct apps from activity events, by frequency.
  const counts = new Map();
  for (const ev of (State.getSession().events || [])) {
    if (ev.type !== "activity") continue;
    const app = (ev.data && ev.data.app) || "";
    if (app) counts.set(app, (counts.get(app) || 0) + 1);
  }
  const apps = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Prefill from existing whole-app rule overrides.
  const existing = {};
  for (const o of ((State.getSession().annotations || {}).classification_overrides || [])) {
    if (o && o.scope === "rule" && o.match && o.match.title_regex === ".*" && o.match.app) {
      existing[o.match.app] = o.label || "";
    }
  }

  const backdrop = document.createElement("div");
  backdrop.id = "classify-mgr-backdrop";
  backdrop.className = "modal-backdrop";
  const rows = apps.map(([app, n]) =>
    '<tr><td class="cm-app">' + escapeHtml(app) + '</td>' +
    '<td class="cm-count">' + n + '</td>' +
    '<td><input type="text" class="modal-input cm-label" data-app="' + escapeHtml(app) + '" ' +
    'value="' + escapeHtml(existing[app] || "") + '" placeholder="e.g. TAMBA — Ticket system"></td></tr>'
  ).join("");
  backdrop.innerHTML =
    '<div class="modal cm-modal">' +
    '<header class="modal-header"><h2>Classify activities</h2>' +
    '<button class="icon-btn modal-close" title="Close (Esc)">✕</button></header>' +
    '<div class="modal-body">' +
    '<p class="modal-msg">Give each application a meaningful label so the process map and timeline show real activities instead of “Unclassified”. This adds rules for this session and re-analyzes. Clear a label to remove it.</p>' +
    (apps.length
      ? '<table class="cm-table"><thead><tr><th>Application</th><th>Events</th><th>Activity label</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<p class="meta">No activity events in this session yet.</p>') +
    '</div>' +
    '<footer class="modal-footer"><button class="modal-cancel">Cancel</button>' +
    '<button class="cm-promote" title="Write these labels into a shared taxonomy.yaml so they classify EVERY future session, not just this one. You pick the team taxonomy file.">Save to team taxonomy…</button>' +
    '<button class="primary cm-save">Save & re-analyze</button></footer>' +
    '</div>';
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", onKey, true);
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector(".cm-save").addEventListener("click", async () => {
    const anno = ensureAnnoShape(State.getSession().annotations);
    anno.classification_overrides = anno.classification_overrides || [];
    let changed = 0;
    backdrop.querySelectorAll(".cm-label").forEach((inp) => {
      const app = inp.getAttribute("data-app");
      const label = (inp.value || "").trim();
      if (label === (existing[app] || "")) return;
      // Drop any prior whole-app rule override for this app, then re-add.
      anno.classification_overrides = anno.classification_overrides.filter(
        (o) => !(o && o.scope === "rule" && o.match
          && o.match.title_regex === ".*" && o.match.app === app));
      if (label) {
        anno.classification_overrides.push({
          override_id: cryptoRandomId(),
          scope: "rule",
          match: { app, title_regex: ".*" },
          label,
          created_at: new Date().toISOString(),
        });
      }
      changed++;
    });
    if (!changed) { close(); return; }
    await persistAnnotations(anno, "classify activities", ["timeline"]);
    close();
    toast(changed + " app" + (changed === 1 ? "" : "s") + " relabelled — re-analyzing…", "success");
    const btn = document.getElementById("btn-normalize");
    if (btn) btn.click();
  });

  backdrop.querySelector(".cm-promote").addEventListener("click", async () => {
    const rules = [];
    backdrop.querySelectorAll(".cm-label").forEach((inp) => {
      const app = inp.getAttribute("data-app");
      const label = (inp.value || "").trim();
      if (app && label) rules.push({ label, match: { app } });
    });
    if (!rules.length) { toast("Enter at least one label to promote.", ""); return; }
    const res = await Ipc.promoteTaxonomyRules({ rules });
    if (!res || res.canceled) return;
    if (!res.ok) { toast("Promote failed: " + (res.error || "unknown"), "error"); return; }
    toast("Promoted " + res.added + " rule" + (res.added === 1 ? "" : "s") +
      " to team taxonomy (" + res.total + " total)", "success");
  });
}

/* Pop a tiny context menu at (x, y) offering to queue a synthetic marker
   insert into annotations.json.marker_edits at timestamp `ts`. When `app` is
   set (right-click on an activity band) the menu also offers Classify this
   app. The edit only takes effect on the next normalization run. */
function showMarkerInsertMenu(x, y, ts, app) {
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
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", async () => {
      menu.remove();
      await handler();
    });
    menu.appendChild(item);
  }

  if (app) addItem("Classify this app…", () => classifyApp(app));
  addItem("Insert Start marker here…", () => queueSyntheticMarker(ts, "start"));
  addItem("Insert End marker here",    () => queueSyntheticMarker(ts, "end"));
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
  /* Dismiss on outside click / escape */
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
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
  if (e.target.closest(".tl-activity, .tl-case-band, .tl-marker, .tl-screenshot")) return;
  if (!State.getSession()) return;
  const evs = State.getSession().events || [];
  if (!evs.length) return;
  const rect = tl.getBoundingClientRect();
  if (rect.width <= 0) return;
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = last - first;
  if (span <= 0) return;
  e.preventDefault();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const ts = first + (x / rect.width) * span;
  showMarkerInsertMenu(e.clientX, e.clientY, new Date(ts).toISOString());
});

async function queueSyntheticMarker(ts, markerType) {
  if (!State.getSession()) return;
  let label = null;
  if (markerType === "start") {
    label = await promptModal({
      title: "Insert Start marker",
      message: "Label for the new Start marker",
      detail: "Queued in annotations.json; re-run Analyze to apply.",
      placeholder: "e.g. Send email",
      okLabel: "Insert",
    });
    if (label === null) return;     // cancelled
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
    await saveAnnotationsWithUndo(a, `insert ${markerType} marker`);
    toast(
      `${markerType === "start" ? "Start" : "End"} marker queued — re-run normalization to apply`,
      "success",
    );
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

/* G4: turn the current timeline range selection into a case — queue a
   synthetic Start at the range start and an End at the range end, in one
   save so undo reverts the pair. Applied on the next normalization run.
   Lets the analyst bracket process instances in an 8-hour passive
   recording after the fact, without capture-time markers. */
async function queueCaseFromSelection() {
  const range = State.getSelectionRange();
  if (!range || !State.getSession()) return;
  let label = await promptModal({
    title: "Insert case from selection",
    message: "Label for the new case",
    detail: "Queues Start and End markers in annotations.json; re-run Analyze to apply.",
    placeholder: "e.g. Order entry",
    okLabel: "Insert case",
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
    await saveAnnotationsWithUndo(a, "insert case from selection");
    toast("Case queued — re-run normalization to apply", "success");
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

/* Suggested markers (ADR-0017) + anchor candidates (ADR-0018) -- the
   accept/dismiss/clear logic and renderAnchorCandidates -- live in
   flow-view-markers.js (god-file split). */

/* H6: mark the current timeline range as excluded from analysis. The
   range is stored in annotations.json.excluded_ranges; on the next
   analysis, step suggestion and statistics skip every event inside it.
   Lets the analyst cut a lunch break or an unrelated detour out of a
   long passive recording without touching the raw event log. */
async function queueExcludeRange() {
  const range = State.getSelectionRange();
  if (!range || !State.getSession()) return;
  const ok = await confirmModal({
    title: "Exclude this range from analysis?",
    message: "Events inside the selected range will be skipped during step suggestion and statistics on the next analysis.",
    detail: "The raw events are kept; re-run Analyze to apply.",
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
    toast("Range excluded — re-run normalization to apply", "success");
    clearSelectionRange();
  } catch (err) {
    toast("Failed to save annotation: " + (err && err.message), "error");
  }
}

/* The timeline lane toggles, renderTimeline (the lane stack), its lane
   helpers (layoutCaseLanes / isUserActivityEvent / monitorBadgeFor), and
   the minimap all live in flow-view-timeline.js (god-file split). */

/* Right-click on a case band: offer scope + jump actions. Uses the
   same context-menu construction pattern as showMarkerInsertMenu. */
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
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => item.style.background = "var(--accent)");
    item.addEventListener("mouseleave", () => item.style.background = "");
    item.addEventListener("click", () => { menu.remove(); handler(); });
    menu.appendChild(item);
  }
  addItem("Scope view to this case", () => {
    /* Find the case by start timestamp -- the case scope dropdown
       keys cases by case_id derived from normalization, but visually
       we map by startMs which is stable. */
    const cases = State.getSession() ? deriveCases(State.getSession()) : [];
    const match = cases.find(x => Math.abs(x.startMs - c.startMs) < 5);
    if (match) {
      State.setCaseScope(match.id);
      const sel = $("#case-scope-select");
      if (sel) { sel.value = match.id; sel.dispatchEvent(new Event("change")); }
      else { renderTimeline(); }
      toast(`Scoped to: ${match.label || match.id}`);
    } else {
      toast("Case not found in normalized output -- run Analyze first", "error");
    }
  });
  addItem("Jump to start", () => seekToTimestamp(new Date(c.startMs).toISOString()));
  if (!c.dangling) {
    addItem("Jump to end", () => seekToTimestamp(new Date(c.endMs).toISOString()));
  }
  document.body.appendChild(menu);
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
  const step = anno.steps.find((s) => s.step_id === sid);
  if (!step) { toast("The selected step no longer exists", "error"); return; }
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

/* ============ Annotations / screenshots / markers ================= */

function renderAnnotations() {
  const host = $("#annotations-list");
  host.innerHTML = "";
  const notes = (State.getSession().annotations && State.getSession().annotations.notes) || [];
  if (!notes.length) {
    host.innerHTML = '<p class="hint">No annotations yet. Anchor a note to the current playback time below.</p>';
    return;
  }
  for (const n of notes.slice().reverse()) {
    const row = document.createElement("div");
    row.className = "anno-row";
    row.innerHTML = '<span class="ts">' + escapeHtml(n.timestamp.slice(11, 19)) + '</span>' +
                    '<span class="text">' + escapeHtml(n.text) + '</span>';
    row.addEventListener("click", () => seekToTimestamp(n.timestamp));
    host.appendChild(row);
  }
}

$("#btn-save-note").addEventListener("click", async () => {
  if (!State.getSession()) return;
  const note = $("#anno-note").value.trim();
  if (!note) return;
  const video = $("#video");
  const videoTs = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  const anno = State.getSession().annotations || { notes: [] };
  anno.notes = anno.notes || [];
  anno.notes.push({
    id: cryptoRandomId(),
    type: "note",
    timestamp: videoTs,
    video_offset_s: video.currentTime || 0,
    text: note,
  });
  await saveAnnotationsWithUndo(anno, "add note");
  State.getSession().annotations = anno;
  $("#anno-note").value = "";
  renderAnnotations();
  toast("Note saved", "success");
});

/* renderScreenshots / the screenshot gallery / toggleScreenshotStar /
   openScreenshot live in flow-view-screenshots.js (god-file split);
   renderScreenshots + openScreenshot are destructured at the top here. */

/* getMarkerEdit / effectiveLabel / effectiveTimestamp / isDeletedMarker,
   renderMarkersList, _humanReason, and the per-marker adjust / delete /
   rename actions live in flow-view-markers.js (god-file split). */

/* deps = { renderShortcutsOverlay, rerenderActiveLevel, applyLevel,
   activateTab } -- cross-surface glue kept in renderer.js. Call once
   at boot. */
function initFlowView(deps) {
  renderShortcutsOverlay = deps.renderShortcutsOverlay || (() => {});
  rerenderActiveLevel    = deps.rerenderActiveLevel    || (() => {});
  applyLevel             = deps.applyLevel             || (() => {});
  activateTab            = deps.activateTab            || (() => {});
  addStepAtTimestamp     = deps.addStepAtTimestamp     || (async () => {});
  // Hand the video module the session (re)loader it calls after a re-sync,
  // injected rather than require()d to avoid a flow-view <-> video cycle.
  Video.initVideo({ loadSessionIntoView });
  // Hand the markers module the timeline re-render it triggers after an
  // accept/dismiss, injected for the same reason.
  FlowMarkers.initMarkers({ renderTimeline });
  // Hand the timeline module the flow-view-resident glue its lanes call
  // (case-scope dimming + the two context menus + the notes-tab switch),
  // injected to keep the timeline <-> flow-view graph acyclic.
  Timeline.initTimeline({
    currentScopeRange, showMarkerInsertMenu, showCaseContextMenu, activateAnnoTab,
  });
}

module.exports = {
  initFlowView,
  loadSessionIntoView, renderTimeline, renderMarkersList,
  renderAnchorCandidates,
  renderAnnotations, renderSessionPills,
  seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow, watchStep,
  activateAnnoTab, addStepAtPlayhead, deriveCases,
};
