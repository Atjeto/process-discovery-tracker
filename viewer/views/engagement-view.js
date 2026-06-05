/*
 * PDT 1.0 Engagement Cockpit — multi-session aggregated workspace.
 *
 * PDT-1.0-SPEC §5.3. The Engagement view is the consulting-deliverable
 * workspace: headline numbers across an engagement, the Process Backlog
 * as cards (not a plain table), per-process drill-in (PDD preview +
 * variant tree placeholder + linked evidence), and the engagement-level
 * export bar.
 */

"use strict";

const State = require("../state.js");

// --- Formatting helpers ---

function _fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m";
  return s + "s";
}

function _fmtMoney(n, ccy) {
  if (n == null || !isFinite(n)) return null;
  const sym = ccy === "USD" ? "$" : ccy === "EUR" ? "€" : (ccy || "") + " ";
  if (Math.abs(n) >= 1000) return sym + Math.round(n / 1000) + "k";
  return sym + Math.round(n);
}

function _fmtCount(n) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString();
}

function _confidenceClass(c) {
  if (c == null || !isFinite(c)) return "low";
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
}

function _h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

// --- State ---

let _currentEngagement = null;
let _selectedRow = null;   // when set, render the per-process detail page

function loadEngagement(eng) {
  _currentEngagement = eng;
  _selectedRow = null;
  render();
}

function getCurrent() { return _currentEngagement; }

function _drillInto(row) {
  _selectedRow = row;
  render();
}

function _backToList() {
  _selectedRow = null;
  render();
}

// --- Render ---

function render() {
  const host = document.getElementById("view-engagement");
  if (!host) return;
  host.innerHTML = "";
  if (!_currentEngagement) {
    host.appendChild(_renderEmpty());
    return;
  }
  if (_selectedRow) {
    host.appendChild(_renderProcessDetail(_selectedRow));
    return;
  }
  host.appendChild(_renderOverview());
}

function _renderEmpty() {
  return _h("div", { class: "engagement-empty" },
    _h("div", { class: "engagement-empty-icon" }, "⌬"),
    _h("h2", null, "No engagement loaded"),
    _h("p", null, "Open an engagement folder to see the Process Backlog and aggregated candidates across all the sessions it contains."),
    _h("button", {
      class: "primary",
      onClick: () => { if (window._openEngagementFolder) window._openEngagementFolder(); },
    }, "Open engagement folder...")
  );
}

