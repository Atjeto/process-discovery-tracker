# Viewer — Timeline Subsystem

> **Deep reference.** The timeline was the original refactor target. Phase 1 of
> ADR-0003 extracted the shared core; Phase 3 moved the Flow timeline into its
> view module. Read [VIEWER.md](./VIEWER.md) first for the surrounding
> architecture.

## The shared core

The viewer renders a horizontal time-band strip in three places — the Flow
timeline, the Steps mini-timeline, and the Phases mini-timeline. They are **no
longer three separately written renderers**: tick maths, axis-label formatting,
position mapping, lane packing, and band/axis DOM construction all live once, in
[`timeline/timeline-core.js`](../../viewer/timeline/timeline-core.js):

| Export | Responsibility |
|---|---|
| `timeToXPct(tMs, startMs, spanMs)` | Map a timestamp to a percent X position |
| `formatAxisLabel(tMs, intervalMs)` | Wall-clock axis label at the right precision |
| `chooseTicks(startMs, endMs, targetCount)` | Pick tick interval + positions |
| `packLanes(items, opts)` | Sweep-line lane assignment for overlapping bands |
| `renderBand(host, spec)` / `renderAxis(host, ticks)` | Band / axis DOM primitives |
| `renderMiniTimeline(host, opts)` | Whole mini-timeline render (lanes + axis) |

`timeline-core.js` is a CommonJS module with **pure, unit-tested** layout maths
([`timeline/timeline-core.test.js`](../../viewer/timeline/timeline-core.test.js),
`npm test`). A fix to tick spacing or lane packing now lands once and reaches all
three timelines — the mechanism behind the old recurring "fixed it here, still
broken there" regressions is gone.

## The three timelines today

| | Flow timeline | Steps mini-timeline | Phases mini-timeline |
|---|---|---|---|
| Entry point | `renderTimeline()` | `renderStepTimeline()` | `renderPhaseTimeline()` |
| File | [`views/flow-view.js`](../../viewer/views/flow-view.js) | [`step-editor.js`](../../viewer/step-editor.js) | [`phase-editor.js`](../../viewer/phase-editor.js) |
| Core use | `chooseTicks` + `packLanes`; builds its own 9-lane stack | `TimelineCore.renderMiniTimeline` | `TimelineCore.renderMiniTimeline` |
| Host element | `#timeline` inside `#timeline-scroll` | `#timeline-steps` inside `.mini-timeline-scroll` | `#timeline-phases` inside `.mini-timeline-scroll` |
| Zoom state | `State.zoomFactor` | `State.stepZoom` | `State.phaseZoom` |
| Height / resize | `--timeline-height` (`#resize-timeline`) | `--mini-timeline-height` | `--mini-timeline-height` |

The Steps and Phases mini-timelines are thin: each gathers its lane items, then
hands them to `TimelineCore.renderMiniTimeline`, which does lane packing, the
axis, and band DOM. The Flow timeline is richer — it keeps its own lane-stack
assembly because of the optional lanes below — but still draws ticks via
`chooseTicks` and packs case lanes via `packLanes`.

## The Flow timeline — `renderTimeline()` (`flow-view.js`)

A 9-lane stack, each optional lane toggleable via the Lanes menu
(`getLaneToggles()`, persisted to `pdt.timelineLanes`):

```
tick labels        (ticksH 20)   wall-clock HH:MM:SS, via chooseTicks
activity bands     (activityH 60) per-app coloured runs  ← idle bands,
                                                            marker bars,
                                                            screenshot dots
                                                            all overlay here
density histogram  (12)          ~120-bucket event-count strip
window-title runs  (14)          one band per (app,title) run
per-step lane      (16)          step bands, click → Steps view
note lane          (18)          numbered note dots
case lanes         (22 each)     packLanes-packed, one row per concurrent case
playhead           (overlay)     1px line synced to the <video>
```

Lane tops are computed as a running sum of fixed pixel heights;
`host.style.minHeight` is set to the total. `layoutCaseLanes()` (in
`flow-view.js`) walks the marker stream into closed/dangling cases and delegates
lane assignment to `TimelineCore.packLanes`.

## Zoom, scroll, and persistence

- **Flow zoom** — `State.zoomFactor`. `#btn-zoom-in/out/reset` multiply by 1.5 /
  divide by 1.5 (floor 1) / reset to 1, then `renderTimeline()`. Zoom is applied
  as `host.style.width = (100 * zoomFactor) + "%"`.
- **Mini-timeline zoom** — `State.stepZoom` / `State.phaseZoom`, wired by
  `bindMiniTimelineZoom()` in `renderer.js` to the per-view zoom buttons; same
  1.5× contract.
- **Persistence** — `persistTimelineForCurrent()` / `restoreTimelineForCurrent()`
  (`flow-view.js`) store `{ zoomFactor, scrollLeft, ts }` per `sessionFolder` in
  the single `localStorage` key `pdt.timelineState`. Scroll writes are throttled
  250 ms (`_wireTimelineScrollPersist`). The mini-timelines do **not** persist
  zoom.

## Minimap, playhead, range selection (Flow only)

All three live in `flow-view.js`:

- **Minimap** — `renderMinimap()` builds `#timeline-minimap`: compressed activity
  bands plus a `.tl-mm-viewport` rectangle. `syncMinimapViewport()` keeps the
  rectangle aligned to `#timeline-scroll`; a `wireMinimap()` IIFE handles
  click-to-jump and viewport-drag.
- **Playhead** — created inside `renderTimeline()` as `#tl-playhead`, positioned
  by `positionPlayhead()` on every `<video>` `timeupdate`, using the OBS / video
  start timestamp (`videoStartTs()`).
- **Range selection** — `installRangeSelection()`: Shift-drag on the `#timeline`
  background sets `State.selectionRange`; `renderSelectionStats()` draws a stats
  card. Wired once via a `host._pdtSelWired` flag.

## Resize handles

[`layout-controls.js`](../../viewer/layout-controls.js) (a CommonJS module that
self-initialises at `require()` time) owns all drag-resize:

| Handle id | CSS variable | Min–Max–Default | Drives |
|---|---|---|---|
| `#resize-timeline` | `--timeline-height` | 80–360–160 | Flow `.timeline-scroll` height |
| `#resize-steps-timeline` | `--mini-timeline-height` | 56–260–120 | Steps strip height |
| `#resize-phases-timeline` | `--mini-timeline-height` | 56–260–120 | Phases strip height (shared var) |
| `#resize-video` | `--video-width` | 240–900–420 | video pane width |

Sizes persist to `pdt.timelineHeight`, `pdt.miniTimelineHeight`, `pdt.videoWidth`.
The mini-timeline `.timeline` element fills its strip via `height:100%` plus a
`minHeight` floor, and lane bands use `calc()` so resizing reflows with no JS
re-render.

## Render triggers

| Trigger | Re-renders |
|---|---|
| Session load (`loadSessionIntoView`) | all three (whichever level is visible) |
| `applyLevel()` view switch | the incoming level's timeline |
| Zoom button | that level's timeline |
| Annotation edit | the `timeline` state topic → `renderTimeline()` (targeted, in place) |
| Lanes menu toggle | `renderTimeline()` |
| Window resize | *(none — the timelines do not re-render on window resize)* |
