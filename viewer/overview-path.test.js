"use strict";
/*
 * The Overview as the home (BA-helper cycle, item 4; lane V1): the "What is
 * left" line derived from the session data alone (five stages: the As-Is map
 * is not one, AD-28; one short line once every stage before the export is
 * done), the recording line, and the document (contract C6, with trigger,
 * result and improvement). Fixture sessions go through the same pure builders
 * renderOverviewLevel uses (pathState, documentStatus, overviewHtml).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathState, documentStatus, overviewHtml, DOC_FIELDS } = require("./views/overview-view.js");

const t = (min) => new Date(Date.UTC(2026, 4, 17, 9, min)).toISOString();

function step(id, caseId, min, state) {
  return {
    step_id: id, case_id: caseId, state: state || "auto_suggested", name: "Step " + id,
    draft_key: "app|screen|Button:" + id,
    time_range: { start: t(min), end: t(min + 1) },
  };
}

/* Three runs of drafted steps: run 1 (2 steps), run 2 (2), run 3 (1). */
function session(over) {
  const s = {
    sessionFolder: null,
    analysis: { case_quality: { mode: "markers", case_count: 3, coverage: 1, tier2_unlocked: true },
      facts: { idle_ms: 1000 }, findings: [] },
    stats: {
      meta: { worker_id: "w1", normalization_run_at: "2026-05-17T10:00:00Z" },
      case_stats: [
        { case_id: "c1", start_ts: t(0), end_ts: t(10) },
        { case_id: "c2", start_ts: t(20), end_ts: t(30) },
        { case_id: "c3", start_ts: t(40), end_ts: t(50) },
      ],
    },
    annotations: {
      steps: [step("a", "c1", 1), step("b", "c1", 3), step("c", "c2", 21), step("d", "c2", 23), step("e", "c3", 41)],
    },
    manifest: { engagement_id: "eng-1", engagement_name: "Order intake" },
    events: [{ type: "activity", timestamp: t(0) }, { type: "activity", timestamp: t(50) }],
  };
  return Object.assign(s, over || {});
}

function confirmRun(sess, caseId) {
  for (const s of sess.annotations.steps) if (s.case_id === caseId) s.state = "confirmed";
}

const FULL_DOC = { title: "Order intake", purpose: "Why", scope: "What", trigger: "An order e-mail",
  result: "A sales order", contacts: "Who", business_rules: "Rules", exceptions: "Exceptions",
  improvement: "Automate the lookup", notes: "" };

/* ---- pathState: each stage's completion condition -------------------------- */

test("no runs marked: the next act is marking runs", () => {
  const sess = session({ stats: { meta: {}, case_stats: [] } });
  for (const s of sess.annotations.steps) s.case_id = null;
  const st = pathState(sess);
  assert.equal(st.done.runs, false);
  assert.equal(st.next, "runs");
});

test("runs marked, pattern run not confirmed: the next act is the pattern run (run 1 by default)", () => {
  const st = pathState(session());
  assert.equal(st.done.runs, true);
  assert.equal(st.done.pattern, false);
  assert.equal(st.next, "pattern");
  assert.equal(st.pattern.caseId, "c1");
});

test("a pattern run is done only when it is confirmed (confirmed_at), not merely designated", () => {
  const sess = session({});
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: null, draft_fixes: {} };
  assert.equal(pathState(sess).done.pattern, false);
  confirmRun(sess, "c1");
  sess.annotations.pattern_run.confirmed_at = "2026-05-17T11:00:00Z";
  const st = pathState(sess);
  assert.equal(st.done.pattern, true);
  assert.equal(st.next, "review");
  assert.equal(st.draftOther.caseId, "c2", "the first other run still drafted");
});

test("the other runs are reviewed once none of them has drafted steps left", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  confirmRun(sess, "c2");
  assert.equal(pathState(sess).draftOther.caseId, "c3");
  sess.annotations.steps.find((s) => s.case_id === "c3").state = "edited";   // edited counts as reviewed
  const st = pathState(sess);
  assert.equal(st.done.review, true);
  assert.equal(st.next, "document");
});

test("the pattern run follows 'Use as pattern': run 1 is then one of the other runs", () => {
  const sess = session({});
  confirmRun(sess, "c2");
  sess.annotations.pattern_run = { case_id: "c2", confirmed_at: "2026-05-17T11:00:00Z" };
  const st = pathState(sess);
  assert.equal(st.done.pattern, true);
  assert.equal(st.draftOther.caseId, "c1");
});

