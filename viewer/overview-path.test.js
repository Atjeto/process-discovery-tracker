"use strict";
/*
 * The Overview as the home (BA-helper cycle, item 4): the "What is left" line
 * derived from the session data alone, the one-line session summary, and the
 * document sections panel (contract C6). Fixture sessions go through the same
 * pure builders renderOverviewLevel uses (pathState, documentStatus,
 * overviewHtml).
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

const FULL_DOC = { title: "Order intake", purpose: "Why", scope: "What", contacts: "Who",
  business_rules: "Rules", exceptions: "Exceptions", notes: "" };

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

test("the document stage is done when every section that fills a PDD placeholder is written", () => {
  const sess = session({});
  for (const c of ["c1", "c2", "c3"]) confirmRun(sess, c);
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  sess.annotations.document = Object.assign({}, FULL_DOC, { exceptions: "   " });
  assert.equal(pathState(sess).next, "document", "a blank field is not written");
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const st = pathState(sess);
  assert.equal(st.done.document, true, "notes are optional");
  assert.equal(st.next, "map");
});

test("the As-Is map stage is done when a copy is chosen as the PDD's As-Is map and its file exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-path-"));
  try {
    const sess = session({ sessionFolder: dir });
    for (const c of ["c1", "c2", "c3"]) confirmRun(sess, c);
    sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
    sess.annotations.document = Object.assign({}, FULL_DOC);
    sess.annotations.reference_maps = [{ map_id: "rm_1", file: "derived_maps/rm_1.bpmn", pdd_role: null }];
    assert.equal(pathState(sess).next, "map", "a copy not chosen for the PDD does not finish the stage");
    sess.annotations.reference_maps[0].pdd_role = "as_is";
    assert.equal(pathState(sess).next, "map", "its file must exist");
    fs.mkdirSync(path.join(dir, "derived_maps"));
    fs.writeFileSync(path.join(dir, "derived_maps", "rm_1.bpmn"), "<definitions/>");
    const st = pathState(sess);
    assert.equal(st.done.map, true);
    assert.equal(st.next, "export");
    assert.equal(st.done.export, false, "an export leaves no record, so it is never shown done");
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

test("documentStatus counts the six sections that fill a placeholder; notes are optional", () => {
  assert.deepEqual(documentStatus(null), { filled: 0, total: 6, firstEmpty: "title" });
  assert.deepEqual(documentStatus({ title: "T", purpose: "  " }), { filled: 1, total: 6, firstEmpty: "purpose" });
  assert.equal(documentStatus(FULL_DOC).filled, 6);
  assert.deepEqual(DOC_FIELDS.map((f) => f.key),
    ["title", "purpose", "scope", "contacts", "business_rules", "exceptions", "notes"], "contract C6 fields");
});

/* ---- overviewHtml: the home's structure ------------------------------------ */

test("the Overview leads with the what-is-left line and its one button", () => {
  const html = overviewHtml(session());
  assert.ok(html.startsWith('<div class="ov-next" id="ov-next" data-next="pattern">'), html.slice(0, 80));
  assert.equal((html.match(/id="btn-ov-next"/g) || []).length, 1, "one button for the next act");
  assert.ok(/<li class="ov-next-stage done" data-stage="runs">/.test(html), "a done stage shows as done");
  assert.ok(/<li class="ov-next-stage next" data-stage="pattern">/.test(html));
  assert.ok(html.includes(">Confirm Run 1 in Steps</button>"));
});

test("with no runs, the line carries the mark-runs instruction and button", () => {
  const sess = session({ stats: { meta: { worker_id: "w1" }, case_stats: [] } });
  for (const s of sess.annotations.steps) s.case_id = null;
  const html = overviewHtml(sess);
  assert.ok(html.includes('data-next="runs"'));
  assert.ok(html.includes("This recording has no runs marked."));
  assert.ok(html.includes(">Mark runs in Flow</button>"));
});

test("the session summary is one line: name, worker, duration, runs and the live confirmed count", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  sess.annotations.steps.find((s) => s.step_id === "c").state = "edited";
  sess.annotations.steps.find((s) => s.step_id === "d").state = "hidden";
  const html = overviewHtml(sess);
  assert.ok(html.includes('<strong class="ov-summary-name">Order intake</strong>'));
  assert.ok(html.includes("recorded by w1"));
  assert.ok(html.includes('<span data-summary="runs">3 runs</span>'));
  assert.ok(html.includes('<span data-summary="steps">3 of 4 steps confirmed</span>'),
    "confirmed and edited count, hidden steps are left out");
});

test("the fact tiles, the badge, the separate mark-runs line and the export bar are gone", () => {
  const html = overviewHtml(session());
  for (const gone of ["ov-tile", "ov-facts", "ov-badge", "ov-mark-runs", "ov-export-bar", "btn-ov-export-pdd"]) {
    assert.ok(!html.includes(gone), gone);
  }
});

test("the document sections panel is collapsed, says how many are filled, and names where each lands", () => {
  const sess = session({});
  sess.annotations.document = { title: "Order intake", purpose: "Why" };
  const html = overviewHtml(sess);
  assert.ok(html.includes('<details class="analysis-section analysis-module ov-doc" id="ov-doc">'), "closed by default");
  assert.ok(html.includes('<span class="analysis-module-takeaway" id="ov-doc-status">2 of 6 filled</span>'));
  assert.equal((html.match(/In the PDD: /g) || []).length, 7);
  assert.ok(html.includes("In the PDD: 3.1 Purpose"));
  assert.ok(html.includes('<textarea class="ov-doc-input" data-doc="purpose" rows="3">Why</textarea>'));
  assert.ok(html.includes('data-doc="title" value="Order intake"'));
});
