# Viewer — Timeline Subsystem

> **Deep reference.** The timeline is where regressions keep recurring and is the
> primary refactor target. Read [VIEWER.md](./VIEWER.md) first for the surrounding
> architecture. Structural problems are catalogued in
> [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).

## The headline: three timeline implementations

The viewer renders a horizontal time-band strip in three places, and each is a
**separately written renderer**:

| | Flow timeline | Steps mini-timeline | Phases mini-timeline |
|---|---|---|---|
| Entry point | `renderTimeline()` | `renderStepTimeline()` | `renderPhaseTimeline()` |
| File | [`renderer.js`](../../viewer/renderer.js) ~2943–3375 | [`step-editor.js:231`](../../viewer/step-editor.js) | [`phase-editor.js:166`](../../viewer/phase-editor.js) |
| Size | ~432 lines (one function) | ~90 lines | ~100 lines |
| Host element | `#timeline` inside `#timeline-scroll` | `#timeline-steps` inside `.mini-timeline-scroll` | `#timeline-phases` inside `.mini-timeline-scroll` |
| Zoom variable | `zoomFactor` | `stepZoom` | `phaseZoom` |
| Height / resize | `--timeline-height` (`#resize-timeline`) | `--mini-timeline-height` (`#resize-steps-timeline`) | `--mini-timeline-height` (`#resize-phases-timeline`) |

They are not variants behind a shared core — they are three codebases that happen
to draw similar things. This is the central finding for the refactor.

## What each renders

**Flow timeline** — `renderTimeline()`. A 9-lane stack, each lane toggleable via
the Lanes menu (`getLaneToggles()`, persisted to `pdt.timelineLanes`):

```
tick labels        (ticksH 20)   wall-clock HH:MM:SS
activity bands     (activityH 60) per-app coloured runs  ← idle bands,
                                                            marker bars,
                                                            screenshot dots
                                                            all overlay here
density histogram  (12)          ~120-bucket event-count strip
window-title runs  (14)          one band per (app,title) run
per-step lane      (16)          step bands, click → Steps view
note lane          (18)          numbered note dots
case lanes         (22 each)     sweep-line packed, one row per concurrent case
playhead           (overlay)     1px line synced to the <video>
```

Lane tops are computed as a running sum of fixed pixel heights; `host.style.minHeight`
is set to the total. Helpers: `layoutCaseLanes()` (`renderer.js:3399`, sweep-line
case packing) and `pickTickStep()` (`renderer.js:3446`).

**Steps / Phases mini-timelines** — a single horizontal band row (lane-packed up
to 4 lanes for steps, 3 for phases) plus a time axis pinned to the bottom. Far
simpler: no density, cases, markers, screenshots, minimap, or playhead. The lane
bands are sized with CSS `calc()` so they scale to fill the drag-resizable strip
height (`--mini-timeline-height`) without a re-render.

## Duplicated logic (refactor targets)

Verified copies of the same logic:

| Logic | Flow | Steps | Phases |
|---|---|---|---|
| Tick-interval choice | `pickTickStep` (`renderer.js:3446`) — seconds-candidate list | `pickTickIntervalMs` (`step-editor.js:172`) | `pickTickIntervalMs` (`phase-editor.js:151`) |
| Axis label formatting | `formatTickLabel` (inline) | `fmtAxisLabel` (`step-editor.js:184`) | `fmtAxisLabel` (`phase-editor.js:159`) |
| Lane packing | `layoutCaseLanes` (`renderer.js:3399`) | `assignLanes` (`step-editor.js:203`) | inline loop (`phase-editor.js` ~188–197) |
| `escapeHtml` / `escapeAttr` | (`renderer.js` has its own) | `step-editor.js:4` | `phase-editor.js:4` |
| Band DOM construction | inline per lane | inline | inline |

`pickTickIntervalMs` and `fmtAxisLabel` are **byte-near-identical** between
`step-editor.js` and `phase-editor.js`. `pickTickStep` in `renderer.js` solves the
same problem with a *different* design — so the tick chooser exists in three forms,
two of them accidental copies and one a divergent reimplementation. Lane-packing is
the same algorithm written twice (a named `assignLanes` function vs. an inline loop).

