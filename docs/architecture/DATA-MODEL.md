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
  events.xes          IEEE-1849 event log         ┐
  events.csv          flat activity CSV           │ written by
  stats.json          activity/case/variant stats │ normalization
  process_map.bpmn    mined BPMN 2.0 (--mine)     │
  dfg.json            directly-follows graph (--mine) ┘
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
`case_id`. Normalization walks the marker stream, builds the case tree, and stamps
every activity/interaction with a `case_ids` stack — `[innermost, …, outermost]`,
empty when outside any marker. See SCHEMA.md → "Marker events — nesting".

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

`normalize.py`'s `_merge_steps()` keeps `manually_authored + edited` and only
regenerates the `auto_*` set — this is why corrections are not lost.

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
| `recordingAvailable`, `recordingPath` | `manifest` / `obs/` | drives the video pane |
| `obsSync`, `externalVideoOffsetMs` | `obs/sync.json` / `annotations.json` | video clock-sync offsets |

`currentSession` and `aggregateSessions` (the Compare-Sessions array) are the two
top-level state roots — both module-level `let`s in `renderer.js`.

### The edit round-trip

All step / phase / marker / note edits funnel through one path:

```
edit → mutate currentSession.annotations
     → saveAnnotationsWithUndo(annotations, label)
         → snapshot previous annotations onto _undoStack  (cap UNDO_MAX = 50)
         → ipcRenderer.invoke("viewer:saveAnnotations", { sessionFolder, annotations })
     → loadSessionIntoView(sessionFolder)   // full reload → re-render
```

Notable consequences:

- **Every edit is a full session reload.** There is no in-place partial update;
  `saveAnnotationsWithUndo` is followed by a re-read of the whole folder. Simple,
  but a performance and complexity cost — see
  [ARCHITECTURE-ISSUES.md](../ARCHITECTURE-ISSUES.md).
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
