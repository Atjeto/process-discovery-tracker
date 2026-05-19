# Changelog

All notable changes to the Process Discovery Tracker. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The step interaction list and auto-generated step descriptions now
  phrase every recorder event kind — including toggle / checkbox
  changes ("Turned Remember me on") and payload-less text-change
  notifications — with a graceful generic fallback for any future kind.
- Auto-detected step names now carry the value the step acted on —
  "Search — SN12345" rather than a bare "Search", "Enter SN12345 in
  Serial Number" rather than "Fill Serial Number" — so a step is
  recognisable from the list without opening its interactions.

### Fixed

- In the Steps view a long step list scrolls within its own pane again,
  with the filter bar pinned; the selected-step detail stays in view no
  matter how far down the list you scroll.

## [0.14.0] - 2026-05-19

### Added

- **A step now shows what it interacted with, not just how many
  interactions.** The step detail panel showed a bare count, so
  understanding a step meant cross-referencing the raw event stream by
  hand. It now lists each interaction as a readable line — *Typed
  "SN12345" into Serial Number*, *Clicked Search*, *Selected "Resolved"
  in Status* — collapsible, with the full typed values shown.

- **Auto-detected steps are now self-describing.** An auto-suggested
  step had an empty description. It now carries a generated prose
  summary of what it did — *"Entered 'SN12345' into Serial Number (20
  keystrokes), clicked Search."* — with full field values and the
  keystroke count behind a coalesced typing burst, so a step reads
  meaningfully in the list and in exports without anyone drilling into
  the events. An analyst's own edits to a step survive re-analysis as
  before.

## [0.13.0] - 2026-05-19

### Added

- **Canonical step rules match controls flexibly.** A match rule
  previously compared three fields for exact equality. Rules now accept
  `contains`, `starts_with`, and `matches` (regex) operators over six
  fields — control type, AutomationId, name, value, class name and
  framework ID — so a template can target a control by a stable part of
  its label instead of its full, volatile text.

- **A step rule can declare how far the step extends.** Each canonical
  step carries a `boundary` mode that decides which following events it
  absorbs: `single`, `until_app_change`, `until_pause`,
  `until_field_change`, `until_next_step`, or the default
  contiguous-group behaviour — so a template can describe a step that
  spans a stretch of work, not just one click.

- **Cases can be detected from a recurring field value.** A template
  can name a *case anchor* — a control whose value identifies the work
  item (a ticket number, a serial). The pipeline opens a new case each
  time the anchor changes value and stamps every interaction and
  activity in that span, so a recording of repeated work splits into
  one case per item with no manual markers.

- **Keystroke runs are coalesced as an early pipeline stage.** Typing
  reaches the pipeline as one `value_changed` event per keystroke. A
  dedicated stage now folds a run of edits to one control into a single
  event carrying the final value before any later stage sees the
  stream, with a prefix guard so two different fields typed
  back-to-back are kept apart.

### Changed

- **Automatic step suggestion fragments less.** With no canonical
  template, step suggestion no longer starts a new step on every app or
  window switch, and tolerates a longer idle gap (10 s) and more
  interactions (60) before splitting. It does start a fresh step after
  a completion action — a click on a button or link labelled "search",
  "submit", "save" and the like.

## [0.12.2] - 2026-05-19

### Fixed

- **A browser-heavy recording still fragmented into hundreds of
  auto-detected steps.** Step suggestion started a new step on every
  change of the raw window title, and web-app titles carry volatile
  text (a live memory counter, the "- Microsoft Edge" tail), so the
  *same* application read as a fresh step over and over. Segmentation
  now keys on the stable app prefix — the title up to its first
  separator, the same label it already uses for naming — so a window
  whose title only churns cosmetically no longer splits the step.

- **Auto-suggested phases were unusable.** "Suggest groupings" bundled
  any steps less than 30 s apart and treated every browser tab as one
  app, so a dense session collapsed into two or three enormous
  "Mixed-app phase" blobs. It now groups steps into continuous-work
  blocks — runs with no idle pause longer than two minutes between
  them — and names each phase after its dominant app.

- **A phase could not be deleted or split.** The phase detail pane had
  no height limit, so a phase with many steps pushed its Save / Delete
  buttons off-screen; the step list now scrolls within a fixed height.
  "Split" was wired to nothing — each step row in a phase now carries a
  split control that moves that step and everything after it into a new
  phase.

- **"Jump" on a raw-events row did nothing without a video.** The jump
  action, and clicking an event row, only seeked a video. With no
  recording linked it now moves the Flow timeline playhead to the event
  and scrolls it into view.

## [0.12.1] - 2026-05-19

### Fixed

- **A recorded session of browser work produced hundreds of unusable
  auto-detected steps.** Typing into a web-app field reached step
  suggestion as a flood of per-keystroke `value_changed` events: the
  recorder's debounce coalescer keys on a control's AutomationId or
  Name, and Chrome exposes neither on most web inputs, so it silently
  skipped them — then the step interaction cap sliced one typed value
  into five or six fragment "steps" with growing-prefix names. Step
  suggestion now coalesces a run of `value_changed` events on one
  control before it segments, and folds the browser's repeated
  same-tab `selection_changed` re-fires; a step name no longer echoes
  the window title back as its own label. The recorder's coalescer
  also gained a UIA RuntimeId fallback so identity-less web fields are
  coalesced at capture time in new recordings. Existing sessions are
  fixed on the next Re-analyze — no re-recording needed.

## [0.12.0] - 2026-05-18

### Added

- **Process Template steps can be identified from the App Library.** A
  step's match rules — the UI patterns that recognise it in a captured
  session — are now composed through a per-step **Match rules…** picker
  that draws on the App Library (the per-app catalog of named UI
  interactions), a basic app/window rule, or an interaction lifted from
  a sample session. Library-sourced rules keep a reference back to the
  catalog entry and show a drift badge when that entry later changes.

- **Inline phase assignment in the Process Template editor.** Each step
  row has a **Phase** dropdown — assign it to an existing phase or
  create one on the spot. The template's `phases` block, which the
  exports roll steps up into, stays in sync automatically.

- **Close and Delete for a Process Template.** The actions bar gained
  **Close** (unload the template from the editor) and **Delete** (remove
  the `.yaml` from disk, with confirmation). Version-history snapshots
  are deliberately kept on delete.

- **Step reordering in the Steps view.** Each step row has up/down
  buttons, and a **Sort by time** action reorders the whole list
  chronologically.

- **Per-row actions in the Raw events table.** A row can now jump the
  video and timeline to its event, spin a new step off it, or add the
  event to the selected step — not just seek.

- **Zoom controls for the Process diagram.** The BPMN process-map tab in
  Compare Sessions gained zoom-in / zoom-out / fit controls, matching
  the Flow diagram.

### Changed

- **The Process Template tab was relaid out.** Two main columns —
  Template steps and Import steps from a session — with the Advanced
  YAML editor demoted from a co-equal third column to a collapsible
  strip below, reclaiming the space for the panels that matter.

- **Clearer naming.** The app-and-window-only match rule is now a "Basic
  match rule" (was "coarse rule"); the bulk step-import panel is now
  "Import steps from a session" (was "Rough-in from a recording").

- **Steps can be multi-selected with a plain click** on their checkbox;
  Ctrl+click still works.

