# ADR-0018: Anchor candidates — transaction-ID auto-extraction for unbracketed sessions

**Status:** Accepted — implemented 2026-05-28 (`normalization/anchor_suggest.py`, the anchor-candidates panel in `viewer/views/flow-view.js`, `shared/SCHEMA.md` §`anchor_candidates`)
**Date:** 2026-05-28
**Deciders:** Project owner, analyst (process-discovery lead)
**Related:** [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (the anchor mechanism this feature feeds), [ADR-0016](0016-segment-level-automation-candidacy.md) (the segment-signature precedent), [ADR-0017](0017-suggested-markers.md) (the companion change-point detector for the OTHER path to bracket unbracketed work), [ML Integration Recommendation](../To-Do/) Phase 0 item #5.

## Context

[ADR-0012](0012-active-case-stamping-and-map-matrix.md) added **anchor-based case detection**: instead of requiring the worker to fire Start/End markers, the pipeline can derive cases from typing into a known field — the customer-ID search box, a serial-number entry, an order-number cell. Anchor mode is the lighter-touch path: the worker focuses on the work; the analyst configures the field once per engagement.

The configuration cost matters. The analyst configures the anchor in a **Process Template YAML** (`normalization/canonical/sample-anchor-based.yaml` and similar). For an established engagement that's a one-time setup. For a brand-new engagement — the discovery sessions this tool is *designed for* — the analyst has no anchor configured yet, and the recording arrives as one big default case with everything attributed to it. Downstream analysis collapses against that single case in exactly the same way [ADR-0017](0017-suggested-markers.md) tackles for the markers path.

The recurring failure mode:

> Worker records 90 minutes of work in Salesforce. The analyst opens the session, runs Analyze, sees `0 cases`. They watch the video, notice the worker types a customer ID at the start of each ticket, and write a Process Template by hand naming `automation_id: customer-id-field` as the anchor. Re-analyze, 3 cases. **The signal was already in `events.jsonl`** — the analyst's manual step transcribes what the system could have pattern-mined.

[ADR-0017](0017-suggested-markers.md) (Suggested markers, the companion feature) attacks this from the marker side: detect change-points in the event stream and propose Start/End boundaries. Anchor candidates attack it from the **field** side: detect which UIA field's typing actually segments the session into cases.

The two coexist: the analyst sees both surfaces and picks whichever feels right for the session. Suggested markers fit ad-hoc / one-off sessions; anchor candidates fit engagements where the field-typing pattern recurs.

## Decision

**Add a hand-rolled pattern-mining detector that ranks fields by how good a case anchor they'd be.** The viewer surfaces the top candidates above the Markers list; the analyst Accepts one (writing a session-level `case_anchor_override` into `annotations.json` that the next normalize run consults BEFORE the marker-mode fallback) or Dismisses one (suppressing the signature from being re-suggested across re-normalizes).

Constraints baked into the decision:

- **Hand-rolled, no new dependencies.** Stdlib only — `Counter`, `defaultdict`, `hashlib.blake2b`. The existing `case_assignment.detect_cases_from_anchors` is reused for the simulation. No `sklearn`, no `pandas` even.
- **Reuse `case_assignment.detect_cases_from_anchors` for scoring.** For each candidate field, the detector *simulates* what the canonical pipeline would produce if that field were the anchor, then scores the resulting case structure. This guarantees that **every emitted candidate is actionable** — the `anchor_config` is the same shape `case_assignment` already accepts, and the simulated metrics are computed from the same machinery the production path will use. The fuzzer's headline invariant is that this round-trip never fails.
- **Suggest, don't mutate.** Same posture as [ADR-0017](0017-suggested-markers.md): candidates live in `annotations.json` as a regenerated-each-run block; the analyst's Accept writes a `case_anchor_override` and the dismiss-list survives re-normalize.
- **Stable identity.** Signature = 12-char blake2b over `(field_property, field_value, window_title)`. Same shape and reasoning as [ADR-0017](0017-suggested-markers.md): decouples the dismiss / accept matching from score drift.
- **Precedence: Process Template > override > markers.** The engagement-level Process Template (when present) wins over the session-level override — the canonical contract is the template, and the analyst's session-level pick is a discovery aid, not a replacement. Both anchor paths fall through to marker mode if neither fires.
- **Coherence discipline ([docs/architecture/COHERENCE-AUDIT.md](../architecture/COHERENCE-AUDIT.md)).** Inverse: Accept ↔ Dismiss for candidates, AND Accept ↔ Clear for the override (the "I changed my mind" path, since an Accept disappears from the candidates list once written). Legend: not needed — anchor candidates have no new timeline visual; the panel is text. Control-interaction: the panel renders in the markers tab where the analyst already looks for case-boundary controls; doesn't conflict with the markers list or the suggested-markers controls. Real-run: verified against the unbracketed fixture (0 cases → Accept top candidate → 3 cases after re-normalize).

### The detector

Four signals, each clamped to `[0, 1]`, blended with weights summing to 1.0:

1. **Coverage (weight 0.40):** `sum(case interaction_counts) / total_interactions`. Rewards anchors that catch most of the work — a field that fires once and catches 5 interactions out of 200 is not a real anchor.
2. **Balance (weight 0.30):** `1 - coefficient_of_variation(case_sizes)`. Cases of similar size are the hallmark of a recurring ticket-shaped process; wildly uneven case sizes suggest the field isn't actually the case-key (e.g. typing a date that splits into 1-event and 50-event "cases").
3. **Diversity (weight 0.20):** `distinct_labels / fire_count`. A real case-anchor has a unique label per fire (CUST-11255, CUST-11256, CUST-11257); a non-anchor field re-types the same value (the company name, the user's own ID).
4. **Focus (weight 0.10):** `1 / log2(case_count + 1)`. Rewards a "right-sized" handful (2–10) of cases over the degenerate "100 cases of 1 event each" pathology.

The detector iterates every `(automation_id, name)` field that received at least 2 `value_changed` / `text_changed` events with a non-empty stripped value; for each, it builds an `anchor_config` (`field` + `equals` + `case_label_from: "value"`), runs `detect_cases_from_anchors` with it, scores the result, and keeps candidates that pass the `_MIN_CASES=2` guard. Returns the top 5 by score.

### Annotations schema

Three new keys on `annotations.json`, all additive:

- **`anchor_candidates[]`** — the live "things to render" array. Regenerated each normalize.
- **`anchor_candidates_dismissed[]`** — signature-keyed dismiss-set.
- **`case_anchor_override`** — null (the default) OR a `case_anchor` dict the normalize pipeline consults. Audit fields (`_accepted_signature`, `_accepted_at`) are stripped by `coerce_anchor_override` before the cfg reaches `detect_cases_from_anchors`.

## Alternatives considered

- **Variance-only scoring (within-case stability + across-case variance).** Rejected — chicken-and-egg: computing "stability within a case" presupposes case_ids, which is what we're trying to derive. Simulating-each-candidate via `detect_cases_from_anchors` sidesteps that.
- **Pull in sentence-transformer embeddings to cluster field NAMES (e.g. "Customer ID" ≈ "CustomerID" ≈ "cust-id").** Rejected — same constraint chain as the ML Integration Recommendation flagged: bundle weight + corp-laptop CPU. And the rule of "automation_id is stable across recapture" already handles the naming-drift problem for the most reliable case.
- **A regex on the typed VALUE (`CUST-\d+`, `SN-\d+`).** Rejected — too brittle. Real engagements have ID schemes the detector won't anticipate (`P12345`, `ORD/2026/00041`, plain integers). The "fire_count and distinct_labels imply case-key" heuristic generalises across schemes.
- **Surface the candidate as a Process Template stub the analyst saves to disk.** Rejected — round-trip overhead and another file to manage. The session-level `case_anchor_override` lets the analyst try anchors in-place; the moment they're confident, they can hand-promote the override into a Process Template for next sessions.
- **Always-on panel.** Rejected — when there's a clean anchor / template in play, the panel is noise. The renderer hides it when there are zero candidates AND no override; reveals it the moment either condition flips.
- **Cross-session candidate aggregation.** Rejected for v1 — useful but adds Compare-Sessions surfacing and a new aggregation pass; out of scope for the first chip. The recommendation doc lists this as a future Phase if the rollout justifies it.

## Consequences

### Positive
- A discovery session's "0 cases" failure mode now has a one-click recovery path — the analyst doesn't write Process Template YAML to test an anchor hypothesis.
- The `anchor_config` shape the detector emits is **identical** to what `case_assignment.detect_cases_from_anchors` accepts (same module, same vocabulary) — there's no parallel matcher to drift.
- Signature-keyed dismiss + accept follow the same posture as ADR-0016 and ADR-0017 — re-normalize-idempotent by construction.
- The precedence rule (`template > override > markers`) preserves the engagement-level contract: the analyst's session-level pick never overrides a Process Template that's already in play.
- Test coverage: 17 deterministic regression scenarios + 5 fuzzer regimes (~8.3k randomized inputs) prove robustness. Every fuzzer iteration verifies that emitted `anchor_config` round-trips through the production `detect_cases_from_anchors` and produces ≥ 2 cases.
- Bundle delta: zero — pure stdlib detector, viewer changes are CSS + JS only.

### Risk: scoring weights uncalibrated on real captures
Same as [ADR-0017](0017-suggested-markers.md). Fuzzer proves the detector never crashes and every emitted config is actionable. Whether the four-signal blend ranks the *right* field first in a 200-interaction Excel-and-SAP session is owner-side calibration. Logged in [NEXT-SESSION-SPEC §3](../To-Do/NEXT-SESSION-SPEC.md); bumping `heuristic_version` is the contract for breaking recalibration.

### Risk: the analyst accepts a field that *isn't* the case key
Possible — especially in a session where multiple fields fire 3 times with distinct values (the unbracketed fixture has `customer-id-field`, `order-quantity`, and `order-number-cell` all tying). Mitigations:
- The top-ranked candidate is correct by score in the fixture (0.935 vs 0.776 vs 0.738 — coverage and balance disambiguate cleanly).
- Accept is reversible via the Clear button on the active-override surface; Ctrl+Z reverts a fresh Accept.
- The override doesn't take effect until the analyst re-runs Analyze, so a misclick is a "re-analyze and see" away from being a real consequence.

### Risk: confusion when both suggested markers AND anchor candidates fire on the same session
Both detectors run; both surface on the markers tab. The analyst sees: "anchor candidates" panel above, "suggested markers" rows in the list. Either Accept produces real cases. The two are complementary — Accept the anchor for an engagement-style session; Accept individual markers for an ad-hoc session. The viewer hint copy (`"Looks like a case anchor"` vs `"suggested marker (dashed)"`) is the only signal — calibration of the panel hints will be revisited if the analyst reports confusion.

### Risk: `case_anchor_override` with a malformed shape
`coerce_anchor_override` is the only consumer; it returns `None` for any input lacking `field` or `recognized`, and the pipeline silently falls back to marker mode. The fuzzer's "merge handles garbage" regime exercises this with strings, dicts missing fields, and `_accepted_*` fields that survive prior runs.

### Out of scope (deferred)
- **Cross-session anchor learning.** "Apps and fields the analyst always Accepts on Engagement X should auto-boost in score for the next session of the same engagement." Useful but needs an engagement-scoped storage surface; v2+.
- **Promote-to-template button.** A one-click "save this override as a new Process Template YAML" would close the loop for engagements that recur. Useful but adds a file-write surface; deferred to a follow-up.
- **Anchor candidates in Compare-Sessions.** A multi-session aggregation panel showing "field X looks like the anchor across N of M sessions" would help with engagement-level setup. Useful but a separate aggregation pass; deferred.
