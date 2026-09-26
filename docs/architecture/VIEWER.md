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
11. [A hand-off opened read only](#11-a-hand-off-opened-read-only-contract-c20)
12. [Several windows](#12-several-windows-lane-mw)

## 1. Process model

The viewer is an Electron app: one **main process**
([`main.js`](../../viewer/main.js)) and one **renderer**
([`index.html`](../../viewer/index.html), its entry script
[`renderer.js`](../../viewer/renderer.js) and the modules that entry
`require()`s). There is no bundler: every module is plain CommonJS.

- **One process, several windows** (lane MW, section 12), 1400x900 for the
  first, no application menu. A `--session=<folder>` argument (the folder
  must hold a `manifest.json`) is sent to the renderer once, after the
  page's first `did-finish-load`, as `viewer:openInitialSession`. A page
  reload therefore opens nothing: a driver relaunches instead. One viewer
  runs per user profile: a second start opens a new window in the running
  one (with its `--session`) and ends.
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
- **One analysis at a time** in a window, and of a project. While
  `normalize.py` runs on a folder, the main process refuses annotation
  writes to that folder (the pipeline rewrites `annotations.json`), from
  any window: the analyst is told to make the change again once the update
  is done. A zip of that project waits too (section 10), and so does a
  second analysis of it.
- **Every write of a project folder is reported.** The handlers that write
  into a folder (`annotations.json`, the video, the transcript, a screenshot,
  an attachment) send `viewer:projectWrite` as the write starts and again
  with its result; a handler that asks for a file first reports nothing
  when the dialog is cancelled. The top bar's save state listens (section
  9). The analysis and the exports report nothing.
- **Removed files wait for an Undo.** A screenshot, an attachment, the
  attached video's copy in `video/` (Remove video, and the copy Replace
  video replaces) or an edited map's file in `derived_maps/` (the Map's
  Delete) the analyst removed moves to `<userData>/pdt-removed/`, and back
  when an Undo names it again (`analyst-files.js`: the files
  `annotations.json` names). Remove transcript parks `transcript.json` and
  its originals there too, under a folder of its own, and its Undo puts them
  back. A video kept anywhere else, the OBS recording included, is never
  moved. That folder is emptied when the viewer starts. A file that cannot
  be moved (open in another program, no room left) is named in the save's
  answer (`filesError`), and the viewer says so in an error message that
  the act's own success message does not cover (`dom.js` toast `hold`).
- **Libraries.** `index.html` loads cytoscape, cytoscape-dagre and the
  bpmn-js modeler as globals (the live map, the map editor and the
  off-screen map pictures). `dfg-viewer.js` requires `@dagrejs/dagre` to lay
  the live map out itself (cytoscape-dagre is the fallback), and
  `asis-view.js` requires bpmn-js's navigated viewer for the map the PDD
  prints.

## 2. The shell and the four levels

**The top bar** (`index.html` `.topbar`) is the one bar: the New and Open
menus, the four level buttons, the status line, the save state, the Export
menu, Help and the theme toggle. The levels, the status line, the save
state and Export show once a project is open (`.app.has-session`). Opening
one menu closes the others.

- **New** (`#btn-new-menu`): *New project from a video...* and *New empty
  project...* (contract C16).
- **Open** (`#btn-recent-menu`): *Open project...* (a recorder's folder or
  a project made with New), *Open a hand-off (.zip)...* (a hand-off, opened
  read only: section 11), then the recent projects.
