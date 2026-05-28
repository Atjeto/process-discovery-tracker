# ADR-0016: Segment-level automation candidacy — coherent stretches, not atomic clicks

**Status:** Accepted — implemented 2026-05-28 (`normalization/analysis_segments.py`, `normalization/analysis_automation.py`, the Analysis & Compare-Sessions views, PDD §4)
**Date:** 2026-05-28
**Deciders:** Project owner, analyst (process-discovery lead)
**Supersedes:** the per-step automation-candidacy mechanism of [ADR-0008](0008-build-the-analysis-layer.md)

## Context

Since [ADR-0008](0008-build-the-analysis-layer.md) the analysis layer has
scored automation candidacy at the **atomic-step grain** — one logical step
per row in the candidate table, ranked by repetitiveness × rule-basedness ×
volume. That grain proved misleading once the PDD started reading like a real
deliverable.

The product-direction insight came from the owner:

> "The deterministic marking of a step to be an automation candidate, waste,
> etc. is kinda out of place with how the app works now. Automation step in
> this context means what? You don't automate clicking the search button, or a
> forward button, if you cannot complete the form population — the process gets
> broken by having a human do a part, then automation clicks a button, then the
> human continues. That's just silly."

A human-robot-human pipeline is **worse than fully manual**: each handoff costs
context, the robot's window of agency is tiny, and any flake in the segment
forces a manual takeover that the analyst hasn't scoped. The unit of automation
that actually makes sense is the **stretch of work a robot could realistically
take end-to-end** — "open the CRM, search the customer, copy three fields,
paste them into the booking screen, submit." A click in the middle of that
stretch is not actionable on its own.

The atomic-step framing also produced 60-row PDD §4 tables of unactionable per-
click candidates that an analyst could not honestly recommend to a client.

## Decision

**Move automation candidacy from the atomic-step grain to the coherent-segment
grain.**

A **segment** is a contiguous run of interactions inside one case that share
the same application, bounded by:
- an application switch (new `process_name` / window),
- a case switch (new innermost `case_id`),
- or an idle gap exceeding `SEGMENT_SPLIT_IDLE_MS` (30 s).

Single-step, sub-5-second segments are dropped — they cannot be automation
units even in principle. Two segments are "the same pattern" when they share
(app, ordered list of constituent `process_label`s); the `segment_signature` is
a stable hash of that pair.

The analysis layer surfaces one row per pattern, carrying:
- the segment label ("salesforce — Search → Copy → Paste"),
- the application,
- the ordered step labels (`step_labels`),
- the cases the pattern appeared in,
- `instance_count`, `total_elapsed_ms`, `mean_elapsed_ms`,
- a `confidence` score in `[0, 1]` (or `null` for single-instance data).

`automation_candidates` in `analysis.json` keeps its key but its per-entry
shape is now segment-grain (see [shared/SCHEMA.md](../../shared/SCHEMA.md)).
`analysis.json.meta.heuristic_version` is bumped to **2** so consumers can
tell pre- and post-ADR-0016 files apart.

Analyst confirm/dismiss is now keyed by `segment_signature` in
`analysis_overrides[]` rather than by `step_id`.

**Waste** stays at the per-step-type grain (`process_label`) — that is the
question the analyst already corrects via the grouped "Waste by step" row in
the Analysis view ("Search across CRM is 80% waste"), and it is a different
question from "could a robot take this stretch."

The per-step `flags.automation_candidate` may still be set by the App Vocab
layer, but the **rendering** sides (Analysis view, PDD §3.5 step list, the
Markdown findings report) no longer surface it — a per-click "Automation
candidate" badge contradicts the segment framing.

## Why segments, not phases or step-types

Considered alternatives:

| Unit | Verdict |
|---|---|
| **Atomic step** (the previous design) | Wrong — see the owner's argument. |
| **Step group / `process_label`** | Right unit for *waste*; wrong for automation. A single "Search" step group is one click — same problem as the atomic step. |
| **Phase** (analyst-curated) | Highest quality, but absent until the analyst has done phase work. Cannot be the default. |
| **Anchor-case segment** (the slice between two anchor-case boundaries) | A full case usually crosses several apps; automating "the whole case" merges segments that ought to be evaluated separately. Useful as a containing scope, not the candidate grain. |
| **Same-app, same-case contiguous run** ✓ | Matches the owner's framing exactly; one app means one automation toolchain (DOM / UIA / API for that app), so a segment is a unit you can actually quote for. |

