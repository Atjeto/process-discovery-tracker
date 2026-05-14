# Process Discovery Tracker

Internal tool for capturing and analyzing process discovery sessions. Full design in [../process_discovery_tracker_design.md](../process_discovery_tracker_design.md).

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
- **Marker split via UI**. The schema supports it (delete + insert), and rename / adjust-timestamp / delete are wired. Inserting a synthetic Start mid-case via the viewer UI is not yet exposed; analysts edit annotations.json directly until that ships.

## Tooling

- `scripts/build-distribution.ps1` - orchestrates the complete ship-ready build (see "Building for distribution" below).
- `scripts/build-python-embeddable.ps1` - downloads the Python embeddable distribution, enables site-packages, bootstraps pip, installs `normalization/requirements.txt`, and lands a self-contained `viewer/python/` folder that the viewer's `python-runner.js` auto-discovers. Production install topology per §11.5 option (a).
- `scripts/prune-sessions.py` - storage retention CLI. Lists or deletes captured session folders older than N days. Defaults to a dry-run; pass `--apply` to delete. Optional `--keep-recovered` skips orphan-recovered sessions.

## Building for distribution

One command produces zip-and-ship Windows folders for both apps, with the bundled Python and normalization scripts already inside the viewer's `resources/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-distribution.ps1
```

Output lands in `dist/`:

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
```

To ship: zip each app folder and copy to the target machine. Recipients unzip and run the .exe directly. No install, no admin rights, no Python install required on the analyst side.

Flags:
- `-SkipPython` - skip rebuilding `viewer/python/` if it already exists. Saves 3-5 minutes.
- `-Clean` - wipe `dist/` and per-app `dist/` folders before building.

The build uses `electron-packager` rather than `electron-builder` to avoid the Windows symlink requirement during winCodeSign cache extraction. If you want NSIS installers, enable Developer Mode in Windows Settings (or run as admin) and the per-app `npm run dist` scripts will produce them via electron-builder.

Pre-build prerequisites: Node 18+, npm, PowerShell. The script downloads the Python embeddable and the Electron binaries on first run; subsequent runs use the cache.

## UI / UX in this pass

- **Capture** ships a live status window (toggle from tray) -- recording indicator, session timer, open-marker stack with nesting, event/marker/screenshot counters, recent-events feed, quick actions (pause, manual screenshot, end session).
- **Viewer** renders the discovered process map two ways: BPMN diagram via `bpmn-js`, DFG via `cytoscape` with `dagre` layout. Tabbed inside one panel so you can flip between them.
- **Viewer statistics** panels render as inline SVG horizontal bar charts (activity frequency with total duration label, case durations with active + wall-clock overlay). Tables for variants / outliers / rework.
- **Session timeline** has zoom in / out / reset, click-to-seek, hover tooltips, nested case bands, screenshot dots, marker labels, video playhead sync, and an event filter (by type, text).
- **Recent sessions** persisted in localStorage and surfaced on the empty state of session view.
- **Keyboard shortcuts**: `1` / `2` switch tabs, `Space` play/pause video, `← →` scrub 5s (`Shift` for 10s), `+ - 0` zoom timeline.
- **Annotation sidebar** has three tabs: notes, screenshots grid, marker list -- all click-to-seek.
- **Empty states + toast notifications** so the app is usable when no data is loaded yet.
