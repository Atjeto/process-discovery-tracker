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
  once the update is done.
- **Removed files wait for an Undo.** A screenshot or an attachment the
  analyst removed moves to `<userData>/pdt-removed/`, and back when an Undo
  names it again; that folder is emptied when the viewer starts.
- **Vendored libraries** load as globals from `index.html`: cytoscape with
  cytoscape-dagre (the live map) and the bpmn-js modeler (the As-Is view,
  the map editor and the off-screen map pictures).

## 2. The shell and the four levels

**The top bar** (`index.html` `.topbar`) is the one bar: the Open menu, the
four level buttons, the status line, the Export menu, Help and the theme
toggle. The levels, the status line and Export show once a session is open
(`.app.has-session`).

- **Open** (`#btn-recent-menu`): *Open recording...*, *New from a video...*,
  *New without a recording...* (contract C16), then the recent recordings.
- **The status line** (`#session-pills`): "Updating steps and map..." with
  Cancel while the pipeline runs; else, when marker changes wait, the one
  call to action *Apply N marker changes*; else nothing.
- **Export**: *PDD (.docx)*, *Process map (image)*, *Process map (BPMN)*
  (section 10).

**The four levels** are `.view-mode-btn[data-level]` buttons; each shows one
container. The Overview is the default on load.

| Level | `data-level` | Container | Render entry |
|---|---|---|---|
| Overview | `overview` | `#session-layout-overview` | `renderOverviewLevel()`, [`views/overview-view.js`](../../viewer/views/overview-view.js) |
| Timeline | `flow` | `#session-layout-flow` | `renderTimeline()`, [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) |
| Steps | `steps` | `#session-layout-steps` | `renderStepsLevel()`, [`views/steps-view.js`](../../viewer/views/steps-view.js) |
| Map | `map` | `#session-layout-map` | `renderMapLevel()` in `renderer.js`, with [`map-controller.js`](../../viewer/map-controller.js) and [`refmap-ui.js`](../../viewer/refmap-ui.js) |

- **Overview**: the "What is left" line (five stages: Runs, Reference run,
  Other runs, Document, PDD, each done or not from the session data alone,
  and one button for the next act; it shrinks to one line once only the
  export is left); the recording line (its name, who recorded it, its runs,
  the reference run's steps, the video and the transcript with their
  Attach, Replace and Remove, and warning lines only when a marker problem,
  a missing file, a check that could not run or an app recorded with less
  detail needs one); the Document (the ten fields of contract C6, the
  Attachments list, and "From the transcript" while one is attached); the
  Observations ([`views/analysis-view.js`](../../viewer/views/analysis-view.js):
  Data typed twice, and Where the time goes per step and per system). Until
  the session is analyzed it shows one note that says where the analysis is.
- **Timeline**: the timeline with its lanes, the video pane, the side panel
  (Screenshots, Markers) and the Raw events drawer, which shows on this
  level only. Detail: [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md).
- **Steps**: the runs in time order, one open at a time (the reference run
  with Confirm run or Reopen run and Save as this process; each other run
  with its differences; "Outside runs"), and the step pane beside them.
  The toolbar has *+ Add step*, the bulk Hide and Merge buttons (shown when
  two or more rows are ticked), *Leave apps out...* and *Saved names...*.
- **Map**: the process map drawn from the runs' steps, each box naming its
  system under its name; when an As-Is copy is chosen for the PDD it shows
  first, read only, with Edit and a way back to the map from the runs. The
  one act is *Edit as the As-Is map*; *Edited maps* opens the gallery of
  copies; the editor is a full-screen overlay (`#refmap-editor-overlay`).
  While the session is not analyzed, no run is marked or the run check
  could not run, the map shows a message that says why instead.

**The step panel** (`#step-panel`,
[`views/step-panel.js`](../../viewer/views/step-panel.js)) sits beside the
level on screen. It has three doors: a click on a map box, a click on a
timeline step band, and a selected Steps row (Watch in the step pane opens
it and plays the step). It names the step, its system and screen, its
description and "In N of M runs, about Xs each", then lists one row per
occurrence across the runs: "Run 1 at 0:39" with a play button for its own
small video, the step's screenshots, what was said then and its notes. Its
foot says *Open in Steps*, or *Show on timeline* on the Steps level. It
closes on the Overview; closed on Steps, it stays closed while rows are
selected, until a door opens it again.

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

## 3. Module map

Every file below is in `viewer/` unless it says `views/`. Tests sit next to
their module as `<name>.test.js`.

**Entry and shell**

