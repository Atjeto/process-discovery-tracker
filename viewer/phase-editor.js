"use strict";

(function () {
  const TimelineCore = require("./timeline/timeline-core.js");
  const PdtTheme = require("./theme.js");

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
        ${containedSteps.map((s, si) => `
          <div class="phase-step-row" draggable="true" data-step-id="${escapeAttr(s.step_id)}">
            <span class="grip">⋮⋮</span>
            <span class="step-name">${escapeHtml(s.name)}</span>
            ${si > 0 ? `<button class="split-step" data-step-id="${escapeAttr(s.step_id)}" title="Split the phase here — this step starts a new phase">✂</button>` : ""}
            <button class="remove-step" data-step-id="${escapeAttr(s.step_id)}" title="Remove from phase">×</button>
          </div>
        `).join("")}
      </div>
      <div class="actions">
        <button id="btn-phase-save" class="primary">Save</button>
        <button id="btn-phase-delete" class="danger">Delete</button>
      </div>`;
    host.querySelectorAll(".remove-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = btn.dataset.stepId;
        if (callbacks.onRemoveStep) callbacks.onRemoveStep(phase.phase_id, sid);
      });
    });
    host.querySelectorAll(".split-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = btn.dataset.stepId;
        if (callbacks.onSplit) callbacks.onSplit(phase.phase_id, sid);
      });
    });

    // P2.6: drag-reorder of step rows within the phase. The rows have
    // draggable="true" set in the template above; wire up dragstart /
    // dragover / drop with a visual drop indicator following the cursor.
    const list = document.getElementById("phase-step-list");
    if (list && callbacks.onReorderSteps) {
      let dragSid = null;
      let indicator = null;
      function showIndicator(target, before) {
        if (!indicator) {
          indicator = document.createElement("div");
          indicator.className = "phase-drag-indicator";
          list.style.position = "relative";
          list.appendChild(indicator);
        }
        const lr = list.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const top = (before ? tr.top : tr.bottom) - lr.top - 1;
        indicator.style.top = top + "px";
        indicator.style.display = "block";
      }
      function hideIndicator() { if (indicator) indicator.style.display = "none"; }
      list.querySelectorAll(".phase-step-row").forEach((row) => {
        row.addEventListener("dragstart", (e) => {
          dragSid = row.dataset.stepId;
          row.classList.add("dragging");
          // Required by Firefox to actually enable drag.
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", dragSid);
          }
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("dragging");
          hideIndicator();
          dragSid = null;
        });
        row.addEventListener("dragover", (e) => {
          if (!dragSid || row.dataset.stepId === dragSid) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          // Decide insert-before vs insert-after based on cursor Y.
          const tr = row.getBoundingClientRect();
          const before = e.clientY < tr.top + tr.height / 2;
          showIndicator(row, before);
          row._pdtInsertBefore = before;
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          hideIndicator();
          if (!dragSid || row.dataset.stepId === dragSid) return;
          const targetSid = row.dataset.stepId;
          const before = !!row._pdtInsertBefore;
          if (callbacks.onReorderSteps) {
            callbacks.onReorderSteps(phase.phase_id, dragSid, targetSid, before);
          }
        });
      });
      list.addEventListener("dragleave", (e) => {
        if (e.target === list) hideIndicator();
      });
    }
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
  }

  /* Build the Phases mini-timeline. Lane-packing, ticks, axis, and band
     layout live in timeline-core.js (shared with the Steps and Flow
     timelines). A phase's time range is the union of its contained steps. */
  function renderPhaseTimeline(host, phases, steps, span, opts) {
    opts = opts || {};
    if (!phases || !phases.length || !span) { host.innerHTML = ""; return; }

    // Palette + band alphas track the active theme (see theme.js).
    const PHASE_PALETTE = PdtTheme.phasePalette();
    const ba = PdtTheme.bandAlphas();

    // A phase spans the union of the steps it contains; sort by start so the
    // palette colours run in chronological order.
    const ranges = [];
    for (const p of phases) {
      const contained = (p.step_ids || [])
        .map(sid => (steps || []).find(s => s.step_id === sid))
        .filter(Boolean);
      if (!contained.length) continue;
      const startMs = Math.min(...contained.map(s => new Date(s.time_range.start).getTime()));
      const endMs = Math.max(...contained.map(s => new Date(s.time_range.end).getTime()));
      if (!isFinite(startMs) || !isFinite(endMs)) continue;
      ranges.push({ p, startMs, endMs });
    }
    ranges.sort((a, b) => a.startMs - b.startMs);

    const items = ranges.map((r, i) => {
      const dur = r.endMs - r.startMs;
      const durStr = dur < 60000 ? `${Math.round(dur / 1000)}s`
        : dur < 3600000 ? `${Math.round(dur / 60000)}m`
        : `${(dur / 3600000).toFixed(1)}h`;
      return {
        id: r.p.phase_id,
        startMs: r.startMs,
        endMs: r.endMs,
        label: r.p.name || "",
        color: PHASE_PALETTE[i % PHASE_PALETTE.length],
        title: `${r.p.name} (${r.p.state})\n${new Date(r.startMs).toLocaleTimeString()} · ${durStr}`,
        selected: opts.selectedId === r.p.phase_id,
        dimmed: !!(opts.dimmedIds && opts.dimmedIds.has(r.p.phase_id)),
      };
    });

    TimelineCore.renderMiniTimeline(host, {
      items,
      span,
      zoom: opts.zoom,
      maxLanes: 3,
      laneHeight: 22,
      blockClass: "phase-band",
      labelClass: "phase-band-label",
      idAttr: "data-phase-id",
      tintAlpha: ba ? ba.tintAlpha : "14",
      borderAlpha: ba ? ba.borderAlpha : "44",
      selectedId: opts.selectedId,
      onSelect: opts.onSelect,
    });
  }

  module.exports = { renderPhaseList, renderPhaseDetail, renderPhaseTimeline };
})();
