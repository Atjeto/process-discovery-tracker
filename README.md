# Process Discovery Tracker

Internal tool for capturing and analyzing process discovery sessions. Full design in [../process_discovery_tracker_design.md](../process_discovery_tracker_design.md).

## What's new in v0.3

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

Items intentionally deferred to v0.4+: see [docs/SPEC-DEFERRED.md](docs/SPEC-DEFERRED.md).

## Layout

| Folder | Role |
|---|---|
| `capture/` | Worker-side Electron tray app. Polls active window, fires marker events, drives OBS, captures screenshots, writes per-session JSONL. |
| `normalization/` | Analyst-side Python pipeline. Turns raw `events.jsonl` into XES + CSV + statistics + (optional) mined BPMN. |
| `viewer/` | Analyst-side Electron app. Two surfaces: session view (video-synced timeline + annotations) and aggregate view (DFG, statistics, exports). |
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
| §3.7.1 Flush cadence | Per-event `appendFileSync` | `capture/tracker.js` |
| §3.7.2 Open markers at crash | Orphan manifest marked `recovered`; normalization layer reconciles | `capture/session.js`, `normalization/case_assignment.py` |
| §5.4 Case duration default | Active duration | `normalization/statistics.py` -- both metrics surface in `stats.json`, viewer shows both |
| §6.4 OBS scene bootstrap | Programmatic via `CreateScene` + `CreateInput` | `capture/obs.js` |
| §9.3 Annotations re-norm | Write to `annotations.json` sidecar; raw events immutable | `viewer/main.js`, `capture/session.js` |
| §11.5 Install topology | Worker: packaged Electron .exe. Analyst: `python-runner.js` resolves `PDT_PYTHON` -> python-embeddable sibling -> system `python` | `viewer/python-runner.js` |

## What's still deferred

Items the design explicitly punts to v1.5+ or beyond:

- **ML capabilities** (§10). Activity equivalence / variant merging via sentence-transformer embeddings + HDBSCAN, case-boundary inference for unbracketed sessions via change-point detection, transaction ID auto-extraction via pattern mining, screen understanding via vision-language models. All v1.5 to v3+.
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
powershell -ExecutionPolicy Bypass -File .\scripts\publish-release.ps1 -Version 0.2.0
# or, manually:
gh release create v0.2.0 dist\release\capture-v0.2.0.zip dist\release\viewer-v0.2.0.zip --title "Process Discovery Tracker v0.2.0"
```

Build flags:
- `-SkipPython` - skip rebuilding `viewer/python/` if it already exists. Saves 3-5 minutes.
- `-Clean` - wipe `dist/` and per-app `dist/` folders before building.
- `-Version 0.2.0` - override the version baked into the release-asset filenames.
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
