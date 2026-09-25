"use strict";
/*
 * The Overview as the home (BA-helper cycle, item 4; lane V1): the Checklist
 * derived from the session data alone (five acts, each with its tooltip: the
 * As-Is map is not one, AD-28; one short line once every act before the
 * export is done), the project line, and the document (contract C6, with
 * trigger, result and improvement; its status names the empty fields). The
 * words are the owner's (AD-29): transaction for a run, project for what is
 * opened. Fixture sessions go through the same pure builders
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

/* AD-28: the other runs are reviewed by opening them in Steps. */
function openRuns(sess, ...caseIds) {
  sess.annotations.opened_runs = (sess.annotations.opened_runs || []).concat(caseIds);
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
  assert.equal(st.nextOther.caseId, "c2", "the first other run not opened yet");
});

test("AD-28: the other runs are reviewed once each has been opened; confirming them is not asked, and drafts stay drafts", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  confirmRun(sess, "c2");
  assert.equal(pathState(sess).nextOther.caseId, "c2", "a confirmed run that was never opened is not reviewed");
  openRuns(sess, "c2");
  assert.equal(pathState(sess).nextOther.caseId, "c3");
  assert.equal(pathState(sess).done.review, false);
  openRuns(sess, "c3");
  const st = pathState(sess);
  assert.equal(st.done.review, true, "c3 is still all drafts, and reviewed");
  assert.equal(st.nextOther, null);
  assert.equal(st.next, "document");
});

test("the line says how many other runs differ from the reference run", () => {
  const sess = session({});
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  const st = pathState(sess);
  assert.equal(st.differing, 2, "runs 2 and 3 have other steps than run 1");
  const html = overviewHtml(sess);
  assert.ok(html.includes(">Review transaction 2 in Steps</button>"));
  assert.ok(html.includes('<div class="ov-next-say">2 transactions differ from the reference transaction.</div>'));
  // The review act (its button, its tooltip and its sentence) asks for no
  // Confirm; the Checklist's own item tooltips may name Confirm transaction.
  const act = (html.match(/<button[^>]*id="btn-ov-next"[^>]*>[^<]*<\/button>/) || [""])[0] +
    (html.match(/<div class="ov-next-say">[^<]*<\/div>/) || [""])[0];
  assert.ok(act.includes("Review transaction 2") && act.includes("differ from the reference transaction"), act);
  assert.ok(!/Confirm/.test(act), "the review act asks for no Confirm");
});

test("lane FX1: Review points at a transaction that differs, and the sentence is about the one it opens", () => {
  const sess = session({});
  // Transaction 2 does what the reference transaction does; transaction 3 differs.
  const keyOf = { c: "a", d: "b" };
  for (const s of sess.annotations.steps) if (keyOf[s.step_id]) s.draft_key = "app|screen|Button:" + keyOf[s.step_id];
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  confirmRun(sess, "c1");
  let st = pathState(sess);
  assert.equal(st.differing, 1);
  assert.equal(st.nextOther.caseId, "c3", "the transaction that differs, before the one that does not");
  assert.equal(st.nextDiffers, true);
  let html = overviewHtml(sess);
  assert.ok(html.includes(">Review transaction 3 in Steps</button>"), html.slice(0, 600));
  assert.ok(html.includes('<div class="ov-next-say">1 transaction differs from the reference transaction.</div>'));
  openRuns(sess, "c3");
  st = pathState(sess);
  assert.equal(st.nextOther.caseId, "c2");
  assert.equal(st.nextDiffers, false);
  html = overviewHtml(sess);
  assert.ok(html.includes(">Review transaction 2 in Steps</button>"));
  assert.ok(html.includes('<div class="ov-next-say">Transaction 2 does not differ from the reference transaction.</div>'));
});

test("lane FX1: a step that happens only under a condition and was not done is no difference for the Checklist", () => {
  const sess = session({});
  const keyOf = { c: "a" };
  for (const s of sess.annotations.steps) if (keyOf[s.step_id]) s.draft_key = "app|screen|Button:" + keyOf[s.step_id];
  sess.annotations.steps = sess.annotations.steps.filter((s) => s.step_id !== "d" && s.case_id !== "c3");
  sess.stats.case_stats = sess.stats.case_stats.slice(0, 2);
  sess.annotations.steps.find((s) => s.step_id === "b").only_when = "the customer asks";
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  confirmRun(sess, "c1");
  const st = pathState(sess);
  assert.equal(st.differing, 0, "transaction 2 did not do b, which happens only when the customer asks");
  assert.ok(overviewHtml(sess).includes('<div class="ov-next-say">No other transaction differs from the reference transaction.</div>'));
});

