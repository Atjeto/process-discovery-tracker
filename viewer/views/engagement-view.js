/*
 * PDT 1.0 Engagement Cockpit — multi-session aggregated workspace.
 *
 * PDT-1.0-SPEC §5.3. The Engagement view is the consulting-deliverable
 * workspace: headline numbers across an engagement, the Process Backlog
 * as cards (not a plain table), per-process drill-in (PDD preview +
 * variant tree + linked evidence), and the engagement-level export bar.
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

function _fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  // ISO-8601 -> YYYY-MM-DD (no timezone wobble); good enough for "captured on" lines.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : iso.slice(0, 10);
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
    if (typeof c === "string" || typeof c === "number") {
      el.appendChild(document.createTextNode(String(c)));
    } else {
      el.appendChild(c);
    }
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

// --- Variant + evidence aggregation helpers (client-side) ---

/* Strip the leading "Screen: " prefix from step labels for compact paths
   ("Incident: Save record" -> "Save record"). Keep the original if no colon. */
function _shortStepLabel(s) {
  if (typeof s !== "string") return String(s || "");
  const i = s.indexOf(":");
  if (i > 0 && i < s.length - 1) return s.slice(i + 1).trim();
  return s.trim();
}

/* The IPC payload exposes a per-session `candidate_cases_by_signature` map
   so we can identify which sessions are evidence for THIS backlog row.
   Falls back to "any session whose stats mention any of the row's step
   labels" so the panel never sits empty when the signature mapping is thin. */
function _sessionsContributingToRow(row, sessionSummaries) {
  const sig = row && row.signature;
  const out = [];
  for (const ss of (sessionSummaries || [])) {
    const byS = ss && ss.candidate_cases_by_signature;
    const cids = (byS && sig && byS[sig]) || [];
    if (cids && cids.length > 0) {
      out.push({ summary: ss, contributingCaseIds: cids });
    }
  }
  return out;
}

/* Aggregate step_variants across the row's contributing sessions. The
   backlog row was built from automation candidates, which are observed in
   each session's annotations; each session's stats.json carries the
   step_variant frequency table for THAT session. We fold the per-session
   variants into one frequency-ranked list, keyed by the joined path. */
function _aggregateVariantsForRow(row, sessionSummaries) {
  const contribs = _sessionsContributingToRow(row, sessionSummaries);
  const byPath = new Map();   // key -> { variant, frequency, sessions }
  for (const c of contribs) {
    const ss = c.summary;
    for (const v of (ss.step_variants || [])) {
      if (!v || !Array.isArray(v.variant) || v.variant.length === 0) continue;
      const path = v.variant.map(s => String(s).trim()).filter(Boolean);
      if (path.length === 0) continue;
      const key = path.join(" → ");   // " -> " join, unicode arrow
      const freq = Math.max(1, Number(v.frequency) || 0);
      const prev = byPath.get(key);
      if (prev) {
        prev.frequency += freq;
        prev.sessions.add(ss.session_id);
      } else {
        byPath.set(key, {
          path,
          variant: path,
          frequency: freq,
          sessions: new Set([ss.session_id]),
        });
      }
    }
  }
  return Array.from(byPath.values())
    .sort((a, b) => (b.frequency - a.frequency) || (b.sessions.size - a.sessions.size));
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
  const wrap = _h("div", { class: "engagement-empty" },
    _h("div", { class: "engagement-empty-icon" }, "⌬"),
    _h("h2", null, "No engagement loaded"),
    _h("p", null,
      "An engagement is a folder of related session captures (the consultant's " +
      "deliverable workspace). Point at one to see the aggregated Process " +
      "Backlog across its sessions."),
    _h("p", { class: "engagement-empty-shape" },
      "Expected layout: engagement.json + sessions/<one folder per session>."),
    _h("div", { class: "engagement-empty-actions" },
      _h("button", { class: "primary",
        onClick: () => { if (window._openEngagementFolder) window._openEngagementFolder(); },
      }, "Open engagement folder..."),
    ),
    // ADR-0033 Demo Pack shortcut — populated by the renderer at boot via
    // the viewer:resolveDemoPacks IPC. Hidden until something is found.
    _h("div", { class: "engagement-empty-demo", id: "engagement-empty-demo" }),
  );
  // Defer the bundled-demo lookup to after the DOM mounts so the user
  // sees the empty state immediately and the demo block fills in.
  if (typeof window !== "undefined" && typeof window._renderEngagementDemoShortcut === "function") {
    setTimeout(() => window._renderEngagementDemoShortcut(), 0);
  }
  return wrap;
}