function _renderOverview() {
  const eng = _currentEngagement.engagement || {};
  const backlog = _currentEngagement.backlog || { rows: [], process_count: 0 };
  const summary = _currentEngagement.summary || {};
  const ccy = (eng.config && eng.config.currency) || "EUR";

  const wrap = _h("div", { class: "engagement-overview" });

  // --- Title ---
  wrap.appendChild(_h("div", { class: "engagement-title-row" },
    _h("div", { class: "engagement-title" },
      _h("h2", null, eng.name || "(unnamed engagement)"),
      eng.client ? _h("span", { class: "engagement-client" }, eng.client) : null,
    ),
    _h("div", { class: "engagement-export-bar" },
      _h("button", { class: "primary", title: "Export the Process Backlog as XLSX",
        onClick: () => { if (window._engagementExportBacklog) window._engagementExportBacklog("xlsx"); } }, "Backlog (XLSX)"),
      _h("button", { title: "Export the Process Backlog as CSV",
        onClick: () => { if (window._engagementExportBacklog) window._engagementExportBacklog("csv"); } }, "CSV"),
      _h("button", { title: "Generate one PDD per backlog row",
        onClick: () => { if (window._engagementExportAllPdds) window._engagementExportAllPdds(); } }, "All PDDs"),
      _h("button", { title: "Export the configured-engagement bundle (leave-behind)",
        onClick: () => { if (window._engagementExportConfig) window._engagementExportConfig(); } }, "Config bundle"),
    ),
  ));

  // --- Headline cards ---
  const headline = _h("section", { class: "engagement-headline" });
  headline.appendChild(_makeHeadlineCard(_fmtCount(summary.session_count), "sessions", "Sessions in this engagement"));
  headline.appendChild(_makeHeadlineCard(_fmtDuration(summary.total_capture_ms || 0), "captured", "Total wall-clock time across all sessions"));
  headline.appendChild(_makeHeadlineCard(_fmtCount(backlog.process_count || 0), "processes", "Identified processes (after fuzzy aggregation)"));
  const aiNamed = (backlog.rows || []).filter(r => r.ai_named).length;
  if (aiNamed > 0) {
    headline.appendChild(_makeHeadlineCard(_fmtCount(aiNamed), "AI-named", "Processes with LLM-generated labels"));
  }
  if (summary.total_net_annual != null) {
    const money = _fmtMoney(summary.total_net_annual, ccy);
    if (money) headline.appendChild(_makeHeadlineCard(money, "potential / yr",
      "Sum of expected-band net annual savings (low-confidence excluded)", true));
  }
  wrap.appendChild(headline);

  // --- Process Backlog cards ---
  const sec = _h("section", { class: "engagement-backlog" });
  sec.appendChild(_h("div", { class: "engagement-sec-header" },
    _h("h3", null, "Process Backlog"),
    backlog.suppressed_low_confidence > 0
      ? _h("span", { class: "engagement-suppressed",
                     title: "Hidden by the confidence floor — open in Workshop to review." },
          backlog.suppressed_low_confidence + " low-confidence hidden")
      : null,
  ));
  if (!backlog.rows || backlog.rows.length === 0) {
    sec.appendChild(_h("div", { class: "engagement-empty-section" },
      "No candidates yet. Add sessions to the engagement and run Analyze on each."));
  } else {
    const grid = _h("div", { class: "engagement-card-grid" });
    backlog.rows.forEach(r => grid.appendChild(_makeRowCard(r)));
    sec.appendChild(grid);
  }
  wrap.appendChild(sec);

  return wrap;
}

function _makeHeadlineCard(value, label, tooltip, accent) {
  return _h("div", { class: "engagement-stat-card" + (accent ? " accent" : ""), title: tooltip },
    _h("div", { class: "engagement-stat-val" }, value),
    _h("div", { class: "engagement-stat-lbl" }, label),
  );
}

function _makeRowCard(row) {
  const conf = Math.round((row.confidence || 0) * 100);
  const confCls = _confidenceClass(row.confidence);
  const apps = row.apps || [];
  const card = _h("div", {
    class: "engagement-card" + (row.below_confidence_floor ? " engagement-card-low" : ""),
    onClick: () => _drillInto(row),
  });
  card.appendChild(_h("div", { class: "engagement-card-rank" }, "#" + (row.rank || "—")));
  const titleRow = _h("div", { class: "engagement-card-title-row" },
    _h("div", { class: "engagement-card-title" }, row.label || "(unnamed)"),
  );
  if (row.ai_named) {
    titleRow.appendChild(_h("span", { class: "engagement-card-ai", title: "Activity name from the local AI Naming Layer" }, "AI"));
  }
  card.appendChild(titleRow);
  card.appendChild(_h("div", { class: "engagement-card-meta" },
    apps.length > 0 ? _h("span", null, apps.join(" · ")) : null,
  ));
  const stats = _h("div", { class: "engagement-card-stats" });
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    _h("span", { class: "stat-val" }, row.case_count || 0),
    _h("span", { class: "stat-lbl" }, "cases"),
  ));
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    _h("span", { class: "stat-val" }, row.session_count || 0),
    _h("span", { class: "stat-lbl" }, "sessions"),
  ));
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    _h("span", { class: "stat-val" }, _fmtDuration(row.mean_elapsed_ms || 0)),
    _h("span", { class: "stat-lbl" }, "avg"),
  ));
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    _h("span", { class: "stat-val cockpit-conf-" + confCls }, conf + "%"),
    _h("span", { class: "stat-lbl" }, "confidence"),
  ));
  card.appendChild(stats);
  if (!row.variant_data_sufficient) {
    card.appendChild(_h("div", { class: "engagement-card-warn",
      title: "Fewer than 3 cases observed — variant analysis is suppressed for this row." },
      "variant analysis suppressed"));
  }
  card.appendChild(_h("div", { class: "engagement-card-cta" }, "Open details →"));
  return card;
}

