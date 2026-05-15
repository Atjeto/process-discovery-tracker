# Changelog

All notable changes to the Process Discovery Tracker. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
