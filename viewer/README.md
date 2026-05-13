# Viewer

Analyst-side Electron app. Two surfaces in one window:

- **Session view** (§9.1) -- one session, video synced to a timeline, marker overlay, annotations.
- **Aggregate view** (§9.2) -- N sessions, merged DFG, statistics, BPMN / XES / stats export.

## Install

```
npm install
```

The viewer also needs Python with the normalization dependencies on PATH (or an embedded Python -- see §11.5 of the design). For dev:

```
cd ../normalization
pip install -r requirements.txt
```

Set `PDT_PYTHON` env var to point at a specific interpreter if the default `python` isn't right.

## Run

```
npm start
```

## Workflows

**Session view:**

1. `Open session folder...` -> pick a session folder produced by the capture tracker.
2. `Run normalization` -> spawns `normalization/normalize.py` against the folder. Tick `Also mine BPMN + DFG` to run the inductive miner too.
3. Timeline renders activity bands, marker bars, idle gaps, screenshot dots, and case overlays.
4. Click anywhere on the timeline (or in the raw-event table) to seek the video.
5. Type a note in the annotations panel; `Save note at current time` writes to `annotations.json`.

**Aggregate view:**

1. `Open sessions...` -> pick one or more session folders, or an engagement folder containing them.
2. `Normalize + mine all` -> runs normalization with mining on every loaded session.
3. Stats panels populate; DFG edges aggregate across sessions.
4. Export BPMN, XES, or stats.json via the buttons at the bottom.

## Python resolution

`python-runner.js` resolves the interpreter in this order:

1. `PDT_PYTHON` env var
2. Sibling `python-embeddable/` folder (the §11.5 ship target)
3. System `python` on PATH

The normalization script is located relative to the viewer in dev (`../normalization/normalize.py`) and under `resources/normalization/` in a packaged build.

## Limitations in this pass

- DFG renders as a sorted edge list, not a graph drawing. Adding `bpmn-io/bpmn-js` for proper BPMN visualization is straightforward but is deferred.
- Statistics panels are tables -- no chart rendering. Add chart.js or similar if visual stats become a priority.
- The annotations contract supports `notes`; marker rename / boundary edit / merge / split UIs are not wired yet (§9.3 is named in the design but only the simplest annotation shape ships here).
- No video streaming optimization. Videos load via `file://` URLs.