- **The status line** (`#session-pills`): "Updating steps and map..." with
  Cancel while the pipeline runs (an export's own run says what it writes:
  "Writing the PDD...", "Writing the Technical details...", "Handing off
  version N..."); else, when marker changes wait, the one call to action
  *Apply N marker changes*; else nothing.
- **The save state** (`#save-state`): *Saved* (the time of the last save
  and the folder in its tooltip), *Saving...* while a write lasts, *Not
  saved* in the error colour (what was not saved and why in its tooltip)
  until a later save succeeds (section 9).
- **Export**: *PDD (.docx)*, *Technical details (.xlsx)*, *Process map
  (image)*, *Process map (BPMN)*, *Hand off...*, *Whole project (.zip)*
  (section 10); in a hand-off opened read only, *PDD of this version*,
  *Technical details of this version* and the two map exports (section 11).

**The four levels** are `.view-mode-btn[data-level]` buttons; each shows one
container. The Overview is the default on load.

| Level | `data-level` | Container | Render entry |
|---|---|---|---|
| Overview | `overview` | `#session-layout-overview` | `renderOverviewLevel()`, [`views/overview-view.js`](../../viewer/views/overview-view.js) |
| Timeline | `flow` | `#session-layout-flow` | `renderTimeline()`, [`views/flow-view-timeline.js`](../../viewer/views/flow-view-timeline.js) |
| Steps | `steps` | `#session-layout-steps` | `renderStepsLevel()`, [`views/steps-view.js`](../../viewer/views/steps-view.js) |
| Map | `map` | `#session-layout-map` | `renderMapLevel()` in `renderer.js`, with [`refmap-ui.js`](../../viewer/refmap-ui.js) (which picture, [`map-view.js`](../../viewer/map-view.js)), [`asis-view.js`](../../viewer/asis-view.js) and [`map-controller.js`](../../viewer/map-controller.js) |

- **Overview**: the Checklist (five acts: Mark the transactions, Confirm
  the reference transaction, Review the other transactions, Write the
  document, Export the PDD; each ticked or not from the session data alone,
  so the export is never ticked; each with a tooltip that says what it
  means, and one button for the next act; while the As-Is map the PDD
  prints was made before the steps changed, *Check the As-Is map* comes
  before the export (lane FX2, `asis-freshness.js`); it shrinks to one line
  once only the export is left); the project
  line (its name, who recorded it, the request, its transactions, the
  reference transaction's steps, the video and the transcript with their
  Attach, Replace and Remove (the video's Remove only for a video the
  analyst attached), and warning lines only when a marker problem, a
  missing file, a check that could not run or an app recorded with less
  detail needs one); the Document ("You write these. The PDD prints them.":
  the twelve fields of contract C6, an empty one showing its question in
  light italics, a status that counts ten of them, all but the Request and
  the Notes, which are optional ("N of 10 written") and, once one is
  written, names the empty ones, the Attachments list, and "From the
  transcript" while one is attached). The Request the analyst writes
  (2.0.1) is the project's request on the project line and in its tooltip
  (`session-summary.js` `documentRequest`), else the capture's
  (`requestOf`); a transcript sentence is never added to it. The Overview
  measures nothing: the PDD's own sections (the systems and the
  information used, the volume and effort) are the document's alone
  (2.0.1), and opening the Overview never runs an analysis. Until the
  project is analyzed it shows one note that says where the analysis is.
- **Timeline**: the timeline with its lanes and their header column (a key
  and a name per lane, like a video editor's track headers), the video pane,
  the side panel (Screenshots, Markers) and the Raw events drawer, which
  shows on this level only. Detail: [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md).
- **Steps**: the transactions in time order, one open at a time, under one
  line that says what a transaction is (the reference transaction with
  Confirm transaction, and *Undo confirm* beside its Confirmed badge once it
  is confirmed; each other transaction with its differences; "Outside the
  transactions"), each step row showing when its step starts on the one
  clock and each transaction's head its time ("under 1s", "42s", "2m 07s":
  `dom.js` `formatDuration`), and the step pane beside them. The divider
  between the two moves with a drag
  or, focused, with Left, Right, Home and End; a double-click or Enter gives
  the usual widths back (`pane-splitter.js`; at 1100px wide or less the two
  stack, without it). The toolbar has *+ Add step*, the bulk Hide, Merge
  and *Group into a sub-process...* buttons (shown when two or more rows
  are ticked), and one quiet tool, *Apps outside the process...*. The list
  shows one level at a time (contract C19, below). The step pane's name
  field offers the activities of the step's system from the project's
  activity library (contract C21, `library.js`; Help, *Build the library...*,
  makes a new one).
- **Map** (lane MV, [`map-view.js`](../../viewer/map-view.js) decides): the
  map the PDD prints shows first, the As-Is copy chosen for the PDD, else
  `process_map_step.bpmn`, drawn by bpmn-js, read only and linked
  ([`asis-view.js`](../../viewer/asis-view.js), C18): a task opens the step
  panel on the step it stands for, a file opens its attachment, a note shows
  its whole text, a system label (and the legend of a copy made before
  2.0.1) takes no click; drag pans, Ctrl and the wheel zoom, and the Map's
  fit fits it. It is drawn on the editor's page with no
  frame around it, each exclusive gateway with its marker as the editor and
  the PDD's picture draw it. One header line (`#map-view-bar`) says which
  picture shows: "Process map (the PDD prints this map)", or the copy's name
  and "(edited; the PDD prints this map)" with the copy's *Edit*, and
  *Show how the transactions ran*. While that copy was made before the steps
  changed (lane FX2: `asis-freshness.js` compares the signature of the maps
  the steps draw now with the one the copy kept, `forked_from_steps`), the
  line says so (`#map-view-stale`) with *Copy again*
  (`#btn-map-asis-recopy`): a new copy of the process map, named like it,
  kept at its first change, which then takes its place in the PDD (the old
  copy stays in the gallery). That second view is the live map drawn
  from the transactions' steps between a Start and an End circle, each box
  naming its system under its name, the arrows weighted by time (the tip
  says how often each was taken); a condition set in Steps labels its line,
  and a path set in Steps that no transaction took is dashed (contract
  C17); its line says "How the transactions ran" with the way back, *Show
  the process map* (*Show the As-Is map* with a copy). The view chosen holds
  per project for the window. `process_map_step.bpmn` changes only when the
  project is analyzed, so while it is the picture needed and older than
  `annotations.json`, the Map analyzes first (section 8), keeping the
  picture it had; a map that cannot be drawn (the analysis failed, or wrote
  none) leaves the level to the live map with one line saying why
  (`#map-view-why`). The one act is *Edit as the As-Is map*: the editor, a
  full-screen overlay (`#refmap-editor-overlay`), opens on a new copy that
  is kept at its first change (in the map, its name or its role); leaving
  it without one keeps nothing, no row and no file, and a copy whose
  changes were all undone is taken back when the editor closes. While the
  editor shows, the keyboard is its own (bpmn-js's, bound to the document
  until it closes): Ctrl+Z and Ctrl+Y undo and redo the map's changes, and
  none of the viewer's shortcuts act underneath. *Edited
  maps* opens the gallery of copies, where a copy the process map changed
  after says what *Copy again* gives. While the project is not analyzed, no
  transaction is marked, the transaction check could not run or the level
  has no step, the live map shows a message that says why instead, and
  nothing else shows. With a sub-process (C19), the picker beside the title
  (`#map-picker`, "Map: <name>") lists every map of `mapTree` depth first,
  indented, each sub-process with its number, and sets `State.mapPath`. The
  picture shows the plane of that level (`map-planes.js` finds it by the
  path of names): the copy's when it has one, else the process map's, with
  one line saying the copy has none, as the PDD prints it. The live map
  draws that level from its traces; a sub-process's box carries a + (a click
  opens the panel at that level, a double-click its map), and dragged
  layouts are kept per level. Once a box of the live map was dragged,
  *Reset layout* shows beside *Fit* (`#btn-session-map-reset-layout`, lane
  CC): it forgets the arrangement kept for that level and draws the map
  laid out again. bpmn-js's own drill down (its arrow, its
  breadcrumbs) moves `State.mapPath` and the picker with it; a plane the
  project has no map for leaves them as they are.

