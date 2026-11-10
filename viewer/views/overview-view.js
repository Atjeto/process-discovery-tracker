/*
 * overview-view.js: the Overview level of the Session view, the home of a
 * loaded project (BA-helper cycle, plan section 5; step-back review 4.4;
 * companion critique section 2). The default level on load. The words are
 * the owner's (AD-29): a run is a "transaction" and what the analyst opens is
 * a "project" wherever a person reads them; code and data keep run and
 * session. One column, top to bottom:
 *   1. the Checklist: the analyst path's acts, fitted to the project (a
 *      recording: mark the transactions, confirm the reference transaction,
 *      review the other transactions; a project made from a video or from
 *      nothing: add the steps, write the steps, and review the other
 *      transactions only with two or more; then, for both, write the
 *      document and hand off), each ticked or not from the session data
 *      alone, each with a tooltip that says what it means, and ONE button for
 *      the next act. Once every act before the hand-off is done it shrinks to
 *      one short line, so the home leads with the document. The As-Is map is
 *      not an act (AD-28): the PDD embeds the edited As-Is copy when there is
 *      one, else the process map (process_map_step.bpmn).
 *   2. the project line: the project (or, once written, the document title),
 *      who recorded it, its transactions, the reference transaction's steps,
 *      and the video and the transcript, each with its Attach; plus a warning
 *      line only when a marker problem, a missing file, a check that could
 *      not run or an app recorded with less detail needs one.
 *   3. the document: annotations.document (contract C6), the PDD's
 *      document-level fields, which the analyst writes and the PDD prints,
 *      and the sentences of an attached transcript; collapsed, with a
 *      one-line status that names the empty fields (open by default once
 *      every act is done).
 * Until the project is analyzed (the analysis runs by itself, AD-22) the
 * home is one note that says where the analysis is, and the project line.
 */

"use strict";

const State = require("../state.js");
const { escapeHtml, escapeAttr, toast, placeMenu, recordingStartMs, sinceStart } = require("../dom.js");
const TM = require("../transcript-model.js");
const { persistAnnotations } = require("../session.js");
const RunsModel = require("../runs-model.js");
const RunDiff = require("../run-differences.js");
const SessionSummary = require("../session-summary.js");
const { pushRecent } = require("../recent.js");
const AnalystUI = require("./analyst-ui.js");
const { isVideoCopy } = require("../analyst-files.js");
const VideoChain = require("../video-chain.js");
const AsIsFresh = require("../asis-freshness.js");
const AC = require("../analyst-content.js");
const RO = require("../read-only.js");
const Handoff = require("../handoff.js");

/* ---- Stage failures (contract C12, RP-10) -------------------------------- */

/* A pipeline stage that failed is named in analysis.stage_errors
   ([{ stage, error }]) and its output key is null. The Overview says the
   check could not run; it never renders that as a measured negative. */
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

/* Where a stuck analysis is run again (no global Analyze button, AD-22). */
const REANALYZE_WHERE = "Help, Troubleshooting has Re-analyze";

/* ---- The mark-transactions sentence and verb ------------------------------ */

/* AD-14: with no run markers there are no runs (transactions, AD-29). One
   plain instruction and one button that opens the Timeline with the Markers
   panel showing. The Map level's lock message (mapLockHtml below) and the
   Steps level use the same sentence and the same verb, so the surfaces
   cannot drift apart. */
const NO_RUNS_MARKED = "This recording has no transactions marked.";
const MARK_RUNS_INSTRUCTION = "On the Timeline, right-click where each transaction starts and " +
  "choose Start a transaction here, then click Apply marker changes.";
const MARK_RUNS_BUTTON = "Mark the transactions on the Timeline";

/* Switch to the Timeline level and show its Markers panel, scrolled on screen
   (an arrival the analyst asked for). Lazy require: flow-view requires this
   module at load, so a top-level require would be a cycle. */
function openMarkersInFlow() {
  const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (flowBtn) flowBtn.click();
  require("./flow-view.js").activateAnnoTab("markers");
  const panel = document.querySelector('.anno-panel[data-panel="markers"]');
  if (panel) panel.scrollIntoView({ block: "nearest" });
}

/* ---- Waiting for the analysis ---------------------------------------------- */

/* What a page that waits for an analysis says, given the run state of the
   recording on screen (State.getAnalysisRun(): { folder, status } or null)
   and whether its analysis is only older (`stale`). Pure. */
function waitingSentence(run, stale) {
  const status = run && run.status;
  if (status === "running") return "The steps and the map are being drafted from the recording.";
  if (status === "failed") return "The analysis failed, so the steps and the map are not drafted. The log at the top says why; " +
    REANALYZE_WHERE + ".";
  if (status === "cancelled") return "The analysis was cancelled, so the steps and the map are not drafted. " +
    REANALYZE_WHERE + ".";
  return (stale ? "This project was analyzed by an older version, so the steps and the map are not up to date. "
    : "This project is not analyzed yet. ") + REANALYZE_WHERE + ".";
}

/* The run state of `sess` (null when the last run was for another recording). */
function _runOf(sess) {
  const run = State.getAnalysisRun();
  return run && sess && run.folder === sess.sessionFolder ? run : null;
}

/* ---- The Map level's lock message ---------------------------------------- */

/* The HTML the Map level shows instead of the process map, or null when the
   map can be drawn. The map draws how the runs flow, so it needs the run
   check to have run and at least one run to be marked. AD-18: one run is
   enough, and so is any coverage. Each state says what actually happened:
   not analyzed yet (or being analyzed, or the analysis failed), analyzed by
   an older version, the run check failed, or no runs marked. `run` is the
   recording's analysis run state (waitingSentence). */
function mapLockHtml(analysis, run) {
  const lead = "The process map is not shown because it draws how the transactions flow. ";
  if (!analysis) return escapeHtml(lead + waitingSentence(run, false));
  const cq = analysis.case_quality;
  if (!cq) {
    const err = _stageError(analysis, "case_quality");
    if (err) {
      return escapeHtml(lead + "The transaction check could not run on this recording, so the " +
        "transactions are not known. " + REANALYZE_WHERE + "; if it fails again, the analysis log names " +
        "the problem.") + _technicalDetail(err);
    }
    return escapeHtml(lead + waitingSentence(run, true));
  }
  if (cq.mode !== "unsegmented" && (cq.case_count || 0) >= 1) return null;
  return escapeHtml(lead + NO_RUNS_MARKED + " " + MARK_RUNS_INSTRUCTION) +
    ' <button type="button" class="link-btn" data-map-cta="mark-runs">' +
    escapeHtml(MARK_RUNS_BUTTON) + "</button>";
}

