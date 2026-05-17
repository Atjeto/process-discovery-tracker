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
const TimelineCore = require("../timeline/timeline-core.js");
const State = require("../state.js");
const PdtTheme = require("../theme.js");
const Ipc = require("../ipc.js");
const PdtPalette = require("../command-palette.js");
const { $, $$, escapeHtml, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { promptModal, confirmModal } = require("../modals.js");
const { resetUndoStack, saveAnnotationsWithUndo, persistAnnotations } = require("../session.js");
const { pushRecent } = require("../recent.js");
const { renderStepsLevel } = require("./steps-view.js");
const { renderPhasesLevel } = require("./phases-view.js");
const SessionSummary = require("../session-summary.js");

/* Injected by renderer.js -- cross-surface glue kept in the thin entry.
   Lazy wrappers so hoisting / load order does not matter. */
let renderShortcutsOverlay = () => {};
let rerenderActiveLevel = () => {};
let applyLevel = () => {};
let activateTab = () => {};

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
    { label: "Switch to Process Template", hint: "Tab 3", run: () => activateTab("canonical") },
    { label: "Switch to Vocabularies", hint: "Tab 4", run: () => activateTab("vocabularies") },
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
  PdtPalette.setProvider(commandPaletteProvider);
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

(function wireMarkerFilter() {
  const txt = document.getElementById("marker-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().marker.text = txt.value.trim();
        if (State.getSession()) renderMarkersList();
      }, 120);
    });
  }
})();

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await Ipc.openSessionFolder();
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

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
    // Persist template path into annotations.json so future re-analyses remember it.
    try {
      const a = State.getSession().annotations || {};
      a.matched_against = a.matched_against || {};
      a.matched_against.template_path = r.path;
      await Ipc.saveAnnotations({
        sessionFolder: State.getSession().sessionFolder,
        annotations: a,
      });
    } catch (_) {}
    toast("Matched against Process Template", "success");
    await loadSessionIntoView(State.getSession().sessionFolder);
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
  if (State.getSession().recordingAvailable && State.getSession().recordingPath) {
    video.src = "file:///" + State.getSession().recordingPath.replace(/\\/g, "/");
    video.style.display = "";
    noVid.style.display = "none";
    overlay.style.display = "";
  } else {
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
    noVid.style.display = "";
    overlay.style.display = "none";
  }
  video.addEventListener("timeupdate", positionPlayhead);
  video.addEventListener("loadedmetadata", () =>
    setVideoOverlay(`${formatDuration(video.duration * 1000)} loaded`));
  setVideoOverlay(State.getSession().recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderScreenshots();
  renderMarkersList();
  renderTimelineSummary();
  // Phase B+ surfaces
  State.setSelectedStepId(null);
  State.setSelectedPhaseId(null);
  State.setMultiSelectedStepIds(new Set());
  if ($("#btn-group-into-phase")) $("#btn-group-into-phase").disabled = true;
  renderStepsLevel();
  renderPhasesLevel();
  updateProcessMapStatus();
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
}

/* Count BPMN flow nodes (task/event/gateway). Ignore namespace prefix. */
function countBpmnNodes(xml) {
  const nodeRe = /<(?:[\w-]+:)?(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|callActivity|subProcess|startEvent|endEvent|intermediateThrowEvent|intermediateCatchEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)\b/g;
  return (xml.match(nodeRe) || []).length;
}

/* Surface the per-session BPMN output produced by `normalize.py --mine`.
   Reads process_map.bpmn from the loaded session folder, counts flow
   nodes, and exposes Open / Reveal affordances in the actions bar.
   Also detects per-case BPMNs under process_maps/ and exposes them
   via a dropdown so multi-case sessions are first-class. */
