/*
 * overview-view.js -- the Overview level of the Session view (lab-phase
 * spec §A5; the honesty redesign's buyer-first surface).
 *
 * The default level on session load. One column, top to bottom:
 *   1. case-quality badge   -- from analysis.case_quality (3 states).
 *   2. anchor hero          -- ONLY when unsegmented + candidates exist;
 *                              Accept/Dismiss reuse the flow-view-markers
 *                              wiring (exported there, not duplicated).
 *   3. fact strip           -- 6 tiles from analysis.facts (Tier 1).
 *   4. findings feed        -- analysis.findings[]: claim + evidence,
 *                              "Show on timeline" (jumpToStepInFlow /
 *                              seekToTimestamp), "include in memo"
 *                              checkbox persisted to the additive
 *                              annotations.memo_selection[].
 *   5. "to say more" box    -- the missing inputs, honestly enumerated.
 *   6. export bar           -- memo export (normalize --memo-out via the
 *                              runNormalize IPC pattern), then revealFile.
 *
 * Tier discipline: everything here is measured (Tier 1) or explicitly
 * gated (the badge + hero ARE the gate UI). Nothing renders case-based
 * authority while case_quality.tier2_unlocked is false.
 */

"use strict";

const path = require("node:path");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const { escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const { saveAnnotationsWithUndo } = require("../session.js");
const { acceptAnchorCandidate, dismissAnchorCandidate } = require("./flow-view-markers.js");
const { seekToTimestamp, jumpToStepInFlow } = require("./flow-view-video.js");
const Posture = require("../posture.js");
const LlmExport = require("../llm-export.js");

function _fmt(ms) { return formatDuration(ms || 0); }
function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

/* ---- 1. Case-quality badge -------------------------------------------- */

function _badge(cq) {
  let cls, text, title;
  if (cq.mode === "markers") {
    cls = "ok";
    text = "✓ Markers — " + (cq.case_count || 0) + " case" + (cq.case_count === 1 ? "" : "s");
    title = "Cases bracketed by worker-fired Start/End markers · " +
      _pct(cq.coverage) + " of interactions inside a case";
  } else if (cq.mode === "anchor") {
    const a = cq.anchor || {};
    cls = "ok";
    text = '✓ Anchor "' + (a.field_value || a.field_property || "?") + '" — ' +
      (cq.case_count || 0) + " case" + (cq.case_count === 1 ? "" : "s") +
      ", " + _pct(cq.coverage) + " coverage";
    title = "Cases stamped by the accepted case anchor (" +
      (a.field_property || "?") + " = " + (a.field_value || "?") + ")";
  } else {
    cls = "warn";
    text = "⚠ Unsegmented";
    title = "No case boundaries — case-based analysis (cycle times, variants, " +
      "per-case comparison) stays locked until markers exist or an anchor is accepted";
  }
  const tier2 = cq.tier2_unlocked
    ? '<span class="ov-tier2 ok" title="Case-based analysis renders — mode is segmented and coverage ≥ 70%">Tier 2 unlocked</span>'
    : '<span class="ov-tier2 locked" title="Case-based analysis is withheld — needs segmentation (markers or an accepted anchor) with ≥ 70% interaction coverage">Tier 2 locked</span>';
  return '<div class="ov-badge-row">' +
    '<span class="ov-badge ' + cls + '" title="' + escapeAttr(title) + '">' +
    escapeHtml(text) + "</span>" + tier2 + _postureControl() + "</div>";
}

/* §C4: the engagement data posture, displayed (and settable) on the
   Overview header line. `sealed` removes the Copy-for-LLM surface from
   the DOM entirely — code-enforced, mirroring the egress guard. */
function _postureControl() {
  const cur = Posture.getDataPosture();
  const opts = Posture.POSTURES.map((p) =>
    '<option value="' + p + '"' + (p === cur ? " selected" : "") + ">" + p + "</option>").join("");
  return '<span class="ov-posture' + (cur === "sealed" ? " sealed" : "") + '" ' +
    'title="' + escapeAttr(Posture.POSTURE_LABELS[cur] || "") + '">' +
    '<span class="ov-posture-label">Data posture</span>' +
    '<select id="ov-posture-select" title="' +
    escapeAttr(Posture.POSTURES.map((p) => Posture.POSTURE_LABELS[p]).join("\n")) + '">' +
    opts + "</select></span>";
}

/* ---- 2. Anchor hero ---------------------------------------------------- */

function _anchorHero(cands) {
  const rows = cands.map((c) => {
    const d = c.display || {};
    const m = c.metrics || {};
    const samples = (d.sample_values || []).slice(0, 3).join(", ");
    return '<div class="ov-hero-row" data-sig="' + escapeAttr(c.signature || "") + '">' +
      '<div class="ov-hero-field"><strong>' + escapeHtml(d.field_property || "?") +
        '</strong> = ' + escapeHtml(d.field_value || "?") +
        (samples ? ' <span class="meta">e.g. ' + escapeHtml(samples) + "</span>" : "") + "</div>" +
      '<div class="ov-hero-metrics">' +
        (m.case_count || "?") + " cases · " +
        (m.coverage != null ? _pct(m.coverage) + " coverage" : "? coverage") +
        " · score " + (c.score != null ? c.score.toFixed(2) : "?") + "</div>" +
      '<div class="ov-hero-actions">' +
        '<button type="button" class="primary" data-act="accept" title="Set as the case anchor (re-runs on next Analyze); the inverse lives in the Markers panel (↺ clear)">Accept</button>' +
        '<button type="button" data-act="dismiss" title="Suppress this candidate across re-analyzes">Dismiss</button>' +
      "</div></div>";
  }).join("");
  return '<div class="ov-hero">' +
    '<div class="ov-section-title">This session has no case boundaries — ' +
      cands.length + " field" + (cands.length === 1 ? "" : "s") +
      " look like case anchors</div>" +
    '<div class="ov-hero-hint">Accepting one stamps cases on the next Analyze ' +
      "and unlocks case-based analysis (suggest-don't-mutate: raw events are " +
      "never touched; Accept is reversible from the Markers panel).</div>" +
    rows + "</div>";
}

function _wireAnchorHero(host) {
  const sess = State.getSession();
  const cands = ((sess && sess.annotations) || {}).anchor_candidates || [];
  host.querySelectorAll(".ov-hero-row").forEach((row) => {
    const cand = cands.find((c) => c.signature === row.dataset.sig);
    if (!cand) return;
    const accept = row.querySelector('[data-act="accept"]');
    const dismiss = row.querySelector('[data-act="dismiss"]');
    if (accept) accept.addEventListener("click", async () => {
      await acceptAnchorCandidate(cand);
      renderOverviewLevel();
    });
    if (dismiss) dismiss.addEventListener("click", async () => {
      await dismissAnchorCandidate(cand);
      renderOverviewLevel();
    });
  });
}

/* ---- 3. Fact strip ------------------------------------------------------ */

function _factStrip(facts) {
  const top = (facts.top_apps || [])[0] || {};
  const seqs = facts.repeated_sequence_count || 0;
  const tiles = [
    { v: _fmt(facts.active_ms), l: "Active (foreground)",
      s: facts.session_span_ms ? "of " + _fmt(facts.session_span_ms) + " span" : "",
      t: "Foreground-window time summed from focus events" },
    { v: _fmt(facts.idle_ms), l: "Idle (measured)",
      s: facts.idle_ms ? "" : "no idle events captured",
      t: "Recorder-flagged input inactivity (idle_start/idle_end)" },
    { v: top.app ? escapeHtml(top.app) : "—", l: "Top app",
      s: top.app ? _pct(top.share) + " of foreground time" : "",
      t: "Largest share of measured foreground time" },
    { v: String(facts.app_switches || 0), l: "App switches",
      s: (facts.switches_per_hour || 0) + "/h",
      t: "Foreground-app changes across the session" },
    { v: _fmt(facts.longest_focus_ms), l: "Longest focus",
      s: "unbroken in one app",
      t: "The longest contiguous same-app foreground stretch" },
    { v: String(facts.rekey_count || 0), l: "Re-keyed values",
      s: seqs + " repeated sequence" + (seqs === 1 ? "" : "s"),
      t: "Distinct values typed into 2+ apps (value equality on the derived stream) · repeated step sequences from motif mining" },
  ];
  return '<div class="ov-facts">' + tiles.map((t) =>
    '<div class="ov-tile" title="' + escapeAttr(t.t) + '">' +
      '<div class="ov-tile-value">' + t.v + "</div>" +
      '<div class="ov-tile-label">' + escapeHtml(t.l) + "</div>" +
      (t.s ? '<div class="ov-tile-sub">' + escapeHtml(t.s) + "</div>" : "") +
    "</div>").join("") + "</div>";
}

/* ---- 4. Findings feed --------------------------------------------------- */

/* The scalar evidence numbers, compact -- mirrors memo_export's rendering
   so the feed and the memo read the same. */
function _evidenceNumbers(ev) {
  const parts = [];
  for (const [k, v] of Object.entries(ev || {})) {
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (k.endsWith("_ms")) parts.push(k.replace(/_/g, " ") + " " + _fmt(v));
    else if (k === "share" || k === "coverage") parts.push(k + " " + _pct(v));
    else parts.push(k.replace(/_/g, " ") + " " + (Number.isInteger(v) ? v : v.toFixed(2)));
  }
  return parts.join(" · ");
}

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

function _findingsFeed(findings, memoSelection) {
  if (!findings.length) {
    return '<div class="ov-section"><div class="ov-section-title">Findings</div>' +
      '<div class="analysis-note">No findings fired on this capture — the ' +
      "detectors found nothing above their preconditions.</div></div>";
  }
  const selected = new Set(memoSelection || []);
  const rows = findings.map((f) => {
    const ev = f.evidence || {};
    const nums = _evidenceNumbers(ev);
    const refs = (ev.screenshot_refs || []).slice(0, 2);
    const target = _timelineTarget(f);
    return '<div class="ov-finding" data-fid="' + escapeAttr(f.id || "") + '">' +
      '<div class="ov-finding-head">' +
        '<span class="ov-finding-tier t' + (f.tier || 1) + '" title="' +
          (f.tier === 2 ? "Tier 2 — case-based" : "Tier 1 — measured, no cases needed") +
          '">T' + (f.tier || 1) + "</span>" +
        '<span class="ov-finding-claim">' + escapeHtml(f.claim || "") + "</span>" +
      "</div>" +
      (nums ? '<div class="ov-finding-evidence">' + escapeHtml(nums) + "</div>" : "") +
      (refs.length ? '<div class="ov-finding-refs">' +
        refs.map((r) => "★ <code>" + escapeHtml(r) + "</code>").join(" ") + "</div>" : "") +
      (f.confidence_note ? '<div class="ov-finding-note">' + escapeHtml(f.confidence_note) + "</div>" : "") +
      '<div class="ov-finding-actions">' +
        (target ? '<button type="button" class="link-btn" data-act="show" title="Jump the Flow timeline (and video) to this finding\'s evidence">Show on timeline</button>' : "") +
        '<label class="ov-memo-check" title="Selected findings render in the exported memo (annotations.json memo_selection)">' +
          '<input type="checkbox" data-act="memo"' + (selected.has(f.id) ? " checked" : "") + " /> include in memo</label>" +
      "</div></div>";
  }).join("");
  return '<div class="ov-section"><div class="ov-section-title">Findings — ' +
    "measured claims, analyst judgment pending</div>" + rows + "</div>";
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
    await saveAnnotationsWithUndo(a, on ? "include finding in memo" : "exclude finding from memo");
    sess.annotations = a;
  } catch (err) {
    toast("Failed to save memo selection: " + (err && err.message), "error");
  }
}

