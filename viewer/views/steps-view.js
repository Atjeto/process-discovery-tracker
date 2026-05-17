/*
 * steps-view.js -- the Steps level of the Session view.
 *
 * Owns the step list + detail + mini-timeline rendering, the step
 * filter, all step CRUD (rename / save / split / merge / hide / delete /
 * add-manual / bulk-delete), and the ignored-apps denylist dialog.
 * Cross-surface helpers (ensureAnnoShape, persistAnnotations,
 * videoTimeToSessionTs, jumpToStepInFlow) are injected by renderer.js
 * via initStepsView().
 */

"use strict";

const { $, escapeHtml, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const PdtSteps = require("../step-editor.js");
const PdtPalette = require("../command-palette.js");

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let videoTimeToSessionTs = () => null;
let jumpToStepInFlow = () => {};
let watchStep = () => {};

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

function decorateDrift(steps) {
  const drifts = (State.getSession().annotations && State.getSession().annotations.drift_markers) || [];
  const byStep = {};
  for (const d of drifts) {
    byStep[d.step_id] = d;
  }
  return (steps || []).map(s => byStep[s.step_id] ? { ...s, drift: byStep[s.step_id] } : s);
}

function stepMatchesFilter(s, f, scopeCaseId) {
  if (scopeCaseId && s.case_id !== scopeCaseId) return false;
  if (f.text && !(s.name || "").toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.states && f.states.size > 0) {
    if (!f.states.has(s.state)) return false;
  } else {
    // No explicit state filter: hidden steps stay out of the list by
    // default (they're suppressed noise). The "hidden" chip reveals them.
    if (s.state === "hidden") return false;
  }
  return true;
}

function renderStepsLevel() {
  if (!State.getSession() || !PdtSteps) return;
  const allSteps = decorateDrift((State.getSession().annotations && State.getSession().annotations.steps) || []);
  const f = State.getListFilters().step;
  const filtered = allSteps.filter(s => stepMatchesFilter(s, f, State.getCaseScope()));
  const filteredIds = new Set(filtered.map(s => s.step_id));

  const meta = $("#step-filter-meta");
  if (meta) meta.textContent = filtered.length === allSteps.length
    ? `${allSteps.length} steps`
    : `${filtered.length} of ${allSteps.length}`;
  // Reflect active state chips
  for (const chip of document.querySelectorAll("#step-filter-states .chip")) {
    chip.classList.toggle("active", f.states.has(chip.dataset.state));
  }

  $("#steps-badge").textContent = String(allSteps.length);
  if ($("#steps-pane-count")) $("#steps-pane-count").textContent = String(allSteps.length);
  PdtSteps.renderStepList($("#step-list"), filtered, State.getSelectedStepId(),
    (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
    (sid) => {
      if (State.getMultiSelectedStepIds().has(sid)) State.getMultiSelectedStepIds().delete(sid);
      else State.getMultiSelectedStepIds().add(sid);
      const grpBtn = $("#btn-group-into-phase");
      if (grpBtn) grpBtn.disabled = State.getMultiSelectedStepIds().size < 2;
      const delBtn = $("#btn-delete-selected-steps");
      if (delBtn) delBtn.disabled = State.getMultiSelectedStepIds().size < 2;
      // Re-render so the user sees the multi-selected state -- otherwise
      // Ctrl+click feels broken because nothing visibly changes.
      renderStepsLevel();
    },
    inlineRenameStep,
    State.getMultiSelectedStepIds(),
  );
  const selected = allSteps.find(s => s.step_id === State.getSelectedStepId()) || null;
  PdtSteps.renderStepDetail($("#step-detail"), selected, {
    onSave: saveStep,
    onDelete: deleteStep,
    onSplit: splitStep,
    onMerge: mergeStepWithNext,
    onJumpToFlow: (step) => jumpToStepInFlow(step),
    onWatchStep: (step) => watchStep(step),
    onToggleHide: toggleStepHidden,
    recordingAvailable: !!(State.getSession() && State.getSession().recordingAvailable),
  });
  const span = getSpan();
  if (span) {
    // Mini-timeline keeps the full set as context; non-matching blocks
    // are dimmed via the dimmedIds option so the filter still localises.
    const dimmedIds = new Set();
    for (const s of allSteps) if (!filteredIds.has(s.step_id)) dimmedIds.add(s.step_id);
    PdtSteps.renderStepTimeline($("#timeline-steps"), allSteps,
      State.getSession().events.filter(e => e.type === "interaction"), span, {
        zoom: State.getStepZoom(),
        selectedId: State.getSelectedStepId(),
        dimmedIds,
        onSelect: (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
      });
    const range = $("#steps-timeline-range");
    if (range) {
      const fmt = (ms) => new Date(ms).toLocaleTimeString();
      range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
    }
  }
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
  step.name = newName;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, 'rename step');
  if (advance === "next") {
    const idx = anno.steps.findIndex(s => s.step_id === stepId);
    const nextStep = anno.steps[idx + 1];
    if (nextStep) {
      State.setSelectedStepId(nextStep.step_id);
      renderStepsLevel();
      setTimeout(() => beginRenameOnSelected(), 30);
    }
  }
}

function beginRenameOnSelected() {
  if (!State.getSelectedStepId()) return;
  const row = document.querySelector(`.step-row[data-step-id="${State.getSelectedStepId()}"] .step-name`);
  if (row) {
    const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    row.dispatchEvent(evt);
  }
}

async function saveStep(updatedStep) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  await persistAnnotations(anno, 'save step');
  toast("Step saved", "success");
}

async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  const ok = await confirmModal({
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
  if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
  await persistAnnotations(anno, 'delete step');
  toast("Step deleted", "success");
}

/* Toggle a step's "hidden" state. Hidden steps drop out of the list
   (unless the hidden filter chip is on) and survive re-analyze via
   _merge_steps. The pre-hide state is stashed on `_prev_state` so
   unhiding restores it. */
async function toggleStepHidden(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  if (step.state === "hidden") {
    step.state = step._prev_state || "auto_suggested";
    delete step._prev_state;
    await persistAnnotations(anno, "unhide step");
    toast("Step restored", "success");
  } else {
    step._prev_state = step.state;
    step.state = "hidden";
    if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    toast("Step hidden — reveal via the hidden filter chip", "success");
  }
}

async function splitStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === stepId);
  if (idx < 0) return;
  const s = anno.steps[idx];
  const ids = s.evidence.interaction_event_ids || [];
  if (ids.length < 2) { toast("Need ≥2 interactions to split", "error"); return; }
  const mid = Math.floor(ids.length / 2);
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(State.getSession().events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
  const firstEvents = firstIds.map(id => interMap[id]).filter(Boolean);
  const secondEvents = secondIds.map(id => interMap[id]).filter(Boolean);
  if (!firstEvents.length || !secondEvents.length) { toast("Could not split step", "error"); return; }
  const second = { ...s, step_id: cryptoRandomId(),
    name: s.name + " (split 2)",
    time_range: { start: secondEvents[0].timestamp, end: secondEvents[secondEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: secondIds },
    state: "edited" };
  const first = { ...s, name: s.name + " (split 1)",
    time_range: { start: firstEvents[0].timestamp, end: firstEvents[firstEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: firstIds },
    state: "edited" };
  anno.steps.splice(idx, 1, first, second);
  await persistAnnotations(anno, 'split step');
  toast("Step split", "success");
}

async function mergeStepWithNext(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const sorted = anno.steps.slice().sort((a, b) =>
    (a.time_range && a.time_range.start || "").localeCompare(b.time_range && b.time_range.start || ""));
  const idx = sorted.findIndex(s => s.step_id === stepId);
  if (idx < 0 || idx === sorted.length - 1) { toast("No next step to merge with", "error"); return; }
  const cur = sorted[idx];
  const next = sorted[idx + 1];
  const merged = {
    ...cur,
    name: cur.name + " + " + next.name,
    time_range: { start: cur.time_range.start, end: next.time_range.end },
    evidence: {
      ...cur.evidence,
      interaction_event_ids: [...(cur.evidence.interaction_event_ids || []), ...(next.evidence.interaction_event_ids || [])],
      screenshot_refs: [...(cur.evidence.screenshot_refs || []), ...(next.evidence.screenshot_refs || [])],
    },
    state: "edited",
  };
  anno.steps = anno.steps.filter(s => s.step_id !== cur.step_id && s.step_id !== next.step_id);
  anno.steps.push(merged);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, 'merge steps');
  toast("Steps merged", "success");
}

async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add manual step", message: "Name this step", placeholder: "e.g., Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const video = $("#video");
  const tsNow = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  // Default duration so manual steps render with a non-zero width
  // in the mini-timeline; the analyst can edit the time range later.
  const endTs = new Date(new Date(tsNow).getTime() + 5000).toISOString();
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    time_range: { start: tsNow, end: endTs },
    evidence: { interaction_event_ids: [], screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
    phase_id: null,
  };
  anno.steps.push(step);
  State.setSelectedStepId(step.step_id);
  await persistAnnotations(anno, 'add step');
  toast("Manual step added", "success");
}

/* Bulk-delete the Ctrl+click multi-selection. One confirm for the
   whole set; Ctrl+Z restores. */
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
  anno.steps = anno.steps.filter(s => !idSet.has(s.step_id));
  if (idSet.has(State.getSelectedStepId())) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  await persistAnnotations(anno, "delete " + ids.length + " steps");
  const grpBtn = $("#btn-group-into-phase");
  if (grpBtn) grpBtn.disabled = true;
  const delBtn = $("#btn-delete-selected-steps");
  if (delBtn) delBtn.disabled = true;
  toast(ids.length + " steps deleted", "success");
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
    toast("No interaction data in this session — nothing to filter.", "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal" role="dialog" style="max-width:460px">' +
      '<header class="modal-header"><h2>Ignored apps</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div style="padding:14px 18px">' +
        '<p class="meta" style="margin-top:0">Apps you tick here are left out of step suggestions — useful for OBS, the tracker itself, or anything that isn\'t part of the process you\'re mapping. Saving re-analyzes the session.</p>' +
        '<div id="ia-list" style="max-height:320px;overflow:auto;margin:10px 0"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">' +
          '<button id="ia-cancel">Cancel</button>' +
          '<button id="ia-save" class="primary">Save &amp; re-analyze</button>' +
        '</div>' +
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
    // Settings change -- write directly (not via the undo stack).
    await Ipc.saveAnnotations({
      sessionFolder: State.getSession().sessionFolder,
      annotations: anno,
    });
    close();
    toast(picked.length
      ? "Ignoring " + picked.length + " app(s) — re-analyzing..."
      : "No apps ignored — re-analyzing...", "success");
    // Re-analyze so the step list reflects the new denylist.
    const normBtn = $("#btn-normalize");
    if (normBtn) normBtn.click();
  });
}

