# ADR-0004: Flow Timeline + Steps View Rework (Warm Editorial)

**Status:** Accepted — shipped in v0.4.0
**Date:** 2026-05-16
**Deciders:** Project owner

## Context

The Warm Editorial redesign (the light-theme replacement of the
"stratified-dark" viewer theme) initially **re-skinned** the Flow
timeline and Steps view rather than rebuilding them: activity bands kept
the old muted dark-theme app palette, screenshots were band-edge dots,
the case lane sat cramped at the bottom, and the Steps list looked
unfinished.

A rebuild was needed, but the timeline had just been through the
ADR-0003 refactor, so the change was reviewed for blast radius first.

**Finding.** [`viewer/timeline/timeline-core.js`](../../viewer/timeline/timeline-core.js)
is a stable, unit-tested toolkit; the Steps and Phases mini-timelines
render through its `renderMiniTimeline`. The **Flow** timeline does not —
`renderTimeline()` in [`flow-view.js`](../../viewer/views/flow-view.js)
is a ~430-line custom function that borrows only
`TimelineCore.chooseTicks`. ADR-0003 items 4-5 (migrate Flow onto the
core; lane plugins) were never completed. So reworking the Flow timeline
is contained to `renderTimeline()` — it cannot reach the shared core or
the other timelines.

## Decision

Rework `renderTimeline()` **in place**; do **not** bundle in the
ADR-0003 lane-plugin refactor.

- Replace the muted app palette with a vivid, distinct light-theme
  palette — each colour deep enough that the white band labels clear a
  comfortable contrast margin.
- Re-order the lane stack: case bands become a labelled header lane
  *above* the activity bands; screenshots get a dedicated capture rail
  *below* them, replacing the band-edge dots. The optional lanes
  (density / titles / per-step / notes) and the Lanes menu are
  unchanged, off by default.
- Rework the Steps list + detail — compact durations in the list,
  Duration / Start / End stat tiles in the detail pane, card styling.

## Options Considered

| Option | Assessment |
|---|---|
| A — Full lane-plugin refactor + rework | Correct long-term, but bundles a structural refactor with a visual one; a regression would be un-bisectable. Rejected. |
| B — In-place rework of `renderTimeline()` *(chosen)* | Contained, verifiable by eye, leaves the shared core untouched. |
| C — CSS-only re-skin | Already attempted; cannot fix the palette (JS data) or the lane order / screenshot rail. Insufficient. |

## Consequences

**Easier:**
- The Flow timeline reads like the design — vivid bands, a labelled case
  header, a real screenshot rail.

**Unchanged (by design):**
- `timeline-core.js` and the Steps/Phases mini-timelines. The
  `timeline-core` unit tests passing after the change is the proof.

**Resolved afterwards:**
- ADR-0003 items 4-5 — migrating `renderTimeline()` onto `timeline-core` as
  proper lane plugins — were completed in commit `faed9f6` (ADR-0003 Phase 1).
  When this ADR was written they were still open and deliberately not bundled
  into this rework; they have since landed as their own focused pass.

## Action Items

1. [x] Vivid app palette in `flow-view.js`.
2. [x] Re-order lanes + dedicated screenshot rail in `renderTimeline()`.
3. [x] Steps list + detail rework.
4. [x] ADR-0003 items 4-5 — lane-plugin refactor of `renderTimeline()` (done separately in commit `faed9f6`).
