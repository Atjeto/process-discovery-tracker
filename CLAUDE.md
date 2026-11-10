# CLAUDE.md

Project context for Claude Code. Read *Start here* first. Full docs index:
[docs/README.md](docs/README.md).

## Start here

- **Direction (since 2026-09-23).** PDT is an internal business process
  companion for a business analyst / process manager, not a product. An SME
  records a process a few times (alone or during a call), the recorder
  drafts the steps, the analyst confirms one reference run, and the app
  produces a process map and a tool-neutral PDD. A project can also start
  from a video or from nothing.
- **Plan of record** (approved 2026-09-23):
  [docs/To-Do/BA-HELPER-PLAN-2026-09-22.md](docs/To-Do/BA-HELPER-PLAN-2026-09-22.md).
  Decisions and what was cut: [ADR-0029](docs/adr/0029-ba-helper-refocus.md).
  The reviews that reshaped the viewer:
  [STEP-BACK-REVIEW-2026-09-23.md](docs/To-Do/STEP-BACK-REVIEW-2026-09-23.md) and
  [COMPANION-CRITIQUE-2026-09-23.md](docs/To-Do/COMPANION-CRITIQUE-2026-09-23.md).
- **Cycle state** (lanes, the autonomous decisions AD-1 to AD-50, the merge
  gates): [.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md](.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md).
  Data contracts C1 to C22:
  [.claude/agent-findings/2026-09-23_ba-helper-contracts.md](.claude/agent-findings/2026-09-23_ba-helper-contracts.md).
- **Baseline** (health, CI history, code review RP-01 to RP-36):
  [docs/To-Do/RESTART-POINT-2026-09-22.md](docs/To-Do/RESTART-POINT-2026-09-22.md).
- **Owner-gated:** the P1 draft probe
  ([runbook](docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md)) and the P5 real-session
  gate ([runbook](docs/To-Do/P5-REAL-SESSION-GATE.md)). Demo data never
  closes either.
- **The shelved product.** The complete v1.5.0 product is kept on branch
  `product-edition`, tag `product-edition-v1.5.0`. Nothing of it is deleted.
- **Versions.** The current release is **v2.0.6** (2026-11-04), the light
  version (see [CHANGELOG.md](CHANGELOG.md)). v1.5.0 was the product
  edition.

History: PDT was a process-mining product from 2026-05 to v1.5.0
(2026-07-03); an ML edition is parked on branch `project-vision-ai-ml`.
[CHANGELOG.md](CHANGELOG.md) headers are the source of truth for tags.

## What this is

A Windows tool in three layers that never talk over a network:

1. **Capture** (`capture/`): the SME's tray app (Electron) with a small
   recording bar, plus a C# .NET 8 UI Automation recorder sidecar. One start:
   the bar, the tray, the welcome and the transaction key all start the
   recording with Transaction 1, then each press starts the next
   transaction. It writes an append-only `events.jsonl`, a `manifest.json`
   and screenshots (OBS video optional); the end summary makes a zip for
   the analyst.
2. **Normalization** (`normalization/`): the Python pipeline: runs from the
   markers, drafted steps, statistics and the analysis, the step-level map
   (`--mine`) and the PDD (`--pdd-out`).
3. **Viewer** (`viewer/`): the analyst's Electron app, with its own Python;
   it runs the pipeline by itself. Four levels: Overview, Timeline, Steps,
   Map.

What travels is the **session folder**: copied from the SME's machine to the
analyst's, and handed to the developers as numbered versions (*Hand-offs*
below). What the analyst adds (a video, a transcript, screenshots, notes,
attachments, edited maps) lives in it too. No AI ships inside the product.

## The analyst path

1. **Open** a recording folder (*Open project...*, Open menu) or the SME's
   zip (*Open a zip...*: unzipped where the analyst says, lane B4a), or
   start a project with *New project from a video...* (the videos and
   their transcripts in one pick, lane B4b) or *New empty project...*
   (New menu, and the page shown while no project is open, which also
   takes the same files dropped on it, lane B4c). Steps' *Paste notes...*
   turns the analyst's notes into steps and document fields in one
   undoable edit (lane E1, `notes-paste.js`). The analysis runs by itself (on open when it is missing or
   older, after Apps outside the process, after a stretch is left out of
   the analysis or included again, on the Map when the steps are newer
   than its map,
   inside Edit as the As-Is map, before a PDD export, a map export or a
   hand-off), with one status line and Cancel. *Apply N marker changes*
   stays deliberate; Help, Troubleshooting has Re-analyze.
2. **Attach** a video (copied into the folder, synced with two clicks) and a
   transcript, if any.
3. **Confirm the reference run** (run 1 unless another is picked): fix and
   name its steps, write descriptions, set the flow where it branches or
   loops (*Only when*, *Go to*), Confirm transaction.
4. **Review the other runs**: each lists its differences; they are not
   confirmed.
5. **Write the document** on the Overview (trigger, result, volume and
   effort, and improvement among its fields).
6. **Check the map**: the Map shows the map the PDD prints (the process map,
   or the edited As-Is map), with *Show how the transactions ran* one click
   away; optionally *Edit as the As-Is map* (and a To-Be copy), kept once
   something in it is changed. When the steps change after the As-Is copy
   was made, the Map and the Checklist say so, with *Copy again*.
