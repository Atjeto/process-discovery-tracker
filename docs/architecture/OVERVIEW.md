# Architecture Overview

> Part of the [architecture reference](./). Describes the current working tree
> (refreshed 2026-05-23 for v0.15.0 plus the analysis & recognition layers). For
> *why* decisions were made, see the ADRs and historical design docs linked from
> [`docs/README.md`](../README.md).

## What this is

Process Discovery Tracker is an internal Windows tool for **process mining**: it
records how a worker actually performs a business process, then turns that
recording into an analyzable, mineable process model — process maps (BPMN / DFG),
a step/phase breakdown, and statistics derived from real desktop activity.

It is used by two roles, on two machines:

| Role | Machine | Runs |
|---|---|---|
| **Worker / SME** | their normal work PC | the **Capture** app, while doing the process |
| **Analyst** | their own PC | the **Viewer** (which drives **Normalization**) |

The two halves never talk over a network. The hand-off is a **session folder** —
a self-contained directory of files — moved from worker to analyst.

## The three layers

```
[ worker machine ]                          [ analyst machine ]
┌──────────────────┐                        ┌────────────────────────┐
│ CAPTURE          │   session folder       │ VIEWER                 │
│ Electron + a C#  │ ─────────────────────▶ │ Electron + bundled     │
│ recorder sidecar │   events.jsonl,        │ Python                 │
│                  │   manifest.json,       │  • loads the session   │
│                  │   screenshots/,        │  • runs normalization  │
│                  │   OBS video            │  • timeline + editors  │
└──────────────────┘                        │  • mines + exports     │
                                            └───────────┬────────────┘
                                                        │ spawns
                                                        ▼
                                            ┌────────────────────────┐
                                            │ NORMALIZATION          │
                                            │ Python + PM4Py         │
                                            │ events.jsonl ──▶ XES,  │
                                            │ CSV, stats.json,       │
                                            │ process_map.bpmn, dfg  │
                                            └────────────────────────┘
```

| Layer | Folder | Responsibility | Tech |
|---|---|---|---|
| **Capture** | [`capture/`](../../capture/) | Poll the foreground window every 5 s, record UI interactions, fire Start/End markers, take screenshots, drive OBS, append a per-session `events.jsonl`. | Electron 33 (main process, no renderer logic of note) + a C# .NET 8 UI Automation recorder sidecar |
| **Normalization** | [`normalization/`](../../normalization/) | Transform raw `events.jsonl` into cases (marker- or anchor-based), steps, and phases; classify activities (taxonomy + platform recognition); compute statistics + heuristic IE/CI findings (the analysis layer); optionally mine activity / step / phase process maps. | Python 3.12 + PM4Py, pandas, networkx |
| **Viewer** | [`viewer/`](../../viewer/) | Load a session, run normalization, render a video-synced timeline, let the analyst edit steps/phases, compare sessions, and export. | Electron 33 + a bundled Python embeddable distribution |
| **Shared** | [`shared/`](../../shared/) | The cross-cutting data-format contract. | Markdown only ([`SCHEMA.md`](../../shared/SCHEMA.md)) |

## Key design principles

These hold across the whole system; every other doc assumes them.

- **The session folder is the single integration seam.** Everything downstream of
  capture is reproducible from `events.jsonl` plus a taxonomy file. Capture and the
  analyst tooling share no code and no live connection — only the folder.
- **Video is the reference; the tracker is the index.** When OBS recording is used,
  the screen recording is the ground truth. The event stream is a navigable index
  *into* the video, not a replacement for it.
- **Raw events are immutable.** `events.jsonl` is append-only and never edited.
  Every analyst correction lives in `annotations.json`, a sidecar file. See
  [DATA-MODEL.md](./DATA-MODEL.md).
- **Re-normalization is non-destructive.** Re-running the Python pipeline preserves
  manually-authored and analyst-edited steps; only machine-suggested artifacts are
  regenerated.
- **Recognition is platform-grounded; classification & analysis are heuristic.**
  An interaction's semantic *type* comes from documented platform/framework
  invariants (the recognition layer, [ADR-0011](../adr/0011-platform-recognition-layer.md)),
  so it transfers across apps; business *labels* and the IE/CI analysis findings
  are heuristics the analyst confirms ([ADR-0008](../adr/0008-build-the-analysis-layer.md)).
- **No network egress.** No telemetry, no update checks. The only socket is OBS on
  `ws://127.0.0.1:4455`. See [`SECURITY.md`](../../SECURITY.md).

## Repository layout

```
process-discovery-tracker/
  capture/          Worker-side Electron app + C# recorder sidecar (recorder/)
  normalization/    Python pipeline (normalize.py + ~13 modules)
  viewer/           Analyst-side Electron app (renderer.js + CommonJS view modules)
  shared/           SCHEMA.md — the data-format contract
  docs/             This documentation set + design specs + ADRs
  scripts/          PowerShell/Node build, release, and admin scripts
  sessions/         (gitignored) captured session folders land here
  dist/             (gitignored) build output and release zips
  README.md         Repo quick-start + per-release feature notes
  CHANGELOG.md      Per-release history
  SECURITY.md       Threat model and security posture
```

## The data lifecycle

1. **Capture** — the worker runs the Capture tray app. Active-window polls and UI
   interactions append to `events.jsonl`; Start/End markers bracket the process;
   screenshots and (optionally) an OBS video are saved into the session folder.
2. **Hand-off** — the session folder is moved to the analyst's machine.
3. **Load** — the analyst opens the folder in the Viewer.
4. **Normalize** — the Viewer spawns the Python pipeline, which assigns cases,
   suggests steps (each stamped with a value-free `process_label`), classifies
   activities, computes statistics + heuristic analysis findings, and (with
   `--mine`) mines activity / step / phase process maps. Outputs are written back
   into the same folder; `annotations.json` is updated non-destructively.
5. **Analyze & edit** — the analyst reviews the timeline, edits steps and phases
   (saved to `annotations.json`), reviews the Analysis findings, and re-normalizes
   as needed.
6. **Explore & export** — the Compare-Sessions view shows the process map as a
   notation × level matrix (BPMN / DFG × Activity / Step / Phase) with drill-down
   and a cross-session analysis panel; process maps (BPMN / DFG / SVG), reports,
   CSVs, and a PDD are exported.

## Where to go next

| You want to understand… | Read |
|---|---|
| The on-disk and in-memory data formats | [DATA-MODEL.md](./DATA-MODEL.md) |
| How a session gets recorded | [CAPTURE.md](./CAPTURE.md) |
| The Python transformation pipeline | [NORMALIZATION.md](./NORMALIZATION.md) |
| The Viewer app (the active refactor target) | [VIEWER.md](./VIEWER.md) |
| The timeline subsystem in depth | [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md) |
| UI styling, tokens, and colour | [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) |
| Known structural problems / refactor targets | [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md) |
