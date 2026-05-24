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
const PdtAlign = require("../step-alignment.js");
const PdtPalette = require("../command-palette.js");
const { stepsToTemplateSteps, canonicalSkeleton, slugify } = require("../canonical-author.js");
const { loadVocabs } = require("./identity-picker.js");

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let videoTimeToSessionTs = () => null;
let jumpToStepInFlow = () => {};
let watchStep = () => {};
let openCanonicalInTemplateTab = () => {};

/* A2: the analyst-chosen split boundary for the currently-selected step --
   { stepId, index } where index means "split AFTER this interaction". Null
   index when no boundary is picked (Split then falls back to the midpoint). */
let _splitAfter = { stepId: null, index: null };

/* ADR-0015: the Steps list has two readings. Flat (default) is the
   chronological step list; Aligned is the consensus backbone across the
   detected cases (curate one -> apply to all). _alignSelIndex is the selected
   backbone position in aligned mode; null means an exception/instance step is
   selected instead (its per-instance editor shows, keyed on getSelectedStepId). */
let _alignMode = false;
let _alignSelIndex = null;

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

/* Decision 1: tag each step with how many cases (tickets) it recurs in, so
   the detail can offer "apply to all". `_repeat` is the case span and drives
   the propagate action. P0.3: the LIST badge is shown only when the repetition
   DISCRIMINATES -- the step recurs across some but not all cases. A step in
   *every* case is the uniform backbone (on 5 identical demo cases every step
   would read "5×" -- zero signal), so it gets no badge even though the
   propagate action stays available. A step in only one case gets no tag. */
