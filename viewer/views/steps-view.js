/*
 * steps-view.js -- the Steps level of the Session view.
 *
 * Owns the step list + detail + mini-timeline rendering, the step
 * filter, all step CRUD (rename / save / split / merge / hide / delete /
 * add-manual / bulk-delete), and the ignored-apps denylist dialog.
 * Cross-surface helpers (ensureAnnoShape, persistAnnotations,
 * videoTimeToSessionTs, jumpToStepInFlow) are injected by renderer.js
 * via initStepsView().
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, cryptoRandomId, toast } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Session = require("../session.js");
const PdtSteps = require("../step-editor.js");
const PdtAlign = require("../step-alignment.js");
const { rollUpSteps, screenType, resolveStepGrainKeys } = require("../process-map-levels.js");
const { buildWorkItems, findGroupAnnotation } = require("../work-items.js");

/* Injected by renderer.js (functions that still live there / in session). */
let ensureAnnoShape = (a) => a;
let persistAnnotations = async () => {};
let videoTimeToSessionTs = () => null;
let jumpToStepInFlow = () => {};
let watchStep = () => {};

/* A2: the analyst-chosen split boundary for the currently-selected step --
   { stepId, index } where index means "split AFTER this interaction". Null
   index when no boundary is picked (Split then falls back to the midpoint). */
let _splitAfter = { stepId: null, index: null };

/* ADR-0015: the Steps list has two readings. Flat (default) is the
   chronological step list; Aligned is the consensus backbone across the
   detected cases (curate one -> apply to all). _alignSelIndex is the selected
   backbone position in aligned mode; null means an exception/instance step is
   selected instead (its per-instance editor shows, keyed on getSelectedStepId). */
let _alignMode = false;
let _alignSelIndex = null;

/* ADR-0028 (R3): the selected case-tree work item -- { caseId, screenKey } --
   and the set of expanded case ids (collapsed by default). Null selection shows
   the empty hint; a selection shows the group-scoped R1c detail panel. */
let _wiSelected = null;
let _wiExpandedCases = new Set();

function getSpan() {
  const evs = (State.getSession() && State.getSession().events) || [];
  if (!evs.length) return null;
  return {
    startMs: new Date(evs[0].timestamp).getTime(),
    endMs:   new Date(evs[evs.length - 1].timestamp).getTime(),
  };
}

/* Decision 1: tag each step with how many cases (tickets) it recurs in, so
   the detail can offer "apply to all". `_repeat` is the case span and drives
   the propagate action. P0.3: the LIST badge is shown only when the repetition
   DISCRIMINATES -- the step recurs across some but not all cases. A step in
   *every* case is the uniform backbone (on 5 identical demo cases every step
   would read "5×" -- zero signal), so it gets no badge even though the
   propagate action stays available. A step in only one case gets no tag. */
function decorateRepeats(steps, interactionsById) {
  const { caseCount, groups } = PdtAlign.alignSteps(steps, interactionsById);
  const span = new Map();
  for (const g of groups) for (const m of g.members) span.set(m.stepId, g.caseSpan);
  return (steps || []).map(s => {
    if (!span.has(s.step_id)) return s;
    const caseSpan = span.get(s.step_id);
    return { ...s, _repeat: caseSpan, _repeatCaseCount: caseCount,
      _repeatDiscriminating: caseSpan < caseCount };
  });
}

function stepMatchesFilter(s, f, scopeCaseId) {
  if (scopeCaseId && s.case_id !== scopeCaseId) return false;
  if (f.text && !(s.name || "").toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.states && f.states.size > 0) {
    if (!f.states.has(s.state)) return false;
  } else {
    // No explicit state filter: hidden steps stay out of the list by
    // default (they're suppressed noise). The "hidden" chip reveals them.
    if (s.state === "hidden") return false;
  }
  return true;
}

