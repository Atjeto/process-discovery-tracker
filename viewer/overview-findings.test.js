"use strict";
/*
 * The Overview's findings and their "include in PDD" boxes (F2), the one home
 * of a repeated step sequence (AD-20), and the order of the home (P1.10).
 *
 * F2: the boxes show exactly what the PDD prints. The pipeline writes
 * analysis.pdd_findings from the PDD's own selection (memo_export): the
 * findings section 1 can print (`eligible`) and the ones it prints while the
 * analyst ticked none (`default`). The pytest test_pdd_findings_demo.py pins
 * the other half: on the demo those ids are the findings the PDD prints.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { overviewHtml, pddTicks, nextMemoSelection, TO_DEFAULT_TOAST } = require("./views/overview-view.js");
const { orderedCandidates } = require("./views/analysis-view.js");

const t = (min) => new Date(Date.UTC(2026, 4, 17, 9, min)).toISOString();

const FINDINGS = [
  { id: "sink-1", detector: "screen_time_sink", tier: 1, claim: "Most time went to Excel.", evidence: {} },
  { id: "frag-1", detector: "fragmentation", tier: 1, claim: "Focus moved 16 times.", evidence: {} },
  { id: "rep-1", detector: "repetition", tier: 2, claim: "The step sequence A was repeated 4 times.", evidence: {} },
  { id: "rekey-1", detector: "rekey_transfer", tier: 1, claim: "A value was typed twice.", evidence: {} },
];
const PDD = { eligible: ["sink-1", "frag-1", "rekey-1"], default: ["sink-1", "frag-1", "rekey-1"] };

function session(annotations, analysisOver) {
  return {
    sessionFolder: null,
    analysis: Object.assign({
      case_quality: { mode: "markers", case_count: 1, coverage: 1, tier2_unlocked: false },
      facts: { idle_ms: 0 }, findings: FINDINGS, pdd_findings: PDD,
    }, analysisOver || {}),
    stats: { meta: { worker_id: "w1" }, case_stats: [{ case_id: "c1", start_ts: t(0), end_ts: t(10) }] },
    annotations: Object.assign({ steps: [] }, annotations || {}),
    manifest: { engagement_id: "eng-1", engagement_name: "Order intake" },
    events: [{ type: "activity", timestamp: t(0) }, { type: "activity", timestamp: t(10) }],
  };
}

/* The finding ids whose "include in PDD" box renders ticked, in page order. */
function ticked(html) {
  return html.split('<div class="ov-finding" data-fid="').slice(1)
    .filter((card) => /data-act="memo" checked/.test(card))
    .map((card) => card.slice(0, card.indexOf('"')));
}
function cards(html) {
  return [...html.matchAll(/<div class="ov-finding" data-fid="([^"]+)">/g)].map((m) => m[1]);
}

/* ---- F2: the ticks are the PDD's findings ----------------------------------- */

test("with nothing ticked, the boxes show the PDD's default findings ticked", () => {
  const html = overviewHtml(session({}));
  assert.deepEqual(cards(html), ["sink-1", "frag-1", "rekey-1"]);
  assert.deepEqual(ticked(html), PDD.default);
  assert.equal((html.match(/include in PDD/g) || []).length, 3, "one box per finding");
});

test("an explicit selection shows as ticked; one naming no printable finding falls back to the default", () => {
  assert.deepEqual(ticked(overviewHtml(session({ memo_selection: ["frag-1"] }))), ["frag-1"]);
  // An older selection naming only a repeated sequence (AD-20) or a gone finding.
  assert.deepEqual(ticked(overviewHtml(session({ memo_selection: ["rep-1", "gone-9"] }))), PDD.default);
  assert.deepEqual([...pddTicks(PDD, ["rep-1", "rekey-1"])], ["rekey-1"]);
});