- **The Raw events table uses the available height** instead of a fixed
  360px panel, and stays collapsible.

### Fixed

- **The Match rules… picker rendered in a narrow left strip** because it
  reused a modal layout meant for a nav sidebar it does not have.

- **A manual step added with no video loaded landed far off the
  timeline** — the fallback timestamp was wall-clock now; it is now
  anchored within the session's recorded span.

- **"Merge with next" ignored a multi-selection.** With two or more
  steps selected it now merges exactly those, in chronological order,
  and names what merged.

- **"+ Add interaction" in the App Library gave no sign anything
  happened** — the new row now scrolls into view, briefly highlights,
  and takes focus.

- **The help text mis-described cases and phases.** Cases are derived
  from markers during normalization, not marked during recording; the
  phases text now explains what phases are for and where to define them.

## [0.10.0] - 2026-05-18

### Added

- **Add a step at the video playhead, without leaving Flow view.** A
  "+ Step" button in the timeline toolbar — and the `S` keyboard
  shortcut — create a step boundary at the current video playhead, so
  a manual step can be marked while watching in Flow view instead of
  switching to the Steps view to place it blind. The playhead inside
  an existing step splits it there; in open space it starts a new step
  running to the next boundary; on a session with no steps yet it
  carves the recording into "Step 1" / "Step 2" at the playhead. The
  per-step lane is switched on so the new boundary appears on the
  timeline immediately.

### Fixed

- **Space and the arrow keys double-fired against the video's native
  controls.** When the `<video>` element had keyboard focus, a Space
  or Left/Right press was handled twice — once by the browser's
  built-in media controls and once by the viewer's global shortcut
  handler — so the two play/pause toggles cancelled out and Space
  appeared to do nothing. The global handler now leaves those keys to
  the native control whenever the video element is focused.

- **The session summary panel could be squeezed flat.** After the
  v0.9.0 session-view overlap fix pinned the event-table and log
  panels to their content height, the summary panel was left as the
  only shrinkable element in the scrolling session column — so it
  collapsed, and its `overflow: hidden` clipped the body, leaving it
  unable to open. It is now pinned like its sibling panels.

- **Command palette result clicks and keyboard navigation.** Hovering
  a result rebuilt the whole list on every mouse-enter, swapping the
  row out between mousedown and mouseup so a click never landed;
  selection highlighting now updates in place. Arrow / Enter / Esc /
  Tab navigation is bound at the document level, so it works whenever
  the palette is open rather than only while the search box holds
  focus.

## [0.9.0] - 2026-05-18

### Added

- **The Analysis view's heuristic findings can now be corrected.** The waste
  and automation classifiers ship as provisional estimates — the value-add vs.
  business-required time split is a guess (all active time defaults to
  value-add), and an automation candidate cannot be judged real from a single
  recording. The Analysis sub-view is now interactive: click a step's waste row
  to set how much of its time is business-required overhead, and confirm or
  dismiss each automation candidate. Corrections are saved to
  `annotations.json` with undo, shown immediately, and folded into the analysis
  layer on the next Analyze run — flowing through to `analysis.json` and the
  PDD export.

- **Compare Sessions gained an Analysis panel.** Loading several recordings of
  the same process now pools their heuristic findings: a cross-session time
  study, a per-worker cycle-time comparison, automation candidates scored
  across sessions — a step seen once per session finally has enough instances
  to judge for repetitiveness — and a process-efficiency trend. Each automation
  candidate carries a fingerprint of how its step was performed, so the same
  step compares cleanly from one recording to the next.

### Fixed

- **The session summary's "Where the time went" bars rendered empty.** The
  bar fill was an inline element, so the browser ignored its width and
  height — the percentages showed but the bars beside them stayed blank.

- **The Flow, Steps, and Phases views could overlap the panels below them.**
  With the analysis-log or raw-events panel open, the session layout was
  squeezed below its content height and the video and annotations spilled
  over the panels beneath. The layout now keeps its height and the session
  view scrolls instead.

## [0.8.0] - 2026-05-18

### Added