/* Wire the Steps surface. deps = { ensureAnnoShape, persistAnnotations,
   videoTimeToSessionTs, jumpToStepInFlow }. Call once at boot. */
function initStepsView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  videoTimeToSessionTs = deps.videoTimeToSessionTs;
  jumpToStepInFlow = deps.jumpToStepInFlow;
  watchStep = deps.watchStep || (() => {});

  // I72: Steps-view commands for the Ctrl+K palette.
  if (PdtPalette) {
    PdtPalette.registerProvider("steps", (q) => {
      const ql = (q || "").toLowerCase();
      const cmds = [
        { type: "command", label: "New manual step", hint: "Steps", run: addManualStep },
        { type: "command", label: "Delete selected steps", hint: "Steps", run: deleteSelectedSteps },
      ];
      return cmds.filter((c) => !ql || c.label.toLowerCase().includes(ql));
    });
  }

  const txt = document.getElementById("step-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().step.text = txt.value.trim();
        renderStepsLevel();
      }, 120);
    });
  }
  const stateGrp = document.getElementById("step-filter-states");
  if (stateGrp) {
    stateGrp.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const st = chip.dataset.state;
      const set = State.getListFilters().step.states;
      if (set.has(st)) set.delete(st); else set.add(st);
      renderStepsLevel();
    });
  }
  if ($("#btn-add-manual-step")) $("#btn-add-manual-step").addEventListener("click", addManualStep);
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
}

module.exports = {
  initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep,
  deleteSelectedSteps, splitStep, mergeStepWithNext,
};