function renderStepsLevel() {
  if (!State.getSession() || !PdtSteps) return;
  const interactionsById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") interactionsById[ev.event_id] = ev;
  }
  // Decorate with intra-session repeat counts (a step that recurs across
  // anchor-detected cases is the high-value "curate once" target).
  const allSteps = decorateRepeats(
    (State.getSession().annotations && State.getSession().annotations.steps) || [],
    interactionsById);

  // Consume a pending step-jump request from a Flow seek: focus on the
  // step containing the requested timestamp. Scrolled into view at the
  // end of this function so the row exists in the DOM.
  const pendingTs = State.consumePendingStepJump();
  if (pendingTs) {
    const targetMs = new Date(pendingTs).getTime();
    if (isFinite(targetMs) && allSteps.length) {
      // Prefer a step that contains the timestamp; fall back to the
      // closest by nearest edge so a right-click in a gap between
      // steps still focuses a step instead of doing nothing visible.
      let best = null, bestDist = Infinity;
      for (const s of allSteps) {
        const tr = s.time_range; if (!tr) continue;
        const a = new Date(tr.start).getTime();
        const b = new Date(tr.end).getTime();
        if (!isFinite(a) || !isFinite(b)) continue;
        if (a <= targetMs && targetMs <= b) { best = s; break; }
        const dist = Math.min(Math.abs(targetMs - a), Math.abs(targetMs - b));
        if (dist < bestDist) { best = s; bestDist = dist; }
      }
      if (best) State.setSelectedStepId(best.step_id);
    }
  }

  const f = State.getListFilters().step;
  const filtered = allSteps.filter(s => stepMatchesFilter(s, f, State.getCaseScope()));
  const filteredIds = new Set(filtered.map(s => s.step_id));

  const meta = $("#step-filter-meta");
  if (meta) meta.textContent = filtered.length === allSteps.length
    ? `${allSteps.length} steps`
    : `${filtered.length} of ${allSteps.length}`;
  // Reflect active state chips
  for (const chip of document.querySelectorAll("#step-filter-states .chip")) {
    chip.classList.toggle("active", f.states.has(chip.dataset.state));
  }

  $("#steps-badge").textContent = String(allSteps.length);
  if ($("#steps-pane-count")) $("#steps-pane-count").textContent = String(allSteps.length);
  // A3: surface analyst flag counts so marking a step visibly counts.
  const sumEl = $("#steps-summary");
  if (sumEl) {
    const fc = { waste: 0, automation_candidate: 0, conditional: 0, exception_path: 0 };
    for (const st of allSteps) {
      const fl = st.flags || {};
      for (const k of Object.keys(fc)) if (fl[k]) fc[k]++;
    }
    const parts = [];
    if (fc.waste) parts.push(fc.waste + " waste");
    if (fc.automation_candidate) parts.push(fc.automation_candidate + " automatable");
    if (fc.conditional) parts.push(fc.conditional + " conditional");
    if (fc.exception_path) parts.push(fc.exception_path + " exception");
    sumEl.textContent = parts.length ? ("Flagged: " + parts.join(" · ")) : "";
  }

  // ADR-0024: at a coarser grain than "element", the Steps list shows the
  // view-time ROLL-UP -- one row per run of consecutive steps sharing the
  // notch key (screen / app / phase / case). "element" keeps the full,
  // editable per-step list below (detail is never destroyed). The roll-up is
  // read-oriented: clicking a group selects its first member so the per-step
  // editor still works; the legend points back to the element notch to edit.
  const grain = State.getGrain();
  // ADR-0028 (R3): the DEFAULT Steps reading at the screen notch is the CASE
  // TREE -- cases -> case-scoped screen-visit work items (fragments merged
  // NON-consecutively across bounces within a case), the analyst's real unit of
  // work. When the session has NO cases there is no scope to merge within, so we
  // fall back to the ADR-0024 consecutive roll-up + a CTA (§5). The element notch
  // and the other coarse notches keep their ADR-0024 behavior below (the Detail
  // slider reaches the flat fragment list -- detail is never destroyed).
  if (grain === "screen") {
    const anno0 = (State.getSession() && State.getSession().annotations) || {};
    const wi = buildWorkItems(filtered, {
      interactionsById,
      caseLabel: caseLabeler(),
      groupAnnotations: anno0.group_annotations || [],
    });
    if (wi.hasCases) {
      renderCaseTree(wi, allSteps, interactionsById);
      _renderStepsMiniTimeline(allSteps, filteredIds);
      return;
    }
    // No cases: keep the ADR-0024 roll-up, but show the segment-me CTA.
    renderGrainGroupedSteps(filtered, allSteps, grain, interactionsById, /*noCasesCta=*/true);
    _renderStepsMiniTimeline(allSteps, filteredIds);
    return;
  }
  if (grain !== "element") {
    renderGrainGroupedSteps(filtered, allSteps, grain, interactionsById);
    _renderStepsMiniTimeline(allSteps, filteredIds);
    return;
  }

  // ADR-0015: the aligned reading needs 2+ detected cases. Gate the toggle on
  // that and fall back to flat for a single-case session. The per-step filter
  // (text + state chips) doesn't act on a consensus, so hide it in aligned mode
  // rather than leave a control that does nothing (coherence discipline).
  const distinctCases = new Set(
    ((State.getSession().annotations && State.getSession().annotations.steps) || [])
      .filter(s => s && s.state !== "hidden" && s.case_id).map(s => s.case_id));
  const canAlign = distinctCases.size >= 2;
  if (_alignMode && !canAlign) _alignMode = false;
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) {
    alignToggle.style.display = canAlign ? "" : "none";
    for (const b of alignToggle.querySelectorAll("button"))
      b.classList.toggle("active", (b.dataset.mode === "aligned") === _alignMode);
  }
  const listFilterEl = $("#step-list-filter");
  if (listFilterEl) listFilterEl.style.display = _alignMode ? "none" : "";

  if (!_alignMode) {
    // ---- Flat reading: the chronological step list + per-step editor ----
    // P0.4: a one-line key for the repeat badge, shown only when at least one
    // discriminating badge is on screen (otherwise the legend is just noise).
    const legendEl = $("#steps-legend");
    if (legendEl) {
      const anyRepeat = allSteps.some(s => s._repeatDiscriminating);
      legendEl.innerHTML = anyRepeat
        ? '<span class="step-repeat">N×</span> = recurs in some (not all) cases: curate one, then "Apply to repeats"'
        : "";
      legendEl.style.display = anyRepeat ? "" : "none";
    }
    PdtSteps.renderStepList($("#step-list"), filtered, State.getSelectedStepId(),
      (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
      (sid) => {
        if (State.getMultiSelectedStepIds().has(sid)) State.getMultiSelectedStepIds().delete(sid);
        else State.getMultiSelectedStepIds().add(sid);
        syncMultiSelectButtons();
        // Re-render so the user sees the multi-selected state -- otherwise
        // Ctrl+click feels broken because nothing visibly changes.
        renderStepsLevel();
      },
      inlineRenameStep,
      State.getMultiSelectedStepIds(),
      // R1 (Steps chrome diet): the per-row ↑ / ↓ move buttons are retired;
      // reorder lives in the right-click menu now (Move up / Move down),
      // reachable from the flat-list rows via this same context-menu opener.
      showStepContextMenu,
    );
    const selected = allSteps.find(s => s.step_id === State.getSelectedStepId()) || null;
    PdtSteps.renderStepDetail($("#step-detail"), selected, stepDetailCallbacks(selected, interactionsById));
  } else {
    // ---- Aligned reading: the consensus backbone across detected cases ----
    renderAlignedReading(interactionsById);
  }
  _renderStepsMiniTimeline(allSteps, filteredIds);
  // The ONLY unrequested scroll: reveal the selected row on ARRIVAL -- either a
  // Flow-seek step jump (pendingTs) or a view switch back to Steps with a
  // surviving selection (pendingStepReveal, e.g. after "Jump to in Flow").
  // Consume pendingStepReveal unconditionally so it never leaks into a later
  // incidental re-render. Select / rename / flag / multi-select re-renders set
  // neither flag, so they never scroll.
  const arriveReveal = State.consumePendingStepReveal();
  if ((pendingTs || arriveReveal) && State.getSelectedStepId()) {
    setTimeout(() => {
      const row = document.querySelector('.step-row[data-step-id="' + State.getSelectedStepId() + '"]');
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
}

/* The Steps mini-timeline (full set as context; non-matching blocks dimmed so
   the filter still localises). Factored so the flat reading and the ADR-0024
   grain roll-up reading both render the same timeline beneath their list. */
function _renderStepsMiniTimeline(allSteps, filteredIds) {
  const span = getSpan();
  if (!span) return;
  const dimmedIds = new Set();
  for (const s of allSteps) if (!filteredIds.has(s.step_id)) dimmedIds.add(s.step_id);
  PdtSteps.renderStepTimeline($("#timeline-steps"), allSteps,
    State.getSession().events.filter(e => e.type === "interaction"), span, {
      zoom: State.getStepZoom(),
      selectedId: State.getSelectedStepId(),
      dimmedIds,
      onSelect: (sid) => { State.setSelectedStepId(sid); renderStepsLevel(); },
      onContextMenu: (sid, x, y) => showStepContextMenu(sid, x, y),
    });
  const range = $("#steps-timeline-range");
  if (range) {
    const fmt = (ms) => new Date(ms).toLocaleTimeString();
    range.textContent = `${fmt(span.startMs)} → ${fmt(span.endMs)} · ${formatDuration(span.endMs - span.startMs)}`;
  }
}

/* ADR-0024: render the Steps list as the view-time grain ROLL-UP. Each row is a
   run of consecutive steps sharing the notch key (rollUpSteps); it shows the
   group label, the count of folded steps, and the group's duration. The roll-up
   is read-oriented -- clicking a group selects its first member so the per-step
   detail editor (rename / flag / split) still works; the legend points back to
   the element notch to edit individual steps. The fine steps are never
   destroyed: slide back to "element" to see them all. */
function renderGrainGroupedSteps(filtered, allSteps, grain, interactionsById, noCasesCta) {
  const anno = (State.getSession() && State.getSession().annotations) || {};
  const phaseName = {};
  for (const ph of (anno.phases || [])) phaseName[ph.phase_id] = ph.name || "(phase)";
  const ctx = { phaseName, interactionsById, caseLabel: caseLabeler() };
  const groups = rollUpSteps(filtered, grain, ctx);

  const meta = $("#step-filter-meta");
  if (meta) {
    meta.textContent = `${groups.length} ${grain} group${groups.length === 1 ? "" : "s"} · ${filtered.length} steps`;
  }
  // Legend: name the notch and the inverse (slide to element to edit). Reuse
  // the steps-legend slot the flat/aligned readings use.
  const legendEl = $("#steps-legend");
  if (legendEl) {
    // ADR-0028 §5: an unsegmented session can't group work by ticket, so the
    // screen notch falls back here -- name that + offer the segment-me path.
    const cta = noCasesCta
      ? ' <span class="grain-legend-hint">This session isn\'t split into cases yet. ' +
        'To group the work by run, mark the start of each run in Flow (right-click ' +
        'the timeline at that moment), then click Analyze session.</span>'
      : ' <span class="grain-legend-hint">Set the Detail slider to ' +
        '<strong>element</strong> to edit individual steps.</span>';
    legendEl.innerHTML = 'Grouped by <strong>' + escapeHtml(grain) +
      '</strong>: each row folds a run of consecutive steps on the same ' +
      escapeHtml(grain) + '.' + cta;
    legendEl.style.display = "";
  }
  // Hide the per-step filter controls that don't act on a roll-up (mirrors the
  // aligned reading's discipline -- no control that does nothing).
  const listFilterEl = $("#step-list-filter");
  if (listFilterEl) listFilterEl.style.display = "none";
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) alignToggle.style.display = "none";

  const selId = State.getSelectedStepId();
  const rows = groups.map((g) => {
    const startMs = g.time_range.start ? new Date(g.time_range.start).getTime() : 0;
    const endMs = g.time_range.end ? new Date(g.time_range.end).getTime() : startMs;
    const dur = formatDuration(Math.max(0, endMs - startMs));
    const sel = g.step_ids.includes(selId) ? " selected" : "";
    const countBadge = g.count > 1
      ? '<span class="grain-group-count" title="' + g.count + ' steps combined at the ' +
        escapeHtml(grain) + ' detail level">' + g.count + "&times;</span>"
      : "";
    return '<div class="step-row grain-group-row' + sel + '" data-step-id="' +
        escapeHtml(g.step_ids[0] || "") + '" data-count="' + g.count + '">' +
      '<span class="grain-group-label" title="' + escapeHtml(g.label) + '">' +
        escapeHtml(g.label) + countBadge + "</span>" +
      '<span class="grain-group-dur meta">' + escapeHtml(dur) + "</span>" +
    "</div>";
  }).join("");
  const list = $("#step-list");
  if (list) {
    list.innerHTML = rows ||
      '<div class="empty-hint">No steps at this detail level.</div>';
    list.querySelectorAll(".grain-group-row").forEach((row) => {
      row.addEventListener("click", () => {
        State.setSelectedStepId(row.dataset.stepId || null);
        renderStepsLevel();
      });
    });
  }
  // Detail: show the selected member's editor so a group is still inspectable.
  const selected = allSteps.find((s) => s.step_id === selId) || null;
  PdtSteps.renderStepDetail($("#step-detail"), selected,
    stepDetailCallbacks(selected, interactionsById));
}

/* ===== ADR-0028 (R3): the case tree -- cases -> work items ============== */

/* Render the Steps list as the CASE TREE: cases (collapsed) -> case-scoped
   screen-visit work items. This is the DEFAULT screen-notch reading when the
   session has cases. A work-item row shows the work item's name (group
   annotation -> screen label), its duration, and "visited N× · M steps".
   Expanding a case shows its work items; clicking a work item selects it and
   shows the group-scoped R1c detail panel. The fine fragments are never
   destroyed -- slide the Detail slider to element to edit them individually. */
function renderCaseTree(wi, allSteps, interactionsById) {
  // Legend: name the active reading + the inverse (element to edit fragments).
  const legendEl = $("#steps-legend");
  if (legendEl) {
    legendEl.innerHTML = 'Grouped by <strong>ticket → screen</strong>: each row is ' +
      'one screen visit for a ticket, its bounces merged back together. ' +
      '<span class="grain-legend-hint">Set the Detail slider to <strong>element</strong> ' +
      'to edit individual fragments.</span>';
    legendEl.style.display = "";
  }
  // Hide the per-step filter/align controls that don't act on the tree.
  const listFilterEl = $("#step-list-filter");
  if (listFilterEl) listFilterEl.style.display = "none";
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) alignToggle.style.display = "none";

  const meta = $("#step-filter-meta");
  if (meta) {
    const totalItems = wi.cases.reduce((n, c) => n + c.work_items.length, 0);
    meta.textContent = wi.cases.length + " case" + (wi.cases.length === 1 ? "" : "s") +
      " · " + totalItems + " work item" + (totalItems === 1 ? "" : "s");
  }

  // Default: all cases collapsed. First render pre-expands nothing; a selection
  // keeps its case open so the selected row is visible.
  if (_wiSelected) _wiExpandedCases.add(_wiSelected.caseId == null ? "__unassigned__" : _wiSelected.caseId);

  const caseKey = (cid) => (cid == null ? "__unassigned__" : cid);
  const rowsHtml = wi.cases.map((cs) => {
    const ck = caseKey(cs.case_id);
    const expanded = _wiExpandedCases.has(ck);
    const nItems = cs.work_items.length;
    const totalMs = cs.work_items.reduce((n, w) => n + (w.total_ms || 0), 0);
    const head =
      '<div class="wi-case-head' + (expanded ? " open" : "") + '" data-case-key="' + escapeHtml(ck) + '">' +
        '<span class="wi-case-caret" aria-hidden="true">' + (expanded ? "▾" : "▸") + "</span>" +
        '<span class="wi-case-name" title="' + escapeHtml(cs.case_label) + '">' + escapeHtml(cs.case_label) + "</span>" +
        '<span class="wi-case-meta meta">' + nItems + " item" + (nItems === 1 ? "" : "s") +
          " · " + escapeHtml(formatDuration(totalMs)) + "</span>" +
      "</div>";
    if (!expanded) return head;
    const items = cs.work_items.map((w) => {
      const isSel = _wiSelected && _wiSelected.caseId === cs.case_id &&
        _wiSelected.screenKey === w.screen_key;
      const visited = w.visit_count > 1
        ? '<span class="wi-visits" title="' + w.visit_count + ' separate visits to this screen for this ticket, merged">visited ' +
          w.visit_count + "×</span> · " : "";
      const wasteTag = w.waste ? '<span class="wi-waste-tag" title="Flagged as waste">waste</span> ' : "";
      const hiddenCls = w.hidden ? " wi-item-hidden" : "";
      return '<div class="wi-item-row' + (isSel ? " selected" : "") + hiddenCls +
          '" data-case-key="' + escapeHtml(ck) + '" data-screen-key="' + escapeHtml(w.screen_key) + '">' +
        '<span class="wi-item-name" title="' + escapeHtml(w.label) + '">' + wasteTag + escapeHtml(w.label) + "</span>" +
        '<span class="wi-item-meta meta">' + visited + w.fragment_count +
          " step" + (w.fragment_count === 1 ? "" : "s") + "</span>" +
        '<span class="wi-item-dur meta">' + escapeHtml(formatDuration(w.total_ms || 0)) + "</span>" +
      "</div>";
    }).join("");
    return head + '<div class="wi-item-group">' + items + "</div>";
  }).join("");

  const list = $("#step-list");
  if (list) {
    list.innerHTML = rowsHtml || '<div class="empty-hint">No work items: no cases with steps.</div>';
    list.querySelectorAll(".wi-case-head").forEach((h) => {
      h.addEventListener("click", () => {
        const ck = h.dataset.caseKey;
        if (_wiExpandedCases.has(ck)) _wiExpandedCases.delete(ck);
        else _wiExpandedCases.add(ck);
        renderStepsLevel();
      });
    });
    list.querySelectorAll(".wi-item-row").forEach((r) => {
      r.addEventListener("click", () => {
        const ck = r.dataset.caseKey;
        _wiSelected = { caseId: ck === "__unassigned__" ? null : ck, screenKey: r.dataset.screenKey };
        // Select the first member step too, so a Jump-to-Flow / timeline seek
        // has a concrete target.
        const cs = wi.cases.find((c) => (c.case_id == null ? "__unassigned__" : c.case_id) === ck);
        const item = cs && cs.work_items.find((w) => w.screen_key === r.dataset.screenKey);
        if (item && item.step_ids.length) State.setSelectedStepId(item.step_ids[0]);
        renderStepsLevel();
      });
    });
  }

  // Detail: the group-scoped R1c panel for the selected work item (facts
  // aggregated; name/waste/hide act on the group).
  const selItem = _wiSelected ? _findSelectedWorkItem(wi) : null;
  renderWorkItemDetail($("#step-detail"), selItem, allSteps, interactionsById);
}

function _findSelectedWorkItem(wi) {
  if (!_wiSelected) return null;
  for (const cs of wi.cases) {
    if (cs.case_id !== _wiSelected.caseId) continue;
    const w = cs.work_items.find((x) => x.screen_key === _wiSelected.screenKey);
    if (w) return Object.assign({ case_label: cs.case_label }, w);
  }
  return null;
}

/* The group-scoped detail panel for a selected work item (ADR-0028): the R1c
   triage panel scoped to the WHOLE screen visit. Facts aggregated (duration,
   visits, fragment count, case); name/waste/hide act on the GROUP (writing to
   group_annotations); "More ▸" lists the member fragments with jump-to-timeline.
   Built here (not via renderStepDetail) because the acts target a group, not a
   single step -- but it reuses the same visual affordances. */
function renderWorkItemDetail(host, item, allSteps, interactionsById) {
  if (!host) return;
  if (!item) {
    host.innerHTML =
      '<div class="empty-pane">' +
        "<p>Pick a work item on the left to name it, note it, or flag it.</p>" +
        '<p class="meta">A work item is one <strong>screen visit for a ticket</strong>: ' +
        "every time you bounced into that screen while working the ticket, merged into " +
        "one thing to read and annotate. Naming it flows down to its fragments on the " +
        "timeline and the map.</p>" +
      "</div>";
    return;
  }
  const ga = item.group_annotation || {};
  const name = (ga.name || item.label || "").toString();
  const notes = (ga.notes || "").toString();
  const dur = formatDuration(item.total_ms || 0);
  const membersHtml = item.steps.map((s, i) => {
    const nm = escapeHtml(s.name || s.step_id || ("Fragment " + (i + 1)));
    const t = (s.time_range && s.time_range.start) ? new Date(s.time_range.start).toLocaleTimeString() : "";
    return '<div class="wi-member-row" data-step-id="' + escapeHtml(s.step_id) + '">' +
      '<span class="wi-member-name" title="' + escapeAttr(s.name || "") + '">' + nm + "</span>" +
      '<span class="wi-member-time meta">' + escapeHtml(t) + "</span>" +
      '<button class="wi-member-jump" title="Jump to this fragment in the Flow timeline">Jump ▸</button>' +
    "</div>";
  }).join("");
  const isHidden = !!ga.hidden;
  host.innerHTML =
    '<div class="step-stat-tiles">' +
      '<div class="stat-tile"><div class="stat-tile-label">Duration</div><div class="stat-tile-value">' + escapeHtml(dur) + "</div></div>" +
      '<div class="stat-tile"><div class="stat-tile-label">Visits</div><div class="stat-tile-value" title="How many separate times you entered this screen for this ticket">' + item.visit_count + "×</div></div>" +
      '<div class="stat-tile"><div class="stat-tile-label">Fragments</div><div class="stat-tile-value">' + item.fragment_count + "</div></div>" +
      '<div class="stat-tile"><div class="stat-tile-label">Case</div><div class="stat-tile-value" title="' + escapeAttr(item.case_label || "") + '">' + escapeHtml(item.case_label || "") + "</div></div>" +
    "</div>" +
    '<label>Name <input type="text" id="wi-name" value="' + escapeAttr(name) + '"></label>' +
    '<label>Notes <textarea id="wi-notes">' + escapeHtml(notes) + "</textarea></label>" +
    '<div class="flags">' +
      '<label title="This whole screen visit shouldn\'t be necessary (rework, duplicate effort). Feeds the waste analysis."><input type="checkbox" id="wi-waste" ' + (ga.waste ? "checked" : "") + "> Waste</label>" +
    "</div>" +
    '<div class="actions">' +
      '<button id="wi-save" class="primary">Save</button>' +
      '<button id="wi-hide" title="' + (isHidden ? "Bring this work item back into the tree" : "Suppress this whole screen visit from the case tree") + '">' + (isHidden ? "Unhide" : "Hide") + "</button>" +
    "</div>" +
    '<details class="step-detail-more">' +
      '<summary class="step-detail-more-head">' +
        '<span class="step-detail-more-title">More: ' + item.fragment_count + " fragment" + (item.fragment_count === 1 ? "" : "s") + "</span>" +
        '<span class="step-detail-more-chevron" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="step-detail-more-body"><div class="wi-members">' + membersHtml + "</div></div>" +
    "</details>";

  const saveBtn = host.querySelector("#wi-save");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const nm = (host.querySelector("#wi-name").value || "").trim();
    const nt = (host.querySelector("#wi-notes").value || "").trim();
    const wst = host.querySelector("#wi-waste").checked;
    saveWorkItemAnnotation(item, { name: nm, notes: nt, waste: wst });
  });
  const hideBtn = host.querySelector("#wi-hide");
  if (hideBtn) hideBtn.addEventListener("click", () => toggleWorkItemHidden(item));
  host.querySelectorAll(".wi-member-row").forEach((row) => {
    const jump = () => {
      const s = allSteps.find((x) => x.step_id === row.dataset.stepId);
      if (s) { State.setSelectedStepId(s.step_id); jumpToStepInFlow(s); }
    };
    const jb = row.querySelector(".wi-member-jump");
    if (jb) jb.addEventListener("click", (e) => { e.stopPropagation(); jump(); });
    row.addEventListener("click", () => {
      State.setSelectedStepId(row.dataset.stepId || null);
    });
  });
}