- **A pass of vocabulary, capture, and viewer polish.** An auto-detected
  step now shows *why* the tool grouped its interactions ("Grouped 8
  interactions in SAP, max gap 4s"). The screenshot gallery collapses a
  run of near-identical frames behind a "(+N near-duplicates)" badge —
  click to expand — computed from a perceptual hash written during
  normalization. A pipeline failure in the analysis log is prefixed with
  a plain-language explanation of the likely cause. The Ctrl+K command
  palette became multi-provider, so the Steps and Phases views
  contribute their own commands, with a ⌘K hint in the topbar. The
  session summary reports **App Vocabulary coverage** per app, and a
  bootstrapped vocabulary is now ranked by how often each control was
  used — rarely-seen controls fold under a disclosure. On the capture
  side: events are written through a 500 ms batching queue (markers and
  lifecycle events still flush immediately); a long idle stretch is
  tagged **at-desk** when the recorder still saw activity, and rendered
  distinctly on the timeline; each activity event and the manifest carry
  window and display geometry, so the viewer badges which **monitor** a
  window was on; and a session that ends with stored sessions over a
  size threshold prompts a cleanup reminder.

- **Comparing sessions, the video, and markers all got sharper.** The
  Compare Sessions view gains a **Group by worker** toggle — the
  activity and case charts split and colour by worker so you can see
  how different people ran the same process; a **side-by-side** mode
  that stacks two sessions' step timelines, shared steps in green and
  divergent ones in amber, with a plain-language summary of where they
  agree; a **conformance overlay** on the Flow diagram that colours
  each node green (matches a Process Template step) or amber
  (off-template) and lists template steps no session reached; a warning
  when the loaded sessions were analyzed against **different taxonomy
  versions**; and a **Variants by: Activity / Step** toggle on the Path
  variations table, so you can compare the analyst's stepped view of
  the process, not just the raw activity sequence. On the Session view,
  a **Sync video** button re-aligns a recording interactively — click a
  moment in the video, then the matching point on the timeline; a
  **▶ Watch** button on each step plays the recording across just that
  step's span; a timeline range can now be **excluded from analysis**
  (step suggestion and statistics skip it) as well as turned into a
  case; re-analyzing a session that already has steps now **asks for
  confirmation** first, since it regenerates auto-detected steps and
  clears the undo history; and every save of `annotations.json` keeps
  **five rotating backups** as a safety net.

- **Projects carry knowledge forward.** A saved project now auto-saves
  a few seconds after you switch tab or view, so a workspace stays
  current without a manual Save. Project files store their session and
  template paths *relative* to the project file, so a project folder
  can be moved or shared without breaking. A project can also carry a
  **team denylist** of apps to leave out of step suggestion — applied
  to any session opened under the project that has no denylist of its
  own — a **Project notes** field, editable from the Project menu and
  included in the findings report, and a **step-template session**:
  open a step-less session under a project that names one and the
  viewer offers to seed it with the template's step structure, each
  step positioned by relative time.

- **Set a project's step template from the menu.** The Project menu
  gains a "Set current session as step template" action: with a
  project open and a session loaded, one click records that session as
  the project's step template, so later step-less sessions opened under
  the project can be seeded from it. Previously the template could only
  be set by hand-editing the project file.

- **One-click HTML findings report.** The Session view's export bar
  gains a "Findings report..." button. It produces a self-contained
  HTML document — process summary, the process map inline, the steps
  table, the waste / automation / efficiency findings, notes, and
  starred screenshots, plus an editable recommendations block — that
  opens in any browser with no external assets. A pre-export dialog
  picks which optional sections to include. Screenshots gain a star
  toggle in the Screenshots panel; only starred screenshots are
  embedded in the report.

- **A process-analysis layer turns a recording into IE-grade
  findings.** After step suggestion, normalization now runs four
  heuristic analyzers and writes an `analysis.json` sidecar: a per-step
  **waste classification** (value-add vs. waiting / motion / rework /
  cross-app overprocessing — the DOWNTIME wastes), a **time study**
  (per-step cycle time across instances, split into active / waiting /
  switching), **automation-candidate** scoring (repetitiveness and
  rule-basedness, scored only where a step repeats often enough to
  judge), and the **process-efficiency ratio** (value-add over total
  stepped time). The viewer gains a fourth Session sub-view —
  **Analysis** — showing the efficiency ratio, a per-step waste bar,
  the time-study table, and the automation list; the session summary
  panel surfaces the efficiency ratio as a tile; and the PDD export
  appends the waste and automation context under each step. The
  classifiers are deliberately conservative and labelled provisional:
  they are tuned ahead of real 8-hour recording data and meant to be
  recalibrated against it. See
  [ADR-0008](docs/adr/0008-build-the-analysis-layer.md).

- **Session summary panel.** An analyzed session now opens with a
  summary above the timeline instead of leaving the analyst to scroll
  and reconstruct what happened: engagement and worker, duration, case /
  event / step counts, a "where the time went" breakdown of the top
  activities, the app-switch count and longest single-app stretch, and
  the longest cases. It also surfaces **marker problems** — a Start with
  no matching End, an orphaned End, a suspiciously short case — each,
  where fixable, with a one-click button that queues the correcting
  marker edit for the next analysis.

- **Compare Sessions flags duration outliers.** When the loaded set
  holds a session whose total duration is a statistical outlier (a
  Tukey fence around the median), a banner names it and offers to drop
  it from the comparison, so one unusually long or short recording
  doesn't quietly skew the merged statistics.

- **Taxonomy rules that match nothing are surfaced.** Normalization now
  records a per-rule match count in `stats.json`
  (`meta.taxonomy_report`) and prints a note for every taxonomy rule
  that classified zero events — a typo in a rule's title pattern no
  longer fails silently.

- **Canonical match-rate drift warning.** When a re-analysis against a
  Process Template sees its interaction match rate fall sharply from
  the previous run (more than 20 points), normalization records it in
  `stats.json` and the session summary shows a warning — the usual
  cause is the target application changing its field identifiers.

- **The interaction recorder filters browser and Electron chrome.**
  The C# recorder now drops the Chromium render-tree scaffolding events
  — empty-id Pane / Group / Document / Custom panes — that every
  browser, and every Electron app, fires for its own internal DOM, the
  same way it already dropped Win32 desktop-shell chrome. Real web-app
  controls, which carry a page-set automation id, are untouched.
  Without this, an all-day browser-heavy recording could bury the
  signal under tens of thousands of noise events.

- **Recorder health lands on the timeline, not just the debug log.**
  The recorder's periodic stats — events emitted, events dropped, an
  error count, and a snapshot of the last failure (process, control,
  message) — are now written to `events.jsonl` as `recorder_health`
  system events, so capture trouble is visible against the session it
  happened in instead of only in the debug log.

- **Applications the recorder cannot see are flagged.** When a
  foreground application produces no interaction events for a sustained
  stretch — typically because it runs elevated, or exposes no UI
  Automation surface — the capture app records an `uncaptured_app`
  event and shows the worker a one-time notice. Such an app used to
  record silently, with no interactions and no explanation.

- **Interaction events carry capture-quality signals.** The first
  interaction captured for each application is tagged with a
  `coverage_hint` — `rich`, `basic`, or `minimal` — a quick read on how
  much detail UI Automation exposes for that app; and a value clamped
  at the 256-character limit is flagged `value_truncated` so a partial
  value is not mistaken for the whole.

- **Events carry a sequence number.** Every event in `events.jsonl`
  now has a monotonic `_seq`; normalization sorts on
  `(timestamp, _seq)`, so events written within the same millisecond
  keep their true order through the pipeline.

- **Sessions can run through idle for all-day recordings.** A new
  `auto_end_on_idle` config key (default on) governs whether an idle
  stretch past `auto_end_idle_minutes` ends the session. Set it off for
  an 8-hour passive recording — idle is still logged, but only the
  worker, or the end of the shift, ends the session.

- **Bracket a case straight from a timeline selection.** The range-
  selection card on the Flow timeline gains an "Insert case from
  selection" button: name the case and it queues a Start and End
  marker at the selection's edges, applied on the next analysis. An
  analyst can now mark process instances in a long passive recording
  after the fact, with no capture-time markers.

- **A post-session summary closes out each recording.** When a capture
  session ends, the Live Session window shows a summary — duration,
  event / marker / screenshot / interaction counts, and whether video
  was recorded — with an optional field to name the session. The name
  is saved to the session manifest and shown in the viewer's Recents
  list, so a worker hands off a recording knowing it is complete and an
  analyst can tell sessions apart at a glance.

- **The recording setup is checked before capture starts.** A
  pre-flight validation runs at session start; if the engagement ID is
  still the default or the session folder is not writable, it asks the
  operator to confirm before recording — catching a misfiled or
  unwritable session before a long recording goes into it, not after.

- **Hotkeys fall back to an alternate binding when one is taken.** If a
  global shortcut can't be registered because another app already holds
  it (some screen recorders and password managers grab Ctrl+Shift+S),
  capture now tries the Ctrl+Alt+ variant and tells the operator which
  binding is live, instead of the hotkey silently doing nothing.

- **Sessions carry an integrity manifest.** Capture writes
  `session-integrity.json` — every file in the session folder with its
  size — when a session ends. Opening the session in the viewer checks
  that manifest against what actually arrived and shows a warning
  banner if files went missing, so a session copied incompletely (a
  dropped video, a truncated event log) is caught before analysis
  instead of silently producing a partial result.

### Changed

- **Step states read in plain language.** The four pipeline step states
  (`auto_suggested`, `auto_matched`, `manually_authored`, `edited`)
  surface to the analyst as just two — "Auto-detected" and "Confirmed" —
  in the step-list tooltip and the summary panel. The pipeline
  distinction is unchanged; only the wording the analyst sees.

- **The Session view points at what to do next.** Once analyzed, a
  context banner in the summary panel suggests the next move — review
  the auto-detected steps, or group reviewed steps into phases — and a
  long recording auto-scrolls to its first case on load.

- **Re-analysis no longer duplicates analyst-owned steps.** When
  normalization regenerates auto-detected steps, a fresh step that
  overlaps a manually-authored, edited, or hidden step by more than
  half its duration is dropped instead of stacked on top — the analyst
  no longer inherits overlapping duplicates to find and delete.

- **Web apps inside a browser are now visible.** The capture tracker
  starts a new activity event when the window title changes, not only
  when the application changes — so a worker moving between Salesforce,
  web-SAP and Workday inside one Chrome window produces three activity
  events instead of one undifferentiated `chrome.exe` event, and the
  process map shows the real flow. The title is normalized first
  (unread counts, unsaved markers and the browser-name suffix are
  ignored) so cosmetic churn doesn't fragment the timeline. This
  realigns capture with the original design — see
  [ADR-0007](docs/adr/0007-activity-event-granularity.md).

- **The interaction-recorder debounce is configurable.** The window
  that coalesces a burst of value changes into one event — typing into
  a field emits a single event with the final value — was a hardcoded
  750 ms. It is now an `interactions.debounce_ms` config key, passed to
  the recorder sidecar in its startup handshake.

## [0.7.0] - 2026-05-17

### Fixed

- **The Flow map no longer draws meaningless self-loops.** A directly-
  follows graph node with an arrow back to itself has no business
  meaning — it was an artifact of the event log keeping consecutive
  same-activity events separate. Normalization now collapses a run of
  one activity into a single occurrence for the process-mining log (the
  finer per-window rows are kept in `events.csv`), so a self-loop is
  structurally impossible — in the Flow graph, the XES log, and the
  mined BPMN alike.

- **The capture tray menu opens on right-click again.** The tray set a
  context menu and also handled right-click explicitly; on Windows the
  two double-fired and right-click did nothing. Both clicks now open
  the menu reliably.

### Added

- **Per-web-app taxonomy.** A canonical `normalization/taxonomy.yaml`
  classifies browser windows into the actual web apps they host
  (Salesforce, SAP, …) instead of one coarse `Unclassified --
  chrome.exe` node. There is deliberately no per-browser catch-all rule
  — an unmatched window stays `Unclassified`, a prompt for the analyst.
  The viewer's Analyze step picks the taxonomy up automatically.

- **Reclassify an activity from the Flow map.** Clicking a map node
  offers a Reclassify action: give the activity its correct label and
  the correction — stored as a `classification_overrides` entry in
  `annotations.json` — flows through re-analysis into the process map,
  the statistics, and the exports. An `Unclassified` node is now a
  prompt the analyst can answer, not a dead end.

## [0.6.0] - 2026-05-17

### Added

- **Studio Dark — a dark theme for the viewer.** A second, opt-in theme
  alongside the default light Warm Editorial: a cool charcoal-blue base,
  a teal accent, a brighter foreground — cinematic and technical. A
  toggle in the topbar switches it at runtime, the choice is remembered,
  and the stored theme is applied before first paint so there is no
  flash. The dark theme covers every view — the timeline bands, the
  step / phase editors, the Flow-diagram (DFG) graph, and the charts
  included.

### Changed

- **Video stage glow.** The video pane carries a subtle radial-gradient
  depth, and the no-video placeholder a faint grid — applied to both
  themes so they stay visually matched.

## [0.5.0] - 2026-05-17

### Changed

- **Capture app tech-debt remediation.** Following an architecture audit
  (`docs/CAPTURE-ARCHITECTURE-ISSUES.md`), the capture app was reworked: a
  `node:test` suite covers the pure-logic modules; the ~1,580-line
  `main.js` is decomposed into focused modules (boot-log, notify,
  session-storage, window-manager); config defaults are consolidated to a
  single source; and each window's HTML is extracted from its JS module
  into a `ui/*.html` file. The decomposition and HTML extraction are
  behaviour-preserving.
- **Screenshots are debounced.** Coincident triggers (an app switch
  landing together with a marker fire) collapse to a single capture
  instead of several near-duplicates. Manual screenshots are never
  suppressed.
- **Viewer: Flow timeline on the shared timeline core.** The Flow
  timeline is migrated onto the timeline-core lane plugins.
- **Viewer: process map is resizable; Activity Frequency chart fix.**

### Added

- **Capture-time failure notifications.** If screenshots start failing
  during a session, the operator gets a desktop notification rather than
  the failure landing only in the debug log.
- **Recorder liveness watchdog.** The interaction-recorder sidecar is
  monitored; if it wedges without exiting, it is terminated and the
  existing restart path recovers it.

## [0.4.0] - 2026-05-16

### Changed (Warm Editorial redesign)

- **Light-theme visual redesign.** The dark "stratified-dark" viewer
  theme is replaced by "Warm Editorial" — a warm off-white palette, an
  amber accent, sharp corners, soft shadows, and self-hosted Plus
  Jakarta Sans + JetBrains Mono typography, applied from a Claude Design
  handoff.
- **Fill-the-window layout.** Every screen fills the viewport and flexes
  its panels by ratio rather than stacking each at a fixed minimum, so
  the video, the screenshot gallery, the process map, and the editors
  grow with the display. The drag-resize handles remain.
- **Flow timeline rebuilt.** Vivid, distinct per-app band colours; case
  bands moved to a labelled header lane above the activity bands; a
  dedicated screenshot rail with clear camera markers; the Flow-diagram
  graph re-themed to the light palette.
- **Bottom playback bar.** A global video transport — skip, play/pause,
  scrub — pinned below the Session view.
- **Steps view polish.** Compact step durations in the list, Duration /
  Start / End stat tiles in the detail pane, and proper card styling.

### Added (round-2 UX feedback — features)

- **Recent dropdown in the top-bar.** Recent sessions + projects were
  only reachable from the Session empty-state, which vanishes once a
  session loads. New "Recent" dropdown next to the Project menu lists
  recent projects + recent sessions + bundled examples, reachable any
  time.
- **Capture: explicit "Start capture session" button.** The Live
  Session window had no obvious way to begin — its primary control was
  "Fire" (a marker), which auto-starts a session as a side effect. It
  now shows a prominent Start button when idle; the marker controls
  dim until a session is running.
- **Timeline Lanes menu.** The timeline had grown to nine stacked
  lanes. A new "Lanes" dropdown in the timeline header toggles idle /
  markers / screenshots / cases / density / window-titles / per-step
  bands / note dots. Defaults keep the core lanes on and the denser
  additions off; the choice persists.
- **Flow diagram variant overlay.** Hovering a node in the Compare
  Sessions Flow diagram now highlights the session paths (variants)
  running through that activity and dims everything else — you see
  where work diverges. The standalone variant-flow Sankey
  (`viewer/variant-viewer.js`) is removed; the Flow diagram absorbed
  the useful idea.
- **Process map SVG export.** New "Process map SVG" export button.
  Exports whichever map is showing — the BPMN process diagram (via
  bpmn-js `saveSVG`) or the Flow diagram (via a hand-written
  cytoscape→SVG serializer) — as an SVG that imports cleanly into
  Figma, Lucidchart, and browsers.

### Changed (round-2 UX feedback — clarity)

- **"Rework loops" panel renamed** to "Repeated activities within a
  case", with a plain-English explainer ("activities a worker did
  more than once inside the same case — often a sign of rework").
- **Capture session-config window** rewritten for a business
  audience: "Set up a recording session", every field relabelled in
  plain language with a one-line helper.

### Added (round-2 UX feedback — step-noise solution)

- **Step-noise denylist.** A session captured with OBS (or any app the
  UIA recorder picks up) visible used to produce dozens of unannotatable
  steps ("OBS 31.0.1: 12 interactions"). New per-session denylist:
  `annotations.json` gains `step_filters.ignored_processes`;
  `step_suggest.py` drops matching interactions (case-insensitive
  substring on process_name + window_title) before step suggestion.
  New "Ignored apps..." button on the Steps view toolbar opens a dialog
  listing every app observed in the session with its interaction count;
  ticking an app + Save re-analyzes the session with that app excluded.
- **Bulk-delete steps.** Ctrl+click 2+ steps, then "Delete selected"
  removes them in one confirm. Ctrl+Z restores the whole batch.
- **Hide step as noise.** New "Hide as noise" button on the step editor.
  Hidden steps drop out of the list (revealed via a new "hidden" filter
  chip) and — unlike a delete — survive re-analyze: `_merge_steps`
  preserves the `hidden` state so a re-suggest doesn't resurrect them.

### Fixed (round-2 UX feedback — bug bash)

- **Resize handle did nothing.** `.timeline-scroll` had `flex: 1`
  (flex-basis 0) which overrode its `height: var(--timeline-height)`,
  so the `#resize-timeline` drag updated the CSS variable but nothing
  moved. Now `flex: 0 0 auto` so the height var drives the viewport.
- **Zoom buttons overlapped the tabs** in Compare Sessions — the
  verbiage rename had blown the tab labels up. Header now wraps;
  `.map-zoom` is shrink-resistant; the BPMN tab label trimmed back to
  "Process diagram".
- **Misleading `+` cursor** on the timeline (`crosshair`) changed to a
  normal cursor; activity-band hover uses `pointer`. Legend gained an
  interaction hint.
- **Screenshot dots** toned down from 14px glowing circles to quiet
  9px markers that brighten on hover.
- **Cases dropdown** showed a lone "All cases" with no explanation on
  an unanalyzed session; now adds a "(no cases yet — click Analyze
  session first)" hint.
