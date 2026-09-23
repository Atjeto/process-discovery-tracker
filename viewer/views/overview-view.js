/*
 * overview-view.js: the Overview level of the Session view, the home of a
 * loaded session (BA-helper cycle, plan section 5). The default level on
 * session load. One column, top to bottom:
 *   1. "What is left" line: the analyst path's stages (mark runs, confirm
 *      the pattern run, review the other runs, fill the document sections,
 *      finish the As-Is map, export the PDD), each shown done or not from
 *      the session data alone, and ONE button for the next act. Nothing
 *      runs by itself: the button lands where it says.
 *   2. session summary: one line (the recording, its runs, how many steps
 *      are confirmed), plus a warning line only when a marker problem, a
 *      missing file or a check that could not run needs one.
 *   3. findings feed: analysis.findings[]: claim + evidence, "Show on
 *      timeline", "include in PDD" (annotations.memo_selection feeds the
 *      PDD's findings section).
 *   4. evidence modules: analysis-view.renderEvidenceInto.
 *   5. "to say more" box: the missing inputs, honestly enumerated.
 *   6. document sections: annotations.document (contract C6), the PDD's
 *      document-level fields; collapsed, with a one-line status.
 *
 * Tier discipline: everything here is measured or explicitly gated. Nothing
 * renders case-based authority while case_quality.tier2_unlocked is false.
 */

"use strict";

const State = require("../state.js");
const { escapeHtml, escapeAttr, formatDuration, toast } = require("../dom.js");
const { saveAnnotationsWithUndo, persistAnnotations } = require("../session.js");
const { findingCardHtml } = require("../finding-cards.js");
const { renderEvidenceInto } = require("./analysis-view.js");
const RunsModel = require("../runs-model.js");
const RefStore = require("../reference-maps.js");
const SessionSummary = require("../session-summary.js");
// flow-view-video.js wires DOM controls at require() time; it is required
// lazily in the click handlers so this module (and its pure section
// builders) load under the node:test runner.
function _video() { return require("./flow-view-video.js"); }

function _pct(x) { return Math.round((x || 0) * 100) + "%"; }

/* ---- Stage failures (contract C12, RP-10) -------------------------------- */

/* A pipeline stage that failed is named in analysis.stage_errors
   ([{ stage, error }]) and its output key is null. The Overview says the
   check could not run; it never renders that as a measured negative (a zero,
   "nothing stood out"). */
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

/* ---- The mark-runs sentence and verb ------------------------------------- */

/* AD-14: with no run markers there are no runs. One plain instruction and
   one button that opens Flow with the Markers panel showing. The Map level's
   lock message (mapLockHtml below) and the Steps level use the same sentence
   and the same verb, so the surfaces cannot drift apart. */
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

/* ---- The Map level's lock message ---------------------------------------- */

/* The HTML the Map level shows instead of the process map, or null when the
   map can be drawn. The map draws how the runs flow, so it needs the run
   check to have run and found runs to compare: at least 2, covering at least
   70% of the recording (case_quality.tier2_unlocked). Each state says what
   actually happened: not analyzed at all, analyzed by an older version, the
   run check failed, or which condition the runs miss. */
function mapLockHtml(analysis) {
  const lead = "The process map is not shown because it draws how the runs flow. ";
  if (!analysis) {
    return escapeHtml(lead + "This session has not been analyzed yet: click Analyze session once.");
  }
  const cq = analysis.case_quality;
  if (!cq) {
    const err = _stageError(analysis, "case_quality");
    if (err) {
      return escapeHtml(lead + "The run check could not run on this recording, so the runs " +
        "are not known. Click Analyze session again; if it still fails, the analysis log names " +
        "the problem.") + _technicalDetail(err);
    }
    return escapeHtml(lead + "This session was analyzed by an older version: click Analyze session once.");
  }
  if (cq.tier2_unlocked) return null;
  const why = cq.mode === "unsegmented"
    ? NO_RUNS_MARKED
    : ((cq.case_count || 0) < 2
        ? "Only one run is marked, and the map needs at least 2 to show how the runs flow."
        : "The marked runs cover only " + _pct(cq.coverage) +
          " of the recording, below the 70% needed to trust them.");
  return escapeHtml(lead + why + " " + MARK_RUNS_INSTRUCTION) +
    ' <button type="button" class="link-btn" data-map-cta="mark-runs">' +
    escapeHtml(MARK_RUNS_BUTTON) + "</button>";
}