/* Upsert a work item's group_annotations entry (name/notes/waste), keyed by
   {case_id, screen_key}. Writes via persistAnnotations so Ctrl+Z reverts it
   (the annotation snapshot deep-clones the whole blob, so the additive key is
   covered by the existing undo mechanism -- no new undo system). An entry that
   becomes empty (no name/notes/waste/hidden) is removed, keeping the array lean. */
async function saveWorkItemAnnotation(item, patch) {
  if (!State.getSession() || !item) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const cid = item.case_id == null ? null : item.case_id;
  const key = item.screen_key;
  let entry = findGroupAnnotation(anno.group_annotations, cid, key);
  if (!entry) {
    entry = { case_id: cid, screen_key: key, manually_authored: true };
    anno.group_annotations.push(entry);
  }
  if ("name" in patch) entry.name = patch.name || "";
  if ("notes" in patch) entry.notes = patch.notes || "";
  if ("waste" in patch) entry.waste = !!patch.waste;
  entry.manually_authored = true;
  _pruneEmptyGroupAnnotation(anno, entry);
  await persistAnnotations(anno, "annotate work item");
  toast("Work item saved", "success");
  renderStepsLevel();
}

async function toggleWorkItemHidden(item) {
  if (!State.getSession() || !item) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const cid = item.case_id == null ? null : item.case_id;
  const key = item.screen_key;
  let entry = findGroupAnnotation(anno.group_annotations, cid, key);
  const nextHidden = !(entry && entry.hidden);
  if (!entry) {
    entry = { case_id: cid, screen_key: key, manually_authored: true };
    anno.group_annotations.push(entry);
  }
  entry.hidden = nextHidden;
  entry.manually_authored = true;
  _pruneEmptyGroupAnnotation(anno, entry);
  await persistAnnotations(anno, nextHidden ? "hide work item" : "unhide work item");
  toast(nextHidden ? "Work item hidden" : "Work item restored", "success");
  renderStepsLevel();
}