- **Steps editor scroll** — the selected-step editor scrolled off-screen
  when the step list was scrolled. The detail pane is now `sticky` so it
  stays put while the list scrolls.

### Added (P2.2 full + audit fixes)

- **P2.2 Variant flow visualization (full).** New `viewer/variant-viewer.js`
  module renders trace_variants as a Sankey-style metro map: each
  unique (column, activity) becomes a node, edges connect consecutive
  activities across variants, both node and edge widths scale with
  the number of sessions flowing through. Divergence columns are
  highlighted in amber so split points are obvious at a glance. The
  Path variations panel in Compare Sessions now has Flow / Table tabs;
  Flow is the default. Click a node to drill into the activity.

### Fixed (audit pass on the deferred batch)

- **P2.7 screenshot gallery filter** simplified to All / Manual / Auto.
  The previous Marker / App switch / Activity resumed options never
  matched anything because capture's `tracker.fireSystem("screenshot",
  ...)` doesn't write a `reason` field — those distinctions only ever
  lived in the spec. Filter now matches what the data actually carries.
- **P2.2 variant heat empty state.** Previous render's rows would
  persist when switching to a session set with no variants. Now shows
  "No variants — analyze sessions to populate."
- **AM.1 timestamp parsing** replaced fragile offset arithmetic
  (`off === 13 || off === 16 ...`) with an anchored regex that fails
  loudly on unrecognized formats instead of silently mangling them.
- **Process Template form editor**: edits to the Advanced YAML
  textarea now update the form view (debounced 350ms; bails silently
  while the YAML is mid-edit and unparseable). And step deletion now
  cleans up dangling references in `proc.phases[].step_ids[]` so a
  phase can't end up pointing at a missing step.
- **P2.12 window-title strip label threshold** was double-counting
  zoom: `host.clientWidth` already reflects the post-zoom width, so
  the previous `(w/100) * hostW * zoomFactor` was 1.5–3× too aggressive
  and labels appeared on bands that were actually too narrow.
- **P2.3 viewport state across modes** was losing the snapshot because
  `display: none` panels return 0 for `scrollWidth` / `clientWidth`.
  Snapshot now reads from the still-visible outgoing layout BEFORE
  swapping visibility.

### Added (deferred-spec follow-up pass)

- **Process Template form editor** replaces the regex-parsed read-only
  step list with an actual editable form: rename / reorder / add /
  delete steps, edit name and description, with reorder arrows on
  every row. Round-trips through `js-yaml` so the underlying match
  rules and other fields the analyst doesn't see stay intact. Match
  rules themselves remain in the Advanced YAML editor.
- **Phase drag-reorder** (P2.6). Step rows inside a phase can now be
  dragged to reorder; a drop indicator follows the cursor and the
  source row dims while dragging. Reorders persist via
  `annotations.json`.
- **Screenshot gallery** (P2.7). New "Open gallery..." link on the
  Screenshots side-panel opens a full-pane overlay. ←/→ steps
  through screenshots, Space toggles auto-advance (~1.2s), Esc
  closes, click the image to seek the video. Filter by trigger
  reason (manual / app switch / activity resumed / marker fire).
- **Window-title runs lane on the Flow timeline** (P2.12). New lane
  between density and steps showing one band per consecutive
  (app, title) run. Labels render only when bands are wide enough
  (~50px); narrow bands stay as colour stripes so the rhythm of
  title changes is visible without crowding labels.
- **Connect Flow / Steps / Phases viewport state** (P2.3). Switching
  view modes now transfers zoom and scroll fraction across the
  three modes — zoom Flow to 3x, scroll mid-session, switch to
  Steps and you stay at the same place.
- **Multi-version Process Template comparison** (AM.1). Every save
  of a Process Template archives a snapshot under
  `.template-history/<basename>/<timestamp>.yaml`. New "Compare
  Process Template versions" panel in the Compare Sessions view
  lets you pick two versions and see a structural diff: steps and
  phases added / removed / renamed.
- **Variant heat** (P2.2, scoped first cut). The Variants table
  in the Compare Sessions view now renders with a frequency-bar
  heat strip per row, an explicit session-count badge, and a
  visual divergence highlight on activities that appear at the
  same position across multiple variants (where paths split).
  Full timeline-overlay rendering deferred — that needs PM4Py
  per-step variant data plumbing on the Python side.

### Changed (verbiage pass for business-analyst audience)

A targeted sweep through user-facing labels, headers, button text,
help copy, and toasts to replace process-mining / engineering jargon
with business equivalents. Internal variable names, IPC channels,
file names, and code comments are unchanged so internal references
keep working. Highlights:

- **"Aggregate" → "Compare Sessions"** wherever it surfaces in the
  UI: the Tab 2 label, the help-modal navigation entry, the help
  text describing it, and the empty-state hero button ("Open
  sessions to compare..."). Internal handler / id names like
  `aggregateSessions`, `view-aggregate`, etc. stay as-is so
  existing wiring remains intact.
- **"Vocabulary" / "App Vocabulary" → "App Library"**: Tab 4
  label, the section heading, the prep CTA card, the Save / Bootstrap
  buttons, the related toast messages, and the New / Save dialogs.
- **"DFG" → "Flow diagram"**: the panel-tab in Compare Sessions's
  Process map. The discoverability tooltip explains it's a
  Direct-Follows Graph for analysts who recognize the term.
- **"BPMN" → "Process diagram (BPMN)"**: the other panel-tab.
  Keeps the industry-standard acronym (importable into Adonis,
  Bizagi, Camunda) but adds the parenthetical so it's not opaque
  to first-time readers.
- **"Canonical YAML saved" → "Process Template saved"** and other
  toast / dialog touches in the Process Template surface.
- **Process Template tab** layout reframed: the raw template
  definition is now behind an "Advanced: full template definition"
  expander rather than the default-visible YAML pane. The list of
  template steps stays directly editable; the underlying definition
  is collapsed-by-default for non-engineer analysts.
- **First-line README and help phrasing** stays focused on the
  analyst-trying-the-tool experience.

### Added

- **Mode-specific shortcuts overlay** (P2.4). Small persistent
  bottom-right widget on the Session view listing the current
  view-mode's 3-4 most-used shortcuts. Dismissable; preference
  persisted to localStorage.
- **Case-scope dropdown deduplication + scope-to-playhead** (P2.8).
  Duplicate marker labels in the case-scope dropdown get a
  `[H:MM:SS]` time-offset suffix so analysts can tell repeated
  cases apart. New `⇥ playhead` button next to the dropdown scopes
  to whichever case contains the current video playhead.
- **Snap-to-event on timeline click** (P2.9). Background click on
  the Flow timeline snaps to the nearest event within ~10px-worth
  of pixel tolerance (scaled by zoom). Genuine empty-space clicks
  still seek to the literal point.
- **Hotkey conflict detection at startup** (P2.10, capture).
  When `globalShortcut.register()` fails (another app is using the
  binding), a Windows toast surfaces the conflict naming each
  failed hotkey, instead of the silent boot.log-only signal.
- **Analyze-all per-iteration progress label** (P2.11). The
  Aggregate "Analyze all sessions" button shows
  "Analyzing N / total..." per-iteration so a long sweep doesn't
  look frozen. Cancel still works mid-loop.
- **Tray menu reorganization** (P2.13, capture). The previously-flat
  tray menu now groups everything beyond the muscle-memory action
  items (Fire Start / End / Pause / End session) into three named
  submenus: Live status (overlays + windows), Storage (recents +
  prune), and Help & config (help + OBS + session config). Fits
  on small-DPI screens.
- **Live-session window keyboard shortcuts** (P2.14, capture).
  S = focus the marker input, E = end marker, P = pause/resume,
  Y = open sync-marker row. Suppressed when an input is focused.
- **Auto-suggested phase grouping** (AM.2). New "Suggest groupings"
  link on the Phases pane runs two heuristics — group consecutive
  steps from the same app, and group consecutive steps with no idle
  gap > 30s — to propose phases. Preview shown as a confirm modal;
  Apply all creates auto-suggested phases the analyst can rename
  and tweak. Skips steps already in a phase.
- **Range selection on the timeline** (P1.1). Shift-drag across the
  Flow timeline to select a time range; a "Selection" stats card
  pops above the legend showing duration, event count, marker count,
  screenshot count, and top apps in the range. Esc clears. The range
  survives view-mode switches and clears on session change.
- **Screenshot hover thumbnails** (P1.2). Hovering a screenshot dot
  on the Flow timeline pops a 220×140 thumbnail preview near the dot.
  Click still opens the full modal.
- **Mini-map overview above the timeline** (P1.3). 30px strip showing
  the whole session compressed into the visible region. Click anywhere
  to jump; drag the highlighted viewport to scroll. Per-app coloured
  bands provide a thumbnail-of-the-timeline read at a glance.
- **Per-step duration bands on the Flow timeline** (P1.4). When a
  session has steps (auto-suggested, auto-matched, or manually
  authored), each step renders as a labeled band on a dedicated lane
  beneath the density histogram. Click a step band to switch to Steps
  view with that step selected.
- **DFG drill-down picker** (P1.5). Clicking a DFG node in the
  Aggregate view now lists every loaded session containing that
  activity (timestamp + session name) instead of jumping to the
  first match. Single-result auto-picks; ↑↓/Enter for keyboard
  navigation; Esc to dismiss. The picker positions near the click.
- **Batch "Remove N missing" link in Recents** (P1.6). When ≥2
  recents entries are flagged missing, a "Remove N missing" link
  appears alongside "Clear all" so the analyst doesn't have to
  ✕ each one individually.
- **Sparklines on aggregate bar charts** (P1.7). The
  activity-frequency and case-duration bar charts in the Aggregate
  view get a tiny 10-bucket sparkline at the bar's right edge,
  showing temporal distribution across the loaded sessions' wall-
  clock span. Quick read for "did this cluster early or evenly?"
- **Auto-clean stale recents** (P1.8). When a Recents entry is first
  detected missing, `firstMissingAt` is stamped on it. After 30 days
  of being missing, the entry is silently dropped on the next
  render. A temporarily-unplugged drive can't false-positive a real
  recent off the list.
- **Annotation lane on the Flow timeline** (P1.9). Numbered note
  dots render in their own lane between steps and cases when notes
  exist. Click a dot to jump to that note in the side panel and
  seek the video to the note's timestamp.
- **Persistent timeline zoom + scroll per session** (P1.10). Zoom
  factor and `#timeline-scroll.scrollLeft` are persisted to
  localStorage keyed by sessionFolder; reopening a session restores
  the zoom and scroll position. Scroll writes are throttled to once
  per 250ms.
