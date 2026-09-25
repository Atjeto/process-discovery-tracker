"use strict";
/*
 * The Overview's Observations, one source with the PDD (lane CC): two items,
 * the PDD's section 5 and section 6 as it prints them.
 *   Data: the table of the fields entered (Field, System and screen, Step,
 *     Example value, Re-keyed), then the Re-keyed data sentences.
 *   Applications and time: Time per transaction (with the line on the
 *     walkthrough) and Time in each application.
 * Nothing is measured here: the rows are analysis.json `pdd_data` and
 * `pdd_time`, which the pipeline computes with the functions the PDD prints
 * them with. shared/pdd-rows-golden.json pins both sides: this file checks
 * that the Overview shows each case's rows cell by cell, under the PDD's
 * headings; normalization/test/test_pdd_rows_golden.py that the pipeline gives
 * them and the PDD prints them. A failed stage is said (C12); an analysis
 * from before the rows says it is not measured yet.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { overviewHtml } = require("./views/overview-view.js");
const { observationsHtml, dataItem, timeItem, rowsTableHtml, OBSERVATIONS_WHO } = require("./views/analysis-view.js");

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "pdd-rows-golden.json"), "utf-8"));

/* The text of an HTML fragment's cells, table by table: [[[cell, ...], ...], ...]
   (the header row first), decoded as the page shows them. */
function decode(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function tablesOf(html) {
  return [...html.matchAll(/<table class="ov-rows">([\s\S]*?)<\/table>/g)].map((m) =>
    [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]))));
}
function listOf(html, cls) {
  const m = new RegExp('<ul class="' + cls + '">([\\s\\S]*?)</ul>').exec(html);
  return m ? [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => decode(x[1])) : [];
}
function titlesOf(html) {
  return [...html.matchAll(/<div class="ov-rows-title">([\s\S]*?)<\/div>/g)].map((m) => decode(m[1]));
}
function moduleOf(html, key) {
  const at = html.indexOf('data-module="' + key + '"');
  assert.ok(at >= 0, "the " + key + " module is there");
  const end = html.indexOf("</details>", at);
  return html.slice(at, end);
}

/* ---- the shared golden: the Overview shows the PDD's rows ------------------- */

test("golden: the fixture covers the tables, the notes and the re-keyed data", () => {
  assert.equal(GOLDEN.version, 1);
  const cases = GOLDEN.cases.map((c) => c.expected);
  assert.ok(cases.some((c) => c.pdd_data.rekeyed.length), "a case re-keys a value");
  assert.ok(cases.some((c) => c.pdd_data.note), "a case has no field entry");
  assert.ok(cases.some((c) => c.pdd_time.per_transaction.note), "a case has no transaction marked");
});

for (const c of GOLDEN.cases) {
  test("golden: the Overview shows the PDD's rows cell by cell: " + c.name, () => {
    const analysis = { case_quality: {}, stage_errors: [], pdd_data: c.expected.pdd_data, pdd_time: c.expected.pdd_time };
    const html = observationsHtml({ analysis });
    const d = c.expected.pdd_data, t = c.expected.pdd_time;
    // Data: the PDD's heading, its table (or its sentence), its Re-keyed data.
    const data = moduleOf(html, "data");
    assert.ok(data.includes('<span class="analysis-module-title">' + d.heading + "</span>"), "titled as the PDD's section 5");
    if (d.note) {
      assert.ok(decode(data).includes(d.note), "the PDD's sentence in place of the table");
      assert.deepEqual(tablesOf(data), []);
    } else {
      assert.deepEqual(tablesOf(data), [[d.header].concat(d.rows)], "the table, cell by cell");
    }
    assert.deepEqual(listOf(data, "ov-rekeyed"), d.rekeyed, "the Re-keyed data, sentence by sentence");
    assert.equal(titlesOf(data).includes("Re-keyed data"), d.rekeyed.length > 0);
    // Applications and time: 6.1 and 6.2 under the PDD's sub-headings.
    const time = moduleOf(html, "time");
    assert.ok(time.includes('<span class="analysis-module-title">' + t.heading + "</span>"), "titled as the PDD's section 6");
    assert.deepEqual(titlesOf(time), [t.per_transaction.heading, t.per_application.heading]);
    const want = [];
    if (!t.per_transaction.note) want.push([t.per_transaction.header].concat(t.per_transaction.rows));
    if (!t.per_application.note) want.push([t.per_application.header].concat(t.per_application.rows));
    assert.deepEqual(tablesOf(time), want, "the tables, cell by cell");
    for (const s of [t.per_transaction.note, t.per_transaction.after, t.per_application.note]) {
      if (s) assert.ok(decode(time).includes(s), "the PDD's line: " + s);
    }
  });
}

/* ---- the takeaways, the states ----------------------------------------------------- */

const FULL = GOLDEN.cases[0].expected;