test("unticking one stores the others; unticking the last returns to the default", () => {
  const first = nextMemoSelection(PDD, [], "frag-1", false);
  assert.deepEqual(first, { selection: ["sink-1", "rekey-1"], toDefault: false });
  const second = nextMemoSelection(PDD, first.selection, "sink-1", false);
  assert.deepEqual(second, { selection: ["rekey-1"], toDefault: false });
  const last = nextMemoSelection(PDD, second.selection, "rekey-1", false);
  assert.deepEqual(last, { selection: [], toDefault: true });
  assert.deepEqual([...pddTicks(PDD, last.selection)], PDD.default, "the default shows ticked again");
  assert.equal(TO_DEFAULT_TOAST, "No finding is ticked, so the PDD prints its default findings.");
});

test("ticking a box adds it to the ticks as shown, in feed order, dropping ids the PDD cannot print", () => {
  const pdd = { eligible: ["a", "b", "c", "d", "e", "f"], default: ["a", "b", "c", "d", "e"] };
  assert.deepEqual(nextMemoSelection(pdd, [], "f", true).selection, ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(nextMemoSelection(pdd, ["gone", "c"], "a", true).selection, ["a", "c"]);
});

test("an analysis from an older version says to analyze again instead of guessing the ticks", () => {
  const html = overviewHtml(session({}, { pdd_findings: undefined }));
  assert.ok(html.includes("Click Analyze session again to see the findings the PDD prints."));
  assert.deepEqual(cards(html), []);
});

/* ---- AD-20 and P2.7 ----------------------------------------------------------- */

test("a repeated step sequence is not a finding on the Overview, and no card carries a tier chip", () => {
  const html = overviewHtml(session({}));
  assert.ok(!html.includes('data-detector="repetition"'));
  assert.ok(!html.includes("Repeated sequences"));
  assert.ok(!html.includes("ov-finding-tier") && !html.includes("case-based"));
  assert.ok(!html.includes("ov-group-count"));
});

test("a finding the PDD leaves out without runs is left out here too", () => {
  const pdd = { eligible: ["sink-1"], default: ["sink-1"] };
  const html = overviewHtml(session({}, { findings: FINDINGS.concat([{ id: "spread-1", detector: "run_spread",
    tier: 2, claim: "The slowest run took twice as long.", evidence: {} }]), pdd_findings: pdd }));
  assert.deepEqual(cards(html), ["sink-1"]);
});

test("automation candidates are listed by total time, repeated sequences only", () => {
  const order = orderedCandidates([
    { label: "once", data_sufficiency: "single_instance", total_elapsed_ms: 90000 },
    { label: "short", data_sufficiency: "multi_instance", total_elapsed_ms: 22000 },
    { label: "long", data_sufficiency: "multi_instance", total_elapsed_ms: 67000 },
    { label: "tie", data_sufficiency: "multi_instance", total_elapsed_ms: 22000 },
  ]).map((c) => c.label);
  assert.deepEqual(order, ["long", "short", "tie"], "longest first; ties keep the pipeline's order");
});

/* ---- P1.10, P1.4, P3.9: the home's order and words ----------------------------- */

test("the document sections sit directly under the summary line, before the findings", () => {
  const html = overviewHtml(session({}));
  const at = (s) => html.indexOf(s);
  assert.ok(at('id="ov-summary"') > 0 && at('id="ov-summary"') < at('id="ov-doc"'));
  assert.ok(at('id="ov-doc"') < at("Findings: measured"));
  assert.ok(at("Findings: measured") < at('id="overview-evidence"'));
  assert.ok(!html.includes("To say more"), "P1.4: the To say more box is gone");
});

test("the summary line names the document title once it is written", () => {
  const plain = overviewHtml(session({}));
  assert.ok(plain.includes('<strong class="ov-summary-name">Order intake</strong>'));
  const titled = overviewHtml(session({ document: { title: "Enter e-mailed orders" } }));
  assert.ok(titled.includes('<strong class="ov-summary-name">Enter e-mailed orders</strong>'));
});