/* ---- 1. What is left ------------------------------------------------------ */

/* The document sections (contract C6) in the order the PDD reads them, each
   with where it appears. `optional`: an empty field leaves no gap in the PDD
   (its section is simply left out), so it does not count as left to do. */
const DOC_FIELDS = [
  { key: "title", label: "Title", where: "the title and 2. Document control", line: true },
  { key: "purpose", label: "Purpose", where: "3.1 Purpose" },
  { key: "scope", label: "Scope", where: "3.2 Scope" },
  { key: "contacts", label: "Key contacts", where: "3.3 Key contacts" },
  { key: "business_rules", label: "Business rules", where: "6.2 Business rules and exceptions" },
  { key: "exceptions", label: "Exceptions", where: "6.2 Business rules and exceptions" },
  { key: "notes", label: "Notes", where: "7. Notes (added only when written)", optional: true },
];

function _docValue(doc, key) {
  const v = doc && typeof doc === "object" ? doc[key] : "";
  return typeof v === "string" ? v : "";
}

/* How many of the document fields that fill a PDD placeholder are written. */
function documentStatus(doc) {
  const counted = DOC_FIELDS.filter((f) => !f.optional);
  const filled = counted.filter((f) => _docValue(doc, f.key).trim()).length;
  const firstEmpty = DOC_FIELDS.find((f) => !_docValue(doc, f.key).trim()) || null;
  return { filled, total: counted.length, firstEmpty: firstEmpty ? firstEmpty.key : null };
}

const PATH_STAGES = [
  { key: "runs", label: "Runs" },
  { key: "pattern", label: "Pattern run" },
  { key: "review", label: "Other runs" },
  { key: "document", label: "Document" },
  { key: "map", label: "As-Is map" },
  { key: "export", label: "PDD" },
];

/* The analyst path's state, derived from the session data alone (pure: the
   runs as the Steps level builds them, the pattern run record, the document
   fields, the reference maps). Each stage is done or not on its own; the next
   act is the first stage that is not done. Exporting leaves no record in the
   session, so the export stage is never shown done: it is the last act.
     runs:     at least one run is marked.
     pattern:  the pattern run is confirmed (pattern_run.confirmed_at).
     review:   no other run still has drafted steps (each is confirmed).
     document: every document field that fills a PDD placeholder is written.
     map:      a reference map is chosen as the PDD's As-Is map and its file
               is on disk. */
function pathState(sess) {
  const anno = (sess && sess.annotations) || {};
  const runs = RunsModel.buildRuns(sess && sess.stats, anno.steps || []).runs;
  const pattern = RunsModel.patternRun(anno, runs);
  const patternId = pattern.run ? pattern.run.caseId : null;
  const draftOther = runs.find((r) => r.caseId !== patternId && r.status === "draft") || null;
  const doc = documentStatus(anno.document);
  const asIs = RefStore.pddPick(anno, "as_is");
  const done = {
    runs: runs.length > 0,
    pattern: !!(pattern.run && pattern.record && pattern.record.confirmed_at),
    review: runs.length > 0 && !draftOther,
    document: doc.filled === doc.total,
    map: !!(asIs && sess && sess.sessionFolder && RefStore.fileExists(sess.sessionFolder, asIs)),
    export: false,
  };
  const next = PATH_STAGES.find((st) => !done[st.key]).key;
  return { done, next, runs, pattern: pattern.run, draftOther, doc };
}

/* The one button for the next act: its text and, where the text alone does
   not say enough, the sentence shown before it. */
function _nextAct(state) {
  switch (state.next) {
    case "runs":
      return { button: MARK_RUNS_BUTTON, say: NO_RUNS_MARKED + " " + MARK_RUNS_INSTRUCTION };
    case "pattern":
      return { button: state.pattern ? "Confirm " + state.pattern.title + " in Steps" : "Open the runs in Steps",
        title: "Check the pattern run's drafted steps, fix their boundaries and names, then click Confirm run." };
    case "review":
      return { button: "Review " + state.draftOther.title + " in Steps",
        title: "Check how this run differs from the pattern run, then click Confirm run." };
    case "document":
      return { button: "Fill the document sections",
        title: "Purpose, scope, contacts, rules and exceptions: the PDD prints them in place of its placeholders." };
    case "map":
      return { button: "Finish the As-Is map in Map",
        title: "Fork the process map, edit it, and choose it as the PDD's As-Is map." };
    default:
      return { button: "Export PDD",
        title: "Write the Process Definition Document (.docx) with the process map, the steps and the findings ticked below." };
  }
}

