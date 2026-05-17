/*
 * phases-view.js -- the Phases level of the Session view.
 *
 * Owns the phase list + detail + mini-timeline rendering, the phase
 * filter, phase CRUD (save / delete / add-manual / group-from-selection
 * / remove-step / reorder-steps), and the heuristic phase-grouping
 * suggestions. Cross-surface helpers (ensureAnnoShape,
 * persistAnnotations, activateAnnoTab) are injected by renderer.js via
 * initPhasesView().
 */

"use strict";

const { $, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const PdtPhases = require("../phase-editor.js");
const PdtPalette = require("../command-palette.js");

/* Injected by renderer.js. */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let activateAnnoTab = () => {};

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

function phaseMatchesFilter(p, steps, f, scopeCaseId) {
  if (f.text && !(p.name || "").toLowerCase().includes(f.text.toLowerCase())) return false;
  if (scopeCaseId) {
    const contained = (p.step_ids || []).map(sid => steps.find(s => s.step_id === sid)).filter(Boolean);
    if (!contained.some(s => s.case_id === scopeCaseId)) return false;
  }
  return true;
}

function renderPhasesLevel() {
  if (!State.getSession() || !PdtPhases) return;
  const phases = (State.getSession().annotations && State.getSession().annotations.phases) || [];
  const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const f = State.getListFilters().phase;
  const filtered = phases.filter(p => phaseMatchesFilter(p, steps, f, State.getCaseScope()));
  const filteredIds = new Set(filtered.map(p => p.phase_id));

  const meta = $("#phase-filter-meta");
  if (meta) meta.textContent = filtered.length === phases.length
    ? `${phases.length} phases`
    : `${filtered.length} of ${phases.length}`;

  $("#phases-badge").textContent = String(phases.length);
  if ($("#phases-pane-count")) $("#phases-pane-count").textContent = String(phases.length);
  PdtPhases.renderPhaseList($("#phase-list"), filtered, State.getSelectedPhaseId(),
    (pid) => { State.setSelectedPhaseId(pid); renderPhasesLevel(); });
  const selected = phases.find(p => p.phase_id === State.getSelectedPhaseId()) || null;
  PdtPhases.renderPhaseDetail($("#phase-detail"), selected, steps, {
    onSave: savePhase,
    onDelete: deletePhase,
    onRemoveStep: removeStepFromPhase,
    onReorderSteps: reorderStepsInPhase,
  });
  const span = getSpan();
  if (span) {
    const dimmedIds = new Set();
    for (const p of phases) if (!filteredIds.has(p.phase_id)) dimmedIds.add(p.phase_id);
    PdtPhases.renderPhaseTimeline($("#timeline-phases"), phases, steps, span, {
      zoom: State.getPhaseZoom(),
      selectedId: State.getSelectedPhaseId(),
      dimmedIds,
      onSelect: (pid) => { State.setSelectedPhaseId(pid); renderPhasesLevel(); },
    });
    const range = $("#phases-timeline-range");
    if (range) {
      const fmt = (ms) => new Date(ms).toLocaleTimeString();
      range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
    }
  }
}

async function savePhase(updatedPhase) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.phases.findIndex(p => p.phase_id === updatedPhase.phase_id);
  if (idx >= 0) anno.phases[idx] = updatedPhase;
  else anno.phases.push(updatedPhase);
  await persistAnnotations(anno, 'save phase');
  toast("Phase saved", "success");
}

async function deletePhase(phaseId) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  const ok = await confirmModal({
    title: "Delete phase?",
    message: phase ? `Delete phase "${phase.name || "(unnamed)"}"?` : "Delete this phase?",
    detail: "Member steps stay; only the grouping is removed. Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  anno.phases = anno.phases.filter(p => p.phase_id !== phaseId);
  // Detach phase_id from contained steps
  for (const s of anno.steps) if (s.phase_id === phaseId) s.phase_id = null;
  if (State.getSelectedPhaseId() === phaseId) State.setSelectedPhaseId(null);
  await persistAnnotations(anno, 'delete phase');
  toast("Phase deleted", "success");
}

async function removeStepFromPhase(phaseId, stepId) {
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase) return;
  phase.step_ids = (phase.step_ids || []).filter(id => id !== stepId);
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  const s = anno.steps.find(x => x.step_id === stepId);
  if (s) s.phase_id = null;
  await persistAnnotations(anno, 'remove step from phase');
}

