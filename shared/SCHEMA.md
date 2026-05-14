# Session Package Schema

A captured session is a self-contained folder. This is the integration seam between capture, normalization, and the viewer (§2.1 of the design).

## Folder layout

```
sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/
  events.jsonl       # raw event stream, append-only, one JSON object per line
  manifest.json      # session metadata, status, OBS reference
  config.yaml        # session config snapshot (planned for iteration 2)
  screenshots/       # event-triggered screenshots (planned)
  obs/               # OBS recording reference and sync data (planned)
```

## events.jsonl envelope

Each line is one JSON object:

```json
{
  "event_id": "uuid",
  "type": "activity" | "marker" | "system" | "interaction",
  "timestamp": "ISO 8601 with millisecond precision",
  "session_id": "uuid",
  "data": { ...type-specific... }
}
```

The envelope is the contract; the `data` shape varies by `type`.

### `activity` data

```json
{
  "app": "chrome.exe",
  "title": "Salesforce - Order #12345 - Google Chrome",
  "pid": 12648,
  "duration_ms": 17320
}
```

`timestamp` is the start of the activity run, not the moment the event was written. `duration_ms` covers the span the foreground window was app+pid (title may have shifted within the run; the latest title is recorded).

### `marker` data

```json
{
  "marker_type": "start" | "end",
  "label": "Order entry" | null,
  "reason": "auto_end_idle" | null
}
```

`case_id` and `parent_case_id` are NOT set by capture. The normalization layer walks the marker stream, builds the case tree, and stamps every activity event with the stack of open case IDs at the moment it was captured (§5.2). After normalization, marker events also carry `case_id` and `parent_case_id` so downstream consumers don't need to re-walk.

End markers carry `null` label by convention; they close the innermost open Start. `reason` is set when an end was auto-fired (e.g. `auto_end_idle` from §3.3).

### `system` data