function _wireFindings(host) {
  const sess = State.getSession();
  const findings = ((sess && sess.analysis) || {}).findings || [];
  host.querySelectorAll(".ov-finding").forEach((row) => {
    const f = findings.find((x) => x.id === row.dataset.fid);
    if (!f) return;
    const show = row.querySelector('[data-act="show"]');
    if (show) show.addEventListener("click", () => {
      const target = _timelineTarget(f);
      if (!target) return;
      if (target.step) { jumpToStepInFlow(target.step); return; }
      const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
      if (flowBtn) flowBtn.click();
      setTimeout(() => seekToTimestamp(target.ts), 0);
    });
    const memo = row.querySelector('[data-act="memo"]');
    if (memo) memo.addEventListener("change", () => _toggleMemoSelection(f.id, memo.checked));
  });
}

/* ---- 5. "To say more" box ----------------------------------------------- */

function _toSayMore(analysis, anno) {
  const items = [];
  const cq = analysis.case_quality || {};
  if (!cq.tier2_unlocked) {
    const n = ((anno || {}).anchor_candidates || []).length;
    items.push("Case segmentation" +
      (n ? " (" + n + " anchor candidate" + (n === 1 ? "" : "s") + " above)" : "") +
      " — accepting an anchor or capturing Start/End markers unlocks cycle " +
      "times, variants and per-case comparison.");
  }
  if (!(anno || {}).roi_inputs) {
    items.push("A loaded labour rate and annual volume (Analysis → Edit " +
      "assumptions) would turn the measured time into a € savings band.");
  }
  const caveat = (analysis.findings || []).find((f) => f.detector === "coverage_caveat");
  if (caveat) {
    const apps = (((caveat.evidence || {}).flagged_apps) || []).map((a) => a.app);
    items.push("Capture confidence is reduced in " + apps.slice(0, 4).join(", ") +
      " — an App Vocabulary for " + (apps.length === 1 ? "it" : "them") +
      " would firm up element identity.");
  }
  if (!((analysis.facts || {}).idle_ms)) {
    items.push("No idle events were measured — waiting time spent inside an " +
      "app without input is invisible to this capture.");
  }
  const hasBnva = ((anno || {}).analysis_overrides || []).some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  if (!hasBnva) {
    items.push("The value-add vs business-required split needs an analyst " +
      "judgment per step type (Analysis → Waste by step) before a " +
      "process-efficiency ratio can be stated.");
  }
  if (!items.length) return "";
  return '<div class="ov-section ov-saymore">' +
    '<div class="ov-section-title">To say more, this engagement needs</div>' +
    "<ul>" + items.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul></div>";
}