test("the reference run follows 'Use as reference run': run 1 is then one of the other runs", () => {
  const sess = session({});
  confirmRun(sess, "c2");
  sess.annotations.pattern_run = { case_id: "c2", confirmed_at: "2026-05-17T11:00:00Z" };
  openRuns(sess, "c2");
  const st = pathState(sess);
  assert.equal(st.done.pattern, true);
  assert.equal(st.nextOther.caseId, "c1", "opening the reference run itself counts for nothing");
});

test("the document stage is done when every field that fills a PDD placeholder is written, trigger, result and improvement included", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  openRuns(sess, "c2", "c3");
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

test("AD-28: the acts are the transactions, the reference transaction, the other transactions, the document and the PDD; an edited As-Is copy changes no act", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-path-"));
  try {
    const sess = session({ sessionFolder: dir });
    confirmRun(sess, "c1");
    openRuns(sess, "c2", "c3");
    sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
    sess.annotations.document = Object.assign({}, FULL_DOC);
    const before = pathState(sess);
    fs.mkdirSync(path.join(dir, "derived_maps"));
    fs.writeFileSync(path.join(dir, "derived_maps", "rm_1.bpmn"), "<definitions/>");
    sess.annotations.reference_maps = [{ map_id: "rm_1", file: "derived_maps/rm_1.bpmn", pdd_role: "as_is" }];
    const after = pathState(sess);
    // Lane FX2: the As-Is item is listed only while the copy is older than
    // the steps; a copy made from the steps as they are is nothing to do.
    assert.deepEqual(Object.keys(after.done), ["runs", "pattern", "review", "document", "asis", "export"]);
    assert.equal(after.done.asis, true);
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

test("documentStatus counts the nine fields that fill a placeholder and names the empty ones; notes are optional", () => {
  const ALL = ["Title", "Purpose", "Scope", "Trigger", "Result", "Key contacts", "Business rules", "Exceptions",
    "Improvement and automation scope"];
  assert.deepEqual(documentStatus(null), { filled: 0, total: 9, missing: ALL, firstEmpty: "title" });
  assert.deepEqual(documentStatus({ title: "T", purpose: "  " }), { filled: 1, total: 9, missing: ALL.slice(1), firstEmpty: "purpose" });
  assert.equal(documentStatus(FULL_DOC).filled, 9);
  assert.deepEqual(documentStatus(FULL_DOC).missing, [], "notes are never missing");
  assert.deepEqual(DOC_FIELDS.map((f) => f.key),
    ["title", "purpose", "scope", "trigger", "result", "contacts", "business_rules", "exceptions", "improvement", "notes"],
    "contract C6 fields, with trigger, result and improvement");
});

/* ---- overviewHtml: the home's structure ------------------------------------ */

test("the Overview leads with the Checklist and its one button; each act is worded as an act, with a tooltip", () => {
  const html = overviewHtml(session());
  assert.ok(html.startsWith('<div class="ov-next" id="ov-next" data-next="pattern">'), html.slice(0, 80));
  assert.ok(html.includes('<span class="ov-next-label">Checklist</span>'));
  assert.ok(!html.includes("What is left"));
  assert.equal((html.match(/id="btn-ov-next"/g) || []).length, 1, "one button for the next act");
  assert.ok(/<li class="ov-next-stage done" data-stage="runs" title="[^"]+"><span class="ov-next-mark" aria-hidden="true">✓<\/span>Mark the transactions<\/li>/.test(html),
    "a done act is ticked");
  assert.ok(/<li class="ov-next-stage next" data-stage="pattern" title="[^"]+">Confirm the reference transaction<\/li>/.test(html));
  assert.ok(html.includes(">Confirm transaction 1 in Steps</button>"));
  const items = [...html.matchAll(/<li class="ov-next-stage[^"]*" data-stage="(\w+)" title="([^"]+)">(?:<span[^>]*>✓<\/span>)?([^<]+)<\/li>/g)]
    .map((m) => [m[1], m[3], m[2].length > 40]);
  assert.deepEqual(items, [
    ["runs", "Mark the transactions", true], ["pattern", "Confirm the reference transaction", true],
    ["review", "Review the other transactions", true], ["document", "Write the document", true],
    ["export", "Export the PDD", true]], "five acts, each with a tooltip that says what it means");
  assert.ok(/data-stage="export" title="[^"]*never ticked/.test(html), "the export's tooltip says why it is never ticked");
});

test("once every stage before the export is done, the line shrinks to one short line with Export PDD, and the document opens", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  openRuns(sess, "c2", "c3");
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const html = overviewHtml(sess);
  assert.ok(html.startsWith('<div class="ov-next ov-next-ready" id="ov-next" data-next="export">'), html.slice(0, 90));
  assert.ok(html.includes('<span class="ov-next-label">Checklist</span><span class="ov-next-ready-text">Everything before the export is done: the PDD is ready to export.</span>'));
  assert.ok(!html.includes("ov-next-stage"), "no stage list");
  assert.ok(html.includes(">Export PDD</button>"));
  assert.ok(html.includes('<details class="analysis-section analysis-module ov-doc" id="ov-doc" open>'), "the home leads with the document");
  assert.ok(overviewHtml(sess, null, false).includes('id="ov-doc">'), "a document the analyst closed stays closed");
});

test("lane FX2: an As-Is map made before the steps changed is a Checklist item (with Copy again named), and the PDD is not ready meanwhile", () => {
  const fs2 = require("node:fs");
  const RM = require("./reference-maps.js");
  const AsIsFresh = require("./asis-freshness.js");
  const sess = session({ sessionFolder: fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-asis-")) });
  confirmRun(sess, "c1");
  openRuns(sess, "c2", "c3");
  sess.annotations.pattern_run = { case_id: "c1", confirmed_at: "2026-05-17T11:00:00Z" };
  sess.annotations.document = Object.assign({}, FULL_DOC);
  const e = RM.buildEntry({ map_id: "rm_1", file: "derived_maps/rm_1.bpmn", name: "As-Is map", source: { level: "step" },
    forked_from_steps: AsIsFresh.stepsMapSignature(sess.annotations, sess.stats) });
  RM.upsert(sess.annotations, e);
  RM.setRole(sess.annotations, "rm_1", "as_is");
  RM.writeBpmn(sess.sessionFolder, e, "<definitions/>");
  assert.ok(fs2.existsSync(path.join(sess.sessionFolder, e.file)));
  let st = pathState(sess);
  assert.equal(st.ready, true, "made from the steps as they are: nothing to check");
  assert.ok(!overviewHtml(sess).includes('data-stage="asis"'));
  sess.annotations.steps[0].name = "Look up the customer";
  st = pathState(sess);
  assert.equal(st.asIsStale, true);
  assert.equal(st.done.asis, false);
  assert.equal(st.next, "asis");
  assert.equal(st.ready, false, "the Checklist no longer says the PDD is ready");
  const html = overviewHtml(sess);
  assert.ok(/<li class="ov-next-stage next" data-stage="asis" title="The As-Is map was made before the steps changed: check it, or Copy again\.[^"]*">Check the As-Is map<\/li>/.test(html), html.slice(0, 900));
  assert.ok(html.includes('data-next-act="asis"'));
  assert.ok(html.includes(">Check the As-Is map</button>"));
  assert.ok(html.includes('<div class="ov-next-say">The As-Is map was made before the steps changed: check it, or Copy again.</div>'));
  // Still listed, not done, while an earlier act is the next one.
  sess.annotations.document.purpose = "";
  const html2 = overviewHtml(sess);
  assert.ok(/<li class="ov-next-stage" data-stage="asis" title="[^"]+">Check the As-Is map<\/li>/.test(html2));
});

test("with no transactions, the Checklist carries the mark-transactions instruction and button", () => {
  const sess = session({ stats: { meta: { worker_id: "w1" }, case_stats: [] } });
  for (const s of sess.annotations.steps) s.case_id = null;
  const html = overviewHtml(sess);
  assert.ok(html.includes('data-next="runs"'));
  assert.ok(html.includes("This recording has no transactions marked."));
  assert.ok(html.includes("choose Start a transaction here, then click Apply marker changes."));
  assert.ok(html.includes(">Mark the transactions on the Timeline</button>"));
});

test("the project line: name, who recorded it, the transactions and the reference transaction's visible steps (not every one's)", () => {
  const sess = session({});
  confirmRun(sess, "c1");
  sess.annotations.steps.find((s) => s.step_id === "b").state = "hidden";
  const html = overviewHtml(sess);
  assert.ok(html.includes('<strong class="ov-summary-name">Order intake</strong>'));
  assert.ok(html.includes("recorded by w1"));
  assert.ok(html.includes('<span data-summary="runs">3 transactions</span>'));
  assert.ok(html.includes('<span data-summary="steps">1 step in transaction 1</span>'), "hidden steps are left out");
  assert.ok(!/steps confirmed|of \d+ steps/.test(html), "no count summed over every transaction");
  assert.ok(!html.includes("0s ·") && !/ · \d+m\d+s · /.test(html), "no recording length");
  sess.annotations.pattern_run = { case_id: "c2", confirmed_at: null };
  assert.ok(overviewHtml(sess).includes('<span data-summary="steps">2 steps in transaction 2</span>'), "the reference transaction, whichever it is");
});

test("lane FX1: the capture app's default request never names the project: the folder's name does", () => {
  const sess = session({ sessionFolder: "D:/SME/20260925-085516",
    manifest: { engagement_id: "default", engagement_name: "Default engagement" } });
  let html = overviewHtml(sess);
  assert.ok(html.includes('<strong class="ov-summary-name">20260925-085516</strong>'), html.slice(0, 900));
  assert.ok(!html.includes("Default engagement") && !/>default</.test(html));
  delete sess.stats;                                 // before the analysis: the same name
  html = overviewHtml(sess);
  assert.ok(html.includes('<strong class="ov-summary-name">20260925-085516</strong>'));
  const win = session({ sessionFolder: ["C:", "Users", "sme", "20260925-085517"].join(String.fromCharCode(92)),
    manifest: { engagement_id: "default" } });
  assert.ok(overviewHtml(win).includes('<strong class="ov-summary-name">20260925-085517</strong>'), "a Windows path");
  const coded = session({ manifest: { engagement_id: "REQ-2026-042", config: { engagement_name: "Default engagement" } } });
  assert.ok(overviewHtml(coded).includes('<strong class="ov-summary-name">REQ-2026-042</strong>'));
});

test("the project line names the SME when the capture app's Profile recorded a name, else the Windows login", () => {
  const sess = session({ manifest: { engagement_id: "eng-1", engagement_name: "Order intake",
    config: { worker: { id: "w1", name: "Ana Novak" } } } });
  assert.ok(overviewHtml(sess).includes("recorded by Ana Novak"));
  sess.manifest.config.worker.name = "W1";
  assert.ok(overviewHtml(sess).includes("recorded by w1"), "a name that only repeats the login is the login");
});

test("the project line's tooltip names the capture's request (AD-30), never as the project, and not the capture app's default", () => {
  const titleOf = (html) => { const m = /<div class="ov-summary-line"(?: title="([^"]*)")?>/.exec(html); return m ? m[1] || "" : null; };
  const set = titleOf(overviewHtml(session({})));
  assert.ok(set.startsWith("Request: Order intake (eng-1) · Analyzed "), set);
  assert.ok(!/project/i.test(set), set);
  const defaults = titleOf(overviewHtml(session({ manifest: { engagement_id: "default", engagement_name: "Default engagement" } })));
  assert.ok(defaults.startsWith("Analyzed ") && !/request|default|project/i.test(defaults), defaults);
  const bare = session({ manifest: { engagement_id: "default" } });
  bare.stats.meta = {};
  assert.equal(titleOf(overviewHtml(bare)), "", "nothing to say: no tooltip");
});

test("the marker warnings name the transaction in the new words; a label that only numbers it is left out (AD-29)", () => {
  const at = (sec) => new Date(Date.UTC(2026, 4, 17, 9, 0, sec)).toISOString();
  const marker = (sec, type, label) => ({ type: "marker", timestamp: at(sec), data: { marker_type: type, label: label || null } });
  const sess = session({ events: [{ type: "activity", timestamp: at(0) }, marker(30, "end"),
    marker(60, "start", "Run 2"), marker(62, "end"), marker(300, "start", "Order entry")] });
  const html = overviewHtml(sess);
  const warn = html.slice(html.indexOf('class="ov-summary-warn"'), html.indexOf('id="ov-doc"'));
  assert.ok(warn.includes("⚠ The end marker at 0:30 has no open transaction to end."), warn);
  assert.ok(warn.includes("⚠ The transaction at 1:00 is only 2s long (accidental?)"), warn);
  assert.ok(warn.includes('⚠ The transaction "Order entry" at 5:00 has no end marker.'), warn);
  assert.ok(warn.includes('data-fix="close-start">End it where the recording ends</button>'), "the fix stays");
  assert.ok(!/\bRun\b|unlabeled|matching End|open Start/.test(warn), warn);
  const numbered = overviewHtml(session({ events: [{ type: "activity", timestamp: at(0) }, marker(60, "start", "Transaction 2")] }));
  assert.ok(numbered.includes("⚠ The transaction at 1:00 has no end marker."), "the capture app's own number is not repeated");
});

test("the project line carries the video and the transcript, each with its act", () => {
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

test("the document is collapsed while acts are left, says who writes it, how many fields are written and which are empty, and names where each lands", () => {
  const sess = session({});
  sess.annotations.document = { title: "Order intake", purpose: "Why", trigger: "An order e-mail" };
  const html = overviewHtml(sess);
  assert.ok(html.includes('<details class="analysis-section analysis-module ov-doc" id="ov-doc">'), "closed by default");
  assert.ok(html.includes('<span class="analysis-module-title">Document</span>' +
    '<span class="ov-block-who" id="ov-doc-who">You write these. The PDD prints them.</span>'));
  assert.ok(html.includes('<span class="analysis-module-takeaway" id="ov-doc-status">3 of 9 written. To write: ' +
    "Scope, Result, Key contacts, Business rules, Exceptions, Improvement and automation scope</span>"));
  // AD-29: an empty field asks its short question; where it lands is its
  // tooltip only (P3.6: never a resident line), never "In the PDD" inside it.
  assert.equal((html.match(/placeholder="In the PDD/g) || []).length, 0);
  assert.equal((html.match(/title="In the PDD: /g) || []).length, 10);
  assert.ok(!html.includes("ov-doc-where"));
  assert.ok(html.includes('<textarea class="ov-doc-input" data-doc="purpose" placeholder="Why is the process done, and for whom?" ' +
    'title="In the PDD: Purpose" rows="3">Why</textarea>'));
  assert.ok(/data-doc="title"[^>]*value="Order intake"/.test(html));
  for (const [key, label] of [["trigger", "Trigger"], ["result", "Result"], ["improvement", "Improvement and automation scope"]]) {
    assert.ok(html.includes('<span class="ov-doc-label">' + label + "</span>"), label);
    assert.ok(html.includes('data-doc="' + key + '"'), key);
  }
  assert.ok(html.includes('data-doc="trigger" placeholder="What starts the process?" title="In the PDD: Trigger: what starts the process"'));
  assert.ok(html.includes('data-doc="result" placeholder="What does the process end with?"'));
  assert.ok(html.includes('data-doc="improvement" placeholder="What could be improved or automated?"'));
  assert.ok(/data-doc="trigger"[^>]*>An order e-mail<\/textarea>/.test(html));
  const none = overviewHtml(session({}));
  assert.ok(none.includes('id="ov-doc-status">0 of 9 written</span>'), "with nothing written, the count alone");
  const all = session({});
  all.annotations.document = Object.assign({}, FULL_DOC);
  assert.ok(overviewHtml(all).includes('id="ov-doc-status">9 of 9 written</span>'));
});

test("lane FX2: a project without start markers is one transaction, said the same way on the Checklist and the project line", () => {
  const sess = session({ stats: { meta: {}, case_stats: [{ case_id: "imp", start_ts: t(0), end_ts: null, implicit: true }] },
    manifest: { source: "blank", label: "Order intake" }, events: [] });
  for (const s of sess.annotations.steps) s.case_id = "imp";
  const st = pathState(sess);
  assert.equal(st.implicit, true);
  assert.equal(st.done.runs, true);
  const html = overviewHtml(sess);
  assert.ok(/<li class="ov-next-stage done" data-stage="runs" title="[^"]+"><span class="ov-next-mark" aria-hidden="true">✓<\/span>One transaction \(not marked\)<\/li>/.test(html), html.slice(0, 600));
  assert.ok(html.includes('<span data-summary="runs">One transaction (not marked)</span>'));
  assert.ok(!/1 transaction</.test(html));
  // A recording with its markers keeps its count.
  const marked = overviewHtml(session());
  assert.ok(marked.includes('<span data-summary="runs">3 transactions</span>'));
  assert.ok(marked.includes(">Mark the transactions</li>"));
});