function updateProcessMapStatus() {
  const wrap = document.getElementById("process-map-status");
  if (!wrap) return;
  if (!State.getSession() || !State.getSession().sessionFolder) {
    wrap.style.display = "none";
    return;
  }
  const bpmnPath = path.join(State.getSession().sessionFolder, "process_map.bpmn");
  let xml = "";
  try {
    if (!fs.existsSync(bpmnPath)) {
      wrap.style.display = "none";
      return;
    }
    xml = fs.readFileSync(bpmnPath, "utf8");
  } catch (_) {
    wrap.style.display = "none";
    return;
  }
  const nodeCount = countBpmnNodes(xml);
  const detail = document.getElementById("process-map-detail");
  if (detail) detail.textContent = nodeCount + (nodeCount === 1 ? " node" : " nodes");
  wrap.style.display = "";
  wrap.dataset.bpmnPath = bpmnPath;

  // Per-case BPMNs (if normalize.py --mine wrote any)
  const perCaseDir = path.join(State.getSession().sessionFolder, "process_maps");
  const sel = document.getElementById("process-map-case-select");
  if (!sel) return;
  let perCaseFiles = [];
  try {
    if (fs.existsSync(perCaseDir)) {
      perCaseFiles = fs.readdirSync(perCaseDir)
        .filter(f => f.toLowerCase().endsWith(".bpmn"))
        .sort();
    }
  } catch (_) {}
  if (!perCaseFiles.length) {
    sel.style.display = "none";
    return;
  }
  sel.style.display = "";
  const opts = ['<option value="">Aggregate (all cases)</option>']
    .concat(perCaseFiles.map(f => `<option value="${f}">${f.replace(/\.bpmn$/i, "")}</option>`));
  sel.innerHTML = opts.join("");
  sel.onchange = () => {
    const v = sel.value;
    wrap.dataset.bpmnPath = v
      ? path.join(perCaseDir, v)
      : bpmnPath;
    try {
      const x = fs.readFileSync(wrap.dataset.bpmnPath, "utf8");
      const n = countBpmnNodes(x);
      if (detail) detail.textContent = n + (n === 1 ? " node" : " nodes");
    } catch (_) {}
  };
}

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
    const err = await Ipc.openExternal(p);
    if (err) toast("Could not open: " + err, "error");
  });
  if (reveal) reveal.addEventListener("click", () => {
    const p = currentBpmnPath();
    if (p) Ipc.revealFile(p);
  });
})();

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
      pills.push({
        label: vocabs.length === 1 ? "vocab" : "vocabs",
        val: `${vocabs.map(v => v.id).join(", ")} · ${hits} hits`,
        cls: hits > 0 ? "ok" : "",
      });
    }
  } else {
    pills.push({ label: "analyzed", val: "no", cls: "warn" });
  }
  const editCount = ((State.getSession().annotations || {}).marker_edits || []).length;
  if (editCount > 0) pills.push({ label: "edits", val: editCount, cls: "warn" });
  $("#session-pills").innerHTML = pills.map((p) =>
    '<div class="pill' + (p.cls ? " " + p.cls : "") + '"><span class="dot"></span>' +
    '<span class="lbl">' + escapeHtml(p.label) + '</span>' + escapeHtml(String(p.val)) + '</div>'
  ).join("");

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
  if (s.hasTemplate || s.matchedInteractions > 0) {
    tiles.push({ label: "Template match", value: pct(s.matchRate || 0),
      sub: `${s.matchedInteractions} interactions` });
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

  const hint = (s.caseCount > 0 && s.stepCount > 0)
    ? '<div class="summary-hint">Cases are time ranges marked during recording. ' +
      "Steps are logical actions identified during analysis — the two are independent.</div>"
    : "";

  const teaser = `${s.engagement} · ${formatDuration(s.durationMs)} · ` +
    `${s.caseCount} case${s.caseCount === 1 ? "" : "s"}`;

  panel.innerHTML =
    '<summary><span class="summary-label">Session summary</span>' +
      `<span class="summary-teaser">${escapeHtml(teaser)}</span></summary>` +
    '<div class="summary-body">' +
      '<div class="summary-head">Engagement ' +
        `<strong>${escapeHtml(s.engagement)}</strong> · worker ` +
        `<strong>${escapeHtml(s.worker)}</strong> · ` +
        `<strong>${escapeHtml(formatDuration(s.durationMs))}</strong> · ` +
        `analyzed ${escapeHtml(analyzed)}</div>` +
      `<div class="summary-tiles">${tilesHtml}</div>` +
      activityHtml + casesHtml + driftHtml + integrityHtml + problemsHtml + hint + bannerHtml +
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

function setVideoOverlay(text) {
  let o = $("#video-overlay");
  o.textContent = text;
}

/* ============ Timeline ============================================ */

/* Per-app colour. Known apps get fixed assignments so the same colour
   is stable across sessions; unknown apps get a deterministic slot via
   a small hash so they stay stable too. The palettes -- and the
   light/dark split -- live in theme.js; bands are solid fills carrying
   white labels, so every colour is deep enough to clear white text. */
function appColor(app) {
  const { map, palette, fallback } = PdtTheme.appColors();
  if (!app) return fallback;
  if (map[app]) return map[app];
  let h = 0;
  const s = app.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/* Friendly display name for known executables; falls back to the raw
   process name so unmapped apps remain identifiable in the legend. */
const APP_LABELS = {
  "chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox",
  "SAPGUI.exe": "SAP", "saplogon.exe": "SAP",
  "EXCEL.EXE": "Excel", "OUTLOOK.EXE": "Outlook",
  "winword.exe": "Word", "powerpnt.exe": "PowerPoint", "Teams.exe": "Teams",
};
function appLabel(app) { return APP_LABELS[app] || (app || "unknown").replace(/\.exe$/i, ""); }

function renderLegend(observedApps) {
  const host = document.getElementById("legend-apps");
  if (!host) return;
  host.innerHTML = "";
  const apps = Array.from(observedApps || []).sort();
  for (const app of apps) {
    const span = document.createElement("span");
    span.className = "legend-app";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = appColor(app);
    span.appendChild(sw);
    span.appendChild(document.createTextNode(appLabel(app)));
    host.appendChild(span);
  }
}

/* P1.10: persistent timeline zoom + scroll per session. Keyed by
   sessionFolder so each session reopens to where the analyst left it.
   Uses a small in-memory throttle for scroll writes since scroll fires
   continuously during drag. */
const TL_STATE_KEY = "pdt.timelineState";
function _readTimelineState() {
  try { return JSON.parse(localStorage.getItem(TL_STATE_KEY)) || {}; }
  catch (_) { return {}; }
}
function _writeTimelineState(map) {
  try { localStorage.setItem(TL_STATE_KEY, JSON.stringify(map)); }
  catch (_) {}
}
function persistTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const scroll = document.getElementById("timeline-scroll");
  map[State.getSession().sessionFolder] = {
    zoomFactor: State.getZoomFactor(),
    scrollLeft: scroll ? scroll.scrollLeft : 0,
    ts: Date.now(),
  };
  _writeTimelineState(map);
}
function restoreTimelineForCurrent() {
  if (!State.getSession() || !State.getSession().sessionFolder) return;
  const map = _readTimelineState();
  const saved = map[State.getSession().sessionFolder];
  if (!saved) return;
  if (typeof saved.zoomFactor === "number" && saved.zoomFactor >= 1) {
    State.setZoomFactor(saved.zoomFactor);
    renderTimeline();
  }
  // Wait one frame so the host has expanded to the new width before scrolling.
  requestAnimationFrame(() => {
    const scroll = document.getElementById("timeline-scroll");
    if (scroll && typeof saved.scrollLeft === "number") scroll.scrollLeft = saved.scrollLeft;
  });
}
let _tlScrollPersistTimer = null;
function _wireTimelineScrollPersist() {
  const scroll = document.getElementById("timeline-scroll");
  if (!scroll || scroll._pdtPersistWired) return;
  scroll._pdtPersistWired = true;
  scroll.addEventListener("scroll", () => {
    syncMinimapViewport();
    if (_tlScrollPersistTimer) return;
    _tlScrollPersistTimer = setTimeout(() => {
      _tlScrollPersistTimer = null;
      persistTimelineForCurrent();
    }, 250);
  });
}
/* I2: on the first load of a session (no remembered timeline view),
   nudge the scroll to the first case so a long recording doesn't open
   on empty pre-case time. Skipped once the analyst has zoomed or
   scrolled -- restoreTimelineForCurrent already owns that case. */
function maybeAutoScrollToFirstCase() {
  const sess = State.getSession();
  if (!sess || !sess.sessionFolder) return;
  if (_readTimelineState()[sess.sessionFolder]) return;   // remembered view
  if (State.getZoomFactor() !== 1) return;                // default zoom only
  const cases = (sess.stats && sess.stats.case_stats) || [];
  const evs = sess.events || [];
  if (!evs.length) return;
  const tops = cases
    .filter((c) => !c.parent_case_id && c.start_ts)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts));
  if (!tops.length) return;
  const first = Date.parse(evs[0].timestamp);
  const last = Date.parse(evs[evs.length - 1].timestamp);
  const span = Math.max(1, last - first);
  const frac = (Date.parse(tops[0].start_ts) - first) / span;
  if (!isFinite(frac) || frac < 0.04) return;   // first case already near the start
  requestAnimationFrame(() => {
    const scroll = document.getElementById("timeline-scroll");
    if (scroll) scroll.scrollLeft = Math.max(0, frac * scroll.scrollWidth - 48);
  });
}

