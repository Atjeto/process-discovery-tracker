/*
 * Viewer renderer -- session + aggregate surfaces glued together.
 *
 * Depends on globals exposed by sibling scripts loaded earlier in
 * index.html:
 *   window.PdtCharts (charts.js)
 *   window.PdtDfg    (dfg-viewer.js, cytoscape)
 *   window.PdtBpmn   (bpmn-viewer.js, bpmn-js)
 */

"use strict";

const { ipcRenderer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentSession = null;
let aggregateSessions = [];

/* ============ Toast =============================================== */

let toastTimer = null;
function toast(text, kind) {
  const el = $("#toast");
  el.textContent = text;
  el.className = "toast show" + (kind ? " " + kind : "");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

/* ============ Recent sessions (localStorage) ====================== */

const RECENT_KEY = "pdt.recentSessions";
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (_) { return []; }
}
function pushRecent(sessionFolder, label) {
  let list = getRecent().filter((r) => r.folder !== sessionFolder);
  list.unshift({ folder: sessionFolder, label, ts: Date.now() });
  list = list.slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecent();
}
function renderRecent() {
  const host = $("#recent-list-session");
  if (!host) return;
  const list = getRecent();
  if (!list.length) {
    host.innerHTML = '<li style="cursor:default;background:transparent;border:none;color:var(--fg-4)">No recent sessions yet.</li>';
    return;
  }
  host.innerHTML = list.map((r) =>
    '<li data-folder="' + escapeHtml(r.folder) + '">' +
      '<span class="label">' + escapeHtml(r.label || path.basename(r.folder)) + '</span>' +
      '<span class="when">' + relTime(r.ts) + '</span>' +
    '</li>'
  ).join("");
  host.querySelectorAll("li[data-folder]").forEach((li) => {
    li.addEventListener("click", () => loadSessionIntoView(li.dataset.folder));
  });
}
function relTime(ms) {
  const dMs = Date.now() - ms;
  const m = Math.round(dMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

/* ============ Tabs ================================================ */

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.view));
});
function activateTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  // Trigger lazy re-fit of any active viz
  if (name === "aggregate") {
    setTimeout(() => {
      if (window.PdtBpmn) window.PdtBpmn.fit();
      if (window.PdtDfg) window.PdtDfg.fit();
    }, 100);
  }
  if (name === "vocabularies") {
    reloadVocabList();
  }
}

/* ============ Session view-mode switcher (Flow / Steps / Phases) ===
   The view-mode bar at the top of the loaded session swaps between
   three top-level layouts:
     #session-layout-flow    - video + timeline + annotations
     #session-layout-steps   - full-width step editor with timeline band
     #session-layout-phases  - full-width phase editor with timeline band
   This is a much bigger change than the original "toggle which timeline
   strip is visible" approach because users couldn't find the cramped
   editor inside the narrow annotations panel. */

let currentLevel = "flow";
let selectedStepId = null;
let multiSelectedStepIds = new Set();
let selectedPhaseId = null;

$$(".view-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".view-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    setLevel(btn.dataset.level);
  });
});

const VIEW_MODE_HELP = {
  flow:   "Flow view: video, raw event timeline, and side panel for notes / screenshots / markers.",
  steps:  "Steps view: rename, split, merge, or flag the logical actions captured in this session.",
  phases: "Phases view: group steps into milestones, or review the phases an auto-match produced.",
};

function setLevel(name) {
  currentLevel = name;
  const layouts = ["flow", "steps", "phases"];
  for (const l of layouts) {
    const el = document.getElementById("session-layout-" + l);
    if (el) el.style.display = l === name ? "" : "none";
  }
  const help = document.getElementById("view-mode-help");
  if (help) help.textContent = VIEW_MODE_HELP[name] || "";
  if (name === "steps")  renderStepsLevel();
  if (name === "phases") renderPhasesLevel();
  if (name === "flow")   renderTimeline();
}

function activateAnnoTab(name) {
  $$(".anno-tab").forEach((t) => t.classList.toggle("active", t.dataset.anno === name));
  $$(".anno-panel").forEach((p) =>
    p.style.display = p.dataset.panel === name ? "" : "none"
  );
}

/* ============ Steps view rendering ================================ */

