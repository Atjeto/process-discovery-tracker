/*
 * overview-view.js -- the Overview level of the Session view (lab-phase
 * spec §A5; the honesty redesign's buyer-first surface).
 *
 * The default level on session load. One column, top to bottom:
 *   1. case-quality badge   -- from analysis.case_quality (2 states).
 *   2. mark-runs line       -- ONLY when no runs are marked (no cases):
 *                              one instruction + a button that opens Flow
 *                              with the Markers panel (openMarkersInFlow,
 *                              shared with the Map lock message).
 *   3. fact strip           -- 6 tiles from analysis.facts (Tier 1).
 *   4. findings feed        -- analysis.findings[]: claim + evidence,
 *                              "Show on timeline" (jumpToStepInFlow /
 *                              seekToTimestamp), "include in PDD"
 *                              checkbox persisted to the additive
 *                              annotations.memo_selection[] (the PDD's
 *                              findings section reads it).
 *   5. evidence modules     -- the retired Analysis modules, rendered by
 *                              analysis-view.renderEvidenceInto.
 *   6. "to say more" box    -- the missing inputs, honestly enumerated.
 *   7. export bar           -- "Export PDD": clicks the Session menu's
 *                              PDD export (#btn-session-pdd), so there is
 *                              one PDD export path.
 *
 * Tier discipline: everything here is measured (Tier 1) or explicitly
 * gated (the badge + the mark-runs line ARE the gate UI). Nothing renders
 * case-based authority while case_quality.tier2_unlocked is false.
 */

"use strict";