test("the takeaways: the first re-keyed sentence (and how many more), the system with the most time per transaction", () => {
  const d = dataItem({ pdd_data: FULL.pdd_data });
  assert.equal(d.takeaway, FULL.pdd_data.rekeyed[0] + " (+1 more)");
  const t = timeItem({ pdd_time: FULL.pdd_time });
  const top = FULL.pdd_time.per_application.rows[0];
  assert.equal(t.takeaway, "Most time in " + top[0] + ": " + top[3] + " per transaction");
  const none = dataItem({ pdd_data: Object.assign({}, FULL.pdd_data, { rekeyed: [] }) });
  assert.equal(none.takeaway, FULL.pdd_data.rows.length + " fields entered, none re-keyed");
  const hand = GOLDEN.cases[1].expected;
  assert.equal(dataItem({ pdd_data: hand.pdd_data }).takeaway, hand.pdd_data.note);
  assert.equal(timeItem({ pdd_time: hand.pdd_time }).takeaway, "2 systems, no time measured");
});

test("a failed rows stage says the check could not run, never an empty table (C12)", () => {
  const analysis = { pdd_data: null, pdd_time: null, stage_errors: [{ stage: "pdd_rows", error: "x" }] };
  const html = observationsHtml({ analysis });
  assert.ok(html.includes("This check could not run on this recording, so the fields entered are not listed."));
  assert.ok(html.includes("This check could not run on this recording, so the times are not measured."));
  assert.ok(!html.includes('class="ov-rows"'));
});

test("an analysis from before the rows (format 2) says they are not measured yet; it is analyzed again as it opens", () => {
  const html = decode(observationsHtml({ analysis: { case_quality: {}, stage_errors: [] } }));
  assert.equal((html.match(/Not measured in this project's analysis yet/g) || []).length, 2);
  assert.ok(!html.includes('class="ov-rows"'));
});

test("the Observations block holds exactly its two items and says the PDD prints them", () => {
  const html = observationsHtml({ analysis: { pdd_data: FULL.pdd_data, pdd_time: FULL.pdd_time } });
  assert.equal((html.match(/data-module="/g) || []).length, 2);
  assert.ok(html.includes('data-module="data"') && html.includes('data-module="time"'));
  assert.ok(html.includes('<div class="ov-section-head"><div class="ov-section-title">Observations</div>' +
    '<div class="ov-block-who">' + OBSERVATIONS_WHO + "</div>" +
    '<div class="ov-rows-freshness" id="ov-rows-freshness" hidden></div></div>'),
  "the title says who fills the block; the line on the rows' age is hidden while they are current");
  assert.equal(OBSERVATIONS_WHO, "Measured from the recording. The PDD prints them in sections 5 and 6.");
  // Older than the steps: the quiet line says so, over the rows it keeps.
  const older = observationsHtml({ analysis: { pdd_data: FULL.pdd_data, pdd_time: FULL.pdd_time } },
    "From the last analysis; refreshing");
  assert.ok(older.includes('<div class="ov-rows-freshness" id="ov-rows-freshness">From the last analysis; refreshing</div>'));
  assert.equal((older.match(/class="ov-rows"/g) || []).length, (html.match(/class="ov-rows"/g) || []).length,
    "the previous rows show meanwhile");
  for (const gone of ["Data typed twice", "Where the time goes", "Average time", "Happened in", "ov-time", "ov-retyped"]) {
    assert.ok(!html.includes(gone), gone);
  }
});

test("a table escapes its cells and sets the number columns right", () => {
  const html = rowsTableHtml(["A", "Time"], [["<b>", "1m 07s"]], [1]);
  assert.ok(html.includes("<td>&lt;b&gt;</td>") && html.includes('<td class="num">1m 07s</td>') && html.includes('<th class="num">Time</th>'));
});

/* ---- The home -------------------------------------------------------------- */

const t = (sec) => new Date(Date.UTC(2026, 4, 14, 9, 0, sec)).toISOString();
function session(over) {
  const s = {
    sessionFolder: null,
    analysis: { case_quality: { mode: "markers", case_count: 2, coverage: 1, tier2_unlocked: true },
      findings: [], stage_errors: [], pdd_data: FULL.pdd_data, pdd_time: FULL.pdd_time },
    stats: { meta: { worker_id: "w1", app_names: {} },
      case_stats: [{ case_id: "c1", start_ts: t(5), end_ts: t(30) }, { case_id: "c2", start_ts: t(35), end_ts: t(58) }] },
    annotations: { steps: [
      { step_id: "a", case_id: "c1", name: "Look up the order", state: "auto_suggested", draft_key: "k1", time_range: { start: t(8), end: t(14) } },
      { step_id: "b", case_id: "c2", name: "Look up the order", state: "auto_suggested", draft_key: "k1", time_range: { start: t(38), end: t(42) } },
    ] },
    manifest: { engagement_id: "eng-1", engagement_name: "Order intake", started_at: t(0) },
    events: [],
  };
  return Object.assign(s, over || {});
}

test("the home is the Checklist, the project line, the document, then the Observations; no findings, evidence or ticks", () => {
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

test("the coverage finding is a warning on the project line, not an observation", () => {
  const cov = { id: "cov-1", detector: "coverage_caveat", claim: "The recorder saw less detail in 1 of 3 apps: Citrix (a remote window).", evidence: {} };
  const html = overviewHtml(session({ analysis: Object.assign({}, session().analysis, { findings: [cov] }) }));
  const summary = html.slice(html.indexOf('id="ov-summary"'), html.indexOf('id="ov-doc"'));
  assert.ok(summary.includes("⚠ The recorder saw less detail in 1 of 3 apps: Citrix (a remote window)."));
  assert.equal((html.match(/The recorder saw less detail/g) || []).length, 1);
});
