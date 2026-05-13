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

## What's NOT done in this pass

Per §13 of the design (open items / explicitly deferred):

- Cross-machine aggregation with cross-machine clock alignment (§13)
- Operator panel for PM-driven marker firing during walkthroughs (§13)
- Citrix / remote desktop capture validation (§13)
- Integration with downstream pipeline (Confluence, ticketing) (§13)
- Multi-analyst concurrent editing (§13, "out of scope for v1")
- Taxonomy promotion workflow (§13)
- ML capabilities (§10, v1.5+)
- Storage retention policy (§13)
- BPMN graphical rendering inside the viewer (DFG renders as edge list; BPMN exports but doesn't draw)
- Charts in statistics panel (tables only)
- Marker rename / boundary edit / merge / split UIs (annotations infrastructure is in place; UI is not)
- Production python-embeddable bundle (analyst side currently uses system Python via `pip install`)