function getSpan() {
  const evs = (currentSession && currentSession.events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

function decorateDrift(steps) {
  const drifts = (currentSession.annotations && currentSession.annotations.drift_markers) || [];
  const byStep = {};
  for (const d of drifts) {
    byStep[d.step_id] = d;
  }
  return (steps || []).map(s => byStep[s.step_id] ? { ...s, drift: byStep[s.step_id] } : s);
}

function renderStepsLevel() {
  if (!currentSession || !window.PdtSteps) return;
  const steps = decorateDrift((currentSession.annotations && currentSession.annotations.steps) || []);
  $("#steps-badge").textContent = String(steps.length);
  if ($("#steps-pane-count")) $("#steps-pane-count").textContent = String(steps.length);
  window.PdtSteps.renderStepList($("#step-list"), steps, selectedStepId,
    (sid) => { selectedStepId = sid; renderStepsLevel(); },
    (sid) => {
      if (multiSelectedStepIds.has(sid)) multiSelectedStepIds.delete(sid);
      else multiSelectedStepIds.add(sid);
      const btn = $("#btn-group-into-phase");
      if (btn) btn.disabled = multiSelectedStepIds.size < 2;
      // Re-render so the user sees the multi-selected state -- otherwise
      // Ctrl+click feels broken because nothing visibly changes.
      renderStepsLevel();
    },
    inlineRenameStep,
    multiSelectedStepIds,
  );
  const selected = steps.find(s => s.step_id === selectedStepId) || null;
  window.PdtSteps.renderStepDetail($("#step-detail"), selected, {
    onSave: saveStep,
    onDelete: deleteStep,
    onSplit: splitStep,
    onMerge: mergeStepWithNext,
  });
  const span = getSpan();
  if (span) {
    window.PdtSteps.renderStepTimeline($("#timeline-steps"), steps,
      currentSession.events.filter(e => e.type === "interaction"), span);
  }
}

async function inlineRenameStep(stepId, newName, advance) {
  // Special command: "open-next:<id>" means just re-render and trigger
  // the next row's rename without modifying any data.
  if (typeof advance === "string" && advance.startsWith("open-next:")) {
    const nextId = advance.slice("open-next:".length);
    selectedStepId = nextId;
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
    return;
  }
  if (!currentSession || !stepId || !newName) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  step.name = newName;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno);
  renderStepsLevel();
  if (advance === "next") {
    const idx = anno.steps.findIndex(s => s.step_id === stepId);
    const nextStep = anno.steps[idx + 1];
    if (nextStep) {
      selectedStepId = nextStep.step_id;
      renderStepsLevel();
      setTimeout(() => beginRenameOnSelected(), 30);
    }
  }
}

function beginRenameOnSelected() {
  if (!selectedStepId) return;
  const row = document.querySelector(`.step-row[data-step-id="${selectedStepId}"] .step-name`);
  if (row) {
    const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    row.dispatchEvent(evt);
  }
}

async function saveStep(updatedStep) {
  if (!currentSession) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  await persistAnnotations(anno);
  renderStepsLevel();
  toast("Step saved", "success");
}

async function deleteStep(stepId) {
  if (!currentSession) return;
  if (!confirm("Delete this step?")) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
  await persistAnnotations(anno);
  if (selectedStepId === stepId) selectedStepId = null;
  renderStepsLevel();
  toast("Step deleted", "success");
}

async function splitStep(stepId) {
  if (!currentSession) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  const idx = anno.steps.findIndex(s => s.step_id === stepId);
  if (idx < 0) return;
  const s = anno.steps[idx];
  const ids = s.evidence.interaction_event_ids || [];
  if (ids.length < 2) { toast("Need ≥2 interactions to split", "error"); return; }
  const mid = Math.floor(ids.length / 2);
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(currentSession.events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
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
  await persistAnnotations(anno);
  renderStepsLevel();
  toast("Step split", "success");
}

async function mergeStepWithNext(stepId) {
  if (!currentSession) return;
  const anno = ensureAnnoShape(currentSession.annotations);
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
  await persistAnnotations(anno);
  selectedStepId = merged.step_id;
  renderStepsLevel();
  toast("Steps merged", "success");
}

async function addManualStep() {
  if (!currentSession) return;
  const name = await promptModal({ title: "Add manual step", message: "Name this step", placeholder: "e.g., Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const video = $("#video");
  const tsNow = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  const anno = ensureAnnoShape(currentSession.annotations);
  const step = {
    step_id: cryptoRandomId(),
    session_id: (currentSession.manifest && currentSession.manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    time_range: { start: tsNow, end: tsNow },
    evidence: { interaction_event_ids: [], screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
    phase_id: null,
  };
  anno.steps.push(step);
  await persistAnnotations(anno);
  selectedStepId = step.step_id;
  renderStepsLevel();
  toast("Manual step added", "success");
}

if ($("#btn-add-manual-step")) {
  $("#btn-add-manual-step").addEventListener("click", addManualStep);
}

/* ============ Phases view rendering =============================== */

function renderPhasesLevel() {
  if (!currentSession || !window.PdtPhases) return;
  const phases = (currentSession.annotations && currentSession.annotations.phases) || [];
  const steps = (currentSession.annotations && currentSession.annotations.steps) || [];
  $("#phases-badge").textContent = String(phases.length);
  if ($("#phases-pane-count")) $("#phases-pane-count").textContent = String(phases.length);
  window.PdtPhases.renderPhaseList($("#phase-list"), phases, selectedPhaseId,
    (pid) => { selectedPhaseId = pid; renderPhasesLevel(); });
  const selected = phases.find(p => p.phase_id === selectedPhaseId) || null;
  window.PdtPhases.renderPhaseDetail($("#phase-detail"), selected, steps, {
    onSave: savePhase,
    onDelete: deletePhase,
    onRemoveStep: removeStepFromPhase,
  });
  const span = getSpan();
  if (span) {
    window.PdtPhases.renderPhaseTimeline($("#timeline-phases"), phases, steps, span);
  }
}

async function savePhase(updatedPhase) {
  const anno = ensureAnnoShape(currentSession.annotations);
  const idx = anno.phases.findIndex(p => p.phase_id === updatedPhase.phase_id);
  if (idx >= 0) anno.phases[idx] = updatedPhase;
  else anno.phases.push(updatedPhase);
  await persistAnnotations(anno);
  renderPhasesLevel();
  toast("Phase saved", "success");
}

async function deletePhase(phaseId) {
  if (!confirm("Delete this phase?")) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  anno.phases = anno.phases.filter(p => p.phase_id !== phaseId);
  // Detach phase_id from contained steps
  for (const s of anno.steps) if (s.phase_id === phaseId) s.phase_id = null;
  await persistAnnotations(anno);
  if (selectedPhaseId === phaseId) selectedPhaseId = null;
  renderPhasesLevel();
  toast("Phase deleted", "success");
}

async function removeStepFromPhase(phaseId, stepId) {
  const anno = ensureAnnoShape(currentSession.annotations);
  const phase = anno.phases.find(p => p.phase_id === phaseId);
  if (!phase) return;
  phase.step_ids = (phase.step_ids || []).filter(id => id !== stepId);
  phase.state = phase.state === "manually_authored" ? "manually_authored" : "edited";
  const s = anno.steps.find(x => x.step_id === stepId);
  if (s) s.phase_id = null;
  await persistAnnotations(anno);
  renderPhasesLevel();
}

async function addManualPhase() {
  if (!currentSession) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (currentSession.manifest && currentSession.manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    step_ids: [],
    state: "manually_authored",
    canonical_phase_id: null,
  };
  anno.phases.push(phase);
  await persistAnnotations(anno);
  selectedPhaseId = phase.phase_id;
  renderPhasesLevel();
  toast("Manual phase added", "success");
}

async function groupIntoPhase() {
  if (!currentSession) return;
  const ids = Array.from(multiSelectedStepIds);
  if (ids.length < 2) return;
  const name = await promptModal({ title: "Add phase", message: "Name this phase", placeholder: "e.g., Validate customer", okLabel: "Add phase" });
  if (!name) return;
  const anno = ensureAnnoShape(currentSession.annotations);
  const phase = {
    phase_id: cryptoRandomId(),
    session_id: (currentSession.manifest && currentSession.manifest.session_id) || "",
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
  await persistAnnotations(anno);
  multiSelectedStepIds.clear();
  selectedPhaseId = phase.phase_id;
  $("#btn-group-into-phase").disabled = true;
  activateAnnoTab("phases");
  renderPhasesLevel();
  toast("Steps grouped into phase", "success");
}

if ($("#btn-add-manual-phase"))   $("#btn-add-manual-phase").addEventListener("click", addManualPhase);
if ($("#btn-group-into-phase"))   $("#btn-group-into-phase").addEventListener("click", groupIntoPhase);

/* ============ Annotation shape helper ============================ */

function ensureAnnoShape(anno) {
  const a = anno || {};
  a.version = 1;
  a.steps = a.steps || [];
  a.phases = a.phases || [];
  a.annotations = a.annotations || [];
  a.notes = a.notes || [];
  a.marker_edits = a.marker_edits || [];
  a.drift_markers = a.drift_markers || [];
  if (currentSession) a.session_id = (currentSession.manifest && currentSession.manifest.session_id) || a.session_id || "";
  currentSession.annotations = a;
  return a;
}

/* ============ Save App Vocabulary from this session ================ */

async function buildVocabFromSession(suggestedName) {
  if (!currentSession) return;
  const vocabName = suggestedName || prompt("App vocabulary name (e.g., 'Salesforce'):", "");
  if (!vocabName) return;
  const vocabId = vocabName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const r = await ipcRenderer.invoke("viewer:bootstrapAppVocab", {
    sessionFolder: currentSession.sessionFolder,
    vocabId, vocabName,
  });
  if (!r || !r.ok) {
    toast("Vocabulary bootstrap failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  const out = await ipcRenderer.invoke("viewer:saveAppVocab", {
    defaultName: vocabId + ".yaml",
    content: r.yaml,
    /* Default to the shipped vocab dir so the analyst doesn't have to
       hunt for it. Falls back to the user's Documents folder if the
       shipped dir isn't writable (e.g., installed under Program Files). */
    preferAppVocabDir: true,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Saved starter vocabulary - edit the `name:` fields and re-analyze any session.", "success");
  }
}

const btnSaveVocab = $("#btn-save-vocab");
if (btnSaveVocab) {
  btnSaveVocab.addEventListener("click", async () => {
    btnSaveVocab.disabled = true;
    await buildVocabFromSession();
    btnSaveVocab.disabled = false;
  });
}

const btnPrepBootstrap = $("#btn-prep-bootstrap");
if (btnPrepBootstrap) {
  btnPrepBootstrap.addEventListener("click", async () => {
    if (!currentSession) return;
    const m = currentSession.manifest || {};
    const friendly = (m.prep_app || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    btnPrepBootstrap.disabled = true;
    await buildVocabFromSession(friendly || null);
    btnPrepBootstrap.disabled = false;
  });
}

/* ============ Aggregate level switcher ============================ */

let aggregateLevel = "flow";
$$("#agg-level-switcher .agg-level-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#agg-level-switcher .agg-level-btn").forEach((b) => b.classList.toggle("active", b === btn));
    aggregateLevel = btn.dataset.level;
    renderAggregate();
  });
});

/* ============ Canonical view IPC ================================== */

let canonicalState = { path: null, content: null, parsed: null, exemplarFolder: null };

if ($("#btn-open-canonical")) {
  $("#btn-open-canonical").addEventListener("click", async () => {
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    canonicalState.path = r.path;
    canonicalState.content = r.content;
    $("#canonical-yaml").value = r.content;
    $("#canonical-meta").textContent = "Loaded " + r.path;
    $("#btn-save-canonical").disabled = false;
    renderCanonicalStepList();
  });
}
if ($("#btn-save-canonical")) {
  $("#btn-save-canonical").addEventListener("click", async () => {
    if (!canonicalState.path) return;
    const content = $("#canonical-yaml").value;
    await ipcRenderer.invoke("viewer:saveCanonicalFile", { path: canonicalState.path, content });
    canonicalState.content = content;
    toast("Canonical YAML saved", "success");
    renderCanonicalStepList();
  });
}
if ($("#btn-load-exemplar")) {
  $("#btn-load-exemplar").addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
    if (!folder) return;
    canonicalState.exemplarFolder = folder;
    if (canonicalState.path) {
      const r = await ipcRenderer.invoke("viewer:testCanonicalMatch", {
        canonicalPath: canonicalState.path, sessionFolder: folder,
      });
      if (r && r.ok) {
        $("#exemplar-match-rate").textContent =
          "Match rate: " + Math.round((r.match_rate || 0) * 100) + "% (" + r.matched + "/" + r.total + ")";
      }
    }
    $("#btn-promote-from-exemplar").disabled = false;
  });
}

function renderCanonicalStepList() {
  const host = $("#canonical-step-list");
  if (!host) return;
  if (!canonicalState.path) {
    host.innerHTML = `
      <div class="empty-pane">
        <p>No template loaded. Click <strong>Open template YAML...</strong> above.</p>
        <p class="meta">A sample template ships with the tool at <code>normalization/canonical/sample-customer-onboarding-v3.yaml</code> - open it to see how one looks.</p>
      </div>`;
    return;
  }
  // Lightweight YAML parse: count steps by indent-aware regex
  const content = canonicalState.content || "";
  const stepMatches = content.match(/^\s*- step_id:\s*"?([^"\n]+)"?\s*$/gm) || [];
  if (!stepMatches.length) {
    host.innerHTML = '<p class="hint">No steps defined yet. Edit the YAML on the right.</p>';
    return;
  }
  host.innerHTML = stepMatches.map((s) =>
    '<div class="canonical-step-row">' + escapeHtml(s.trim()) + '</div>'
  ).join("");
}

// Render the empty state immediately so the Template tab isn't blank.
if (typeof window !== "undefined") {
  setTimeout(() => renderCanonicalStepList(), 0);
}

/* ============ Step / phase / PDD exports ========================= */

async function exportArtifact(kind) {
  if (!currentSession && !aggregateSessions.length) return;
  const filtered = aggregateSessions.length ? filteredAggregateSessions() : [currentSession];
  if (!filtered.length) return;
  const target = filtered[0];
  // Run normalize with the corresponding --*-out flag against a temp path
  const os = require("os");
  let ext = "bpmn";
  if (kind === "pdd") ext = "docx";
  else if (kind === "step-csv") ext = "csv";
  const tmpPath = path.join(os.tmpdir(), "pdt-export-" + Date.now() + "." + ext);
  const opts = { sessionFolder: target.sessionFolder, mine: false };
  if (kind === "step-bpmn")  opts.stepBpmnOut  = tmpPath;
  if (kind === "phase-bpmn") opts.phaseBpmnOut = tmpPath;
  if (kind === "pdd")        opts.pddOut       = tmpPath;
  if (kind === "step-csv")   opts.stepCsvOut   = tmpPath;
  const r = await ipcRenderer.invoke("viewer:runNormalizeExtended", opts);
  if (!r || !r.ok) { toast("Export failed: " + ((r && r.error) || "unknown"), "error"); return; }
  const suggested = "process." + kind + "." + ext;
  const out = await ipcRenderer.invoke("viewer:exportFile", { sourcePath: tmpPath, suggestedName: suggested });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Exported: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").addEventListener("click", () => exportArtifact("step-bpmn"));
if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").addEventListener("click", () => exportArtifact("phase-bpmn"));
if ($("#btn-export-pdd"))        $("#btn-export-pdd").addEventListener("click", () => exportArtifact("pdd"));
if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").addEventListener("click", () => exportArtifact("step-csv"));


/* ============ Re-normalize to canonical =========================== */

if ($("#btn-renormalize-canonical")) {
  $("#btn-renormalize-canonical").addEventListener("click", async () => {
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    if (!aggregateSessions.length) { toast("Load sessions first", "error"); return; }
    let driftCount = 0;
    for (const s of aggregateSessions) {
      const result = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
        sessionFolder: s.sessionFolder, mine: true, canonical: r.path,
      });
      if (result && result.ok && result.drift_count) driftCount += result.drift_count;
    }
    const folders = aggregateSessions.map((s) => s.sessionFolder);
    aggregateSessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
    aggregateSessions = aggregateSessions.filter((s) => !s.error);
    renderAggregate();
    toast(`Re-normalized; ${driftCount} drift marker(s)`, driftCount ? "warn" : "success");
  });
}

/* ============ Annotation sub-tabs ================================= */

$$(".anno-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".anno-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".anno-panel").forEach((p) =>
      p.style.display = p.dataset.panel === tab.dataset.anno ? "" : "none"
    );
  });
});

