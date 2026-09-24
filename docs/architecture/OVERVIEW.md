# Architecture overview

> Part of the architecture reference ([docs/README.md](../README.md)). It
> describes the light version on `master`, the BA-helper refocus
> ([ADR-0029](../adr/0029-ba-helper-refocus.md)). The product edition's
> architecture lives with its code on branch `product-edition`.

## What this is

Process Discovery Tracker (PDT) records how a subject-matter expert (SME)
performs a business process on a Windows PC and turns the recording into a
confirmed step list, a process map and a tool-neutral process definition
document (PDD). It is an internal tool for the owner's work as a business
analyst / process manager.

| Role | Machine | Runs |
|---|---|---|
| **SME** | their own work PC | the **Capture** app, while doing the process a few times, one run hotkey press per run |
| **Analyst** | their own PC | the **Viewer**, which runs **Normalization** |

The two halves never talk over a network. The hand-off is a **session
folder**, a self-contained directory copied from the SME's PC to the
analyst's.

Two input modes are supported (plan D8): the recorder alone, and the recorder
plus a video (plus, optionally, a Teams transcript). The recorder always
runs: it is the recording when there is no video, it drafts the steps, it
measures the timings, and it knows which field in which app was used. The
video adds the SME's narration and what happened away from the keyboard.

## The three layers

```
[ SME machine ]                           [ analyst machine ]
+---------------------+                   +-----------------------------+
| CAPTURE             |  session folder   | VIEWER                      |
| Electron tray app   | ----------------> | Electron + bundled Python   |
| + C# recorder       |  copied by hand   |  open, attach video,        |
|                     |                   |  confirm, review, map,      |
| events.jsonl        |                   |  export                     |
| manifest.json       |                   +--------------+--------------+
| screenshots/        |                                  | analyzes by itself
| optional OBS video  |                                  v
+---------------------+                   +-----------------------------+
                                          | NORMALIZATION (Python)      |
                                          |  runs from the markers,     |
                                          |  drafted steps, statistics, |
                                          |  findings, step BPMN, PDD   |
                                          +-----------------------------+
```

| Layer | Folder | Responsibility | Tech |
|---|---|---|---|
| **Capture** | [`capture/`](../../capture/) | Poll the foreground window every 5 s, record UI interactions, take screenshots, write a start and end marker per run from the run hotkey, drive OBS when configured, append to `events.jsonl`. | Electron 42 (main process) + a C# .NET 8 UI Automation recorder sidecar |
| **Normalization** | [`normalization/`](../../normalization/) | Turn `events.jsonl` into runs (from the markers), draft each run's steps, keep the analyst's steps, compute statistics and findings, mine the step-level BPMN, render the PDD. A separate CLI imports a meeting transcript. | Python with pm4py, pandas, python-docx |
| **Viewer** | [`viewer/`](../../viewer/) | Load a session, run the pipeline, show the recording on a video-synced timeline, let the analyst confirm and edit steps, place a meeting transcript, draw the process map, fork editable maps, export the PDD. | Electron 42 + a bundled Python embeddable |
| **Shared** | [`shared/`](../../shared/) | The data contract ([SCHEMA.md](../../shared/SCHEMA.md)) and the rule files both languages load: platform recognition, value-free labels, the run-differences golden. | JSON, Markdown |

## Key design principles

- **The session folder is the only integration seam.** Capture and the
  analyst tools share no code and no live connection. Everything the pipeline
  writes can be rebuilt from the folder, given the same taxonomy and
  remembered-names store.
- **Raw events are immutable.** `events.jsonl` is append-only. Every analyst
  decision lives in `annotations.json`, and re-analysis keeps it: steps the
  analyst confirmed, edited, added or hid survive; only the drafts are
  replaced. See [DATA-MODEL.md](./DATA-MODEL.md).
- **The recorder drafts, the analyst decides.** Drafted steps and
  remembered names are suggestions the analyst can see and undo; nothing is
  applied silently.
- **Measured facts render as measured.** A stage that could not run says so
  instead of showing zeros (`stage_errors`); a failed export exits non-zero
  and the viewer never opens a stale file.
- **Value-free grouping.** Step names and screen strings are stripped of case
  values by one rule set shared by Python and JS, so the same step in every
  run is one node and one row.
- **No network, no AI.** No telemetry, no update checks. The only socket is
  OBS on `ws://127.0.0.1:4455`. See [SECURITY.md](../../SECURITY.md).

## Repository layout

```
process-discovery-tracker/
  capture/          SME side Electron app + C# recorder sidecar (recorder/)
  normalization/    Python pipeline (normalize.py and its modules), transcript_import.py
  viewer/           Analyst side Electron app (renderer, views/, stores)
  e2e/              Playwright smokes against the real viewer (run-all.js)
  shared/           SCHEMA.md and the shared rule files
  docs/             Architecture reference, ADRs, plans and audits
  scripts/          Build, release and structure-only data scripts
  sessions/         Committed demo in example-aggregate/; everything else gitignored
  dist/             (gitignored) build output and release zips
```

## The data lifecycle

1. **Capture.** The SME runs the tray app and presses the run hotkey at the
   start of each run; pressing it again ends the open run and starts the
   next. Interactions, window polls, markers and screenshots append to the
   session folder; an OBS video is optional.
2. **Hand-off.** The session folder is copied to the analyst's machine.
   `session-integrity.json` lets the viewer flag files that did not arrive.
3. **Open.** The viewer loads the folder. The analyst may attach a video and
   sync it to the session clock, and attach the meeting transcript (step 8).
4. **Analysis.** The viewer runs `normalize.py` by itself when a folder opens
   without a current analysis, and again when something it depends on changes,
   with the bundled taxonomy, `--names` and `--mine`. The pipeline derives the runs from the markers,
   drafts each run's steps, merges them with the analyst's steps, and writes
   `stats.json`, `analysis.json`, `process_map_step.bpmn` and the updated
   `annotations.json` back into the folder.
5. **Confirm and review.** The analyst confirms the reference run, then reviews
   how each other run differs from it. Edits save to `annotations.json`;
   renames also go to the remembered-names store on the analyst's machine.
6. **Map.** The viewer draws the process map from the runs' steps. Fork copies
   `process_map_step.bpmn` into an editable As-Is or To-Be map under
   `derived_maps/`.
7. **Export.** The viewer runs the pipeline again with `--pdd-out` and the map
   images; the PDD `.docx` is offered for saving.
8. **Transcript (optional).** Attach transcript runs `transcript_import.py`,
   which parses a Teams `.vtt` or `.docx` file into `transcript.json`. The
   viewer places each sentence on the session clock (through the video's
   sync, or by matching one sentence to one moment), shows the sentences said
   during each step and the talk outside the runs, and adds a chosen sentence
   to a step's description or a document field, from where it reaches the
   PDD.

## Where to go next

| You want to understand | Read |
|---|---|
| The session files and the annotation model | [DATA-MODEL.md](./DATA-MODEL.md), [SCHEMA.md](../../shared/SCHEMA.md) |
| How a session gets recorded | [CAPTURE.md](./CAPTURE.md) |
| The Python pipeline | [NORMALIZATION.md](./NORMALIZATION.md) |
| The viewer's internals | [VIEWER.md](./VIEWER.md), [VIEWER-TIMELINE.md](./VIEWER-TIMELINE.md) |
| UI styling and copy | [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) |
| Why the light version looks the way it does | [ADR-0029](../adr/0029-ba-helper-refocus.md), [BA-HELPER-PLAN-2026-09-22.md](../To-Do/BA-HELPER-PLAN-2026-09-22.md) |
