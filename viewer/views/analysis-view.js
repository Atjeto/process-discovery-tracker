/*
 * analysis-view.js -- the Analysis level of the Session view.
 *
 * R1 of the approachability redesign (docs/To-Do/APPROACHABILITY-REDESIGN-
 * 2026-07-03.md §4/§5) subtracted this view down to three modules: "Where
 * the time goes" (the time study, now also the judgment-editor entry point),
 * "Automation candidates" (finding cards, ADR-0016), and the €-ROI section
 * (whole-section gated on an analyst-entered annual volume). "Process
 * efficiency" and the "Waste by step/screen" resident module were removed
 * (efficiency returns later as a finding; its underlying computation in
 * `applyAnalysisOverrides` stays intact for that future use, unrendered).
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
const Ipc = require("../ipc.js");
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

/* Format a monetary amount in the ROI block's currency. Returns "—" for a
   null/absent figure (we never fabricate a number). Common currency codes get
   a symbol; anything else is rendered as "<amount> <CODE>". */
const _CURRENCY_SYMBOL = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };
function _money(val, currency) {
  if (val === null || val === undefined || !isFinite(Number(val))) return "—";
  const code = String(currency || "EUR").toUpperCase();
  const sym = _CURRENCY_SYMBOL[code];
  let n;
  try { n = Math.round(Number(val)).toLocaleString("en-US"); }
  catch (_) { n = String(Math.round(Number(val))); }
  return sym ? sym + n : n + " " + code;
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
    // roi is computed by Python from roi_inputs; analyst waste/automation
    // overrides don't touch it, so carry it through unchanged.
    roi: analysis.roi,
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

/* A shortened chain form for the ROI table (app · first → … → last step) —
   the full chain lives on hover/title. Item 6: the ROI table must not repeat
   the whole chain a third time. The ROI candidate carries only `label`
   ("app — step1 → step2 → …"), so parse the short form back out of it. */
function _shortChainLabel(r) {
  const raw = String(r.label || "");
  const dash = raw.indexOf(" — ");
  const app = dash >= 0 ? raw.slice(0, dash) : "";
  const chain = dash >= 0 ? raw.slice(dash + 3) : raw;
  // Split into steps; drop any trailing "… (+N more)" sentinel the label
  // already carries, then quote the first and last real step.
  const steps = chain.split(" → ").map((s) => s.trim())
    .filter((s) => s && !/^…/.test(s) && !/^\(\+\d+ more\)$/.test(s));
  if (steps.length >= 2) {
    return (app ? app + " · " : "") + steps[0] + " → … → " + steps[steps.length - 1];
  }
  if (steps.length === 1) return (app ? app + " · " : "") + steps[0];
  return raw.length > 60 ? raw.slice(0, 57) + "…" : raw;
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

/* ============ €-ROI section (§11c) ================================ */

/* The band value cell. While no loaded labour rate is supplied the whole
   block runs in time-savings mode -- the honest output of arithmetic that
   refuses to invent a wage -- so each band shows annualised hours saved.
   Once a rate is present we switch to € net/yr, which is the figure that
   actually closes the business case. */
function _bandCell(band, roi) {
  if (!band) return '<span class="score-na">—</span>';
  if (roi.needs_input || band.net_annual === null || band.net_annual === undefined) {
    const h = band.saved_hours_per_year;
    return (h === null || h === undefined)
      ? '<span class="score-na">—</span>'
      : escapeHtml(String(h)) + ' <span class="roi-unit">h/yr</span>';
  }
  return _money(band.net_annual, roi.currency) +
    ' <span class="roi-unit">net/yr</span>';
}

/* The band-encoding legend (COHERENCE-AUDIT: a new encoding needs a legend).
   Maps the three columns to their realism multipliers so the analyst can see
   conservative=×0.5 .. optimistic=×0.9 rather than guessing. */
function _roiLegend(roi) {
  const f = (roi.inputs_used && roi.inputs_used.realism_factors) || {};
  const cell = (label, key) => {
    const v = f[key];
    return '<span><span class="roi-swatch roi-swatch-' + key + '"></span>' +
      escapeHtml(label) +
      (v !== undefined ? ' <span class="roi-factor">×' + escapeHtml(String(v)) + "</span>" : "") +
      "</span>";
  };
  return '<div class="roi-legend">' +
    cell("conservative", "conservative") +
    cell("expected", "expected") +
    cell("optimistic", "optimistic") +
    "</div>";
}

/* Item 3: below a floor the hours figure is too small to earn hero weight —
   at ~0.01 h/yr the number reads as a measured "all value-add" result and an
   analyst who pastes it into a memo gets laughed at. Below 1 h/yr, a plain
   sentence carries the number instead of the big figure (the number did not
   change; the presentation weight now matches the evidence). */
const ROI_HERO_FLOOR_HOURS = 1;

function _roiTotals(roi) {
  const t = roi.totals || {};
  const h = t.saved_hours_per_year;
  const hasHours = !(h === null || h === undefined);
  const belowFloor = hasHours && Number(h) < ROI_HERO_FLOOR_HOURS;
  const parts = [];
  if (belowFloor) {
    parts.push('<div class="roi-total roi-total-floor">' +
      '<div class="roi-floor-note">Under an hour a year at observed volume — ' +
      "more recorded instances would size this. The per-candidate breakdown is " +
      "below.</div></div>");
  } else {
    const hours = hasHours ? h + " h" : "—";
    parts.push('<div class="roi-total"><div class="roi-total-big">' + escapeHtml(String(hours)) +
      '</div><div class="roi-total-label">saved per year (expected)</div></div>');
  }
  if (!roi.needs_input) {
    parts.push('<div class="roi-total"><div class="roi-total-big">' +
      _money(t.net_annual, roi.currency) +
      '</div><div class="roi-total-label">net €/yr (expected)</div></div>');
    parts.push('<div class="roi-total"><div class="roi-total-big">' +
      _money(t.gross_annual, roi.currency) +
      '</div><div class="roi-total-label">gross €/yr (expected)</div></div>');
  }
  return '<div class="roi-totals">' + parts.join("") + "</div>";
}

function _roiRow(r, roi) {
  const bands = r.bands || {};
  const basisNote = r.volume_basis === "observed"
    ? ' <span class="roi-basis" title="No annual volume supplied — using the ' +
      r.instance_count + ' observed instance(s) as a conservative floor. ' +
      'Set an annual volume to project a real yearly saving.">observed floor</span>'
    : (r.volume_basis === "annotated"
        ? ' <span class="roi-basis roi-basis-set" title="Per-segment annual volume override">per-segment</span>'
        : "");
  const payback = (r.expected_payback_months === null || r.expected_payback_months === undefined)
    ? '<span class="score-na">—</span>'
    : escapeHtml(String(r.expected_payback_months)) + ' <span class="roi-unit">mo</span>';
  return "<tr>" +
    '<td><div class="auto-label" title="' + escapeAttr(r.label || "") + '">' +
      escapeHtml(_shortChainLabel(r) || "(segment)") + "</div></td>" +
    '<td class="num">' + (r.instance_count || 0) + "</td>" +
    '<td class="num">' + escapeHtml(_fmt(r.mean_elapsed_ms)) + "</td>" +
    '<td class="num">' + escapeHtml(String(r.annual_volume)) + basisNote + "</td>" +
    '<td class="num">' + _bandCell(bands.conservative, roi) + "</td>" +
    '<td class="num roi-expected">' + _bandCell(bands.expected, roi) + "</td>" +
    '<td class="num">' + _bandCell(bands.optimistic, roi) + "</td>" +
    '<td class="num">' + payback + "</td>" +
    '<td><button type="button" class="roi-tune-btn" data-segment-signature="' +
      escapeAttr(r.segment_signature || "") +
      '" title="Set this segment\'s annual volume, automatable share and build cost">tune</button></td>' +
  "</tr>";
}

/* The €-ROI module's memo-altitude takeaway: the expected yearly saving in
   the honest unit (hours until a labour rate turns it into money), or the
   below-floor phrasing when it is under an hour.

   R1 (§4 "a floored headline above a rendered table of zeros is a gate in
   name only"): the totals Python returns are always computed off SOME volume
   basis, including the observed-instance floor -- so before an analyst has
   entered a real annual volume, this takeaway must NOT surface that
   floor-based hours/€ figure (one recording is not a year). It falls back to
   the same one-line observed-volume sentence the gated body shows. */
function _roiTakeaway(roi) {
  const cands = Array.isArray(roi.candidates) ? roi.candidates : [];
  if (!cands.length) return "None to cost yet — needs a sequence seen across 2+ cases";
  if (!_hasAnalystVolume(roi)) return "No annual volume entered yet — showing observed instances only";
  const t = roi.totals || {};
  const h = t.saved_hours_per_year;
  if (h === null || h === undefined) return cands.length + " candidate" + (cands.length === 1 ? "" : "s") + " costed";
  if (Number(h) < ROI_HERO_FLOOR_HOURS) return "Under an hour a year at observed volume";
  if (!roi.needs_input && t.net_annual != null) {
    return _money(t.net_annual, roi.currency) + " net/yr (expected)";
  }
  return h + " h/yr saved (expected)";
}

/* R1 (§4/§5, use gate §3): does an analyst-entered annual volume exist
   anywhere -- the flat session-wide default, or a per-segment override that
   actually resolved for a candidate (volume_basis "default"/"annotated")?
   The observed-instance-count floor ("observed") does NOT count: one
   recording is not a year, and the use gate says an assumption never earns
   a table until someone entered it. */
function _hasAnalystVolume(roi) {
  const flat = roi.inputs_used && roi.inputs_used.annual_volume;
  if (flat !== null && flat !== undefined) return true;
  const cands = Array.isArray(roi.candidates) ? roi.candidates : [];
  return cands.some((r) => r && r.volume_basis && r.volume_basis !== "observed");
}

/* The one-line observed-volume takeaway sentence shown in the replace-pattern
   body when no analyst-entered volume exists yet -- names the observed
   instance count so the CTA reads as "here's what we saw", not a blank ask. */
function _observedVolumeSentence(roi) {
  const cands = Array.isArray(roi.candidates) ? roi.candidates : [];
  if (!cands.length) {
    return "No multi-instance automation candidates to cost yet — the €-ROI " +
      "projects a yearly saving from a segment seen across 2+ cases.";
  }
  const totalInstances = cands.reduce((s, r) => s + (r.instance_count || 0), 0);
  return cands.length + " automation candidate" + (cands.length === 1 ? "" : "s") +
    " observed " + totalInstances + " time" + (totalInstances === 1 ? "" : "s") +
    " in this recording — enter how often the process runs per year to project " +
    "a real yearly saving.";
}

/* Build the €-ROI module object (title/takeaway/body). Pure (no DOM reads).
   `_roiSection` wraps it in the collapsible module shell so it stays unit-
   testable as a string (its substrings live in the module body).

   R1 (§4 verdict "Whole section gates on entered volume + wage"): the FULL
   body (table, hero figures, per-row tune) renders only once an analyst has
   entered an explicit annual volume. Below that, disclosure's replace-
   pattern swaps the whole body for the one-line observed-volume takeaway +
   the "Edit assumptions…" CTA -- never a table of manufactured zeros. The
   monetary-figures-need-a-rate gate (`roi.needs_input`) is unchanged. */
function _roiModule(roi) {
  const cands = Array.isArray(roi.candidates) ? roi.candidates : [];
  const title = "Return on automation (€-ROI)";
  const editBtn = '<button type="button" class="roi-edit-btn" ' +
    'title="Set the loaded labour rate, annual volume, build cost and realism factors">' +
    "Edit assumptions…</button>";

  if (!cands.length || !_hasAnalystVolume(roi)) {
    return {
      title, takeaway: _roiTakeaway(roi),
      gated: !!cands.length,
      body: '<div class="roi-head">' + editBtn + "</div>" +
        '<div class="analysis-note">' + escapeHtml(_observedVolumeSentence(roi)) + "</div>",
    };
  }

  const caption = roi.needs_input
    ? '<div class="analysis-caption">Time-savings only — no loaded labour rate supplied, ' +
      "so monetary figures are withheld (a wage is never fabricated). " +
      '<strong>Edit assumptions</strong> and add a € per hour to see the net/yr and payback. ' +
      "Each band is observed mean time × automatable share × a realism factor, annualised by volume.</div>"
    : '<div class="analysis-caption">Net €/yr = annual volume × (observed mean time × automatable share × ' +
      "realism factor) × loaded €/hr, less the build cost amortised over " +
      escapeHtml(String((roi.inputs_used && roi.inputs_used.amortization_years) || 3)) +
      " years. Figures are a band, not a point estimate — read the range.</div>";
  // Item 4: an assumption never gets a column. The automatable share is a
  // configured assumption (flat or per-segment tuned), not a per-row
  // measurement -- it renders once, here, never as an AUTO% table column.
  // Per-row overrides stay reachable via each row's "tune" affordance.
  const autoShareNote = '<div class="analysis-caption roi-auto-share-note">Assumes ' +
    Math.round(((roi.inputs_used && roi.inputs_used.automatable_fraction) || 0.7) * 100) +
    "% of each candidate's time is automatable unless tuned per segment " +
    '(<span class="roi-tune-hint">the "tune" button on a row</span>).</div>';
  // ADR-0024: make the grain↔ROI relationship explicit. The candidates are at
  // the coherent-segment grain (ADR-0016) and the total is time-based, so the
  // Grain slider re-itemises the Steps and Map views but never moves this total.
  const grainNote = '<div class="analysis-caption roi-grain-note">The headline ' +
    "total does not depend on the Detail slider: it re-groups the Steps and " +
    "Map views, but a robot saves the same hours however the work is grouped, " +
    "so this figure never moves.</div>";

  const rows = cands.map((r) => _roiRow(r, roi)).join("");
  const unit = roi.needs_input ? "Hours/yr" : "Net €/yr";
  const table =
    '<table class="analysis-table roi-table">' +
      "<thead><tr><th>Segment</th><th>Inst.</th><th>Mean</th>" +
      "<th>Volume/yr</th>" +
      '<th title="conservative band">Cons.</th>' +
      '<th class="roi-expected" title="expected band">' + escapeHtml(unit) + "</th>" +
      '<th title="optimistic band">Opt.</th>' +
      "<th>Payback</th><th></th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";

  return {
    title, takeaway: _roiTakeaway(roi),
    body: '<div class="roi-head">' + editBtn + "</div>" + caption + autoShareNote + grainNote +
      _roiLegend(roi) + _roiTotals(roi) + table,
  };
}

/* Render the €-ROI section wrapped in the collapsible module shell. Pure (no
   DOM reads) so it stays unit-testable; exported as `_roiSection`. */
function _roiSection(roi) {
  if (!roi || typeof roi !== "object") return "";
  return _moduleShell("roi", _roiModule(roi));
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

/* Merge a patch into annotations.roi_inputs, persist via the undo path, then
   re-analyze so analysis.json's `roi` block (and this panel) recompute. The
   re-analyze is a same-folder reload, which preserves the undo stack — so
   Ctrl+Z still reverts the assumption edit. A patch value of `undefined`
   deletes that key (reset to the computed default). */
async function _writeRoiInputs(patch) {
  const session = State.getSession();
  if (!session || !session.sessionFolder) return;
  let anno;
  try { anno = JSON.parse(JSON.stringify(session.annotations || {})); }
  catch (_) { anno = {}; }
  const ri = (anno.roi_inputs && typeof anno.roi_inputs === "object") ? anno.roi_inputs : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete ri[k];
    else ri[k] = v;
  }
  // Drop empty override maps so we never persist noise; a fully-empty block
  // collapses back to null (the "no inputs" shape Python and SCHEMA expect).
  for (const mp of ["annual_volume_overrides", "automation_cost_overrides",
                    "automatable_fraction_overrides"]) {
    if (ri[mp] && typeof ri[mp] === "object" && !Object.keys(ri[mp]).length) delete ri[mp];
  }
  anno.roi_inputs = Object.keys(ri).length ? ri : null;
  await Session.saveAnnotationsWithUndo(anno, "Edit ROI assumptions");
  session.annotations = anno;
  State.emit("analysis");
  // Recompute. mine:false — `roi` lives in analysis.json; no map rebuild needed.
  toast("Recomputing ROI…");
  const r = await Ipc.runNormalizeExtended({ sessionFolder: session.sessionFolder, mine: false });
  if (!r || !r.ok) {
    toast("ROI recompute failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  // Reload in place (same folder ⇒ undo stack preserved) so the panel shows the
  // recomputed band. Lazy require dodges the flow-view ⇄ analysis-view cycle.
  const { loadSessionIntoView } = require("./flow-view.js");
  await loadSessionIntoView(session.sessionFolder);
  toast("ROI updated", "success");
}

/* A blank field resets to the default (undefined ⇒ delete key). */
function _numOrUndef(raw) {
  const t = String(raw == null ? "" : raw).trim();
  if (t === "") return undefined;
  const n = Number(t);
  return isFinite(n) ? n : undefined;
}

/* Session-level ROI assumptions form. Pre-fills from the persisted
   `roi_inputs` (falling back to the resolved `inputs_used` defaults shown in
   analysis.json) so the analyst edits live numbers, not blanks. */
async function _editRoiInputs() {
  const session = State.getSession();
  if (!session) return;
  const ri = (session.annotations && session.annotations.roi_inputs) || {};
  const used = ((session.analysis && session.analysis.roi) || {}).inputs_used || {};
  const rf = used.realism_factors || {};
  const cur = (k, fallback) => {
    const v = ri[k];
    if (v !== null && v !== undefined) return String(v);
    return fallback === undefined ? "" : String(fallback);
  };
  const rfVal = (band, def) => {
    const v = rf[band];
    return String(v !== undefined && v !== null ? v : def);
  };
  const res = await formModal({
    title: "ROI assumptions",
    message: "Commercial inputs that turn the automation candidates into a €-ROI band. " +
      "Leave a field blank to reset it to the default; with no labour rate the band stays in hours.",
    okLabel: "Save & recompute",
    fields: [
      { key: "currency", label: "Currency code", value: cur("currency", used.currency || "EUR"), placeholder: "EUR" },
      { key: "loaded_cost_per_hour", label: "Loaded labour cost (per hour)", value: cur("loaded_cost_per_hour"), placeholder: "e.g. 36", hint: "Fully-loaded operator cost. Blank → monetary figures stay hidden (no fabricated wage)." },
      { key: "annual_volume", label: "Annual volume (runs per year)", value: cur("annual_volume"), placeholder: "e.g. 1000", hint: "Blank → each candidate falls back to its observed instance count (a floor)." },
      { key: "automation_cost", label: "Automation build cost (one-off)", value: cur("automation_cost"), placeholder: "e.g. 15000", hint: "Amortised over the years below for net/yr + payback." },
      { key: "amortization_years", label: "Amortization (years)", value: cur("amortization_years", 3), placeholder: "3" },
      { key: "automatable_fraction", label: "Automatable share (0–1)", value: cur("automatable_fraction", 0.7), placeholder: "0.7", hint: "Share of manual time a robot realistically removes." },
      { key: "rf_conservative", label: "Realism — conservative", value: rfVal("conservative", 0.5), placeholder: "0.5" },
      { key: "rf_expected", label: "Realism — expected", value: rfVal("expected", 0.7), placeholder: "0.7" },
      { key: "rf_optimistic", label: "Realism — optimistic", value: rfVal("optimistic", 0.9), placeholder: "0.9" },
    ],
  });
  if (!res) return;
  const patch = {};
  const cText = String(res.currency || "").trim();
  patch.currency = cText === "" ? undefined : cText.toUpperCase();
  patch.loaded_cost_per_hour = _numOrUndef(res.loaded_cost_per_hour);
  patch.annual_volume = _numOrUndef(res.annual_volume);
  patch.automation_cost = _numOrUndef(res.automation_cost);
  patch.amortization_years = _numOrUndef(res.amortization_years);
  patch.automatable_fraction = _numOrUndef(res.automatable_fraction);
  const rfPatch = {};
  const addRf = (band, raw) => { const n = _numOrUndef(raw); if (n !== undefined) rfPatch[band] = n; };
  addRf("conservative", res.rf_conservative);
  addRf("expected", res.rf_expected);
  addRf("optimistic", res.rf_optimistic);
  if (Object.keys(rfPatch).length) {
    patch.realism_factors = Object.assign({}, ri.realism_factors || {}, rfPatch);
  }
  await _writeRoiInputs(patch);
}

/* Per-segment ROI override form (the SCHEMA `*_overrides` maps keyed by
   segment_signature). Lets the analyst give one candidate a different annual
   volume / automatable share / build cost than the session-wide defaults. */
async function _editSegmentRoi(sig) {
  const session = State.getSession();
  if (!session || !sig) return;
  const ri = (session.annotations && session.annotations.roi_inputs) || {};
  const vOv = (ri.annual_volume_overrides || {})[sig];
  const fOv = (ri.automatable_fraction_overrides || {})[sig];
  const cOv = (ri.automation_cost_overrides || {})[sig];
  const roi = (session.analysis && session.analysis.roi) || {};
  const cand = (roi.candidates || []).find((c) => c.segment_signature === sig);
  const res = await formModal({
    title: "Tune this segment",
    message: cand ? (cand.label || sig) : sig,
    okLabel: "Save & recompute",
    fields: [
      { key: "annual_volume", label: "Annual volume (this segment)", value: vOv == null ? "" : String(vOv), placeholder: "runs/yr", hint: "Overrides the session annual volume for this one candidate. Blank → use the session default." },
      { key: "automatable_fraction", label: "Automatable share (0–1)", value: fOv == null ? "" : String(fOv), placeholder: "0.7" },
      { key: "automation_cost", label: "Build cost (this segment)", value: cOv == null ? "" : String(cOv), placeholder: "one-off" },
    ],
  });
  if (!res) return;
  const setOv = (mapKey, val) => {
    const map = Object.assign({}, ri[mapKey] || {});
    if (val === undefined) delete map[sig];
    else map[sig] = val;
    return map;
  };
  await _writeRoiInputs({
    annual_volume_overrides: setOv("annual_volume_overrides", _numOrUndef(res.annual_volume)),
    automatable_fraction_overrides: setOv("automatable_fraction_overrides", _numOrUndef(res.automatable_fraction)),
    automation_cost_overrides: setOv("automation_cost_overrides", _numOrUndef(res.automation_cost)),
  });
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

  // €-ROI controls: the session-level "Edit assumptions…" and the per-row
  // "tune" override forms (§11c).
  const roiEdit = host.querySelector(".roi-edit-btn");
  if (roiEdit) roiEdit.addEventListener("click", () => _editRoiInputs());
  host.querySelectorAll(".roi-tune-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sig = btn.dataset.segmentSignature;
      if (sig) _editSegmentRoi(sig);
    });
  });
}

/* Render the Analysis level into #analysis-content. Reads the loaded
   session's analysis.json sidecar (session.analysis), merged with any
   analyst corrections from annotations.json; shows an empty state when
   the session was not analyzed or has no steps. */
function renderAnalysisLevel() {
  const host = $("#analysis-content");
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
  // current grain notch; the €-ROI total stays invariant. Build the regroup
  // maps once (skipped at the element notch, which keeps the editable default).
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
  // section builders return { title, takeaway, body, gated } (null = no data);
  // _roiSection already returns its own shell-wrapped string (kept string-shaped
  // for its unit test). A tier gate always wins: a gated module's body is its
  // CTA, so it shows even when expanded, and a collapse never removes it (the
  // native <details> retains the body in the DOM).
  host.innerHTML =
    _caption(overrides.length) +
    _moduleShell("time", _timeStudySection(analysis.time_study || [], notch, maps, wasteByProcessLabel)) +
    _moduleShell("automation", _automationSection(analysis.automation_candidates || [])) +
    _roiSection(analysis.roi);
  _wireControls(host, analysis);
  _wireModulePersistence(host);
}

module.exports = { renderAnalysisLevel, _roiSection };