```json
{
  "kind": "session_start" | "session_end" | "paused" | "resumed" |
          "idle_start" | "idle_end" |
          "screenshot" | "screenshot_manual" |
          "obs_recording_start" | "obs_recording_stop",
  ...
}
```

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`, `idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`, `obs_recording_start`, `obs_recording_stop`, `sync_marker`, `recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`.

Kind-specific payloads:

| Kind | Payload |
|---|---|
| `idle_start` | `{ idle_seconds }` |
| `idle_end` | `{ duration_seconds }` |
| `auto_end_idle` | `{ idle_seconds }` (fired after auto-closing all open markers, §3.3) |
| `screenshot` / `screenshot_manual` | `{ path: "screenshots/<file>.jpg" }` (relative to session folder) |
| `obs_recording_start` / `obs_recording_stop` | (empty; full OBS sync details live in `obs/sync.json` and `manifest.json.obs`) |
| `sync_marker` | `{ sync_id }` -- shared identifier across machines for cross-machine timeline alignment in shift reviews |
| `recorder_start` / `recorder_stop` / `recorder_dead_permanent` | (empty) |
| `recorder_died` | `{ code, signal, restart_count }` |
| `session_start` / `session_end` / `paused` / `resumed` | (empty) |

### `interaction` data

Sourced from Windows UI Automation via the C# sidecar recorder. See `docs/interaction-recorder.md`.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `invoked` \| `selection_changed` \| `value_changed` \| `toggle_changed` \| `text_changed` \| `focus_changed` |
| `control_type` | string | e.g. `Button`, `Edit`, `ListItem` |
| `automation_id` | string | Developer-assigned ID |
| `name` | string | Visible label |
| `class_name` | string | Win32 class name |
| `framework_id` | string | `Win32`, `WinForm`, `WPF`, `XAML`, `Chrome`, others |
| `window_title` | string | Top-level window title |
| `process_name` | string | Owning process .exe name |
| `pid` | int | Owning process PID |
| `selected_value` | string | `selection_changed` only |
| `toggle_state` | string | `toggle_changed` only - `on` \| `off` \| `indeterminate` |
| `value` | string | `value_changed` only, length-clamped to 256 chars |

Fields are omitted (not nulled) when the underlying UIA property throws on access.

## Annotation file (annotations.json)

Analyst-authored edits and notes. Sidecar to `events.jsonl`; raw events are never mutated. Re-normalization consumes this file (§9.3 option b) before case assignment.

```json
{
  "version": 1,
  "session_id": "uuid",
  "steps": [],
  "phases": [],
  "annotations": [],
  "marker_edits": [],
  "notes": [],
  "drift_markers": [],
  "matched_against": null,
  "last_modified": null,
  "last_modified_by": null
}
```

`notes` and `marker_edits` retain the v0 shapes below. The new top-level keys (`steps`, `phases`, `annotations`, `matched_against`, `drift_markers`, `version`, `session_id`, `last_modified`, `last_modified_by`) are additive; missing files are treated as empty.

Legacy entries inside the two original arrays:

```json
{
  "notes": [
    { "id": "uuid", "type": "note", "timestamp": "...", "video_offset_s": 0, "text": "..." }
  ],
  "marker_edits": [
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "label",     "value": "New label",    "previous": "Old", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "timestamp", "value": "<new ISO>",    "previous": "...", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "op":    "delete",                                                  "ts": "..." }
  ]
}
```

### Step entity (`steps[]`)

```json
{
  "step_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid or null",
  "name": "string",
  "description": "string",
  "time_range": { "start": "iso", "end": "iso" },
  "evidence": {
    "interaction_event_ids": ["uuid"],
    "screenshot_refs": ["screenshots/file.jpg"],
    "video_timecode_range": [0, 0],
    "manual_notes": "string"
  },
  "state": "auto_suggested|auto_matched|manually_authored|edited",
  "canonical_step_id": "uuid or null",
  "flags": {
    "conditional": false,
    "condition_text": null,
    "exception_path": false,
    "waste": false,
    "automation_candidate": false
  },
  "phase_id": "uuid or null"
}
```

### Phase entity (`phases[]`)

```json
{
  "phase_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid",
  "name": "Validate customer",
  "description": "",
  "step_ids": ["uuid", "uuid"],
  "state": "manually_authored|auto_matched|edited",
  "canonical_phase_id": "uuid or null"
}
```

Phases derive their `time_range` from the union of contained steps (not stored).

### Drift marker (`drift_markers[]`)

```json
{
  "marker_id": "uuid",
  "kind": "canonical_drift",
  "step_id": "uuid",
  "previous_canonical_step_id": "uuid or null",
  "new_canonical_step_id": "uuid or null",
  "ts": "iso"
}
```

Supported edits:

- `field: "label"` - rename a marker
- `field: "timestamp"` - shift a marker's timestamp
- `op: "delete"` - drop a marker from the normalized stream (raw event remains)

Last-write-wins per `(event_id, field|op)`. Order of edits within the array does not matter for application.

## manifest.json

```json
{
  "session_id": "uuid",
  "engagement_id": "default",
  "started_at": "ISO 8601",
  "ended_at": "ISO 8601 or null",
  "status": "active" | "closed" | "recovered",
  "config": { ...snapshot of session config... },
  "obs": {
    "recording_path": null,
    "recording_start_ts": null,
    "offset_ms": null
  },
  "recovered": false
}
```

`status`:

- `active` -- session is currently running, or was active when the tracker crashed (orphan).
- `closed` -- session ended cleanly.
- `recovered` -- session was orphaned and reopened at next launch. Open markers in `events.jsonl` are handled by the normalization layer.

## Invariants

- Events are immutable once written. Corrections live in `annotations.json` (§9.3 -- the viewer writes notes here; marker edit / merge / split UIs are deferred).
- `event_id` is unique within a session.
- `events.jsonl` is sorted by `timestamp` in practice (single-writer append) but normalization sorts defensively (§7.1 step 2).
- Adjacent identical activity events (same app, title, label, case_ids) are collapsed during normalization (§7.1 step 7).

## Post-normalization artifacts

The normalization layer writes the following alongside `events.jsonl`:

| File | Contents |
|---|---|
| `events.xes` | IEEE 1849-2016 event log, one trace per top-level case |
| `events.csv` | Flat CSV of activity events |
| `stats.json` | `{ activity_stats, case_stats, trace_variants, app_outliers, rework_loops }` |
| `process_map.bpmn` | BPMN 2.0 XML from PM4Py inductive miner (with `--mine`) |
| `dfg.json` | Directly-Follows Graph as `{ edges, start_activities, end_activities }` (with `--mine`) |
| `annotations.json` | Analyst-authored notes + future marker edits |
| `obs/sync.json` | `{ tracker_session_start_ts, obs_recording_start_ts, offset_ms, recording_path }` |