/* What the Map says (plain text) when the transactions are known but no
   step can be drawn. A project with no steps yet (a blank one, C16, has its
   one transaction from the start) is told to add them, never that its
   transactions are not marked; one whose steps are all hidden, or all
   outside the transactions, is told none is visible. `steps`:
   annotations.steps. */
const NO_STEPS_YET = "No steps yet: add steps in Steps to build the map.";
const NO_VISIBLE_STEPS = "No steps to draw yet: the transactions have no visible steps. " +
  "Add or unhide steps in the Steps view.";
function mapEmptyText(steps) {
  return Array.isArray(steps) && steps.length ? NO_VISIBLE_STEPS : NO_STEPS_YET;
}

/* ---- 1. The Checklist ------------------------------------------------------ */

/* The document fields (contract C6, with trigger, result and improvement as
   the pipeline lane defines them) in the order the PDD reads them, each with
   where it appears (the field's tooltip) and the short question an empty
   field asks (its placeholder). `optional`: an empty field leaves no gap in
   the PDD (its section is simply left out), so it does not count as left to
   do. */
const DOC_FIELDS = [
  { key: "title", label: "Title", where: "the title and Document control", ask: "What is the process called?", line: true },
  { key: "request", label: "Request", where: "Document control: Request", ask: "Which request is this for? Its name and code", line: true, optional: true },
  { key: "purpose", label: "Purpose", where: "Purpose", ask: "Why is the process done, and for whom?" },
  { key: "scope", label: "Scope", where: "Scope", ask: "Where does it start and end, and what is left out?" },
  { key: "trigger", label: "Trigger", where: "Trigger: what starts the process", ask: "What starts the process?" },
  { key: "result", label: "Result", where: "Result: what the process ends with", ask: "What does the process end with?" },
  { key: "contacts", label: "Key contacts", where: "Key contacts", ask: "Who owns the process, and who can answer questions?" },
  { key: "business_rules", label: "Business rules", where: "Business rules and exceptions", ask: "Which rules decide what happens?" },
  { key: "exceptions", label: "Exceptions", where: "Business rules and exceptions", ask: "What goes differently, and how is it handled?" },
  { key: "effort", label: "Volume and effort", where: "Volume and effort", ask: "How often is the process done, and how long does one take?" },
  { key: "improvement", label: "Improvement and automation scope", where: "Improvement and automation scope", ask: "What could be improved or automated?" },
  { key: "notes", label: "Notes", where: "the last section, printed only when written", ask: "Anything else the PDD should say?", optional: true },
];

function _docValue(doc, key) {
  const v = doc && typeof doc === "object" ? doc[key] : "";
  return typeof v === "string" ? v : "";
}

/* How many of the document fields that fill a PDD placeholder are written,
   and which are still empty (`missing`: their labels, in the PDD's order). */
function documentStatus(doc) {
  const counted = DOC_FIELDS.filter((f) => !f.optional);
  const filled = counted.filter((f) => _docValue(doc, f.key).trim()).length;
  const missing = counted.filter((f) => !_docValue(doc, f.key).trim()).map((f) => f.label);
  // The cursor goes to the first empty field that counts: an optional one
  // (the request, the notes) is never owed.
  const firstEmpty = counted.find((f) => !_docValue(doc, f.key).trim()) || null;
  return { filled, total: counted.length, missing, firstEmpty: firstEmpty ? firstEmpty.key : null };
}

/* The Checklist's acts, in the analyst path's order: each item names the act
   and its tooltip says what it means and when it is ticked (AD-29). The acts
   fit the project: `recording` true lists an act only for a recording (its
   steps are drafted), false only for a project made from a video or from
   nothing (its steps are added by hand), absent for both. */
const PATH_STAGES = [
  { key: "runs", label: "Mark the transactions", recording: true,
    title: "A transaction is one pass through the process. Each starts at a start marker: the SME's transaction key " +
      "sets one, or you add one on the Timeline. A project without a recording is one transaction from the start. " +
      "Ticked once there is at least one transaction." },
  { key: "steps", label: "Add the steps", recording: false,
    title: "Add the steps of the process: on the Timeline, at the moments of the video (+ Step, or S), or in Steps " +
      "with + Add step. Ticked once there is a step." },
  { key: "written", label: "Write the steps", recording: false,
    title: "Give each step a name of its own and a description: the PDD prints them. Ticked once every step has both." },
  { key: "pattern", label: "Confirm the reference transaction", recording: true,
    title: "In Steps, check the reference transaction's drafted steps (transaction 1 unless you pick another), fix " +
      "their boundaries and names, then click Confirm transaction. Ticked once it is confirmed, or once none of its " +
      "steps is a draft." },
  // Without a recording, listed only when the project has two or more
  // transactions: one has no other to review.
  { key: "review", label: "Review the other transactions",
    title: "Open each other transaction in Steps: it lists how it differs from the reference transaction. The other " +
      "transactions are not confirmed. Ticked once each transaction that differs from the reference transaction " +
      "has been opened." },
  { key: "document", label: "Write the document",
    title: "Write the document fields on this page: you write them, and the PDD prints them. Ticked once every " +
      "field but Notes is written." },
  // Lane FX2: listed only while the As-Is map the PDD prints was made
  // before the steps changed (asis-freshness.js); not an act otherwise
  // (AD-28: the As-Is map is not a stage).
  { key: "asis", label: "Check the As-Is map", onlyWhenDue: true,
    title: "The As-Is map was made before the steps changed: check it, or Copy again. On the Map, Edit opens it; " +
      "Copy again makes a new copy of the process map as it is now, which then takes its place in the PDD." },
  { key: "handoff", label: "Hand off",
    title: "Hand this version of the project to the developers: one zip with the project, the PDD and the process " +
      "map. Ticked once a version was handed off." },
];

/* Lane FX2: the Checklist's line while the As-Is map is older than the steps. */
const ASIS_STALE = "The As-Is map was made before the steps changed: check it, or Copy again.";

/* The name + Step and + Add step give a new step ("Step 12", steps-view.js
   nextStepName): no name of its own. */
const NUMBERED_STEP = /^Step (\d+)$/;

/* Whether a step has a name of its own and a description, the two things the
   PDD prints for it. */
function _stepWritten(s) {
  const name = typeof (s && s.name) === "string" ? s.name.trim() : "";
  const desc = typeof (s && s.description) === "string" ? s.description.trim() : "";
  return !!name && !NUMBERED_STEP.test(name) && !!desc;
}

