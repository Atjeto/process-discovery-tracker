# ADR-0027: Retire the per-step path/segment flags — keep only `waste`

**Status:** Accepted
**Date:** 2026-05-31
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0016](0016-segment-level-automation-candidacy.md) (automation candidacy at the coherent-segment grain), [ADR-0008](0008-build-the-analysis-layer.md) (the waste / value-add classifier), [ADR-0013](0013-value-free-grouping-and-map-readability.md) + [ADR-0024](0024-step-grain-as-view-time-rollup.md) (the map's branch frequency / variants). Supersedes the four-flag per-step model from [ADR-0009](0009-normalization-redesign-v0.13.md).

## Context

A step carried four analyst-togglable flags: `conditional`, `exception_path`,
`waste`, `automation_candidate` (`condition_text` alongside `conditional`). Three
of the four are **mis-scoped**: they describe a property of a *path* or a
*multi-step segment*, not of a single step.

- **A single step is not an automation candidate** — a coherent *segment* of work
  is. [ADR-0016](0016-segment-level-automation-candidacy.md) already moved
  candidacy to the segment grain; `report-md.js` and the PDD §4.3 already ignored
  the per-step flag (the PDD comment literally said "a per-step flag
  misrepresents that"). The checkbox was dead.
- **A single step is not an exception path** — an exception/variation is a *path*
  through several steps. The system already derives this: the viewer's aligned
  reading shows "steps a case has that the consensus does not," and `stats`
  carries `trace_variants` (the rare/divergent sequences ARE the exceptions).
- **Conditionality** ("this step only sometimes happens") is exactly the map's
  **branch frequency** — a step on a low-frequency edge is, by construction,
  conditional. A hand-flag duplicates what the DFG already shows.

Only **`waste`** is a genuine per-step judgment: Lean classifies non-value-add
*per activity*, and the pipeline already auto-computes a per-step VA/NVA split
(`analysis_waste.classify_waste`) that feeds the efficiency figure; the flag is
the analyst's confirm/override.

## Decision

**Keep `waste` as the only per-step flag. Retire `conditional`,
`exception_path`, `automation_candidate`, and `condition_text`.** The concepts
they tried to express are sourced from where they actually live:

- automation candidacy → **coherent segments** (ADR-0016, `analysis.automation_candidates`);
- exceptions / variations → the **observed trace variants** (and the aligned reading);
- conditionality → the **map's branch frequency** (ADR-0024 grain / DFG).

Concretely: the step-detail UI drops three checkboxes (one `Waste` checkbox
remains) and the matching badges; `step_suggest` / `canonical_match` stamp only
`flags.waste`; `step-alignment` propagates only `waste`; the MD/HTML reports list
only `waste`; and **PDD §5 "Exceptions & variations" is re-sourced from
`stats.trace_variants` + `rework_loops`** instead of the dead per-step flags.

Legacy `annotations.json` may still carry the old keys; they are ignored, not
migrated (raw data is immutable; the keys simply stop being read or written).

## Consequences

- **No nonsensical per-step affordance.** The UI no longer asks "is this one step
  an automation candidate / an exception path," which never had a coherent answer.
- **The PDD's exceptions section is now real**, derived from observed variation
  rather than a checkbox an analyst rarely set correctly.
- **No data migration, golden-neutral.** The golden projection never read `flags`;
  pytest 345 + viewer 259 stay green. The flag *fields* shrink to `{waste}`.
- **Lost:** the ability to hand-mark an individual step as conditional/exception/
  automation. That was the point — those judgments belong to a path or a segment.
  A future *range* selection (mark a run of steps) could layer on top if needed,
  but the automatic sources cover the need today.

## Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md))

- **Removing a verb, not adding one** — the surviving `Waste` flag keeps its
  inverse (toggle off), its legend (the help text), and its real consumer (the
  efficiency analysis). The three retired flags had no coherent single-step
  meaning, so removing them *increases* coherence.
- **Real run.** Validated in the viewer: the step detail shows only `Waste`; the
  Compare panels gain working drill-downs; a re-rendered PDD §5 lists the observed
  variations + rework instead of empty flag rows.
