/*
 * Worker self-annotation wizard (lab-phase §E3) -- ported from the
 * project-vision-ai-ml branch's capture/self-annotation/wizard.js.
 *
 * Post-capture wizard that asks the worker up to 5 templated questions
 * about what they were doing -- guided worker self-annotation instead of
 * freeform analyst guessing. Heuristic templates only: every question
 * references an OBSERVED value (a duration, a count, a label), never an
 * inference, and the generation is deterministic for a given input. No
 * LLM anywhere (the clean edition's permanent posture).
 *
 * Two input shapes feed generateQuestions:
 *   - the analyst-side shape the ML branch used (annotations/patterns of
 *     a normalized session) -- kept intact so the ported behavior and
 *     tests still hold;
 *   - `session.capture_observations` (clean-edition addition) -- the
 *     capture-side facts observe.js derives from events.jsonl at session
 *     end, which is when this wizard actually runs (no pipeline has
 *     touched the session yet).
 *
 * Answers are appended to annotations.json as `self_annotations[]` with
 * `manually_authored: true` so re-normalization preserves them -- see
 * shared/SCHEMA.md.
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
      questions.push(_fillTemplate("longest_segment", variantIdx, {
        start: _fmtTime(longest.time_range && longest.time_range.start),
        end: _fmtTime(longest.time_range && longest.time_range.end),
        dur: _fmtDuration(dur_ms),
        app: (longest.grain_keys && longest.grain_keys.app) || "an app",
      }, { step_id: longest.step_id, dur_ms }));
    }
  }

  // 2. Top activity cluster — biggest cluster by occurrence_count from patterns.
  const clusters = Array.isArray(patterns.activity_clusters)
    ? patterns.activity_clusters.slice() : [];
  clusters.sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0));
  if (clusters.length > 0 && (clusters[0].occurrence_count || 0) >= 2) {
    const c = clusters[0];
    questions.push(_fillTemplate("top_activity_cluster", variantIdx, {
      label: c.process_label || "(unnamed)",
      n: c.occurrence_count,
    }, { cluster_id: c.cluster_id, label: c.process_label }));
  }

  // 3. Anomaly — first anomaly from patterns.
  const anomalies = Array.isArray(patterns.anomalies) ? patterns.anomalies : [];
  if (anomalies.length > 0) {
    const a = anomalies[0];
    // Find case start_ts (best-effort).
    const time = a.start_ts || a.case_start_ts || "the unusual case";
    questions.push(_fillTemplate("anomaly", variantIdx, {
      time: typeof time === "string" && time.includes("T") ? _fmtTime(time) : time,
    }, { case_id: a.case_id }));
  }

  // 4. Ambiguous case boundary — first marker_suggestion below high
  // confidence (the "we're not sure" type).
  const markerSuggestions = Array.isArray(ann.marker_suggestions)
    ? ann.marker_suggestions : [];
  const ambiguous = markerSuggestions.find(m => m.score >= 0.4 && m.score < 0.75);
  if (ambiguous) {
    questions.push(_fillTemplate("ambiguous_case_boundary", variantIdx, {
      time_a: _fmtTime(ambiguous.timestamp),
      time_b: "",
    }, { suggestion_id: ambiguous.suggestion_id }));
  }

  // 5. High-frequency motif from patterns.
  const motifs = Array.isArray(patterns.motifs) ? patterns.motifs.slice() : [];
  motifs.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  if (motifs.length > 0 && (motifs[0].frequency || 0) >= 3) {
    const m = motifs[0];
    const motif_str = Array.isArray(m.labels) ? m.labels.join(" → ") : "(motif)";
    questions.push(_fillTemplate("high_frequency_motif", variantIdx, {
      motif: motif_str,
      n: m.frequency,
    }, { motif_id: m.motif_id }));
  }

  // Capture-side observations (clean-edition addition): at session end no
  // pipeline output exists yet, so observe.js's events.jsonl facts feed
  // the same template library. Analyst-shaped sources above keep their
  // ported precedence; these fill the remaining slots.
  const obs = session.capture_observations || null;
  if (obs) {
    // Longest continuous focus stretch (only if the step-based source
    // didn't already produce one).
    const ls = obs.longest_stretch;
    if (ls && ls.dur_ms > 60_000 && !questions.some(q => q.template_key === "longest_segment")) {
      questions.push(_fillTemplate("longest_segment", variantIdx, {
        start: _fmtTime(ls.start),
        end: _fmtTime(ls.end),
        dur: _fmtDuration(ls.dur_ms),
        app: ls.app || "an app",
      }, { app: ls.app, start: ls.start, dur_ms: ls.dur_ms }));
    }
    // Most-repeated interaction.
    const top = obs.top_interaction_label;
    if (top && top.n >= 3 && !questions.some(q => q.template_key === "top_activity_cluster")) {
      questions.push(_fillTemplate("top_activity_cluster", variantIdx, {
        label: top.label,
        n: top.n,
      }, { label: top.label, n: top.n }));
    }
    // Heaviest app-switching pair.
    const pairs = Array.isArray(obs.app_switch_pairs) ? obs.app_switch_pairs : [];
    if (pairs.length > 0 && pairs[0].n >= 4) {
      const p = pairs[0];
      questions.push(_fillTemplate("app_switching", variantIdx, {
        app_a: p.app_a, app_b: p.app_b, n: p.n,
      }, { app_a: p.app_a, app_b: p.app_b, n: p.n }));
    }
    // A value re-keyed into several places.
    const retyped = Array.isArray(obs.retyped_values) ? obs.retyped_values : [];
    if (retyped.length > 0 && retyped[0].n_places >= 2) {
      const r = retyped[0];
      questions.push(_fillTemplate("high_retypes", variantIdx, {
        value: r.value, n: r.n_places,
      }, { value: r.value, n_places: r.n_places }));
    }
  }

  // Cap at 5.
  return questions.slice(0, 5);
}

function _fillTemplate(key, variantIdx, vars, observed) {
  const template = TEMPLATES.find(t => t.key === key);
  const phrasing = _pick(template.phrasings, variantIdx);
  return {
    question: _fill(phrasing, vars),
    template_key: key,
    observed: observed || {},
  };
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