| File | Owns |
|---|---|
| `main.js` | The main process: the window, every `viewer:*` handler (section 5), `loadSessionData()`, the path checks, the one-analysis lock, the holding folder for removed files. |
| `index.html` | The markup: the top bar, the four level containers, the step panel, the playback bar, Help, the map editor overlay. |
| `renderer.js` | The wiring entry: the level switcher, the Map level's data source (`_sessionMapData`, the system per box), the state bus subscriptions, the keyboard shortcuts, Help, the playback bar, the Open and Export menus, the exports (section 10), boot. |
| `styles.css` | Every style rule, the light and dark tokens ([DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)). |
| `ipc.js` | One typed wrapper per `viewer:*` channel; nothing else touches `ipcRenderer`. |
| `state.js` | The central store, the topic bus, the undo and redo stacks (section 6). |
| `session.js` | Annotation saves with undo, `persistAnnotations`, undo and redo in place, `ensureAnnoShape` (section 9). |
| `dom.js` | `$`, `$$`, escaping, `formatDuration`, the one clock (`clock`, `recordingStartMs`, `sinceStart`, `parseClock`), `toast`, `placeMenu` (a menu kept inside the window). |
| `modals.js` | `promptModal`, `confirmModal`, `formModal`: themed dialogs. |
| `theme.js` | The light and dark theme, its persistence, the per-app band colours and the map's colour snapshot. |
| `recent.js` | The recent recordings (`pdt.recentSessions`): the list on the empty state; the Open menu reads it too. |
| `layout-controls.js` | The Timeline's resize handles and video modes (expanded, full screen); wires itself when required. |
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

**Views** (`views/`)

| File | Owns |
|---|---|
| `overview-view.js` | The Overview: What is left (`pathState`), the recording line, the Document fields and their saves, "From the transcript", the Map's lock message (`mapLockHtml`), the note shown while the analysis is missing. |
| `analysis-view.js` | The Overview's Observations: Data typed twice, Where the time goes. |
| `flow-view.js` | The Timeline hub: session load (`loadSessionIntoView`), the automatic analysis and the status line (section 8), New from a video and New without a recording, the Run select, range selection, the timeline menus (insert a marker, add a note, jump to a step), the Raw events table. |
| `flow-view-timeline.js` | The timeline: the lane stack, the minimap, the lanes menu, zoom and scroll persistence, the summary line. |
| `flow-view-video.js` | The video and the timeline: the span a video project runs on, the playhead, seeking, Attach video and Sync video (two clicks). |
| `flow-view-screenshots.js` | The Screenshots panel, the gallery, and the guarded open of a screenshot. |
| `flow-view-markers.js` | The Markers panel: the markers with the analyst's changes laid over them, move, delete, rename. |
| `flow-view-transcript.js` | The Transcript lane, the transcript's Sync, Attach, Replace and Remove. |
| `flow-view-apps.js` | Per-app band colours, the system a band names, the legend. |
| `steps-view.js` | The Steps level: the runs and their steps, every step verb (rename, split, merge, hide, delete an added step, add, move an untimed step, waste), Confirm run and Reopen run, Use as reference run, Save as this process, the comparison with a saved process, the Leave apps out and Saved names dialogs. |
| `step-panel.js` | The step panel (section 2). |
| `analyst-ui.js` | What the analyst adds, on screen (C16): the System field, the screenshots (Add screenshot, Use in PDD, Remove, Ctrl+V), notes on a step or a moment, attachments on a step and on the Overview. |

**Models** (pure: no DOM, no state; the unit tests drive them)

| File | Owns |
|---|---|
| `runs-model.js` | The runs and their steps as the Steps level shows them: the reference run (C3), step order (time, then `order`), chips and statuses, the carried merges, the probe line, saved-name propagation. |
| `run-differences.js` | How a run differs from its reference; one rule with the PDD, pinned by `shared/run-differences-golden.json`. |
| `marker-edits.js` | The markers with `annotations.marker_edits` laid over them; which edits are pending until the next analysis. |
| `process-map-levels.js` | The process map as a directly-follows graph from the runs' steps (`buildAnnotationDfg`, `mapNodeLabel`), and the value-free `processLabel` and `screenType` from the shared rule files. |
| `system-names.js` | The one vocabulary of systems (C14) from `shared/system-names.json`: `systemName`, `whereOfStep`, the systems the System field offers. |
| `step-facts.js` | What the step pane and the panel say about a step: the fact line ("Salesforce · Account lookup · 6s · ends at Search · Run 1 at 0:19"), the fields typed, the drafted narration shown as a hint. |
| `analyst-content.js` | The pure half of C16: where an untimed step goes and how it moves, the screenshots a step shows, the notes of a step or a moment, the implicit run's id. |
| `transcript-model.js` | The transcript's time rule (its own sync, else the video's) and every pick of sentences (for a step, outside the runs, by speaker or search). |
| `session-summary.js` | The recording line's facts, the name in Recents, the marker problems. |
| `reference-maps.js` | The edited maps store (ADR-0019): `annotations.reference_maps[]` plus `derived_maps/<id>.bpmn`. |
| `case-scope.js` | The Run select's options, escaped. |
| `recognition.js` | Platform recognition of an interaction (ADR-0011), for the step pane's interaction list. |
| `identity-line.js` | The one readable line per captured control in that list. |
| `timeline/timeline-core.js` | Ticks, lane packing and the lane stack ([VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md)). |