/* Drop a group_annotations entry that carries no analyst content (all of
   name/notes/waste/hidden empty) so the array doesn't accumulate blank rows. */
function _pruneEmptyGroupAnnotation(anno, entry) {
  const empty = !((entry.name || "").trim()) && !((entry.notes || "").trim()) &&
    !entry.waste && !entry.hidden;
  if (empty) {
    anno.group_annotations = (anno.group_annotations || []).filter((g) => g !== entry);
  }
}

/* R1 triage economics: a resident "App / Screen" fact for the step detail
   panel's fact line. Prefers the pipeline-stamped grain_keys (screen already
   value-freed at stamp time is not guaranteed, so re-apply screenType -- the
   same read-only helper the map's screen axis uses, imported but never
   mutated here); falls back to resolving live from the step's interactions
   for older sessions/hand-authored steps (mirrors process-map-levels' own
   _containmentKeys fallback). Never touches process-map-levels.js. */
function stepAppScreenFact(step, interactionsById) {
  if (!step) return "";
  const keys = (step.grain_keys && typeof step.grain_keys === "object")
    ? step.grain_keys
    : resolveStepGrainKeys(step, interactionsById || {});
  const app = (keys.app || "").trim();
  const screen = screenType(keys.screen || "").trim();
  if (app && screen && screen !== "(screen)") return app + " - " + screen;
  return app || (screen && screen !== "(screen)" ? screen : "");
}

/* The callbacks the per-step detail editor needs. Factored so both the flat
   reading and the aligned reading's exception editor (ADR-0015 Phase 4) wire the
   same verbs to a selected step. */
function stepDetailCallbacks(selected, interactionsById) {
  return {
    onSave: saveStep,
    onDelete: deleteStep,
    onSplit: splitStep,
    onMerge: mergeStepWithNext,
    onMergeSelected: mergeSelectedSteps,
    multiSelectedCount: State.getMultiSelectedStepIds().size,
    onJumpToFlow: (step) => jumpToStepInFlow(step),
    onWatchStep: (step) => watchStep(step),
    onToggleHide: toggleStepHidden,
    interactionsById,
    recordingAvailable: !!(State.getSession() && State.getSession().recordingAvailable),
    // Decision 1: how many tickets this step recurs in + the propagate action.
    repeatCount: (selected && selected._repeat) || 0,
    onPropagate: () => { if (selected) propagateStepToGroup(selected.step_id); },
    // A2: the chosen split boundary for this step (if any) + the picker.
    splitAfterIndex: (selected && _splitAfter.stepId === selected.step_id) ? _splitAfter.index : null,
    onPickSplit: (idx) => {
      if (!selected) return;
      if (_splitAfter.stepId === selected.step_id && _splitAfter.index === idx) {
        _splitAfter = { stepId: null, index: null };   // toggle the boundary off
      } else {
        _splitAfter = { stepId: selected.step_id, index: idx };
      }
      renderStepsLevel();
    },
    // R1 triage economics: resident one-line facts (duration/start/end already
    // came from time_range; these two are the added app/screen + case facts).
    appScreenFact: stepAppScreenFact(selected, interactionsById),
    caseLabel: selected && selected.case_id ? caseLabeler()(selected.case_id) : "",
  };
}

/* A friendly, stable label per case_id for the aligned reading: the canonical
   marker-enriched label from deriveCases when one exists, else a stable "Case N"
   index (never the opaque case_id hash). Lazy-require flow-view so the
   steps<->flow module cycle resolves at call time, not load time. */
function caseLabeler() {
  let cases = [];
  try { cases = require("./flow-view.js").deriveCases(State.getSession()) || []; } catch (_) { cases = []; }
  const m = {};
  cases.forEach((c, i) => { m[c.id] = (c.label && c.label !== c.id) ? c.label : ("Case " + (i + 1)); });
  return (id) => m[id] || "Case ?";
}

