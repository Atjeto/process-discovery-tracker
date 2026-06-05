# ADR-0029: Pattern Layer — classical ML and sequence mining as a normalisation stage

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 2 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0016](0016-segment-level-automation-candidacy.md) (the segment grain this layer feeds with honest motif evidence), [ADR-0017](0017-suggested-markers.md) (the suggest-don't-mutate precedent + the hand-rolled-no-new-deps posture), [ADR-0018](0018-anchor-candidates.md) (the companion field-side detector), [ADR-0024](0024-step-grain-as-view-time-rollup.md) (the view-time grain ladder the clusters render at), [ADR-0028](0028-ai-naming-layer.md) (the downstream Naming Layer that names what this surfaces), [ADR-0030](0030-engagement-workspace.md) (the engagement scope cross-session clustering requires). Spec: [PDT-1.0-SPEC §3.1](../PDT-1.0-SPEC.md#31-pattern-layer--classical-ml-and-sequence-mining).

## Context

The current heuristic stack — `step_suggest`, `case_assignment`, the segment-grain ROI in `analysis_roi.py`, the change-point detector in `marker_suggest.py` ([ADR-0017](0017-suggested-markers.md)), the anchor candidates in `anchor_suggest.py` ([ADR-0018](0018-anchor-candidates.md)) — does the easy deterministic version of pattern recognition well. Each remaining gap is the same shape: *similarity across noisy variant sequences, cross-session linkage, anomaly thresholds calibrated to the actual session.*

The Naming Layer ([ADR-0028](0028-ai-naming-layer.md)) cannot solve that. An LLM can *name* an activity cluster but cannot *discover* it from an event stream — that's a structure-from-noise problem, not a language problem. Naming the clusters before they exist is the textbook hallucination surface; producing them deterministically (or via classical ML when needed) and naming what survives is the correct order.

The four concrete gaps the heuristics leave open:

1. **Activity clusters.** `process_label` derives one label per window-title pattern. Real activities span multiple screens and tolerate noise; clustering similar event windows is what produces the *unit* the Naming Layer names.
2. **Motifs / repeated subsequences.** Segment ROI ([ADR-0016](0016-segment-level-automation-candidacy.md)) wants honest evidence of *"these N events repeat M times"* — not just "this window appeared a lot." Motif mining produces that signal.
3. **Cross-session case linkage.** When markers are absent and no anchor field exists, cases still need to be inferred. Motif boundaries + app-vocabulary anchors + dwell-time bimodality are the inputs; a confidence band is the output.
4. **Anomalies.** Sessions or segments that differ substantially from the modal pattern — the consultant's first-look list.

## Decision

**Add `normalization/patterns/` as a new normalisation stage between `segment_assembly` and the Naming Layer.** The layer is the new structural source of truth that previously-heuristic detectors will be re-pointed at; the LLM never sees its inputs and only names its outputs.

Module layout — one submodule per concern, sibling to `normalization/recognition/`:

| Module | Purpose |
|---|---|
| `motif_mining.py` | Sequence motif discovery — repeated event subsequences. |
| `clustering.py` | Activity clustering over recognised-interaction sequences. |
| `anomaly.py` | Sessions / segments that deviate from the modal pattern. |
| `case_inference.py` | Marker-free case-boundary inference from motif boundaries + vocab anchors + dwell-time bimodality. |

Constraints baked into the decision — same posture [ADR-0017](0017-suggested-markers.md) takes for the change-point detector:

- **Pure-Python in-repo where possible.** Hand-rolled motif mining and clustering against the input volume the pipeline sees (one session = thousands of events, not millions). `scikit-learn` is allowed *only* where the wheel is small and the algorithm is genuinely better than a 100-line in-repo implementation; weights vendor into `viewer/python/` only on a measured bundle delta. The default is "in-repo," not "import sklearn." Heavyweight deps (`scipy`, `numpy`-heavy ML stacks) are rejected at the bundle-cost level the same way `ruptures` was rejected in [ADR-0017](0017-suggested-markers.md).
- **Additive output, never destructive.** Results land in a new `derived/patterns.json` blob and as additive fields on existing `segments[]` / `cases[]` in `annotations.json`. Manually-authored content survives re-runs.
- **Confidence band, never a point estimate.** Cross-session case linkage and anomaly scores ship with explicit confidence; downstream surfaces (Cockpit, PDD, €-ROI) consume the band. Anomaly thresholds are calibrated to the session's own distribution, not a hard-coded constant.
- **Variant suppression below 3 cases.** The Cockpit refuses to show variant percentages with fewer than 3 observed cases — *"only 2 cases observed; variant analysis suppressed"* ([PDT-1.0-SPEC §5.2](../PDT-1.0-SPEC.md#52-cross-session-work-the-engagement-enables)). A new guard pins this ([PDT-1.0-SPEC §7.4](../PDT-1.0-SPEC.md#74-guard-updates-chip-guardrailsmd)).
- **Cross-session is engagement-scoped, not global.** Clustering across sessions runs inside an Engagement ([ADR-0030](0030-engagement-workspace.md)); the v1.0 answer to cross-client pattern sharing is "no carry-over" ([PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions)).
- **Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md)).** Every cluster / motif / anomaly is rejectable in the UI (Glance, Cockpit, Workshop) — disagreement is a first-class verb. Rejections store as negative examples in `annotations.json`; the next normalisation pass re-mines with them as constraints. No live retraining.

### Why-before-LLM

The order is load-bearing. The Naming Layer ([ADR-0028](0028-ai-naming-layer.md)) names *what the Pattern Layer surfaces.* Reversed — naming first, then trying to validate against structure — is the hallucination shape. Phase 2 of the [PDT 1.0 rollout](../PDT-1.0-SPEC.md#8-phased-rollout) ships the Pattern Layer **before** Phase 4 ships the Naming Layer for exactly this reason; Phase 3 (Glance + the self-annotation wizard, [ADR-0032](0032-self-annotation-wizard.md)) sits between them to produce labelled examples the Naming Layer is evaluated against.

## Consequences

**Positive**
- Segment-grain ROI ([ADR-0016](0016-segment-level-automation-candidacy.md)) becomes honest: candidates derive from observed motifs, not single-window proxies. The €-ROI band's "where does that number come from" answer improves.
- Cross-session work the engagement workspace ([ADR-0030](0030-engagement-workspace.md)) needs — "Review incident" across Alice, Bob, and Carol — has its load-bearing structural input.
- The Naming Layer is unblocked. It receives stable units to name, not raw events.
- Disagreement-as-feedback ([PDT-1.0-SPEC §4.3](../PDT-1.0-SPEC.md#43-the-workshop-toggle-formerly-depth)) closes the loop without live training.

**Negative / accepted**
- New calibration surface — anomaly thresholds, cluster similarity, motif-minimum-support — needs real-engagement validation before the defaults are trusted. Same posture [ADR-0017](0017-suggested-markers.md) takes; calibration is owner-side work.
- Bundle delta if `scikit-learn` proves necessary anywhere. The default is in-repo; an `sklearn` decision is gated on a measured comparison.

**Reversal.** If the layer underperforms on real engagement data, the heuristic stack still runs (the Pattern Layer is additive; existing `auto_*` outputs survive). The Naming Layer would degrade to cluster IDs — same fallback [ADR-0028](0028-ai-naming-layer.md) defines for an Ollama-unreachable backend.
