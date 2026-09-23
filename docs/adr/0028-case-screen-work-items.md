# ADR-0028: The case-scoped screen visit is the analyst-facing unit of work

**Status:** Accepted (direction pre-approved by [APPROACHABILITY-REDESIGN-2026-07-03](../To-Do/APPROACHABILITY-REDESIGN-2026-07-03.md) §5 R3; owner real-session validation pending)
**Note (2026-09-23):** Superseded by [ADR-0029](0029-ba-helper-refocus.md): `group_annotations[]` and the case by screen work-item view are cut. The runs-and-steps view (confirm the pattern run, then a differences view for the other runs) replaces it.
**Date:** 2026-07-03
**Deciders:** Project owner (approachability critique), analyst (process-discovery lead)
**Related:** [ADR-0024](0024-step-grain-as-view-time-rollup.md) (the containment ladder + the view-time roll-up this extends), [ADR-0009](0009-normalization-redesign-v013.md) (why fragment-tuning at normalize time is banned — "model mismatch, not a tuning bug"), [ADR-0013](0013-value-free-grouping-and-map-readability.md) (the value-free `screen_label` / `screenType` key this reuses), [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (anchor/marker case stamping), [ADR-0015](0015-intra-session-repetition-alignment.md) (curate-one-propagate, the cross-case sibling of this cross-bounce merge).

## Context

The analyst "struggled for months to sit down and annotate" real recordings.
The R3 layer of the approachability diagnosis (§2 L1) names the structural
cause: **segmentation emits mechanical fragments, not tasks.**

A worker handling one ticket bounces TAMBA → Excel → TAMBA → SNFI → TAMBA a
dozen times while investigating it. The pipeline segments finely (correctly —
[ADR-0009](0009-normalization-redesign-v013.md) established that re-segmenting
coarsely at normalize time is a *destructive* one-grain-fits-all flip, and
[ADR-0024](0024-step-grain-as-view-time-rollup.md) made grain a reversible
*view* control instead). But the ADR-0024 roll-up folds only **consecutive**
same-key runs. Every app bounce ends a run, so the interleaved work on one
ticket never folds into one unit: a real 1-hour session shows on the order of
500 step rows, navigable by nothing the analyst remembers. The measured demo is
the same shape in miniature — its 4 cases produce 64 fine steps that the
consecutive roll-up folds to ~19 groups; a real session multiplies that by the
bounce rate.

The analyst's mental unit is not "the fragment where I typed into that field."
It is **"what I did on that ticket, on that screen"** — the whole TAMBA visit
for ticket #10852, merged back together across all the times the work bounced
away to Excel and returned. That is the *case-scoped screen visit*.

The tier gates ([LAB-PHASE-SPEC.md](../LAB-PHASE-SPEC.md) §1) and the use gate
(§3 of the redesign) both apply: this unit earns residence because it produces a
**recorded analyst decision** (name/note/waste the visit) and a **memo sentence**
("14 min across 12 TAMBA visits for this ticket, half of it re-keying") that the
500-row list could never yield.

## Decision

**The analyst-facing unit of work is the case-scoped screen visit — fragments
aggregated *across* bounces within a case (non-consecutive merge) — computed at
view time on the ADR-0024 grain ladder. It is the default Steps reading when the
session has cases; the raw steps array and the pipeline are untouched.**

### 1. The grouping (view-time, non-consecutive, within a case)

For each case, the case's non-hidden steps (chronologically ordered) are folded
by the **screen** grain key — the same value-free
`grainKey(step, "screen")` / `screenType(...)` machinery ADR-0024 already uses
for the map's screen axis (reused, not reimplemented). Unlike ADR-0024's
`rollUpSteps`, which starts a new group at every run boundary, a work item
**merges all steps that share a screen key anywhere in the case**, however many
times the work bounced away and back. The grouping key is:

```
work_item_key = (case_id, screen_key)      where screen_key = grainKey(step, "screen")
```

Steps outside any case (`case_id` null) group under a single **"Unassigned"**
pseudo-case at the end, by the same screen key — never merged across the real
cases, never silently dropped.

The **bounce count is preserved as a fact**, not erased: each work item records
`visit_count` (the number of consecutive runs that were folded — how many times
the worker entered this screen for this ticket) and its member fragment ids in
chronological order. `visit_count == 1` means the work was never interrupted;
`> 1` is exactly the interleave the fine roll-up could not fold.

### 2. Annotation attaches at the group level (additive, viewer-written, pipeline-preserved)

Naming, noting, or flagging a work item writes one entry to an **additive
top-level `group_annotations[]`** array in `annotations.json`, keyed by
`(case_id, screen_key)`:

```json
{
  "group_annotations": [
    {
      "case_id": "7d7bd6ed-…",
      "screen_key": "scr:TAMBA",
      "name": "Investigate serial in TAMBA",
      "notes": "half of this is re-keying the serial",
      "waste": false,
      "hidden": false,
      "manually_authored": true
    }
  ]
}
```

- **`case_id`** + **`screen_key`** are the composite key (`screen_key` is the
  exact `grainKey(step,"screen")` value, e.g. `"scr:TAMBA"`, so it is stable and
  value-free by construction).
- **`name`** *(optional string)* — the analyst's business name for the visit;
  flows to members at render (rule 3).
- **`notes`** *(optional string)* — free text.
- **`waste`** *(optional bool)* — the visit is rework/waste (the one surviving
  per-work judgment, mirroring ADR-0027's single `waste` flag).
- **`hidden`** *(optional bool)* — suppress the whole visit from the case tree.
- **`manually_authored: true`** — marks the entry as an analyst edit, so
  re-normalization preserves it verbatim (the same contract `self_annotations`
  and every analyst edit rely on).

**The pipeline preserves this key but does not consume it.** `normalize.py`
round-trips unknown additive top-level keys (verified: a hand-added
`group_annotations` survives `normalize.py … --mine` byte-for-byte, exactly as
Phase E's `self_annotations[]` does). Nothing under `normalization/` or
`capture/` changes; the session golden is untouched because the golden reads
`process_label`/counts/DFG shape, not this key.

### 3. Render-time flow-down

Wherever a member fragment displays a name at the screen grain — the Steps case
tree, the timeline step lane (when toggled on), the map's step/screen level —
the fragment displays **its work item's `group_annotations` name** if one exists,
falling back to the value-free screen label otherwise. This is threaded through
the **single existing label-resolution seam**, `grainLabel(step, notch, ctx)` in
`process-map-levels.js`: at the `screen` notch it consults an optional
`ctx.groupName(case_id, screen_key)` resolver. Every surface that rolls up
already builds that `ctx` (`rollUpSteps` / `buildAnnotationDfg` / the timeline
lane), so one seam covers all of them — no per-call-site patching.

### 4. Export trade-off (stated honestly)

The PDD / memo export is **Python-side** (`report-md.js` / the pipeline's
document builders) and **does not read `group_annotations` this phase.** A memo
generated now shows the value-free screen labels, not the analyst's work-item
names. This is a deliberate scoping line: R3 makes the *reading and annotating*
unit right in the viewer; wiring the export to prefer group names is the
named **follow-up** (a small additive read in the export path, no pipeline
model change). Recorded here so it is a known gap, not a silent one.

### 5. No-cases fallback

An unsegmented session (no markers, no accepted anchor — every step `case_id`
null) has no case scope to merge within, so the case tree would be one giant
"Unassigned" bucket that answers no "which ticket?" question. In that case the
Steps view keeps the ADR-0024 consecutive roll-up it has today **plus a one-line
CTA** pointing at the anchor/markers path ("Segment this session into cases to
group work by ticket — review the anchor candidate / fire markers"). This is a
replace-pattern (fallback *instead of* the tree), never both at once.

## Alternatives rejected

- **Fan-out writes to member steps** (stamp the chosen name onto every fragment's
  `step.name`). Rejected twice over: it pollutes the very 500-row list this ADR
  exists to escape (the fragments are still there, now all wearing one name), and
  it breaks the re-normalize preservation contract — the pipeline regenerates the
  `auto_*` step set, so fan-out stamps would be clobbered on the next analyze
  while the group-level sidecar survives. Annotation must live *above* the
  fragments, keyed by the stable `(case_id, screen_key)`.
- **Pipeline-time grouping** (merge the fragments in `normalize.py`). Rejected:
  it destroys ADR-0024's reversibility (the fine grain is gone from the data, the
  only way back is a re-analyze the other way) and moves the golden output (the
  §11b flip ADR-0009/0024 measured as *destructive* and *totals-moving*). The
  merge must be a view, exactly like grain.
- **Consecutive-only (keep ADR-0024's `rollUpSteps` as the unit).** Rejected —
  that is the status quo that produces the 500 rows; the whole point is the
  non-consecutive merge within a case.

## Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md))

- **Inverse / control-interaction.** The case tree is the default reading; the
  element-grain flat list and the full ADR-0024 grain ladder stay fully
  functional, reachable via the existing **Detail** slider — sliding to
  `element` restores every fragment, undestroyed. A group name/waste/hide is
  reversible by Ctrl+Z (the annotation snapshot undo covers the additive key for
  free — `snapshotAnnotations` deep-clones the whole blob).
- **Legend.** The Steps helper line names which reading is active and how to
  reach the other ("Grouped by ticket → screen. Set Detail to *element* to edit
  individual fragments.").
- **No dead controls.** A no-cases session gets the fallback + CTA, not a blank
  or degenerate tree.
- **Real run.** Validated in the viewer against the demo (case tree renders; a
  seeded revisit folds `visit_count > 1`) and pinned by `e2e/workitems-smoke.js`;
  the owner real-session gate (a real 1-hour session → ≤ ~60 work items, "find
  that ticket" in seconds) closes the phase per §5 R3.