/* ============ Map sub-tabs ======================================== */

function setMapZoomVisible(visible) {
  const wrap = document.getElementById("map-zoom");
  if (wrap) wrap.style.display = visible ? "" : "none";
}
function setMapZoomPct(z) {
  const el = document.getElementById("map-zoom-pct");
  if (el) el.textContent = Math.round((z || 1) * 100) + "%";
}

$$(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".panel-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const which = tab.dataset.map;
    $("#bpmn-host").style.display = which === "bpmn" ? "" : "none";
    $("#dfg-host").style.display = which === "dfg" ? "" : "none";
    setMapZoomVisible(which === "dfg");
    setTimeout(() => {
      if (which === "bpmn" && window.PdtBpmn) window.PdtBpmn.fit();
      if (which === "dfg" && window.PdtDfg) {
        window.PdtDfg.fit();
        setMapZoomPct(window.PdtDfg.getZoom());
      }
    }, 50);
  });
});

const btnDfgZoomIn = document.getElementById("btn-dfg-zoom-in");
const btnDfgZoomOut = document.getElementById("btn-dfg-zoom-out");
const btnDfgZoomFit = document.getElementById("btn-dfg-zoom-fit");
if (btnDfgZoomIn) btnDfgZoomIn.addEventListener("click", () => {
  if (window.PdtDfg) { window.PdtDfg.zoomIn(); setMapZoomPct(window.PdtDfg.getZoom()); }
});
if (btnDfgZoomOut) btnDfgZoomOut.addEventListener("click", () => {
  if (window.PdtDfg) { window.PdtDfg.zoomOut(); setMapZoomPct(window.PdtDfg.getZoom()); }
});
if (btnDfgZoomFit) btnDfgZoomFit.addEventListener("click", () => {
  if (window.PdtDfg) { window.PdtDfg.fit(); setMapZoomPct(window.PdtDfg.getZoom()); }
});

/* ============ Session view: open + normalize ====================== */

async function openSessionFlow() {
  const folder = await ipcRenderer.invoke("viewer:openSessionFolder");
  if (!folder) return;
  await loadSessionIntoView(folder);
}

$("#btn-open-session-hero").addEventListener("click", openSessionFlow);
$("#btn-open-session").addEventListener("click", openSessionFlow);

$("#btn-normalize").addEventListener("click", async () => {
  if (!currentSession) return;
  const mine = $("#cb-mine").checked;
  $("#btn-normalize").disabled = true;
  $("#log-host").style.display = "";
  $("#normalize-log").textContent = "";
  // If a Process Template was previously matched, re-use its path automatically.
  const remembered = (currentSession.annotations &&
    currentSession.annotations.matched_against &&
    currentSession.annotations.matched_against.template_path) || null;
  const r = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
    sessionFolder: currentSession.sessionFolder,
    mine,
    canonical: remembered,
  });
  $("#btn-normalize").disabled = false;
  if (!r.ok) {
    $("#normalize-log").textContent += "\nERROR: " + r.error;
    toast("Analysis failed: " + r.error, "error");
    return;
  }
  toast(remembered ? "Re-analyzed with template" : "Analysis complete", "success");
  await loadSessionIntoView(currentSession.sessionFolder);
});

const btnMatchTemplate = $("#btn-match-template");
if (btnMatchTemplate) {
  btnMatchTemplate.addEventListener("click", async () => {
    if (!currentSession) return;
    const r = await ipcRenderer.invoke("viewer:openCanonicalFile");
    if (!r) return;
    btnMatchTemplate.disabled = true;
    $("#btn-normalize").disabled = true;
    $("#log-host").style.display = "";
    $("#normalize-log").textContent = "";
    const mine = $("#cb-mine").checked;
    const result = await ipcRenderer.invoke("viewer:runNormalizeExtended", {
      sessionFolder: currentSession.sessionFolder,
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
      const a = currentSession.annotations || {};
      a.matched_against = a.matched_against || {};
      a.matched_against.template_path = r.path;
      await ipcRenderer.invoke("viewer:saveAnnotations", {
        sessionFolder: currentSession.sessionFolder,
        annotations: a,
      });
    } catch (_) {}
    toast("Matched against Process Template", "success");
    await loadSessionIntoView(currentSession.sessionFolder);
  });
}

ipcRenderer.on("viewer:normalizeLog", (_e, text) => {
  const pre = $("#normalize-log");
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
});

async function loadSessionIntoView(folder) {
  try {
    currentSession = await ipcRenderer.invoke("viewer:loadSession", folder);
  } catch (e) {
    toast("Failed to load: " + (e.message || e), "error");
    return;
  }
  $("#session-empty").style.display = "none";
  $("#session-loaded").style.display = "";
  $("#btn-normalize").disabled = false;
  const label =
    (currentSession.manifest && currentSession.manifest.engagement_id) ||
    path.basename(folder);
  pushRecent(folder, label + " · " + path.basename(folder));

  renderSessionPills();
  // Wire video. Toggle the no-video card explicitly since the
  // sibling-selector CSS only fires when [src] is present.
  const video = $("#video");
  const noVid = $("#no-video");
  const overlay = $("#video-overlay");
  if (currentSession.recordingAvailable && currentSession.recordingPath) {
    video.src = "file:///" + currentSession.recordingPath.replace(/\\/g, "/");
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
  setVideoOverlay(currentSession.recordingAvailable ? "loading…" : "no video");

  renderTimeline();
  renderEventTable();
  renderAnnotations();
  renderScreenshots();
  renderMarkersList();
  renderTimelineSummary();
  // Phase B+ surfaces
  selectedStepId = null;
  selectedPhaseId = null;
  multiSelectedStepIds = new Set();
  if ($("#btn-group-into-phase")) $("#btn-group-into-phase").disabled = true;
  renderStepsLevel();
  renderPhasesLevel();
  updateProcessMapStatus();
}

/* Surface the per-session BPMN output produced by `normalize.py --mine`.
   Reads process_map.bpmn from the loaded session folder, counts flow
   nodes, and exposes Open / Reveal affordances in the actions bar. */
function updateProcessMapStatus() {
  const wrap = document.getElementById("process-map-status");
  if (!wrap) return;
  if (!currentSession || !currentSession.sessionFolder) {
    wrap.style.display = "none";
    return;
  }
  const bpmnPath = path.join(currentSession.sessionFolder, "process_map.bpmn");
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
  // Count BPMN flow nodes (task/event/gateway). Ignore namespace prefix.
  const nodeRe = /<(?:[\w-]+:)?(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|callActivity|subProcess|startEvent|endEvent|intermediateThrowEvent|intermediateCatchEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)\b/g;
  const matches = xml.match(nodeRe) || [];
  const nodeCount = matches.length;
  const detail = document.getElementById("process-map-detail");
  if (detail) detail.textContent = nodeCount + (nodeCount === 1 ? " node" : " nodes");
  wrap.style.display = "";
  wrap.dataset.bpmnPath = bpmnPath;
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
    const err = await ipcRenderer.invoke("viewer:openExternal", p);
    if (err) toast("Could not open: " + err, "error");
  });
  if (reveal) reveal.addEventListener("click", () => {
    const p = currentBpmnPath();
    if (p) ipcRenderer.invoke("viewer:revealFile", p);
  });
})();

