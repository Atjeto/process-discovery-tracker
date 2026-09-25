/*
 * analysis-view.js: the Overview's Observations (step-back review 4.4), one
 * source with the PDD (lane CC). Two items, each a collapsible module whose
 * one-line takeaway shows while it is closed (closed by default; the
 * analyst's choice persists per item under the pdt.analysis.* keys):
 *
 *   Data: the PDD's section 5 as it prints it: every field entered, with its
 *     system and screen, its step, an example value and how it is re-keyed,
 *     then the Re-keyed data (a value typed in one system and again in
 *     another in the same transaction).
 *   Applications and time: the PDD's section 6: the Time per transaction
 *     (each transaction's steps, active and elapsed time, and the line on
 *     the walkthrough) and the Time in each application (each system's
 *     screens, steps and time per transaction, the most time first).
 *
 * Both are the rows the pipeline wrote into analysis.json (`pdd_data`,
 * `pdd_time`; normalization/pdd_export.py data_section and time_section,
 * the functions the PDD prints the sections with): nothing is measured
 * here, so the Overview and the PDD read one fact in the same words, pinned
 * by shared/pdd-rows-golden.json. A failed stage is said (C12), never shown
 * as zero; an analysis from before the rows (format 2) is analyzed again as
 * the project opens (normalize-result.js analysisNeed).
 */

"use strict";

const { escapeHtml, escapeAttr } = require("../dom.js");

const STAGE_NOT_RUN = "This check could not run on this recording";
const NOT_YET = "Not measured in this project's analysis yet: the project is analyzed again as it opens.";

/* ---- Collapsible modules ------------------------------------------------- */

const _MODULE_KEY_PREFIX = "pdt.analysis.";
function _moduleOpen(key) {
  try { return localStorage.getItem(_MODULE_KEY_PREFIX + key) === "1"; }
  catch (_) { return false; }
}
function _setModuleOpen(key, open) {
  try { localStorage.setItem(_MODULE_KEY_PREFIX + key, open ? "1" : "0"); }
  catch (_) {}
}

/* One item: a title, a takeaway that shows while it is closed, a body. */
function _moduleShell(key, mod) {
  const open = _moduleOpen(key);
  return '<details class="analysis-section analysis-module ov-obs-item" data-module="' +
      escapeAttr(key) + '"' + (open ? " open" : "") + ">" +
    '<summary class="analysis-module-head">' +
      '<span class="analysis-module-title">' + escapeHtml(mod.title) + "</span>" +
      '<span class="analysis-module-takeaway">' + escapeHtml(mod.takeaway || "") + "</span>" +
      '<span class="analysis-module-chevron" aria-hidden="true"></span>' +
    "</summary>" +
    '<div class="analysis-module-body">' + (mod.body || "") + "</div>" +
  "</details>";
}

/* ---- The PDD's rows ----------------------------------------------------------- */

/* Where a block stands: "ok" (its rows are there), "not-run" (its stage
   failed, C12), "not-yet" (an analysis from before the rows). */
function _rowsStatus(analysis, key) {
  const v = analysis ? analysis[key] : undefined;
  if (v && typeof v === "object") return "ok";
  if (v === null) return "not-run";
  return "not-yet";
}

/* One of the PDD's tables as it prints it: `header` and `rows` (every cell
   the text printed). `num`: the columns that hold a number or a time, set
   right in the mono type. */
function rowsTableHtml(header, rows, num) {
  const right = new Set(num || []);
  const cell = (tag, text, i) => "<" + tag + (right.has(i) ? ' class="num"' : "") + ">" + escapeHtml(String(text == null ? "" : text)) + "</" + tag + ">";
  return '<table class="ov-rows">' +
    "<thead><tr>" + (header || []).map((h, i) => cell("th", h, i)).join("") + "</tr></thead>" +
    "<tbody>" + (rows || []).map((r) => "<tr>" + r.map((c, i) => cell("td", c, i)).join("") + "</tr>").join("") + "</tbody>" +
    "</table>";
}

const _note = (text) => '<p class="analysis-note ov-rows-note">' + escapeHtml(text) + "</p>";
const _subtitle = (text) => '<div class="ov-rows-title">' + escapeHtml(text) + "</div>";

function _notRun(title, what) {
  return { title, takeaway: STAGE_NOT_RUN,
    body: '<p class="analysis-note ov-stage-not-run">' + escapeHtml(STAGE_NOT_RUN + ", so " + what + ".") + "</p>" };
}

