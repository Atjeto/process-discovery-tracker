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
 * The value-add vs. business-required split needs a human (ADR-0008). The
 * analyst's judgment lives in annotations.json `analysis_overrides[]`,
 * keyed by `process_label`; not in analysis.json (which `normalize`
 * regenerates every run). `applyAnalysisOverrides` folds it back in so the
 * view updates immediately; the next Analyze run bakes it into
 * analysis.json proper. See ANALYSIS-LAYER-FOLLOWUPS.md.
 *
 * Automation candidates (ADR-0016) are the one home of a repeated step
 * sequence (AD-20): listed by total time, as the PDD's 5.3 lists them.
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const State = require("../state.js");
const Session = require("../session.js");
const { formModal } = require("../modals.js");
const { processLabel } = require("../process-map-levels.js");
const { findingCardHtml } = require("../finding-cards.js");

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
   side: analysis_waste.py (_apply_waste_override) + analysis_efficiency.py.
   Returns `analysis` unchanged when there is nothing to apply. */
function applyAnalysisOverrides(analysis, overrides) {
  if (!analysis || !overrides || !overrides.length) return analysis;
  const byStep = _overridesByStep(overrides);
  const byPl = _overridesByProcessLabel(overrides);

  const waste = (analysis.waste_classification || []).map((w) => {
    const ov = byStep[w.step_id] || byPl[_wasteRowProcessLabel(w)];
    if (!ov) return w;
    return _applyWasteOverride(w, ov);
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
    automation_candidates: analysis.automation_candidates || [],
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
   (same pattern as `pdt.theme` / `pdt.summaryOpen`). Default: collapsed, so
   the Overview shows each module's takeaway line and the detail is one click
   away (P1.10). */
const _MODULE_KEY_PREFIX = "pdt.analysis.";
function _moduleOpen(key) {
  try { return localStorage.getItem(_MODULE_KEY_PREFIX + key) === "1"; }
  catch (_) { return false; }
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
function _groupWasteRows(waste) {
  const groups = new Map();
  for (const w of (waste || [])) {
    const pl = _wasteRowProcessLabel(w) || w.name || "(step)";
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

/* The inline judgment on a "Where the time goes" row (item 2 relocated):
   "20s business-required" once an analyst has judged this step type, else
   nothing (P1.4: the row's own total already says what was measured). Never
   a colored bar: a default-green bar would read as a measured "all value-add"
   result. */
function _wasteInlineSummary(g) {
  if (!g || !(g.bnva_ms || 0)) return "";
  return escapeHtml(_fmt(g.bnva_ms)) + " business-required";
}

/* The judgment editor for one step type's process_label, relocated (item 2)
   from the removed "Waste by screen"/"Waste by step" resident module into
   the expand-in-place body of its "Where the time goes" row. Reuses the
   original row markup (value/waste bar + waste-type tags) and the SAME
   click-to-edit affordance (`.waste-row-editable` -> `_editBnva`, wired in
   `_wireControls`) -- the write path and undo behavior are unchanged. */
function _buildWasteRow(g) {
  const total = (g.va_ms || 0) + (g.bnva_ms || 0) + (g.nva_ms || 0);
  const seg = (ms, cls) => (!ms || total <= 0) ? "" :
    '<span class="waste-seg ' + cls + '" style="width:' +
    ((ms / total) * 100).toFixed(1) + '%"></span>';
  const tags = (g.waste_types || [])
    .map((t) => '<span class="waste-tag">' + escapeHtml(t) + "</span>")
    .join("");
  const unjudged = !(g.bnva_ms || 0);
  const title = g.instances > 1
    ? "Click to set the business-required share across all " + g.instances + " instances"
    : "Click to set the business-required share of this step";
  // Item 2: while nothing is judged, the bar would be all value-add green (a
  // measured-looking "all value-add" result). Replace it with a neutral,
  // judgment-free measured-time chip until the analyst sets the first split.
  const barCell = unjudged
    ? '<span class="waste-bar waste-bar-unjudged" title="Not judged yet: click to split into value-add / business-required / waste">' +
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
  return legend + '<div class="waste-row waste-row-editable" data-process-label="' +
      escapeAttr(g.process_label || "") +
      '" title="' + escapeAttr(title) + '">' +
    '<span class="waste-name" title="' + escapeAttr(g.process_label || "") + '">' +
      escapeHtml(g.process_label || "(step)") + "</span>" +
    barCell +
    '<span class="waste-tags">' + tags + "</span>" +
    '<span class="waste-edit">adjust</span>' +
  "</div>";
}

/* Honesty gate (lab-phase §A5, relocated by §B1): distribution statistics
   (mean/stdev/percentiles) at tiny N are cargo-cult precision -- a "p95"
   over 3 instances is noise wearing a lab coat. The summary-stat line
   renders only when at least one row has `instances >= 10`; below that each
   row shows what was actually measured: the instances themselves, as dots. */
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
   the aggregate row) so the strip draws one clickable dot per instance. Rows
   are keyed by the step-group label. A row whose steps can't be resolved
   (e.g. stale analysis.json against edited steps) just renders without
   dots: nothing is fabricated. */
function _instancesByRowLabel() {
  const sess = State.getSession();
  const steps = (((sess && sess.annotations) || {}).steps || [])
    .filter((s) => s && s.state !== "hidden");
  const byLabel = new Map();
  for (const st of steps) {
    const label = _studyStepLabel(st);
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(st);
  }
  return byLabel;
}

/* step_id -> step for the dot click handlers (rebuilt every render). */
let _tsDotSteps = new Map();

function _timeStudySection(ts, wasteByProcessLabel) {
  if (!ts.length) return null;
  const study = ts;
  const maxN = study.reduce((m, t) => Math.max(m, t.instances || 0), 0);
  const distribution = maxN >= TIME_STUDY_DISTRIBUTION_MIN_N;
  const instancesOf = _instancesByRowLabel();
  _tsDotSteps = new Map();
  // Item 2 (relocated): a row's judgment editor is the waste group sharing
  // its process_label: `t.name` IS the process_label
  // (analysis_common.step_group_label), so the join is exact.
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
  // time go", so the heaviest step type leads. Display order only. A step
  // type with no measured time has nothing to show and is left out (P3.7).
  const tot = (t) => Math.round(((t.cycle_ms || {}).mean || 0) * (t.instances || 0));
  const ordered = study.filter((t) => tot(t) > 0).sort((a, b) => tot(b) - tot(a));
  if (!ordered.length) return null;

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
          (canJump ? ": click to open this instance on the Flow timeline" : "")) +
        '"' + (canJump ? "" : " disabled") + "></button>";
    }).join("");
    const breakdown = "active " + _fmt(t.active_ms) + " · waiting " + _fmt(t.waiting_ms) +
      " · switching " + _fmt(t.switching_ms);
    const stats = distribution
      ? '<div class="ts-stats">mean ' + escapeHtml(_fmt(c.mean)) +
        " · stdev " + escapeHtml(_fmt(c.stdev)) +
        " · p50 " + escapeHtml(_fmt(c.p50)) +
        " · p95 " + escapeHtml(_fmt(c.p95)) +
        " · range " + escapeHtml(_fmt(c.min)) + "-" + escapeHtml(_fmt(c.max)) + "</div>"
      : "";
    // Item 2 (relocated): the judgment editor lives one click behind this row
    // (expand-in-place, Evidence mechanic). Rows that already carry a judgment
    // show it inline on the row line ("20s business-required"); the click
    // target for editing lives in the expansion, not the row itself. The
    // judgment cell is always there (empty until judged) so the row's grid
    // keeps its columns.
    const g = wasteFor(t.name);
    const judgment = _wasteInlineSummary(g);
    const judgmentBody = g ? _buildWasteRow(g) : "";
    const expand = '<button type="button" class="ts-judge-expand" data-act="ts-expand" ' +
      'aria-expanded="false" title="Set business-required time for this step">▸</button>';
    return '<div class="ts-row" data-process-label="' + escapeAttr(t.name || "") + '">' +
      '<div class="ts-row-line">' +
        '<span class="ts-name" title="' + escapeAttr((t.name || "(step)") + " - " + breakdown) + '">' +
          escapeHtml(t.name || "(step)") + "</span>" +
        '<span class="ts-n">' + (t.instances || 0) + "×</span>" +
        '<span class="ts-total">' + escapeHtml(_fmt(total)) + "</span>" +
        '<div class="ts-strip">' + dots + "</div>" +
        '<span class="ts-judgment">' + judgment + "</span>" +
        expand +
      "</div>" +
      stats +
      '<div class="ts-judge-body" hidden>' + judgmentBody + "</div>" +
    "</div>";
  }).join("");

  const axis = '<div class="ts-axis"><span class="ts-axis-lbl">per-instance ' +
    'duration</span><span>0s</span><span class="ts-axis-line"></span><span>' +
    escapeHtml(_fmt(axisMax)) + "</span></div>";
  // Takeaway: name the heaviest step type + its total time (the module's memo
  // altitude).
  const totalMs = ordered.reduce((s, t) => s + tot(t), 0);
  const top = ordered[0];
  const takeaway = _fmt(totalMs) + " across " + ordered.length + " step type" +
    (ordered.length === 1 ? "" : "s") + " · most in " + (top.name || "(step)");
  return {
    title: "Where the time goes",
    takeaway,
    body: axis + '<div class="ts-rows">' + rows + "</div>",
  };
}