**Widgets**

| File | Owns |
|---|---|
| `step-editor.js` | The step rows of a run and the step pane: the fact line, Name, System, the fields typed, Description, "Said during this step", Waste, Watch, Hide, the screenshots, notes and attachments, and under More the interactions, Show on timeline, Split, Merge. Name and System save on Enter or when the field is left, Description when it is left: there is no Save button. |
| `map-controller.js` | The Map's live process map: draws the data source, its fit control, a box click to the step panel. |
| `dfg-viewer.js` | The directly-follows graph on cytoscape and dagre, left to right, time-weighted edges with an edge tip in words; dragged layouts persist per node set; `exportSvg` for the map image. |
| `refmap-ui.js` | The edited maps: the As-Is map shown first, the edit act (it analyzes first when the steps changed since the map file was written), the gallery, the editor overlay, and the off-screen pictures of the maps for the PDD. |
| `bpmn-viewer.js` | The bpmn-js modeler in the editor overlay: the copy opens on its own saved layout and each edit saves back into it. |

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
buttons reach `flow-view.js`), so the graph stays acyclic.

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
| | `viewer:revealFile` | Shows a file in its folder. |
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

Two messages go the other way: `viewer:openInitialSession` (the
`--session` folder, once at startup) and `viewer:normalizeLog` (the
pipeline's output as it runs), exposed as `onOpenInitialSession(fn)` and
`onNormalizeLog(fn)`.

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
| `caseScope` | The Run select: a run id, or `""` for all runs (it dims the other runs on the timeline only). |
| `zoomFactor` | The Timeline's zoom. |
| `selectionRange` | A Shift-drag range on the timeline. |
| `pendingStepJump`, `pendingStepReveal` | A moment or a step the Steps level should show on arrival. |
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
| `pdt.recentSessions` | `recent.js` | The recent recordings. |
| `pdt.theme` | `theme.js` | `light` or `dark` (the inline script in `index.html` reads it before the first paint). |
| `pdt.timelineState` | `flow-view-timeline.js` | Per session folder, the timeline's zoom and scroll. |
| `pdt.timelineLanes` | `flow-view-timeline.js` | Which lanes are shown. |
| `pdt.timelineHeight`, `pdt.videoWidth` | `layout-controls.js` | The dragged pane sizes. |
| `pdt.analysis.<item>` | `analysis-view.js` | Whether an Observations item is open. |
| `pdt.dfgLayout.<hash>` | `dfg-viewer.js` | A dragged map layout, per set of boxes. |

## 7. Render pipeline

**Load.** `loadSessionIntoView(folder)` (`flow-view.js`):

```
Ipc.loadSession(folder) -> State.setSession(...)
  -> undo stack reset (another folder) and a new undo baseline
  -> the top bar's levels show; the annotations error banner; Recents
  -> the video (or the slim no-video band), + Step and Sync video only with a video
  -> renderTimeline, the Raw events table, the Screenshots and Markers panels,
     the timeline summary, renderStepsLevel, renderOverviewLevel, the Run select
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
pane a step's fields, its screenshots, notes and attachments; the Overview
`document` and the attachments; the Map `reference_maps`. Written by the
main process directly, not through the undo stack: `external_video` (Attach
and Sync video), the transcript's sync, and the two stores on the analyst's
machine (saved names, saved processes, whose Undo is a toast action).

## 10. Exports

The Export menu and the Overview's last act share one path
(`exportArtifact` in `renderer.js`):

- **PDD (.docx).** The maps are drawn off screen by bpmn-js
  (`RefmapUI.renderPddMaps`): the As-Is copy chosen for the PDD and the
  To-Be copy, as PNG files passed with `--pdd-map-image` and
  `--pdd-tobe-image`. With no As-Is copy, the map from the runs
  (`process_map_step.bpmn`, analyzed first when it is missing or older than
  the steps) is drawn the same way. The pipeline writes the document to a
  temp path that was empty before the run, and the analyst is offered the
  file only when this run wrote it (`pddExportOutcome`). While the Map says
  why it draws nothing, the PDD says so too.
- **Process map (image).** The chosen As-Is copy as SVG (bpmn-js), else the
  map on the Map level (`dfg-viewer.exportSvg`, opening the Map first).
- **Process map (BPMN).** The chosen As-Is copy, else
  `process_map_step.bpmn` (analyzed first when it is missing).