- **Project / engagement layer** (P2.1). New `viewer/project.js` data
  module + topbar Project menu + `.pdt-project.json` file format. A
  project bundles the loaded aggregate session set, the current focus
  session, the active process template, the current view mode, the
  current case scope, and the timeline zoom into a single re-loadable
  file. New IPC handlers `viewer:saveProject`, `viewer:saveProjectAs`,
  `viewer:openProject`, `viewer:loadProjectFile`. The Session view's
  empty state now surfaces a "Recent projects" list alongside "Recent
  sessions"; click a recent project to restore everything in one go.
  Standalone-session opens (the existing flow) still work unchanged
  and don't create projects until you explicitly Save as.
- **Aggregate filter date-range hint.** "YYYY-MM-DD" hint label appears next
  to the From / To date inputs in the Aggregate view so the expected format
  is obvious in environments where browsers render date inputs as plain text.

### Changed

- **Capture window palette aligned to viewer.** All capture-side windows
  (help, OBS settings, session config, label picker, prep-app vocab,
  legacy status) now use the same stratified-dark sage / slate ladder as
  the viewer (`--bg: #14141A` through `--bg-5: #484854`,
  `--fg: #D8D6CE`, `--accent: #6E8A66` sage,
  `--accent-2: #5A7488` slate). Eliminates the electric-blue accent
  (`#3a86ff`) that lingered in the older tray surfaces and clashed with
  the rest of the app.
