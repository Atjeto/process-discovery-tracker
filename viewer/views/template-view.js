/*
 * template-view.js -- the Process Template (Canonical) tab.
 *
 * Owns the editable Process Template step list, the Advanced YAML
 * textarea sync, exemplar-session match testing, the version-compare
 * panel, and the re-normalize-to-canonical flow. The module's
 * top-level code wires its controls at require() time (the DOM is
 * already parsed when renderer.js pulls this in).
 */

"use strict";

const { $, escapeHtml, toast, cryptoRandomId } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const { renderAggregate } = require("./aggregate-view.js");
const { canonicalSkeleton, slugify, stepsToTemplateSteps, interactionMatches, ruleDrift, ensurePhase, assignStepToPhase } = require("../canonical-author.js");
const { openIdentityPicker, loadVocabs } = require("./identity-picker.js");

/* Module-level cache of the loaded sample session -- its steps + events
   feed the promote-to-template flow. */
let sampleSession = null;

/* App Library vocabs, cached for the drift check in the step list.
   Refreshed by refreshVocabCache() when a template loads or the
   identity picker closes. */
let cachedVocabs = [];

/* ============ AM.1 -- Process Template version compare ============ */

async function refreshTemplateVersions() {
  const panel = document.getElementById("template-compare-panel");
  if (!panel) return;
  if (!State.getCanonicalState().path) {
    panel.style.display = "none";
    return;
  }
  const list = await Ipc.listTemplateVersions(State.getCanonicalState().path);
  if (!list || !list.length) { panel.style.display = "none"; return; }
  panel.style.display = "";
  const aSel = document.getElementById("tpl-cmp-a");
  const bSel = document.getElementById("tpl-cmp-b");
  const opts = list.map((v) =>
    `<option value="${escapeHtml(v.path)}">${escapeHtml(v.label || v.timestamp)}</option>`
  ).join("");
  aSel.innerHTML = opts;
  bSel.innerHTML = opts;
  // Default: A = newest snapshot before current, B = current.
  if (list.length >= 2) {
    aSel.value = list[1].path;
    bSel.value = list[0].path;
  }
}

async function compareTemplateVersions() {
  const aPath = document.getElementById("tpl-cmp-a").value;
  const bPath = document.getElementById("tpl-cmp-b").value;
  const out = document.getElementById("tpl-cmp-output");
  if (!aPath || !bPath || aPath === bPath) {
    out.innerHTML = '<span style="color:var(--fg-3)">Pick two different versions to compare.</span>';
    return;
  }
  const yaml = require("js-yaml");
  async function read(p) {
    const r = await Ipc.readTemplateFile(p);
    if (!r || !r.ok) return null;
    try { return yaml.load(r.content) || {}; }
    catch (_) { return null; }
  }
  const [a, b] = await Promise.all([read(aPath), read(bPath)]);
  if (!a || !b) {
    out.innerHTML = '<span class="delta-down">Couldn\'t parse one of the templates.</span>';
    return;
  }
  const aProc = a.canonical_process || a;
  const bProc = b.canonical_process || b;
  const aSteps = new Map((aProc.steps || []).map((s) => [s.step_id, s]));
  const bSteps = new Map((bProc.steps || []).map((s) => [s.step_id, s]));
  const aPhases = new Map((aProc.phases || []).map((p) => [p.phase_id, p]));
  const bPhases = new Map((bProc.phases || []).map((p) => [p.phase_id, p]));
  const addedSteps = [];
  const removedSteps = [];
  const renamedSteps = [];
  for (const [id, s] of bSteps) {
    if (!aSteps.has(id)) addedSteps.push(s.name || id);
    else if (aSteps.get(id).name !== s.name) {
      renamedSteps.push(`${aSteps.get(id).name || id} → ${s.name}`);
    }
  }
  for (const [id, s] of aSteps) {
    if (!bSteps.has(id)) removedSteps.push(s.name || id);
  }
  const addedPhases = [];
  const removedPhases = [];
  for (const [id, p] of bPhases) if (!aPhases.has(id)) addedPhases.push(p.name || id);
  for (const [id, p] of aPhases) if (!bPhases.has(id)) removedPhases.push(p.name || id);
  const aVer = aProc.version != null ? "v" + aProc.version : "(no version)";
  const bVer = bProc.version != null ? "v" + bProc.version : "(no version)";
  function row(label, items, cls) {
    if (!items.length) return "";
    return '<div><strong>' + escapeHtml(label) + ' (' + items.length + '):</strong> ' +
           '<span class="' + cls + '">' + escapeHtml(items.join(", ")) + '</span></div>';
  }
  const nochange = !addedSteps.length && !removedSteps.length && !renamedSteps.length &&
                   !addedPhases.length && !removedPhases.length;
  out.innerHTML =
    '<div><strong>Comparing</strong> ' + escapeHtml(aVer) + ' → ' + escapeHtml(bVer) + '</div>' +
    (nochange
      ? '<div style="color:var(--fg-3);margin-top:4px">No structural differences.</div>'
      : row("Steps added", addedSteps, "delta-up") +
        row("Steps removed", removedSteps, "delta-down") +
        row("Steps renamed", renamedSteps, "") +
        row("Phases added", addedPhases, "delta-up") +
        row("Phases removed", removedPhases, "delta-down"));
}