/* ---- 6. Memo export bar -------------------------------------------------- */

async function _exportMemo() {
  const sess = State.getSession();
  if (!sess || !sess.sessionFolder) return;
  // §B4: the Word memo (inline evidence figures) is the deliverable; the
  // Markdown seed is written alongside it. One re-analyze, two renders.
  const memoDocx = path.join(sess.sessionFolder, "memo.docx");
  const memoMd = path.join(sess.sessionFolder, "memo.md");
  const btn = document.getElementById("btn-ov-export-memo");
  if (btn) { btn.disabled = true; btn.textContent = "Exporting…"; }
  toast("Re-analyzing + writing memo.docx + memo.md…");
  try {
    const r = await Ipc.runNormalizeExtended({
      sessionFolder: sess.sessionFolder,
      mine: false,
      memoOut: [memoDocx, memoMd],
    });
    if (!r || !r.ok) {
      toast("Memo export failed: " + ((r && r.error) || "unknown"), "error");
      return;
    }
    // Same-folder reload (preserves undo) so the Overview reflects the
    // recomputed analysis the memo was rendered from.
    const { loadSessionIntoView } = require("./flow-view.js");
    await loadSessionIntoView(sess.sessionFolder);
    toast("memo.docx + memo.md written", "success");
    await Ipc.revealFile(memoDocx);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Export memo (.docx + .md)"; }
  }
}

