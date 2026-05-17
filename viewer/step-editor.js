"use strict";

(function () {
  const TimelineCore = require("./timeline/timeline-core.js");
  const PdtTheme = require("./theme.js");
  const { stepStateLabel } = require("./session-summary.js");

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function formatTimeRange(tr) {
    if (!tr || !tr.start || !tr.end) return "";
    return `${tr.start.slice(11,19)} - ${tr.end.slice(11,19)}`;
  }

  /* Compact duration for a step's time range -- "42s", "2:17", "1h04". */
  function stepDuration(tr) {
    if (!tr || !tr.start || !tr.end) return "";
    const ms = new Date(tr.end).getTime() - new Date(tr.start).getTime();
    if (!isFinite(ms) || ms < 0) return "";
    const secs = Math.round(ms / 1000);
    if (secs < 60) return secs + "s";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + ":" + String(secs % 60).padStart(2, "0");
    return Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0");
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
        (isMulti ? " multi-selected" : "") +
        (s.state === "hidden" ? " step-hidden" : "");
      row.dataset.stepId = s.step_id;
      const driftTag = s.drift ? '<span class="drift-indicator" title="Canonical drift detected">⚠</span>' : "";
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(s.state)}" title="${escapeAttr(stepStateLabel(s.state))}"></span>
        <span class="multi-check" title="Ctrl+click to multi-select for phase grouping"></span>
        <span class="step-name" title="Double-click to rename" tabindex="-1">${escapeHtml(s.name)}</span>
        ${driftTag}
        <span class="step-time">${escapeHtml(stepDuration(s.time_range))}</span>
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
    const _tr = step.time_range || {};
    const _dur = stepDuration(_tr) || "—";
    const _start = _tr.start ? escapeHtml(_tr.start.slice(11, 19)) : "—";
    const _end = _tr.end ? escapeHtml(_tr.end.slice(11, 19)) : "—";
    host.innerHTML = `
      <div class="step-stat-tiles">
        <div class="stat-tile"><div class="stat-tile-label">Duration</div><div class="stat-tile-value">${escapeHtml(_dur)}</div></div>
        <div class="stat-tile"><div class="stat-tile-label">Start</div><div class="stat-tile-value">${_start}</div></div>
        <div class="stat-tile"><div class="stat-tile-label">End</div><div class="stat-tile-value">${_end}</div></div>
      </div>
      <label>Name <input type="text" id="step-name" value="${escapeAttr(step.name)}"></label>
      ${step.suggestion_reason ? `<p class="step-suggestion-reason" title="Why the tool grouped these interactions into a step">Auto-detected: ${escapeHtml(step.suggestion_reason)}</p>` : ""}
      <label>Description <textarea id="step-desc">${escapeHtml(step.description || "")}</textarea></label>
      <div class="flags">
        <label title="This step only happens in some cases (branching path). Marks the step as conditional in exports."><input type="checkbox" id="flag-conditional" ${flags.conditional ? "checked" : ""}> Conditional</label>
        <label title="This step represents an error, workaround, or recovery action -- not the happy path."><input type="checkbox" id="flag-exception" ${flags.exception_path ? "checked" : ""}> Exception path</label>
        <label title="This step shouldn't be necessary (rework, duplicate effort, copy-paste between systems). Surfaces in the aggregate as 'waste hotspots'."><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
        <label title="Mark this individual step as a candidate to include in a future automation project (RPA / integration / script). Aggregated across the session into the PDD export and the stats report so you can see total automatable share at a glance."><input type="checkbox" id="flag-auto" ${flags.automation_candidate ? "checked" : ""}> Automation candidate</label>
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
        ${(callbacks && callbacks.recordingAvailable) ? '<button id="btn-step-watch" title="Play the recording across this step\'s time range">▶ Watch</button>' : ""}
        <button id="btn-step-split">Split</button>
        <button id="btn-step-merge">Merge with next</button>
        <button id="btn-step-hide" title="${step.state === "hidden" ? "Bring this step back into the list" : "Suppress this step as noise. It stays out of the list and survives re-analyze. Reveal it again via the hidden filter chip."}">${step.state === "hidden" ? "Unhide" : "Hide as noise"}</button>
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
    const hideBtn = document.getElementById("btn-step-hide");
    if (hideBtn) hideBtn.addEventListener("click", () =>
      callbacks.onToggleHide && callbacks.onToggleHide(step.step_id));
    document.getElementById("btn-step-split").addEventListener("click", () =>
      callbacks.onSplit && callbacks.onSplit(step.step_id));
    document.getElementById("btn-step-merge").addEventListener("click", () =>
      callbacks.onMerge && callbacks.onMerge(step.step_id));
    const jumpBtn = document.getElementById("btn-step-jump");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => callbacks.onJumpToFlow && callbacks.onJumpToFlow(step));
      jumpBtn.disabled = !(step.time_range && step.time_range.start);
    }
    const watchBtn = document.getElementById("btn-step-watch");
    if (watchBtn) {
      watchBtn.addEventListener("click", () => callbacks.onWatchStep && callbacks.onWatchStep(step));
      watchBtn.disabled = !(step.time_range && step.time_range.start);
    }
  }

  /* Build the Steps mini-timeline. The lane-packing, tick maths, axis, and
     band layout all live in timeline-core.js (shared with the Phases and Flow
     timelines); this function only shapes step data into the core's MiniItem
     form. `interactions` is unused -- kept for call-site compatibility. */
  function renderStepTimeline(host, steps, interactions, span, opts) {
    opts = opts || {};
    if (!steps || !steps.length || !span) { host.innerHTML = ""; return; }

    // Palette + band alphas track the active theme (see theme.js).
    const STEP_PALETTE = PdtTheme.stepPalette();
    const ba = PdtTheme.bandAlphas();
    // Same name -> same colour across the session.
    const colorByName = new Map();
    let pi = 0;
    for (const s of steps) {
      const name = s.name || s.step_id;
      if (!colorByName.has(name)) colorByName.set(name, STEP_PALETTE[pi++ % STEP_PALETTE.length]);
    }

    const items = [];
    for (const s of steps) {
      if (!s.time_range) continue;
      const startMs = new Date(s.time_range.start).getTime();
      const endMs = new Date(s.time_range.end).getTime();
      if (!isFinite(startMs) || !isFinite(endMs)) continue;
      const dur = endMs - startMs;
      const durStr = dur < 60000 ? `${Math.round(dur / 1000)}s`
        : dur < 3600000 ? `${Math.round(dur / 60000)}m`
        : `${(dur / 3600000).toFixed(1)}h`;
      items.push({
        id: s.step_id,
        startMs,
        endMs,
        label: s.name || "",
        color: colorByName.get(s.name || s.step_id),
        title: `${s.name} (${s.state})\n${new Date(startMs).toLocaleTimeString()} · ${durStr}`,
        selected: opts.selectedId === s.step_id,
        dimmed: !!(opts.dimmedIds && opts.dimmedIds.has(s.step_id)),
      });
    }

    TimelineCore.renderMiniTimeline(host, {
      items,
      span,
      zoom: opts.zoom,
      maxLanes: 4,
      laneHeight: 18,
      blockClass: "step-block",
      labelClass: "step-block-label",
      idAttr: "data-step-id",
      tintAlpha: ba ? ba.tintAlpha : undefined,
      borderAlpha: ba ? ba.borderAlpha : undefined,
      selectedId: opts.selectedId,
      onSelect: opts.onSelect,
    });
  }

  function renderInteractionEvent(ev) {
    const d = ev.data || {};
    const kind = d.kind || "?";
    const label = d.name || d.automation_id || d.control_type || d.window_title || "";
    return `${kind}: ${label}`;
  }

  module.exports = { renderStepList, renderStepDetail, renderStepTimeline, renderInteractionEvent };
})();