/* The analyst path's state, derived from the session data alone (pure: the
   runs as the Steps level builds them, the reference run record, the runs
   opened, the document fields, the hand-offs). Each stage is done or not on
   its own; the next act is the first stage that is not done, else the
   hand-off (it can always be made again).
     runs:     at least one run is marked (a recording).
     steps:    the project has a visible step (no recording).
     written:  every visible main-level step of the reference run has a name
               of its own and a description (no recording).
     pattern:  the reference run is confirmed (pattern_run.confirmed_at) and
               no level below its main one holds a draft (C19), or it has a
               step and holds no draft at any level: nothing to confirm
               (a recording).
     review:   every other run that differs from the reference run has been
               opened in Steps, where its differences show
               (annotations.opened_runs; AD-28: the other runs are not
               confirmed). Without a recording it is listed only with two or
               more runs.
     document: every document field that fills a PDD placeholder is written.
     handoff:  annotations.handoffs holds a version.
   `stages` the keys listed for this project, `ready`: every stage before
   the hand-off is done (the line shrinks). `nextOther` is the other run to
   review next: the first not opened yet that differs from the reference
   run, else the first not opened yet (lane FX1); `nextDiffers` whether it
   differs, `differing` how many of the other runs differ from the reference
   run. `unwritten` the reference run's visible steps without a name of their
   own or a description, `handedOff` the latest hand-off entry or null. */
function pathState(sess) {
  const anno = (sess && sess.annotations) || {};
  const recording = AC.hasRecording(sess);
  const runs = RunsModel.buildRuns(sess && sess.stats, anno.steps || []).runs;
  const pattern = RunsModel.patternRun(anno, runs);
  const patternId = pattern.run ? pattern.run.caseId : null;
  const opened = new Set(Array.isArray(anno.opened_runs) ? anno.opened_runs : []);
  const others = runs.filter((r) => r.caseId !== patternId);
  // Compared as Steps compares them: a reference step inside a stretch left
  // out of the analysis is not a difference, nor is the left-out line, nor a
  // step that happens only under a condition and was not done.
  const excluded = Array.isArray(anno.excluded_ranges) ? anno.excluded_ranges : [];
  const differs = new Set(pattern.run ? others.filter((r) => RunDiff.differenceCount(RunDiff.differences(
    pattern.run.visible, r.visible,
    { leftOut: RunDiff.leftOutStretches(excluded, { startMs: r.startMs, endMs: r.endMs }) })) > 0)
    .map((r) => r.caseId) : []);
  const unopened = others.filter((r) => !opened.has(r.caseId));
  const nextOther = unopened.find((r) => differs.has(r.caseId)) || unopened[0] || null;
  const differing = differs.size;
  const doc = documentStatus(anno.document);
  const refSteps = pattern.run ? pattern.run.visible : [];
  const unwritten = refSteps.filter((s) => !_stepWritten(s));
  const handedOff = Handoff.latest(anno);
  const all = {
    runs: runs.length > 0,
    steps: (Array.isArray(anno.steps) ? anno.steps : []).some((s) => s && typeof s === "object" && s.state !== "hidden"),
    written: refSteps.length > 0 && !unwritten.length,
    // Nothing to confirm is nothing owed: a reference run with a step and no
    // draft at any level reads done without a Confirm click.
    pattern: !!pattern.run && (RunsModel.patternConfirmed(pattern.record, pattern.run) ||
      (pattern.run.visible.length > 0 && !RunsModel.holdsDraft(pattern.run.members))),
    review: runs.length > 0 && !unopened.some((r) => differs.has(r.caseId)),
    document: doc.filled === doc.total,
    // Lane FX2: the As-Is map the PDD prints was made before the steps changed.
    asis: !AsIsFresh.chosenAsIsStale(sess),
    handoff: !!handedOff,
  };
  const stages = PATH_STAGES.filter((st) => (st.recording === undefined || st.recording === recording) &&
    (st.key !== "review" || recording || runs.length >= 2)).map((st) => st.key);
  const done = {};
  for (const k of stages) done[k] = all[k];
  const next = stages.find((k) => !done[k]) || "handoff";
  // Lane FX2: a project without start markers has one implicit transaction.
  const implicit = !!AC.implicitRunId(sess && sess.stats);
  return { recording, stages, done, next, ready: next === "handoff", runs, pattern: pattern.run, nextOther,
    nextDiffers: !!(nextOther && differs.has(nextOther.caseId)), differing, doc, asIsStale: !all.asis, implicit,
    unwritten, refStepCount: refSteps.length, handedOff, video: _hasVideo(sess) };
}

/* Whether the project has a video to mark its steps on. */
function _hasVideo(sess) {
  return !!(sess && (sess.recordingAvailable || VideoChain.clipsOf(sess.annotations).length > 0));
}

const HANDOFF_BUTTON = "Hand off...";
const HANDOFF_BUTTON_TITLE = "Hand this version of the project to the developers: one zip next to the project " +
  "folder with the project, the PDD and the process map. It starts the Export menu's Hand off.";

/* The one button for the next act: its text and, where the text alone does
   not say enough, the sentence shown before it. A transaction's title reads
   lower case inside a sentence ("Review transaction 2 in Steps"). */
function _nextAct(state) {
  switch (state.next) {
    case "runs":
      return { button: MARK_RUNS_BUTTON, say: NO_RUNS_MARKED + " " + MARK_RUNS_INSTRUCTION };
    case "steps":
      return state.video
        ? { button: "Mark the steps on the Timeline", act: "steps-timeline",
          say: "Play the video and press S, or click + Step, where each step starts." }
        : { button: "Add the steps in Steps", act: "steps-list", say: "Click + Add step for each step of the process." };
    case "written": {
      const n = state.unwritten.length;
      return { button: "Write the steps in Steps",
        title: "Steps opens with the first step that has no name of its own or no description selected.",
        say: n + " of " + _plural(state.refStepCount, "step", "steps") + " " +
          (n === 1 ? "has no name of its own" : "have no name of their own") + " or no description." };
    }
    case "pattern":
      return { button: state.pattern ? "Confirm " + state.pattern.title.toLowerCase() + " in Steps" : "Open the transactions in Steps",
        title: "Check the reference transaction's drafted steps, fix their boundaries and names, then click Confirm transaction." };
    case "review":
      // The review is owed only while a transaction that differs is not
      // opened yet, and the button opens one of those (lane FX1).
      return { button: "Review " + state.nextOther.title.toLowerCase() + " in Steps",
        title: "Open the transaction to see how it differs from the reference transaction. The other transactions are not confirmed.",
        say: _plural(state.differing, "transaction differs", "transactions differ") + " from the reference transaction." };
    case "document":
      return { button: "Write the document",
        title: "Purpose, scope, trigger, result, contacts, rules, exceptions and the improvement and automation scope: you write them, and the PDD prints them in place of its placeholders." };
    case "asis":
      return { button: "Check the As-Is map", say: ASIS_STALE,
        title: "Open the Map: Edit the As-Is map to match the steps, or Copy again for a new copy of the process map as it is now." };
    default:
      return { button: HANDOFF_BUTTON, title: HANDOFF_BUTTON_TITLE };
  }
}

