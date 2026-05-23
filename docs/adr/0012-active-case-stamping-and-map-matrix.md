# ADR-0012: Active-Case Stamping & the Notation × Level Process-Map Matrix

**Status:** Accepted — shipped in v0.15.0 (2026-05-23); empty-value anchor guard
+ observed-flow export added 2026-05-23 (unreleased)
**Date:** 2026-05-23
**Deciders:** Rasha (analyst/owner)
**Related:** [ADR-0009](./0009-normalization-redesign-v013.md) (anchor detection),
[ADR-0011](./0011-platform-recognition-layer.md) (recognition layer),
[VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md),
[COHERENCE-AUDIT.md](../architecture/COHERENCE-AUDIT.md)

## Context

Two related defects surfaced when the v0.13 pipeline met a real capture.

1. **Case over-segmentation.** Cases were detected by an open/close-by-gap model
   (`min_gap_ms` / `close_on_pause_ms`): a long pause inside one ticket's work
   split it into several "cases", and re-searching the same serial opened a new
   one each time. A real ATM session in which **one** serial was searched ~11
   times produced **13** "cases" — noise, not tickets. The process-mining log
   built on that is meaningless.

2. **The process map conflated notation and level.** A single "depth" control
   mixed two independent axes — **notation** (BPMN "Process diagram" vs. DFG
   "Flow diagram") and **level** (Activity / Step / Phase) — and carried the
   wrong premise that *"step level can only render as a DFG"*, so changing level
   yanked the user off the BPMN tab. (See COHERENCE-AUDIT.md.)

## Decision

### 1. Active-case stamping (replaces gap-based case detection)

A case is **named by an anchor** (e.g. the serial-search field) and is **stable
per label**: `case_id = uuid5(_ANCHOR_NS, label)`, so re-searching the same
serial **resumes** that case rather than opening a new one. The **most-recently
fired anchor is the active case**, and every following interaction is attributed
to it. Because work interleaves (search A → … → search B → … → search A again),
a case owns a list of **disjoint active segments**, not one contiguous range —
so stamping is correct under interleaving (`detect_cases_from_anchors` /
`stamp_anchor_cases` in `normalization/case_assignment.py`).

Two guards keep it honest:
- **Degenerate-case guard** drops slivers — a case below `min_case_interactions`
  (default 2) **or** `min_case_duration_ms` (default 1000) is discarded as an
  accidental anchor fire.
- **Empty-label guard** (2026-05-23): an anchor fire whose label value is empty
  — a focus/click on the search box before anything is typed — does **not**
  open a case or switch the active one. An empty box names no ticket; without
  this it opened a throwaway `""` case that the degenerate guard then dropped,
  **orphaning** the interactions stamped to it.

This supersedes `min_gap_ms` / `close_on_pause_ms` splitting: a pause is just a
pause; the case resumes on the next anchor.

### 2. Notation × Level is a full orthogonal matrix

The map is **notation × level**, two independent axes:
- **Notation:** Process diagram (**BPMN**) or Flow diagram (**DFG**).
- **Level:** Activity / Step / Phase.

The level selector changes level **in place** and never swaps notation; the
notation tabs never reset the level (`viewer/views/aggregate-view.js`
`renderMap()` / `mapBpmnFile()`). **The Process diagram (BPMN) supports all
three levels** — this corrects the retired "step → DFG only" premise.

**Step/Phase BPMN is the _observed flow_**, mined from the annotations (no
Process Template required): one trace per case over the step/phase labels →
PM4Py `discover_inductive` → `export_bpmn`, with a pure-Python BPMNDI layout so
`bpmn-js` can render it (`normalization/bpmn_observed.py`
`write_observed_bpmn`). `normalize.py --mine` writes `process_map_step.bpmn` /
`process_map_phase.bpmn` into the session folder whenever non-hidden steps
exist; the viewer reads those files, and the Step/Phase BPMN **export** now ships
that same observed-flow file (rather than the template-derived `bpmn_step`,
which is empty without `--canonical`).

## Consequences

### Easier
- A real capture collapses to its **true** case count — the ATM session now
  reports **1 case** (one serial), the basis for sane statistics and alignment.
- The map is navigable across **both** axes; every notation × level cell is
  valid, and switching one axis never silently changes the other.
- Step/Phase process diagrams exist **without a Process Template** — the
  observed flow is mined straight from the analyst's annotations.

### Harder / to revisit
- Anchor detection still depends on the canonical template naming the right
  `case_anchor` field; recognising the *anchor itself* from documented platform
  signatures (rather than an opaque `automation_id` like `txtsr`) is the
  ADR-0011 direction, not yet wired into case detection.
- "One serial = one ticket" is a **capture-completeness** assumption: if a
  session handled two tickets but only one serial reached the anchor field,
  stamping correctly yields one case — the gap is in capture, not here.
- `process_map_step|phase.bpmn` is regenerated on `--mine`; consumers must
  re-analyze to refresh it after editing steps/phases.

## Action Items
1. [x] Active-case stamping (`detect_cases_from_anchors` / `stamp_anchor_cases`) + tests.
2. [x] Degenerate-case guard (`min_case_interactions` / `min_case_duration_ms`).
3. [x] Empty-label anchor guard + tests (`test_anchor_cases.py`). *(2026-05-23)*
4. [x] Notation × level matrix in `renderMap()`; observed-flow Step/Phase BPMN (`bpmn_observed.py`).
5. [x] Step/Phase BPMN **export** repointed at the observed-flow file. *(2026-05-23)*
6. [x] Phase → Step → Activity drill-down navigation, with subtree scoping (a click filters to the clicked node's children on the Flow diagram) — [ADR-0013](./0013-value-free-grouping-and-map-readability.md).
7. [ ] Recognition-driven anchor detection (ADR-0011), replacing the opaque-`automation_id` anchor.
