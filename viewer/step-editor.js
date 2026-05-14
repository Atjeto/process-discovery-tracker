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

  function renderStepList(host, steps, selectedId, onSelect, onMultiSelect, onInlineRename, multiSelectedSet) {
    host.innerHTML = "";
    if (!steps || !steps.length) {
      host.innerHTML = `
        <div class="empty-pane">
          <p><strong>No steps yet.</strong></p>
          <p>Steps appear after you click <em>Analyze session</em>. If the session had interaction events recorded, you'll see auto-suggested steps here. If a Process Template was matched, you'll see auto-matched steps named after the template.</p>
          <p>You can also build steps yourself with the <strong>+ Add step</strong> button above.</p>
        </div>`;
      return;
    }
    const ms = multiSelectedSet || new Set();
    for (const s of steps) {
      const row = document.createElement("div");
      const isMulti = ms.has(s.step_id);
      const isSel = s.step_id === selectedId;
      row.className = "step-row" +
        (isSel ? " selected" : "") +
        (isMulti ? " multi-selected" : "");
      row.dataset.stepId = s.step_id;
      const driftTag = s.drift ? '<span class="drift-indicator" title="Canonical drift detected">⚠</span>' : "";
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(s.state)}" title="${escapeAttr(s.state)}"></span>
        <span class="multi-check" title="Ctrl+click to multi-select for phase grouping"></span>
        <span class="step-name" title="Double-click to rename" tabindex="-1">${escapeHtml(s.name)}</span>
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
      const nameEl = row.querySelector(".step-name");
      nameEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        beginInlineRename(nameEl, s, onInlineRename, steps);
      });
      host.appendChild(row);
    }
  }

  function beginInlineRename(nameEl, step, onInlineRename, allSteps) {
    if (!nameEl || nameEl.querySelector("input")) return;
    const original = step.name || "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = original;
    input.className = "step-name-edit";
    nameEl.textContent = "";
    nameEl.appendChild(input);
    input.focus();
    input.select();
    let committed = false;
    const commit = (advance) => {
      if (committed) return;
      committed = true;
      const next = input.value.trim();
      if (next && next !== original && onInlineRename) {
        onInlineRename(step.step_id, next, advance === "next");
      } else if (advance === "next" && onInlineRename) {
        // No change but user hit Tab: advance to next row's rename.
        const idx = (allSteps || []).findIndex(x => x.step_id === step.step_id);
        if (idx >= 0 && idx < allSteps.length - 1) onInlineRename(null, null, "open-next:" + allSteps[idx + 1].step_id);
        else nameEl.textContent = original;
      } else {
        nameEl.textContent = original;
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit("stay"); }
      else if (e.key === "Tab") { e.preventDefault(); commit("next"); }
      else if (e.key === "Escape") { e.preventDefault(); committed = true; nameEl.textContent = original; }
    });
    input.addEventListener("blur", () => commit("stay"));
  }

  function renderStepDetail(host, step, callbacks) {
    if (!step) {
      host.innerHTML = `
        <div class="empty-pane">
          <p>Pick a step on the left to see its details, rename it, or flag it.</p>
          <p class="meta">Each step has a name, an optional description, a list of UI interactions that made it up, and four flags you can toggle:</p>
          <ul class="meta">
            <li><strong>Conditional</strong>: this step only happens sometimes (branching path)</li>
            <li><strong>Exception path</strong>: this step represents an error or workaround</li>
            <li><strong>Waste</strong>: this step shouldn't be needed (rework, duplicate effort)</li>
            <li><strong>Automation candidate</strong>: this step could be replaced by a bot</li>
          </ul>
        </div>`;
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
        <button id="btn-step-jump" title="Switch to Flow view and seek the video/timeline to the start of this step">Jump to in Flow</button>
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
    const jumpBtn = document.getElementById("btn-step-jump");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => callbacks.onJumpToFlow && callbacks.onJumpToFlow(step));
      jumpBtn.disabled = !(step.time_range && step.time_range.start);
    }
  }

  /* Muted palette per design intent -- desaturated, distinguishable but
     quiet. Same name = same color across the session. */
  const STEP_PALETTE = ["#5A7488","#6E6A88","#886A78","#887A5A","#5A8870","#787058","#5E6878"];

  function renderStepTimeline(host, steps, interactions, span, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!steps || !steps.length || !span || span.endMs <= span.startMs) return;
    const total = span.endMs - span.startMs;
    const zoom = Math.max(1, opts.zoom || 1);
    // Width scales with zoom so the scroll container can pan horizontally.
    host.style.width = (100 * zoom) + "%";
    const colorByName = new Map();
    let pi = 0;
    for (const s of steps) {
      const name = s.name || s.step_id;
      if (!colorByName.has(name)) colorByName.set(name, STEP_PALETTE[pi++ % STEP_PALETTE.length]);
    }
    for (const s of steps) {
      if (!s.time_range) continue;
      const start = new Date(s.time_range.start).getTime();
      const end = new Date(s.time_range.end).getTime();
      const left = ((start - span.startMs) / total) * 100;
      const width = Math.max(0.5, ((end - start) / total) * 100);
      const color = colorByName.get(s.name || s.step_id);
      const block = document.createElement("div");
      const dimmed = opts.dimmedIds && opts.dimmedIds.has(s.step_id);
      block.className = "step-block"
        + (opts.selectedId === s.step_id ? " selected" : "")
        + (dimmed ? " dimmed" : "");
      block.style.left = left + "%";
      block.style.width = width + "%";
      block.style.background = color + "1F";
      block.style.borderColor = color + "55";
      block.style.color = color;
      block.title = `${s.name} (${s.state})`;
      block.dataset.stepId = s.step_id;
      const label = document.createElement("span");
      label.className = "step-block-label";
      label.textContent = s.name || "";
      block.appendChild(label);
      if (opts.onSelect) {
        block.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onSelect(s.step_id);
        });
      }
      host.appendChild(block);
    }
    // Auto-scroll the selected block into view (centered) so jumping to
    // a step in the list keeps it on-screen at any zoom level.
    if (opts.selectedId) {
      const sel = host.querySelector(`.step-block[data-step-id="${opts.selectedId}"]`);
      const scroll = host.parentElement;
      if (sel && scroll) {
        const sl = sel.offsetLeft, sw = sel.offsetWidth;
        const target = sl + sw / 2 - scroll.clientWidth / 2;
        scroll.scrollLeft = Math.max(0, target);
      }
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