/* The short line once every act before the hand-off is done. */
function _readyText(state) {
  const v = state.handedOff;
  if (!v) return "Everything before the hand-off is done.";
  const date = Handoff.entryDate(v);
  return "Version " + v.version + " was handed off" + (date ? " on " + date : "") + ". Hand off again after a change.";
}

function _nextLineHtml(state) {
  const act = _nextAct(state);
  const button = '<button type="button" class="primary" id="btn-ov-next" data-next-act="' + (act.act || state.next) + '"' +
    (act.title ? ' title="' + escapeAttr(act.title) + '"' : "") + ">" + escapeHtml(act.button) + "</button>";
  if (state.ready) {
    // Every act before the hand-off is done: one short line.
    return '<div class="ov-next ov-next-ready" id="ov-next" data-next="handoff">' +
      '<span class="ov-next-label">Checklist</span>' +
      '<span class="ov-next-ready-text">' + escapeHtml(_readyText(state)) + "</span>" +
      button + "</div>";
  }
  const stages = PATH_STAGES.filter((st) => state.stages.includes(st.key) && (!st.onlyWhenDue || !state.done[st.key])).map((st) => {
    const cls = state.done[st.key] ? "done" : (st.key === state.next ? "next" : "");
    // Lane FX2: the implicit transaction reads as it does everywhere.
    const label = st.key === "runs" && state.implicit ? AC.IMPLICIT_TRANSACTION : st.label;
    return '<li class="ov-next-stage' + (cls ? " " + cls : "") + '" data-stage="' + st.key + '" title="' +
      escapeAttr(st.title) + '">' +
      (state.done[st.key] ? '<span class="ov-next-mark" aria-hidden="true">✓</span>' : "") +
      escapeHtml(label) + "</li>";
  }).join("");
  return '<div class="ov-next" id="ov-next" data-next="' + state.next + '">' +
    '<span class="ov-next-label">Checklist</span>' +
    '<ol class="ov-next-stages">' + stages + "</ol>" + button +
    (act.say ? '<div class="ov-next-say">' + escapeHtml(act.say) + "</div>" : "") +
    "</div>";
}

/* Land on the Steps level with `stepId` selected, so the arrival reveals it
   (the same arrival "Open in Steps" uses). */
function _openStepInSteps(stepId) {
  if (stepId) State.setSelectedStepId(stepId);
  const btn = document.querySelector('.view-mode-btn[data-level="steps"]');
  if (btn) btn.click();
}

/* Land on the Steps level with `run` open: its first step is selected. */
function _openRunInSteps(run) {
  const first = run && ((run.visible && run.visible[0]) || (run.members && run.members[0]));
  _openStepInSteps(first && first.step_id);
}

/* Lane FX2: the Map, where the As-Is map shows with its Edit and Copy again. */
function _openMap() {
  const btn = document.querySelector('.view-mode-btn[data-level="map"]');
  if (btn) btn.click();
}

/* The Timeline, where the steps are marked at the moments of the video. */
function _openTimeline() {
  const btn = document.querySelector('.view-mode-btn[data-level="flow"]');
  if (btn) btn.click();
}

/* Open the document and put the cursor in the first empty field. */
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
  if (act === "steps-timeline") { _openTimeline(); return; }
  if (act === "steps-list") { _openStepInSteps(null); return; }
  if (act === "written") { _openStepInSteps(state.unwritten[0] && state.unwritten[0].step_id); return; }
  if (act === "pattern") { _openRunInSteps(state.pattern); return; }
  if (act === "review") { _openRunInSteps(state.nextOther); return; }
  if (act === "document") { _openDocument(); return; }
  if (act === "asis") { _openMap(); return; }
  _handOff();
}

function _wireNextLine(host) {
  const btn = host.querySelector("#btn-ov-next");
  if (btn) btn.addEventListener("click", () => _goNext(btn.dataset.nextAct));
}

/* ---- 2. The project line ----------------------------------------------------- */

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* The video and the transcript, each with the act that attaches it (the
   Attach video flow syncs it with two clicks, flow-view-video.attachVideo;
   the transcript acts are delegated by id in flow-view-transcript.js).
   C23 (2.0.6): a project holds several of each. One video: Replace, Remove
   and Add another; several: how many, and Add (each one's acts are on the
   Timeline's Videos lane). The same for the transcripts (each one's acts on
   the Transcript lane). */
function _mediaParts(sess) {
  const clips = VideoChain.clipsOf(sess && sess.annotations);
  const found = new Set(((sess && sess.videos) || []).filter((v) => v && v.path).map((v) => v.id));
  const nameOf = (c) => String(c.path || "").split(/[\\/]/).filter(Boolean).pop() || "video";
  const addTitle = "Add a video" + ((sess && (sess.events || []).length)
    ? ": the first is placed with two clicks, a moment in the video and the same moment on the timeline."
    : ": it goes after the last one, back to back.");
  let video;
  if (clips.length > 1) {
    const missing = clips.filter((c) => !found.has(c.id)).length;
    video = '<span data-summary="video" title="' + escapeAttr(clips.map((c, i) => (i + 1) + ". " + nameOf(c) +
        (found.has(c.id) ? "" : " (not found)")).join("\n")) + '">' + clips.length + " videos" +
        (missing ? ", " + missing + " not found" : "") + "</span> " +
      '<button type="button" class="link-btn" id="btn-add-video" title="' + escapeAttr(addTitle) + '">Add</button>';
  } else if (clips.length === 1 && found.has(clips[0].id)) {
    // Remove (lane CC), Attach's inverse: only for the video the analyst attached.
    const copy = isVideoCopy(clips[0].path);
    video = '<span data-summary="video">Video</span> <button type="button" class="link-btn" id="btn-attach-video" data-clip="' +
        escapeAttr(clips[0].id) + '" title="' + escapeAttr("Put another video in place of this one" +
        ((sess.events || []).length ? ", then sync it: click a moment in the video, then the same moment on the timeline." : ".") +
        (copy ? " The copy it replaces leaves the project folder; Ctrl+Z brings it back." : " Ctrl+Z brings this one back.")) + '">Replace</button>' +
      ' <button type="button" class="link-btn" id="btn-remove-video" data-clip="' + escapeAttr(clips[0].id) + '" title="' +
        escapeAttr("Take the video out of this project" + (copy ? ": its copy in the project's video folder is deleted." : ".") +
          " Ctrl+Z brings it back.") + '">Remove</button>' +
      ' <button type="button" class="link-btn" id="btn-add-video" title="' + escapeAttr(addTitle) + '">Add another</button>';
  } else if (!clips.length && sess && sess.recordingAvailable) {
    // The recording's own video: another takes its place.
    video = '<span data-summary="video">Video</span> <button type="button" class="link-btn" id="btn-attach-video" ' +
      'title="' + escapeAttr("Attach another video in place of this one, then sync it: click a moment in the video, then the same moment on the timeline.") + '">Replace</button>';
  } else {
    // None, or the one video's file is not found here (Attach finds it: it keeps its place).
    video = '<span data-summary="video">No video</span> <button type="button" class="link-btn" id="btn-attach-video" ' +
      'title="Attach a video of the recording (a Teams recording or a screen video), then sync it: click a moment in the video, then the same moment on the timeline.">Attach</button>';
  }
  const parts = TM.transcriptsOf(sess);
  let transcript;
  if (parts.length > 1) {
    transcript = '<span data-summary="transcript">' + parts.length + " transcripts</span> " +
      '<button type="button" class="link-btn" id="btn-add-transcript" title="' + escapeAttr(TM.ADD_TITLE) + '">Add</button>';
  } else if (parts.length || (sess && sess.transcriptError)) {
    transcript = '<span data-summary="transcript">' + (parts.length ? "Transcript" : "Transcript cannot be read") + "</span> " +
      '<button type="button" class="link-btn" id="btn-attach-transcript" title="' + escapeAttr(TM.REPLACE_TITLE) + '">Replace</button> ' +
      '<button type="button" class="link-btn" id="btn-remove-transcript" title="' + escapeAttr(TM.REMOVE_TITLE) + '">Remove</button>' +
      (parts.length && clips.length > 1 ? ' <button type="button" class="link-btn" id="btn-add-transcript" title="' +
        escapeAttr(TM.ADD_TITLE) + '">Add another</button>' : "");
  } else {
    transcript = '<span data-summary="transcript">No transcript</span> <button type="button" class="link-btn" id="btn-attach-transcript" ' +
      'title="' + escapeAttr(TM.ATTACH_TITLE) + '">Attach</button>';
  }
  return [video, transcript];
}