$("#btn-zoom-in").addEventListener("click", () => { State.setZoomFactor(State.getZoomFactor() * 1.5); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-out").addEventListener("click", () => { State.setZoomFactor(Math.max(1, State.getZoomFactor() / 1.5)); renderTimeline(); persistTimelineForCurrent(); });
$("#btn-zoom-reset").addEventListener("click", () => { State.setZoomFactor(1); renderTimeline(); persistTimelineForCurrent(); });

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
    '<span class="clear-link" id="tl-selection-clear">× Clear selection</span>';
  document.getElementById("tl-selection-clear").addEventListener("click", clearSelectionRange);
  document.getElementById("tl-selection-case").addEventListener("click", queueCaseFromSelection);
}

/* P1.3: minimap overview above the timeline. A 30px strip showing the
   whole session compressed; the highlighted rectangle marks the
   currently-visible region in the scroll container. Click anywhere to
   jump; drag the rectangle to scroll. */
function renderMinimap() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  if (!mm || !scroll || !State.getSession() || !State.getSession().events) return;
  const evs = State.getSession().events;
  if (!evs.length) { mm.style.display = "none"; return; }
  mm.style.display = "";
  const first = new Date(evs[0].timestamp).getTime();
  const last  = new Date(evs[evs.length - 1].timestamp).getTime();
  const span  = Math.max(1, last - first);
  // Build / reset content.
  mm.innerHTML = "";
  // Activity bands (compressed). Skip very short ones for clarity.
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const dur = ev.data.duration_ms || 0;
    if (dur < span * 0.0005) continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.1, (dur / span) * 100);
    const b = document.createElement("div");
    b.className = "tl-mm-band";
    b.style.left = x + "%";
    b.style.width = w + "%";
    b.style.background = appColor(ev.data.app);
    mm.appendChild(b);
  }
  // Viewport rectangle.
  const vp = document.createElement("div");
  vp.className = "tl-mm-viewport";
  vp.id = "tl-mm-viewport";
  mm.appendChild(vp);
  syncMinimapViewport();
}
function syncMinimapViewport() {
  const mm = document.getElementById("timeline-minimap");
  const scroll = document.getElementById("timeline-scroll");
  const vp = document.getElementById("tl-mm-viewport");
  if (!mm || !scroll || !vp) return;
  const inner = scroll.scrollWidth || 1;
  const outer = scroll.clientWidth || 1;
  const visibleFrac = Math.min(1, outer / inner);
  const startFrac   = scroll.scrollLeft / inner;
  vp.style.left  = (startFrac * 100) + "%";
  vp.style.width = (visibleFrac * 100) + "%";
}
(function wireMinimap() {
  const mm = document.getElementById("timeline-minimap");
  if (!mm || mm._pdtWired) return;
  mm._pdtWired = true;
  mm.addEventListener("click", (e) => {
    // Click outside the viewport rect → jump there.
    if (e.target.id === "tl-mm-viewport") return;
    const scroll = document.getElementById("timeline-scroll");
    if (!scroll) return;
    const rect = mm.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const inner = scroll.scrollWidth || 1;
    const outer = scroll.clientWidth || 1;
    scroll.scrollLeft = Math.max(0, frac * inner - outer / 2);
    syncMinimapViewport();
    persistTimelineForCurrent();
  });
  // Drag the viewport.
  let dragging = null;
  mm.addEventListener("mousedown", (e) => {
    if (e.target.id !== "tl-mm-viewport") return;
    e.preventDefault();
    const vp = e.target;
    vp.classList.add("dragging");
    const scroll = document.getElementById("timeline-scroll");
    const rect = mm.getBoundingClientRect();
    dragging = { startX: e.clientX, startScrollLeft: scroll.scrollLeft, mmW: rect.width, scroll };
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dxPx = e.clientX - dragging.startX;
    const inner = dragging.scroll.scrollWidth || 1;
    const dxScroll = (dxPx / Math.max(1, dragging.mmW)) * inner;
    dragging.scroll.scrollLeft = Math.max(0, dragging.startScrollLeft + dxScroll);
    syncMinimapViewport();
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    const vp = document.getElementById("tl-mm-viewport");
    if (vp) vp.classList.remove("dragging");
    dragging = null;
    persistTimelineForCurrent();
  });
})();

/* P1.2: hover thumbnail for timeline screenshot dots. Single shared
   element — created lazily, repositioned on each show. */
let _screenshotThumbEl = null;
function showScreenshotThumb(dot, imgPath) {
  if (!_screenshotThumbEl) {
    _screenshotThumbEl = document.createElement("img");
    _screenshotThumbEl.className = "tl-screenshot-thumb";
    document.body.appendChild(_screenshotThumbEl);
  }
  _screenshotThumbEl.src = "file:///" + imgPath.replace(/\\/g, "/");
  const rect = dot.getBoundingClientRect();
  // Place above the dot, biased to keep within viewport.
  const thumbW = 220, thumbH = 140;
  let left = rect.left + rect.width / 2 - thumbW / 2;
  if (left < 8) left = 8;
  if (left + thumbW > window.innerWidth - 8) left = window.innerWidth - thumbW - 8;
  let top = rect.top - thumbH - 8;
  if (top < 8) top = rect.bottom + 8;
  _screenshotThumbEl.style.left = left + "px";
  _screenshotThumbEl.style.top  = top  + "px";
  _screenshotThumbEl.style.display = "block";
}
function hideScreenshotThumb() {
  if (_screenshotThumbEl) _screenshotThumbEl.style.display = "none";
}

function renderTimelineSummary() {
  const evs = State.getSession().events;
  if (!evs.length) { $("#timeline-summary").textContent = ""; return; }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  $("#timeline-summary").textContent =
    first.toLocaleTimeString() + " → " + last.toLocaleTimeString() +
    " · " + formatDuration(last - first);
}

/* Pop a tiny context menu at (x, y) offering to queue a synthetic
   marker insert into annotations.json.marker_edits at timestamp `ts`.
   The edit only takes effect on the next normalization run. */
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

  addItem("Insert Start marker here…", () => queueSyntheticMarker(ts, "start"));
  addItem("Insert End marker here",    () => queueSyntheticMarker(ts, "end"));

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

/* P2.D: timeline lane visibility. Defaults keep the core lanes on and
   the denser additions (density / window-titles / per-step / notes)
   off so the timeline isn't overwhelming out of the box. Persisted
   per-installation since it's a workflow preference, not session data. */
