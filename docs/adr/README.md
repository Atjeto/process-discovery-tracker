# Architecture Decision Records — index & registry

This is the **canonical registry** of ADR numbers — the single source of truth for
which numbers exist, and which are dead gaps. It is **enforced by CI**
(`normalization/test/test_adr_registry.py`): the build fails if any ADR number is
duplicated, if an ADR file isn't listed here, or if a file reuses a number this
registry marks as a dead gap.

## The rule (do not break it)

**The next ADR number is always `max(existing) + 1`. Never reuse a number, and never
fill a gap.** If you are an agent/chip adding an ADR: read this table, take the next
number after the highest one below, create `docs/adr/NNNN-title.md`, and add your row
here in the same commit. Concurrent chips must each take a distinct next number (and a
distinct branch — see [CONTRIBUTING](../../CONTRIBUTING.md)).

## Registry

| #    | Title | Status |
|------|-------|--------|
| 0001 | Click recorder — capture mechanism and language | Accepted |
| 0002 | App vocabularies — per-app interaction annotations | Accepted |
| 0003 | Viewer architecture refactor — incremental modularization | Accepted |
| 0004 | Flow timeline + Steps view rework (Warm Editorial) | Accepted |
| 0005 | Capture app tech-debt remediation (C1–C8) | Accepted |
| 0006 | Sequencing the improvements backlog | Accepted |
| 0007 | Activity-event granularity — title in the run key | Accepted |
| 0008 | Build the analysis layer now | Accepted |
| 0009 | Normalization redesign (v0.13) | Superseded in part |
| 0010 | UX overhaul — viewer interaction model + recorder usability | Accepted |
| 0011 | Platform/framework recognition layer | Accepted |
| 0012 | Active-case stamping & the notation × level map matrix | Accepted |
| 0013 | Value-free step grouping (`process_label`) & map readability | Accepted |
| 0014 | Distribution model — GitHub Releases + electron-packager | Accepted |
| 0015 | Intra-session repetition alignment — curate one, propagate | Accepted |
| 0016 | Segment-level automation candidacy | Accepted |
| 0017 | Suggested markers — change-point detection | Accepted |
| 0018 | Anchor candidates — transaction-ID auto-extraction | Accepted |
| 0019 | Reference Maps — decoupled, editable BPMN copies | Accepted |
| 0020 | — | **Gap (never reuse)** |
| 0021 | — | **Gap (never reuse)** |
| 0022 | — | **Gap (never reuse)** |
| 0023 | Recorder capture-confidence model + OCR last resort (§11e) | Accepted |
| 0024 | Step grain as a view-time roll-up (§11b, reframed) | Accepted |
| 0025 | In-app vocabulary discovery — "point-and-learn" | Accepted |
| 0026 | Ship unsigned by design; services-boutique scope | Accepted |

## Why 0020–0022 are dead gaps

0019–0022 were floated in the Wave-0 architecture review (e2e gate, Node egress guard,
pluggable storage backend, calibration config), but that work shipped as direct commits
+ the Fit Analysis, never as standalone ADRs. 0019 was later (re)used for Reference Maps;
the numbering drifted **once** because "reserved" lived only in prose. 0020–0022 are now
permanent dead gaps under the `max+1` rule, and this registry + its CI guard exist so the
drift can't recur. **The next ADR is 0027.**