function decorateRepeats(steps, interactionsById) {
  const { caseCount, groups } = PdtAlign.alignSteps(steps, interactionsById);
  const span = new Map();
  for (const g of groups) for (const m of g.members) span.set(m.stepId, g.caseSpan);
  return (steps || []).map(s => {
    if (!span.has(s.step_id)) return s;
    const caseSpan = span.get(s.step_id);
    return { ...s, _repeat: caseSpan, _repeatCaseCount: caseCount,
      _repeatDiscriminating: caseSpan < caseCount };
  });
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
  const interactionsById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") interactionsById[ev.event_id] = ev;
  }
  // Decorate with drift markers, then intra-session repeat counts (a step that
  // recurs across anchor-detected cases is the high-value "curate once" target).
  const allSteps = decorateRepeats(
    decorateDrift((State.getSession().annotations && State.getSession().annotations.steps) || []),
    interactionsById);

  // Consume a pending step-jump request from a Flow seek: focus on the
  // step containing the requested timestamp. Scrolled into view at the
  // end of this function so the row exists in the DOM.
  const pendingTs = State.consumePendingStepJump();
  if (pendingTs) {
    const targetMs = new Date(pendingTs).getTime();
    if (isFinite(targetMs) && allSteps.length) {
      // Prefer a step that contains the timestamp; fall back to the
      // closest by nearest edge so a right-click in a gap between
      // steps still focuses a step instead of doing nothing visible.
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
  // A3: surface analyst flag counts so marking a step visibly counts.
  const sumEl = $("#steps-summary");
  if (sumEl) {
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
  // ADR-0015: the aligned reading needs 2+ detected cases. Gate the toggle on
  // that and fall back to flat for a single-case session. The per-step filter
  // (text + state chips) doesn't act on a consensus, so hide it in aligned mode
  // rather than leave a control that does nothing (coherence discipline).
  const distinctCases = new Set(
    ((State.getSession().annotations && State.getSession().annotations.steps) || [])
      .filter(s => s && s.state !== "hidden" && s.case_id).map(s => s.case_id));
  const canAlign = distinctCases.size >= 2;
  if (_alignMode && !canAlign) _alignMode = false;
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) {
    alignToggle.style.display = canAlign ? "" : "none";
    for (const b of alignToggle.querySelectorAll("button"))
      b.classList.toggle("active", (b.dataset.mode === "aligned") === _alignMode);
  }
  const listFilterEl = $("#step-list-filter");
  if (listFilterEl) listFilterEl.style.display = _alignMode ? "none" : "";

  if (!_alignMode) {
    // ---- Flat reading: the chronological step list + per-step editor ----
    // P0.4: a one-line key for the repeat badge, shown only when at least one
    // discriminating badge is on screen (otherwise the legend is just noise).
    const legendEl = $("#steps-legend");
    if (legendEl) {
      const anyRepeat = allSteps.some(s => s._repeatDiscriminating);
      legendEl.innerHTML = anyRepeat
        ? '<span class="step-repeat">N×</span> = recurs in some (not all) cases — curate one, then "Apply to repeats"'
        : "";
      legendEl.style.display = anyRepeat ? "" : "none";
    }
    PdtSteps.renderStepList($("#step-list"), filtered, State.getSelectedStepId(),
      (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
      (sid) => {
        if (State.getMultiSelectedStepIds().has(sid)) State.getMultiSelectedStepIds().delete(sid);
        else State.getMultiSelectedStepIds().add(sid);
        syncMultiSelectButtons();
        // Re-render so the user sees the multi-selected state -- otherwise
        // Ctrl+click feels broken because nothing visibly changes.
        renderStepsLevel();
      },
      inlineRenameStep,
      State.getMultiSelectedStepIds(),
      reorderStep,
    );
    const selected = allSteps.find(s => s.step_id === State.getSelectedStepId()) || null;
    PdtSteps.renderStepDetail($("#step-detail"), selected, stepDetailCallbacks(selected, interactionsById));
  } else {
    // ---- Aligned reading: the consensus backbone across detected cases ----
    renderAlignedReading(interactionsById);
  }
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
        onContextMenu: (sid, x, y) => showStepContextMenu(sid, x, y),
      });
    const range = $("#steps-timeline-range");
    if (range) {
      const fmt = (ms) => new Date(ms).toLocaleTimeString();
      range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
    }
  }
  if (pendingTs && State.getSelectedStepId()) {
    setTimeout(() => {
      const row = document.querySelector('.step-row[data-step-id="' + State.getSelectedStepId() + '"]');
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
}

/* The callbacks the per-step detail editor needs. Factored so both the flat
   reading and the aligned reading's exception editor (ADR-0015 Phase 4) wire the
   same verbs to a selected step. */
function stepDetailCallbacks(selected, interactionsById) {
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
    // Decision 1: how many tickets this step recurs in + the propagate action.
    repeatCount: (selected && selected._repeat) || 0,
    onPropagate: () => { if (selected) propagateStepToGroup(selected.step_id); },
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
  };
}

/* A friendly, stable label per case_id for the aligned reading: the canonical
   marker-enriched label from deriveCases when one exists, else a stable "Case N"
   index (never the opaque case_id hash). Lazy-require flow-view so the
   steps<->flow module cycle resolves at call time, not load time. */
function caseLabeler() {
  let cases = [];
  try { cases = require("./flow-view.js").deriveCases(State.getSession()) || []; } catch (_) { cases = []; }
  const m = {};
  cases.forEach((c, i) => { m[c.id] = (c.label && c.label !== c.id) ? c.label : ("Case " + (i + 1)); });
  return (id) => m[id] || "Case ?";
}

/* ADR-0015 Phase 2-4: render the aligned reading into the Steps list + detail.
   The consensus backbone is computed LIVE from the current annotation steps
   (no persisted template, per VALUE-CHAIN Decision 1), so it tracks analyst
   edits with no re-analyze. A backbone row selected -> the curate/instances
   detail; an exception (or a deselected backbone) -> the per-instance editor. */
function renderAlignedReading(interactionsById) {
  const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const aligned = PdtAlign.alignCases(steps);
  const byId = {};
  for (const s of steps) byId[s.step_id] = s;
  const caseLabel = caseLabeler();

  // P0.4 discipline: an on-screen key for the frequency-pill encoding.
  const legendEl = $("#steps-legend");
  if (legendEl) {
    legendEl.innerHTML = '<span class="bb-freq">n/N</span> = cases (tickets) that include this step — curate one, then Apply to all instances';
    legendEl.style.display = "";
  }

  if (_alignSelIndex == null || _alignSelIndex >= aligned.backbone.length) {
    _alignSelIndex = aligned.backbone.length ? 0 : null;
  }

  PdtSteps.renderBackboneList($("#step-list"), {
    caseCount: aligned.caseCount,
    backbone: aligned.backbone,
    selectedIndex: _alignSelIndex,
    onSelectBackbone: (i) => { _alignSelIndex = i; State.setSelectedStepId(null); renderStepsLevel(); },
  });

  const entry = (_alignSelIndex != null) ? aligned.backbone[_alignSelIndex] : null;
  if (entry) {
    const instances = entry.members.map(m => ({ caseId: m.caseId, caseLabel: caseLabel(m.caseId), step: byId[m.stepId] }));
    const memberSteps = entry.members.map(m => byId[m.stepId]).filter(Boolean);
    const seed = Object.assign({ name: entry.token }, PdtAlign.representativeCuration(memberSteps));
    const idx = _alignSelIndex;
    PdtSteps.renderBackboneDetail($("#step-detail"), entry, {
      caseCount: aligned.caseCount,
      instances,
      seed,
      onJump: (sid) => { const s = byId[sid]; if (s) jumpToStepInFlow(s); },
      onApply: (curated) => applyCurationToBackbone(idx, curated),
    });
  } else {
    PdtSteps.renderBackboneDetail($("#step-detail"), null, {});
  }
}

/* ADR-0015 Phase 3: curate one consensus step -> propagate to ALL its aligned
   instances across cases in ONE annotations write (therefore one Ctrl+Z). Fork
   F2 default = confirmed: the analyst edits the consensus name/description/flags
   then clicks Apply; nothing auto-applies. Re-derives the backbone from the live
   steps so the member set is current at apply time. */
async function applyCurationToBackbone(backboneIndex, curated) {
  if (!State.getSession() || !curated) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const aligned = PdtAlign.alignCases(anno.steps || []);
  const entry = aligned.backbone[backboneIndex];
  if (!entry || !entry.members.length) { toast("No instances to apply to", "error"); return; }
  let applied = 0;
  for (const m of entry.members) {
    const t = (anno.steps || []).find(s => s.step_id === m.stepId);
    if (!t) continue;
    if (curated.name) t.name = curated.name;
    t.description = curated.description || "";
    t.flags = Object.assign({}, t.flags || {}, curated.flags || {});
    t.state = t.state === "manually_authored" ? "manually_authored" : "edited";
    applied++;
  }
  await persistAnnotations(anno, "apply to all instances");   // one write -> one Ctrl+Z
  toast("Applied to " + applied + " instance(s) across cases", "success");
  renderStepsLevel();
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
  _splitAfter = { stepId: null, index: null };
  await persistAnnotations(anno, 'split step');
  toast("Step split", "success");
}

/* "Add step here" from the Flow video playhead -- always adds a step,
   never refuses:
     - playhead inside a step -> split that step at the playhead
       (a boundary inside a step necessarily cuts it in two);
     - playhead in open space -> new step from the playhead to the
       next step's start (or the session end);
     - no steps yet           -> carve the session into "Step 1" /
       "Step 2" at the playhead.
   Distinct from splitStep(), which cuts a selected step at its
   interaction-count midpoint. */
async function addStepAtTimestamp(tsISO) {
  if (!State.getSession()) return;
  const t = new Date(tsISO).getTime();
  if (!isFinite(t)) { toast("Couldn't read the playhead position", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const inter = State.getSession().events.filter(e => e.type === "interaction");
  const interMap = Object.fromEntries(inter.map(e => [e.event_id, e]));
  const evTime = (id) => interMap[id] ? new Date(interMap[id].timestamp).getTime() : NaN;
  const tISO = new Date(t).toISOString();

  // No steps yet: carve the whole session in two at the playhead.
  if (!anno.steps.length) {
    const span = getSpan();
    if (!span) { toast("No events to anchor a step to", "error"); return; }
    const before = inter.filter(e => new Date(e.timestamp).getTime() < t).map(e => e.event_id);
    const after = inter.filter(e => new Date(e.timestamp).getTime() >= t).map(e => e.event_id);
    anno.steps.push(
      makeStep("Step 1", new Date(span.startMs).toISOString(), tISO, before),
      makeStep("Step 2", tISO, new Date(span.endMs).toISOString(), after),
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
    const first = { ...s, time_range: { start: s.time_range.start, end: tISO },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) < t) },
      state: "edited" };
    const second = { ...s, step_id: cryptoRandomId(), name: newName,
      time_range: { start: tISO, end: s.time_range.end },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) >= t) },
      state: "edited" };
    anno.steps.splice(idx, 1, first, second);
    await persistAnnotations(anno, "Add step at playhead");
    toast('Added "' + newName + '"', "success");
    return;
  }

  // Playhead in open space: new step from the playhead to the next boundary.
  const span = getSpan();
  const next = anno.steps
    .filter(s => s.time_range && s.time_range.start)
    .map(s => new Date(s.time_range.start).getTime())
    .filter(ms => ms >= t)
    .sort((a, b) => a - b)[0];
  const endMs = next != null ? next : (span ? span.endMs : t + 5000);
  if (endMs - t <= 0) { toast("A step already starts here"); return; }
  const newName = nextStepName(anno.steps);
  const ids = inter
    .filter(e => { const et = new Date(e.timestamp).getTime(); return et >= t && et < endMs; })
    .map(e => e.event_id);
  anno.steps.push(makeStep(newName, tISO, new Date(endMs).toISOString(), ids));
  await persistAnnotations(anno, "Add step at playhead");
  toast('Added "' + newName + '"', "success");
}

