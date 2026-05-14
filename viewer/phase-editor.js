"use strict";

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderPhaseList(host, phases, selectedId, onSelect) {
    host.innerHTML = "";
    if (!phases || !phases.length) {
      host.innerHTML = `
        <div class="empty-pane">
          <p><strong>No phases yet.</strong></p>
          <p>Phases group steps into milestones. Two ways to create them:</p>
          <ol>
            <li>Switch to <strong>Steps</strong>, Ctrl+click two or more steps, then click <em>Group selected steps into phase</em>.</li>
            <li>Load a Process Template with phases defined, then re-normalize the session.</li>
          </ol>
        </div>`;
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
      host.innerHTML = `
        <div class="empty-pane">
          <p>Pick a phase on the left to rename it, see which steps it contains, or remove steps from it.</p>
        </div>`;
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

  /* Muted phase palette -- very low chroma. Phases sit beneath the step
     row so the tint must stay quiet to not overpower the step bands. */
  const PHASE_PALETTE = ["#5A7488","#6E6A88","#886A78","#887A5A","#5A8870","#787058"];

  function renderPhaseTimeline(host, phases, steps, span, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!phases || !phases.length || !span || span.endMs <= span.startMs) return;
    const total = span.endMs - span.startMs;
    const zoom = Math.max(1, opts.zoom || 1);
    host.style.width = (100 * zoom) + "%";
    let pi = 0;
    for (const p of phases) {
      const contained = (p.step_ids || []).map(sid =>
        (steps || []).find(s => s.step_id === sid)).filter(Boolean);
      if (!contained.length) continue;
      const startMs = Math.min(...contained.map(s => new Date(s.time_range.start).getTime()));
      const endMs = Math.max(...contained.map(s => new Date(s.time_range.end).getTime()));
      const left = ((startMs - span.startMs) / total) * 100;
      const width = Math.max(0.5, ((endMs - startMs) / total) * 100);
      const color = PHASE_PALETTE[pi++ % PHASE_PALETTE.length];
      const band = document.createElement("div");
      const dimmed = opts.dimmedIds && opts.dimmedIds.has(p.phase_id);
      band.className = "phase-band"
        + (opts.selectedId === p.phase_id ? " selected" : "")
        + (dimmed ? " dimmed" : "");
      band.style.left = left + "%";
      band.style.width = width + "%";
      band.style.background = color + "14";
      band.style.borderColor = color + "44";
      band.style.color = color;
      band.title = `${p.name} (${p.state})`;
      band.dataset.phaseId = p.phase_id;
      band.innerHTML = `<span class="phase-band-label">${escapeHtml(p.name)}</span>`;
      if (opts.onSelect) {
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onSelect(p.phase_id);
        });
      }
      host.appendChild(band);
    }
    if (opts.selectedId) {
      const sel = host.querySelector(`.phase-band[data-phase-id="${opts.selectedId}"]`);
      const scroll = host.parentElement;
      if (sel && scroll) {
        const sl = sel.offsetLeft, sw = sel.offsetWidth;
        scroll.scrollLeft = Math.max(0, sl + sw / 2 - scroll.clientWidth / 2);
      }
    }
  }

  window.PdtPhases = { renderPhaseList, renderPhaseDetail, renderPhaseTimeline };
})();