const LANE_KEY = "pdt.timelineLanes";
const LANE_DEFAULTS = {
  idle: true, markers: true, screenshots: true, cases: true,
  density: false, titles: false, steps: false, notes: false,
};
function getLaneToggles() {
  try {
    const saved = JSON.parse(localStorage.getItem(LANE_KEY)) || {};
    return Object.assign({}, LANE_DEFAULTS, saved);
  } catch (_) { return Object.assign({}, LANE_DEFAULTS); }
}
function setLaneToggle(key, on) {
  const cur = getLaneToggles();
  cur[key] = !!on;
  try { localStorage.setItem(LANE_KEY, JSON.stringify(cur)); } catch (_) {}
}
(function wireLanesMenu() {
  const btn = document.getElementById("btn-lanes");
  const popup = document.getElementById("lanes-popup");
  if (!btn || !popup) return;
  // Reflect persisted state into the checkboxes.
  const toggles = getLaneToggles();
  popup.querySelectorAll("input[data-lane]").forEach((cb) => {
    cb.checked = !!toggles[cb.dataset.lane];
    cb.addEventListener("change", () => {
      setLaneToggle(cb.dataset.lane, cb.checked);
      if (State.getSession()) renderTimeline();
    });
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.style.display = popup.style.display === "none" ? "" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== btn) popup.style.display = "none";
  });
})();

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = State.getSession().events;
  if (!evs.length) {
    const mm = document.getElementById("timeline-minimap");
    if (mm) mm.style.display = "none";
    return;
  }
  const lanes = getLaneToggles();
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  /* Lane stack (top to bottom):
       ticks        -- HH:MM:SS labels at sensible intervals
       cases        -- one labelled row per concurrent case (header)
       activity     -- per-app coloured bands (the hero lane)
       screenshots  -- dedicated capture rail
       density / titles / steps / notes -- optional lanes
       playhead overlays all lanes.
     Each lane below is a { key, height, gapBefore, render } plugin; the
     shared timeline core (TimelineCore.renderLaneStack) stacks them, drives
     the zoom width + minHeight, and calls each lane's render(host, ctx).
     See docs/adr/0003-viewer-architecture-refactor.md items 4-5. */
  const ticksH = 20;
  const caseRowH = 22;

  // P2.12: window-title runs lane. Group consecutive activity events
  // by (app, title) and emit one band per run.
  const _titleRuns = [];
  {
    let runStart = null, runEndDur = 0, runApp = null, runTitle = null;
    function flushRun(endMs) {
      if (runStart != null && endMs > runStart) {
        _titleRuns.push({ startMs: runStart, endMs, app: runApp, title: runTitle });
      }
      runStart = null; runApp = null; runTitle = null; runEndDur = 0;
    }
    for (const ev of evs) {
      if (ev.type !== "activity") continue;
      const t = new Date(ev.timestamp).getTime();
      const dur = ev.data.duration_ms || 0;
      const app = ev.data.app || "";
      const title = ev.data.title || "";
      if (runStart == null) {
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      } else if (app === runApp && title === runTitle) {
        runEndDur = (t + dur) - runStart;
      } else {
        flushRun(runStart + runEndDur);
        runStart = t; runApp = app; runTitle = title; runEndDur = dur;
      }
    }
    if (runStart != null) flushRun(runStart + runEndDur);
  }

  const _stepsForLane = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const _notesForLane = (State.getSession().annotations && State.getSession().annotations.notes) || [];

  // Case bands render as a labelled header ABOVE the activity lane;
  // layoutCaseLanes assigns each case a non-overlapping lane (sweep-line).
  const caseLanes = layoutCaseLanes(evs, first, last);

  // Resolved lane heights. A height of 0 hides the lane: the core skips its
  // render and (with gapBefore) collapses the spacing. These mirror the
  // pre-core geometry; gapBefore values below reproduce the lane cascade.
  const casesH = lanes.cases ? caseLanes.lanesNeeded * caseRowH : 0;
  const activityH = 60;
  const screenshotsH = lanes.screenshots ? 26 : 0;
  const densityH = lanes.density ? 12 : 0;
  const titlesLaneH = (lanes.titles && _titleRuns.length) ? 14 : 0;
  const stepsLaneH = (lanes.steps && _stepsForLane.length) ? 16 : 0;
  const notesLaneH = (lanes.notes && _notesForLane.length) ? 18 : 0;

  // Apps observed while drawing the activity lane feed the legend; the case
  // scope range dims out-of-scope activity bands. Both computed once.
  const observedApps = new Set();
  const scopeRange = currentScopeRange();

  // ===== Time-axis ticks =====
  // Tick positions, intervals, and labels come from the shared timeline
  // core -- the same logic the Steps and Phases timelines use. The
  // `.tl-flow-tick` class keeps the Flow ticks (tall vertical lines)
  // distinct from the mini-timelines' short `.tl-tick` axis ticks. The
  // tick lines reach down to the bottom of the activity lane.
  const ticksLane = {
    key: "ticks",
    height: ticksH,
    gapBefore: 4,
    render(host, ctx) {
      const ticksTop = ctx.slot.top;
      const act = ctx.slots.get("activity");
      const activityTop = act.top;
      const activityH = act.height;
      for (const tk of TimelineCore.chooseTicks(first, last, 12)) {
        const x = tk.xPct;
        const tick = document.createElement("div");
        tick.className = "tl-flow-tick";
        tick.style.left = x + "%";
        tick.style.top = ticksTop + "px";
        tick.style.height = (activityTop + activityH - ticksTop) + "px";
        host.appendChild(tick);
        const lbl = document.createElement("div");
        lbl.className = "tl-flow-tick-label";
        lbl.style.left = "calc(" + x + "% + 3px)";
        lbl.style.top = ticksTop + "px";
        lbl.textContent = tk.label;
        host.appendChild(lbl);
      }
    },
  };

  // ===== Case lanes =====
  // layoutCaseLanes() walks the marker stream and assigns each case to a
  // non-overlapping lane via a sweep-line algo:
  //   - Each case knows its [start, end) and a parent_id.
  //   - A new case picks the first lane whose previous occupant ended
  //     before this case starts. Nested cases land BELOW their parent.
  //   - Dangling cases (start with no end) extend to `last` with a
  //     dashed right edge so they're visually distinct from closed.
  // The case scope dropdown can target any of these directly.
  const casesLane = {
    key: "cases",
    height: casesH,
    gapBefore: 4,
    render(host, ctx) {
      const casesTop = ctx.slot.top;
      for (const c of (lanes.cases ? caseLanes.cases : [])) {
        const x = ((c.startMs - first) / span) * 100;
        const w = Math.max(0.15, ((c.endMs - c.startMs) / span) * 100);
        const top = casesTop + c.lane * caseRowH;
        const band = document.createElement("div");
        band.className = "tl-case-band" + (c.dangling ? " dangling" : "");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = top + "px";
        band.style.height = (caseRowH - 4) + "px";
        band.title = (c.dangling ? "unclosed: " : "case: ") +
          (c.label || "(unlabeled)") +
          (c.dangling ? "" : "\n" + formatDuration(c.endMs - c.startMs));
        // Click anywhere on a case band -- closed OR dangling -- seeks
        // the video to the case start. Right-click opens the scope/jump
        // menu below.
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          seekToTimestamp(new Date(c.startMs).toISOString());
        });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Scope-to-case option (in addition to the marker insert menu
          // available on activity bands).
          showCaseContextMenu(e.clientX, e.clientY, c);
        });
        host.appendChild(band);
        const lbl = document.createElement("div");
        lbl.className = "tl-case-label";
        lbl.style.left = "calc(" + x + "% + 4px)";
        lbl.style.top = (top + 3) + "px";
        lbl.textContent = c.label || "(unlabeled)";
        host.appendChild(lbl);
      }
    },
  };

  // ===== Activity lane (the hero lane) =====
  // Per-app coloured bands with inline title + duration labels so analysts
  // can read the timeline without hovering. Out-of-scope bands (case scope
  // active and this band's midpoint outside the case range) are dimmed via
  // .out-of-scope so context survives. Idle bands and marker bars share the
  // activity lane's row.
  const activityLane = {
    key: "activity",
    height: activityH,
    gapBefore: casesH ? 6 : 4,
    render(host, ctx) {
      const activityTop = ctx.slot.top;
      const activityH = ctx.slot.height;
      for (const ev of evs) {
        if (ev.type !== "activity") continue;
        const t = new Date(ev.timestamp).getTime();
        const dur = ev.data.duration_ms || 0;
        const x = ((t - first) / span) * 100;
        const w = Math.max(0.15, (dur / span) * 100);
        const inScope = !scopeRange ||
          (t + dur / 2 >= scopeRange.startMs && t + dur / 2 <= scopeRange.endMs);
        const band = document.createElement("div");
        band.className = "tl-band tl-activity" + (inScope ? "" : " out-of-scope");
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = activityTop + "px";
        band.style.height = activityH + "px";
        band.style.background = appColor(ev.data.app);
        band.dataset.app = ev.data.app || "";
        if (ev.data.app) observedApps.add(ev.data.app);
        band.title = (ev.data.app || "") + " - " + (ev.data.title || "") +
          "\n" + new Date(t).toLocaleTimeString() + " (" + formatDuration(dur) + ")";

        // Label: app name (top line, bold-ish) + window title (second line, dim).
        // Duration pinned to bottom-right. CSS hides children that don't fit.
        const lbl = document.createElement("div");
        lbl.className = "tl-activity-label";
        const appName = document.createElement("span");
        appName.className = "tl-act-app";
        appName.textContent = appLabel(ev.data.app);
        const titleEl = document.createElement("span");
        titleEl.className = "tl-act-title";
        titleEl.textContent = ev.data.title || "";
        const durEl = document.createElement("span");
        durEl.className = "tl-act-dur";
        durEl.textContent = formatDuration(dur);
        lbl.appendChild(appName);
        lbl.appendChild(titleEl);
        lbl.appendChild(durEl);
        band.appendChild(lbl);

        band.addEventListener("click", (e) => { e.stopPropagation(); seekToTimestamp(ev.timestamp); });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          showMarkerInsertMenu(e.clientX, e.clientY, ev.timestamp);
        });
        host.appendChild(band);
      }

      // Idle bands
      let idleStart = null;
      for (const ev of (lanes.idle ? evs : [])) {
        if (ev.type !== "system") continue;
        if (ev.data.kind === "idle_start") idleStart = new Date(ev.timestamp).getTime();
        else if (ev.data.kind === "idle_end" && idleStart) {
          const endT = new Date(ev.timestamp).getTime();
          const x = ((idleStart - first) / span) * 100;
          const w = Math.max(0.15, ((endT - idleStart) / span) * 100);
          const band = document.createElement("div");
          band.className = "tl-band tl-idle";
          band.style.left = x + "%";
          band.style.width = w + "%";
          band.style.top = activityTop + "px";
          band.style.height = activityH + "px";
          band.title = "idle " + formatDuration(endT - idleStart);
          host.appendChild(band);
          idleStart = null;
        }
      }

      // Marker bars (rendered above bands)
      for (const ev of (lanes.markers ? evs : [])) {
        if (ev.type !== "marker") continue;
        const t = new Date(ev.timestamp).getTime();
        const x = ((t - first) / span) * 100;
        const bar = document.createElement("div");
        bar.className = "tl-marker";
        bar.style.left = x + "%";
        bar.style.height = activityH + "px";
        bar.style.top = activityTop + "px";
        bar.title = ev.data.marker_type + ": " + (ev.data.label || "") +
          (ev.data.reason ? " (" + ev.data.reason + ")" : "");
        host.appendChild(bar);
        if (ev.data.marker_type === "start") {
          const label = effectiveLabel(ev);
          if (label) {
            const lbl = document.createElement("div");
            lbl.className = "tl-marker-label";
            lbl.style.left = "calc(" + x + "% + 4px)";
            lbl.style.top = (activityTop + 2) + "px";
            lbl.textContent = label;
            host.appendChild(lbl);
          }
        }
      }
    },
  };

  // ===== Screenshot rail =====
  // A dedicated capture lane beneath the activity bands: clearly visible,
  // clickable camera markers in their own row rather than dots lost on
  // the band edge. P1.2: hover still pops a thumbnail preview.
  const screenshotsLane = {
    key: "screenshots",
    height: screenshotsH,
    gapBefore: 4,
    render(host, ctx) {
      const screenshotsTop = ctx.slot.top;
      const screenshotsH = ctx.slot.height;
      const rail = document.createElement("div");
      rail.className = "tl-screenshot-rail";
      rail.style.top = screenshotsTop + "px";
      rail.style.height = screenshotsH + "px";
      host.appendChild(rail);
      const railLabel = document.createElement("div");
      railLabel.className = "tl-rail-label";
      railLabel.style.top = (screenshotsTop + screenshotsH / 2 - 5) + "px";
      railLabel.textContent = "CAPTURES";
      host.appendChild(railLabel);
      const markY = screenshotsTop + (screenshotsH - 16) / 2;
      const camSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="3" y="3" width="18" height="18" rx="2"/>'
        + '<circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L6 21"/></svg>';
      for (const ev of evs) {
        if (ev.type !== "system") continue;
        if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
        const t = new Date(ev.timestamp).getTime();
        const x = ((t - first) / span) * 100;
        const dot = document.createElement("div");
        dot.className = "tl-screenshot";
        dot.style.left = "calc(" + x + "% - 8px)";
        dot.style.top = markY + "px";
        dot.innerHTML = camSvg;
        dot.title = ev.data.kind + " - " + new Date(t).toLocaleTimeString() +
          "\n" + (ev.data.path || "");
        dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
        if (ev.data.path) {
          dot.addEventListener("mouseenter", () => showScreenshotThumb(dot, ev.data.path));
          dot.addEventListener("mouseleave", () => hideScreenshotThumb());
        }
        host.appendChild(dot);
      }
    },
  };

  // ===== Density histogram lane =====
  // Bucket events into ~120 bins across the span. Background events
  // (idle_start/end, paused/resumed, recorder_*) are excluded so the
  // histogram reflects user activity, not session bookkeeping. The bucket
  // maths runs inside render() -- it only fires when the lane is shown.
  const densityLane = {
    key: "density",
    height: densityH,
    gapBefore: screenshotsH ? 6 : 4,
    render(host, ctx) {
      const densityTop = ctx.slot.top;
      const densityH = ctx.slot.height;
      const N_BUCKETS = 120;
      const bucketDur = span / N_BUCKETS;
      const buckets = new Array(N_BUCKETS).fill(0);
      for (const ev of evs) {
        if (!isUserActivityEvent(ev)) continue;
        const idx = Math.min(N_BUCKETS - 1, Math.floor((new Date(ev.timestamp).getTime() - first) / bucketDur));
        if (idx >= 0) buckets[idx] += 1;
      }
      const maxBucket = buckets.reduce((m, v) => v > m ? v : m, 0) || 1;
      for (let i = 0; i < N_BUCKETS; i++) {
        if (!buckets[i]) continue;
        const x = (i / N_BUCKETS) * 100;
        const w = (1 / N_BUCKETS) * 100;
        const h = Math.max(2, Math.round(densityH * (buckets[i] / maxBucket)));
        const bar = document.createElement("div");
        bar.className = "tl-density-bar";
        bar.style.left = x + "%";
        bar.style.width = w + "%";
        bar.style.top = (densityTop + densityH - h) + "px";
        bar.style.height = h + "px";
        bar.title = `${buckets[i]} events @ ` +
          new Date(first + i * bucketDur).toLocaleTimeString();
        host.appendChild(bar);
      }
      // Density baseline (faint background strip so the lane reads even
      // when sparse).
      const densityBaseline = document.createElement("div");
      densityBaseline.className = "tl-density-base";
      densityBaseline.style.top = densityTop + "px";
      densityBaseline.style.height = densityH + "px";
      host.appendChild(densityBaseline);
    },
  };

  // ===== Window-title runs lane (P2.12) =====
  // One band per consecutive (app, title) run. Label only renders when
  // the band is wide enough to fit ~6 chars; otherwise the band is a
  // pure colour stripe so the rhythm of title changes is still visible.
  const titlesLane = {
    key: "titles",
    height: titlesLaneH,
    gapBefore: 4,
    render(host, ctx) {
      const titlesLaneTop = ctx.slot.top;
      // renderLaneStack set host.style.width to the zoomed width before
      // this runs, so host.clientWidth ALREADY reflects the zoomed width.
      // Don't multiply by zoomFactor again -- the band's pixel width is
      // just (w / 100) * hostW.
      const hostW = host.clientWidth || 800;
      const minLabelPx = 50;
      for (const r of _titleRuns) {
        const x = ((r.startMs - first) / span) * 100;
        const w = Math.max(0.05, ((r.endMs - r.startMs) / span) * 100);
        const band = document.createElement("div");
        band.className = "tl-title-band";
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = titlesLaneTop + "px";
        band.title = (r.app || "") + " — " + (r.title || "(untitled)");
        const renderedPx = (w / 100) * hostW;
        if (renderedPx >= minLabelPx) {
          band.textContent = r.title || (r.app || "").replace(/\.exe$/i, "");
        }
        host.appendChild(band);
      }
    },
  };

  // ===== Per-step lane (P1.4) =====
  // Renders a single row of step bands beneath density when steps exist.
  // Click to select the step + jump to Steps view.
  const stepsLane = {
    key: "steps",
    height: stepsLaneH,
    gapBefore: titlesLaneH ? 4 : 0,
    render(host, ctx) {
      const stepsLaneTop = ctx.slot.top;
      for (const s of (lanes.steps ? _stepsForLane : [])) {
        if (!s.time_range || !s.time_range.start || !s.time_range.end) continue;
        const sStart = new Date(s.time_range.start).getTime();
        const sEnd   = new Date(s.time_range.end).getTime();
        if (!isFinite(sStart) || !isFinite(sEnd) || sEnd <= sStart) continue;
        const x = ((sStart - first) / span) * 100;
        const w = Math.max(0.2, ((sEnd - sStart) / span) * 100);
        const band = document.createElement("div");
        band.className = "tl-step-band";
        band.style.left = x + "%";
        band.style.width = w + "%";
        band.style.top = stepsLaneTop + "px";
        band.textContent = s.name || s.step_id || "";
        band.title = (s.name || s.step_id) + " — " + formatDuration(sEnd - sStart);
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          State.setSelectedStepId(s.step_id);
          const stepsBtn = document.querySelector('.view-mode-btn[data-level="steps"]');
          if (stepsBtn) stepsBtn.click();
        });
        host.appendChild(band);
      }
    },
  };

  // ===== Annotation lane (P1.9) =====
  // Numbered note dots beneath the steps lane (or beneath density if no
  // steps). Click to open the note in the side panel + switch to Notes
  // tab.
  const notesLane = {
    key: "notes",
    height: notesLaneH,
    gapBefore: stepsLaneH ? 4 : 0,
    render(host, ctx) {
      const notesLaneTop = ctx.slot.top;
      (lanes.notes ? _notesForLane : []).forEach((n, idx) => {
        if (!n.timestamp) return;
        const ms = new Date(n.timestamp).getTime();
        if (!isFinite(ms)) return;
        const x = ((ms - first) / span) * 100;
        const dot = document.createElement("div");
        dot.className = "tl-note-dot";
        dot.style.left = "calc(" + x + "% - 7px)";
        dot.style.top = notesLaneTop + "px";
        dot.textContent = String(idx + 1);
        dot.dataset.noteIdx = String(idx);
        dot.title = (n.text || "(empty note)").slice(0, 80);
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          activateAnnoTab("notes");
          const noteRow = document.querySelector(`[data-note-idx="${idx}"]`);
          if (noteRow) noteRow.scrollIntoView({ behavior: "smooth", block: "center" });
          seekToTimestamp(n.timestamp);
        });
        host.appendChild(dot);
      });
    },
  };

  // Stack and render every lane through the shared timeline core. The core
  // owns the vertical layout maths, the zoom width, and the minHeight; each
  // lane plugin owns its own DOM. tailPx (14) + the 120 floor reproduce the
  // pre-core host.style.minHeight.
  TimelineCore.renderLaneStack(host, {
    lanes: [ticksLane, casesLane, activityLane, screenshotsLane,
            densityLane, titlesLane, stepsLane, notesLane],
    span: { startMs: first, endMs: last },
    zoom: State.getZoomFactor(),
    tailPx: 14,
    minHeightFloor: 120,
  });

  // Legend mirrors the apps observed while the activity lane rendered.
  renderLegend(observedApps);

  // Playhead overlays all lanes; appended last so it paints on top.
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek on background. P2.9: snap to nearest event when one
  // is within ~250ms / span × pixel-tolerance of the click; else seek
  // to the literal point. Avoids the "click empty space, jump 30 ms
  // before the activity I meant" feel.
  host.addEventListener("click", (e) => {
    if (e.target !== host) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX + host.scrollLeft - rect.left) / rect.width;
    const target = first + frac * span;
    // pixel tolerance scales with zoom: at 1x ~10px tolerance, at higher
    // zoom the same px is fewer ms, so snapping stays "near the cursor"
    // visually rather than "near in wall-clock".
    const pxTol = 10;
    const msTol = Math.max(50, Math.min(500, (pxTol / Math.max(1, host.clientWidth || rect.width)) * span));
    let nearestT = null, nearestDelta = Infinity;
    for (const ev of evs) {
      const t = new Date(ev.timestamp).getTime();
      const d = Math.abs(t - target);
      if (d < nearestDelta) { nearestDelta = d; nearestT = t; }
      if (d > msTol && nearestT != null) break; // events are time-sorted
    }
    const seekT = (nearestT != null && nearestDelta <= msTol) ? nearestT : target;
    seekToTimestamp(new Date(seekT).toISOString());
  });

  // P1.3: refresh minimap to mirror the new timeline content + viewport.
  renderMinimap();
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !State.getSession() || !State.getSession().events.length) return;
  const first = new Date(State.getSession().events[0].timestamp).getTime();
  const last = new Date(State.getSession().events[State.getSession().events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsStartTs = videoStartTs();
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = x + "%";
  ph.style.display = "";
  setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

/* ============ Timeline helpers (lane layout, density)
   ================================================================ */

/* Walk markers, build closed/dangling cases, and assign each to a
   non-overlapping lane. Returns { cases: [...], lanesNeeded }.
   Each case: { startMs, endMs, label, dangling, lane, parent_id, id }. */
function layoutCaseLanes(evs, first, last) {
  const opening = [];   // stack of currently-open cases by depth
  const closed = [];
  let nextId = 0;
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      opening.push({
        id: nextId++,
        startMs: t,
        label: ev.data.label,
        parent_id: opening.length ? opening[opening.length - 1].id : null,
      });
    } else if (ev.data.marker_type === "end" && opening.length) {
      const c = opening.pop();
      c.endMs = t;
      c.dangling = false;
      closed.push(c);
    }
  }
  // Dangling cases: extend to session end.
  for (const c of opening) {
    c.endMs = last;
    c.dangling = true;
    closed.push(c);
  }
  // Lane assignment is delegated to the shared timeline core. Cases stay
  // sorted by start so the returned array order is unchanged; maxLanes is
  // set high enough that cases are never capped (unlike step/phase lanes).
  closed.sort((a, b) => a.startMs - b.startMs);
  const packed = TimelineCore.packLanes(
    closed.map((c) => ({ id: String(c.id), startMs: c.startMs, endMs: c.endMs })),
    { maxLanes: Math.max(1, closed.length), spanMs: Math.max(1, last - first) }
  );
  for (const c of closed) c.lane = packed.laneOf.get(String(c.id)) || 0;
  return { cases: closed, lanesNeeded: packed.laneCount };
}