function makeStep(name, startISO, endISO, eventIds) {
  return {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
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

const byStartTime = (a, b) =>
  ((a.time_range && a.time_range.start) || "").localeCompare((b.time_range && b.time_range.start) || "");

/* Fold an ordered list of steps into one. The first step's identity +
   metadata wins; the time range stretches to cover the last; evidence is
   concatenated. Shared by both merge entry points so they cannot diverge. */
function mergeStepObjects(toMerge) {
  const first = toMerge[0];
  const last = toMerge[toMerge.length - 1];
  return {
    ...first,
    name: toMerge.map(s => s.name).join(" + "),
    time_range: { start: first.time_range.start, end: last.time_range.end },
    evidence: {
      ...first.evidence,
      interaction_event_ids: toMerge.flatMap(s => (s.evidence && s.evidence.interaction_event_ids) || []),
      screenshot_refs: toMerge.flatMap(s => (s.evidence && s.evidence.screenshot_refs) || []),
    },
    state: "edited",
  };
}

async function commitMerge(anno, toMerge, undoLabel) {
  const merged = mergeStepObjects(toMerge);
  const mergedIds = new Set(toMerge.map(s => s.step_id));
  anno.steps = anno.steps.filter(s => !mergedIds.has(s.step_id));
  anno.steps.push(merged);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, undoLabel);
  return merged;
}

/* P0.1: merge the clicked step with the chronologically NEXT step -- always,
   regardless of any multi-selection. The selection-aware merge is a separate,
   explicitly-labelled action (mergeSelectedSteps) so one control never does
   two things on hidden state (the "merged the wrong pair" defect). */
async function mergeStepWithNext(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const sorted = anno.steps.slice().sort(byStartTime);
  const idx = sorted.findIndex(s => s.step_id === stepId);
  if (idx < 0) { toast("Step not found", "error"); return; }
  if (idx === sorted.length - 1) { toast("No next step to merge with", "error"); return; }
  const toMerge = [sorted[idx], sorted[idx + 1]];
  await commitMerge(anno, toMerge, 'merge step with next');
  toast('Merged "' + toMerge[0].name + '" + "' + toMerge[1].name + '"', "success");
}

/* P0.1: merge exactly the Ctrl/checkbox multi-selected steps (chronologically
   ordered), the inverse of split for an arbitrary set. Acts on the user's
   actual selection -- never falls back to "next". */
async function mergeSelectedSteps() {
  if (!State.getSession()) return;
  const multi = State.getMultiSelectedStepIds();
  if (!multi || multi.size < 2) { toast("Tick 2+ steps to merge", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const toMerge = anno.steps.filter(s => multi.has(s.step_id)).sort(byStartTime);
  if (toMerge.length < 2) { toast("Select at least two steps to merge", "error"); return; }
  const merged = await commitMerge(anno, toMerge, 'merge selected steps');
  multi.clear();
  syncMultiSelectButtons();
  toast('Merged ' + toMerge.length + ' steps into "' + merged.name + '"', "success");
}

/* Keep the three multi-selection toolbar actions (group / delete / merge) in
   lockstep with the selection size, from one place so they cannot drift. */
function syncMultiSelectButtons() {
  const n = State.getMultiSelectedStepIds().size;
  for (const id of ["btn-group-into-phase", "btn-delete-selected-steps", "btn-merge-selected"]) {
    const b = $("#" + id);
    if (b) b.disabled = n < 2;
  }
}

/* Move a step one slot up/down. The swap is relative to the step's
   neighbour in the *displayed* (filtered) order so it stays intuitive
   when a filter is active, but applied to the underlying anno.steps. */
async function reorderStep(stepId, delta) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const f = State.getListFilters().step;
  const visible = decorateDrift(anno.steps)
    .filter(s => stepMatchesFilter(s, f, State.getCaseScope()));
  const vIdx = visible.findIndex(s => s.step_id === stepId);
  const neighbour = visible[vIdx + delta];
  if (vIdx < 0 || !neighbour) return;
  const i = anno.steps.findIndex(s => s.step_id === stepId);
  const j = anno.steps.findIndex(s => s.step_id === neighbour.step_id);
  if (i < 0 || j < 0) return;
  const tmp = anno.steps[i];
  anno.steps[i] = anno.steps[j];
  anno.steps[j] = tmp;
  await persistAnnotations(anno, 'reorder step');
}

/* Reorder the whole step list chronologically by time_range.start. */
async function sortStepsByTime() {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  if (!anno.steps.length) { toast("No steps to sort", ""); return; }
  anno.steps.sort((a, b) =>
    ((a.time_range && a.time_range.start) || "")
      .localeCompare((b.time_range && b.time_range.start) || ""));
  await persistAnnotations(anno, 'sort steps by time');
  toast("Steps sorted by start time", "success");
}

async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add manual step", message: "Name this step", placeholder: "e.g., Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const video = $("#video");
  let tsNow = videoTimeToSessionTs(video.currentTime);
  if (!tsNow) {
    // No video to anchor to: drop the step at the end of the session's
    // recorded span (after any existing step) rather than wall-clock
    // now, which would land far past the timeline.
    const span = getSpan();
    let anchorMs = span ? span.endMs : Date.now();
    for (const s of anno.steps) {
      const end = s.time_range && s.time_range.end && new Date(s.time_range.end).getTime();
      if (end && end > anchorMs) anchorMs = end;
    }
    tsNow = new Date(anchorMs).toISOString();
  }
  // Default duration so manual steps render with a non-zero width
  // in the mini-timeline; the analyst can edit the time range later.
  const endTs = new Date(new Date(tsNow).getTime() + 5000).toISOString();
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
  syncMultiSelectButtons();
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
    '<div class="modal modal-simple" role="dialog">' +
      '<header class="modal-header"><h2>Ignored apps</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta" style="margin-top:0">Apps you tick here are left out of step suggestions — useful for OBS, the tracker itself, or anything that isn\'t part of the process you\'re mapping. Saving re-analyzes the session.</p>' +
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

/* Turn the current session's annotated steps into a new Process
   Template YAML. Each template step carries the name + description and
   a match rule derived from the step's interactions (canonical-author.js).
   A plain file write -- not routed through saveAnnotationsWithUndo, so
   the annotation undo stack is untouched. */
async function exportStepsAsTemplate() {
  if (!State.getSession()) { toast("Open a session first.", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const steps = (anno.steps || [])
    .filter((s) => s.state !== "hidden")
    .slice()
    .sort((a, b) => ((a.time_range && a.time_range.start) || "")
      .localeCompare((b.time_range && b.time_range.start) || ""));
  if (!steps.length) {
    toast("This session has no steps to export — add or analyze steps first.", "error");
    return;
  }
  const name = await promptModal({
    title: "Export as Process Template",
    message: "Name this process",
    detail: steps.length + " step(s) will be carried over, each with a match rule derived from its interactions.",
    placeholder: "e.g. Customer Onboarding",
    okLabel: "Create template",
  });
  if (!name) return;
  const yaml = require("js-yaml");
  let vocabs = [];
  try { vocabs = await loadVocabs(); } catch (_) { vocabs = []; }
  const tplSteps = stepsToTemplateSteps(steps, State.getSession().events || [], vocabs);
  const content = yaml.dump(canonicalSkeleton(name, tplSteps),
    { lineWidth: 120, noRefs: true, sortKeys: false });
  const r = await Ipc.newCanonicalFile({
    content, suggestedName: slugify(name) || "new-process",
  });
  if (!r) return;
  const withRules = tplSteps.filter((s) => s.match.length).length;
  toast("Process Template created — " + tplSteps.length + " step(s), " +
    withRules + " with a derived match rule", "success");
  const open = await confirmModal({
    title: "Open the new template?",
    message: "Switch to the Process Template tab to review and refine the match rules?",
    okLabel: "Open template",
    cancelLabel: "Stay here",
  });
  if (open) openCanonicalInTemplateTab(r);
}

/* Wire the Steps surface. deps = { ensureAnnoShape, persistAnnotations,
   videoTimeToSessionTs, jumpToStepInFlow, openCanonicalInTemplateTab }.
   Call once at boot. */
function initStepsView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  videoTimeToSessionTs = deps.videoTimeToSessionTs;
  jumpToStepInFlow = deps.jumpToStepInFlow;
  watchStep = deps.watchStep || (() => {});
  if (deps.openCanonicalInTemplateTab) openCanonicalInTemplateTab = deps.openCanonicalInTemplateTab;

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
  if ($("#btn-sort-steps-time")) $("#btn-sort-steps-time").addEventListener("click", sortStepsByTime);
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-merge-selected")) $("#btn-merge-selected").addEventListener("click", mergeSelectedSteps);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);
  if ($("#btn-steps-to-template")) $("#btn-steps-to-template").addEventListener("click", exportStepsAsTemplate);

  // ADR-0015: the Flat / Aligned reading toggle (shown only with 2+ cases).
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) {
    alignToggle.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b) return;
      const next = b.dataset.mode === "aligned";
      if (next === _alignMode) return;
      _alignMode = next;
      _alignSelIndex = next ? 0 : null;
      renderStepsLevel();
    });
  }
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

