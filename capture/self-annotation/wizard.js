/*
 * PDT 1.0 Self-Annotation Wizard — PDT-1.0-SPEC §3.3, ADR-0032.
 *
 * Post-capture wizard that asks the worker 5 templated questions about
 * what they were doing — replaces freeform analyst annotation with
 * guided worker self-annotation. Heuristic templates (no LLM), with an
 * upgrade path documented in ADR-0032.
 *
 * The wizard is a renderer-side module loaded by the capture-app
 * post-session summary window. Answers are appended to annotations.json
 * as `self_annotations[]` with `manually_authored: true` so
 * re-normalisation preserves them.
 */

"use strict";

/**
 * Template library for self-annotation questions. Each template has a
 * `key` (the pattern type that triggers it), a `phrasings` array of
 * variants the wizard rotates through, and a `placeholders` list naming
 * the observed values to splice in.
 *
 * The templates always reference *what was observed* — never leading
 * the witness — and accompany each prompt with a yes/no exception flag.
 */
const TEMPLATES = [
  {
    key: "longest_segment",
    phrasings: [
      "Between {start} and {end} you spent {dur} on this {app}. What were you working on?",
      "Your longest stretch was {dur} on {app} starting at {start}. What was the goal?",
      "You spent {dur} continuously on {app} from {start}. What were you doing?",
    ],
    placeholders: ["start", "end", "dur", "app"],
  },
  {
    key: "top_activity_cluster",
    phrasings: [
      "We saw you do '{label}' {n} times. What is this in your own words?",
      "'{label}' appears {n}× — what name would you give this activity?",
      "We labelled {n} occurrences as '{label}'. Is that right?",
    ],
    placeholders: ["label", "n"],
  },
  {
    key: "anomaly",
    phrasings: [
      "Around {time}, this case looked different from the others — what happened?",
      "We flagged the case starting at {time} as unusual. Was it an exception?",
      "The case at {time} doesn't fit the modal pattern. What was different?",
    ],
    placeholders: ["time"],
  },
  {
    key: "ambiguous_case_boundary",
    phrasings: [
      "Between {time_a} and {time_b}, was this one task or two?",
      "We're not sure if there's a case boundary around {time_a}. Did you finish a task here?",
      "Did something end and another start around {time_a}?",
    ],
    placeholders: ["time_a", "time_b"],
  },
  {
    key: "high_frequency_motif",
    phrasings: [
      "We saw '{motif}' repeat {n} times. Is this a routine you do often?",
      "'{motif}' showed up {n}× — does this happen daily, weekly, occasionally?",
      "How often do you do '{motif}'? We saw it {n} times this session.",
    ],
    placeholders: ["motif", "n"],
  },
  {
    key: "app_switching",
    phrasings: [
      "You switched between {app_a} and {app_b} {n} times — what were you doing across both?",
      "Lots of back-and-forth between {app_a} and {app_b} ({n} switches). What's the workflow?",
      "{n} app switches between {app_a} and {app_b}. Why? (Copying data? Cross-referencing?)",
    ],
    placeholders: ["app_a", "app_b", "n"],
  },
  {
    key: "high_retypes",
    phrasings: [
      "We saw '{value}' typed {n} times across apps. Is this one piece of data going several places?",
      "'{value}' appeared in {n} different places — manual data movement?",
      "You typed '{value}' {n} times into different controls. What is this value?",
    ],
    placeholders: ["value", "n"],
  },
];

function _pick(arr, idx) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.abs(idx) % arr.length];
}

function _fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m";
  return s + "s";
}

function _fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) { return "—"; }
}

/**
 * Generate up to 5 questions from the session's patterns and stats.
 * Returns an ordered list of {question, template_key, observed} objects.
 */
