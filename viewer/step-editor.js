"use strict";

(function () {
  const PdtRecognize = require("./recognition.js");
  const { stepChip } = require("./runs-model.js");
  const TM = require("./transcript-model.js");
  const { escapeHtml, escapeAttr, sinceStart } = require("./dom.js");
  // A step's time on screen ("42s", "2:17", "1h04"), the fact line's too.
  const { duration: stepDuration } = require("./step-facts.js");
  // One composed human identity line per element (App Library pass, R1). Reused
  // here for the step-detail interaction rows so a control with no accessible
  // name reads as `<ControlType> · "<best identity>" · <window>` with the
  // volatility/weak marker + tooltip -- never a bare automation_id or a raw
  // window title. The matcher stays ground truth; this is presentation only.
  const { identityLine } = require("./identity-line.js");

  /* True while the step pane is being drawn again: a field removed from the
     page then must not save what it held (a blur during the redraw). */
  let _rendering = false;

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
     tag, the state chip and the duration (the run says in one line which
     names came from saved names). P1.9: a row carries a chip only
     where it differs from its run: `opts.baseline` is the chip class the run's
     status stands for ("draft" or "confirmed"), and a row whose chip is that
     class shows none (the run's own status says it). Without a baseline (the
     steps outside runs) every row shows its chip.
       opts: { nameListId, onBeginRename(step), emptyHtml, baseline } */
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
      row.innerHTML = `
        <span class="multi-check" title="Click to select for merge or to hide several steps at once"></span>
        <span class="step-name" title="${escapeAttr(_nameTitle)}" tabindex="-1">${escapeHtml(s.name)}</span>
        ${flagBadges}${chipHtml}
        <span class="step-time">${escapeHtml(stepDuration(s.time_range))}</span>
      `;
      row.addEventListener("click", (e) => {
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
         attached, Waste, Watch (with a video: it plays the step in the step
         panel) and Hide, and the step's screenshots;
       "More" (a native <details>, collapsed on every selection): the
         interactions the step is made of, Show on timeline, Split, Merge with
         next, Merge selected, Delete (added steps only).
     Callbacks (steps-view.js stepDetailCallbacks) carry the verbs, the fact
     line, the fields, the description and its hint, and (C16) the System
     field and the screenshots, notes and attachments (views/analyst-ui.js). */
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
    const interListHtml = renderInteractionList(resolvedInter, interIds.length,
      { splittable: true, splitAfterIndex, originMs: callbacks.originMs });
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
    const fact = callbacks.factLine || "";
    // C4: the name input suggests remembered and already-used names.
    const nameList = callbacks.nameListId ? ` list="${escapeAttr(callbacks.nameListId)}"` : "";
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
    host.innerHTML = `
      ${fact ? `<p class="step-fact">${escapeHtml(fact)}</p>` : ""}
      <label>Name <input type="text" id="step-name" value="${escapeAttr(step.name)}"${nameList} title="Saved when you press Enter or leave the field"></label>
      ${callbacks.systemHtml || ""}
      ${stepFieldsHtml(callbacks.fields)}
      <label>Description <textarea id="step-desc" placeholder="${escapeAttr(hint)}" title="Saved when you leave the field">${escapeHtml(desc)}</textarea></label>
      ${saidDuringStepHtml(callbacks.transcriptSaid, desc)}
      <div class="flags">
        <label title="This step should not be needed (rework, duplicate effort, copying between systems). The PDD marks it as waste."><input type="checkbox" id="flag-waste" ${flags.waste ? "checked" : ""}> Waste</label>
      </div>
      <div class="actions">
        ${watchBtn}
        <button id="btn-step-hide" title="${isHidden ? "Bring this step back into the list" : "Take this step out. Every analysis keeps it out; Show hidden steps on its transaction lists it again."}">${isHidden ? "Unhide" : "Hide step"}</button>
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
            <button id="btn-step-split" title="${escapeAttr(splitBtnTitle)}">${splitBtnLabel}</button>
            <button id="btn-step-merge" title="Merge this step with the next step of its transaction (the inverse of Split)">Merge with next</button>
            ${mergeSelectedBtn}
            ${isAdded ? '<button id="btn-step-delete" class="danger" title="Delete this step you added">Delete</button>' : ""}
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
    nameEl.addEventListener("keydown", (e) => {
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
    // C16: the System field, the screenshots, notes and attachments.
    if (callbacks.wireExtras) callbacks.wireExtras(host, () => _rendering);
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
    const watchEl = document.getElementById("btn-step-watch");
    if (watchEl) {
      watchEl.addEventListener("click", () => callbacks.onWatchStep && callbacks.onWatchStep(step));
      watchEl.disabled = !(step.time_range && step.time_range.start);
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
      const t = sinceStart(ev.timestamp, opts.originMs);
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
        `<span class="si-text meta">${missing} interaction(s) not found in this project</span>` +
        `</li>`);
    }
    return `<details class="step-interactions"${total <= 15 ? " open" : ""}>` +
      `<summary>Interactions (${total})</summary>` +
      interactionLegendHtml(events) +
      `<ol class="step-interaction-list">${rows.join("")}</ol>` +
      `</details>`;
  }

  module.exports = {
    renderStepList, renderStepDetail,
    describeInteraction, renderInteractionList, siKindClass, stepFieldsHtml,
  };
})();
