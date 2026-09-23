"use strict";
/*
 * Contract C12 on the Overview (RP-10): a pipeline stage that failed is named
 * in analysis.json stage_errors and its output key is null. The Overview must
 * say the check could not run; it must never render that as a measured
 * negative (zero-valued fact tiles, "Nothing stood out").
 *
 * Fixture analysis objects go through overviewHtml, the same pure builder
 * renderOverviewLevel writes into the page. Each failure fixture has a
 * control that ran and measured the "negative" honestly, so the tests prove
 * the two states render differently (not merely that a string exists).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { overviewHtml, STAGE_NOT_RUN } = require("./views/overview-view.js");

const CQ = { mode: "markers", case_count: 4, coverage: 0.9, tier2_unlocked: true };
const FACTS = {
  active_ms: 120000, session_span_ms: 180000, idle_ms: 5000, app_switches: 12, switches_per_hour: 30,
  longest_focus_ms: 40000, rekey_count: 2, repeated_sequence_count: 3,
  top_apps: [{ app: "Excel", share: 0.5 }], app_time_source: "focus",
};
const ZERO_FACTS = Object.assign({}, FACTS, {
  active_ms: 0, idle_ms: 0, app_switches: 0, switches_per_hour: 0, longest_focus_ms: 0,
  rekey_count: 0, repeated_sequence_count: 0,
});
const FINDING = { id: "f1", detector: "screen_time_sink", tier: 1, claim: "Most time went to Excel", evidence: { share: 0.5 } };

const tileValues = (html) => [...html.matchAll(/<div class="ov-tile-value">([^<]*)<\/div>/g)].map((m) => m[1]);
const tileSubs = (html) => [...html.matchAll(/<div class="ov-tile-sub">([^<]*)<\/div>/g)].map((m) => m[1]);

test("a failed facts stage shows every tile as could-not-be-measured, never a zero", () => {
  const html = overviewHtml({ case_quality: CQ, facts: null, findings: [FINDING],
    stage_errors: [{ stage: "facts", error: "KeyError: 'duration_ms'" }] }, {});
  assert.deepEqual(tileValues(html), ["-", "-", "-", "-", "-", "-"]);
  assert.deepEqual(tileSubs(html), Array(6).fill("could not be measured"), "one sub-line per tile");
  assert.ok(html.includes(STAGE_NOT_RUN + ": the measured facts are missing, not zero."));
  assert.ok(html.includes("Technical detail: KeyError: &#39;duration_ms&#39;"), "the reason is shown, escaped");
  assert.ok(!html.includes("No idle time was measured"), "no idle-time gap is claimed from a failed stage");
});

test("control: facts that ran and measured zeros render as zeros, with no could-not-run note", () => {
  const html = overviewHtml({ case_quality: CQ, facts: ZERO_FACTS, findings: [FINDING] }, {});
  const values = tileValues(html);
  assert.equal(values.length, 6);
  assert.ok(!values.includes("-"), "measured tiles carry values: " + values.join(","));
  assert.ok(!html.includes("could not be measured"));
  assert.ok(!html.includes(STAGE_NOT_RUN));
});

test("a failed findings stage says the check could not run, never 'Nothing stood out'", () => {
  const html = overviewHtml({ case_quality: CQ, facts: FACTS, findings: null,
    stage_errors: [{ stage: "findings", error: "not run: depends on failed stage(s) motifs" }] }, {});
  assert.ok(html.includes(STAGE_NOT_RUN + ", so it cannot say whether anything stood out."));
  assert.ok(!/Nothing stood out/i.test(html));
  assert.ok(html.includes("Technical detail: not run: depends on failed stage(s) motifs"));
});

test("control: findings that ran and found nothing still say 'Nothing stood out'", () => {
  const html = overviewHtml({ case_quality: CQ, facts: FACTS, findings: [] }, {});
  assert.ok(/Nothing stood out/.test(html));
  assert.ok(!html.includes(STAGE_NOT_RUN));
});

test("a failed repeated-sequence count is not shown as 0 repeated sequences", () => {
  const html = overviewHtml({ case_quality: CQ, facts: Object.assign({}, FACTS, { repeated_sequence_count: null }),
    findings: [FINDING], stage_errors: [{ stage: "motifs", error: "ValueError: x" }] }, {});
  assert.ok(tileSubs(html).includes("repeated sequences could not be measured"));
  assert.ok(!tileSubs(html).some((s) => /^0 repeated sequences$/.test(s)));
  const ok = overviewHtml({ case_quality: CQ, facts: FACTS, findings: [FINDING] }, {});
  assert.ok(tileSubs(ok).includes("3 repeated sequences"), "control: a measured count renders as a count");
});

test("a failed case check is said on the badge, not read as 'not analyzed' or 'no cases'", () => {
  const html = overviewHtml({ case_quality: null, facts: FACTS, findings: [FINDING],
    stage_errors: [{ stage: "case_quality", error: "TypeError: bad marker" }] }, {});
  assert.ok(html.includes("The case check could not run on this recording"));
  assert.ok(!html.includes("No analysis yet"));
  assert.ok(!html.includes("No cases identified yet"), "no case gap is claimed from a failed check");
  assert.equal(tileValues(html).length, 6, "the facts that did run are still shown");
  const never = overviewHtml({ meta: {} }, {});
  assert.ok(never.includes("No analysis yet"), "control: an analysis without the blocks is 'not analyzed yet'");
});