7. **Hand off**, the Checklist's last act and the Export menu's first group
   (*For the developers and the archive*): one zip next to the folder with
   the project, the PDD, the Technical details (where something was
   recorded), the process map (SVG and BPMN) and *Start here.txt* of that
   version. The PDD's map is the edited As-Is copy when one exists, else the
   map from the runs. *For another analyst*: *Whole project (.zip)*.
   *Single files*: the PDD, the *Technical details (.xlsx)* and the map
   (image, BPMN). Each export opens Explorer at the file.

The Checklist fits the project: a recording's acts are Mark the
transactions, Confirm the reference transaction (ticked without a click when
none of its steps is a draft), Review the other transactions (only those
that differ), Write the document, Hand off; a project made from a video or
from nothing has Add the steps, Write the steps, Review the other
transactions (only with two or more), Write the document, Hand off, and a
project made from a video opens on the Timeline.

Along the way the analyst adds what the recording lacks: steps, screenshots,
notes, attachments, a step's system, the flow. Every change saves itself to
the folder.

## Layout

| Path | What |
|---|---|
| `capture/` | SME side: tray app, recording bar, end summary, transaction key; the C# recorder in `capture/recorder/` (tests in `Recorder.Tests/`). |
| `normalization/` | Analyst side Python pipeline: `normalize.py` and its stage modules; `transcript_import.py`; `golden_check.py` and `golden/`. |
| `viewer/` | Analyst side Electron app. `viewer/python/` is the bundled Python (gitignored, built by `scripts/build-python-embeddable.ps1`). |
| `e2e/` | The in-repo Playwright gate: the smokes against the real viewer, all run by `run-all.js`. |
| `shared/` | Cross-layer contracts: [SCHEMA.md](shared/SCHEMA.md) (authoritative); `recognition-patterns.json`; `system-names.json`; `process-label-patterns.json` and `screen-label-patterns.json` with their goldens; `run-differences-golden.json` (pins the viewer and the PDD to one alignment rule); `flow-links-golden.json` (pins the live map and the step BPMN to one step flow rule); `sub-process-maps-golden.json` (pins the maps a project holds, C19). |
| `docs/` | Docs, ADRs, plans and audits; index at [docs/README.md](docs/README.md). |
| `scripts/` | Build and release scripts, plus the structure-only data scripts. |
| `demo/` | The demo project that ships with the viewer (`Order to cash`, recorded live, finished by a script driving the viewer; see `demo/README.md`). Open, *Open the demo project* copies it into Documents\PDT demo, a fresh copy each time (`viewer/demo-project.js`, `PDT_DEMO_DIR` for tests). |
| `sessions/example-aggregate/` | The committed test sessions: 10 sessions of one order-to-cash process (synthetic, used by the golden and the smokes). |
| `corpus/` | Product-era test scenarios; no test or gate reads them. |
| `.claude/agent-findings/` | Cycle records: contracts, resume state, findings register, cut map. |
| `sessions/` (rest), `dist/` | Gitignored: captured sessions and build output. |

## Documentation map

| Read | When |
|---|---|
| [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) | The layers and the data flow, first. |
| [docs/architecture/DATA-MODEL.md](docs/architecture/DATA-MODEL.md), [shared/SCHEMA.md](shared/SCHEMA.md) | Session files, the annotation model. Touching session data: read SCHEMA. |
| [docs/architecture/CAPTURE.md](docs/architecture/CAPTURE.md) | The capture app and the recorder. |
| [docs/architecture/NORMALIZATION.md](docs/architecture/NORMALIZATION.md) | The pipeline: CLI, stages, modules. |
| [docs/architecture/VIEWER.md](docs/architecture/VIEWER.md), [VIEWER-TIMELINE.md](docs/architecture/VIEWER-TIMELINE.md) | The viewer: modules, levels, state, IPC, the timeline. |
| [docs/FEATURES.md](docs/FEATURES.md) | What the light version does, by component. |
| [docs/architecture/DESIGN-SYSTEM.md](docs/architecture/DESIGN-SYSTEM.md) | CSS tokens, themes, contrast, the UI copy style guide. |
| [docs/architecture/COHERENCE-AUDIT.md](docs/architecture/COHERENCE-AUDIT.md) | The discipline every new verb passes. |
| [docs/adr/](docs/adr/README.md) | Decisions; the registry is CI-enforced. |
| [CONTRIBUTING.md](CONTRIBUTING.md), [docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md), [docs/DEPLOY.md](docs/DEPLOY.md) | Dev setup, build, release, install. |
| [CHANGELOG.md](CHANGELOG.md) | Release history; `[Unreleased]` collects what lands after 2.0.6. |

## Key concepts

- **The words** (AD-29). People read *transaction* for one pass through the
  process and *project* for what the analyst opens or starts; the capture
  app's engagement reads *request* (AD-30). Code, data keys (`case_id`,
  `pattern_run`, `engagement_id`), CLI flags and file names keep run, case,
  session and engagement.