- **Capture help window** rewritten to document the v0.3 surface area:
  Live Session window, hotkey overlay, first-run welcome, marker
  close-then-open default, multi-monitor screenshot config, and the
  Session config window (vs. raw YAML).
- **Viewer help modal** now documents undo / redo (Ctrl+Z / Ctrl+Y),
  the right-click context menu on activity bands (insert markers,
  scope-to-case, jump-to-case-start/end), and the analysis Cancel
  button.
- **README** gains a "What's new in v0.3" section near the top so a
  first-time reader doesn't have to dig through the changelog to learn
  about the live session window, undo, marker close-then-open, etc.
- **`scripts/generate-icons.ps1`** now reads the sage / slate / bg
  hex tokens directly from `viewer/styles.css` instead of duplicating
  the hardcoded literals. Falls back to the previous defaults if the
  CSS file is missing (so a stripped dist still builds icons).

### Removed

- **Dead `escapeHtml` stub in welcome-window.js**. The inline
  duplicate inside the embedded `<script>` block was unused;
  template-literal callers all hit the module-level definition.
  Bookkeeping cleanup.
- **Last `window.confirm` from the legacy status window.** End-session
  click in `capture/status-window.js` now opens an inline confirm row
  (Cancel / End session) styled to match the operator-panel pattern,
  rather than a raw browser confirm dialog. With this, no
  `window.confirm` or `window.prompt` remains in either app's normal
  flow.