/* The density histogram counts only events that represent user
   activity, not session bookkeeping (pause/resume, idle starts,
   recorder lifecycle, etc.). */
function isUserActivityEvent(ev) {
  if (ev.type === "activity" || ev.type === "interaction" || ev.type === "marker") return true;
  if (ev.type === "system") {
    const k = ev.data && ev.data.kind;
    if (k === "screenshot" || k === "screenshot_manual") return true;
  }
  return false;
}

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

/* ============ Video helpers ======================================= */

/* The "video start timestamp" -- i.e. the wall clock at video t=0.
   Priority: external-video offset (Teams recording etc.), else OBS's
   recording_start_ts. Returns ISO string or null. */
function videoStartTs() {
  if (!State.getSession()) return null;
  // External video override: session started_at + offsetMs = wall-clock when video t=0.
  if (State.getSession().externalVideoOffsetMs != null && State.getSession().manifest && State.getSession().manifest.started_at) {
    const ms = new Date(State.getSession().manifest.started_at).getTime()
             + Number(State.getSession().externalVideoOffsetMs);
    return new Date(ms).toISOString();
  }
  return (State.getSession().manifest.obs && State.getSession().manifest.obs.recording_start_ts) || null;
}

function formatPlayback(curS, durS) {
  const fmt = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  };
  return fmt(curS) + " / " + (isFinite(durS) ? fmt(durS) : "??:??");
}

