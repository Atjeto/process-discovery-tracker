"use strict";

(function () {
  const PdtRecognize = require("./recognition.js");
  const { stepChip } = require("./runs-model.js");
  const TM = require("./transcript-model.js");
  const StepFlow = require("./step-flow.js");
  const { escapeHtml, escapeAttr, sinceStart } = require("./dom.js");
  const FieldRefusal = require("./field-refusal.js");
  // C25: what the automation does with the step, and who does it.
  const StepScope = require("./step-scope.js");
  const { NOT_NEEDED_TITLE } = StepScope;
  // C26: the information the step uses or enters.
  const StepInfo = require("./step-information.js");
  const EMPTY_NAME = "A step needs a name, so the name it had is back.";
  // C21: the activities the name field's picker keeps as the analyst types.
  const { filterActivities } = require("./library.js");
  // One composed human identity line per element (App Library pass, R1):
  // `<ControlType> · "<best identity>" · <window>`, the title of a recorded
  // action's row in the step pane (2.0.1: the window is the Recorded line's
  // screen, so the row itself reads only what happened).
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
    draft: "Draft: the recorder drafted this step, and nobody has checked it yet.",
    confirmed: "Confirmed: you accepted the drafted step as it is.",
    edited: "Edited: you changed this step (its name, its boundaries or its flags).",
    added: "Added: you added this step by hand.",
    hidden: "Hidden: you took this step out. Unhide it from its menu.",
  };

  /* The step rows of one run (steps-view.js renders the runs around them).
     A row: the multi-select tick (shown on hover or once ticked), the name
     (double-click to rename, with the shared name suggestions), the waste
     tag, the state chip and when the step starts on the one clock (2.0.1:
     the moment finds the step in the video; its duration is in its pane and
     in the step panel, and the transaction's in its header) (the run says in one line how many
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
               ticked), originMs (when the recording started, for the
               moment each row shows), marks (2.0.1: a Map of step id =>
               { kind, text }, a run's differences from the reference on its
               rows, run-differences.js rowMarks), ghosts ([{ after, kind,
               name, text }]: the reference steps the run did not do, each a
               greyed row after the row `after`, first when null), placed
               (C22, 2.0.5: a Map of step id => what its mark says, for a
               step the analyst placed elsewhere in the process than its
               time puts it: the row carries "Placed") } */
  const DIFF_LABELS = { extra: "Extra", order: "Moved", repeated: "Again", skipped: "Skipped", not_done: "Not done" };
  function _ghostRow(g) {
    const row = document.createElement("div");
    row.className = "step-ghost";
    row.dataset.ghost = g.kind;
    row.title = g.text;
    row.setAttribute("aria-disabled", "true");
    row.innerHTML = `<span class="multi-check-space" aria-hidden="true"></span>` +
      `<span class="step-name">${escapeHtml(g.name)}</span>` +
      `<span class="step-diff step-diff-${escapeAttr(g.kind)}">${escapeHtml(DIFF_LABELS[g.kind] || g.kind)}</span>`;
    return row;
  }
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
    const marks = o.marks instanceof Map ? o.marks : new Map();
    const placed = o.placed instanceof Map ? o.placed : new Map();
    const ghosts = Array.isArray(o.ghosts) ? o.ghosts : [];
    for (const g of ghosts) if (g.after === null) host.appendChild(_ghostRow(g));
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
      // Waste is the only per-step flag (ADR-0027), since C25 the Automation
      // choice No longer needed, said in its words: a small tag, never a
      // strikethrough (which read as removed).
      const flagBadges = StepScope.automationOf(s) === "not_needed"
        ? `<span class="step-tag-waste" title="${escapeAttr(NOT_NEEDED_TITLE)}">${escapeHtml(StepScope.labelOf("not_needed"))}</span>` : "";
      const chip = stepChip(s.state);
      const chipHtml = (o.baseline && chip.cls === o.baseline) ? ""
        : `<span class="step-chip step-chip-${escapeAttr(chip.cls)}" title="${escapeAttr(CHIP_TITLES[chip.cls] || "")}">${escapeHtml(chip.label)}</span>`;
      // R1 (Steps chrome diet): a truncated name (the list ellipsizes) must be
      // readable on hover, so the title shows the FULL name; the rename hint
      // rides after it. There are no per-row reorder buttons: the list is in
      // the process order, time order until a step is moved (Alt+Up and
      // Alt+Down, its menu). The multi-select check stays (a genuine per-row
      // act for merge and bulk delete).
      const _nameTitle = (s.name ? s.name + " - " : "") + "double-click to rename";
      // C19: a sub-process carries the way into it, its sub-steps counted.
      const subCount = typeof o.subSteps === "function" ? o.subSteps(s) : null;
      const subHtml = Number.isInteger(subCount)
        ? `<button type="button" class="step-sub-open" title="Open this sub-process: its steps, in every transaction that goes through it">▸ ${subCount} ${subCount === 1 ? "sub-step" : "sub-steps"}</button>`
        : "";
      const diff = marks.get(s.step_id);
      const diffHtml = diff
        ? `<span class="step-diff step-diff-${escapeAttr(diff.kind)}" title="${escapeAttr(diff.text)}">${escapeHtml(DIFF_LABELS[diff.kind] || diff.kind)}</span>` : "";
      // C22: a step placed elsewhere in the process than its time puts it.
      const placedHtml = placed.has(s.step_id)
        ? `<span class="step-placed" title="${escapeAttr(placed.get(s.step_id))}">Placed</span>` : "";
      // 2.0.1: the tick is a checkbox a keyboard reaches (Space ticks it).
      row.innerHTML = `
        <span class="multi-check" role="checkbox" tabindex="${o.readOnly ? "-1" : "0"}" aria-checked="${isMulti ? "true" : "false"}"
          aria-label="${escapeAttr("Tick " + (s.name || "this step") + ", to act on several steps")}" title="Tick to merge, group or hide several steps at once"></span>
        <span class="step-name" title="${escapeAttr(_nameTitle)}" tabindex="-1">${escapeHtml(s.name)}</span>
        ${subHtml}${diffHtml}${placedHtml}${flagBadges}${chipHtml}
        <span class="step-time">${escapeHtml(sinceStart(s.time_range && s.time_range.start, o.originMs))}</span>
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
      checkEl.addEventListener("keydown", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
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
      for (const g of ghosts) if (g.after === s.step_id) host.appendChild(_ghostRow(g));
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
      : "No action was recorded in this step, so it cannot be split: add a step beside it.";
  }

  /* 2.0.1 (the owner's review): Recorded is open or closed as the analyst
     last left it, on any step, kept on this computer; until then it is open
     for a step of 15 actions or fewer. `kept`: "1", "0" or null. */
  const RECORDED_KEY = "pdt.recordedOpen";
  let _recordedChoice = null;
  function recordedOpen(total, kept) {
    return kept === "1" ? true : kept === "0" ? false : total <= 15;
  }
  function _keptRecordedOpen() {
    try {
      const v = localStorage.getItem(RECORDED_KEY);
      if (v === "1" || v === "0") return v;
    } catch (_) { /* nothing kept on this computer */ }
    return _recordedChoice;
  }
  function _keepRecordedOpen(open) {
    _recordedChoice = open ? "1" : "0";
    try { localStorage.setItem(RECORDED_KEY, _recordedChoice); } catch (_) { /* kept until the viewer closes */ }
  }

  /* What the Description field shows while it is empty. */
  const DESC_HINT = "What the person does in this step";

  /* The selected step's editor (P1.7; 2.0.1, the owner's review of the Steps
     page: an editor for the analyst, in the order the work goes, each fact
     once). Nothing waits for a Save button: the name and (C25) Done by save
     on Enter or when the field is left, the description when it is left,
     Automation when a choice is made;
     each is one undoable edit. The verbs that change the step's shape are
     the Steps toolbar's (steps-view.js), the scissors excepted.
       the head: the name as the title (C21: the library's picker under it),
         the step's state and (C21) the code of the library activity it is
         named from; then one line of facts: the system (C16, a field: the
         recording's until the analyst types another), Done by (C25, a
         field: the recording's role until the analyst types another), the screen, where the
         step is, how long it took (2.0.3: its start and end as fields
         when its time is the analyst's, `factsHtml`), in how many
         transactions (lane D6: from two up a link to the step panel's rows,
         `occurrencesHtml`), then Play
         (with a video: the step in the step panel's video, the panel opening
         again when it was closed; plan D2: below 1440 px it opens only so,
         in the place of the step list) and Show on timeline;
       what you write: the Description (C7; the drafting's narration is not
         its hint: the actions are under Recorded) with what was said during
         the step under it (C8), each sentence with Add, Information (C26:
         `informationHtml`, the recorded fields, then the analyst's lines,
         each change one undoable edit), the Flow line (C17:
         Only when and Decision, each a sentence of fields) and Automation
         (C25: what the automation does with the step, in place of the Waste
         tick; read only, the choice as text);
       the step's screenshots, the one the PDD prints marked;
       what it is made of: Recorded (a native <details>, open or closed as
         the analyst last left it; open in a hand-off opened read only): how
         many actions and where a draft ends, then the actions with the
         control each acted on, each but the last with the scissors that
         split the step after it;
       what is attached: its attachments and notes, when it has some, and
         one row of adds (views/analyst-ui.js).
     One column of a readable width; the step panel (step-panel.js) adds
     only what it lacks (plan D2): the step's video and every time the step
     happened, each with its play. Callbacks (steps-view.js stepDetailCallbacks) carry
     the facts, the state, the code, the Recorded line, the description, the
     System field, the screenshots and what is attached, (C21) the name
     field's picker: `picker` (library.js pickerFor) and
     onPickActivity(stepId, activityId), and (C25) `doneBy` ({ placeholder,
     role }: what the Done by field shows while empty, the recording's role),
     onDoneBy(stepId, text) and onAutomation(stepId, value). Lane PANE: the same editor draws
     the step opened in the Timeline's pane (views/timeline-pane.js), in its
     own host: `onTimeline` leaves out Show on timeline (the step is on it),
     and `afterFactsHtml` goes under the line of facts (the pane's Also
     happens in). */
  function renderStepDetail(host, step, callbacks) {
    _rendering = true;
    try { _renderStepDetail(host, step, callbacks || {}); } finally { _rendering = false; }
  }
  function _renderStepDetail(host, step, callbacks) {
    const interMap = (callbacks && callbacks.interactionsById) || {};
    const interIds = (step.evidence && step.evidence.interaction_event_ids) || [];
    const resolvedInter = interIds.map((id) => interMap[id]).filter(Boolean);
    // C19: a sub-process is not split (its steps are, inside it).
    const sub = callbacks.subProcess || null;
    // The analyst's description; a draft's narration is not a description.
    const desc = typeof callbacks.description === "string" ? callbacks.description : (step.description || "");
    const chip = stepChip(step.state);
    const facts = (callbacks.facts || []).filter(Boolean);
    host.innerHTML = `
      <div class="step-head">
        <div class="step-title-row">
          ${nameFieldHtml(step, callbacks.picker)}
          <span class="step-chip step-chip-${escapeAttr(chip.cls)} step-state" title="${escapeAttr(CHIP_TITLES[chip.cls] || "")}">${escapeHtml(chip.label)}</span>
          ${callbacks.code ? `<span class="step-code" id="step-code" title="The code of the library activity this step is named from">${escapeHtml(callbacks.code)}</span>` : ""}
        </div>
        <p class="step-facts" id="step-facts">${callbacks.systemHtml || ""}${doneByHtml(step, callbacks)}${callbacks.factsHtml ? `<span class="step-facts-rest">${callbacks.factsHtml}</span>` : facts.length ? `<span class="step-facts-rest">${escapeHtml(facts.join(" · "))}</span>` : ""}${occurrencesHtml(callbacks)}${callbacks.recordingAvailable ? `<button type="button" class="link-btn" id="btn-step-watch" title="Play this step in the step panel, which lists every time it happened">▶ Play</button>` : ""}${callbacks.onTimeline ? "" : `<button type="button" class="link-btn" id="btn-step-jump" title="Open the Timeline at the start of this step (the video too, when one is attached)">Show on timeline</button>`}</p>
        ${callbacks.afterFactsHtml || ""}
      </div>
      <div class="step-body">
        <div class="step-write" id="step-doc">
          <label class="step-field">Description <textarea id="step-desc" placeholder="${escapeAttr(DESC_HINT)}" title="The text the PDD prints under this step. Saved when you leave the field">${escapeHtml(desc)}</textarea></label>
          ${saidDuringStepHtml(callbacks.transcriptSaid, desc)}
          ${informationHtml(step, callbacks)}
          ${flowSectionHtml(step, callbacks.flow)}
          ${automationHtml(step, callbacks)}
        </div>
        ${callbacks.shotsHtml ? `<div class="step-shots-part">${callbacks.shotsHtml}</div>` : ""}
        <div class="step-made">
          ${recordedHtml(resolvedInter, interIds.length, {
            // 2.0.1: each action but the last has its scissors (a click
            // splits after that action; there is no split at a guess), and
            // after Merge with next the place where the two steps met is
            // marked. A hand-off opened read only shows the actions open.
            splittable: !sub, mergedAfter: callbacks.mergedAfterIndex, originMs: callbacks.originMs,
            line: callbacks.recorded, open: callbacks.readOnly || recordedOpen(interIds.length, _keptRecordedOpen()),
          })}
        </div>
        <div class="step-attached">${callbacks.attachedHtml || ""}</div>
      </div>`;
    // 2.0.1: Recorded stays open or closed as the analyst last left it.
    // Lane PANE: the parts are looked up in `host`, which may be the Steps
    // editor's pane or the Timeline's pane (views/timeline-pane.js); one of
    // them holds the editor at a time (steps-view.js renderStepInto).
    const recEl = host.querySelector("#step-recorded");
    const recHead = recEl && recEl.querySelector("summary");
    if (recHead) recHead.addEventListener("click", () => _keepRecordedOpen(!recEl.open));
    // The name saves on Enter or when the field is left; Escape puts it back.
    // On the Timeline (lane PANE) Enter and Escape also leave the field, so
    // Space plays on and S marks the next step, as the step panel's did.
    wireNameField(host.querySelector("#step-name"), step, callbacks, { isRendering: () => _rendering, leave: !!callbacks.onTimeline });
    // The description saves when the field is left, and when a sentence of
    // the transcript is added to it.
    const descEl = host.querySelector("#step-desc");
    let shownDesc = desc.trim();
    const commitDesc = () => {
      if (_rendering || !descEl.isConnected) return;
      const v = descEl.value.trim();
      if (v === shownDesc || !callbacks.onDescription) return;
      shownDesc = v;
      callbacks.onDescription(step.step_id, v);
    };
    descEl.addEventListener("blur", commitDesc);
    // C25: a choice saves at once; Done by saves as the name does.
    const autoEl = host.querySelector("#step-automation");
    if (autoEl) autoEl.addEventListener("change", () => {
      if (_rendering || !autoEl.isConnected) return;
      if (callbacks.onAutomation) callbacks.onAutomation(step.step_id, autoEl.value);
    });
    wireDoneBy(host.querySelector("#step-done-by"), step, callbacks);
    wireSaidDuringStep(host, callbacks.transcriptSaid, commitDesc);
    wireInformation(host, step, callbacks);
    wireFlow(host, step, callbacks);
    // C16: the System field, the screenshots, notes and attachments.
    if (callbacks.wireExtras) callbacks.wireExtras(host, () => _rendering);
    // The scissors after an action split the step there (Ctrl+Z undoes it).
    host.querySelectorAll(".si-split-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const after = parseInt(b.dataset.after, 10);
        if (callbacks.onSplitAt && Number.isInteger(after)) callbacks.onSplitAt(after);
      });
    });
    const jumpBtn = host.querySelector("#btn-step-jump");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => callbacks.onJumpToFlow && callbacks.onJumpToFlow(step));
      jumpBtn.disabled = !(step.time_range && step.time_range.start);
    }
    const playBtn = host.querySelector("#btn-step-watch");
    if (playBtn) {
      playBtn.addEventListener("click", () => callbacks.onWatchStep && callbacks.onWatchStep(step));
      playBtn.disabled = !(step.time_range && step.time_range.start);
    }
    // The "in N of M transactions" fact: the step panel at this step.
    const occBtn = host.querySelector("#btn-step-occurrences");
    if (occBtn) occBtn.addEventListener("click", () => callbacks.onShowOccurrences && callbacks.onShowOccurrences(step));
  }

  /* The line of facts' "in N of M transactions" (`callbacks.occurrences`:
     { text, n }): with N of 2 or more, on Steps, a link that opens the step
     panel at the step (its rows, one per transaction: the door of a project
     without a video, which has no Play); on the Timeline (the step panel does
     not open there) the same words as text; else nothing (the text is then
     among the facts, steps-view.js stepFacts). */
  const OCCURRENCES_TITLE = "Shows every time this step happened, one row per transaction.";
  function occurrencesHtml(callbacks) {
    const o = callbacks.occurrences;
    if (!o || !o.text) return "";
    if (callbacks.onTimeline) return `<span class="step-facts-occ">${escapeHtml(o.text)}</span>`;
    return `<span class="step-facts-occ"><button type="button" class="link-btn" id="btn-step-occurrences" title="${escapeAttr(OCCURRENCES_TITLE)}">${escapeHtml(o.text)}</button></span>`;
  }

  /* C26: the Information section, after the Description: first the recorded
     fields of the step (read only, `callbacks.information.recorded`,
     step-information.js recordedRows), marked Recorded; then the analyst's
     lines, each a row of three fields (Information, Example, Where it goes)
     with Remove; then Add information. A header row names the columns, and
     each field is labelled by its column (aria-labelledby). A field saves
     when it is left or on Enter, Escape puts back what it held; a line whose
     name is emptied goes (the steps view says so). Add information opens a
     row that is kept once it has a name, when the focus leaves the row or on
     Enter (Escape closes it); until then a redraw keeps what was typed in it.
     Read only: the same rows as text, no acts. The steps view makes each add,
     change or remove one undoable edit (callbacks.onInfoAdd, onInfoField,
     onInfoRemove). */
  let _infoOpen = { stepId: null, adding: false, draft: {} };
  let _infoFocus = null;   // { stepId, id }: a part to focus once drawn
  function _infoOpenFor(step) {
    if (_infoOpen.stepId !== step.step_id) {
      _infoOpen = { stepId: step.step_id, adding: false, draft: {} };
      _infoFocus = null;
    }
    return _infoOpen;
  }
  const INFO_RECORDED_TITLE = "Read from the actions recorded in this step.";
  const INFO_IDS = { name: "info-name", example: "info-example", goes_to: "info-where" };
  const INFO_COLS = { name: "info-col-name", example: "info-col-example", goes_to: "info-col-where" };

  function _infoTextRow(e, recorded) {
    const cell = (v) => `<span class="info-cell" title="${escapeAttr(v || "")}">${escapeHtml(v || "")}</span>`;
    return `<li class="info-row${recorded ? " info-recorded" : " info-typed"}">` + cell(e.name) + cell(e.example) + cell(e.goes_to) +
      (recorded ? `<span class="info-from" title="${escapeAttr(INFO_RECORDED_TITLE)}">${escapeHtml(StepInfo.WORDS.recorded)}</span>` : `<span class="info-from"></span>`) +
      `</li>`;
  }
  function _infoEditRow(key, e) {
    const field = (k) => `<input type="text" class="info-input" id="${INFO_IDS[k]}-${key}" data-key="${k}" aria-labelledby="${INFO_COLS[k]}"` +
      ` maxlength="${k === "name" ? StepInfo.NAME_MAX : StepInfo.TEXT_MAX}" value="${escapeAttr(e[k] || "")}" autocomplete="off">`;
    return `<li class="info-row info-typed${key === "new" ? " pending" : ""}" data-i="${key}">` + field("name") + field("example") + field("goes_to") +
      `<button type="button" class="link-btn info-remove" title="${escapeAttr(StepInfo.WORDS.removeTitle)}">${escapeHtml(StepInfo.WORDS.remove)}</button></li>`;
  }

  function informationHtml(step, callbacks) {
    if (!step) return "";
    const W = StepInfo.WORDS;
    const recorded = (callbacks.information && Array.isArray(callbacks.information.recorded)) ? callbacks.information.recorded : [];
    const entries = StepInfo.entriesOf(step);
    const ro = !!callbacks.readOnly;
    const open = ro ? { adding: false, draft: {} } : _infoOpenFor(step);
    let rows = recorded.map((e) => _infoTextRow(e, true)).join("");
    rows += ro ? entries.map((e) => _infoTextRow(e, false)).join("") : entries.map((e, i) => _infoEditRow(String(i), e)).join("");
    if (open.adding) rows += _infoEditRow("new", open.draft);
    const head = rows
      ? `<div class="info-row info-head"><span class="info-col" id="${INFO_COLS.name}">${escapeHtml(W.name)}</span>` +
        `<span class="info-col" id="${INFO_COLS.example}">${escapeHtml(W.example)}</span>` +
        `<span class="info-col" id="${INFO_COLS.goes_to}">${escapeHtml(W.goesTo)}</span><span class="info-col"></span></div>` +
        `<ul class="info-rows" id="step-info-rows">${rows}</ul>`
      : "";
    const add = ro ? "" : `<button type="button" class="link-btn" id="btn-info-add" title="${escapeAttr(W.addTitle)}">${escapeHtml(W.add)}</button>`;
    return `<div class="step-sect step-info" id="step-info" role="group" aria-labelledby="step-info-title">` +
      `<div class="step-sect-head"><span class="step-sect-title" id="step-info-title">${escapeHtml(W.heading)}</span></div>` +
      head + add + `</div>`;
  }

  /* Wire the Information section just drawn. Opening or closing the row
     being added draws the section again by itself; a saved change comes back
     through the steps view's redraw. */
  function wireInformation(host, step, callbacks) {
    const sect = host.querySelector("#step-info");
    if (!sect || callbacks.readOnly) return;
    const open = _infoOpenFor(step);
    const id = step.step_id;
    const redraw = () => {
      const cur = host.querySelector("#step-info");
      if (!cur) return;
      _rendering = true;
      try {
        const box = document.createElement("div");
        box.innerHTML = informationHtml(step, callbacks);
        cur.replaceWith(box.firstElementChild);
      } finally { _rendering = false; }
      wireInformation(host, step, callbacks);
    };
    const live = (el) => !_rendering && el && el.isConnected;
    const addBtn = sect.querySelector("#btn-info-add");
    if (addBtn) addBtn.addEventListener("click", () => {
      if (!open.adding) { open.adding = true; open.draft = {}; }
      _infoFocus = { stepId: id, id: INFO_IDS.name + "-new" };
      redraw();
    });
    for (const row of sect.querySelectorAll(".info-row[data-i]")) {
      const key = row.dataset.i;
      const inputs = Array.from(row.querySelectorAll(".info-input"));
      if (key === "new") {
        // The row being added: kept once it has a name, when the focus leaves
        // the row or on Enter; Escape closes it.
        let done = false;
        const commit = (byKey) => {
          if (done || !live(row)) return;
          const entry = {};
          for (const el of inputs) entry[el.dataset.key] = el.value;
          if (!StepInfo.cleanEntry(entry)) {
            // No name: a row left with nothing in it closes; one with text
            // waits for its name.
            if (!inputs.some((el) => el.value.trim())) { done = true; open.adding = false; open.draft = {}; redraw(); }
            return;
          }
          done = true;
          open.adding = false;
          open.draft = {};
          if (byKey) _infoFocus = { stepId: id, id: "btn-info-add" };
          if (callbacks.onInfoAdd) callbacks.onInfoAdd(id, entry);
        };
        for (const el of inputs) {
          el.addEventListener("input", () => { open.draft[el.dataset.key] = el.value; });
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(true); }
            else if (e.key === "Escape") {
              e.preventDefault();
              done = true;
              open.adding = false;
              open.draft = {};
              _infoFocus = { stepId: id, id: "btn-info-add" };
              redraw();
            }
          });
        }
        row.addEventListener("focusout", (e) => {
          if (e.relatedTarget && row.contains(e.relatedTarget)) return;
          commit(false);
        });
        row.querySelector(".info-remove").addEventListener("click", () => {
          done = true;
          open.adding = false;
          open.draft = {};
          _infoFocus = { stepId: id, id: "btn-info-add" };
          redraw();
        });
        continue;
      }
      const i = parseInt(key, 10);
      for (const el of inputs) {
        const shown = el.value;
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); el.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); el.value = shown; if (callbacks.onTimeline) el.blur(); }
        });
        el.addEventListener("blur", () => {
          if (!live(el)) return;
          const v = el.value.replace(/\s+/g, " ").trim();
          if (v === shown.replace(/\s+/g, " ").trim()) return;
          if (callbacks.onInfoField) callbacks.onInfoField(id, i, el.dataset.key, el.value);
        });
      }
      row.querySelector(".info-remove").addEventListener("click", () => {
        if (callbacks.onInfoRemove) callbacks.onInfoRemove(id, i);
      });
    }
    if (_infoFocus && _infoFocus.stepId === id) {
      const el = sect.querySelector("#" + _infoFocus.id);
      if (el) { _infoFocus = null; el.focus(); }
    }
  }

  /* C25: what the automation does with the step, the last line of what you
     write: a choice of four (step-scope.js CHOICES), or in a project opened
     read only the choice as text. */
  const AUTOMATION_TITLE = "What the automation will do with this step.";
  function automationHtml(step, callbacks) {
    const value = StepScope.automationOf(step);
    if (callbacks.readOnly) {
      return `<p class="step-automation" id="step-automation-text">Automation: ${escapeHtml(StepScope.labelOf(value))}</p>`;
    }
    const options = StepScope.CHOICES.map((c) =>
      `<option value="${escapeAttr(c.value)}"${c.value === value ? " selected" : ""}>${escapeHtml(c.label)}</option>`).join("");
    return `<label class="step-automation" title="${escapeAttr(AUTOMATION_TITLE)}">Automation <select id="step-automation">${options}</select></label>`;
  }

  /* C25: who does the step, on the line of facts after the system: a field
     whose placeholder is the recording's role ("Sales assistant (from the
     recording)"), a typed value winning; in a project opened read only the
     value or the role as text, nothing when nobody is named. */
  const DONE_BY_TITLE = "A role or a person; empty, the recording's role.";
  function doneByHtml(step, callbacks) {
    const d = callbacks.doneBy || {};
    const own = StepScope.cleanDoneBy(step.done_by);
    if (callbacks.readOnly) {
      const who = own || d.role || "";
      return who ? `<span class="step-doneby" id="step-done-by-text">Done by ${escapeHtml(who)}</span>` : "";
    }
    return `<label class="step-doneby" title="${escapeAttr(DONE_BY_TITLE)}">Done by ` +
      `<input type="text" id="step-done-by" class="step-doneby-input" maxlength="${StepScope.DONE_BY_MAX}" value="${escapeAttr(own)}"` +
      ` placeholder="${escapeAttr(d.placeholder || "A role or a person")}"></label>`;
  }

  /* Done by saves when the field is left, Enter leaves it, Escape puts back
     what it held; a redraw saves nothing. */
  function wireDoneBy(input, step, callbacks) {
    if (!input) return;
    const shown = input.value;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); input.value = shown; input.blur(); }
    });
    input.addEventListener("blur", () => {
      if (_rendering || !input.isConnected) return;
      if (StepScope.cleanDoneBy(input.value) === StepScope.cleanDoneBy(shown)) return;
      if (callbacks.onDoneBy) callbacks.onDoneBy(step.step_id, input.value);
    });
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
  /* The ids of the name field's parts: the editor's, or (`ids`) the step
     panel's, which can be on the page beside it. */
  const NAME_IDS = { input: "step-name", list: "step-activity-list", note: "step-lib-note" };
  function nameFieldHtml(step, picker, ids) {
    const id = Object.assign({}, NAME_IDS, ids || {});
    const acts = picker && Array.isArray(picker.activities) ? picker.activities : [];
    const note = picker && picker.note ? `<span class="step-lib-note" id="${escapeAttr(id.note)}">${escapeHtml(picker.note)}</span>` : "";
    const title = acts.length
      ? "The name of this step: pick an activity of " + picker.system + " from the library, or type any name."
      : "The name of this step. Saved when you press Enter or leave the field";
    const combo = acts.length ? ` role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${escapeAttr(id.list)}"` : "";
    // 2.0.1: the name is the editor's title; its label is for a screen reader.
    return `<div class="step-name-field">` +
      `<label class="sr-only" for="${escapeAttr(id.input)}">Name</label>` +
      `<input type="text" id="${escapeAttr(id.input)}" class="step-title-input" value="${escapeAttr(step.name)}" autocomplete="off"${combo} title="${escapeAttr(title)}">` +
      note +
      (acts.length ? `<ul class="step-activity-list" id="${escapeAttr(id.list)}" role="listbox" aria-label="${escapeAttr("Activities of " + picker.system)}" hidden></ul>` : "") +
      `</div>`;
  }

  /* Wire a name field drawn by nameFieldHtml: it saves on Enter or when it
     is left (callbacks.onRename; an empty name puts the name back), Escape
     puts back what it showed, and (C21) its picker takes its keys first (Up,
     Down, Enter on a row, Escape on an open list). opts: isRendering() (a
     blur while the field is drawn again saves nothing), listId (the
     picker's list, the editor's by default), leave (the step panel: Enter
     and Escape also leave the field, so the page's keys answer again). */
  function wireNameField(nameEl, step, callbacks, opts) {
    if (!nameEl) return;
    const o = opts || {};
    const rendering = typeof o.isRendering === "function" ? o.isRendering : () => false;
    // Lane A-2: an empty name is refused, and says so under the name until
    // the name is edited again (field-refusal.js).
    const refusalKey = "name:" + step.step_id + ":" + (nameEl.id || "");
    FieldRefusal.renew(nameEl, refusalKey);
    const commitName = () => {
      if (rendering() || !nameEl.isConnected) return;
      const v = nameEl.value.trim();
      if (!v) {
        const had = String(step.name || "");
        nameEl.value = had;
        if (had.trim()) FieldRefusal.show(nameEl, EMPTY_NAME, refusalKey);
        return;
      }
      FieldRefusal.clear(nameEl, refusalKey);
      if (v !== String(step.name || "").trim() && callbacks.onRename) callbacks.onRename(step.step_id, v);
    };
    const picker = wireNamePicker(nameEl, step, callbacks, o.listId);
    nameEl.addEventListener("keydown", (e) => {
      if (picker && picker.onKey(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        // Leaving the field saves it (blur).
        if (o.leave) nameEl.blur(); else commitName();
      } else if (e.key === "Escape") {
        e.preventDefault();
        nameEl.value = step.name || "";
        if (o.leave) nameEl.blur();
      }
    });
    nameEl.addEventListener("blur", commitName);
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
  function wireNamePicker(nameEl, step, callbacks, listId) {
    const picker = callbacks.picker;
    if (!picker || !(picker.activities || []).length) return null;
    const list = document.getElementById(listId || NAME_IDS.list);
    if (!list) return null;
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
    onlyWhen: "For a step some transactions skip: say when it is done.",
    goTo: "A decision after this step: when a condition holds, the process goes elsewhere.",
    condition: "When this step happens. Saved when you press Enter or leave the field.",
    removeCondition: "Remove the condition: the step always happens",
    target: "Where the process goes after this step",
    when: "When the process goes there. Saved when you press Enter or leave the field.",
    removeLink: "Remove this link: the next step follows",
    inherited: "A condition set on another step holds here in every transaction: change it there.",
    // C22 (2.0.5): its place in the process, apart from its time.
    placeAfter: "Put this step after another step of the process; its time on the Timeline stays.",
    backToTime: "Put this step back where its time puts it in the process",
  };

  function _targetOptions(choices, selected, missing) {
    const opt = (value, label, on, disabled) => '<option value="' + escapeAttr(value) + '"' +
      (on ? " selected" : "") + (disabled ? " disabled" : "") + ">" + escapeHtml(label) + "</option>";
    let html = selected == null ? opt("", "Choose a step or the end", true, true)
      : missing ? opt(selected, "A step no longer in this transaction", true, true) : "";
    // 2.0.1: grouped by where they lie from this step.
    for (const [kind, label] of [["back", "Back to (a loop)"], ["ahead", "Ahead to"], ["other", "Steps another transaction did"]]) {
      const items = (choices || []).filter((c) => (c.kind || "ahead") === kind);
      if (items.length) html += '<optgroup label="' + escapeAttr(label) + '">' +
        items.map((c) => opt(c.value, c.label, c.value === selected, false)).join("") + "</optgroup>";
    }
    return html + opt(StepFlow.END, "End the process", selected === StepFlow.END, false);
  }

  /* A link row is one sentence made of its fields (2.0.1: the sentence and the
     fields once said the same thing twice): "Goes back to [step] when
     [condition] Remove"; the whole sentence is the row's title. */
  function _linkRowHtml(i, link, choices) {
    const isNew = link == null;
    const key = isNew ? "new" : String(i);
    const reading = isNew ? "Choose where the process goes after this step." : link.reading;
    return '<li class="flow-link' + (isNew ? " pending" : "") + '" data-i="' + key + '" title="' + escapeAttr(reading) + '">' +
      '<span class="flow-link-text">' + escapeHtml(isNew ? "Goes to" : link.verb || "Goes to") + "</span>" +
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
    const line = escapeHtml(inherited || flow.next || StepFlow.DEFAULT_LINE);
    const onlyBtn = showCond || inherited ? "" : '<button type="button" class="link-btn" id="btn-flow-only-when" title="' +
      escapeAttr(FLOW_TITLES.onlyWhen) + '">Only when…</button>';
    const goBtn = '<button type="button" class="link-btn" id="btn-flow-go-to" title="' + escapeAttr(FLOW_TITLES.goTo) + '">Decision…</button>';
    // C22: where the step comes in the process, apart from its time.
    const placeBtn = flow.canPlace === false ? "" : '<button type="button" class="link-btn" id="btn-flow-place" title="' +
      escapeAttr(FLOW_TITLES.placeAfter) + '">Place after…</button>';
    const placedHtml = flow.placed
      ? '<p class="flow-placed" id="step-placed-line"><span class="step-placed">Placed</span> ' + escapeHtml(flow.placed) +
        (flow.canBack ? ' <button type="button" class="link-btn" id="btn-flow-back-to-time" title="' + escapeAttr(FLOW_TITLES.backToTime) +
          '">Back to its time</button>' : "") + "</p>"
      : "";
    // Nothing set on the step: one line.
    if (!showCond && !links.length && !open.link) {
      return '<div class="step-sect step-flow" id="step-flow"><div class="step-sect-head step-flow-head">' +
        '<span class="step-sect-title">Flow</span>' +
        '<span class="flow-line"' + lineAttrs + ">" + line + "</span>" +
        onlyBtn + goBtn + placeBtn + "</div>" + placedHtml + "</div>";
    }
    const condHtml = showCond
      ? '<div class="flow-cond"><label class="flow-cond-label" for="step-only-when">Only when</label>' +
        '<input type="text" id="step-only-when" value="' + escapeAttr(cond) + '" placeholder="for example: a new customer" title="' +
          escapeAttr(FLOW_TITLES.condition) + '">' +
        '<button type="button" class="link-btn" id="btn-flow-remove-condition" title="' + escapeAttr(FLOW_TITLES.removeCondition) + '">Remove</button></div>' +
        '<p class="flow-line" id="step-flow-line">' + escapeHtml(flow.next || StepFlow.DEFAULT_LINE) + '</p>'
      : '<p class="flow-line"' + lineAttrs + ">" + line + "</p>";
    const rows = links.map((l, i) => _linkRowHtml(i, l, flow.choices)).join("") +
      (open.link ? _linkRowHtml(links.length, null, flow.choices) : "");
    return '<div class="step-sect step-flow" id="step-flow"><div class="step-sect-head step-flow-head">' +
      '<span class="step-sect-title">Flow</span>' + onlyBtn + goBtn + placeBtn + "</div>" + placedHtml +
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
    // C22: the step's place in the process.
    onClick("#btn-flow-place", () => { if (callbacks.onPlaceAfter) callbacks.onPlaceAfter(id); });
    onClick("#btn-flow-back-to-time", () => { if (callbacks.onBackToTime) callbacks.onBackToTime(id); });

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
    const desc = host.querySelector("#step-desc");
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

  /* The Recorded part of the step pane (2.0.1): its summary says what the
     recording holds of the step (`line`, steps-view.js: "6 actions on New
     order · took 7s · ends at Save order"), its body lists the actions and
     holds `actsHtml` (Merge with next); open when `open`. */
  function recordedHtml(events, total, opts) {
    opts = opts || {};
    return `<details class="step-part step-recorded" id="step-recorded"${opts.open ? " open" : ""}>` +
      `<summary class="step-part-head"><span class="step-part-title">Recorded</span>` +
      (opts.line ? `<span class="step-part-hint">${escapeHtml(opts.line)}</span>` : "") +
      `<span class="tr-more-chevron" aria-hidden="true"></span></summary>` +
      `<div class="evidence">${renderInteractionList(events, total, opts)}</div>` +
      (opts.actsHtml ? `<div class="actions">${opts.actsHtml}</div>` : "") +
      `</details>`;
  }

  /* The list of a step's recorded actions, one line each: what happened and
     when; the control and its window are the row's title. `events` are the
     resolved interaction events in step order; `total` is the count the step
     claims (may exceed events.length when some ids are not in this session's
     event stream). */
  function renderInteractionList(events, total, opts) {
    // Lane FX3 (validation pass 3, F16): the analyst's words, "action" (a
    // click, a field typed), as Split and Open as a sub-process say it.
    if (!total) return `<p class="meta">No action was recorded in this step.</p>`;
    opts = opts || {};
    // When splittable, every action but the last carries scissors: a click
    // splits the step after it. `mergedAfter` marks where two merged steps
    // met (2.0.1).
    const splittable = !!opts.splittable && events.length >= 2;
    const met = Number.isInteger(opts.mergedAfter) ? opts.mergedAfter : null;
    const rows = events.map((ev, i) => {
      const t = sinceStart(ev.timestamp, opts.originMs);
      const wasLine = met === i && i < events.length - 1;
      const splitBtn = (splittable && i < events.length - 1)
        ? `<button type="button" class="si-split-btn" data-after="${i}" title="Split the step here: the first part ends after this action" aria-label="Split the step after this action">&#9988;</button>`
        : "";
      const data = (ev && ev.data) || {};
      const title = identityLine(data).text + (wasLine ? "\nThe two merged steps met here" : "");
      // 2.0.1: the control it acted on (the developer's reading); its window
      // is the screen on the head's line.
      const control = identityLine(Object.assign({}, data, { window_title: "", window_title_regex: "" })).text;
      return `<li class="step-interaction${wasLine ? " was-boundary" : ""}" data-idx="${i}" title="${escapeAttr(title)}">` +
        `<span class="si-body"><span class="si-text">${escapeHtml(describeInteraction(ev))}</span>` +
        (control ? `<span class="si-control">${escapeHtml(control)}</span>` : "") + `</span>` +
        `<span class="si-time">${escapeHtml(t)}</span>${splitBtn}</li>`;
    });
    const missing = total - events.length;
    if (missing > 0) {
      rows.push(`<li class="step-interaction">` +
        `<span class="si-text meta">${missing === 1 ? "1 recorded action is" : missing + " recorded actions are"} not in this project</span>` +
        `</li>`);
    }
    return (splittable ? `<p class="si-split-hint">The scissors after an action split the step there.</p>` : "") +
      `<ol class="step-interaction-list">${rows.join("")}</ol>`;
  }

  module.exports = {
    renderStepList, renderStepDetail,
    describeInteraction, renderInteractionList, recordedHtml, recordedOpen, keepRecordedOpen: _keepRecordedOpen, splitBlocker,
    nameFieldHtml, activityListHtml, wireNameField, DESC_HINT,
    // C26 and lane D6, for the tests.
    informationHtml, occurrencesHtml,
  };
})();
