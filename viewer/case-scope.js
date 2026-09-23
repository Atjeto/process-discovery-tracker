/*
 * case-scope.js: the options of the Flow "Run:" dropdown (#case-scope-select).
 * Pure, so the escaping is unit-tested.
 *
 * RP-34: a case id comes from annotations.json (steps[].case_id), which is
 * session data and so untrusted: a crafted id must not break out of the
 * option's value attribute into the page (nodeIntegration is on). Both the
 * value and the text go through the shared escapers.
 */

"use strict";

const { escapeHtml, escapeAttr } = require("./dom.js");

function _timecode(ms) {
  if (!ms) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
}

/* `cases` = [{ id, label, startMs }] (flow-view.deriveCases); `scope` = the
   selected case id ("" for all runs); `sessionStartMs` = the first event's
   time. Duplicate labels get a [H:MM:SS] offset so they can be told apart
   (P2.8). Returns the options' HTML. */
function caseScopeOptionsHtml(cases, scope, sessionStartMs) {
  const labelCounts = {};
  for (const c of cases) {
    const k = c.label || c.id;
    labelCounts[k] = (labelCounts[k] || 0) + 1;
  }
  const opts = ['<option value="">All runs</option>'].concat(cases.map((c) => {
    const baseLabel = c.label && c.label !== c.id ? c.label : c.id;
    const offsetMs = c.startMs && Number.isFinite(sessionStartMs) ? c.startMs - sessionStartMs : 0;
    const label = labelCounts[baseLabel] > 1 ? `${baseLabel} [${_timecode(offsetMs)}]` : baseLabel;
    return '<option value="' + escapeAttr(c.id) + '"' + (c.id === scope ? " selected" : "") + ">" +
      escapeHtml(label) + "</option>";
  }));
  // Runs are derived from analyzed steps; a session without any says so
  // rather than showing a lone "All runs".
  if (!cases.length) {
    opts.push('<option value="" disabled>(no runs yet)</option>');
  }
  return opts.join("");
}

module.exports = { caseScopeOptionsHtml };