/* One-line plain-text summary of a match rule, for the read-only rule
   display under each template step. */
function describeMatchRule(rule) {
  if (!rule || typeof rule !== "object") return "(empty rule)";
  const parts = [];
  if (rule.process_name) parts.push(escapeHtml(rule.process_name));
  if (rule.window_title_regex) parts.push("title ~ " + escapeHtml(rule.window_title_regex));
  const i = rule.interaction;
  if (i && typeof i === "object") {
    if (i.control_type) parts.push(escapeHtml(i.control_type));
    if (i.automation_id) parts.push("#" + escapeHtml(i.automation_id));
    if (i.name) parts.push('"' + escapeHtml(i.name) + '"');
  }
  return parts.length ? parts.join(" · ") : "(empty rule)";
}

/* Render the Process Template steps as an editable form rather than
   just a derived count. Edits to name + description round-trip through
   js-yaml so the underlying match rules and other fields the analyst
   doesn't see stay intact. */
function renderCanonicalStepList() {
  const host = $("#canonical-step-list");
  if (!host) return;
  if (!State.getCanonicalState().path) {
    host.innerHTML = `
      <div class="empty-pane">
        <p>No template loaded. Click <strong>Open Process Template...</strong> above.</p>
        <p class="meta">A sample template ships with the tool at <code>normalization/canonical/sample-customer-onboarding-v3.yaml</code> - open it to see how one looks.</p>
      </div>`;
    return;
  }
  const yaml = require("js-yaml");
  let parsed = null;
  try { parsed = yaml.load(State.getCanonicalState().content || "") || {}; }
  catch (e) {
    host.innerHTML = '<p class="hint" style="color:var(--bad)">Couldn\'t parse the template: ' +
      escapeHtml(e.message) + '</p>';
    return;
  }
  const proc = parsed.canonical_process || (parsed.canonical_process = {});
  if (!Array.isArray(proc.steps)) proc.steps = [];
  State.getCanonicalState().parsed = parsed;

  const meta = '<div class="canonical-meta-form">' +
    '<label>Template name <input type="text" id="ctpl-name" value="' + escapeHtml(proc.name || "") + '" /></label>' +
    '<label>Version <input type="number" min="1" id="ctpl-version" value="' + (proc.version || 1) + '" /></label>' +
    '</div>';
  // Per-step phase membership is a *view* of proc.phases (which own the
  // step_ids); build a step_id -> phase_id lookup for the row selects.
  const phaseOfStep = new Map();
  for (const ph of (Array.isArray(proc.phases) ? proc.phases : [])) {
    for (const sid of (Array.isArray(ph.step_ids) ? ph.step_ids : [])) {
      if (!phaseOfStep.has(sid)) phaseOfStep.set(sid, ph.phase_id);
    }
  }
  function phaseOptions(selectedId) {
    const phases = Array.isArray(proc.phases) ? proc.phases : [];
    let html = '<option value=""' + (selectedId ? "" : " selected") +
      '>— Unassigned —</option>';
    for (const ph of phases) {
      if (!ph || !ph.phase_id) continue;
      html += '<option value="' + escapeHtml(ph.phase_id) + '"' +
        (ph.phase_id === selectedId ? " selected" : "") + '>' +
        escapeHtml(ph.name || ph.phase_id) + '</option>';
    }
    return html + '<option value="__new__">+ New phase…</option>';
  }
  const rows = proc.steps.map((s, i) =>
    '<div class="ctpl-step" data-idx="' + i + '">' +
      '<div class="ctpl-step-head">' +
        '<input type="text" class="ctpl-step-name" value="' + escapeHtml(s.name || "") + '" placeholder="Step name (e.g. Search customer)" />' +
        '<button type="button" class="ctpl-step-up"   title="Move up">↑</button>' +
        '<button type="button" class="ctpl-step-down" title="Move down">↓</button>' +
        '<button type="button" class="ctpl-step-del danger" title="Delete">×</button>' +
      '</div>' +
      '<textarea class="ctpl-step-desc" placeholder="Optional plain-English description of what the step does">' +
        escapeHtml(s.description || "") + '</textarea>' +
      '<div class="ctpl-step-rules-head">' +
        '<button type="button" class="ctpl-step-rules-btn">Match rules…</button>' +
      '</div>' +
      (Array.isArray(s.match) && s.match.length
        ? '<div class="ctpl-step-rules">' +
            s.match.map((r) => {
              const origin = r.library_ref ? "library" : (r.interaction ? "derived" : "coarse");
              const originLabel = origin === "coarse" ? "basic" : origin;
              const drifted = origin === "library" && ruleDrift(r, cachedVocabs);
              return '<div class="ctpl-rule">' +
                '<span class="ctpl-rule-origin origin-' + origin + '">' + originLabel + '</span> ' +
                describeMatchRule(r) +
                (drifted ? ' <span class="ctpl-rule-drift" title="The linked App Library entry changed — open Match rules to re-sync">drift</span>' : '') +
              '</div>';
            }).join("") +
          '</div>'
        : '<div class="ctpl-step-norules">No match rules yet — this step won\'t auto-match. Click “Match rules…” to give it an identity.</div>') +
      '<div class="ctpl-step-phase"><span>Phase</span>' +
        '<select class="ctpl-step-phase-sel">' + phaseOptions(phaseOfStep.get(s.step_id)) + '</select>' +
      '</div>' +
    '</div>'
  ).join("");
  host.innerHTML = meta + rows +
    '<div class="ctpl-actions"><button type="button" id="ctpl-add-step" class="link-btn">+ Add step</button></div>';

  function commit() {
    proc.name = document.getElementById("ctpl-name").value.trim();
    const v = parseInt(document.getElementById("ctpl-version").value, 10);
    if (Number.isFinite(v) && v >= 1) proc.version = v;
    host.querySelectorAll(".ctpl-step").forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      if (!proc.steps[idx]) return;
      proc.steps[idx].name = row.querySelector(".ctpl-step-name").value.trim();
      proc.steps[idx].description = row.querySelector(".ctpl-step-desc").value.trim();
    });
    State.getCanonicalState().content = yaml.dump(parsed, { lineWidth: 120, noRefs: true, sortKeys: false });
    const ta = document.getElementById("canonical-yaml");
    if (ta) ta.value = State.getCanonicalState().content;
    const saveBtn = document.getElementById("btn-save-canonical");
    if (saveBtn && saveBtn.dataset) saveBtn.dataset.dirty = "1";
  }

  host.querySelectorAll(".ctpl-step-name, .ctpl-step-desc").forEach((el) => {
    el.addEventListener("input", commit);
  });
  document.getElementById("ctpl-name").addEventListener("input", commit);
  document.getElementById("ctpl-version").addEventListener("input", commit);
  // Direct edits in the Advanced YAML textarea must update
  // State.getCanonicalState().content AND re-render the form so the two views
  // stay in sync. Re-parse on input; bail silently on parse error
  // (the analyst is mid-typing and the YAML is temporarily broken).
  const ta = document.getElementById("canonical-yaml");
  if (ta && !ta._pdtSyncWired) {
    ta._pdtSyncWired = true;
    let _taSyncTimer = null;
    ta.addEventListener("input", () => {
      State.getCanonicalState().content = ta.value;
      // A raw-YAML edit is an unsaved change too -- mark dirty so Close warns.
      const saveBtn = document.getElementById("btn-save-canonical");
      if (saveBtn && saveBtn.dataset) saveBtn.dataset.dirty = "1";
      clearTimeout(_taSyncTimer);
      _taSyncTimer = setTimeout(() => {
        try {
          const reparsed = yaml.load(ta.value);
          if (reparsed) renderCanonicalStepList();
        } catch (_) { /* leave form stale until valid */ }
      }, 350);
    });
  }
  host.querySelectorAll(".ctpl-step-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.closest(".ctpl-step").dataset.idx, 10);
      const ok = await confirmModal({
        title: "Delete step?",
        message: "Remove step \"" + (proc.steps[idx].name || "(unnamed)") + "\" from the template?",
        detail: "Match rules attached to this step will also be removed.",
        okLabel: "Delete", danger: true,
      });
      if (!ok) return;
      const removedId = proc.steps[idx].step_id;
      proc.steps.splice(idx, 1);
      // Drop the deleted step from any phase it belonged to. An empty
      // phase is removed too -- there's no separate phase-manager UI
      // that could otherwise clean one up.
      assignStepToPhase(proc, removedId, null);
      commit();
      renderCanonicalStepList();
    });
  });
  function moveStep(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= proc.steps.length) return;
    const tmp = proc.steps[idx];
    proc.steps[idx] = proc.steps[j];
    proc.steps[j] = tmp;
    commit();
    renderCanonicalStepList();
  }
  host.querySelectorAll(".ctpl-step-up").forEach((btn) =>
    btn.addEventListener("click", () => moveStep(parseInt(btn.closest(".ctpl-step").dataset.idx, 10), -1)));
  host.querySelectorAll(".ctpl-step-down").forEach((btn) =>
    btn.addEventListener("click", () => moveStep(parseInt(btn.closest(".ctpl-step").dataset.idx, 10), 1)));
  host.querySelectorAll(".ctpl-step-rules-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.closest(".ctpl-step").dataset.idx, 10);
      const stepObj = proc.steps[idx];
      if (!stepObj) return;
      const result = await openIdentityPicker(stepObj);
      if (!result) return;
      stepObj.match = result;
      commit();
      renderCanonicalStepList();
      refreshVocabCache();
    });
  });
  host.querySelectorAll(".ctpl-step-phase-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const idx = parseInt(sel.closest(".ctpl-step").dataset.idx, 10);
      const step = proc.steps[idx];
      if (!step) return;
      let targetId;
      if (sel.value === "__new__") {
        const name = await promptModal({
          title: "New phase",
          message: "Name the phase this step belongs to",
          placeholder: "e.g. Validate customers",
          okLabel: "Create",
        });
        if (!name || !name.trim()) { renderCanonicalStepList(); return; }
        targetId = ensurePhase(proc, name);
      } else {
        targetId = sel.value || null;
      }
      assignStepToPhase(proc, step.step_id, targetId);
      commit();
      renderCanonicalStepList();
    });
  });
  document.getElementById("ctpl-add-step").addEventListener("click", () => {
    proc.steps.push({
      step_id: cryptoRandomId(),
      name: "New step",
      description: "",
      match: [],
    });
    commit();
    renderCanonicalStepList();
  });
}

