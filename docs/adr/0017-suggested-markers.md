# ADR-0017: Suggested markers — change-point detection for unbracketed sessions

**Status:** Accepted — implemented 2026-05-28 (`normalization/marker_suggest.py`, the markers lane in `viewer/views/flow-view.js`, `shared/SCHEMA.md` §`marker_suggestions`)
**Date:** 2026-05-28
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (anchor-based case detection — the *other* path to derive cases without markers), [ADR-0016](0016-segment-level-automation-candidacy.md) (the segment-signature precedent for stable identity), [ML Integration Recommendation](../To-Do/) Phase 0 item #2.

## Context

A worker recording a long passive process — an hour or more of their actual day — often forgets to fire Start/End markers between cases. The capture app already pushes hard against this failure mode (Live Session window, hotkey overlay, marker-close-then-open default), and the analyst can configure anchor-based case detection for engagements where a single field reliably names each case ([ADR-0012](0012-active-case-stamping-and-map-matrix.md)). But field reality is field reality:

- The anchor mechanism needs an engagement-specific template — useful when the engagement is established, useless on a discovery session.
- A worker recording before they know which field is the case key has no anchor to set yet.
- Long passive recordings driven by a single dashboard collect markerless work between deliberate "ticket open" moments.

When markers are absent and no anchor fires, `case_assignment.assign_case_ids` produces one big default case. Every downstream artifact collapses against it: `step_suggest` segments the entire stretch as one logical sequence, `analysis_segments` finds no boundaries, `stats.compute_all` reports a single 90-minute case, the PDD's As-Is process section reads as one undifferentiated blob, and the segment-level automation candidacy from [ADR-0016](0016-segment-level-automation-candidacy.md) has nothing to pool across.

The analyst's fallback today is to bracket the recording by hand from the timeline — right-click → "Insert Start marker here…" / "Insert End marker here", queued as `marker_edits[]` op:insert and applied on the next normalize. That works but it's tedious for a long recording, and the analyst guesses at boundaries from a video they only watched once.

## Decision

**Add a hand-rolled change-point detector that surfaces candidate Start/End boundaries as suggested markers.** The analyst clicks Accept to promote a suggestion into the existing `marker_edits[]` op:insert path (so the next normalize stamps real cases) or Dismiss to suppress that boundary from being re-suggested across re-normalizes.

Constraints baked into the decision:

- **Hand-rolled, no new dependencies.** `pandas` + stdlib only. No `ruptures` / `scipy.signal` / `sklearn`. Adding a heavyweight library for this is wrong-sized — the change-point detection problem here is small (one stream per session, dozens to hundreds of boundary candidates), and a 2-100 MB library for it bloats the viewer's bundled Python (`viewer/python/`, currently ~190 MB; +bundle weight per [docs/BUILD-AND-DIST.md](../BUILD-AND-DIST.md) is meaningful).
- **Suggest, don't mutate.** Raw `events.jsonl` is append-only / immutable. Suggestions live in `annotations.json` as a new top-level `marker_suggestions[]` block; Accept writes to the existing `marker_edits[]` op:insert path; Dismiss writes to a new `marker_suggestions_dismissed[]` block.
- **Stable identity for re-normalize.** Each suggestion has a 12-char `signature` (blake2b over `(marker_type, ts bucketed to 5 s, before_app, after_app, reason)`) — mirrors the `segment_signature` pattern in [ADR-0016](0016-segment-level-automation-candidacy.md). Dismissals and accepts are keyed on this signature so they survive re-normalize even if the detector tweaks its score.
- **Coherence discipline ([docs/architecture/COHERENCE-AUDIT.md](../architecture/COHERENCE-AUDIT.md)).** Every new verb has its inverse on the same surface (Accept ↔ Dismiss, both visible with equal weight; Ctrl+Z reverts each), every new visual encoding has an on-screen legend ("suggested marker" chip in the timeline legend strip), the new control is checked against the controls already on the Flow timeline surface (right-click insert / G4 "Insert case from selection" / Lanes menu — no axis-mash, suggested markers ride the existing `lanes.markers` toggle), and the change is verified in a real run via the `_pdt_verify` harness, not just unit tests.

### The detector

Four signals scored per row in the **uncased** stretches (events with `data.case_ids == []`):

1. **`idle_gap` (0.0–0.5):** `0.5 * tanh(idle_gap_to_prev_ms / idle_gap_ms_threshold)`. A long pause suggests the worker switched tasks.
2. **`home_app_return` (0.5):** the incoming app is in the auto-derived "home app" set (the single most common app in uncased rows, gated at ≥40% appearance share) AND the outgoing app is not. The "return to dashboard from a sub-task" signal.
3. **`transaction_id_typed` (0.6):** a `value_changed` / `text_changed` event carries a value matching `^[A-Z]{2,5}-?\d{3,8}$` or `^\d{6,12}$`. The worker just told the system "new case starts now" — the strongest single signal, so it alone crosses the 0.5 threshold.
4. **`app_cluster_boundary` (0.2):** the predecessor and successor apps are in different "clusters." A cluster is a connected component over the Markov adjacency graph where an edge (`a → b`) is in-cluster iff its weight ≥20% of `a`'s outbound mass. Hand-rolled Union-Find, ~15 lines.

A row crosses threshold at `sum >= 0.5`; rate-limited to no two Starts within 30 s. Each Start pairs with an End at the next Start's predecessor or the next idle-gap-above-`idle_gap_ms`, whichever comes first.