/* ADR-0015 Phase 2-4: render the aligned reading into the Steps list + detail.
   The consensus backbone is computed LIVE from the current annotation steps
   (no persisted template, per VALUE-CHAIN Decision 1), so it tracks analyst
   edits with no re-analyze. A backbone row selected -> the curate/instances
   detail; an exception (or a deselected backbone) -> the per-instance editor. */
function renderAlignedReading(interactionsById) {
  const steps = (State.getSession().annotations && State.getSession().annotations.steps) || [];
  const aligned = PdtAlign.alignCases(steps);
  const byId = {};
  for (const s of steps) byId[s.step_id] = s;
  const caseLabel = caseLabeler();

  // P0.4 discipline: an on-screen key for the frequency-pill encoding.
  const legendEl = $("#steps-legend");
  if (legendEl) {
    legendEl.innerHTML = '<span class="bb-freq">n/N</span> = cases (tickets) that include this step: curate one, then Apply to all instances';
    legendEl.style.display = "";
  }

  // null _alignSelIndex is a VALID state: an exception/instance step is selected
  // instead of a backbone row. Only default to the first backbone row when
  // nothing at all is selected; only snap back to 0 if the index fell off the end.
  if (_alignSelIndex != null && _alignSelIndex >= aligned.backbone.length) {
    _alignSelIndex = aligned.backbone.length ? 0 : null;
  } else if (_alignSelIndex == null && !State.getSelectedStepId() && aligned.backbone.length) {
    _alignSelIndex = 0;
  }

  PdtSteps.renderBackboneList($("#step-list"), {
    caseCount: aligned.caseCount,
    backbone: aligned.backbone,
    selectedIndex: _alignSelIndex,
    onSelectBackbone: (i) => { _alignSelIndex = i; State.setSelectedStepId(null); renderStepsLevel(); },
    // Phase 4: steps a case has that the consensus lacks. Selecting one drops
    // the backbone selection and shows the normal per-instance editor below.
    exceptions: aligned.exceptions.map(ex => Object.assign({ caseLabel: caseLabel(ex.caseId) }, ex)),
    selectedStepId: State.getSelectedStepId(),
    onSelectException: (sid) => { _alignSelIndex = null; State.setSelectedStepId(sid); renderStepsLevel(); },
  });

  const entry = (_alignSelIndex != null) ? aligned.backbone[_alignSelIndex] : null;
  if (entry) {
    const instances = entry.members.map(m => ({ caseId: m.caseId, caseLabel: caseLabel(m.caseId), step: byId[m.stepId] }));
    const memberSteps = entry.members.map(m => byId[m.stepId]).filter(Boolean);
    const seed = Object.assign({ name: entry.token }, PdtAlign.representativeCuration(memberSteps));
    const idx = _alignSelIndex;
    PdtSteps.renderBackboneDetail($("#step-detail"), entry, {
      caseCount: aligned.caseCount,
      instances,
      seed,
      onJump: (sid) => { const s = byId[sid]; if (s) jumpToStepInFlow(s); },
      onApply: (curated) => applyCurationToBackbone(idx, curated),
    });
  } else {
    // Phase 4: an exception step selected -> edit it in place with the normal
    // per-instance editor (rename / flag / delete / split / jump). Otherwise the
    // empty hint.
    const sel = byId[State.getSelectedStepId()] || null;
    if (sel) {
      PdtSteps.renderStepDetail($("#step-detail"), sel, stepDetailCallbacks(sel, interactionsById));
    } else {
      PdtSteps.renderBackboneDetail($("#step-detail"), null, {});
    }
  }
}

/* ADR-0015 Phase 3: curate one consensus step -> propagate to ALL its aligned
   instances across cases in ONE annotations write (therefore one Ctrl+Z). Fork
   F2 default = confirmed: the analyst edits the consensus name/description/flags
   then clicks Apply; nothing auto-applies. Re-derives the backbone from the live
   steps so the member set is current at apply time. */
async function applyCurationToBackbone(backboneIndex, curated) {
  if (!State.getSession() || !curated) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const aligned = PdtAlign.alignCases(anno.steps || []);
  const entry = aligned.backbone[backboneIndex];
  if (!entry || !entry.members.length) { toast("No instances to apply to", "error"); return; }
  let applied = 0;
  for (const m of entry.members) {
    const t = (anno.steps || []).find(s => s.step_id === m.stepId);
    if (!t) continue;
    if (curated.name) t.name = curated.name;
    t.description = curated.description || "";
    t.flags = Object.assign({}, t.flags || {}, curated.flags || {});
    t.state = t.state === "manually_authored" ? "manually_authored" : "edited";
    applied++;
  }
  await persistAnnotations(anno, "apply to all instances");   // one write -> one Ctrl+Z
  toast("Applied to " + applied + " instance(s) across cases", "success");
  renderStepsLevel();
}

async function inlineRenameStep(stepId, newName, advance) {
  // Special command: "open-next:<id>" means just re-render and trigger
  // the next row's rename without modifying any data.
  if (typeof advance === "string" && advance.startsWith("open-next:")) {
    const nextId = advance.slice("open-next:".length);
    State.setSelectedStepId(nextId);
    renderStepsLevel();
    setTimeout(() => beginRenameOnSelected(), 30);
    return;
  }
  if (!State.getSession() || !stepId || !newName) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  step.name = newName;
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, 'rename step');
  if (advance === "next") {
    const idx = anno.steps.findIndex(s => s.step_id === stepId);
    const nextStep = anno.steps[idx + 1];
    if (nextStep) {
      State.setSelectedStepId(nextStep.step_id);
      renderStepsLevel();
      setTimeout(() => beginRenameOnSelected(), 30);
    }
  }
}

function beginRenameOnSelected() {
  if (!State.getSelectedStepId()) return;
  const row = document.querySelector(`.step-row[data-step-id="${State.getSelectedStepId()}"] .step-name`);
  if (row) {
    const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    row.dispatchEvent(evt);
  }
}

async function saveStep(updatedStep) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === updatedStep.step_id);
  if (idx >= 0) anno.steps[idx] = updatedStep;
  else anno.steps.push(updatedStep);
  await persistAnnotations(anno, 'save step');
  toast("Step saved", "success");
}

