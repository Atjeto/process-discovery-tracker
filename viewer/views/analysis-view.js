/*
 * analysis-view.js -- the analytical Evidence modules (formerly the Analysis
 * level of the Session view; the level was retired in R4).
 *
 * R1 of the approachability redesign (docs/To-Do/APPROACHABILITY-REDESIGN-
 * 2026-07-03.md §4/§5) subtracted this view down to "Where the time goes"
 * (the time study, now also the judgment-editor entry point) and
 * "Automation candidates" (finding cards, ADR-0016); the BA-helper refocus
 * cut the ROI section (the business case lives outside this tool). "Process
 * efficiency" and the "Waste by step/screen" resident module were removed
 * (efficiency returns later as a finding; its underlying computation in
 * `applyAnalysisOverrides` stays intact for that future use, unrendered).
 *
 * R4 (§5) retired the Analysis view-mode tab: these modules now render
 * into the Overview's Evidence layer (below the findings feed) via
 * `renderEvidenceInto(host)`. The uniform collapsible-module header + per-
 * analyst collapse persistence (pdt.analysis.* keys) are unchanged.
 *
 * The underlying estimates ship provisional (ADR-0008): the value-add vs.
 * business-required split needs a human, and confirming a candidate really
 * is automation-worthy is an analyst call. Corrections live in
 * annotations.json `analysis_overrides[]`, keyed by `process_label`
 * for waste and by `segment_signature` for automation; not in
 * analysis.json (which `normalize` regenerates every run).
 * `applyAnalysisOverrides` folds them back in so the view updates
 * immediately; the next Analyze run bakes them into analysis.json
 * proper. See ANALYSIS-LAYER-FOLLOWUPS.md and ADR-0016.
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const State = require("../state.js");
const Session = require("../session.js");
const { formModal } = require("../modals.js");
const { processLabel, grainLabel } = require("../process-map-levels.js");
const { findingCardHtml } = require("../finding-cards.js");

/* ADR-0024: resolve, for the CURRENT grain notch, how to re-bucket the
   step-grained analysis (Waste by step, Time study). Returns two maps built
   from the session's steps: stepId -> grain label (exact) and process_label ->
   grain label (majority, for the pre-aggregated time-study rows that carry no
   step_id). At the element notch the analysis stays at the process_label grain
   (the existing, editable behaviour), so callers skip regrouping there. */
function _grainMaps(notch) {
  const sess = State.getSession();
  const anno = (sess && sess.annotations) || {};
  const phaseName = {};
  for (const ph of (anno.phases || [])) phaseName[ph.phase_id] = ph.name || "(phase)";
  const interactionsById = {};
  for (const ev of ((sess && sess.events) || [])) {
    if (ev.type === "interaction" && ev.event_id) interactionsById[ev.event_id] = ev;
  }
  const ctx = { phaseName, interactionsById, caseLabel: (id) => id };
  const byStepId = new Map();
  const plCounts = new Map();   // process_label -> Map(grainLabel -> count)
  for (const st of (anno.steps || [])) {
    if (!st || st.state === "hidden") continue;
    const label = grainLabel(st, notch, ctx);
    if (st.step_id) byStepId.set(st.step_id, label);
    const pl = st.process_label || processLabel(st.name || "") || "(step)";
    if (!plCounts.has(pl)) plCounts.set(pl, new Map());
    const m = plCounts.get(pl);
    m.set(label, (m.get(label) || 0) + 1);
  }
  const byProcessLabel = new Map();
  for (const [pl, m] of plCounts) {
    let best = null, bn = -1;
    for (const [l, n] of m) if (n > bn) { best = l; bn = n; }
    byProcessLabel.set(pl, best);
  }
  return { byStepId, byProcessLabel };
}

function _fmt(ms) {
  return formatDuration(ms || 0);
}

/* ============ Override merge (display side) ======================= */

function _overridesByStep(overrides) {
  const map = {};
  for (const ov of (overrides || [])) {
    if (ov && ov.step_id != null) map[ov.step_id] = ov;
  }
  return map;
}

/* Index `analysis_overrides[]` entries written from a grouped 'Waste by
   step' row -- one row per `process_label`, with no `step_id`. Such an
   entry propagates to every instance of that step type. A per-step_id
   override (more specific) wins. Mirrors `overrides_by_process_label`
   in normalization/analysis_common.py. */
function _overridesByProcessLabel(overrides) {
  const map = {};
  for (const ov of (overrides || [])) {
    if (ov && ov.step_id == null && ov.process_label) {
      map[ov.process_label] = ov;
    }
  }
  return map;
}

function _wasteRowProcessLabel(w) {
  return (w && (w.process_label || processLabel(w.name || ""))) || "";
}

function _applyWasteOverride(w, ov) {
  const row = Object.assign({}, w);
  if (Array.isArray(ov.waste_types)) row.waste_types = ov.waste_types.map(String);
  if (ov.bnva_ms !== undefined) {
    const elapsed = row.elapsed_ms || 0;
    const nva = row.nva_ms || 0;
    let bnva = Math.round(Number(ov.bnva_ms));
    if (!isFinite(bnva)) bnva = 0;
    bnva = Math.max(0, Math.min(bnva, Math.max(0, elapsed - nva)));
    row.bnva_ms = bnva;
    row.va_ms = Math.max(0, elapsed - bnva - nva);
  }
  return row;
}

