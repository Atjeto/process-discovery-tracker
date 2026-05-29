# Process Discovery Tracker

Internal tool for capturing and analyzing process discovery sessions. Full design in [../process_discovery_tracker_design.md](../process_discovery_tracker_design.md).

## What's new in v0.19.0

The current version is **0.19.0** (SemVer 0.x). v0.18.x – v0.19.0 closed **Phase 0
of the ML-integration recommendation** (two non-ML detectors for the "worker forgot
to fire markers, no Process Template configured" failure mode) and finished the
**productization cycle** — analyst deliverable polished to a small-internal-rollout
bar:

- **Suggested markers** ([ADR-0017](docs/adr/0017-suggested-markers.md)). A
  hand-rolled change-point detector (`normalization/marker_suggest.py`) scans an
  unbracketed recording and surfaces candidate Start/End boundaries as dashed bars
  on the Flow timeline with Accept/Dismiss rows; Accept brackets a real case on the
  next Analyze. No new dependencies; dismissals and accepts survive re-normalize.
- **Anchor candidates** ([ADR-0018](docs/adr/0018-anchor-candidates.md)). A
  pattern-mining detector (`normalization/anchor_suggest.py`) ranks the field whose
  typing would naturally segment the session into cases (a customer-ID search box, a
  serial-number entry); Accept writes a session-level `case_anchor_override` that
  case assignment consults before the marker-mode fallback — turning a "0 cases"
  discovery session into real cases without hand-writing a Process Template.
- **In-view Session map.** A **Map** level (plus a one-click **"View map"** from a
  single Session) renders a single session's full interactive process map inline —
  the same notation × level matrix (Activity/Step/Phase × Flow/BPMN, zoom/pan) that
  used to be Compare-Sessions only — backed by a shared `map-controller.js`.
- **Segment-level automation candidacy** ([ADR-0016](docs/adr/0016-segment-level-automation-candidacy.md)).
  Automation is scored at the coherent-segment grain — a contiguous, same-app run
  the robot could take end-to-end — not per atomic step. Sub-5 s single-step
  segments are dropped because they can't be automation units on their own. PDD §4
  renders the segment table; the Analysis view and Compare-Sessions automation
  panel use the same shape.
- **PDD = a standard RPA Process Definition Document.** Document control,
  introduction (purpose / objectives / contacts), As-Is process description
  (overview, applications-used table, embedded process-map image, statistics with
  a where-the-time-went breakdown, detailed steps, input data), automation
  assessment, exceptions & variations. Pipeline-filled where the data exists,
  explicit `[To be completed]` for the analyst-judgement parts.
- **Decluttered Analysis.** The Compare-Sessions Analysis panel (adaptive
  columns, signal-only rows, automation table collapses to a note when nothing's
  scoreable) and the single-session Waste-by-step (rolled up by `process_label`,
  instant micro-steps behind an expander, edits propagate across instances).
- **Capture polish for the field laptop.** Settings / Profile / Session-setup
  tray IA split by lifetime, backed by a `userData/user-config.json` overlay
  deep-merged on top of the YAML config. The ~5 s session-start freeze is gone
  (best-effort OBS connect moved off the critical path). Chromium web-content
  reaches the recorder out of the box.
- **Intra-session repetition alignment** ([ADR-0015](docs/adr/0015-intra-session-repetition-alignment.md)).
  Steps view's Flat / Aligned toggle shows a consensus backbone across detected
  cases; edit a backbone step and "Apply to all N instances" propagates the
  curation in one annotations write, reversible with one Ctrl+Z.
- **Pipeline hardening.** Committed seeded fuzzers
  (`case_assignment` / `stats_compute` / analysis layer / `step_suggest`) pin
  invariants and the corrupt-log robustness regime. The eight `parse_ts` copies
  consolidate to one shared helper. A `process_label` Python↔JS golden keeps the
  two engines in lock-step.

Headline capabilities added since v0.5.0:

- **Platform/framework recognition layer** ([ADR-0011](docs/adr/0011-platform-recognition-layer.md)).
  Interactions are typed by documented, cross-app platform signatures (UIA
  ControlTypes plus Chromium/Edge, Bootstrap, AG-Grid, SharePoint, Office 365 and
  Win32 conventions) loaded from `shared/recognition-patterns.json` by **both** the
  viewer and the Python pipeline — meaning transfers across engagements instead of
  riding one app's opaque automation IDs.
- **Process maps as a notation × level matrix.** Process diagram (BPMN) and Flow
  diagram (DFG), each at Activity / Step / Phase level, with the level selector and
  the notation tabs independent. Step/Phase maps are the *observed flow* mined from
  your annotations, so the map is meaningful even with no taxonomy.
- **Value-free `process_label` grouping** ([ADR-0013](docs/adr/0013-value-free-grouping-and-map-readability.md)).
  A step's auto-name embeds case values ("Search — CUST-10852"); the value-free
  label ("Search") is the grouping key for the step map *and* the analysis/stats, so
  work repeated across cases collapses to one node/row instead of a per-instance
  hairball. Phase→step→activity drill-down and a "Hide rare paths" toggle keep a
  dense map readable.
- **Anchor-based case detection** ([ADR-0012](docs/adr/0012-active-case-stamping-and-map-matrix.md)).
  Cases can be detected from a recurring field value (a ticket or serial number),
  stable per label and stamped onto interleaved work, with no manual markers —
  replacing the old gap-based splitting.
- **Heuristic IE/CI analysis layer** ([ADR-0008](docs/adr/0008-build-the-analysis-layer.md)).
  Per-step waste classification, a time study, automation-candidate scoring and a
  process-efficiency ratio, written to `analysis.json` and correctable by the
  analyst; a cross-session Analysis panel pools findings across recordings.
- **Classification you can fix in place.** A per-web-app taxonomy, reclassify from
  the Flow map, an in-app classification manager, and team-taxonomy promotion — plus
  App Vocabulary / App Library enrichment ([ADR-0002](docs/adr/0002-app-vocabularies.md)).
- **Exports.** A self-contained HTML findings report, a Markdown report (Activity
  *and* Step statistics), a PDD document, and process-map SVG export.
- **Viewer/recorder UX overhaul** ([ADR-0010](docs/adr/0010-ux-overhaul-viewer-recorder.md)):
  interaction colour-coding, click-to-split steps, a step context menu, step flags
  that reach the outputs, configurable recorder hotkeys, an always-on-top
  tray-reachable Live Session window, and a **Studio Dark** theme alongside the light
  Warm Editorial default.
- **Capture hardening.** The C# .NET 8 UI-Automation recorder gained health events,
  uncaptured-app flags, per-app coverage hints and a forensic verbose mode; the
  capture app writes events through a 500 ms batching queue (markers/system flush
  immediately) and a session-integrity manifest.

Full per-release history (including v0.6.0–v0.14.4) is in
[CHANGELOG.md](CHANGELOG.md). Selected earlier highlights:

### v0.5.0 — capture tech-debt remediation

- **Capture-app tech-debt remediation** (capture). A `node:test` unit suite;
  `main.js` decomposed into focused modules (`boot-log`, `notify`,
  `session-storage`, `window-manager`); window HTML extracted into
  `capture/ui/*.html`; config defaults consolidated to one source; a recorder
  liveness watchdog; screenshot-trigger debounce; and desktop notifications when
  capture is degrading. Decision record:
  [ADR-0005](docs/adr/0005-capture-architecture-remediation.md).
- **Viewer Flow timeline on the shared core** (viewer). The Flow timeline was
  migrated onto `timeline-core` as lane plugins, completing the ADR-0003 viewer
  refactor.

### v0.3 — Live Session window, hotkey overlay, marker close-then-open

- **Live Session window** (capture). One window with the recording indicator, session timer, open-marker stack, counters, recent-events feed, fire-marker input, sync marker, and inline end-session confirm. Replaces the old operator panel + status window split.
- **Hotkey overlay** (capture). Always-on-top, click-through corner widget showing the three primary hotkeys. Toggle from the tray; visibility persisted.
- **First-run welcome window** (capture). 560×540 onboarding shown once per machine; reopenable via tray → Help.
- **Marker close-then-open by default** (capture). Pressing Start with an existing open marker closes it and opens a sibling, eliminating the "4 starts, 0 ends, all nested" pathology. Nest semantics still available via a checkbox / submenu / Shift+Enter.
- **Multi-monitor screenshot follows foreground** (capture). New `screenshots.display` config — `"active"` (default), `"primary"`, `"all"`.
- **Native Windows toast on recorder / OBS failure** (capture). Failures become visible instead of silently breaking the session.
- **Session config window** (capture). Tray entry opens a form for engagement ID, worker, idle threshold, process labels, OBS scene; saves to `quick-config.yaml` for the next launch.
- **Annotations undo / redo** (viewer). `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) on every step / phase / marker / note edit. Stack capped at 50, reset on session switch.
- **Time-axis ticks + event-density histogram + per-case lanes** (viewer). Wall-clock labels along the timeline, an activity-density strip, and one row per case so dangling / overlapping bands stay readable.
- **Right-click context menu on activity bands** (viewer). Insert Start/End markers at the clicked moment; a faint `⋯` hover hint advertises the menu.
- **Themed confirm / prompt modals** (viewer + capture). No more raw browser dialogs. Destructive confirms style the OK button red and default focus to Cancel.
- **Analysis progress streaming + Cancel** (viewer). Long analyses show progress and can be aborted via a red Cancel button.
- **Stratified-dark palette** across all surfaces. Sage / slate accents, no electric blue. Capture and viewer windows now share the same look.

### v0.4.0 — Warm Editorial redesign + project layer

The **Warm Editorial** redesign — the dark "stratified-dark" theme replaced by a warm light theme, with a rebuilt Flow timeline and Steps view ([ADR-0004](docs/adr/0004-flow-timeline-steps-rework.md)) — plus the project layer, ten timeline / aggregate features, business-language relabeling, and a number of polish items:

- **Project / engagement layer** (viewer). Top-bar Project menu lets you save the current aggregate session set + focus session + active Process Template + view mode + case scope into a single `.pdt-project.json` file. Reopen restores everything in one click. "Recent projects" surfaces in the Session view's empty state alongside Recent sessions.
- **Range selection on the timeline** (viewer). **Shift-drag** across the Flow timeline to mark a range; a stats card shows duration, event/marker/screenshot counts, and top apps in the range. Esc clears.
- **Screenshot hover thumbnails + minimap + per-step bands + annotation lane** (viewer). Hovering a screenshot dot pops a 220×140 thumbnail. A 30-px minimap above the timeline gives you whole-session orientation; click anywhere to jump, drag the highlighted viewport to scroll. When steps exist, they render as labeled bands beneath the density histogram. When notes exist, they render as numbered dots in their own lane.
- **DFG drill-down picker** (viewer). Clicking a node in the Compare-Sessions Flow diagram now lists every loaded session containing that activity (timestamp + session name) so you can pick the moment you actually meant. Single result auto-picks; ↑↓/Enter for keyboard navigation.
- **Sparklines on aggregate charts + persistent timeline zoom + scope-to-playhead + snap-to-event** (viewer). Activity-frequency and case-duration bars get a 10-bucket sparkline showing temporal distribution. Timeline zoom + scroll persist per session in localStorage. New `⇥ playhead` button next to the case-scope dropdown scopes to whichever case the video playhead is in. Background timeline clicks snap to the nearest event within ~10px-equivalent.
- **Auto-clean stale recents + batch "Remove N missing"** (viewer). Recents entries missing for >30 days auto-drop. When ≥2 recents are flagged missing, a "Remove N missing" link appears alongside Clear all.
- **Auto-suggested phase grouping** (viewer). New "Suggest groupings..." link on the Phases pane runs two heuristics — group consecutive steps by app, group consecutive steps with no idle gap > 30s — and offers the candidates as preview before applying.
- **Hotkey conflict toast + tray menu reorganization + live-session keyboard control** (capture). When `globalShortcut.register()` fails (another app grabbed the binding), a Windows toast names the conflict. The tray's flat ~15-item menu collapses into Live status / Storage / Help & config submenus while keeping muscle-memory items (Fire Start / End / Pause) at top. The Live Session window picks up S/E/P/Y shortcuts (suppressed when an input is focused).
- **Mode-specific shortcuts overlay** (viewer). Dismissable bottom-right card in the Session view lists 3-4 most-used shortcuts for the active mode (Flow / Steps / Phases).
- **Business-language relabeling** (viewer). "Aggregate" → "Compare Sessions", "Vocabularies" → "App Library", "DFG" → "Flow diagram", "BPMN" → "Process diagram (BPMN)". Toast + dialog copy rewritten. Process Template's raw definition lives behind an "Advanced" disclosure so non-engineer analysts see the step list as the default surface.

### v0.4.0 — round-2 UX feedback pass

A pass driven by hands-on field testing of the above. Fixes friction and clarifies the parts that were hard to use:

- **Step-noise denylist** (viewer + normalization). A session captured with OBS (or any app the recorder picks up) used to produce dozens of unannotatable "OBS: 12 interactions" steps. New per-session denylist (`annotations.json` → `step_filters.ignored_processes`); `step_suggest.py` drops matching interactions before step suggestion. The Steps view has an **"Ignored apps..."** dialog (tick the apps to exclude → re-analyzes), a **"Delete selected"** bulk action, and a **"Hide as noise"** per-step button whose hidden state survives re-analyze.
- **Capture: explicit "Start capture session" button**. The Live Session window now shows an obvious green Start button when idle — firing a marker still auto-starts, but you no longer have to know that.
- **Recent dropdown in the top-bar** (viewer). Recent sessions + projects are reachable any time, not just from the empty state.
- **Timeline Lanes menu** (viewer). The timeline had grown to nine stacked lanes; a "Lanes" dropdown toggles each, with the denser lanes (density / window-titles / per-step / notes) off by default.
- **Flow diagram variant overlay** (viewer). Hovering a node in the Compare Sessions Flow diagram highlights the session paths through that activity and dims the rest. (The separate variant-flow Sankey was removed — the Flow diagram absorbed it.)
- **Process map SVG export** (viewer). New "Process map SVG" button exports the active map (BPMN process diagram or Flow diagram) as SVG — imports into Figma, Lucidchart, browsers.
- **Bug fixes**: timeline resize handle now works (`flex` was overriding the height var); Compare Sessions zoom buttons no longer overlap the tabs; the misleading `+` cursor over the timeline is gone; screenshot dots toned down; the Steps editor pane stays pinned while the step list scrolls.
- **Clearer wording**: capture session-config window rewritten in plain language ("Set up a recording session"); "Rework loops" → "Repeated activities within a case".

Items intentionally deferred: see [docs/SPEC-DEFERRED.md](docs/SPEC-DEFERRED.md).

## Layout

| Folder | Role |
|---|---|
| `capture/` | Worker-side Electron tray app. Polls active window, fires marker events, drives OBS, captures screenshots, writes per-session JSONL. |
| `normalization/` | Analyst-side Python pipeline. Turns raw `events.jsonl` into XES + CSV + statistics + (optional) mined BPMN. |
| `viewer/` | Analyst-side Electron app. Two surfaces: Session view (video-synced timeline + annotations) and Compare Sessions view (process map, statistics, exports). |
| `shared/` | Cross-cutting schema docs. |

## End-to-end flow

```
[ worker machine ]                     [ analyst machine ]
+----------------+                     +---------------------+
| capture/       |   session folder    | viewer/             |
|  - tracker     | ------------------> |  - loads JSONL      |
|  - OBS control |  (events.jsonl,     |  - runs normalize   |
|  - screenshots |   manifest, video,  |  - shows timeline   |
|                |   screenshots, ...) |  - mines + exports  |
+----------------+                     +---------------------+
                                              |
                                              v
                                      +---------------------+
                                      | normalization/      |
                                      |  - case assignment  |
                                      |  - classification   |
                                      |  - XES + CSV emit   |
                                      |  - PM4Py mining     |
                                      |  - statistics       |
                                      +---------------------+
```

The session package is the single integration seam (§2.1). Anything downstream of capture is reproducible from `events.jsonl` plus the taxonomy.

## Quick start

### Capture (worker side)

```
cd capture
npm install
npm start
```

Tray icon appears. `Ctrl+Shift+S` opens a label picker for Start markers, `Ctrl+Shift+E` closes innermost, `Ctrl+Shift+P` takes a manual screenshot. Set `PDT_CONFIG=path/to/config.yaml` to load a per-session config (see `capture/sample-config.yaml`).

Output: `%APPDATA%\process-discovery-tracker\sessions\<engagement>\<timestamp>\`.

### Normalization (analyst side)

```
cd normalization
pip install -r requirements.txt
python normalize.py path/to/session/folder --taxonomy sample-taxonomy.yaml --mine
```

Writes `events.xes`, `events.csv`, `stats.json`, `process_map.bpmn`, `dfg.json` into the same folder.

### Viewer (analyst side)

```
cd viewer
npm install
npm start
```

`Open session folder...` and `Run normalization` to round-trip from raw to mined in the UI. Aggregate view loads multiple sessions for cross-session synthesis.

## Defaults picked from the design's open questions

Documented here so they're easy to revisit:

| Open question | Default picked | Where |
|---|---|---|
| §3.7.1 Flush cadence | 500 ms batch queue; markers/system flush immediately | `capture/tracker.js` |
| §3.7.2 Open markers at crash | Orphan manifest marked `recovered`; normalization layer reconciles | `capture/session.js`, `normalization/case_assignment.py` |
| §5.4 Case duration default | Active duration | `normalization/statistics.py` -- both metrics surface in `stats.json`, viewer shows both |
| §6.4 OBS scene bootstrap | Programmatic via `CreateScene` + `CreateInput` | `capture/obs.js` |
| §9.3 Annotations re-norm | Write to `annotations.json` sidecar; raw events immutable | `viewer/main.js`, `capture/session.js` |
| §11.5 Install topology | Worker: packaged Electron .exe. Analyst: `python-runner.js` resolves `PDT_PYTHON` -> python-embeddable sibling -> system `python` | `viewer/python-runner.js` |

## What's still deferred

Items the design explicitly punts to v1.5+ or beyond:

- **ML capabilities** (§10). Activity equivalence / variant merging via sentence-transformer embeddings + HDBSCAN, case-boundary inference for unbracketed sessions via change-point detection, transaction ID auto-extraction via pattern mining, screen understanding via vision-language models. All v1.5 to v3+. *(The **non-ML Phase 0** of the middle two has since shipped — hand-rolled change-point and pattern-mining detectors, [ADR-0017](docs/adr/0017-suggested-markers.md) / [ADR-0018](docs/adr/0018-anchor-candidates.md); the ML-backed versions remain deferred.)*
- **Multi-analyst concurrent editing** of the same session (§13). Single-analyst editing only.
- **Marker split via UI**. Rename, adjust-timestamp, delete, and insert are all wired through `annotations.json.marker_edits`. The viewer's timeline now exposes insert via right-click on an activity band → "Insert Start marker here…" / "Insert End marker here". The edit is queued; re-run normalization to apply.

## Tooling

- `scripts/build-distribution.ps1` - orchestrates the complete ship-ready build (see "Building for distribution" below). Produces `dist/release/*.zip` ready to attach to a GitHub Release.
- `scripts/publish-release.ps1` - wraps `gh release create`. Uploads the two zips from `dist/release/` to a tagged GitHub Release.
- `scripts/build-python-embeddable.ps1` - downloads the Python embeddable distribution, enables site-packages, bootstraps pip, installs `normalization/requirements.txt`, and lands a self-contained `viewer/python/` folder that the viewer's `python-runner.js` auto-discovers. Production install topology per §11.5 option (a).
- `scripts/prune-sessions.py` - storage retention CLI. Lists or deletes captured session folders older than N days. Defaults to a dry-run; pass `--apply` to delete. Optional `--keep-recovered` skips orphan-recovered sessions.
- `scripts/generate-sbom.js` - emits a CycloneDX 1.5 SBOM at `dist/SBOM.json` listing every npm and Python dependency in the shipping bundle. No external deps; pure Node stdlib.

## Security posture

See [SECURITY.md](SECURITY.md) for the full threat model and [docs/Security-QA.md](docs/Security-QA.md) for the one-page Q&A you can paste into a corp security ticket. Run `powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1` before any commit or release to fail-fast on runtime advisory regressions. The short version:

- No network egress at runtime (only OBS on `ws://127.0.0.1:4455`).
- No telemetry, no update checks.
- No process injection, DLL hooks, or keyboard hooks. Foreground-window polling only.
- Screenshots via Electron's first-party `desktopCapturer` API (no bundled helper executables that AV heuristics flag).
- Content-Security-Policy on every renderer window with `connect-src 'none'`.
- `setWindowOpenHandler` denies external windows; `will-navigate` is blocked.
- All user-supplied strings escaped before HTML injection.
- 0 runtime npm advisories on both apps (see SECURITY.md for details).
- CycloneDX 1.5 SBOM generated by `scripts/generate-sbom.js`.

## Installing a prebuilt release (analyst / SME machine)

Prebuilt binaries ship via **GitHub Releases** rather than living inside the repo. On the target machine:

1. Open the [Releases page](../../releases) and download both assets from the latest tag:
   - `capture-vX.Y.Z.zip` -- the worker tray app
   - `viewer-vX.Y.Z.zip` -- the analyst UI (bundles Python + PM4Py)
2. Right-click each zip > Extract All. Pick anywhere -- `C:\Tools\`, your profile, wherever.
3. Run `Process Discovery Tracker.exe` (capture) or `Process Discovery Viewer.exe` (viewer) directly. No installer, no admin rights, no Python install.

If GitHub isn't reachable from the SME's machine, an analyst with the zips on a USB / OneDrive can hand them over the same way.

## Building for distribution

One command produces ship-ready Windows folders for both apps plus a `dist/release/` containing the two zips ready to attach to a GitHub Release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1
```

Output:

```
dist/
  capture/<Process Discovery Tracker-win32-x64>/
    Process Discovery Tracker.exe
    resources/
    ...
  viewer/<Process Discovery Viewer-win32-x64>/
    Process Discovery Viewer.exe
    resources/
      python/python.exe          (PM4Py, pandas, networkx, pyyaml preinstalled)
      normalization/normalize.py (normalization pipeline)
    ...
  User-Guide.docx
  DISTRIBUTION.md
  release/
    capture-vX.Y.Z.zip           upload these two to the GitHub Release
    viewer-vX.Y.Z.zip
```

To publish a release once the build is done:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-release.ps1 -Version 0.5.0
# or, manually:
gh release create v0.5.0 dist\release\capture-v0.5.0.zip dist\release\viewer-v0.5.0.zip --title "Process Discovery Tracker v0.5.0"
```

Build flags:
- `-SkipPython` - skip rebuilding `viewer/python/` if it already exists. Saves 3-5 minutes.
- `-Clean` - wipe `dist/` and per-app `dist/` folders before building.
- `-Version 0.5.0` - override the version baked into the release-asset filenames.
- `-SkipRelease` - stop after producing the unzipped dist trees (no `dist/release/` zips).

The build uses `electron-packager` rather than `electron-builder` to avoid the Windows symlink requirement during winCodeSign cache extraction. If you want NSIS installers, enable Developer Mode in Windows Settings (or run as admin) and the per-app `npm run dist` scripts will produce them via electron-builder.

Pre-build prerequisites: Node 18+, npm, PowerShell, .NET 8 SDK (for the C# recorder), `gh` CLI (for `publish-release.ps1`; manual `gh release create` works too). The script downloads the Python embeddable and the Electron binaries on first run; subsequent runs use the cache.

## UI / UX in this pass

- **Capture** ships a live status window (toggle from tray) -- recording indicator, session timer, open-marker stack with nesting, event/marker/screenshot counters, recent-events feed, quick actions (pause, manual screenshot, end session).
- **Viewer** renders the discovered process map two ways: BPMN diagram via `bpmn-js`, DFG via `cytoscape` with `dagre` layout. Tabbed inside one panel so you can flip between them.
- **Viewer statistics** panels render as inline SVG horizontal bar charts (activity frequency with total duration label, case durations with active + wall-clock overlay). Tables for variants / outliers / rework.
- **Session timeline** has zoom in / out / reset, click-to-seek, hover tooltips, nested case bands, screenshot dots, marker labels, video playhead sync, and an event filter (by type, text).
- **Recent sessions** persisted in localStorage and surfaced on the empty state of session view.
- **Keyboard shortcuts**: `1` / `2` switch tabs, `Space` play/pause video, `← →` scrub 5s (`Shift` for 10s), `+ - 0` zoom timeline.
- **Annotation sidebar** has three tabs: notes, screenshots grid, marker list -- all click-to-seek.
- **Empty states + toast notifications** so the app is usable when no data is loaded yet.
