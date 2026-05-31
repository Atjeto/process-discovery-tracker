# Viewer — Timeline Subsystem

> **Deep reference.** The timeline was the original refactor target. ADR-0003
> Phase 1 extracted the shared core and migrated all three timelines — Steps,
> Phases, and (in commit `faed9f6`) Flow — onto it; Phase 3 moved the Flow
> timeline into its view module. Read [VIEWER.md](./VIEWER.md) first for the
> surrounding architecture.

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
| `layoutLaneStack(lanes)` / `renderLaneStack(host, lanes, opts)` | Lay out and render a stack of lane plugins (`{ key, height, gapBefore, render }`) — used by the Flow timeline |

`timeline-core.js` is a CommonJS module with **pure, unit-tested** layout maths
([`timeline/timeline-core.test.js`](../../viewer/timeline/timeline-core.test.js),
`npm test`). A fix to tick spacing or lane packing now lands once and reaches all
three timelines — the mechanism behind the old recurring "fixed it here, still
broken there" regressions is gone.

## The three timelines today

| | Flow timeline | Steps mini-timeline | Phases mini-timeline |
|---|---|---|---|
| Entry point | `renderTimeline()` | `renderStepTimeline()` | `renderPhaseTimeline()` |
| File | [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) | [`step-editor.js`](../../viewer/step-editor.js) | [`phase-editor.js`](../../viewer/phase-editor.js) |
| Core use | `TimelineCore.renderLaneStack` with lane plugins | `TimelineCore.renderMiniTimeline` | `TimelineCore.renderMiniTimeline` |
| Host element | `#timeline` inside `#timeline-scroll` | `#timeline-steps` inside `.mini-timeline-scroll` | `#timeline-phases` inside `.mini-timeline-scroll` |
| Zoom state | `State.zoomFactor` | `State.stepZoom` | `State.phaseZoom` |
| Height / resize | `--timeline-height` (`#resize-timeline`) | `--mini-timeline-height` | `--mini-timeline-height` |

The Steps and Phases mini-timelines are thin: each gathers its lane items, then
hands them to `TimelineCore.renderMiniTimeline`, which does lane packing, the
axis, and band DOM. The Flow timeline is richer — it has the optional lanes
below — but is also a caller of the core: it builds an array of lane plugins and
hands them to `TimelineCore.renderLaneStack` (commit `faed9f6` completed this
migration — ADR-0003 items 4-5).

## The Flow timeline — `renderTimeline()` (`flow-view-timeline.js`)

`renderTimeline()` builds an ordered array of **lane plugins** — each an object
`{ key, height, gapBefore, render(host, ctx) }` — and hands it to
`TimelineCore.renderLaneStack`, which lays the lanes out (running-sum tops, total
`minHeight`) and calls each lane's `render`. The lane stack, top to bottom:

```
tick labels        wall-clock HH:MM:SS axis, via chooseTicks
case header        labelled lane of concurrent-case bands (packLanes-packed)
activity bands     per-app coloured runs; idle bands, real marker bars, and
                   dashed suggested-marker bars overlay here
screenshot rail    dedicated rail of screenshot marks
density histogram  optional — ~120-bucket event-count strip
window-title runs  optional — one band per (app, value-free title) run
per-step lane      optional — step bands rolled up to the current Grain
                   notch, click → Steps view
note lane          optional — numbered note dots
playhead           overlay — 1px line synced to the <video>
```

The four optional lanes (density / window-title / per-step / note) toggle via the
Lanes menu (`getLaneToggles()`, persisted to `pdt.timelineLanes`) — they are
simply omitted from the lane array when off. `layoutCaseLanes()` walks the marker
stream into closed/dangling cases and delegates row assignment to
`TimelineCore.packLanes`.

**Suggested markers** ([ADR-0017](../adr/0017-suggested-markers.md)) ride the same
marker overlay: when the markers lane is on, `annotations.marker_suggestions[]`
render as dashed `.tl-marker.tl-suggested` bars (a higher-confidence
`.tl-suggested-hi` variant for `score ≥ 0.75`), filtered to drop any suggestion the
analyst has already Accepted. They are not a separate toggle — they share the
real markers' visibility — and the side-panel markers list carries the matching
Accept/Dismiss rows.

**Grain and the step lane** ([ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)).
The per-step lane rolls up to the shared **Grain** notch (`State.grain`: element /
screen / app / phase / case, default screen) — one band per consecutive run of
steps sharing that notch's key, with a fold count; the `element` notch reproduces
every raw step band. The single Grain slider in the view-mode bar drives this lane
in lock-step with the Steps list and the Map; it is a *view-time* control, so a
notch change re-renders the lane without re-normalizing — raw `events.jsonl` is
untouched. The `window-title` lane's grouping key is **value-free** (record ids
stripped via `screenType` / `shared/screen-label-patterns.json`), so one logical
screen is one band across cases.

The case header *above* the activity bands and the dedicated screenshot rail
*below* them are the Warm Editorial lane re-order — see
[ADR-0004](../adr/0004-flow-timeline-steps-rework.md).

## Zoom, scroll, and persistence

- **Flow zoom** — `State.zoomFactor`. `#btn-zoom-in/out/reset` multiply by 1.5 /
  divide by 1.5 (floor 1) / reset to 1, then `renderTimeline()`. Zoom is applied
  as `host.style.width = (100 * zoomFactor) + "%"`.
- **Mini-timeline zoom** — `State.stepZoom` / `State.phaseZoom`, wired by
  `bindMiniTimelineZoom()` in `renderer.js` to the per-view zoom buttons; same
  1.5× contract.
- **Persistence** — `persistTimelineForCurrent()` / `restoreTimelineForCurrent()`
  (`flow-view-timeline.js`) store `{ zoomFactor, scrollLeft, ts }` per
  `sessionFolder` in the single `localStorage` key `pdt.timelineState`. Scroll
  writes are throttled 250 ms (`_wireTimelineScrollPersist`). The mini-timelines
  do **not** persist zoom.

## Minimap, playhead, range selection (Flow only)

The minimap lives in `flow-view-timeline.js` with `renderTimeline`; the playhead
is created by `renderTimeline` but positioned from `flow-view-video.js`; range
selection stays in `flow-view.js` (it pairs with the queue-from-selection /
exclude-range marker actions):

- **Minimap** (`flow-view-timeline.js`) — `renderMinimap()` builds
  `#timeline-minimap`: compressed activity bands plus a `.tl-mm-viewport`
  rectangle. `syncMinimapViewport()` keeps the rectangle aligned to
  `#timeline-scroll`; a `wireMinimap()` IIFE handles click-to-jump and
  viewport-drag.
- **Playhead** — created inside `renderTimeline()` as `#tl-playhead`
  (`flow-view-timeline.js`), positioned by `positionPlayhead()`
  (`flow-view-video.js`) on every `<video>` `timeupdate`, using the OBS / video
  start timestamp (`videoStartTs()`).
- **Range selection** (`flow-view.js`) — `installRangeSelection()`: Shift-drag on
  the `#timeline` background sets `State.selectionRange`; `renderSelectionStats()`
  draws a stats card. Wired once via a `host._pdtSelWired` flag.

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