function generateQuestions(session, opts) {
  opts = opts || {};
  const variantIdx = opts.variantIndex || 0;
  const questions = [];

  if (!session) return questions;

  const stats = session.stats || {};
  const ann = session.annotations || {};
  const patterns = session.patterns || {};
  const steps = Array.isArray(ann.steps) ? ann.steps : [];

  // 1. Longest segment — find the longest step by duration.
  if (steps.length > 0) {
    const sortedByDur = steps.slice().sort((a, b) => {
      const ad = _stepDurMs(a);
      const bd = _stepDurMs(b);
      return bd - ad;
    });
    const longest = sortedByDur[0];
    const dur_ms = _stepDurMs(longest);
    if (dur_ms > 60_000) {
      const template = TEMPLATES.find(t => t.key === "longest_segment");
      const phrasing = _pick(template.phrasings, variantIdx);
      const text = _fill(phrasing, {
        start: _fmtTime(longest.time_range && longest.time_range.start),
        end: _fmtTime(longest.time_range && longest.time_range.end),
        dur: _fmtDuration(dur_ms),
        app: (longest.grain_keys && longest.grain_keys.app) || "an app",
      });
      questions.push({
        question: text,
        template_key: template.key,
        observed: { step_id: longest.step_id, dur_ms },
      });
    }
  }

  // 2. Top activity cluster — biggest cluster by occurrence_count from patterns.
  const clusters = Array.isArray(patterns.activity_clusters)
    ? patterns.activity_clusters.slice() : [];
  clusters.sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0));
  if (clusters.length > 0 && (clusters[0].occurrence_count || 0) >= 2) {
    const c = clusters[0];
    const template = TEMPLATES.find(t => t.key === "top_activity_cluster");
    const phrasing = _pick(template.phrasings, variantIdx);
    const text = _fill(phrasing, {
      label: c.process_label || "(unnamed)",
      n: c.occurrence_count,
    });
    questions.push({
      question: text,
      template_key: template.key,
      observed: { cluster_id: c.cluster_id, label: c.process_label },
    });
  }

  // 3. Anomaly — first anomaly from patterns.
  const anomalies = Array.isArray(patterns.anomalies) ? patterns.anomalies : [];
  if (anomalies.length > 0) {
    const a = anomalies[0];
    const template = TEMPLATES.find(t => t.key === "anomaly");
    const phrasing = _pick(template.phrasings, variantIdx);
    // Find case start_ts (best-effort).
    const time = a.start_ts || a.case_start_ts || "the unusual case";
    const text = _fill(phrasing, {
      time: typeof time === "string" && time.includes("T") ? _fmtTime(time) : time,
    });
    questions.push({
      question: text,
      template_key: template.key,
      observed: { case_id: a.case_id },
    });
  }

  // 4. Ambiguous case boundary — first marker_suggestion or anchor candidate
  // below high confidence (the "we're not sure" type).
  const markerSuggestions = Array.isArray(ann.marker_suggestions)
    ? ann.marker_suggestions : [];
  const ambiguous = markerSuggestions.find(m => m.score >= 0.4 && m.score < 0.75);
  if (ambiguous) {
    const template = TEMPLATES.find(t => t.key === "ambiguous_case_boundary");
    const phrasing = _pick(template.phrasings, variantIdx);
    const text = _fill(phrasing, {
      time_a: _fmtTime(ambiguous.timestamp),
      time_b: "",
    });
    questions.push({
      question: text,
      template_key: template.key,
      observed: { suggestion_id: ambiguous.suggestion_id },
    });
  }

  // 5. High-frequency motif from patterns.
  const motifs = Array.isArray(patterns.motifs) ? patterns.motifs.slice() : [];
  motifs.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  if (motifs.length > 0 && (motifs[0].frequency || 0) >= 3) {
    const m = motifs[0];
    const template = TEMPLATES.find(t => t.key === "high_frequency_motif");
    const phrasing = _pick(template.phrasings, variantIdx);
    const motif_str = Array.isArray(m.labels) ? m.labels.join(" → ") : "(motif)";
    const text = _fill(phrasing, {
      motif: motif_str,
      n: m.frequency,
    });
    questions.push({
      question: text,
      template_key: template.key,
      observed: { motif_id: m.motif_id },
    });
  }

  // Cap at 5.
  return questions.slice(0, 5);
}

function _stepDurMs(step) {
  if (!step || !step.time_range) return 0;
  const a = new Date(step.time_range.start).getTime();
  const b = new Date(step.time_range.end).getTime();
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, b - a);
}

function _fill(template, vars) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

/**
 * Persist an answer to annotations.json as a self_annotation entry.
 */
function buildSelfAnnotation(question, answerText, isException) {
  return {
    self_annotation_id: "sa-" + Math.random().toString(36).slice(2, 10),
    template_key: question.template_key,
    question: question.question,
    answer: answerText,
    is_exception: !!isException,
    observed: question.observed || {},
    manually_authored: true,
    created_at: new Date().toISOString(),
  };
}

module.exports = {
  TEMPLATES,
  generateQuestions,
  buildSelfAnnotation,
};