function _renderProcessDetail(row) {
  const eng = _currentEngagement.engagement || {};
  const wrap = _h("div", { class: "engagement-detail" });
  wrap.appendChild(_h("button", { class: "engagement-back-btn", onClick: _backToList }, "← Back to backlog"));
  wrap.appendChild(_h("h2", { class: "engagement-detail-title" }, row.label || "(unnamed)"));
  wrap.appendChild(_h("div", { class: "engagement-detail-meta" },
    _h("span", null, "Rank #" + (row.rank || "—")),
    _h("span", null, " · "),
    _h("span", null, (row.apps || []).join(", ")),
    row.ai_named ? _h("span", { class: "engagement-detail-ai-tag" }, "AI-named") : null,
  ));

  // --- Headline stats row ---
  const headline = _h("section", { class: "engagement-headline" });
  headline.appendChild(_makeHeadlineCard(row.case_count || 0, "cases observed"));
  headline.appendChild(_makeHeadlineCard(row.session_count || 0, "sessions"));
  headline.appendChild(_makeHeadlineCard(_fmtDuration(row.mean_elapsed_ms), "avg duration"));
  headline.appendChild(_makeHeadlineCard(_fmtDuration(row.total_elapsed_ms), "total observed"));
  const conf = Math.round((row.confidence || 0) * 100);
  headline.appendChild(_makeHeadlineCard(conf + "%", "confidence", null, true));
  wrap.appendChild(headline);

  // --- Variants block ---
  const variantsSec = _h("section", { class: "engagement-detail-section" });
  variantsSec.appendChild(_h("h3", null, "Variants"));
  if (!row.variant_data_sufficient) {
    variantsSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Variant analysis is suppressed because fewer than 3 cases were observed. " +
      "Capture more sessions of this process to unlock variant breakdown."));
  } else {
    variantsSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Open in Workshop → Steps view (Aligned reading) to compare each case's path through the activity sequence."));
  }
  wrap.appendChild(variantsSec);

  // --- PDD actions block ---
  const pddSec = _h("section", { class: "engagement-detail-section" });
  pddSec.appendChild(_h("h3", null, "Process Discovery Document"));
  pddSec.appendChild(_h("p", { class: "engagement-detail-hint" },
    "The PDD bundles a measured-numbers summary with an LLM-drafted §1 paragraph. " +
    "All numerical content traces to observations; surrounding prose is templated when the LLM is unavailable."));
  pddSec.appendChild(_h("div", { class: "engagement-detail-actions" },
    _h("button", { class: "primary", onClick: () => {
      if (window._engagementExportPdd) window._engagementExportPdd(row);
    } }, "Generate PDD for this process"),
  ));
  wrap.appendChild(pddSec);

  // --- Evidence block ---
  const evidenceSec = _h("section", { class: "engagement-detail-section" });
  evidenceSec.appendChild(_h("h3", null, "Evidence"));
  evidenceSec.appendChild(_h("p", { class: "engagement-detail-hint" },
    "Signature " + (row.signature || "—").slice(0, 12) +
    " — observed in " + (row.session_count || 0) + " session(s), " +
    (row.case_count || 0) + " case(s)."));
  wrap.appendChild(evidenceSec);

  return wrap;
}

module.exports = { render, loadEngagement, getCurrent };
