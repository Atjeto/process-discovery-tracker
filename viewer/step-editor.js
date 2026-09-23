"use strict";

(function () {
  const TimelineCore = require("./timeline/timeline-core.js");
  const PdtTheme = require("./theme.js");
  const PdtRecognize = require("./recognition.js");
  const { stepChip } = require("./runs-model.js");
  const TM = require("./transcript-model.js");
  const { escapeHtml, escapeAttr } = require("./dom.js");   // shared escapers (deduped)
  // One composed human identity line per element (App Library pass, R1). Reused
  // here for the step-detail interaction rows so a control with no accessible
  // name reads as `<ControlType> · "<best identity>" · <window>` with the
  // volatility/weak marker + tooltip -- never a bare automation_id or a raw
  // window title. The matcher stays ground truth; this is presentation only.
  const { identityLine } = require("./identity-line.js");

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

  /* What each step chip means, on hover. */
  const CHIP_TITLES = {
    draft: "Draft: the recorder drafted this step and it has not been checked yet. Confirm run accepts it as it is.",
    confirmed: "Confirmed: you accepted the drafted step as it is.",
    edited: "Edited: you changed this step (its name, its boundaries or its flags).",
    added: "Added: you added this step by hand.",
    hidden: "Hidden: you took this step out. Unhide it from its menu.",
  };

  /* The step rows of one run (steps-view.js renders the runs around them).
     A row: the multi-select tick, the name (double-click to rename, with the
     shared name suggestions), a remembered-name tag on a draft that took a
     name given before, the waste badge, the state chip and the duration.
       opts: { nameListId, onBeginRename(step), emptyHtml } */
  function renderStepList(host, steps, selectedId, onSelect, onMultiSelect, onInlineRename, multiSelectedSet, onContextMenu, opts) {
    const o = opts || {};
    host.innerHTML = "";
    if (!steps || !steps.length) {
      host.innerHTML = o.emptyHtml || `
        <div class="empty-pane">
          <p><strong>No steps yet.</strong></p>
          <p>Steps appear after you click <em>Analyze session</em>.</p>
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
      row.dataset.state = s.state || "";
      // A3: analyst flag badges -- marking a step now visibly shows in the list.
      const _f = s.flags || {};
      // Only the value-add judgment is a genuine PER-STEP property. Exception
      // path / automation candidate / conditional were retired (ADR-0027): they
      // describe a PATH or a multi-step SEGMENT, not a single step — exceptions
      // come from the observed variants, automation candidacy from coherent
      // segments (ADR-0016), conditionality from the map's branch frequency.
      const flagBadges =
        (_f.waste ? '<span class="step-flag flag-waste" title="Waste: should not be needed">W</span>' : "");
      // RP-11: a draft that took a name the analyst gave before says where its
      // name came from, so it is not mistaken for a name given here.
      const remembered = (s.name_source === "remembered" && (s.state === "auto_suggested" || s.state === "confirmed"))
        ? '<span class="step-remembered" title="Named from a name you gave before">remembered</span>'
        : "";
      const chip = stepChip(s.state);
      // R1 (Steps chrome diet): a truncated name (the list ellipsizes) must be
      // readable on hover, so the title shows the FULL name; the rename hint
      // rides after it. There are no per-row reorder buttons: the list is in
      // time order. The multi-select check stays (a genuine per-row act for
      // merge and bulk delete).
      const _nameTitle = (s.name ? s.name + " - " : "") + "double-click to rename";
      row.innerHTML = `
        <span class="multi-check" title="Click to select for merge or to hide several steps at once"></span>
        <span class="step-name" title="${escapeAttr(_nameTitle)}" tabindex="-1">${escapeHtml(s.name)}</span>
        ${remembered}${flagBadges}
        <span class="step-chip step-chip-${escapeAttr(chip.cls)}" title="${escapeAttr(CHIP_TITLES[chip.cls] || "")}">${escapeHtml(chip.label)}</span>
        <span class="step-time">${escapeHtml(stepDuration(s.time_range))}</span>
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
      // Right-click a row for the full step context menu (Split / Merge /
      // Rename / Hide / Jump / flags), the same menu the Steps timeline
      // blocks open.
      if (onContextMenu) {
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(s.step_id, e.clientX, e.clientY);
        });
      }
      const nameEl = row.querySelector(".step-name");
      nameEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        // The first click of a double-click selects the row, and selecting
        // re-renders the list, so this row can be detached by now (the
        // browser still delivers dblclick to it). Rename the row that is on
        // screen for this step, or the input would open where nobody sees it.
        let target = nameEl;
        if (!nameEl.isConnected) {
          const live = Array.from(document.querySelectorAll(".step-row")).find((r) => r.dataset.stepId === s.step_id);
          target = (live && live.querySelector(".step-name")) || nameEl;
        }
        if (o.onBeginRename) o.onBeginRename(s);
        beginInlineRename(target, s, onInlineRename, steps, o.nameListId);
      });
      host.appendChild(row);
    }
  }

  function beginInlineRename(nameEl, step, onInlineRename, allSteps, nameListId) {
    if (!nameEl || nameEl.querySelector("input")) return;
    const original = step.name || "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = original;
    input.className = "step-name-edit";
    // C4: suggest remembered names and the names already used in the session.
    if (nameListId) input.setAttribute("list", nameListId);
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

  /* R1 triage economics (APPROACHABILITY-REDESIGN-2026-07-03 §3-5): a real
     session carries ~500 auto steps and only ~10-15 ever matter for the memo,
     so any per-step ask is multiplied by 500 -- empty fields read as owed
     work. RESIDENT (zero-click, disclosure Memo altitude): the name (inline-
     editable), the one-line facts (duration, app/screen, case), and the three
     primary one-click acts that already existed (Hide/Unhide, the Waste flag,
     the name edit) -- nothing else. Everything else the panel used to show at
     equal weight (description, interaction evidence, screenshot count,
     classification detail, split/merge/jump/watch/
     propagate/delete) moves behind ONE native <details> expansion ("More ▸"),
     collapsed by default and NOT persisted per step -- renderStepDetail is
     called fresh on every selection change, so a re-render always starts
     collapsed (the default stance is triage, per the brief). This mirrors
     the disclosure model's expand-in-place mechanic (same <details> +
     ::-webkit-details-marker suppression + CSS-only chevron as
     .analysis-module in analysis-view.js/styles.css) -- Evidence altitude,
     one click, stays on page, no navigation. */
  function renderStepDetail(host, step, callbacks) {
    if (!step) {
      host.innerHTML = `
        <div class="empty-pane">
          <p>Pick a step on the left to see its details, rename it, or flag it.</p>
          <p class="meta">Each step has a name, an optional description, a list of UI interactions that made it up, and a <strong>Waste</strong> flag: mark a step as waste when it shouldn't be needed (rework, duplicate effort, copy-paste between systems); it feeds the value-add / efficiency analysis.</p>
          <p class="meta">Process variations / exception paths come from the observed <em>variants</em>, automation candidacy from coherent <em>segments</em> (Analysis), and conditionality from the map's branch frequency. None are per-step toggles.</p>
        </div>`;
      return;
    }
    const flags = step.flags || {};
    const _tr = step.time_range || {};
    const _dur = stepDuration(_tr) || "-";
    const _start = _tr.start ? escapeHtml(localTime(_tr.start)) : "-";
    const _end = _tr.end ? escapeHtml(localTime(_tr.end)) : "-";
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
    // P0.1: merge is the inverse of split, shown right beside it. "Merge with
    // next" always merges this step + the following one; the count-labelled
    // "Merge N selected" appears only when 2+ steps are ticked, so one button
    // never silently does two things.
    const mergeSelCount = (callbacks && callbacks.multiSelectedCount) || 0;
    const mergeSelectedBtn = mergeSelCount >= 2
      ? `<button id="btn-step-merge-selected" title="Merge the ${mergeSelCount} ticked steps into one">Merge ${mergeSelCount} selected</button>`
      : "";
    // Resident one-line facts: duration/start/end (unchanged) plus the R1
    // app/screen + run facts threaded in from steps-view.js (a step with
    // neither resolves to no chip, never a placeholder "(app)").
    const appScreenFact = (callbacks && callbacks.appScreenFact) || "";
    const runLabel = (callbacks && callbacks.runLabel) || "";
    const factTiles =
      (appScreenFact ? `<div class="stat-tile"><div class="stat-tile-label">App / Screen</div><div class="stat-tile-value" title="${escapeAttr(appScreenFact)}">${escapeHtml(appScreenFact)}</div></div>` : "") +
      (runLabel ? `<div class="stat-tile"><div class="stat-tile-label">Run</div><div class="stat-tile-value" title="${escapeAttr(runLabel)}">${escapeHtml(runLabel)}</div></div>` : "");
    // C4: the name input suggests remembered and already-used names.
    const nameList = (callbacks && callbacks.nameListId) ? ` list="${escapeAttr(callbacks.nameListId)}"` : "";
    const isHidden = step.state === "hidden";
    // Item 5 (L12b): a drafted step is hidden, never deleted (the next Analyze
    // would draft it again; a hidden one stays out). Only a step the analyst
    // added has Delete.
    const isAdded = step.state === "manually_authored";
    host.innerHTML = `
      <div class="step-stat-tiles">
        <div class="stat-tile"><div class="stat-tile-label">Duration</div><div class="stat-tile-value">${escapeHtml(_dur)}</div></div>
        <div class="stat-tile"><div class="stat-tile-label">Start</div><div class="stat-tile-value">${_start}</div></div>
        <div class="stat-tile"><div class="stat-tile-label">End</div><div class="stat-tile-value">${_end}</div></div>
        ${factTiles}
      </div>
      <label>Name <input type="text" id="step-name" value="${escapeAttr(step.name)}"${nameList}></label>
      <div class="flags">
        <label title="This step shouldn't be necessary (rework, duplicate effort, copy-paste between systems). Feeds the value-add / waste analysis and surfaces in the aggregate as 'waste hotspots'."><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
      </div>
      <div class="actions">
        <button id="btn-step-save" class="primary">Save</button>
        <button id="btn-step-hide" title="${isHidden ? "Bring this step back into the list" : "Take this step out. Every analysis keeps it out; Show hidden steps on its run lists it again."}">${isHidden ? "Unhide" : "Hide step"}</button>
      </div>
      <details class="step-detail-more">
        <summary class="step-detail-more-head">
          <span class="step-detail-more-title">More</span>
          <span class="step-detail-more-chevron" aria-hidden="true"></span>
        </summary>
        <div class="step-detail-more-body">
          ${step.suggestion_reason ? `<p class="step-suggestion-reason" title="Why the tool grouped these interactions into a step">Auto-detected: ${escapeHtml(step.suggestion_reason)}</p>` : ""}
          <label>Description <textarea id="step-desc">${escapeHtml(step.description || "")}</textarea></label>
          ${saidDuringStepHtml(callbacks && callbacks.transcriptSaid, step.description || "")}
          <div class="evidence">
            ${interListHtml}
            <p>${(step.evidence && step.evidence.screenshot_refs || []).length} screenshots</p>
          </div>
          <div class="actions">
            <button id="btn-step-jump" title="Switch to Flow view and seek the video/timeline to the start of this step">Jump to in Flow</button>
            ${(callbacks && callbacks.recordingAvailable) ? '<button id="btn-step-watch" title="Play the recording across this step\'s time range">▶ Watch</button>' : ""}
            <button id="btn-step-split" title="${escapeAttr(splitBtnTitle)}">${splitBtnLabel}</button>
            <button id="btn-step-merge" title="Merge this step with the next step of its run (the inverse of Split)">Merge with next</button>
            ${mergeSelectedBtn}
            ${isAdded ? '<button id="btn-step-delete" class="danger" title="Delete this step you added">Delete</button>' : ""}
          </div>
        </div>
      </details>`;
    document.getElementById("btn-step-save").addEventListener("click", () => {
      if (!callbacks.onSave) return;
      const descEl = document.getElementById("step-desc");
      callbacks.onSave({
        ...step,
        name: document.getElementById("step-name").value.trim(),
        description: descEl ? descEl.value.trim() : (step.description || ""),
        flags: {
          ...flags,
          waste: document.getElementById("flag-waste").checked,
        },
        state: step.state === "manually_authored" ? "manually_authored" : "edited",
      });
    });
    wireSaidDuringStep(host, callbacks && callbacks.transcriptSaid);
    const deleteBtn = document.getElementById("btn-step-delete");
    if (deleteBtn) deleteBtn.addEventListener("click", () =>
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
  }

  /* C8: "Said during this step", under the Description, only while a
     transcript is attached. `said` is null (no transcript), { synced: false }
     or { synced: true, sentences } (the sentences of the step's window,
     transcript-model.sentencesForStep). Add puts a sentence's text in the
     Description box; the editor's own Save keeps it, like typed text. */
  function _addTitle(added) {
    return added ? "The description already holds this sentence"
      : "Add this sentence to the description. Edit it there, then click Save.";
  }
  function saidDuringStepHtml(said, description) {
    if (!said) return "";
    let body;
    if (!said.synced) body = `<p class="tr-note">${escapeHtml(TM.NOT_SYNCED_LINE)}</p>`;
    else if (!said.sentences.length) body = `<p class="tr-note">Nothing was said during this step.</p>`;
    else {
      body = `<ol class="tr-list">` + said.sentences.map((s) => {
        const added = TM.isAdded(description, s.text);
        return `<li class="tr-row">${TM.sentenceRowHtml(s)}` +
          `<button type="button" class="tr-add" data-seg="${escapeAttr(s.id)}" title="${escapeAttr(_addTitle(added))}"${added ? " disabled" : ""}>${added ? "Added" : "Add"}</button></li>`;
      }).join("") + `</ol>`;
    }
    return `<details class="tr-more" id="step-said" open>` +
      `<summary class="tr-more-head"><span class="tr-more-title">Said during this step</span>` +
      `<span class="tr-more-chevron" aria-hidden="true"></span></summary>` +
      `<div class="tr-more-body">${body}</div></details>`;
  }
  function wireSaidDuringStep(host, said) {
    const desc = document.getElementById("step-desc");
    if (!said || !said.synced || !desc) return;
    const byId = new Map(said.sentences.map((s) => [s.id, s]));
    const buttons = Array.from(host.querySelectorAll("#step-said .tr-add"));
    const refresh = () => buttons.forEach((b) => {
      const s = byId.get(b.dataset.seg);
      const added = !!s && TM.isAdded(desc.value, s.text);
      b.disabled = added;
      b.textContent = added ? "Added" : "Add";
      b.title = _addTitle(added);
    });
    buttons.forEach((b) => b.addEventListener("click", () => {
      const s = byId.get(b.dataset.seg);
      if (!s) return;
      desc.value = TM.appendText(desc.value, s.text);
      refresh();
    }));
    desc.addEventListener("input", refresh);
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
      const keys = n > 1 ? ` - ${n} keystrokes` : "";
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

  /* The one composed human identity line for an interaction row, via the
     shared identityLine (App Library pass): `<ControlType> · "<best identity>"
     · <window>` with the volatility/weak marker rendered as a tooltip'd glyph.
     The event's own `data` blob carries exactly the signature fields
     identityLine reads (control_type / automation_id / name / class_name /
     window_title), so it is passed straight through. Kept alongside the action
     verb (describeInteraction) so a row reads "what happened" AND "on which
     control" -- the identity replaces the old raw automation_id / window-title
     fallback, not the verb. Returns "" when there is no identity worth a second
     line (an unidentified control still gets the muted marker). */
  function interactionIdentityHtml(ev) {
    const data = (ev && ev.data) || {};
    const line = identityLine(data);
    const marker = line.marker
      ? `<span class="si-marker si-marker-${escapeAttr(line.marker.kind)}" title="${escapeAttr(line.marker.note)}">${line.marker.kind === "volatile" ? "⚠" : "?"}</span>`
      : "";
    // Identity text (ellipsized) + the marker glyph share one inline row so the
    // marker sits right after the identity, not wrapped to its own line.
    return `<span class="si-idrow"><span class="si-identity" title="${escapeAttr(line.text)}">${escapeHtml(line.text)}</span>${marker}</span>`;
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
        `<span class="si-body">` +
          `<span class="si-text">${escapeHtml(describeInteraction(ev))}</span>` +
          interactionIdentityHtml(ev) +
        `</span>` +
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

  module.exports = {
    renderStepList, renderStepDetail, renderStepTimeline,
    describeInteraction, renderInteractionList, siKindClass,
  };
})();
