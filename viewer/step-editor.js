"use strict";

(function () {
  const TimelineCore = require("./timeline/timeline-core.js");
  const PdtTheme = require("./theme.js");
  const PdtRecognize = require("./recognition.js");
  const { stepStateLabel } = require("./session-summary.js");
  const { escapeHtml, escapeAttr } = require("./dom.js");   // shared escapers (deduped)

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
        (s.state === "hidden" ? " step-hidden" : "") +
        (s.flags && s.flags.waste ? " step-flag-waste" : "");
      row.dataset.stepId = s.step_id;
      const driftTag = s.drift ? '<span class="drift-indicator" title="Canonical drift detected">⚠</span>' : "";
      // A3: analyst flag badges -- marking a step now visibly shows in the list.
      const _f = s.flags || {};
      // Only the value-add judgment is a genuine PER-STEP property. Exception
      // path / automation candidate / conditional were retired (ADR-0027): they
      // describe a PATH or a multi-step SEGMENT, not a single step — exceptions
      // come from the observed variants, automation candidacy from coherent
      // segments (ADR-0016), conditionality from the map's branch frequency.
      const flagBadges =
        (_f.waste ? '<span class="step-flag flag-waste" title="Waste — should not be needed">W</span>' : "");
      // P0.3: repeat badge -- shown only when the repetition discriminates
      // (the step recurs in some, not all, cases). A legible "N×" label; a
      // step in every case is the uniform backbone and carries no badge.
      const repeatBadge = s._repeatDiscriminating
        ? `<span class="step-repeat" title="Appears in ${s._repeat} of ${s._repeatCaseCount} cases (not all) — edit one, then Apply to repeats">${s._repeat}×</span>`
        : "";
      row.innerHTML = `
        <span class="state-icon state-${escapeAttr(s.state)}" title="${escapeAttr(stepStateLabel(s.state))}"></span>
        <span class="multi-check" title="Click to select for merge or phase grouping"></span>
        <span class="step-name" title="Double-click to rename" tabindex="-1">${escapeHtml(s.name)}</span>
        ${driftTag}${flagBadges}${repeatBadge}
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
          <p class="meta">Each step has a name, an optional description, a list of UI interactions that made it up, and a <strong>Waste</strong> flag — mark a step as waste when it shouldn't be needed (rework, duplicate effort, copy-paste between systems); it feeds the value-add / efficiency analysis.</p>
          <p class="meta">Process variations / exception paths come from the observed <em>variants</em>, automation candidacy from coherent <em>segments</em> (Analysis), and conditionality from the map's branch frequency — none are per-step toggles.</p>
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
    // Decision 1: when this step recurs across tickets, offer to apply the
    // curation (name + description + flags) to the matching steps in the rest.
    const repeatCount = (callbacks && callbacks.repeatCount) || 0;
    const propagateBtn = repeatCount > 1
      ? `<button id="btn-step-propagate" title="Apply this step's name, description and flags to the ${repeatCount - 1} matching step(s) in other tickets">Apply to ${repeatCount - 1} repeat(s)</button>`
      : "";
    // P0.1: merge is the inverse of split, shown right beside it. "Merge with
    // next" always merges this step + the following one; the count-labelled
    // "Merge N selected" appears only when 2+ steps are ticked, so one button
    // never silently does two things.
    const mergeSelCount = (callbacks && callbacks.multiSelectedCount) || 0;
    const mergeSelectedBtn = mergeSelCount >= 2
      ? `<button id="btn-step-merge-selected" title="Merge the ${mergeSelCount} ticked steps into one">Merge ${mergeSelCount} selected</button>`
      : "";
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
        <label title="This step shouldn't be necessary (rework, duplicate effort, copy-paste between systems). Feeds the value-add / waste analysis and surfaces in the aggregate as 'waste hotspots'."><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
      </div>
      <div class="evidence">
        ${interListHtml}
        <p>${(step.evidence && step.evidence.screenshot_refs || []).length} screenshots</p>
        ${step.canonical_step_id ? `<p class="meta">canonical: <code>${escapeHtml(step.canonical_step_id)}</code></p>` : ""}
        ${step.drift ? `<p class="drift-note">⚠ Canonical drift: was <code>${escapeHtml(step.drift.previous_canonical_step_id || "")}</code> → now <code>${escapeHtml(step.drift.new_canonical_step_id || "")}</code></p>` : ""}
      </div>
      <div class="actions">
        <button id="btn-step-save" class="primary">Save</button>
        ${propagateBtn}
        <button id="btn-step-jump" title="Switch to Flow view and seek the video/timeline to the start of this step">Jump to in Flow</button>
        ${(callbacks && callbacks.recordingAvailable) ? '<button id="btn-step-watch" title="Play the recording across this step\'s time range">▶ Watch</button>' : ""}
        <button id="btn-step-split" title="${escapeAttr(splitBtnTitle)}">${splitBtnLabel}</button>
        <button id="btn-step-merge" title="Merge this step with the one that follows it (the inverse of Split)">Merge with next</button>
        ${mergeSelectedBtn}
        <span class="project-menu step-more-menu" id="step-more-menu">
          <button class="project-btn step-more-btn" id="btn-step-more" title="More actions" aria-haspopup="true">⋯</button>
          <div class="project-menu-popup" id="step-more-popup" style="display:none">
            <button class="project-menu-item" id="btn-step-hide" title="${step.state === "hidden" ? "Bring this step back into the list" : "Suppress this step as noise. It stays out of the list and survives re-analyze. Reveal it again via the hidden filter chip."}">${step.state === "hidden" ? "Unhide" : "Hide as noise"}</button>
            <button class="project-menu-item danger" id="btn-step-delete">Delete</button>
          </div>
        </span>
      </div>`;
    document.getElementById("btn-step-save").addEventListener("click", () => {
      if (!callbacks.onSave) return;
      callbacks.onSave({
        ...step,
        name: document.getElementById("step-name").value.trim(),
        description: document.getElementById("step-desc").value.trim(),
        flags: {
          ...flags,
          waste: document.getElementById("flag-waste").checked,
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
    const _propBtn = document.getElementById("btn-step-propagate");
    if (_propBtn) _propBtn.addEventListener("click", () =>
      callbacks.onPropagate && callbacks.onPropagate());
    // A2: scissors on each interaction pick the split boundary.
    host.querySelectorAll(".si-split-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const after = parseInt(b.dataset.after, 10);
        if (callbacks.onPickSplit && Number.isInteger(after)) callbacks.onPickSplit(after);
      });
    });
    // G-8: right-click an interaction to add its element signature to an App
    // Library vocabulary — kills the hand-copying of identifiers that manual
    // vocabulary curation needs.
    if (callbacks && callbacks.onAddInteractionToVocab) {
      host.querySelectorAll(".step-interaction[data-idx]").forEach((li) => {
        li.addEventListener("contextmenu", (e) => {
          const idx = parseInt(li.dataset.idx, 10);
          const ev = Number.isInteger(idx) ? resolvedInter[idx] : null;
          if (!ev) return;
          e.preventDefault();
          e.stopPropagation();
          callbacks.onAddInteractionToVocab(ev, step, e.clientX, e.clientY);
        });
      });
    }
    document.getElementById("btn-step-merge").addEventListener("click", () =>
      callbacks.onMerge && callbacks.onMerge(step.step_id));
    const _mergeSelBtn = document.getElementById("btn-step-merge-selected");
    if (_mergeSelBtn) _mergeSelBtn.addEventListener("click", () =>
      callbacks.onMergeSelected && callbacks.onMergeSelected());
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
    // Overflow "⋯" menu holding the destructive Hide / Delete actions. Open on
    // click; the outside-click closer removes itself so re-renders don't stack
    // listeners.
    const moreBtn = document.getElementById("btn-step-more");
    const morePopup = document.getElementById("step-more-popup");
    if (moreBtn && morePopup) {
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const show = morePopup.style.display === "none";
        morePopup.style.display = show ? "" : "none";
        if (show) {
          const onDoc = (ev) => {
            if (!morePopup.contains(ev.target) && ev.target !== moreBtn) {
              morePopup.style.display = "none";
              document.removeEventListener("click", onDoc, true);
            }
          };
          document.addEventListener("click", onDoc, true);
        }
      });
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
    // Fall back to the recognised framework/platform type (e.g. "data-grid
    // cell", "form field") rather than a meaningless "a control" when the
    // element has no visible name or id (ADR-0011).
    const field = name || String(d.automation_id || "").trim() || PdtRecognize.recognize(d).typeLabel;
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
      if (!name) return `Clicked a ${PdtRecognize.recognize(d).typeLabel}`;
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

  /* P0.4: a colour key for the A1 interaction bars, so the hues are not an
     unexplained code. Only the kinds actually present in this step are shown;
     if every interaction is the muted "other", there is nothing to explain. */
  const SI_LEGEND_LABELS = {
    "si-value": "Value entry", "si-action": "Action",
    "si-select": "Selection", "si-toggle": "Toggle", "si-other": "Other",
  };
  function interactionLegendHtml(events) {
    const present = new Set((events || []).map(siKindClass));
    if (!present.size || (present.size === 1 && present.has("si-other"))) return "";
    const order = ["si-value", "si-action", "si-select", "si-toggle", "si-other"];
    const items = order.filter((k) => present.has(k)).map((k) =>
      `<span class="si-lg-item"><span class="si-sw ${k}"></span>${SI_LEGEND_LABELS[k]}</span>`).join("");
    return `<div class="si-legend">${items}</div>`;
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
      interactionLegendHtml(events) +
      `<ol class="step-interaction-list">${rows.join("")}</ol>` +
      `</details>`;
  }

  /* ADR-0015 Phase 2: the aligned reading. Render the consensus BACKBONE -- the
     modal step sequence across the detected cases (tickets) -- into the list
     pane. Each row carries a frequency pill: how many of N cases hit that
     position. A full-strength pill at n = N (in every case); a muted "partial"
     pill below that (the step is not universal). The analyst curates ONE
     backbone step and propagates to its instances (Phase 3); exceptions -- steps
     a case has that the backbone lacks -- render below when supplied (Phase 4).
       opts: { caseCount, backbone, selectedIndex, onSelectBackbone,
               exceptions?, selectedStepId?, onSelectException? } */
  function renderBackboneList(host, opts) {
    opts = opts || {};
    const backbone = opts.backbone || [];
    host.innerHTML = "";
    if (!backbone.length) {
      host.innerHTML = `
        <div class="empty-pane">
          <p><strong>No aligned reading yet.</strong></p>
          <p>The aligned reading lines up the repeating work across the session's cases (tickets). It needs the session split into 2+ cases — detect a case key first, then the consensus steps appear here.</p>
        </div>`;
      return;
    }
    const caseCount = opts.caseCount || 0;
    const frag = document.createDocumentFragment();
    backbone.forEach((e, i) => {
      const row = document.createElement("div");
      const partial = caseCount && e.frequency < caseCount;
      row.className = "backbone-row" + (i === opts.selectedIndex ? " selected" : "");
      row.dataset.bbIndex = String(i);
      row.innerHTML =
        `<span class="bb-seq">${i + 1}</span>` +
        `<span class="bb-name" title="${escapeAttr(e.token)}">${escapeHtml(e.token)}</span>` +
        `<span class="bb-freq${partial ? " partial" : ""}" title="In ${e.frequency} of ${caseCount} cases">${e.frequency}/${caseCount}</span>`;
      row.addEventListener("click", () => opts.onSelectBackbone && opts.onSelectBackbone(i));
      frag.appendChild(row);
    });
    host.appendChild(frag);

    // Phase 4: exceptions -- steps a case has that the consensus does not.
    const exceptions = opts.exceptions || [];
    if (exceptions.length) {
      const sec = document.createElement("div");
      sec.className = "bb-exceptions";
      sec.innerHTML =
        `<div class="bb-exc-head" title="Steps a single case has that the consensus backbone does not — an exception ticket's extra work. Edit each one in place.">` +
          `Exceptions · ${exceptions.length}</div>`;
      const exFrag = document.createDocumentFragment();
      exceptions.forEach((ex) => {
        const row = document.createElement("div");
        row.className = "bb-exc-row" + (ex.stepId === opts.selectedStepId ? " selected" : "");
        row.dataset.stepId = ex.stepId;
        row.innerHTML =
          `<span class="bb-inst-case" title="Case (ticket): ${escapeAttr(ex.caseId || "")}">${escapeHtml(ex.caseLabel || ex.caseId || "")}</span>` +
          `<span class="bb-name" title="${escapeAttr(ex.token)}">${escapeHtml(ex.token)}</span>`;
        row.addEventListener("click", () => opts.onSelectException && opts.onSelectException(ex.stepId));
        exFrag.appendChild(row);
      });
      sec.appendChild(exFrag);
      host.appendChild(sec);
    }
  }

  /* ADR-0015 Phase 2/3: the consensus-step detail. Shows the backbone step's
     frequency and its aligned instances across cases (each with a jump to the
     Flow view). Phase 3 adds the curate form (name / description / flags) seeded
     from a representative instance and an "Apply to all instances" button that
     propagates the curation to every member in ONE write (one Ctrl+Z).
       entry: { token, frequency, members } (or null for the empty hint)
       opts:  { caseCount, instances:[{caseId, step}], seed:{name,description,flags},
                onJump, onApply } */
  function renderBackboneDetail(host, entry, opts) {
    opts = opts || {};
    if (!entry) {
      host.innerHTML = `
        <div class="empty-pane">
          <p>Pick a step in the consensus backbone to see its instances across cases, then curate one name + flags and apply to all.</p>
          <p class="meta">Steps below the backbone are <strong>exceptions</strong> — one case's extra work. Select an exception to edit it in place.</p>
        </div>`;
      return;
    }
    const caseCount = opts.caseCount || 0;
    const partial = caseCount && entry.frequency < caseCount;
    const instances = opts.instances || [];
    const seed = opts.seed || {};
    const flags = seed.flags || {};
    const instHtml = instances.map((it) => {
      const sid = it.step ? it.step.step_id : "";
      const nm = (it.step && it.step.name) || "(unnamed)";
      const tm = it.step && it.step.time_range ? localTime(it.step.time_range.start) : "";
      return `<li class="bb-instance" data-step-id="${escapeAttr(sid)}">` +
        `<span class="bb-inst-case" title="Case (ticket): ${escapeAttr(it.caseId || "")}">${escapeHtml(it.caseLabel || it.caseId || "")}</span>` +
        `<span class="bb-inst-name" title="${escapeAttr(nm)}">${escapeHtml(nm)}</span>` +
        `<span class="bb-inst-time">${escapeHtml(tm)}</span>` +
        `<button type="button" class="bb-inst-jump" data-step-id="${escapeAttr(sid)}" title="Jump to this instance in the Flow view">Flow ▸</button>` +
        `</li>`;
    }).join("");
    // The curate form + Apply button only render when the caller wires onApply
    // (ADR-0015 Phase 3). Phase 2 is a read-only reading: head + instances only,
    // so no inert control is shown.
    const curateHtml = opts.onApply ? `
      <label>Name <input type="text" id="bb-name" value="${escapeAttr(seed.name || entry.token)}"></label>
      <label>Description <textarea id="bb-desc">${escapeHtml(seed.description || "")}</textarea></label>
      <div class="flags">
        <label title="This step shouldn't be necessary (rework, duplicate effort, copy-paste between systems). Feeds the value-add / waste analysis."><input type="checkbox" id="bb-flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
      </div>
      <p class="meta">Exception paths come from the observed variants, automation candidacy from coherent segments (Analysis), and conditionality from the map's branch frequency — none are per-step toggles (ADR-0027).</p>
      <div class="actions">
        <button id="btn-bb-apply" class="primary" title="Apply this name, description and flags to all ${instances.length} aligned instance(s) across cases — one edit, one Ctrl+Z.">Apply to all ${instances.length} instances</button>
      </div>` : "";
    host.innerHTML = `
      <div class="bb-detail-head">
        <div class="bb-detail-title" title="The shared step name (ticket/order values stripped out)">${escapeHtml(entry.token)}</div>
        <div class="bb-detail-freq${partial ? " partial" : ""}">Seen in ${entry.frequency} of ${caseCount} cases</div>
      </div>
      <p class="meta">${partial
        ? "Not in every case — review whether it belongs in the consensus before applying."
        : "In every case — the consensus backbone for this process."}</p>
      ${curateHtml}
      <div class="bb-instances">
        <div class="bb-instances-title">Aligned instances (${instances.length})</div>
        <ol class="bb-instance-list">${instHtml}</ol>
      </div>`;
    host.querySelectorAll(".bb-inst-jump").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (opts.onJump) opts.onJump(b.dataset.stepId);
    }));
    const applyBtn = document.getElementById("btn-bb-apply");
    if (applyBtn) applyBtn.addEventListener("click", () => {
      if (!opts.onApply) return;
      opts.onApply({
        name: document.getElementById("bb-name").value.trim(),
        description: document.getElementById("bb-desc").value.trim(),
        // ADR-0027: waste is the only per-step flag. Spread any existing seed
        // flags so legacy keys are preserved-but-untouched (ignored downstream),
        // and only the waste toggle is authored here -- mirrors renderStepDetail.
        flags: {
          ...flags,
          waste: document.getElementById("bb-flag-waste").checked,
        },
      });
    });
  }

  module.exports = {
    renderStepList, renderStepDetail, renderStepTimeline,
    describeInteraction, renderInteractionList, siKindClass,
    renderBackboneList, renderBackboneDetail,
  };
})();