/* Fold annotations.json `analysis_overrides` into a copy of the
   analysis.json sidecar, so an analyst correction shows in the view
   before the next re-analyze bakes it in. Mirrors the normalization
   side: analysis_waste.py (_apply_waste_override) + analysis_efficiency.py
   + analysis_automation.py (automation_confirmed). Returns `analysis`
   unchanged when there is nothing to apply. */
function applyAnalysisOverrides(analysis, overrides) {
  if (!analysis || !overrides || !overrides.length) return analysis;
  const byStep = _overridesByStep(overrides);
  const byPl = _overridesByProcessLabel(overrides);

  const waste = (analysis.waste_classification || []).map((w) => {
    const ov = byStep[w.step_id] || byPl[_wasteRowProcessLabel(w)];
    if (!ov) return w;
    return _applyWasteOverride(w, ov);
  });

  const automation = (analysis.automation_candidates || []).map((a) => {
    const ov = (overrides || []).find((o) =>
      o && o.segment_signature && o.segment_signature === a.segment_signature);
    if (!ov || ov.automation_confirmed === undefined) return a;
    return Object.assign({}, a, { automation_confirmed: !!ov.automation_confirmed });
  });

  const sum = (k) => waste.reduce((t, w) => t + (w[k] || 0), 0);
  const totalVa = sum("va_ms");
  const totalElapsed = sum("elapsed_ms");
  const efficiency = Object.assign({}, analysis.efficiency || {}, {
    process_efficiency_ratio: totalElapsed ? totalVa / totalElapsed : 0,
    total_va_ms: totalVa,
    total_bnva_ms: sum("bnva_ms"),
    total_nva_ms: sum("nva_ms"),
    total_elapsed_ms: totalElapsed,
  });

  return {
    meta: analysis.meta,
    waste_classification: waste,
    time_study: analysis.time_study || [],
    automation_candidates: automation,
    efficiency,
  };
}

/* ============ Collapsible modules (item 21) ====================== */

/* Every Analysis section wears a uniform header — title + one-line takeaway
   + chevron — and collapses per analyst (DISCLOSURE-MODEL rule 9). The
   takeaway renders even when collapsed (it IS the module's memo altitude).
   A section builder returns { title, takeaway, body, gated } — `body` is the
   inner HTML WITHOUT the outer box or the section title (the shell supplies
   both). A null return means the section has no data and is not rendered.

   CRITICAL (rule 9): a tier gate always wins. A gated module's `body` is its
   call-to-action, so an expanded gated module shows the CTA; a collapse never
   removes the CTA from the DOM — the native <details> keeps the body in the
   DOM and only un-renders it while collapsed, so it reappears on expand.

   Collapse state persists per analyst in localStorage under `pdt.analysis.*`
   (same pattern as `pdt.theme` / `pdt.summaryOpen`). Default on first run:
   every module open (today's behaviour). */
const _MODULE_KEY_PREFIX = "pdt.analysis.";
function _moduleOpen(key) {
  try { return localStorage.getItem(_MODULE_KEY_PREFIX + key) !== "0"; }
  catch (_) { return true; }
}
function _setModuleOpen(key, open) {
  try { localStorage.setItem(_MODULE_KEY_PREFIX + key, open ? "1" : "0"); }
  catch (_) {}
}

function _moduleShell(key, mod) {
  if (!mod) return "";
  const open = _moduleOpen(key);
  return '<details class="analysis-section analysis-module" data-module="' +
      escapeAttr(key) + '"' + (open ? " open" : "") + '>' +
    '<summary class="analysis-module-head">' +
      '<span class="analysis-module-title">' + escapeHtml(mod.title) + "</span>" +
      '<span class="analysis-module-takeaway"' +
        (mod.gated ? ' data-gated="1"' : "") + ">" +
        escapeHtml(mod.takeaway || "") + "</span>" +
      '<span class="analysis-module-chevron" aria-hidden="true"></span>' +
    "</summary>" +
    '<div class="analysis-module-body">' + (mod.body || "") + "</div>" +
  "</details>";
}

/* Wire the per-analyst persistence after render. Native <details> gives the
   inverse (expand) + the DOM-retained body for free; we only persist the
   toggle. */
function _wireModulePersistence(host) {
  host.querySelectorAll("details.analysis-module[data-module]").forEach((d) => {
    if (d._pdtWired) return;
    d._pdtWired = true;
    d.addEventListener("toggle", () => _setModuleOpen(d.dataset.module, d.open));
  });
}

/* ============ Sections ============================================ */

function _caption(overrideCount) {
  let html = '<div class="analysis-caption">Estimates — these figures ' +
    "come from rules of thumb set before any real recording data existed. " +
    "Review them before relying on them.";
  if (overrideCount > 0) {
    html += " <strong>" + overrideCount + " analyst correction" +
      (overrideCount === 1 ? "" : "s") + "</strong> applied in this view — " +
      "run Analyze again to bake them into analysis.json and the PDD export.";
  }
  return html + "</div>";
}