/* The claim sentence for one candidate's finding card: the pipeline's
   readable label (its steps, then "in <application>", the application by its
   readable name, 43d307b) and the measured repeats, e.g. "va01: Check
   document → va01: Create sales order in SAP GUI: ran 5 times, 46s in total,
   9s on average". The label already carries the step sequence, so the card
   does not print the chain again. */
function _candidateClaim(a) {
  const labels = (a.step_labels || []).filter((x) => String(x || "").trim());
  const what = String(a.label || "").trim() || labels.join(" → ") || "Step sequence";
  const n = a.instance_count || 0;
  return what + ": ran " + n + (n === 1 ? " time, " : " times, ") +
    _fmt(a.total_elapsed_ms) + " in total, " + _fmt(a.mean_elapsed_ms) + " on average";
}

/* The candidates in the order the Overview and the PDD's 5.3 list them (AD-20):
   repeated sequences only, longest total time first (a stable sort, so ties
   keep the pipeline's order, as Python's sorted() does in pdd_export). Pure. */
function orderedCandidates(auto) {
  return (auto || []).filter((a) => a && a.data_sufficiency === "multi_instance")
    .sort((a, b) => (b.total_elapsed_ms || 0) - (a.total_elapsed_ms || 0));
}

/* R1 (§4/§5): one finding card per candidate, the SAME shared card component
   the Overview findings feed uses (finding-cards.js). AD-20: the one home of a
   repeated step sequence, listed by total time as the PDD's 5.3 lists it. */