function renderSessionPills() {
  const m = currentSession.manifest || {};
  const pills = [];
  pills.push({ label: "events", val: currentSession.events.length, cls: "ok" });
  pills.push({ label: "status", val: m.status || "?",
    cls: m.status === "recovered" ? "warn" : (m.status === "closed" ? "ok" : "") });
  if (m.obs && m.obs.recording_path) pills.push({ label: "video", val: "OBS linked", cls: "ok" });
  else pills.push({ label: "video", val: "no recording" });
  if (currentSession.stats) {
    pills.push({ label: "analyzed", val: "✓", cls: "ok" });
    const meta = currentSession.stats.meta || {};
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
  const editCount = ((currentSession.annotations || {}).marker_edits || []).length;
  if (editCount > 0) pills.push({ label: "edits", val: editCount, cls: "warn" });
  $("#session-pills").innerHTML = pills.map((p) =>
    '<div class="pill' + (p.cls ? " " + p.cls : "") + '"><span class="dot"></span>' +
    '<span class="lbl">' + escapeHtml(p.label) + '</span>' + escapeHtml(String(p.val)) + '</div>'
  ).join("");

  // Show onboarding card until the session is analyzed.
  const onboarding = $("#onboarding-card");
  if (onboarding) {
    onboarding.style.display = currentSession.stats ? "none" : "";
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
    const tmpl = (currentSession.annotations &&
      currentSession.annotations.matched_against &&
      currentSession.annotations.matched_against.template_path);
    if (tmpl) {
      btnMatch.textContent = "Change Process Template...";
      btnMatch.title = "Currently matched against: " + tmpl;
    } else {
      btnMatch.textContent = "Match Process Template...";
      btnMatch.title = "Pick a Process Template YAML and match this session against it.";
    }
  }
}

function setVideoOverlay(text) {
  let o = $("#video-overlay");
  o.textContent = text;
}

/* ============ Timeline ============================================ */

let zoomFactor = 1;

/* Muted per-app color palette. Known apps get fixed assignments so the
   same color is stable across sessions; unknown apps get a deterministic
   slot via a small hash so they stay stable too. All tones desaturated
   to keep the timeline instrument-like (no decorative color). */
const APP_COLOR_MAP = {
  "chrome.exe":   "#5C7080",
  "msedge.exe":   "#5C7080",
  "firefox.exe":  "#5C7080",
  "SAPGUI.exe":   "#807060",
  "saplogon.exe": "#807060",
  "EXCEL.EXE":    "#607868",
  "OUTLOOK.EXE":  "#705C78",
  "winword.exe":  "#6A6878",
  "powerpnt.exe": "#8C6A5C",
  "Teams.exe":    "#5C6A88",
};
const APP_PALETTE = [
  "#5C7080", "#807060", "#607868", "#705C78",
  "#685E58", "#5E6878", "#586E70", "#787058",
];
function _hashAppIdx(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % APP_PALETTE.length;
}
function appColor(app) {
  if (!app) return "#505050";
  if (APP_COLOR_MAP[app]) return APP_COLOR_MAP[app];
  return APP_PALETTE[_hashAppIdx(app.toLowerCase())];
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

$("#btn-zoom-in").addEventListener("click", () => { zoomFactor *= 1.5; renderTimeline(); });
$("#btn-zoom-out").addEventListener("click", () => { zoomFactor = Math.max(1, zoomFactor / 1.5); renderTimeline(); });
$("#btn-zoom-reset").addEventListener("click", () => { zoomFactor = 1; renderTimeline(); });

function renderTimelineSummary() {
  const evs = currentSession.events;
  if (!evs.length) { $("#timeline-summary").textContent = ""; return; }
  const first = new Date(evs[0].timestamp);
  const last = new Date(evs[evs.length - 1].timestamp);
  $("#timeline-summary").textContent =
    first.toLocaleTimeString() + " → " + last.toLocaleTimeString() +
    " · " + formatDuration(last - first);
}

function renderTimeline() {
  const host = $("#timeline");
  host.innerHTML = "";
  const evs = currentSession.events;
  if (!evs.length) return;
  const first = new Date(evs[0].timestamp).getTime();
  const last = new Date(evs[evs.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);

  host.style.width = (100 * zoomFactor) + "%";
  const activityTop = 6;
  const activityH = 70;
  const caseTop = activityH + 24;
  const caseH = 26;
  // height comes from --timeline-height (drag-resizable); set as min-height so content never clips
  host.style.minHeight = Math.max(120, caseTop + caseH + 30) + "px";

  // Activity bands -- coloured per app, with inline title + duration
  // labels so analysts can read the timeline without hovering.
  const observedApps = new Set();
  for (const ev of evs) {
    if (ev.type !== "activity") continue;
    const t = new Date(ev.timestamp).getTime();
    const dur = ev.data.duration_ms || 0;
    const x = ((t - first) / span) * 100;
    const w = Math.max(0.15, (dur / span) * 100);
    const band = document.createElement("div");
    band.className = "tl-band tl-activity";
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = activityTop + "px";
    band.style.height = activityH + "px";
    // Append alpha (AA = ~67%) to keep the muted look while letting
    // inline labels read at full opacity (band opacity would cascade).
    band.style.background = appColor(ev.data.app) + "AA";
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
    host.appendChild(band);
  }
  renderLegend(observedApps);

  // Idle bands
  let idleStart = null;
  for (const ev of evs) {
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
  for (const ev of evs) {
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

  // Screenshot dots (on band bottom edge)
  for (const ev of evs) {
    if (ev.type !== "system") continue;
    if (ev.data.kind !== "screenshot" && ev.data.kind !== "screenshot_manual") continue;
    const t = new Date(ev.timestamp).getTime();
    const x = ((t - first) / span) * 100;
    const dot = document.createElement("div");
    dot.className = "tl-screenshot";
    dot.style.left = "calc(" + x + "% - 3px)";
    dot.style.top = (activityTop + activityH - 4) + "px";
    dot.title = ev.data.kind + " - " + new Date(t).toLocaleTimeString() +
      "\n" + (ev.data.path || "");
    dot.addEventListener("click", (e) => { e.stopPropagation(); openScreenshot(ev.data.path); });
    host.appendChild(dot);
  }

  // Case bands (with nesting)
  const stack = [];
  for (const ev of evs) {
    if (ev.type !== "marker") continue;
    const t = new Date(ev.timestamp).getTime();
    if (ev.data.marker_type === "start") {
      stack.push({ startMs: t, label: ev.data.label, depth: stack.length });
    } else if (ev.data.marker_type === "end" && stack.length) {
      const opened = stack.pop();
      const x = ((opened.startMs - first) / span) * 100;
      const w = Math.max(0.15, ((t - opened.startMs) / span) * 100);
      const band = document.createElement("div");
      band.className = "tl-case-band";
      band.style.left = x + "%";
      band.style.width = w + "%";
      band.style.top = (caseTop + opened.depth * 3) + "px";
      band.style.height = (caseH - opened.depth * 6) + "px";
      band.title = "case: " + (opened.label || "(unlabeled)") +
        "\n" + formatDuration(t - opened.startMs);
      band.addEventListener("click", (e) => {
        e.stopPropagation();
        seekToTimestamp(new Date(opened.startMs).toISOString());
      });
      host.appendChild(band);
      const lbl = document.createElement("div");
      lbl.className = "tl-case-label";
      lbl.style.left = "calc(" + x + "% + 4px)";
      lbl.style.top = (caseTop + opened.depth * 3 + 4) + "px";
      lbl.textContent = opened.label || "(unlabeled)";
      host.appendChild(lbl);
    }
  }
  for (const o of stack) {
    const x = ((o.startMs - first) / span) * 100;
    const w = ((last - o.startMs) / span) * 100;
    const band = document.createElement("div");
    band.className = "tl-case-band dangling";
    band.style.left = x + "%";
    band.style.width = w + "%";
    band.style.top = (caseTop + o.depth * 3) + "px";
    band.style.height = (caseH - o.depth * 6) + "px";
    band.title = "unclosed: " + (o.label || "(unlabeled)");
    host.appendChild(band);
  }

  // Playhead
  const ph = document.createElement("div");
  ph.className = "tl-playhead";
  ph.id = "tl-playhead";
  ph.style.left = "0%";
  ph.style.display = "none";
  host.appendChild(ph);

  // Click->seek on background
  host.addEventListener("click", (e) => {
    if (e.target !== host) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX + host.scrollLeft - rect.left) / rect.width;
    const target = first + frac * span;
    seekToTimestamp(new Date(target).toISOString());
  });
}

function positionPlayhead() {
  const video = $("#video");
  const ph = $("#tl-playhead");
  if (!ph || !currentSession || !currentSession.events.length) return;
  const first = new Date(currentSession.events[0].timestamp).getTime();
  const last = new Date(currentSession.events[currentSession.events.length - 1].timestamp).getTime();
  const span = Math.max(1, last - first);
  const obsStartTs = videoStartTs();
  if (!obsStartTs) { ph.style.display = "none"; return; }
  const playT = new Date(obsStartTs).getTime() + video.currentTime * 1000;
  const x = ((playT - first) / span) * 100;
  ph.style.left = x + "%";
  ph.style.display = "";
  setVideoOverlay(formatPlayback(video.currentTime, video.duration));
}

/* The "video start timestamp" -- i.e. the wall clock at video t=0.
   Priority: external-video offset (Teams recording etc.), else OBS's
   recording_start_ts. Returns ISO string or null. */
function videoStartTs() {
  if (!currentSession) return null;
  // External video override: session started_at + offsetMs = wall-clock when video t=0.
  if (currentSession.externalVideoOffsetMs != null && currentSession.manifest && currentSession.manifest.started_at) {
    const ms = new Date(currentSession.manifest.started_at).getTime()
             + Number(currentSession.externalVideoOffsetMs);
    return new Date(ms).toISOString();
  }
  return (currentSession.manifest.obs && currentSession.manifest.obs.recording_start_ts) || null;
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
  if (!currentSession) return;
  const video = $("#video");
  const obsStartTs = videoStartTs();
  if (!obsStartTs || !video.src) return;
  const offsetS = (new Date(ts).getTime() - new Date(obsStartTs).getTime()) / 1000;
  if (offsetS < 0) return;
  video.currentTime = offsetS;
  video.play().catch(() => {});
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
  for (const ev of currentSession.events) {
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
  const notes = (currentSession.annotations && currentSession.annotations.notes) || [];
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
  if (!currentSession) return;
  const note = $("#anno-note").value.trim();
  if (!note) return;
  const video = $("#video");
  const videoTs = videoTimeToSessionTs(video.currentTime) || new Date().toISOString();
  const anno = currentSession.annotations || { notes: [] };
  anno.notes = anno.notes || [];
  anno.notes.push({
    id: cryptoRandomId(),
    type: "note",
    timestamp: videoTs,
    video_offset_s: video.currentTime || 0,
    text: note,
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
  $("#anno-note").value = "";
  renderAnnotations();
  toast("Note saved", "success");
});

function renderScreenshots() {
  const host = $("#screenshots-grid");
  host.innerHTML = "";
  const shots = (currentSession.events || []).filter((e) =>
    e.type === "system" &&
    (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
  if (!shots.length) {
    host.innerHTML = '<p class="hint">No screenshots captured in this session.</p>';
    return;
  }
  for (const s of shots) {
    const card = document.createElement("div");
    card.className = "thumb";
    const fullPath = path.join(currentSession.sessionFolder, s.data.path);
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

function openScreenshot(relPath) {
  if (!relPath || !currentSession) return;
  const full = path.join(currentSession.sessionFolder, relPath);
  if (fs.existsSync(full)) ipcRenderer.invoke("viewer:openExternal", full);
}

function getMarkerEdit(eventId) {
  /* Returns the latest pending edit (e.g. rename) for a given marker
     event_id, or null. Edits live in annotations.json under marker_edits. */
  const edits = (currentSession.annotations && currentSession.annotations.marker_edits) || [];
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
  const edits = (currentSession.annotations && currentSession.annotations.marker_edits) || [];
  return edits.some((e) => e.event_id === eventId && e.op === "delete");
}

function effectiveTimestamp(markerEvent) {
  const edits = (currentSession.annotations && currentSession.annotations.marker_edits) || [];
  let latest = null;
  for (const e of edits) {
    if (e.event_id === markerEvent.event_id && e.field === "timestamp") latest = e.value;
  }
  return latest || markerEvent.timestamp;
}

function renderMarkersList() {
  const host = $("#markers-list");
  host.innerHTML = "";
  const markers = (currentSession.events || []).filter((e) => e.type === "marker");
  if (!markers.length) {
    host.innerHTML = '<p class="hint">No markers fired in this session.</p>';
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

async function persistAnnotations(anno) {
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
}

async function adjustMarkerToVideoTime(markerEvent) {
  if (!currentSession) return;
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
  const anno = currentSession.annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "timestamp",
    value: newTs,
    previous: markerEvent.timestamp,
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno);
  renderMarkersList();
  renderTimeline();
  toast("Marker timestamp adjusted", "success");
}

async function deleteMarker(markerEvent) {
  if (!currentSession) return;
  if (!confirm(`Delete this ${markerEvent.data.marker_type} marker from normalization output?\n\nRaw events.jsonl is not touched; the delete is recorded in annotations.json.`)) return;
  const anno = currentSession.annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    op: "delete",
    ts: new Date().toISOString(),
  });
  await persistAnnotations(anno);
  renderMarkersList();
  renderTimeline();
  toast("Marker marked for deletion (re-run normalization)", "success");
}

async function renameMarker(markerEvent, newLabel) {
  if (!currentSession) return;
  const anno = currentSession.annotations || { notes: [], marker_edits: [] };
  anno.marker_edits = anno.marker_edits || [];
  anno.marker_edits.push({
    id: cryptoRandomId(),
    event_id: markerEvent.event_id,
    field: "label",
    value: newLabel,
    previous: markerEvent.data.label,
    ts: new Date().toISOString(),
  });
  await ipcRenderer.invoke("viewer:saveAnnotations", {
    sessionFolder: currentSession.sessionFolder,
    annotations: anno,
  });
  currentSession.annotations = anno;
  renderMarkersList();
  renderTimeline(); // marker labels on the timeline pick up the edit
  toast("Marker renamed (re-run normalization to apply downstream)", "success");
}

/* ============ Aggregate view ====================================== */

async function openMultiFlow() {
  const folders = await ipcRenderer.invoke("viewer:openMultipleSessions");
  if (!folders || !folders.length) return;
  const sessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = sessions.filter((s) => !s.error);
  $("#aggregate-empty").style.display = aggregateSessions.length ? "none" : "";
  $("#aggregate-loaded").style.display = aggregateSessions.length ? "" : "none";
  $("#btn-normalize-all").disabled = !aggregateSessions.length;
  renderAggregate();
  if (aggregateSessions.length) {
    toast(`Loaded ${aggregateSessions.length} session(s)`, "success");
  }
}

$("#btn-open-multi-hero").addEventListener("click", openMultiFlow);
$("#btn-open-multi").addEventListener("click", openMultiFlow);

$("#btn-normalize-all").addEventListener("click", async () => {
  if (!aggregateSessions.length) return;
  $("#btn-normalize-all").disabled = true;
  for (const s of aggregateSessions) {
    await ipcRenderer.invoke("viewer:runNormalize", {
      sessionFolder: s.sessionFolder,
      mine: true,
    });
  }
  const folders = aggregateSessions.map((s) => s.sessionFolder);
  aggregateSessions = await ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
  aggregateSessions = aggregateSessions.filter((s) => !s.error);
  renderAggregate();
  $("#btn-normalize-all").disabled = false;
  toast("All sessions normalized + mined", "success");
});

let aggregateFilter = "";
let aggregateFromDate = "";
let aggregateToDate = "";
$("#agg-filter").addEventListener("input", (e) => {
  aggregateFilter = (e.target.value || "").toLowerCase().trim();
  renderAggregate();
});
$("#agg-from").addEventListener("change", (e) => {
  aggregateFromDate = e.target.value || "";
  renderAggregate();
});
$("#agg-to").addEventListener("change", (e) => {
  aggregateToDate = e.target.value || "";
  renderAggregate();
});

function matchesFilter(text) {
  if (!aggregateFilter) return true;
  return String(text || "").toLowerCase().includes(aggregateFilter);
}

function sessionInDateRange(s) {
  /* Use manifest.started_at against [from, to] inclusive when set.
     A session with no started_at is conservatively included. */
  if (!aggregateFromDate && !aggregateToDate) return true;
  const startedAt = (s.manifest || {}).started_at;
  if (!startedAt) return true;
  const day = startedAt.slice(0, 10); // YYYY-MM-DD
  if (aggregateFromDate && day < aggregateFromDate) return false;
  if (aggregateToDate && day > aggregateToDate) return false;
  return true;
}

function filteredAggregateSessions() {
  return aggregateSessions.filter(sessionInDateRange);
}

function renderAggregate() {
  // Pills - count filtered + total
  const filtered = filteredAggregateSessions();
  const numNormalized = filtered.filter((s) => !!s.stats).length;
  const rangeNote = (aggregateFromDate || aggregateToDate)
    ? ` (filtered from ${aggregateSessions.length})` : "";
  $("#aggregate-pills").innerHTML =
    '<div class="pill ok"><span class="dot"></span><span class="lbl">sessions</span>' +
      filtered.length + escapeHtml(rangeNote) + '</div>' +
    '<div class="pill' + (numNormalized === filtered.length && filtered.length ? ' ok' : '') + '">' +
      '<span class="dot"></span><span class="lbl">normalized</span>' +
      numNormalized + ' / ' + filtered.length + '</div>';

  const allStats = filtered.map((s) => s.stats).filter(Boolean);
  if (!allStats.length) {
    $("#map-empty").style.display = "";
    $("#activity-chart").innerHTML = '<div class="chart-empty">no data</div>';
    $("#case-chart").innerHTML = '<div class="chart-empty">no data</div>';
    return;
  }
  $("#map-empty").style.display = "none";

  // Merge activity stats
  const actMap = new Map();
  for (const st of allStats) {
    for (const r of (st.activity_stats || [])) {
      const e = actMap.get(r.activity_label) || {
        activity_label: r.activity_label, frequency: 0, total_duration_ms: 0,
        median_samples: [], p90_samples: [],
      };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      e.median_samples.push(r.median_ms);
      e.p90_samples.push(r.p90_ms);
      actMap.set(r.activity_label, e);
    }
  }
  const actRows = [...actMap.values()]
    .filter((r) => matchesFilter(r.activity_label))
    .sort((a, b) => b.frequency - a.frequency);
  window.PdtCharts.renderBarChart($("#activity-chart"),
    actRows.map((r) => ({
      label: r.activity_label,
      value: r.frequency,
      valueLabel: r.frequency + " · " + window.PdtCharts.fmtDurationS(r.total_duration_ms / 1000),
    })),
    { unit: "" });

  // Case durations: bar chart, active duration with wall-clock overlay
  const caseRows = [];
  for (const st of allStats) {
    for (const r of (st.case_stats || [])) {
      if (r.parent_case_id) continue; // top-level only
      if (!matchesFilter(r.label || r.case_id)) continue;
      caseRows.push({
        label: (r.label || r.case_id.slice(0, 8)),
        value: (r.active_ms || 0) / 1000,
        secondary: (r.wall_clock_ms || 0) / 1000,
        valueLabel: window.PdtCharts.fmtDurationS((r.active_ms || 0) / 1000),
        meta: r,
      });
    }
  }
  caseRows.sort((a, b) => b.value - a.value);
  window.PdtCharts.renderBarChart($("#case-chart"), caseRows, {
    color: "var(--accent-2)",
    secondaryColor: "var(--warn)",
  });

  // Variants table
  const varRows = [];
  for (const st of allStats) {
    for (const v of (st.trace_variants || [])) {
      const variantStr = v.variant.join(" → ");
      if (!matchesFilter(variantStr)) continue;
      varRows.push([v.frequency, v.length, variantStr]);
    }
  }
  varRows.sort((a, b) => b[0] - a[0]);
  fillTable("#variants", varRows.slice(0, 80));

  // Outliers + rework
  const outRows = [];
  for (const st of allStats) {
    for (const r of (st.app_outliers || [])) {
      if (!matchesFilter(r.app)) continue;
      outRows.push([r.app, r.case_count, r.case_pct + "%"]);
    }
  }
  fillTable("#outliers", outRows);
  const reworkRows = [];
  for (const st of allStats) {
    for (const r of (st.rework_loops || [])) {
      if (!matchesFilter(r.activity_label)) continue;
      reworkRows.push([r.activity_label, r.rework_count]);
    }
  }
  fillTable("#rework", reworkRows);

  // BPMN + DFG render from the first available session
  const sessionWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  if (sessionWithBpmn && window.PdtBpmn) {
    window.PdtBpmn.render($("#bpmn-host"),
      path.join(sessionWithBpmn.sessionFolder, "process_map.bpmn"),
      { onNodeClick: (activityLabel) => drillToActivity(activityLabel) });
  }
  // Merge DFG edges across the filtered sessions
  const edgeMap = new Map();
  const starts = new Map();
  const ends = new Map();
  for (const s of filtered) {
    if (!s.dfg) continue;
    for (const e of (s.dfg.edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
    for (const [k, v] of Object.entries(s.dfg.start_activities || {})) {
      starts.set(k, (starts.get(k) || 0) + v);
    }
    for (const [k, v] of Object.entries(s.dfg.end_activities || {})) {
      ends.set(k, (ends.get(k) || 0) + v);
    }
  }
  if (edgeMap.size && window.PdtDfg) {
    const dfg = {
      edges: [...edgeMap.entries()].map(([k, freq]) => {
        const [source, target] = k.split("\x00");
        return { source, target, frequency: freq };
      }),
      start_activities: Object.fromEntries(starts),
      end_activities: Object.fromEntries(ends),
    };
    window.PdtDfg.render($("#dfg-host"), dfg, {
      onNodeClick: (activityLabel) => drillToActivity(activityLabel),
      onZoomChange: (z) => setMapZoomPct(z),
    });
    // Show zoom controls if the DFG tab is currently active
    const dfgTabActive = document.querySelector('.panel-tab.active')?.dataset.map === "dfg";
    setMapZoomVisible(dfgTabActive);
  }

  // Export buttons
  const firstWithBpmn = filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "process_map.bpmn")));
  $("#btn-export-bpmn").disabled = !firstWithBpmn;
  $("#btn-export-xes").disabled = !filtered.find((s) =>
    fs.existsSync(path.join(s.sessionFolder, "events.xes")));
  $("#btn-export-stats").disabled = !allStats.length;
  $("#btn-export-md").disabled = !filtered.length;
  /* Taxonomy promotion is enabled when any normalized session has
     Unclassified activity labels in its stats. */
  $("#btn-export-promotions").disabled = !allStats.some((st) =>
    (st.activity_stats || []).some((r) => /^Unclassified/.test(r.activity_label || "")));

  // Phase E export buttons: enabled when at least one session has step data.
  const haveSteps = filtered.some((s) =>
    (s.annotations && (s.annotations.steps || []).length));
  if ($("#btn-export-bpmn-step"))  $("#btn-export-bpmn-step").disabled  = !haveSteps;
  if ($("#btn-export-bpmn-phase")) $("#btn-export-bpmn-phase").disabled = !haveSteps;
  if ($("#btn-export-pdd"))        $("#btn-export-pdd").disabled        = !haveSteps;
  if ($("#btn-export-step-csv"))   $("#btn-export-step-csv").disabled   = !haveSteps;

  // Version-spread banner
  const versions = new Set();
  for (const s of filtered) {
    const v = ((s.stats || {}).meta || {}).canonical_version;
    if (v != null) versions.add(v);
  }
  const banner = $("#agg-version-spread");
  if (banner) {
    if (versions.size > 1) {
      const latest = Math.max(...[...versions].filter(v => typeof v === "number"));
      banner.style.display = "";
      banner.innerHTML =
        `Loaded sessions span ${versions.size} canonical versions ` +
        `(${[...versions].join(", ")}). Statistics may be inconsistent. ` +
        `<button id="btn-renormalize-to-latest">Re-normalize all to v${latest}</button>`;
      const reBtn = $("#btn-renormalize-to-latest");
      if (reBtn) reBtn.addEventListener("click", () => $("#btn-renormalize-canonical").click());
    } else {
      banner.style.display = "none";
      banner.innerHTML = "";
    }
  }

  // Drift panel
  const driftPanel = $("#drift-panel");
  if (driftPanel) {
    const totalDrift = filtered.reduce((acc, s) =>
      acc + (((s.annotations || {}).drift_markers || []).length), 0);
    if (totalDrift > 0) {
      driftPanel.style.display = "";
      const rateRows = filtered.map((s) => ({
        folder: s.sessionFolder.split(/[\\/]/).pop(),
        match_rate: ((s.stats || {}).meta || {}).match_rate || 0,
        drift: ((s.annotations || {}).drift_markers || []).length,
      }));
      $("#drift-content").innerHTML = `
        <table class="stats-table">
          <thead><tr><th>session</th><th>match rate</th><th>drift markers</th></tr></thead>
          <tbody>
            ${rateRows.map(r => `<tr><td>${escapeHtml(r.folder)}</td>
              <td class="num">${Math.round((r.match_rate || 0) * 100)}%</td>
              <td class="num">${r.drift}</td></tr>`).join("")}
          </tbody>
        </table>`;
    } else {
      driftPanel.style.display = "none";
    }
  }
}

/* ============ Drill-down from aggregate to session ================ */

async function drillToActivity(activityLabel) {
  if (!activityLabel) return;
  // Find the first session whose normalized CSV / events.jsonl
  // contains an activity event with this label. We use the loaded
  // events for the match because activity_label only appears after
  // normalization stamps it; loadSessionData reads stats.json but not
  // the normalized events stream. Simplest: re-read the activity
  // labels from the in-memory raw events plus the session's per-app
  // labels via stats.activity_stats hit list -- but the truest source
  // is to scan each session's events.jsonl by mapping raw app+title to
  // the same classification rules. For v1 we approximate: open the
  // first session that lists this label in its activity_stats, and
  // seek to the first activity event of that app.
  for (const sess of aggregateSessions) {
    const stats = sess.stats;
    if (!stats) continue;
    const hit = (stats.activity_stats || []).find((r) => r.activity_label === activityLabel);
    if (!hit) continue;
    // Switch to session view and load that session
    activateTab("session");
    await loadSessionIntoView(sess.sessionFolder);
    // Find the first activity event whose post-classification label
    // matches. We don't carry activity_label on raw events.jsonl, so
    // fall back to scanning events.csv if present, otherwise pick the
    // first activity event whose app substring matches the label's
    // last segment after "--".
    const target = findFirstActivityByLabel(currentSession, activityLabel);
    if (target) {
      seekToTimestamp(target.timestamp);
      toast("Drilled to " + activityLabel + " in " + sess.sessionFolder.split(/[\\/]/).pop(), "success");
    } else {
      toast("Opened session - couldn't pinpoint timestamp", "");
    }
    return;
  }
  toast("No loaded session contains " + activityLabel, "error");
}

function findFirstActivityByLabel(session, activityLabel) {
  /* Heuristic match: the label format from sample-taxonomy.yaml is
     usually "<Group> -- <App>" or similar. Pull the trailing token
     after "--" and match against event app strings. Best-effort. */
  if (!session || !session.events) return null;
  const tail = (activityLabel.split("--").pop() || "").trim().toLowerCase();
  for (const ev of session.events) {
    if (ev.type !== "activity") continue;
    const app = (ev.data.app || "").toLowerCase();
    const title = (ev.data.title || "").toLowerCase();
    if (tail && (app.includes(tail) || title.includes(tail))) return ev;
  }
  // Fallback: just the first activity event
  return session.events.find((e) => e.type === "activity") || null;
}

/* ============ Exports ============================================= */

$("#btn-export-bpmn").addEventListener("click", () => exportFirst("process_map.bpmn"));
$("#btn-export-xes").addEventListener("click", () => exportFirst("events.xes"));
$("#btn-export-stats").addEventListener("click", () => exportFirst("stats.json"));

$("#btn-export-md").addEventListener("click", async () => {
  if (!window.PdtReport) return;
  const filtered = filteredAggregateSessions();
  if (!filtered.length) return;
  /* Re-merge activity stats and cases across the filtered set so the
     report matches what the panels show. */
  const actMap = new Map();
  for (const s of filtered) {
    for (const r of ((s.stats || {}).activity_stats || [])) {
      const e = actMap.get(r.activity_label) || { activity_label: r.activity_label, frequency: 0, total_duration_ms: 0 };
      e.frequency += r.frequency;
      e.total_duration_ms += r.total_duration_ms;
      actMap.set(r.activity_label, e);
    }
  }
  const mergedActivity = [...actMap.values()].sort((a, b) => b.frequency - a.frequency);
  const mergedCases = [];
  for (const s of filtered) {
    for (const r of ((s.stats || {}).case_stats || [])) {
      if (!r.parent_case_id) mergedCases.push(r);
    }
  }
  mergedCases.sort((a, b) => (b.active_ms || 0) - (a.active_ms || 0));
  const edgeMap = new Map();
  for (const s of filtered) {
    for (const e of ((s.dfg || {}).edges || [])) {
      const k = e.source + "\x00" + e.target;
      edgeMap.set(k, (edgeMap.get(k) || 0) + (e.frequency || 1));
    }
  }
  const dfg = { edges: [...edgeMap.entries()].map(([k, freq]) => {
    const [source, target] = k.split("\x00");
    return { source, target, frequency: freq };
  })};
  const md = window.PdtReport.buildAggregateReport(filtered, mergedActivity, mergedCases, dfg);
  await saveMarkdownReport(md, "aggregate-report.md");
});

$("#btn-session-md").addEventListener("click", async () => {
  if (!currentSession || !window.PdtReport) return;
  const md = window.PdtReport.buildSessionReport(currentSession);
  const name = "session-" + (currentSession.sessionFolder.split(/[\\/]/).slice(-1)[0] || "report") + ".md";
  await saveMarkdownReport(md, name);
});

async function saveMarkdownReport(md, suggestedName) {
  /* Write into a temp file, then ask main.js to copy it via the
     export-file dialog so the user picks the destination. */
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-" + suggestedName);
  fs.writeFileSync(tmpPath, md, "utf-8");
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: tmpPath,
    suggestedName,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Markdown report saved: " + path.basename(out), "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

$("#btn-export-promotions").addEventListener("click", async () => {
  /* Taxonomy promotion (§13). Walk normalized sessions for events
     classified as "Unclassified - <app>". Emit a YAML stub with one
     rule per unique app, ready for the analyst to refine and append
     to the central taxonomy. */
  const filtered = filteredAggregateSessions();
  const apps = new Map(); // app -> { firstTitle, count }
  for (const sess of filtered) {
    for (const ev of (sess.events || [])) {
      if (ev.type !== "activity") continue;
      const label = ev.data.activity_label || "";
      if (!/^Unclassified/.test(label)) continue;
      const app = ev.data.app || "unknown";
      const entry = apps.get(app) || { firstTitle: ev.data.title || "", count: 0 };
      entry.count += 1;
      apps.set(app, entry);
    }
  }
  /* Also include unclassified activity_stats entries (which may be the
     only signal if events aren't loaded for older sessions). */
  for (const sess of filtered) {
    for (const r of (((sess.stats || {}).activity_stats) || [])) {
      if (!/^Unclassified/.test(r.activity_label || "")) continue;
      const app = (r.activity_label.split("-").pop() || "").trim();
      if (!apps.has(app)) apps.set(app, { firstTitle: "", count: r.frequency || 0 });
    }
  }
  if (!apps.size) {
    toast("No Unclassified activities found in the loaded sessions", "");
    return;
  }
  const sorted = [...apps.entries()].sort((a, b) => b[1].count - a[1].count);
  const lines = [
    "# Taxonomy promotion candidates",
    "# Generated by Process Discovery Viewer on " + new Date().toISOString(),
    "# Review and append to the central taxonomy YAML. Edit `label` to taste,",
    "# refine `title_regex` if you want stricter matching, and add `extract` rules where useful.",
    "",
    "rules:",
  ];
  for (const [app, info] of sorted) {
    lines.push("  - match:");
    lines.push("      app: \"" + app.replace(/"/g, "\\\"") + "\"");
    lines.push("      title_regex: \".*\"");
    lines.push("    label: \"TODO - " + app.replace(/"/g, "\\\"") + "\"  # " + info.count + " unclassified events" +
      (info.firstTitle ? "; sample title: " + JSON.stringify(info.firstTitle.slice(0, 60)) : ""));
  }
  const yaml = lines.join("\n") + "\n";
  const tmpDir = require("os").tmpdir();
  const tmpPath = path.join(tmpDir, "pdt-" + Date.now() + "-taxonomy-promotions.yaml");
  fs.writeFileSync(tmpPath, yaml, "utf-8");
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: tmpPath,
    suggestedName: "taxonomy-promotions.yaml",
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast(`Promoted ${sorted.length} app(s) as taxonomy candidates`, "success");
  }
  try { fs.unlinkSync(tmpPath); } catch (_) {}
});

async function exportFirst(filename) {
  const s = aggregateSessions.find((x) =>
    fs.existsSync(path.join(x.sessionFolder, filename)));
  if (!s) return;
  const src = path.join(s.sessionFolder, filename);
  const out = await ipcRenderer.invoke("viewer:exportFile", {
    sourcePath: src,
    suggestedName: filename,
  });
  if (out) {
    await ipcRenderer.invoke("viewer:revealFile", out);
    toast("Exported: " + path.basename(out), "success");
  }
}

/* ============ Keyboard shortcuts ================================== */

document.addEventListener("keydown", (e) => {
  // Esc closes the help modal regardless of focus, since the modal
  // captures itself rather than the input fields beneath it.
  if (e.key === "Escape" && $("#help-modal").style.display !== "none") {
    closeHelp();
    e.preventDefault();
    return;
  }
  // Don't intercept other shortcuts while typing in inputs
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    openHelp();
    e.preventDefault();
    return;
  }
  if (e.key === "1") activateTab("session");
  else if (e.key === "2") activateTab("aggregate");
  else if (e.key === "3") activateTab("canonical");
  else if (e.key === "4") activateTab("vocabularies");
  // Step editor shortcuts (only when on session view and steps panel)
  else if (currentLevel === "steps" && currentSession) {
    const steps = (currentSession.annotations && currentSession.annotations.steps) || [];
    if (e.key === "j" || e.key === "ArrowDown") {
      const idx = steps.findIndex(s => s.step_id === selectedStepId);
      if (idx < steps.length - 1) { selectedStepId = steps[Math.max(0, idx + 1)].step_id; renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "k" || e.key === "ArrowUp") {
      const idx = steps.findIndex(s => s.step_id === selectedStepId);
      if (idx > 0) { selectedStepId = steps[idx - 1].step_id; renderStepsLevel(); e.preventDefault(); }
    } else if (e.key === "n") {
      addManualStep(); e.preventDefault();
    } else if (e.key === "s") {
      if (selectedStepId) { splitStep(selectedStepId); e.preventDefault(); }
    } else if (e.key === "m") {
      if (selectedStepId) { mergeStepWithNext(selectedStepId); e.preventDefault(); }
    }
  }
  else if (e.key === " ") {
    const video = $("#video");
    if (video && video.src) {
      if (video.paused) video.play(); else video.pause();
      e.preventDefault();
    }
  } else if (e.key === "ArrowLeft") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "ArrowRight") {
    const video = $("#video");
    if (video && video.src) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + (e.shiftKey ? 10 : 5));
      e.preventDefault();
    }
  } else if (e.key === "+" || e.key === "=") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor *= 1.5; renderTimeline();
    }
  } else if (e.key === "-" || e.key === "_") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor = Math.max(1, zoomFactor / 1.5); renderTimeline();
    }
  } else if (e.key === "0") {
    if ($("#view-session").classList.contains("active")) {
      zoomFactor = 1; renderTimeline();
    }
  }
});

/* ============ Utilities =========================================== */

function formatDuration(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  if (s < 1) return Math.round(ms) + "ms";
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m" + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m";
}

function fillTable(sel, rows) {
  const tbody = document.querySelector(sel + " tbody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (let i = 0; i < row.length; i++) {
      const td = document.createElement("td");
      if (typeof row[i] === "number" || /^[0-9.]+%?$/.test(String(row[i]))) td.className = "num";
      td.textContent = row[i] != null ? String(row[i]) : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}

/* ============ Help modal ========================================== */

function openHelp(section) {
  $("#help-modal").style.display = "";
  if (section) selectHelpSection(section);
}
function closeHelp() { $("#help-modal").style.display = "none"; }
function selectHelpSection(name) {
  $$(".help-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  $$(".help-section").forEach((s) => s.classList.toggle("active", s.dataset.section === name));
}
$("#btn-help").addEventListener("click", () => openHelp());
/* Inline "What is a step?" / "What is a phase?" links in the toolbar
   open the help modal at the right section. */
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest(".link-help");
  if (!t) return;
  e.preventDefault();
  openHelp(t.dataset.helpSection || "stepsphases");
});
$("#btn-help-close").addEventListener("click", closeHelp);
$$(".help-nav-item").forEach((b) =>
  b.addEventListener("click", () => selectHelpSection(b.dataset.section))
);
$("#help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") closeHelp();
});