/* Roll the per-instance waste rows up to one row per `process_label`
   (the value-free step-type key the rest of the UI groups on -- the
   process map's Step level, the time study, the stats). A capture with
   four cases yields four "Search -- CUST-XXX" rows pre-grouping; here
   they collapse to one "Search" row aggregating VA / BNVA / NVA across
   the four instances. The original per-instance rows are kept on the
   group for round-tripping; the displayed name is the process_label so
   case-specific values don't leak into the group label.

   `waste_types` for a group is the union across instances (any signal
   from any instance still surfaces). */
function _groupWasteRows(waste, labelOf) {
  const groups = new Map();
  for (const w of (waste || [])) {
    // ADR-0024: at a coarse grain notch `labelOf` re-buckets per-step waste rows
    // by the notch's grain label (screen/app/phase/case); at the element notch
    // it is absent and rows group by process_label (the editable default).
    const pl = (labelOf && labelOf(w)) || _wasteRowProcessLabel(w) || w.name || "(step)";
    if (!groups.has(pl)) {
      groups.set(pl, {
        process_label: pl,
        name: pl,
        instances: 0,
        step_ids: [],
        elapsed_ms: 0, va_ms: 0, bnva_ms: 0, nva_ms: 0,
        cross_app_transfers: 0,
        _wasteSet: new Set(),
      });
    }
    const g = groups.get(pl);
    g.instances += 1;
    if (w.step_id) g.step_ids.push(w.step_id);
    g.elapsed_ms += w.elapsed_ms || 0;
    g.va_ms += w.va_ms || 0;
    g.bnva_ms += w.bnva_ms || 0;
    g.nva_ms += w.nva_ms || 0;
    g.cross_app_transfers += w.cross_app_transfers || 0;
    for (const t of (w.waste_types || [])) g._wasteSet.add(String(t));
  }
  const out = [];
  for (const g of groups.values()) {
    g.waste_types = [...g._wasteSet];
    delete g._wasteSet;
    out.push(g);
  }
  return out;
}

/* The inline judgment summary shown on a collapsed "Where the time goes" row
   (item 2 relocated): "36.0s measured · 20s business-required" once an
   analyst has judged this step type, else "36.0s measured · not judged" —
   never a colored bar (a default-green bar would read as a measured "all
   value-add" result, the same honesty gate the old resident module enforced,
   now applied per row instead of per section). */
function _wasteInlineSummary(g) {
  if (!g) return "";
  const total = (g.va_ms || 0) + (g.bnva_ms || 0) + (g.nva_ms || 0);
  if (!total) return "";
  const judged = !!(g.bnva_ms || 0);
  return judged
    ? escapeHtml(_fmt(total)) + " measured · " + escapeHtml(_fmt(g.bnva_ms)) + " business-required"
    : escapeHtml(_fmt(total)) + " measured · not judged";
}

/* The judgment editor for one step type's process_label, relocated (item 2)
   from the removed "Waste by screen"/"Waste by step" resident module into
   the expand-in-place body of its "Where the time goes" row. Reuses the
   original row markup (value/waste bar + waste-type tags) and the SAME
   click-to-edit affordance (`.waste-row-editable` -> `_editBnva`, wired in
   `_wireControls`) -- the write path and undo behavior are unchanged. */
function _buildWasteRow(g, editable = true) {
  const total = (g.va_ms || 0) + (g.bnva_ms || 0) + (g.nva_ms || 0);
  const seg = (ms, cls) => (!ms || total <= 0) ? "" :
    '<span class="waste-seg ' + cls + '" style="width:' +
    ((ms / total) * 100).toFixed(1) + '%"></span>';
  const tags = (g.waste_types || [])
    .map((t) => '<span class="waste-tag">' + escapeHtml(t) + "</span>")
    .join("");
  const unjudged = !(g.bnva_ms || 0);
  // ADR-0024: at a coarse grain the row is READ-ONLY (the business-required
  // override is process_label-scoped and a coarse group spans many labels) --
  // edit at the element notch.
  const cls = editable ? "waste-row waste-row-editable" : "waste-row";
  const title = editable
    ? (g.instances > 1
        ? "Click to set the business-required share across all " + g.instances + " instances"
        : "Click to set the business-required share of this step")
    : "Read-only at this detail level — set the Detail slider to element to adjust business-required time";
  // Item 2: while nothing is judged, the bar would be all value-add green (a
  // measured-looking "all value-add" result). Replace it with a neutral,
  // judgment-free measured-time chip until the analyst sets the first split.
  const barCell = unjudged
    ? '<span class="waste-bar waste-bar-unjudged" title="Not judged yet — click to split into value-add / business-required / waste">' +
        escapeHtml(_fmt(total)) + " measured · not judged</span>"
    : '<span class="waste-bar">' +
        seg(g.va_ms, "seg-va") + seg(g.bnva_ms, "seg-bnva") +
        seg(g.nva_ms, "seg-nva") +
      "</span>";
  const legend = '<div class="waste-legend">' +
    '<span><span class="swatch seg-va"></span>value-add</span>' +
    '<span><span class="swatch seg-bnva"></span>business-required</span>' +
    '<span><span class="swatch seg-nva"></span>waste</span>' +
  "</div>";
  return legend + '<div class="' + cls + '" data-process-label="' +
      escapeAttr(g.process_label || "") +
      '" title="' + escapeAttr(title) + '">' +
    '<span class="waste-name" title="' + escapeAttr(g.process_label || "") + '">' +
      escapeHtml(g.process_label || "(step)") + "</span>" +
    barCell +
    '<span class="waste-tags">' + tags + "</span>" +
    (editable ? '<span class="waste-edit">adjust</span>' : "") +
  "</div>";
}

