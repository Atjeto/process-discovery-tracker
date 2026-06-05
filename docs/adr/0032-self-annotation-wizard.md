# ADR-0032: Self-Annotation Wizard — heuristic-templated, post-capture, 5 questions

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 3 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0017](0017-suggested-markers.md) (the `manually_authored` + `auto_*` separation this preserves), [ADR-0023](0023-recorder-capture-confidence.md) (capture-confidence feeds question-template selection), [ADR-0028](0028-ai-naming-layer.md) (the LLM that was originally specced for this and was dropped), [ADR-0029](0029-pattern-layer.md) (the detected patterns that key the template library), [ADR-0031](0031-cockpit-and-workshop-modes.md) (the Glance mode the wizard feeds). Spec: [PDT-1.0-SPEC §3.3](../PDT-1.0-SPEC.md#33-interview-layer--heuristic-templated-worker-self-annotation).

## Context

The analyst-shaped hole in PDT 1.0 ([PDT-1.0-SPEC §1](../PDT-1.0-SPEC.md#1-why-this-rewrite-exists)) leaves a structural gap: someone has to confirm case boundaries, name activities for ambiguous segments, and flag rework. Workers will not annotate freeform — they don't know which fields matter, they don't speak the analyst's vocabulary, and a blank text box at the end of a 4-hour capture closes the tool. They will, however, **answer pointed questions** if those questions are short, observation-grounded, and clearly optional.

The first version of this spec routed question generation through the LLM (Naming Layer with five uses, [PDT-1.0-SPEC §3.2](../PDT-1.0-SPEC.md#32-naming-layer--local-llm-scoped-to-two-uses)). On review, the LLM was decoration here: the wizard's value comes from *the question being pointed at observed behaviour*, not from generative wording. The observed behaviour comes from the Pattern Layer ([ADR-0029](0029-pattern-layer.md)); the values that fill the template come from measurements. The LLM adds cost (an extra prompt class, eval, hallucination surface) without changing the wizard's load-bearing UX.

The cost difference: ~0.5 cycle templated, ~1 cycle LLM-generated.

## Decision

**Build the Self-Annotation Wizard with a fixed template library and observed-value substitution, not LLM-generated questions.** Triggered at the end of capture, before the session closes. 5 questions max, ~30s each, ~2.5 minutes total. The wizard outputs `self_annotations[]` in `annotations.json`, marked `manually_authored: true`.

### Question generation

Questions are selected from a **fixed template library** keyed by detected pattern type. The Pattern Layer ([ADR-0029](0029-pattern-layer.md)) tags candidate moments; the wizard picks five across the available types:

| Template key | Trigger | Example phrasing (one of 3–5 variants) |
|---|---|---|
| `longest_segment` | The session's longest uninterrupted segment | "Between {t_start} and {t_end} you spent {duration} on {top_app}. What were you doing?" |
| `top_activity_cluster` | The largest activity cluster from clustering | "You repeated this pattern {n} times: {short_step_sequence}. What's the goal of that loop?" |
| `anomaly` | A segment that deviates from the modal pattern | "We saw something unusual at {t}: {observed_signal}. Was this exception, rework, or business-as-usual?" |
| `ambiguous_case_boundary` | A case-inference confidence below threshold | "Around {t} the flow looked like it might restart. Is that one task or two?" |
| `motif` | A short repeated subsequence (≥3 occurrences) | "We saw you switch between {app_a} and {app_b} {n} times in {window}. What were you working on?" |

Rules baked into the design:

- **5 questions max per session, 30s target each.** Hard cap. The wizard tracks and shows progress; question count never grows.
- **Each template has 3–5 phrasing variants.** Picked deterministically per question (seeded by session id + template key) so the wording feels fresh but every session of the same shape gets the same questions — the consultant sees a comparable signal across captures.
- **Templates substitute observed values, never lead the witness.** A template references *what was seen* ("you switched 12 times"), never *what you might have been doing* ("were you looking up invoices?"). Question wording is reviewed once at template-authoring time; observed-value substitution can only inject measured quantities, app names, and step labels — not interpretations.
- **One yes/no exception flag per question.** Captures rework cheaply: *☐ This was an exception or rework, not the normal flow.*
- **Skippable, with completion tracked.** The Cockpit shows the consultant how much of the session was self-annotated; a skipped session is honest, not held back. (The rejected alternative — "session held in `needs_annotation` state" — punishes the worker for honest unwillingness and reduces capture volume, [PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions).)
- **Capture-confidence gates question availability.** Below the [ADR-0023](0023-recorder-capture-confidence.md) threshold, low-confidence inputs cannot drive a question — the template `anomaly` requires the underlying signal to clear the same floor the Naming Layer's "insufficient signal" refusal uses ([ADR-0028](0028-ai-naming-layer.md)).
- **`manually_authored: true` on every output.** Re-normalisation preserves the entries — same posture [ADR-0017](0017-suggested-markers.md) takes for analyst-authored markers. Self-annotations override AI suggestions for activity naming and case-boundary confirmation when both exist.

### Upgrade path

If a later cycle shows the templates underperform (questions feel robotic, signals captured are sparse), the question generator can swap to LLM-generated phrasing **after** Phase 4 ([ADR-0028](0028-ai-naming-layer.md)) ships. The deterministic version ships first; the LLM upgrade is contingent on measured shortfall, not on speculative quality. The observed-value substitution and the no-lead-the-witness rule survive the upgrade — the LLM phrases the question, the measurement provides the content.

### Storage

```jsonc
"self_annotations": [
  {
    "id": "<uuid>",
    "template_key": "motif",
    "asked_at": "<iso8601>",
    "question_rendered": "We saw you switch between Excel and ServiceNow 12 times in 24 minutes. What were you working on?",
    "answer_text": "<free text — ~1 line>",
    "exception_flag": false,
    "manually_authored": true,
    "linked_events": ["<event_id>", ...]   // the underlying signal
  }
]
```

## Consequences

**Positive**
- The analyst-shaped hole closes at the source. Workers self-annotate; the consultant inherits confirmed labels.
- Glance ([ADR-0031](0031-cockpit-and-workshop-modes.md)) has high-signal correction data — the highest-quality training signal the Pattern Layer ([ADR-0029](0029-pattern-layer.md)) can get.
- ~0.5 cycle of implementation cost vs ~1 cycle for LLM-generated. The cycle saved funds the polish elsewhere.
- Capture feels collaborative, not extractive. The worker sees what was observed and is asked, not told.

**Negative / accepted**
- Template-library authoring is real work — each template wants 3–5 phrasings reviewed for tone and the no-lead-the-witness rule. The library is small (5 keys) so the bounded scope is tractable.
- A worker who answers freeform "I don't know" to every question produces low-signal `self_annotations[]` — the Pattern Layer proceeds without that signal, confidence is lower, the Cockpit shows the gap.
- A genuinely novel session pattern that doesn't match any template key gets a generic `longest_segment` question instead of a precise one. Acceptable; the alternative was a hallucinated LLM question against unfamiliar structure.

**Reversal.** The wizard is end-of-capture — if it underperforms it can be disabled per-engagement without affecting any other surface. `self_annotations[]` is additive in `annotations.json`; absent entries are simply absent. The upgrade to LLM-generated questions is gated on measured underperformance of the templates, not on time.
