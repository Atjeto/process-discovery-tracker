# Changelog

All notable changes to the Process Discovery Tracker. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
