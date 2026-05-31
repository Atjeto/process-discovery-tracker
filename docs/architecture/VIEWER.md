# Viewer Architecture

> **Deep reference.** The viewer's structural refactor (ADR-0003) is **complete** —
> the renderer is now a graph of CommonJS modules. This document and
> [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md) are the maps for that structure. The
> design-system pass (ADR-0003 Phase 4) was superseded by the Warm Editorial
> redesign — see [ADR-0004](../adr/0004-flow-timeline-steps-rework.md) and
> [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## Contents

1. [Process model](#1-process-model)
2. [Module map](#2-module-map)
3. [The module graph](#3-the-module-graph)
4. [IPC surface](#4-ipc-surface)
5. [View system](#5-view-system)
6. [State model](#6-state-model)
7. [Render pipeline](#7-render-pipeline)
8. [Annotations editing & undo](#8-annotations-editing--undo)
9. [Compare Sessions (Aggregate) view](#9-compare-sessions-aggregate-view)
10. [Project layer](#10-project-layer)

## 1. Process model

The Viewer is an Electron app: one **main process** ([`main.js`](../../viewer/main.js))
and one **renderer** ([`index.html`](../../viewer/index.html) + a graph of
`require()`d modules).

- **One window**, 1400×900, created in `createMainWindow()`. A `--session=<path>`
  argv entry is parsed at startup and pushed to the renderer as
  `viewer:openInitialSession`.
- `webPreferences` deliberately set `nodeIntegration: true`, `contextIsolation: false`.
  This is why the renderer scripts call `require("electron")`, `require("node:fs")`,
  and `require("./<module>.js")` directly. The risk is mitigated by `webSecurity`,
  a deny-all `setWindowOpenHandler`, and a `will-navigate` guard.
- The main process is thin: window lifecycle, file dialogs, the normalization
  subprocess, and file I/O. **All UI logic lives in the renderer.**

## 2. Module map

`index.html` loads exactly **five `<script>` tags**: the four vendored libraries
(cytoscape, dagre, cytoscape-dagre, bpmn-js — consumed as globals) and the single
`renderer.js` entry. Everything else is reached through `renderer.js`'s
`require()` graph — there is no bundler (ADR-0003: the renderer already used
CommonJS, so real modules need no build step).

**Entry + cross-cutting infrastructure** (flat in `viewer/`):

| File | Role |
|---|---|
| `renderer.js` | **Thin wiring entry** — tab routing, the session-view level switcher (Flow / Steps / Phases / **Map** / **Analysis**), the state-bus subscriptions, global keyboard shortcuts, the project menu, export buttons, boot. Owns the lazily-created Session-view map controller (`_sessionMapCtrl`). Wires modules together; holds no view logic. |
| `state.js` | Central state store + topic pub/sub bus + undo/redo stacks (Phase 2). |
| `session.js` | Annotations persistence + the undo/redo round-trip (Phase 3). |
| `ipc.js` | Typed wrappers over every `viewer:*` IPC channel (Phase 3). |
| `dom.js` | DOM helpers: `$`, `$$`, `escapeHtml`, `formatDuration`, `fillTable`, `toast`, … |
| `modals.js` | `promptModal`, `confirmModal`, help-modal open/close. |
| `recent.js` | Recent-sessions localStorage + bundled examples. |
| `project.js` | Project-file layer — capture/validate, recents (collector-callback pattern). |
| `timeline/timeline-core.js` | Shared timeline core: lane packing, tick choice, band primitives (Phase 1). |

**Per-view modules** (`viewer/views/`):

| File | Surface |
|---|---|
| `views/flow-view.js` | Flow level — session load + analyze, range selection, event table, case scope, command-palette provider, session pills/summary, the marker-insert menu + queue actions. The hub; it `require()`s the five `flow-view-*` helper modules below and re-exports their public entry points so its surface (`renderTimeline`, `seekToTimestamp`, `renderMarkersList`, …) is unchanged for `renderer.js`/`steps-view.js`/`analysis-view.js`. |
| `views/flow-view-apps.js` | Pure per-app colour (`appColor`), display label (`appLabel`), and the timeline legend (`renderLegend`). No DOM/state coupling back into the Flow view. |
| `views/flow-view-timeline.js` | The Flow timeline subsystem — `renderTimeline` (the lane stack: ticks / cases / activity+idle+markers+suggested / screenshots / density / titles / steps / notes via `TimelineCore.renderLaneStack`), its lane helpers (`layoutCaseLanes` / `isUserActivityEvent` / `monitorBadgeFor`), the minimap + middle-drag-pan, the lane-visibility toggles, per-session zoom/scroll persistence, and the timeline summary. `require()`s apps/video/markers/screenshots one-way; the flow-view glue its lanes call (`currentScopeRange`, `showMarkerInsertMenu`, `showCaseContextMenu`, `activateAnnoTab`) is injected via `initTimeline()`. flow-view re-exports `renderTimeline` and feeds it to `initMarkers()`. |
| `views/flow-view-video.js` | The video↔timeline bridge — video-start derivation, video↔session-time conversion, the playhead, seeking (+ the no-video playhead fallback), watch-a-step playback, and the interactive video re-sync. Self-wires `#video` timeupdate + `#btn-sync-video`; `loadSessionIntoView` injected via `initVideo()`. Required by flow-view + the screenshots/markers modules (`seekToTimestamp`). |
| `views/flow-view-screenshots.js` | The screenshot surfaces — side-panel thumbnail grid, full-pane gallery (arrow-key stepping, auto-advance, aHash near-duplicate folding), star-for-report, the lazy hover thumb, and the guarded open-in-OS-viewer path. Owns its own state; self-wires `#btn-open-gallery`; `require()`s `flow-view-video.js`. |
| `views/flow-view-markers.js` | The markers side-panel + unbracketed-session recovery — marker-edit resolution (effective label/timestamp/deleted), the markers list, **suggested markers** (dashed `.tl-suggested` bars + Accept/Dismiss rows, [ADR-0017](../adr/0017-suggested-markers.md)), the **anchor-candidates** panel ([ADR-0018](../adr/0018-anchor-candidates.md)), and per-marker adjust/delete/rename. flow-view consumes `effectiveLabel`/`visibleMarkerSuggestions` (the timeline overlay); `renderTimeline` injected via `initMarkers()`. |
| `views/steps-view.js` | Steps level — step list/detail, step CRUD, the **Flat / Aligned** reading toggle (consensus backbone, curate-one→propagate, exceptions — [ADR-0015](../adr/0015-intra-session-repetition-alignment.md)), the ignored-apps dialog. |
| `views/phases-view.js` | Phases level — phase list/detail, phase CRUD, grouping suggestions. |
| `views/analysis-view.js` | Analysis level — per-session heuristic waste / time-study / automation / efficiency findings ([ADR-0008](../adr/0008-build-the-analysis-layer.md)), plus the €-ROI panel (§11c) rendering `analysis.json`'s `roi` band with the `roi_inputs` analyst-assumption + per-segment "tune" forms (persisted via the undo path; re-analyze recomputes the €). |
| `views/aggregate-view.js` | Compare Sessions — the notation × level process-map matrix, drill-down scoping, cross-session statistics + analysis, exports. |
| `views/template-view.js` | Process Template tab — version compare, exemplar match. |
| `views/vocab-view.js` | App Library (Vocabulary editor) tab. Hosts **"Discover from window"** ([ADR-0025](../adr/0025-in-app-vocabulary-discovery.md)): point at a prepared app window → the recorder snapshots its live UI → the volatility picker + `bootstrap_from_snapshot` return a stable-signature skeleton merged into the editor. Each discovered entry shows *why* its signature was picked (`identity_source` + ADR-0023 confidence, and any rejected volatile id); re-discovery **merges** (analyst-named entries are preserved, never overwritten); discovery-provenance fields are stripped on save. |
| `views/identity-picker.js` | The per-step **Match rules** picker modal (Process Template tab) — composes a step's match rules from the App Library, a coarse app/window rule, or an interaction lifted from a captured session. |

**Feature modules** — all CommonJS `module.exports` since Phase 3 Stage A (the
former `window.Pdt*` globals were converted; the globals are gone):

| File | Exports | Role |
|---|---|---|
| `charts.js` | `renderBarChart`, `fmtDurationS` | Inline-SVG bar charts |
| `dfg-viewer.js` | `render`, `fit`, `zoomIn/Out`, `getZoom`, `exportSvg` | Directly-Follows Graph (cytoscape + dagre); persists dragged layout per node set. `exportSvg` is a **hand-written cytoscape→SVG serializer** (cytoscape has no native SVG export) — emits nodes/edges/labels as SVG primitives, driving the "Process map SVG" export |
| `bpmn-viewer.js` | `render`, `fit`, `exportSvg` | BPMN 2.0 diagram (bpmn-js Modeler — scroll-zoom, drag-pan, draggable boxes saved back to the `.bpmn`) |
| `process-map-levels.js` | `buildAnnotationDfg`, `rollUpSteps`, `grainKey`/`grainLabel`, `resolveStepGrainKeys`, `processLabel`, `dropRareEdges` | Pure DFG + view-time grain roll-up from annotations (the `element ⊂ screen ⊂ app ⊂ phase ⊂ case` ladder), value-free step label, rare-path thinning — unit-tested ([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md), [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)) |
| `map-controller.js` | `createMapController` | The shared process-map UI controller (notation × level matrix, drill-down scoping, rare-path slider, BPMN/DFG render + zoom). Extracted from the Aggregate view so the **same** controller mounts in both Compare Sessions and the Session view's in-view **Map** level — each caller passes its own host elements + a session-set provider |
| `recognition.js` | `recognize`, `isChrome`, … | Semantic interaction category from documented platform/framework signatures (`shared/recognition-patterns.json`); twin of the Python `recognition.py` ([ADR-0011](../adr/0011-platform-recognition-layer.md)) |
| `step-alignment.js` | `alignCases`, `alignSteps`, `groupForStep`, `representativeCuration`, … | Intra-session repetition alignment ([ADR-0015](../adr/0015-intra-session-repetition-alignment.md)). `alignCases` builds the consensus **backbone** across detected cases (Needleman–Wunsch over value-free `process_label` tokens) with per-position frequency + exceptions — behind the Steps view's Aligned reading; `alignSteps`/`groupForStep` are the older signature-based repeat grouping (per-row badges + "Apply to N repeats"). Pure, fuzz-tested |
| `analysis-aggregate.js` | `aggregateAnalysis` | Pure cross-session rollup of per-session `analysis.json` (time study / per-worker / automation / efficiency) for the Compare-Sessions Analysis panel |
| `session-summary.js` | `summarize`, `detectDurationOutliers` | Pure per-session summary + duration-outlier detection |
| `theme.js` | `stepPalette`, `dfgStyleTokens`, … | Light/dark theme tokens + chart/DFG colour palettes |
| `report-md.js` | `buildSessionReport`, `buildAggregateReport` | Markdown report generation (Activity **and** Step statistics tables) |
| `report-html.js` | `generateFindingsReport` | Self-contained **HTML findings report** (Phase D) — process summary, inline process-map SVG, steps table, waste/automation/efficiency findings, notes, starred screenshots; opens in any browser, no external assets |
| `canonical-author.js` | (pure authoring helpers) | Pure functions for **authoring** Process Templates — the canonical step + match-rule shapes; shared by the Steps view and the Template tab, unit-testable (no DOM) |
| `step-editor.js` | `renderStepList`, `renderStepDetail`, `renderStepTimeline`, … | Steps list/detail + Steps mini-timeline |
| `phase-editor.js` | `renderPhaseList`, `renderPhaseDetail`, `renderPhaseTimeline` | Phases list/detail + Phases mini-timeline |
| `layout-controls.js` | (side-effect import) | Drag-resize handles + video modes; self-inits at `require()` time |
| `command-palette.js` | `open`, `close`, `toggle`, `setProvider` | Ctrl+K command palette |
| `python-runner.js` | `runNormalize`, `runDiscoverVocab`, `resolvePython`, … | Spawns the bundled Python pipeline (`require`d by `main.js`); `runDiscoverVocab` feeds a window snapshot to `normalization/discover_vocab.py` (ADR-0025) |
| `recorder-snapshot.js` | `snapshotWindow`, `resolveRecorderExe` | Drives the C# recorder's one-shot `snapshot` command for App-Library discovery (ADR-0025) — spawns the recorder, runs a two-pass UIA snapshot of the target window, resolves with the controls + window title. Transient; nothing written to disk |
| `main.js` | — | Electron main process (see §4) |

`step-editor.js` / `phase-editor.js` are the list/detail + mini-timeline
**widgets**; `views/steps-view.js` / `views/phases-view.js` are the
renderer-side orchestration that *calls* them — different files, different
layers.

## 3. The module graph

`renderer.js` `require()`s the infrastructure modules and the six view modules,
then wires them together. Modules never reach back into `renderer.js` by name:
cross-surface glue is **injected** at boot through an `init<Module>({...})` call,
passed as lazy arrow wrappers so load order does not matter. Examples:

```
renderer.js ─ initFlowView({ renderShortcutsOverlay, rerenderActiveLevel,
                             applyLevel, activateTab })
            ─ initSession({ renderAnnotations, renderSessionPills })
            ─ initStepsView({ ensureAnnoShape, persistAnnotations,
                              videoTimeToSessionTs, jumpToStepInFlow })
            ─ initPhasesView({ ensureAnnoShape, persistAnnotations,
                               activateAnnoTab })
            ─ initAggregateView({ onDrillToSession })
            ─ initRecent({ onOpenSession })
```

A module may also wire its own DOM controls at `require()` time — the document is
already parsed when `renderer.js` pulls it in (`flow-view.js`, `template-view.js`,
`layout-controls.js` all do this). Functions a sibling still calls are re-exported
and destructured by `renderer.js` so call sites stay unchanged (e.g.
`renderTimeline` / `renderMarkersList` from `flow-view.js` are wired into the
level switcher and the state bus).

The **same injection pattern is used one level down**, inside the Flow view:
`flow-view.js` `require()`s its five `flow-view-*` helpers and, where a helper
needs a function that lives back in the hub, injects it at boot rather than
`require()`ing the hub (which would cycle) — `initVideo({ loadSessionIntoView })`,
`initMarkers({ renderTimeline })`, and `initTimeline({ currentScopeRange,
showMarkerInsertMenu, showCaseContextMenu, activateAnnoTab })`. The helpers in
turn `require()` each other only one-way (`screenshots`→`video`,
`markers`→`video`, `timeline`→`apps`/`video`/`markers`/`screenshots`), so the
graph stays acyclic. `flow-view.js` re-exports the helpers' public entry points
(`seekToTimestamp`, `renderMarkersList`, `renderAnchorCandidates`,
`videoTimeToSessionTs`, `watchStep`, …) on its own surface, so `renderer.js` /
`steps-view.js` / `analysis-view.js` import them from `flow-view.js` exactly as
before.

`ipc.js` centralises the `viewer:*` channel strings: a typo'd channel is a
missing export, caught at the call site instead of failing silently at runtime.

## 4. IPC surface

`renderer.js` and the view modules talk to `main.js` over Electron IPC, always
through `ipc.js` — one typed async wrapper per channel over
`ipcRenderer.invoke("viewer:…")`, against `ipcMain.handle` in `main.js`:

| Group | Channels |
|---|---|
| Session load | `viewer:openSessionFolder`, `viewer:openMultipleSessions`, `viewer:loadSession`, `viewer:loadMultipleSessions` |
| Normalization | `viewer:runNormalize`, `viewer:runNormalizeExtended`, `viewer:testCanonicalMatch`, `viewer:bootstrapAppVocab`, `viewer:cancelNormalize` |
| Export / shell | `viewer:exportFile`, `viewer:saveSvgFile`, `viewer:revealFile`, `viewer:openExternal` |
| Canonical templates | `viewer:openCanonicalFile`, `viewer:saveCanonicalFile`, `viewer:listTemplateVersions`, `viewer:readTemplateFile` |
| App Vocabularies | `viewer:saveAppVocab`, `viewer:listAppVocabs`, `viewer:openVocabFile`, `viewer:readVocab`, `viewer:writeVocab`, `viewer:newVocabFile` |
| External video | `viewer:attachExternalVideo`, `viewer:saveExternalVideoSync` |
| Projects | `viewer:saveProjectAs`, `viewer:saveProject`, `viewer:openProject`, `viewer:loadProjectFile` |
| Annotations | `viewer:saveAnnotations` |

Main→renderer messages (`webContents.send`) are exposed by `ipc.js` as
`onOpenInitialSession(fn)` (startup `--session=`) and `onNormalizeLog(fn)`
(streamed normalization output).

`loadSessionData()` in `main.js` assembles the session object the renderer holds
(via `State.setSession`): `{ sessionFolder, manifest, events, stats, dfg,
annotations, obsSync, recordingPath, recordingAvailable, externalVideoOffsetMs }`.
All normalization IPC funnels through `runNormalize()` and shares one module-scope
kill handle, so `viewer:cancelNormalize` stops whichever run is in flight.

## 5. View system

The renderer has **four top-level surfaces** (containers in `index.html`):

| Container | Surface | Module |
|---|---|---|
| `#view-session` | One session — video + timeline + annotations | `views/flow-view.js` (+ steps/phases) |
| `#view-aggregate` | Compare Sessions — process maps, statistics, exports | `views/aggregate-view.js` |
| `#view-canonical` | Process Template editor | `views/template-view.js` |
| `#view-vocabularies` | App Library (App Vocabulary editor) | `views/vocab-view.js` |

Inside `#view-session` there are **five levels**, switched by the `.view-mode-btn`
buttons → `applyLevel(name)` in `renderer.js`:

| Level | Layout container | Render entry |
|---|---|---|
| `flow` | `#session-layout-flow` | `renderTimeline()` — `flow-view.js` |
| `steps` | `#session-layout-steps` | `renderStepsLevel()` — `steps-view.js` |
| `phases` | `#session-layout-phases` | `renderPhasesLevel()` — `phases-view.js` |
| `map` | `#session-layout-map` | `renderMapLevel()` — `renderer.js` (drives a lazily-created `map-controller.js` over the single focused session) |
| `analysis` | `#session-layout-analysis` | `renderAnalysisLevel()` — `analysis-view.js` |

The **Map** level (v0.18.0) puts the full interactive process map — the same
notation × level matrix as Compare Sessions — inline for one session, so an analyst
reaches a single session's map without entering the Aggregate view (the Aggregate
view also offers a one-click **"View map"** that opens this level for the focused
session). It is backed by the shared `map-controller.js` (above). Clicking an
activity node seeks the Flow timeline rather than opening a drill-to-session picker.

`applyLevel()` keeps the level in `state.js` (`State.getLevel`/`setLevel`),
toggles `display` on the `#session-layout-*` containers, and snapshots /
restores the outgoing and incoming levels' viewport (zoom + scroll fraction) via
`_viewportSnapshotForMode` / `_viewportApplyToMode`. The `MODE_VIEWPORT` table and
`LEVEL_RENDERERS` map in `renderer.js` replace what used to be a hand-written
3-way `if (currentLevel === …)` block repeated across the renderer.

## 6. State model

State lives in [`state.js`](../../viewer/state.js) — a single store with explicit
getters/setters and a topic pub/sub bus (no framework, no reactivity):

| State | Holds |
|---|---|
| `session` | the loaded session object (§4) |
| `aggregateSessions` | array of sessions for the Compare view |
| `level` | `"flow"` \| `"steps"` \| `"phases"` \| `"map"` \| `"analysis"` |
| `zoomFactor` / `stepZoom` / `phaseZoom` | per-timeline zoom |
| `caseScope` | case-id filter, or `""` for all |
| `selectedStepId`, `selectedPhaseId`, `multiSelectedStepIds` | editor selection |
| `canonicalState`, `vocabState`, `listFilters` | tab-local state |
| undo / redo stacks | annotation undo history (§8) |

`State.subscribe(topic, fn)` / `State.emit(topic)` / `State.batch(fn)` are the
change bus: an annotation edit emits the topics it touched and the subscribed
view re-renders itself.

**Persistence** is `localStorage`, all keys prefixed `pdt.`:

| Key | Written by | Holds |
|---|---|---|
| `pdt.recentSessions` | `recent.js` | recent session folders |
| `pdt.recentProjects` | `project.js` | recent project files |
| `pdt.timelineHeight`, `pdt.videoWidth`, `pdt.miniTimelineHeight` | `layout-controls.js` | drag-resized pane sizes |
| `pdt.timelineState` | `flow-view.js` | per-session timeline zoom + scroll (one key, a map) |
| `pdt.timelineLanes` | `flow-view.js` | which Flow-timeline lanes are toggled on |
| `pdt.shortcutsOverlayHidden` | `renderer.js` | dismiss state of the shortcuts card |

## 7. Render pipeline

**Load.** `loadSessionIntoView(folder)` in `flow-view.js`:

```
open folder → Ipc.loadSession() → State.setSession(result)
            → wire <video>
            → renderTimeline() · renderEventTable() · renderAnnotations()
              renderScreenshots() · renderMarkersList() · renderTimelineSummary()
              renderStepsLevel() · renderPhasesLevel() · updateProcessMapStatus()
              populateCaseScope() · restoreTimelineForCurrent() · installRangeSelection()
```

Every surface is re-rendered on load regardless of which level is visible.

**Edit.** Annotation edits do **not** trigger a full session reload (Phase 2
fixed this — issue S6). They route through `session.js`:

```
edit → persistAnnotations(annotations, label, topics)   (session.js)
     → saveAnnotationsWithUndo → Ipc.saveAnnotations()
     → State.emit(topic) for each touched topic
     → the subscribed view re-renders itself, in place
```

## 8. Annotations editing & undo

All step / phase / marker / note mutations funnel through `session.js`:

- `saveAnnotationsWithUndo(annotations, label)` snapshots the **previous**
  `annotations` onto the undo stack (in `state.js`) before writing.
- Undo / redo stacks are in-memory, capped, and each entry is pinned to a
  `sessionFolder`. `resetUndoStack()` runs on session switch.
- `performUndo()` / `performRedo()` write the snapshot back via
  `viewer:saveAnnotations`, then patch `session.annotations` **in place** and emit
  the change topics — no full reload, no scroll jump (issue S6).

Step CRUD (`splitStep`, `mergeStepWithNext`, `addManualStep`, …) lives in
`steps-view.js`; phase CRUD (`groupIntoPhase`, …) in `phases-view.js`; marker CRUD
in `flow-view.js`. All end at `session.js`.

## 9. Compare Sessions (Aggregate) view

[`views/aggregate-view.js`](../../viewer/views/aggregate-view.js) drives
`#view-aggregate`: activity-frequency and case-duration bar charts (`charts.js`),
trace-variant / outlier / rework tables, the cross-session **Analysis panel**
(`analysis-aggregate.js` rolls up each loaded session's `analysis.json` into a
pooled time study / per-worker / automation / efficiency view), and the process
map.

**The process map is a notation × level matrix**
([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md)):

- **Notation** — *Process diagram* (**BPMN**, `bpmn-viewer.js`) or *Flow diagram*
  (**DFG**, `dfg-viewer.js`), as panel tabs.
- **Level / Grain** — the **Grain** ladder `element ⊂ screen ⊂ app ⊂ phase ⊂ case`
  ([ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)), plus the **Activity**
  taxonomy level, via the `#session-map-level` dropdown — synced with the shared
  **Grain** slider in the view-mode bar (`State.getGrain()`, default `screen`).
  The old fixed Activity/Step/Phase levels fold into this ladder (`step` == the
  `element` notch's map collapse). BPMN is mined only at the Element/Phase grains;
  for screen/app/case the map falls back to the Flow diagram (no dead host).

The axes are independent — changing level never swaps notation and vice versa. As
of v0.18.0 the matrix, drill-down scoping, rare-path slider, and BPMN/DFG render
all live in the shared **`map-controller.js`** (`createMapController`), which the
Aggregate view and the Session-view Map level both instantiate against their own
host elements — so there is one process-map implementation, not two. The activity DFG is the merged taxonomy
graph; the step/phase DFG is built **live** from annotations
(`process-map-levels.buildAnnotationDfg`), collapsing value-laden step names via
`processLabel` so repeated work is one node
([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)). The step/phase
*Process diagram* is the observed-flow file mined by `bpmn_observed.py`.

**Grain is a view-time roll-up** ([ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md)).
A single **Grain** slider in the view-mode bar (`State.getGrain()`, notches
`element/screen/app/phase/case`, default `screen`) sets a shared notch that the
Steps list, the Flow timeline, and the Map all read. `rollUpSteps(steps, notch)`
folds a session's steps into one group per run of consecutive (per-case) steps
sharing the notch's key — `element` is identity (every step shown, the fine
count preserved), `screen`/`app` read the step's `grain_keys` (stamped by
`step_suggest.step_grain_keys`, with a JS `resolveStepGrainKeys` fallback for
older sessions), and `phase`/`case` read `phase_id`/`case_id`. It is a **view**:
no re-normalization, raw `events.jsonl` untouched, sliding back restores the
detail. The €-ROI total is computed once in Python from event-stream segments
and so is **invariant** across notches — the slider re-itemises the Steps/Map
but never moves the headline figure.

**Map interaction (Flow diagram):**

- **Drill-down scoping** — clicking a phase node descends to the step level
  *filtered to that phase's steps*; a step node descends to the activity level
  *filtered to that step's activity labels*. A "scoped: ‹parent› · show all" chip
  in the header is the inverse. The BPMN is a static mined file, so a click there
  descends *unfiltered*.
- **Hide rare paths** — a toggle drops one-off (frequency-1) edges so the dominant
  flow is readable on a dense recording (`dropRareEdges`); the hidden count shows
  in the label, reversible.
- **Conformance overlay** — when loaded sessions matched a Process Template, DFG
  nodes are coloured green (matches a canonical step) / amber (off-template).
- **Drill to source** — clicking an *activity* node opens a picker of the loaded
  sessions that contain it (drill-to-session injected by `renderer.js` via
  `initAggregateView({ onDrillToSession })`); the picker also offers a
  **Reclassify** action that writes a classification override and re-analyzes.

Zoom/pan and dragged node layout persist — `dfg-viewer.js` per node set in
`localStorage`, `bpmn-viewer.js` by saving XML back to the `.bpmn`.

## 10. Project layer

[`project.js`](../../viewer/project.js) bundles the analyst's working set — loaded
aggregate sessions, focus session, active template, current tab / view-mode / case
scope, timeline state — into a single `.pdt-project.json` file. It is a CommonJS
module `require()`d by `renderer.js`, persists recents under `pdt.recentProjects`,
validates the `format` / `version` pair on load, and uses **collector callbacks**
so it never references `renderer.js` variables directly — the seam pattern the
rest of the viewer now follows.