/* The project in one line: its name (the document title once written,
   P3.9), who recorded it (the SME's name when the capture app's Profile set
   one, else the Windows login), its transactions, the reference
   transaction's steps (not every transaction's: the process has that many
   steps), and the video and the transcript with their acts. `state` is
   pathState, or null before the project is analyzed (the parts that need the
   runs are left out). */
function _summaryLine(sess, state) {
  const s = SessionSummary.computeSummary(sess);
  const m = (sess && sess.manifest) || {};
  // The document title, else the analyst-given name (manifest.label: a
  // project made in the viewer, C16), else the request's name or code, else
  // the folder's name; never the capture app's default request ("Default
  // engagement", lane FX1). The hand-off's file names use the same name.
  const folderName = String((sess && sess.sessionFolder) || "").split(/[\\/]/).filter(Boolean).pop() || "";
  const login = s ? s.worker : ((m.config && m.config.worker && m.config.worker.id) || "");
  const sme = SessionSummary.smeName(m) || login;
  const shown = SessionSummary.displayName(sess, folderName);
  // AD-30, lane FX3 (validation pass 3, F23): the request shows on the
  // line, its code next to its name: beside the name when the capture's
  // request names the project, else as a part of its own once the document
  // title or the recording's name names it. Never the capture app's
  // defaults. 2.0.1: the request the analyst writes in the document wins.
  const docReq = SessionSummary.documentRequest(sess);
  const reqName = docReq ? "" : SessionSummary.requestName(m);
  const reqCode = docReq ? "" : SessionSummary.requestCode(m);
  const reqText = docReq || SessionSummary.requestOf(m);
  const namesProject = !docReq && !!reqText && (shown === reqName || shown === reqCode);
  const parts = ['<strong class="ov-summary-name">' + escapeHtml(shown) + "</strong>" +
    (namesProject && shown === reqName && reqCode && reqCode !== reqName
      ? ' <span class="ov-summary-code" data-summary="request">(' + escapeHtml(reqCode) + ")</span>" : "")];
  if (reqText && !namesProject) parts.push('<span data-summary="request">Request: ' + escapeHtml(reqText) + "</span>");
  // A project made from a video or from nothing (C16) was not recorded by anyone.
  if (sme && !["video", "blank"].includes(m.source)) parts.push("recorded by " + escapeHtml(sme));
  if (state) {
    const runs = state.runs.length;
    parts.push('<span data-summary="runs">' + (state.implicit ? AC.IMPLICIT_TRANSACTION
      : runs ? _plural(runs, "transaction", "transactions") : "No transactions") + "</span>");
    if (state.pattern) {
      parts.push('<span data-summary="steps">' + _plural(state.pattern.visible.length, "step", "steps") +
        " in " + escapeHtml(state.pattern.title.toLowerCase()) + "</span>");
    }
  }
  parts.push(..._mediaParts(sess));
  // AD-30: the tooltip names the request (only when one was set), never as
  // the project: that word is what is opened.
  const request = reqText;
  const analyzed = s && s.analyzedAt ? new Date(s.analyzedAt).toLocaleString() : "";
  const title = [request ? "Request: " + request : "", analyzed ? "Analyzed " + analyzed : ""]
    .filter(Boolean).join(" · ");
  return '<div class="ov-summary-line"' + (title ? ' title="' + escapeAttr(title) + '"' : "") + ">" +
    parts.join(" · ") + "</div>";
}

/* The warning lines, each only when there is something to say: the marker
   problems (with their fixes), files missing from the copy, the run check
   that could not run (C12: said, never shown as a measured negative), and the
   apps the recorder saw with less detail (analysis.json `coverage_caveat`,
   capture_detail.py; the findings that once held it are cut, lane FX1). */
