/*
 * PDT 1.0 Cockpit view — summary-first session review.
 *
 * See docs/PDT-1.0-SPEC.md §4.2 and §0 (TL;DR). The Cockpit is the new
 * default surface the consultant lands on when opening a session — a
 * two-column read-like-a-memo summary that surfaces the AI-detected
 * process candidates and "what stood out" items at a glance, with one
 * click into the existing Workshop depth (Flow / Steps / Phases / Map /
 * Analysis) when verification is needed.
 *
 * Phase 0 derivation (this file): runs on existing pipeline output
 * (stats, analysis, annotations) — no AI dependency. Future phases add
 * the Pattern Layer outputs (patterns.json) and Naming Layer outputs.
 *
 * Integrity: every visible number traces to a measurement; nothing in
 * here invents a value. Candidates below the confidence floor are
 * filtered out (ADR-0016 honesty pass).
 */

"use strict";

const State = require("../state.js");
const { escapeHtml } = require("../dom.js");

/*
 * PDT-1.0-SPEC §6.5 — helpContext slots. Each AI-rendered artefact carries
 * a `data-help-context` attribute keyed against this registry; future
 * Operate-mode (client-retained tool) builds will populate the
 * consultant's inline guidance against the same keys. The slots are
 * always wired; the content is loaded lazily from
 * help_context/<key>.md when present, else a built-in default is shown.
 */
const HELP_CONTEXT = {
  "cockpit-headline-duration":
    "Total wall-clock time captured. Includes all idle time the worker was at their desk.",
  "cockpit-headline-app-switches":
    "Every time the foreground app changed. High counts often indicate manual data-movement opportunities.",
  "cockpit-headline-interactions":
    "Each UIA event from the C# recorder — clicks, value changes, selections. The raw signal feeding everything else.",
  "cockpit-headline-savings":
    "Conservative–expected band from the €-ROI layer. Numbers are measured (mean duration × annual volume × labour rate × realism factor) — never produced by the LLM.",
  "cockpit-candidate-row":
    "AI-named activity cluster. Click 'Verify →' to drop into Workshop → Analysis with this segment highlighted.",
  "cockpit-candidate-confidence":
    "Pattern Layer confidence: coverage × tuple-completeness × capture-confidence cap. Below the 50% floor are hidden — open Workshop → Analysis to review.",
  "cockpit-candidate-ai-badge":
    "Named by the local Naming Layer (ADR-0028). Hover the badge to see which cues the LLM used.",
  "cockpit-stood-out-item":
    "Surfaced by an existing heuristic detector (anchors, marker suggestions, idle-gap detector). Not AI-generated.",
  "cockpit-suppressed":
    "Candidates whose pattern-layer confidence is below the engagement's configured floor (default 50%). Not included in deliverables; reviewable in Workshop.",
  "cockpit-rail-map":
    "Simplified preview of the directly-follows graph mined from this session. Open Workshop → Map for the interactive view.",
  "cockpit-rail-apps":
    "Foreground time per application, measured from the activity stream. The top-3 frame what kind of work this session captures.",
  "cockpit-rail-cases":
    "Cases detected in this session — one per anchor stamp. Open Workshop → Phases for the case-by-case breakdown.",
  "cockpit-rail-engagement":
    "This session is part of an engagement. Switch to the Engagement tab to see the aggregated backlog.",
};

function _helpAttr(key) {
  return HELP_CONTEXT[key] ? { "data-help-context": key, title: HELP_CONTEXT[key] } : null;
}

/* -------- Display formatting --------------------------------------- */

function _fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + (sec ? sec + "s" : "");
  return sec + "s";
}

function _fmtCount(n) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString();
}

function _fmtMoney(amount, currency) {
  if (amount == null || !isFinite(amount)) return null;
  const cur = currency || "EUR";
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : (cur + " ");
  const abs = Math.abs(amount);
  if (abs >= 1000) return sym + Math.round(amount / 1000) + "k";
  return sym + Math.round(amount);
}

