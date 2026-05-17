# Features

What the Process Discovery Tracker does, by component. This is the capability
catalogue; for *how* each piece is built see the
[architecture reference](architecture/OVERVIEW.md), and for per-release history
see [CHANGELOG.md](../CHANGELOG.md).

The product has three components — **Capture** (record), **Normalization**
(transform), **Viewer** (analyze) — joined by a self-contained session folder.

## Capture — recording a session

Worker-side Electron tray app; see [architecture/CAPTURE.md](architecture/CAPTURE.md).

- **Foreground-window tracking** — polls the active window every 5 s and records
  `activity` events (app, title, duration).
- **UI-interaction recording** — a C# UI Automation sidecar captures clicks,
  selections, toggles, and field edits as `interaction` events, with noise
  filtering and per-keystroke coalescing.
- **Process markers** — Start/End markers (hotkey, tray, or the Live Session
  window) bracket the process; nested and sibling markers are supported; open
  markers auto-close on long idle.
- **Screenshots** — event-triggered captures (app switch, marker fire, idle
  resume, manual), multi-monitor aware, debounced so coincident triggers collapse
  to a single capture.
- **OBS video** — optional; drives OBS Studio over a local WebSocket to record
  the screen, and writes a clock-sync file so the viewer can align events to the
  video.
- **Idle detection** — pauses tracking and can auto-end the session after a
  configurable idle period.
- **Live Session window** — recording indicator, timer, open-marker stack,
  counters, recent-events feed, inline marker firing, and an end-session confirm.
- **Sync markers** — a shared sync ID fired across machines to correlate
  multi-worker sessions.
- **Resilience** — orphan-session recovery on the next launch; a recorder
  liveness watchdog; desktop notifications when capture is degrading (OBS
  dropped, recorder dead, screenshots failing).
- **Configuration** — per-session YAML (engagement / worker identity, hotkeys,
  idle thresholds, screenshot triggers, OBS, process-label list), editable via a
  plain-language setup window.
- **Session storage management** — in-tray disk-usage display, per-session
  delete, and bulk prune-by-age.

## Normalization — transforming the recording

Analyst-side Python pipeline; see
[architecture/NORMALIZATION.md](architecture/NORMALIZATION.md).

- **Case assignment** — walks the marker stream into a case tree and stamps every
  event with its case stack.
- **Activity classification** — rule-based classification against a taxonomy YAML.
- **Step suggestion** — groups consecutive interactions into suggested steps, with
  a per-session noise denylist to drop irrelevant apps.
- **Canonical matching** — matches interactions against a reference "canonical"
  step set, with a match rate and drift detection when the canonical set shifts.
- **App Vocabularies** — per-application dictionaries that turn raw UIA fields
  into human-readable names and screen IDs.
- **Statistics** — activity, case, trace-variant, outlier, and rework statistics.
- **Process mining** — PM4Py inductive / heuristics miners produce a BPMN process
  map and a directly-follows graph (DFG).
- **Exports** — `events.xes` (IEEE 1849-2016), a flat step CSV, `stats.json`, and
  a process-definition `.docx`.
- **Non-destructive re-runs** — manually-authored and analyst-edited steps survive
  re-normalization; only machine-suggested artifacts are regenerated.

## Viewer — analyzing a session

Analyst-side Electron app; see [architecture/VIEWER.md](architecture/VIEWER.md).

### Session view

- **Video-synced timeline** — a Flow timeline of activity bands, idle, markers, a
  labelled case header lane, and a screenshot rail; clicking seeks the OBS video.
- **Optional timeline lanes** — density histogram, window-title runs, per-step
  bands, note dots — toggled via a Lanes menu.
- **Minimap, range selection, playhead** — whole-session orientation, Shift-drag
  range stats, and a video-synced playhead.
- **Steps & Phases** — review and edit machine-suggested steps (split / merge /
  hide / bulk-delete), group steps into phases, with a mini-timeline for each.
- **Annotations** — notes, a screenshot gallery, and a marker list, with full
  undo / redo; edits save to `annotations.json` and never touch the raw events.
- **Run normalization in-app** — spawn the bundled Python pipeline with progress
  streaming and a cancel control.

### Compare Sessions (Aggregate) view

- **Process maps** — the mined map rendered two ways: BPMN (via bpmn-js) and DFG
  (via cytoscape + dagre), in a resizable pane.
- **Cross-session statistics** — activity-frequency and case-duration charts;
  trace-variant, outlier, and rework tables.
- **Drill-down** — clicking a process-map node lists the loaded sessions that
  contain that activity.
- **Exports** — BPMN, XES, statistics, Markdown reports, and process-map SVG.

### Across the viewer

- **Process Template editor** — define and version a canonical step set and match
  sessions against it.
- **App Library** — edit the App Vocabularies that enrich interactions.
- **Project layer** — save the working set (loaded sessions, focus session,
  active template, view state) into a single `.pdt-project.json` file.
- **Themes** — the light "Warm Editorial" default and an opt-in "Studio Dark"
  theme, switchable at runtime.
- **Command palette, keyboard shortcuts, and recent-sessions** — workflow
  conveniences throughout.

## What's deferred

Capabilities intentionally out of scope are tracked in
[SPEC-DEFERRED.md](SPEC-DEFERRED.md) — notably the local ML stack (variant
merging, case-boundary inference) and multi-analyst concurrent editing.
