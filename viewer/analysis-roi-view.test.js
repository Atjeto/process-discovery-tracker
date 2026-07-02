/*
 * Unit tests for the €-ROI section renderer in views/analysis-view.js (§11c),
 * updated for the R1 approachability redesign (§4/§5 of
 * docs/To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md): the whole section body
 * (table, hero figures, per-row tune) is gated on an ANALYST-ENTERED annual
 * volume, not merely on having candidates. The observed-instance-count floor
 * ("volume_basis: observed") does not count as analyst-entered — one
 * recording is not a year.
 *
 * `_roiSection` is a pure HTML-string builder (no DOM reads), so it is
 * testable head-less under node:test. These pin the whole-section gate (the
 * replace-pattern CTA below it), the band legend once gated open, the
 * needs-input vs. monetary modes, the observed-floor note, the empty state,
 * and that AUTO% never renders as a table column.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { _roiSection } = require("./views/analysis-view.js");

function band(realism, hours, net) {
  return {
    realism_factor: realism,
    saved_ms_per_instance: 1000,
    saved_hours_per_year: hours,
    gross_annual: net === null ? null : net + 100,
    net_annual: net,
    payback_months: null,
  };
}

function candidate(opts) {
  opts = opts || {};
  return {
    segment_signature: opts.sig || "abc123",
    label: opts.label || "chrome — Salesforce lookup",
    instance_count: opts.instances || 4,
    mean_elapsed_ms: opts.mean || 16750,
    automatable_fraction: opts.frac || 0.7,
    annual_volume: opts.volume || 4,
    volume_basis: opts.basis || "observed",
    bands: {
      conservative: band(0.5, opts.consH || 0.01, opts.consNet === undefined ? null : opts.consNet),
      expected: band(0.7, opts.expH || 0.02, opts.expNet === undefined ? null : opts.expNet),
      optimistic: band(0.9, opts.optH || 0.03, opts.optNet === undefined ? null : opts.optNet),
    },
    expected_saved_hours_per_year: opts.expH || 0.02,
    expected_net_annual: opts.expNet === undefined ? null : opts.expNet,
    expected_payback_months: opts.payback === undefined ? null : opts.payback,
  };
}

// `hasVolume: true` sets inputs_used.annual_volume so the whole-section gate
// (an explicit analyst-entered annual volume) is satisfied -- the default
// (false) leaves it null, matching a fresh session with no roi_inputs.
function roiBlock(opts) {
  opts = opts || {};
  return {
    currency: opts.currency || "EUR",
    needs_input: opts.needs_input === undefined ? true : opts.needs_input,
    inputs_used: {
      loaded_cost_per_hour: opts.rate === undefined ? null : opts.rate,
      realism_factors: { conservative: 0.5, expected: 0.7, optimistic: 0.9 },
      automatable_fraction: opts.automatable_fraction === undefined ? 0.7 : opts.automatable_fraction,
      annual_volume: opts.volume === undefined ? null : opts.volume,
      automation_cost: null,
      amortization_years: 3.0,
    },
    candidates: opts.candidates || [],
    totals: opts.totals || { saved_hours_per_year: 0.05, net_annual: null, gross_annual: null },
  };
}

test("empty / missing roi renders nothing or a guidance note, never a crash", () => {
  assert.equal(_roiSection(null), "");
  assert.equal(_roiSection(undefined), "");
  const html = _roiSection(roiBlock({ candidates: [] }));
  assert.match(html, /No multi-instance automation candidates/);
  // No table is drawn when there is nothing to cost.
  assert.doesNotMatch(html, /<table/);
});

test("gate: no analyst-entered volume replaces the whole body with the observed-volume takeaway + Edit assumptions CTA", () => {
  const html = _roiSection(roiBlock({
    candidates: [candidate({ basis: "observed", instances: 4 })],
  }));
  // The replace-pattern: no table, no hero figures, no legend -- just the
  // one-line observed-volume sentence and the CTA button.
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /roi-legend/);
  assert.doesNotMatch(html, /roi-totals/);
  assert.match(html, /roi-edit-btn/);
  assert.match(html, /Edit assumptions/);
  assert.match(html, /1 automation candidate observed 4 times/);
  // The module takeaway (memo altitude, visible even collapsed) also must not
  // surface the observed-floor hours/€ figure as if it were a real projection.
  assert.match(html, /No annual volume entered yet/);
});

test("gate: a flat session-wide annual_volume unlocks the full table", () => {
  const html = _roiSection(roiBlock({
    volume: 1000,
    candidates: [candidate({ basis: "default", volume: 1000 })],
  }));
  assert.match(html, /<table/);
  assert.match(html, /roi-legend/);
});

test("gate: a per-segment annual_volume override (volume_basis: annotated) also unlocks the table", () => {
  const html = _roiSection(roiBlock({
    candidates: [candidate({ basis: "annotated", volume: 500 })],
  }));
  assert.match(html, /<table/);
  assert.match(html, /roi-legend/);
});

test("band legend is always present with the three realism multipliers once gated open", () => {
  const html = _roiSection(roiBlock({ volume: 1000, candidates: [candidate({ basis: "default" })] }));
  assert.match(html, /roi-legend/);
  assert.match(html, /conservative/);
  assert.match(html, /expected/);
  assert.match(html, /optimistic/);
  // Multipliers shown so the encoding is self-explaining.
  assert.match(html, /×0\.5/);
  assert.match(html, /×0\.9/);
});

test("needs_input mode shows hours, withholds money, and prompts for a rate", () => {
  const html = _roiSection(roiBlock({
    needs_input: true,
    volume: 1000,
    candidates: [candidate({ basis: "default", expH: 0.02 })],
  }));
  assert.match(html, /Time-savings only/);
  assert.match(html, /h\/yr/);            // band cells are in hours
  assert.match(html, /Hours\/yr/);         // expected-column header
  // No fabricated money: the monetary totals labels / net-per-year cells are
  // absent (the € in the section title is the unit name, not a figure).
  assert.doesNotMatch(html, /net €\/yr/);
  assert.doesNotMatch(html, /gross €\/yr/);
});

test("monetary mode shows € net/yr in the band cells and totals", () => {
  const html = _roiSection(roiBlock({
    needs_input: false,
    currency: "EUR",
    rate: 36,
    volume: 1000,
    candidates: [candidate({ basis: "default", consNet: 100, expNet: 200, optNet: 300, payback: 8.5 })],
    totals: { saved_hours_per_year: 5.0, net_annual: 200, gross_annual: 500 },
  }));
  assert.match(html, /€200/);              // expected net
  assert.match(html, /€300/);              // optimistic net
  assert.match(html, /net €\/yr/);          // totals label
  assert.match(html, /8\.5/);               // payback months
  assert.match(html, /Net €\/yr/);          // expected-column header in money mode
});

test("observed-floor volume basis on ONE candidate is flagged, even once the section is unlocked by another candidate's volume", () => {
  const html = _roiSection(roiBlock({
    candidates: [
      candidate({ sig: "has-volume", basis: "annotated", volume: 500 }),
      candidate({ sig: "no-volume", basis: "observed" }),
    ],
  }));
  assert.match(html, /observed floor/);
});

test("every candidate gets a per-segment tune affordance carrying its signature, once unlocked", () => {
  const html = _roiSection(roiBlock({
    volume: 1000,
    candidates: [candidate({ sig: "deadbeef0001", basis: "default" }), candidate({ sig: "deadbeef0002", basis: "default" })],
  }));
  assert.match(html, /data-segment-signature="deadbeef0001"/);
  assert.match(html, /data-segment-signature="deadbeef0002"/);
  // The session-level edit affordance is present too.
  assert.match(html, /roi-edit-btn/);
});

test("HTML-unsafe candidate labels are escaped, once unlocked", () => {
  const html = _roiSection(roiBlock({
    volume: 1000,
    candidates: [candidate({ basis: "default", label: '<img src=x onerror=alert(1)>' })],
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});

test("item 4: AUTO% never renders as a table column; the automatable share renders once, in the assumptions line", () => {
  const html = _roiSection(roiBlock({
    volume: 1000,
    automatable_fraction: 0.7,
    candidates: [candidate({ basis: "default", frac: 0.7 })],
  }));
  assert.doesNotMatch(html, /Auto%/);
  assert.doesNotMatch(html, />70%<\/td>/);
  // The assumption renders once, in prose, in the legend/assumptions line.
  assert.match(html, /70% of each candidate's time is automatable/);
});