const State = require("../state.js");
const { escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const { saveAnnotationsWithUndo } = require("../session.js");
const { findingCardHtml } = require("../finding-cards.js");
const { renderEvidenceInto } = require("./analysis-view.js");
// flow-view-video.js wires DOM controls at require() time; it is required
// lazily in the click handlers so this module (and its pure section
// builders) load under the node:test runner.
function _video() { return require("./flow-view-video.js"); }

function _fmt(ms) { return formatDuration(ms || 0); }
function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

/* ---- Stage failures (contract C12, RP-10) -------------------------------- */

/* A pipeline stage that failed is named in analysis.stage_errors
   ([{ stage, error }]) and its output key is null. The Overview says the
   check could not run; it never renders that as a measured negative (zero
   tiles, "nothing stood out"). */
const STAGE_NOT_RUN = "This check could not run on this recording";
function _stageError(analysis, stage) {
  const list = (analysis && Array.isArray(analysis.stage_errors)) ? analysis.stage_errors : [];
  return list.find((e) => e && e.stage === stage) || null;
}
function _technicalDetail(err) {
  return err && err.error
    ? '<div class="ov-stage-detail">Technical detail: ' + escapeHtml(err.error) + "</div>"
    : "";
}

/* ---- 1. Case-quality badge -------------------------------------------- */

function _badge(cq) {
  let cls, text, title;
  const oneCase = (cq.case_count || 0) === 1;
  if (cq.mode === "markers") {
    cls = "ok";
    // G-3: one case never unlocks comparisons — say so on the badge itself.
    text = oneCase
      ? "✓ 1 case marked, but case comparisons need at least 2"
      : "✓ " + (cq.case_count || 0) + " cases, marked by the worker";
    title = "The worker marked case starts/ends during recording · " +
      _pct(cq.coverage) + " of recorded actions fall inside a case";
  } else {
    cls = "warn";
    text = "⚠ No cases identified yet";
    title = "The recording is not split into cases yet. How long each case " +
      "takes, the paths taken, and case-by-case comparison stay locked until " +
      "each run has a start marker";
  }
  // Item 8: the case-state and the "case analysis on/locked" fact are the
  // SAME fact in two vocabularies — merge them. The tier-2 clause becomes the
  // badge's subtitle rather than a second, duplicating chip. The two badge
  // states (markers / unsegmented) are preserved.
  const subCls = cq.tier2_unlocked ? "ok" : "locked";
  const subText = cq.tier2_unlocked
    ? "Case analysis on"
    : "Case analysis locked";
  const subTitle = cq.tier2_unlocked
    ? "At least 2 cases are identified and cover at least 70% of the recording, so the case-by-case numbers are shown"
    : "The case-by-case numbers are hidden: they need at least 2 cases, from run start markers, covering at least 70% of the recording";
  return '<div class="ov-badge-row">' +
    '<span class="ov-badge ' + cls + '" title="' + escapeAttr(title) + '">' +
    '<span class="ov-badge-text">' + escapeHtml(text) + "</span>" +
    '<span class="ov-badge-sub ' + subCls + '" title="' + escapeAttr(subTitle) + '">' +
    escapeHtml(subText) + "</span>" +
    "</span></div>";
}

/* ---- 2. Mark-runs line -------------------------------------------------- */

/* AD-14: with no run markers there are no cases. One plain instruction and
   one button that opens Flow with the Markers panel showing. The Map level's
   step-diagram lock message (renderer.js) uses the same sentence and the same
   verb, so the two surfaces cannot drift apart. */
const NO_RUNS_MARKED = "This recording has no runs marked.";
const MARK_RUNS_INSTRUCTION = "In Flow, add a start marker at the beginning of " +
  "each run (right-click the timeline at that moment), then click Analyze session.";
const MARK_RUNS_BUTTON = "Mark runs in Flow";

/* Switch to the Flow level and show its Markers panel, scrolled on screen
   (an arrival the analyst asked for). Lazy require: flow-view requires this
   module at load, so a top-level require would be a cycle. */
function openMarkersInFlow() {
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  require("./flow-view.js").activateAnnoTab("markers");
  const panel = document.querySelector('.anno-panel[data-panel="markers"]');
  if (panel) panel.scrollIntoView({ block: "nearest" });
}

function _markRunsLine() {
  return '<div class="ov-mark-runs" id="ov-mark-runs">' +
    '<span class="ov-mark-runs-text">' + escapeHtml(NO_RUNS_MARKED + " " + MARK_RUNS_INSTRUCTION) +
    "</span>" +
    '<button type="button" class="primary" id="btn-ov-mark-runs">' +
    escapeHtml(MARK_RUNS_BUTTON) + "</button></div>";
}

/* ---- 3. Fact strip ------------------------------------------------------ */

const _FACT_LABELS = ["Active time", "Idle time", "Top app", "App switches", "Longest stretch", "Re-typed values"];

/* C12: the facts stage failed (facts is null). Same six tiles, each saying it
   could not be measured, so no tile can be read as a measured zero. */
function _factStripNotRun(err) {
  const tip = STAGE_NOT_RUN + ", so this number could not be measured. It is not zero.";
  return '<div class="ov-facts ov-facts-not-run">' + _FACT_LABELS.map((l) =>
    '<div class="ov-tile ov-tile-not-run" title="' + escapeAttr(tip) + '">' +
      '<div class="ov-tile-value">-</div>' +
      '<div class="ov-tile-label">' + escapeHtml(l) + "</div>" +
      '<div class="ov-tile-sub">could not be measured</div>' +
    "</div>").join("") + "</div>" +
    '<div class="analysis-note ov-stage-not-run">' + escapeHtml(STAGE_NOT_RUN +
      ": the measured facts are missing, not zero. Run Analyze again; if it still " +
      "fails, the analysis log names the problem.") + "</div>" + _technicalDetail(err);
}

function _factStrip(facts, analysis) {
  if (facts == null) return _factStripNotRun(_stageError(analysis, "facts"));
  const top = (facts.top_apps || [])[0] || {};
  // C12: repeated_sequence_count is null when its stage (motifs) failed.
  const seqsKnown = facts.repeated_sequence_count != null;
  const seqs = facts.repeated_sequence_count || 0;
  // G-2 honesty rule: an old recording can carry NO app-time signal at all
  // (facts.app_time_source === "none") — those tiles must say so, never
  // render a confident 0. An interaction-derived estimate is labelled.
  const src = facts.app_time_source;
  const noAppSignal = src === "none";
  const derived = src === "interactions";
  const naSub = "not available from this recording";
  const naTip = "This recording (an older recorder version) has no " +
    "window-focus signal, so this number can't be measured from it";
  const estSub = "estimated from clicks and typing";
  const tiles = [
    noAppSignal
      ? { v: "-", l: "Active time", s: naSub, t: naTip }
      : { v: _fmt(facts.active_ms), l: "Active time",
          s: derived ? estSub
            : (facts.session_span_ms ? "of " + _fmt(facts.session_span_ms) + " recorded" : ""),
          t: "Time an app spent as the front window, summed across the recording" },
    { v: _fmt(facts.idle_ms), l: "Idle time",
      s: facts.idle_ms ? "" : "no idle time recorded",
      t: "Stretches with no mouse or keyboard input, as flagged by the recorder" },
    noAppSignal
      ? { v: "-", l: "Top app", s: naSub, t: naTip }
      : { v: top.app ? escapeHtml(top.app) : "-", l: "Top app",
          s: top.app ? _pct(top.share) + " of active time" : "",
          t: "The app with the largest share of measured active time" },
    noAppSignal
      ? { v: "-", l: "App switches", s: naSub, t: naTip }
      : { v: String(facts.app_switches || 0), l: "App switches",
          s: (facts.switches_per_hour || 0) + "/h" + (derived ? " · " + estSub : ""),
          t: "How often a different app came to the front" },
    noAppSignal
      ? { v: "-", l: "Longest stretch", s: naSub, t: naTip }
      : { v: _fmt(facts.longest_focus_ms), l: "Longest stretch",
          s: derived ? estSub : "unbroken in one app",
          t: "The longest unbroken stretch of work in a single app" },
    // Item 14: kept as one tile (splitting to 7 tiles would crowd the 980px-
    // wide, 6-tile-tuned row — see DESIGN-CRITIQUE item 14) but fixed the
    // grammar slip (the label pluralized even when rekey_count === 1). The
    // subtitle text itself is unchanged (a longer rewrite clipped the tile
    // at typical widths); the tooltip spells out that it is a second,
    // separate measurement rather than a qualifier on the headline number.
    { v: String(facts.rekey_count || 0),
      l: "Re-typed value" + (facts.rekey_count === 1 ? "" : "s"),
      s: seqsKnown
        ? seqs + " repeated sequence" + (seqs === 1 ? "" : "s")
        : "repeated sequences could not be measured",
      t: "Values typed into more than one app: a sign the same data is re-entered by hand. " +
         "Subtitle: how many step sequences repeat across the recording (a separate measurement)." },
  ];
  return '<div class="ov-facts">' + tiles.map((t) =>
    '<div class="ov-tile" title="' + escapeAttr(t.t) + '">' +
      '<div class="ov-tile-value">' + t.v + "</div>" +
      '<div class="ov-tile-label">' + escapeHtml(t.l) + "</div>" +
      (t.s ? '<div class="ov-tile-sub">' + escapeHtml(t.s) + "</div>" : "") +
    "</div>").join("") + "</div>";
}

/* ---- 4. Findings feed --------------------------------------------------- */

/* Resolve the finding's best timeline target: the first evidenced step, else
   the first evidenced event's timestamp, else a screenshot-free null. */
function _timelineTarget(f) {
  const sess = State.getSession();
  if (!sess) return null;
  const ev = f.evidence || {};
  const stepIds = ev.step_ids || [];
  if (stepIds.length) {
    const steps = (sess.annotations || {}).steps || [];
    const step = steps.find((s) => stepIds.includes(s.step_id));
    if (step && step.time_range && step.time_range.start) return { step };
  }
  const eventIds = ev.event_ids || [];
  if (eventIds.length) {
    const byId = new Set(eventIds);
    const target = (sess.events || []).find((e) => byId.has(e.event_id));
    if (target && target.timestamp) return { ts: target.timestamp };
  }
  if (ev.first_occurrence_ts) return { ts: ev.first_occurrence_ts };
  return null;
}

/* A plain-English name for a detector group's heading. Falls back to the
   raw detector key (title-cased) so a new detector still groups sensibly. */
const _DETECTOR_LABEL = {
  screen_time_sink: "Time sinks",
  fragmentation: "Fragmented attention",
  repetition: "Repeated sequences",
  rekey_transfer: "Re-typed values",
  coverage_caveat: "Recording coverage",
};
function _detectorHeading(det) {
  if (_DETECTOR_LABEL[det]) return _DETECTOR_LABEL[det];
  return String(det || "Findings").replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function _findingsFeed(findings, memoSelection, analysis) {
  if (findings == null) {
    // C12: the findings stage failed. "Nothing stood out" would be a measured
    // negative the recording never supported.
    return '<div class="ov-section"><div class="ov-section-title">Findings</div>' +
      '<div class="analysis-note ov-stage-not-run">' + escapeHtml(STAGE_NOT_RUN +
        ", so it cannot say whether anything stood out. Run Analyze again; if it " +
        "still fails, the analysis log names the problem.") + "</div>" +
      _technicalDetail(_stageError(analysis, "findings")) + "</div>";
  }
  if (!findings.length) {
    return '<div class="ov-section"><div class="ov-section-title">Findings</div>' +
      '<div class="analysis-note">Nothing stood out: the automatic checks ' +
      "found nothing worth reporting on this recording.</div></div>";
  }
  // §D2: the card itself is the shared finding-card component, so the
  // Overview feed and the Compare divergence feed render identically.
  // DISCLOSURE-MODEL rule 3: the "how this was measured" sentence renders
  // ONCE per detector group (behind an ⓘ), not repeated under every card.
  // Group findings by detector, preserving first-seen order.
  const order = [];
  const byDet = new Map();
  for (const f of findings) {
    const det = f.detector || "other";
    if (!byDet.has(det)) { byDet.set(det, []); order.push(det); }
    byDet.get(det).push(f);
  }
  const sel = new Set(memoSelection || []);
  const groups = order.map((det) => {
    const list = byDet.get(det);
    const method = list.map((f) => f.confidence_note).find((n) => n) || "";
    // The methodology note is the group's shared ⓘ; the per-card copy is
    // omitted (opts.omitMethodology) so it appears at most once per group.
    const cards = list.map((f) => findingCardHtml(f, {
      timelineTarget: _timelineTarget,
      memoSelection: sel,
      omitMethodology: true,
    })).join("");
    const info = method
      ? '<button type="button" class="ov-finding-method-btn" data-act="method" ' +
        'aria-expanded="false" title="How this was measured">ⓘ how this was measured</button>' +
        '<div class="ov-finding-method" hidden>' + escapeHtml(method) + "</div>"
      : "";
    return '<div class="ov-finding-group" data-detector="' + escapeAttr(det) + '">' +
      '<div class="ov-finding-group-head">' +
        '<span class="ov-finding-group-title">' + escapeHtml(_detectorHeading(det)) + "</span>" +
        (list.length > 1 ? '<span class="ov-group-count">' + list.length + " findings</span>" : "") +
        info +
      "</div>" + cards + "</div>";
  }).join("");
  return '<div class="ov-section"><div class="ov-section-title">Findings: ' +
    "measured from the recording; review before sharing</div>" + groups + "</div>";
}

async function _toggleMemoSelection(fid, on) {
  const sess = State.getSession();
  if (!sess || !fid) return;
  const a = sess.annotations || {};
  const list = Array.isArray(a.memo_selection) ? a.memo_selection.slice() : [];
  const i = list.indexOf(fid);
  if (on && i === -1) list.push(fid);
  if (!on && i !== -1) list.splice(i, 1);
  a.memo_selection = list;
  try {
    await saveAnnotationsWithUndo(a, on ? "include finding in PDD" : "exclude finding from PDD");
    sess.annotations = a;
  } catch (err) {
    toast("Failed to save the PDD selection: " + (err && err.message), "error");
  }
}

function _wireFindings(host) {
  const sess = State.getSession();
  const findings = ((sess && sess.analysis) || {}).findings || [];
  host.querySelectorAll(".ov-finding").forEach((row) => {
    const f = findings.find((x) => x.id === row.dataset.fid);
    if (!f) return;
    // Expand-in-place: the chevron (or a click on the head, away from the
    // controls) toggles the evidence body inline — no navigation.
    const body = row.querySelector(".ov-finding-body");
    const expand = row.querySelector('[data-act="expand"]');
    const toggle = () => {
      if (!body) return;
      const open = body.hidden;
      body.hidden = !open;
      if (expand) {
        expand.setAttribute("aria-expanded", String(open));
        expand.textContent = open ? "▾" : "▸";
      }
      row.classList.toggle("expanded", open);
    };
    if (expand) expand.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    const head = row.querySelector(".ov-finding-head");
    if (head && body) head.addEventListener("click", (e) => {
      // A click on the tier chip / claim text (not a control) expands.
      if (e.target.closest("button, a, label, input")) return;
      toggle();
    });
    const show = row.querySelector('[data-act="show"]');
    if (show) show.addEventListener("click", () => {
      const target = _timelineTarget(f);
      if (!target) return;
      if (target.step) { _video().jumpToStepInFlow(target.step); return; }
      const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
      if (flowBtn) flowBtn.click();
      setTimeout(() => _video().seekToTimestamp(target.ts), 0);
    });
    // Screenshot chip -> the security-hardened open path (reused, never
    // weakened): openScreenshot validates the session-relative image path.
    row.querySelectorAll('[data-act="shot"]').forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const rel = chip.dataset.shot;
        if (rel) require("./flow-view-screenshots.js").openScreenshot(rel);
      });
    });
    const memo = row.querySelector('[data-act="memo"]');
    if (memo) memo.addEventListener("change", () => _toggleMemoSelection(f.id, memo.checked));
  });
  // Group methodology ⓘ: one per detector group, expand-in-place.
  host.querySelectorAll(".ov-finding-method-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = btn.parentElement && btn.parentElement.querySelector(".ov-finding-method");
      if (!note) return;
      const open = note.hidden;
      note.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
  });
}