/* ============ Boot ================================================ */

renderRecent();
$("#topbar-meta").textContent = "v0.1 · " + new Date().toLocaleDateString();

/* If launched with --session=<path>, the main process pushes the path
   via this channel. Open it without any further user click. */
ipcRenderer.on("viewer:openInitialSession", (_e, folder) => {
  if (folder) loadSessionIntoView(folder);
});

/* ============ Vocabularies tab (form editor, no YAML) ============= */

let vocabState = {
  list: [],
  selectedPath: null,
  current: null,
  dirty: false,
};

async function reloadVocabList() {
  const r = await ipcRenderer.invoke("viewer:listAppVocabs");
  vocabState.list = (r && r.vocabs) || [];
  const meta = $("#vocab-list-meta");
  if (meta) {
    if (vocabState.list.length) {
      meta.textContent = vocabState.list.length + " vocab(s) across " + ((r.dirs || []).length) + " folder(s)";
    } else {
      meta.textContent = "no vocabularies yet";
    }
  }
  renderVocabList();
  if (vocabState.selectedPath && !vocabState.list.some(v => v.path === vocabState.selectedPath)) {
    vocabState.selectedPath = null;
    vocabState.current = null;
    renderVocabEditor();
  } else if (vocabState.selectedPath) {
    await selectVocab(vocabState.selectedPath);
  } else {
    renderVocabEditor();
  }
}