/* The read-only message shown when a "Where the time goes" row is expanded
   at a coarser-than-element detail level (the business-required override is
   process_label-scoped, so it can only be set/read at the element notch). */
function _wasteReadOnlyNote() {
  return '<div class="analysis-note">Set the Detail slider to <strong>element</strong> ' +
    "to judge this step's business-required time.</div>";
}

/* ADR-0024: merge the per-step-type time-study rows up to the grain notch.
   `byProcessLabel` maps each step type to its (majority) grain label; rows
   sharing a label fold into one — instances and active/waiting/switching sum,
   mean is the instance-weighted mean, min/max are the extremes. The TOTAL time
   summed across rows is unchanged (every row is still counted once), so the
   study just re-itemises. Returns the original rows at the element notch. */
function _regroupTimeStudy(ts, notch, maps) {
  if (!notch || notch === "element" || !maps) return ts;
  const groups = new Map();
  for (const t of ts) {
    const label = maps.byProcessLabel.get(t.name) || t.name || "(step)";
    const c = t.cycle_ms || {};
    const inst = t.instances || 0;
    let g = groups.get(label);
    if (!g) {
      g = { name: label, instances: 0, _meanSum: 0,
            _min: Infinity, _max: -Infinity, active_ms: 0, waiting_ms: 0, switching_ms: 0 };
      groups.set(label, g);
    }
    g.instances += inst;
    g._meanSum += (c.mean || 0) * inst;          // instance-weighted mean
    if (c.min != null) g._min = Math.min(g._min, c.min);
    if (c.max != null) g._max = Math.max(g._max, c.max);
    g.active_ms += t.active_ms || 0;
    g.waiting_ms += t.waiting_ms || 0;
    g.switching_ms += t.switching_ms || 0;
  }
  return [...groups.values()].map((g) => ({
    name: g.name,
    instances: g.instances,
    cycle_ms: {
      mean: g.instances ? g._meanSum / g.instances : 0,
      min: g._min === Infinity ? 0 : g._min,
      max: g._max === -Infinity ? 0 : g._max,
    },
    active_ms: g.active_ms, waiting_ms: g.waiting_ms, switching_ms: g.switching_ms,
  })).sort((a, b) => (b.active_ms + b.waiting_ms) - (a.active_ms + a.waiting_ms));
}

/* Honesty gate (lab-phase §A5, relocated by §B1): distribution statistics
   (mean/stdev/percentiles) at tiny N are cargo-cult precision -- a "p95"
   over 3 instances is noise wearing a lab coat. The summary-stat line
   renders only when at least one row has `instances >= 10` (and only at
   the element notch, where stdev/percentiles exist in the data -- the
   coarse-grain regroup can't derive them); below that each row shows what
   was actually measured: the instances themselves, as dots. */
const TIME_STUDY_DISTRIBUTION_MIN_N = 10;

/* ===== §B1: "Where the time goes" — the instance strip ================= */

/* The JS mirror of analysis_common.step_group_label: the label a step's
   time-study row carries. A template-matched step keeps its canonical
   name; an auto step uses the value-free process_label. */
function _studyStepLabel(st) {
  if (st.canonical_step_id) return st.name || st.process_label || "(unnamed step)";
  return st.process_label || processLabel(st.name || "") || st.name || "(unnamed step)";
}

function _stepDurMs(st) {
  const tr = (st && st.time_range) || {};
  const a = tr.start ? new Date(tr.start).getTime() : NaN;
  const b = tr.end ? new Date(tr.end).getTime() : NaN;
  return (isFinite(a) && isFinite(b) && b >= a) ? (b - a) : 0;
}

/* Resolve each study row's INSTANCES (the individual annotated steps behind
   the aggregate row) so the strip draws one clickable dot per instance. At
   the element notch rows are keyed by the step-group label; at a coarse
   notch the rows were regrouped by grain label, so match via maps.byStepId.
   A row whose steps can't be resolved (e.g. stale analysis.json against
   edited steps) just renders without dots -- nothing is fabricated. */
function _instancesByRowLabel(notch, maps) {
  const sess = State.getSession();
  const steps = (((sess && sess.annotations) || {}).steps || [])
    .filter((s) => s && s.state !== "hidden");
  const coarse = (notch && notch !== "element" && maps);
  const byLabel = new Map();
  for (const st of steps) {
    const label = coarse
      ? (st.step_id && maps.byStepId.get(st.step_id))
      : _studyStepLabel(st);
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(st);
  }
  return byLabel;
}

/* step_id -> step for the dot click handlers (rebuilt every render). */
let _tsDotSteps = new Map();

