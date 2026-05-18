# Analysis Layer — Follow-ups

Spec for the two follow-ons deferred when the analysis layer landed.
Context: [`docs/adr/0008-build-the-analysis-layer.md`](../adr/0008-build-the-analysis-layer.md)
and IMPROVEMENTS.md Cluster N. The layer itself shipped in commit
`c894f80` — the `analysis.json` sidecar, the viewer Analysis sub-view,
and the PDD enrichment.

Not covered here: passive capture / auto case detection (I79, I80) —
that is IMPROVEMENTS.md Cluster O and is tracked separately.

Sequencing: do **1 before 2** — item 1 is self-contained and
high-value, and item 2's automation aggregation benefits from the
confirmed candidates item 1 produces. Each is one commit with its own
CHANGELOG entry.

---

## 1 — Analyst correction of analysis classifications

**Why.** The heuristics ship provisional. Two values in particular
need a human: the value-add vs. business-required split (`bnva_ms` is
always `0` today — all active time defaults to VA) and whether an
automation candidate is real. IMPROVEMENTS.md Cluster N Module 1 says
"the analyst reviews and corrects classifications" but never specs it.

**Key constraint.** `analysis.json` is regenerated on every `normalize`
run, so corrections **cannot live in it** — they would be overwritten.
They live in `annotations.json` (the analyst sidecar), the same way
`classification_overrides[]` already does, and the analysis layer
applies them while computing `analysis.json`.

**Data model** — new `annotations.json` key:

```json
"analysis_overrides": [
  { "step_id": "uuid",
    "bnva_ms": 0,                   // analyst reclassifies VA time as BNVA
    "waste_types": ["..."],         // optional: replace the detected set
    "automation_confirmed": true }  // optional: confirm / dismiss a candidate
]
```

Only the fields the analyst touched are present; the rest stays heuristic.

**Implementation.**
- `normalization/analysis_waste.py` — accept the overrides; after the
  heuristic split, apply any `analysis_overrides` entry for the step
  (analyst value wins; recompute so `va_ms + bnva_ms + nva_ms` still
  equals `elapsed_ms`).
- `normalization/analysis_automation.py` — surface `automation_confirmed`
  on the candidate entry.
- `normalization/analysis.py` — thread `annotations` through to both.
- `viewer/views/analysis-view.js` — make the waste rows and automation
  list interactive: a control to set a step's BNVA share, a
  confirm/dismiss toggle per candidate. Persist with
  `saveAnnotationsWithUndo` (from `session.js`) — the established
  annotations-write path, with undo.
- `shared/SCHEMA.md` — document `analysis_overrides[]`.

**Tests.** `test_analysis_waste.py` / `test_analysis_automation.py`
already exist — add cases for override application.

---

## 2 — Compare-Sessions aggregation of analysis

**Why.** Per-session automation scoring is weak: a step seen once
can't be judged for repetitiveness (`data_sufficiency:
"single_instance"`). It gains real signal only across many recordings
of the same process. The Compare Sessions view loads N sessions and
should aggregate their analysis.

**Scope** — a new "Analysis" panel in the Compare Sessions view:
- Cross-session time study — group step instances by
  `canonical_step_id` across all loaded sessions; aggregate cycle stats.
- Per-worker comparison — group by `manifest` worker; compare per-step
  cycle time.
- Aggregated automation candidates — instances pooled across sessions,
  so repetitiveness / rule-basedness become meaningful.
- Efficiency-ratio trend across the loaded set.

**Implementation.**
- New pure module `viewer/analysis-aggregate.js` —
  `aggregateAnalysis(sessions) → {...}` merging each `session.analysis`.
  Pure, no DOM, unit-tested in `node:test` — mirrors `session-summary.js`.
- `viewer/views/aggregate-view.js` — render the panel from it.
- **Open question to settle first:** cross-session repetitiveness needs
  each step's interaction-sequence signature, which `analysis.json`
  does not store today (only the scores). Either (a) add a sequence
  signature to `automation_candidates[]` so aggregation can compare
  without re-reading events, or (b) re-derive client-side from the
  loaded sessions' events. (a) is cleaner — decide before starting.

**Tests.** `node:test` for `analysis-aggregate.js`.