async function deleteStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  const ok = await confirmModal({
    title: "Delete step?",
    message: step ? `Delete step "${step.name || "(unnamed)"}"?` : "Delete this step?",
    detail: "Ctrl+Z will restore it.",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  anno.steps = anno.steps.filter(s => s.step_id !== stepId);
  if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
  await persistAnnotations(anno, 'delete step');
  toast("Step deleted", "success");
}

/* Toggle a step's "hidden" state. Hidden steps drop out of the list
   (unless the hidden filter chip is on) and survive re-analyze via
   _merge_steps. The pre-hide state is stashed on `_prev_state` so
   unhiding restores it. */
async function toggleStepHidden(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = anno.steps.find(s => s.step_id === stepId);
  if (!step) return;
  if (step.state === "hidden") {
    step.state = step._prev_state || "auto_suggested";
    delete step._prev_state;
    await persistAnnotations(anno, "unhide step");
    toast("Step restored", "success");
  } else {
    step._prev_state = step.state;
    step.state = "hidden";
    if (State.getSelectedStepId() === stepId) State.setSelectedStepId(null);
    await persistAnnotations(anno, "hide step");
    toast("Step hidden: reveal via the hidden filter chip", "success");
  }
}

async function splitStep(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idx = anno.steps.findIndex(s => s.step_id === stepId);
  if (idx < 0) return;
  const s = anno.steps[idx];
  const ids = (s.evidence || {}).interaction_event_ids || [];   // a step may lack evidence
  if (ids.length < 2) { toast("Need ≥2 interactions to split", "error"); return; }
  // A2: split at the analyst-picked boundary (split AFTER index i -> first
  // chunk is [0..i]) when one is set for THIS step; else the midpoint.
  let mid;
  if (_splitAfter.stepId === stepId && Number.isInteger(_splitAfter.index)
      && _splitAfter.index >= 0 && _splitAfter.index < ids.length - 1) {
    mid = _splitAfter.index + 1;
  } else {
    mid = Math.floor(ids.length / 2);
  }
  const firstIds = ids.slice(0, mid);
  const secondIds = ids.slice(mid);
  const interMap = Object.fromEntries(State.getSession().events.filter(e => e.type === "interaction").map(e => [e.event_id, e]));
  const firstEvents = firstIds.map(id => interMap[id]).filter(Boolean);
  const secondEvents = secondIds.map(id => interMap[id]).filter(Boolean);
  if (!firstEvents.length || !secondEvents.length) { toast("Could not split step", "error"); return; }
  // G-4: splitting an already-split step must not stack suffixes
  // ("X (split 1) (split 1)") — strip any existing artifact first.
  const baseName = stripSplitSuffix(s.name);
  const second = { ...s, step_id: cryptoRandomId(),
    name: baseName + " (split 2)",
    time_range: { start: secondEvents[0].timestamp, end: secondEvents[secondEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: secondIds },
    state: "edited" };
  const first = { ...s, name: baseName + " (split 1)",
    time_range: { start: firstEvents[0].timestamp, end: firstEvents[firstEvents.length - 1].timestamp },
    evidence: { ...s.evidence, interaction_event_ids: firstIds },
    state: "edited" };
  anno.steps.splice(idx, 1, first, second);
  _splitAfter = { stepId: null, index: null };
  await persistAnnotations(anno, 'split step');
  toast("Step split", "success");
}

/* "Add step here" from the Flow video playhead -- always adds a step,
   never refuses:
     - playhead inside a step -> split that step at the playhead
       (a boundary inside a step necessarily cuts it in two);
     - playhead in open space -> new step from the playhead to the
       next step's start (or the session end);
     - no steps yet           -> carve the session into "Step 1" /
       "Step 2" at the playhead.
   Distinct from splitStep(), which cuts a selected step at its
   interaction-count midpoint. */
async function addStepAtTimestamp(tsISO) {
  if (!State.getSession()) return;
  const t = new Date(tsISO).getTime();
  if (!isFinite(t)) { toast("Couldn't read the playhead position", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const inter = State.getSession().events.filter(e => e.type === "interaction");
  const interMap = Object.fromEntries(inter.map(e => [e.event_id, e]));
  const evTime = (id) => interMap[id] ? new Date(interMap[id].timestamp).getTime() : NaN;
  const tISO = new Date(t).toISOString();

  // No steps yet: carve the whole session in two at the playhead.
  if (!anno.steps.length) {
    const span = getSpan();
    if (!span) { toast("No events to anchor a step to", "error"); return; }
    const before = inter.filter(e => new Date(e.timestamp).getTime() < t).map(e => e.event_id);
    const after = inter.filter(e => new Date(e.timestamp).getTime() >= t).map(e => e.event_id);
    anno.steps.push(
      makeStep("Step 1", new Date(span.startMs).toISOString(), tISO, before),
      makeStep("Step 2", tISO, new Date(span.endMs).toISOString(), after),
    );
    await persistAnnotations(anno, "Add step at playhead");
    toast('Created "Step 1" and "Step 2"', "success");
    return;
  }

  // Playhead inside a step: split that step at the playhead.
  const idx = anno.steps.findIndex(s => s.time_range
    && new Date(s.time_range.start).getTime() < t
    && new Date(s.time_range.end).getTime() > t);
  if (idx >= 0) {
    const s = anno.steps[idx];
    const ids = (s.evidence && s.evidence.interaction_event_ids) || [];
    const newName = nextStepName(anno.steps);
    const first = { ...s, time_range: { start: s.time_range.start, end: tISO },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) < t) },
      state: "edited" };
    const second = { ...s, step_id: cryptoRandomId(), name: newName,
      time_range: { start: tISO, end: s.time_range.end },
      evidence: { ...(s.evidence || {}), interaction_event_ids: ids.filter(id => evTime(id) >= t) },
      state: "edited" };
    anno.steps.splice(idx, 1, first, second);
    await persistAnnotations(anno, "Add step at playhead");
    toast('Added "' + newName + '"', "success");
    return;
  }

  // Playhead in open space: new step from the playhead to the next boundary.
  const span = getSpan();
  const next = anno.steps
    .filter(s => s.time_range && s.time_range.start)
    .map(s => new Date(s.time_range.start).getTime())
    .filter(ms => ms >= t)
    .sort((a, b) => a - b)[0];
  const endMs = next != null ? next : (span ? span.endMs : t + 5000);
  if (endMs - t <= 0) { toast("A step already starts here"); return; }
  const newName = nextStepName(anno.steps);
  const ids = inter
    .filter(e => { const et = new Date(e.timestamp).getTime(); return et >= t && et < endMs; })
    .map(e => e.event_id);
  anno.steps.push(makeStep(newName, tISO, new Date(endMs).toISOString(), ids));
  await persistAnnotations(anno, "Add step at playhead");
  toast('Added "' + newName + '"', "success");
}

function makeStep(name, startISO, endISO, eventIds) {
  return {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    time_range: { start: startISO, end: endISO },
    evidence: { interaction_event_ids: eventIds, screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
    phase_id: null,
  };
}

function nextStepName(steps) {
  let max = 0;
  for (const s of steps) {
    const m = /^Step (\d+)$/.exec(s.name || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "Step " + (max + 1);
}

const byStartTime = (a, b) =>
  ((a.time_range && a.time_range.start) || "").localeCompare((b.time_range && b.time_range.start) || "");

/* G-4: "(split N)" suffixes are split-tool artifacts; they stack and then
   ride along into merged names ("X (split 1) (split 1) + Y" — the owner's
   real session). Strip them whenever a name is reused as a building block. */
function stripSplitSuffix(name) {
  return String(name || "").replace(/(\s*\(split \d+\))+/g, "").trim() || String(name || "").trim();
}

/* Fold an ordered list of steps into one. The first step's identity +
   metadata wins; the time range stretches to cover the last; evidence is
   concatenated. Shared by both merge entry points so they cannot diverge.
   The merged name dedupes the parts (merging "X (split 1)" + "X (split 2)"
   reads "X", not "X + X") and caps its length — a merge of long auto names
   must not produce a paragraph. */
function mergeStepObjects(toMerge) {
  const first = toMerge[0];
  const last = toMerge[toMerge.length - 1];
  const parts = [];
  for (const s of toMerge) {
    const n = stripSplitSuffix(s.name);
    if (n && !parts.includes(n)) parts.push(n);
  }
  let mergedName = parts.join(" + ") || stripSplitSuffix(first.name);
  if (mergedName.length > 120) mergedName = mergedName.slice(0, 119) + "…";
  return {
    ...first,
    name: mergedName,
    time_range: { start: first.time_range.start, end: last.time_range.end },
    evidence: {
      ...first.evidence,
      interaction_event_ids: toMerge.flatMap(s => (s.evidence && s.evidence.interaction_event_ids) || []),
      screenshot_refs: toMerge.flatMap(s => (s.evidence && s.evidence.screenshot_refs) || []),
    },
    state: "edited",
  };
}

async function commitMerge(anno, toMerge, undoLabel) {
  const merged = mergeStepObjects(toMerge);
  const mergedIds = new Set(toMerge.map(s => s.step_id));
  anno.steps = anno.steps.filter(s => !mergedIds.has(s.step_id));
  anno.steps.push(merged);
  State.setSelectedStepId(merged.step_id);
  await persistAnnotations(anno, undoLabel);
  return merged;
}

/* P0.1: merge the clicked step with the chronologically NEXT step -- always,
   regardless of any multi-selection. The selection-aware merge is a separate,
   explicitly-labelled action (mergeSelectedSteps) so one control never does
   two things on hidden state (the "merged the wrong pair" defect). */
async function mergeStepWithNext(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const sorted = anno.steps.slice().sort(byStartTime);
  const idx = sorted.findIndex(s => s.step_id === stepId);
  if (idx < 0) { toast("Step not found", "error"); return; }
  if (idx === sorted.length - 1) { toast("No next step to merge with", "error"); return; }
  const toMerge = [sorted[idx], sorted[idx + 1]];
  await commitMerge(anno, toMerge, 'merge step with next');
  toast('Merged "' + toMerge[0].name + '" + "' + toMerge[1].name + '"', "success");
}

/* P0.1: merge exactly the Ctrl/checkbox multi-selected steps (chronologically
   ordered), the inverse of split for an arbitrary set. Acts on the user's
   actual selection -- never falls back to "next". */
async function mergeSelectedSteps() {
  if (!State.getSession()) return;
  const multi = State.getMultiSelectedStepIds();
  if (!multi || multi.size < 2) { toast("Tick 2+ steps to merge", "error"); return; }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const toMerge = anno.steps.filter(s => multi.has(s.step_id)).sort(byStartTime);
  if (toMerge.length < 2) { toast("Select at least two steps to merge", "error"); return; }
  const merged = await commitMerge(anno, toMerge, 'merge selected steps');
  multi.clear();
  syncMultiSelectButtons();
  toast('Merged ' + toMerge.length + ' steps into "' + merged.name + '"', "success");
}

/* Keep the two multi-selection toolbar actions (delete / merge) in lockstep
   with the selection size, from one place so they cannot drift. They are
   HIDDEN until 2+ steps are ticked -- a permanently-disabled button is just
   noise in the toolbar (clutter pass); it appears only when it can be used. */
function syncMultiSelectButtons() {
  const n = State.getMultiSelectedStepIds().size;
  for (const id of ["btn-delete-selected-steps", "btn-merge-selected"]) {
    const b = $("#" + id);
    if (b) b.hidden = n < 2;
  }
}

/* Move a step one slot up/down. The swap is relative to the step's
   neighbour in the *displayed* (filtered) order so it stays intuitive
   when a filter is active, but applied to the underlying anno.steps. */
async function reorderStep(stepId, delta) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const f = State.getListFilters().step;
  const visible = (anno.steps || [])
    .filter(s => stepMatchesFilter(s, f, State.getCaseScope()));
  const vIdx = visible.findIndex(s => s.step_id === stepId);
  const neighbour = visible[vIdx + delta];
  if (vIdx < 0 || !neighbour) return;
  const i = anno.steps.findIndex(s => s.step_id === stepId);
  const j = anno.steps.findIndex(s => s.step_id === neighbour.step_id);
  if (i < 0 || j < 0) return;
  const tmp = anno.steps[i];
  anno.steps[i] = anno.steps[j];
  anno.steps[j] = tmp;
  await persistAnnotations(anno, 'reorder step');
}

/* Keyboard reorder (Alt+ArrowUp / Alt+ArrowDown from renderer): move the
   SELECTED step one slot, then re-render + keep it visible. reorderStep
   persists but does not re-render, so this wraps it. Reuses the arrival-reveal
   scroll path (the only unrequested scroll) since the moved row is the point of
   the act -- an explicit reorder is a request to see the row move. */
async function reorderSelectedStep(delta) {
  const sid = State.getSelectedStepId();
  if (!sid) return;
  await reorderStep(sid, delta);
  renderStepsLevel();
  const row = document.querySelector('.step-row[data-step-id="' + sid + '"]');
  if (row) row.scrollIntoView({ block: "nearest" });
}

/* Reorder the whole step list chronologically by time_range.start. */
async function sortStepsByTime() {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  if (!anno.steps.length) { toast("No steps to sort", ""); return; }
  anno.steps.sort((a, b) =>
    ((a.time_range && a.time_range.start) || "")
      .localeCompare((b.time_range && b.time_range.start) || ""));
  await persistAnnotations(anno, 'sort steps by time');
  toast("Steps sorted by start time", "success");
}

async function addManualStep() {
  if (!State.getSession()) return;
  const name = await promptModal({ title: "Add manual step", message: "Name this step", placeholder: "e.g., Search customer in CRM", okLabel: "Add step" });
  if (!name) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const video = $("#video");
  let tsNow = video ? videoTimeToSessionTs(video.currentTime) : null;   // #video may be absent
  if (!tsNow) {
    // No video to anchor to: drop the step at the end of the session's
    // recorded span (after any existing step) rather than wall-clock
    // now, which would land far past the timeline.
    const span = getSpan();
    let anchorMs = span ? span.endMs : Date.now();
    for (const s of anno.steps) {
      const end = s.time_range && s.time_range.end && new Date(s.time_range.end).getTime();
      if (end && end > anchorMs) anchorMs = end;
    }
    tsNow = new Date(anchorMs).toISOString();
  }
  // Default duration so manual steps render with a non-zero width
  // in the mini-timeline; the analyst can edit the time range later.
  const endTs = new Date(new Date(tsNow).getTime() + 5000).toISOString();
  const step = {
    step_id: cryptoRandomId(),
    session_id: (State.getSession().manifest && State.getSession().manifest.session_id) || "",
    case_id: null,
    name,
    description: "",
    time_range: { start: tsNow, end: endTs },
    evidence: { interaction_event_ids: [], screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
    state: "manually_authored",
    canonical_step_id: null,
    flags: { conditional: false, condition_text: null, exception_path: false, waste: false, automation_candidate: false },
    phase_id: null,
  };
  anno.steps.push(step);
  State.setSelectedStepId(step.step_id);
  await persistAnnotations(anno, 'add step');
  toast("Manual step added", "success");
}

/* Bulk-delete the Ctrl+click multi-selection. One confirm for the
   whole set; Ctrl+Z restores. */
async function deleteSelectedSteps() {
  if (!State.getSession()) return;
  const ids = Array.from(State.getMultiSelectedStepIds());
  if (ids.length < 2) return;
  const ok = await confirmModal({
    title: "Delete " + ids.length + " steps?",
    message: "Delete the " + ids.length + " selected steps?",
    detail: "Ctrl+Z restores them all.",
    okLabel: "Delete " + ids.length,
    danger: true,
  });
  if (!ok) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const idSet = new Set(ids);
  anno.steps = anno.steps.filter(s => !idSet.has(s.step_id));
  if (idSet.has(State.getSelectedStepId())) State.setSelectedStepId(null);
  State.getMultiSelectedStepIds().clear();
  await persistAnnotations(anno, "delete " + ids.length + " steps");
  syncMultiSelectButtons();
  toast(ids.length + " steps deleted", "success");
}

/* ===== Ignored apps (step-noise denylist) =====
   Apps the analyst checks here are written to annotations.json under
   step_filters.ignored_processes; step_suggest.py drops their
   interactions before step suggestion. Saving re-analyzes the session
   so the step list refreshes immediately. */
function distinctSessionApps() {
  const counts = new Map();
  for (const ev of (State.getSession() && State.getSession().events) || []) {
    if (ev.type !== "interaction") continue;
    const proc = (ev.data && ev.data.process_name) || "(unknown)";
    counts.set(proc, (counts.get(proc) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([proc, n]) => ({ proc, count: n }))
    .sort((a, b) => b.count - a.count);
}

function openIgnoredAppsDialog() {
  if (!State.getSession()) { toast("Open a session first.", ""); return; }
  const apps = distinctSessionApps();
  if (!apps.length) {
    toast("No interaction data in this session: nothing to filter.", "");
    return;
  }
  const anno = ensureAnnoShape(State.getSession().annotations);
  const current = new Set((anno.step_filters.ignored_processes || []).map(s => String(s).toLowerCase()));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal modal-simple" role="dialog">' +
      '<header class="modal-header"><h2>Ignored apps</h2>' +
        '<button class="icon-btn modal-close" id="ia-close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta" style="margin-top:0">Apps you tick here are left out of step suggestions: useful for OBS, the tracker itself, or anything that isn\'t part of the process you\'re mapping. Saving re-analyzes the session.</p>' +
        '<div id="ia-list" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button id="ia-cancel">Cancel</button>' +
        '<button id="ia-save" class="primary">Save &amp; re-analyze</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  const list = backdrop.querySelector("#ia-list");
  list.innerHTML = apps.map((a, i) => {
    const checked = current.has(a.proc.toLowerCase()) ? " checked" : "";
    return '<label class="cb" style="display:flex;gap:8px;padding:5px 4px;align-items:center">' +
      '<input type="checkbox" data-proc="' + escapeHtml(a.proc) + '"' + checked + ' />' +
      '<span style="flex:1">' + escapeHtml(a.proc) + '</span>' +
      '<span class="meta">' + a.count + ' interactions</span>' +
      '</label>';
  }).join("");

  function close() { backdrop.remove(); }
  backdrop.querySelector("#ia-close").addEventListener("click", close);
  backdrop.querySelector("#ia-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#ia-save").addEventListener("click", async () => {
    const picked = Array.from(list.querySelectorAll("input[type=checkbox]"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.proc);
    anno.step_filters.ignored_processes = picked;
    // Settings change -- written directly (not via the undo stack), through
    // the one write path (RP-04): a failed save has already been shown as an
    // error, so keep the dialog open and do not re-analyze.
    try {
      await Session.saveAnnotationsDirect(anno, "ignored apps");
    } catch (_) {
      return;
    }
    close();
    toast(picked.length
      ? "Ignoring " + picked.length + " app(s): re-analyzing..."
      : "No apps ignored: re-analyzing...", "success");
    // Re-analyze so the step list reflects the new denylist.
    const normBtn = $("#btn-normalize");
    if (normBtn) normBtn.click();
  });
}

/* Wire the Steps surface. deps = { ensureAnnoShape, persistAnnotations,
   videoTimeToSessionTs, jumpToStepInFlow, watchStep }. Call once at boot. */
function initStepsView(deps) {
  ensureAnnoShape = deps.ensureAnnoShape;
  persistAnnotations = deps.persistAnnotations;
  videoTimeToSessionTs = deps.videoTimeToSessionTs;
  jumpToStepInFlow = deps.jumpToStepInFlow;
  watchStep = deps.watchStep || (() => {});

  const txt = document.getElementById("step-filter-text");
  if (txt) {
    let t;
    txt.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        State.getListFilters().step.text = txt.value.trim();
        renderStepsLevel();
      }, 120);
    });
  }
  const stateGrp = document.getElementById("step-filter-states");
  if (stateGrp) {
    stateGrp.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const st = chip.dataset.state;
      const set = State.getListFilters().step.states;
      if (set.has(st)) set.delete(st); else set.add(st);
      renderStepsLevel();
    });
  }
  if ($("#btn-add-manual-step")) $("#btn-add-manual-step").addEventListener("click", addManualStep);
  if ($("#btn-sort-steps-time")) $("#btn-sort-steps-time").addEventListener("click", sortStepsByTime);
  if ($("#btn-delete-selected-steps")) $("#btn-delete-selected-steps").addEventListener("click", deleteSelectedSteps);
  if ($("#btn-merge-selected")) $("#btn-merge-selected").addEventListener("click", mergeSelectedSteps);
  if ($("#btn-ignored-apps")) $("#btn-ignored-apps").addEventListener("click", openIgnoredAppsDialog);

  // ADR-0015: the Flat / Aligned reading toggle (shown only with 2+ cases).
  const alignToggle = $("#step-align-toggle");
  if (alignToggle) {
    alignToggle.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b) return;
      const next = b.dataset.mode === "aligned";
      if (next === _alignMode) return;
      _alignMode = next;
      _alignSelIndex = next ? 0 : null;
      renderStepsLevel();
    });
  }
}

