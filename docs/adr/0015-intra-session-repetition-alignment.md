# ADR-0015: Intra-session repetition alignment — curate one, propagate to all

**Status:** Accepted (strategic direction) — partially implemented
**Date:** 2026-05-23 (consolidates the 2026-05-22 redirect of [ADR-0009](0009-normalization-redesign-v013.md) and Decision 1 of [VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md))
**Deciders:** Analyst (process-discovery lead), project owner

## Context

[ADR-0009](0009-normalization-redesign-v013.md) proposed fixing chronic
over-segmentation (the real 1h33m ATM recording yields **~308 atomic steps** instead
of the expected ~70) with **cross-session canonical templates** — a persistent,
hand-authored YAML that recognises "the right steps" in future recordings.

The 2026-05-22 value-chain review surfaced two facts about the real workload that
invalidate that mechanism:

- **Processes are mostly one-off.** Each engagement is a different process, rarely
  re-recorded. A persistent template earns its keep only by matching *future*
  recordings of the same process; for one-off work it matches **zero** future
  sessions and is pure overhead.
- **Both regimes occur regularly** — short single-process recordings (tens of steps)
  *and* long repetitive multi-ticket recordings (the 308-step session).

But the hard regime is not random: the 308-step session is **12 tickets × ~7 steps**.
**The repetition is intra-session, not inter-session** — and that is the opening.

## Decision

Replace cross-session canonical-template *matching* with **intra-session repetition
alignment**:

> Detect the repeating unit (the case / ticket), fuzzily align the instances, let the
> analyst **curate ONE and propagate to all**. The "template" is auto-derived from
> within the session and dies with it — never authored, named, maintained, or reused
> across engagements. Exactly right for one-off work.

This re-uses parts of ADR-0009 and discards others:

- **Survives from ADR-0009:** anchor-based case detection — find the tickets from a
  recurring field value (the serial-search box), not from manual markers. Needs only
  a per-session "which field is the case key" pick, no maintained template. (Shipped
  as active-case stamping, [ADR-0012](0012-active-case-stamping-and-map-matrix.md).)
- **Repurposed:** the `sequence_signature` / `step_variants` machinery (built for
  *cross-session* pooling in Compare-Sessions) becomes the bones for *intra-session*
  alignment — pointed within one session across the detected cases. `canonical-author.js`
  is repurposed as the intra-session propagation engine, not a YAML-authoring path.
- **Rejected:** persistent canonical-template *matching* (ADR-0009 Issues 4, 5, 8),
  mis-targeted for one-off processes.

**Two regimes, two answers:**

| Regime | Answer |
|---|---|
| Short, single-process | Cheap `step_suggest` heuristic fix + fast manual curation (ADR-0010 A1/A2/A4/A5/B1). Few steps, so manual is fine. |
| Long, repetitive multi-ticket | Intra-session alignment: anchor-detect the cases, align the instances, curate one and project across all. |

## What is built vs. open

- **Built:** anchor-based case detection / active-case stamping
  (`case_assignment.py`, [ADR-0012](0012-active-case-stamping-and-map-matrix.md)); a
  first-cut alignment engine (`viewer/step-alignment.js`) with repeat badges and an
  "Apply to N repeats" affordance; the step-level process map that gains its
  frequencies from the aligned instances ([ADR-0013](0013-value-free-grouping-and-map-readability.md)).
- **Open (the hard build):** fuzzy / variant-aware alignment (ticket 3 had an
  exception — a step-level trace-clustering problem) and the full
  curate-once-apply-to-all editing loop. Tracked in `docs/To-Do/NEXT-SESSION-SPEC.md`.

## Consequences

**Easier:** the 308-step regime becomes usable (curate one ticket → apply to twelve);
the step map gets real "this path 10/12 times" frequencies instead of a hairball
(all-unique) or a single line (one instance); no template to author or maintain for
one-off work.

**Harder / caveats:** alignment must be fuzzy/variant-aware, not exact; the AG-Grid
capture gate ([ADR-0009](0009-normalization-redesign-v013.md) Issue 1, **resolved**:
TAMBA AG-Grid cells are identityless, so the grid is one coarse step) bounds the
*granularity* of what can be aligned, not whether alignment works; not every process
has a clean case key (fallback: the analyst marks the first repetition, or detect
recurring sub-sequences by self-similarity).

**Supersedes:** the canonical-template-matching mechanism of
[ADR-0009](0009-normalization-redesign-v013.md) (Issues 4, 5, 8). ADR-0009's
anchor-detection idea (Issue 3) is kept and shipped.

## Action items

1. [x] Anchor-based case detection (the prerequisite that finds the repeating unit) — [ADR-0012](0012-active-case-stamping-and-map-matrix.md).
2. [x] First-cut alignment engine + repeat badges + "Apply to N repeats" (`step-alignment.js`).
3. [ ] Fuzzy / variant-aware alignment across detected cases (step-level trace clustering).
4. [ ] The full curate-once-apply-to-all editing loop (propagate a curated instance to its siblings).
5. [x] AG-Grid capture gate resolved (identityless cells → coarse step).