function renderVocabList() {
  const host = $("#vocab-list");
  if (!host) return;
  if (!vocabState.list.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p><strong>No vocabularies yet.</strong></p>' +
      '<p>Two ways to start:</p>' +
      '<ol>' +
      '<li>Click <strong>+ New vocabulary</strong> above to start an empty one.</li>' +
      '<li>Capture a prep session from the tracker tray (<em>Start app vocabulary prep session...</em>), then bootstrap from it.</li>' +
      '</ol>' +
      '</div>';
    return;
  }
  host.innerHTML = "";
  for (const v of vocabState.list) {
    const row = document.createElement("div");
    row.className = "vocab-row" + (v.path === vocabState.selectedPath ? " selected" : "");
    row.innerHTML =
      '<div class="vocab-row-head">' +
      '<span class="vocab-row-name">' + escapeHtml(v.name || v.id) + '</span>' +
      '<span class="vocab-row-count">' + v.interaction_count + '</span>' +
      '</div>' +
      '<div class="vocab-row-meta">' + escapeHtml(v.id) + ' · v' + v.version + ' · ' + escapeHtml(v.file) + '</div>';
    row.addEventListener("click", () => selectVocab(v.path));
    host.appendChild(row);
  }
}

async function selectVocab(p) {
  if (vocabState.dirty) {
    if (!confirm("You have unsaved changes. Discard them?")) return;
  }
  vocabState.selectedPath = p;
  vocabState.dirty = false;
  const v = await ipcRenderer.invoke("viewer:readVocab", p);
  if (!v) {
    vocabState.current = null;
    toast("Could not read vocab file", "error");
  } else if (v._error) {
    vocabState.current = null;
    toast("Vocab YAML parse error: " + v._error, "error");
  } else {
    vocabState.current = v;
  }
  renderVocabList();
  renderVocabEditor();
  const btn = $("#btn-vocab-open-yaml");
  if (btn) btn.disabled = !p;
}