function _summaryWarnings(sess) {
  const out = [];
  const problems = SessionSummary.detectMarkerProblems((sess && sess.events) || []);
  const origin = recordingStartMs(sess);
  for (const p of problems) {
    // The one clock: the time since the recording started, as the Timeline shows it.
    const time = sinceStart(p.timestamp, origin);
    // AD-29: each line names the transaction. A label that only numbers it
    // ("Transaction 2", or "Run 2" in a recording made before 2.0.0) says
    // nothing the line does not, so it is left out, as in Steps.
    const named = p.label && !RunsModel.numberOnlyLabel(p.label) ? ' "' + escapeHtml(p.label) + '"' : "";
    let text = "", fix = "";
    if (p.kind === "dangling_start") {
      text = "The transaction" + named + " at " + time + " has no end marker.";
      fix = '<button class="summary-fix" data-fix="close-start">End it where the recording ends</button>';
    } else if (p.kind === "orphan_end") {
      text = "The end marker at " + time + " has no open transaction to end.";
      if (p.eventId) {
        fix = '<button class="summary-fix" data-fix="delete-end" data-event-id="' +
          escapeAttr(p.eventId) + '">Remove this marker</button>';
      }
    } else if (p.kind === "short_case") {
      text = "The transaction" + named + " at " + time + " is only " + Math.round((p.durationMs || 0) / 1000) +
        "s long (accidental?)";
    }
    out.push('<div class="summary-problem"><span class="p-text">⚠ ' + text + "</span>" + fix + "</div>");
  }
  const integ = sess && sess.integrity;
  if (integ && integ.missing && integ.missing.length) {
    const n = integ.missing.length;
    const names = integ.missing.slice(0, 6).map(escapeHtml).join(", ");
    out.push('<div class="summary-problem"><span class="p-text">⚠ ' + n + " file" + (n === 1 ? "" : "s") +
      " recorded in this project " + (n === 1 ? "is" : "are") + " missing (the folder may have been " +
      "copied incompletely): " + names + (n > 6 ? ", …" : "") + ".</span></div>");
  }
  const analysis = (sess && sess.analysis) || {};
  if (!analysis.case_quality) {
    const err = _stageError(analysis, "case_quality");
    if (err) {
      out.push('<div class="analysis-note ov-stage-not-run">' + escapeHtml("The transaction check could not run " +
        "on this recording, so the transactions are not compared and the Map is not shown. " + REANALYZE_WHERE +
        "; if it fails again, the analysis log names the problem.") + "</div>" + _technicalDetail(err));
    }
  }
  const coverage = analysis.coverage_caveat && typeof analysis.coverage_caveat.claim === "string"
    ? analysis.coverage_caveat : null;
  if (coverage) {
    out.push('<div class="summary-problem ov-coverage"><span class="p-text">⚠ ' + escapeHtml(coverage.claim) + "</span></div>");
  }
  return out.join("");
}

/* Lane HV (contract C20): the line of a hand-off opened read only, "Version
   2, handed off 2026-09-25 by rasha · Read only", what changed in its
   tooltip; "" for a project the analyst works on. Lane MW: a project open
   for editing in another window says so instead (#ov-elsewhere). */
function _handoffLineHtml(sess) {
  if (!RO.isReadOnly(sess)) return "";
  if (RO.isOpenElsewhere(sess)) {
    return '<div class="ov-handoff" id="ov-elsewhere" title="' +
      escapeAttr("Changes are made in the window where this project was opened first. Opened again once that window closes, it can be changed here.") +
      '">' + escapeHtml(RO.ELSEWHERE_LINE) + "</div>";
  }
  const entry = Handoff.latest(sess.annotations);
  const title = entry && entry.note ? "What changed in this version: " + entry.note : "";
  return '<div class="ov-handoff" id="ov-handoff"' + (title ? ' title="' + escapeAttr(title) + '"' : "") + ">" +
    escapeHtml(Handoff.readOnlyLine(entry)) + "</div>";
}

function _summaryHtml(sess, state) {
  const line = _summaryLine(sess, state);
  const warn = state ? _summaryWarnings(sess) : "";
  return '<div class="ov-summary" id="ov-summary">' + _handoffLineHtml(sess) + line +
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
      if (saved) btn.textContent = "Done (pending)";
      else btn.disabled = false;
    });
  });
  _wireVideoActs(host);
}

/* The project line's video acts: Attach (Replace) and Remove. Lazy require:
   flow-view-video.js wires DOM controls at require() time. */
function _wireVideoActs(host) {
  const Video = () => require("./flow-view-video.js");
  const attachVideo = host.querySelector("#ov-summary #btn-attach-video");
  if (attachVideo) {
    attachVideo.addEventListener("click", () => (attachVideo.dataset.clip ? Video().replaceVideo(attachVideo.dataset.clip) : Video().attachVideo()));
  }
  const addVideo = host.querySelector("#ov-summary #btn-add-video");
  if (addVideo) addVideo.addEventListener("click", () => Video().attachVideo());
  const removeVideo = host.querySelector("#ov-summary #btn-remove-video");
  if (removeVideo) removeVideo.addEventListener("click", () => Video().removeVideo(removeVideo.dataset.clip));
}

/* ---- 3. The document (contract C6) ------------------------------------------ */

/* Whether the analyst opened or closed the document: kept across re-renders
   (an undo, a re-analysis) for the recording on screen. null: the default,
   closed while stages are left and open once every stage is done. */
let _docOpen = null;
let _docFolder = null;

/* "6 of 10 written. To write: Trigger, Result, Improvement and automation
   scope": the count, and the empty fields by name while some are written
   (with none written, every field is still to write). Commas only: a label
   can hold "and". */
function _documentStatusText(st, readOnly) {
  const count = st.filled + " of " + st.total + " written";
  // Lane HV: a hand-off opened read only names the empty fields, not a to-do.
  return st.filled > 0 && st.missing.length ? count + (readOnly ? ". Not written: " : ". To write: ") + st.missing.join(", ") : count;
}

/* Who fills the document, in the summary beside its title (AD-29); in a
   hand-off opened read only (lane HV), who wrote it. */
const DOC_WHO = "You write these. The PDD prints them.";
const DOC_WHO_READ_ONLY = "The analyst wrote these. The PDD prints them.";

/* ---- 3b. From the transcript (contract C8) -------------------------------- */

/* One collapsed disclosure at the end of the document, only while a
   transcript is attached. By default it lists the talk outside the runs
   (where purpose, scope, rules and exceptions are discussed); a speaker
   filter and a search narrow it; "Add to" appends a sentence to a document
   field. Kept across re-renders for the session on screen, like _docOpen.
   Its summary says in one line what the list holds (AD-29). */
let _tr = { open: false, speaker: "", query: "", during: false };

/* What the list holds, beside the disclosure's title. */
function _transcriptWhat(view) {
  if (!view.synced) return "Everything that was said";
  return _tr.during ? "What was said, during the transactions too" : "What was said outside the transactions";
}

/* The document fields a sentence can be added to: C6's, less title, request and contacts. */
const TR_TARGETS = DOC_FIELDS.filter((f) => !["title", "request", "contacts"].includes(f.key));

/* The sentences the disclosure lists now, or null without a transcript. */
function _transcriptView(sess) {
  const placed = TM.forSession(sess);
  if (!placed) return null;
  const speakers = TM.speakersOf(placed.sentences);
  if (_tr.speaker && !speakers.includes(_tr.speaker)) _tr.speaker = "";
  let list = placed.sentences;
  if (placed.synced) {
    // C23: a transcript of several not synced yet keeps its sentences, after
    // the placed ones.
    const timed = list.filter((x) => Number.isFinite(x.startMs));
    const untimed = list.filter((x) => !Number.isFinite(x.startMs));
    if (_tr.during) list = timed.slice().sort((a, b) => a.startMs - b.startMs).concat(untimed);
    else {
      const runs = RunsModel.buildRuns(sess.stats, (sess.annotations || {}).steps || []).runs;
      const evs = sess.events || [];
      const endMs = evs.length ? Date.parse(evs[evs.length - 1].timestamp) : NaN;
      list = TM.outsideRuns(timed, TM.runSpans(runs, endMs)).concat(untimed);
    }
  }
  return { synced: placed.synced, speakers, list: TM.filterSentences(list, _tr.speaker, _tr.query),
    originMs: recordingStartMs(sess) };
}

