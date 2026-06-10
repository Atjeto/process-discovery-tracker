/*
 * Self-Annotation Wizard tests -- ported from the project-vision-ai-ml
 * branch (its suite ran green there), plus the clean-edition
 * capture_observations cases (lab-phase §E3). Runs under node:test.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TEMPLATES, generateQuestions, buildSelfAnnotation } = require("./wizard.js");

test("TEMPLATES has the 7 expected pattern types", () => {
  const keys = TEMPLATES.map(t => t.key);
  assert.ok(keys.includes("longest_segment"));
  assert.ok(keys.includes("top_activity_cluster"));
  assert.ok(keys.includes("anomaly"));
  assert.ok(keys.includes("ambiguous_case_boundary"));
  assert.ok(keys.includes("high_frequency_motif"));
});

test("Each template has at least 3 phrasing variants", () => {
  for (const t of TEMPLATES) {
    assert.ok(t.phrasings.length >= 3, `${t.key} has ${t.phrasings.length} variants`);
  }
});

test("generateQuestions returns no more than 5 questions", () => {
  // Rich session with everything that could trigger a question.
  const session = {
    stats: {},
    annotations: {
      steps: Array.from({ length: 5 }, (_, i) => ({
        step_id: `s${i}`,
        name: `Step ${i}`,
        time_range: { start: `2026-06-05T09:0${i}:00Z`, end: `2026-06-05T09:0${i + 1}:00Z` },
        grain_keys: { app: "test.exe" },
      })),
      marker_suggestions: [
        { suggestion_id: "m1", score: 0.5, timestamp: "2026-06-05T09:30:00Z" },
      ],
    },
    patterns: {
      activity_clusters: [
        { cluster_id: "c1", process_label: "Search", occurrence_count: 10 },
      ],
      anomalies: [{ case_id: "case-x", start_ts: "2026-06-05T09:45:00Z" }],
      motifs: [{ motif_id: "m1", labels: ["A", "B"], frequency: 5 }],
    },
  };
  const qs = generateQuestions(session);
  assert.ok(qs.length <= 5, `got ${qs.length} questions`);
});

test("generateQuestions handles empty session gracefully", () => {
  assert.deepEqual(generateQuestions(null), []);
  assert.deepEqual(generateQuestions({}), []);
});

test("generateQuestions substitutes observed values into the template", () => {
  const session = {
    annotations: {
      steps: [{
        step_id: "s1",
        name: "Long step",
        time_range: { start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:30:00Z" },
        grain_keys: { app: "excel.exe" },
      }],
    },
    patterns: {},
  };
  const qs = generateQuestions(session);
  const longest = qs.find(q => q.template_key === "longest_segment");
  assert.ok(longest, "should produce a longest_segment question");
  assert.ok(longest.question.includes("excel.exe"));
});

test("buildSelfAnnotation produces a valid record", () => {
  const q = { question: "What were you doing?", template_key: "longest_segment", observed: { step_id: "s1" } };
  const sa = buildSelfAnnotation(q, "Reviewing data", true);
  assert.equal(sa.template_key, "longest_segment");
  assert.equal(sa.answer, "Reviewing data");
  assert.equal(sa.is_exception, true);
  assert.equal(sa.manually_authored, true);
  assert.ok(sa.self_annotation_id);
  assert.ok(sa.created_at);
});

test("Variant rotation gives different phrasings for same observation", () => {
  const session = {
    annotations: {
      steps: [{
        step_id: "s1",
        name: "Long step",
        time_range: { start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:30:00Z" },
        grain_keys: { app: "excel.exe" },
      }],
    },
    patterns: {},
  };
  const q0 = generateQuestions(session, { variantIndex: 0 })[0];
  const q1 = generateQuestions(session, { variantIndex: 1 })[0];
  // Different phrasings should produce different question text (though
  // they reference the same observation).
  assert.notEqual(q0.question, q1.question);
});

/* ----------------- clean-edition capture_observations sources (§E3) */

const CAPTURE_OBS = {
  longest_stretch: {
    app: "excel.exe",
    start: "2026-06-05T09:00:00Z",
    end: "2026-06-05T09:22:00Z",
    dur_ms: 22 * 60_000,
  },
  top_interaction_label: { label: "click 'Save'", n: 7 },
  app_switch_pairs: [{ app_a: "excel.exe", app_b: "sap.exe", n: 9 }],
  retyped_values: [{ value: "CUST-10852", n_places: 3 }],
};

test("capture observations alone produce observed-value questions", () => {
  const qs = generateQuestions({ capture_observations: CAPTURE_OBS });
  const keys = qs.map(q => q.template_key);
  assert.deepEqual(keys, [
    "longest_segment", "top_activity_cluster", "app_switching", "high_retypes",
  ]);
  assert.ok(qs[0].question.includes("excel.exe"));
  assert.ok(qs[1].question.includes("click 'Save'"));
  assert.ok(qs[2].question.includes("9"));
  assert.ok(qs[3].question.includes("CUST-10852"));
  assert.ok(qs.length <= 5);
});

test("capture sources stay below their observation thresholds", () => {
  const qs = generateQuestions({
    capture_observations: {
      longest_stretch: { app: "a.exe", start: "2026-06-05T09:00:00Z", end: "2026-06-05T09:00:30Z", dur_ms: 30_000 },
      top_interaction_label: { label: "click 'OK'", n: 2 },
      app_switch_pairs: [{ app_a: "a.exe", app_b: "b.exe", n: 2 }],
      retyped_values: [],
    },
  });
  assert.deepEqual(qs, []);
});

test("analyst-shaped sources keep precedence over capture observations", () => {
  const session = {
    annotations: {
      steps: [{
        step_id: "s1",
        time_range: { start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:30:00Z" },
        grain_keys: { app: "word.exe" },
      }],
    },
    patterns: {},
    capture_observations: CAPTURE_OBS,
  };
  const qs = generateQuestions(session);
  const longest = qs.filter(q => q.template_key === "longest_segment");
  // One longest_segment question only -- the analyst-shaped one wins.
  assert.equal(longest.length, 1);
  assert.ok(longest[0].question.includes("word.exe"));
});

test("capture-observation generation is deterministic for the same input", () => {
  const a = generateQuestions({ capture_observations: CAPTURE_OBS });
  const b = generateQuestions({ capture_observations: CAPTURE_OBS });
  assert.deepEqual(a, b);
});
