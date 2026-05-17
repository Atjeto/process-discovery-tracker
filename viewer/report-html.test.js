/*
 * Unit tests for report-html.js -- the self-contained HTML findings
 * report. generateFindingsReport is pure, so fixtures are plain objects.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateFindingsReport } = require("./report-html.js");

function sampleSession() {
  return {
    sessionFolder: "/s/eng/20260517-100000",
    manifest: {
      engagement_id: "ENG-7",
      started_at: "2026-05-17T10:00:00Z",
      config: { worker: { id: "w-1" } },
    },
    stats: {
      activity_stats: [
        { activity_label: "CRM", total_duration_ms: 6000, frequency: 2 },
      ],
      case_stats: [],
      meta: {
        normalization_run_at: "2026-05-17T11:00:00Z",
        raw_event_count: 10, case_count: 1, step_count: 1,
        step_state_breakdown: { auto_suggested: 1, auto_matched: 0,
          manually_authored: 0, edited: 0 },
      },
    },
    events: [
      { type: "activity", timestamp: "2026-05-17T10:00:00Z", data: { app: "a.exe", duration_ms: 1000 } },
      { type: "activity", timestamp: "2026-05-17T10:05:00Z", data: { app: "a.exe", duration_ms: 1000 } },
      { type: "system", timestamp: "2026-05-17T10:02:00Z",
        data: { kind: "screenshot_manual", path: "screenshots/001.jpg" } },
    ],
    annotations: {
      steps: [
        { step_id: "st1", name: "Enter customer data", state: "auto_suggested",
          time_range: { start: "2026-05-17T10:00:00Z", end: "2026-05-17T10:04:12Z" } },
        { step_id: "st2", name: "Noise step", state: "hidden",
          time_range: { start: "2026-05-17T10:04:12Z", end: "2026-05-17T10:04:20Z" } },
      ],
      notes: [
        { id: "n1", timestamp: "2026-05-17T10:03:00Z", text: "Worker paused for a lookup" },
      ],
      starred_screenshots: ["screenshots/001.jpg"],
    },
    analysis: {
      efficiency: { process_efficiency_ratio: 0.62, total_va_ms: 62000,
        total_elapsed_ms: 100000 },
      waste_classification: [
        { step_id: "st1", name: "Enter customer data", elapsed_ms: 100000,
          va_ms: 62000, bnva_ms: 0, nva_ms: 38000, waste_types: ["waiting"] },
      ],
      automation_candidates: [
        { step_id: "st1", name: "Enter customer data",
          scores: { repetitiveness: null, rule_based: null, volume: 100000 },
          data_sufficiency: "single_instance" },
      ],
    },
  };
}

const ALL_ON = {
  includeProcessMap: true, includeAnalysis: true,
  includeNotes: true, includeScreenshots: true,
  processMapSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  screenshotData: { "screenshots/001.jpg": "data:image/jpeg;base64,AAAA" },
};

test("generateFindingsReport returns a complete HTML document", () => {
  const html = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("</html>"));
  assert.ok(html.includes("<style>"));
});

test("the report carries the engagement and a confirmed step", () => {
  const html = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(html.includes("ENG-7"));
  assert.ok(html.includes("Enter customer data"));
});

test("hidden steps are excluded from the steps table", () => {
  const html = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(!html.includes("Noise step"));
});

test("the recommendations block is always present and editable", () => {
  const html = generateFindingsReport(sampleSession(), {});
  assert.ok(html.includes('contenteditable="true"'));
});

test("the process map is embedded only when requested and supplied", () => {
  const withMap = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(withMap.includes("<figure>"));
  const noMap = generateFindingsReport(sampleSession(),
    { ...ALL_ON, includeProcessMap: false });
  assert.ok(!noMap.includes("<figure>"));
  const noSvg = generateFindingsReport(sampleSession(),
    { ...ALL_ON, processMapSvg: null });
  assert.ok(!noSvg.includes("<figure>"));
});

test("the analysis section appears with analysis data and toggles off", () => {
  const on = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(on.includes("Waste &amp; automation findings"));
  assert.ok(on.includes("62%"));
  const off = generateFindingsReport(sampleSession(),
    { ...ALL_ON, includeAnalysis: false });
  assert.ok(!off.includes("Waste &amp; automation findings"));
});

test("notes and starred screenshots honour their toggles", () => {
  const on = generateFindingsReport(sampleSession(), ALL_ON);
  assert.ok(on.includes("Worker paused for a lookup"));
  assert.ok(on.includes("data:image/jpeg;base64,AAAA"));
  const off = generateFindingsReport(sampleSession(),
    { ...ALL_ON, includeNotes: false, includeScreenshots: false });
  assert.ok(!off.includes("Worker paused for a lookup"));
  assert.ok(!off.includes("Starred screenshots"));
});

test("HTML in session data is escaped", () => {
  const sess = sampleSession();
  sess.annotations.steps[0].name = "<script>alert(1)</script>";
  const html = generateFindingsReport(sess, ALL_ON);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("an unanalyzed session still produces a report", () => {
  const html = generateFindingsReport({ manifest: { engagement_id: "E" } }, {});
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("not been analyzed"));
});