function _timeStudySection(ts, notch, maps, wasteByProcessLabel) {
  if (!ts.length) return null;
  const regroup = (notch && notch !== "element" && maps);
  const study = _regroupTimeStudy(ts, notch, maps);
  const maxN = study.reduce((m, t) => Math.max(m, t.instances || 0), 0);
  const distribution = !regroup && maxN >= TIME_STUDY_DISTRIBUTION_MIN_N;
  const instancesOf = _instancesByRowLabel(notch, maps);
  _tsDotSteps = new Map();
  // Item 2 (relocated): at the element notch, a row's judgment editor is the
  // waste group sharing its process_label -- at that notch `t.name` IS the
  // process_label (analysis_common.step_group_label), so the join is exact.
  const canJudge = !regroup;
  const wasteFor = (name) => (wasteByProcessLabel && wasteByProcessLabel.get(name)) || null;

  // Shared horizontal time axis: 0 .. the longest single instance anywhere,
  // so durations compare across rows. Fall back to the study's cycle max for
  // rows whose steps didn't resolve.
  let axisMax = 0;
  for (const t of study) {
    axisMax = Math.max(axisMax, ((t.cycle_ms || {}).max) || 0);
    for (const st of (instancesOf.get(t.name) || [])) {
      axisMax = Math.max(axisMax, _stepDurMs(st));
    }
  }

  // Render order: biggest total first — this section answers "where did the
  // time go", so the heaviest step type leads. Display order only.
  const ordered = study.slice().sort((a, b) => {
    const tot = (t) => Math.round(((t.cycle_ms || {}).mean || 0) * (t.instances || 0));
    return tot(b) - tot(a);
  });

  const rows = ordered.map((t) => {
    const c = t.cycle_ms || {};
    const total = Math.round((c.mean || 0) * (t.instances || 0));
    const insts = instancesOf.get(t.name) || [];
    const dots = insts.map((st) => {
      const ms = _stepDurMs(st);
      const x = axisMax > 0 ? (ms / axisMax) * 100 : 0;
      if (st.step_id) _tsDotSteps.set(st.step_id, st);
      const canJump = !!(st.step_id && st.time_range && st.time_range.start);
      return '<button type="button" class="ts-dot" style="left:' + x.toFixed(2) + '%"' +
        (st.step_id ? ' data-step-id="' + escapeAttr(st.step_id) + '"' : "") +
        ' title="' + escapeAttr(_fmt(ms) +
          (canJump ? " — click to open this instance on the Flow timeline" : "")) +
        '"' + (canJump ? "" : " disabled") + "></button>";
    }).join("");
    const breakdown = "active " + _fmt(t.active_ms) + " · waiting " + _fmt(t.waiting_ms) +
      " · switching " + _fmt(t.switching_ms);
    const stats = distribution
      ? '<div class="ts-stats">mean ' + escapeHtml(_fmt(c.mean)) +
        " · stdev " + escapeHtml(_fmt(c.stdev)) +
        " · p50 " + escapeHtml(_fmt(c.p50)) +
        " · p95 " + escapeHtml(_fmt(c.p95)) +
        " · range " + escapeHtml(_fmt(c.min)) + "–" + escapeHtml(_fmt(c.max)) + "</div>"
      : "";
    // Item 2 (relocated): the judgment editor lives one click behind this row
    // (expand-in-place, Evidence mechanic). Rows that already carry a judgment
    // show it inline on the row line ("36.0s measured · 20s business-required");
    // the click target for editing lives in the expansion, not the row itself.
    const g = wasteFor(t.name);
    const judgment = canJudge ? _wasteInlineSummary(g) : "";
    const judgmentBody = canJudge
      ? (g ? _buildWasteRow(g, true) : "")
      : _wasteReadOnlyNote();
    const expand = '<button type="button" class="ts-judge-expand" data-act="ts-expand" ' +
      'aria-expanded="false" title="Set business-required time for this step">▸</button>';
    return '<div class="ts-row" data-process-label="' + escapeAttr(t.name || "") + '">' +
      '<div class="ts-row-line">' +
        '<span class="ts-name" title="' + escapeAttr((t.name || "(step)") + " — " + breakdown) + '">' +
          escapeHtml(t.name || "(step)") + "</span>" +
        '<span class="ts-n">' + (t.instances || 0) + "×</span>" +
        '<span class="ts-total">' + escapeHtml(_fmt(total)) + "</span>" +
        '<div class="ts-strip">' + dots + "</div>" +
        (judgment ? '<span class="ts-judgment">' + judgment + "</span>" : "") +
        expand +
      "</div>" +
      stats +
      '<div class="ts-judge-body" hidden>' + judgmentBody + "</div>" +
    "</div>";
  }).join("");

  const gateNote = distribution ? "" :
    '<div class="analysis-caption">Summary statistics (mean/stdev/percentiles) ' +
    "render once a step type reaches " + TIME_STUDY_DISTRIBUTION_MIN_N +
    " instances — below that the strip shows exactly what was measured: " +
    "one dot per observed instance.</div>";
  const axis = '<div class="ts-axis"><span class="ts-axis-lbl">per-instance ' +
    'duration</span><span>0s</span><span class="ts-axis-line"></span><span>' +
    escapeHtml(_fmt(axisMax)) + "</span></div>";
  // Takeaway: name the heaviest step type + its total time (the module's memo
  // altitude), or the row count when nothing measured a duration.
  const totalMs = ordered.reduce((s, t) =>
    s + Math.round(((t.cycle_ms || {}).mean || 0) * (t.instances || 0)), 0);
  const top = ordered[0];
  const takeaway = totalMs > 0 && top
    ? _fmt(totalMs) + " across " + ordered.length + " step type" +
      (ordered.length === 1 ? "" : "s") + " · most in " + (top.name || "(step)")
    : ordered.length + " step type" + (ordered.length === 1 ? "" : "s") + " measured";
  return {
    title: "Where the time goes",
    takeaway,
    body: gateNote + axis + '<div class="ts-rows">' + rows + "</div>",
  };
}

