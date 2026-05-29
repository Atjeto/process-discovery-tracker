/*
 * Unit tests for the €-ROI section renderer in views/analysis-view.js (§11c).
 *
 * `_roiSection` is a pure HTML-string builder (no DOM reads), so it is
 * testable head-less under node:test. These pin the band legend (a
 * COHERENCE-AUDIT requirement), the needs-input vs. monetary modes, the
 * observed-floor note, and the empty state.
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

function roiBlock(opts) {
  opts = opts || {};
  return {
    currency: opts.currency || "EUR",
    needs_input: opts.needs_input === undefined ? true : opts.needs_input,
    inputs_used: {
      loaded_cost_per_hour: opts.rate === undefined ? null : opts.rate,
      realism_factors: { conservative: 0.5, expected: 0.7, optimistic: 0.9 },
      automatable_fraction: 0.7,
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

test("band legend is always present with the three realism multipliers", () => {
  const html = _roiSection(roiBlock({ candidates: [candidate({})] }));
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
    candidates: [candidate({ expH: 0.02 })],
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
    candidates: [candidate({ consNet: 100, expNet: 200, optNet: 300, payback: 8.5 })],
    totals: { saved_hours_per_year: 5.0, net_annual: 200, gross_annual: 500 },
  }));
  assert.match(html, /€200/);              // expected net
  assert.match(html, /€300/);              // optimistic net
  assert.match(html, /net €\/yr/);          // totals label
  assert.match(html, /8\.5/);               // payback months
  assert.match(html, /Net €\/yr/);          // expected-column header in money mode
});

test("observed-floor volume basis is flagged so it can't be mistaken for a year", () => {
  const html = _roiSection(roiBlock({ candidates: [candidate({ basis: "observed" })] }));
  assert.match(html, /observed floor/);
});

test("every candidate gets a per-segment tune affordance carrying its signature", () => {
  const html = _roiSection(roiBlock({
    candidates: [candidate({ sig: "deadbeef0001" }), candidate({ sig: "deadbeef0002" })],
  }));
  assert.match(html, /data-segment-signature="deadbeef0001"/);
  assert.match(html, /data-segment-signature="deadbeef0002"/);
  // The session-level edit affordance is present too.
  assert.match(html, /roi-edit-btn/);
});

test("HTML-unsafe candidate labels are escaped", () => {
  const html = _roiSection(roiBlock({
    candidates: [candidate({ label: '<img src=x onerror=alert(1)>' })],
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});