function _automationSection(auto) {
  if (!auto.length) return null;
  const scored = orderedCandidates(auto);
  if (!scored.length) {
    return {
      title: "Automation candidates",
      takeaway: "None yet: no step sequence was repeated",
      body: '<div class="analysis-note">Every step sequence in this recording happened once. ' +
        "A candidate is a step sequence done at least twice.</div>",
    };
  }
  const cards = scored.map((a, i) => findingCardHtml({
    id: "automation-" + (a.segment_signature || i),
    claim: _candidateClaim(a),
  }, { screenshots: false })).join("");
  return {
    title: "Automation candidates",
    takeaway: scored.length + " candidate" + (scored.length === 1 ? "" : "s") + ", longest total time first",
    body: '<div class="auto-cards">' + cards + "</div>",
  };
}

/* ============ Correction handlers ================================= */

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
      "business-required minutes per instance: applied to every instance " +
      "(clamped to each one's available active time); measured waste is unaffected."
    : '"' + (group.process_label || "step") + '" runs ' + _fmt(totalElapsed) +
      ". By default all active time counts as value-add. Enter the part " +
      "that is business-required: necessary, but not adding value. The rest " +
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

/* Attach the waste-row handlers after a render. `analysis` is the
   override-merged view. Waste rows are grouped by `process_label`; the click
   targets the group, not a single instance, so an edit propagates across the
   step type. */
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
   Every "Where the time goes" row opens its judgment editor. */
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
  // R1: "Process efficiency" and the "Waste by step/screen" resident module are
  // gone (§4 of the redesign): the judgment editor relocates into the
  // "Where the time goes" row expansion (item 2 relocated). Build the
  // process_label -> waste group map once (the override is process_label-scoped).
  const wasteByProcessLabel =
    new Map(_groupWasteRows(analysis.waste_classification || []).map((g) => [g.process_label, g]));
  // Item 21: each section renders inside a uniform collapsible module (title +
  // one-line takeaway + chevron), collapse state persisted per analyst. The
  // section builders return { title, takeaway, body, gated } (null = no data).
  // A tier gate always wins: a gated module's body is its CTA, so it shows
  // even when expanded, and a collapse never removes it (the native <details>
  // retains the body in the DOM).
  host.innerHTML =
    _moduleShell("time", _timeStudySection(analysis.time_study || [], wasteByProcessLabel)) +
    _moduleShell("automation", _automationSection(analysis.automation_candidates || []));
  _wireControls(host, analysis);
  _wireModulePersistence(host);
}

module.exports = { renderEvidenceInto, orderedCandidates };
