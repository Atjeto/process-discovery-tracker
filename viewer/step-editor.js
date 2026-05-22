"use strict";

(function () {
  const TimelineCore = require("./timeline/timeline-core.js");
  const PdtTheme = require("./theme.js");
  const { stepStateLabel } = require("./session-summary.js");

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* Local "HH:MM:SS" from an ISO timestamp. The mini-timeline axis
     already uses toLocaleTimeString, so step times must use the same
     convention -- a raw .slice(11,19) shows the UTC time and silently
     disagrees with the timeline (e.g. 08:55:07 in the detail tile
     vs. 10:55 on the timeline on a +2 system). */
  function localTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatTimeRange(tr) {
    if (!tr || !tr.start || !tr.end) return "";
    return `${localTime(tr.start)} - ${localTime(tr.end)}`;
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

  function renderStepList(host, steps, selectedId, onSelect, onMultiSelect, onInlineRename, multiSelectedSet, onReorder) {
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
        <span class="multi-check" title="Click to select for merge or phase grouping"></span>
        <span class="step-name" title="Double-click to rename" tabindex="-1">${escapeHtml(s.name)}</span>
        ${driftTag}
        <span class="step-time">${escapeHtml(stepDuration(s.time_range))}</span>
        <span class="step-reorder">
          <button type="button" class="step-move-up" title="Move up" tabindex="-1">↑</button>
          <button type="button" class="step-move-down" title="Move down" tabindex="-1">↓</button>
        </span>
      `;
      row.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (onMultiSelect) onMultiSelect(s.step_id);
        } else if (onSelect) {
          onSelect(s.step_id);
        }
      });
      // A plain click on the checkbox toggles multi-selection -- no Ctrl
      // needed; stopPropagation so it doesn't also fire row-select.
      const checkEl = row.querySelector(".multi-check");
      checkEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onMultiSelect) onMultiSelect(s.step_id);
      });
      row.querySelector(".step-move-up").addEventListener("click", (e) => {
        e.stopPropagation();
        if (onReorder) onReorder(s.step_id, -1);
      });
      row.querySelector(".step-move-down").addEventListener("click", (e) => {
        e.stopPropagation();
        if (onReorder) onReorder(s.step_id, 1);
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
    const _start = _tr.start ? escapeHtml(localTime(_tr.start)) : "—";
    const _end = _tr.end ? escapeHtml(localTime(_tr.end)) : "—";
    const interMap = (callbacks && callbacks.interactionsById) || {};
    const interIds = (step.evidence && step.evidence.interaction_event_ids) || [];
    const resolvedInter = interIds.map((id) => interMap[id]).filter(Boolean);
    // A2: a boundary index chosen by the analyst (split AFTER this index).
    const splitAfterIndex = (callbacks && Number.isInteger(callbacks.splitAfterIndex))
      ? callbacks.splitAfterIndex : null;
    const interListHtml = renderInteractionList(resolvedInter, interIds.length,
      { splittable: true, splitAfterIndex });
    const _hasSplitPoint = splitAfterIndex !== null;
    const splitBtnLabel = _hasSplitPoint ? "Split here" : "Split";
    const splitBtnTitle = _hasSplitPoint
      ? "Split this step after interaction #" + (splitAfterIndex + 1)
      : "Split this step in two. Click the scissors on an interaction to choose where; otherwise it splits at the midpoint.";
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
        ${interListHtml}
        <p>${(step.evidence && step.evidence.screenshot_refs || []).length} screenshots</p>
        ${step.canonical_step_id ? `<p class="meta">canonical: <code>${escapeHtml(step.canonical_step_id)}</code></p>` : ""}
        ${step.drift ? `<p class="drift-note">⚠ Canonical drift: was <code>${escapeHtml(step.drift.previous_canonical_step_id || "")}</code> → now <code>${escapeHtml(step.drift.new_canonical_step_id || "")}</code></p>` : ""}
      </div>
      <div class="actions">
        <button id="btn-step-save" class="primary">Save</button>
        <button id="btn-step-jump" title="Switch to Flow view and seek the video/timeline to the start of this step">Jump to in Flow</button>
        ${(callbacks && callbacks.recordingAvailable) ? '<button id="btn-step-watch" title="Play the recording across this step\'s time range">▶ Watch</button>' : ""}
        <button id="btn-step-split" title="${escapeAttr(splitBtnTitle)}">${splitBtnLabel}</button>
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
    // A2: scissors on each interaction pick the split boundary.
    host.querySelectorAll(".si-split-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const after = parseInt(b.dataset.after, 10);
        if (callbacks.onPickSplit && Number.isInteger(after)) callbacks.onPickSplit(after);
      });
    });
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

    // A5: right-click a step block for the step context menu (split, merge,
    // rename, hide, jump, flag). The Flow timeline's document-level
    // contextmenu handler is scoped to #timeline, so it never fires here.
    if (opts.onContextMenu) {
      for (const block of host.querySelectorAll(".step-block[data-step-id]")) {
        block.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          opts.onContextMenu(block.getAttribute("data-step-id"), e.clientX, e.clientY);
        });
      }
    }
  }

  /* A readable one-line description of a single interaction event --
     'Typed "X" into Serial Number', 'Clicked Search', 'Turned Wi-Fi
     on'. Covers every recorder event kind; an unrecognised future kind
     degrades to a humanized fallback. Exported for unit tests. */
  function describeInteraction(ev) {
    const d = (ev && ev.data) || {};
    const kind = d.kind || "";
    const name = String(d.meaningful_name || d.name || "").trim();
    const ctl = d.control_type || "";
    const field = name || String(d.automation_id || "").trim() || "a control";
    if (kind === "value_changed") {
      let value = String(d.value || "").trim();
      if (value.length > 300) value = value.slice(0, 299) + "…";
      const n = d._coalesced_count || 0;
      const keys = n > 1 ? ` — ${n} keystrokes` : "";
      return value
        ? `Typed "${value}" into ${field}${keys}`
        : `Cleared ${field}${keys}`;
    }
    if (kind === "text_changed") return `Edited ${field}`;
    if (kind === "invoked") {
      if (!name) return `Clicked a ${ctl || "control"}`;
      if (ctl === "MenuItem") return `Opened ${name}`;
      if (ctl === "Hyperlink") return `Followed ${name}`;
      return `Clicked ${name}`;
    }
    if (kind === "selection_changed") {
      const sel = String(d.selected_value || "").trim();
      if (ctl === "TabItem" || ctl === "Tab") return `Switched to ${sel || name || "a tab"}`;
      if (sel) return name ? `Selected "${sel}" in ${name}` : `Selected "${sel}"`;
      return name ? `Changed selection in ${name}` : "Changed a selection";
    }
    if (kind === "toggle_changed") {
      const state = String(d.toggle_state || "").trim().toLowerCase();
      if (state === "on") return `Turned ${field} on`;
      if (state === "off") return `Turned ${field} off`;
      if (state === "indeterminate") return `Set ${field} to indeterminate`;
      return `Toggled ${field}`;
    }
    if (kind === "focus_changed") return name ? `Focused ${name}` : "Focus moved";
    const label = name || d.automation_id || ctl || d.window_title || "interaction";
    return `${kind ? kind.replace(/_/g, " ") : "Event"}: ${label}`;
  }

  /* The collapsible list of a step's constituent interactions. `events`
     are the resolved interaction events in step order; `total` is the
     count the step claims (may exceed events.length when some ids are
     not in this session's event stream). */
  /* A1: bucket an interaction by kind so the list can colour-code value
     entry vs. actions vs. selections vs. toggles (ADR-0010 A1). An unknown
     or navigational kind (focus_changed, ...) stays muted. Exported for
     unit tests. */
  function siKindClass(ev) {
    const k = (ev && ev.data && ev.data.kind) || "";
    if (k === "value_changed" || k === "text_changed") return "si-value";
    if (k === "invoked") return "si-action";
    if (k === "selection_changed") return "si-select";
    if (k === "toggle_changed") return "si-toggle";
    return "si-other";
  }

  function renderInteractionList(events, total, opts) {
    if (!total) return `<p class="meta">No interactions recorded for this step.</p>`;
    opts = opts || {};
    // A2: when splittable, every interaction except the last carries a
    // scissors control that picks the boundary the Split action cuts at.
    const splittable = !!opts.splittable && events.length >= 2;
    const splitAfter = Number.isInteger(opts.splitAfterIndex) ? opts.splitAfterIndex : null;
    const rows = events.map((ev, i) => {
      const t = localTime(ev.timestamp);
      const isBoundary = splittable && splitAfter === i;
      const splitBtn = (splittable && i < events.length - 1)
        ? `<button type="button" class="si-split-btn${isBoundary ? " active" : ""}" data-after="${i}" tabindex="-1" title="Split the step here, after this interaction">&#9988;</button>`
        : "";
      return `<li class="step-interaction ${siKindClass(ev)}${isBoundary ? " split-boundary" : ""}" data-idx="${i}">` +
        `<span class="si-text">${escapeHtml(describeInteraction(ev))}</span>` +
        `<span class="si-time">${escapeHtml(t)}</span>${splitBtn}</li>`;
    });
    const missing = total - events.length;
    if (missing > 0) {
      rows.push(`<li class="step-interaction">` +
        `<span class="si-text meta">${missing} interaction(s) not found in this session</span>` +
        `</li>`);
    }
    return `<details class="step-interactions"${total <= 15 ? " open" : ""}>` +
      `<summary>Interactions (${total})</summary>` +
      `<ol class="step-interaction-list">${rows.join("")}</ol>` +
      `</details>`;
  }

  module.exports = {
    renderStepList, renderStepDetail, renderStepTimeline,
    describeInteraction, renderInteractionList, siKindClass,
  };
})();