function _exportBar() {
  // §C3/§C4: the Copy-for-LLM button EXISTS only under a permitting
  // posture — sealed removes it from the DOM, not just from view.
  const llm = Posture.copyForLlmAllowed()
    ? '<button type="button" id="btn-ov-copy-llm" ' +
      'title="One reviewable, PII-masked JSON of the DERIVED stream — facts, findings (values tokenized), step groups, the vocab skeletons this session hit. No raw events, no screenshots. Shown for line-by-line review; you paste it, the app sends nothing.">' +
      "Copy for LLM…</button>"
    : "";
  return '<div class="ov-export-bar">' +
    '<button type="button" id="btn-ov-export-memo" class="primary" ' +
      'title="Re-runs the analysis with --memo-out and writes <session>\\memo.docx (starred screenshots embedded inline) + memo.md — the 2-page findings memo (claims + measured numbers), then reveals it">' +
      "Export memo (.docx + .md)</button>" +
    llm +
    '<span class="meta">2 pages: fact strip · selected findings · the Tier-2 ' +
      "section only if unlocked · what's missing</span>" +
    "</div>";
}

/* §C3 from the Overview: the session's derived blocks + the skeletons of
   the vocabs this session actually hit (stats.meta.app_vocabulary_hits_by_id),
   so the export carries exactly the engagement's working set. */