test("the document stage is done when every field that fills a PDD placeholder is written, trigger, result and improvement included", () => {
  const sess = session({});
  for (const c of ["c1", "c2", "c3"]) confirmRun(sess, c);
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  sess.annotations.document = Object.assign({}, FULL_DOC, { exceptions: "   " });
  assert.equal(pathState(sess).next, "document", "a blank field is not written");
  for (const key of ["trigger", "result", "improvement"]) {
    sess.annotations.document = Object.assign({}, FULL_DOC, { [key]: "" });
    assert.equal(pathState(sess).next, "document", key + " is counted");
  }
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const st = pathState(sess);
  assert.equal(st.done.document, true, "notes are optional");
  assert.equal(st.next, "export", "AD-28: the As-Is map is not a stage");
  assert.equal(st.ready, true);
  assert.equal(st.done.export, false, "an export leaves no record, so it is never shown done");
});

test("AD-28: the stages are Runs, Reference run, Other runs, Document and PDD; an edited As-Is copy changes no stage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-path-"));
  try {
    const sess = session({ sessionFolder: dir });
    for (const c of ["c1", "c2", "c3"]) confirmRun(sess, c);
    sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
    sess.annotations.document = Object.assign({}, FULL_DOC);
    const before = pathState(sess);
    fs.mkdirSync(path.join(dir, "derived_maps"));
    fs.writeFileSync(path.join(dir, "derived_maps", "rm_1.bpmn"), "<definitions/>");
    sess.annotations.reference_maps = [{ map_id: "rm_1", file: "derived_maps/rm_1.bpmn", pdd_role: "as_is" }];
    const after = pathState(sess);
    assert.deepEqual(Object.keys(after.done), ["runs", "pattern", "review", "document", "export"]);
    assert.deepEqual([before.next, after.next], ["export", "export"]);
    const html = overviewHtml(session({ sessionFolder: null, annotations: { steps: [] } }));
    assert.ok(!html.includes('data-stage="map"') && !html.includes("As-Is map"), "no As-Is stage on the line");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("each stage is shown done on its own, whatever the order it was done in", () => {
  const sess = session({ stats: { meta: {}, case_stats: [] } });
  for (const s of sess.annotations.steps) s.case_id = null;
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const st = pathState(sess);
  assert.equal(st.done.document, true);
  assert.equal(st.next, "runs");
});

test("documentStatus counts the nine fields that fill a placeholder; notes are optional", () => {
  assert.deepEqual(documentStatus(null), { filled: 0, total: 9, firstEmpty: "title" });
  assert.deepEqual(documentStatus({ title: "T", purpose: "  " }), { filled: 1, total: 9, firstEmpty: "purpose" });
  assert.equal(documentStatus(FULL_DOC).filled, 9);
  assert.deepEqual(DOC_FIELDS.map((f) => f.key),
    ["title", "purpose", "scope", "trigger", "result", "contacts", "business_rules", "exceptions", "improvement", "notes"],
    "contract C6 fields, with trigger, result and improvement");
});

/* ---- overviewHtml: the home's structure ------------------------------------ */

test("the Overview leads with the what-is-left line and its one button", () => {
  const html = overviewHtml(session());
  assert.ok(html.startsWith('<div class="ov-next" id="ov-next" data-next="pattern">'), html.slice(0, 80));
  assert.equal((html.match(/id="btn-ov-next"/g) || []).length, 1, "one button for the next act");
  assert.ok(/<li class="ov-next-stage done" data-stage="runs">/.test(html), "a done stage shows as done");
  assert.ok(/<li class="ov-next-stage next" data-stage="pattern">/.test(html));
  assert.ok(html.includes(">Confirm Run 1 in Steps</button>"));
  assert.ok(html.includes('data-stage="pattern">Reference run</li>'), "the pattern run is the reference run here");
});

test("once every stage before the export is done, the line shrinks to one short line with Export PDD, and the document opens", () => {
  const sess = session({});
  for (const c of ["c1", "c2", "c3"]) confirmRun(sess, c);
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const html = overviewHtml(sess);
  assert.ok(html.startsWith('<div class="ov-next ov-next-ready" id="ov-next" data-next="export">'), html.slice(0, 90));
  assert.ok(!html.includes("ov-next-stage"), "no stage list");
  assert.ok(html.includes(">Export PDD</button>"));
  assert.ok(html.includes('<details class="analysis-section analysis-module ov-doc" id="ov-doc" open>'), "the home leads with the document");
  assert.ok(overviewHtml(sess, null, false).includes('id="ov-doc">'), "a document the analyst closed stays closed");
});

test("with no runs, the line carries the mark-runs instruction and button", () => {
  const sess = session({ stats: { meta: { worker_id: "w1" }, case_stats: [] } });
  for (const s of sess.annotations.steps) s.case_id = null;
  const html = overviewHtml(sess);
  assert.ok(html.includes('data-next="runs"'));
  assert.ok(html.includes("This recording has no runs marked."));
  assert.ok(html.includes(">Mark runs on the Timeline</button>"));
  assert.ok(html.includes("then click Apply marker changes."));
});

test("the recording line: name, who recorded it, the runs and the reference run's visible steps (not every run's)", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  sess.annotations.steps.find((s) => s.step_id === "b").state = "hidden";
  const html = overviewHtml(sess);
  assert.ok(html.includes('<strong class="ov-summary-name">Order intake</strong>'));
  assert.ok(html.includes("recorded by w1"));
  assert.ok(html.includes('<span data-summary="runs">3 runs</span>'));
  assert.ok(html.includes('<span data-summary="steps">1 step in run 1</span>'), "hidden steps are left out");
  assert.ok(!/steps confirmed|of \d+ steps/.test(html), "no count summed over every run");
  assert.ok(!html.includes("0s ·") && !/ · \d+m\d+s · /.test(html), "no recording length");
  sess.annotations.pattern_run = { case_id: "c2", confirmed_at: null };
  assert.ok(overviewHtml(sess).includes('<span data-summary="steps">2 steps in run 2</span>'), "the reference run, whichever it is");
});

