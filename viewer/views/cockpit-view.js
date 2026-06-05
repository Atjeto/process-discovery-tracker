/*
 * PDT 1.0 Cockpit view — summary-first session review.
 *
 * See docs/PDT-1.0-SPEC.md §4.2 and §0 (TL;DR). The Cockpit is the new
 * default surface the consultant lands on when opening a session — a
 * single-column read-like-a-memo summary that surfaces the AI-detected
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
      text: anchorCandidates.length + " possible case anchor" +
        (anchorCandidates.length > 1 ? "s" : "") +
        " found — review to split this session into cases.",
      confidence: typeof top.score === "number" ? top.score : 0,
    });
  }

  const markerSuggestions = Array.isArray(ann.marker_suggestions) ? ann.marker_suggestions : [];
  if (markerSuggestions.length > 0) {
    const top = markerSuggestions[0] || {};
    stood_out.push({
      kind: "marker_suggestion",
      text: markerSuggestions.length + " possible case boundar" +
        (markerSuggestions.length > 1 ? "ies" : "y") + " detected.",
      confidence: typeof top.score === "number" ? top.score : 0,
    });
  }

  const wasteSteps = Array.isArray(ann.steps)
    ? ann.steps.filter(s => s && s.flags && s.flags.waste)
    : [];
  if (wasteSteps.length > 0) {
    stood_out.push({
      kind: "waste",
      text: wasteSteps.length + " step" + (wasteSteps.length > 1 ? "s" : "") +
        " flagged as waste.",
      confidence: 1.0,
    });
  }

  // Idle time signal (from stats if present).
  const idle_ms = stats.total_idle_ms || stats.idle_ms || 0;
  if (idle_ms > 60_000) {
    stood_out.push({
      kind: "idle_gap",
      text: _fmtDuration(idle_ms) + " total idle / wait time.",
      confidence: 1.0,
    });
  }

  // App switches signal — only when notably high.
  if (app_switches >= 30) {
    stood_out.push({
      kind: "app_switching",
      text: _fmtCount(app_switches) + " app switches — possible context-switching cost.",
      confidence: 1.0,
    });
  }

  return {
    headline: { duration_ms, app_switches, interactions },
    candidates,
    suppressed_low_confidence,
    stood_out,
    roi: roi_view,
  };
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
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

// Spread the helpContext attrs onto an existing element shorthand.
function _withHelp(attrs, key) {
  const h = _helpAttr(key);
  return h ? Object.assign({}, attrs, h) : attrs;
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
  host.appendChild(headline);

  // ---- Process candidates section ----
  const candSec = _h("section", { class: "cockpit-section" });
  const candHeader = _h("div", { class: "cockpit-section-header" },
    _h("h3", { class: "cockpit-h3" }, "Process candidates"),
    data.suppressed_low_confidence > 0
      ? _h("span", _withHelp({ class: "cockpit-suppressed" }, "cockpit-suppressed"),
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
        }, "cockpit-candidate-ai-badge"), "AI"));
      }
      if (c.semantic_merged && (c.merged_variants || []).length > 1) {
        nameEl.appendChild(_h("span", {
          class: "cockpit-candidate-merged",
          title: "Semantic-merged from " + c.merged_variants.length +
                 " label variants: " + c.merged_variants.join(" · "),
        }, "↔ " + c.merged_variants.length));
      }
      const item = _h("li", _withHelp({ class: "cockpit-candidate", "data-segment": c.id }, "cockpit-candidate-row"),
        _h("div", { class: "cockpit-candidate-main" },
          nameEl,
          _h("div", { class: "cockpit-candidate-meta" },
            _h("span", { class: "cockpit-candidate-count" },
              c.instance_count + "× · " + _fmtDuration(c.mean_elapsed_ms) + " avg"),
            _h("span", _withHelp({ class: "cockpit-candidate-conf cockpit-conf-" + confCls,
                          title: "Confidence " + conf + "%. " +
                                 "Click to verify in Workshop → Analysis." }, "cockpit-candidate-confidence"),
              conf + "%"),
          ),
        ),
        _h("button", {
          class: "cockpit-candidate-drill",
          title: "Verify this candidate in Workshop → Analysis",
          onClick: () => _drillIntoCandidate(c.id),
        }, "Verify →"),
      );
      list.appendChild(item);
    });
    candSec.appendChild(list);
  }
  host.appendChild(candSec);

  // ---- What stood out ----
  const stoodOutSec = _h("section", { class: "cockpit-section" });
  stoodOutSec.appendChild(_h("h3", { class: "cockpit-h3" }, "What stood out"));
  if (data.stood_out.length === 0) {
    stoodOutSec.appendChild(_h("div", { class: "cockpit-empty-section" },
      "Nothing flagged. Try running anchor detection or adding case markers."));
  } else {
    const list = _h("ul", { class: "cockpit-stood-out-list" });
    data.stood_out.forEach(s => {
      list.appendChild(_h("li", _withHelp({ class: "cockpit-stood-out" }, "cockpit-stood-out-item"),
        _h("span", { class: "cockpit-stood-out-bullet" }, "▌"),
        _h("span", { class: "cockpit-stood-out-text" }, s.text),
      ));
    });
    stoodOutSec.appendChild(list);
  }
  host.appendChild(stoodOutSec);

  // ---- Footer hint ----
  host.appendChild(_h("div", { class: "cockpit-footer" },
    _h("span", { class: "cockpit-footer-hint" },
      "Need depth? Switch to Workshop in the top bar for the full analyst surface."),
  ));
}

/* -------- Drill-through to Workshop -------------------------------- */

// Park the selected segment id and switch the user to Workshop / Analysis,
// where the existing analysis view can scroll to and highlight it.
function _drillIntoCandidate(segmentId) {
  // Defer to the renderer's exposed drill hook (wired in renderer.js).
  if (typeof window !== "undefined" && typeof window._cockpitDrill === "function") {
    window._cockpitDrill(segmentId);
  }
}

module.exports = { render, derive, CONFIDENCE_FLOOR, HELP_CONTEXT };