function renderVocabEditor() {
  const host = $("#vocab-editor");
  if (!host) return;
  const v = vocabState.current;
  if (!v) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p>Pick a vocabulary on the left to edit it, or click <strong>+ New vocabulary</strong> above to create one.</p>' +
      '<p class="meta">The editor renders the YAML as a form. The underlying file is rewritten on save; you can also edit the YAML directly with <em>Open YAML in editor</em>.</p>' +
      '</div>';
    return;
  }
  const interactions = v.interactions || [];
  const scope = v.scope || {};
  host.innerHTML =
    '<div class="vocab-head">' +
    '<label>Display name<input type="text" id="vocab-name" value="' + escapeAttr(v.name || "") + '" placeholder="e.g., Salesforce"></label>' +
    '<label>Internal id<input type="text" id="vocab-id" value="' + escapeAttr(v.id || "") + '" placeholder="salesforce"></label>' +
    '<label>Version<input type="number" id="vocab-version" value="' + escapeAttr(v.version || 1) + '" min="1" step="1"></label>' +
    '</div>' +
    '<div class="vocab-head">' +
    '<label>Scope: process name (.exe)<input type="text" id="vocab-scope-proc" value="' + escapeAttr(scope.process_name || "") + '" placeholder="chrome.exe"></label>' +
    '<label>Scope: window title regex (optional)<input type="text" id="vocab-scope-title" value="' + escapeAttr(scope.window_title_regex || "") + '" placeholder=".*Salesforce.*"></label>' +
    '</div>' +
    '<div class="vocab-toolbar">' +
    '<strong>Interactions (' + interactions.length + ')</strong>' +
    '<span class="flex-spacer"></span>' +
    '<button id="btn-vocab-add-interaction">+ Add interaction</button>' +
    '<button id="btn-vocab-save" class="primary">Save vocabulary</button>' +
    '</div>' +
    '<div id="vocab-interactions"></div>';
  renderVocabInteractions();
  $("#vocab-name").addEventListener("input", markDirty);
  $("#vocab-id").addEventListener("input", markDirty);
  $("#vocab-version").addEventListener("input", markDirty);
  $("#vocab-scope-proc").addEventListener("input", markDirty);
  $("#vocab-scope-title").addEventListener("input", markDirty);
  $("#btn-vocab-add-interaction").addEventListener("click", addInteraction);
  $("#btn-vocab-save").addEventListener("click", saveVocab);
}