## [0.3.0] - 2026-05-15

UX overhaul (capture + viewer) plus structured logging and CI from a
parallel work stream. See [docs/UX-CHANGES.md](docs/UX-CHANGES.md) for
the full UX changeset rationale and
[docs/SPEC-DEFERRED.md](docs/SPEC-DEFERRED.md) for items intentionally
deferred to v0.4+.

### Added (UX overhaul)

- **Themed confirm / prompt modals.** Replaces every browser-native
  `window.confirm` / `window.prompt` site in the viewer (7 call sites)
  with `confirmModal()` / `promptModal()` helpers. Destructive
  confirms support a `danger: true` flag that styles the OK button
  red and focuses Cancel. Same swap applied in the capture-side
  operator panel (sync ID, end session inline-confirm rows). Browser
  dialogs no longer appear in either app's normal flow.
- **First-run welcome window** (`capture/welcome-window.js`). 560×540
  onboarding shown once per machine (gated by
  `userData/welcome-shown.json`). Three CTAs: open the live session
  window, open help, dismiss. Reopenable via tray → Help.
- **Hotkey overlay widget** (`capture/hotkey-overlay.js`). Always-on-
  top, click-through, frameless 220×110 corner widget showing the
  three primary hotkeys. Toggleable from the tray; visibility
  persisted across launches.
- **Live session window** (`capture/operator-panel.js`, rebuilt).
  Merges the old operator panel and status window: counter grid,
  recent-events feed, fire-marker input + nest checkbox, inline sync
  marker, inline end-session confirm. Stratified-dark palette to
  match the viewer. The legacy status window remains in the tray as
  "Show status window (legacy)" for one release.
- **Marker close-then-open by default.** Pressing Start with an
  existing open marker now closes the open marker(s) and opens a
  sibling, eliminating the "4 starts, 0 ends, all nested" pathology
  that caused overlapping case bands. Nest semantics remain
  available via the "Nest under current" checkbox in the live
  session window, the picker's secondary button, or a dedicated
  tray submenu. Shift+Enter in the picker flips the choice for one
  fire.
- **Multi-monitor screenshot follows foreground.** New
  `screenshots.display` config (`"active"` default, `"primary"`,
  `"all"`). Active mode picks the display containing the focused
  window via `active-win` bounds; all mode captures every display
  and emits one screenshot event per file with `_d<displayId>.jpg`
  suffix. Fallback chain: foreground bounds → cursor position →
  primary.
- **Native Windows toast on recorder / OBS failure.** When the UIA
  recorder dies permanently or OBS connect fails (non-strict), an
  Electron `Notification` surfaces the failure. Replaces the silent
  tray-tooltip-suffix-only signalling.
- **Annotations undo stack** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
  Every step / phase / marker / note operation snapshots
  annotations.json before saving; undo reverts; redo replays. Stack
  capped at 50, reset on session switch. Action-labeled so the
  undo toast reads "Undone: split step."
- **Time-axis ticks on the Flow timeline.** Sensible tick step
  picked from `{1s, 2s, 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m,
  30m, 1h, 2h, 4h, 6h, 12h, 1d}` for ~12 ticks across the visible
  span. HH:MM:SS / HH:MM / M/D labels depending on granularity.
- **Event-density histogram lane.** 120-bucket histogram showing
  user-activity event volume per bin. Bookkeeping events (idle
  starts, pause/resume, recorder lifecycle) excluded so the lane
  reflects analyst-relevant activity. Makes idle-vs-active stretches
  readable at a glance.
- **Per-case lanes on the Flow timeline.** Each case occupies its
  own row via a sweep-line lane assignment, instead of all cases
  stacking onto a single depth-offset row. Dangling cases get a
  dashed right-edge treatment instead of merging visually with
  same-end-timestamp neighbours. Timeline height grows with
  `lanesNeeded`.
- **Case band context menu.** Right-click a case band: scope view
  to this case, jump to start, jump to end. Solves the case-scope-
  dropdown deduplication problem indirectly (you can pick visually).
- **Right-click discoverability hint.** Faint `⋯` fades in at the
  top-right of activity bands on hover; `cursor: context-menu`
  surfaces that right-click does something.
- **Analysis progress streaming + cancel.** Log host opens by
  default while normalize is running. Red Cancel button in the log
  summary kills the in-flight Python child (SIGTERM, then SIGKILL
  500ms later). Cancellation flows through all four normalize entry
  points (`viewer:runNormalize`, `viewer:runNormalizeExtended`,
  `viewer:testCanonicalMatch`, `viewer:bootstrapAppVocab`). The
  aggregate "Analyze all" loop additionally has its own Cancel
  button that kills the in-flight session and breaks the loop.
- **Brand-square icons** (`shared/tracker-icon.ico`, regenerable via
  `scripts/generate-icons.ps1`). Multi-resolution `.ico` (16/32/48/
  64/128/256) derived from the topbar logo design. Wired into both
  `capture/build-package.js` and `viewer/build-package.js` via
  `icon:`, so the .exe / taskbar / alt-tab / Start menu / window
  chrome show the brand square instead of the default Electron
  diamond. `capture/tray-icon.png` replaced with the matching
  32×32 brand square (was Motif's three-bar logo, an unrelated
  product).
- **Stratified-dark palette.** Viewer's six bg tokens (`--bg`
  through `--bg-5`) re-spaced across a wider lightness range
  (~6 points per step) so panels, the timeline strip, and rules
  visually separate at a glance. Foreground bumped to suit the
  brighter average surface. Accents unchanged. Hardcoded color
  literals in `dfg-viewer.js` and the right-click context menu
  rewritten to use CSS variables or token snapshots.
- **Filter clear-X buttons** on Recents (already shipped pre-v0.3
  but mentioned here for completeness).

### Added (other work stream)

- **Marker insert via the viewer timeline.** Right-click an activity band
  → "Insert Start marker here…" or "Insert End marker here". The edit is
  queued in `annotations.json.marker_edits` with `op: "insert"`; re-run
  normalization to apply. Closes the README's "analysts edit
  annotations.json directly until that ships" caveat. `apply_marker_edits`
  in `normalize.py` now supports the insert op.
- **Session config window in the capture app.** New "Session config..."
  tray menu entry opens a form for engagement ID, worker, idle threshold,
  process labels, and OBS scene. Saves to
  `%APPDATA%\process-discovery-tracker\quick-config.yaml`. The next
  launch picks this up automatically if `PDT_CONFIG` is unset.