- **The drafting rule** (C1, `step_suggest.py`). Within a run, a step is a
  stretch on one screen ending at a commit (a button, menu item or link
  invocation, or a vocab `completion: true`), inclusive; at the first
  interaction on another screen; or at the run's end. Each draft carries
  `draft_key` (`"<app>|<screen>|<commit>"`), `name_source` and `end_reason`;
  merged steps keep `draft_keys`.
- **Step states:** `auto_suggested` (a draft), `confirmed`, `edited`,
  `manually_authored`, `hidden`. All but drafts survive re-analysis; drafts
  are hidden, not deleted, so an analysis cannot bring them back.
- **The reference run** (`annotations.pattern_run`, C3): default the first
  run with a step; *Use as reference transaction* picks another. Confirm
  transaction turns its drafts into `confirmed`; *Undo confirm*, a link beside
  the Confirmed badge, is the inverse. The other runs are reviewed, never
  confirmed (AD-28; `annotations.opened_runs`).
  `draft_fixes` counts its merges, splits, adds and drops: the P1 probe.
- **The activity library** (C21). The app ships one library of named
  activities per system, `library/activities.json` (`PDT_LIBRARY` names
  another, for tests); a project's first analysis copies it into the folder
  as `library.json` and keeps it (`--library`). The step pane's name field
  offers the activities of the step's system (`library.js` `pickerFor`): a
  pick sets the name, the system, `library_activity` and, when the step has
  none, the description, and the title shows the activity's code. Any
  name can still be typed; a rename still names the project's other drafts
  of its key (the session's own names). Help, *Build the library...*
  (`views/library-builder-ui.js`) is the owner's tool: it reads projects and
  hand-off zips, lists the named steps by system (the same screens named
  differently side by side) and saves a new version. The remembered step
  names (C4) are gone.
- **Runs.** Markers only, never nested: a Start while a run is open ends
  that run first. Case ids are deterministic (C9), so analyst steps stay
  attached across re-analysis. A recording without run markers has no runs.
- **Leaving things out.** *Apps outside the process* (Steps toolbar,
  `step_filters`) and *Leave out of the analysis* (a Shift-drag on the
  Timeline, `excluded_ranges`) take events out before drafting. Both show
  hatched on the Timeline; a stretch left out offers *Include again*, cuts
  its transaction's trace on both maps (C17) and is said once, first, in
  Steps and the PDD's 4.1, where the reference steps done in it are not read
  as skipped. In a project without a recording the same Shift-drag offers
  *Not part of the process* (lane E, E4: a detour of a call): the same
  `excluded_ranges` entry, one click, no analysis, and nothing reads it
  there (`left-out.js` `analysisRanges`; the pipeline's step BPMN and PDD
  likewise), so the steps marked in it stay and no map or PDD mentions it.
  Either kind is skipped when playing (a seek into it plays it) and left out
  of the Transcript tab.
- **Sessions without a recording** (C16): `manifest.source` `video` or
  `blank`, an empty `events.jsonl`, one implicit run until a Start is
  inserted; a video project's Timeline runs on the video's length. Steps
  added by hand have `time_range: null` and an `order` (Alt+Up and Alt+Down
  move one), listed after the timed steps, with no duration.
- **A step's place in the process** (C22, 2.0.5, the owner's report: a
  correction the SME shows late in a video came after every step in
  between). `step.placed_after` names the step it comes after in its
  transaction ("start": first); its `time_range` stays where it was shown.
  One order rule, `viewer/step-order.js` `processOrder` and
  `step_context.process_order`, pinned by `shared/step-order-golden.json`,
  read by Steps, both maps, the differences, the PDD and the stats; a
  hidden step is never an anchor. Verbs: Alt+Up and Alt+Down on any step,
  *Place after a step...* (the step menu, the band menu, the Flow line; into
  another transaction too), *Back to its time*; the edits write the fewest
  placements (`deriveOrder`) and a step that leaves hands its followers over
  (`keepOrder`). Marks: *Placed* on the row and the Flow line, `.placed` on
  the band, the legend's *placed elsewhere in the process*. A placed step
  belongs to its anchor's transaction (`step_suggest._follow_placement_case`).