function renderVocabInteractions() {
  const host = $("#vocab-interactions");
  if (!host) return;
  const interactions = (vocabState.current && vocabState.current.interactions) || [];
  if (!interactions.length) {
    host.innerHTML = '<p class="hint">No interactions yet. Click + Add interaction, or bootstrap from a prep session in the tracker tray.</p>';
    return;
  }
  host.innerHTML = "";
  for (let i = 0; i < interactions.length; i++) {
    const ent = interactions[i];
    const sig = ent.signature || {};
    const flags = ent.flags || {};
    const sigParts = [sig.control_type, sig.automation_id, sig.name].filter(Boolean);
    const sigSummary = sigParts.length ? sigParts.join(" · ") : "(unset signature)";
    const row = document.createElement("div");
    row.className = "vocab-int";
    row.dataset.idx = String(i);
    row.innerHTML =
      '<div class="vocab-int-head">' +
      '<span class="vocab-int-num">' + (i + 1) + '</span>' +
      '<div class="vocab-int-sig">' + escapeHtml(sigSummary) + '</div>' +
      '<button class="icon-btn vocab-int-remove" title="Remove">✕</button>' +
      '</div>' +
      '<div class="vocab-int-body">' +
      '<label>Meaningful name<input type="text" data-field="name" value="' + escapeAttr(ent.name || "") + '" placeholder="e.g., Search customer record"></label>' +
      '<div class="vocab-int-sig-fields">' +
      '<label>control_type<input type="text" data-sig="control_type" value="' + escapeAttr(sig.control_type || "") + '"></label>' +
      '<label>automation_id<input type="text" data-sig="automation_id" value="' + escapeAttr(sig.automation_id || "") + '"></label>' +
      '<label>name (raw)<input type="text" data-sig="name" value="' + escapeAttr(sig.name || "") + '"></label>' +
      '<label>window_title_regex<input type="text" data-sig="window_title_regex" value="' + escapeAttr(sig.window_title_regex || "") + '"></label>' +
      '</div>' +
      '</div>';
    row.querySelector(".vocab-int-remove").addEventListener("click", () => removeInteraction(i));
    row.querySelectorAll("[data-field], [data-sig], [data-flag]").forEach(el => {
      el.addEventListener("input", collectAndMark);
      el.addEventListener("change", collectAndMark);
    });
    host.appendChild(row);
  }
}

function collectAndMark() {
  const v = vocabState.current;
  if (!v) return;
  v.name = $("#vocab-name").value.trim();
  v.id = $("#vocab-id").value.trim();
  v.version = parseInt($("#vocab-version").value, 10) || 1;
  v.scope = v.scope || {};
  const proc = $("#vocab-scope-proc").value.trim();
  const titleR = $("#vocab-scope-title").value.trim();
  if (proc) v.scope.process_name = proc; else delete v.scope.process_name;
  if (titleR) v.scope.window_title_regex = titleR; else delete v.scope.window_title_regex;
  const rows = document.querySelectorAll("#vocab-interactions .vocab-int");
  v.interactions = [];
  rows.forEach(row => {
    const sig = {};
    row.querySelectorAll("[data-sig]").forEach(el => {
      const k = el.dataset.sig;
      const val = el.value.trim();
      if (val) sig[k] = val;
    });
    const ent = {
      signature: sig,
      name: row.querySelector('[data-field="name"]').value.trim() || "",
    };
    const flags = {};
    row.querySelectorAll("[data-flag]").forEach(el => {
      if (el.checked) flags[el.dataset.flag] = true;
    });
    if (Object.keys(flags).length) ent.flags = flags;
    v.interactions.push(ent);
  });
  markDirty();
}

function markDirty() {
  vocabState.dirty = true;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary*";
}

function addInteraction() {
  const v = vocabState.current;
  if (!v) return;
  v.interactions = v.interactions || [];
  v.interactions.push({ signature: { control_type: "Button", name: "" }, name: "" });
  renderVocabInteractions();
  markDirty();
}

function removeInteraction(idx) {
  const v = vocabState.current;
  if (!v) return;
  v.interactions.splice(idx, 1);
  renderVocabInteractions();
  markDirty();
}

async function saveVocab() {
  if (!vocabState.selectedPath || !vocabState.current) return;
  collectAndMark();
  const r = await ipcRenderer.invoke("viewer:writeVocab", {
    path: vocabState.selectedPath,
    vocab: vocabState.current,
  });
  if (!r || !r.ok) {
    toast("Save failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  vocabState.dirty = false;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary";
  toast("Vocabulary saved - re-analyze any session to apply", "success");
  reloadVocabList();
}

if ($("#btn-vocab-new")) {
  $("#btn-vocab-new").addEventListener("click", async () => {
    const name = await promptModal({ title: "New App Vocabulary", message: "What app is this vocabulary for?", placeholder: "e.g., Salesforce", okLabel: "Create" });
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const p = await ipcRenderer.invoke("viewer:newVocabFile", { suggestedId: id });
    if (!p) return;
    await reloadVocabList();
    await selectVocab(p);
    toast("New vocabulary created - fill in interactions and save", "success");
  });
}
if ($("#btn-vocab-reload")) {
  $("#btn-vocab-reload").addEventListener("click", reloadVocabList);
}
if ($("#btn-vocab-open-yaml")) {
  $("#btn-vocab-open-yaml").addEventListener("click", () => {
    if (vocabState.selectedPath) ipcRenderer.invoke("viewer:openVocabFile", vocabState.selectedPath);
  });
}

/* ============ Attach external video (Teams recording, etc.) ======= */

function parseHmsToMs(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  const sign = s.startsWith("-") ? -1 : 1;
  if (s.startsWith("-") || s.startsWith("+")) s = s.slice(1);
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
           + (m[4] ? Number(m[4].padEnd(3, "0").slice(0, 3)) : 0);
  return sign * ms;
}

async function attachExternalVideo() {
  if (!currentSession) return;
  const r = await ipcRenderer.invoke("viewer:attachExternalVideo", {
    sessionFolder: currentSession.sessionFolder,
  });
  if (!r) return;
  const m = currentSession.manifest || {};
  const started_at = m.started_at;
  if (!started_at) {
    toast("Session manifest has no started_at; can't compute video offset", "error");
    return;
  }
  const ans = await promptModal({
    title: "Align video to session",
    message: "When did the recording start, relative to the session?",
    detail: "Session started at " + started_at + ". Format HH:MM:SS, signed (-00:00:05 means recording started 5 sec before the session).",
    placeholder: "00:00:00",
    defaultValue: "00:00:00",
    okLabel: "Attach"
  });
  if (ans == null) return;
  const offsetMs = parseHmsToMs(ans);
  if (offsetMs === null) {
    toast("Couldn't parse offset; try 00:00:05 or -00:01:30", "error");
    return;
  }
  const saved = await ipcRenderer.invoke("viewer:saveExternalVideoSync", {
    sessionFolder: currentSession.sessionFolder,
    videoPath: r.path,
    offsetMs,
  });
  if (!saved || !saved.ok) {
    toast("Video attach failed: " + ((saved && saved.error) || "unknown"), "error");
    return;
  }
  toast("Video attached - reloading session", "success");
  await loadSessionIntoView(currentSession.sessionFolder);
}

if ($("#btn-attach-video")) {
  $("#btn-attach-video").addEventListener("click", attachExternalVideo);
}

/* ============ promptModal: a working replacement for window.prompt
   ================================================================
   Electron's renderer ships without a working prompt() implementation;
   calling it silently returns undefined, which is why "Add manual step"
   and "Group into phase" felt broken. This is a real inline modal that
   resolves to the typed string (or null on cancel/escape). */

function promptModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-prompt";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Input") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      '<input type="text" class="modal-input" ' +
      ' placeholder="' + escapeAttr(opts.placeholder || "") + '" ' +
      ' value="' + escapeAttr(opts.defaultValue || "") + '">' +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector(".modal-input");
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      resolve(value);
    }
    okBtn.addEventListener("click", () => done(input.value));
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
