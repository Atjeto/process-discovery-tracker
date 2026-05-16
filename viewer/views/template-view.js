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

const { $, escapeHtml, toast, cryptoRandomId } = require("./dom.js");
const { confirmModal } = require("./modals.js");
const State = require("./state.js");
const Ipc = require("./ipc.js");
const { renderAggregate } = require("./aggregate-view.js");

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
      (Array.isArray(s.match) && s.match.length
        ? '<div class="ctpl-step-rules">' + s.match.length + ' match rule(s) — edit via Advanced</div>'
        : '<div class="ctpl-step-rules" style="color:var(--bad)">No match rules — won\'t auto-match. Add via Advanced.</div>') +
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
      // Clean up dangling references in any phase's step_ids so we
      // don't leave a phase pointing at a missing step. If a phase
      // ends up empty, leave it (the analyst can delete it) rather
      // than auto-removing -- removal is a separate decision.
      if (Array.isArray(proc.phases)) {
        for (const ph of proc.phases) {
          if (Array.isArray(ph.step_ids)) {
            ph.step_ids = ph.step_ids.filter((id) => id !== removedId);
          }
        }
      }
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

/* ============ Wiring (runs at require time) ======================= */

(function wireTemplateCompare() {
  const aSel = document.getElementById("tpl-cmp-a");
  const bSel = document.getElementById("tpl-cmp-b");
  const refresh = document.getElementById("tpl-cmp-refresh");
  if (aSel) aSel.addEventListener("change", compareTemplateVersions);
  if (bSel) bSel.addEventListener("change", compareTemplateVersions);
  if (refresh) refresh.addEventListener("click", refreshTemplateVersions);
})();

if ($("#btn-open-canonical")) {
  $("#btn-open-canonical").addEventListener("click", async () => {
    const r = await Ipc.openCanonicalFile();
    if (!r) return;
    State.getCanonicalState().path = r.path;
    State.getCanonicalState().content = r.content;
    $("#canonical-yaml").value = r.content;
    $("#canonical-meta").textContent = "Loaded " + r.path;
    $("#btn-save-canonical").disabled = false;
    renderCanonicalStepList();
  });
}
if ($("#btn-save-canonical")) {
  $("#btn-save-canonical").addEventListener("click", async () => {
    if (!State.getCanonicalState().path) return;
    const content = $("#canonical-yaml").value;
    await Ipc.saveCanonicalFile({ path: State.getCanonicalState().path, content });
    State.getCanonicalState().content = content;
    toast("Process Template saved", "success");
    renderCanonicalStepList();
    // AM.1: refresh the version compare list on the next aggregate
    // render so the new snapshot shows up.
    refreshTemplateVersions().catch(() => {});
  });
}
if ($("#btn-load-exemplar")) {
  $("#btn-load-exemplar").addEventListener("click", async () => {
    const folder = await Ipc.openSessionFolder();
    if (!folder) return;
    State.getCanonicalState().exemplarFolder = folder;
    if (State.getCanonicalState().path) {
      const r = await Ipc.testCanonicalMatch({
        canonicalPath: State.getCanonicalState().path, sessionFolder: folder,
      });
      if (r && r.ok) {
        $("#exemplar-match-rate").textContent =
          "Match rate: " + Math.round((r.match_rate || 0) * 100) + "% (" + r.matched + "/" + r.total + ")";
      }
    }
    $("#btn-promote-from-exemplar").disabled = false;
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

module.exports = { refreshTemplateVersions, renderCanonicalStepList };