- **Videos chained on one timeline** (C23, 2.0.6, the owner: "10th minute
  on the timeline is 10th minute on the timeline, regardless if there are 1
  or 7 videos"). `annotations.external_videos` holds the clips `{ id, path,
  offset_ms, in_ms, out_ms, length_ms }` (`viewer/video-chain.js`
  `clipsOf`, `step_context.video_clips`; 2.0.5's one `external_video` reads
  as one clip). A project made from videos runs them back to back: an add
  goes after the last, and a trim, a replace or a remove moves the clips
  after it and what is marked on them (`shiftMarks`: steps, inserted
  markers, notes and screenshots at a moment, stretches left out), refusing
  a cut that would take a mark away (`cutBlocks`); a recording places each
  clip by its sync and nothing else moves. The player shows one clip at a
  time (`flow-view-video.js`: `chainOf`, `clipAtMs`, `playheadMs`,
  `seekClock`); every time it gives or takes is a moment on the clock. The
  Videos lane (`views/video-lane.js`) trims by a dragged side or a
  right-click. One transcript per video (`transcript.json`,
  `transcript-2.json`...; `video_id`, offset from its clip's 0;
  `transcript-model.js` `partsOf`, `bindsBeforeChainEdit`). The PDD reads
  the clock only, never a video time.
- **Moving on the Timeline** (2.0.3, a PM's report; `flow-view-timeline.js`
  *Dragging a side*): a transaction's band drags its start and its end (a
  marker change, pending until Apply marker changes; the Transactions lane
  draws the markers as they now are, a band not yet applied dashed); a step
  whose time is the analyst's (`AC.stepTimeMovable`: no recorded actions)
  drags its sides, a step back to back giving way, and joins the transaction
  its start is in at once (`steps-view.js` `setStepTimes`). A side dragged
  and a right-click's new transaction or step snap within 8 px to a step's
  start or the playhead (a step's side to any side); a marker never comes
  to a step's end, which would part its last action from it. The same
  times are typed in Steps: an open transaction's *Starts at* and *Ends at*
  (`steps-view.js` `_runTimesEl`, with Apply marker changes beside a
  change), the selected step's start and end on its line of facts (a step
  without a time gets a start field); one rule set, `time-edits.js`. An
  insert edit the last analysis used keeps `applied_timestamp` and
  `applied_label` while a change to it waits (`keepApplied`). Steps are
  marked one after another (the owner: "you always add steps
  sequentially"): each step added ends the one before it, a transaction's
  end or the next one's start ends its last step, and until then the
  newest is open (`time-edits.js` `isOpen`: "open", no length, fading out
  on the Timeline). Joined sides move together (`followMarker`,
  `followRemoval`, `handBack`), and every Timeline right-click marks
  there, on a band too. A project without a recording applies its marker
  changes itself (`flow-view.js` `scheduleAutoApply`, giving way to a
  save); a recording keeps Apply marker changes.
- **What the analyst adds** (C16), inside the folder: screenshots in
  `screenshots/analyst/` (a video frame, a pasted image or a file;
  `step.pdd_screenshot` picks the one the PDD prints), notes in
  `analyst_notes` (on a step or a moment; out of the PDD's text and its map
  pictures, on the Map, the map exports and the step map beside their step;
  the old `notes` key round-trips), attachments
  in `attachments/` (listed in the PDD, and carried with it: a project with
  any exports its PDD as one zip, the PDD and `Attachments/`, the names
  linking there, `pdd-zip.js`, `--pdd-attachments`; a hand-off's PDD links
  into the project folder beside it), and `step.system`. Removing one
  deletes its entry and file; Undo restores both.
- **Step flow** (C17, AD-31). A step may carry `only_when` (a condition)
  and `links` (`[{ to: step_id | "end", when }]`: a loop back, a skip or an
  early end), set in the step pane's Flow line (*Only when...*, *Decision...*,
  its targets grouped back, ahead, another transaction's step and End).
  A draft that gets either becomes `edited`. One edge rule for the live map
  (`process-map-levels.js`) and the step BPMN (`step_flow.py`), pinned by
  `shared/flow-links-golden.json`. The live map draws Start and End circles,
  the conditions on its lines and a dashed line for a path no transaction
  took; the step BPMN gets exclusive gateways; the PDD prints the flow under
  the step.
- **System names** (C14): `shared/system-names.json` turns an application
  and a window title into the business system (Salesforce for a Chrome
  window on Salesforce), read by `app_names.py` and `system-names.js` for
  the Timeline's legend, the step pane's System, the map boxes, the panel and the
  PDD. Its site
  rule (2.0.1, `site_name`, `siteName`) names a browser window on a site no
  rule names by the site its title ends with, the browser's name dropped
  ("Order Desk"), and the screen then leaves the site out. Its
  `program_names` makes the name Windows gives a program, which the capture
  app records for the window in front ("Google Chrome"), the application a
  rule knows ("chrome"), so the Timeline names systems as the steps do. A
  `step.system` set by the analyst wins.
- **The video travels with the folder.** Attach video copies it into
  `video/` and stores its path relative to the folder; a missing absolute
  path falls back to a file of that name in the folder (`video-path.js`).
  Remove video and Replace take the copy out of the folder, and Ctrl+Z
  brings it back (lane CC).
- **One clock.** The viewer's times and the PDD's pointers read the time
  since the recording started (m:ss or h:mm:ss); the time of day shows only
  in the Timeline's summary. A Steps row shows when its step starts. A
  length reads one way in the viewer (`dom.js` `formatDuration`) and in the
  step map's documentation (`step_context.fmt_ms`): "under 1s",
  "42s", "2m 07s", "3m", "1h 04m"; never "0s", "28.9s" or "414ms", and
  never "2:17", which is a moment on the one clock.
- **The step panel** (`views/step-panel.js`): two doors (a map box, a
  Steps row; a task of the Map's picture is a map box too) open one panel
  with every occurrence of the step: its moment, a small video,
  screenshots, what was said, notes. How the transactions ran fits again
  when the panel opens or closes beside it (`dfg-viewer.js` `resize`). On
  the Map its head edits the step's name, system and description with the
  editor's own handlers (`steps-view.js` `panelFieldCallbacks`; text on
  Steps and read only). It never opens on the Timeline (`opensOn`, lane
  PANE): there a step opens in the pane beside the video.
- **The Timeline's pane** (lane PANE, plan section 11.2,
  `views/timeline-pane.js`, the pure rows in `pane-lists.js`): beside the
  video, five tabs (`#tp-tabs`, a real tablist): *Steps (n)*,
  *Transcript*, *Screenshots (n)*, *Notes (n)*, *Files (n)*; a project
  opens on Steps. The Steps tab lists every step in the order of the
  process, the ones without a time too (*Starts here* on their row,
  `flow-view.js` `showHereAt`), grouped under each transaction's header in
  a recording (the reference first; its name, *Starts at* and *Ends at*
  from `steps-view.js` `_runTimesEl`, *Rename*, *Delete transaction*: the
  Markers tab is gone). A row or a step's band opens the step in place,
  drawn by the Steps editor's own code into another host
  (`steps-view.js` `renderStepInto`; one host holds the editor at a time,
  its parts carry ids) with *All steps*, *Previous*, *Next*, *Open in
  Steps*, *Also happens in* (`step-panel.js` `occurrences`) and Steps'
  verbs (`stepVerbStates`). A step marked on the Timeline (S, Add step, a
  right-click, *Add step here*) opens there, its name focused only while
  the video is paused (`nameTakesFocus`), and takes the video's frame at
  its moment as an added screenshot in the same undoable edit
  (`analyst-ui.js` `frameAtMoment`, lane E-1). Notes and Files list every
  note and attached file; a screenshot or a note clicked on the timeline
  opens its tab at it.