/* ---- 5. "To say more" box ----------------------------------------------- */

function _toSayMore(analysis, anno) {
  const items = [];
  // C12: a failed case check or facts stage says nothing about cases or idle
  // time, so neither gap is claimed from a null block.
  const cq = analysis.case_quality;
  if (cq && !cq.tier2_unlocked) {
    if (cq.mode && cq.mode !== "unsegmented" && (cq.case_count || 0) >= 1) {
      // G-3: cases exist, just not enough of them to compare.
      items.push("Only " + (cq.case_count || 0) + " case" +
        ((cq.case_count || 0) === 1 ? " was" : "s were") + " identified: " +
        "case comparisons need at least 2, so capturing or marking one more " +
        "case would unlock how long each case takes and the paths taken.");
    } else {
      items.push("No cases identified yet: a start marker at the beginning " +
        "of each run unlocks how long each case takes, the paths taken, and " +
        "case-by-case comparison.");
    }
  }
  if (analysis.facts && !analysis.facts.idle_ms) {
    items.push("No idle time was measured: time spent waiting inside an " +
      "app without typing or clicking is invisible to this recording.");
  }
  const hasBnva = ((anno || {}).analysis_overrides || []).some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  if (!hasBnva) {
    items.push("Saying how much of the time added value needs an analyst " +
      "to judge each step type first (Evidence → Where the time goes, below); " +
      "until then no efficiency claim is made.");
  }
  if (!items.length) return "";
  return '<div class="ov-section ov-saymore">' +
    '<div class="ov-section-title">To say more, this analysis needs</div>' +
    "<ul>" + items.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul></div>";
}