/* A2/A5: toggle one boolean flag on a step and persist. Shared by the step
   timeline context menu and any other quick-flag affordance. */
async function toggleStepFlag(stepId, flagKey) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const step = (anno.steps || []).find(s => s.step_id === stepId);
  if (!step) return;
  step.flags = step.flags || {};
  step.flags[flagKey] = !step.flags[flagKey];
  step.state = step.state === "manually_authored" ? "manually_authored" : "edited";
  await persistAnnotations(anno, (step.flags[flagKey] ? "flag " : "unflag ") + flagKey);
  toast(step.flags[flagKey] ? "Flagged" : "Flag cleared", "success");
}

/* Decision 1: apply this step's name + description + flags to the matching
   steps in the OTHER cases it recurs in -- "curate one ticket, apply to all".
   Alignment is by the value-agnostic structural signature (step-alignment.js). */
async function propagateStepToGroup(stepId) {
  if (!State.getSession()) return;
  const anno = ensureAnnoShape(State.getSession().annotations);
  const interactionsById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") interactionsById[ev.event_id] = ev;
  }
  const group = PdtAlign.groupForStep(stepId, anno.steps || [], interactionsById);
  if (!group || group.caseSpan < 2) {
    toast("This step doesn't recur across tickets", "error");
    return;
  }
  const source = (anno.steps || []).find(s => s.step_id === stepId);
  if (!source) return;
  let applied = 0;
  for (const m of group.members) {
    if (m.stepId === stepId) continue;
    const t = (anno.steps || []).find(s => s.step_id === m.stepId);
    if (!t) continue;
    t.name = source.name;
    t.description = source.description;
    t.flags = { ...(source.flags || {}) };
    t.state = t.state === "manually_authored" ? "manually_authored" : "edited";
    applied++;
  }
  await persistAnnotations(anno, "apply step to repeats");
  toast("Applied to " + applied + " matching step(s) in other tickets", "success");
  renderStepsLevel();
}