function _confidenceClass(c) {
  if (c == null || !isFinite(c)) return "low";
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
}

function _fmtPct(n) {
  if (n == null || !isFinite(n)) return "0%";
  return Math.round(n) + "%";
}

/* -------- Confidence floor (ADR-0016 €-ROI honesty) ---------------- */

// Candidates below this confidence are excluded from the visible band
// and from the process-candidates list. The honesty pass: low-confidence
// numbers do not appear in deliverables.
const CONFIDENCE_FLOOR = 0.5;

/* -------- Data derivation ------------------------------------------ */

/**
 * Derive the cockpit data structure from a loaded session object.
 * Pure function — no DOM, no state mutation. Returns null when no
 * session is loaded.
 */
function derive(session) {
  if (!session) return null;

  const stats = session.stats || {};
  const analysis = session.analysis || {};
  const events = Array.isArray(session.events) ? session.events : [];
  const ann = session.annotations || {};
  const manifest = session.manifest || {};
  const dfg = session.dfg || null;

  // ---- Headline numbers ----
  // Duration: prefer pipeline-computed stat, else derive from event timestamps.
  let duration_ms = stats.session_duration_ms || stats.duration_ms || null;
  if (!duration_ms && events.length >= 2) {
    const first = new Date(events[0].timestamp).getTime();
    const last = new Date(events[events.length - 1].timestamp).getTime();
    if (isFinite(first) && isFinite(last) && last > first) duration_ms = last - first;
  }

  // App switches: count transitions in the activity stream.
  const activities = events.filter(e => e && e.type === "activity");
  let app_switches = 0;
  let last_app = null;
  for (const a of activities) {
    const app = a.data && a.data.app;
    if (app && last_app && app !== last_app) app_switches++;
    if (app) last_app = app;
  }

  // Interactions: total UIA events captured.
  const interactions = events.filter(e => e && e.type === "interaction").length;

  // ---- Process candidates (filtered by confidence floor) ----
  // PDT-1.0-SPEC §3.2: Pattern-Layer activity clusters with LLM names take
  // priority when present (patterns.json named_clusters[]). Fall back to the
  // existing automation_candidates path when no Pattern-Layer output exists.
  const patterns = session.patterns || {};
  const clusters = Array.isArray(patterns.activity_clusters)
    ? patterns.activity_clusters : [];
  const nameMap = new Map();
  if (Array.isArray(patterns.named_clusters)) {
    for (const n of patterns.named_clusters) {
      if (n && n.cluster_id) nameMap.set(n.cluster_id, n);
    }
  }

  let allCandidates;
  if (clusters.length > 0) {
    // Pattern-Layer path — preferred.
    allCandidates = clusters.map(c => {
      const named = nameMap.get(c.cluster_id);
      const llmName = named && !named.insufficient_signal ? named.name : null;
      const sem = c.semantic_merge || null;
      return {
        id: c.cluster_id || "",
        label: llmName || c.process_label || "(unnamed cluster)",
        confidence: typeof c.confidence === "number" ? c.confidence : 0,
        instance_count: c.occurrence_count || 0,
        mean_elapsed_ms: c.mean_duration_ms || 0,
        apps: c.app ? [c.app] : [],
        llm_named: !!llmName,
        llm_provenance: named ? (named.provenance || []) : [],
        source: llmName ? "pattern_layer_llm" : "pattern_layer",
        semantic_merged: !!sem,
        merged_variants: sem ? (sem.merged_label_variants || []) : [],
      };
    });
  } else {
    // Fallback: existing automation_candidates from analysis.json.
    const rawCandidates = Array.isArray(analysis.automation_candidates)
      ? analysis.automation_candidates : [];
    allCandidates = rawCandidates.map(c => ({
      id: c.segment_signature || "",
      label: c.label || "(unnamed)",
      confidence: (c.scores && typeof c.scores.confidence === "number") ? c.scores.confidence : 0,
      instance_count: c.instance_count || 0,
      mean_elapsed_ms: c.mean_elapsed_ms || 0,
      apps: Array.isArray(c.apps) ? c.apps : (c.app ? [c.app] : []),
      llm_named: false,
      llm_provenance: [],
      source: "automation_candidates",
    }));
  }
  // Apply confidence floor — the honesty pass.
  const candidates = allCandidates
    .filter(c => c.confidence >= CONFIDENCE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence);
  const suppressed_low_confidence = allCandidates.length - candidates.length;

  // ---- ROI band (only for candidates above the confidence floor) ----
  const roi = analysis.roi || {};
  const totals = roi.totals || {};
  const roi_view = {
    currency: roi.currency || "EUR",
    needs_input: !!roi.needs_input,
    saved_hours_per_year: totals.saved_hours_per_year || 0,
    net_annual: totals.net_annual || 0,
    gross_annual: totals.gross_annual || 0,
  };

  // ---- "What stood out" — surfaced from existing heuristic detectors ----
  const stood_out = [];

  const anchorCandidates = Array.isArray(ann.anchor_candidates) ? ann.anchor_candidates : [];
  if (anchorCandidates.length > 0) {
    const top = anchorCandidates[0] || {};
    stood_out.push({
      kind: "anchor_candidate",
      headline: anchorCandidates.length + " possible case anchor" +
        (anchorCandidates.length > 1 ? "s" : ""),
      hint: "Anchors split this recording into separate cases. Review them before metrics roll up correctly.",
      action: { label: "Review anchors", level: "phases" },
      confidence: typeof top.score === "number" ? top.score : 0,
    });
  }

  const markerSuggestions = Array.isArray(ann.marker_suggestions) ? ann.marker_suggestions : [];
  if (markerSuggestions.length > 0) {
    const top = markerSuggestions[0] || {};
    stood_out.push({
      kind: "marker_suggestion",
      headline: markerSuggestions.length + " possible case boundar" +
        (markerSuggestions.length > 1 ? "ies" : "y") + " detected",
      hint: "The detector found points that look like case starts. Confirm them so step timings line up.",
      action: { label: "Confirm markers", level: "phases" },
      confidence: typeof top.score === "number" ? top.score : 0,
    });
  }

  const wasteSteps = Array.isArray(ann.steps)
    ? ann.steps.filter(s => s && s.flags && s.flags.waste)
    : [];
  if (wasteSteps.length > 0) {
    stood_out.push({
      kind: "waste",
      headline: wasteSteps.length + " step" + (wasteSteps.length > 1 ? "s" : "") +
        " flagged as waste",
      hint: "These steps add no value to the customer outcome. Likely first candidates for automation or removal.",
      action: { label: "Inspect waste", level: "analysis" },
      confidence: 1.0,
    });
  }

  // Idle time signal (from stats if present).
  const idle_ms = stats.total_idle_ms || stats.idle_ms || 0;
  if (idle_ms > 60_000) {
    stood_out.push({
      kind: "idle_gap",
      headline: _fmtDuration(idle_ms) + " idle / wait time",
      hint: "Long pauses inside a case usually mean waiting on an external system or a person.",
      action: null,
      confidence: 1.0,
    });
  }

  // App switches signal — only when notably high.
  if (app_switches >= 30) {
    stood_out.push({
      kind: "app_switching",
      headline: _fmtCount(app_switches) + " app switches",
      hint: "High context-switching often signals manual copy-paste between systems — a common automation target.",
      action: { label: "Look at flow", level: "flow" },
      confidence: 1.0,
    });
  }

  // ---- Right-rail: top apps by foreground time ----
  // Stats.activity_stats labels look like "Text entry -- chrome.exe". Bucket
  // those by the trailing app token to get per-app totals.
  const appBuckets = new Map();
  const activityStats = Array.isArray(stats.activity_stats) ? stats.activity_stats : [];
  for (const a of activityStats) {
    const lbl = String(a.activity_label || "");
    // "Activity -- app.exe" — split on " -- " or " — " and take the trailer.
    const parts = lbl.split(/ -- | — /);
    const app = parts.length > 1 ? parts[parts.length - 1] : lbl;
    if (!app) continue;
    const dur = a.total_duration_ms || 0;
    appBuckets.set(app, (appBuckets.get(app) || 0) + dur);
  }
  const totalAppMs = Array.from(appBuckets.values()).reduce((s, v) => s + v, 0);
  const appList = Array.from(appBuckets.entries())
    .map(([app, ms]) => ({ app, ms, pct: totalAppMs > 0 ? (ms / totalAppMs * 100) : 0 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  // ---- Right-rail: case + step breakdown ----
  const caseStats = Array.isArray(stats.case_stats) ? stats.case_stats : [];
  const caseCount = caseStats.length;
  const stepCount = (stats.meta && stats.meta.step_count) ||
                    (Array.isArray(ann.steps) ? ann.steps.length : 0);
  // Mean wall-clock per case — straight average from case_stats.
  let meanCaseMs = 0;
  if (caseStats.length > 0) {
    const sum = caseStats.reduce((s, c) => s + (c.wall_clock_ms || 0), 0);
    meanCaseMs = Math.round(sum / caseStats.length);
  }

  // ---- Right-rail: DFG preview ----
  // We don't render the full bpmn here — just a tiny chain of node labels
  // that the user can scan. The Map view holds the real diagram.
  const dfgNodes = _buildDfgChain(dfg);

  // ---- Right-rail: engagement context ----
  const engagement = manifest.engagement_id ? {
    id: manifest.engagement_id,
    name: _humanizeEngagementId(manifest.engagement_id),
  } : null;

  return {
    headline: { duration_ms, app_switches, interactions },
    candidates,
    suppressed_low_confidence,
    stood_out,
    roi: roi_view,
    rail: {
      dfg: dfgNodes,
      apps: appList,
      cases: { count: caseCount, mean_ms: meanCaseMs, total: caseStats },
      steps: { count: stepCount },
      engagement,
    },
  };
}

/**
 * Build a small linear chain through the DFG for the rail preview.
 * Picks one start activity, walks the highest-frequency outgoing edge
 * each hop until it hits an end activity or runs out. The full graph
 * lives in Workshop → Map; this is just an at-a-glance shape.
 */
function _buildDfgChain(dfg) {
  if (!dfg || !Array.isArray(dfg.edges) || dfg.edges.length === 0) return [];
  const starts = dfg.start_activities || {};
  const ends = dfg.end_activities || {};
  // Pick the most-frequent start.
  let cur = null;
  let bestStart = 0;
  for (const [k, v] of Object.entries(starts)) {
    if (v > bestStart) { bestStart = v; cur = k; }
  }
  if (!cur && dfg.edges.length > 0) cur = dfg.edges[0].source;
  const visited = new Set();
  const chain = [];
  while (cur && !visited.has(cur) && chain.length < 6) {
    visited.add(cur);
    chain.push({ label: _shortenAppLabel(cur), is_end: !!ends[cur] });
    if (ends[cur]) break;
    // Find the highest-frequency outgoing edge from cur.
    let next = null;
    let bestFreq = 0;
    for (const e of dfg.edges) {
      if (e.source !== cur) continue;
      if ((e.frequency || 0) > bestFreq) { bestFreq = e.frequency; next = e.target; }
    }
    cur = next;
  }
  return chain;
}

// "Text entry -- chrome.exe" -> "chrome.exe" -> "chrome"
// "Save record -- ServiceNow" -> "ServiceNow"
function _shortenAppLabel(label) {
  if (!label) return "";
  const parts = String(label).split(/ -- | — /);
  let tail = parts[parts.length - 1] || parts[0];
  // Strip .exe / .EXE.
  tail = tail.replace(/\.(exe|EXE)$/, "");
  if (tail.length > 24) tail = tail.slice(0, 21) + "…";
  return tail;
}

function _humanizeEngagementId(id) {
  if (!id) return "";
  // "demo-pack-servicenow-it-service" -> "Demo Pack — ServiceNow It Service"
  return String(id)
    .split("-")
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : "")
    .join(" ");
}

/* -------- DOM helpers ---------------------------------------------- */

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

// Spread the helpContext attrs onto an existing element shorthand.
function _withHelp(attrs, key) {
  const h = _helpAttr(key);
  return h ? Object.assign({}, attrs, h) : attrs;
}

/* -------- Stood-out finding rendering ------------------------------ */

// One small inline SVG glyph per finding kind. Keeps the visual
// distinct from the bullet-soup the original "▌" rendering looked
// like, without pulling in an icon font.
const _STOOD_OUT_ICONS = {
  anchor_candidate:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 18a7 7 0 0 0 14 0"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  marker_suggestion:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h11l-2 4 2 4H6"/></svg>',
  waste:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10z"/></svg>',
  idle_gap:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  app_switching:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
};

function _stoodOutIcon(kind) {
  const svg = _STOOD_OUT_ICONS[kind] || _STOOD_OUT_ICONS.waste;
  const wrap = document.createElement("span");
  wrap.className = "cockpit-stood-out-icon cockpit-stood-out-icon-" + kind;
  wrap.innerHTML = svg;
  return wrap;
}

/* -------- Render ---------------------------------------------------- */

function render() {
  const host = document.getElementById("session-layout-cockpit");
  if (!host) return;

  const session = State.getSession();
  const data = derive(session);

  host.innerHTML = "";

  if (!data) {
    host.appendChild(_h("div", { class: "cockpit-empty" },
      _h("div", { class: "cockpit-empty-title" }, "Open a session to see the Cockpit"),
      _h("div", { class: "cockpit-empty-hint" },
        "The Cockpit shows the headline numbers, AI-detected process candidates, " +
        "and what stood out — at a glance. Drop into Workshop in the top bar when you " +
        "need depth."),
    ));
    return;
  }

  // The cockpit now lays out in two columns:
  //   - .cockpit-main: headline + candidates + stood-out
  //   - .cockpit-rail: map preview + apps + cases + engagement
  // Either column can scroll independently if content runs long.
  const main = _h("section", { class: "cockpit-main" });
  const rail = _h("aside", { class: "cockpit-rail" });

  // ---- Headline strip ----
  const headline = _h("section", { class: "cockpit-headline" });
  headline.appendChild(_h("div", _withHelp({ class: "cockpit-headline-item" }, "cockpit-headline-duration"),
    _h("div", { class: "cockpit-headline-val" }, _fmtDuration(data.headline.duration_ms)),
    _h("div", { class: "cockpit-headline-lbl" }, "captured"),
  ));
  headline.appendChild(_h("div", _withHelp({ class: "cockpit-headline-item" }, "cockpit-headline-app-switches"),
    _h("div", { class: "cockpit-headline-val" }, _fmtCount(data.headline.app_switches)),
    _h("div", { class: "cockpit-headline-lbl" }, "app switches"),
  ));
  headline.appendChild(_h("div", _withHelp({ class: "cockpit-headline-item" }, "cockpit-headline-interactions"),
    _h("div", { class: "cockpit-headline-val" }, _fmtCount(data.headline.interactions)),
    _h("div", { class: "cockpit-headline-lbl" }, "interactions"),
  ));
  // ROI headline tile — only when there's a real savings band AND inputs are set.
  // No-numbers-from-LLM principle: this number traces to measured candidates.
  if (data.roi.saved_hours_per_year > 0 && !data.roi.needs_input && data.roi.net_annual > 0) {
    const money = _fmtMoney(data.roi.net_annual, data.roi.currency);
    if (money) {
      headline.appendChild(_h("div", _withHelp({ class: "cockpit-headline-item cockpit-savings" }, "cockpit-headline-savings"),
        _h("div", { class: "cockpit-headline-val" }, money),
        _h("div", { class: "cockpit-headline-lbl" }, "potential savings / yr"),
      ));
    }
  } else if (data.roi.saved_hours_per_year > 0) {
    // Time-only band (no labour rate).
    headline.appendChild(_h("div", _withHelp({ class: "cockpit-headline-item cockpit-savings" }, "cockpit-headline-savings"),
      _h("div", { class: "cockpit-headline-val" },
        Math.round(data.roi.saved_hours_per_year) + "h"),
      _h("div", { class: "cockpit-headline-lbl" }, "potential time saved / yr"),
    ));
  }
  main.appendChild(headline);

  // ---- Process candidates section ----
  const candSec = _h("section", { class: "cockpit-section" });
  const candHeader = _h("div", { class: "cockpit-section-header" },
    _h("h3", { class: "cockpit-h3" }, "Process candidates"),
    data.suppressed_low_confidence > 0
      ? _h("span", _withHelp({
          class: "cockpit-suppressed",
          "aria-label": data.suppressed_low_confidence + " candidates below the confidence floor, hidden from this view; open Workshop to review them.",
        }, "cockpit-suppressed"),
          data.suppressed_low_confidence + " low-confidence hidden")
      : null,
  );
  candSec.appendChild(candHeader);

  if (data.candidates.length === 0) {
    candSec.appendChild(_h("div", { class: "cockpit-empty-section" },
      data.suppressed_low_confidence > 0
        ? "No candidates above the confidence floor. Open Workshop → Analysis to review the low-confidence ones."
        : "No process candidates surfaced. Run normalization with --mine to detect process patterns."));
  } else {
    const list = _h("ul", { class: "cockpit-candidate-list" });
    data.candidates.slice(0, 10).forEach(c => {
      const conf = Math.round(c.confidence * 100);
      const confCls = _confidenceClass(c.confidence);
      const nameEl = _h("div", { class: "cockpit-candidate-name" }, c.label);
      // Badge LLM-named clusters so the consultant sees provenance at a glance
      // (ADR-0028 — every AI output carries confidence + provenance).
      if (c.llm_named) {
        nameEl.appendChild(_h("span", _withHelp({
          class: "cockpit-candidate-ai",
          title: "Named by the local AI Naming Layer (ADR-0028) from cues: " +
                 (c.llm_provenance || []).join(", "),
          // a11y: SR reads "Email Sending, named by AI" instead of bare "AI"
          "aria-label": "Named by AI",
          role: "img",
        }, "cockpit-candidate-ai-badge"), "AI"));
      }
      if (c.semantic_merged && (c.merged_variants || []).length > 1) {
        nameEl.appendChild(_h("span", {
          class: "cockpit-candidate-merged",
          title: "Semantic-merged from " + c.merged_variants.length +
                 " label variants: " + c.merged_variants.join(" · "),
          "aria-label": "Merged from " + c.merged_variants.length + " similar labels",
          role: "img",
        }, "↔ " + c.merged_variants.length));
      }
      const item = _h("li", _withHelp({ class: "cockpit-candidate", "data-segment": c.id }, "cockpit-candidate-row"),
        _h("div", { class: "cockpit-candidate-main" },
          nameEl,
          _h("div", { class: "cockpit-candidate-meta" },
            _h("span", { class: "cockpit-candidate-count" },
              c.instance_count + "× · " + _fmtDuration(c.mean_elapsed_ms) + " avg"),
            _h("span", _withHelp({ class: "cockpit-candidate-conf confidence-pill conf-" + confCls + " cockpit-conf-" + confCls,
                          title: "Confidence " + conf + "%. " +
                                 "Click to verify in Workshop → Analysis.",
                          // a11y: WCAG 1.4.1 — colour + glyph carry meaning,
                          // and the screen reader gets the level in words.
                          "aria-label": "confidence " + conf + "%, " + confCls,
                          role: "img" }, "cockpit-candidate-confidence"),
              conf + "%"),
          ),
        ),
        _h("button", {
          class: "cockpit-candidate-drill",
          title: "Drop into Workshop / Analysis with this candidate's segment scrolled into view, so you can confirm it's real before it lands in the backlog.",
          onClick: () => _drillIntoCandidate(c.id, c.label),
        }, "Verify →"),
      );
      list.appendChild(item);
    });
    candSec.appendChild(list);
  }
  main.appendChild(candSec);

  // ---- What stood out (real findings, not bullet stubs) ----
  const stoodOutSec = _h("section", { class: "cockpit-section" });
  stoodOutSec.appendChild(_h("h3", { class: "cockpit-h3" }, "What stood out"));
  if (data.stood_out.length === 0) {
    stoodOutSec.appendChild(_h("div", { class: "cockpit-empty-section" },
      "Nothing flagged. Try running anchor detection or adding case markers."));
  } else {
    const list = _h("ul", { class: "cockpit-stood-out-list" });
    data.stood_out.forEach(s => {
      const findingBody = _h("div", { class: "cockpit-stood-out-body" },
        _h("div", { class: "cockpit-stood-out-headline" }, s.headline),
        s.hint ? _h("div", { class: "cockpit-stood-out-hint" }, s.hint) : null,
      );
      const actionEl = s.action ? _h("button", {
        class: "cockpit-stood-out-action",
        title: "Open Workshop with this finding's surface focused.",
        onClick: () => _drillIntoLevel(s.action.level),
      }, s.action.label + " →") : null;
      list.appendChild(_h("li", _withHelp({
        class: "cockpit-stood-out cockpit-stood-out-" + s.kind,
      }, "cockpit-stood-out-item"),
        _stoodOutIcon(s.kind),
        findingBody,
        actionEl,
      ));
    });
    stoodOutSec.appendChild(list);
  }
  main.appendChild(stoodOutSec);

  // ---- Footer hint ----
  main.appendChild(_h("div", { class: "cockpit-footer" },
    _h("span", { class: "cockpit-footer-hint" },
      "Need depth? Switch to Workshop in the top bar for the full analyst surface."),
  ));

  // ---- Right-rail: at-a-glance context ----
  // Engagement card (only when this session is part of one).
  if (data.rail.engagement) {
    const eng = data.rail.engagement;
    rail.appendChild(_h("section", _withHelp({
      class: "cockpit-rail-card cockpit-rail-engagement",
    }, "cockpit-rail-engagement"),
      _h("div", { class: "cockpit-rail-card-label" }, "Engagement"),
      _h("div", { class: "cockpit-rail-eng-name", title: eng.id }, eng.name),
      _h("button", {
        class: "cockpit-rail-eng-link",
        title: "Switch to the Engagement tab for the aggregated backlog.",
        onClick: () => {
          if (typeof window !== "undefined" && typeof window._cockpitSwitchTab === "function") {
            window._cockpitSwitchTab("engagement");
          }
        },
      }, "Open engagement →"),
    ));
  }

  // Process-map preview card — the linear DFG chain.
  if (data.rail.dfg && data.rail.dfg.length > 0) {
    const chain = _h("ol", { class: "cockpit-rail-dfg" });
    data.rail.dfg.forEach((node, idx) => {
      chain.appendChild(_h("li", {
        class: "cockpit-rail-dfg-node" + (node.is_end ? " cockpit-rail-dfg-end" : "") +
               (idx === 0 ? " cockpit-rail-dfg-start" : ""),
      }, node.label));
      if (idx < data.rail.dfg.length - 1) {
        chain.appendChild(_h("li", { class: "cockpit-rail-dfg-arrow", "aria-hidden": "true" }, "↓"));
      }
    });
    rail.appendChild(_h("section", _withHelp({
      class: "cockpit-rail-card",
    }, "cockpit-rail-map"),
      _h("div", { class: "cockpit-rail-card-label" }, "Process shape"),
      chain,
      _h("button", {
        class: "cockpit-rail-link",
        title: "Open the full interactive process map in Workshop.",
        onClick: () => _drillIntoLevel("map"),
      }, "Open the full map →"),
    ));
  }

  // Cases + steps breakdown.
  if (data.rail.cases.count > 0 || data.rail.steps.count > 0) {
    rail.appendChild(_h("section", _withHelp({
      class: "cockpit-rail-card",
    }, "cockpit-rail-cases"),
      _h("div", { class: "cockpit-rail-card-label" }, "Breakdown"),
      _h("div", { class: "cockpit-rail-breakdown" },
        _h("div", { class: "cockpit-rail-breakdown-row" },
          _h("span", { class: "cockpit-rail-breakdown-val" }, _fmtCount(data.rail.cases.count)),
          _h("span", { class: "cockpit-rail-breakdown-lbl" },
            data.rail.cases.count === 1 ? "case" : "cases"),
        ),
        _h("div", { class: "cockpit-rail-breakdown-row" },
          _h("span", { class: "cockpit-rail-breakdown-val" }, _fmtCount(data.rail.steps.count)),
          _h("span", { class: "cockpit-rail-breakdown-lbl" }, "steps"),
        ),
        data.rail.cases.mean_ms > 0
          ? _h("div", { class: "cockpit-rail-breakdown-row" },
              _h("span", { class: "cockpit-rail-breakdown-val" }, _fmtDuration(data.rail.cases.mean_ms)),
              _h("span", { class: "cockpit-rail-breakdown-lbl" }, "avg / case"),
            )
          : null,
      ),
    ));
  }

  // Top apps by foreground time.
  if (data.rail.apps && data.rail.apps.length > 0) {
    const topApps = data.rail.apps.slice(0, 3);
    const appsList = _h("ul", { class: "cockpit-rail-apps-list" });
    topApps.forEach(a => {
      appsList.appendChild(_h("li", { class: "cockpit-rail-app" },
        _h("div", { class: "cockpit-rail-app-row" },
          _h("span", { class: "cockpit-rail-app-name", title: a.app }, _shortenAppLabel(a.app)),
          _h("span", { class: "cockpit-rail-app-pct" }, _fmtPct(a.pct)),
        ),
        _h("div", { class: "cockpit-rail-app-bar" },
          _h("div", {
            class: "cockpit-rail-app-bar-fill",
            style: "width: " + Math.max(2, Math.min(100, a.pct)) + "%",
          }),
        ),
      ));
    });
    rail.appendChild(_h("section", _withHelp({
      class: "cockpit-rail-card",
    }, "cockpit-rail-apps"),
      _h("div", { class: "cockpit-rail-card-label" }, "Top apps · % time"),
      appsList,
    ));
  }

  host.appendChild(main);
  host.appendChild(rail);
}

/* -------- Drill-through to Workshop -------------------------------- */

// Park the selected segment id + label and switch the user to Workshop /
// Analysis, where the existing analysis view can scroll to and highlight
// it. The label is passed through so the drill banner names the candidate.
function _drillIntoCandidate(segmentId, candidateLabel) {
  if (typeof window !== "undefined" && typeof window._cockpitDrill === "function") {
    window._cockpitDrill(segmentId, candidateLabel);
  }
}

// Switch to Workshop and land on a given level (flow/steps/phases/map/analysis).
function _drillIntoLevel(level) {
  if (typeof window === "undefined") return;
  if (typeof window._cockpitDrillLevel === "function") {
    window._cockpitDrillLevel(level);
    return;
  }
  // Fallback: flip to Workshop mode and click the level button directly.
  const modeBtn = document.querySelector('#session-mode-toggle .mode-btn[data-mode="workshop"]');
  if (modeBtn) modeBtn.click();
  setTimeout(() => {
    const lvlBtn = document.querySelector('.view-mode-btn[data-level="' + level + '"]');
    if (lvlBtn) lvlBtn.click();
  }, 80);
}

module.exports = { render, derive, CONFIDENCE_FLOOR, HELP_CONTEXT };