**The step panel** (`#step-panel`,
[`views/step-panel.js`](../../viewer/views/step-panel.js)) sits beside the
level on screen. It has three doors: a click on a map box, a click on a
timeline step band, and a selected Steps row (Watch in the step pane opens
it and plays the step); a task of the map the PDD prints is a map box too. It names
the step, its system and screen, its description, its flow in one short
line when one is set (contract C17: "Only when ... · Goes back to step 2
when ...") and "In N of M transactions, about Xs each" (without "about ...
each" when the mean is under a second), then says how often the
step happened ("This step happened 5 times: once in transactions 1, 3 and 4,
twice in transaction 2. Play any of them.") and lists one row per time:
"Transaction 1 · 0:39 into the recording · took 8s" ("Transaction 2, again"
for a second time in one transaction; "took under 1s", never "0s") with a
play button for its own small video, which opens paused on the row the
panel opened on, then the step's
screenshots, what was said then and its notes, each under a small lead. Its foot says *Open in Steps*, or *Show on timeline* on the
Steps level, and *Open sub-process* for a sub-process. At a level below the
main one (C19) the panel shows the occurrences of the step's node in every
visit of that level. A task of that map that no step stands for (added or
renamed in the editor, or its step renamed or hidden since the copy was
made) opens the panel on its name, with one line saying no step has it. The panel closes on the Overview; closed on Steps, it stays
closed while rows are selected, until a door opens it again. How the
transactions ran fits again when the panel opens or closes beside it
(`dfg-viewer.js` `resize`, 2.0.1).

**Sub-processes** (contract C19; [`sub-process-maps.js`](../../viewer/sub-process-maps.js),
[`sub-process-verbs.js`](../../viewer/sub-process-verbs.js)). A step with
`sub_steps` is a sub-process, at any depth. The Steps list shows one level
at a time: `State.mapPath`, the path of map nodes from the main map down
(`[]` the main level), which the step panel, the Timeline's steps lane and
the Map follow too (a map chosen on the Map lets go of a step selected at
another level, so Steps opens there). A sub-process row carries
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
`action_key`; the cells of one sheet filled one after another (two or
more `DataItem` controls named by a cell address) are one sub-step named
by their columns ("Fill in columns A to F", keyed
`<app>|<screen>|cells:A-F`, described "Entered 20 cells, A2 to F5."),
while a single cell stays "Enter B7"; drafts become edited; the new level
opens; on a recorded step
with fewer than two actions the step pane's button is disabled with the
reason and the step menu leaves it out, 2.0.1), *Group into a
sub-process...* (two or more ticked steps one after the other in one
transaction; the same stretches in every transaction are grouped too, and
the links move with them), *+ Add step* (into the open visit), *Dissolve
sub-process* (a group gives its steps back in its place; an opened step
drops its sub-steps, whose screenshots, notes and attachments move to it;
one confirm names the descriptions and flow that go). A sub-process's name
reaches every occurrence of its node at its level; a drafted sub-step's
name reaches the drafts of its action and is saved under `action|` and its
key. Confirm transaction and Undo confirm reach every level, and the
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

**Help** (`#help-modal`) holds the analyst's guide in eight sections
(Getting started, Steps, Map, Markers, Recording keys, Hand-offs,
Shortcuts, Troubleshooting), the version, and *Re-analyze*
(Troubleshooting) for an analysis that stopped. Getting started is the
process managers' guide, `docs/HOW-TO.md` in the same words
(`e2e/session-smoke.js` checks every sentence against the document): what
PDT does, starting a project, the first hour, everyday tasks, the hand-off,
where things are kept, the library, the messages that need an act, and a
glossary. The other sections say more about each part; Hand-offs adds what
a version's PDD says and how a hand-off opens.

## 3. Module map

Every file below is in `viewer/` unless it says `views/`. Tests sit next to
their module as `<name>.test.js`.

**Entry and shell**

| File | Owns |
|---|---|
| `main.js` | The main process: the windows and the one-viewer-per-profile lock (section 12), every `viewer:*` handler (section 5), `loadSessionData()`, the path checks, the one-analysis lock, the write reports (`viewer:projectWrite`), the holding folder for removed files. |
| `window-registry.js` | Lane MW: which window shows which project, in the main process; a project open for editing in one window opens read only in another (`open`, `close`, `readOnlyHere`, `editorOf`). Pure. |
| `index.html` | The markup: the top bar, the four level containers, the step panel, the playback bar, Help, the map editor overlay. |
| `renderer.js` | The wiring entry: the level switcher, the Map level's live map data (`_sessionMapData`, the system per box; whether it draws, `_liveMapState`; C19: the level shown, `_mapLevel`, and its picker), the state bus subscriptions, the keyboard shortcuts, Help, the playback bar, the New, Open and Export menus, the exports (section 10), the save state's mount, boot. |
| `save-state.js` | The save state in the top bar (section 9): its pure state (`applyWrite`, `view`) and the element it drives, fed by `Ipc.onProjectWrite` and by `noteWrite` for the map files the renderer writes. |
| `styles.css` | Every style rule, the light and dark tokens ([DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)). |
| `ipc.js` | One typed wrapper per `viewer:*` channel; nothing else touches `ipcRenderer`. |
| `state.js` | The central store, the topic bus, the undo and redo stacks (section 6). |
| `session.js` | Annotation saves with undo, `persistAnnotations`, undo and redo in place, `ensureAnnoShape` (section 9). |
| `dom.js` | `$`, `$$`, escaping, `formatDuration` (2.0.1: the one way a length reads in the app, the rule the step map's documentation shares (`step_context.fmt_ms`): "under 1s", "42s", "2m 07s", "3m", "1h 04m"; never "0s", "28.9s", "414ms" or "2:17", which is a moment; the Timeline's summary, bands and Raw events, the live map's tips and `step-facts.js` `formatMs` use it), the one clock (`clock`, `recordingStartMs`, `sinceStart`, `parseClock`), `toast`, `placeMenu` (a menu kept inside the window). |
| `modals.js` | `promptModal` (`required`: OK waits for some text), `confirmModal`: themed dialogs. |
| `handoff.js` | Pure (contract C20): the versions of `annotations.handoffs` (`entries`, `latest`, `nextVersion`, `newEntry`), the one line a version says (`handedOffLine`, the PDD's words; `readOnlyLine`), the project's name as the app shows it and made safe for Windows, and the hand-off's file names. |
| `read-only.js` | A hand-off opened read only (C20): `isReadOnly(session)`, the check every verb reachable without a control makes, and `lockInputs` (the step pane's and the document's fields read only); lane MW: `isOpenElsewhere` and `reasonFor`, for a project open for editing in another window. |
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
| `annotations-store.js` | Reading `annotations.json` (an unreadable file is reported, never treated as absent, with the newest backup that can be read), the backups `.2` to `.5`, the temp-file-then-rename write, and Restore the newest backup (`restoreNewestBackup`: the unreadable file kept as `annotations.unreadable-<time>.json`, the backup copied into place). |
| `transcript-store.js` | `transcript.json`: read, save the sync offset, and the files Remove transcript takes out (`transcriptFiles`: the file and the originals in `transcript/`) (C8). |
| `analyst-files.js` | The files the analyst adds (C16): screenshots in `screenshots/analyst/`, attachments in `attachments/` (a free name when one is taken), the move of removed files and back (the video's copy in `video/` and the edited maps' files too, lane CC), the parking of a removed transcript's files for its Undo (`parkFiles`, `restoreParked`), which attachment opens. |
| `new-project.js` | A session without a recording (C16): `manifest.json` (`session_id`, `source`, `started_at`, `label`), an empty `events.jsonl`, `annotations.json`, and for a video project the video copied into `video/` at offset 0. |
| `video-path.js` | Pure: where an attached video is kept (copied into `video/`, stored relative to the folder) and how a stored path is found again on another machine. |
| `project-zip.js` | Export, Whole project (.zip): where the zip goes (next to the folder, `<name>.zip`, else `<name> (2).zip` and on), one more try when a save replaced a file while the zip was made, the sentence for a failure, the size. |
| `handoff-zip.js` | Export, Hand off... (contract C20): `<project> v<N>.zip` next to the folder (never over another zip), the folder zipped by `zip-folder.js`, then the PDD and the Technical details of the version appended at the zip's root (`appendFiles`), built as `.building` and renamed when complete. |
| `library.js` | The activity library (contract C21): the app's file (`library/activities.json`, `resources/library/activities.json` in the package, `PDT_LIBRARY` for tests), reading one (a missing or invalid file is an empty library), the project's `library.json` before the app's (`projectLibrary`), the pipeline's checks mirrored (`problems`), and the pure look-ups the step pane needs (`pickerFor`, `filterActivities`, `applyActivity`, `codeOf`) and Help's line (`summaryLine`). Used by the main process and the renderer. |
| `handoff-open.js` | A hand-off zip opened read only (C20): whether it is one (`inspectHandoff`: one project folder whose `annotations.json` lists a version, and at the root the PDD and the Technical details of the version it lists last; a whole project's zip is none), its extraction under `<userData>/handoffs/<project> v<N>/` (streamed, each file's size and CRC checked, no entry outside the folder, a temporary folder renamed when complete, the same zip finding its folder again through `.pdt-handoff.json`), `isReadOnlyProject` (the rule main refuses writes by: a folder under `<userData>/handoffs`, or a hand-off unzipped by hand, its PDD and Technical details beside it), `handoffFile` (the PDD or the workbook it came with) and `readProjectZip` (C21: a zip's project manifest and annotations, read where it is, for the Library builder). |
| `zip-folder.js` | The zip writer (PKZIP 2.0 without ZIP64, UTF-8 names, written as `.partial` and renamed at the end): a copy of `capture/zip-folder.js`, kept identical by `project-zip.test.js`, since a packaged viewer cannot reach `capture/`. |
| `project-folder.js` | Which folder a chosen folder opens (lane FX2): a project folder, or the one project folder inside it (the folder Windows' Extract All makes of the SME's zip); any other folder is refused with a sentence that says what to open. |
| `staged-outputs.js` | What a stopped analysis leaves (lane FX1): the `*.pdt-staged` files `normalize.py` writes before it moves its outputs in, removed once a cancelled run's process has ended. |

**Views** (`views/`)

| File | Owns |
|---|---|
| `overview-view.js` | The Overview: the Checklist (`pathState`), the project line (in a hand-off opened read only its first line, the version, `#ov-handoff`), the Document fields, their saves and status, "From the transcript", the Map's lock and empty messages (`mapLockHtml`, `mapEmptyText`), and the note shown while the analysis is missing. |
| `handoff-ui.js` | Export, Hand off... (contract C20): the dialog, the version entry (one undoable edit, taken back when the hand-off does not finish), the PDD and the Technical details of the version (`writeDocuments`, renderer.js), the zip; and in a hand-off opened read only, its PDD and workbook opened in their programs. |
| `flow-view.js` | The Timeline hub: project load (`loadSessionIntoView`, which also tells the save state and draws the Map again when it shows), the automatic analysis and the status line (section 8; `analysisBusy` while a run is queued or running), New project from a video and New empty project, the Transaction select, range selection and its card (Insert transaction from selection; Leave out of the analysis, and Include again on a band left out: lane CC), the timeline menus (start or end a transaction, add a note, jump to a step), the Raw events table (jump, + step), the unreadable banner and its Restore the newest backup. |
| `flow-view-timeline.js` | The timeline: the lane stack, the stretches left out of the analysis drawn hatched over the Systems lane (`leftOutBands`), the minimap, the lanes menu, zoom and scroll persistence, the summary line. |
| `flow-view-video.js` | The video and the timeline: the span a video project runs on, the playhead, seeking, Attach video (Replace) and Sync video (two clicks), each one undoable edit of `external_video`, and Remove video (lane CC). |
| `flow-view-screenshots.js` | The Screenshots panel, the gallery, and the guarded open of a screenshot. |
| `flow-view-markers.js` | The Markers panel: the markers with the analyst's changes laid over them, move, delete, rename. |
| `flow-view-transcript.js` | The Transcript lane, the transcript's Sync, Attach, Replace and Remove. |
| `flow-view-apps.js` | Per-app band colours, the system a band names, the legend. |
| `steps-view.js` | The Steps level: the transactions and their steps, the line that says what a transaction is, every step verb (rename, split, merge, hide, delete an added step, add, move an untimed step, waste, the flow of contract C17: one undoable edit each, and the links to a step dropped or moved when it is hidden, deleted, merged or split), Confirm transaction and Undo confirm (a link beside the Confirmed badge), Use as reference transaction, the Apps outside the process dialog, a pick from the library (C21: `pickActivityAction`; a name typed that is an activity of the step's system is that pick, any other name leaves the library). C19: the level shown (`goToLevel`, the breadcrumb, one block per visit) and the sub-process verbs (Open as a sub-process, Group into a sub-process, Dissolve sub-process), every verb working at the level shown. |
| `step-panel.js` | The step panel (section 2), its flow line, the panel at a level below the main one and its *Open sub-process* (C19), and the panel for an As-Is task no step stands for (`openForMissing`). |
| `analyst-ui.js` | What the analyst adds, on screen (C16): the System field, the screenshots (Add screenshot, Use in PDD, Remove, Ctrl+V), notes on a step or a moment, attachments on a step and on the Overview. |
| `library-builder-ui.js` | The Library builder (C21; Help, *Build the library...*), the owner's tool: Add projects... and Add hand-off zips..., the named steps by system, a row each to tick and fix (name, code, description), the same screens named differently side by side as one conflict, and Save library... (a new version, checked as the pipeline checks a library, the app's own file offered first). |

**Models** (pure: no DOM, no state; the unit tests drive them)

| File | Owns |
|---|---|
| `runs-model.js` | The runs and their steps as the Steps level shows them: their titles ("Transaction N"; a marker label that only numbers its run is not shown, `numberOnlyLabel`), the reference run (C3), step order (time, then `order`), chips and statuses, the carried merges, the probe line, a rename's propagation to the same drafts (`propagateName`), the names a row's rename suggests (`nameSuggestions`: the names used in the project). C19: Confirm and Undo confirm (`reopenRun`) reach every level, a status reads every visible level (`patternConfirmed`, `holdsDraft`), and names propagate at every level (`propagateActionName`). |
| `sub-process-maps.js` | The maps a project holds (C19): `mapTree` (one map per sub-process, its traces, its number; one rule with the pipeline's `sub_process_maps.py`, pinned by `shared/sub-process-maps-golden.json`), the tree finder `findStep` (a step at any depth, its list, parent and level), a level's places (`levelVisits`, one per visit), the visits of a node, `validPath`, `nodeName`, `mainMapName`. |
| `sub-process-verbs.js` | The pure half of the sub-process verbs (C19): the sub-steps drafted from a step's recorded actions (`draftSubSteps`, `action_key`; 2.0.1: the cells of one sheet filled one after another folded into one, "Fill in columns A to F", `cellOf`), Open as a sub-process, Group into a sub-process with its link repairs, Dissolve (and what it takes away), the rename of a sub-process's every occurrence. |
| `run-differences.js` | How a run differs from its reference; one rule with the PDD, pinned by `shared/run-differences-golden.json`. After the merge folding, a step whose own align key the reference lacks but whose name is a reference step's (whitespace collapsed, case ignored) is that step (`namedAlike`, 2.0.1). The Steps level passes its words (`REFERENCE_RUN`, `RUN_UNIT`: "transaction"). |
| `marker-edits.js` | The markers with `annotations.marker_edits` laid over them; which edits are pending until the next analysis. |
| `process-map-levels.js` | The process map as a directly-follows graph from the runs' steps, with the Start and End events and the step flow of contract C17 (`buildAnnotationDfg`, `flowEdges`, `stepLinks`, `mapNodeLabel`, where a drafted step or sub-step, with a `draft_key` or an `action_key`, is its name; one rule with the step BPMN, pinned by `shared/flow-links-golden.json`), and the value-free `processLabel` and `screenType` from the shared rule files. |
| `step-flow.js` | The pure half of the step flow (C17): what the Flow line and the step panel say (`linkReading`, `panelLine`, `inheritedLine`), the steps a link can go to, the edits, and the repairs when a target step is hidden, removed, merged or split. |
| `asis-links.js` | What a click on the map the PDD prints does (C18): a task names its step's map box, a data object its attachment (`DataObjectReference_<id>`), a text annotation its note; a system label (`isSystemLabel`: `TextAnnotation_system_<k>`, or a map's one `TextAnnotation_system`), the legend of a copy made before 2.0.1, the flows, the events and the gateways do nothing. C19: a task and a collapsed sub-process carry their level (the names of the sub-processes around them), `projectPath` reads those names as the project's own sub-processes, and the ids in a plane are read without its `Sub<n>_` prefix. |
| `map-view.js` | Which picture the Map shows (lane MV): the map the PDD prints (the chosen As-Is copy, else `process_map_step.bpmn`; at a sub-process the copy's plane, else the step map's) or how the transactions ran, when the Map analyzes first (the step map needed and older than the steps, no analysis running or already run for that change), the line that says why a picture does not show (`WHY`), and the words of the one header line (`line`). |
| `map-planes.js` | The maps of one BPMN file (C19): each sub-process's plane found by its path of names (`findPlane`), the path of an element's level and of a plane's root, the `Sub<n>_` prefix (`baseId`), the PDD's map pictures (`pddMaps`, the manifest `pddManifest`) and an exported image's name (`imageName`). |
| `system-names.js` | The one vocabulary of systems (C14) from `shared/system-names.json`: `systemName`, the site rule's `siteName` (2.0.1: a browser window on a site no rule names is named by the site its title ends with), `whereOfStep`, the systems the System field offers. |
| `step-facts.js` | What the step pane and the panel say about a step: the fact line ("Salesforce · SO-01 · Account lookup · 6s · ends at Search · Transaction 1 at 0:19", the code of a step named from the library next to the system, C21), the fields typed, the drafted narration shown as a hint, and a length as the viewer writes it (`formatMs`, `dom.js` `formatDuration`). |
| `library-builder.js` | The Library builder's model (C21): the steps a project's analysts named (`namedSteps`: confirmed, edited or added by hand, with their screens), one entry per name in a system (`collect`), the rows (`rows`: the library's activities ticked, the projects' names after them, clusters of rows that share screens or a name, a conflict where the same screens carry different names), the library the ticked rows make (`buildLibrary`: a name the library has adds its screens to that activity), the version (`nextVersion`: the date and a counter). |
| `analyst-content.js` | The pure half of C16: where an untimed step goes and how it moves, the screenshots a step shows, the notes of a step or a moment, the implicit run's id. |
| `transcript-model.js` | The transcript's time rule (its own sync, else the video's; a sentence said before the recording reads "0:28 before") and every pick of sentences (for a step, outside the transactions, by speaker or search). |
| `session-summary.js` | The project line's facts, the request (the document's, `documentRequest`, 2.0.1, else the capture's, `requestOf`, AD-30), the name in Recents, the name an export is offered under (`exportBaseName`, lane FX3), the marker problems. |
| `reference-maps.js` | The edited maps store (ADR-0019): `annotations.reference_maps[]` plus `derived_maps/<id>.bpmn`; a new copy's row with nothing written (`forkEntry`, lane MV) or written at once (`fork`), keeping the signature of the maps its steps drew (`forked_from_steps`, lane FX2); for a copy made before that was kept, whether it is out of date (`isStale`: the signature of the process it was made from, `processSignature`, against the current one; a byte hash for a copy made before signatures); `predatesRichMap` tells a copy made before the map had its systems, notes and attachments (C18: none of a user or manual task, the legend, a colour or, since 2.0.1, a system label). |
| `asis-freshness.js` | Whether an edited copy was made from the steps as they are now (lane FX2): `stepsMapSignature` (every map of the project, its boxes and lines, each box's notes, files, system, hand marker, sub-process and waste mark, and the Trigger and the Result), `copyStale` (the signature a copy kept, else `reference-maps.js` `isStale`), `chosenAsIsStale` for the Map's line and the Checklist. |
| `case-scope.js` | The Transaction select's options ("Transaction 1 · Order #10900"), escaped. |
| `recognition.js` | Platform recognition of an interaction (ADR-0011), for the step pane's interaction list. |
| `identity-line.js` | The one readable line per captured control in that list (no marker on it: a project is recorded once, lane CC). |
| `timeline/timeline-core.js` | Ticks, lane packing and the lane stack ([VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md)). |

**Widgets**

| File | Owns |
|---|---|
| `step-editor.js` | The step rows of a run (each with when its step starts on the one clock, 2.0.1) and the step pane: the fact line, Name (C21: its picker, the library's activities of the step's system under the field, opened by a click, typing or Down; a click or Enter picks one; with none, one quiet line while the field has the focus), System, the fields typed, Description, "Said during this step", the Flow line (C17: "Always · then the next step", *Only when...*, *Go to...* with a dropdown of the transaction's steps and End the process), Waste, Watch, Hide, *Open as a sub-process* (disabled with its reason on a recorded step with fewer than two actions; on a sub-process *Open sub-process* and *Dissolve sub-process*, C19), the screenshots, notes and attachments, and under More the interactions, Show on timeline, Split, Merge. Name, System, a condition and a link's "when" save on Enter or when the field is left, a link's target when it is picked, Description when it is left: there is no Save button. A double-click renames the row its first click landed on, even when that click's redraw moved the rows. |
| `map-controller.js` | The Map's live map, how the transactions ran: draws the data source once it has an edge (the Start's and the End's count), its fit control, a box click to the step panel, a double-click on a sub-process's box to its map (C19). |
| `dfg-viewer.js` | The live map on cytoscape, laid out left to right by `@dagrejs/dagre` with room for the condition labels and every line routed around the boxes (cytoscape-dagre is the fallback): the Start and End circles, time-weighted edges, the conditions on their lines, a dashed line for a path set in Steps that no transaction took, an edge tip in words; dragged layouts persist per node set (and per level, C19); a sub-process's box carries a + (a small square at its foot); `resize` fits the map again when the step panel opens or closes beside it (2.0.1). |
| `refmap-ui.js` | The Map level's picture and the edited maps (lane MV): which picture shows and when it is drawn again (`syncMapView`, the facts for `map-view.js`: the view chosen, the copy, `process_map_step.bpmn` and whether it is current, the planes each file has once drawn), its one header line and the line that says why, the Map's own analysis once per change (`mapBusy` while it runs), the step map kept current across the edited maps' own saves and the PDD's run (`keepingStepMapCurrent`); the edit act (it analyzes first when the steps changed since the map file was written, or waits for the Map's own analysis), the new copy kept at its first change and dropped when it was left unchanged, the gallery (with what *Copy again* gives), the editor overlay, the map files it writes reported to the save state, and the off-screen renderer of the PDD's pictures and Export's map image (`renderBpmnToPng`, `renderBpmnToSvg`; C19: a plane per path, `renderPlanesToPng`, `renderPlaneToSvg`). |
| `asis-view.js` | The map the PDD prints on the Map level (C18): bpmn-js's navigated viewer, read only and fitted, each exclusive gateway with its marker as the modeler draws it, its clicks (`asis-links.js`: the step panel, an attachment, the note popover `#map-asis-note`; the system labels, and the legend of a copy made before 2.0.1, marked inert). C19: the plane of a level (`showLevel`, each plane fitted the first time; the drawn file's `definitions` for the planes it has), bpmn-js's own drill down told to the Map (`configure`'s `onLevel`), the main map's crumb named. |
| `bpmn-viewer.js` | The bpmn-js modeler in the editor overlay: a copy opens on its own saved layout, a new one from its XML before its file exists (`xml`, lane MV); each edit, undo and redo is heard first (`onChange`: a new copy is kept then), written back after a short delay and reported to the save state; `flush` writes a waiting edit when the editor closes or another map opens; `changed` tells whether the map differs from the one opened. |
| `bpmn-text-wrap.js` | A bpmn-js module (lane FX3) given to every bpmn-js the viewer creates (the Map's picture, the editor, the PDD's and Export's pictures): each name is wrapped between words in its own font and box before diagram-js lays it out, so a word that fits a line is never cut in two (`wrapLines`, `innerWidth`). Only the text drawn changes, never the diagram's file. |

## 4. The module graph

`renderer.js` requires the views and wires them together. A module never
requires `renderer.js`: the glue it needs is injected at boot as lazy
wrappers, so the load order does not matter.

```
renderer.js
  initFlowView({ rerenderActiveLevel, addStepAtTimestamp })
  initSession({ renderSessionPills, reloadSession, analyzeSession })
  initRecent({ onOpenSession })
  initStepsView({ ensureAnnoShape, persistAnnotations, jumpToStepInFlow,
                  watchStep, analyze })
  HandoffUI.initHandoffUI({ writeDocuments })
  RefmapUI.initRefmapUI({ renderLiveMap, renderMap, liveMap, analysisBusy,
                          sourceBpmnPath, analyze, mapPath, onAsIsLevel,
                          mainMapName, hasSteps })
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
| | `viewer:openInNewWindow` | Lane MW: the project folder given (or the one project folder it holds) opens in a new window; `{ ok: false, error }` and no window when it is no project. |
| | `viewer:openHandoffDialog` | The file picker for a hand-off zip (C20): the chosen `.zip` path, or null. |
| | `viewer:loadSession` | Loads a folder (below), or a hand-off zip: extracted under `<userData>/handoffs` (`handoff-open.js`) and its project loaded read only, the answer adding `openedZip` and `handoffReused`. The window that asked now holds the project (section 12). |
| Analysis | `viewer:runNormalizeExtended` | Runs `normalize.py` (`mine`, `pddOut`, `pddMapImage`, `pddTobeImage`, `pddMapImages`, and C20's `techOut` and `handoff`; C21's `--library`, the app's library file, when it exists and the pipeline takes the flag); streams its log. |
| | `viewer:cancelNormalize` | Stops the run in progress. |
| Annotations | `viewer:saveAnnotations` | The backup copies, then the atomic write; moves removed analyst files out and back (screenshots, attachments, the video's copy, the edited maps' files). |
| | `viewer:restoreAnnotationsBackup` | The unreadable banner's Restore the newest backup: keeps the unreadable file as `annotations.unreadable-<time>.json`, copies the newest readable backup into place (the one confirmed, else refused). |
| The activity library (C21) | `viewer:readAppLibrary` | The app's library file, read (Help's line, the builder's start). |
| | `viewer:libraryAddProjects`, `viewer:libraryAddZips` | The Library builder's sources: a folder or a zip dialog, then each project's `manifest.json` and `annotations.json` (a zip read where it is), and the ones that could not be read. |
| | `viewer:saveLibrary` | The builder's library, checked again, then a save dialog on the app's library file and a temp-file-then-rename write. |
| Export and shell | `viewer:exportFile` | A save dialog, then a copy of the given file. |
| | `viewer:saveSvgFile` | A save dialog, then the SVG text. |
| | `viewer:exportProjectZip` | Zips an open project next to its folder (`project-zip.js`); refused while that project's analysis runs, one zip of a project at a time. Answers the zip's path, size and entry count. |
| | `viewer:exportHandoffZip` | Contract C20: the hand-off's zip next to the folder, with the PDD and the Technical details passed at its root (`handoff-zip.js`); the same refusals as the Whole project zip, and a project opened read only. |
| | `viewer:openHandoffFile` | Contract C20: in a hand-off opened read only, opens the PDD (`kind` "pdd") or the Technical details ("tech") it came with. |
| | `viewer:revealFile` | Shows a file in its folder (Explorer, the file selected). |
| | `viewer:openExternal` | Opens a screenshot, after the path checks (section 1). |
| Video | `viewer:attachExternalVideo` | The video file picker. |
| | `viewer:copyVideoIn` | Copies the video into `video/` when it is outside the folder and answers the path to store (relative when it is in the folder); the renderer writes `external_video` as one undoable edit. |
| Transcript (C8) | `viewer:importTranscript` | The file picker, then `transcript_import.py`. |
| | `viewer:removeTranscript` | Parks `transcript.json` and the originals in `transcript/` for an Undo; answers where (`tag`, `files`). |
| | `viewer:restoreTranscript` | The Undo of a removal: the parked files come back (a file attached since is kept). |
| | `viewer:saveTranscriptSync` | Writes the sync offset. |
| New projects (C16) | `viewer:chooseNewProject` | For a video project the video, then one save dialog for the project's name and folder. |
| | `viewer:createProject` | Makes the folder chosen last. |
| Analyst files (C16) | `viewer:addScreenshot` | Writes `screenshots/analyst/<id>.<png\|jpg>` from a file, a video frame or a pasted image. |
| | `viewer:addAttachment` | The file picker, then a copy into `attachments/`. |
| | `viewer:openAttachment` | Opens an attachment of a loaded session, or shows it in its folder. |

Three messages go the other way: `viewer:openInitialSession` (the project
a window opens as it loads: the `--session` folder, or the one a new window
was made for), `viewer:normalizeLog` (the
pipeline's output as it runs) and `viewer:projectWrite` (each write of a
project folder: `{ folder, channel, phase: "start" }`, then `{ folder,
channel, phase: "end", ok, error, code }`, `channel` one of `annotations`,
`video`, `transcript`, `screenshot`, `attachment`), exposed as
`onOpenInitialSession(fn)`, `onNormalizeLog(fn)` and `onProjectWrite(fn)`.

`loadSessionData()` in `main.js` assembles the session the renderer holds:

```
{ sessionFolder, manifest, events, stats, analysis, annotations,
  annotationsError, obsSync, recordingPath, recordingAvailable,
  externalVideoOffsetMs, integrity, transcript, transcriptError, readOnly }
```

`readOnly` (contract C20) is true for a folder under `<userData>/handoffs`,
where a hand-off opens: every handler that writes a project folder, or runs
the analysis, refuses such a folder first (`_refuseReadOnly`), before any
dialog and before the save state hears of a write. `viewer:loadSession`
adds `openElsewhere` (lane MW): true, with `readOnly` true, when another
window has the project open for editing; those handlers refuse that
window's writes the same way.

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
| `mapPath` | The level shown (C19): the path of map nodes from the main map down, `[]` the main level. The Steps list, the step panel, the Timeline's steps lane and the Map follow it; a project opened resets it. |
| `analysisRun` | `{ folder, status }` of the last run: `running`, `failed` or `cancelled` (null once one succeeds). |
| undo and redo stacks | Annotation snapshots, at most 50 each, each pinned to its session folder. |

`State.subscribe(topic, fn)`, `State.emit(topic)` and `State.batch(fn)` are
the bus. The topics and who listens (`renderer.js`):

| Topic | Re-renders |
|---|---|
| `steps` | the Steps level, the Overview, the Map, the step panel |
| `timeline` | the timeline, the Screenshots panel |
| `markers` | the Markers panel, the status line, the Overview |
| `analysis` | the Overview |
| `mapPath` | the Map (the step panel's *Open sub-process* on the Map) |

**Kept on this machine** (`localStorage`, every key starts with `pdt.`):

| Key | Written by | Holds |
|---|---|---|
| `pdt.recentSessions` | `recent.js` | The recent projects. |
| `pdt.theme` | `theme.js` | `light` or `dark` (the inline script in `index.html` reads it before the first paint). |
| `pdt.timelineState` | `flow-view-timeline.js` | Per session folder, the timeline's zoom and scroll. |
| `pdt.timelineLanes` | `flow-view-timeline.js` | Which lanes are shown. |
| `pdt.timelineHeight`, `pdt.videoWidth` | `layout-controls.js` | The dragged pane sizes. |
| `pdt.stepsSplit` | `pane-splitter.js` | The Steps level's divider: the transactions' share of the width. |
| `pdt.dfgLayout.<hash>` | `dfg-viewer.js` | A dragged map layout, per set of boxes (and per level below the main map, C19); Reset layout removes it. |

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
whichever is on screen; the Map renders only while it is on screen, and on
load when it is (a project opened, or reloaded after an analysis, while the
Map shows).

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
  `normalization/pipeline_stages.py` writes, 5 now: 4 gave the project
  line its `coverage_caveat`, lane FX1, and 5 cut the PDD's rows the
  Overview no longer shows). Once per folder in a
  window, never from an analysis's own reload, and not while
  `annotations.json` cannot be read.
- **After a change the drafts depend on**: *Apps outside the process*, a
  stretch left out of the analysis and *Include again*, and an undo or a
  redo of either of those two (`session.js` `revertFollowUp`).
- **Inside the acts that need a current map file**: *Edit as the As-Is map*,
  the PDD export and the two map exports, when `process_map_step.bpmn` is
  missing or older than the steps.
- **On the Map** (lane MV, `refmap-ui.js`): when the picture it shows is
  `process_map_step.bpmn` (no As-Is copy is chosen, or the copy has no map
  for the level shown) and that file is missing or older than
  `annotations.json`, as the Map opens or a step changes while it shows. Once
  per change: never while a run is queued or running (`analysisBusy`), and
  not again for the `annotations.json` it ran for or the one it left, also
  when it failed or wrote no map (the Map then says so over the live map).
  The picture shown before stays meanwhile, and the Map draws again when the
  run ends. How the transactions ran needs no analysis. The edited maps' own
  saves and the PDD's run rewrite `annotations.json` without changing a step,
  so a step map current before them stays current.

Two runs are deliberate and ask first when the session has steps: *Apply N
marker changes* (the status line) and *Re-analyze* (Help, Troubleshooting).
Every analysis passes `--mine` (the PDD export's own run does not); every
run passes `--library` with the app's library file when it exists (contract
C21: a project's first analysis copies it into the folder as
`library.json`, and the project keeps that copy). The session the viewer
loads carries the library the project reads (`library`: its `library.json`,
else the app's).

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
  (`opened_runs`), *Apps outside the process* (an analysis follows at once)
  and the taking back of a new map copy whose changes were all undone
  (`refmap-ui.js`).
- A failed write shows one error toast and rejects, so the caller's success
  message never follows an unsaved edit; the edit stays in memory and the
  next successful save writes it.
- `performUndo()` and `performRedo()` write the snapshot back and re-render
  in place. Opening a run is not an edit: the runs opened so far stay
  opened across an undo. The stacks are reset when another folder opens.
  An undo or a redo that changes `excluded_ranges` analyzes again, and one
  that changes `external_video` reloads the project (where the video is is
  read as it loads): `revertFollowUp` (lane CC).
- `recordFileAct(label, { undo, redo })` puts a change of files that
  `annotations.json` does not name on the same stacks: Remove transcript,
  whose undo puts its parked files back and whose redo takes them out
  again (lane CC).
- The map editor has its own undo (bpmn-js's command stack): while it
  shows, Ctrl+Z and Ctrl+Y are its keys, and `renderer.js` runs none of the
  viewer's shortcuts (lane MV).

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
`derived_maps/` (a new copy only at its first change: the Map's Edit left
without one writes nothing). Attach, Replace, Sync and Remove video write
`external_video` through the undo stack like any edit (lane CC). Written by
the main process directly, not through the undo stack: the transcript's
attach and sync. (The saved processes of contract C5 left the app on
2026-09-24: a process is recorded once; the remembered step names of C4 on
2026-09-25, contract C21: files left in `pdt-library` are not read.)

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
- A hand-off opened read only reads *Read only*, its version in the
  tooltip, and no report changes that (contract C20).

## 10. Exports

The Export menu's items live in `renderer.js`; the PDD and the BPMN file
share `exportArtifact` with the Overview's last act. Every export ends the
same way: its folder opens in Explorer with the file selected
(`viewer:revealFile`), and a toast names the file. The analyst stays on the
level they are on. A file is offered under the project's name and its kind
(`session-summary.exportBaseName`, lane FX3): the document title once it is
written, else the recording's name (`manifest.label`), else the request,
else the folder's name, made fit for a Windows file name: *Order to cash
PDD.docx*, *Order to cash map.bpmn*, *Order to cash As-Is map.bpmn*.

- **PDD (.docx).** The maps are drawn off screen by bpmn-js
  (`RefmapUI.renderPddMaps`): the As-Is copy chosen for the PDD and the
  To-Be copy, as PNG files passed with `--pdd-map-image` and
  `--pdd-tobe-image`. With no As-Is copy, the map from the transactions
  (`process_map_step.bpmn`, analyzed first when it is missing or older than
  the steps) is drawn the same way. C19: each sub-process's map with a
  number (`map-planes.pddMaps`) gets a picture too, the As-Is copy's plane
  for its path when the copy has one, else the step BPMN's
  (`RefmapUI.renderPlanesToPng`), listed in a manifest in a temp folder and
  passed with `--pdd-map-images`. The pipeline writes the document to a
  temp path that was empty before the run, and the analyst is offered the
  file only when this run wrote it (`pddExportOutcome`). While the Map says
  why it draws nothing, the PDD says so too.
- **Process map (image)** (`exportMapSvg`). The map the PDD prints, at the
  level the Map shows (the main map unless the picker chose a sub-process): its plane in the chosen As-Is
  copy, else in `process_map_step.bpmn` (analyzed first when it is missing
  or older than the steps), drawn off screen by the PDD's renderer
  (`RefmapUI.renderPlaneToSvg`) and saved as SVG, offered as
  `<project> map.svg` or `<project> As-Is map.svg`, and a sub-process's as
  `<project> map of sub-process <number>.svg` (`map-planes.imageName`). While the Map says why it draws no map, nothing is saved
  and the toast says so.
- **Process map (BPMN).** The chosen As-Is copy, else
  `process_map_step.bpmn` (analyzed first when it is missing or older than
  the steps): one file with every map.
- **Technical details (.xlsx)** (`exportTechDetails`, contract C20). The
  pipeline writes the workbook (`--tech-out`) to a temp path in one run, as
  the PDD does, and it is offered as `<project> Technical details.xlsx`. The PDD and
  the workbook share `writeDocuments`: the maps drawn first for the PDD,
  one run, each file offered only when this run wrote it.
- **Hand off...** (`views/handoff-ui.js`, contract C20). One dialog, "What
  changed in this version?" (filled with "First hand-off" for version 1; OK
  waits for a note). The entry `{ version, handed_off_at, by (the Windows
  user), note }` goes into `annotations.handoffs` as one undoable edit
  ("Hand off version N (the zip file stays)"), the step map kept current
  (`keepingStepMapCurrent`); then `writeDocuments` makes the PDD and the
  Technical details for the version (`--handoff N`: the analysis first when
  the step map is older than the steps, as for the PDD), and the main
  process writes `<project> v<N>.zip` next to the folder
  (`viewer:exportHandoffZip`): the folder, and at the zip's root
  `<project> v<N> PDD.docx` and `<project> v<N> Technical details.xlsx`.
  `<project>` is the name the Overview shows (`session-summary.js
  displayName`), made safe for a file name. A zip is never written over
  another (" (2)" and on). Explorer opens at the zip, and the toast says
  that Ctrl+Z takes the version back while the zip stays. A hand-off that
  does not finish takes its entry back at once (`session.js
  takeBackLastEdit`, or an edit of its own when another edit came after
  it), so no version is recorded without its zip. Export pulses while it
  is made, and its item reads "Handing off...".
- **Whole project (.zip)** (`exportProjectZip`). The main process zips the
  project folder next to it (`viewer:exportProjectZip`, `project-zip.js`):
  `<name>.zip`, or `<name> (2).zip` when that name is taken, so an earlier
  zip is never replaced. The zip's root is the folder itself, so extracting
  it gives the project back. While it is made, Export pulses (`aria-busy`)
  and its item reads "Making the zip..."; the toast gives the zip's size. A
  project whose analysis is running is refused (the pipeline replaces files
  through temporary ones), and so is a second zip of the same project.

## 11. A hand-off opened read only (contract C20)

The owner: a developer builds from a hand-off and adds nothing to it; the
analyst's project is where changes are made. *Open a hand-off (.zip)...*
(`#btn-open-handoff` in the Open menu, `#btn-open-handoff-hero` on the page
shown while no project is open) asks for the zip with a file dialog
(`viewer:openHandoffDialog`; Windows' folder dialog, the one *Open
project...* shows, lists folders only): `viewer:loadSession` extracts it
under `<userData>/handoffs/<project> v<N>/` (`handoff-open.js`), or finds
where the same zip was extracted before, and loads its project folder with
`readOnly: true`. A newer version
is a zip, and a folder, of its own: it just opens, and nothing compares it
with another. A zip that is no hand-off (the SME's recording) is refused
with a sentence saying to unzip it first. A hand-off unzipped by hand
(Extract All, then Open project on its folder) opens read only too: its PDD
and Technical details of the version the project lists last lie beside the
project folder (`handoff-open.js isReadOnlyProject`, the rule main refuses
writes by).

Everything can be looked at and played: every level, the step panel, the
video, the transcript, the maps (the Map shows the map the hand-off came
with), and the PDD and the Technical details it came with (Export, *PDD of
this version*, *Technical details of this version*, opened in their
programs). Nothing can change:

- **No editing control.** The page carries `.app.read-only`
  (`flow-view.js loadSessionIntoView`), and the rules in `styles.css`, beside
  the unreadable-annotations page's (lane FX2), hide every control that
  changes the project on every level: the Checklist, the project line's
  Attach, Replace and Remove, the Steps toolbar, the ticks, Confirm
  transaction and Undo confirm, the step pane's acts, the Timeline's + Step,
  Sync, the transcript lane's acts and the markers' Move and Delete, the
  Map's Edit as the As-Is map, Edited maps and Copy again, Help's
  Re-analyze, and the Export items that write. The step pane's fields and
  the document's are read only (`read-only.js lockInputs`: a dashed edge, no
  fill); the document's line names the empty fields ("Not written: ...")
  and says the analyst wrote them.
- **No verb without a control.** The shortcuts that edit (Ctrl+Z, Ctrl+Y,
  Ctrl+Enter, Alt+Up and Alt+Down, Enter, N, S and M in Steps, S on the
  Timeline) do nothing (`renderer.js _editsInReadOnly`); a double-click
  renames nothing; the right-click menus keep only the ways to look (a
  step: Open sub-process, Show on timeline, Watch; the Timeline: Jump to
  step here; a stretch left out: Go to its start); opening a transaction
  records nothing (`opened_runs`); a paste adds no screenshot.
- **No save, no analysis.** `session.js writeAnnotations` refuses a
  read-only project before the main process (so no Undo entry is ever
  recorded), the analysis never starts (on open, on the Map, from a verb:
  `analyzeSession`, `runPipeline`), and the
  main process refuses every write into a folder under `<userData>/handoffs`
  (section 5), so a control that slips through changes nothing.
- **The project line** (`#ov-handoff`, the Overview's first line) reads
  "Version 2, handed off 2026-09-25 by rasha · Read only", what changed in
  its tooltip; the top bar's save state reads *Read only*, and the Recent
  list names the entry "<name> · version 2, read only".

## 12. Several windows (lane MW)

The owner: a PM works on one project and opens another at the same time, or
keeps one open for reference while working on another. Not over
complicated: one process, several windows, no lock files.

- **Opening.** *Open in a new window...* (`#btn-open-new-window`, the Open
  menu) asks for a project folder with the folder dialog, and each recent
  project in the Open menu has a button that opens it in a new window
  (`.recent-menu-newwin`); both go through `viewer:openInNewWindow`, which
  makes a window (`main.js createWindow`, the size of the window it opens
  from, a little lower and to the right) that opens the project as it
  loads (`viewer:openInitialSession`). The project on screen stays open.
  Each window is named after its project ("Order entry · Process Discovery
  Viewer", "(read only)" added when it is), so the taskbar tells them apart.
- **One viewer per profile.** `app.requestSingleInstanceLock()`: a second
  start of the viewer (the shortcut clicked again, a `--session` launch)
  opens a new window in the running one, with its `--session` (`main.js
  sessionArg`, resolved in the folder it started in), and ends. Two
  processes on one profile did not share the recent projects and settings
  (the second got an empty Local Storage and its changes were lost when it
  closed), and the second emptied `<userData>/pdt-removed` as it started,
  taking the first one's files waiting for an Undo.
- **The same project twice.** The main process keeps which window shows
  which project (`window-registry.js`, keyed by the window's webContents
  id; a folder is one project whatever its case or slashes). A project open
  for editing in one window opens read only in another: `viewer:loadSession`
  answers `readOnly: true` and `openElsewhere: true`, and the page is a
  read-only page as in section 11 (`.app.read-only`, plus `.app.open-elsewhere`,
  which hides the hand-off's two Export items), its project line
  `#ov-elsewhere` "Open in another window: read only here" and its save
  state *Read only*, its tooltip saying where changes are made. Every
  handler that writes a project folder refuses that window's writes
  (`_refuseReadOnly(folder, sender)`), never the editing window's. A hand-off
  opens read only in every window and holds nothing.
- **Letting go.** A window that opens another project, or loads its page
  again, lets its project go; a closed window lets it go and stops an
  analysis it was running (the run moves nothing in, and its staged files
  are cleared). A window opened read only stays so; opened again once no
  window edits the project, it opens for editing. Nothing is written for
  this anywhere, so nothing is left behind and no zip can carry it.
- **Per window.** A dialog opens over the window that asked (`_winOf`), the
  write reports and the analysis log go to it, Cancel stops its own
  analysis, and New project remembers its choice per window. One analysis
  of a project runs at a time, whichever window asked. The recent projects,
  the theme and the layout are the profile's, shared by every window (a
  window reads them as it draws them).
- **Closing.** Closing a window closes only its project; the viewer ends
  with its last window.
