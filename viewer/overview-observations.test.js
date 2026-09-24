"use strict";
/*
 * The Overview's Observations (step-back review 4.4, lane V1 item 3): two
 * items in place of the findings feed, the evidence modules and the
 * "include in PDD" ticks.
 *   Data typed twice: the re-typed values finding, said per field where the
 *     events name the fields ("Product code in Salesforce typed again as
 *     Material number in SAP", each place named by its system, C14); a failed
 *     findings stage is said (C12), never read as "none".
 *   Where the time goes: per step (the map's grouping) its average time per
 *     run and "in N of M runs"; per system the same (where the automation
 *     candidates fold in); no dot strip, no total over the runs,
 *     no business-required editor.
 * The viewer no longer reads analysis.json pdd_findings or
 * annotations.memo_selection.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { overviewHtml } = require("./views/overview-view.js");
const { observationsHtml, retypedLines, timePerStep } = require("./views/analysis-view.js");

const t = (sec) => new Date(Date.UTC(2026, 4, 14, 9, 0, sec)).toISOString();
// A window title's separator, built so this file holds no dash punctuation.
const SF_ORDER = "Salesforce" + " " + String.fromCharCode(45) + " " + "Order";

/* Two runs of the demo's shape: run 1 types SKU-1 into Salesforce's Product
   code (in Chrome) and SAP's Material number; run 2 does the same and looks
   the code up in Notepad in between. */
const EVENTS = [
  { type: "activity", timestamp: t(0), data: {} },
  { type: "interaction", event_id: "e1", timestamp: t(10), data: { kind: "value_changed", process_name: "chrome.exe",
    window_title: SF_ORDER, name: "Product code", automation_id: "product-code", value: "SKU-1" } },
  { type: "interaction", event_id: "e2", timestamp: t(20), data: { kind: "value_changed", process_name: "SAPGUI.exe",
    name: "Material number", automation_id: "material-number", value: "SKU-1" } },
  { type: "interaction", event_id: "e3", timestamp: t(40), data: { kind: "value_changed", process_name: "chrome.exe",
    window_title: SF_ORDER, name: "Product code", automation_id: "product-code", value: "SKU-1" } },
  { type: "interaction", event_id: "e4", timestamp: t(45), data: { kind: "text_changed", process_name: "notepad.exe",
    name: "", automation_id: "mapping-search", value: "SKU-1" } },
  { type: "interaction", event_id: "e5", timestamp: t(50), data: { kind: "value_changed", process_name: "SAPGUI.exe",
    name: "Material number", automation_id: "material-number", value: "SKU-1" } },
  { type: "activity", timestamp: t(59), data: {} },
];
const APP_NAMES = { "chrome.exe": "Google Chrome (browser)", "SAPGUI.exe": "SAP GUI", "notepad.exe": "Notepad" };
const REKEY = { id: "rekey-1", detector: "rekey_transfer", tier: 1,
  claim: "1 value was typed into more than one app; for example, \"SKU-1\" was entered in Google Chrome (browser), Notepad, SAP GUI (6 times in total).",
  evidence: { rekey_count: 1, values: [{ value: "SKU-1", apps: ["chrome.exe", "notepad.exe", "sapgui.exe"], entry_count: 5 }] } };

function step(id, caseId, name, fromSec, toSec, app, extra) {
  return Object.assign({ step_id: id, case_id: caseId, name, state: "auto_suggested",
    draft_key: app + "|screen|" + name, grain_keys: { app, screen: app === "chrome" ? SF_ORDER : "screen", element: "e" },
    time_range: { start: t(fromSec), end: t(toSec) } }, extra || {});
}

function session(over) {
  const s = {
    sessionFolder: null,
    analysis: { case_quality: { mode: "markers", case_count: 2, coverage: 1, tier2_unlocked: true },
      findings: [REKEY], stage_errors: [] },
    stats: {
      meta: { worker_id: "w1", app_names: APP_NAMES, draft_summary: {} },
      case_stats: [
        { case_id: "c1", start_ts: t(5), end_ts: t(30) },
        { case_id: "c2", start_ts: t(35), end_ts: t(58) },
      ],
    },
    annotations: { steps: [
      step("a", "c1", "Look up the order", 8, 14, "chrome"),
      step("b", "c1", "Create the sales order", 18, 26, "sapgui"),
      step("c", "c2", "Look up the order", 38, 42, "chrome"),
      step("d", "c2", "Find the material number", 44, 46, "notepad"),
      step("e", "c2", "Create the sales order", 48, 52, "sapgui"),
      step("f", "c2", "Create the sales order", 53, 57, "sapgui"),
    ] },
    manifest: { engagement_id: "eng-1", engagement_name: "Order intake", started_at: t(0) },
    events: EVENTS,
  };
  return Object.assign(s, over || {});
}

/* ---- Data typed twice ------------------------------------------------------ */

test("data typed twice is said per field: the first place the value went, then each other system it was typed into again, named by the one vocabulary of systems", () => {
  const r = retypedLines(session().analysis, EVENTS, APP_NAMES);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.lines, [
    "Product code in Salesforce typed again as Material number in SAP",
    "Product code in Salesforce typed again as mapping-search in Notepad",
  ]);
});

test("without field names in the events the finding's own sentence stands; nothing typed twice says none", () => {
  const bare = EVENTS.map((e) => (e.type === "interaction" ? Object.assign({}, e, { data: Object.assign({}, e.data, { value: "other" }) }) : e));
  assert.deepEqual(retypedLines(session().analysis, bare, APP_NAMES), { status: "ok", lines: [REKEY.claim] });
  assert.deepEqual(retypedLines({ findings: [] }, EVENTS, APP_NAMES), { status: "none", lines: [] });
});