- **The Timeline's screen and first row** (lane SCREEN, plan section
  11.1 and 11.3): the stage (the video, at most 58% of its width, and the
  pane) above, the timeline (`#timeline-section`) at the full width of the
  window below, and the page does not scroll there
  (`#view-session.on-timeline`); the dividers store
  `pdt.stage.timelineHeight` and `pdt.stage.videoWidth`
  (`layout-controls.js`). The row `#tl-row`: Play, the clock (a click types
  a time), Add step, Start transaction or End transaction (one button), Add
  note, the message area `#tl-message` (`dom.js` `placeToast` moves
  `#toast` there while the Timeline shows; at rest `#timeline-summary`),
  the Transaction select, Lanes, the zoom; a selected stretch shows there
  with its acts (the selection card is gone). The rules are
  `timeline-row.js`, drawn by `flow-view.js` `syncTimelineRow`. No playback
  bar, and `#video` has no controls (only during a sync's first step).
- **The Steps page is an editor** (2.0.1, the owner's review): the toolbar
  acts on the selected step (Split..., Merge with next, Hide step, the
  sub-process verbs, Delete; `_syncStepVerbs`), the rows carry a
  transaction's differences (`rowMarks`), and the selected step reads in
  one column in the order of the work: name as the title, one line of
  facts (with Play, into the step panel beside it), what you write, the
  screenshots, Recorded, what is attached (`step-editor.js`
  `_renderStepDetail`).
- **The map** (lane MV, `map-view.js`, `refmap-ui.js`). The Map shows the map
  the PDD prints: the As-Is copy chosen for the PDD, else
  `process_map_step.bpmn` (written by `--mine`), drawn by bpmn-js and linked
  (`asis-view.js`): a task opens the step panel, a file its attachment, a
  note its text; one header line says which. When that file is older than
  `annotations.json` the Map analyzes first, once per change, keeping its
  picture meanwhile. *Show how the transactions ran* is the second view: the
  live map from the runs' visible steps, each box naming its system, with
  frequencies and the paths no transaction took. *Edit as the As-Is map*
  copies the process map into an editable As-Is or To-Be map (ADR-0019; the
  pipeline never touches a copy), kept at its first change: leaving the
  editor without one keeps nothing. In the editor, Ctrl+Z and Ctrl+Y are the
  map's own (bpmn-js's keyboard, bound while it is open). A copy keeps the
  signature of the maps its steps drew (`forked_from_steps`,
  `asis-freshness.js`, lane FX2): once the steps draw another, the Map's line
  and the Checklist's *Check the As-Is map* say so, and *Copy again* makes a
  new copy, kept at its first change, which takes the old one's place in the
  PDD.
- **The richer step map** (C18, AD-32, as 2.0.1 amended it).
  `process_map_step.bpmn` names its main end after the Result and each early
  end after its `when`; a step done in a system is a plain task with a short
  text annotation above it naming the system (`TextAnnotation_system_<k>`),
  unless every task of the map done in a system is done in the same one:
  the map then says it once ("System: SAP", `TextAnnotation_system`, joined
  to nothing). A step done outside every system (added by hand, no system
  set) is a manual task, the hand marker, with no label (lane CL: the person
  marker on every box said nothing). A step's notes are a text annotation
  under its task, its attachments data objects under it; a flow that turns
  up or down leaves or enters a gateway at its top or bottom corner, and the
  map keeps its merge gateways. No colours and no legend since
  2.0.1: a label is text a process manager changes in any BPMN tool, where
  no tool could change a colour. Without a chosen As-Is copy, the Map's
  picture, Export's map image and the PDD's map picture are this file drawn
  by bpmn-js (the PDD's picture without the steps' notes, lane FX2; the
  system labels stay). A click on a system label does nothing
  (`asis-links.js` `isSystemLabel`).
- **Sub-processes** (C19, AD-33).
  - **Storage.** A step's `sub_steps` array holds its sub-steps, nested and
    the same shape as steps. `annotations.steps` stays the main level, so a
    reader that ignores `sub_steps` sees only that.
  - **Creating one.** *Open as a sub-process* drafts one sub-step per
    recorded action (`action_key`, never `draft_key`); the cells of one
    sheet filled one after another are one sub-step, "Fill in columns A to
    F" (`<app>|<screen>|cells:A-F`, 2.0.1). A recorded step with fewer
    than two actions has nothing to open: the step pane disables the verb
    with its reason and the step menu leaves it out (a step added by hand
    still opens, empty). *Group into a sub-process* adds a parent with
    `group: true`; a link it moves remembers where it was (`lifted_from`,
    `pointed_to`, lane FX2). *Dissolve* undoes either and gives each such
    link back.
  - **The maps.** `mapTree` (`viewer/sub-process-maps.js`) and `map_tree`
    (`normalization/sub_process_maps.py`) list the project's maps. They are
    pinned by `shared/sub-process-maps-golden.json`: traces per visit, the
    hierarchical numbers, the order.
  - **Where it shows.** Steps and Map share `State.mapPath`. The step BPMN
    draws each sub-process as a collapsed `bpmn:subProcess` (16 px taller
    than a task, so its name clears the + marker) with its own plane (ids
    prefixed `Sub<n>_`). The PDD prints one chapter per numbered
    sub-process (3.3 onwards), with pictures passed by the viewer through
    `--pdd-map-images`.
- **Saving and handing over.** Every change saves itself to the project
  folder; the top bar says *Saved*, *Saving...* or *Not saved*
  (`save-state.js`, fed by `viewer:projectWrite` and the map editor's
  writes). Export, *Whole project (.zip)* zips the folder next to it
  (`project-zip.js`, `zip-folder.js`, a copy of the capture app's writer),
  never over an earlier zip and not while an analysis runs.
- **Hand-offs** (C20, lane HV). *Export*, *Hand off...* asks what changed,
  adds `{ version, handed_off_at, by, note }` to `annotations.handoffs` (one
  undoable edit: Ctrl+Z takes it back, the zip stays) and writes
  `<project> v<N>.zip` next to the folder: the folder (without
  `annotations.json.2` to `.5`, `normalize.log`, `*.pdt-staged`), and at
  the zip's root the PDD, the Technical details (none where nothing was
  recorded), `<project> v<N> map.svg`, `<project> v<N> map.bpmn` and
  `Start here.txt` made for that version (`normalize.py --handoff N`,
  `--tech-out`; `viewer/handoff-zip.js`). What a reader of the version
  will miss (`viewer/readiness.js`: the reference transaction's drafts,
  steps without a name, description, picture or system, decisions without
  a condition, empty document fields, a stale As-Is map) is listed in the
  dialog (*Hand off anyway*, each line a link that cancels) and, once the
  Checklist is ready or a version exists, under the Checklist (`#ov-miss`);
  it never blocks. Every PDD says its
  version ("Version N, handed off <date> by <name>", else "Working copy
  after version N") over a Version history table. *Open a
  zip...* (Open menu, and the page shown while no project is open) takes
  a hand-off's zip: extracted under `<userData>/handoffs/<project> v<N>/`
  (`handoff-open.js`; a hand-off unzipped by hand is read only too) and
  opened read only (`.app.read-only`,
  `read-only.js`; main refuses every write there): everything looked at and
  played, nothing changed, no analysis, the project line "Version N,
  handed off <date> by <name> · Read only". No sync, no locks, no
  comparison: a newer version is a zip of its own. The Technical details
  (`tech_details.py`, written by `xlsx_writer.py` on the standard library):
  the reference transaction's recorded controls in the PDD's step order,
  the data fields per transaction, the re-keyed values, the applications.
- **Several windows** (lane MW). One viewer process, several windows, one
  project each: *Open in a new window...* (Open menu) or the button beside
  a recent project opens another project beside the one on screen, and a
  second start of the viewer opens a window in the running one
  (`requestSingleInstanceLock`). The main process keeps which window shows
  which project (`window-registry.js`): a project open for editing in one
  window opens read only in another (the hand-off's read-only page,
  `openElsewhere`, the project line "Open in another window: read only
  here"; main refuses that window's writes). No lock files: closing a
  window lets its project go, and the viewer ends with its last window.
  Dialogs, write reports, the analysis log and Cancel belong to the window
  that asked.
- **The PDD** (`pdd_export.py`): the process written down for the SME, who
  confirms it, and for whoever asks about it; archived per version (the
  owner, 2026-09-26). The developers work from the project (a read-only
  hand-off) and the Technical details, so the PDD holds no values, controls
  or recorded times: its section 5 names the systems and the information
  entered in each, 6 is the analyst's *Volume and effort*, and the re-keyed
  data is said under 7. A step's context line reads "SAP, Order entry · in
  3 of 4 transactions · Transaction 1 at 0:19", and while steps are drafts
  the PDD says so ("The analyst has not yet confirmed N of these M
  steps."). Tool-neutral, built around the confirmed reference run. The document
  fields (C6) fill their places and survive re-export; Document control's
  Request is the document's optional `request` (2.0.1), else the capture's.
  A step's `description` (C7) is its text.
- **The meeting transcript** (C8): `transcript_import.py` writes
  `transcript.json`. A sentence is placed through its own sync, else the
  attached video's; added to a description or a document field, it reaches
  the PDD. Lane E (E3): the Timeline's *Transcript* tab, beside Screenshots
  and Markers, lists every transcript on the one clock with a search, a
  speaker select and the sentence at the playhead marked
  (`flow-view-transcript.js` `renderTab`, `transcript-list.js`); after
  each sentence *Add step here* adds a step there and *Copy to...* opens
  one menu (the selected step's description, then the document's fields:
  the Overview's `showDocTargetMenu`). The owner's copy rule (lane E): a
  label is a verb and its object, a tooltip one sentence saying what the
  click does, no unnamed menu button, a message says what happened.
  The Overview's list holds all the talk while no transaction is marked
  (E6). *Starts here* on a step's row in the Timeline's pane (E5, lane
  PANE; `steps-view.js` `showStepAt`) gives a step written first the
  playhead's moment, its place in the process kept; the right-click menu's
  *"<step>" starts here* (`show-here.js`) does it at the moment clicked.
- **`analysis.json` `format`** (`pipeline_stages.ANALYSIS_FORMAT`, 5 now):
  the viewer analyzes a folder on open when it is missing or lower. 5 (2.0.1)
  cut `pdd_data`, `pdd_time` and `steps_signature`: the Overview no longer
  shows the PDD's rows (its Observations are gone), so opening it never
  runs an analysis. 4 cut the analysis layer nothing read (facts, findings,
  the step-based estimates, `pdd_findings`) and gave the Overview's one
  check its own key, `coverage_caveat` (lane FX1).
- **Raw data is immutable.** `events.jsonl` is append-only; analyst edits
  live in `annotations.json`, replaced atomically, the viewer keeping
  `annotations.json.2` (newest) to `.5`; the unreadable banner's *Restore the
  newest backup* puts the newest readable one back, keeping the unreadable
  file as `annotations.unreadable-<time>.json`. An unreadable one is reported and
  never overwritten. Keys of cut features round-trip (C10).
- **Honest failures.** A failed stage writes its key as `null` plus one
  `stage_errors` entry (C12), shown as "could not run", never as zero.
  `normalize.py` exits (C13) 0, 1 usage or crash, 2 unreadable
  `annotations.json` (nothing written), 3 a failed export. A run changes the
  project only when it succeeds: its outputs are staged as `*.pdt-staged` and
  moved in as its last act, so a failed or cancelled run leaves them as they
  were (lane FX1).
- **Shared rules.** `process_label` and the screen string strip case values
  (`shared/*-label-patterns.json`, loaded by Python and JS); interactions
  are typed by platform signatures (`shared/recognition-patterns.json`,
  [ADR-0011](docs/adr/0011-platform-recognition-layer.md)). Classification is
  an internal engine with no UI (AD-16).

## Commands

Each app (from `capture/` or `viewer/`):

```
npm install
npm start          # launch; after a code change, quit and start it again (no reload key)
npm test           # node:test unit suite
```

Recorder (needs the .NET 8 SDK): `npm run build:recorder` in `capture/`;
tests: `dotnet test capture/recorder/Recorder.Tests/Recorder.Tests.csproj`.

**Full-deps pytest.** Plain `python -m pytest normalization/test/` skips the
pipeline tests (the system Python has pytest but no pandas or pm4py) and
still looks green. Run the bundled interpreter with the system pytest
appended, from `normalization/`:

```
../viewer/python/python.exe -c "import sys; sys.path.append(r'C:\Users\rasha\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages'); import pytest; sys.exit(pytest.main(['test/', '-q', '-p', 'no:cacheprovider']))"
```

Session golden (`--update` only for an intended output change):
`viewer/python/python.exe normalization/golden_check.py`

Re-analyze a session the way the viewer does:

```
viewer/python/python.exe normalization/normalize.py <session_folder> --taxonomy normalization/taxonomy.yaml --mine --library library/activities.json
```

Import a Teams transcript (exit codes in NORMALIZATION.md):

```
viewer/python/python.exe normalization/transcript_import.py <session_folder> <transcript.vtt|.docx>
```

e2e (the real viewer on a throwaway profile; needs `npm install` in `viewer/`
and `e2e/` once):

```
cd e2e && node run-all.js                        # every smoke, one summary line each
PDT_E2E_WINDOW=1366x768 node run-all.js          # (Bash) run at a smaller window
```

The default window is 1500x950. CI's runner display is 1024x720 and Windows
refuses a window larger than the display, so check small sizes locally; each
launch logs the size it really ran at.

Build and publish (repo root, PowerShell):

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
.\scripts\build-distribution.ps1 -SkipPython
.\scripts\publish-release.ps1 -Version X.Y.Z -NotesFromChangelog
```

`publish-release.ps1` refuses unless the tree is clean and HEAD equals
`origin/master`; `-Prerelease` marks a pre-release. Detail:
[docs/BUILD-AND-DIST.md](docs/BUILD-AND-DIST.md).

## Verification

- UI bugs are invisible to the unit suites: validate behaviour in the real
  viewer. `e2e/run-all.js` runs the smokes: `session`, `overview`, `runs`,
  `map-slim`, `transcript`, `panel`, `companion`, `subprocess`, `handoff`,
  `library`, `windows`, `demo`, `timeline-edit`, `process-place`, `video-chain` and `start` (each `<name>-smoke.js`;
  [e2e/README.md](e2e/README.md) says what each covers).
  `session-smoke.js` holds the map connectivity pin (one component, one entry
  step, one final step, counted on the step boxes: the Start and End circles
  are left out).
- The gates before any merge to master (resume state, "Gates"): full-deps
  pytest, the golden, `node --test` in `viewer/` and `capture/`,
  `node run-all.js` in `e2e/`, and `dotnet test` when `capture/recorder/`
  changed.
- CI runs `pytest.yml`, `js.yml` and `e2e.yml` on `windows-latest`. Check
  `gh run list --branch master --limit 6` after every push: CI once stayed
  red for months while local runs looked green.
- Agents read [docs/CHIP-GUARDRAILS.md](docs/CHIP-GUARDRAILS.md) first: the
  hard invariants with the guard for each, how to launch the viewer, and the
  DOM handles of every surface.
- Released-build claims are validated on the packaged app (it bundles its own
  Python), not the dev box.
- The skills pack lives in `~/.claude/skills/` (user-global);
  [docs/claude-skills/](docs/claude-skills/README.md) is a frozen snapshot.

## Conventions

- **No bundler.** Both Electron apps use CommonJS `require()`
  (`nodeIntegration: true`); new modules are plain `module.exports`.
- **Tests:** `node:test` (JS) and `pytest` (Python) only.
- **ADRs** in `docs/adr/`: the next number is `max + 1`, registered in
  `docs/adr/README.md` in the same commit (CI-enforced). A new verb also
  clears the COHERENCE-AUDIT checklist: its inverse, a legend, a
  control-interaction check, a real-run check.
- **Git:** branch off `master` per lane or session, fast-forward `master`,
  delete merged branches. Parallel sessions share this working directory:
  check the current branch before any git write, and use a worktree to
  isolate. Commit only when asked. Commits use an imperative subject and no
  `Co-Authored-By` trailer; write the message to a file and pass it with
  `git commit -F` (PowerShell 5.1 splits quoted arguments).
- **Docs** never hardcode line or test counts.
- **No dash punctuation** in anything written: docs, UI copy, commit
  messages, chat. No em dash, no en dash, and no ASCII stand-in for them (a
  double hyphen, or a hyphen with spaces around it) between clauses; use a
  colon, a comma, parentheses or a new sentence.
  `viewer/ui-copy-guard.test.js` fails on an em or en dash in UI strings.

## Environment

- **Two machines.** The dev box (node, python, git, .NET) and a locked-down
  work laptop that runs only released builds: never suggest installs there.
  SME machines are locked down the same way.
- **Company captures stay local.** Never read a real `events.jsonl` into an
  assistant; use only the structure-only `scripts/inspect-events.js` and
  `scripts/count-cases.js`. The P1 probe numbers are structure-only by design.
- `sessions/example-aggregate/` is committed demo data. Re-analyzing it for
  verification is fine (the golden and the e2e smokes use temp copies); never
  commit its regenerated files.
- **PowerShell:** scope-set `RemoteSigned`, never `-ExecutionPolicy Bypass`.
- **C: is space-constrained.** The single-file recorder self-extracts about
  180 MB; on a full C: it captures 0 events. Set
  `DOTNET_BUNDLE_EXTRACT_BASE_DIR` (and `TEMP`/`TMP` for builds) to a folder
  on D:.
- **Releases ship unsigned** ([ADR-0026](docs/adr/0026-distribution-unsigned-and-services-boutique-scope.md));
  never propose signing under the company certificate.
- **No browser extensions** for capture: corporate security flags them.
- **Internal use:** no masking or privacy caveats for data shown in the app
  or written to the PDD. The recorder's password redaction stays.

## Gotchas

- The recorder is a separate C# process ([ADR-0001](docs/adr/0001-click-recorder-sidecar-language.md)),
  talking NDJSON over stdio.
- Distribution uses **electron-packager** (each app's `build-package.js`),
  not electron-builder.
- The bundled Python cannot run pytest: use the recipe above.
- Capture writes are batched: activity and interaction events ride a 500 ms
  queue; markers and system events flush at once.
- A Playwright `page.reload()` breaks the viewer's session: the `--session`
  hand-off in `main.js` is a one-shot `did-finish-load` listener. Relaunch
  instead.
- A worktree build needs a real copy of `viewer/python`, not a junction:
  electron-packager fails with EPERM trying to symlink it.
- One viewer runs per profile (lane MW): a second start opens a window in
  the running one and ends. `npm start` and the packaged app share the
  profile (`%APPDATA%\process-discovery-tracker-viewer`), so `npm start`
  while the packaged viewer runs opens a window of the packaged one. The
  e2e launches each have a profile of their own.