If real captures show same-app segments fragmenting too aggressively (e.g.
every browser tab change becoming its own segment), the fallback is to widen
the same-app bucket — e.g. treat all `chrome.exe` windows as one app — and
re-tune `SEGMENT_SPLIT_IDLE_MS`. Both are heuristics tunable from
`analysis_segments.py` without changing the model.

## Consequences

**Easier:**
- PDD §4 reads like an honest recommendation ("the CRM lookup → copy contact
  fields → paste sequence runs 4× across cases, total 2m 14s, suggested
  automation: scope this segment as a single, end-to-end unit") instead of a
  60-row grid of single-click candidates.
- The Analysis view's automation list shrinks to a handful of named segments
  on a real recording, instead of dozens of low-confidence rows.
- A `confidence` score that is `null` for one-off data is honest about the
  data being insufficient (the same v1-honesty stance ADR-0008 took).

**Harder / caveats:**
- The `segment_signature` is tied to the *ordered list of step labels*, so
  re-analyzing with different step thresholds can change the signature — the
  analyst's previous confirm/dismiss can detach. We accept this: a different
  step granularity is genuinely a different automation pattern.
- Single-interaction segments are dropped entirely. A genuinely-automatable
  one-click action (a daily "Refresh dashboard" button) won't surface as a
  candidate. We judge this a fair price: surfacing one-clickers is mostly
  noise, and the analyst can still flag them manually.
- Cross-app automations (a "switch to Excel, copy a cell, paste into SAP"
  reflex) become **two** adjacent segments rather than one. The owner's
  framing already covers this — the *transfer between apps* is the place
  meaningful waste shows up, and it is captured under `cross_app_transfers`
  in the waste classifier, not as a single segment.

## Implementation outline

| Layer | Change |
|---|---|
| Segment detection | New module `normalization/analysis_segments.py` — `detect_segments(events, steps)` walks the interaction stream and emits the coherent runs. |
| Scoring | `normalization/analysis_automation.py` rewritten: builds segments, groups by signature, scores at the segment grain. The function name and return-list key (`automation_candidates`) are preserved so callers don't break. |
| Orchestrator | `normalization/analysis.py` now also writes `analysis.json.segments`, the raw segment list, for viewer drill-in. `HEURISTIC_VERSION` bumped to **2**. |
| PDD §4 | `normalization/pdd_export.py` rewrites §4 around the segment table + a narrative top-3 summary. §3.5 strips the per-step `automation_candidate` flag from rendering. |
| Analysis view | `viewer/views/analysis-view.js` renders one row per segment pattern, with a confirm/dismiss control keyed by `segment_signature`. |
| Compare-Sessions | `viewer/analysis-aggregate.js` pools by `segment_signature`; `viewer/views/aggregate-view.js` renders the segment table. |
| Schema | `shared/SCHEMA.md` documents the segment-shape `automation_candidates`, the new `segments` array, and the new `segment_signature`-scoped `analysis_overrides[]` entry. |

## Verification

1. Python suite: `python -m pytest normalization/test/` — segment-detection
   unit tests, plus the updated PDD export.
2. Viewer suite: `cd viewer && npm test` — the aggregate-analysis tests pin
   the new pooled shape.
3. Real-run harness against `sessions/example-aggregate/sess-2026-0514-0900`
   (the 4-case CRM-lookup example): the Analysis tab should show a small
   number of named segments (not dozens of per-click rows), and the PDD §4
   should read as a narrative recommendation.

## Action items

1. [x] Build `analysis_segments.py` and re-aim `analysis_automation.py` at it.
2. [x] Drop the per-step automation flag from §3.5 + Analysis view + report-md
   rendering (it stays a schema field for the App-Vocab layer).
3. [x] Update `shared/SCHEMA.md`, `analysis_overrides[]` shape, and the
   Compare-Sessions pooling.
4. [x] Bump `analysis.json.meta.heuristic_version` to 2.
5. [x] Update test suites + add CHANGELOG `[Unreleased]` entry.
