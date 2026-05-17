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
  session-integrity.json  # file manifest (name + size) written at session end
```

## events.jsonl envelope

Each line is one JSON object:

```json
{
  "event_id": "uuid",
  "type": "activity" | "marker" | "system" | "interaction",
  "timestamp": "ISO 8601 with millisecond precision",
  "session_id": "uuid",
  "data": { ...type-specific... },
  "_seq": 0
}
```

The envelope is the contract; the `data` shape varies by `type`.

`_seq` is a monotonic integer — the 0-based ordinal of the event's line
within `events.jsonl`, stamped by the capture tracker as each event is
appended. Normalization uses it as a secondary sort key so events that
share a millisecond `timestamp` keep their true append order. Sessions
captured before this field existed simply omit it (treated as `0`).

### `activity` data

```json
{
  "app": "chrome.exe",
  "title": "Salesforce - Order #12345 - Google Chrome",
  "pid": 12648,
  "duration_ms": 17320
}
```

`timestamp` is the start of the activity run, not the moment the event was written. `duration_ms` covers the span the foreground window held the same app, pid, and (normalized) window title — see the data dictionary below.

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

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`, `idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`, `obs_recording_start`, `obs_recording_stop`, `sync_marker`, `recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`, `recorder_health`, `uncaptured_app`.

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
| `recorder_health` | `{ queued, emitted_total, dropped_total, errors, last_error? }` -- a periodic snapshot of the C# recorder's stats line (~every 30s). `last_error` (`{ kind, pid, process_name, control_type, message }`) is present only after a recorder-side failure. |
| `uncaptured_app` | `{ app, pid }` -- a foreground app the recorder produced no interaction events for, after a sustained stretch frontmost (commonly an elevated process, or one with no UI Automation surface). Emitted once per pid. |
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
| `value_truncated` | bool | `value_changed` only; present (`true`) when the 256-char clamp fired, so the analyst knows the stored value is partial |
| `coverage_hint` | string | First interaction per process only — `rich` (stable `automation_id`) \| `basic` (control type, no id) \| `minimal` (class name only). Signals how richly UIA exposes that app. |

Fields are omitted (not nulled) when the underlying UIA property throws on access.

#### Enrichment fields (added during normalization)

When an App Vocabulary (ADR-0002) matches an interaction, normalize.py adds:

| Field | Type | Notes |
|---|---|---|
| `meaningful_name` | string | Analyst-curated name for this interaction (e.g. "Run customer search") |
| `screen_id` | string | Named screen the interaction belongs to, if the vocab defines screens |
| `vocab_flags` | object | Default flags rolled up onto the containing step (`waste`, `automation_candidate`, ...) |
| `vocab_source` | object | `{ vocab_id, vocab_version }` for traceability |

