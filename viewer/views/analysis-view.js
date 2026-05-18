/*
 * analysis-view.js -- the Analysis level of the Session view.
 *
 * Renders the heuristic IE/CI findings from analysis.json: the process
 * efficiency ratio, per-step waste classification, the time study, and
 * automation candidates.
 *
 * The heuristics ship provisional (ADR-0008): the value-add vs.
 * business-required split and whether an automation candidate is real
 * both need a human. This view lets the analyst correct them -- a click
 * on a waste row sets the step's business-required time; a confirm /
 * dismiss toggle marks an automation candidate. Corrections are written
 * to annotations.json (`analysis_overrides[]`), NOT analysis.json (which
 * `normalize` regenerates every run). `applyAnalysisOverrides` folds them
 * back in so the view updates immediately; the next Analyze run bakes
 * them into analysis.json proper. See ANALYSIS-LAYER-FOLLOWUPS.md.
 */

"use strict";

const { $, escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const State = require("../state.js");
const Session = require("../session.js");
const { formModal } = require("../modals.js");

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

/* Fold annotations.json `analysis_overrides` into a copy of the
   analysis.json sidecar, so an analyst correction shows in the view
   before the next re-analyze bakes it in. Mirrors the normalization
   side: analysis_waste.py (_apply_waste_override) + analysis_efficiency.py
   + analysis_automation.py (automation_confirmed). Returns `analysis`
   unchanged when there is nothing to apply. */
function applyAnalysisOverrides(analysis, overrides) {
  if (!analysis || !overrides || !overrides.length) return analysis;
  const byStep = _overridesByStep(overrides);

  const waste = (analysis.waste_classification || []).map((w) => {
    const ov = byStep[w.step_id];
    if (!ov) return w;
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
  });

  const automation = (analysis.automation_candidates || []).map((a) => {
    const ov = byStep[a.step_id];
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

function _efficiencySection(eff) {
  if (!eff || typeof eff.process_efficiency_ratio !== "number") return "";
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

function _wasteSection(waste) {
  if (!waste.length) return "";
  const rows = waste.map((w) => {
    const total = (w.va_ms || 0) + (w.bnva_ms || 0) + (w.nva_ms || 0);
    const seg = (ms, cls) => (!ms || total <= 0) ? "" :
      '<span class="waste-seg ' + cls + '" style="width:' +
      ((ms / total) * 100).toFixed(1) + '%"></span>';
    const tags = (w.waste_types || [])
      .map((t) => '<span class="waste-tag">' + escapeHtml(t) + "</span>")
      .join("");
    return '<div class="waste-row waste-row-editable" data-step-id="' +
        escapeAttr(w.step_id || "") +
        '" title="Click to set the business-required share of this step">' +
      '<span class="waste-name" title="' + escapeAttr(w.name || "") + '">' +
        escapeHtml(w.name || "(step)") + "</span>" +
      '<span class="waste-bar">' +
        seg(w.va_ms, "seg-va") + seg(w.bnva_ms, "seg-bnva") +
        seg(w.nva_ms, "seg-nva") +
      "</span>" +
      '<span class="waste-tags">' + tags + "</span>" +
      '<span class="waste-edit">adjust</span>' +
    "</div>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Waste by step</div>' +
    '<div class="waste-legend">' +
      '<span><span class="swatch seg-va"></span>value-add</span>' +
      '<span><span class="swatch seg-bnva"></span>business-required</span>' +
      '<span><span class="swatch seg-nva"></span>waste</span>' +
    "</div>" +
    '<div class="waste-rows">' + rows + "</div></div>";
}

function _timeStudySection(ts) {
  if (!ts.length) return "";
  const rows = ts.map((t) => {
    const c = t.cycle_ms || {};
    return "<tr>" +
      "<td>" + escapeHtml(t.name || "(step)") + "</td>" +
      '<td class="num">' + (t.instances || 0) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(c.mean)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(c.min)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(c.max)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(t.active_ms)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(t.waiting_ms)) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(t.switching_ms)) + "</td>" +
    "</tr>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Time study</div>' +
    '<table class="analysis-table">' +
      "<thead><tr><th>Step</th><th>Instances</th><th>Mean</th>" +
      "<th>Min</th><th>Max</th><th>Active</th><th>Waiting</th>" +
      "<th>Switching</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
}

function _decisionCell(a) {
  const c = a.automation_confirmed;
  const btn = (val, label) =>
    '<button type="button" class="auto-btn' + (c === val ? " active" : "") +
    '" data-confirm="' + val + '">' + label + "</button>";
  return '<div class="auto-decision" data-step-id="' +
    escapeAttr(a.step_id || "") + '">' +
    btn(true, "Confirm") + btn(false, "Dismiss") + "</div>";
}

function _automationSection(auto) {
  if (!auto.length) return "";
  const score = (v) => (v === null || v === undefined)
    ? '<span class="score-na" title="needs 2+ instances of the step">—</span>'
    : Math.round(v * 100) + "%";
  const rows = auto.map((a) => {
    const sc = a.scores || {};
    const inst = a.instances || 0;
    const dataLabel = inst + " instance" + (inst === 1 ? "" : "s") +
      (a.data_sufficiency === "single_instance" ? " — insufficient" : "");
    return "<tr>" +
      "<td>" + escapeHtml(a.name || "(step)") + "</td>" +
      '<td class="num">' + score(sc.repetitiveness) + "</td>" +
      '<td class="num">' + score(sc.rule_based) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(sc.volume)) + "</td>" +
      "<td>" + escapeHtml(dataLabel) + "</td>" +
      "<td>" + _decisionCell(a) + "</td>" +
    "</tr>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Automation candidates</div>' +
    '<table class="analysis-table">' +
      "<thead><tr><th>Step</th><th>Repetitive</th><th>Rule-based</th>" +
      "<th>Volume</th><th>Data</th><th>Decision</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
}

/* ============ Correction handlers ================================= */

/* Upsert a per-step entry in annotations.json `analysis_overrides[]`.
   A patch field set to undefined clears that correction; an entry left
   with only `step_id` is pruned. Persists with undo, then emits
   "analysis" so this view (and undo/redo) repaint. */
async function _writeOverride(stepId, patch) {
  const session = State.getSession();
  if (!session || !stepId) return;
  let anno;
  try { anno = JSON.parse(JSON.stringify(session.annotations || {})); }
  catch (_) { anno = {}; }
  const list = Array.isArray(anno.analysis_overrides) ? anno.analysis_overrides : [];
  let entry = list.find((o) => o && o.step_id === stepId);
  if (!entry) { entry = { step_id: stepId }; list.push(entry); }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete entry[k];
    else entry[k] = v;
  }
  anno.analysis_overrides = list.filter((o) =>
    o && o.step_id != null && Object.keys(o).some((k) => k !== "step_id"));
  await Session.saveAnnotationsWithUndo(anno, "Adjust analysis classification");
  session.annotations = anno;
  State.emit("analysis");
}

async function _editBnva(w) {
  const elapsed = w.elapsed_ms || 0;
  const nva = w.nva_ms || 0;
  const maxBnvaMin = Math.max(0, elapsed - nva) / 60000;
  const curMin = (w.bnva_ms || 0) / 60000;
  const res = await formModal({
    title: "Business-required time",
    message: '"' + (w.name || "step") + '" runs ' + _fmt(elapsed) +
      ". The heuristic counts all active time as value-add. Enter the part " +
      "that is business-required — necessary, but not adding value. The rest " +
      "stays value-add; measured waste is unaffected.",
    okLabel: "Save",
    fields: [{
      key: "min",
      label: "Business-required minutes",
      value: curMin ? String(Math.round(curMin * 100) / 100) : "",
      placeholder: "0",
      hint: "Up to " + (Math.round(maxBnvaMin * 100) / 100) +
        " min of active time. Leave blank to reset to the heuristic.",
    }],
  });
  if (!res) return;
  const raw = String(res.min == null ? "" : res.min).trim();
  if (raw === "") { _writeOverride(w.step_id, { bnva_ms: undefined }); return; }
  const min = Number(raw);
  if (!isFinite(min) || min < 0) {
    toast("Enter a number of minutes (0 or more)", "error");
    return;
  }
  _writeOverride(w.step_id, { bnva_ms: Math.round(min * 60000) });
}

/* Attach the waste-row and automation-decision handlers after a render.
   `analysis` is the override-merged view, so the current state is read
   from it (a second click on the active decision clears it). */
function _wireControls(host, analysis) {
  const wasteByStep = {};
  for (const w of (analysis.waste_classification || [])) {
    wasteByStep[w.step_id] = w;
  }
  host.querySelectorAll(".waste-row-editable").forEach((row) => {
    row.addEventListener("click", () => {
      const w = wasteByStep[row.dataset.stepId];
      if (w) _editBnva(w);
    });
  });

  const autoByStep = {};
  for (const a of (analysis.automation_candidates || [])) {
    autoByStep[a.step_id] = a;
  }
  host.querySelectorAll(".auto-decision .auto-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".auto-decision");
      if (!wrap) return;
      const stepId = wrap.dataset.stepId;
      const want = btn.dataset.confirm === "true";
      const cur = autoByStep[stepId];
      const isActive = cur && cur.automation_confirmed === want;
      _writeOverride(stepId, { automation_confirmed: isActive ? undefined : want });
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
  host.innerHTML =
    _caption(overrides.length) +
    _efficiencySection(analysis.efficiency || {}) +
    _wasteSection(analysis.waste_classification || []) +
    _timeStudySection(analysis.time_study || []) +
    _automationSection(analysis.automation_candidates || []);
  _wireControls(host, analysis);
}

module.exports = { renderAnalysisLevel };