/* Decision 1: apply this step's name + description + flags to the matching
   steps in the OTHER cases it recurs in -- "curate one ticket, apply to all".
   Alignment is by the value-agnostic structural signature (step-alignment.js). */
async function propagateStepToGroup(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const interactionsById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") interactionsById[ev.event_id] = ev;
  }
  const group = PdtAlign.groupForStep(stepId, anno.steps || [], interactionsById);
  if (!group || group.caseSpan < 2) {
    toast("This step doesn't recur across tickets", "error");
    return;
  }
  const source = (anno.steps || []).find(s => s.step_id === stepId);
  if (!source) return;
  let applied = 0;
  for (const m of group.members) {
    if (m.stepId === stepId) continue;
    const t = (anno.steps || []).find(s => s.step_id === m.stepId);
    if (!t) continue;
    t.name = source.name;
    t.description = source.description;
    t.flags = { ...(source.flags || {}) };
    t.state = t.state === "manually_authored" ? "manually_authored" : "edited";
    applied++;
  }
  await persistAnnotations(anno, "apply step to repeats");
  toast("Applied to " + applied + " matching step(s) in other tickets", "success");
  renderStepsLevel();
}

/* A5: right-click context menu for a step block in the Step timeline.
   Mirrors the inline-styled menu pattern used by the Flow timeline
   (flow-view.js showMarkerInsertMenu) for visual consistency. */
function showStepContextMenu(stepId, x, y) {
  const prior = document.getElementById("step-ctx-menu");
  if (prior) prior.remove();
  const session = State.getSession();
  const anno = session && session.annotations;
  const step = anno && (anno.steps || []).find(s => s.step_id === stepId);
  if (!step) return;
  State.setSelectedStepId(stepId);

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

  // Decision 1: "apply to repeats" when this step recurs across cases.
  const _interById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") _interById[ev.event_id] = ev;
  }
  const _grp = PdtAlign.groupForStep(stepId, (anno.steps || []), _interById);
  if (_grp && _grp.caseSpan > 1) {
    addSep();
    addItem("Apply name + flags to " + (_grp.caseSpan - 1) + " repeat(s)",
      () => propagateStepToGroup(stepId));
  }

  document.body.appendChild(menu);
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
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
};
