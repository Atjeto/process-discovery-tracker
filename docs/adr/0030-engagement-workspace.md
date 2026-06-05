# ADR-0030: Engagement workspace — a new top-level concept above the session

**Status:** Accepted — recorded 2026-06-05 (design only; build is Phase 0–1 of the [PDT 1.0 spec](../PDT-1.0-SPEC.md))
**Date:** 2026-06-05
**Deciders:** Project owner
**Related:** [ADR-0016](0016-segment-level-automation-candidacy.md) (the €-ROI band aggregated up to the engagement level), [ADR-0019](0019-reference-maps.md) (the per-session deliverable artefact this aggregates), [ADR-0026](0026-distribution-unsigned-and-services-boutique-scope.md) (the services-boutique scope that frames "what an engagement is"), [ADR-0029](0029-pattern-layer.md) (cross-session clustering runs here, not globally), [ADR-0031](0031-cockpit-and-workshop-modes.md) (the Cockpit pattern applied at engagement level). Spec: [PDT-1.0-SPEC §5](../PDT-1.0-SPEC.md#5-the-engagement-workspace).

## Context

The v0.x lineage has one unit of work: the session. A session is one worker's recording, normalised once, annotated, and exported. That's the right unit for the analyst-instrument framing the early product targeted; it's the wrong unit for the consulting-augmentation framing [PDT-1.0-SPEC](../PDT-1.0-SPEC.md) commits to.

A real engagement is *one client, one functional area, N captured sessions from M workers, over weeks W1–W4.* The deliverable the consultant produces — a ranked Process Backlog and a PDD per identified process — is engagement-shaped, not session-shaped. Today the consultant assembles that deliverable by hand: open each session, re-do the analysis in their head, merge findings in a spreadsheet, write each PDD from scratch. The tool gives no scaffolding for the aggregation.

Three concrete things break at session scope:

1. **Cross-session activity clustering.** "Review incident" detected in Alice's session, Bob's session, and Carol's session should collapse to one engagement-level activity with 14 cases pooled. The [Pattern Layer](0029-pattern-layer.md)'s clustering needs an engagement scope to run inside.
2. **Defensible variant analysis.** Variant percentages on a single 4-case session are statistically meaningless. On a pooled 14-case engagement they're defensible. The "≤2 cases → suppress variant percentages" rule ([ADR-0029](0029-pattern-layer.md)) only matters in an engagement-scoped view.
3. **Aggregate €-ROI.** Per-session automation savings projected across all sessions of the same process is the number the buyer cares about. The €-ROI band ([ADR-0016](0016-segment-level-automation-candidacy.md)) needs an aggregation surface above the session.

## Decision

**Introduce `engagements/` as a new top-level directory and `currentEngagement` as a new top-level concept in viewer state.** An engagement represents one consulting deliverable — one client, one functional area, N sessions from M workers — and is the unit the Cockpit ([ADR-0031](0031-cockpit-and-workshop-modes.md)) opens against.

Folder layout — files-on-disk, no database ([PDT-1.0-SPEC Appendix B](../PDT-1.0-SPEC.md#appendix-b--what-this-spec-deliberately-does-not-do)):

```
engagements/
  <engagement-id>/
    engagement.json              ← metadata, owner, dates, scope
    sessions/                    ← symlinks or copies of session folders
      2026-06-04-alice-ap.../
      2026-06-05-bob-ap.../
    backlog.json                 ← the Process Backlog (deliverable artefact)
    processes/                   ← one folder per identified process
      review-incident/
        pdd.md
        evidence.json            ← which sessions/cases support which claims
        thumbnail.png
    deliverables/
      backlog.xlsx
      pdd-bundle.pdf
      slide-cards/
```

Constraints baked into the decision:

- **Files-on-disk, no schema migration.** Engagements are directories; sessions are referenced by symlink (or copy on filesystems without symlinks). Re-normalising a session does not touch the engagement; promoting a process to the engagement backlog does not touch the session. Each side stays the authoritative store for its own data.
- **Cross-session work happens here, not globally.** The [Pattern Layer](0029-pattern-layer.md)'s cross-session clustering, variant analysis, and aggregate ROI are scoped to one engagement. Cross-engagement carry-over is **explicitly out of scope for v1.0** ([PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions)) — per-client isolation; revisit after the first three engagements.
- **Variant suppression is engagement-aware.** With ≥3 pooled cases of the same process across the engagement's sessions, variant counts are surfaced. Below 3, the Cockpit shows *"only N cases observed; variant analysis suppressed"* — same posture [ADR-0029](0029-pattern-layer.md) takes at the structural layer.
- **Backlog ranking is the headline.** Processes ranked by `(frequency × time × confidence)`. Low-confidence processes remain visible but ranked below; the consultant decides whether to promote. This is the load-bearing artefact the buyer sees first.
- **The configured engagement is part of the leave-behind.** When a buyer retains the tool ([PDT-1.0-SPEC §6.5](../PDT-1.0-SPEC.md#65-the-configured-tool-itself-the-leave-behind)), the engagement folder + the calibrated thresholds + the authored App Vocabularies + the Reference Maps export as `engagement-config.zip`. The engagement is *itself* the unit of configuration export.
- **Reference Maps ([ADR-0019](0019-reference-maps.md)) link up.** A per-session Reference Map for "Review incident" links to the engagement-level process when the Pattern Layer ([ADR-0029](0029-pattern-layer.md)) finds a match. The rule for linkage is deferred to Phase 2 when the actual output shape is known ([PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions)).

## Consequences

**Positive**
- The deliverable shape matches the buyer's mental model. The Process Backlog is the engagement; the PDDs are its rows.
- The Pattern Layer ([ADR-0029](0029-pattern-layer.md)) has the scope it needs. Variant analysis becomes defensible.
- Aggregate €-ROI projects honestly from pooled measured durations, not from a single-session extrapolation.
- The leave-behind is concrete: a configured engagement is what the client champion inherits.

**Negative / accepted**
- Sessions live in two places (their original folder + `engagements/<id>/sessions/`). Symlinks where supported; copies on filesystems that don't (Windows requires admin or developer-mode for symlinks — the engagement uses copies on default Windows). The metadata-in-`engagement.json` model keeps the engagement authoritative for what's *in* it.
- The viewer's routing grows a new scope (`engagement` vs `session`). The five-tab depth UI stays session-scoped; the Cockpit ([ADR-0031](0031-cockpit-and-workshop-modes.md)) renders at both scopes.
- Multi-worker capture coordination is **out of band** for v1.0 ([PDT-1.0-SPEC §11 open question](../PDT-1.0-SPEC.md#11-open-questions)) — the consultant tells the workers what to capture; the tool aggregates what arrives.

**Reversal.** Engagements are additive — the per-session flow continues to work unchanged. Removing the engagement concept would mean removing only the new `engagements/` directory and the `currentEngagement` viewer state; the session data model is untouched.