- **Recorder sidecar threat model** section in `SECURITY.md`. Covers
  process boundary, IPC mechanism (NDJSON over stdio), privileges, what
  UIA does and doesn't expose, and the lifecycle events.
- **Structured logging** for normalization. `normalization/log_setup.py`
  configures a stdlib `logging` root with a stderr handler at WARNING and
  a per-session `RotatingFileHandler` writing `normalize.log` into the
  session folder at INFO. Called from `normalize.py` entry.
- **Capture-side log helpers.** `capture/log.js` exposes `appLogger()`
  (writes to `%APPDATA%\process-discovery-tracker\app.log`) and
  `createSessionLogger(folder)` (writes to `<session>/capture.log`).
  Always-on; complements the existing `bootLog` (gated on `PDT_DEBUG=1`).
- **OBS lifecycle now logs to `app.log`.** Connect failures, scene
  bootstrap failures, and start/stop record failures land in
  `app.log` in addition to the debug-only `boot.log`.
- **Pytest CI.** `.github/workflows/pytest.yml` runs the normalization
  test suite on push and PR to master/main. windows-latest, Python 3.12.
- **`stats.json.meta.dropped_jsonl_lines`.** Count of malformed JSONL
  events the normalizer dropped during load. Surfaces in the pipeline
  console output as well.
- **`docs/DEPLOY.md`.** Install, upgrade, rollback runbook for capture
  and viewer. Includes the BPMN export pivot path if Adonis ever
  rejects PM4Py's output.
- **`docs/TROUBLESHOOTING.md`.** Known failure modes (OBS, recorder,
  hotkeys, taxonomy YAML, slow mining) with log-file pointers.
- **Data dictionary** in `shared/SCHEMA.md`. Semantic notes for the
  `case_ids` stack, step lifecycle states, interaction enrichment
  precedence, and every `stats.json.meta` field.

### Changed

- **Silent exception handlers narrowed.** `bpmn_step.py`, `bpmn_phase.py`,
  and `pdd_export.py` previously caught `Exception` and `pass`'d. Each
  site now catches the specific exceptions it can produce and logs a
  warning with the step / file context. `step_csv.py` was reviewed and
  left as-is — its `except ImportError: pass` is an intentional optional
  pandas fallback to stdlib `csv`.
- **`pdd_export.py` italic bug fixed.** `p.italic = True` on a python-docx
  `Paragraph` is a no-op (only `Run` has `italic`). The previously-swallowed
  AttributeError is now properly avoided by iterating `p.runs`.
- **Malformed JSONL is now logged, not silently dropped.** `load_events`
  in `normalize.py` emits a `WARNING` per dropped line with line number
  and a 120-char snippet. The total count appears in the pipeline summary
  and in `stats.json.meta`.
- **Taxonomy promotion YAML uses `[REVIEW]` instead of `TODO -`.** The
  viewer's "Promote unclassified to taxonomy" export prefixes generated
  labels with `[REVIEW]` so they're visually distinct from forgotten
  developer TODOs that survived into shipped output.

## [0.2.0] - 2026-05-15

First release published via GitHub Releases. Prebuilt binaries are
attached as `capture-v0.2.0.zip` and `viewer-v0.2.0.zip`; the in-repo
`capture/dist/` and `viewer/dist/` trees are gone (gitignored). On a
fresh machine, download from the Releases page rather than cloning the
repo. See README "Installing a prebuilt release" for the SME-side flow.

### Added

- **`interactions.verbose` config flag.** Opt-in forensic mode that
  restores the raw UIA event firehose (focus_changed, text_changed,
  per-keystroke value_changed). Default off. Use only when debugging
  missing events or focus-tracking issues; expect ~3-5x more events
  per session.
- **Auto-extract for `recorder.zip` at runtime.** If `recorder.exe` is
  missing but `recorder.zip` is present next to where it should land,
  `resolveRecorderPath()` extracts it via Windows-native `tar.exe -xf`
  (libarchive-backed, ships with Win10+). Eliminates the silent-fail
  trap where capture sessions ran without UIA recording because the
  recorder zip was never manually extracted.
- **`scripts/publish-release.ps1`.** Wraps `gh release create
  vX.Y.Z dist\release\*.zip ...`. Verifies both assets exist before
  uploading; supports `-NotesFile`, `-Draft`, `-Prerelease`.
- **`docs/BUILD-AND-DIST.md`.** Explains the recorder.exe topology
  (`bin/` vs `obj/` vs `publish/` vs `dist/.../resources/publish/`),
  the distribution model (GitHub Releases), and what's safe to delete
  to reclaim disk space.

### Changed

- **UIA subscriber filters noise at the source.** Three high-volume
  subscriptions were dropped from the default subscription set:
  - `focus_changed` events (fired on every Tab keystroke, click-shift,
    menu hover, dialog open/close). The window/process semantics we
    actually care about ride along on the next signal event.
  - `text_changed` events (notification-only, no payload, mostly a
    heartbeat indicating typing somewhere).
  - Win32 desktop-chrome events (taskbar, window manager, AltTab
    list) where `FrameworkId == "Win32"` and `ControlType` is in
    `{Pane, Group, Window, Custom}`.
  - `value_changed` / `range_value_changed` are now coalesced per
    `(pid, automation_id || name)` within a 750ms debounce window:
    typing "Customer Acme Corp" in an edit field produces one event
    with the final value instead of one per keystroke.

  Expected event volume reduction: 70-85% in typical sessions. An
  8h session that previously produced ~85k events should land in
  the ~15-25k range without losing analytical signal.

- **`scripts/build-distribution.ps1`** now produces `dist/release/`
  containing `capture-vX.Y.Z.zip` and `viewer-vX.Y.Z.zip` ready to
  attach to a GitHub Release. Each zip has a single versioned
  top-level folder (e.g. `capture-v0.2.0/`) so Windows Explorer's
  "Extract All" produces the expected layout. New flags: `-Version`
  (override the release-asset version suffix), `-SkipRelease` (build
  but don't zip).

- **`README.md`** rewrote the "Building for distribution" and added a
  new "Installing a prebuilt release" section. Recipients are
  directed to the Releases page rather than to a manual zip dance.

### Removed

- **In-repo prebuilt `dist/` trees.** `capture/dist/` and `viewer/dist/`
  are now gitignored. The previous "commit the .zip-of-.exe to fit
  under GitHub's 100 MB file limit" workaround was replaced by GitHub
  Releases (2 GB per asset). About 600 MB of committed binaries dropped
  from the repo.
- **`scripts/unzip-dist.ps1`.** Obsolete — Releases ship unzipped
  folders.

### Migration notes

- **For SMEs / analysts**: stop cloning the repo to get the apps. Go
  to the [Releases page](../../releases), grab the two zips, extract,
  run.
- **For maintainers**: the recorder.exe must be rebuilt (`cd capture &&
  npm run build:recorder`) for the noise filter to take effect — the
  C# subscription set lives in `recorder.exe`, not the Electron host.
- **For anyone running an existing session with the old recorder**:
  no action required, but consider a fresh build to cut event volume.

## [0.1.0] - 2026-05-14

Pre-release internal builds. Not published to GitHub Releases; binaries
lived inside the repo as zipped .exe files in `capture/dist/` and
`viewer/dist/`. See git history for incremental changes.
