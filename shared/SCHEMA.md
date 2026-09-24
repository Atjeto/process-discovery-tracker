# Session Package Schema

A captured session is a self-contained folder: the integration seam between
capture, normalization and the viewer (section 2.1 of the design). This file
is the authoritative format reference;
[DATA-MODEL.md](../docs/architecture/DATA-MODEL.md) is the working summary.
Contract numbers (C1 to C16) refer to
`.claude/agent-findings/2026-09-23_ba-helper-contracts.md`; the decisions
behind the light version are in [ADR-0029](../docs/adr/0029-ba-helper-refocus.md).

## Folder layout

```
sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/
  events.jsonl            # raw event stream, append-only, one JSON object per line
  manifest.json           # session metadata, status, consent, OBS reference
  config.yaml             # the session's configuration snapshot
  screenshots/            # event-triggered screenshots
  screenshots/analyst/    # screenshots the analyst added by hand (C16)
  attachments/            # files the analyst attached (C16)
  obs/sync.json           # tracker to OBS clock offset, when OBS recorded
  session-integrity.json  # file manifest (name and size) written at session end
  annotations.json        # analyst sidecar (written by the viewer and the pipeline)
  annotations.json.2..5   # the viewer's rotating backups of it
  derived_maps/           # forked, editable reference maps (ADR-0019)
  stats.json              # pipeline outputs: see "Post-normalization artifacts"
  analysis.json
  process_map_step.bpmn   # with --mine
  normalize.log
  transcript/             # a copy of an imported meeting transcript (C8), if any
  transcript.json         # its parsed segments, if any
```

Two small stores live outside any session folder, on the analyst's machine:
see "Analyst library" below.

**Sessions without a recording (C16).** A session can also start from a
video or from nothing (`manifest.source` `"video"` or `"blank"`): a new
folder with `manifest.json`, an empty `events.jsonl` and `annotations.json`,
without the capture files (`config.yaml`, `obs/`, `session-integrity.json`,
the recorder's screenshots). Everything the analyst adds (steps,
screenshots, notes, attachments) lives in the folder, so it travels with it.
Today only the pipeline half of C16 exists: the pipeline reads such sessions
and every key the analyst adds (screenshots, notes, attachments, a step's
`system`, `order`, `pdd_screenshot`, `hidden_screenshots`), while the viewer
neither creates such sessions nor writes those keys yet.

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

`_seq` is a monotonic integer: the 0-based ordinal of the event's line in
`events.jsonl`, stamped by the capture tracker as each event is appended.
Normalization uses it as a secondary sort key, so events that share a
millisecond `timestamp` keep their true append order. Sessions captured
before this field existed omit it (treated as `0`).

### `activity` data

```json
{
  "app": "chrome.exe",
  "title": "Salesforce - Order #12345 - Google Chrome",
  "pid": 12648,
  "duration_ms": 17320,
  "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 }
}
```

`timestamp` is the start of the activity run, not the moment the event was
written. `duration_ms` covers the span the foreground window held the same
app, pid and (normalized) window title; see the data dictionary below.

`bounds` (optional) is the foreground window's desktop rectangle: `x` and `y`
top-left, `w` and `h` size. The viewer pairs it with `manifest.displays` to
show which monitor the work happened on. Capture builds whose `active-win`
omits window bounds leave the field off.

### `marker` data

```json
{
  "marker_type": "start" | "end",
  "label": "Run 1" | null,
  "reason": "auto_end_idle" | "auto_close_for_sibling"
}
```