/* Load a template into the editor -- shared by Open Process Template,
   New Process Template, and the "Export as Process Template" hand-off
   from the Steps view. */
function loadCanonical(r) {
  if (!r || !r.path) return;
  State.getCanonicalState().path = r.path;
  State.getCanonicalState().content = r.content;
  if ($("#canonical-yaml")) $("#canonical-yaml").value = r.content;
  if ($("#canonical-meta")) $("#canonical-meta").textContent = "Loaded " + r.path;
  const saveBtn = $("#btn-save-canonical");
  if (saveBtn) { saveBtn.disabled = false; if (saveBtn.dataset) delete saveBtn.dataset.dirty; }
  if ($("#btn-close-canonical")) $("#btn-close-canonical").disabled = false;
  if ($("#btn-delete-canonical")) $("#btn-delete-canonical").disabled = false;
  renderCanonicalStepList();
  refreshVocabCache();
}

/* Unload the current template from the editor, back to the empty state.
   Shared by the Close button and by Delete (after the file is removed
   from disk). */
function closeCanonical() {
  const cs = State.getCanonicalState();
  cs.path = null;
  cs.content = null;
  cs.parsed = null;
  cs.exemplarFolder = null;
  sampleSession = null;
  if ($("#canonical-yaml")) $("#canonical-yaml").value = "";
  if ($("#canonical-meta")) $("#canonical-meta").textContent = "";
  if ($("#exemplar-match-rate")) $("#exemplar-match-rate").textContent = "";
  const saveBtn = $("#btn-save-canonical");
  if (saveBtn) { saveBtn.disabled = true; if (saveBtn.dataset) delete saveBtn.dataset.dirty; }
  if ($("#btn-close-canonical")) $("#btn-close-canonical").disabled = true;
  if ($("#btn-delete-canonical")) $("#btn-delete-canonical").disabled = true;
  renderCanonicalStepList();
  renderExemplarSteps();
  refreshTemplateVersions().catch(() => {});
}

