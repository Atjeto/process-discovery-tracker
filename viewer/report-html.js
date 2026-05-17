/*
 * report-html.js -- self-contained HTML findings report (Phase D).
 *
 * generateFindingsReport(session, options) returns a complete HTML
 * document string -- doctype, inline <style>, body -- that opens in any
 * browser with no external assets. Pure: every environment-dependent
 * input (the process-map SVG, screenshot image data) is passed in via
 * `options`, so the function is deterministic and unit-testable.
 */

"use strict";

const { computeSummary, stepStateLabel } = require("./session-summary.js");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return "-";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

function fmtTs(iso) {
  if (!iso) return "-";
  return String(iso).replace("T", " ").replace(/\.\d{3}/, "").replace(/Z$/, "");
}

function stepDurationMs(step) {
  const tr = step && step.time_range;
  if (!tr || !tr.start || !tr.end) return null;
  const a = Date.parse(tr.start), b = Date.parse(tr.end);
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, b - a);
}

const CSS = [
  "*{box-sizing:border-box}",
  "body{margin:0;background:#f4f4f2;color:#1a1a1a;",
  "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}",
  "main{max-width:900px;margin:0 auto;padding:32px 28px;background:#fff}",
  "h1{font-size:24px;margin:0 0 4px}",
  "h2{font-size:16px;margin:28px 0 10px;padding-bottom:4px;border-bottom:2px solid #ddd}",
  "header .sub{color:#666;margin:0}",
  "table{width:100%;border-collapse:collapse;margin:8px 0}",
  "th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e3e3e3;font-size:13px}",
  "th{background:#f0f0ee}",
  "td.num,th.num{text-align:right}",
  ".kv{display:flex;flex-wrap:wrap;gap:4px 24px;margin:6px 0}",
  ".kv div b{color:#000}",
  "figure{margin:8px 0;text-align:center}",
  "figure svg{max-width:100%;height:auto;border:1px solid #e3e3e3}",
  "figcaption{color:#888;font-size:12px;margin-top:4px}",
  ".note{border-left:3px solid #ccc;padding:3px 10px;margin:6px 0}",
  ".note .ts{color:#999;font-size:12px}",
  ".shot{margin:12px 0}",
  ".shot img{max-width:100%;border:1px solid #ddd}",
  ".shot .cap{color:#888;font-size:12px}",
  ".reco{border:1px dashed #bbb;padding:12px;min-height:60px;background:#fafafa}",
  ".muted{color:#888}",
  ".wtag{display:inline-block;background:#eee;border-radius:3px;padding:0 6px;",
  "font-size:11px;margin-right:3px}",
  "footer{margin-top:32px;padding-top:10px;border-top:1px solid #e3e3e3;",
  "color:#999;font-size:12px}",
].join("");

function headerSection(session, summary) {
  const m = session.manifest || {};
  const worker = (summary && summary.worker) ||
    ((m.config && m.config.worker && m.config.worker.id)) || "unknown worker";
  const dur = summary ? fmtDuration(summary.durationMs) : "-";
  return "<header><h1>Process Findings Report</h1>" +
    '<p class="sub">Engagement <b>' + esc(m.engagement_id || "-") + "</b> · worker <b>" +
    esc(worker) + "</b> · started " + esc(fmtTs(m.started_at)) +
    " · duration <b>" + esc(dur) + "</b></p></header>";
}

function summarySection(session, summary) {
  if (!summary) {
    return "<h2>Process summary</h2>" +
      '<p class="muted">This session has not been analyzed yet.</p>';
  }
  const kv = [
    ["Cases", summary.caseCount],
    ["Events", summary.eventCount],
    ["Steps", summary.stepCount + " (" + summary.autoSteps + " auto-detected, " +
      summary.confirmedSteps + " confirmed)"],
    ["Phases", summary.phaseCount],
    ["App switches", summary.appSwitches],
  ];
  if (summary.efficiencyRatio != null) {
    kv.push(["Process efficiency",
      Math.round(summary.efficiencyRatio * 100) + "% value-add"]);
  }
  let out = "<h2>Process summary</h2><div class=\"kv\">" +
    kv.map((r) => "<div>" + esc(r[0]) + ": <b>" + esc(String(r[1])) + "</b></div>").join("") +
    "</div>";
  if (summary.topActivities && summary.topActivities.length) {
    out += "<table><thead><tr><th>Where the time went</th><th class=\"num\">Share</th>" +
      "<th class=\"num\">Time</th></tr></thead><tbody>" +
      summary.topActivities.map((a) =>
        "<tr><td>" + esc(a.label) + "</td><td class=\"num\">" +
        Math.round(a.pct * 100) + "%</td><td class=\"num\">" +
        esc(fmtDuration(a.ms)) + "</td></tr>").join("") +
      "</tbody></table>";
  }
  return out;
}

function processMapSection(options) {
  if (!options.includeProcessMap || !options.processMapSvg) return "";
  return "<h2>Process map</h2><figure>" + options.processMapSvg +
    "<figcaption>Directly-follows flow of the captured activities.</figcaption></figure>";
}

