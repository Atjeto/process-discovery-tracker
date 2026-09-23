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
const Flags = require("../flags.js");

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
    onSplit: splitPhase,
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

/* Split a phase at a step: that step and every step after it (in the
   phase's order) move into a new phase; the steps before it stay. */
async function splitPhase(phaseId, stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase || !Array.isArray(phase.step_ids)) return;
  const idx = phase.step_ids.indexOf(stepId);
  if (idx <= 0) {
    toast("Cannot split at the first step — pick a later one.", "");
    return;
  }
  const moved = phase.step_ids.slice(idx);
  phase.step_ids = phase.step_ids.slice(0, idx);
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  const newPhase = {
    phase_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name: (phase.name || "Phase") + " (part 2)",
    description: "",
    step_ids: moved,
    state: "manually_authored",
    canonical_phase_id: null,
  };
  for (const sid of moved) {
    const s = anno.steps.find(x => x.step_id === sid);
    if (s) s.phase_id = newPhase.phase_id;
  }
  const pidx = anno.phases.findIndex(p => p.phase_id === phaseId);
  anno.phases.splice(pidx + 1, 0, newPhase);
  State.setSelectedPhaseId(newPhase.phase_id);
  await persistAnnotations(anno, "split phase");
  toast("Phase split", "success");
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

/* AM.2: heuristic phase-grouping suggestions. A phase is a run of
   consecutive steps with no idle pause longer than IDLE_GAP_MS between
   them -- one continuous block of work. The analyst sees a preview and
   accepts/rejects the whole set; steps already in a phase are skipped. */
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

  // An idle pause longer than this starts a new phase. The old rule
  // also chained any two steps < 30 s apart regardless of pauses, which
  // on a dense multi-app session merged almost everything into a
  // handful of giant blobs.
  const IDLE_GAP_MS = 120 * 1000;

  // A step's app is the prefix of its name ("TAMBA: Search" -> "TAMBA").
  const appOf = (s) => {
    const nm = String(s.name || "");
    const i = nm.indexOf(":");
    return (i > 0 ? nm.slice(0, i) : nm).trim();
  };

  const groups = [];
  let cur = [steps[0]];
  for (let i = 1; i < steps.length; i++) {
    const prevEnd = steps[i - 1].time_range && steps[i - 1].time_range.end
      ? new Date(steps[i - 1].time_range.end).getTime() : 0;
    const curStart = steps[i].time_range && steps[i].time_range.start
      ? new Date(steps[i].time_range.start).getTime() : 0;
    const gap = (prevEnd && curStart) ? curStart - prevEnd : 0;
    if (gap <= IDLE_GAP_MS) cur.push(steps[i]);
    else { if (cur.length >= 2) groups.push(cur); cur = [steps[i]]; }
  }
  if (cur.length >= 2) groups.push(cur);

  if (!groups.length) {
    toast("No grouping suggestions found — no continuous-work blocks of 2+ steps.", "");
    return;
  }

  // Name a phase after its dominant app, else a sequence number.
  const nameOf = (g, idx) => {
    const counts = new Map();
    for (const s of g) { const a = appOf(s); if (a) counts.set(a, (counts.get(a) || 0) + 1); }
    let best = "", bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return best ? best + " work" : "Work block " + (idx + 1);
  };

  const lines = groups.slice(0, 8).map((g, i) => `  ${i + 1}. ${nameOf(g, i)} — ${g.length} steps`);
  const moreNote = groups.length > 8 ? `\n  …and ${groups.length - 8} more` : "";
  const ok = await confirmModal({
    title: "Apply " + groups.length + " phase grouping" + (groups.length === 1 ? "" : "s") + "?",
    message: `Found ${groups.length} candidate phase${groups.length === 1 ? "" : "s"} from ${steps.length} ungrouped steps.`,
    detail: "Each phase is a run of steps with no idle pause longer than 2 minutes between them — one continuous block of work. Rename, split, or delete them afterwards.\n\n" +
            lines.join("\n") + moreNote,
    okLabel: "Apply all",
  });
  if (!ok) return;

  groups.forEach((g, idx) => {
    const phase = {
      phase_id: cryptoRandomId(),
      session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
      case_id: null,
      name: nameOf(g, idx),
      description: "Auto-suggested by phase grouping (continuous-work blocks).",
      step_ids: g.map((s) => s.step_id),
      state: "auto_suggested",
      canonical_phase_id: null,
    };
    anno.phases.push(phase);
    for (const s of g) {
      const original = anno.steps.find((x) => x.step_id === s.step_id);
      if (original) original.phase_id = phase.phase_id;
    }
  });
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
  // §D3: auto-phase suggestion is OUT of the default flow (a cargo-cult
  // cut, lab-phase spec §1) -- phases come from the Process Template or
  // the analyst's own grouping. The heuristic stays behind a config flag
  // (default off; flags.js); existing sessions with phases render
  // unchanged either way.
  const _suggestBtn = $("#btn-suggest-phases");
  if (_suggestBtn) {
    if (Flags.flagEnabled("autoPhaseSuggest")) {
      _suggestBtn.addEventListener("click", suggestPhaseGroupings);
    } else {
      _suggestBtn.remove();
    }
  }
}

module.exports = {
  initPhasesView, renderPhasesLevel, addManualPhase, groupIntoPhase,
};
