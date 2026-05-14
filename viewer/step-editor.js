"use strict";

(function () {
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function formatTimeRange(tr) {
    if (!tr || !tr.start || !tr.end) return "";
    return `${tr.start.slice(11,19)} - ${tr.end.slice(11,19)}`;
  }

  function renderStepList(host, steps, selectedId, onSelect, onMultiSelect) {
    host.innerHTML = "";
    if (!steps || !steps.length) {
      host.innerHTML = '<p class="hint">No steps yet. Run normalization or right-click the timeline to add a manual step.</p>';
      return;
    }
    for (const s of steps) {
      const row = document.createElement("div");
      row.className = "step-row" + (s.step_id === selectedId ? " selected" : "");
      row.dataset.stepId = s.step_id;
      const driftTag = s.drift ? '<span class="drift-indicator" title="Canonical drift detected">⚠</span>' : "";
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(s.state)}" title="${escapeAttr(s.state)}"></span>
        <span class="step-name">${escapeHtml(s.name)}</span>
        ${driftTag}
        <span class="step-time">${escapeHtml(formatTimeRange(s.time_range))}</span>
      `;
      row.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (onMultiSelect) onMultiSelect(s.step_id);
        } else if (onSelect) {
          onSelect(s.step_id);
        }
      });
      host.appendChild(row);
    }
  }

  function renderStepDetail(host, step, callbacks) {
    if (!step) {
      host.innerHTML = '<p class="hint">Select a step to edit.</p>';
      return;
    }
    const flags = step.flags || {};
    host.innerHTML = `
      <label>Name <input type="text" id="step-name" value="${escapeAttr(step.name)}"></label>
      <label>Description <textarea id="step-desc">${escapeHtml(step.description || "")}</textarea></label>
      <div class="flags">
        <label><input type="checkbox" id="flag-conditional" ${flags.conditional ? "checked" : ""}> Conditional</label>
        <label><input type="checkbox" id="flag-exception" ${flags.exception_path ? "checked" : ""}> Exception path</label>
        <label><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
        <label><input type="checkbox" id="flag-auto" ${flags.automation_candidate ? "checked" : ""}> Automation candidate</label>
      </div>
      <div class="evidence">
        <p>${(step.evidence && step.evidence.interaction_event_ids || []).length} interactions</p>
        <p>${(step.evidence && step.evidence.screenshot_refs || []).length} screenshots</p>
        ${step.canonical_step_id ? `<p class="meta">canonical: <code>${escapeHtml(step.canonical_step_id)}</code></p>` : ""}
        ${step.drift ? `<p class="drift-note">⚠ Canonical drift: was <code>${escapeHtml(step.drift.previous_canonical_step_id || "")}</code> → now <code>${escapeHtml(step.drift.new_canonical_step_id || "")}</code></p>` : ""}
      </div>
      <div class="actions">
        <button id="btn-step-save" class="primary">Save</button>
        <button id="btn-step-split">Split</button>
        <button id="btn-step-merge">Merge with next</button>
        <button id="btn-step-delete" class="danger">Delete</button>
      </div>`;
    document.getElementById("btn-step-save").addEventListener("click", () => {
      if (!callbacks.onSave) return;
      callbacks.onSave({
        ...step,
        name: document.getElementById("step-name").value.trim(),
        description: document.getElementById("step-desc").value.trim(),
        flags: {
          ...flags,
          conditional: document.getElementById("flag-conditional").checked,
          exception_path: document.getElementById("flag-exception").checked,
          waste: document.getElementById("flag-waste").checked,
          automation_candidate: document.getElementById("flag-auto").checked,
        },
        state: step.state === "manually_authored" ? "manually_authored" : "edited",
      });
    });
    document.getElementById("btn-step-delete").addEventListener("click", () =>
      callbacks.onDelete && callbacks.onDelete(step.step_id));
    document.getElementById("btn-step-split").addEventListener("click", () =>
      callbacks.onSplit && callbacks.onSplit(step.step_id));
    document.getElementById("btn-step-merge").addEventListener("click", () =>
      callbacks.onMerge && callbacks.onMerge(step.step_id));
  }

  function renderStepTimeline(host, steps, interactions, span) {
    host.innerHTML = "";
    if (!steps || !steps.length || !span || span.endMs <= span.startMs) return;
    const total = span.endMs - span.startMs;
    const palette = ["#3a86ff","#8338ec","#ff006e","#fb5607","#ffbe0b","#06d6a0","#118ab2"];
    const colorByName = new Map();
    let pi = 0;
    for (const s of steps) {
      const name = s.name || s.step_id;
      if (!colorByName.has(name)) colorByName.set(name, palette[pi++ % palette.length]);
    }
    for (const s of steps) {
      if (!s.time_range) continue;
      const start = new Date(s.time_range.start).getTime();
      const end = new Date(s.time_range.end).getTime();
      const left = ((start - span.startMs) / total) * 100;
      const width = Math.max(0.5, ((end - start) / total) * 100);
      const block = document.createElement("div");
      block.className = "step-block";
      block.style.left = left + "%";
      block.style.width = width + "%";
      block.style.background = colorByName.get(s.name || s.step_id);
      block.title = `${s.name} (${s.state})`;
      block.dataset.stepId = s.step_id;
      host.appendChild(block);
    }
  }

  function renderInteractionEvent(ev) {
    const d = ev.data || {};
    const kind = d.kind || "?";
    const label = d.name || d.automation_id || d.control_type || d.window_title || "";
    return `${kind}: ${label}`;
  }

  window.PdtSteps = { renderStepList, renderStepDetail, renderStepTimeline, renderInteractionEvent };
})();
