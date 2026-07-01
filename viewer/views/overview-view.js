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
const { findingCardHtml } = require("../finding-cards.js");

function _fmt(ms) { return formatDuration(ms || 0); }
function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

/* ---- 1. Case-quality badge -------------------------------------------- */

function _badge(cq) {
  let cls, text, title;
  const oneCase = (cq.case_count || 0) === 1;
  if (cq.mode === "markers") {
    cls = "ok";
    // G-3: one case never unlocks comparisons — say so on the badge itself.
    text = oneCase
      ? "✓ 1 case marked — case comparisons need at least 2"
      : "✓ " + (cq.case_count || 0) + " cases — marked by the worker";
    title = "The worker marked case starts/ends during recording · " +
      _pct(cq.coverage) + " of recorded actions fall inside a case";
  } else if (cq.mode === "anchor") {
    const a = cq.anchor || {};
    cls = "ok";
    text = oneCase
      ? '✓ 1 case identified by "' + (a.field_value || a.field_property || "?") +
        '" — case comparisons need at least 2'
      : "✓ " + (cq.case_count || 0) + " cases" +
        ' — identified by "' + (a.field_value || a.field_property || "?") + '"' +
        " (" + _pct(cq.coverage) + " covered)";
    title = "Cases were identified by the confirmed field (" +
      (a.field_property || "?") + " = " + (a.field_value || "?") + ")";
  } else {
    cls = "warn";
    text = "⚠ No cases identified yet";
    title = "The recording is not split into cases yet — how long each case " +
      "takes, the paths taken, and case-by-case comparison stay locked until " +
      "the worker records markers or you confirm the field that identifies each case";
  }
  // Item 8: the case-state and the "case analysis on/locked" fact are the
  // SAME fact in two vocabularies — merge them. The tier-2 clause becomes the
  // badge's subtitle rather than a second, duplicating chip. The three badge
  // states (markers / anchor / unsegmented) are preserved.
  const subCls = cq.tier2_unlocked ? "ok" : "locked";
  const subText = cq.tier2_unlocked
    ? "Case analysis on"
    : "Case analysis locked";
  const subTitle = cq.tier2_unlocked
    ? "At least 2 cases are identified and cover at least 70% of the recording, so the case-by-case numbers are shown"
    : "The case-by-case numbers are hidden — they need at least 2 confirmed cases (worker markers, or a confirmed identifying field) covering at least 70% of the recording";
  return '<div class="ov-badge-row">' +
    '<span class="ov-badge ' + cls + '" title="' + escapeAttr(title) + '">' +
    '<span class="ov-badge-text">' + escapeHtml(text) + "</span>" +
    '<span class="ov-badge-sub ' + subCls + '" title="' + escapeAttr(subTitle) + '">' +
    escapeHtml(subText) + "</span>" +
    "</span>" + _postureControl() + "</div>";
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
    '<span class="ov-posture-label">Data sharing</span>' +
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
        '<button type="button" class="primary" data-act="accept" title="Use this field to split the recording into cases (applies on the next Analyze). You can undo this from the Markers panel.">Accept</button>' +
        '<button type="button" data-act="dismiss" title="Hide this suggestion — it stays hidden on future analyses.">Dismiss</button>' +
      "</div></div>";
  }).join("");
  return '<div class="ov-hero">' +
    '<div class="ov-section-title">No cases identified yet — ' +
      cands.length + " field" + (cands.length === 1 ? "" : "s") +
      " could identify each ticket/order</div>" +
    '<div class="ov-hero-hint">Accept one and the next Analyze will split the ' +
      "recording into separate cases, unlocking the case-by-case numbers. The " +
      "recording itself is never changed, and Accept can be undone from the " +
      "Markers panel.</div>" +
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
      ? { v: "—", l: "Active time", s: naSub, t: naTip }
      : { v: _fmt(facts.active_ms), l: "Active time",
          s: derived ? estSub
            : (facts.session_span_ms ? "of " + _fmt(facts.session_span_ms) + " recorded" : ""),
          t: "Time an app spent as the front window, summed across the recording" },
    { v: _fmt(facts.idle_ms), l: "Idle time",
      s: facts.idle_ms ? "" : "no idle time recorded",
      t: "Stretches with no mouse or keyboard input, as flagged by the recorder" },
    noAppSignal
      ? { v: "—", l: "Top app", s: naSub, t: naTip }
      : { v: top.app ? escapeHtml(top.app) : "—", l: "Top app",
          s: top.app ? _pct(top.share) + " of active time" : "",
          t: "The app with the largest share of measured active time" },
    noAppSignal
      ? { v: "—", l: "App switches", s: naSub, t: naTip }
      : { v: String(facts.app_switches || 0), l: "App switches",
          s: (facts.switches_per_hour || 0) + "/h" + (derived ? " · " + estSub : ""),
          t: "How often a different app came to the front" },
    noAppSignal
      ? { v: "—", l: "Longest stretch", s: naSub, t: naTip }
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
      s: seqs + " repeated sequence" + (seqs === 1 ? "" : "s"),
      t: "Values typed into more than one app — a sign the same data is re-entered by hand. " +
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