function _transcriptListHtml(view) {
  if (!view.list.length) return '<p class="tr-note">No sentence matches.</p>';
  return '<ol class="tr-list">' + view.list.map((s) => '<li class="tr-row">' + TM.sentenceRowHtml(s, view.originMs) +
    '<button type="button" class="tr-add tr-add-to" data-seg="' + escapeAttr(s.id) + '" ' +
    'title="Add this sentence to a document field">Add to</button></li>').join("") + "</ol>";
}

function _transcriptHtml(sess) {
  const view = _transcriptView(sess);
  if (!view) return "";
  const speakers = view.speakers.map((sp) => '<option value="' + escapeAttr(sp) + '"' +
    (sp === _tr.speaker ? " selected" : "") + ">" + escapeHtml(sp) + "</option>").join("");
  return '<details class="tr-more ov-tr" id="ov-tr"' + (_tr.open ? " open" : "") + ">" +
    '<summary class="tr-more-head"><span class="tr-more-title">From the transcript ' +
      '<span id="ov-tr-count">(' + view.list.length + ")</span></span>" +
      '<span class="tr-more-what" id="ov-tr-what">' + escapeHtml(_transcriptWhat(view)) + "</span>" +
      '<span class="tr-more-chevron" aria-hidden="true"></span></summary>' +
    '<div class="tr-more-body">' +
      (view.synced ? "" : '<p class="tr-note">' + escapeHtml(TM.NOT_SYNCED_LINE) + "</p>") +
      '<div class="ov-tr-tools">' +
        '<select class="ov-tr-speaker" aria-label="Speaker"><option value="">All speakers</option>' + speakers + "</select>" +
        '<input type="search" class="ov-tr-search" placeholder="Search the transcript" aria-label="Search the transcript" value="' +
          escapeAttr(_tr.query) + '" />' +
        (view.synced ? '<label class="cb ov-tr-during"><input type="checkbox" class="ov-tr-during-cb"' +
          (_tr.during ? " checked" : "") + " /> Include talk during the transactions</label>" : "") +
      "</div>" +
      '<div id="ov-tr-list">' + _transcriptListHtml(view) + "</div>" +
    "</div></details>";
}

function _closeAddToMenu() {
  const menu = document.getElementById("ov-tr-add-menu");
  if (menu) menu.remove();
}

/* The "Add to" menu of one sentence: the fields it can go to, a field that
   already holds it marked and disabled. */
function _showAddToMenu(btn, segId) {
  _closeAddToMenu();
  const placed = TM.forSession(State.getSession());
  const s = placed && placed.sentences.find((x) => x.id === segId);
  const panel = document.getElementById("ov-doc");
  if (!s || !panel) return;
  const menu = document.createElement("div");
  menu.id = "ov-tr-add-menu";
  menu.className = "project-menu-popup tr-add-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = TR_TARGETS.map((f) => {
    const el = panel.querySelector('[data-doc="' + f.key + '"]');
    const added = !!el && TM.isAdded(el.value, s.text);
    return '<button type="button" class="project-menu-item" role="menuitem" data-doc-target="' + f.key + '"' +
      (added ? " disabled" : "") + ">" + escapeHtml(f.label) + (added ? " (added)" : "") + "</button>";
  }).join("");
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  placeMenu(menu, r.left, r.bottom + 2);
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && menu.contains(e.target)) return;
    close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  }
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-doc-target]");
    if (!item || item.disabled) return;
    close();
    const field = panel.querySelector('[data-doc="' + item.dataset.docTarget + '"]');
    if (!field) return;
    // The field shows the text at once and stays editable; the save is the
    // panel's own (one undoable entry, like typing in the field).
    field.value = TM.appendText(field.value, s.text);
    _saveDocField(item.dataset.docTarget, field.value);
    const label = (DOC_FIELDS.find((f) => f.key === item.dataset.docTarget) || {}).label || "";
    toast("Added to " + label + ".", "success");
  });
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
}

function _wireTranscript(host) {
  const panel = host.querySelector("#ov-tr");
  if (!panel) return;
  panel.addEventListener("toggle", () => { _tr.open = panel.open; });
  const refresh = () => {
    const view = _transcriptView(State.getSession());
    if (!view) return;
    panel.querySelector("#ov-tr-list").innerHTML = _transcriptListHtml(view);
    panel.querySelector("#ov-tr-count").textContent = "(" + view.list.length + ")";
    panel.querySelector("#ov-tr-what").textContent = _transcriptWhat(view);
  };
  const speaker = panel.querySelector(".ov-tr-speaker");
  speaker.addEventListener("change", () => { _tr.speaker = speaker.value; refresh(); });
  const search = panel.querySelector(".ov-tr-search");
  search.addEventListener("input", () => { _tr.query = search.value; refresh(); });
  const during = panel.querySelector(".ov-tr-during-cb");
  if (during) during.addEventListener("change", () => { _tr.during = during.checked; refresh(); });
  panel.querySelector("#ov-tr-list").addEventListener("click", (e) => {
    const b = e.target.closest(".tr-add-to");
    if (b) _showAddToMenu(b, b.dataset.seg);
  });
}

function _documentHtml(anno, sess, open) {
  const doc = (anno && anno.document) || null;
  const st = documentStatus(doc);
  // Lane HV: a hand-off says who wrote the fields; lane MW: a project open
  // for editing in another window is the analyst's own, still to write there.
  const handedOff = RO.isReadOnly(sess) && !RO.isOpenElsewhere(sess);
  const fields = DOC_FIELDS.map((f) => {
    const value = _docValue(doc, f.key);
    // P3.6: where the field lands is its tooltip, not a line. AD-29: an
    // empty field asks its short question (a light italic placeholder), so
    // it looks empty.
    const where = "In the PDD: " + f.where;
    const attrs = ' data-doc="' + f.key + '" placeholder="' + escapeAttr(f.ask) + '" title="' + escapeAttr(where) + '"';
    const input = f.line
      ? '<input type="text" class="ov-doc-input"' + attrs + ' value="' + escapeAttr(value) + '" />'
      : '<textarea class="ov-doc-input"' + attrs + ' rows="3">' + escapeHtml(value) + "</textarea>";
    return '<label class="ov-doc-field">' +
      '<span class="ov-doc-label">' + escapeHtml(f.label) + (f.optional ? ' <span class="ov-doc-optional">optional</span>' : "") + "</span>" +
      input + "</label>";
  }).join("");
  // A disclosure (.analysis-module): a title, who fills it, a one-line status
  // that shows while it is closed, and a chevron.
  return '<details class="analysis-section analysis-module ov-doc" id="ov-doc"' + (open ? " open" : "") + ">" +
    '<summary class="analysis-module-head" title="The PDD prints each field you write in place of its ' +
      'placeholder; the fields are kept for every later export.">' +
      '<span class="analysis-module-title">Document</span>' +
      '<span class="ov-block-who" id="ov-doc-who">' + escapeHtml(handedOff ? DOC_WHO_READ_ONLY : DOC_WHO) + "</span>" +
      '<span class="analysis-module-takeaway" id="ov-doc-status">' + escapeHtml(_documentStatusText(st, handedOff)) + "</span>" +
      '<span class="analysis-module-chevron" aria-hidden="true"></span>' +
    "</summary>" +
    '<div class="analysis-module-body ov-doc-body">' + fields + AnalystUI.overviewAttachmentsHtml(anno) +
      _transcriptHtml(sess) + "</div></details>";
}

