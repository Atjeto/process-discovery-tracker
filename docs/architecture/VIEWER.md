# Viewer

> The analyst's app in the light version ([ADR-0029](../adr/0029-ba-helper-refocus.md)):
> how it is built, module by module. The timeline has its own page,
> [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md); styling is in
> [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md); the files it reads and writes are
> in [SCHEMA.md](../../shared/SCHEMA.md). The product edition's viewer is on
> branch `product-edition`.

## Contents

1. [Process model](#1-process-model)
2. [The shell and the four levels](#2-the-shell-and-the-four-levels)
3. [Module map](#3-module-map)
4. [The module graph](#4-the-module-graph)
5. [IPC surface](#5-ipc-surface)
6. [State](#6-state)
7. [Render pipeline](#7-render-pipeline)
8. [The automatic analysis](#8-the-automatic-analysis)
9. [Edits, undo and saving](#9-edits-undo-and-saving)
10. [Exports](#10-exports)

## 1. Process model

The viewer is an Electron app: one **main process**
([`main.js`](../../viewer/main.js)) and one **renderer**
([`index.html`](../../viewer/index.html), its entry script
[`renderer.js`](../../viewer/renderer.js) and the modules that entry
`require()`s). There is no bundler: every module is plain CommonJS.

- **One window**, 1400x900, no application menu. A `--session=<folder>`
  argument (the folder must hold a `manifest.json`) is sent to the renderer
  once, after the page's first `did-finish-load`, as
  `viewer:openInitialSession`. A page reload therefore opens nothing: a
  driver relaunches instead.
- **The renderer has Node** (`nodeIntegration: true`,
  `contextIsolation: false`), so modules `require()` each other and
  `node:fs` directly. The risk is contained around it: a Content Security
  Policy in `index.html` (no network connections, no frames, no objects),
  a window-open handler that denies everything, a `will-navigate` guard,
  and checks in the main process on every path the renderer hands it
  (below).
- **The main process is thin**: the window, the file dialogs, the Python
  runs (`normalize.py` and `transcript_import.py`, through
  [`python-runner.js`](../../viewer/python-runner.js) with the bundled
  Python), and the file writes. Everything on screen is the renderer's.
- **Paths from session data are untrusted.** The main process remembers the
  session folders it loaded. It opens a screenshot only when the path is
  inside `screenshots/` of such a folder and has an image extension; an
  attachment only when it is a file in `attachments/` of such a folder (a
  document, an image or a mail opens in its program; any other type is
  shown in its folder); it writes `annotations.json` only into a folder
  with a `manifest.json`.
- **One analysis at a time.** While `normalize.py` runs on a folder, the
  main process refuses annotation writes to that folder (the pipeline
  rewrites `annotations.json`): the analyst is told to make the change again
  once the update is done. A zip of that project waits too (section 10).
- **Every write of a project folder is reported.** The handlers that write
  into a folder (`annotations.json`, the video, the transcript, a screenshot,
  an attachment) send `viewer:projectWrite` as the write starts and again
  with its result; a handler that asks for a file first reports nothing
  when the dialog is cancelled. The top bar's save state listens (section
  9). The analysis and the exports report nothing.
- **Removed files wait for an Undo.** A screenshot or an attachment the
  analyst removed moves to `<userData>/pdt-removed/`, and back when an Undo
  names it again; that folder is emptied when the viewer starts.
- **Libraries.** `index.html` loads cytoscape, cytoscape-dagre and the
  bpmn-js modeler as globals (the live map, the map editor and the
  off-screen map pictures). `dfg-viewer.js` requires `@dagrejs/dagre` to lay
  the live map out itself (cytoscape-dagre is the fallback), and
  `asis-view.js` requires bpmn-js's navigated viewer for the As-Is map.

## 2. The shell and the four levels

**The top bar** (`index.html` `.topbar`) is the one bar: the New and Open
menus, the four level buttons, the status line, the save state, the Export
menu, Help and the theme toggle. The levels, the status line, the save
state and Export show once a project is open (`.app.has-session`). Opening
one menu closes the others.

- **New** (`#btn-new-menu`): *New project from a video...* and *New empty
  project...* (contract C16).
- **Open** (`#btn-recent-menu`): *Open project...* (a recorder's folder or a
  project made with New), then the recent projects.
- **The status line** (`#session-pills`): "Updating steps and map..." with
  Cancel while the pipeline runs; else, when marker changes wait, the one
  call to action *Apply N marker changes*; else nothing.
- **The save state** (`#save-state`): *Saved* (the time of the last save
  and the folder in its tooltip), *Saving...* while a write lasts, *Not
  saved* in the error colour (what was not saved and why in its tooltip)
  until a later save succeeds (section 9).
- **Export**: *PDD (.docx)*, *Process map (image)*, *Process map (BPMN)*,
  *Whole project (.zip)* (section 10).

**The four levels** are `.view-mode-btn[data-level]` buttons; each shows one
container. The Overview is the default on load.

| Level | `data-level` | Container | Render entry |
|---|---|---|---|
| Overview | `overview` | `#session-layout-overview` | `renderOverviewLevel()`, [`views/overview-view.js`](../../viewer/views/overview-view.js) |
| Timeline | `flow` | `#session-layout-flow` | `renderTimeline()`, [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) |
| Steps | `steps` | `#session-layout-steps` | `renderStepsLevel()`, [`views/steps-view.js`](../../viewer/views/steps-view.js) |
| Map | `map` | `#session-layout-map` | `renderMapLevel()` in `renderer.js`, with [`map-controller.js`](../../viewer/map-controller.js) and [`refmap-ui.js`](../../viewer/refmap-ui.js) |

- **Overview**: the Checklist (five acts: Mark the transactions, Confirm
  the reference transaction, Review the other transactions, Write the
  document, Export the PDD; each ticked or not from the session data alone,
  each with a tooltip that says what it means, and one button for the next
  act; it shrinks to one line once only the export is left); the project
  line (its name, who recorded it, its transactions, the reference
  transaction's steps, the video and the transcript with their Attach,
  Replace and Remove, and warning lines only when a marker problem, a
  missing file, a check that could not run or an app recorded with less
  detail needs one); the Document ("You write these. The PDD prints them.":
  the ten fields of contract C6, an empty one showing its question in light
  italics, a status that counts the written fields and, once one is
  written, names the empty ones, the Attachments list, and "From the
  transcript" while one is attached); the Observations
  ([`views/analysis-view.js`](../../viewer/views/analysis-view.js),
  "Measured from the recording": Data typed twice, and Where the time goes
  per step and per system, with its Average time and in how many
  transactions it Happened). Until the project is analyzed it shows one
  note that says where the analysis is.
- **Timeline**: the timeline with its lanes, the video pane, the side panel
  (Screenshots, Markers) and the Raw events drawer, which shows on this
  level only. Detail: [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md).
- **Steps**: the transactions in time order, one open at a time, under one
  line that says what a transaction is (the reference transaction with
  Confirm transaction or Reopen transaction and Save as this process; each
  other transaction with its differences; "Outside the transactions"), and
  the step pane beside them. The divider between the two moves with a drag
  or, focused, with Left, Right, Home and End; a double-click or Enter gives
  the usual widths back (`pane-splitter.js`; at 1100px wide or less the two
  stack, without it). The toolbar has *+ Add step*, the bulk Hide, Merge
  and *Group into a sub-process...* buttons (shown when two or more rows
  are ticked), *Leave apps out...* and *Saved names...*. The list shows one
  level at a time (contract C19, below).
- **Map**: the process map drawn from the transactions' steps between a
  Start and an End circle, each box naming its system under its name; a
  condition set in Steps labels its line, and a path set in Steps that no
  transaction took is dashed (contract C17). When an As-Is copy is chosen
  for the PDD it shows first, drawn by bpmn-js, read only and linked like
  the map from the transactions (C18,
  [`asis-view.js`](../../viewer/asis-view.js)): a task opens the step panel
  on the step it stands for, a file opens its attachment, a note shows its
  whole text, the legend takes no click; drag pans, Ctrl and the wheel zoom,
  and the Map's fit fits it. Edit and a way back to the map from the
  transactions sit above it. The one act is *Edit as the As-Is map*;
  *Edited maps* opens the gallery of copies, where a copy the process map
  changed after says what *Copy again* gives; the editor is a full-screen
  overlay (`#refmap-editor-overlay`). While the project is not analyzed, no
  transaction is marked or the transaction check could not run, the map
  shows a message that says why instead.

**The step panel** (`#step-panel`,
[`views/step-panel.js`](../../viewer/views/step-panel.js)) sits beside the
level on screen. It has three doors: a click on a map box, a click on a
timeline step band, and a selected Steps row (Watch in the step pane opens
it and plays the step); a task of the As-Is map is a map box too. It names
the step, its system and screen, its description, its flow in one short
line when one is set (contract C17: "Only when ... · Goes back to step 2
when ...") and "In N of M transactions, about Xs each", then says how often the
step happened ("This step happened 5 times: once in transactions 1, 3 and 4,
twice in transaction 2. Play any of them.") and lists one row per time:
"Transaction 1 · 0:39 into the recording · took 8s" ("Transaction 2, again"
for a second time in one transaction) with a play button for its own small
video, which opens paused on the row the panel opened on, then the step's
screenshots, what was said then and its notes, each under a small lead. Its foot says *Open in Steps*, or *Show on timeline* on the
Steps level, and *Open sub-process* for a sub-process. At a level below the
main one (C19) the panel shows the occurrences of the step's node in every
visit of that level. A task of the As-Is map that no step stands for (added or
renamed in the editor, or its step renamed or hidden since the copy was
made) opens the panel on its name, with one line saying no step has it. The panel closes on the Overview; closed on Steps, it stays
closed while rows are selected, until a door opens it again.

**Sub-processes** (contract C19; [`sub-process-maps.js`](../../viewer/sub-process-maps.js),
[`sub-process-verbs.js`](../../viewer/sub-process-verbs.js)). A step with
`sub_steps` is a sub-process, at any depth. The Steps list shows one level
at a time: `State.mapPath`, the path of map nodes from the main map down
(`[]` the main level), which the step panel and the Timeline's steps lane
follow too (the Map level joins in lane SUB-V2). A sub-process row carries
*▸ N sub-steps*, which opens its level; a double-click on the name still
renames. Inside, a breadcrumb over the list (`#steps-crumbs`) names the way
down, the document's title (else "Main process") first; each crumb goes up
and selects the step the level was inside, and *Dissolve sub-process*
(`#btn-dissolve-level`) sits beside it. The list then has one block per
visit of the sub-process ("Transaction 2", "Transaction 2, again"; key
`data-visit`), the reference transaction's first visit marked Reference,
with its status and Confirm transaction, and every other block compared
with it (`run-differences.js`). The step pane works the same at every
level; its Go to lists the visit's steps and End, which ends the
sub-process only. The verbs, each one undoable edit at the level shown:
*Open as a sub-process* (the step pane, the step menu: every visible
occurrence of the step's node at its level, in every transaction, gets one
drafted sub-step per recorded action, named without values and keyed by
`action_key`; drafts become edited; the new level opens), *Group into a
sub-process...* (two or more ticked steps one after the other in one
transaction; the same stretches in every transaction are grouped too, and
the links move with them), *+ Add step* (into the open visit), *Dissolve
sub-process* (a group gives its steps back in its place; an opened step
drops its sub-steps, whose screenshots, notes and attachments move to it;
one confirm names the descriptions and flow that go). A sub-process's name
reaches every occurrence of its node at its level; a drafted sub-step's
name reaches the drafts of its action and is saved under `action|` and its
key. Confirm transaction and Reopen transaction reach every level, and the
reference transaction reads Draft while a level below holds a draft. Merge,
Split and a moment added to a step are refused on a sub-process with one
line; Hide hides it with everything under it; Delete on a group deletes its
steps too (the confirm counts them and points at Dissolve).

**Switching levels.** `selectLevel(name)` marks the level button and calls
`applyLevel(name)` (`renderer.js`): it records the level in `state.js`,
shows one container, tells the step panel, shows the Raw events drawer on
the Timeline only, and carries the viewport through `MODE_VIEWPORT` (the
Timeline's zoom and scroll; the Steps level keeps the Timeline's viewport
while the analyst is on it, so a return lands where it was). Arriving on
Steps with a selected step scrolls its row into view once.

**Help** (`#help-modal`) holds the analyst's guide in six sections (Getting
started, Steps, Markers, Recording keys, Shortcuts, Troubleshooting), the
version, and *Re-analyze* (Troubleshooting) for an analysis that stopped.
Getting started says what a transaction is, what each block of the
Overview shows, that every change saves itself and how a project is handed
over.

## 3. Module map

Every file below is in `viewer/` unless it says `views/`. Tests sit next to
their module as `<name>.test.js`.

**Entry and shell**

| File | Owns |
|---|---|
| `main.js` | The main process: the window, every `viewer:*` handler (section 5), `loadSessionData()`, the path checks, the one-analysis lock, the write reports (`viewer:projectWrite`), the holding folder for removed files. |
| `index.html` | The markup: the top bar, the four level containers, the step panel, the playback bar, Help, the map editor overlay. |
| `renderer.js` | The wiring entry: the level switcher, the Map level's data source (`_sessionMapData`, the system per box), the state bus subscriptions, the keyboard shortcuts, Help, the playback bar, the New, Open and Export menus, the exports (section 10), the save state's mount, boot. |
| `save-state.js` | The save state in the top bar (section 9): its pure state (`applyWrite`, `view`) and the element it drives, fed by `Ipc.onProjectWrite` and by `noteWrite` for the map files the renderer writes. |
| `styles.css` | Every style rule, the light and dark tokens ([DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)). |
| `ipc.js` | One typed wrapper per `viewer:*` channel; nothing else touches `ipcRenderer`. |
| `state.js` | The central store, the topic bus, the undo and redo stacks (section 6). |
| `session.js` | Annotation saves with undo, `persistAnnotations`, undo and redo in place, `ensureAnnoShape` (section 9). |
| `dom.js` | `$`, `$$`, escaping, `formatDuration`, the one clock (`clock`, `recordingStartMs`, `sinceStart`, `parseClock`), `toast`, `placeMenu` (a menu kept inside the window). |
| `modals.js` | `promptModal`, `confirmModal`, `formModal`: themed dialogs. |
| `theme.js` | The light and dark theme, its persistence, the per-app band colours and the map's colour snapshot. |
| `recent.js` | The recent projects (`pdt.recentSessions`): the list on the empty state; the Open menu reads it too. |
| `layout-controls.js` | The Timeline's resize handles and video modes (expanded, full screen); wires itself when required. |
| `pane-splitter.js` | The Steps level's divider between the transactions and the selected step (`#steps-splitter`): the drag, the double-click, the keys, the share it remembers, each pane held at its minimum by the stylesheet's clamp; wired by `steps-view.js`. |
| `python-runner.js` | Main process: finds the Python (`PDT_PYTHON`, the bundled one, else `python`), runs `normalize.py` (always with the bundled taxonomy) and `transcript_import.py`. |
| `normalize-result.js` | What a finished run means for the analyst: the failure sentence (exit codes, contract C13), the PDD export outcome, and `analysisNeed()` with `ANALYSIS_FORMAT` (section 8). |
| `build-package.js` | The electron-packager wrapper for releases. |

**Main-process stores** (plain `fs`, each testable with a fake file system)

| File | Owns |
|---|---|
| `annotations-store.js` | Reading `annotations.json` (an unreadable file is reported, never treated as absent), the backups `.2` to `.5`, the temp-file-then-rename write. |
| `names-store.js` | The saved names, `<userData>/pdt-library/remembered-names.json` (contract C4). |
| `processes-store.js` | The saved processes, `<userData>/pdt-library/processes.json` (C5): save, undo, forget. |
| `transcript-store.js` | `transcript.json`: read, save the sync offset, remove (C8). |
| `analyst-files.js` | The files the analyst adds (C16): screenshots in `screenshots/analyst/`, attachments in `attachments/` (a free name when one is taken), the move of removed files and back, which attachment opens. |
| `new-project.js` | A session without a recording (C16): `manifest.json` (`session_id`, `source`, `started_at`, `label`), an empty `events.jsonl`, `annotations.json`, and for a video project the video copied into `video/` at offset 0. |
| `video-path.js` | Pure: where an attached video is kept (copied into `video/`, stored relative to the folder) and how a stored path is found again on another machine. |
| `project-zip.js` | Export, Whole project (.zip): where the zip goes (next to the folder, `<name>.zip`, else `<name> (2).zip` and on), one more try when a save replaced a file while the zip was made, the sentence for a failure, the size. |
| `zip-folder.js` | The zip writer (PKZIP 2.0 without ZIP64, UTF-8 names, written as `.partial` and renamed at the end): a copy of `capture/zip-folder.js`, kept identical by `project-zip.test.js`, since a packaged viewer cannot reach `capture/`. |

**Views** (`views/`)

| File | Owns |
|---|---|
| `overview-view.js` | The Overview: the Checklist (`pathState`), the project line, the Document fields, their saves and status, "From the transcript", the Map's lock and empty messages (`mapLockHtml`, `mapEmptyText`), the note shown while the analysis is missing. |
| `analysis-view.js` | The Overview's Observations: Data typed twice, Where the time goes (`averageTime`, `happenedIn`). |
| `flow-view.js` | The Timeline hub: project load (`loadSessionIntoView`, which also tells the save state), the automatic analysis and the status line (section 8), New project from a video and New empty project, the Transaction select, range selection, the timeline menus (start or end a transaction, add a note, jump to a step), the Raw events table. |
| `flow-view-timeline.js` | The timeline: the lane stack, the minimap, the lanes menu, zoom and scroll persistence, the summary line. |
| `flow-view-video.js` | The video and the timeline: the span a video project runs on, the playhead, seeking, Attach video and Sync video (two clicks). |
| `flow-view-screenshots.js` | The Screenshots panel, the gallery, and the guarded open of a screenshot. |
| `flow-view-markers.js` | The Markers panel: the markers with the analyst's changes laid over them, move, delete, rename. |
| `flow-view-transcript.js` | The Transcript lane, the transcript's Sync, Attach, Replace and Remove. |
| `flow-view-apps.js` | Per-app band colours, the system a band names, the legend. |
| `steps-view.js` | The Steps level: the transactions and their steps, the line that says what a transaction is, every step verb (rename, split, merge, hide, delete an added step, add, move an untimed step, waste, the flow of contract C17: one undoable edit each, and the links to a step dropped or moved when it is hidden, deleted, merged or split), Confirm transaction and Reopen transaction, Use as reference transaction, Save as this process, the comparison with a saved process, the Leave apps out and Saved names dialogs. C19: the level shown (`goToLevel`, the breadcrumb, one block per visit) and the sub-process verbs (Open as a sub-process, Group into a sub-process, Dissolve sub-process), every verb working at the level shown. |
| `step-panel.js` | The step panel (section 2), its flow line, the panel at a level below the main one and its *Open sub-process* (C19), and the panel for an As-Is task no step stands for (`openForMissing`). |
| `analyst-ui.js` | What the analyst adds, on screen (C16): the System field, the screenshots (Add screenshot, Use in PDD, Remove, Ctrl+V), notes on a step or a moment, attachments on a step and on the Overview. |

**Models** (pure: no DOM, no state; the unit tests drive them)

| File | Owns |
|---|---|
| `runs-model.js` | The runs and their steps as the Steps level shows them: their titles ("Transaction N"; a marker label that only numbers its run is not shown, `numberOnlyLabel`), the reference run (C3), step order (time, then `order`), chips and statuses, the carried merges, the probe line, saved-name propagation. C19: Confirm and Reopen reach every level, a status reads every visible level (`patternConfirmed`, `holdsDraft`), and names propagate at every level (`propagateActionName`, `rememberKey`). |
| `sub-process-maps.js` | The maps a project holds (C19): `mapTree` (one map per sub-process, its traces, its number; one rule with the pipeline's `sub_process_maps.py`, pinned by `shared/sub-process-maps-golden.json`), the tree finder `findStep` (a step at any depth, its list, parent and level), a level's places (`levelVisits`, one per visit), the visits of a node, `validPath`, `nodeName`. |
| `sub-process-verbs.js` | The pure half of the sub-process verbs (C19): the sub-steps drafted from a step's recorded actions (`draftSubSteps`, `action_key`), Open as a sub-process, Group into a sub-process with its link repairs, Dissolve (and what it takes away), the rename of a sub-process's every occurrence. |
| `run-differences.js` | How a run differs from its reference; one rule with the PDD, pinned by `shared/run-differences-golden.json`. The Steps level passes its words (`REFERENCE_RUN`, `RUN_UNIT`: "transaction"). |
| `marker-edits.js` | The markers with `annotations.marker_edits` laid over them; which edits are pending until the next analysis. |
| `process-map-levels.js` | The process map as a directly-follows graph from the runs' steps, with the Start and End events and the step flow of contract C17 (`buildAnnotationDfg`, `flowEdges`, `stepLinks`, `mapNodeLabel`, where a drafted step or sub-step, with a `draft_key` or an `action_key`, is its name; one rule with the step BPMN, pinned by `shared/flow-links-golden.json`), and the value-free `processLabel` and `screenType` from the shared rule files. |
| `step-flow.js` | The pure half of the step flow (C17): what the Flow line and the step panel say (`linkReading`, `panelLine`, `inheritedLine`), the steps a link can go to, the edits, and the repairs when a target step is hidden, removed, merged or split. |
| `asis-links.js` | What a click on the As-Is map does (C18): a task names its step's map box, a data object its attachment (`DataObjectReference_<id>`), a text annotation its note; the legend, the flows, the events and the gateways do nothing. |
| `system-names.js` | The one vocabulary of systems (C14) from `shared/system-names.json`: `systemName`, `whereOfStep`, the systems the System field offers. |
| `step-facts.js` | What the step pane and the panel say about a step: the fact line ("Salesforce · Account lookup · 6s · ends at Search · Transaction 1 at 0:19"), the fields typed, the drafted narration shown as a hint. |
| `analyst-content.js` | The pure half of C16: where an untimed step goes and how it moves, the screenshots a step shows, the notes of a step or a moment, the implicit run's id. |
| `transcript-model.js` | The transcript's time rule (its own sync, else the video's; a sentence said before the recording reads "0:28 before") and every pick of sentences (for a step, outside the transactions, by speaker or search). |
| `session-summary.js` | The project line's facts, the request (`requestOf`, AD-30), the name in Recents, the marker problems. |
| `reference-maps.js` | The edited maps store (ADR-0019): `annotations.reference_maps[]` plus `derived_maps/<id>.bpmn`; whether a copy is out of date (`isStale`: the signature of the process it was made from, `processSignature`, against the current one; a byte hash for a copy made before signatures); `predatesRichMap` tells a copy made before the map had its colours, notes and attachments (C18). |
| `case-scope.js` | The Transaction select's options ("Transaction 1 · Order #10900"), escaped. |
| `recognition.js` | Platform recognition of an interaction (ADR-0011), for the step pane's interaction list. |
| `identity-line.js` | The one readable line per captured control in that list. |
| `timeline/timeline-core.js` | Ticks, lane packing and the lane stack ([VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md)). |

**Widgets**

| File | Owns |
|---|---|
| `step-editor.js` | The step rows of a run and the step pane: the fact line, Name, System, the fields typed, Description, "Said during this step", the Flow line (C17: "Always · then the next step", *Only when...*, *Go to...* with a dropdown of the transaction's steps and End the process), Waste, Watch, Hide, *Open as a sub-process* (or on a sub-process *Open sub-process* and *Dissolve sub-process*, C19), the screenshots, notes and attachments, and under More the interactions, Show on timeline, Split, Merge. Name, System, a condition and a link's "when" save on Enter or when the field is left, a link's target when it is picked, Description when it is left: there is no Save button. A double-click renames the row its first click landed on, even when that click's redraw moved the rows. |
| `map-controller.js` | The Map's live process map: draws the data source once it has an edge (the Start's and the End's count), its fit control, a box click to the step panel. |
| `dfg-viewer.js` | The live map on cytoscape, laid out left to right by `@dagrejs/dagre` with room for the condition labels and every line routed around the boxes (cytoscape-dagre is the fallback): the Start and End circles, time-weighted edges, the conditions on their lines, a dashed line for a path set in Steps that no transaction took, an edge tip in words; dragged layouts persist per node set. |
| `refmap-ui.js` | The edited maps: which map the Map shows first and when the As-Is map is drawn again (`syncMapView`), the edit act (it analyzes first when the steps changed since the map file was written), the gallery (with what *Copy again* gives), the editor overlay, the map files it writes reported to the save state, and the off-screen renderer of the PDD's pictures and Export's map image (`renderBpmnToPng`, `renderBpmnToSvg`). |
| `asis-view.js` | The As-Is map on the Map level (C18): bpmn-js's navigated viewer, read only and fitted, its clicks (`asis-links.js`: the step panel, an attachment, the note popover `#map-asis-note`). |
| `bpmn-viewer.js` | The bpmn-js modeler in the editor overlay: the copy opens on its own saved layout; each edit, undo and redo is written back after a short delay and reported to the save state; `flush` writes a waiting edit when the editor closes or another map opens. |

## 4. The module graph

`renderer.js` requires the views and wires them together. A module never
requires `renderer.js`: the glue it needs is injected at boot as lazy
wrappers, so the load order does not matter.

```
renderer.js
  initFlowView({ rerenderActiveLevel, addStepAtTimestamp })
  initSession({ renderSessionPills })
  initRecent({ onOpenSession })
  initStepsView({ ensureAnnoShape, persistAnnotations, jumpToStepInFlow,
                  watchStep, analyze })
  RefmapUI.initRefmapUI({ renderLiveMap, sourceBpmnPath, analyze })
```

The same pattern repeats inside the Timeline: `flow-view.js` requires its
`flow-view-*` helpers and hands them what lives back in the hub
(`initVideo({ loadSessionIntoView })`, `initTimeline({ currentScopeRange,
showMarkerInsertMenu, showCaseContextMenu })`,
`initTranscript({ loadSessionIntoView, renderTimeline })`). The helpers
require each other one way only. Where a later module needs an earlier one
back, it requires it lazily at the call (the timeline's step band opens
`step-panel.js`, the notes lane calls `analyst-ui.js`, the Overview's
buttons reach `flow-view.js`, the As-Is map opens the step panel and an
attachment, the step panel's *Open sub-process* reaches `steps-view.js`),
so the graph stays acyclic.

A module may wire its own controls when it is required: the page is already
parsed when `renderer.js` loads it (`flow-view.js`, `flow-view-timeline.js`,
`flow-view-video.js`, `step-panel.js`, `analyst-ui.js` and
`layout-controls.js` do).

## 5. IPC surface

The renderer reaches the main process only through `ipc.js`, one wrapper per
channel over `ipcRenderer.invoke`, answered by `ipcMain.handle` in
`main.js`. The handlers that write answer `{ ok: false, error }` with a
sentence the analyst can read instead of throwing, and `null` when the
analyst cancelled a dialog; `viewer:loadSession` rejects with its reason,
which the renderer shows.

| Group | Channel | Does |
|---|---|---|
| Session | `viewer:openSessionFolder` | The folder picker. |
| | `viewer:loadSession` | Loads a folder (below). |
| Analysis | `viewer:runNormalizeExtended` | Runs `normalize.py` (`mine`, `pddOut`, `pddMapImage`, `pddTobeImage`; `--names` when the store exists); streams its log. |
| | `viewer:cancelNormalize` | Stops the run in progress. |
| Annotations | `viewer:saveAnnotations` | The backup copies, then the atomic write; moves removed analyst files out and back. |
| Saved names (C4) | `viewer:rememberStepName`, `viewer:readRememberedNames`, `viewer:forgetStepName` | Save, read, forget a name. |
| Saved processes (C5) | `viewer:readProcesses`, `viewer:saveProcess`, `viewer:undoSaveProcess`, `viewer:forgetProcess` | Read, save, undo a save, forget. |
| Export and shell | `viewer:exportFile` | A save dialog, then a copy of the given file. |
| | `viewer:saveSvgFile` | A save dialog, then the SVG text. |
| | `viewer:exportProjectZip` | Zips an open project next to its folder (`project-zip.js`); refused while that project's analysis runs, one zip of a project at a time. Answers the zip's path, size and entry count. |
| | `viewer:revealFile` | Shows a file in its folder (Explorer, the file selected). |
| | `viewer:openExternal` | Opens a screenshot, after the path checks (section 1). |
| Video | `viewer:attachExternalVideo` | The video file picker. |
| | `viewer:saveExternalVideoSync` | Copies the video into `video/` when it is outside the folder, then writes `external_video` (relative path, offset). |
| Transcript (C8) | `viewer:importTranscript` | The file picker, then `transcript_import.py`. |
| | `viewer:removeTranscript` | Deletes `transcript.json` (the copied original stays). |
| | `viewer:saveTranscriptSync` | Writes the sync offset. |
| New projects (C16) | `viewer:chooseNewProject` | For a video project the video, then one save dialog for the project's name and folder. |
| | `viewer:createProject` | Makes the folder chosen last. |
| Analyst files (C16) | `viewer:addScreenshot` | Writes `screenshots/analyst/<id>.<png\|jpg>` from a file, a video frame or a pasted image. |
| | `viewer:addAttachment` | The file picker, then a copy into `attachments/`. |
| | `viewer:openAttachment` | Opens an attachment of a loaded session, or shows it in its folder. |

Three messages go the other way: `viewer:openInitialSession` (the
`--session` folder, once at startup), `viewer:normalizeLog` (the
pipeline's output as it runs) and `viewer:projectWrite` (each write of a
project folder: `{ folder, channel, phase: "start" }`, then `{ folder,
channel, phase: "end", ok, error, code }`, `channel` one of `annotations`,
`video`, `transcript`, `screenshot`, `attachment`), exposed as
`onOpenInitialSession(fn)`, `onNormalizeLog(fn)` and `onProjectWrite(fn)`.

`loadSessionData()` in `main.js` assembles the session the renderer holds:

```
{ sessionFolder, manifest, events, stats, analysis, annotations,
  annotationsError, obsSync, recordingPath, recordingAvailable,
  externalVideoOffsetMs, integrity, transcript, transcriptError }
```

`events` are sorted by time (malformed lines skipped). The video is the
analyst's attached one when its stored path resolves on this machine, else
the OBS recording the manifest names. `integrity.missing` lists the files
`session-integrity.json` declares that did not arrive.

## 6. State

[`state.js`](../../viewer/state.js) is one store with getters and setters and
a topic bus; there is no framework.

| State | Holds |
|---|---|
| `session` | The loaded session (section 5). |
| `level` | `overview`, `flow`, `steps` or `map`. |
| `selectedStepId`, `multiSelectedStepIds` | The step selection on the Steps level. |
| `caseScope` | The Transaction select: a run id, or `""` for all transactions (it dims the other transactions on the timeline only). |
| `zoomFactor` | The Timeline's zoom. |
| `selectionRange` | A Shift-drag range on the timeline. |
| `pendingStepJump`, `pendingStepReveal` | A moment or a step the Steps level should show on arrival (at the step's own level, C19). |
| `mapPath` | The level shown (C19): the path of map nodes from the main map down, `[]` the main level. The Steps list, the step panel and the Timeline's steps lane follow it; a project opened resets it. |
| `analysisRun` | `{ folder, status }` of the last run: `running`, `failed` or `cancelled` (null once one succeeds). |
| undo and redo stacks | Annotation snapshots, at most 50 each, each pinned to its session folder. |

`State.subscribe(topic, fn)`, `State.emit(topic)` and `State.batch(fn)` are
the bus. The topics and who listens (`renderer.js`):

| Topic | Re-renders |
|---|---|
| `steps` | the Steps level, the Overview, the Map, the step panel |
| `timeline` | the timeline |
| `markers` | the Markers panel, the status line, the Overview |
| `analysis` | the Overview |

**Kept on this machine** (`localStorage`, every key starts with `pdt.`):

| Key | Written by | Holds |
|---|---|---|
| `pdt.recentSessions` | `recent.js` | The recent projects. |
| `pdt.theme` | `theme.js` | `light` or `dark` (the inline script in `index.html` reads it before the first paint). |
| `pdt.timelineState` | `flow-view-timeline.js` | Per session folder, the timeline's zoom and scroll. |
| `pdt.timelineLanes` | `flow-view-timeline.js` | Which lanes are shown. |
| `pdt.timelineHeight`, `pdt.videoWidth` | `layout-controls.js` | The dragged pane sizes. |
| `pdt.stepsSplit` | `pane-splitter.js` | The Steps level's divider: the transactions' share of the width. |
| `pdt.analysis.<item>` | `analysis-view.js` | Whether an Observations item is open. |
| `pdt.dfgLayout.<hash>` | `dfg-viewer.js` | A dragged map layout, per set of boxes. |

## 7. Render pipeline

**Load.** `loadSessionIntoView(folder)` (`flow-view.js`):

```
Ipc.loadSession(folder) -> State.setSession(...)
  -> undo stack reset (another folder) and a new undo baseline
  -> the top bar's levels show; the annotations error banner
  -> the save state (another folder starts over; an unreadable annotations.json is Not saved)
  -> Recents
  -> the video (or the slim no-video band), + Step and Sync video only with a video
  -> renderTimeline, the Raw events table, the Screenshots and Markers panels,
     the timeline summary, renderStepsLevel, renderOverviewLevel, the Transaction select
  -> the remembered timeline zoom and scroll
  -> the automatic analysis when the session needs one (section 8)
```

The Overview, the Timeline and the Steps level are rendered on load,
whichever is on screen; the Map renders only while it is on screen.

**Edit.** An edit never reloads the session:

```
edit -> persistAnnotations(annotations, label, topics)     (session.js)
     -> saveAnnotationsWithUndo -> viewer:saveAnnotations
     -> State.emit(topic) for each topic the edit touched
     -> the views that listen re-render in place
```

**Analysis.** A finished analysis reloads the session from disk
(`loadSessionIntoView(folder, { afterAnalysis: true })`): the pipeline has
rewritten `annotations.json`, `stats.json`, `analysis.json` and the map
file.

## 8. The automatic analysis

There is no Analyze button (AD-22). `flow-view.js` runs the pipeline by
itself:

- **On open**, when `normalize-result.analysisNeed(session)` says so: no
  `stats.json` or `analysis.json`, or an `analysis.json` whose `format` is
  missing or lower than `ANALYSIS_FORMAT` (the number
  `normalization/pipeline_stages.py` writes, 2 now). Once per folder in a
  window, never from an analysis's own reload, and not while
  `annotations.json` cannot be read.
- **After a change the drafts depend on**: *Leave apps out* and a range
  excluded from the analysis.
- **Inside the acts that need a current map file**: *Edit as the As-Is map*
  and the PDD export, when `process_map_step.bpmn` is missing or older than
  the steps.

Two runs are deliberate and ask first when the session has steps: *Apply N
marker changes* (the status line) and *Re-analyze* (Help, Troubleshooting).
Every analysis passes `--mine` (the PDD export's own run does not); every
run passes `--names` when the saved names store exists.

Runs go one at a time (`runPipeline` queues them). While one lasts the
status line says "Updating steps and map..." with Cancel, the page stays as
it is, and the main process refuses annotation writes to that folder. A
failed run opens the analysis log (`#log-host`) with its failure sentence
first; a cancelled one does not. Confirmed, edited, added and hidden steps
survive every run.

## 9. Edits, undo and saving

Every annotation write in the renderer goes through `session.js`:

- `saveAnnotationsWithUndo(annotations, label)` writes, and only a write that
  reached the disk becomes an undo entry (the state before the edit).
- `persistAnnotations(annotations, label, topics)` saves with undo and emits
  the topics (default `steps` and `timeline`).
- `saveAnnotationsDirect` writes without an undo entry: opening a run
  (`opened_runs`) and *Leave apps out* (an analysis follows at once).
- A failed write shows one error toast and rejects, so the caller's success
  message never follows an unsaved edit; the edit stays in memory and the
  next successful save writes it.
- `performUndo()` and `performRedo()` write the snapshot back and re-render
  in place. Opening a run is not an edit: the runs opened so far stay
  opened across an undo. The stacks are reset when another folder opens.

The main process writes `annotations.json` through `annotations-store.js`:
the current file is copied to `annotations.json.2` (the older copies move to
`.3`, `.4`, `.5`), the new content goes to a temp file that is renamed over
it, and a file that cannot be read is never replaced.

What each level edits: the Steps level the steps, `pattern_run`,
`opened_runs` and `step_filters`; the Timeline `marker_edits`,
`excluded_ranges`, `external_video` and the notes at a moment; the step
pane a step's fields (its flow, `only_when` and `links`, included), its
screenshots, notes and attachments; the Overview `document` and the
attachments; the Map `reference_maps` and the copies' files in
`derived_maps/`. Written by the main process directly, not through the undo
stack: `external_video` (Attach and Sync video), the transcript's sync, and
the two stores on the analyst's machine (saved names, saved processes,
whose Undo is a toast action).

**The save state** ([`save-state.js`](../../viewer/save-state.js),
`#save-state` in the top bar) says whether the analyst's work reached the
folder. Its sources: the main process's `viewer:projectWrite` reports
(section 1) and, for the map files the renderer writes itself, `noteWrite`
with the channel `map` (a new copy or a duplicate from `refmap-ui.js`, the
editor's delayed write from `bpmn-viewer.js`). The rules:

- *Saving...* shows once a write has lasted 300 ms, so a quick save does
  not flash; the word fades in again after each save.
- A failed annotations or map save leaves the change on screen, and only a
  later save of the same kind writes it: *Not saved* stays until then. A
  failed write of another kind (a video, a transcript, a file) left nothing
  waiting, so the next successful save of any kind ends it. The act's own
  error toast still shows.
- An `annotations.json` that cannot be read is *Not saved* from the moment
  the project opens.
- Opening another project starts over; a report for another folder changes
  nothing.

## 10. Exports

The Export menu's items live in `renderer.js`; the PDD and the BPMN file
share `exportArtifact` with the Overview's last act. Every export ends the
same way: its folder opens in Explorer with the file selected
(`viewer:revealFile`), and a toast names the file. The analyst stays on the
level they are on.

- **PDD (.docx).** The maps are drawn off screen by bpmn-js
  (`RefmapUI.renderPddMaps`): the As-Is copy chosen for the PDD and the
  To-Be copy, as PNG files passed with `--pdd-map-image` and
  `--pdd-tobe-image`. With no As-Is copy, the map from the transactions
  (`process_map_step.bpmn`, analyzed first when it is missing or older than
  the steps) is drawn the same way. The pipeline writes the document to a
  temp path that was empty before the run, and the analyst is offered the
  file only when this run wrote it (`pddExportOutcome`). While the Map says
  why it draws nothing, the PDD says so too.
- **Process map (image)** (`exportMapSvg`). The chosen As-Is copy, else
  `process_map_step.bpmn` (analyzed first when it is missing or older than
  the steps), drawn off screen by the PDD's renderer
  (`RefmapUI.renderBpmnToSvg`) and saved as SVG: the picture the PDD
  prints, whatever level is on screen. While the Map says why it draws no
  map, nothing is saved and the toast says so.
- **Process map (BPMN).** The chosen As-Is copy, else
  `process_map_step.bpmn` (analyzed first when it is missing).
- **Whole project (.zip)** (`exportProjectZip`). The main process zips the
  project folder next to it (`viewer:exportProjectZip`, `project-zip.js`):
  `<name>.zip`, or `<name> (2).zip` when that name is taken, so an earlier
  zip is never replaced. The zip's root is the folder itself, so extracting
  it gives the project back. While it is made, Export pulses (`aria-busy`)
  and its item reads "Making the zip..."; the toast gives the zip's size. A
  project whose analysis is running is refused (the pipeline replaces files
  through temporary ones), and so is a second zip of the same project.