/* P2.6: drag-reorder a step within a phase. drag === source step,
   target === drop-target step, before === insert above (vs below). */
async function reorderStepsInPhase(phaseId, dragStepId, targetStepId, before) {
  if (!State.getSession() || !dragStepId || !targetStepId || dragStepId === targetStepId) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase || !Array.isArray(phase.step_ids)) return;
  const ids = phase.step_ids.slice();
  const fromIdx = ids.indexOf(dragStepId);
  if (fromIdx === -1) return;
  ids.splice(fromIdx, 1);
  let toIdx = ids.indexOf(targetStepId);
  if (toIdx === -1) return;
  if (!before) toIdx += 1;
  ids.splice(toIdx, 0, dragStepId);
  phase.step_ids = ids;
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, "reorder steps in phase");
}

async function addManualPhase() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    step_ids: [],
    state: "manually_authored",
    canonical_phase_id: null,
  };
  anno.phases.push(phase);
  State.setSelectedPhaseId(phase.phase_id);
  await persistAnnotations(anno, 'add phase');
  toast("Manual phase added", "success");
}

async function groupIntoPhase() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    step_ids: ids,
    state: "manually_authored",
    canonical_phase_id: null,
  };
  anno.phases.push(phase);
  for (const sid of ids) {
    const s = anno.steps.find(x => x.step_id === sid);
    if (s) s.phase_id = phase.phase_id;
  }
  State.getMultiSelectedStepIds().clear();
  State.setSelectedPhaseId(phase.phase_id);
  await persistAnnotations(anno, 'group steps into phase');
  $("#btn-group-into-phase").disabled = true;
  activateAnnoTab("phases");
  toast("Steps grouped into phase", "success");
}

/* AM.2: heuristic phase-grouping suggestions. Walks the step list and
   produces candidate groupings using two rules:
     1. Consecutive steps from the same app.
     2. Consecutive steps with no gap > GAP_MS between them.
   The analyst sees a preview and accepts/rejects the whole set.
   Steps already assigned to a phase are skipped. */