/* Confirm/Dismiss — preserved EXACTLY as-is functionally: same data-confirm
   handling, same analysis_overrides automation_confirmed write path
   (_writeSegmentOverride, wired in _wireControls). Only the container moved
   (table cell -> finding-card detail line). */
function _decisionCell(a) {
  const c = a.automation_confirmed;
  const btn = (val, label) =>
    '<button type="button" class="auto-btn' + (c === val ? " active" : "") +
    '" data-confirm="' + val + '">' + label + "</button>";
  return '<div class="auto-decision" data-segment-signature="' +
    escapeAttr(a.segment_signature || "") + '">' +
    btn(true, "Confirm") + btn(false, "Dismiss") + "</div>";
}

/* Item 6: the full step chain, printed once, behind the card's expand-in-place
   (the evidence line) -- never repeated in the claim sentence. */
function _stepChainHtml(a) {
  const allSteps = a.step_labels || [];
  if (!allSteps.length) return '<span class="score-na">no labelled steps</span>';
  const steps = allSteps.slice(0, 4);
  const moreSteps = allSteps.length - steps.length;
  const fullChain = allSteps.join(" → ");
  return '<div class="auto-sequence" title="' + escapeAttr(fullChain) + '">' +
    steps.map(escapeHtml).join('<span class="auto-arrow"> → </span>') +
    (moreSteps > 0 ? ' <span class="auto-more">+' + moreSteps + " more</span>" : "") +
  "</div>";
}

/* The claim sentence for one candidate's finding card, e.g. "chrome ·
   6-step sequence — ran 4×, 1m7s total, mean 16.8s". */
function _candidateClaim(a) {
  const app = String(a.app || "").replace(/\.exe$/i, "") || "segment";
  const n = (a.step_labels || []).length;
  const size = n ? n + "-step sequence" : "sequence";
  const runs = (a.instance_count || 0) + "×";
  return app + " · " + size + " — ran " + runs + ", " +
    _fmt(a.total_elapsed_ms) + " total, mean " + _fmt(a.mean_elapsed_ms);
}

/* R1 (§4/§5): the ranked table is replaced by finding-card presentation,
   reusing the SAME shared card component the Overview findings feed uses
   (finding-cards.js) -- one card per candidate, in the existing rank order.
   Detection + scoring (Python) and the Confirm/Dismiss write path are
   unchanged; only the presentation moved from a table row to a card. */
function _automationSection(auto) {
  if (!auto.length) return null;
  const scored = auto.filter((a) => a.data_sufficiency === "multi_instance");
  const lonely = auto.length - scored.length;
  const lead = '<div class="analysis-caption">' +
    "A candidate is a contiguous run of work in one application within one " +
    "case — e.g. a CRM lookup → copy → paste sequence. Single clicks or " +
    "keystrokes are not surfaced (a hybrid where a robot clicks one button " +
    "inside a manual flow is worse than fully manual). Ranked by automation " +
    "priority — frequency × mean time × automatable share." +
    "</div>";
  if (!scored.length) {
    const note = lonely
      ? "All detected segments occurred only once in this capture — "
        + "automation candidacy needs the same segment seen across 2+ cases. "
        + "Load more sessions or analyze a longer recording."
      : "No multi-instance segments detected.";
    return {
      title: "Automation candidates",
      takeaway: "None ranked yet — needs a sequence seen across 2+ cases",
      body: lead + '<div class="analysis-note">' + escapeHtml(note) + "</div>",
    };
  }
  // Card order = existing rank order (unchanged from the table).
  const cards = scored.map((a, i) => {
    const rank = (a.rank === null || a.rank === undefined) ? (i + 1) : a.rank;
    const f = {
      id: "automation-" + (a.segment_signature || i),
      tier: 1,
      claim: _candidateClaim(a),
      evidence: {
        instances: a.instance_count || 0,
        mean_ms: a.mean_elapsed_ms,
      },
    };
    const cardHtml = findingCardHtml(f, {
      screenshots: false,
      detailHtml: () => _stepChainHtml(a) + _decisionCell(a),
    });
    // Rank prefix stays visible on the card (the existing priority order).
    return '<div class="auto-card" data-rank="' + escapeAttr(String(rank)) + '">' + cardHtml + "</div>";
  }).join("");
  const tail = lonely
    ? '<div class="analysis-note">' + lonely + " more segment" +
      (lonely === 1 ? "" : "s") + " occurred only once and " +
      "aren't ranked (single instances can't be judged for repeatability)." +
      "</div>"
    : "";
  return {
    title: "Automation candidates",
    takeaway: scored.length + " candidate" + (scored.length === 1 ? "" : "s") +
      " ranked by automation priority",
    body: lead + '<div class="auto-cards">' + cards + "</div>" + tail,
  };
}

/* ============ Correction handlers ================================= */

/* Upsert a segment-signature entry in annotations.json
   `analysis_overrides[]` -- the new shape used for confirming or
   dismissing an automation segment (ADR-0016). A patch field set to
   undefined clears that correction; an entry left with only the
   identity field is pruned. Persists with undo, then emits "analysis"
   so this view (and undo/redo) repaint. */