/* ---- R4 (Task 2): the Evidence modules (retired Analysis, in Overview) --- */

function _evidenceSection() {
  // A resident section header + the host the analysis-view modules render into.
  // renderEvidenceInto() fills #overview-evidence with the two collapsible
  // modules (time / automation), each with its own collapse persistence.
  return '<div class="ov-section ov-evidence-section">' +
    '<div class="ov-section-title">Evidence: the measured detail behind the findings</div>' +
    '<div id="overview-evidence"></div></div>';
}

/* ---- 7. Export bar -------------------------------------------------------- */

/* AD-13: the Overview's call to action is the PDD. The button clicks the
   Session menu's Export > PDD item (#btn-session-pdd, wired in renderer.js),
   so the Overview and the menu share one export path. */
function _exportBar() {
  return '<div class="ov-export-bar">' +
    '<button type="button" id="btn-ov-export-pdd" class="primary" ' +
      'title="Write the Process Definition Document (.docx) for this session, with the process map and the findings ticked above">' +
      "Export PDD</button>" +
    '<span class="meta">Word document: the process map, the steps, and the findings ticked above</span>' +
    "</div>";
}

function _exportPdd() {
  const pdd = document.getElementById("btn-session-pdd");
  if (!pdd) { toast("The PDD export is not available in this window.", "error"); return; }
  pdd.click();
}

