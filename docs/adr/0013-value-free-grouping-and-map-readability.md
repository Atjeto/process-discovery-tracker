# ADR-0013: Value-Free Step Grouping (`process_label`) & Map Readability on Real Data

**Status:** Accepted — implemented 2026-05-23 (unreleased, on `viewer-refactor`).
Builds on the v0.15.0 cycle.
**Date:** 2026-05-23
**Deciders:** Rasha (analyst/owner)
**Related:** [ADR-0012](./0012-active-case-stamping-and-map-matrix.md) (map matrix),
[ADR-0011](./0011-platform-recognition-layer.md) (recognition),
[ADR-0008](./0008-build-the-analysis-layer.md) (analysis layer),
[VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md)

## Context

The v0.15.0 map matrix (ADR-0012) and analysis layer (ADR-0008) are sound on
synthetic fixtures but fall apart on a **real, mostly-unique-valued** capture,
because an auto-suggested step's *name* embeds the case's values:

> `Salesforce: Search — CUST-10900`, `… — CUST-10901`, `Enter 25 in Quantity`, …

Every order produces a uniquely-named step, so anything keyed on the step name
or the per-step `step_id` **fragments per instance**:

1. **The step-level process map exploded** into one node per case — a hairball,
   not a model (found in a real-run pass, fixed mid-v0.15.0 cycle in the viewer).
2. **The Analysis tab's cross-session time study was an "endless list"** — one
   row per raw order ("Salesforce: Search — CUST-10900", "— CUST-10901", …),
   near-valueless. Same fragmentation hit `stats_compute.step_stats`,
   `step_variants`, and the pooled automation candidates. Root cause:
   `analysis_time_study._group_key` / `analysis_automation._group_key` grouped by
   `canonical_step_id or step_id`, and the stats keyed on the raw `name` — so
   with **no Process Template** every instance was its own group.

The unifying defect: **repeated work was not recognised as repeated** because its
identity was carried in a value-laden string.

Two further map problems surfaced on dense real recordings:

3. **No way to navigate the hierarchy.** The map could show phase / step /
   activity levels (ADR-0012), but a click only *changed the level* — it showed
   the whole next level, not the clicked node's children. There was no drill-in.
4. **One-off deviations cluttered the model.** A long recording's correct model
   still carries many frequency-1 paths (a worker's idiosyncratic detour on one
   ticket), drowning the dominant flow.

## Decision

### 1. `process_label` is the universal value-free grouping key

A step's **`process_label`** is its name with case values stripped to the step
*type*: `Search — CUST-10900` → `Search`, `Enter 25 in Quantity` →
`Enter Quantity`. It is computed by `step_suggest.process_label` (Python) and
stamped onto every step at normalize (`step["process_label"]`); the viewer has an
identical `processLabel` in `process-map-levels.js` so the **Flow diagram
collapses live without a re-analyze**. The two regexes must stay in sync.

This abstraction — already used by the step-level map and the observed-flow BPMN
(ADR-0012) — is now the grouping key **everywhere a step is aggregated**:

- **Grouping key:** `canonical_step_id → process_label → step_id`
  (`analysis_common.step_group_key`).
- **Display label:** a template-matched step keeps its canonical `name`
  (authoritative, value-free by construction); an auto step falls back to
  `process_label` (`analysis_common.step_group_label`).

Applied in `analysis_time_study`, `analysis_automation`, and (`step_group_label`)
in `stats_compute.step_stats` / `step_variants`. The cross-session pooler
(`viewer/analysis-aggregate.js`) keys on `canonical_step_id || name`, so once the
per-session rows carry a value-free `name`, cross-session pooling collapses too —
no viewer change needed.

**Result on the real demo session:** time-study rows 64 → 17, `step_stats`
28 → 17, each step type one row with `instances = N` ("Salesforce: Search · 4").

### 2. Drill-down scopes to the clicked node's children — on the Flow diagram

Clicking a **phase** node descends to the step level showing only that phase's
steps; clicking a **step** node descends to the activity level showing only the
activity labels produced inside that step
(`aggregate-view.drillDownLevel(label)`, `buildAnnotationDfg(…, filter)`,
`_filterDfgToLabels`). A **"scoped: ‹parent› · show all"** chip in the map header
is the inverse (clears the scope).

**Scoping is a live-DFG (Flow diagram) capability only.** The Process diagram
(BPMN) is a *pre-mined static file* (ADR-0012) that cannot be re-filtered in JS,
so a click there descends *unfiltered*, consistent with "the BPMN only collapses
on re-analyze." The scope is cleared by an explicit level pick, a switch to the
BPMN notation, and a data refresh.

### 3. "Hide rare paths" thins one-off edges for readability

A Flow-diagram toggle (`process-map-levels.dropRareEdges`) drops frequency-1
edges *when the model has more-frequent paths*, leaving the dominant flow; the
hidden count shows in the label and it is reversible. It is a **no-op when there
is no frequency spread** (every edge a singleton), so the map is never blanked.
This is the "+N more / show rare paths" affordance for scale; BPMN-XOR fan-out
itself is valid notation, not a bug (see COHERENCE-AUDIT.md / NEXT-SESSION §3).

## Consequences

### Easier
- The Analysis tab, the step report, and the step-level map are **usable on real
  one-off-valued data** — repeated work reads as one thing with a count.
- One abstraction (`process_label`) underpins the map, the stats, and the
  analysis, so they agree by construction.
- The hierarchy is navigable (drill-in) and dense maps are readable (rare-path
  thinning), both without a re-analyze.

### Harder / to revisit
- **Two regexes to keep in sync** — `step_suggest.process_label` (Python) and
  `process-map-levels.processLabel` (JS). A divergence makes the live Flow
  collapse disagree with the mined BPMN. Tested on both sides.
- `process_label` is a heuristic strip (a trailing ` — value` or `Enter X in Y`);
  a step name shaped unlike those two patterns is left whole, so an oddly-named
  auto step can still fail to collapse. Calibrate against more real captures.
- Drill-scoping and rare-path apply to the **DFG only**; the BPMN's static nature
  is a standing asymmetry the analyst must understand (the chip is hidden on the
  Process diagram).

## Action Items
1. [x] `process_label` stamped at normalize + live `processLabel` in the viewer (v0.15.0 real-run fix).
2. [x] `step_group_key` / `step_group_label` in `analysis_common`; applied in `analysis_time_study`, `analysis_automation`, `stats_compute`. Tests: value-laden-name collapse on both Python and JS sides.
3. [x] Drill-down subtree scoping (`drillDownLevel(label)`, `buildAnnotationDfg` filter, `_filterDfgToLabels`) + scope chip + clear.
4. [x] "Hide rare paths" toggle (`dropRareEdges`) + hidden-count label.
5. [ ] Calibrate `process_label` and the rare-path threshold against more real captures; consider a frequency *slider* if a binary toggle proves too coarse.
6. [ ] Drill-scoping for the BPMN would need live re-mining in JS or a server round-trip — deferred.