function _nextLineHtml(state) {
  const act = _nextAct(state);
  const stages = PATH_STAGES.map((st) => {
    const cls = state.done[st.key] ? "done" : (st.key === state.next ? "next" : "");
    return '<li class="ov-next-stage' + (cls ? " " + cls : "") + '" data-stage="' + st.key + '">' +
      (state.done[st.key] ? '<span class="ov-next-mark" aria-hidden="true">✓</span>' : "") +
      escapeHtml(st.label) + "</li>";
  }).join("");
  return '<div class="ov-next" id="ov-next" data-next="' + state.next + '">' +
    '<span class="ov-next-label">What is left</span>' +
    '<ol class="ov-next-stages">' + stages + "</ol>" +
    '<button type="button" class="primary" id="btn-ov-next" data-next-act="' + state.next + '"' +
      (act.title ? ' title="' + escapeAttr(act.title) + '"' : "") + ">" + escapeHtml(act.button) + "</button>" +
    (act.say ? '<div class="ov-next-say">' + escapeHtml(act.say) + "</div>" : "") +
    "</div>";
}

/* Land on the Steps level with `run` open: its first step is selected, so the
   arrival reveals it (the same arrival "Open in Steps" uses). */
function _openRunInSteps(run) {
  const first = run && ((run.visible && run.visible[0]) || (run.members && run.members[0]));
  if (first && first.step_id) State.setSelectedStepId(first.step_id);
  const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
  if (btn) btn.click();
}

/* Open the document sections and put the cursor in the first empty field. */
function _openDocument() {
  const panel = document.getElementById("ov-doc");
  if (!panel) return;
  panel.open = true;
  _docOpen = true;
  const st = documentStatus((State.getSession() && State.getSession().annotations || {}).document);
  const field = panel.querySelector('[data-doc="' + (st.firstEmpty || DOC_FIELDS[0].key) + '"]');
  if (field) {
    field.scrollIntoView({ block: "center" });
    field.focus();
  }
}

function _goNext(act) {
  const sess = State.getSession();
  if (!sess) return;
  const state = pathState(sess);
  if (act === "runs") { openMarkersInFlow(); return; }
  if (act === "pattern") { _openRunInSteps(state.pattern); return; }
  if (act === "review") { _openRunInSteps(state.draftOther); return; }
  if (act === "document") { _openDocument(); return; }
  if (act === "map") {
    const mapBtn = document.querySelector('.view-mode-btn[data-level="map"]');
    if (mapBtn) mapBtn.click();
    // Copies already made are listed, so one can be chosen as the As-Is map.
    if (RefStore.list(sess.annotations).length) require("../refmap-ui.js").showGallery(true);
    return;
  }
  _exportPdd();
}

function _wireNextLine(host) {
  const btn = host.querySelector("#btn-ov-next");
  if (btn) btn.addEventListener("click", () => _goNext(btn.dataset.nextAct));
}

/* ---- 2. Session summary ---------------------------------------------------- */

/* The recording in one line: its name, who recorded it, how long, its runs,
   and how many of its steps the analyst stands behind (confirmed, edited or
   added: the Steps level's meaning of Confirmed), counted live from the
   steps so the line agrees with the Steps level at once. */