async function _writeSegmentOverride(signature, patch) {
  const session = State.getSession();
  if (!session || !signature) return;
  let anno;
  try { anno = JSON.parse(JSON.stringify(session.annotations || {})); }
  catch (_) { anno = {}; }
  const list = Array.isArray(anno.analysis_overrides) ? anno.analysis_overrides : [];
  let entry = list.find((o) => o && o.segment_signature === signature);
  if (!entry) { entry = { segment_signature: signature }; list.push(entry); }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete entry[k];
    else entry[k] = v;
  }
  anno.analysis_overrides = list.filter((o) =>
    o && (o.step_id != null || o.process_label || o.segment_signature) &&
    Object.keys(o).some((k) =>
      k !== "step_id" && k !== "process_label" && k !== "segment_signature"));
  await Session.saveAnnotationsWithUndo(anno, "Adjust analysis classification");
  session.annotations = anno;
  State.emit("analysis");
}

/* Upsert a process_label-scoped entry in `analysis_overrides[]`. Written
   from a grouped 'Waste by step' row; on the next re-analyze the entry
   propagates to every instance of that step type. Mirrors `_writeOverride`. */
async function _writeProcessLabelOverride(processLbl, patch) {
  const session = State.getSession();
  if (!session || !processLbl) return;
  let anno;
  try { anno = JSON.parse(JSON.stringify(session.annotations || {})); }
  catch (_) { anno = {}; }
  const list = Array.isArray(anno.analysis_overrides) ? anno.analysis_overrides : [];
  let entry = list.find((o) => o && o.step_id == null && o.process_label === processLbl);
  if (!entry) { entry = { process_label: processLbl }; list.push(entry); }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete entry[k];
    else entry[k] = v;
  }
  anno.analysis_overrides = list.filter((o) =>
    o && (o.step_id != null || o.process_label) &&
    Object.keys(o).some((k) => k !== "step_id" && k !== "process_label"));
  await Session.saveAnnotationsWithUndo(anno, "Adjust analysis classification");
  session.annotations = anno;
  State.emit("analysis");
}

async function _editBnva(group) {
  const totalElapsed = group.elapsed_ms || 0;
  const totalNva = group.nva_ms || 0;
  const n = group.instances || 1;
  const avgElapsed = totalElapsed / n;
  const avgNva = totalNva / n;
  const maxBnvaMin = Math.max(0, avgElapsed - avgNva) / 60000;
  const curMin = ((group.bnva_ms || 0) / n) / 60000;
  const message = n > 1
    ? '"' + (group.process_label || "step") + '" runs ' + _fmt(totalElapsed) +
      " across " + n + " instances (avg " + _fmt(Math.round(avgElapsed)) +
      "). By default all active time counts as value-add. Enter the " +
      "business-required minutes per instance — applied to every instance " +
      "(clamped to each one's available active time); measured waste is unaffected."
    : '"' + (group.process_label || "step") + '" runs ' + _fmt(totalElapsed) +
      ". By default all active time counts as value-add. Enter the part " +
      "that is business-required — necessary, but not adding value. The rest " +
      "stays value-add; measured waste is unaffected.";
  const hint = n > 1
    ? "Up to " + (Math.round(maxBnvaMin * 100) / 100) +
      " min per instance (average available active time). Applies to all " +
      n + " instances. Leave blank to go back to the default."
    : "Up to " + (Math.round(maxBnvaMin * 100) / 100) +
      " min of active time. Leave blank to go back to the default.";
  const res = await formModal({
    title: "Business-required time",
    message,
    okLabel: "Save",
    fields: [{
      key: "min",
      label: n > 1 ? "Business-required minutes (per instance)" : "Business-required minutes",
      value: curMin ? String(Math.round(curMin * 100) / 100) : "",
      placeholder: "0",
      hint,
    }],
  });
  if (!res) return;
  const raw = String(res.min == null ? "" : res.min).trim();
  if (raw === "") {
    _writeProcessLabelOverride(group.process_label, { bnva_ms: undefined });
    return;
  }
  const min = Number(raw);
  if (!isFinite(min) || min < 0) {
    toast("Enter a number of minutes (0 or more)", "error");
    return;
  }
  _writeProcessLabelOverride(group.process_label, { bnva_ms: Math.round(min * 60000) });
}

/* Attach the waste-row and automation-decision handlers after a render.
   `analysis` is the override-merged view, so the current state is read
   from it (a second click on the active decision clears it). Waste rows
   are grouped by `process_label`; the click targets the group, not a
   single instance, so an edit propagates across the step type. */
