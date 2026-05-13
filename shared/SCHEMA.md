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
  "label": "Order entry" | null
}
```

`case_id` and `parent_case_id` are NOT set by capture. The normalization layer walks the marker stream, builds the case tree, and stamps every activity event with the stack of open case IDs at the moment it was captured (§5.2).

End markers carry `null` label by convention; they close the innermost open Start.

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

Additional kind-specific fields:

- `screenshot` and `screenshot_manual`: `{ path: "screenshots/<timestamp>.jpg" }`
- `obs_recording_start`: `{ recording_path: "...", obs_start_ts: "..." }`
- `idle_start` / `idle_end`: `{ last_input_ts: "..." }`

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

- Events are immutable once written. Corrections live in `annotations.json` (planned, §9.3).
- `event_id` is unique within a session.
- `events.jsonl` is sorted by `timestamp` in practice (single-writer append) but normalization sorts defensively (§7.1 step 2).
- Adjacent identical activity events (same app, title, label, case_ids) are collapsed during normalization (§7.1 step 7).
