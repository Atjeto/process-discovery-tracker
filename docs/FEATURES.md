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
- **App-vocabulary prep sessions** — a dedicated capture mode (tray → *Start app
  vocabulary prep session…*) records a focused walkthrough of one app, filed
  separately under `vocab-prep`, purely to bootstrap that app's vocabulary (ADR-0002).

## Normalization — transforming the recording

Analyst-side Python pipeline; see
[architecture/NORMALIZATION.md](architecture/NORMALIZATION.md).

- **Case assignment** — builds a case tree from Start/End markers and stamps every
  event with its case stack; can also detect cases from a recurring **anchor**
  field (e.g. the serial-search box), so re-searching the same value resumes one
  case instead of fragmenting (ADR-0012).
- **Platform recognition** — classifies interactions into semantic types from
  documented platform/framework signatures (UIA ControlTypes + Chromium /
  Bootstrap / AG-Grid / SharePoint / Office), shared between the viewer and the
  pipeline so they agree (ADR-0011).
- **Activity classification** — rule-based classification against a taxonomy YAML;
  an unmatched activity falls back to a semantic label from the dominant recognised
  interaction category ("Form entry — chrome.exe") rather than "Unclassified".
- **Step suggestion** — groups consecutive interactions into suggested steps, with
  a per-session noise denylist; each step is stamped with a value-free
  `process_label` so repeated work collapses downstream (ADR-0013).
- **Canonical matching** — matches interactions against a reference "canonical"
  step set, with a match rate and drift detection when the canonical set shifts.
  Re-analyze inherits a step's identity + curated grouping so corrections survive.
- **App Vocabularies** — per-application dictionaries that turn raw UIA fields
  into human-readable names and screen IDs.
- **Statistics** — activity, case, **step**, trace-variant, outlier, and rework
  statistics; step stats and variants group by the value-free label so they don't
  fragment per instance (ADR-0013).
- **Analysis layer** — heuristic waste / time-study / automation-candidate /
  process-efficiency findings, per session and pooled across sessions (ADR-0008).
- **Process mining** — PM4Py miners produce the activity BPMN map and a DFG, plus
  **observed-flow** Step/Phase BPMNs mined from the analyst's annotations (no
  Process Template required — ADR-0012).
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
- **Aligned reading — curate one, apply to all** — a Flat / Aligned toggle on the
  Steps view shows the consensus backbone across the detected cases, each step
  with a frequency ("seen in N of M cases"); curate one step and propagate its
  name / description / flags to every case in a single undo, with divergent steps
  surfaced as editable exceptions (ADR-0015).
- **Annotations** — notes, a screenshot gallery, and a marker list, with full
  undo / redo; edits save to `annotations.json` and never touch the raw events.
- **Run normalization in-app** — spawn the bundled Python pipeline with progress
  streaming and a cancel control.
- **Analysis findings** — a per-session Analysis level surfaces the heuristic
  waste / time-study / automation / efficiency findings for review and correction
  (ADR-0008).
- **Findings report (HTML)** — a one-click self-contained HTML report (process
  summary, the process map inline, the steps table, the waste/automation/efficiency
  findings, notes, and starred screenshots, plus an editable recommendations block)
  that opens in any browser with no external assets.

### Compare Sessions (Aggregate) view

- **Process maps — notation × level matrix** — Process diagram (BPMN, via bpmn-js)
  or Flow diagram (DFG, via cytoscape + dagre), each at Activity / Step / Phase
  level; the two axes are independent (ADR-0012). Zoom/pan and dragged layout
  persist.
- **Map navigation** — drill-down *scopes* to a clicked node's children
  (phase → its steps → that step's activities) on the Flow diagram, with a
  "show all" chip; a rare-path frequency **slider** thins low-frequency branches
  for readability on dense recordings (ADR-0013). Clicking an activity node drills to
  the source session or reclassifies it.
- **Cross-session statistics + analysis** — activity-frequency and case-duration
  charts; trace-variant, outlier, and rework tables; and a pooled Analysis panel
  (time study, per-worker comparison, automation candidates, efficiency trend).
- **Exports** — BPMN (activity / step / phase), XES, statistics, Markdown reports
  (with **Activity *and* Step statistics** tables), process-map SVG, the HTML
  findings report, and a PDD.

### Across the viewer

- **Process Template editor** — define and version a canonical step set and match
  sessions against it.
- **App Library** — edit the App Vocabularies that enrich interactions.
- **Team taxonomy** — promote analyst classification corrections into a shared
  `taxonomy.yaml`, so they classify every future session, not just this one.
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