function seekToTimestamp(ts) {
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  if (!obsStartTs || !video.src) return;
  const offsetS = (new Date(ts).getTime() - new Date(obsStartTs).getTime()) / 1000;
  if (offsetS < 0) return;
  video.currentTime = offsetS;
  video.play().catch(() => {});
}

/* Steps/Phases detail panel -> Flow view. Switches the active level
   and seeks the video to the start of the step (if a recording is
   linked) or scrolls the Flow timeline playhead there. */
function jumpToStepInFlow(step) {
  if (!step || !step.time_range || !step.time_range.start) return;
  // Switch view-mode bar back to Flow
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  // Seek if we have a recording, else just nudge the playhead to land at the right column
  seekToTimestamp(step.time_range.start);
}

function videoTimeToSessionTs(seconds) {
  const obsStartTs = videoStartTs();
  if (!obsStartTs) return null;
  return new Date(new Date(obsStartTs).getTime() + seconds * 1000).toISOString();
}

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
    tr.addEventListener("click", () => seekToTimestamp(ev.timestamp));
    tbody.appendChild(tr);
    count += 1;
  }
  $("#event-count").textContent = String(count);
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

function renderScreenshots() {
  const host = $("#screenshots-grid");
  host.innerHTML = "";
  const shots = (State.getSession().events || []).filter((e) =>
    e.type === "system" &&
    (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
  // Stash for the gallery (P2.7).
  _allScreenshots = shots;
  if (!shots.length) {
    host.innerHTML = '<p class="hint">No screenshots captured in this session.</p>';
    return;
  }
  for (const s of shots) {
    const card = document.createElement("div");
    card.className = "thumb";
    const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
    if (fs.existsSync(fullPath)) {
      const img = document.createElement("img");
      img.src = "file:///" + fullPath.replace(/\\/g, "/");
      card.appendChild(img);
    }
    const stamp = document.createElement("div");
    stamp.className = "stamp";
    stamp.textContent = s.timestamp.slice(11, 19);
    card.appendChild(stamp);
    if (s.data.kind === "screenshot_manual") {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = "manual";
      card.appendChild(b);
    }
    card.title = s.timestamp + "\n" + s.data.path;
    card.addEventListener("click", () => seekToTimestamp(s.timestamp));
    host.appendChild(card);
  }
}

/* P2.7: full-pane screenshot gallery. Step through every screenshot
   with arrow keys, Esc closes, Space toggles auto-advance (~1.2s),
   filter by trigger reason. Built lazily on first open; keeps a
   single overlay element in the DOM after first build. */
let _allScreenshots = [];
let _galleryState = null;  // { idx, filterReason, playing, playTimer }
function _galleryFilter(reason) {
  // Capture only distinguishes manual screenshots from auto ones today
  // (no reason field on the auto path -- they all come through as
  // kind="screenshot"). Filter accordingly; richer per-trigger
  // distinctions would need a capture-side change to pass `reason`.
  if (!reason || reason === "all") return _allScreenshots.slice();
  return _allScreenshots.filter((s) => {
    const k = s.data.kind || "";
    if (reason === "manual") return k === "screenshot_manual";
    if (reason === "auto")   return k !== "screenshot_manual";
    return true;
  });
}
function openScreenshotGallery() {
  if (!_allScreenshots.length) { toast("No screenshots in this session.", ""); return; }
  let overlay = document.getElementById("screenshot-gallery");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "screenshot-gallery";
    overlay.className = "screenshot-gallery";
    overlay.innerHTML =
      '<div class="screenshot-gallery-header">' +
        '<span class="title">Screenshot gallery</span>' +
        '<select id="gallery-filter">' +
          '<option value="all">All screenshots</option>' +
          '<option value="manual">Manual only</option>' +
          '<option value="auto">Auto only</option>' +
        '</select>' +
        '<button id="gallery-play" type="button" class="link-btn">Play (Space)</button>' +
        '<button id="gallery-close" type="button" class="link-btn">Close (Esc)</button>' +
      '</div>' +
      '<div class="screenshot-gallery-body"><img id="gallery-img" alt="screenshot" /></div>' +
      '<div class="screenshot-gallery-footer">' +
        '<span class="pos" id="gallery-pos">—</span>' +
        '<span class="ts" id="gallery-ts">—</span>' +
        '<span class="reason" id="gallery-reason">—</span>' +
        '<span class="flex-spacer" style="flex:1"></span>' +
        '<span style="color:var(--fg-3);font-size:10px">← / → step · Space play · Esc close · click image to seek video</span>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById("gallery-close").addEventListener("click", closeScreenshotGallery);
    document.getElementById("gallery-play").addEventListener("click", _galleryTogglePlay);
    document.getElementById("gallery-filter").addEventListener("change", (e) => {
      _galleryState.filterReason = e.target.value;
      _galleryState.idx = 0;
      _galleryRenderFrame();
    });
    document.getElementById("gallery-img").addEventListener("click", () => {
      const list = _galleryFilter(_galleryState.filterReason);
      const s = list[_galleryState.idx];
      if (s) seekToTimestamp(s.timestamp);
    });
  }
  _galleryState = { idx: 0, filterReason: "all", playing: false, playTimer: null };
  document.getElementById("gallery-filter").value = "all";
  _galleryRenderFrame();
  document.addEventListener("keydown", _galleryKey);
}
function closeScreenshotGallery() {
  const overlay = document.getElementById("screenshot-gallery");
  if (overlay) overlay.style.display = "none";
  if (_galleryState && _galleryState.playTimer) clearTimeout(_galleryState.playTimer);
  document.removeEventListener("keydown", _galleryKey);
  _galleryState = null;
}
function _galleryRenderFrame() {
  const overlay = document.getElementById("screenshot-gallery");
  overlay.style.display = "flex";
  const list = _galleryFilter(_galleryState.filterReason);
  if (!list.length) {
    document.getElementById("gallery-img").style.display = "none";
    document.getElementById("gallery-pos").textContent = "0 / 0";
    document.getElementById("gallery-ts").textContent = "";
    document.getElementById("gallery-reason").textContent = "(no matching screenshots)";
    return;
  }
  const s = list[_galleryState.idx];
  const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
  const img = document.getElementById("gallery-img");
  img.style.display = "";
  img.src = "file:///" + fullPath.replace(/\\/g, "/");
  document.getElementById("gallery-pos").textContent = `${_galleryState.idx + 1} / ${list.length}`;
  document.getElementById("gallery-ts").textContent = s.timestamp;
  document.getElementById("gallery-reason").textContent =
    s.data.kind === "screenshot_manual" ? "manual" : (s.data.reason || "automatic");
}
function _galleryStep(delta) {
  if (!_galleryState) return;
  const list = _galleryFilter(_galleryState.filterReason);
  if (!list.length) return;
  _galleryState.idx = (_galleryState.idx + delta + list.length) % list.length;
  _galleryRenderFrame();
}
function _galleryTogglePlay() {
  if (!_galleryState) return;
  _galleryState.playing = !_galleryState.playing;
  const btn = document.getElementById("gallery-play");
  if (btn) btn.textContent = _galleryState.playing ? "Pause (Space)" : "Play (Space)";
  if (_galleryState.playing) _galleryAdvance();
  else if (_galleryState.playTimer) { clearTimeout(_galleryState.playTimer); _galleryState.playTimer = null; }
}
function _galleryAdvance() {
  if (!_galleryState || !_galleryState.playing) return;
  _galleryState.playTimer = setTimeout(() => {
    _galleryStep(1);
    _galleryAdvance();
  }, 1200);
}
function _galleryKey(e) {
  if (!_galleryState) return;
  if (e.key === "Escape") { e.preventDefault(); closeScreenshotGallery(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); _galleryStep(1); }
  else if (e.key === "ArrowLeft")  { e.preventDefault(); _galleryStep(-1); }
  else if (e.key === " ")          { e.preventDefault(); _galleryTogglePlay(); }
}
(function wireScreenshotGallery() {
  const btn = document.getElementById("btn-open-gallery");
  if (btn) btn.addEventListener("click", openScreenshotGallery);
})();

function openScreenshot(relPath) {
  if (!relPath || !State.getSession()) return;
  const full = path.join(State.getSession().sessionFolder, relPath);
  if (fs.existsSync(full)) Ipc.openExternal(full);
}

function getMarkerEdit(eventId) {
  /* Returns the latest pending edit (e.g. rename) for a given marker
     event_id, or null. Edits live in annotations.json under marker_edits. */
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === eventId) latest = e; // last write wins
  }
  return latest;
}

