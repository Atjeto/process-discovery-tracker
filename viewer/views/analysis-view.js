/*
 * analysis-view.js -- the Analysis level of the Session view.
 *
 * Renders the heuristic findings from analysis.json: the process
 * efficiency ratio, per-step-type waste classification, the time
 * study, and automation candidates (segment-grain, ADR-0016).
 *
 * The heuristics ship provisional (ADR-0008): the value-add vs.
 * business-required split needs a human, and confirming a segment
 * really is automation-worthy is an analyst call. Corrections live in
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

/* Waste-type filter (v0.18.1). Clicking a chip on a waste row filters the list
   to rows tagged with that type; the click also runs stopPropagation so it
   doesn't bubble to the row's "adjust" handler. Module-level so it persists
   across re-renders within the same session; reset on session change is
   handled implicitly because the visible list shape changes anyway. */
let _wasteTypeFilter = null;

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

/* ============ Sections ============================================ */

function _caption(overrideCount) {
  let html = '<div class="analysis-caption">Heuristic estimate — these figures ' +
    "come from rule-of-thumb classifiers tuned ahead of real recording " +
    "data. Review them before relying on them.";
  if (overrideCount > 0) {
    html += " <strong>" + overrideCount + " analyst correction" +
      (overrideCount === 1 ? "" : "s") + "</strong> applied in this view — " +
      "run Analyze again to bake them into analysis.json and the PDD export.";
  }
  return html + "</div>";
}

/* Honesty gate (lab-phase §A5): while every step's `bnva_ms` still sits at
   the heuristic default of 0, the VA/(VA+BNVA+NVA) ratio is an artifact of
   that default, not a measurement -- so the big number is WITHHELD until the
   analyst has judged business-required time on at least one step type. The
   section is replaced by the call to action (the Tier-gate pattern), never
   rendered with fact-level authority. */