test("a failed findings stage says the check could not run, never 'none' (C12)", () => {
  assert.deepEqual(retypedLines({ findings: null }, EVENTS, APP_NAMES), { status: "not-run", lines: [] });
  const html = observationsHtml(session({ analysis: { case_quality: {}, findings: null,
    stage_errors: [{ stage: "findings", error: "x" }] } }));
  assert.ok(html.includes("This check could not run on this recording, so it cannot say whether data was typed twice."));
  assert.ok(!html.includes("None seen"));
});

/* ---- Where the time goes ----------------------------------------------------- */

test("where the time goes: per step, the average time per run and in how many runs, most time first", () => {
  const r = timePerStep(session().stats, session().annotations.steps, APP_NAMES);
  assert.equal(r.runCount, 2);
  assert.deepEqual(r.steps.map((x) => [x.label, x.avgMs, x.runs]), [
    // 8 s in run 1, 4 + 4 s in run 2 (the step was done twice): 8 s per run.
    ["Create the sales order", 8000, 2],
    ["Look up the order", 5000, 2],
    ["Find the material number", 2000, 1],
  ]);
});

test("where the time goes: per system too, the browser named by the web system its window shows (the automation candidates fold in here)", () => {
  const r = timePerStep(session().stats, session().annotations.steps, APP_NAMES);
  assert.deepEqual(r.apps.map((x) => [x.label, x.avgMs, x.runs]), [
    ["SAP", 8000, 2],
    ["Salesforce", 5000, 2],
    ["Notepad", 2000, 1],
  ]);
});

test("where the time goes: a system the analyst set on a step wins over the derived one (C16)", () => {
  const s = session();
  s.annotations.steps.push({ step_id: "p", case_id: "c1", name: "Call the customer", state: "manually_authored",
    system: "Phone", time_range: { start: t(26), end: t(29) } });
  s.annotations.steps[0].system = "CRM";
  const r = timePerStep(s.stats, s.annotations.steps, APP_NAMES);
  assert.deepEqual(r.apps.map((x) => [x.label, x.avgMs, x.runs]), [
    ["SAP", 8000, 2],
    ["CRM", 6000, 1],
    ["Salesforce", 4000, 1],
    ["Phone", 3000, 1],
    ["Notepad", 2000, 1],
  ]);
});

test("hidden steps and steps outside the runs are not counted; a step with no measured time is left out", () => {
  const s = session();
  s.annotations.steps.push(step("g", null, "Outside", 1, 4, "chrome"));
  s.annotations.steps.push(step("h", "c1", "Hidden one", 26, 29, "chrome", { state: "hidden" }));
  s.annotations.steps.push(step("i", "c1", "No time", 29, 29, "chrome"));
  const labels = timePerStep(s.stats, s.annotations.steps, APP_NAMES).steps.map((x) => x.label);
  assert.deepEqual(labels, ["Create the sales order", "Look up the order", "Find the material number"]);
});

test("the Observations block holds exactly its two items, with no dot strip, total, editor or tick", () => {
  const html = observationsHtml(session());
  assert.equal((html.match(/data-module="/g) || []).length, 2);
  assert.ok(html.includes('data-module="retyped"') && html.includes('data-module="time"'));
  assert.ok(html.includes(">Observations<"));
  assert.ok(html.includes(">Data typed twice<") && html.includes(">Where the time goes<"));
  assert.ok(html.includes("in 2 of 2 runs") && html.includes("in 1 of 2 runs"));
  assert.ok(html.includes("Most in Create the sales order: 8.0s per run"));
  for (const gone of ["ts-dot", "ts-strip", "waste-row", "business-required", "include in PDD", "data-act=\"memo\"", "Automation candidates"]) {
    assert.ok(!html.includes(gone), gone);
  }
});

test("with no runs marked, where the time goes says so", () => {
  const html = observationsHtml(session({ stats: { meta: { app_names: APP_NAMES }, case_stats: [] },
    annotations: { steps: [] } }));
  assert.ok(html.includes("No runs are marked yet"));
});

/* ---- The home -------------------------------------------------------------- */

test("the home is the What is left line, the recording line, the document, then the Observations; no findings, evidence or ticks", () => {
  const html = overviewHtml(session({ analysis: Object.assign(session().analysis, {
    pdd_findings: { eligible: ["rekey-1"], default: ["rekey-1"] } }) }));
  const at = (x) => html.indexOf(x);
  assert.ok(html.startsWith('<div class="ov-next" id="ov-next"'), "the line leads");
  assert.ok(at('id="ov-next"') < at('id="ov-summary"'));
  assert.ok(at('id="ov-summary"') < at('id="ov-doc"'));
  assert.ok(at('id="ov-doc"') < at('id="ov-observations"'));
  for (const gone of ["Findings", "overview-evidence", "include in PDD", "ov-finding", "Evidence"]) {
    assert.ok(!html.includes(gone), gone);
  }
});

test("the coverage finding is a warning on the recording line, not an observation", () => {
  const cov = { id: "cov-1", detector: "coverage_caveat", claim: "The recorder saw less detail in 1 of 3 apps: Citrix (a remote window).", evidence: {} };
  const html = overviewHtml(session({ analysis: Object.assign({}, session().analysis, { findings: [REKEY, cov] }) }));
  const summary = html.slice(html.indexOf('id="ov-summary"'), html.indexOf('id="ov-doc"'));
  assert.ok(summary.includes("⚠ The recorder saw less detail in 1 of 3 apps: Citrix (a remote window)."));
  assert.equal((html.match(/The recorder saw less detail/g) || []).length, 1);
});