function effectiveLabel(markerEvent) {
  const edit = getMarkerEdit(markerEvent.event_id);
  if (edit && edit.field === "label") return edit.value;
  return markerEvent.data.label;
}

function isDeletedMarker(eventId) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  return edits.some((e) => e.event_id === eventId && e.op === "delete");
}

function effectiveTimestamp(markerEvent) {
  const edits = (State.getSession().annotations && State.getSession().annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === markerEvent.event_id && e.field === "timestamp") latest = e.value;
  }
  return latest || markerEvent.timestamp;
}

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const allMarkers = (State.getSession().events || []).filter((e) => e.type === "marker");
  if (!allMarkers.length) {
    host.innerHTML = '<p class="hint">No markers fired in this session.</p>';
    return;
  }
  const f = State.getListFilters().marker;
  const query = (f.text || "").toLowerCase();
  const markers = query
    ? allMarkers.filter(m => (effectiveLabel(m) || "").toLowerCase().includes(query)
        || (m.data.reason || "").toLowerCase().includes(query))
    : allMarkers;
  const meta = $("#marker-filter-meta");
  if (meta) meta.textContent = markers.length === allMarkers.length
    ? `${allMarkers.length} markers`
    : `${markers.length} of ${allMarkers.length}`;
  if (!markers.length) {
    host.innerHTML = '<p class="hint">No markers match the filter.</p>';
    return;
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Double-click a Start to rename. Use the row buttons to adjust the timestamp or delete. Edits save to annotations.json; re-run normalization to apply downstream.";
  host.appendChild(hint);
  let depth = 0;
  for (const m of markers) {
    const row = document.createElement("div");
    const deleted = isDeletedMarker(m.event_id);
    row.className = "marker-row " + m.data.marker_type + (deleted ? " deleted" : "");
    if (m.data.marker_type === "end") depth = Math.max(0, depth - 1);
    const lbl = effectiveLabel(m) || "(unlabeled)";
    const editedNote = (getMarkerEdit(m.event_id) || effectiveTimestamp(m) !== m.timestamp)
      ? ' <span class="meta">· edited</span>' : '';
    const deletedNote = deleted ? ' <span class="meta bad">· deleted</span>' : '';
    row.innerHTML =
      '<span class="ts">' + escapeHtml(effectiveTimestamp(m).slice(11, 19)) + '</span>' +
      '<span class="dir">' + (m.data.marker_type === "start" ? "▶" : "■") + '</span>' +
      '<span class="lbl">' + escapeHtml(lbl) +
        (m.data.reason ? ' <span class="meta">(' + escapeHtml(m.data.reason) + ')</span>' : '') +
        editedNote + deletedNote +
      '</span>' +
      '<span class="depth">L' + depth + '</span>' +
      '<span class="marker-actions">' +
        '<button class="icon-btn xs" data-act="adjust" title="Adjust to current video time">◷</button>' +
        '<button class="icon-btn xs" data-act="delete" title="Delete marker (from normalization)">✕</button>' +
      '</span>';
    if (m.data.marker_type === "start") depth += 1;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".marker-actions")) return;
      seekToTimestamp(effectiveTimestamp(m));
    });
    if (m.data.marker_type === "start") {
      row.addEventListener("dblclick", async (e) => {
        if (e.target.closest(".marker-actions")) return;
        const current = effectiveLabel(m) || "";
        const next = await promptModal({ title: "Rename marker", message: "New label", defaultValue: current, okLabel: "Rename" });
        if (next == null || next.trim() === "" || next === current) return;
        await renameMarker(m, next.trim());
      });
    }
    row.querySelector('[data-act="adjust"]').addEventListener("click", () =>
      adjustMarkerToVideoTime(m));
    row.querySelector('[data-act="delete"]').addEventListener("click", () =>
      deleteMarker(m));
    host.appendChild(row);
  }
}