async function _copySessionForLlm() {
  const sess = State.getSession();
  if (!sess) return;
  const hitIds = Object.keys(
    (((sess.stats || {}).meta) || {}).app_vocabulary_hits_by_id || {});
  const vocabs = [];
  if (hitIds.length) {
    try {
      const r = await Ipc.listAppVocabs();
      for (const v of ((r && r.vocabs) || [])) {
        if (!hitIds.includes(v.id)) continue;
        const doc = await Ipc.readVocab(v.path);
        if (doc && !doc._error) vocabs.push(doc);
      }
    } catch (_) { /* export still works without the vocab section */ }
  }
  LlmExport.showExportModal({
    session: { analysis: sess.analysis || {}, annotations: sess.annotations || {} },
    vocabs,
    posture: Posture.getDataPosture(),
    surface: "overview",
  });
}

/* ---- Render -------------------------------------------------------------- */

function renderOverviewLevel() {
  const host = document.getElementById("overview-content");
  if (!host) return;
  const sess = State.getSession();
  if (!sess) { host.innerHTML = ""; return; }
  const analysis = sess.analysis;
  const cq = analysis && analysis.case_quality;
  if (!cq) {
    host.innerHTML = '<div class="analysis-empty">No analysis yet — click ' +
      "<strong>Analyze session</strong> above to compute the measured facts, " +
      "case quality and findings this Overview renders. (Sessions analyzed " +
      "before this version need one re-analyze.)</div>";
    return;
  }
  const anno = sess.annotations || {};
  const facts = analysis.facts || {};
  const findings = analysis.findings || [];
  const cands = anno.anchor_candidates || [];

  let html = _badge(cq);
  if (cq.mode === "unsegmented" && cands.length) html += _anchorHero(cands);
  html += _factStrip(facts);
  html += _findingsFeed(findings, anno.memo_selection);
  html += _toSayMore(analysis, anno);
  html += _exportBar();
  host.innerHTML = html;

  _wireAnchorHero(host);
  _wireFindings(host);
  const exp = host.querySelector("#btn-ov-export-memo");
  if (exp) exp.addEventListener("click", () => _exportMemo());
  const llm = host.querySelector("#btn-ov-copy-llm");
  if (llm) llm.addEventListener("click", () => _copySessionForLlm());
  const posture = host.querySelector("#ov-posture-select");
  if (posture) posture.addEventListener("change", () => {
    Posture.setDataPosture(posture.value);
    renderOverviewLevel();   // re-render: header chip + export bar follow the posture
  });
}

module.exports = { renderOverviewLevel };