test("the recording line names the SME when the capture app's Profile recorded a name, else the Windows login", () => {
  const sess = session({ manifest: { engagement_id: "eng-1", engagement_name: "Order intake",
    config: { worker: { id: "w1", name: "Ana Novak" } } } });
  assert.ok(overviewHtml(sess).includes("recorded by Ana Novak"));
  sess.manifest.config.worker.name = "W1";
  assert.ok(overviewHtml(sess).includes("recorded by w1"), "a name that only repeats the login is the login");
});

test("the recording line carries the video and the transcript, each with its act", () => {
  const none = overviewHtml(session({}));
  assert.ok(/<span data-summary="video">No video<\/span> <button[^>]*id="btn-attach-video"[^>]*>Attach<\/button>/.test(none));
  assert.ok(/<span data-summary="transcript">No transcript<\/span> <button[^>]*id="btn-attach-transcript"[^>]*>Attach<\/button>/.test(none));
  assert.ok(!none.includes("btn-remove-transcript"));
  const both = overviewHtml(session({ recordingAvailable: true, transcript: { version: 1, segments: [] } }));
  assert.ok(/<span data-summary="video">Video<\/span> <button[^>]*id="btn-attach-video"[^>]*>Replace<\/button>/.test(both));
  assert.ok(/id="btn-attach-transcript"[^>]*>Replace<\/button> <button[^>]*id="btn-remove-transcript"[^>]*>Remove<\/button>/.test(both));
  const unreadable = overviewHtml(session({ transcriptError: "it is not valid JSON" }));
  assert.ok(unreadable.includes('<span data-summary="transcript">Transcript cannot be read</span>'));
  assert.ok(unreadable.includes('id="btn-remove-transcript"'));
});

test("the fact tiles, the badge, the separate mark-runs line and the export bar are gone", () => {
  const html = overviewHtml(session());
  for (const gone of ["ov-tile", "ov-facts", "ov-badge", "ov-mark-runs", "ov-export-bar", "btn-ov-export-pdd"]) {
    assert.ok(!html.includes(gone), gone);
  }
});

test("the document is collapsed while stages are left, says how many fields are written, and names where each lands", () => {
  const sess = session({});
  sess.annotations.document = { title: "Order intake", purpose: "Why", trigger: "An order e-mail" };
  const html = overviewHtml(sess);
  assert.ok(html.includes('<details class="analysis-section analysis-module ov-doc" id="ov-doc">'), "closed by default");
  assert.ok(html.includes('<span class="analysis-module-title">Document</span>'));
  assert.ok(html.includes('<span class="analysis-module-takeaway" id="ov-doc-status">3 of 9 written</span>'));
  // P3.6: where a field lands is its placeholder and tooltip, not a resident line.
  assert.equal((html.match(/placeholder="In the PDD: /g) || []).length, 10);
  assert.ok(!html.includes("ov-doc-where"));
  assert.ok(html.includes('<textarea class="ov-doc-input" data-doc="purpose" placeholder="In the PDD: Purpose" ' +
    'title="In the PDD: Purpose" rows="3">Why</textarea>'));
  assert.ok(/data-doc="title"[^>]*value="Order intake"/.test(html));
  for (const [key, label] of [["trigger", "Trigger"], ["result", "Result"], ["improvement", "Improvement and automation scope"]]) {
    assert.ok(html.includes('<span class="ov-doc-label">' + label + "</span>"), label);
    assert.ok(html.includes('data-doc="' + key + '"'), key);
  }
  assert.ok(html.includes('data-doc="trigger" placeholder="In the PDD: Trigger: what starts the process"'));
  assert.ok(/data-doc="trigger"[^>]*>An order e-mail<\/textarea>/.test(html));
});
