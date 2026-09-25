"use strict";

(function () {
  const PdtRecognize = require("./recognition.js");
  const { stepChip } = require("./runs-model.js");
  const TM = require("./transcript-model.js");
  const StepFlow = require("./step-flow.js");
  const { escapeHtml, escapeAttr, sinceStart } = require("./dom.js");
  // A step's time on screen ("42s", "2:17", "1h04"), the fact line's too.
  const { duration: stepDuration } = require("./step-facts.js");
  // C21: the activities the name field's picker keeps as the analyst types.
  const { filterActivities } = require("./library.js");
  // One composed human identity line per element (App Library pass, R1). Reused
  // here for the step-detail interaction rows so a control with no accessible
  // name reads as `<ControlType> · "<best identity>" · <window>` with the
  // volatility/weak marker + tooltip -- never a bare automation_id or a raw
  // window title. The matcher stays ground truth; this is presentation only.
  const { identityLine } = require("./identity-line.js");

  /* True while the step pane is being drawn again: a field removed from the
     page then must not save what it held (a blur during the redraw). */
  let _rendering = false;

  /* A double-click renames the row its FIRST click landed on. That click
     selects the row and the list is drawn again; the step panel may open
     beside it, the list narrows and the rows move down, so the second click
     can land on the row above (or on no row at all). `_firstClick` is that
     first click, { stepId, at, onName }; the second click of the pair does
     not select another row, and the double-click renames the row of the
     first click wherever it is now. Only the analyst's own clicks count: a
     rename started from the keyboard or a menu is a made-up double-click on
     the row it names. */
  let _firstClick = null;
  const DOUBLE_CLICK_MS = 800;
  function _pairedWith(e) {
    const f = _firstClick;
    return f && e && e.isTrusted && e.timeStamp - f.at >= 0 && e.timeStamp - f.at <= DOUBLE_CLICK_MS ? f : null;
  }
  function _liveRow(stepId) {
    return Array.from(document.querySelectorAll(".step-row")).find((r) => r.dataset.stepId === stepId) || null;
  }
  // Every first click forgets the last one; a row's own click then records
  // itself (the capture phase runs before the row's handler).
  if (typeof document !== "undefined") document.addEventListener("click", (e) => {
    if (e.isTrusted && e.detail <= 1) _firstClick = null;
  }, true);
  if (typeof document !== "undefined") document.addEventListener("dblclick", (e) => {
    let row = null;
    if (e.isTrusted) {
      // The analyst's double-click: the row whose name took its first click
      // (none when that click was elsewhere, a row's "▸ N sub-steps" say).
      const f = _pairedWith(e);
      row = f && f.onName ? _liveRow(f.stepId) : null;
    } else {
      const nameEl = e.target && e.target.closest ? e.target.closest(".step-row .step-name") : null;
      row = nameEl ? nameEl.closest(".step-row") : null;
    }
    _firstClick = null;
    if (!row || typeof row._pdtBeginRename !== "function") return;
    e.stopPropagation();
    row._pdtBeginRename();
  });

  /* What each step chip means, on hover. */
  const CHIP_TITLES = {
    draft: "Draft: the recorder drafted this step and it has not been checked yet. On the reference transaction, Confirm transaction accepts it as it is.",
    confirmed: "Confirmed: you accepted the drafted step as it is.",
    edited: "Edited: you changed this step (its name, its boundaries or its flags).",
    added: "Added: you added this step by hand.",
    hidden: "Hidden: you took this step out. Unhide it from its menu.",
  };

  /* The step rows of one run (steps-view.js renders the runs around them).
     A row: the multi-select tick (shown on hover or once ticked), the name
     (double-click to rename, with the shared name suggestions), the waste
     tag, the state chip and the duration (the run says in one line how many
     steps were named for the analyst: from the project's library, or from
     the name given to the same drafted step elsewhere in the project). P1.9: a row carries a chip only
     where it differs from its run: `opts.baseline` is the chip class the run's
     status stands for ("draft" or "confirmed"), and a row whose chip is that
     class shows none (the run's own status says it). Without a baseline (the
     steps outside runs) every row shows its chip. A sub-process row (C19)
     carries "▸ N sub-steps", which opens its level.
       opts: { nameListId, onBeginRename(step), emptyHtml, baseline,
               subSteps(step) (its visible sub-steps counted, null for a
               plain step), onOpenSub(step), readOnly (lane HV: a hand-off
               opened read only, where a row is neither renamed nor
               ticked) } */
  function renderStepList(host, steps, selectedId, onSelect, onMultiSelect, onInlineRename, multiSelectedSet, onContextMenu, opts) {
    const o = opts || {};
    host.innerHTML = "";
    if (!steps || !steps.length) {
      host.innerHTML = o.emptyHtml || `
        <div class="empty-pane">
          <p><strong>No steps yet.</strong></p>
          <p>Steps appear once the recording is analyzed.</p>
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
      row.dataset.state = s.state || "";
      // Waste is the only per-step flag (ADR-0027): a small tag, never a
      // strikethrough (which read as removed).
      const flagBadges = (s.flags && s.flags.waste)
        ? '<span class="step-tag-waste" title="Flagged as waste: this step should not be needed">Waste</span>' : "";
      const chip = stepChip(s.state);
      const chipHtml = (o.baseline && chip.cls === o.baseline) ? ""
        : `<span class="step-chip step-chip-${escapeAttr(chip.cls)}" title="${escapeAttr(CHIP_TITLES[chip.cls] || "")}">${escapeHtml(chip.label)}</span>`;
      // R1 (Steps chrome diet): a truncated name (the list ellipsizes) must be
      // readable on hover, so the title shows the FULL name; the rename hint
      // rides after it. There are no per-row reorder buttons: the list is in
      // time order. The multi-select check stays (a genuine per-row act for
      // merge and bulk delete).
      const _nameTitle = (s.name ? s.name + " - " : "") + "double-click to rename";
      // C19: a sub-process carries the way into it, its sub-steps counted.
      const subCount = typeof o.subSteps === "function" ? o.subSteps(s) : null;
      const subHtml = Number.isInteger(subCount)
        ? `<button type="button" class="step-sub-open" title="Open this sub-process: its steps, in every transaction that goes through it">▸ ${subCount} ${subCount === 1 ? "sub-step" : "sub-steps"}</button>`
        : "";
      row.innerHTML = `
        <span class="multi-check" title="Click to select for merge or to hide several steps at once"></span>
        <span class="step-name" title="${escapeAttr(_nameTitle)}" tabindex="-1">${escapeHtml(s.name)}</span>
        ${subHtml}${flagBadges}${chipHtml}
        <span class="step-time">${escapeHtml(stepDuration(s.time_range))}</span>
      `;
      if (subHtml) {
        row.dataset.subProcess = "true";
        row.querySelector(".step-sub-open").addEventListener("click", (e) => {
          e.stopPropagation();
          if (o.onOpenSub) o.onOpenSub(s);
        });
      }
      row.addEventListener("click", (e) => {
        // The second click of a double-click that began elsewhere (another
        // row, when the list moved under the pointer, or a button that
        // redrew the list) selects nothing: the double-click renames the row
        // its first click landed on, if any.
        if (e.isTrusted && e.detail > 1) {
          const paired = _pairedWith(e);
          if (!paired || paired.stepId !== s.step_id) return;
        }
        if (e.isTrusted && e.detail <= 1) {
          _firstClick = { stepId: s.step_id, at: e.timeStamp, onName: !!(e.target && e.target.closest && e.target.closest(".step-name")) };
        }
        if (e.ctrlKey || e.metaKey) {
          if (onMultiSelect) onMultiSelect(s.step_id);
        } else if (onSelect) {
          onSelect(s.step_id);
        }
      });
      // A plain click on the tick box toggles multi-selection (no Ctrl
      // needed); stopPropagation so it doesn't also fire row-select. P2.14:
      // the box shows on hover and on a ticked row only (styles.css).
      const checkEl = row.querySelector(".multi-check");
      checkEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onMultiSelect && !o.readOnly) onMultiSelect(s.step_id);
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
      // A double-click on the name renames the step (the document's dblclick
      // listener above picks the row; this is how it starts the rename).
      row._pdtBeginRename = () => {
        const nameEl = row.querySelector(".step-name");
        if (!nameEl || o.readOnly) return;
        if (o.onBeginRename) o.onBeginRename(s);
        beginInlineRename(nameEl, s, onInlineRename, steps, o.nameListId);
      };
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
    // The names already used in the project.
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

  /* Why Split cannot act on a step, in the analyst's words, or "" when it
     can (lane FX3, validation pass 3, F16): Split cuts a step between two
     of its recorded actions (a click, a field typed), so it needs two. The
     step pane offers it disabled with this reason; the step menu leaves it
     out; its key says it. */
  function splitBlocker(step) {
    const n = ((step && step.evidence && step.evidence.interaction_event_ids) || []).length;
    if (n >= 2) return "";
    return n === 1
      ? "Only one action (a click, a field typed) was recorded in this step, so it cannot be split."
      : "No action (a click, a field typed) was recorded in this step, so it cannot be split. + Add step adds a step beside it.";
  }

  /* The fields typed in the step, as a compact list: [{ field, value }]. */
  function stepFieldsHtml(fields) {
    if (!Array.isArray(fields) || !fields.length) return "";
    return `<div class="step-fields"><span class="step-fields-title">Fields typed</span><dl>` +
      fields.map((f) => `<dt title="${escapeAttr(f.field)}">${escapeHtml(f.field)}</dt><dd title="${escapeAttr(f.value)}">${escapeHtml(f.value)}</dd>`).join("") +
      `</dl></div>`;
  }

  /* The selected step's editor (P1.7; companion critique, section 3): what
     the analyst edits and what the PDD prints, resident; the rest one click
     away. Nothing waits for a Save button: the name saves on Enter or when
     the field is left, the description when it is left, Waste on its click;
     each is one undoable edit.
       resident: one fact line (the system, the screen, the time, where a
         draft ends, where the step is in the recording), the name, the
         fields typed, the Description (the text the PDD prints under the
         step, C7; the drafting's own narration is its hint, not its text)
         with "Said during this step" under it while a transcript is
         attached, the Flow line (C17: Only when and Go to), Waste, Watch
         (with a video: it plays the step in the step panel), Hide and (C19)
         Open as a sub-process, or on a sub-process Open sub-process and
         Dissolve sub-process, and the step's screenshots;
       "More" (a native <details>, collapsed on every selection): the
         interactions the step is made of, Show on timeline, Split, Merge with
         next, Merge selected (on a sub-process one line saying why neither
         applies), Delete (added steps only).
     Callbacks (steps-view.js stepDetailCallbacks) carry the verbs, the fact
     line, the fields, the description and its hint, (C16) the System field
     and the screenshots, notes and attachments (views/analyst-ui.js), and
     (C21) the name field's picker: `picker` (library.js pickerFor) and
     onPickActivity(stepId, activityId). */
  function renderStepDetail(host, step, callbacks) {
    _rendering = true;
    try { _renderStepDetail(host, step, callbacks || {}); } finally { _rendering = false; }
  }
  function _renderStepDetail(host, step, callbacks) {
    const flags = step.flags || {};
    const interMap = (callbacks && callbacks.interactionsById) || {};
    const interIds = (step.evidence && step.evidence.interaction_event_ids) || [];
    const resolvedInter = interIds.map((id) => interMap[id]).filter(Boolean);
    // A2: a boundary index chosen by the analyst (split AFTER this index).
    const splitAfterIndex = (callbacks && Number.isInteger(callbacks.splitAfterIndex))
      ? callbacks.splitAfterIndex : null;
    // C19: a sub-process is not split or merged (its steps are, inside it).
    const sub = callbacks.subProcess || null;
    const interListHtml = renderInteractionList(resolvedInter, interIds.length,
      { splittable: !sub, splitAfterIndex, originMs: callbacks.originMs });
    const _hasSplitPoint = splitAfterIndex !== null;
    const splitBtnLabel = _hasSplitPoint ? "Split here" : "Split";
    const splitBtnTitle = _hasSplitPoint
      ? "Split this step after action " + (splitAfterIndex + 1)
      : "Split this step in two. Click the scissors after an action to choose where; otherwise it splits at the midpoint.";
    // P0.1: merge is the inverse of split, shown right beside it. "Merge with
    // next" always merges this step + the following one; the count-labelled
    // "Merge N selected" appears only when 2+ steps are ticked, so one button
    // never silently does two things.
    const mergeSelCount = (callbacks && callbacks.multiSelectedCount) || 0;
    const mergeSelectedBtn = mergeSelCount >= 2
      ? `<button id="btn-step-merge-selected" title="Merge the ${mergeSelCount} ticked steps into one">Merge ${mergeSelCount} selected</button>`
      : "";
    const fact = callbacks.factLine || "";
    const isHidden = step.state === "hidden";
    // Item 5 (L12b): a drafted step is hidden, never deleted (the next Analyze
    // would draft it again; a hidden one stays out). Only a step the analyst
    // added has Delete.
    const isAdded = step.state === "manually_authored";
    // The analyst's description; a draft's narration is only its hint.
    const desc = typeof callbacks.description === "string" ? callbacks.description : (step.description || "");
    const hint = callbacks.descriptionHint || "The text the PDD prints under this step";
    const watchBtn = callbacks.recordingAvailable
      ? `<button id="btn-step-watch" title="Play this step in the video of the step panel">▶ Watch</button>` : "";
    // C19: the way into a sub-process and its inverse, or the verb that makes
    // one of this step.
    const subBtns = sub
      ? `<button id="btn-step-open-sub" title="Show the ${sub.count} ${sub.count === 1 ? "step" : "steps"} of this sub-process, in every transaction that goes through it">▸ Open sub-process</button>` +
        `<button id="btn-step-dissolve" title="${escapeAttr(sub.group
          ? "Put its steps back in its place, in every transaction. Ctrl+Z undoes it."
          : "Drop its sub-steps, in every transaction; what you added to them moves to this step. Ctrl+Z undoes it.")}">Dissolve sub-process</button>`
      : callbacks.canOpenAsSub
        ? `<button id="btn-step-make-sub" title="Give this step its own steps, one per action recorded in it (a field typed, a click), in every transaction where it happens, and show them">Open as a sub-process</button>`
        : "";
    const splitWhy = sub ? "" : splitBlocker(step);
    const moreActs = sub
      ? `<p class="step-sub-note" id="step-sub-note">A sub-process is not split or merged: dissolve it first, or work on its steps inside.</p>`
      : `<button id="btn-step-split" title="${escapeAttr(splitWhy || splitBtnTitle)}"${splitWhy ? " disabled" : ""}>${splitBtnLabel}</button>
            <button id="btn-step-merge" title="Merge this step with the next step of its transaction (the inverse of Split)">Merge with next</button>
            ${mergeSelectedBtn}`;
    host.innerHTML = `
      ${fact ? `<p class="step-fact">${escapeHtml(fact)}</p>` : ""}
      ${nameFieldHtml(step, callbacks.picker)}
      ${callbacks.systemHtml || ""}
      ${stepFieldsHtml(callbacks.fields)}
      <label>Description <textarea id="step-desc" placeholder="${escapeAttr(hint)}" title="Saved when you leave the field">${escapeHtml(desc)}</textarea></label>
      ${saidDuringStepHtml(callbacks.transcriptSaid, desc)}
      ${flowSectionHtml(step, callbacks.flow)}
      <div class="flags">
        <label title="This step should not be needed (rework, duplicate effort, copying between systems). The PDD marks it as waste."><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
      </div>
      <div class="actions">
        ${watchBtn}
        <button id="btn-step-hide" title="${isHidden ? "Bring this step back into the list" : "Take this step out. Every analysis keeps it out; Show hidden steps on its transaction lists it again."}">${isHidden ? "Unhide" : "Hide step"}</button>
        ${subBtns}
      </div>
      ${callbacks.extrasHtml || ""}
      <details class="step-detail-more">
        <summary class="step-detail-more-head">
          <span class="step-detail-more-title">More</span>
          <span class="step-detail-more-chevron" aria-hidden="true"></span>
        </summary>
        <div class="step-detail-more-body">
          <div class="evidence">${interListHtml}</div>
          <div class="actions">
            <button id="btn-step-jump" title="Open the Timeline at the start of this step (the video too, when one is attached)">Show on timeline</button>
            ${moreActs}
            ${isAdded ? `<button id="btn-step-delete" class="danger" title="${escapeAttr(sub && sub.group ? "Delete this sub-process you made, with its steps" : "Delete this step you added")}">Delete</button>` : ""}
          </div>
        </div>
      </details>`;
    // The name saves on Enter or when the field is left; Escape puts it back.
    const nameEl = document.getElementById("step-name");
    const commitName = () => {
      if (_rendering || !nameEl.isConnected) return;
      const v = nameEl.value.trim();
      if (!v) { nameEl.value = step.name || ""; return; }
      if (v !== String(step.name || "").trim() && callbacks.onRename) callbacks.onRename(step.step_id, v);
    };
    // C21: the picker takes its keys first (Up, Down, Enter on a row, Escape
    // on an open list).
    const picker = wireNamePicker(nameEl, step, callbacks);
    nameEl.addEventListener("keydown", (e) => {
      if (picker && picker.onKey(e)) return;
      if (e.key === "Enter") { e.preventDefault(); commitName(); }
      else if (e.key === "Escape") { e.preventDefault(); nameEl.value = step.name || ""; }
    });
    nameEl.addEventListener("blur", commitName);
    // The description saves when the field is left, and when a sentence of
    // the transcript is added to it.
    const descEl = document.getElementById("step-desc");
    let shownDesc = desc.trim();
    const commitDesc = () => {
      if (_rendering || !descEl.isConnected) return;
      const v = descEl.value.trim();
      if (v === shownDesc || !callbacks.onDescription) return;
      shownDesc = v;
      callbacks.onDescription(step.step_id, v);
    };
    descEl.addEventListener("blur", commitDesc);
    document.getElementById("flag-waste").addEventListener("change", () =>
      callbacks.onToggleWaste && callbacks.onToggleWaste(step.step_id));
    wireSaidDuringStep(host, callbacks.transcriptSaid, commitDesc);
    wireFlow(host, step, callbacks);
    // C16: the System field, the screenshots, notes and attachments.
    if (callbacks.wireExtras) callbacks.wireExtras(host, () => _rendering);
    const deleteBtn = document.getElementById("btn-step-delete");
    if (deleteBtn) deleteBtn.addEventListener("click", () =>
      callbacks.onDelete && callbacks.onDelete(step.step_id));
    const hideBtn = document.getElementById("btn-step-hide");
    if (hideBtn) hideBtn.addEventListener("click", () =>
      callbacks.onToggleHide && callbacks.onToggleHide(step.step_id));
    // C19: the sub-process verbs.
    const onClick = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    onClick("btn-step-open-sub", () => callbacks.onOpenSub && callbacks.onOpenSub(step.step_id));
    onClick("btn-step-dissolve", () => callbacks.onDissolve && callbacks.onDissolve(step.step_id));
    onClick("btn-step-make-sub", () => callbacks.onOpenAsSub && callbacks.onOpenAsSub(step.step_id));
    onClick("btn-step-split", () => callbacks.onSplit && callbacks.onSplit(step.step_id));
    // A2: scissors on each interaction pick the split boundary.
    host.querySelectorAll(".si-split-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const after = parseInt(b.dataset.after, 10);
        if (callbacks.onPickSplit && Number.isInteger(after)) callbacks.onPickSplit(after);
      });
    });
    onClick("btn-step-merge", () => callbacks.onMerge && callbacks.onMerge(step.step_id));
    const _mergeSelBtn = document.getElementById("btn-step-merge-selected");
    if (_mergeSelBtn) _mergeSelBtn.addEventListener("click", () =>
      callbacks.onMergeSelected && callbacks.onMergeSelected());
    const jumpBtn = document.getElementById("btn-step-jump");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => callbacks.onJumpToFlow && callbacks.onJumpToFlow(step));
      jumpBtn.disabled = !(step.time_range && step.time_range.start);
    }
    const watchEl = document.getElementById("btn-step-watch");
    if (watchEl) {
      watchEl.addEventListener("click", () => callbacks.onWatchStep && callbacks.onWatchStep(step));
      watchEl.disabled = !(step.time_range && step.time_range.start);
    }
  }

  /* C21: the name field and its picker. The field offers the activities of
     the step's system from the project's library (`picker`, library.js
     pickerFor): a list under the field, opened by a click in it, by typing
     (then it keeps the activities whose name or code holds the text) or by
     the Down key; Up and Down move through it, Enter or a click picks one,
     Escape closes it. Any name can still be typed. With no activity for the
     step's system (or no system yet, on a step added by hand) the field says
     so in one quiet line while it has the focus (styles.css), and no list
     opens. */
  function nameFieldHtml(step, picker) {
    const acts = picker && Array.isArray(picker.activities) ? picker.activities : [];
    const note = picker && picker.note ? `<span class="step-lib-note" id="step-lib-note">${escapeHtml(picker.note)}</span>` : "";
    const title = acts.length
      ? "Pick an activity of " + picker.system + " from the library, or type any name. Saved when you press Enter or leave the field"
      : "Saved when you press Enter or leave the field";
    const combo = acts.length ? ` role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="step-activity-list"` : "";
    return `<div class="step-name-field">` +
      `<label>Name${note}<input type="text" id="step-name" value="${escapeAttr(step.name)}" autocomplete="off"${combo} title="${escapeAttr(title)}"></label>` +
      (acts.length ? `<ul class="step-activity-list" id="step-activity-list" role="listbox" aria-label="${escapeAttr("Activities of " + picker.system)}" hidden></ul>` : "") +
      `</div>`;
  }

  /* The picker's rows: an activity's name, its code and its description; the
     one the step is named from (`current`) marked, the one the keys are on
     (`active`, an index) lit. */
  function activityListHtml(activities, current, active) {
    return (activities || []).map((a, i) =>
      `<li class="step-activity${a.id === current ? " current" : ""}${i === active ? " active" : ""}" role="option" id="step-activity-${i}" data-i="${i}" aria-selected="${i === active}"` +
        (a.description ? ` title="${escapeAttr(a.description)}"` : "") + ">" +
        `<span class="step-activity-name">${escapeHtml(a.name)}</span>` +
        (a.code ? `<span class="step-activity-code">${escapeHtml(a.code)}</span>` : "") +
        (a.description ? `<span class="step-activity-desc">${escapeHtml(a.description)}</span>` : "") +
      "</li>").join("");
  }

  /* Wire the picker of the name field just drawn: { onKey(e) } (true when the
     key was the picker's), or null when there is no list. A pick (a row
     clicked, Enter on the row the keys are on, or Enter on a name typed that
     is an activity's) keeps the focus in the field and calls
     onPickActivity. */
  function wireNamePicker(nameEl, step, callbacks) {
    const picker = callbacks.picker;
    const list = document.getElementById("step-activity-list");
    if (!picker || !list || !(picker.activities || []).length) return null;
    let shown = [], active = -1, typed = false;
    const close = () => {
      list.hidden = true;
      list.innerHTML = "";
      active = -1;
      nameEl.setAttribute("aria-expanded", "false");
      nameEl.removeAttribute("aria-activedescendant");
    };
    const draw = () => {
      shown = filterActivities(picker.activities, typed ? nameEl.value : "");
      if (!shown.length || nameEl.readOnly) { close(); return; }
      if (active >= shown.length) active = shown.length - 1;
      list.innerHTML = activityListHtml(shown, picker.current, active);
      list.hidden = false;
      nameEl.setAttribute("aria-expanded", "true");
      const lit = active >= 0 ? list.querySelector(".step-activity.active") : null;
      if (lit) {
        nameEl.setAttribute("aria-activedescendant", lit.id);
        lit.scrollIntoView({ block: "nearest" });
      } else {
        nameEl.removeAttribute("aria-activedescendant");
      }
    };
    const pick = (a) => {
      if (!a || nameEl.readOnly) return;
      nameEl.value = a.name;
      close();
      if (callbacks.onPickActivity) callbacks.onPickActivity(step.step_id, a.id);
    };
    nameEl.addEventListener("click", () => { if (list.hidden) { typed = false; active = -1; draw(); } });
    nameEl.addEventListener("input", () => { typed = true; active = -1; draw(); });
    nameEl.addEventListener("blur", close);
    // A click on a row picks it; the field keeps the focus meanwhile.
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const li = e.target && e.target.closest ? e.target.closest(".step-activity") : null;
      if (li) pick(shown[Number(li.dataset.i)]);
    });
    // A name typed that is an activity's (case does not matter) is that pick.
    const typedActivity = () => {
      const t = nameEl.value.trim().toLowerCase();
      return t ? picker.activities.find((a) => a.name.trim().toLowerCase() === t) || null : null;
    };
    return {
      onKey(e) {
        if (nameEl.readOnly) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (list.hidden) draw();
          if (!shown.length || list.hidden) return true;
          const n = shown.length;
          active = e.key === "ArrowDown" ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1);
          draw();
          return true;
        }
        if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); pick(shown[active]); return true; }
        if (e.key === "Enter" && typedActivity()) { e.preventDefault(); pick(typedActivity()); return true; }
        if (e.key === "Escape" && !list.hidden) { e.preventDefault(); close(); return true; }
        return false;
      },
    };
  }

  /* C17: the Flow line, under the description. The default after a step is
     the next step of its transaction, so a step with nothing set reads one
     line, "Always · then the next step", with its two acts: "Only when..."
     opens a text field for the step's condition (step.only_when) and "Go
     to..." adds a row: a dropdown of the transaction's steps in order,
     numbered, and "End the process" (the step itself is not offered), with a
     "when" field; the row reads where it goes ("Goes back to step 4, ...,
     when ..."). A condition or a link saves when its field is left or Enter
     is pressed, a target when it is picked; each has Remove. The steps view
     makes each change one undoable edit (callbacks.onFlow*); `callbacks.flow`
     is { onlyWhen, inherited, links: [{ to, when, reading, missing }],
     choices } for a step in a transaction, else null (no Flow line); a step
     without a condition of its own reads the one set on its box in another
     transaction (`inherited`, step-flow.inheritedLine).
     A field opened but not saved yet (Only when... or Go to... clicked) is
     kept here per step, so a redraw of the pane keeps it open. */
  let _flowOpen = { stepId: null, condition: false, link: false };
  let _flowFocus = null;   // { stepId, id }: a field to focus once drawn
  function _flowOpenFor(step) {
    if (_flowOpen.stepId !== step.step_id) {
      _flowOpen = { stepId: step.step_id, condition: false, link: false };
      _flowFocus = null;
    }
    return _flowOpen;
  }

  const FLOW_TITLES = {
    onlyWhen: "This step happens only under a condition. The map draws a decision: the condition on the way into the step and an \"otherwise\" path around it.",
    goTo: "After this step, when a condition holds, the process goes back to an earlier step, skips to a later one or ends.",
    condition: "The condition under which this step happens. Saved when you press Enter or leave the field; empty removes it.",
    removeCondition: "Remove the condition: the step always happens",
    target: "Where the process goes after this step",
    when: "When the process goes there. Saved when you press Enter or leave the field.",
    removeLink: "Remove this link: the next step follows",
    inherited: "A condition holds for this step in every transaction. Change it on the step where it is set.",
  };

  function _targetOptions(choices, selected, missing) {
    const opt = (value, label, on, disabled) => '<option value="' + escapeAttr(value) + '"' +
      (on ? " selected" : "") + (disabled ? " disabled" : "") + ">" + escapeHtml(label) + "</option>";
    let html = selected == null ? opt("", "Choose a step or the end", true, true)
      : missing ? opt(selected, "A step no longer in this transaction", true, true) : "";
    for (const c of choices || []) html += opt(c.value, c.label, c.value === selected, false);
    return html + opt(StepFlow.END, "End the process", selected === StepFlow.END, false);
  }

  function _linkRowHtml(i, link, choices) {
    const isNew = link == null;
    const key = isNew ? "new" : String(i);
    const reading = isNew ? "Choose where the process goes after this step." : link.reading;
    return '<li class="flow-link' + (isNew ? " pending" : "") + '" data-i="' + key + '">' +
      '<span class="flow-link-text">' + escapeHtml(reading) + "</span>" +
      '<span class="flow-link-edit">' +
        '<select class="flow-link-to" id="flow-link-to-' + key + '" aria-label="Goes to" title="' + escapeAttr(FLOW_TITLES.target) + '">' +
          _targetOptions(choices, isNew ? null : link.to, !isNew && link.missing) + "</select>" +
        '<label class="flow-when-label" for="flow-link-when-' + key + '">when</label>' +
        '<input type="text" class="flow-link-when" id="flow-link-when-' + key + '" value="' + escapeAttr(isNew ? "" : link.when) + '"' +
          ' placeholder="for example: the check fails" title="' + escapeAttr(FLOW_TITLES.when) + '"' + (isNew ? " disabled" : "") + ">" +
        '<button type="button" class="link-btn flow-link-remove" title="' + escapeAttr(FLOW_TITLES.removeLink) + '">Remove</button>' +
      "</span></li>";
  }

  function flowSectionHtml(step, flow) {
    if (!flow || !step) return "";
    const open = _flowOpenFor(step);
    const cond = flow.onlyWhen || "";
    const showCond = !!cond || open.condition;
    const links = flow.links || [];
    // A condition set on the same step in another transaction holds here too
    // (C17): it reads as set there, and is changed there.
    const inherited = showCond ? "" : StepFlow.inheritedLine(flow.inherited);
    const lineAttrs = ' id="step-flow-line"' + (inherited ? ' title="' + escapeAttr(FLOW_TITLES.inherited) + '"' : "");
    const line = escapeHtml(inherited || StepFlow.DEFAULT_LINE);
    const onlyBtn = showCond || inherited ? "" : '<button type="button" class="link-btn" id="btn-flow-only-when" title="' +
      escapeAttr(FLOW_TITLES.onlyWhen) + '">Only when…</button>';
    const goBtn = '<button type="button" class="link-btn" id="btn-flow-go-to" title="' + escapeAttr(FLOW_TITLES.goTo) + '">Go to…</button>';
    // Nothing set on the step: one line.
    if (!showCond && !links.length && !open.link) {
      return '<div class="step-sect step-flow" id="step-flow"><div class="step-sect-head step-flow-head">' +
        '<span class="step-sect-title">Flow</span>' +
        '<span class="flow-line"' + lineAttrs + ">" + line + "</span>" +
        onlyBtn + goBtn + "</div></div>";
    }
    const condHtml = showCond
      ? '<div class="flow-cond"><label class="flow-cond-label" for="step-only-when">Only when</label>' +
        '<input type="text" id="step-only-when" value="' + escapeAttr(cond) + '" placeholder="for example: a new customer" title="' +
          escapeAttr(FLOW_TITLES.condition) + '">' +
        '<button type="button" class="link-btn" id="btn-flow-remove-condition" title="' + escapeAttr(FLOW_TITLES.removeCondition) + '">Remove</button></div>' +
        '<p class="flow-line" id="step-flow-line">Then the next step</p>'
      : '<p class="flow-line"' + lineAttrs + ">" + line + "</p>";
    const rows = links.map((l, i) => _linkRowHtml(i, l, flow.choices)).join("") +
      (open.link ? _linkRowHtml(links.length, null, flow.choices) : "");
    return '<div class="step-sect step-flow" id="step-flow"><div class="step-sect-head step-flow-head">' +
      '<span class="step-sect-title">Flow</span>' + onlyBtn + goBtn + "</div>" +
      condHtml + (rows ? '<ol class="flow-links">' + rows + "</ol>" : "") + "</div>";
  }

  /* Wire the Flow line just drawn. A click that only opens or closes a field
     draws the section again by itself; a saved change comes back through the
     steps view's redraw. */
  function wireFlow(host, step, callbacks) {
    const sect = host.querySelector("#step-flow");
    const flow = callbacks.flow;
    if (!sect || !flow) return;
    const open = _flowOpenFor(step);
    const id = step.step_id;
    const redraw = () => {
      const cur = host.querySelector("#step-flow");
      if (!cur) return;
      _rendering = true;
      try {
        const box = document.createElement("div");
        box.innerHTML = flowSectionHtml(step, flow);
        cur.replaceWith(box.firstElementChild);
      } finally { _rendering = false; }
      wireFlow(host, step, callbacks);
    };
    const live = (el) => !_rendering && el && el.isConnected;
    const onClick = (sel, fn) => { const el = sect.querySelector(sel); if (el) el.addEventListener("click", fn); };

    onClick("#btn-flow-only-when", () => {
      open.condition = true;
      _flowFocus = { stepId: id, id: "step-only-when" };
      redraw();
    });
    onClick("#btn-flow-go-to", () => {
      open.link = true;
      _flowFocus = { stepId: id, id: "flow-link-to-new" };
      redraw();
    });

    // The condition: saved on Enter or when left; empty removes it.
    const saved = flow.onlyWhen || "";
    const condEl = sect.querySelector("#step-only-when");
    if (condEl) {
      const commit = () => {
        if (!live(condEl)) return;
        const v = condEl.value.trim();
        if (v === saved) {
          if (!v && open.condition) { open.condition = false; redraw(); }
          return;
        }
        open.condition = false;
        if (callbacks.onFlowCondition) callbacks.onFlowCondition(id, v);
      };
      condEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") {
          e.preventDefault();
          condEl.value = saved;
          if (!saved) { open.condition = false; redraw(); }
        }
      });
      condEl.addEventListener("blur", commit);
    }
    // Remove clears the condition, including one the field saved a moment
    // ago when the click took the focus from it (a pending field just closes).
    onClick("#btn-flow-remove-condition", () => {
      open.condition = false;
      redraw();
      if (callbacks.onFlowCondition) callbacks.onFlowCondition(id, "");
    });

    // The links, and the row being added.
    for (const row of sect.querySelectorAll(".flow-link")) {
      const key = row.dataset.i;
      const isNew = key === "new";
      const i = isNew ? -1 : parseInt(key, 10);
      const link = isNew ? null : (flow.links || [])[i];
      const sel = row.querySelector(".flow-link-to");
      const whenEl = row.querySelector(".flow-link-when");
      const takeTarget = () => {
        if (!live(sel) || !sel.value) return;
        if (isNew) {
          open.link = false;
          _flowFocus = { stepId: id, id: "flow-link-when-" + (flow.links || []).length };
          if (callbacks.onFlowAddLink) callbacks.onFlowAddLink(id, sel.value);
        } else if (link && sel.value !== link.to && callbacks.onFlowLinkTarget) {
          callbacks.onFlowLinkTarget(id, i, sel.value);
        }
      };
      // A pick with the mouse is taken at once. The arrows change a closed
      // dropdown's value as they move, so after a key the pick is taken on
      // Enter or when the dropdown is left; Escape puts it back.
      let keyed = false;
      sel.addEventListener("mousedown", () => { keyed = false; });
      sel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); keyed = false; takeTarget(); }
        else if (e.key === "Escape") { e.preventDefault(); keyed = false; sel.value = isNew ? "" : link.to; }
        else if (!e.altKey && !e.ctrlKey && !e.metaKey) keyed = true;
      });
      sel.addEventListener("change", () => { if (!keyed) takeTarget(); });
      sel.addEventListener("blur", () => { if (keyed) { keyed = false; takeTarget(); } });
      if (!isNew && whenEl) {
        const was = (link && link.when) || "";
        const commitWhen = () => {
          if (!live(whenEl)) return;
          const v = whenEl.value.trim();
          if (v !== was && callbacks.onFlowLinkWhen) callbacks.onFlowLinkWhen(id, i, v);
        };
        whenEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commitWhen(); }
          else if (e.key === "Escape") { e.preventDefault(); whenEl.value = was; }
        });
        whenEl.addEventListener("blur", commitWhen);
      }
      row.querySelector(".flow-link-remove").addEventListener("click", () => {
        if (isNew) { open.link = false; redraw(); return; }
        if (callbacks.onFlowRemoveLink) callbacks.onFlowRemoveLink(id, i);
      });
    }

    if (_flowFocus && _flowFocus.stepId === id) {
      const el = sect.querySelector("#" + _flowFocus.id);
      if (el) { _flowFocus = null; el.focus(); }
    }
  }

  /* C8: "Said during this step", under the Description, only while a
     transcript is attached. `said` is null (no transcript), { synced: false }
     or { synced: true, sentences, originMs } (the sentences of the step's
     window, transcript-model.sentencesForStep, timed from the recording's
     start). Add puts a sentence's text in the Description box and saves it. */
  function _addTitle(added) {
    return added ? "The description already holds this sentence"
      : "Add this sentence to the description. You can edit it there.";
  }
  function saidDuringStepHtml(said, description) {
    if (!said) return "";
    let body;
    if (!said.synced) body = `<p class="tr-note">${escapeHtml(TM.NOT_SYNCED_LINE)}</p>`;
    else if (!said.sentences.length) body = `<p class="tr-note">Nothing was said during this step.</p>`;
    else {
      body = `<ol class="tr-list">` + said.sentences.map((s) => {
        const added = TM.isAdded(description, s.text);
        return `<li class="tr-row">${TM.sentenceRowHtml(s, said.originMs)}` +
          `<button type="button" class="tr-add" data-seg="${escapeAttr(s.id)}" title="${escapeAttr(_addTitle(added))}"${added ? " disabled" : ""}>${added ? "Added" : "Add"}</button></li>`;
      }).join("") + `</ol>`;
    }
    return `<details class="tr-more" id="step-said" open>` +
      `<summary class="tr-more-head"><span class="tr-more-title">Said during this step</span>` +
      `<span class="tr-more-chevron" aria-hidden="true"></span></summary>` +
      `<div class="tr-more-body">${body}</div></details>`;
  }
  function wireSaidDuringStep(host, said, save) {
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
      if (save) save();
    }));
    desc.addEventListener("input", refresh);
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
     · <window>`. The event's own `data` blob carries exactly the signature
     fields identityLine reads (control_type / automation_id / name /
     class_name / window_title), so it is passed straight through. Kept
     alongside the action verb (describeInteraction) so a row reads "what
     happened" AND "on which control". */
  function interactionIdentityHtml(ev) {
    const data = (ev && ev.data) || {};
    const line = identityLine(data);
    return `<span class="si-identity" title="${escapeAttr(line.text)}">${escapeHtml(line.text)}</span>`;
  }

  function renderInteractionList(events, total, opts) {
    // Lane FX3 (validation pass 3, F16): the analyst's words, "action" (a
    // click, a field typed), as Split and Open as a sub-process say it.
    if (!total) return `<p class="meta">No action was recorded in this step.</p>`;
    opts = opts || {};
    // A2: when splittable, every interaction except the last carries a
    // scissors control that picks the boundary the Split action cuts at.
    const splittable = !!opts.splittable && events.length >= 2;
    const splitAfter = Number.isInteger(opts.splitAfterIndex) ? opts.splitAfterIndex : null;
    const rows = events.map((ev, i) => {
      const t = sinceStart(ev.timestamp, opts.originMs);
      const isBoundary = splittable && splitAfter === i;
      const splitBtn = (splittable && i < events.length - 1)
        ? `<button type="button" class="si-split-btn${isBoundary ? " active" : ""}" data-after="${i}" tabindex="-1" title="Split the step here, after this action">&#9988;</button>`
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
        `<span class="si-text meta">${missing === 1 ? "1 recorded action is" : missing + " recorded actions are"} not in this project</span>` +
        `</li>`);
    }
    return `<details class="step-interactions"${total <= 15 ? " open" : ""}>` +
      `<summary>Recorded actions (${total})</summary>` +
      interactionLegendHtml(events) +
      `<ol class="step-interaction-list">${rows.join("")}</ol>` +
      `</details>`;
  }

  module.exports = {
    renderStepList, renderStepDetail,
    describeInteraction, renderInteractionList, siKindClass, stepFieldsHtml, splitBlocker,
    nameFieldHtml, activityListHtml,
  };
})();