async function suggestPhaseGroupings() {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const steps = (anno.steps || []).filter((s) => !s.phase_id);
  if (steps.length < 2) {
    toast("Need at least 2 ungrouped steps to suggest groupings.", "");
    return;
  }
  steps.sort((a, b) => {
    const at = a.time_range && a.time_range.start ? new Date(a.time_range.start).getTime() : 0;
    const bt = b.time_range && b.time_range.start ? new Date(b.time_range.start).getTime() : 0;
    return at - bt;
  });
  const GAP_MS = 30 * 1000;
  const groups = [];
  let cur = [steps[0]];
  const eventById = new Map();
  for (const ev of (State.getSession().events || [])) {
    if (ev.event_id) eventById.set(ev.event_id, ev);
  }
  const stepAppCache = new Map();
  function appOf(s) {
    if (stepAppCache.has(s.step_id)) return stepAppCache.get(s.step_id);
    const counts = new Map();
    const evIds = (s.evidence && s.evidence.interaction_event_ids) || [];
    for (const id of evIds) {
      const ev = eventById.get(id);
      const app = ev && ev.data && ev.data.process_name;
      if (app) counts.set(app, (counts.get(app) || 0) + 1);
    }
    if (!counts.size && s.time_range) {
      // Fallback: scan activity events overlapping the step.
      const start = new Date(s.time_range.start).getTime();
      const end = new Date(s.time_range.end).getTime();
      for (const ev of (State.getSession().events || [])) {
        if (ev.type !== "activity") continue;
        const t = new Date(ev.timestamp).getTime();
        if (t < start || t > end) continue;
        const app = ev.data && ev.data.app;
        if (app) counts.set(app, (counts.get(app) || 0) + 1);
      }
    }
    let best = "", bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    const v = best.toLowerCase();
    stepAppCache.set(s.step_id, v);
    return v;
  }
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1], s = steps[i];
    const sameApp = appOf(prev) && appOf(prev) === appOf(s);
    const prevEnd = prev.time_range && prev.time_range.end ? new Date(prev.time_range.end).getTime() : 0;
    const curStart = s.time_range && s.time_range.start ? new Date(s.time_range.start).getTime() : 0;
    const closeInTime = prevEnd && curStart && (curStart - prevEnd) <= GAP_MS;
    if (sameApp || closeInTime) cur.push(s);
    else { if (cur.length >= 2) groups.push(cur); cur = [s]; }
  }
  if (cur.length >= 2) groups.push(cur);

  if (!groups.length) {
    toast("No grouping suggestions found — steps are too varied or sparse.", "");
    return;
  }
  // Build a preview detail string for the confirm modal.
  const lines = groups.slice(0, 8).map((g, i) => {
    const apps = [...new Set(g.map(appOf).filter(Boolean))].join(", ") || "mixed apps";
    return `  ${i + 1}. ${g.length} steps (${apps})`;
  });
  const moreNote = groups.length > 8 ? `\n  …and ${groups.length - 8} more` : "";
  const ok = await confirmModal({
    title: "Apply " + groups.length + " phase grouping" + (groups.length === 1 ? "" : "s") + "?",
    message: `Found ${groups.length} candidate phase${groups.length === 1 ? "" : "s"} from ${steps.length} ungrouped steps.`,
    detail: "Each group bundles consecutive steps that either run in the same app or have no idle gap > 30 seconds between them. Phases are named after the dominant app; rename anytime.\n\n" +
            lines.join("\n") + moreNote,
    okLabel: "Apply all",
  });
  if (!ok) return;
  for (const g of groups) {
    const apps = [...new Set(g.map(appOf).filter(Boolean))];
    const name = apps.length === 1
      ? apps[0].replace(/\.exe$/i, "").replace(/^./, (c) => c.toUpperCase()) + " work"
      : "Mixed-app phase";
    const phase = {
      phase_id: cryptoRandomId(),
      session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
      case_id: null,
      name,
      description: "Auto-suggested by phase grouping heuristics.",
      step_ids: g.map((s) => s.step_id),
      state: "auto_suggested",
      canonical_phase_id: null,
    };
    anno.phases.push(phase);
    for (const s of g) {
      const original = anno.steps.find((x) => x.step_id === s.step_id);
      if (original) original.phase_id = phase.phase_id;
    }
  }
  await persistAnnotations(anno, "auto-group steps into phases");
  toast("Applied " + groups.length + " phase grouping" + (groups.length === 1 ? "" : "s"), "success");
}

/* Wire the Phases surface. deps = { ensureAnnoShape, persistAnnotations,
   activateAnnoTab }. Call once at boot. */
function initPhasesView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  activateAnnoTab = deps.activateAnnoTab;

  const txt = document.getElementById("phase-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().phase.text = txt.value.trim();
        renderPhasesLevel();
      }, 120);
    });
  }
  if ($("#btn-add-manual-phase")) $("#btn-add-manual-phase").addEventListener("click", addManualPhase);
  if ($("#btn-group-into-phase")) $("#btn-group-into-phase").addEventListener("click", groupIntoPhase);
  if ($("#btn-suggest-phases")) $("#btn-suggest-phases").addEventListener("click", suggestPhaseGroupings);

  // I72: Phases-view commands for the Ctrl+K palette.
  if (PdtPalette) {
    PdtPalette.registerProvider("phases", (q) => {
      const ql = (q || "").toLowerCase();
      const cmds = [
        { type: "command", label: "New phase", hint: "Phases", run: addManualPhase },
      ];
      return cmds.filter((c) => !ql || c.label.toLowerCase().includes(ql));
    });
  }
}

module.exports = {
  initPhasesView, renderPhasesLevel, addManualPhase, groupIntoPhase,
};
