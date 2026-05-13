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
  "type": "activity" | "marker" | "system",
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

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`, `idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`, `obs_recording_start`, `obs_recording_stop`.

Kind-specific payloads:

| Kind | Payload |
|---|---|
| `idle_start` | `{ idle_seconds }` |
| `idle_end` | `{ duration_seconds }` |
| `auto_end_idle` | `{ idle_seconds }` (fired after auto-closing all open markers, §3.3) |
| `screenshot` / `screenshot_manual` | `{ path: "screenshots/<file>.jpg" }` (relative to session folder) |
| `obs_recording_start` / `obs_recording_stop` | (empty; full OBS sync details live in `obs/sync.json` and `manifest.json.obs`) |
| `session_start` / `session_end` / `paused` / `resumed` | (empty) |

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