A start marker's `label` is the run's name ("Run N", or a named run from
the capture app's Recording setup). End markers carry a `null` label.
`reason` is present only when an end was fired automatically:
`auto_close_for_sibling` when the next run started (the run key, Next run or
a named run) while the run was open, `auto_end_idle` when an idle stretch
past `auto_end_idle_minutes` ended it. An end with no `reason` was fired by
the SME (End run) or by stopping the recording.

Capture writes no `case_id`. Normalization derives the runs from the markers
(see "Marker events: runs and `case_ids`" in the data dictionary). In the
pipeline's derived stream every marker also carries `case_id` and
`parent_case_id` (always `null` now: runs never nest), and a start marker
carries `ends_case_id`, the run it ended, or `null`. These derived fields are
never written back to `events.jsonl`.

A marker inserted through `annotations.json` `marker_edits` becomes a
synthetic marker in the derived stream, with event id `insert-<edit_id>` and
`data.synthetic: true` plus `data.edit_id`.

### `system` data

```json
{
  "kind": "session_start" | "session_end" | "paused" | "resumed" |
          "idle_start" | "idle_end" | "screenshot" | "screenshot_manual" | ...,
  ...
}
```

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`,
`idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`,
`obs_recording_start`, `obs_recording_stop`, `events_dropped`,
`recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`,
`recorder_health`, `recorder_silent`, `recorder_silent_end`, `uncaptured_app`.
(`sync_marker`, for cross-machine correlation, is gone: a session is one SME
on one machine, so there is nothing to correlate; ADR-0029.)

Kind-specific payloads:

| Kind | Payload |
|---|---|
| `idle_start` | `{ idle_seconds, at_desk }`: `at_desk` is `true` when the recorder forwarded an interaction within the last 30 s, so the worker was active even though the OS idle timer (mouse and keyboard) crossed the threshold |
| `idle_end` | `{ duration_seconds }` |
| `auto_end_idle` | `{ idle_seconds }` (fired after the open run was ended for idleness) |
| `screenshot` / `screenshot_manual` | `{ path: "screenshots/<file>.jpg" }` (relative to the session folder) |
| `obs_recording_start` / `obs_recording_stop` | (empty; the OBS sync details live in `obs/sync.json` and `manifest.json` `obs`) |
| `events_dropped` | `{ dropped_interactions, dropped_activities, first_dropped_ts, last_dropped_ts, failed_writes, last_error }` (RP-21): a write batch of activity and interaction events (no marker or system event inside it) failed and was dropped rather than retried. The tracker folds every drop in one loss stretch into one record and queues it ahead of the next event it appends, so the gap is counted and visible on the session timeline, not only in a boot log. `failed_writes` is how many flush attempts failed during the stretch; `last_error` is the most recent write error's message. |
| `recorder_start` / `recorder_stop` / `recorder_dead_permanent` | (empty) |
| `recorder_died` | `{ code, signal, restart_count }` |
| `recorder_health` | `{ queued, emitted_total, dropped_total, errors, last_error? }`: a periodic snapshot (about every 30 s) of the C# recorder's stats line. `last_error` (`{ kind, pid, process_name, control_type, message }`) is present only after a recorder-side failure. |
| `recorder_silent` | `{ silent_for_ms }`: the capture app's dead-man monitor saw no interaction event and no `recorder_health` heartbeat for over about 2 minutes during an active session (the silent-death failure). Fired once per silence stretch, with a tray warning and an OS notification. Treat the span from the last signal as interaction-blind. |
| `recorder_silent_end` | `{ gap_ms }`: recorder signals resumed after a `recorder_silent` stretch; `gap_ms` is the full signal-to-signal gap. |
| `uncaptured_app` | `{ app, pid }`: a foreground app the recorder produced no interaction events for after a sustained stretch in front (often an elevated process, or one with no UI Automation surface). Emitted once per pid. |
| `session_start` / `session_end` / `paused` / `resumed` | (empty) |

### `interaction` data

Sourced from Windows UI Automation through the C# recorder sidecar. See
[docs/interaction-recorder.md](../docs/interaction-recorder.md).

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `invoked` \| `selection_changed` \| `value_changed` \| `toggle_changed` \| `text_changed` \| `focus_changed` |
| `control_type` | string | For example `Button`, `Edit`, `ListItem` |
| `automation_id` | string | Developer-assigned id |
| `name` | string | Visible label |
| `class_name` | string | Win32 class name |
| `framework_id` | string | Raw UIA FrameworkId: `Win32`, `WinForm`, `WPF`, `XAML`, `Chrome`, others. Java, Qt and remoting hosts misreport it (often `Win32`); prefer `framework`. |
| `framework` | string | **Normalized UI toolkit** (section 11e): `win32` \| `winforms` \| `wpf` \| `winui` \| `chromium` \| `java` \| `javafx` \| `qt` \| `remote` \| `terminal` \| `unknown`. Re-derived in the recorder from `framework_id` and `class_name`, so toolkits that misreport their `framework_id` are still recognized. Distinct from the recognition layer's web-app `framework` axis (chromium, ag-grid, office365). Explains thin capture (`java` needs the Java Access Bridge; `remote` and `terminal` expose little to UIA, so the video is the backstop). Always present (worst case `unknown`). |
| `identity_source` | string | **Identity-ladder rung** (section 11e): `automation_id` \| `name` \| `class_name` \| `ocr` \| `none`. Which source gave the element a stable identity, most reliable first. `ocr` means the OCR last rung recovered a label (see `ocr_text`); `none` means no identity at all. Always present. |
| `confidence` | number | **Per-element capture confidence** in `[0,1]` (section 11e). Blends the `identity_source` rung with the `framework`: a strong rung is still capped at `0.30` on a `remote` or `terminal` surface, where a captured field is an unreliable proxy for the real control. Rough rungs: `automation_id` about 0.95, `name` about 0.70, `class_name` about 0.40, `ocr` about 0.25, `none` about 0.10. Always present. |
| `ocr_text` | string | Present **only** when the OCR last rung fired (section 11e): a text label recovered from the element's on-screen region with `Windows.Media.Ocr` because it exposed no structured identity. Off by default (session opt-in `interactions.ocr`). Like `value` and `window_title` this is **captured content**, so the structure-only `inspect-events.js` never prints it. Clamped to 256 characters. |
| `window_title` | string | Top-level window title |
| `process_name` | string | Owning process `.exe` name |
| `pid` | int | Owning process id |
| `selected_value` | string | `selection_changed` only |
| `toggle_state` | string | `toggle_changed` only: `on` \| `off` \| `indeterminate` |
| `value` | string | `value_changed` only, clamped to 256 characters. **Omitted entirely when `value_redacted` is set.** |
| `value_redacted` | bool | `value_changed` only; present (`true`) when the recorder **redacted a secret at capture**: the control was UIA-flagged `IsPassword` (a password or masked-secret field), so the `value` is omitted and the `TextPattern` and OCR recovery are skipped. The raw `events.jsonl` never holds the secret. This is the only redaction in the light version: there is no masking of other values (ADR-0029 D7). |
| `value_truncated` | bool | `value_changed` only; present (`true`) when the 256-character clamp fired, so the stored value is partial |
| `value_source` | string | `value_changed` only; present **only when the value was recovered** off the primary UIA ValuePattern path (section 11e): currently `text_pattern` (read through `TextPattern` from a rich-text or document control whose ValuePattern was empty). Omitted on the normal path. |
| `coverage_hint` | string | First interaction per process only: `rich` (stable `automation_id`) \| `basic` (control type, no id) \| `minimal` (class name only). How richly UIA exposes that app. |

Fields are omitted (not nulled) when the underlying UIA property throws on
access.

`text_changed` and `focus_changed` are emitted **only in the recorder's
verbose (forensic) mode**; the default mode drops both. `text_changed`
carries no payload (the value rides the next `value_changed`), and the
`window_title` and `process_name` ride the next signal event. A normally
captured session contains neither kind.

#### Enrichment fields (added during normalization)

When an App Vocabulary ([ADR-0002](../docs/adr/0002-app-vocabularies.md))
matches an interaction, the pipeline adds, in its derived stream only:

| Field | Type | Notes |
|---|---|---|
| `meaningful_name` | string | A curated name for this interaction (for example "Run customer search") |
| `screen_id` | string | The named screen the interaction belongs to, if the vocab defines screens. Set when the control matches a vocab signature carrying a `screen`, **or** (ADR-0024 section 6b) when the `window_title` matches a vocab screen's `window_title_regex`, so every interaction on one form shares one value-free screen even when its control is not in the vocab (a screen tag only; not counted as a vocab name match). |
| `vocab_flags` | object | Default flags from the vocab; only `waste` rolls up onto the containing step ([ADR-0027](../docs/adr/0027-retire-per-step-path-flags.md)) |
| `vocab_semantics` | object | The matched entry's semantic fields (lab-phase section C1, all optional in the vocab YAML): `verb`, `object`, `means`, `completion` (bool: the drafting rule ends a step at this interaction, contract C1(a)), `case_id_source` (bool, authored metadata only; its one consumer, the anchor-candidate detector, is cut), `carries_value` (bool, admits the field's values to the re-key detector at a relaxed minimum length). Present only when the entry carries at least one of them. |
| `vocab_source` | object | `{ vocab_id, vocab_version }` for traceability |

These fields are additive; the raw `name`, `control_type` and the rest
always remain.

### Recorder snapshot messages (unused)

The recorder still answers a `snapshot` stdio command with
`snapshot_control` and `snapshot_done` lines ([ADR-0025](../docs/adr/0025-in-app-vocabulary-discovery.md)).
Nothing in the light version sends it: the in-app vocabulary discovery that
used it is cut. The messages were never persisted to `events.jsonl`; their
shape is in `capture/recorder/Snapshotter.cs`.

## Annotation file (annotations.json)

The analyst's work. Sidecar to `events.jsonl`; raw events are never
changed. Normalization reads this file (section 9.3 option b) before it
assigns runs and drafts steps, and writes the merged steps back.

```json
{
  "version": 1,
  "session_id": "uuid",
  "steps": [],
  "pattern_run": null,
  "document": null,
  "marker_edits": [],
  "reference_maps": [],
  "external_video": null,
  "step_filters": { "ignored_processes": [], "ignored_window_titles": [] },
  "excluded_ranges": [],
  "analysis_overrides": [],
  "analyst_screenshots": [],
  "analyst_notes": [],
  "attachments": [],
  "notes": [],
  "annotations": [],
  "process_exclusions": {},
  "classification_overrides": [],
  "calibration": null,
  "last_modified": null
}
```

Every top-level key is additive; a missing file, or a missing key inside
one, is treated as empty or absent. `annotations[]` is seeded empty by both
writers and read by nothing (a v0 leftover). `last_modified` is stamped by
the pipeline on every write.

**Writes and backups.** Both writers replace the file atomically: the new
content goes to a temp file in the same folder, which is then renamed over
`annotations.json`. Before each save the viewer copies the current file into
a rotation of four backups, `annotations.json.2` (most recent) to
`annotations.json.5` (oldest). A file that exists but cannot be read is
never treated as absent and never overwritten: the viewer shows a banner
naming it and its backups and refuses to save or analyze, and `normalize.py`
exits 2 before writing anything (C13). Recovery is a manual copy of a `.N`
file over `annotations.json`.

**`external_video`** *(object or null)*: the attached video,
`{ path, offset_ms, attached_at }`, written by the viewer when a video is
attached and synced. `path` is absolute, or relative to the session folder
for a video kept in the folder (a video session's, C16). `offset_ms` places
the video on the session clock: video time 0 is `manifest.started_at` plus
`offset_ms`. When the file exists, it wins over the manifest's OBS
recording.

**`pattern_run`** *(object or null; contract C3, viewer-written)*: the run
the analyst confirms as the reference, and the P1 draft-quality probe
instrument:

```json
"pattern_run": {
  "case_id": "<case_id of the run used as the pattern>",
  "confirmed_at": "ISO 8601 or null",
  "draft_fixes": { "merge": 0, "split": 0, "add": 0, "drop": 0 },
  "drafted_steps": 7
}
```

- The default pattern run is the first run by start time with at least one
  step; it is computed, not stored, until the analyst makes a change that
  needs the record. The analyst can pick another run.
- "Confirm run" turns that run's remaining `auto_suggested` steps into
  `confirmed` and sets `confirmed_at`. "Reopen run" is the inverse: the run's
  `confirmed` steps become drafts again (edited and added steps keep their
  state), `confirmed_at` goes back to `null`, and `draft_fixes` is kept. A
  run reads as confirmed once every non-hidden step is in an analyst state
  (`confirmed`, `edited`, `manually_authored`).
- `draft_fixes` counts the boundary fixes made to the pattern run's drafts
  before it is confirmed (merge, split, add, drop; renames are not counted).
  Carrying a merge to the other runs, or hiding the same draft in the other
  runs, adds nothing: only the fix in the pattern run itself counts.
- `drafted_steps` is the run's drafted-step count when it became the pattern:
  the probe line's fallback when `stats.json` has no `meta.draft_summary`.
- These are the structure-only numbers the
  [P1 draft-probe runbook](../docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md) reports.
  The pipeline preserves this key verbatim and never regenerates it.

**`document`** *(object or null; contract C6, viewer-written)*: the PDD's
document-level sections, as fields that survive re-export:

```json
"document": { "title": "", "purpose": "", "scope": "", "trigger": "", "result": "",
              "contacts": "", "business_rules": "", "exceptions": "",
              "improvement": "", "notes": "" }
```

Plain multi-line strings, edited in the Overview's document panel. The PDD
prints each non-empty field in its place:

| Field | Prints as |
|---|---|
| `title` | The document's title and Document control's "Process" |
| `purpose`, `scope` | 2.1 Purpose, 2.2 Scope |
| `trigger` | 2.3 Trigger: what starts the process. Its first line also names the step map's start event |
| `result` | 2.4 Result: what the process has produced when it ends. Its first line also names the step map's end event |
| `contacts` | 2.5 Key contacts |
| `business_rules` | 4.2 Business rules |
| `exceptions` | 4.3 Exceptions, the application errors included |
| `improvement` | 7 Improvement and automation scope |
| `notes` | 8 Notes, printed only when written (the attachments, C16, follow it) |

An empty field prints a "[To be completed: ...]" gap in its place, except
`title` (the document is then titled "Process Definition Document") and
`notes` (left out). Only these fields leave gaps, so every gap is one the
analyst can close in the app. The pipeline preserves this key verbatim.

**`analyst_screenshots`** *(array; contract C16, viewer-written)*: the
screenshots the analyst added by hand (a video frame, a pasted image, a
file):

```json
"analyst_screenshots": [
  { "id": "uuid", "file": "<id>.png", "step_id": "uuid or null",
    "at": "ISO 8601 or null", "source": "video_frame | paste | file",
    "added_at": "ISO 8601" }
]
```

- The image is copied to `screenshots/analyst/<file>`; `file` is the file
  name only (`<id>.png` or `<id>.jpg`). The pipeline reads the file as
  `screenshots/analyst/` plus the last part of `file`, so a name never leaves
  that folder.
- `step_id` attaches the screenshot to a step; `at` is the moment it shows
  (a video frame's time). Either may be null.
- Removing one deletes its entry and its file. A step's `pdd_screenshot` may
  name it by `id` (see the step entity).
- The pipeline never writes this key; re-normalization round-trips it
  untouched.

**`analyst_notes`** *(array; contract C16, viewer-written)*: notes the
analyst pins to a step or a moment:

```json
"analyst_notes": [
  { "id": "uuid", "text": "Ask Ana about the credit block.",
    "step_id": "uuid or null", "at": "ISO 8601 or null", "added_at": "ISO 8601" }
]
```

A note shows where its step or moment shows (the step pane, the timeline,
the panel). Notes are context in the viewer: the PDD does not print them
(the document's own Notes field, `document.notes`, is printed). The key is
not `notes`: that one holds the product edition's Flow notes (see "Notes and
marker edits"). Removing a note deletes its entry. The pipeline never writes
this key and round-trips it untouched.

**`attachments`** *(array; contract C16, viewer-written)*: files the
analyst attached to the session or to a step (an example email, an input
spreadsheet, an SOP, a form):

```json
"attachments": [
  { "id": "uuid", "file": "order-email.msg", "label": "Example order email",
    "step_id": "uuid or null", "added_at": "ISO 8601" }
]
```

- The file is copied to `attachments/<file>` (a numeric suffix when the name
  exists); `file` is the file name only.
- The PDD lists every attachment (label and file name) in a last section,
  "Attachments", and names a step's attachments by label under that step
  ("Attachments: Example order email."); an empty label prints the file
  name. Nothing is embedded.
- Removing one deletes its entry and its copied file. The pipeline never
  writes this key and round-trips it untouched.

**`step_filters`** *(object)*: apps and windows the analyst left out of the
analysis. `ignored_processes` is written by the viewer's ignored-apps
dialog; `ignored_window_titles` is read by the pipeline but only ever seeded
empty by the viewer. Process names match case-insensitively with or without
`.exe`; titles match as case-insensitive substrings. Matching interactions
and activity events are dropped from the derived stream before anything
else runs.

**`process_exclusions`** *(object, pipeline-written)*: what the self and
ignored-app filter dropped on the last run,
`{ excluded_count, by_process, process_names, window_substrings }`.
Regenerated every run.

**`calibration`** *(object or null; absent means the pipeline defaults)*: a
per-session tuning block with no UI. Only two knobs still do anything:
`coalesce_idle_ms` (1500, the typing-burst coalescing window) and
`filter_browser_chrome` (`true`: drop the browser's own address bar, tabs and
toolbar before drafting). The old segmenter's knobs (`step_split_idle_ms`,
`step_max_interactions`, `step_min_interactions`, `step_max_idle_ms`,
`step_split_on_element`) are read without error and ignored, like any unknown
key. An absent or empty block reproduces the default output exactly.

### Notes and marker edits

```json
{
  "notes": [
    { "id": "uuid", "type": "note", "timestamp": "...", "video_offset_s": 0, "text": "..." }
  ],
  "marker_edits": [
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "label",     "value": "New label",    "previous": "Old", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "field": "timestamp", "value": "<new ISO>",    "previous": "...", "ts": "..." },
    { "id": "uuid", "event_id": "<marker_event_id>", "op":    "delete",                                                  "ts": "..." },
    { "id": "uuid", "op": "insert", "marker_type": "start", "label": "Run 2", "timestamp": "<ISO>", "ts": "..." }
  ]
}
```

`notes[]` are the product edition's Flow notes (timestamped, written by
the v1.5.0 viewer's Notes tab, which the light version cut). Both writers
still seed the key as an empty list; nothing writes an entry and the PDD
does not print them; re-normalization round-trips them untouched (C10). The
notes the analyst pins to a step or a moment are `analyst_notes[]`, a
different key with a different shape, so an old session's notes and the
product edition's reader keep working.

`marker_edits[]` supports `field: "label"` (rename a marker), `field:
"timestamp"` (move it), `op: "delete"` (drop it from the derived stream; the
raw event stays) and `op: "insert"` (add a missed marker). An insert creates
a synthetic marker during normalization with event id `insert-<edit_id>`;
its `data` carries `synthetic: true` and `edit_id`. `marker_type` defaults to
`"start"`; `label` may be null for an end marker. Edits are last-write-wins
per `(event_id, field|op)`; their order in the array does not matter.

### Classification override (`classification_overrides[]`)

Corrections to activity classification. No viewer surface writes them
anymore (classification has no editing UI, AD-16); the pipeline still applies
entries an older file carries, after taxonomy classification and before
the collapses, so the corrected label flows into the statistics and the
analysis.

```json
{
  "classification_overrides": [
    { "override_id": "uuid", "scope": "instance",
      "event_id": "<activity_event_id>", "label": "CRM: Salesforce",
      "created_at": "<ISO>" },
    { "override_id": "uuid", "scope": "rule",
      "match": { "app": "chrome.exe", "title_regex": ".*Salesforce.*" },
      "label": "CRM: Salesforce", "created_at": "<ISO>" }
  ]
}
```

`scope: "instance"` retargets one activity event by `event_id`; `scope:
"rule"` retargets every activity event whose `app` and window `title` match.
An instance override wins over a rule for the same event; among rules, the
first match wins.

### Analysis override (`analysis_overrides[]`)

The analyst's corrections to the step-based estimates
([ADR-0008](../docs/adr/0008-build-the-analysis-layer.md)). No viewer
surface writes them anymore: the business-required split editor and the
automation Confirm and Dismiss buttons are cut. The analysis stage still
applies the entries an older file carries while it recomputes; corrections
live here, **not** in `analysis.json`, which is regenerated on every run.

```json
{
  "analysis_overrides": [
    { "step_id": "uuid",
      "bnva_ms": 0,
      "waste_types": ["waiting", "rework"] },
    { "process_label": "Search",
      "bnva_ms": 60000 },
    { "segment_signature": "12-hex-chars",
      "automation_confirmed": true }
  ]
}
```

Entries are typed by the identity field they carry; every other field is
optional, present only when the analyst touched it.

- **`step_id`-scoped** entries target one step. `bnva_ms` moves value-add
  time into business-required non-value-add (clamped so `va_ms + bnva_ms +
  nva_ms` still equals `elapsed_ms`); `waste_types` replaces the detected
  waste types for that step.
- **`process_label`-scoped** entries (no `step_id`) apply to every step of
  that type.
- **`segment_signature`-scoped** entries record the analyst's verdict on an
  automation candidate ([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)):
  `automation_confirmed` `true` (confirm) or `false` (dismiss). The signature
  is the stable hash of the segment's app and ordered step labels, so the
  verdict survives a re-analysis while the pattern is still detected. An old
  entry with `step_id` plus `automation_confirmed` is read without error and
  ignored.

A `step_id` entry wins over a `process_label` entry for waste.

### Excluded range (`excluded_ranges[]`)

Time spans the analyst marked out of scope on the timeline (a lunch break,
an unrelated detour). Drafting and `stats.json` skip every event whose
`timestamp` falls inside one on the next run; `events.jsonl` is untouched.

```json
{
  "excluded_ranges": [
    { "start": "<ISO>", "end": "<ISO>", "reason": "manual" }
  ]
}
```

`start` and `end` are inclusive ISO 8601 bounds. `reason` is free text. A
malformed entry (missing `start` or `end`, or `end` before `start`) is
ignored rather than failing the run.

### Reference maps (`reference_maps[]`)

Analyst-authored, **decoupled** BPMN copies (ADR-0019). The Map's edit act
("Edit as the As-Is map", the fork) copies the step-level map the pipeline
writes with `--mine` (`process_map_step.bpmn`)
into a standalone `.bpmn` the analyst edits freely; the pipeline **never**
re-mines, merges or regenerates it. The metadata row lives here; the diagram
lives at `derived_maps/<map_id>.bpmn`.

```json
{
  "reference_maps": [
    {
      "map_id": "rm_<uuid>",
      "name": "To-Be: straight-through order entry",
      "kind": "to_be",
      "file": "derived_maps/rm_<uuid>.bpmn",
      "source": { "notation": "bpmn", "level": "step", "scope": null },
      "forked_from_hash": "9f3c…",
      "forked_at": "<ISO>",
      "edited_at": "<ISO>",
      "pdd_role": "to_be",
      "notes": ""
    }
  ]
}
```

- **`kind`**: `as_is` | `to_be` | `reference`. The Map's first copy is
  `as_is` (named "As-Is map"); a later one is `to_be` (named "To-Be map").
  When a copy gets a PDD role, its `kind` follows the role. `reference`
  remains on older entries.
- **`file`**: path relative to the session folder, forward slashes. Written
  and read by `viewer/reference-maps.js`.
- **`source`**: what was forked; always the step-level BPMN now.
- **`forked_from_hash`**: a short hash (blake2b, sha256 fallback) of the
  source `.bpmn` at fork time. When the current source hashes differently the
  copy's row offers **Copy again**, which makes a new copy (the same name and
  kind, no role) and never merges.
- **`pdd_role`**: `null` | `as_is` | `to_be`: which PDD slot the map fills
  (one map per slot). At export the viewer renders the copy to PNG and passes
  it as `--pdd-map-image` (As-Is, section 3.1) or `--pdd-tobe-image` (To-Be,
  section 7.1). With no As-Is copy, the viewer draws `process_map_step.bpmn`
  the same way and passes that picture instead. The Map's "Edit as the As-Is
  map" gives its copy the role `as_is` when no copy has it.

**Re-analysis:** `pipeline_stages._init_existing_anno` only makes sure the
key exists, and no stage writes it, so `reference_maps[]` and the
`derived_maps/*.bpmn` files survive every run. Created after capture, they
are not in `session-integrity.json`. Every change goes through the viewer's
undo, so Ctrl+Z reverts a copy, a rename, a PDD role, a duplicate or a
delete.

### Step entity (`steps[]`)

```json
{
  "step_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid or null",
  "name": "string",
  "process_label": "string: the value-free grouping key (ADR-0013)",
  "draft_key": "string, drafted steps only: \"<app>|<screen>|<commit>\" (C1)",
  "draft_keys": ["string", "merged drafts only: the members' draft keys, in order"],
  "name_source": "remembered|draft, drafted steps only",
  "end_reason": "commit|screen_change|run_end, drafted steps only",
  "grain_keys": {
    "element": "string: the control the step acted on (automation_id or name)",
    "screen":  "string: vocab screen_id, else the value-free screen label (shared/screen-label-patterns.json)",
    "app":     "string: process_name without .exe"
  },
  "description": "string",
  "time_range": { "start": "iso", "end": "iso" },
  "order": "integer, steps without a time only (C16)",
  "system": "string, optional: the system the analyst set (C16)",
  "pdd_screenshot": "string, optional: the screenshot the PDD prints (C16)",
  "hidden_screenshots": ["screenshots/file.jpg"],
  "evidence": {
    "interaction_event_ids": ["uuid"],
    "screenshot_refs": ["screenshots/file.jpg"],
    "video_timecode_range": null,
    "manual_notes": "string"
  },
  "state": "auto_suggested|confirmed|edited|manually_authored|hidden",
  "_prev_state": "hidden steps only: the state before hiding",
  "suggestion_reason": "string, drafted steps only: why the rule ended the step",
  "canonical_step_id": null,
  "flags": { "waste": false },
  "phase_id": null
}
```

**What the analyst adds to a step (contract C16).** All four keys are
viewer-written and optional; re-normalization keeps them on every step it
preserves. A draft (`auto_suggested`) is drafted again on every analysis, so
the viewer turns a draft it adds one of them to into `edited`, as every
other change to a draft does.

- **`time_range`** may be `null` on a step the analyst added
  (`manually_authored`) without a time: a step of a blank session, or one
  added without a playhead. Such a step carries **`order`**, a number the
  viewer sets, unique within its run. The steps of a run are in time order
  (the start time), then the steps without a time in `order`, then any step
  with neither, in the list's order. The stats, the differences, the map
  (`process_map_step.bpmn`), the PDD and the viewer use that one order. A
  step without a time has no duration: the timed figures (step stats, the
  step-based analysis, the PDD's times, the map's average time) leave it
  out, and nothing prints a time for it. A time range the viewer writes is
  read as measured, so it is written only when the analyst placed the step
  on the clock.
- **`system`**: the business system, set by the analyst (for a step added
  by hand, or to correct a recorded one). It wins over the system derived
  from the step's interactions (C14) in the PDD (the step's line, the
  systems of the process, the data table, Applications and time) and in the
  step map's task documentation; the screen stays derived.
- **`pdd_screenshot`**: the one screenshot the PDD prints under the step: a
  recorder screenshot's session-relative path (one of `screenshot_refs`), or
  the `id` of an entry of `analyst_screenshots`. Absent (or naming a file
  that is not in the session folder, or a hidden one) means the default:
  every screenshot of the step, its `screenshot_refs` and then the analyst
  screenshots whose `step_id` is the step. A path outside the session folder
  is never embedded.
- **`hidden_screenshots`**: recorder screenshots (paths as in
  `screenshot_refs`) taken off the step. They are never printed, and the raw
  files are never deleted; removing a screenshot the analyst added deletes
  it instead (`analyst_screenshots`).

`flags.waste` is the **only** per-step flag ([ADR-0027](../docs/adr/0027-retire-per-step-path-flags.md)).
Older files may still carry `conditional`, `exception_path`,
`automation_candidate` or `condition_text`; they are ignored.

`canonical_step_id` and `phase_id` are always `null` now: canonical matching
and phases are cut (ADR-0029). The fields stay in the shape so older tooling
keeps working; nothing sets them.

`description` is the step's text in the PDD's detailed steps (C7). A draft's
description is a generated narration of its interactions, which the PDD
leaves out because the fields table and the screenshots already carry it; a
description the analyst wrote is printed.

`_prev_state` is set when a step is hidden, so Unhide can restore it. Drafts
are hidden rather than deleted: a hidden step is analyst-owned, so the next
analysis does not bring the draft back. Only steps the analyst added can be
deleted.

**Drafted steps (contract C1).** `normalization/step_suggest.py`
`auto_suggest_steps` drafts every run. Within one run it walks the
interactions in time order; a step is a stretch of consecutive interactions
on one screen of one app, ending at (a) a commit interaction, inclusive:
`kind == "invoked"` on a `Button`, `SplitButton`, `MenuItem` or `Hyperlink`,
or any interaction whose vocab semantics carry `completion: true`; (b) the
first interaction on a different screen, exclusive; or (c) the end of the
run. Interactions outside every run are drafted the same way with
`case_id: null`; the map and the step BPMN leave those steps out. Every
drafted step carries:

- **`draft_key`**: `"<app>|<screen>|<commit>"`, value-free by construction.
  `app` is `process_name` lowercased with `.exe` stripped; `screen` is the
  vocab `screen_id` when present, else the value-free screen label; `commit`
  is `"<control_type>:<identity>"` of the commit interaction (identity:
  automation_id, else name, else class_name, else `"?"`, each passed through
  the shared value rules), or the literal `"(visit)"` when the step did not
  end on a commit. The remembered names (C4) and saved processes (C5) match
  on it. A key is used whole, never split (a screen label can contain `|`).
- **`name_source`**: `"remembered"` when the name is one the analyst gave
  before, else `"draft"`. A draft takes, in this order, the name of a step
  the analyst named in this session with the same key (typed names, in
  `edited` or `manually_authored` steps, before accepted ones in `confirmed`
  steps; the pattern run's first), then the remembered-names store's name
  (`--names`), then the default name. So names travel with the session
  folder: the same session analyzed on another machine drafts the same
  names.
- **`end_reason`**: `"commit"`, `"screen_change"` or `"run_end"`, the three
  ways the rule ends a step.

The default name (when not remembered) is `"<screen label>: <commit label>"`,
or `"<screen label>"` for a `"(visit)"` step; the commit label is the
interaction's vocab `meaningful_name`, else its `name`, else its
`control_type`. Names never embed a typed value.

**Merged and split steps.** A merge or a split in the viewer removes the
draft identity (`draft_key`, `name_source`, `end_reason`), because the
result is no longer one draft. A merge of drafted steps then stores
`draft_keys`: each member's `draft_key` (a merged member's `draft_keys`
flattened) in order. It lets a merge in the pattern run be carried to the
same consecutive drafts in the other runs, and it is the step's alignment
key in the differences view and in the PDD's section 4.1:
`"merge:"` plus the keys as a JSON array. A step with `draft_key` aligns as
`"draft:<draft_key>"`, any other step as `"label:<process_label>"`.
`shared/run-differences-golden.json` pins that one rule for both the viewer
(`run-differences.js`) and the PDD (`pdd_export.py`). A step added by hand
carries none of these fields.

**`process_label`** is recomputed on every run. A step with a `draft_key` is
its own label (its name, whatever its state); any other step's name passes
through the shared rules in `shared/process-label-patterns.json`.

**`grain_keys`** are the UI-containment keys stamped on every step
(`element` inside `screen` inside `app`;
[ADR-0024](../docs/adr/0024-step-grain-as-view-time-rollup.md)). The grain
slider they once fed is cut; the keys stay and are recomputed on every run,
so they track the current evidence. The viewer reads a step's `app` and
`screen` from them (the step pane's fact line, the time per application on
the Overview). The drafting rule's `screen` is the same value-free label. A
step with no interactions carries `(element)`, `(screen)` and `(app)`
placeholders.

### Legacy keys (contract C10)

ADR-0029 and the later lanes cut the features behind the keys below.
Re-normalization round-trips each of them verbatim
(`pipeline_stages._init_existing_anno` never seeds or regenerates them), so
an old `annotations.json` loads without error. Nothing reads them, and
neither writer seeds them. The pre-cut shape of each is in git history (the
revision before ADR-0029) and on branch `product-edition`.

| Key | Was | Cut because |
|---|---|---|
| `phases[]` | Analyst-authored phase groupings of steps | Phases are cut (ADR-0029 D4) |
| `drift_markers[]` | Flags when a step's canonical assignment would now resolve differently | Canonical matching is cut (AD-8) |
| `marker_suggestions[]`, `marker_suggestions_dismissed[]` | Suggested-marker candidates ([ADR-0017](../docs/adr/0017-suggested-markers.md)) | The detector is cut; a missed run marker is added by hand |
| `anchor_candidates[]`, `anchor_candidates_dismissed[]`, `case_anchor_override` | Anchor-candidate suggestions and the accepted override ([ADR-0018](../docs/adr/0018-anchor-candidates.md), [ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md)) | Anchor-based case detection is cut; case detection is markers only |
| `roi_inputs` | The EUR-ROI assumptions | The business-case formula stays in the owner's QB app (ADR-0029 D3) |
| `pii_masking`, `pii_masking_config` | The structural PII masking report and config | No masking for internal use; password redaction at capture stays (D7) |
| `group_annotations[]` | Name, note, waste, hidden on a case-scoped screen visit ([ADR-0028](../docs/adr/0028-case-screen-work-items.md)) | The runs-and-steps view replaces the work-item case tree |
| `self_annotations[]` | The worker's answers to the close-out wizard's questions | The questions are cut; the end summary asks nothing |
| `matched_against` | Which Process Template a session was matched against | Template matching is cut; saved-process matching (C5) writes nothing here |
| `starred_screenshots[]` | Screenshots the analyst starred for the HTML findings report | The report is cut; the PDD's findings section that later embedded evidence screenshots is cut too (AD-24) |
| `memo_selection[]` | The findings the analyst ticked for the PDD's findings section ("include in PDD") | The PDD prints no findings (AD-24) and the ticks are gone (lane V1) |

## Analyst library (outside the session folder)

Two stores on the analyst's machine, in the viewer's user data folder
(Electron `userData`) under `pdt-library/`. Both are written by the viewer
through a temp file renamed over the store, so a failed write leaves the
previous store in place. A store that exists but cannot be read (bad JSON,
a byte order mark, the wrong `version`) is reported and never replaced.
Entries a reader skips are kept on disk as they are.

### `pdt-library/remembered-names.json` (contract C4, light vocab)

```json
{ "version": 1,
  "names": { "<draft_key>": { "name": "Look up customer", "updated_at": "ISO 8601" } } }
```

- Written when the analyst renames a step that carries a `draft_key`; the
  rename also applies at once to every still-draft step in the session with
  the same key. The Saved names dialog (Steps toolbar) renames an entry
  (and the session's still-draft steps with that key) or forgets it (the
  entry is deleted). It does not rename the session's edited or confirmed
  steps of that key, and their name comes first at the next analysis (see
  `name_source`).
- Read by the pipeline through `normalize.py --names <path>` at draft time,
  after the session's own names; the viewer passes it on every analysis it
  runs when the file exists. A missing or unreadable file is not a failure
  there: one stderr warning, and drafting goes on without it. Both readers
  skip an entry without a non-blank `name`.

### `pdt-library/processes.json` (contract C5, light template)

```json
{ "version": 1,
  "processes": [ {
      "id": "proc-<uuid>", "name": "Incident logging", "saved_at": "ISO 8601",
      "source_session_id": "<session_id>",
      "steps": [ { "draft_key": "...", "name": "...", "description": "...", "waste": false } ]
  } ] }
```

- "Save as this process" writes the confirmed pattern run's visible steps in
  time order. Each step carries `draft_key` (a drafted step), or
  `draft_keys` (merged drafts), or neither (a step added by hand), plus its
  name, description and waste flag. Saving under a name that already exists
  (case does not matter) replaces that entry and keeps its `id`; Undo
  restores the previous entry. "Forget this saved process", on the Steps
  level's "Compared with saved process" line, deletes the entry; the toast's
  Undo brings it back.
- When a session opens with no confirmed pattern run, the viewer compares it
  with the saved process whose distinct draft keys overlap the session's
  visible steps' the most (Jaccard, at least 0.5; ties go to the most
  recently saved, then to the name), shows that line visibly, and offers
  "Stop comparing".
- The pipeline never reads this file.

## manifest.json

```json
{
  "session_id": "uuid",
  "source": "recorder | video | blank (optional; absent means recorder)",
  "engagement_id": "default",
  "engagement_name": "project name from setup (optional; null until set)",
  "started_at": "ISO 8601",
  "ended_at": "ISO 8601 or null",
  "status": "active" | "closed" | "recovered",
  "label": "the name given in the capture app's end summary (optional; absent until set)",
  "purpose": "process",
  "config": { ...snapshot of session config... },
  "obs": {
    "recording_path": null,
    "recording_start_ts": null,
    "offset_ms": null
  },
  "displays": [
    { "id": 0, "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 } }
  ],
  "consent": {
    "required": false,
    "granted": null,
    "mode": "off" | "per_session" | "once",
    "version": 2,
    "worker_id": "alice",
    "acknowledged_at": "ISO 8601 or null"
  },
  "recovered": false
}
```

`started_at` is the session clock's reference: an attached video's and a
transcript's `offset_ms` are relative to it.

`source` (contract C16) says how the session was made. The capture app
writes none, which means `"recorder"`. A session started from a video has
`"video"` (`started_at` is the moment the analyst says the video starts, by
default the file's creation time; `annotations.json` gets `external_video`
with the path relative to the folder and `offset_ms: 0`); a session started
from nothing has `"blank"` (`started_at` is the creation time). Both have an
empty `events.jsonl` and no capture fields (`config`, `obs`, `consent` and
the rest are absent). The viewer does not create them yet. The pipeline
reads them as sessions without a recording:

- **One implicit run.** While the derived stream has no start marker (the
  marker edits applied), the session has one implicit run covering the
  whole session: `case_id` `uuid5(<fixed namespace>,
  "<session_id>:implicit-run")` (C9's namespace), open (no end), starting at
  `started_at`. It contains every step, one without a time included: a
  preserved step whose `case_id` is not a current run joins it. A start
  marker inserted by hand (`marker_edits`) replaces it, exactly as in a
  recording, and the steps then move to the run that contains their time.
  A recording keeps the marker rule (no start marker, no runs).
- **Nothing recorded.** No foreground time was measured: each run's
  `active_ms` is `null` in `stats.json`, and the analysis stages that
  measure the recording are `null` in `analysis.json` without a
  `stage_errors` entry (see analysis.json).

`consent` is the worker-consent record (section 11f), present in every
recording. With
no consent gate configured (`config.consent.mode: "off"`, the default) it is
the not-required shape `{ required: false, granted: null, mode: "off" }` and
the recording starts unconditionally. With `"per_session"` (prompt at every
start) or `"once"` (prompt once per worker and `version`, remembered in the
user config) the worker sees a consent window at session start; declining
**aborts the start** (no session folder is created), so a session on disk
with `mode` other than `"off"` always has `granted: true`. `version`,
`worker_id` and `acknowledged_at` are present only for a gated session. The
default consent text is version 2: it says that only what is typed into
password fields is left out (the recorder's redaction), so a `"once"`
acknowledgement of the version 1 text is asked again. The C# recorder is
unchanged; consent is purely a capture-app gate.

`displays` is the monitor geometry at session start
(`Electron screen.getAllDisplays()`). The viewer uses it with each activity
event's `bounds` to show which monitor a window was on. It is absent on
sessions captured before the field existed; on a single-display machine it
is a one-element list.

`status`:

- `active`: the session is running, or was running when the tracker crashed
  (an orphan).
- `closed`: the session ended cleanly.
- `recovered`: the session was orphaned and reopened at the next launch.
  Open markers in `events.jsonl` are handled by normalization.

`label` is an optional name for the recording, typed in the capture app's
end summary ("Name this recording"); absent until set. The viewer's Recent
list names a session by its document title (`annotations.document.title`),
else this label, else the project and the folder name.

`engagement_name` is the project name typed in the capture app's Recording
setup, lifted out of `config` to the top level at session creation so lists
can show it without reading the nested config; `null` when never set. Older
sessions carry it inside `config.engagement_name`, and consumers fall back to
that. The PDD's Document control prints it as the project (else
`engagement_id`), unless it is the capture app's default.

`purpose` is always `"process"`. The field is kept so the shape stays
stable. Before ADR-0029 a session could also be `"app_prep"` (an App
Vocabulary curation walkthrough, with a `prep_app` field, filed under
`engagement_id: "vocab-prep"`); app-prep sessions are cut. An older manifest
may still carry `purpose: "app_prep"` and `prep_app`; nothing reads them.

`worker_review` is gone with the close-out wizard's questions (see
[CAPTURE.md](../docs/architecture/CAPTURE.md) for the end summary that
replaced them). An older manifest may still carry it; nothing reads it.

## session-integrity.json

Written by the capture app when a session ends: a list of every file in the
session folder, so the viewer can tell whether a session was copied
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
does not list itself. The viewer's session loader compares the list with the
files present and reports any that are missing.

## transcript.json (contract C8)

Written by `normalization/transcript_import.py` (standard library only) when
a Teams meeting transcript (`.vtt` or `.docx`) is imported. Absent on a
session with no imported transcript. The importer only reads `events.jsonl`
and `annotations.json`; the original file is copied byte for byte to
`transcript/<original name>` and never modified.

```json
{ "version": 1, "source_file": "transcript/meeting.vtt", "format": "vtt",
  "clock": "video", "offset_ms": null,
  "segments": [ { "id": "t0001", "start_s": 12.34, "end_s": 15.0,
                  "speaker": "Ana", "text": "now I look up the customer" } ] }
```

- **`format`**: `"vtt"` or `"docx"`, from the source file's extension.
- **`clock`**: `"video"` when `annotations.json` has an `external_video` with a
  `path` at import time, else `"own"`. Informational only: the time rule
  below does not depend on it.
- **`offset_ms`**: `null` when the importer writes the file. A number means the
  analyst synced the transcript. For both clocks it is relative to
  `manifest.started_at`, the same reference the video offset uses.
- **`segments[]`**: `start_s` and `end_s` are seconds from the transcript's own
  start, to the millisecond. `speaker` is `null` when the source line carried
  no speaker tag (never guessed from a "Name: text" pattern).

**Time rule.** A segment's wall time is `manifest.started_at + offset +
start_s`, where `offset` is:

1. `transcript.offset_ms`, when it is a number (the analyst synced it);
2. else the attached video's `external_video.offset_ms`: the transcript
   shares the meeting video's clock (plan D2), so re-syncing the video moves
   the transcript too;
3. else the transcript is not synced, and nothing is placed on the timeline.

Every viewer surface places sentences by this one rule
(`viewer/transcript-model.js`). Syncing (pick a sentence, then click its
moment on the timeline) rewrites `offset_ms` in `transcript.json` atomically
and keeps every other key as it is (`viewer/transcript-store.js`). A
re-import replaces the file entirely, so `offset_ms` goes back to `null`; a
copy already in `transcript/` with the same name is replaced, any other
earlier copy is left alone. Removing a transcript deletes `transcript.json`
only; the copy in `transcript/` stays. A `transcript.json` that exists but
cannot be used (not JSON, not version 1, no `segments` list) is reported and
ignored. A sentence the analyst adds is appended to a step's `description`
or a `document` field; the transcript file itself never changes.

Supported source layouts (WebVTT with `<v Name>` voice tags, WebVTT Graph
export variants, Word "timing, speaker, text", and Word "Name 0:03" then
text) are documented in the module docstring. A layout the parser does not
recognize fails loudly (exit code 2 below), never with a guess. No real Teams
file was available when it was built; the owner confirms with one.

`transcript_import.py` has its own CLI, separate from `normalize.py`:

```
python transcript_import.py <session_folder> <transcript_file>
```

| Exit code | Meaning |
|---|---|
| 0 | Imported. One summary line on stdout (segment count, speakers, duration, clock), UTF-8. |
| 1 | Bad arguments (not exactly two), or the folder is not a session folder (no `events.jsonl`). |
| 2 | The transcript file cannot be read, or its layout is not a supported one. Nothing was written. |
| 3 | The session folder cannot be used: `annotations.json` exists but cannot be read (so the clock cannot be chosen), or the output write failed. The previous transcript, if any, is kept. |

Errors go to stderr as one line starting `[transcript] ERROR:`. The reusable
entry point `transcript_import.parse(path)` returns `{"format", "segments"}`
and raises `TranscriptError` with a one-line reason; it writes nothing, so a
transcript can be previewed before it is written into the session.

## analysis.json

Measured facts and the step-based estimates, written by the analysis stage
([ADR-0008](../docs/adr/0008-build-the-analysis-layer.md)). Absent on
sessions analyzed before the stage existed. Every step-based figure is a
provisional estimate: `meta.provisional` is always `true` and
`meta.heuristic_version` names the classifier generation.

The three **measured blocks** (`case_quality`, `facts`, `findings`; lab-phase
spec sections A1 to A3) need no runs and no steps, so the file is written for
a session without steps too (the step-based blocks are empty there).

```json
{
  "meta": { "heuristic_version": 2, "generated_at": "ISO 8601",
            "session_id": "uuid", "step_count": 0, "provisional": true },
  "waste_classification": [
    { "step_id": "uuid", "name": "string", "elapsed_ms": 0,
      "va_ms": 0, "bnva_ms": 0, "nva_ms": 0,
      "waste_types": ["waiting | motion | rework | overprocessing"],
      "cross_app_transfers": 0 }
  ],
  "time_study": [
    { "step_id": "uuid", "canonical_step_id": null,
      "name": "string", "instances": 1,
      "cycle_ms": { "mean": 0, "min": 0, "max": 0, "stdev": 0,
                    "p25": 0, "p50": 0, "p75": 0, "p95": 0 },
      "active_ms": 0, "waiting_ms": 0, "switching_ms": 0 }
  ],
  "segments": [
    { "segment_id": "stable hash plus case and start",
      "signature": "12-hex-chars",
      "app": "salesforce.exe",
      "case_id": "uuid or null",
      "start": "ISO 8601", "end": "ISO 8601",
      "elapsed_ms": 0,
      "interaction_count": 0,
      "step_ids": ["uuid"],
      "step_labels": ["Search", "Copy", "Paste"],
      "label": "Search → Copy → Paste in Salesforce" }
  ],
  "automation_candidates": [
    { "segment_signature": "12-hex-chars",
      "label": "Search → Copy → Paste in Salesforce",
      "app": "salesforce.exe",
      "apps": ["salesforce.exe"],
      "step_labels": ["Search", "Copy", "Paste"],
      "case_ids": ["uuid", "uuid"],
      "instance_count": 4,
      "total_elapsed_ms": 134000,
      "mean_elapsed_ms": 33500,
      "instances": [
        { "segment_id": "...", "case_id": "uuid",
          "start": "ISO 8601", "end": "ISO 8601",
          "elapsed_ms": 0, "interaction_count": 0, "step_ids": ["uuid"] }
      ],
      "scores": { "confidence": 1.0, "volume": 134000 },
      "automatable_fraction": 0.7,
      "rank_score": 93800.0,
      "rank": 1,
      "estimated_savings_ms": null,
      "automation_confirmed": null,
      "data_sufficiency": "single_instance | multi_instance" }
  ],
  "efficiency": {
    "process_efficiency_ratio": 0.0,
    "total_va_ms": 0, "total_bnva_ms": 0, "total_nva_ms": 0,
    "total_elapsed_ms": 0,
    "per_step": [ { "step_id": "uuid", "ratio": 0.0 } ]
  },
  "stage_errors": [],
  "case_quality": {
    "mode": "markers | implicit | unsegmented",
    "case_count": 0,
    "coverage": 0.0,
    "tier2_unlocked": false
  },
  "facts": {
    "active_ms": 0, "idle_ms": 0, "session_span_ms": 0,
    "top_apps": [ { "app": "chrome.exe", "ms": 0, "share": 0.31 } ],
    "app_switches": 0, "switches_per_hour": 0.0,
    "longest_focus_ms": 0,
    "rekey_count": 0,
    "repeated_sequence_count": 0,
    "app_time_source": "activity | interactions | none"
  },
  "findings": [
    { "id": "screen_time_sink-3fa2b1c0d4e5",
      "detector": "screen_time_sink | fragmentation | waiting | repetition | backtracking | rekey_transfer | coverage_caveat",
      "claim": "templated sentence, measured numbers, never normative",
      "evidence": { "step_ids": ["uuid"], "event_ids": ["uuid"],
                    "screenshot_refs": ["screenshots/shot_01.png"] },
      "tier": 1,
      "confidence_note": "how the number was measured and its limits" }
  ],
  "pdd_findings": { "eligible": ["finding id"], "default": ["finding id"] }
}
```

**Measured blocks** (computed by `case_quality.py`, `facts.py`,
`findings.py` and `motifs.py`):

- **`case_quality`**: the gate for run-based surfaces. `mode` is `markers`
  when the session has runs from markers, `implicit` when its one run is the
  implicit run of a session without a recording (C16), else `unsegmented`;
  `coverage` is the fraction of interaction events inside a run (`null` in a
  session without a recording, which has none to count); `tier2_unlocked`
  is `mode != "unsegmented" AND coverage >= 0.7 AND case_count >= 2` (one
  run has nothing to compare against). Run-based figures (cycle times,
  variants, per-run comparison) must not render as established facts while
  it is false.
- **`facts`**: direct measurements over the derived stream, no estimates:
  foreground time, measured idle, top apps by share, switch rate, the
  longest unbroken same-app stretch, values re-keyed across two or more apps
  (value equality), and the count of distinct repeated step-label sequences.
  `app_time_source` records where the app-time numbers came from:
  `activity` (measured foreground durations), `interactions` (estimated from
  interaction timestamps when the capture is too old to emit activity
  durations, capture v0.9.0), or `none` (no usable signal; consumers render
  "not available from this recording", never a confident 0).
- **`findings[]`**: the detector library's claims. Claims are comparative or
  factual; each carries its evidence (numbers plus `step_ids`, `event_ids`
  and up to two `screenshot_refs` from the finding's own time window) and a
  `confidence_note` stating the measurement's limits. `tier` is 1 for
  detectors that need no runs, 2 for run-based ones (`repetition`). Ids are
  stable across re-runs (detector plus a content hash). The viewer's
  Overview reads two of them: `rekey_transfer` (Data typed twice) and
  `coverage_caveat` (a warning line). The PDD prints none.
- **`pdd_findings`**: the findings the PDD's former findings section could
  print (`eligible`) and printed by default (`default`), for the "include in
  PDD" ticks. The section and the ticks are cut; the key is still written
  and nothing reads it.

`waste_classification` has one entry per step. `time_study` has one entry
per *logical* step: instances are grouped by `step_group_key`
(`canonical_step_id`, which is always `null` now, then `process_label`, then
`step_id`), so repeated work collapses to one entry with `instances = N`
([ADR-0013](../docs/adr/0013-value-free-grouping-and-map-readability.md)).
`bnva_ms` is `0` until the analyst sets it through `analysis_overrides[]`.

`segments` and `automation_candidates` are **segment-grained**
([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)): the
unit is a coherent stretch of work (consecutive same-app, same-run
interactions, bounded by an app or run switch or a long idle gap), not a
single click. `segments` lists every detected segment; `automation_candidates`
pools them by `segment_signature` (a stable hash of the app and the ordered
`step_labels`), so a pattern repeated four times is one row with
`instance_count: 4`. Labels name the application by its readable name
(`stats.json` `meta.app_names`). A pattern seen once is reported with
`data_sufficiency: "single_instance"`: one observation cannot show
repeatability. Candidates are ordered multi-instance first, then by
`rank_score = instance_count x mean_elapsed_ms x automatable_fraction`, with
a flat `automatable_fraction` of `0.7`. `rank` is the 1-based position among
multi-instance candidates (`null` for single-instance rows, whose
`rank_score` is `0`). `automation_confirmed` carries the verdict of an older
`analysis_overrides[]` entry. `estimated_savings_ms` is always `null`: the
savings estimate went with the EUR-ROI layer, and the business-case formula
lives in the owner's QB app (ADR-0029 D3). The findings detectors read the
step-based blocks; the viewer and the PDD do not.

**`stage_errors`** (contract C12, RP-10): always present, empty when every
stage ran. When a stage fails, its own output key is written `null` (never
`[]` or zeros, which would read as a measured "nothing found"), and one entry
names it:

```json
"stage_errors": [ { "stage": "facts", "error": "KeyError: 'duration_ms'" } ]
```

The stages that can fail independently: each step-based block
(`waste_classification`, `time_study`, `segments`, `automation_candidates`,
and `efficiency`, which does not run without the waste split);
`step_analysis`, when the whole step-based layer fails and its blocks go
`null` together; `case_quality`; `motifs` (the repeated-sequence input to
`facts`); `facts`; `findings`, which does not run when `step_analysis`,
`motifs`, `facts`, `time_study`, `segments` or `automation_candidates`
failed, since its detectors read all of them and a partial run would
under-report; and `pdd_findings`. The viewer's Overview shows a failed stage
as "this check could not run on this recording", never as a measured
negative. The PDD reads no analysis stage.

**Nothing recorded (C16).** A session without a recording
(`manifest.source` `"video"` or `"blank"`) has nothing for the measurements
of the recording to measure. There, the step-based block
(`waste_classification`, `time_study`, `segments`, `automation_candidates`,
`efficiency`), `facts`, `findings` and `pdd_findings` are `null` **without**
a `stage_errors` entry, since nothing failed; `case_quality` still counts the
runs. A renderer tells the two apart by `stage_errors`: `null` with an entry
is "this check could not run", `null` without one is "nothing was recorded".
In every session the step-based block leaves out the steps without a time
range: they have no time to measure.

## Invariants

- Events are immutable once written. Corrections live in `annotations.json`
  (section 9.3).
- `event_id` is unique within a session.
- `events.jsonl` is in `timestamp` order in practice (one writer, appending);
  normalization sorts defensively by `(timestamp, _seq)`, so a millisecond
  collision still resolves to the true append order (section 7.1 step 2).
- Adjacent identical activity events (same app, title, label and `case_ids`)
  are collapsed during normalization (section 7.1 step 7).

## Post-normalization artifacts

`normalize.py` writes these into the session folder:

| File | Contents |
|---|---|
| `stats.json` | `{ activity_stats, case_stats, trace_variants, step_variants, step_stats, app_outliers, rework_loops, screenshot_hashes, meta }` |
| `analysis.json` | `{ meta, waste_classification, time_study, segments, automation_candidates, efficiency, stage_errors, case_quality, facts, findings, pdd_findings }` |
| `annotations.json` | The merged steps (drafts plus the analyst's steps), `process_exclusions`, `version`, `session_id`, `last_modified`; every other key as it was |
| `process_map_step.bpmn` | With `--mine`: the step-level BPMN from the visible steps that belong to a run (one trace per run, nodes labelled by `process_label`; one run is a plain sequence, two or more are mined), ending in a real end event. Each task's documentation carries its description, system, screen, run count and average time; the start and end events take the first line of `document.trigger` and `document.result`; each branch says "N of M runs" (C15). "Edit as the As-Is map" copies it, and the PDD prints it when no As-Is copy is chosen. |
| `normalize.log` | Rolling log of warnings and info (see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)) |

The PDD goes to the path given with `--pdd-out`; the viewer writes it to a
temporary file and offers it for saving. Other writers: the capture app
(`events.jsonl`, `manifest.json`, `config.yaml`, `screenshots/`,
`obs/sync.json` `{ tracker_session_start_ts, obs_recording_start_ts,
offset_ms, recording_path }`, `session-integrity.json`), the viewer
(`annotations.json` and its backups, `derived_maps/`, the transcript's
`offset_ms`) and `transcript_import.py` (`transcript.json`, `transcript/`).

**No longer written:** `events.xes`, `events.csv`, `dfg.json`, the
activity-level `process_map.bpmn` and the per-case maps in `process_maps/`
(removed in the light version, ADR-0029 AD-9). Older folders, the committed
demo sessions included, may still hold them; nothing reads them.

## `normalize.py` exit codes (contract C13)

```
python normalize.py <session_folder> [--taxonomy path/to/taxonomy.yaml] [--mine]
    [--pdd-out path.docx] [--pdd-map-image path.png] [--pdd-tobe-image path.png]
    [--names remembered-names.json]
```

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | Usage error (bad arguments), or the folder is not a session folder. |
| 2 | `annotations.json` exists but cannot be parsed; nothing was written. |
| 3 | A requested export (`--pdd-out`) failed; the analysis outputs (stats, analysis, step BPMN) were already written, the export was not. |

Every error (codes 1 to 3) is one stderr line starting `[normalize] ERROR:`;
an unexpected crash also exits 1, with a Python traceback. The viewer treats
any non-zero exit as a failure and never opens a stale export file. Flag
reference: [NORMALIZATION.md](../docs/architecture/NORMALIZATION.md).

---

# Data Dictionary

The sections above define the *shape* of each file. This part defines the
*meaning* of fields whose semantics are not obvious from the type, plus the
cross-cutting conventions.

## Conventions

| Topic | Rule |
|---|---|
| Identifiers | Treat every id as opaque. `event_id`, `session_id` and `step_id` are RFC 4122 v4 UUIDs in lowercase hex; a run's `case_id` is a v5 UUID derived from the session and its start marker (C9). A synthetic marker's event id is `insert-<edit_id>`; other ids carry a prefix (`rm_` reference maps, `proc-` saved processes, `t0001` transcript segments). |
| Timestamps | ISO 8601 with millisecond precision and a timezone (`...Z` for UTC). Always emit UTC; comparing across sessions needs no timezone work. |
| Encoding | Text files are UTF-8 without a byte order mark. `events.jsonl` uses LF line endings, even on Windows. |
| Paths inside session artifacts | Relative to the session folder, forward slashes (`screenshots/foo.jpg`). `external_video.path` may be absolute. The `file` of an `analyst_screenshots` or `attachments` entry is a file name inside `screenshots/analyst/` or `attachments/` (C16). |
| Numeric durations | Milliseconds (`duration_ms`, `total_ms`) unless the field name says `_s` for seconds (`video_offset_s`, `start_s`). |

## Activity events: what `duration_ms` measures

An `activity` event spans a run of consecutive `active-win` polls that
returned the same `(app, pid)` pair **and the same normalized window
title**. A change of foreground app, process or title ends the run and
starts a new event, so moving between web apps in one browser (Salesforce,
then SAP, both `chrome.exe`) produces distinct events instead of one coarse
`chrome.exe` event ([ADR-0007](../docs/adr/0007-activity-event-granularity.md)).

The title is normalized for the run-boundary comparison only: a leading
unread count (`(3)`), an unsaved-changes marker (`*` or `●`) and the
trailing browser-name suffix are stripped, so cosmetic title churn does not
fragment the stream. The raw title is what the event records.

`duration_ms` is the wall-clock span from the first poll to the last poll in
the run, not the sum of foreground time. Idle gaps within the run are not
subtracted there; they show up as separate `idle_start` / `idle_end` system
events. A run's `active_ms` in `stats.json` does subtract them.

Collapsed events (section 7.1 step 7) sum `duration_ms` across adjacent
events with the same `(app, title, label, case_ids)`. The collapsed event's
`timestamp` is the first event's timestamp; its duration is the sum.

## Marker events: runs and `case_ids`

A **run** is one pass through the process, bracketed by markers. Case
detection is markers only: anchor-based detection is gone (ADR-0029), and a
recording with no markers has no runs. A session without a recording (a
video or blank session, C16) with no start marker has one implicit run
covering the whole session instead (see manifest.json `source`).

- A `start` marker opens a run. **Runs never nest.** A `start` that arrives
  while a run is open ends that run first. The capture app's run hotkey
  already writes an `end` (`reason: "auto_close_for_sibling"`) before the
  next `start`; when a stream lacks it (a start inserted in the viewer, for
  example), the pipeline ends the open run at the new start, records it on
  the derived start marker as `ends_case_id`, and gives the ended run
  `end_reason: "auto_close_for_sibling"` in `stats.json`. No end marker is
  invented.
- An `end` marker ends the open run, whatever its label. An `end` with no
  open run is ignored.
- A run left open at the end of the stream stays open (no end is invented).
- A run's `case_id` is `uuid5(<fixed namespace>, "<session_id>:<start marker
  event_id>")` (C9), so re-analyzing the same recording yields the same ids.
  On re-analysis a preserved analyst step whose `case_id` is no longer a run
  moves to the run whose span contains it; a step no run contains gets
  `case_id: null`.

After normalization every activity and interaction event in the derived
stream carries `case_ids`:

| `case_ids` | Meaning |
|---|---|
| `[]` | The event happened outside every run (before the first start, after the last end, or between runs). |
| `["abc"]` | Inside run `abc`. |

The list shape is kept from the product edition, when runs could nest; it
never holds more than one id now, and `parent_case_id` is always `null`.

## Step states: the lifecycle

Each step's `state` says how it got into `annotations.json`:

| State | Set by | Survives re-normalization |
|---|---|---|
| `auto_suggested` | The drafting rule ([step_suggest.py](../normalization/step_suggest.py) `auto_suggest_steps`, contract C1): one drafted step per screen visit, ending at its commit action. | No: replaced by the next run's drafts. |
| `confirmed` | "Confirm run" on the step's run, the draft left unchanged (C3). "Reopen run" turns it back into a draft. | Yes, exactly like `edited`. |
| `manually_authored` | The analyst added a step by hand. | Yes. |
| `edited` | The analyst changed a draft (renamed, merged, split, or otherwise). | Yes. |
| `hidden` | The analyst hid the step (its previous state is kept in `_prev_state`). | Yes: a re-analysis does not bring it back as a fresh draft. |

`auto_matched` (the canonical step matcher) is gone with canonical matching
(ADR-0029 AD-8); the viewer reads a leftover one as a draft. The merge in
[`_merge_steps`](../normalization/step_suggest.py) keeps `manually_authored`,
`edited`, `confirmed` and `hidden` steps, drops a fresh draft that overlaps
one of them, and lets a fresh draft inherit the `step_id` of the step it
re-covers. That is why corrections, confirmations and hides survive
re-analysis.

## Interaction enrichment: when each field is present

UIA fields (`automation_id`, `name`, `class_name` and the rest) come from the
recorder. App Vocabulary fields (`meaningful_name`, `screen_id`,
`vocab_flags`, `vocab_semantics`, `vocab_source`) appear only when a
vocabulary in `normalization/app_vocabularies/` matches the interaction. See
[ADR-0002](../docs/adr/0002-app-vocabularies.md) for why this layer exists.

When both the UIA `name` and a vocab `meaningful_name` are present, the
viewer prefers `meaningful_name` for display but exposes both. Consumers
fall back to `name` when `meaningful_name` is absent.

The **recognition layer** ([ADR-0011](../docs/adr/0011-platform-recognition-layer.md))
classifies an interaction by documented platform and framework signatures in
[`shared/recognition-patterns.json`](recognition-patterns.json), shared
verbatim by `viewer/recognition.js` and `normalization/recognition.py` so
both engines classify alike. Each signature carries a `category`, a
`typeLabel` and a `framework`; the optional **`richTextIf`** field refines a
match: when the element's `class_name` also contains that substring, the
interaction is reclassified `category: "rich_text"` (typeLabel "rich-text
field") instead of the signature's default.

## `stats.json` sub-objects

| Top-level key | Shape | What it is for |
|---|---|---|
| `activity_stats` | `[{ activity_label, frequency, frequency_pct, total_duration_ms, mean_ms, median_ms, p90_ms, p99_ms }]` | Per-activity roll-ups across the session. |
| `case_stats` | `[{ case_id, label, parent_case_id, start_ts, end_ts, wall_clock_ms, active_ms, end_reason, implicit? }]` | One row per run, in start order. `parent_case_id` is always `null` now. `active_ms` is foreground time inside the run minus the idle time the recorder measured (RP-07); `null` in a session without a recording (C16). `end_reason` is the end marker's `reason`, `auto_close_for_sibling` when the next start ended the run, or `null`. `implicit: true` marks the implicit run of a session without a recording (C16; the key is absent on every other row): its `label`, `end_ts`, `wall_clock_ms` and `end_reason` are `null`. The viewer's runs come from here. |
| `trace_variants` | `[{ variant: ["A", "B", "C"], frequency, length }]` | Distinct activity sequences per run, most frequent first. |
| `step_variants` | `[{ variant: ["Step A", "Step B"], frequency, length }]` | Distinct step sequences per run, each element the value-free `process_label` ([ADR-0013](../docs/adr/0013-value-free-grouping-and-map-readability.md)), in the run's step order (time, then `order`, C16). Built from the visible steps; empty until the session has steps. |
| `step_stats` | `[{ step_name, frequency, frequency_pct, total_duration_ms, mean_ms, median_ms, p90_ms, p99_ms }]` | Per-step duration distribution, keyed on `process_label`, so a step seen in N runs is one row with `frequency = N`. Visible steps with a time range only (a step without one is left out, C16). |
| `app_outliers` | `[{ app, case_count, case_pct }]` | Apps that appear in fewer than 5% of runs. |
| `rework_loops` | `[{ activity_label, rework_count }]` | Activities revisited within a single run. |
| `screenshot_hashes` | `[{ filename, hash }]` | A 64-bit average hash (16 hex characters) per screenshot. The viewer's screenshot gallery uses it to collapse runs of near-identical frames. Empty when Pillow is unavailable. |
| `meta` | See below | Run metadata. |

### `stats.json.meta` fields

| Field | Meaning |
|---|---|
| `normalization_run_at` | When the pipeline ran. Compare with the `events.jsonl` modification time to spot stale outputs. |
| `taxonomy_version`, `taxonomy_path`, `taxonomy_report` | Which classification taxonomy was applied, and a match count per rule (so a rule that matched nothing shows up). |
| `raw_event_count` | Lines parsed from `events.jsonl`. |
| `dropped_jsonl_lines` | Lines that failed to parse. Zero is expected; see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) otherwise. |
| `collapsed_activity_count` | Activity events left after the section 7.1 step 7 collapse. |
| `coalesced_event_count` | Events left after typing bursts were coalesced. |
| `interaction_count` | Interaction events in the session. |
| `case_count` | Runs in the session. |
| `marker_edits_applied` | Edits from `annotations.json` `marker_edits` that took effect this run. |
| `step_count`, `step_state_breakdown` | Total steps and the count per state: `auto_suggested`, `manually_authored`, `edited`, `confirmed`, `hidden`. |
| `draft_summary` | The drafting rule's own structure-only numbers (the P1 probe instrument), counted on the fresh drafts before the merge with the analyst's steps: `{ runs, steps_per_run, out_of_run_steps, end_reason: {commit, screen_change, run_end}, name_source: {remembered, draft}, commit_identity: {automation_id, name, class_name, "?"} }`. `steps_per_run` follows run start order. On a session with no runs, `runs` is 0 and every draft counts in `out_of_run_steps`. The [P1 draft-probe runbook](../docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md) reads it. |
| `app_vocabularies`, `app_vocabulary_matches`, `app_vocabulary_hits_by_id` | Vocabularies loaded, interactions matched, hits per vocabulary. |
| `vocab_coverage` | Per app `{ total_interactions, enriched, coverage_pct }`: how much of each app's interactions a vocabulary could name. The viewer does not show it. |
| `app_names` | `{ executable as recorded: readable name }` for every application in the recording (`normalization/app_names.py`): the `shared/system-names.json` rule for that application alone (a rule without a title: "SAP", "Excel", "Google Chrome"), else a vocabulary's name, else a window-title segment naming the executable as a word, else the capitalized executable name; never an invented product name. The viewer, the findings and the automation-candidate labels read application names through it. The PDD and the step map name the business system through `app_names.system_name`, which also applies the title rules (a Chrome window on Salesforce is "Salesforce"; C14). |
| `annotations_present`, `session_folder`, `worker_id` | Bookkeeping. |

`canonical_process_id`, `canonical_version`, `drift_count`, `phase_count`,
`matched_interactions` and `match_rate` are gone: canonical matching and
phases are cut (ADR-0029).

## When the schema changes

The schema is versioned implicitly: an additive change is non-breaking;
renames and removals would be breaking. `annotations.json` has an explicit
`version` (currently `1`); bump it on a breaking change. `events.jsonl` does
not version itself; `manifest.json` is the place for a future capture-schema
version. The two analyst library stores carry their own `version` (1).