function _summaryLine(sess, state) {
  const s = SessionSummary.computeSummary(sess);
  if (!s) return "";
  const steps = (((sess && sess.annotations) || {}).steps || []).filter((st) => st && st.state !== "hidden");
  const confirmed = steps.filter((st) => RunsModel.ANALYST_STATES.has(st.state)).length;
  const runs = state.runs.length;
  const name = s.engagementName || s.engagement;
  const parts = [
    '<strong class="ov-summary-name">' + escapeHtml(name) + "</strong>",
    "recorded by " + escapeHtml(s.worker),
    escapeHtml(formatDuration(s.durationMs)),
    '<span data-summary="runs">' + runs + (runs === 1 ? " run" : " runs") + "</span>",
    '<span data-summary="steps">' + confirmed + " of " + steps.length + " steps confirmed</span>",
  ];
  const analyzed = s.analyzedAt ? new Date(s.analyzedAt).toLocaleString() : "";
  const title = "Engagement " + (s.engagementName ? s.engagementName + " (" + s.engagement + ")" : s.engagement) +
    (analyzed ? " · analyzed " + analyzed : "");
  return '<div class="ov-summary-line" title="' + escapeAttr(title) + '">' + parts.join(" · ") + "</div>";
}

/* The warning lines, each only when there is something to say: the marker
   problems (with their fixes), files missing from the copy, and the checks
   that could not run (C12: said, never shown as a measured negative). */
function _summaryWarnings(sess) {
  const out = [];
  const problems = SessionSummary.detectMarkerProblems((sess && sess.events) || []);
  for (const p of problems) {
    const time = (p.timestamp || "").slice(11, 19);
    const label = p.label ? '"' + escapeHtml(p.label) + '"' : "(unlabeled)";
    let text = "", fix = "";
    if (p.kind === "dangling_start") {
      text = "Start " + label + " at " + time + " has no matching End.";
      fix = '<button class="summary-fix" data-fix="close-start">Close at session end</button>';
    } else if (p.kind === "orphan_end") {
      text = "End marker at " + time + " has no open Start to close.";
      if (p.eventId) {
        fix = '<button class="summary-fix" data-fix="delete-end" data-event-id="' +
          escapeAttr(p.eventId) + '">Remove this marker</button>';
      }
    } else if (p.kind === "short_case") {
      text = "Run " + label + " at " + time + " is only " + Math.round((p.durationMs || 0) / 1000) +
        "s long (accidental?)";
    }
    out.push('<div class="summary-problem"><span class="p-text">⚠ ' + text + "</span>" + fix + "</div>");
  }
  const integ = sess && sess.integrity;
  if (integ && integ.missing && integ.missing.length) {
    const n = integ.missing.length;
    const names = integ.missing.slice(0, 6).map(escapeHtml).join(", ");
    out.push('<div class="summary-problem"><span class="p-text">⚠ ' + n + " file" + (n === 1 ? "" : "s") +
      " recorded in this session " + (n === 1 ? "is" : "are") + " missing (the session may have been " +
      "copied incompletely): " + names + (n > 6 ? ", …" : "") + ".</span></div>");
  }
  const analysis = (sess && sess.analysis) || {};
  if (!analysis.case_quality) {
    const err = _stageError(analysis, "case_quality");
    if (err) {
      out.push('<div class="analysis-note ov-stage-not-run">' + escapeHtml("The run check could not run " +
        "on this recording, so the runs are not compared and the Map is not shown. Click Analyze " +
        "session again; if it still fails, the analysis log names the problem.") + "</div>" + _technicalDetail(err));
    }
  }
  if (analysis.facts === null) {
    out.push('<div class="analysis-note ov-stage-not-run">' + escapeHtml(STAGE_NOT_RUN +
      ": the measured facts (active and idle time, app switches, re-typed values) are missing, " +
      "not zero. Click Analyze session again; if it still fails, the analysis log names the problem.") +
      "</div>" + _technicalDetail(_stageError(analysis, "facts")));
  }
  return out.join("");
}

function _summaryHtml(sess, state) {
  const line = _summaryLine(sess, state);
  const warn = _summaryWarnings(sess);
  if (!line && !warn) return "";
  return '<div class="ov-summary" id="ov-summary">' + line +
    (warn ? '<div class="ov-summary-warn">' + warn + "</div>" : "") + "</div>";
}

function _wireSummary(host) {
  host.querySelectorAll("#ov-summary .summary-fix").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      // Lazy require: flow-view requires this module at load.
      const Flow = require("./flow-view.js");
      let saved = false;
      if (btn.dataset.fix === "close-start") {
        const evs = (State.getSession() && State.getSession().events) || [];
        if (evs.length) saved = await Flow.queueSyntheticMarker(evs[evs.length - 1].timestamp, "end");
      } else if (btn.dataset.fix === "delete-end") {
        saved = await Flow.queueMarkerDelete(btn.dataset.eventId);
      }
      if (saved) btn.textContent = "Done (pending): analyze to apply";
      else btn.disabled = false;
    });
  });
}

