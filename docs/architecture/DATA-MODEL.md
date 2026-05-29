# Data Model

> **Authoritative on-disk reference:** [`shared/SCHEMA.md`](../../shared/SCHEMA.md).
> This doc is a working summary plus the part SCHEMA.md does not cover — the
> **in-memory model** the Viewer holds and how it round-trips to disk.

## Session folder — the integration seam

A captured session is one self-contained folder. Capture writes the first two
files; Normalization adds the rest.

```
sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/
  events.jsonl        raw event stream — append-only, immutable
  manifest.json       session metadata + status + OBS reference
  annotations.json    analyst edits (sidecar; created/updated by the Viewer)
  screenshots/        event-triggered screenshots
  obs/sync.json       tracker↔OBS clock offset
  events.xes          IEEE-1849 event log                  ┐
  events.csv          flat activity CSV                     │
  stats.json          activity/case/step/variant stats      │ written by
  analysis.json       heuristic waste/time-study (ADR-0008)  │ normalization
  process_map.bpmn    mined activity BPMN (--mine)          │
  process_map_step.bpmn / _phase.bpmn  observed-flow maps (--mine) │
  process_maps/       per-case BPMNs (--mine)               │
  dfg.json            directly-follows graph (--mine)        ┘
  capture.log / normalize.log
```

## events.jsonl — the raw stream

Every line is one JSON object with a fixed envelope; only `data` varies by `type`:

```json
{ "event_id": "uuid", "type": "...", "timestamp": "ISO-8601 ms UTC",
  "session_id": "uuid", "data": { ... } }
```

| `type` | Produced by | `data` carries |
|---|---|---|
| `activity` | active-window polling (every 5 s) | `app`, `title`, `pid`, `duration_ms` |
| `marker` | Start/End hotkeys, auto-end-idle | `marker_type` (`start`/`end`), `label`, `reason` |
| `system` | session lifecycle events | `kind` (`session_start`, `idle_start`, `screenshot`, `recorder_died`, `sync_marker`, …) + kind-specific payload |
| `interaction` | the C# UI Automation recorder | `kind`, `control_type`, `automation_id`, `name`, `framework_id`, `window_title`, `pid`, … |

**Cases are not in the raw stream.** Capture records markers but assigns no
`case_id`. Normalization assigns cases two ways:

- **Marker-based** — walk the Start/End marker stream, build the case tree, and
  stamp every activity/interaction with a `case_ids` stack —
  `[innermost, …, outermost]`, empty when outside any marker.
- **Anchor-based** ([ADR-0012](../adr/0012-active-case-stamping-and-map-matrix.md))
  — when the canonical set names a `case_anchor` field, a case is named by its
  anchor value and is **stable per label** (`case_id = uuid5(label)`), so
  re-searching the same serial *resumes* that case rather than opening a new one;
  the active case is stamped onto every following interaction by disjoint segment.
  The anchor field comes from a Process Template's `case_anchor` **or** — when there
  is none — the session-level `case_anchor_override` the analyst Accepted from an
  anchor candidate ([ADR-0018](../adr/0018-anchor-candidates.md)). Precedence is
  **`template > override > markers`.**

When a long capture has *neither* markers nor an anchor, normalization surfaces
recovery suggestions rather than collapsing silently into one default case:
**suggested markers** propose Start/End boundaries ([ADR-0017](../adr/0017-suggested-markers.md))
and **anchor candidates** rank the field whose typing would segment the session
([ADR-0018](../adr/0018-anchor-candidates.md)). Both are detected in Python, stored
in `annotations.json`, and applied only when the analyst Accepts.

See SCHEMA.md → "Marker events — nesting".

## annotations.json — the analyst sidecar

`events.jsonl` is never mutated. Every analyst correction lives here, and
re-normalization reads this file *before* case assignment so edits survive.

| Key | Holds |
|---|---|
| `steps[]` | Step entities (see lifecycle below) |
| `phases[]` | Phase entities — named groups of `step_ids` |
| `marker_edits[]` | Rename / re-time / delete / insert operations on markers; last-write-wins per `(event_id, field\|op)` |
| `notes[]` | Free-text notes pinned to a timestamp / video offset |
| `drift_markers[]` | Auto-recorded `canonical_drift` signals |
| `step_filters` | `{ ignored_processes: [...] }` — the step-noise denylist |
| `excluded_ranges[]` | Time ranges the analyst excluded from step suggestion / stats |
| `marker_suggestions[]` / `marker_suggestions_dismissed[]` | Suggested-marker candidates + the analyst's signature-keyed dismiss-set ([ADR-0017](../adr/0017-suggested-markers.md)); regenerated each normalize, dismissals persist |
| `anchor_candidates[]` / `anchor_candidates_dismissed[]` | Anchor-candidate ranking + its dismiss-set ([ADR-0018](../adr/0018-anchor-candidates.md)) |
| `case_anchor_override` | `null`, or the `case_anchor` config the analyst Accepted from an anchor candidate; consulted by case assignment (after a Process Template, before markers) |
| `version`, `session_id`, `matched_against`, `last_modified*` | Bookkeeping |