function analysisSection(session, options) {
  const analysis = session.analysis;
  if (!options.includeAnalysis || !analysis) return "";
  let out = "<h2>Waste &amp; automation findings</h2>" +
    '<p class="muted">Heuristic estimate &mdash; review before relying on these figures.</p>';
  const eff = analysis.efficiency || {};
  if (typeof eff.process_efficiency_ratio === "number") {
    out += "<p>Process efficiency: <b>" +
      Math.round(eff.process_efficiency_ratio * 100) + "%</b> value-add — " +
      esc(fmtDuration(eff.total_va_ms)) + " of " +
      esc(fmtDuration(eff.total_elapsed_ms)) + " across steps.</p>";
  }
  const waste = analysis.waste_classification || [];
  if (waste.length) {
    out += "<table><thead><tr><th>Step</th><th class=\"num\">Value-add</th>" +
      "<th class=\"num\">Waste</th><th>Waste types</th></tr></thead><tbody>" +
      waste.map((w) =>
        "<tr><td>" + esc(w.name || "(step)") + "</td><td class=\"num\">" +
        esc(fmtDuration(w.va_ms)) + "</td><td class=\"num\">" +
        esc(fmtDuration(w.nva_ms)) + "</td><td>" +
        (w.waste_types || []).map((t) => '<span class="wtag">' + esc(t) + "</span>").join("") +
        "</td></tr>").join("") +
      "</tbody></table>";
  }
  const auto = analysis.automation_candidates || [];
  if (auto.length) {
    const score = (v) => (v == null) ? "—" : Math.round(v * 100) + "%";
    out += "<table><thead><tr><th>Automation candidate</th>" +
      "<th class=\"num\">Repetitive</th><th class=\"num\">Rule-based</th>" +
      "<th>Data</th></tr></thead><tbody>" +
      auto.map((a) => {
        const sc = a.scores || {};
        return "<tr><td>" + esc(a.name || "(step)") + "</td><td class=\"num\">" +
          score(sc.repetitiveness) + "</td><td class=\"num\">" +
          score(sc.rule_based) + "</td><td>" +
          esc(a.data_sufficiency === "single_instance"
            ? "1 instance — insufficient" : "multi-instance") + "</td></tr>";
      }).join("") +
      "</tbody></table>";
  }
  return out;
}

function stepsSection(session) {
  const steps = ((session.annotations || {}).steps || [])
    .filter((s) => s.state !== "hidden");
  if (!steps.length) return "";
  return "<h2>Steps</h2><table><thead><tr><th>#</th><th>Step</th>" +
    "<th class=\"num\">Duration</th><th>State</th></tr></thead><tbody>" +
    steps.map((s, i) =>
      "<tr><td class=\"num\">" + (i + 1) + "</td><td>" + esc(s.name || "(step)") +
      (s.description ? '<br><span class="muted">' + esc(s.description) + "</span>" : "") +
      "</td><td class=\"num\">" + esc(fmtDuration(stepDurationMs(s))) +
      "</td><td>" + esc(stepStateLabel(s.state)) + "</td></tr>").join("") +
    "</tbody></table>";
}

function notesSection(session, options) {
  if (!options.includeNotes) return "";
  const notes = ((session.annotations || {}).notes || []).slice()
    .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  if (!notes.length) return "";
  return "<h2>Notes</h2>" + notes.map((n) =>
    '<div class="note"><span class="ts">' + esc(fmtTs(n.timestamp)) + "</span> " +
    esc(n.text || "") + "</div>").join("");
}

function screenshotsSection(session, options) {
  if (!options.includeScreenshots) return "";
  const starred = (session.annotations || {}).starred_screenshots || [];
  const data = options.screenshotData || {};
  const byPath = {};
  for (const ev of (session.events || [])) {
    if (ev.type === "system" && ev.data &&
        (ev.data.kind === "screenshot" || ev.data.kind === "screenshot_manual")) {
      byPath[ev.data.path] = ev;
    }
  }
  const shots = starred.filter((p) => data[p]);
  if (!shots.length) return "";
  return "<h2>Starred screenshots</h2>" + shots.map((p) => {
    const ev = byPath[p];
    const cap = ev
      ? fmtTs(ev.timestamp) + " · " +
        (ev.data.kind === "screenshot_manual" ? "manual" : "automatic")
      : p;
    return '<div class="shot"><img alt="screenshot" src="' + esc(data[p]) + '">' +
      '<div class="cap">' + esc(cap) + "</div></div>";
  }).join("");
}

/* Build a complete, self-contained HTML findings report. `options`:
   includeProcessMap / includeAnalysis / includeNotes / includeScreenshots
   (booleans), processMapSvg (string|null), screenshotData ({relPath:
   dataURI}). Pure -- no DOM, no fs. */
function generateFindingsReport(session, options) {
  session = session || {};
  options = options || {};
  const summary = computeSummary(session);
  const m = session.manifest || {};
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    "<title>Findings report — " + esc(m.engagement_id || "session") + "</title>",
    "<style>" + CSS + "</style>",
    "</head><body><main>",
    headerSection(session, summary),
    summarySection(session, summary),
    processMapSection(options),
    analysisSection(session, options),
    stepsSection(session),
    notesSection(session, options),
    screenshotsSection(session, options),
    "<h2>Recommendations</h2>",
    '<div class="reco" contenteditable="true">Recommendations: [to be completed]</div>',
    "<footer>Generated by Process Discovery Viewer on " +
      esc(fmtTs(new Date().toISOString())) + ".</footer>",
    "</main></body></html>",
  ].join("\n");
}

module.exports = { generateFindingsReport };
