/*
 * analysis-view.js -- the Analysis level of the Session view.
 *
 * Renders the heuristic IE/CI findings from analysis.json: the process
 * efficiency ratio, per-step waste classification, the time study, and
 * automation candidates. Pure rendering of the precomputed sidecar --
 * every heuristic lives in the normalization analysis layer (Cluster N
 * / ADR-0008), so this module only formats what it is given.
 */

"use strict";

const { $, escapeHtml, formatDuration } = require("../dom.js");
const State = require("../state.js");

function _fmt(ms) {
  return formatDuration(ms || 0);
}

function _caption() {
  return '<div class="analysis-caption">Heuristic estimate — these figures ' +
    "come from rule-of-thumb classifiers tuned ahead of real recording " +
    "data. Review them before relying on them.</div>";
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
    return '<div class="waste-row">' +
      '<span class="waste-name" title="' + escapeHtml(w.name || "") + '">' +
        escapeHtml(w.name || "(step)") + "</span>" +
      '<span class="waste-bar">' +
        seg(w.va_ms, "seg-va") + seg(w.bnva_ms, "seg-bnva") +
        seg(w.nva_ms, "seg-nva") +
      "</span>" +
      '<span class="waste-tags">' + tags + "</span>" +
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

function _automationSection(auto) {
  if (!auto.length) return "";
  const score = (v) => (v === null || v === undefined)
    ? '<span class="score-na" title="needs 2+ instances of the step">—</span>'
    : Math.round(v * 100) + "%";
  const rows = auto.map((a) => {
    const sc = a.scores || {};
    return "<tr>" +
      "<td>" + escapeHtml(a.name || "(step)") + "</td>" +
      '<td class="num">' + score(sc.repetitiveness) + "</td>" +
      '<td class="num">' + score(sc.rule_based) + "</td>" +
      '<td class="num">' + escapeHtml(_fmt(sc.volume)) + "</td>" +
      "<td>" + escapeHtml(a.data_sufficiency === "single_instance"
        ? "1 instance — insufficient" : "multi-instance") + "</td>" +
    "</tr>";
  }).join("");
  return '<div class="analysis-section">' +
    '<div class="analysis-section-title">Automation candidates</div>' +
    '<table class="analysis-table">' +
      "<thead><tr><th>Step</th><th>Repetitive</th><th>Rule-based</th>" +
      "<th>Volume</th><th>Data</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
}

/* Render the Analysis level into #analysis-content. Reads the loaded
   session's analysis.json sidecar (session.analysis); shows an empty
   state when the session was not analyzed or has no steps. */
function renderAnalysisLevel() {
  const host = $("#analysis-content");
  if (!host) return;
  const session = State.getSession();
  const analysis = session && session.analysis;
  if (!analysis) {
    host.innerHTML = '<div class="analysis-empty">No analysis available. ' +
      "Analyze a session that has steps to generate waste, time-study " +
      "and automation findings.</div>";
    return;
  }
  host.innerHTML =
    _caption() +
    _efficiencySection(analysis.efficiency || {}) +
    _wasteSection(analysis.waste_classification || []) +
    _timeStudySection(analysis.time_study || []) +
    _automationSection(analysis.automation_candidates || []);
}

module.exports = { renderAnalysisLevel };