/* Reload the App Library vocab cache, then re-render so the step list's
   drift badges reflect the current Library. */
async function refreshVocabCache() {
  try { cachedVocabs = await loadVocabs(); }
  catch (_) { cachedVocabs = []; }
  renderCanonicalStepList();
}

/* Collect every match rule across the currently-open template's steps
   -- used to flag which sample-session steps are already covered. */
function collectOpenTemplateRules() {
  const parsed = State.getCanonicalState().parsed;
  const proc = parsed && parsed.canonical_process;
  if (!proc || !Array.isArray(proc.steps)) return [];
  const rules = [];
  for (const s of proc.steps) {
    for (const rule of (Array.isArray(s.match) ? s.match : [])) rules.push(rule);
  }
  return rules;
}

/* Live "N steps selected" feedback for the import panel: recounts the
   ticked exemplar checkboxes, updates the indicator, and enables the
   promote button only when at least one step is selected. */
function updateExemplarSelectedCount() {
  const countEl = $("#exemplar-selected-count");
  const promoteBtn = $("#btn-promote-from-exemplar");
  const host = $("#exemplar-events");
  if (!sampleSession) {
    if (countEl) countEl.textContent = "";
    if (promoteBtn) promoteBtn.disabled = true;
    return;
  }
  const n = host ? host.querySelectorAll(".exemplar-step-cb:checked").length : 0;
  if (countEl) {
    countEl.textContent = n === 0
      ? "No steps selected"
      : n + " step" + (n === 1 ? "" : "s") + " selected";
  }
  if (promoteBtn) promoteBtn.disabled = (n === 0);
}