These fields are additive; the raw `name`, `control_type`, etc. always remain.

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
  "classification_overrides": [],
  "notes": [],
  "drift_markers": [],
  "starred_screenshots": [],
  "matched_against": null,
  "last_modified": null,
  "last_modified_by": null
}
```

`notes` and `marker_edits` retain the v0 shapes below. The new top-level keys (`steps`, `phases`, `annotations`, `matched_against`, `drift_markers`, `classification_overrides`, `version`, `session_id`, `last_modified`, `last_modified_by`, `starred_screenshots`) are additive; missing files are treated as empty. `starred_screenshots` is an array of screenshot paths (the `data.path` of `screenshot` / `screenshot_manual` events) the analyst flagged for inclusion in the HTML findings report.

Legacy entries inside the two original arrays:

```json
{
  "notes": [
    { "id": "uuid", "type": "note", "timestamp": "...", "video_offset_s": 0, "text": "..." }
  ],
  "marker_edits": [
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "label",     "value": "New label",    "previous": "Old", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "timestamp", "value": "<new ISO>",    "previous": "...", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "op":    "delete",                                                  "ts": "..." },
    { "id": "uuid", "op": "insert", "marker_type": "start", "label": "Order entry", "timestamp": "<ISO>", "ts": "..." }
  ]
}
```

Insert edits create a synthetic marker event during normalization with `event_id: "insert-<edit_id>"`. `data` carries `synthetic: true` and `edit_id` so downstream consumers can distinguish synthetic markers from captured ones. `marker_type` defaults to `"start"`; `label` may be null for an End marker (Ends close the innermost open Start regardless of label).

### Classification override (`classification_overrides[]`)

Analyst corrections to activity classification, written by the viewer's Flow-map reclassify action. Applied during normalization (after taxonomy classification, before collapse) so the corrected label flows through to `events.csv`, `events.xes`, the DFG/BPMN process maps, and `stats.json`.

```json
{
  "classification_overrides": [
    { "override_id": "uuid", "scope": "instance",
      "event_id": "<activity_event_id>", "label": "CRM -- Salesforce",
      "created_at": "<ISO>" },
    { "override_id": "uuid", "scope": "rule",
      "match": { "app": "chrome.exe", "title_regex": ".*Salesforce.*" },
      "label": "CRM -- Salesforce", "created_at": "<ISO>" }
  ]
}
```

`scope: "instance"` retargets one activity event by `event_id`; `scope: "rule"` retargets every activity event whose `app` + window `title` match. An instance override wins over a rule override for the same event; among rules, first match wins. A `rule` entry is itself a candidate taxonomy rule (`match` + `label`) — an owner can promote it into `taxonomy.yaml` by hand (§6.1). Raw `events.jsonl` is never modified.

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
  "label": "analyst-given session name (optional; absent until set)",
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

`label` is an optional analyst-facing name, set from the capture app's
post-session summary; it is absent until set. The viewer's Recents list shows
it in place of the folder timestamp when present.

## session-integrity.json

Written by the capture app when a session ends -- a manifest of every file in
the session folder, so the viewer can tell whether a session was copied
completely from the worker's machine.

```json
{
  "files": [
    { "name": "events.jsonl", "size": 1234567 },
    { "name": "screenshots/001.jpg", "size": 45678 }
  ],
  "created_at": "ISO 8601"
}
```

`name` is the path relative to the session folder, forward slashes; the file
lists itself excluded. The viewer's session loader compares this against the
files actually present and surfaces any that are missing.

## analysis.json

Heuristic IE/CI findings, written by the normalization **analysis layer**
([ADR-0008](../docs/adr/0008-build-the-analysis-layer.md) / IMPROVEMENTS.md
Cluster N) whenever a session has steps. Absent on sessions normalized before
the layer existed, and on step-less sessions. Every figure is a provisional
heuristic — `meta.provisional` is always `true` and `meta.heuristic_version`
identifies the classifier generation.

```json
{
  "meta": { "heuristic_version": 1, "generated_at": "ISO 8601",
            "session_id": "uuid", "step_count": 0, "provisional": true },
  "waste_classification": [
    { "step_id": "uuid", "name": "string", "elapsed_ms": 0,
      "va_ms": 0, "bnva_ms": 0, "nva_ms": 0,
      "waste_types": ["waiting | motion | rework | overprocessing"],
      "cross_app_transfers": 0 }
  ],
  "time_study": [
    { "step_id": "uuid", "canonical_step_id": "uuid or null",
      "name": "string", "instances": 1,
      "cycle_ms": { "mean": 0, "min": 0, "max": 0, "stdev": 0,
                    "p25": 0, "p50": 0, "p75": 0, "p95": 0 },
      "active_ms": 0, "waiting_ms": 0, "switching_ms": 0 }
  ],
  "automation_candidates": [
    { "step_id": "uuid", "canonical_step_id": "uuid or null", "name": "string",
      "scores": { "repetitiveness": 0.0, "rule_based": 0.0, "volume": 0 },
      "estimated_savings_ms": null,
      "data_sufficiency": "single_instance | multi_instance" }
  ],
  "efficiency": {
    "process_efficiency_ratio": 0.0,
    "total_va_ms": 0, "total_bnva_ms": 0, "total_nva_ms": 0,
    "total_elapsed_ms": 0,
    "per_step": [ { "step_id": "uuid", "ratio": 0.0 } ]
  }
}
```

`waste_classification` has one entry per step; `time_study` and
`automation_candidates` have one entry per *logical* step — instances sharing a
`canonical_step_id` are grouped, falling back to one group per step when no
process template was matched. `bnva_ms` is `0` in the current heuristic
generation: the value-add vs. business-required split needs analyst judgement
and is left for a correction pass. `automation_candidates` scores are `null`
with `data_sufficiency: "single_instance"` for a step observed only once —
repetitiveness cannot be judged from a single instance.

## Invariants

- Events are immutable once written. Corrections live in `annotations.json` (§9.3 -- the viewer writes notes here; marker edit / merge / split UIs are deferred).
- `event_id` is unique within a session.
- `events.jsonl` is sorted by `timestamp` in practice (single-writer append); normalization sorts defensively by `(timestamp, _seq)` so a millisecond timestamp collision still resolves to true append order (§7.1 step 2).
- Adjacent identical activity events (same app, title, label, case_ids) are collapsed during normalization (§7.1 step 7).

## Post-normalization artifacts

The normalization layer writes the following alongside `events.jsonl`:

| File | Contents |
|---|---|
| `events.xes` | IEEE 1849-2016 event log, one trace per top-level case |
| `events.csv` | Flat CSV of activity events |
| `stats.json` | `{ activity_stats, case_stats, trace_variants, app_outliers, rework_loops, meta }` |
| `process_map.bpmn` | BPMN 2.0 XML from PM4Py inductive miner (with `--mine`) |
| `dfg.json` | Directly-Follows Graph as `{ edges, start_activities, end_activities }` (with `--mine`) |
| `analysis.json` | Heuristic IE findings: `{ meta, waste_classification, time_study, automation_candidates, efficiency }` (when the session has steps — ADR-0008) |
| `annotations.json` | Analyst-authored notes + future marker edits |
| `obs/sync.json` | `{ tracker_session_start_ts, obs_recording_start_ts, offset_ms, recording_path }` |
| `normalize.log` | Rolling log of warnings and info from normalization (see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)) |
| `capture.log` | Per-session log written by the capture app for high-signal events |

---

# Data Dictionary

The section above defines the *shape* of each file. This section defines the *meaning* of fields whose semantics aren't obvious from the type, plus cross-cutting conventions.

## Conventions

| Topic | Rule |
|---|---|
| Identifiers | All IDs (`event_id`, `session_id`, `case_id`, `step_id`, `phase_id`, `marker_id`) are RFC 4122 v4 UUIDs serialized as lowercase hex with dashes. Treat them as opaque. |
| Timestamps | ISO 8601 with millisecond precision and timezone (`...Z` for UTC). Always emit UTC. Comparing across sessions requires no timezone normalization. |
| Encoding | All text files are UTF-8 without BOM. JSON Lines (`events.jsonl`) uses LF line endings even on Windows. |
| Paths inside session artifacts | Relative to the session folder, forward slashes (`screenshots/foo.jpg`). Cross-platform safe. |
| Numeric durations | Always in milliseconds (`duration_ms`, `total_ms`) unless the field name says `_s` for seconds (`video_offset_s`). |

## Activity events — what `duration_ms` actually measures

An `activity` event spans a run of consecutive `active-win` polls that returned the same `(app, pid)` pair **and the same normalized window title**. A change of foreground app, process, or title ends the run and starts a new event — so navigation between web apps inside one browser (Salesforce → SAP, both `chrome.exe`) produces distinct events instead of one coarse `chrome.exe` event (see [ADR-0007](../docs/adr/0007-activity-event-granularity.md)).

The title is *normalized* for the run-boundary comparison only: a leading unread-count (`(3)`), an unsaved-changes marker (`*`/`●`), and the trailing browser-name suffix are stripped, so cosmetic title churn does not fragment the stream. The raw, unmodified title is what is recorded on the event.

The `duration_ms` is the wall-clock span between the first poll and the last poll in the run, not the sum of foreground time (idle gaps within the run are not separately accounted — they show up as separate `idle_start` / `idle_end` system events that bracket the activity, not as gaps inside it).

Collapsed events (after §7.1 step 7) sum `duration_ms` across adjacent events with the same `(app, title, label, case_ids)`. The collapsed event's `timestamp` is the *first* event's timestamp; the duration is the *summed* duration.

## Marker events — nesting and the `case_ids` stack

A `start` marker opens a case. A subsequent `start` opens a child case while the parent stays open. An `end` marker closes the *innermost* open case (the top of the stack), regardless of label. There is no marker-to-marker pairing by label.

After normalization, every activity / interaction event carries `case_ids: [innermost, ..., outermost]`:

| `case_ids` shape | Meaning |
|---|---|
| `[]` | The event happened outside any open marker (e.g. before the first Start or after the last End). |
| `["abc"]` | Inside one top-level case. |
| `["xyz", "abc"]` | Inside a child case `xyz` whose parent is `abc`. Used for transactions nested inside a containing process. |

The XES export emits one trace per *top-level* case (the last entry in each event's `case_ids`). Child cases become trace attributes or sub-traces depending on the analysis target.

## Step states — the lifecycle

Each step's `state` field describes how the step got into `annotations.json`:

| State | Set by | Survives re-normalization? |
|---|---|---|
| `auto_suggested` | The rule-based step suggester ([step_suggest.py](../normalization/step_suggest.py)). Best-guess grouping of adjacent interactions. | No — replaced by the next run's suggestions. |
| `auto_matched` | The canonical step matcher ([canonical_match.py](../normalization/canonical_match.py)) when a canonical step set is provided via `--canonical`. | No — replaced when re-matched. |
| `manually_authored` | The analyst clicked "New step" in the viewer's step editor. | Yes — `_merge_steps()` preserves it across runs. |
| `edited` | The analyst modified an `auto_suggested` or `auto_matched` step. | Yes — same. |

The merge order in [normalize.py `_merge_steps`](../normalization/normalize.py) is: `manually_authored + edited + fresh_auto_*`. This is why corrections survive re-normalization without re-doing work.

`drift_markers[]` record when a previously `edited`/`manually_authored` step's `canonical_step_id` would now resolve differently against the current canonical version — a signal that the canonical set has shifted under the analyst's prior assignment. Recorded automatically; reviewed manually.

## Interaction enrichment — when each field is present

UIA fields (`automation_id`, `name`, `class_name`, etc.) come from the recorder. App Vocabulary enrichment fields (`meaningful_name`, `screen_id`, `vocab_flags`, `vocab_source`) only appear when a vocabulary in `normalization/app_vocabularies/` matches the interaction. See [ADR-0002](../docs/adr/0002-app-vocabularies.md) for why this layer exists.

When both UIA `name` and App Vocab `meaningful_name` are present, the viewer prefers `meaningful_name` for display but exposes both. Downstream consumers should fall back to `name` when `meaningful_name` is absent.

## `stats.json` sub-objects

| Top-level key | Shape | What it's for |
|---|---|---|
| `activity_stats` | `[{ activity_label, frequency, total_duration_ms, median_ms, p90_ms, ... }]` | Per-activity rollups across all cases in this session. |
| `case_stats` | `[{ case_id, parent_case_id, label, started_at, ended_at, active_ms, ... }]` | One row per case. `parent_case_id` is null for top-level cases. |
| `trace_variants` | `[{ variant: ["A", "B", "C"], frequency }]` | Distinct activity sequences ranked by occurrence. |
| `app_outliers` | `[{ app, frequency, share }]` | Apps that appear in < 5% of cases. |
| `rework_loops` | `[{ activity_label, case_id, revisits }]` | Same activity revisited within a single case. |
| `meta` | See below | Normalization run metadata. |

### `stats.json.meta` fields

| Field | Meaning |
|---|---|
| `normalization_run_at` | When the pipeline ran. Use to detect stale derivatives vs `events.jsonl` mtime. |
| `taxonomy_version` / `taxonomy_path` | Which classification taxonomy was applied. Re-running with a newer version is non-destructive. |
| `raw_event_count` | Total lines successfully parsed from `events.jsonl`. |
| `dropped_jsonl_lines` | Lines that failed `json.loads`. Zero is the expected value. Non-zero is investigable; see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md). |
| `collapsed_activity_count` | Activity events remaining after §7.1 step 7 collapse. |
| `interaction_count` / `matched_interactions` / `match_rate` | How many interactions did we have, how many did the canonical matcher claim, what's the ratio. |
| `case_count` | Top-level + nested cases combined. |
| `marker_edits_applied` | Edits from `annotations.json.marker_edits` that took effect this run. |
| `step_count` / `step_state_breakdown` | Total steps and counts per state (`auto_suggested`, `auto_matched`, `manually_authored`, `edited`). The breakdown is the cheapest health-check for analyst engagement. |
| `canonical_process_id` / `canonical_version` | Pinned canonical set, if `--canonical` was used. |
| `drift_count` / `phase_count` | Total drift markers and phases in `annotations.json` after this run. |
| `app_vocabularies` / `app_vocabulary_matches` / `app_vocabulary_hits_by_id` | Vocabularies loaded, interactions matched, per-vocab hit counts. |

## When the schema changes

The schema is versioned implicitly: every additive change is non-breaking; renamings or removals would be breaking. `annotations.json` has an explicit `version` field (currently `1`) — bump it on breaking changes. Raw `events.jsonl` does not version itself; the `manifest.json` is the place to put a future capture-schema version when needed.