function _renderOverview() {
  const eng = _currentEngagement.engagement || {};
  const backlog = _currentEngagement.backlog || { rows: [], process_count: 0 };
  const summary = _currentEngagement.summary || {};
  const ccy = (eng.config && eng.config.currency) || "EUR";
  const engFolder = _currentEngagement.engagementFolder || "";
  // A folder picked by the user that doesn't carry an engagement.json or
  // sessions/ subfolder yields name="" + process_count=0 + sessions=0.
  // That's the "wrong folder" case — surface it explicitly so the user
  // doesn't sit in front of "(unnamed) · 0 · — · 0" wondering what to do.
  const looksUnconfigured = !eng.name
                          && (summary.session_count || 0) === 0
                          && (backlog.process_count || 0) === 0;

  const wrap = _h("div", { class: "engagement-overview" });

  // --- Title (with persistent "Switch engagement" action) ---
  wrap.appendChild(_h("div", { class: "engagement-title-row" },
    _h("div", { class: "engagement-title" },
      _h("h2", null, eng.name || "(unnamed engagement)"),
      eng.client ? _h("span", { class: "engagement-client" }, eng.client) : null,
    ),
    _h("div", { class: "engagement-export-bar" },
      _h("button", { class: "engagement-switch-btn",
        title: "Pick a different engagement folder",
        onClick: () => { if (window._openEngagementFolder) window._openEngagementFolder(); } },
        "Switch engagement..."),
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

  // Path crumb so the user always knows WHICH folder is loaded — critical
  // when they suspect they opened the wrong one.
  if (engFolder) {
    wrap.appendChild(_h("div", { class: "engagement-folder-crumb",
      title: engFolder,
      "aria-label": "Engagement loaded from " + engFolder,
    }, "Folder: " + engFolder));
  }

  // Loud "this folder is empty / wrong shape" banner instead of letting
  // the empty headline numbers + empty backlog speak in silence.
  if (looksUnconfigured) {
    const banner = _h("div", { class: "engagement-misconfig-banner" },
      _h("strong", null, "This folder doesn't look like an engagement."),
      _h("p", null,
        "We expected engagement.json + a sessions/ subfolder with one " +
        "directory per captured session. Pick a different folder, or " +
        "try sessions/demo-pack/ to see what a real engagement looks like."),
      _h("button", { class: "primary",
        onClick: () => { if (window._openEngagementFolder) window._openEngagementFolder(); } },
        "Pick a different folder..."),
    );
    wrap.appendChild(banner);
    return wrap;
  }

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
                     title: "Hidden by the confidence floor — open in Workshop to review.",
                     "aria-label": backlog.suppressed_low_confidence + " candidates below the confidence floor, hidden from this backlog; open Workshop to review them." },
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
  const cases = row.case_count || 0;
  const sessions = row.session_count || 0;
  // a11y: rendered as a <button>, not a clickable <div>, so it's keyboard-
  // reachable and screen-reader-announced. CSS resets in cockpit.css turn
  // off the default button chrome (text-align, font, color inherit;
  // appearance: none; width: 100%).
  const card = _h("button", {
    type: "button",
    class: "engagement-card" + (row.below_confidence_floor ? " engagement-card-low" : ""),
    onClick: () => _drillInto(row),
    "aria-label": "Open process details: " + (row.label || "(unnamed)"),
  });
  card.appendChild(_h("div", { class: "engagement-card-rank" }, "#" + (row.rank || "—")));

  // Title row.
  const titleRow = _h("div", { class: "engagement-card-title-row" },
    _h("div", { class: "engagement-card-title" }, row.label || "(unnamed)"),
  );
  if (row.ai_named) {
    titleRow.appendChild(_h("span", {
      class: "engagement-card-ai",
      title: "Activity name from the local AI Naming Layer",
      "aria-label": "Activity named by AI",
      role: "img",
    }, "AI"));
  }
  card.appendChild(titleRow);

  // Meta line — apps + observed-in count. Promotes the cases/sessions
  // info from a stat box into one human-readable line so the card can
  // breathe with only AVG + CONFIDENCE in the stats grid.
  const metaBits = [];
  if (apps.length > 0) metaBits.push(apps.join(" · "));
  metaBits.push(cases + " case" + (cases === 1 ? "" : "s") + " in " +
                sessions + " session" + (sessions === 1 ? "" : "s"));
  card.appendChild(_h("div", { class: "engagement-card-meta" }, metaBits.join(" • ")));

  // Stats — just two: avg duration + confidence. Two stat boxes fit at
  // a card width that still leaves room for value > label.
  const stats = _h("div", { class: "engagement-card-stats engagement-card-stats-2" });
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    _h("span", { class: "stat-val" }, _fmtDuration(row.mean_elapsed_ms || 0)),
    _h("span", { class: "stat-lbl" }, "avg duration"),
  ));
  stats.appendChild(_h("div", { class: "engagement-card-stat" },
    // UX-density pass: same .confidence-pill chip used in Cockpit /
    // Workshop, instead of plain text or a plain coloured number.
    _h("span", { class: "stat-val" },
      _h("span", { class: "confidence-pill conf-" + confCls + " cockpit-conf-" + confCls,
                   // a11y: WCAG 1.4.1 — the colour+shape carry meaning; the
                   // aria-label gives a screen reader the level in words.
                   "aria-label": "confidence " + conf + "%, " + confCls,
                   role: "img" }, conf + "%")),
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
  const sessionSummaries = _currentEngagement.sessionSummaries || [];
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
  // UX-density pass: render the confidence headline as the shared .confidence-pill,
  // matching the chip used on the backlog card and in Cockpit / Workshop.
  const confCardCls = _confidenceClass(row.confidence);
  const confCard = _h("div", { class: "engagement-stat-card accent", title: "Process confidence" },
    _h("div", { class: "engagement-stat-val" },
      _h("span", { class: "confidence-pill conf-" + confCardCls + " cockpit-conf-" + confCardCls,
                   // a11y: WCAG 1.4.1 — screen-reader equivalent of the colour+shape pill.
                   "aria-label": "confidence " + conf + "%, " + confCardCls,
                   role: "img" }, conf + "%")),
    _h("div", { class: "engagement-stat-lbl" }, "confidence"),
  );
  headline.appendChild(confCard);
  wrap.appendChild(headline);

  // Aggregate variants once — the preview strip + the Variants section
  // both consume this. The strip uses the most-frequent path (the "modal
  // path"); the Variants section ranks the top 5.
  const aggregated = _aggregateVariantsForRow(row, sessionSummaries);
  const contributingSessions = _sessionsContributingToRow(row, sessionSummaries);

  // --- Process map preview (modal path) ---
  // A small step-strip showing the most frequently observed sequence for
  // this process; replaces the "BPMN snapshot" plan because the row's
  // segment is essentially a single sequence — the strip captures it
  // directly without re-spawning bpmn-js for a thumbnail.
  const previewSec = _h("section", { class: "engagement-detail-section engagement-preview" });
  previewSec.appendChild(_h("h3", null, "Process map preview"));
  const modalPath = (aggregated[0] && aggregated[0].path) || (row.activity_labels || []);
  if (modalPath && modalPath.length > 0) {
    const strip = _h("div", { class: "engagement-path-strip", role: "img",
      "aria-label": "Modal step sequence: " + modalPath.join(" then ") });
    modalPath.forEach((stepLabel, i) => {
      if (i > 0) strip.appendChild(_h("span", { class: "engagement-path-arrow", "aria-hidden": "true" }, "→"));
      strip.appendChild(_h("span", { class: "engagement-path-node",
        title: stepLabel }, _shortStepLabel(stepLabel)));
    });
    previewSec.appendChild(strip);
    previewSec.appendChild(_h("p", { class: "engagement-detail-hint engagement-preview-cap" },
      "Modal sequence observed across " + (row.case_count || 0) + " case" +
      ((row.case_count === 1) ? "" : "s") + ". Variants below."));
  } else {
    previewSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Sequence cues unavailable — the contributing candidates didn't carry a step-label list."));
  }
  wrap.appendChild(previewSec);

  // --- Variants block ---
  const variantsSec = _h("section", { class: "engagement-detail-section" });
  variantsSec.appendChild(_h("h3", null, "Variants"));
  if (!row.variant_data_sufficient) {
    variantsSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Variant analysis is suppressed because fewer than 3 cases were observed. " +
      "Capture more sessions of this process to unlock the variant breakdown."));
  } else if (aggregated.length === 0) {
    variantsSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "No step-variant data is available in the contributing sessions' stats.json. " +
      "Re-run normalize for at least one contributing session to populate it."));
  } else {
    variantsSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Top step-sequence variants observed across the contributing sessions, " +
      "ranked by frequency. The path matches the modal cell of the activity map."));
    const list = _h("ol", { class: "engagement-variant-list" });
    const totalFreq = aggregated.reduce((acc, v) => acc + v.frequency, 0);
    const top = aggregated.slice(0, 5);
    top.forEach((v, i) => {
      const sessionCount = v.sessions.size;
      const pct = totalFreq > 0 ? Math.round((v.frequency / totalFreq) * 100) : 0;
      const li = _h("li", { class: "engagement-variant-row" + (i === 0 ? " modal" : "") });
      const pathRow = _h("div", { class: "engagement-variant-path" });
      v.path.forEach((stepLabel, idx) => {
        if (idx > 0) pathRow.appendChild(_h("span", { class: "engagement-variant-arrow",
          "aria-hidden": "true" }, "→"));
        pathRow.appendChild(_h("span", { class: "engagement-variant-step",
          title: stepLabel }, _shortStepLabel(stepLabel)));
      });
      const meta = _h("div", { class: "engagement-variant-meta" },
        _h("span", { class: "engagement-variant-count",
          title: "Observed " + v.frequency + " time(s) across " + sessionCount + " session(s)" },
          "×" + v.frequency + " " + (v.frequency === 1 ? "case" : "cases")),
        _h("span", { class: "engagement-variant-sep" }, "·"),
        _h("span", { class: "engagement-variant-sessions" },
          sessionCount + " session" + (sessionCount === 1 ? "" : "s")),
        _h("span", { class: "engagement-variant-sep" }, "·"),
        _h("span", { class: "engagement-variant-pct" }, pct + "%"),
      );
      li.appendChild(pathRow);
      li.appendChild(meta);
      list.appendChild(li);
    });
    variantsSec.appendChild(list);
    if (aggregated.length > top.length) {
      variantsSec.appendChild(_h("p", { class: "engagement-detail-hint engagement-variant-more" },
        "+ " + (aggregated.length - top.length) + " more variant(s) below the top 5; " +
        "open a contributing session in Workshop → Steps for the full breakdown."));
    }
  }
  wrap.appendChild(variantsSec);

  // --- Evidence block ---
  const evidenceSec = _h("section", { class: "engagement-detail-section" });
  evidenceSec.appendChild(_h("h3", null, "Evidence"));
  if (contributingSessions.length === 0) {
    evidenceSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Signature " + (row.signature || "—").slice(0, 12) +
      " — observed in " + (row.session_count || 0) + " session(s), " +
      (row.case_count || 0) + " case(s). " +
      "Individual session attribution is unavailable for this row " +
      "(the signature-to-session map was empty in the engagement payload)."));
  } else {
    evidenceSec.appendChild(_h("p", { class: "engagement-detail-hint" },
      "Signature " + (row.signature || "—").slice(0, 12) + " · " +
      contributingSessions.length + " contributing session" +
      (contributingSessions.length === 1 ? "" : "s") +
      ". Each row opens the session in Workshop."));
    const table = _h("div", { class: "engagement-evidence-table", role: "table" });
    const head = _h("div", { class: "engagement-evidence-head", role: "row" },
      _h("div", { class: "engagement-evidence-cell ec-session", role: "columnheader" }, "Session"),
      _h("div", { class: "engagement-evidence-cell ec-worker", role: "columnheader" }, "Worker"),
      _h("div", { class: "engagement-evidence-cell ec-cases", role: "columnheader" }, "Cases here"),
      _h("div", { class: "engagement-evidence-cell ec-date", role: "columnheader" }, "Captured"),
      _h("div", { class: "engagement-evidence-cell ec-open", role: "columnheader" }, ""),
    );
    table.appendChild(head);
    // Sort by capture date desc so the most recent evidence reads first.
    contributingSessions
      .slice()
      .sort((a, b) => String(b.summary.started_at || "").localeCompare(String(a.summary.started_at || "")))
      .forEach(c => {
        const ss = c.summary;
        const folder = ss.session_folder || "";
        const open = (e) => {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          if (typeof window !== "undefined" && typeof window._engagementOpenSession === "function") {
            window._engagementOpenSession(folder);
          }
        };
        const row = _h("div", { class: "engagement-evidence-row", role: "row",
          onClick: open },
          _h("div", { class: "engagement-evidence-cell ec-session", role: "cell",
            title: folder }, ss.session_id || "—"),
          _h("div", { class: "engagement-evidence-cell ec-worker", role: "cell" },
            ss.worker_id || "unknown"),
          _h("div", { class: "engagement-evidence-cell ec-cases", role: "cell" },
            String(c.contributingCaseIds.length)),
          _h("div", { class: "engagement-evidence-cell ec-date", role: "cell" },
            _fmtDate(ss.started_at)),
          _h("div", { class: "engagement-evidence-cell ec-open", role: "cell" },
            _h("button", { class: "engagement-evidence-open",
              onClick: open,
              title: "Open this session in Workshop" }, "Open in Workshop →")),
        );
        table.appendChild(row);
      });
    evidenceSec.appendChild(table);
  }
  wrap.appendChild(evidenceSec);

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

  return wrap;
}

module.exports = { render, loadEngagement, getCurrent };