/* A5: right-click context menu for a step block in the Step timeline.
   Mirrors the inline-styled menu pattern used by the Flow timeline
   (flow-view.js showMarkerInsertMenu) for visual consistency. */
function showStepContextMenu(stepId, x, y) {
  const prior = document.getElementById("step-ctx-menu");
  if (prior) prior.remove();
  const session = State.getSession();
  const anno = session && session.annotations;
  const step = anno && (anno.steps || []).find(s => s.step_id === stepId);
  if (!step) return;
  State.setSelectedStepId(stepId);

  const menu = document.createElement("div");
  menu.id = "step-ctx-menu";
  menu.style.cssText =
    "position:fixed;z-index:1000;background:var(--bg-3);color:var(--fg);" +
    "border:1px solid var(--rule);padding:4px 0;border-radius:var(--radius-sm);" +
    "box-shadow:var(--shadow);font:13px var(--font-ui);min-width:210px;cursor:default;user-select:none;";
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  function addItem(label, handler) {
    const item = document.createElement("div");
    item.textContent = label;
    item.style.cssText = "padding:6px 14px;cursor:pointer;";
    item.addEventListener("mouseenter", () => { item.style.background = "var(--accent)"; });
    item.addEventListener("mouseleave", () => { item.style.background = ""; });
    item.addEventListener("click", async () => { menu.remove(); await handler(); });
    menu.appendChild(item);
  }
  function addSep() {
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;margin:4px 0;background:var(--rule);";
    menu.appendChild(sep);
  }

  const flags = step.flags || {};
  addItem("Split at interaction…", () => {
    renderStepsLevel();
    toast("Click the scissors on an interaction, then Split", "success");
  });
  addItem("Merge with next", () => mergeStepWithNext(stepId));
  // P0.1: the selection-aware merge is a distinct item, shown only when a
  // multi-selection exists -- so its label can name the count it acts on.
  const _multiSel = State.getMultiSelectedStepIds();
  if (_multiSel && _multiSel.size >= 2) {
    addItem("Merge " + _multiSel.size + " selected steps", () => mergeSelectedSteps());
  }
  addItem("Rename", () => { renderStepsLevel(); setTimeout(() => beginRenameOnSelected(), 30); });
  // R1 (Steps chrome diet): reorder relocated here from the retired per-row
  // ↑ / ↓ buttons. Same reorderStep callback + semantics (swap with the
  // visible neighbour in the filtered list). Only offer a direction that has a
  // neighbour, so no menu item is a no-op. reorderStep persists but does not
  // re-render, so re-render after it (mirrors the other mutating items).
  const _f = State.getListFilters().step;
  const _visible = (anno.steps || [])
    .filter(s => stepMatchesFilter(s, _f, State.getCaseScope()));
  const _vIdx = _visible.findIndex(s => s.step_id === stepId);
  if (_vIdx > 0) {
    addItem("Move up", async () => { await reorderStep(stepId, -1); renderStepsLevel(); });
  }
  if (_vIdx >= 0 && _vIdx < _visible.length - 1) {
    addItem("Move down", async () => { await reorderStep(stepId, 1); renderStepsLevel(); });
  }
  addItem(step.state === "hidden" ? "Unhide" : "Hide as noise", () => toggleStepHidden(stepId));
  addItem("Jump to in Flow", () => {
    const s = (anno.steps || []).find(x => x.step_id === stepId);
    if (s) jumpToStepInFlow(s);
  });
  if (session && session.recordingAvailable) {
    addItem("Watch", () => {
      const s = (anno.steps || []).find(x => x.step_id === stepId);
      if (s) watchStep(s);
    });
  }
  addSep();
  addItem(flags.waste ? "Clear waste flag" : "Flag as waste",
    () => toggleStepFlag(stepId, "waste"));
  addItem(flags.automation_candidate ? "Clear automation flag" : "Flag as automation candidate",
    () => toggleStepFlag(stepId, "automation_candidate"));

  // Decision 1: "apply to repeats" when this step recurs across cases.
  const _interById = {};
  for (const ev of (State.getSession().events || [])) {
    if (ev.type === "interaction") _interById[ev.event_id] = ev;
  }
  const _grp = PdtAlign.groupForStep(stepId, (anno.steps || []), _interById);
  if (_grp && _grp.caseSpan > 1) {
    addSep();
    addItem("Apply name + flags to " + (_grp.caseSpan - 1) + " repeat(s)",
      () => propagateStepToGroup(stepId));
  }

  document.body.appendChild(menu);
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
  renderStepsLevel();   // reflect the new selection immediately
}

module.exports = {
  initStepsView, renderStepsLevel, beginRenameOnSelected, addManualStep,
  deleteSelectedSteps, splitStep, mergeStepWithNext, mergeSelectedSteps,
  addStepAtTimestamp, reorderSelectedStep,
  // G-4 label hygiene -- pure, exported for unit testing.
  stripSplitSuffix, mergeStepObjects,
};