/* Render the loaded sample session's steps as a checklist in the
   #exemplar-events panel. Steps already covered by the open template
   are tagged and left unchecked so the analyst focuses on the gaps. */
function renderExemplarSteps() {
  const host = $("#exemplar-events");
  if (!host) return;
  if (!sampleSession) {
    host.innerHTML = "";
    updateExemplarSelectedCount();
    return;
  }
  const steps = (sampleSession.annotations && sampleSession.annotations.steps) || [];
  if (!steps.length) {
    host.innerHTML = '<p class="hint">This session has no steps yet. Open it on the ' +
      'Session tab and analyze it (or add steps manually) first, then reload it here.</p>';
    updateExemplarSelectedCount();
    return;
  }
  const interById = new Map();
  for (const ev of sampleSession.events || []) {
    if (ev && ev.type === "interaction" && ev.event_id) interById.set(ev.event_id, ev);
  }
  const openRules = collectOpenTemplateRules();
  host.innerHTML = steps.map((s, i) => {
    const ids = (s.evidence && s.evidence.interaction_event_ids) || [];
    const ints = ids.map((id) => interById.get(id)).filter(Boolean);
    const apps = [...new Set(ints
      .map((e) => (e.data && e.data.process_name) || "")
      .filter(Boolean))];
    const covered = openRules.length && ints.length &&
      ints.every((ev) => openRules.some((rule) => interactionMatches(rule, ev)));
    return '<label class="exemplar-step">' +
      '<input type="checkbox" class="exemplar-step-cb" data-idx="' + i + '"' +
        (covered ? "" : " checked") + ' />' +
      '<span class="exemplar-step-name">' + escapeHtml(s.name || "(unnamed step)") + '</span>' +
      '<span class="exemplar-step-meta">' + ints.length + ' interaction(s)' +
        (apps.length ? ' · ' + escapeHtml(apps.join(", ")) : '') + '</span>' +
      (covered ? '<span class="exemplar-step-tag">in template</span>' : '') +
      '</label>';
  }).join("");
  updateExemplarSelectedCount();
}