/* ---- Render -------------------------------------------------------------- */

/* C12: the case check failed (case_quality is null). Said on the badge, so it
   is not mistaken for "not analyzed yet" or for "no cases". */
function _badgeNotRun(err) {
  return '<div class="ov-badge-row">' +
    '<span class="ov-badge warn" title="' + escapeAttr(STAGE_NOT_RUN + ", so the cases in it are not known.") + '">' +
    '<span class="ov-badge-text">' + escapeHtml("The case check could not run on this recording") + "</span>" +
    "</span></div>" + _technicalDetail(err);
}

/* Whether analysis.json carries the Overview's blocks at all: the case check
   ran, or it is named as a failed stage (C12). */
function _hasOverview(analysis) {
  return !!(analysis && (analysis.case_quality || _stageError(analysis, "case_quality")));
}

/* The Overview HTML for one analysis.json + annotations. Pure (no DOM, no
   State), so the unit tests render fixture analyses through the same code. */
function overviewHtml(analysis, anno) {
  if (!_hasOverview(analysis)) {
    return '<div class="analysis-empty">No analysis yet: click ' +
      "<strong>Analyze session</strong> above to compute the measured facts, " +
      "case quality and findings this Overview renders. (Sessions analyzed " +
      "before this version need one re-analyze.)</div>";
  }
  anno = anno || {};
  const cq = analysis.case_quality;
  let html = cq ? _badge(cq) : _badgeNotRun(_stageError(analysis, "case_quality"));
  if (cq && cq.mode === "unsegmented") html += _markRunsLine();
  html += _factStrip(analysis.facts, analysis);
  html += _findingsFeed(analysis.findings, anno.memo_selection, analysis);
  // R4 (Task 2): the retired Analysis modules, as Evidence, BELOW the findings.
  html += _evidenceSection();
  html += _toSayMore(analysis, anno);
  html += _exportBar();
  return html;
}

function renderOverviewLevel() {
  const host = document.getElementById("overview-content");
  if (!host) return;
  const sess = State.getSession();
  if (!sess) { host.innerHTML = ""; return; }
  host.innerHTML = overviewHtml(sess.analysis, sess.annotations);
  if (!_hasOverview(sess.analysis)) return;   // the "not analyzed yet" note has nothing to wire

  const markRuns = host.querySelector("#btn-ov-mark-runs");
  if (markRuns) markRuns.addEventListener("click", () => openMarkersInFlow());
  _wireFindings(host);
  // Fill the Evidence host with the analysis modules (own wiring + collapse
  // persistence). Kept after innerHTML so the modules render into the live host.
  renderEvidenceInto(host.querySelector("#overview-evidence"));
  const exp = host.querySelector("#btn-ov-export-pdd");
  if (exp) exp.addEventListener("click", () => _exportPdd());
}

module.exports = {
  renderOverviewLevel, openMarkersInFlow, overviewHtml,
  NO_RUNS_MARKED, MARK_RUNS_INSTRUCTION, MARK_RUNS_BUTTON, STAGE_NOT_RUN,
};