/* Save one field through the one write path (persistAnnotations: undoable,
   one entry per field). The panel stays as it is (no re-render, so typing in
   the next field goes on); the status, the Checklist and the recording
   line update in place. An undo or a re-analysis re-renders the
   Overview with the values on disk. */
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
    await persistAnnotations(anno, "edit document field " + (field ? field.label : key), []);
  } catch (_) {
    return;   // already shown to the analyst by session.js
  }
  // The Recents entry is named by the document title once it is written.
  if (key === "title") {
    const base = String(sess.sessionFolder || "").split(/[\\/]/).filter(Boolean).pop() || "";
    pushRecent(sess.sessionFolder, SessionSummary.recentLabel(sess, base));
  }
  _refreshPathInPlace();
}

/* Update the Checklist, the document status and the recording line without
   re-rendering the rest of the Overview. */
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
  // P3.9: the recording line names the document title once it is written.
  const summary = host.querySelector("#ov-summary .ov-summary-line");
  if (summary) {
    summary.outerHTML = _summaryLine(sess, state);
    _wireVideoActs(host);
  }
}

function _wireDocument(host) {
  const panel = host.querySelector("#ov-doc");
  if (!panel) return;
  panel.addEventListener("toggle", () => { _docOpen = panel.open; });
  panel.querySelectorAll("[data-doc]").forEach((el) => {
    el.addEventListener("change", () => _saveDocField(el.dataset.doc, el.value));
  });
}

/* ---- The hand-off -------------------------------------------------------- */

/* The Checklist's last act is the hand-off. It clicks the Export menu's
   Hand off... item (#btn-session-handoff, views/handoff-ui.js), so the
   Overview and the menu share one hand-off path. */
function _handOff() {
  const item = document.getElementById("btn-session-handoff");
  if (!item) { toast("The hand-off is not available in this window.", "error"); return; }
  item.click();
}

/* ---- Render -------------------------------------------------------------- */

/* Whether analysis.json carries the Overview's blocks at all: the run check
   ran, or it is named as a failed stage (C12). */
function hasAnalysisBlocks(analysis) {
  return !!(analysis && (analysis.case_quality || _stageError(analysis, "case_quality")));
}

/* The Overview HTML for one session ({ analysis, annotations, stats,
   manifest, events, sessionFolder, integrity, recordingAvailable, transcript,
   transcriptError }). `run` is the recording's analysis run state
   (State.getAnalysisRun() for it, or null), `docOpen` whether the document
   is shown open (null: the default). Pure (no DOM, no State), so the unit
   tests render fixture sessions through the same code. */
function overviewHtml(sess, run, docOpen) {
  const analysis = sess && sess.analysis;
  if (!hasAnalysisBlocks(analysis)) {
    const stale = !!(analysis && sess.stats);
    return '<div class="analysis-empty ov-waiting" id="ov-waiting" data-run="' + escapeAttr((run && run.status) || "") + '">' +
      escapeHtml(waitingSentence(run, stale)) + "</div>" + _summaryHtml(sess, null);
  }
  const anno = (sess && sess.annotations) || {};
  const state = pathState(sess);
  // Lane HV: the Checklist is the analyst's to-do list; a hand-off opened
  // read only has nothing to do.
  let html = RO.isReadOnly(sess) ? "" : _nextLineHtml(state);
  html += _summaryHtml(sess, state);
  // P1.10: the only typing the home asks for sits under the recording line;
  // once every stage is done it opens by itself, so the home leads with it.
  html += _documentHtml(anno, sess, docOpen == null ? state.ready : !!docOpen);
  return html;
}

function renderOverviewLevel() {
  const host = document.getElementById("overview-content");
  if (!host) return;
  const sess = State.getSession();
  if (!sess) { host.innerHTML = ""; return; }
  if (_docFolder !== sess.sessionFolder) {
    _docFolder = sess.sessionFolder;
    _docOpen = null;
    _tr = { open: false, speaker: "", query: "", during: false };
  }
  _closeAddToMenu();
  // A document field being typed in keeps what was typed (and the cursor)
  // across a re-render: it is saved when the field is left, as always.
  const active = document.activeElement;
  const typing = active && host.contains(active) && active.dataset && active.dataset.doc
    ? { key: active.dataset.doc, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  host.innerHTML = overviewHtml(sess, _runOf(sess), _docOpen);
  _wireSummary(host);
  if (!hasAnalysisBlocks(sess.analysis)) return;   // the waiting note has nothing else to wire

  _wireNextLine(host);
  _wireDocument(host);
  AnalystUI.wireOverviewAttachments(host);
  _wireTranscript(host);
  // Lane HV: the document of a hand-off opened read only is read, not typed in.
  if (RO.isReadOnly(sess)) RO.lockInputs(host.querySelector("#ov-doc"));
  if (typing) {
    const field = host.querySelector('[data-doc="' + typing.key + '"]');
    if (field) {
      if (field.value !== typing.value) field.value = typing.value;
      field.focus();
      try { field.setSelectionRange(typing.start, typing.end); } catch (_) { /* not a text field */ }
      // A value put back here is not a "change" the field would report on
      // leaving it, so leaving it saves it (unchanged text saves nothing).
      field.addEventListener("blur", () => _saveDocField(typing.key, field.value), { once: true });
    }
  }
}

module.exports = {
  renderOverviewLevel, openMarkersInFlow, overviewHtml, pathState, documentStatus, mapLockHtml,
  mapEmptyText, hasAnalysisBlocks, waitingSentence,
  DOC_FIELDS, NO_RUNS_MARKED, MARK_RUNS_INSTRUCTION, MARK_RUNS_BUTTON, STAGE_NOT_RUN, NO_STEPS_YET, ASIS_STALE,
};