**Consequence:** a fix to tick spacing, lane packing, or band layout in one
timeline does not reach the other two. This is the mechanism behind the recurring
"fixed it here, still broken there" regressions.

## Zoom, scroll, and persistence

- **Flow zoom** — `zoomFactor` (module-level in `renderer.js`). `#btn-zoom-in/out/reset`
  multiply by 1.5 / divide by 1.5 (floor 1) / reset to 1, then call
  `renderTimeline()`. Zoom is applied as `host.style.width = (100 * zoomFactor) + "%"`.
- **Mini-timeline zoom** — `stepZoom` / `phaseZoom`, wired by `bindMiniTimelineZoom()`
  (`renderer.js` ~958) to the per-view zoom buttons; same 1.5× contract.
- **Persistence** — `persistTimelineForCurrent()` / `restoreTimelineForCurrent()`
  store `{ zoomFactor, scrollLeft, ts }` per `sessionFolder` in the single
  `localStorage` key `pdt.timelineState`. Scroll writes are throttled 250 ms
  (`_wireTimelineScrollPersist`). The mini-timelines do **not** persist zoom.

Three zoom variables, two persistence behaviours, no shared contract.

## Minimap, playhead, range selection (Flow only)

- **Minimap** — `renderMinimap()` builds `#timeline-minimap`: compressed activity
  bands plus a `.tl-mm-viewport` rectangle. `syncMinimapViewport()` keeps the
  rectangle aligned to `#timeline-scroll`; a `wireMinimap()` IIFE handles
  click-to-jump and viewport-drag.
- **Playhead** — created inside `renderTimeline()` as `#tl-playhead`
  (`renderer.js:3341`), positioned by `positionPlayhead()` (`renderer.js:3377`) on
  every `<video>` `timeupdate`, using the OBS/video start timestamp.
- **Range selection** — `installRangeSelection()` (`renderer.js:2567`): Shift-drag
  on the `#timeline` background sets `_selectionRange`; `renderSelectionStats()`
  draws a stats card. Wired once via a `host._pdtSelWired` flag.

## Resize handles

[`layout-controls.js`](../../viewer/layout-controls.js) (self-initialising IIFE,
exposes `window.PdtLayout`) owns all drag-resize:

| Handle id | CSS variable | Min–Max–Default | Drives |
|---|---|---|---|
| `#resize-timeline` | `--timeline-height` | 80–360–160 | Flow `.timeline-scroll` height |
| `#resize-steps-timeline` | `--mini-timeline-height` | 56–260–120 | Steps strip height |
| `#resize-phases-timeline` | `--mini-timeline-height` | 56–260–120 | Phases strip height (shared var) |
| `#resize-video` | `--video-width` | 240–900–420 | video pane width |

Sizes persist to `pdt.timelineHeight`, `pdt.miniTimelineHeight`, `pdt.videoWidth`.
The mini-timeline `.timeline` element fills its strip via `height:100%` plus a
`minHeight` floor, and lane bands use `calc()` so resizing reflows with no JS
re-render — see the layout comments in `step-editor.js` / `phase-editor.js`.

## Render triggers

| Trigger | Re-renders |
|---|---|
| Session load (`loadSessionIntoView`) | all three (whichever level is visible) |
| `setLevel()` view switch | the incoming level's timeline |
| Zoom button | that level's timeline |
| Annotation edit | full session reload → all |
| Lanes menu toggle | `renderTimeline()` |
| Window resize | *(none — the timelines do not re-render on window resize)* |

## The unification opportunity

A refactor would extract a single timeline module with: one tick-interval +
axis-label helper, one lane-packing function, one band-construction primitive, and
one zoom/scroll/persist contract — consumed by Flow, Steps, and Phases alike. The
Flow timeline's extra lanes (density, cases, markers, …) become optional lane
plugins rather than inline blocks in a 432-line function. Detailed prioritisation
and sequencing live in [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md); this
document is the map of what exists today.