/* ============ Wiring (runs at require time) ======================= */

(function wireTemplateCompare() {
  const aSel = document.getElementById("tpl-cmp-a");
  const bSel = document.getElementById("tpl-cmp-b");
  const refresh = document.getElementById("tpl-cmp-refresh");
  if (aSel) aSel.addEventListener("change", compareTemplateVersions);
  if (bSel) bSel.addEventListener("change", compareTemplateVersions);
  if (refresh) refresh.addEventListener("click", refreshTemplateVersions);
})();

if ($("#btn-new-canonical")) {
  $("#btn-new-canonical").addEventListener("click", async () => {
    const name = await promptModal({
      title: "New Process Template",
      message: "Name this process",
      placeholder: "e.g. Customer Onboarding",
      okLabel: "Create",
    });
    if (!name) return;
    const yaml = require("js-yaml");
    const content = yaml.dump(canonicalSkeleton(name),
      { lineWidth: 120, noRefs: true, sortKeys: false });
    const r = await Ipc.newCanonicalFile({
      content, suggestedName: slugify(name) || "new-process",
    });
    if (!r) return;
    loadCanonical(r);
    toast("Process Template created — add steps below, then Save changes", "success");
  });
}
if ($("#btn-open-canonical")) {
  $("#btn-open-canonical").addEventListener("click", async () => {
    const r = await Ipc.openCanonicalFile();
    if (!r) return;
    loadCanonical(r);
  });
}
if ($("#btn-save-canonical")) {
  $("#btn-save-canonical").addEventListener("click", async () => {
    if (!State.getCanonicalState().path) return;
    const content = $("#canonical-yaml").value;
    await Ipc.saveCanonicalFile({ path: State.getCanonicalState().path, content });
    State.getCanonicalState().content = content;
    // Saved -> no unsaved changes; clear the dirty flag the Close
    // confirm reads so it doesn't prompt spuriously after a save.
    const saveBtn = $("#btn-save-canonical");
    if (saveBtn && saveBtn.dataset) delete saveBtn.dataset.dirty;
    toast("Process Template saved", "success");
    renderCanonicalStepList();
    // AM.1: refresh the version compare list on the next aggregate
    // render so the new snapshot shows up.
    refreshTemplateVersions().catch(() => {});
  });
}
if ($("#btn-close-canonical")) {
  $("#btn-close-canonical").addEventListener("click", async () => {
    if (!State.getCanonicalState().path) return;
    const saveBtn = $("#btn-save-canonical");
    if (saveBtn && saveBtn.dataset && saveBtn.dataset.dirty === "1") {
      const ok = await confirmModal({
        title: "Close without saving?",
        message: "This Process Template has unsaved changes.",
        detail: "Closing it discards them.",
        okLabel: "Discard & close", danger: true,
      });
      if (!ok) return;
    }
    closeCanonical();
  });
}
if ($("#btn-delete-canonical")) {
  $("#btn-delete-canonical").addEventListener("click", async () => {
    const cs = State.getCanonicalState();
    if (!cs.path) return;
    const ok = await confirmModal({
      title: "Delete this Process Template?",
      message: "Permanently delete this Process Template file from disk?",
      detail: cs.path + "\n\nVersion history snapshots are kept. This can't be undone.",
      okLabel: "Delete", danger: true,
    });
    if (!ok) return;
    const r = await Ipc.deleteCanonicalFile({ path: cs.path });
    if (!r || !r.ok) {
      toast("Couldn't delete the template" + (r && r.error ? ": " + r.error : ""), "error");
      return;
    }
    toast("Process Template deleted", "success");
    closeCanonical();
  });
}
if ($("#btn-load-exemplar")) {
  $("#btn-load-exemplar").addEventListener("click", async () => {
    const folder = await Ipc.openSessionFolder();
    if (!folder) return;
    State.getCanonicalState().exemplarFolder = folder;
    sampleSession = await Ipc.loadSession(folder);
    if (!sampleSession || sampleSession.error) {
      sampleSession = null;
      renderExemplarSteps();
      toast("Couldn't load that session folder", "error");
      return;
    }
    renderExemplarSteps();
    if (State.getCanonicalState().path) {
      const r = await Ipc.testCanonicalMatch({
        canonicalPath: State.getCanonicalState().path, sessionFolder: folder,
      });
      if (r && r.ok) {
        $("#exemplar-match-rate").textContent =
          "Match rate: " + Math.round((r.match_rate || 0) * 100) + "% (" + r.matched + "/" + r.total + ")";
      }
    }
  });
}
const _exHost = $("#exemplar-events");
if (_exHost && !_exHost._pdtCountWired) {
  _exHost._pdtCountWired = true;
  _exHost.addEventListener("change", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("exemplar-step-cb")) {
      updateExemplarSelectedCount();
    }
  });
}
if ($("#btn-promote-from-exemplar")) {
  $("#btn-promote-from-exemplar").addEventListener("click", () => {
    if (!sampleSession) return;
    if (!State.getCanonicalState().path) {
      toast("Open or create a Process Template first", "error");
      return;
    }
    const steps = (sampleSession.annotations && sampleSession.annotations.steps) || [];
    const checked = Array.from(document.querySelectorAll(".exemplar-step-cb:checked"))
      .map((cb) => steps[parseInt(cb.dataset.idx, 10)])
      .filter(Boolean);
    if (!checked.length) { toast("Tick at least one step to add", "error"); return; }
    const tplSteps = stepsToTemplateSteps(checked, sampleSession.events || [], cachedVocabs);
    const yaml = require("js-yaml");
    let parsed = State.getCanonicalState().parsed;
    if (!parsed) parsed = State.getCanonicalState().parsed = {};
    const proc = parsed.canonical_process || (parsed.canonical_process = {});
    if (!Array.isArray(proc.steps)) proc.steps = [];
    proc.steps.push(...tplSteps);
    State.getCanonicalState().content = yaml.dump(parsed,
      { lineWidth: 120, noRefs: true, sortKeys: false });
    const ta = $("#canonical-yaml");
    if (ta) ta.value = State.getCanonicalState().content;
    const saveBtn = $("#btn-save-canonical");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.dataset.dirty = "1"; }
    renderCanonicalStepList();
    renderExemplarSteps();
    const withRules = tplSteps.filter((s) => s.match.length).length;
    toast("Added " + tplSteps.length + " step(s), " + withRules +
      " with a derived match rule — review and Save changes", "success");
  });
}

if ($("#btn-renormalize-canonical")) {
  $("#btn-renormalize-canonical").addEventListener("click", async () => {
    const r = await Ipc.openCanonicalFile();
    if (!r) return;
    if (!State.getAggregateSessions().length) { toast("Load sessions first", "error"); return; }
    let driftCount = 0;
    for (const s of State.getAggregateSessions()) {
      const result = await Ipc.runNormalizeExtended({
        sessionFolder: s.sessionFolder, mine: true, canonical: r.path,
      });
      if (result && result.ok && result.drift_count) driftCount += result.drift_count;
    }
    const folders = State.getAggregateSessions().map((s) => s.sessionFolder);
    State.setAggregateSessions(await Ipc.loadMultipleSessions(folders));
    State.setAggregateSessions(State.getAggregateSessions().filter((s) => !s.error));
    renderAggregate();
    toast(`Re-normalized; ${driftCount} drift marker(s)`, driftCount ? "warn" : "success");
  });
}

// Render the empty state immediately so the Template tab isn't blank.
setTimeout(() => renderCanonicalStepList(), 0);

module.exports = { refreshTemplateVersions, renderCanonicalStepList, loadCanonical };