A missing `annotations.json` is treated as empty (see `emptyAnnotationsShape()`
below).

### Step / Phase lifecycle

A step's `state` records how it entered the file and whether it survives a
re-normalization run:

| State | Set by | Survives re-normalize? |
|---|---|---|
| `auto_suggested` | `step_suggest.py` (rule-based grouping) | No — regenerated |
| `auto_matched` | `canonical_match.py` (with `--canonical`) | No — re-matched |
| `manually_authored` | analyst clicked "New step" | **Yes** |
| `edited` | analyst modified an auto step | **Yes** |

`_merge_steps()` (in `step_suggest.py`) keeps `manually_authored + edited` and
only regenerates the `auto_*` set — this is why corrections are not lost. A
regenerated auto step also **inherits** the prior step's `step_id` and curated
`phase_id` / `canonical_step_id` when it re-covers the same interactions
(`_inherit_step_identity`), so a grouping or template link is not silently lost.
Every step also carries a value-free **`process_label`** (its name with case
values stripped) used to group repeated work in the maps, stats, and analysis
([ADR-0013](../adr/0013-value-free-grouping-and-map-readability.md)).

## In-memory model (Viewer)

When the analyst opens a folder, `loadSessionIntoView(folder)` in
[`viewer/renderer.js`](../../viewer/renderer.js) requests the session over IPC:

```js
currentSession = await ipcRenderer.invoke("viewer:loadSession", folder);
```

The handler that assembles the object lives in [`viewer/main.js`](../../viewer/main.js).
The renderer treats `currentSession` as having these fields:

| Field | Source file | Notes |
|---|---|---|
| `sessionFolder` | — | absolute path; the identity key for undo/redo + persistence |
| `manifest` | `manifest.json` | `manifest.engagement_id` is the display label |
| `events` | `events.jsonl` | parsed array, the timeline's input |
| `annotations` | `annotations.json` | the editable sidecar; `emptyAnnotationsShape()` when absent |
| `stats` | `stats.json` | normalization output; absent until normalized |
| `dfg` | `dfg.json` | directly-follows graph; absent until mined |
| `analysis` | `analysis.json` | heuristic waste / time-study / automation / efficiency; absent until analyzed (ADR-0008) |
| `recordingAvailable`, `recordingPath` | `manifest` / `obs/` | drives the video pane |
| `obsSync`, `externalVideoOffsetMs` | `obs/sync.json` / `annotations.json` | video clock-sync offsets |

`currentSession` and `aggregateSessions` (the Compare-Sessions array) are the two
top-level state roots — both module-level `let`s in `renderer.js`.

### The edit round-trip

All step / phase / marker / note edits funnel through `session.js` and re-render
**in place** — no full folder reload (ADR-0003 Phase 2, issue S6):

```
edit → persistAnnotations(annotations, label, topics)          (session.js)
     → saveAnnotationsWithUndo → snapshot prev onto _undoStack  (cap UNDO_MAX = 50)
       → ipcRenderer.invoke("viewer:saveAnnotations", { sessionFolder, annotations })
     → State.emit(topic) for each touched topic
     → the subscribed view re-renders itself, in place
```

Notable consequences:

- **Edits are in-place, not a full reload.** The change bus (`State.emit`)
  re-renders only the views subscribed to the touched topics — no folder re-read,
  no scroll jump (ADR-0003 Phase 2 fixed the earlier full-reload model). Running a
  re-*normalize* (the Python pipeline) is the only path that re-reads the folder.
- **Undo/redo is in-memory only.** `_undoStack` / `_redoStack` hold cloned
  annotation snapshots, are capped at 50, are pinned to a `sessionFolder`, and are
  cleared on session switch (`resetUndoStack()`). They do not persist across a
  Viewer restart.
- `emptyAnnotationsShape()` is the canonical "no annotations yet" object:
  `{ steps: [], phases: [], annotations: [], notes: [], marker_edits: [], drift_markers: [] }`.

> Note: `emptyAnnotationsShape()` omits `step_filters` / `version` / `session_id`,
> which SCHEMA.md lists. Those are additive and tolerated as absent — flagged in
> [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md) as a schema-drift snag.

## Conventions (summary)

IDs are RFC-4122 v4 UUIDs; timestamps are ISO-8601 with milliseconds in UTC;
text files are UTF-8 without BOM; durations are milliseconds unless the field name
ends in `_s`. Full rules and the field-by-field data dictionary are in
[`shared/SCHEMA.md`](../../shared/SCHEMA.md).