/* Section 5, Data: the table of the fields entered, then the Re-keyed data. */
function dataItem(analysis) {
  const title = "Data";
  const status = _rowsStatus(analysis, "pdd_data");
  if (status === "not-run") return _notRun(title, "the fields entered are not listed");
  if (status === "not-yet") return { title, takeaway: "Not measured yet", body: _note(NOT_YET) };
  const d = analysis.pdd_data;
  if (d.note) return { title: d.heading || title, takeaway: d.note, body: _note(d.note) };
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const rekeyed = Array.isArray(d.rekeyed) ? d.rekeyed : [];
  const takeaway = rekeyed.length
    ? rekeyed[0] + (rekeyed.length > 1 ? " (+" + (rekeyed.length - 1) + " more)" : "")
    : rows.length + (rows.length === 1 ? " field" : " fields") + " entered, none re-keyed";
  return {
    title: d.heading || title,
    takeaway,
    body: rowsTableHtml(d.header, rows) +
      (rekeyed.length ? _subtitle("Re-keyed data") +
        '<ul class="ov-rekeyed">' + rekeyed.map((l) => "<li>" + escapeHtml(l) + "</li>").join("") + "</ul>" : ""),
  };
}

/* Section 6, Applications and time: the time per transaction, then the time
   in each application. */
function timeItem(analysis) {
  const title = "Applications and time";
  const status = _rowsStatus(analysis, "pdd_time");
  if (status === "not-run") return _notRun(title, "the times are not measured");
  if (status === "not-yet") return { title, takeaway: "Not measured yet", body: _note(NOT_YET) };
  const t = analysis.pdd_time;
  const tx = t.per_transaction || {};
  const app = t.per_application || {};
  const appRows = Array.isArray(app.rows) ? app.rows : [];
  const timed = Array.isArray(app.header) && app.header.length === 4;
  let takeaway;
  if (app.note) takeaway = app.note;
  else if (timed && appRows.length) {
    takeaway = "Most time in " + appRows[0][0] + ": " + appRows[0][3] +
      (app.header[3] === "Time per transaction" ? " per transaction" : "");
  } else takeaway = appRows.length + (appRows.length === 1 ? " system" : " systems") + ", no time measured";
  const txBody = tx.note ? _note(tx.note)
    : rowsTableHtml(tx.header, tx.rows, [1, 2, 3]) + (tx.after ? '<p class="ov-rows-after">' + escapeHtml(tx.after) + "</p>" : "");
  const appBody = app.note ? _note(app.note) : rowsTableHtml(app.header, appRows, timed ? [3] : []);
  return {
    title: t.heading || title,
    takeaway,
    body: _subtitle(tx.heading || "Time per transaction") + txBody +
      _subtitle(app.heading || "Time in each application") + appBody,
  };
}

/* ---- The block ------------------------------------------------------------- */

/* Who fills the Observations, beside their title (AD-29): nobody types them,
   and the PDD prints the same rows. */
const OBSERVATIONS_WHO = "Measured from the recording. The PDD prints them in sections 5 and 6.";

/* The Observations block of the Overview for one session. `rowsLine`: the
   quiet line on the rows' age (rows-freshness.js freshnessLine), "" while
   they are current; overview-view.js updates it in place. Pure (no DOM, no
   State): the unit tests render fixture sessions through it. */
function observationsHtml(sess, rowsLine) {
  if (!sess) return "";
  const line = rowsLine || "";
  return '<section class="ov-section ov-observations" id="ov-observations">' +
    '<div class="ov-section-head"><div class="ov-section-title">Observations</div>' +
      '<div class="ov-block-who">' + escapeHtml(OBSERVATIONS_WHO) + "</div>" +
      '<div class="ov-rows-freshness" id="ov-rows-freshness"' + (line ? "" : " hidden") + ">" +
        escapeHtml(line) + "</div></div>" +
    _moduleShell("data", dataItem(sess.analysis)) +
    _moduleShell("time", timeItem(sess.analysis)) +
    "</section>";
}

/* Wire the per-analyst open state after a render. */
function wireObservations(host) {
  if (!host) return;
  host.querySelectorAll("#ov-observations details.analysis-module[data-module]").forEach((d) => {
    d.addEventListener("toggle", () => _setModuleOpen(d.dataset.module, d.open));
  });
}

module.exports = { observationsHtml, wireObservations, dataItem, timeItem, rowsTableHtml, OBSERVATIONS_WHO };