async function adjustMarkerToVideoTime(markerEvent) {
  if (!State.getSession()) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  let newTs;
  if (obsStartTs && video && video.src) {
    newTs = new Date(new Date(obsStartTs).getTime() + (video.currentTime || 0) * 1000).toISOString();
  } else {
    const input = await promptModal({ title: "Adjust marker timestamp", message: "New ISO 8601 timestamp", detail: "e.g., 2026-05-14T09:23:11.482Z", defaultValue: effectiveTimestamp(markerEvent), okLabel: "Save" });
    if (!input) return;
    newTs = input.trim();
  }
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "timestamp",
    value: newTs,
    previous: markerEvent.timestamp,
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'adjust marker timestamp', ["markers", "timeline"]);
  toast("Marker timestamp adjusted", "success");
}

async function deleteMarker(markerEvent) {
  if (!State.getSession()) return;
  const ok = await confirmModal({
    title: "Delete marker?",
    message: `Delete this ${markerEvent.data.marker_type} marker from normalization output?`,
    detail: "Raw events.jsonl is not touched; the delete is recorded in annotations.json. Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    op: "delete",
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno, 'delete marker', ["markers", "timeline"]);
  toast("Marker marked for deletion (re-run normalization)", "success");
}

async function renameMarker(markerEvent, newLabel) {
  if (!State.getSession()) return;
  const anno = State.getSession().annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "label",
    value: newLabel,
    previous: markerEvent.data.label,
    ts: new Date().toISOString(),
  });
  await Ipc.saveAnnotations({
    sessionFolder: State.getSession().sessionFolder,
    annotations: anno,
  });
  State.getSession().annotations = anno;
  renderMarkersList();
  renderTimeline(); // marker labels on the timeline pick up the edit
  toast("Marker renamed (re-run normalization to apply downstream)", "success");
}

/* deps = { renderShortcutsOverlay, rerenderActiveLevel, applyLevel,
   activateTab } -- cross-surface glue kept in renderer.js. Call once
   at boot. */
function initFlowView(deps) {
  renderShortcutsOverlay = deps.renderShortcutsOverlay || (() => {});
  rerenderActiveLevel    = deps.rerenderActiveLevel    || (() => {});
  applyLevel             = deps.applyLevel             || (() => {});
  activateTab            = deps.activateTab            || (() => {});
}

module.exports = {
  initFlowView,
  loadSessionIntoView, renderTimeline, renderMarkersList,
  renderAnnotations, renderSessionPills,
  seekToTimestamp, videoTimeToSessionTs, jumpToStepInFlow,
  activateAnnoTab,
};
