/*
 * case-scope.js: the options of the Timeline's "Transaction:" dropdown
 * (#case-scope-select). Pure, so the escaping is unit-tested.
 *
 * RP-34: a case id comes from annotations.json (steps[].case_id), which is
 * session data and so untrusted: a crafted id must not break out of the
 * option's value attribute into the page (nodeIntegration is on). Both the
 * value and the text go through the shared escapers.
 *
 * AD-29: an option reads the way the Steps level names the run, "Transaction
 * 1 · Order #10900" (its title, then its marker label when it has one that
 * says more than its number).
 */

"use strict";

const { escapeHtml, escapeAttr } = require("./dom.js");
const { numberOnlyLabel } = require("./runs-model.js");

function _timecode(ms) {
  if (!ms) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
}

/* `cases` = [{ id, label, startMs, title? }] (flow-view.deriveCases, each
   with the Steps level's title when it has one); `scope` = the selected case
   id ("" for all transactions); `sessionStartMs` = the first event's time.
   A case with a title reads "Transaction 1 · Order #10900" ("Transaction 1"
   without a label worth showing). One without (not a run the Steps level
   knows) keeps its label, or its id, and duplicate labels get a [H:MM:SS]
   offset so they can be told apart (P2.8). Returns the options' HTML. */
function caseScopeOptionsHtml(cases, scope, sessionStartMs) {
  const labelCounts = {};
  for (const c of cases) {
    const k = c.label || c.id;
    labelCounts[k] = (labelCounts[k] || 0) + 1;
  }
  const opts = ['<option value="">All transactions</option>'].concat(cases.map((c) => {
    const named = c.label && c.label !== c.id && !numberOnlyLabel(c.label) ? c.label : "";
    let label;
    if (c.title) {
      label = c.title + (named ? " · " + named : "");
    } else {
      const baseLabel = c.label && c.label !== c.id ? c.label : c.id;
      const offsetMs = c.startMs && Number.isFinite(sessionStartMs) ? c.startMs - sessionStartMs : 0;
      label = labelCounts[baseLabel] > 1 ? `${baseLabel} [${_timecode(offsetMs)}]` : baseLabel;
    }
    return '<option value="' + escapeAttr(c.id) + '"' + (c.id === scope ? " selected" : "") + ">" +
      escapeHtml(label) + "</option>";
  }));
  // Transactions are derived from analyzed steps; a project without any
  // says so rather than showing a lone "All transactions".
  if (!cases.length) {
    opts.push('<option value="" disabled>(no transactions yet)</option>');
  }
  return opts.join("");
}

module.exports = { caseScopeOptionsHtml };
