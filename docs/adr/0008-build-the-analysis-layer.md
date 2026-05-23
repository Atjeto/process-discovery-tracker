# ADR-0008: Build the Analysis Layer Now

**Status:** Accepted
**Date:** 2026-05-17
**Deciders:** Project owner
**Supersedes:** the analysis-layer deferral in [ADR-0006](0006-backlog-sequencing.md)

## Context

[ADR-0006](0006-backlog-sequencing.md) adopted `IMPLEMENTATION-SPEC.md` as the
execution plan and **deferred the analysis layer** — IMPROVEMENTS.md Cluster N
(waste classification, time study, automation scoring, process-efficiency
ratio; entries I74–I78, I81). It deferred on two grounds:

1. **The per-step aggregations were not pre-computed.** The pipeline emits the
   raw inputs (idle events, the interaction stream, per-label durations) but
   never rolls idle / switching time up to the step level, and `stats.json` is
   keyed by activity label, not step.
2. **The heuristics want real data to calibrate against.** "What counts as
   waste" and "how automatable is this step" are judgement-laden classifiers.
   No 8-hour passive recording exists yet to tune them, and shipping
   guess-tuned heuristics risks plausible-but-wrong output that erodes trust.

On review the project owner judged the analysis layer to be the most valuable
missing capability — it is what moves the tool's output from "here is what
happened" to "here is what to change" — and chose to build it now rather than
wait for the recording, accepting that the heuristics ship provisional.

## Decision

Build the analysis layer as IMPROVEMENTS.md Cluster N specifies: four
analytical modules in the normalization pipeline writing an `analysis.json`
sidecar per session, surfaced in the viewer and the PDD export.

- `analysis_waste.py` (I74 + I81), `analysis_time_study.py` (I75),
  `analysis_automation.py` (I76), `analysis_efficiency.py` (I77), over a shared
  `analysis_common.py` per-step time-segmentation primitive, orchestrated by
  `analysis.py`.
- It runs automatically inside `normalize()` whenever the session has steps —
  no opt-in flag, since it is cheap arithmetic (unlike `--mine`). It is
  best-effort: a module that throws is logged and skipped, never failing the
  run.
- The viewer reads `analysis.json` into the session object, adds an **Analysis**
  Session sub-view, and shows the efficiency ratio as a session-summary tile.
  `pdd_export.py` appends per-step waste / automation context.

## The calibration concern is met, not dismissed

ADR-0006's second objection is real, so it is addressed directly rather than
waved away:

- Every threshold is a **named, commented constant** at the top of its module
  (`MOTION_MS`, `TRANSFER_WINDOW_MS`, …) — recalibration is a one-line edit.
- `analysis.json.meta` carries `heuristic_version` and `provisional: true`;
  the viewer's Analysis panel shows a standing "Heuristic estimate — review
  before relying on it" caption.
- The honestly-weak parts are **marked, not faked.** The value-add vs.
  business-required split needs domain judgement, so `bnva_ms` is `0` and all
  active time defaults to `va_ms`, pending an analyst-correction pass.
  Automation repetitiveness and rule-basedness are reported as `null` with
  `data_sufficiency: "single_instance"` for a step seen only once — they
  cannot be judged from one instance.

When the first real 8-hour recording lands, recalibrate the thresholds against
it and bump `heuristic_version`.

## Scope

**In:** the four analyzers + `analysis.json`; the viewer Analysis sub-view and
the efficiency-ratio summary tile; the PDD enrichment (I78).

**Out (follow-on):**

- Analyst correction of classifications — reclassifying VA/BNVA, confirming
  automation candidates — writing back to `annotations.json`.
- Compare-Sessions cross-session aggregation and per-worker comparison, where
  automation scoring becomes meaningful at multi-instance scale.
- Passive capture and auto case detection (I79 / I80, Cluster O).

## Consequences

**Easier:**

- The analyst's deliverable carries IE-grade findings — waste, time study,
  automation candidates, efficiency — without hand-computation.
- `analysis.json` is a clean sidecar; consumers that do not know it ignore it.

**Costs / accepted risks:**

- Outputs are **provisional** until calibrated against real recording data;
  every consumer must treat them as estimates. This is precisely the cost
  ADR-0006 flagged — it is now accepted deliberately, with the provisional
  marking and tunable constants as the mitigation.
- The pipeline gains a stage; re-running normalization regenerates
  `analysis.json` non-destructively, like `stats.json`.

## Action Items

1. [x] Land the four analyzers + `analysis.json`, wired into `normalize.py`.
2. [x] Surface it in the viewer (Analysis sub-view, efficiency tile) and the
       PDD export.
3. [ ] After the first 8-hour passive recording, recalibrate the heuristics
       and bump `heuristic_version`.
4. [x] Build the analyst-correction pass and the Compare-Sessions
       aggregation — spec: [`docs/To-Do/Archive/ANALYSIS-LAYER-FOLLOWUPS.md`](../To-Do/Archive/ANALYSIS-LAYER-FOLLOWUPS.md).