function _efficiencySection(eff, hasBnvaOverride) {
  if (!eff || typeof eff.process_efficiency_ratio !== "number") return "";
  if (!hasBnvaOverride) {
    return '<div class="analysis-section">' +
      '<div class="analysis-section-title">Process efficiency</div>' +
      '<div class="analysis-note">Withheld — the value-add vs business-required ' +
        "split is an analyst judgment, and no step type has one yet (the " +
        "heuristic defaults business-required to 0, which would inflate the " +
        "ratio). Click a row under <strong>Waste by step</strong> to set " +
        "business-required minutes; the ratio renders from then on.</div>" +
      "</div>";
  }
  const pct = Math.round(eff.process_efficiency_ratio * 100);
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Process efficiency</div>' +
    '<div class="efficiency-row">' +
      '<div class="efficiency-big">' + pct + "%</div>" +
      '<div class="efficiency-detail">' +
        "value-add " + escapeHtml(_fmt(eff.total_va_ms)) + " · " +
        "waste " + escapeHtml(_fmt(eff.total_nva_ms)) + " · " +
        "of " + escapeHtml(_fmt(eff.total_elapsed_ms)) + " across steps" +
      "</div>" +
    "</div></div>";
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

function _buildWasteRow(g, editable = true) {
  const total = (g.va_ms || 0) + (g.bnva_ms || 0) + (g.nva_ms || 0);
  const seg = (ms, cls) => (!ms || total <= 0) ? "" :
    '<span class="waste-seg ' + cls + '" style="width:' +
    ((ms / total) * 100).toFixed(1) + '%"></span>';
  const tags = (g.waste_types || [])
    .map((t) => '<button type="button" class="waste-tag waste-tag-btn" ' +
      'data-waste-type="' + escapeAttr(t) + '" ' +
      'title="Click to filter the list to step types tagged \'' + escapeAttr(t) + '\' (click again to clear).">' +
      escapeHtml(t) + "</button>")
    .join("");
  const badge = g.instances > 1
    ? '<span class="waste-instances" title="' + g.instances +
        ' instances">' + g.instances + "&times;</span>"
    : "";
  // ADR-0024: at a coarse grain the rows are READ-ONLY (the business-required
  // override is process_label-scoped and a coarse group spans many labels) --
  // edit at the element notch. The waste totals are unchanged, so the
  // efficiency figure is grain-invariant either way.
  const cls = editable ? "waste-row waste-row-editable" : "waste-row";
  const title = editable
    ? (g.instances > 1
        ? "Click to set the business-required share across all " + g.instances + " instances"
        : "Click to set the business-required share of this step")
    : "Read-only at this grain — set Grain to element to adjust business-required time";
  return '<div class="' + cls + '" data-process-label="' +
      escapeAttr(g.process_label || "") +
      '" title="' + escapeAttr(title) + '">' +
    '<span class="waste-name" title="' + escapeAttr(g.process_label || "") + '">' +
      escapeHtml(g.process_label || "(step)") + badge + "</span>" +
    '<span class="waste-bar">' +
      seg(g.va_ms, "seg-va") + seg(g.bnva_ms, "seg-bnva") +
      seg(g.nva_ms, "seg-nva") +
    "</span>" +
    '<span class="waste-tags">' + tags + "</span>" +
    (editable ? '<span class="waste-edit">adjust</span>' : "") +
  "</div>";
}

function _wasteSection(waste, notch, maps) {
  if (!waste.length) return "";
  const regroup = (notch && notch !== "element" && maps);
  const labelOf = regroup
    ? (w) => (w.step_id && maps.byStepId.get(w.step_id))
        || maps.byProcessLabel.get(_wasteRowProcessLabel(w)) || null
    : null;
  const editable = !regroup;
  const allGroups = _groupWasteRows(waste, labelOf);
  if (!allGroups.length) return "";
  // Apply the waste-type filter (v0.18.1). When set, only rows whose
  // waste_types include the filter survive; the rest are hidden until the
  // user clears the filter via the indicator chip.
  const groups = _wasteTypeFilter
    ? allGroups.filter((g) => (g.waste_types || []).includes(_wasteTypeFilter))
    : allGroups;
  const dur = (g) => (g.va_ms || 0) + (g.bnva_ms || 0) + (g.nva_ms || 0);
  const hasSignal = (g) => dur(g) > 0 || (g.waste_types && g.waste_types.length);
  // Surface the wasteful + time-heavy step types; tuck instant (0-duration) ones
  // behind an expander so the default view isn't a wall of empty bars. Sort by
  // total waste (nva) desc, then total duration desc.
  const sorted = groups.slice().sort((a, b) =>
    (b.nva_ms || 0) - (a.nva_ms || 0) || dur(b) - dur(a));
  const main = sorted.filter(hasSignal);
  const instant = sorted.filter((g) => !hasSignal(g));
  const legend = '<div class="waste-legend">' +
    '<span><span class="swatch seg-va"></span>value-add</span>' +
    '<span><span class="swatch seg-bnva"></span>business-required</span>' +
    '<span><span class="swatch seg-nva"></span>waste</span>' +
  "</div>";
  const filterChip = _wasteTypeFilter
    ? '<div class="waste-filter-chip">Filtered to <span class="waste-tag waste-tag-active">' +
      escapeHtml(_wasteTypeFilter) + '</span> — ' +
      groups.length + ' of ' + allGroups.length + ' step types ' +
      '<button type="button" class="waste-filter-clear" title="Show all step types">show all ✕</button></div>'
    : "";
  const rowHtml = (g) => _buildWasteRow(g, editable);
  let body = main.length ? '<div class="waste-rows">' + main.map(rowHtml).join("") + "</div>" : "";
  if (instant.length) {
    body += '<details class="waste-instant"><summary>' + instant.length +
      " instant " + (regroup ? notch : "step type") + (instant.length === 1 ? "" : "s") +
      " (no measured duration)</summary>" +
      '<div class="waste-rows">' + instant.map(rowHtml).join("") + "</div></details>";
  }
  if (_wasteTypeFilter && !groups.length) {
    body = '<div class="waste-empty">No step types tagged "' +
      escapeHtml(_wasteTypeFilter) + '" in this session.</div>';
  }
  const title = regroup ? ("Waste by " + escapeHtml(notch)) : "Waste by step";
  const grainHint = regroup
    ? '<div class="analysis-caption">Rolled up to the <strong>' + escapeHtml(notch) +
      "</strong> grain (read-only — set Grain to <strong>element</strong> to adjust " +
      "business-required time). The waste totals, and so the efficiency figure, are unchanged.</div>"
    : "";
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">' + title + "</div>" + grainHint + legend + filterChip + body + "</div>";
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

/* Honesty gate (lab-phase §A5): distribution statistics (mean/stdev/
   percentiles) at tiny N are cargo-cult precision -- a "p95" over 3
   instances is noise wearing a lab coat. The distribution columns render
   only when at least one row has `instances >= 10` (and only at the
   element notch, where stdev/percentiles exist in the data -- the coarse-
   grain regroup can't derive them); below that the table states what was
   actually measured: instances, total, and the min–max range. */
const TIME_STUDY_DISTRIBUTION_MIN_N = 10;

function _timeStudySection(ts, notch, maps) {
  if (!ts.length) return "";
  const regroup = (notch && notch !== "element" && maps);
  const study = _regroupTimeStudy(ts, notch, maps);
  const maxN = study.reduce((m, t) => Math.max(m, t.instances || 0), 0);
  const distribution = !regroup && maxN >= TIME_STUDY_DISTRIBUTION_MIN_N;
  const rows = study.map((t) => {
    const c = t.cycle_ms || {};
    const total = Math.round((c.mean || 0) * (t.instances || 0));
    const range = escapeHtml(_fmt(c.min)) + " – " + escapeHtml(_fmt(c.max));
    const cells = distribution
      ? '<td class="num">' + escapeHtml(_fmt(c.mean)) + "</td>" +
        '<td class="num">' + escapeHtml(_fmt(c.stdev)) + "</td>" +
        '<td class="num">' + escapeHtml(_fmt(c.p50)) + "</td>" +
        '<td class="num">' + escapeHtml(_fmt(c.p95)) + "</td>" +
        '<td class="num">' + range + "</td>"
      : '<td class="num">' + escapeHtml(_fmt(total)) + "</td>" +
        '<td class="num">' + range + "</td>";
    return "<tr>" +
      "<td>" + escapeHtml(t.name || "(step)") + "</td>" +
      '<td class="num">' + (t.instances || 0) + "</td>" +
      cells +
      '<td class="num">' + escapeHtml(_fmt(t.active_ms)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(t.waiting_ms)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(t.switching_ms)) + "</td>" +
    "</tr>";
  }).join("");
  const head = regroup ? escapeHtml(notch.charAt(0).toUpperCase() + notch.slice(1)) : "Step";
  const statHead = distribution
    ? "<th>Mean</th><th>Stdev</th><th>P50</th><th>P95</th><th>Range</th>"
    : "<th>Total</th><th>Range</th>";
  const gateNote = distribution ? "" :
    '<div class="analysis-caption">Distribution columns (mean/stdev/percentiles) ' +
    "render once a step type reaches " + TIME_STUDY_DISTRIBUTION_MIN_N +
    " instances — below that the table shows what was measured: instances, " +
    "total and range.</div>";
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Time study' +
      (regroup ? ' <span class="meta">(by ' + escapeHtml(notch) + ")</span>" : "") + "</div>" +
    gateNote +
    '<table class="analysis-table">' +
      "<thead><tr><th>" + head + "</th><th>Instances</th>" + statHead +
      "<th>Active</th><th>Waiting</th>" +
      "<th>Switching</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
}

function _decisionCell(a) {
  const c = a.automation_confirmed;
  const btn = (val, label) =>
    '<button type="button" class="auto-btn' + (c === val ? " active" : "") +
    '" data-confirm="' + val + '">' + label + "</button>";
  return '<div class="auto-decision" data-segment-signature="' +
    escapeAttr(a.segment_signature || "") + '">' +
    btn(true, "Confirm") + btn(false, "Dismiss") + "</div>";
}

/* Render the Automation candidates list at the segment grain
   (ADR-0016). A row is a coherent stretch of work the segment detector
   found repeating: same app, same case, same ordered step sequence.
   That is the smallest unit a robot can actually take end-to-end --
   we deliberately do NOT render single clicks or keystrokes here. */
function _automationSection(auto) {
  if (!auto.length) return "";
  const scored = auto.filter((a) => a.data_sufficiency === "multi_instance");
  const lonely = auto.length - scored.length;
  const lead = '<div class="analysis-section-title">Automation candidates</div>' +
    '<div class="analysis-caption">' +
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
    return '<div class="analysis-section">' + lead +
      '<div class="analysis-note">' + escapeHtml(note) + "</div></div>";
  }
  const rows = scored.map((a, i) => {
    const steps = (a.step_labels || []).slice(0, 6);
    const moreSteps = (a.step_labels || []).length - steps.length;
    const sequence = steps.length
      ? steps.map(escapeHtml).join('<span class="auto-arrow"> → </span>')
        + (moreSteps > 0 ? ' <span class="auto-more">+' + moreSteps + " more</span>" : "")
      : '<span class="score-na">no labelled steps</span>';
    const app = String(a.app || "").replace(/\.exe$/i, "") || "—";
    const rank = (a.rank === null || a.rank === undefined) ? (i + 1) : a.rank;
    return "<tr>" +
      '<td class="num auto-rank">' + escapeHtml(String(rank)) + "</td>" +
      '<td><div class="auto-label">' + escapeHtml(a.label || "(segment)") + "</div>" +
        '<div class="auto-sequence">' + sequence + "</div></td>" +
      "<td>" + escapeHtml(app) + "</td>" +
      '<td class="num">' + (a.instance_count || 0) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(a.total_elapsed_ms)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(a.mean_elapsed_ms)) + "</td>" +
      "<td>" + _decisionCell(a) + "</td>" +
    "</tr>";
  }).join("");
  const tail = lonely
    ? '<div class="analysis-note">' + lonely + " more segment" +
      (lonely === 1 ? "" : "s") + " occurred only once and " +
      "aren't ranked (single instances can't be judged for repeatability)." +
      "</div>"
    : "";
  return '<div class="analysis-section">' + lead +
    '<table class="analysis-table">' +
      '<thead><tr><th title="Automation priority rank">#</th>' +
      "<th>Segment</th><th>App</th>" +
      "<th>Instances</th><th>Total time</th><th>Mean per instance</th>" +
      "<th>Decision</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" + tail + "</div>";
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

function _roiTotals(roi) {
  const t = roi.totals || {};
  const hours = (t.saved_hours_per_year === null || t.saved_hours_per_year === undefined)
    ? "—" : t.saved_hours_per_year + " h";
  const parts = [
    '<div class="roi-total"><div class="roi-total-big">' + escapeHtml(String(hours)) +
      '</div><div class="roi-total-label">saved per year (expected)</div></div>',
  ];
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
    '<td><div class="auto-label">' + escapeHtml(r.label || "(segment)") + "</div></td>" +
    '<td class="num">' + (r.instance_count || 0) + "</td>" +
    '<td class="num">' + escapeHtml(_fmt(r.mean_elapsed_ms)) + "</td>" +
    '<td class="num">' + Math.round((r.automatable_fraction || 0) * 100) + "%</td>" +
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

/* Render the €-ROI section: the analyst-assumption banner, the band legend,
   the expected-band totals, and a per-candidate band table. Pure (no DOM
   reads) so it is unit-testable; exported as `_roiSection`. */
function _roiSection(roi) {
  if (!roi || typeof roi !== "object") return "";
  const cands = Array.isArray(roi.candidates) ? roi.candidates : [];
  const title = '<div class="analysis-section-title">Return on automation (€-ROI)</div>';
  const editBtn = '<button type="button" class="roi-edit-btn" ' +
    'title="Set the loaded labour rate, annual volume, build cost and realism factors">' +
    "Edit assumptions…</button>";
  const head =
    '<div class="roi-head">' + title + editBtn + "</div>";

  if (!cands.length) {
    return '<div class="analysis-section">' + head +
      '<div class="analysis-note">No multi-instance automation candidates to cost yet — ' +
      "the €-ROI projects a yearly saving from a segment seen across 2+ cases. " +
      "Analyze a longer recording or load more sessions.</div></div>";
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
  // ADR-0024: make the grain↔ROI relationship explicit. The candidates are at
  // the coherent-segment grain (ADR-0016) and the total is time-based, so the
  // Grain slider re-itemises the Steps and Map views but never moves this total.
  const grainNote = '<div class="analysis-caption roi-grain-note">The headline ' +
    "total is grain-invariant: the Grain slider re-itemises the Steps and Map " +
    "views, but a robot saves the same hours however the work is grouped, so " +
    "this figure never moves.</div>";

  const rows = cands.map((r) => _roiRow(r, roi)).join("");
  const unit = roi.needs_input ? "Hours/yr" : "Net €/yr";
  const table =
    '<table class="analysis-table roi-table">' +
      "<thead><tr><th>Segment</th><th>Inst.</th><th>Mean</th><th>Auto%</th>" +
      "<th>Volume/yr</th>" +
      '<th title="conservative band">Cons.</th>' +
      '<th class="roi-expected" title="expected band">' + escapeHtml(unit) + "</th>" +
      '<th title="optimistic band">Opt.</th>' +
      "<th>Payback</th><th></th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";

  return '<div class="analysis-section">' + head + caption + grainNote +
    _roiLegend(roi) + _roiTotals(roi) + table + "</div>";
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
      "). The heuristic counts active time as value-add. Enter the " +
      "business-required minutes per instance — applied to every instance " +
      "(clamped to each one's available active time); measured waste is unaffected."
    : '"' + (group.process_label || "step") + '" runs ' + _fmt(totalElapsed) +
      ". The heuristic counts all active time as value-add. Enter the part " +
      "that is business-required — necessary, but not adding value. The rest " +
      "stays value-add; measured waste is unaffected.";
  const hint = n > 1
    ? "Up to " + (Math.round(maxBnvaMin * 100) / 100) +
      " min per instance (average available active time). Applies to all " +
      n + " instances. Leave blank to reset to the heuristic."
    : "Up to " + (Math.round(maxBnvaMin * 100) / 100) +
      " min of active time. Leave blank to reset to the heuristic.";
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

  /* v0.18.1: chip-driven waste-type filter. Click a chip on a row to scope the
     list to step types tagged with that waste type; stopPropagation keeps the
     click from also opening the row's adjust modal. Click the chip of the
     currently-filtered type (or the "show all ✕" indicator) to clear. */
  host.querySelectorAll(".waste-tag-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = btn.dataset.wasteType;
      _wasteTypeFilter = _wasteTypeFilter === t ? null : t;
      renderAnalysisLevel();
    });
  });
  const clearBtn = host.querySelector(".waste-filter-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _wasteTypeFilter = null;
      renderAnalysisLevel();
    });
  }

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
  // ADR-0024: the step-grained itemisation (Waste by step, Time study) follows
  // the current grain notch; the €-ROI total stays invariant. Build the regroup
  // maps once (skipped at the element notch, which keeps the editable default).
  const notch = State.getGrain();
  const maps = (notch && notch !== "element") ? _grainMaps(notch) : null;
  // Honesty gate: the efficiency ratio renders only once an analyst has
  // judged business-required time somewhere (any bnva_ms override).
  const hasBnvaOverride = overrides.some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  host.innerHTML =
    _caption(overrides.length) +
    _efficiencySection(analysis.efficiency || {}, hasBnvaOverride) +
    _wasteSection(analysis.waste_classification || [], notch, maps) +
    _timeStudySection(analysis.time_study || [], notch, maps) +
    _automationSection(analysis.automation_candidates || []) +
    _roiSection(analysis.roi);
  _wireControls(host, analysis);
}

module.exports = { renderAnalysisLevel, _roiSection };