**Guards:** drop any suggestion whose timestamp falls inside an `excluded_range`, inside an existing case's `(start_ts, end_ts)` window, within 5 s of a real Start (captured or synthetic op:insert), or whose proposed case would contain fewer than 5 interactions. The 5 s rule applies to Starts only — an End landing right before a real Start is a clean case-to-case handoff (this suggested case closes; the next real case opens).

### Annotations schema

Two new top-level blocks in `annotations.json`, both additive:

- **`marker_suggestions[]`** — the live "things to render" array. Wholesale regenerated each normalize (the analyst owns the dismiss-list and accepted-edits, not the suggestions themselves — same posture `step_suggest._merge_steps` takes with `auto_suggested` steps).
- **`marker_suggestions_dismissed[]`** — signature-keyed dismiss-set. Append-only. Consulted by `_merge_marker_suggestions` on every normalize.

The Accept handler writes the suggestion's `signature` onto the resulting `marker_edits[]` op:insert as `derived_from_signature` so the next normalize recognizes the boundary as "already handled" without needing the suggestion row to persist.

## Alternatives considered

- **Use `ruptures` (the Python change-point library).** Rejected — adds 2 MB + transitive deps to the bundled Python (`viewer/python/`); the detector here needs four bespoke signals rather than a generic change-point algorithm anyway. Hand-rolled is the right size.
- **Use a sequence model (LSTM / transformer) trained on labeled boundaries.** Rejected — the project has no labeled training data and won't for a while; classical statistics is the right tool, not because it's good enough, but because it's actually appropriate. See the ML Integration Recommendation.
- **Extend `marker_edits[]` with a `state: "suggested"` op.** Rejected — conflates analyst-authored ops with auto-derived suggestions; the merge logic would have to discriminate by state on every read; the existing `marker_edits[]` shape is "the analyst's queued change list" and putting auto-suggestions in there muddles that contract.
- **Dismiss via row-state vs separate block.** Rejected — a separate dismiss block keeps the live-render array trivially clean (every entry is actionable, no UI-side filtering), matches the analyst-verdict pattern from [ADR-0016](0016-segment-level-automation-candidacy.md), and makes the dismiss-set a small append-only contract that the merge consults with a `set` lookup.
- **Compute suggestions viewer-side in JS.** Rejected — would need JS↔Python algorithm parity (the same trap the recognition layer hit before ADR-0011 follow-ups #3–#5 closed the cross-side gap); doing it in Python is single source of truth.
- **Run the detector during `--mine` only.** Rejected — the detector is part of the normalize pipeline, not the mining stage. Most normalizes don't pass `--mine` but still benefit from suggestions.
- **Single suggestion per stretch (only Start, no End).** Rejected — without a paired End the analyst would have to set the End by hand from the timeline, which is exactly the work this feature avoids. Pairing in Python keeps both ends inside the same algorithmic decision.

## Consequences

### Positive
- A long unbracketed capture becomes one-click-per-case curatable — the inverse of "marker → case" gets its complement "no marker → suggested marker → case", closing the curation loop the COHERENCE-AUDIT flagged in the analyst's path.
- Signature-keyed dismiss + accept survive re-normalize idempotently — same proven posture as analyst-edited steps.
- The detector is small (one ~400-line module, no new deps), debuggable (every signal is a deterministic Python function), and easy to recalibrate (four constants at the top of the module).
- Test coverage: 19 deterministic regression scenarios + a seeded property-based fuzzer with three regimes (4000 well-formed + 3000 adversarial + 3000 merge invariants + 1000 garbage-input merge), all proving robustness — never crash, never violate the four guards, idempotent across re-runs.
- Bundle delta: zero (no new pip dep). The detector module itself is the only addition to `viewer/python/normalization/`.

### Risk: heuristic false-positives on real (non-demo) captures
The fuzzer proves robustness, not calibration. The score weights (`0.5 / 0.5 / 0.6 / 0.2`), the threshold (`0.5`), the home-app share (`40%`), the cluster edge fraction (`20%`), and the per-case minimum (`5`) are calibrated against demo data and the seeded fuzzer; whether they produce the right number of suggestions per hour on real Salesforce / Excel / Outlook captures is owner-side calibration. Logged in [NEXT-SESSION-SPEC §3](../To-Do/NEXT-SESSION-SPEC.md). The `heuristic_version` field on every suggestion and dismiss-record is the contract for breaking recalibration: bumping it to 2 invalidates the v1 dismiss-set (the analyst's prior verdicts no longer apply to a meaningfully different algorithm).

### Risk: a false-positive the analyst Accepts pollutes case_assignment
Mitigated by per-row Accept only — there is no Accept-all action. A false-positive Accept can also be undone with Ctrl+Z (single keystroke restores the suggestion and removes the op:insert).

### Risk: dismiss-set growing unbounded
Bounded by the suggestion-signature space, which is bounded by the number of detectable change-points in `events.jsonl` (immutable). Worst case is a single-digit-KB list on an all-day capture; not a real concern.

### Risk: signature collision at the 5-second bucket
Worst case is one rare double-render the analyst dismisses once. Not a correctness bug; a UX paper cut.

### Out of scope (deferred to future ADRs)
- Auto-detecting the case anchor itself (Phase 0 item #5 — transaction-ID auto-extraction). The next chip.
- Showing the suggestion's evidence trail (`near_event_ids`) inline in the timeline. Tooltip + side-panel reason chip is the v1 surface; the evidence drill-down can land later if the analyst asks for it.
- Cross-session suggestion learning ("apps and patterns the analyst always Accepts on this engagement should auto-boost in score"). v2+ feature; need real-rollout data first.
