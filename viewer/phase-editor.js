"use strict";

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderPhaseList(host, phases, selectedId, onSelect) {
    host.innerHTML = "";
    if (!phases || !phases.length) {
      host.innerHTML = '<p class="hint">No phases yet. Group steps under the Steps tab, or run normalization against a canonical YAML with phases defined.</p>';
      return;
    }
    for (const p of phases) {
      const row = document.createElement("div");
      row.className = "phase-row" + (p.phase_id === selectedId ? " selected" : "");
      row.dataset.phaseId = p.phase_id;
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(p.state)}" title="${escapeAttr(p.state)}"></span>
        <span class="phase-name">${escapeHtml(p.name)}</span>
        <span class="phase-count">${(p.step_ids || []).length} steps</span>
      `;
      row.addEventListener("click", () => onSelect && onSelect(p.phase_id));
      host.appendChild(row);
    }
  }

  function renderPhaseDetail(host, phase, steps, callbacks) {
    if (!phase) {
      host.innerHTML = '<p class="hint">Select a phase to edit.</p>';
      return;
    }
    const containedSteps = (phase.step_ids || []).map(sid =>
      (steps || []).find(s => s.step_id === sid)).filter(Boolean);
    host.innerHTML = `
      <label>Name <input type="text" id="phase-name" value="${escapeAttr(phase.name)}"></label>
      <label>Description <textarea id="phase-desc">${escapeHtml(phase.description || "")}</textarea></label>
      <div class="phase-step-list" id="phase-step-list">
        ${containedSteps.map(s => `
          <div class="phase-step-row" draggable="true" data-step-id="${escapeAttr(s.step_id)}">
            <span class="grip">⋮⋮</span>
            <span class="step-name">${escapeHtml(s.name)}</span>
            <button class="remove-step" data-step-id="${escapeAttr(s.step_id)}" title="Remove from phase">×</button>
          </div>
        `).join("")}
      </div>
      <div class="actions">
        <button id="btn-phase-save" class="primary">Save</button>
        <button id="btn-phase-split">Split here</button>
        <button id="btn-phase-delete" class="danger">Delete</button>
      </div>`;
    host.querySelectorAll(".remove-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = btn.dataset.stepId;
        if (callbacks.onRemoveStep) callbacks.onRemoveStep(phase.phase_id, sid);
      });
    });
    document.getElementById("btn-phase-save").addEventListener("click", () => {
      if (!callbacks.onSave) return;
      callbacks.onSave({
        ...phase,
        name: document.getElementById("phase-name").value.trim(),
        description: document.getElementById("phase-desc").value.trim(),
        state: phase.state === "manually_authored" ? "manually_authored" : "edited",
      });
    });
    document.getElementById("btn-phase-delete").addEventListener("click", () =>
      callbacks.onDelete && callbacks.onDelete(phase.phase_id));
    document.getElementById("btn-phase-split").addEventListener("click", () =>
      callbacks.onSplit && callbacks.onSplit(phase.phase_id));
  }

  function renderPhaseTimeline(host, phases, steps, span) {
    host.innerHTML = "";
    if (!phases || !phases.length || !span || span.endMs <= span.startMs) return;
    const total = span.endMs - span.startMs;
    const palette = ["#3a86ff","#8338ec","#ff006e","#fb5607","#ffbe0b","#06d6a0"];
    let pi = 0;
    for (const p of phases) {
      const contained = (p.step_ids || []).map(sid =>
        (steps || []).find(s => s.step_id === sid)).filter(Boolean);
      if (!contained.length) continue;
      const startMs = Math.min(...contained.map(s => new Date(s.time_range.start).getTime()));
      const endMs = Math.max(...contained.map(s => new Date(s.time_range.end).getTime()));
      const left = ((startMs - span.startMs) / total) * 100;
      const width = Math.max(0.5, ((endMs - startMs) / total) * 100);
      const band = document.createElement("div");
      band.className = "phase-band";
      band.style.left = left + "%";
      band.style.width = width + "%";
      band.style.background = palette[pi++ % palette.length];
      band.title = `${p.name} (${p.state})`;
      band.dataset.phaseId = p.phase_id;
      band.innerHTML = `<span class="phase-band-label">${escapeHtml(p.name)}</span>`;
      host.appendChild(band);
    }
  }

  window.PdtPhases = { renderPhaseList, renderPhaseDetail, renderPhaseTimeline };
})();