function _findingsFeed(findings, memoSelection) {
  if (!findings.length) {
    return '<div class="ov-section"><div class="ov-section-title">Findings</div>' +
      '<div class="analysis-note">Nothing stood out — the automatic checks ' +
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
  return '<div class="ov-section"><div class="ov-section-title">Findings — ' +
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
      if (target.step) { jumpToStepInFlow(target.step); return; }
      const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
      if (flowBtn) flowBtn.click();
      setTimeout(() => seekToTimestamp(target.ts), 0);
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
  const cq = analysis.case_quality || {};
  if (!cq.tier2_unlocked) {
    if (cq.mode && cq.mode !== "unsegmented" && (cq.case_count || 0) >= 1) {
      // G-3: cases exist, just not enough of them to compare.
      items.push("Only " + (cq.case_count || 0) + " case" +
        ((cq.case_count || 0) === 1 ? " was" : "s were") + " identified — " +
        "case comparisons need at least 2, so capturing or marking one more " +
        "case would unlock how long each case takes and the paths taken.");
    } else {
      const n = ((anno || {}).anchor_candidates || []).length;
      items.push("No cases identified yet" +
        (n ? " (" + n + " candidate field" + (n === 1 ? "" : "s") + " above)" : "") +
        " — confirming the field that identifies each ticket/order, or " +
        "recording Start/End markers, unlocks how long each case takes, the " +
        "paths taken, and case-by-case comparison.");
    }
  }
  if (!(anno || {}).roi_inputs) {
    items.push("A loaded labour rate and annual volume (Analysis → Edit " +
      "assumptions) would turn the measured time into a € savings band.");
  }
  const caveat = (analysis.findings || []).find((f) => f.detector === "coverage_caveat");
  if (caveat) {
    const apps = (((caveat.evidence || {}).flagged_apps) || []).map((a) => a.app);
    items.push("The recorder saw less detail in " + apps.slice(0, 4).join(", ") +
      " — teaching the app " + (apps.length === 1 ? "its" : "their") +
      " screens (App Library → Discover from window) would make those " +
      "numbers firmer.");
  }
  if (!((analysis.facts || {}).idle_ms)) {
    items.push("No idle time was measured — time spent waiting inside an " +
      "app without typing or clicking is invisible to this recording.");
  }
  const hasBnva = ((anno || {}).analysis_overrides || []).some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  if (!hasBnva) {
    items.push("Saying how much of the time added value needs an analyst " +
      "to judge each step type first (Analysis → Waste by step); until " +
      "then no efficiency claim is made.");
  }
  if (!items.length) return "";
  return '<div class="ov-section ov-saymore">' +
    '<div class="ov-section-title">To say more, this analysis needs</div>' +
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
      'title="A privacy-masked text summary — facts, findings, step groups, and the App Library entries this session used. No raw events, no screenshots. You review it line by line, then copy it yourself — the app sends nothing anywhere.">' +
      "Copy for AI review…</button>"
    : "";
  return '<div class="ov-export-bar">' +
    '<button type="button" id="btn-ov-export-memo" class="primary" ' +
      'title="Re-runs the analysis with --memo-out and writes <session>\\memo.docx (starred screenshots embedded inline) + memo.md — the 2-page findings memo (claims + measured numbers), then reveals it">' +
      "Export memo (.docx + .md)</button>" +
    llm +
    '<span class="meta">2 pages: the key numbers · selected findings · ' +
      "case-by-case numbers only when cases are confirmed · what's missing</span>" +
    "</div>";
}

/* §C3 from the Overview: the session's derived blocks + the skeletons of
   the vocabs this session actually hit (stats.meta.app_vocabulary_hits_by_id),
   so the export carries exactly the engagement's working set. G-5: ALL known
   vocabs are read for the candidate-rows coverage check (an app with a vocab
   the session didn't hit is still covered, not a naming gap); only the hit
   ones export their skeleton rows. */
async function _copySessionForLlm() {
  const sess = State.getSession();
  if (!sess) return;
  const hitIds = Object.keys(
    (((sess.stats || {}).meta) || {}).app_vocabulary_hits_by_id || {});
  const vocabs = [];
  const allVocabs = [];
  try {
    const r = await Ipc.listAppVocabs();
    for (const v of ((r && r.vocabs) || [])) {
      const doc = await Ipc.readVocab(v.path);
      if (!doc || doc._error) continue;
      allVocabs.push(doc);
      if (hitIds.includes(v.id)) vocabs.push(doc);
    }
  } catch (_) { /* export still works without the vocab section */ }
  LlmExport.showExportModal({
    session: { analysis: sess.analysis || {}, annotations: sess.annotations || {} },
    vocabs,
    events: sess.events || [],
    coverageVocabs: allVocabs,
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