function _wireControls(host, analysis) {
  const groups = _groupWasteRows(analysis.waste_classification || []);
  const groupByPl = {};
  for (const g of groups) groupByPl[g.process_label] = g;
  host.querySelectorAll(".waste-row-editable").forEach((row) => {
    row.addEventListener("click", () => {
      const g = groupByPl[row.dataset.processLabel];
      if (g) _editBnva(g);
    });
  });

  // §B1: instance-strip dots — click jumps the Flow timeline to that step
  // (same path the Overview findings use). Lazy require: flow-view-video
  // touches the DOM at load, which would break this module's pure unit tests.
  host.querySelectorAll(".ts-dot[data-step-id]").forEach((dot) => {
    dot.addEventListener("click", () => {
      const st = _tsDotSteps.get(dot.dataset.stepId);
      if (st) require("./flow-view-video.js").jumpToStepInFlow(st);
    });
  });

  // Item 2 (relocated): the judgment editor expand-in-place toggle on a
  // "Where the time goes" row (Evidence mechanic — inline, no navigation).
  host.querySelectorAll(".ts-judge-expand").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = btn.closest(".ts-row");
      const body = row && row.querySelector(".ts-judge-body");
      if (!body) return;
      const open = body.hidden;
      body.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "▾" : "▸";
    });
  });

  // Automation candidate cards (finding-cards.js): expand-in-place toggle for
  // the evidence body (the step chain + the Confirm/Dismiss decision). Mirrors
  // overview-view.js's _wireFindings toggle so the same component behaves the
  // same everywhere it's reused.
  host.querySelectorAll(".auto-cards .ov-finding").forEach((card) => {
    const body = card.querySelector(".ov-finding-body");
    const expand = card.querySelector('[data-act="expand"]');
    const toggle = () => {
      if (!body) return;
      const open = body.hidden;
      body.hidden = !open;
      if (expand) {
        expand.setAttribute("aria-expanded", String(open));
        expand.textContent = open ? "▾" : "▸";
      }
    };
    if (expand) expand.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    const head = card.querySelector(".ov-finding-head");
    if (head && body) head.addEventListener("click", (e) => {
      if (e.target.closest("button, a, label, input")) return;
      toggle();
    });
  });

  const autoBySig = {};
  for (const a of (analysis.automation_candidates || [])) {
    if (a.segment_signature) autoBySig[a.segment_signature] = a;
  }
  host.querySelectorAll(".auto-decision .auto-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".auto-decision");
      if (!wrap) return;
      const sig = wrap.dataset.segmentSignature;
      if (!sig) return;
      const want = btn.dataset.confirm === "true";
      const cur = autoBySig[sig];
      const isActive = cur && cur.automation_confirmed === want;
      _writeSegmentOverride(sig, { automation_confirmed: isActive ? undefined : want });
    });
  });
}

/* Render the surviving Analysis modules ("Where the time goes" with its
   judgment expansion, and the automation candidate finding-cards) into a
   caller-supplied host element.

   R4 (APPROACHABILITY-REDESIGN-2026-07-03 §5): the Analysis LEVEL is retired.
   These modules move into the Overview as Evidence modules below the findings
   feed (DISCLOSURE-MODEL "Analysis → Evidence"), keeping their uniform header +
   collapse-persistence pattern. Overview calls this with its `#overview-evidence`
   host. The RAW EVENTS Machine drawer stays in the Flow view (it always lived
   there, not in this stack); this function renders the analytical modules.

   Reads the loaded session's analysis.json sidecar (session.analysis) merged
   with annotations.json corrections; renders an empty note when unanalyzed.

   DETAIL SLIDER (R4 decision): the "Where the time goes" judgment editor is
   element-notch-gated. The Detail slider lives in the always-visible view-mode
   bar (not inside any level), so it is fully usable while the Overview shows —
   sliding it to `element` opens the judgment editor here exactly as it did on
   the retired Analysis level. No per-module local detail toggle is needed. */
function renderEvidenceInto(host) {
  if (!host) return;
  const session = State.getSession();
  const raw = session && session.analysis;
  if (!raw) {
    host.innerHTML = '<div class="analysis-empty">No analysis available. ' +
      "Analyze a session that has steps to generate waste, time-study " +
      "and automation findings.</div>";
    return;
  }
  const overrides = (session.annotations &&
    session.annotations.analysis_overrides) || [];
  const analysis = applyAnalysisOverrides(raw, overrides);
  // ADR-0024: the step-grained itemisation ("Where the time goes") follows the
  // current grain notch. Build the regroup maps once (skipped at the element
  // notch, which keeps the editable default).
  const notch = State.getGrain();
  const maps = (notch && notch !== "element") ? _grainMaps(notch) : null;
  // R1: "Process efficiency" and the "Waste by step/screen" resident module are
  // gone (§4 of the redesign) -- the judgment editor relocates into the
  // "Where the time goes" row expansion (item 2 relocated). Build the
  // process_label -> waste group map once, at the element notch only (the
  // override is process_label-scoped, so it only makes sense to judge there).
  const wasteByProcessLabel = (notch === "element" || !notch)
    ? new Map(_groupWasteRows(analysis.waste_classification || []).map((g) => [g.process_label, g]))
    : null;
  // Item 21: each section renders inside a uniform collapsible module (title +
  // one-line takeaway + chevron), collapse state persisted per analyst. The
  // section builders return { title, takeaway, body, gated } (null = no data).
  // A tier gate always wins: a gated module's body is its CTA, so it shows
  // even when expanded, and a collapse never removes it (the native <details>
  // retains the body in the DOM).
  host.innerHTML =
    _caption(overrides.length) +
    _moduleShell("time", _timeStudySection(analysis.time_study || [], notch, maps, wasteByProcessLabel)) +
    _moduleShell("automation", _automationSection(analysis.automation_candidates || []));
  _wireControls(host, analysis);
  _wireModulePersistence(host);
}

module.exports = { renderEvidenceInto };