/* ---- 3. Findings feed --------------------------------------------------- */

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
  // §D2: the card itself is the shared finding-card component.
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
    // controls) toggles the evidence body inline: no navigation.
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

/* The missing inputs. A recording with no runs marked is not listed: the
   what-is-left line says it, with its button. */
function _toSayMore(analysis, anno) {
  const items = [];
  // C12: a failed case check or facts stage says nothing about runs or idle
  // time, so neither gap is claimed from a null block.
  const cq = analysis.case_quality;
  if (cq && !cq.tier2_unlocked && cq.mode && cq.mode !== "unsegmented" && (cq.case_count || 0) >= 1) {
    const n = cq.case_count || 0;
    items.push(n < 2
      ? "Only 1 run is marked: comparing runs needs at least 2, so recording one more run " +
        "(or marking another in this recording) would show how long each run takes and how the runs differ."
      : "The marked runs cover only " + _pct(cq.coverage) + " of the recording, below the 70% needed " +
        "to compare them: marking the rest of the work as runs would show how long each run takes " +
        "and how the runs differ.");
  }
  if (analysis.facts && !analysis.facts.idle_ms) {
    items.push("No idle time was measured: time spent waiting inside an " +
      "app without typing or clicking is invisible to this recording.");
  }
  const hasBnva = ((anno || {}).analysis_overrides || []).some(
    (ov) => ov && ov.bnva_ms !== undefined && ov.bnva_ms !== null);
  if (!hasBnva) {
    items.push("Saying how much of the time added value needs an analyst " +
      "to judge each step type first (Evidence → Where the time goes, above); " +
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

/* ---- 6. Document sections (contract C6) ------------------------------------ */

/* Whether the analyst opened the document sections: kept across re-renders
   (an undo, a re-analysis) for the session on screen; closed by default. */
let _docOpen = false;
let _docFolder = null;

function _documentStatusText(st) {
  return st.filled + " of " + st.total + " filled";
}

function _documentHtml(anno) {
  const doc = (anno && anno.document) || null;
  const st = documentStatus(doc);
  const fields = DOC_FIELDS.map((f) => {
    const value = _docValue(doc, f.key);
    const input = f.line
      ? '<input type="text" class="ov-doc-input" data-doc="' + f.key + '" value="' + escapeAttr(value) + '" />'
      : '<textarea class="ov-doc-input" data-doc="' + f.key + '" rows="3">' + escapeHtml(value) + "</textarea>";
    return '<label class="ov-doc-field">' +
      '<span class="ov-doc-label">' + escapeHtml(f.label) + (f.optional ? ' <span class="ov-doc-optional">optional</span>' : "") + "</span>" +
      '<span class="ov-doc-where">In the PDD: ' + escapeHtml(f.where) + "</span>" +
      input + "</label>";
  }).join("");
  // The same disclosure as the Evidence modules (.analysis-module): a title,
  // a one-line status that shows while it is closed, and a chevron.
  return '<details class="analysis-section analysis-module ov-doc" id="ov-doc"' + (_docOpen ? " open" : "") + ">" +
    '<summary class="analysis-module-head" title="The PDD prints each field you write in place of its ' +
      'placeholder; the fields are kept for every later export.">' +
      '<span class="analysis-module-title">Document sections</span>' +
      '<span class="analysis-module-takeaway" id="ov-doc-status">' + escapeHtml(_documentStatusText(st)) + "</span>" +
      '<span class="analysis-module-chevron" aria-hidden="true"></span>' +
    "</summary>" +
    '<div class="analysis-module-body ov-doc-body">' + fields + "</div></details>";
}

/* Save one field through the one write path (persistAnnotations: undoable,
   one entry per field). The panel stays as it is (no re-render, so typing in
   the next field goes on); the status and the what-is-left line update in
   place. An undo or a re-analysis re-renders the Overview with the values
   on disk. */
async function _saveDocField(key, value) {
  const sess = State.getSession();
  if (!sess) return;
  const anno = sess.annotations || {};
  const cur = (anno.document && typeof anno.document === "object") ? anno.document : {};
  if (_docValue(cur, key) === value) return;
  const next = {};
  for (const f of DOC_FIELDS) next[f.key] = _docValue(cur, f.key);
  // Keys a later contract adds are kept as they are.
  for (const k of Object.keys(cur)) if (!(k in next)) next[k] = cur[k];
  next[key] = value;
  anno.document = next;
  const field = DOC_FIELDS.find((f) => f.key === key);
  try {
    await persistAnnotations(anno, "edit document section " + (field ? field.label : key), []);
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  _refreshPathInPlace();
}

/* Update the what-is-left line and the document status without re-rendering
   the rest of the Overview. */
function _refreshPathInPlace() {
  const sess = State.getSession();
  const host = document.getElementById("overview-content");
  if (!sess || !host) return;
  const state = pathState(sess);
  const line = host.querySelector("#ov-next");
  if (line) {
    line.outerHTML = _nextLineHtml(state);
    _wireNextLine(host);
  }
  const status = host.querySelector("#ov-doc-status");
  if (status) status.textContent = _documentStatusText(state.doc);
}

function _wireDocument(host) {
  const panel = host.querySelector("#ov-doc");
  if (!panel) return;
  panel.addEventListener("toggle", () => { _docOpen = panel.open; });
  panel.querySelectorAll("[data-doc]").forEach((el) => {
    el.addEventListener("change", () => _saveDocField(el.dataset.doc, el.value));
  });
}

/* ---- Export -------------------------------------------------------------- */

/* AD-13: the what-is-left line's last act is the PDD. It clicks the Session
   menu's Export > PDD item (#btn-session-pdd, wired in renderer.js), so the
   Overview and the menu share one export path. */
function _exportPdd() {
  const pdd = document.getElementById("btn-session-pdd");
  if (!pdd) { toast("The PDD export is not available in this window.", "error"); return; }
  pdd.click();
}

/* ---- Render -------------------------------------------------------------- */

/* Whether analysis.json carries the Overview's blocks at all: the case check
   ran, or it is named as a failed stage (C12). */
function _hasOverview(analysis) {
  return !!(analysis && (analysis.case_quality || _stageError(analysis, "case_quality")));
}

/* The Overview HTML for one session ({ analysis, annotations, stats,
   manifest, events, sessionFolder, integrity }). Pure (no DOM, no State), so
   the unit tests render fixture sessions through the same code. */
function overviewHtml(sess) {
  const analysis = sess && sess.analysis;
  if (!_hasOverview(analysis)) {
    return '<div class="analysis-empty">No analysis yet: click ' +
      "<strong>Analyze session</strong> above to compute the runs, the measured " +
      "facts and the findings this Overview shows. (Sessions analyzed " +
      "before this version need one re-analyze.)</div>";
  }
  const anno = (sess && sess.annotations) || {};
  const state = pathState(sess);
  let html = _nextLineHtml(state);
  html += _summaryHtml(sess, state);
  html += _findingsFeed(analysis.findings, anno.memo_selection, analysis);
  // R4 (Task 2): the retired Analysis modules, as Evidence, BELOW the findings.
  html += _evidenceSection();
  html += _toSayMore(analysis, anno);
  html += _documentHtml(anno);
  return html;
}

function renderOverviewLevel() {
  const host = document.getElementById("overview-content");
  if (!host) return;
  const sess = State.getSession();
  if (!sess) { host.innerHTML = ""; return; }
  if (_docFolder !== sess.sessionFolder) { _docFolder = sess.sessionFolder; _docOpen = false; }
  host.innerHTML = overviewHtml(sess);
  if (!_hasOverview(sess.analysis)) return;   // the "not analyzed yet" note has nothing to wire

  _wireNextLine(host);
  _wireSummary(host);
  _wireFindings(host);
  // Fill the Evidence host with the analysis modules (own wiring + collapse
  // persistence). Kept after innerHTML so the modules render into the live host.
  renderEvidenceInto(host.querySelector("#overview-evidence"));
  _wireDocument(host);
}

module.exports = {
  renderOverviewLevel, openMarkersInFlow, overviewHtml, pathState, documentStatus, mapLockHtml,
  DOC_FIELDS, NO_RUNS_MARKED, MARK_RUNS_INSTRUCTION, MARK_RUNS_BUTTON, STAGE_NOT_RUN,
};
