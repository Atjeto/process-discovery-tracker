# Viewer Architecture

> **Deep reference.** The Viewer is the active refactor target; this document and
> [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md) are the primary maps for that work.
> Structural problems are catalogued separately in
> [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).

## Contents

1. [Process model](#1-process-model)
2. [Module map](#2-module-map)
3. [The window-globals contract](#3-the-window-globals-contract)
4. [IPC surface](#4-ipc-surface)
5. [View system](#5-view-system)
6. [State model](#6-state-model)
7. [Render pipeline](#7-render-pipeline)
8. [Annotations editing & undo](#8-annotations-editing--undo)
9. [Compare Sessions (Aggregate) view](#9-compare-sessions-aggregate-view)
10. [Project layer](#10-project-layer)

## 1. Process model

The Viewer is an Electron app: one **main process** ([`main.js`](../../viewer/main.js))
and one **renderer** ([`index.html`](../../viewer/index.html) + a stack of scripts).

- **One window**, 1400×900, created in `createMainWindow()`. A `--session=<path>`
  argv entry is parsed at startup and pushed to the renderer as
  `viewer:openInitialSession`.
- `webPreferences` deliberately set `nodeIntegration: true`, `contextIsolation: false`.
  This is why the renderer scripts call `require("electron")`, `require("node:fs")`,
  and `require("./project.js")` directly. The risk is mitigated by `webSecurity`,
  a deny-all `setWindowOpenHandler`, and a `will-navigate` guard.
- The main process is thin: window lifecycle, file dialogs, the normalization
  subprocess, and file I/O. **All UI logic lives in the renderer.**

## 2. Module map

Renderer scripts load in this order (see `index.html`); later scripts depend on
globals set by earlier ones. There are **two loading patterns**, which is itself
worth knowing:

| File | Lines (approx) | Loaded as | Exposes | Role |
|---|---|---|---|---|
| `charts.js` | 154 | `<script>` global | `window.PdtCharts` = `{ renderBarChart, fmtDurationS }` | Inline-SVG bar charts for the Aggregate view |
| `dfg-viewer.js` | 269 | `<script>` global | `window.PdtDfg` = `{ render, fit, zoomIn, zoomOut, getZoom, exportSvg }` | Directly-Follows Graph via cytoscape + dagre |
| `bpmn-viewer.js` | 81 | `<script>` global | `window.PdtBpmn` = `{ render, fit, exportSvg }` | BPMN 2.0 diagram via bpmn-js |
| `report-md.js` | 210 | `<script>` global | `window.PdtReport` = `{ buildSessionReport, buildAggregateReport }` | Markdown report generation |
| `step-editor.js` | 338 | `<script>` global | `window.PdtSteps` = `{ renderStepList, renderStepDetail, renderStepTimeline, renderInteractionEvent }` | Steps list/detail + the Steps mini-timeline |
| `phase-editor.js` | 274 | `<script>` global | `window.PdtPhases` = `{ renderPhaseList, renderPhaseDetail, renderPhaseTimeline }` | Phases list/detail + the Phases mini-timeline |
| `layout-controls.js` | 172 | `<script>` global | `window.PdtLayout` = `{ setTimelineHeight, setVideoWidth, setVideoMode, setMiniTimelineHeight }` | Drag-resize handles + video modes; self-inits on `DOMContentLoaded` |
| `command-palette.js` | 156 | `<script>` global | `window.PdtPalette` = `{ open, close, toggle, setProvider }` | Ctrl+K command palette |
| `renderer.js` | **5,708** | `<script>` global | *(nothing)* | **The orchestrator** — see below |
| `project.js` | 170 | `require()` (CommonJS) | `module.exports` (project shape, capture/validate, recents) | Project-file layer |
| `python-runner.js` | 153 | `require()` by `main.js` | `module.exports` = `{ runNormalize, resolvePython, … }` | Spawns the bundled Python pipeline |
| `main.js` | 697 | Electron main | — | Main process (see §4) |

`renderer.js` exposes no global of its own — it is the top-level script that wires
everything together. At **5,708 lines** it holds session loading, all view
rendering, the Flow timeline, every UI event handler, state, and persistence. This
single file is the central finding of the refactor review; see
[ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).

> **Note on patterns.** Most modules use the `window.Pdt*` global pattern;
> `project.js` and `python-runner.js` use CommonJS `module.exports`. `project.js`
> additionally uses a *collector-callback* pattern to stay decoupled from
> `renderer.js`'s variable names — the cleanest module seam in the viewer, and a
> useful template for the refactor.

## 3. The window-globals contract

`renderer.js` orchestrates the feature modules by calling their globals. There is
**no enforced interface** — the contract is the set of function names above, kept
in sync by hand. Representative calls:

```
renderer.js ─ renderStepsLevel()   → window.PdtSteps.renderStepList / renderStepDetail / renderStepTimeline
            ─ renderPhasesLevel()  → window.PdtPhases.renderPhaseList / renderPhaseDetail / renderPhaseTimeline
            ─ renderAggregate()    → window.PdtCharts.renderBarChart
                                   → window.PdtDfg.render / window.PdtBpmn.render
            ─ report export        → window.PdtReport.buildSessionReport / buildAggregateReport
            ─ Ctrl+K               → window.PdtPalette.open / setProvider
```

`layout-controls.js` is the exception: it self-initialises on `DOMContentLoaded`
and is not called by `renderer.js` at all — it only writes CSS variables
(`--timeline-height`, `--video-width`, `--mini-timeline-height`) that the
stylesheet and the timeline renderers read.

The header comment in `renderer.js` lists only `PdtCharts` / `PdtDfg` / `PdtBpmn`
as dependencies — it is stale; the real dependency set is all seven `Pdt*` globals
plus `require("./project.js")`.

## 4. IPC surface

`renderer.js` ↔ `main.js` over Electron IPC. All renderer→main calls are
`ipcRenderer.invoke("viewer:…")` against `ipcMain.handle` in `main.js`:

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

Main→renderer messages (`webContents.send`): `viewer:openInitialSession` (startup
`--session=`), `viewer:normalizeLog` (streamed normalization output).

`loadSessionData()` in `main.js` assembles the session object the renderer holds
as `currentSession`: `{ sessionFolder, manifest, events, stats, dfg, annotations,
obsSync, recordingPath, recordingAvailable, externalVideoOffsetMs }`. All
normalization IPC funnels through `runNormalize()` and shares one module-scope kill
handle (`_normalizeHandle`), so `viewer:cancelNormalize` stops whichever run is in
flight.

## 5. View system

The renderer has **four top-level surfaces** (containers in `index.html`):

| Container | Surface |
|---|---|
| `#view-session` | One session — video + timeline + annotations |
| `#view-aggregate` | Compare Sessions — process maps, statistics, exports |
| `#view-canonical` | Process Template editor |
| `#view-vocabularies` | App Library (App Vocabulary editor) |

Inside `#view-session` there are **three levels**, switched by the `.view-mode-btn`
buttons → `setLevel(name)` ([`renderer.js:463`](../../viewer/renderer.js)):

| Level | Layout container | Render entry |
|---|---|---|
| `flow` | `#session-layout-flow` | `renderTimeline()` |
| `steps` | `#session-layout-steps` | `renderStepsLevel()` |
| `phases` | `#session-layout-phases` | `renderPhasesLevel()` |

`setLevel()` does three things: sets the explicit `currentLevel` variable
([`renderer.js:388`](../../viewer/renderer.js), `let currentLevel = "flow"`),
toggles `display` on the three `#session-layout-*` containers, and snapshots /
restores the outgoing and incoming levels' viewport (zoom + scroll fraction) via
`_viewportSnapshotForMode` / `_viewportApplyToMode`.

> The current level **is** explicit state (`currentLevel`) — but the renderer also
> relies on DOM `display` for the same fact, and dispatches on it with a
> hand-written 3-way `if (currentLevel === "flow") … "steps" … "phases"` block
> repeated at ~6 sites. The duplication, not the state, is the smell — see
> [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).

## 6. State model

There is no store and no framework. State is module-level `let`s in `renderer.js`:

| Variable | Holds |
|---|---|
| `currentSession` | the loaded session object (§4) |
| `aggregateSessions` | array of sessions for the Compare view |
| `currentLevel` | `"flow"` \| `"steps"` \| `"phases"` |
| `zoomFactor` | Flow-timeline zoom (`stepZoom` / `phaseZoom` for the mini-timelines) |
| `currentCaseScope` | case-id filter, or `""` for all |
| `selectedStepId`, `selectedPhaseId`, `multiSelectedStepIds` | editor selection |
| `_undoStack`, `_redoStack` | annotation undo history (§8) |

**Persistence** is `localStorage`, all keys prefixed `pdt.`:

| Key | Written by | Holds |
|---|---|---|
| `pdt.recentSessions` | `renderer.js` | recent session folders |
| `pdt.recentProjects` | `project.js` | recent project files |
| `pdt.timelineHeight`, `pdt.videoWidth`, `pdt.miniTimelineHeight` | `layout-controls.js` | drag-resized pane sizes |
| `pdt.timelineState` | `renderer.js` | per-session timeline zoom + scroll (one key, a map) |
| `pdt.timelineLanes` | `renderer.js` | which Flow-timeline lanes are toggled on |
| `pdt.shortcutsOverlayHidden` | `renderer.js` | dismiss state of the shortcuts card |

## 7. Render pipeline

**Load.** `loadSessionIntoView(folder)` ([`renderer.js:2188`](../../viewer/renderer.js)):

```
open folder → ipcRenderer.invoke("viewer:loadSession") → currentSession = result
            → wire <video>
            → renderTimeline() · renderEventTable() · renderAnnotations()
              renderScreenshots() · renderMarkersList() · renderTimelineSummary()
              renderStepsLevel() · renderPhasesLevel() · updateProcessMapStatus()
              populateCaseScope() · restoreTimelineForCurrent() · installRangeSelection()
```

Every surface is re-rendered on load regardless of which level is visible.

**Edit.** Annotation edits do **not** patch the DOM in place — they round-trip
through disk:

```
edit → saveAnnotationsWithUndo(annotations, label)   (renderer.js:56)
     → ipcRenderer.invoke("viewer:saveAnnotations")
     → loadSessionIntoView(sessionFolder)            ← full reload + full re-render
```

This "every edit is a full session reload" model is simple but expensive and is a
named refactor target.

## 8. Annotations editing & undo

All step / phase / marker / note mutations funnel through
`saveAnnotationsWithUndo(annotations, label)`:

- It snapshots the **previous** `annotations` onto `_undoStack` before writing.
- `_undoStack` / `_redoStack` are in-memory, capped at `UNDO_MAX = 50`, and each
  entry is pinned to a `sessionFolder`.
- `resetUndoStack()` runs on session switch.
- `performUndo()` / `performRedo()` write the snapshot back via
  `viewer:saveAnnotations` and then `loadSessionIntoView()` to refresh.

Step CRUD (`inlineRenameStep`, `saveStep`, `splitStep`, `mergeStepWithNext`,
`addManualStep`, `toggleStepHidden`, …) and phase CRUD (`savePhase`,
`groupIntoPhase`, `reorderStepsInPhase`, …) all end at this one function.

## 9. Compare Sessions (Aggregate) view

`renderAggregate()` ([`renderer.js:4170`](../../viewer/renderer.js)) drives
`#view-aggregate`: activity-frequency and case-duration bar charts (`PdtCharts`),
trace-variant / outlier / rework tables, and the process map. The map renders two
ways in one tabbed panel — **DFG** via `PdtDfg` (cytoscape + dagre) and **BPMN** via
`PdtBpmn` (bpmn-js). Clicking a DFG node opens a drill-down picker that lists every
loaded session containing that activity.

## 10. Project layer

[`project.js`](../../viewer/project.js) bundles the analyst's working set — loaded
aggregate sessions, focus session, active template, open vocabularies, current tab
/ view-mode / case scope, timeline state — into a single `.pdt-project.json` file.
It is a CommonJS module `require()`d by `renderer.js`, persists recents under
`pdt.recentProjects`, validates the `format` / `version` pair on load, and uses
**collector callbacks** so it never references `renderer.js` variables directly.
This decoupling is the pattern the rest of the viewer should move toward.
