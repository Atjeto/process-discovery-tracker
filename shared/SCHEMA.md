# Session Package Schema

A captured session is a self-contained folder. This is the integration seam between capture, normalization, and the viewer (§2.1 of the design).

## Folder layout

```
sessions/<engagement_id>/<YYYYMMDD-HHMMSS>/
  events.jsonl       # raw event stream, append-only, one JSON object per line
  manifest.json      # session metadata, status, OBS reference
  annotations.json   # analyst sidecar (created/updated by the viewer)
  screenshots/       # event-triggered screenshots
  obs/               # OBS recording reference and sync data
  derived_maps/      # analyst-authored reference maps — standalone editable .bpmn copies (ADR-0019)
  session-integrity.json  # file manifest (name + size) written at session end
  transcript/        # a copy of an imported meeting transcript (contract C8), if any
  transcript.json    # the parsed, aligned form of the imported transcript, if any
  # + normalization outputs (events.xes/csv, stats.json, analysis.json,
  #   process_map*.bpmn, dfg.json) — see "Post-normalization artifacts" below
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
  "duration_ms": 17320,
  "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 }
}
```

`timestamp` is the start of the activity run, not the moment the event was written. `duration_ms` covers the span the foreground window held the same app, pid, and (normalized) window title — see the data dictionary below.

`bounds` (optional) is the foreground window's desktop rectangle — `x`/`y` top-left, `w`/`h` size. The viewer pairs it with `manifest.displays` to badge which monitor the work happened on. Capture builds whose `active-win` omits window bounds simply leave the field off.

### `marker` data

```json
{
  "marker_type": "start" | "end",
  "label": "Order entry" | null,
  "reason": "auto_end_idle" | "auto_close_for_sibling" | null
}
```

`case_id` and `parent_case_id` are NOT set by capture. The normalization layer walks the marker stream, builds the case tree, and stamps every activity event with the stack of open case IDs at the moment it was captured (§5.2). After normalization, marker events also carry `case_id` and `parent_case_id` so downstream consumers don't need to re-walk.

End markers carry `null` label by convention; they close the innermost open Start. `reason` is set when an end was auto-fired — `auto_end_idle` (an idle stretch past the threshold, §3.3) or `auto_close_for_sibling` (pressing Start with a marker already open closes it and opens a sibling — the default close-then-open behaviour).

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

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`, `idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`, `obs_recording_start`, `obs_recording_stop`, `events_dropped`, `recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`, `recorder_health`, `recorder_silent`, `recorder_silent_end`, `uncaptured_app`. (`sync_marker`, for cross-machine correlation, is gone: the BA-helper scenario is single-worker, single-machine per session, so there is nothing to correlate; [ADR-0029](../docs/adr/0029-ba-helper-refocus.md).)

Kind-specific payloads:

| Kind | Payload |
|---|---|
| `idle_start` | `{ idle_seconds, at_desk }` — `at_desk` is `true` when the recorder forwarded an interaction within the last 30 s, i.e. the worker was active even though the OS idle timer (mouse/keyboard) crossed the threshold |
| `idle_end` | `{ duration_seconds }` |
| `auto_end_idle` | `{ idle_seconds }` (fired after auto-closing all open markers, §3.3) |
| `screenshot` / `screenshot_manual` | `{ path: "screenshots/<file>.jpg" }` (relative to session folder) |
| `obs_recording_start` / `obs_recording_stop` | (empty; full OBS sync details live in `obs/sync.json` and `manifest.json.obs`) |
| `events_dropped` | `{ dropped_interactions, dropped_activities, first_dropped_ts, last_dropped_ts, failed_writes, last_error }` (RP-21): a non-critical write batch (activity/interaction events, no marker or system event inside it) failed and was dropped rather than retried. The tracker folds every drop in one loss stretch into a single pending record and queues it as this durable event ahead of the next event it appends, so the gap is counted and visible on the session timeline instead of only a boot-log line. `dropped_interactions` / `dropped_activities` split the count by event type; `failed_writes` is how many flush attempts failed during the stretch; `last_error` is the most recent write error's message. |
| `recorder_start` / `recorder_stop` / `recorder_dead_permanent` | (empty) |
| `recorder_died` | `{ code, signal, restart_count }` |
| `recorder_health` | `{ queued, emitted_total, dropped_total, errors, last_error? }` -- a periodic snapshot of the C# recorder's stats line (~every 30s). `last_error` (`{ kind, pid, process_name, control_type, message }`) is present only after a recorder-side failure. |
| `recorder_silent` | `{ silent_for_ms }` -- the capture app's dead-man monitor detected no interaction event AND no `recorder_health` heartbeat for over ~2 minutes during an active session (the silent-death failure mode). Fired once per silence stretch, alongside a tray warning state + OS notification. The analyst should treat the span from the last signal as interaction-blind. |
| `recorder_silent_end` | `{ gap_ms }` -- recorder signals resumed after a `recorder_silent` stretch; `gap_ms` is the full signal-to-signal gap. |
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
| `framework_id` | string | Raw UIA FrameworkId — `Win32`, `WinForm`, `WPF`, `XAML`, `Chrome`, others. Java/Qt/remoting hosts misreport this (often `Win32`); prefer `framework` below. |
| `framework` | string | **Normalized UI-toolkit detection** (§11e) — `win32` \| `winforms` \| `wpf` \| `winui` \| `chromium` \| `java` \| `javafx` \| `qt` \| `remote` \| `terminal` \| `unknown`. Re-derived in the recorder from `framework_id` + `class_name` so toolkits that lie about their `framework_id` are recognised. Distinct from the recognition layer's *web-app* `framework` axis (chromium/ag-grid/office365). Lets the analyst tally toolkit coverage and explain thin capture (`java` needs the Java Access Bridge; `remote`/`terminal` expose little to UIA → the video backstop applies). Always present (worst case `unknown`). |
| `identity_source` | string | **Identity-ladder rung** (§11e) — `automation_id` \| `name` \| `class_name` \| `ocr` \| `none`. Which source gave the element a stable identity, in descending reliability. `ocr` means a label was recovered by the OCR last rung (see `ocr_text`); `none` means no identity at all. Always present. |
| `confidence` | number | **Per-element capture confidence** in `[0,1]` (§11e). Blends the `identity_source` rung with the `framework` (a strong rung is still capped at `0.30` on a `remote`/`terminal` surface, where a captured field is an unreliable proxy for the real pixel control). Rough rungs: `automation_id`≈0.95, `name`≈0.70, `class_name`≈0.40, `ocr`≈0.25, `none`≈0.10. Lets the analyst flag low-trust captures. Always present. |
| `ocr_text` | string | Present **only** when the OCR last rung fired (§11e) — a text label recovered from the element's on-screen region via `Windows.Media.Ocr` because it exposed no structured identity. Default-off (session opt-in `interactions.ocr`). Like `value` / `window_title` this is **captured content**, so the structure-only `inspect-events.js` never prints it. Length-clamped to 256 chars. |
| `window_title` | string | Top-level window title |
| `process_name` | string | Owning process .exe name |
| `pid` | int | Owning process PID |
| `selected_value` | string | `selection_changed` only |
| `toggle_state` | string | `toggle_changed` only - `on` \| `off` \| `indeterminate` |
| `value` | string | `value_changed` only, length-clamped to 256 chars. **Omitted entirely when `value_redacted` is set.** |
| `value_redacted` | bool | `value_changed` only; present (`true`) when the recorder **redacted a secret at capture** — the control was UIA-flagged `IsPassword` (a password / masked-secret field), so the `value` is omitted and the `TextPattern` / OCR recovery is skipped. The raw `events.jsonl` never holds the secret. This is capture-time redaction (the recorder), distinct from the analyst-side `value_masked` masking of the *derived* stream below. |
| `value_truncated` | bool | `value_changed` only; present (`true`) when the 256-char clamp fired, so the analyst knows the stored value is partial |
| `value_source` | string | `value_changed` only; present **only when the value was recovered** off the primary UIA ValuePattern path (§11e) — currently `text_pattern` (content read via `TextPattern` from a rich-text/document control that reported an empty ValuePattern value, generalizing the AG-Grid fix). Omitted on the normal path. A future OCR recovery would surface here as `ocr`. |
| `coverage_hint` | string | First interaction per process only — `rich` (stable `automation_id`) \| `basic` (control type, no id) \| `minimal` (class name only). Signals how richly UIA exposes that app. |

Fields are omitted (not nulled) when the underlying UIA property throws on access.

`text_changed` and `focus_changed` are emitted **only in the recorder's verbose
(forensic) mode**; the default mode drops both — `text_changed` carries no payload
(the value rides the next `value_changed`), and the `window_title` / `process_name`
we care about ride the next signal event. A normally-captured session contains
neither kind.

#### Enrichment fields (added during normalization)

When an App Vocabulary (ADR-0002) matches an interaction, normalize.py adds:

| Field | Type | Notes |
|---|---|---|
| `meaningful_name` | string | Analyst-curated name for this interaction (e.g. "Run customer search") |
| `screen_id` | string | Named screen the interaction belongs to, if the vocab defines screens. Set when the interaction's control matches a vocab signature carrying a `screen`, **or** (ADR-0024 §6b) when its `window_title` matches a vocab screen's `window_title_regex` — so every interaction on one form shares one value-free screen even if its specific control isn't in the vocab (a screen tag only; not counted as a vocab name match). |
| `vocab_flags` | object | Default flags from the vocab; only `waste` rolls up onto the containing step (ADR-0027 — other keys are ignored) |
| `vocab_semantics` | object | The matched entry's **semantic fields** (lab-phase §C1, all optional in the vocab YAML): `verb` (enter/select/click/submit/toggle/open, auto-derived at discovery from control type × event kind), `object` + `means` (human/LLM-authored meaning), `completion` (bool, true when the drafting rule ends a step at this interaction, contract C1(a)), `case_id_source` (bool, authored metadata only: its one consumer, the anchor-candidate detector, was cut in [ADR-0029](../docs/adr/0029-ba-helper-refocus.md)), `carries_value` (bool, admitting the field's typed values into the rekey detector at a relaxed minimum length). Present only when the entry carries at least one of them (a pre-C1 vocab produces exactly the pre-C1 event shape). |
| `vocab_source` | object | `{ vocab_id, vocab_version }` for traceability |

These fields are additive; the raw `name`, `control_type`, etc. always remain.

#### Masking fields (added during normalization — §11f)

When structural PII masking (`normalization/pii_masking.py`) redacts an
interaction's value, normalize.py replaces the value **in the derived stream
only** (events.csv / events.xes / stats / steps / analysis / maps) and marks it:

| Field | Type | Notes |
|---|---|---|
| `value` / `selected_value` | string | Redacted to a one-way join-preserving token `«<category>#<8-hex>»` (`sha256(session_id + ":" + value)[:8]`) — same value+session ⇒ same token, original not recoverable. |
| `value_masked` | bool | `true` when this interaction's value was redacted. |
| `value_masked_rule` | string | Which rule category fired (`password`, `ssn`, `card`, `cvv`, `pin`, `secret`, `iban`, `routing`, `account`, or a custom id). |

The **raw `events.jsonl` is never rewritten** — masking applies only to the
in-memory copy that produces the derived artifacts. Which rule-set ran is
recorded in the `pii_masking` annotations key (below).

### Recorder snapshot messages (transient, ADR-0025, narrowed by ADR-0029)

The recorder's `snapshot` stdio command streams two message types that are
**never persisted to `events.jsonl`**. Before [ADR-0029](../docs/adr/0029-ba-helper-refocus.md)
they were consumed live by the viewer's App Library "Discover from window"
flow; that in-app vocabulary discovery flow is cut (light vocab, a
remembered-names store keyed by `draft_key`, replaced it), so the recorder
still answers a `snapshot` command the same way but nothing in the current
viewer sends one. They
share the `{ v: 1, type, ts, data }` envelope of the other recorder stdio lines
(`ready` / `stats` / `warning`).

**`snapshot_control`** — one per identifiable control in the target window's UIA
subtree, per pass. Controls with no `automation_id`/`name`/`class_name` (pure
decoration) are skipped; the walk is capped at ~2000 controls.

| Field | Type | Notes |
|---|---|---|
| `control_type` | string | e.g. `Button`, `Edit`, `ComboBox` |
| `automation_id` | string | Developer-assigned ID (may be volatile — the two-pass diff decides) |
| `name` | string | Accessible label |
| `class_name` | string | UIA class name |
| `framework_id` | string | Raw UIA FrameworkId |
| `framework` | string | Normalized toolkit (§11e), same domain as the `interaction` field |
| `identity_source` | string | Identity-ladder rung (§11e): `automation_id` \| `name` \| `class_name` (never `none` — those are skipped) |
| `confidence` | number | Per-element capture confidence `[0,1]` (§11e) |
| `bounds` | object | `{ x, y, w, h }` on-screen rectangle; omitted when UIA reports none |
| `depth` | int | Tree depth below the target window (the window itself is `0`) |
| `role` | string | UIA LocalizedControlType — the human role word ("button") |
| `pass` | int | 1-based snapshot pass (≥2 passes ≥1s apart so the picker can diff for volatility) |

**`snapshot_done`** — one per pass, after that pass's controls.

| Field | Type | Notes |
|---|---|---|
| `window_title` | string | Target window title (the screen-grouping key for the skeleton); `null` if no target resolved |
| `count` | int | Controls emitted in this pass |
| `pass` | int | 1-based pass number |

## Annotation file (annotations.json)

Analyst-authored edits and notes. Sidecar to `events.jsonl`; raw events are never mutated. Re-normalization consumes this file (§9.3 option b) before case assignment.

```json
{
  "version": 1,
  "session_id": "uuid",
  "steps": [],
  "annotations": [],
  "marker_edits": [],
  "pattern_run": null,
  "document": null,
  "classification_overrides": [],
  "analysis_overrides": [],
  "excluded_ranges": [],
  "notes": [],
  "starred_screenshots": [],
  "memo_selection": [],
  "reference_maps": [],
  "external_video": null,
  "calibration": null,
  "last_modified": null,
  "last_modified_by": null
}
```

`notes` and `marker_edits` retain the v0 shapes below. Every top-level key is
additive; a missing file, or a missing key inside one, is treated as empty /
absent. `external_video` *(optional object; pre-dates this cycle)* is the
attached video's `{ path, offset_ms, attached_at }`, written by the viewer's
Attach-video flow; `offset_ms` is the sync offset between the video's own
clock and the session's (contract C8 reads it as the transcript's `"video"`
clock).

**`pattern_run`** *(optional object; contract C3, viewer-written)*: the run
the analyst has confirmed as the reference, and the P1 draft-quality probe
instrument:

```json
"pattern_run": {
  "case_id": "<case_id of the run used as the pattern>",
  "confirmed_at": "ISO 8601 or null",
  "draft_fixes": { "merge": 0, "split": 0, "add": 0, "drop": 0 }
}
```

- The default pattern run is the first run by start time with at least one
  step; the analyst can pick another. "Confirm run" converts that run's
  remaining `auto_suggested` steps to `confirmed`. A run is confirmed once
  every one of its non-hidden steps is in an analyst state (`confirmed`,
  `edited`, `manually_authored`).
- `draft_fixes` counts the boundary fixes made to the pattern run's drafts
  while confirming it (merge, split, add, drop: renames are not counted).
  This is the structure-only number the
  [P1 draft-probe runbook](../docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md) reports.
- The pipeline preserves this key verbatim and never regenerates it.

**`document`** *(optional object; contract C6, viewer-written)*: the PDD's
document-level sections, as fields that survive re-export instead of being
written into the exported `.docx` by hand:

```json
"document": { "title": "", "purpose": "", "scope": "", "contacts": "",
              "business_rules": "", "exceptions": "", "notes": "" }
```

Plain multi-line strings. The PDD renders each non-empty field in place of
the matching placeholder; an empty field keeps the export's default
placeholder text. The pipeline preserves this key verbatim.

**`memo_selection`** *(optional string array; lab-phase spec §A4/§A5)*: the
`findings[].id` values the analyst ticked "include in PDD" on in the
viewer's Overview level (before this cycle, "include in memo"; the standalone
memo export is cut, and this list now feeds the PDD's findings section
instead: see `memo_export.build_memo_model`). Falls back to the top
findings in feed order when empty or when no listed id matches the
regenerated findings. Analyst-owned; never written by the pipeline.

**`starred_screenshots`** *(optional array; unchanged shape)*: screenshot
paths (the `data.path` of `screenshot` / `screenshot_manual` events) the
analyst flagged as evidence. Before this cycle they fed the HTML findings
report (cut); they now embed inline as evidence figures in the PDD's
findings section.

**`calibration`** *(optional object; absent = pipeline defaults)*: the
segmentation-tuning surface an analyst can set per session. The drafting
rule (contract C1) replaced the old step auto-suggester, and most of the
old segmenter's knobs no longer apply: `step_split_idle_ms`,
`step_max_interactions`, `step_min_interactions`, `step_max_idle_ms`, and
`step_split_on_element` are still read (an old session's block loads without
error) but **ignored**, like any unknown key. Only two knobs still do
anything: `coalesce_idle_ms` (1500, the typing-burst coalescing window) and
`filter_browser_chrome` (`true`, drop the browser's own address bar / tabs /
toolbar before drafting). An absent or empty block reproduces the default
pipeline output exactly.

The viewer keeps up to four rotating backups of this file: `annotations.json.2` (most recent) through `annotations.json.5` (oldest); each save shifts the previous versions down one slot. It is a safety net against a regretted bulk edit or a corrupt write; recovery is a manual file copy of a `.N` file back over `annotations.json`.

### Legacy keys (contract C10)

[ADR-0029](../docs/adr/0029-ba-helper-refocus.md) cut the features behind the
keys below. Re-normalization keeps round-tripping every one of them
verbatim: `pipeline_stages._init_existing_anno` never seeds or regenerates
them, so an old `annotations.json` loads without error and nothing under
`normalization/` writes, reads, or deletes them. The viewer ignores them.
Detail on the pre-cut shape of each is kept in git history (the doc
revision before ADR-0029), not repeated here.

| Key | Was | Cut because |
|---|---|---|
| `phases[]` | Analyst-authored phase groupings of steps | Phases are cut (ADR-0029 D4/D6) |
| `drift_markers[]` | Flags when a step's canonical assignment would now resolve differently | Canonical / Process Template matching is cut (ADR-0029 AD-8) |
| `marker_suggestions[]`, `marker_suggestions_dismissed[]` | Suggested-marker candidates ([ADR-0017](../docs/adr/0017-suggested-markers.md)) | The detector is cut; a missed run marker is added by hand |
| `anchor_candidates[]`, `anchor_candidates_dismissed[]`, `case_anchor_override` | Anchor-candidate suggestions and the accepted override ([ADR-0018](../docs/adr/0018-anchor-candidates.md), [ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md)) | Anchor-based case detection is cut; case detection is markers only |
| `roi_inputs` | The analyst's EUR-ROI assumptions (§11c, [ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md) lineage) | The business-case formula stays in the owner's QB app (ADR-0029 D3) |
| `pii_masking`, `pii_masking_config` | The structural-PII-masking report and the analyst's masking config (§11f) | No privacy masking for internal use; password redaction at capture stays (ADR-0029 D7) |
| `group_annotations[]` | Name / note / waste / hidden on a case-scoped screen visit ([ADR-0028](../docs/adr/0028-case-screen-work-items.md)) | The runs-and-steps view (`pattern_run`, contract C3) replaces the work-item case tree |
| `self_annotations[]` | The worker's answers to the close-out wizard's observed-value questions (lab-phase spec §E3) | The wizard's observed-value questions are cut; the end summary is unauthored |
| `matched_against` | Which Process Template a session was matched against | Process Template matching is cut; saved-process matching (contract C5) is viewer-side and does not write this key |

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

### Analysis override (`analysis_overrides[]`)

Analyst corrections to the heuristic analysis layer ([ADR-0008](../docs/adr/0008-build-the-analysis-layer.md)). The waste and automation classifiers ship provisional: the value-add vs. business-required split is left to the analyst (`bnva_ms` is `0` by heuristic) and an automation candidate cannot be confirmed from a single recording. The analyst corrects both from the viewer's Analysis sub-view. Corrections live here, **not** in `analysis.json` — that sidecar is regenerated on every `normalize` run — and the analysis layer reads them while recomputing it.

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

Entries are typed by which identity field they carry. Every field is optional —
only the ones the analyst touched are present; the rest stay heuristic.

- **`step_id`-scoped** corrections target one step instance. `bnva_ms`
  reclassifies value-add time as business-required non-value-add (clamped to
  available active time so `va_ms + bnva_ms + nva_ms` still equals
  `elapsed_ms`); `waste_types` replaces the detected waste-type set for that
  step.
- **`process_label`-scoped** corrections (no `step_id`) propagate to every
  instance of that step type — written when the analyst edits the grouped
  "Waste by step" row in the Analysis view.
- **`segment_signature`-scoped** corrections target a coherent-segment
  automation candidate ([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)). `automation_confirmed`
  (`true` confirm / `false` dismiss) records the analyst's verdict; the
  signature is the stable hash of the segment's app + ordered step labels,
  so the verdict survives the next re-analyze as long as the segment pattern
  is still detected. A pre-ADR-0016 entry using `step_id` + `automation_confirmed`
  is read-tolerated but ignored on save — the analyst's next click rewrites
  it to the segment-keyed shape.

A per-`step_id` override (the most specific) wins over a `process_label` one
for waste. Raw `events.jsonl` and `analysis.json` are never edited by hand;
the next `normalize` run bakes the overrides into a fresh `analysis.json`.

### Excluded range (`excluded_ranges[]`)

Time spans the analyst marked as out-of-scope from the viewer's timeline range selection — a lunch break, an unrelated detour, anything that shouldn't count in a long passive recording. Step suggestion and `stats.json` skip every event whose `timestamp` falls inside an excluded range on the next normalization run; the raw `events.jsonl`, `events.csv`, and the process maps (`dfg.json`, `process_map.bpmn`) are untouched.

```json
{
  "excluded_ranges": [
    { "start": "<ISO>", "end": "<ISO>", "reason": "manual" }
  ]
}
```

`start` and `end` are inclusive ISO 8601 bounds. `reason` is free text — `"manual"` for a range the analyst selected by hand. A malformed entry (missing `start` or `end`, or `end` earlier than `start`) is ignored rather than failing the run.

### Reference maps (`reference_maps[]`)

Analyst-authored, **decoupled** editable BPMN copies forked from a mined map cell (ADR-0019). A reference map is a **one-way leaf**: the analyst forks the live (laid-out) Process diagram into a standalone `.bpmn`, edits it freely with the full bpmn-js palette, and the pipeline **never** re-mines, merges, or regenerates it. The metadata row lives here; the diagram blob lives at `derived_maps/<map_id>.bpmn`.

```json
{
  "reference_maps": [
    {
      "map_id": "rm_<uuid>",
      "name": "To-Be — straight-through order entry",
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

- **`kind`** — `as_is` | `to_be` | `reference`. What the map *is* (drives the gallery chip + labelling).
- **`file`** — path (relative to the session folder, forward-slashed) to the standalone `.bpmn`. Written/read by `viewer/reference-maps.js`.
- **`source`** — the `(notation, level, scope)` map cell the fork snapshotted, for provenance and drift.
- **`forked_from_hash`** — a short hash (blake2b, sha256 fallback) of the **source** `.bpmn` at fork time. Drift = the current source file hashes differently → the gallery shows "source changed" and offers **Re-fork from current** (a new copy; never a merge).
- **`pdd_role`** — `null` | `as_is` | `to_be`. Which PDD slot this map is selected for (exclusive per slot). When set, the viewer renders the copy to PNG (`exportSvg` → raster) and passes it as `--pdd-map-image` (As-Is, overriding the mined DFG) or `--pdd-tobe-image` (the proposed To-Be section, §4.5).

**Re-normalize contract:** `pipeline_stages._init_existing_anno` only `setdefault`s this key — no stage writes it — so `reference_maps[]` and the `derived_maps/*.bpmn` blobs are preserved verbatim across every `normalize --mine`. Created post-capture, they are not part of `session-integrity.json`. The viewer persists every change through the annotations undo layer, so Ctrl+Z reverts each fork / rename / kind / PDD-role / delete.

### Step entity (`steps[]`)

```json
{
  "step_id": "uuid",
  "session_id": "uuid",
  "case_id": "uuid or null",
  "name": "string",
  "process_label": "string -- name with case values stripped, the value-free grouping key (ADR-0013)",
  "draft_key": "string, absent on a hand-authored step: value-free identity \"<app>|<screen>|<commit>\" (contract C1)",
  "name_source": "remembered|draft, absent on a hand-authored step",
  "end_reason": "commit|screen_change|run_end, absent on a hand-authored step",
  "grain_keys": {
    "element": "string -- the field/control the step acted on (automation_id|name)",
    "screen":  "string, vocab screen_id, else the value-free window-title-derived screen label (shared/screen-label-patterns.json -> screenType / screen_label), so one logical screen is one node across cases (ADR-0024 §6a/§6b)",
    "app":     "string -- process_name (.exe stripped)"
  },
  "description": "string",
  "time_range": { "start": "iso", "end": "iso" },
  "evidence": {
    "interaction_event_ids": ["uuid"],
    "screenshot_refs": ["screenshots/file.jpg"],
    "video_timecode_range": [0, 0],
    "manual_notes": "string"
  },
  "state": "auto_suggested|manually_authored|edited|confirmed|hidden",
  "suggestion_reason": "string, auto_suggested steps only, the C1 draft reason",
  "canonical_step_id": null,
  "flags": {
    "waste": false
  },
  "phase_id": null
}
```

`flags.waste` is the **only** per-step flag ([ADR-0027](../docs/adr/0027-retire-per-step-path-flags.md)).
The former `conditional` / `exception_path` / `automation_candidate` / `condition_text`
flags were retired: a single step is not a path or a segment, so exceptions/variations are
derived from the observed trace variants, automation candidacy from coherent segments
([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)), and conditionality
from the map's branch frequency. Older `annotations.json` may still carry the legacy keys;
they are ignored.

`canonical_step_id` and `phase_id` are always `null` now: canonical / Process
Template matching and phases are both cut ([ADR-0029](../docs/adr/0029-ba-helper-refocus.md)).
The two fields stay in the shape so old tooling that reads them keeps working;
nothing sets them anymore. `phases[]` as a top-level array is gone too (see
the legacy-keys table above).

**Drafted steps (contract C1).** `normalization/step_suggest.py`'s
`auto_suggest_steps` (the drafting rule) replaced the earlier free-running
step auto-suggester. Within one run (case), it walks interactions in time
order; a step is a run of consecutive interactions on one screen, ending at
(a) a commit interaction, inclusive: `kind == "invoked"` on a `Button` /
`SplitButton` / `MenuItem` / `Hyperlink`, or any interaction whose vocab
semantics carry `completion: true`; or (b) the first interaction on a
different screen, exclusive; or (c) the end of the run. Every drafted step
carries three additional fields:

- **`draft_key`**: `"<app>|<screen>|<commit>"`, value-free by construction.
  `app` is `process_name` lowercased with `.exe` stripped; `screen` is the
  vocab `screen_id` when present, else the value-free screen label; `commit`
  is `"<control_type>:<identity>"` of the commit interaction (identity =
  automation_id, else name, else class_name, else `"?"`, each taken
  value-free), or the literal `"(visit)"` when the step did not end on a
  commit. `draft_key` is the identity light vocab (contract C4) and light
  template (contract C5) match on.
- **`name_source`**: `"remembered"` when the name came from the
  remembered-names store (C4), else `"draft"`.
- **`end_reason`**: `"commit"`, `"screen_change"`, or `"run_end"` (the three
  ways the rule ends a step, (a)/(b)/(c) above).

The default drafted name (when not remembered) is `"<screen label>: <commit
label>"`, or just `"<screen label>"` for a `"(visit)"` step; the commit
label is the interaction's vocab `meaningful_name`, else its `name`, else
its `control_type`. Names never embed a typed value. A hand-authored step
(`manually_authored`, or any step normalized before this cycle) carries none
of `draft_key` / `name_source` / `end_reason`.

`grain_keys` are the **UI-containment keys** drafting and the map read
(`element` ⊂ `screen` ⊂ `app`; [ADR-0024](../docs/adr/0024-step-grain-as-view-time-rollup.md)).
Before [ADR-0029](../docs/adr/0029-ba-helper-refocus.md) they also drove an
in-app **Grain** slider with `phase` and `case` notches; the slider (and the
notation × level map matrix it fed) is cut, but the three keys stay,
recomputed every analyze (like `process_label`) so they track the current
evidence. The drafting rule's `screen` component (contract C1) is the same
value-free label the `screen` grain key uses. A step with no interactions
(a hand-authored step) carries `(element)` / `(screen)` / `(app)`
placeholders. Raw `events.jsonl` is untouched; these keys live on the step
(the annotation sidecar) only.

`marker_edits[]` entries (the shape is under "Legacy entries inside the two
original arrays" above) support:

- `field: "label"` - rename a marker
- `field: "timestamp"` - shift a marker's timestamp
- `op: "delete"` - drop a marker from the normalized stream (raw event remains)

Last-write-wins per `(event_id, field|op)`. Order of edits within the array does not matter for application.

## manifest.json

```json
{
  "session_id": "uuid",
  "engagement_id": "default",
  "engagement_name": "project name from setup (optional; null until set)",
  "started_at": "ISO 8601",
  "ended_at": "ISO 8601 or null",
  "status": "active" | "closed" | "recovered",
  "label": "analyst-given session name (optional; absent until set)",
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
    "version": 1,
    "worker_id": "alice",
    "acknowledged_at": "ISO 8601 or null"
  },
  "recovered": false
}
```

`consent` is the worker-consent record (§11f), always present. With no consent
gate configured (`config.consent.mode: "off"`, the default) it is the
not-required shape `{ required: false, granted: null, mode: "off" }` and the
recording starts unconditionally. When `mode` is `"per_session"` (prompt every
start) or `"once"` (prompt once per worker + `version`, remembered in
user-config), the worker is shown a consent window at session start; declining
**aborts the start** (no session folder is created), so a session that exists on
disk with `mode != "off"` always has `granted: true`. `version`, `worker_id`,
and `acknowledged_at` are present only for a gated session. The C# recorder is
unchanged — consent is purely a capture-app gate.

`displays` is the monitor geometry captured at session start (`Electron screen.getAllDisplays()`). The viewer uses it with each `activity` event's `bounds` to badge which monitor a window was on; it is absent on sessions captured before this field existed and on single-display machines it is simply a one-element list.

`status`:

- `active` -- session is currently running, or was active when the tracker crashed (orphan).
- `closed` -- session ended cleanly.
- `recovered` -- session was orphaned and reopened at next launch. Open markers in `events.jsonl` are handled by the normalization layer.

`label` is an optional analyst-facing name, set from the capture app's
post-session summary; it is absent until set. The viewer's Recents list shows
it in place of the folder timestamp when present.

`engagement_name` is the project name the operator typed in the session-setup
window. It is lifted out of the `config` snapshot to the top level at session
creation so the Recents list and the viewer can display it without reading the
nested config; it is `null` when never set. Sessions captured before this field
existed carry the name inside `config.engagement_name`, and consumers fall back
to that. Display precedence is `label` (a post-session rename) → `engagement_name`
→ the engagement-folder name.

`purpose` is always `"process"` now: every capture is an ordinary
business-process recording. The field is kept so the manifest shape stays
stable; nothing writes any other value. Before [ADR-0029](../docs/adr/0029-ba-helper-refocus.md)
a session could also be `"app_prep"` (an App-Vocabulary curation walkthrough,
with a `prep_app` field naming the app being curated, filed under
`engagement_id: "vocab-prep"`); app-prep sessions are cut along with the
in-app vocabulary discovery flow they fed, and `prep_app` is no longer
written. A manifest from before this cycle may still carry `purpose:
"app_prep"` and `prep_app`; nothing reads them.

`worker_review` is gone: the worker close-out wizard's observed-value
questions (self-annotation §E3) are cut along with it (see
[CAPTURE.md](../docs/architecture/CAPTURE.md) for what the session end
screen shows instead). A manifest from before this cycle may still carry a
`worker_review` block; nothing reads it, and the answers it referenced
(`annotations.json self_annotations[]`) are a legacy key (contract C10).

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

## transcript.json (contract C8)

Written by `normalization/transcript_import.py`, standard library only, when
a Teams meeting transcript (`.vtt` or `.docx`) has been imported. Absent on
a session with no imported transcript. `events.jsonl` and `annotations.json`
are only read by the importer, never written; the original transcript file
is copied byte-for-byte to `transcript/<original name>` and never modified.

```json
{ "version": 1, "source_file": "transcript/meeting.vtt", "format": "vtt",
  "clock": "video", "offset_ms": null,
  "segments": [ { "id": "t0001", "start_s": 12.34, "end_s": 15.0,
                  "speaker": "Ana", "text": "now I look up the customer" } ] }
```

- **`format`**: `"vtt"` or `"docx"`, from the source file's extension.
- **`clock`**: `"video"` when `annotations.json` has an `external_video`
  entry with a `path` (the same check the viewer makes before it plays an
  attached video); otherwise `"own"`.
- **`offset_ms`**: always `null` when the importer writes this file. With
  `clock: "video"`, a segment's wall time is session start +
  `external_video.offset_ms` + `start_s`, so no separate offset is needed.
  With `clock: "own"` (no video), the viewer sets `offset_ms` by syncing one
  transcript sentence to one moment; until then the transcript has no wall
  clock of its own.
- **`segments[]`**: `start_s` / `end_s` are seconds from the transcript's
  own start, to the millisecond. `speaker` is `null` when the source line
  carried no speaker tag (never guessed from a "Name: text" pattern).

A re-import replaces `transcript.json` entirely, including `offset_ms`; a
copy already in `transcript/` with the same name is replaced, any other
prior import's copy is left alone. Supported source layouts (WebVTT with
`<v Name>` voice tags, WebVTT Graph-export variants, Word "timing, speaker,
text," and Word "Name 0:03" then text) are documented in the module
docstring; a layout the parser does not recognize fails loudly (exit code 2
below), never a silent guess.

`normalization/transcript_import.py` has its own CLI, separate from
`normalize.py`:

```
python transcript_import.py <session_folder> <transcript_file>
```

| Exit code | Meaning |
|---|---|
| 0 | Imported. One summary line on stdout (segment count, speakers, duration, clock), UTF-8. |
| 1 | Bad arguments (not exactly two), or the folder is not a session folder (no `events.jsonl`). |
| 2 | The transcript file cannot be read, or its layout is not one of the supported ones. Nothing was written. |
| 3 | The session folder cannot be used: `annotations.json` exists but cannot be read (so the clock cannot be chosen), or the output write failed. The previous transcript, if any, is kept. |

Errors go to stderr as one line starting `[transcript] ERROR:`. The reusable
entry point `transcript_import.parse(path)` returns `{"format", "segments"}`
and raises `TranscriptError` with a one-line reason; it writes nothing, so
the viewer can preview a transcript before committing to write it into the
session.

## analysis.json

Heuristic IE/CI findings, written by the normalization **analysis layer**
([ADR-0008](../docs/adr/0008-build-the-analysis-layer.md) / IMPROVEMENTS.md
Cluster N). Absent on sessions normalized before the layer existed. Every
step-grained figure is a provisional heuristic — `meta.provisional` is always
`true` and `meta.heuristic_version` identifies the classifier generation.

Since the honesty redesign (lab-phase spec §A1–§A3) the file also carries
three **Tier-1 measured blocks** — `case_quality`, `facts`, `findings` —
which need no case boundaries and no steps, so the file now writes for a
step-less session too (the classic step-grained blocks stay empty there).

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
    { "step_id": "uuid", "canonical_step_id": "uuid or null",
      "name": "string", "instances": 1,
      "cycle_ms": { "mean": 0, "min": 0, "max": 0, "stdev": 0,
                    "p25": 0, "p50": 0, "p75": 0, "p95": 0 },
      "active_ms": 0, "waiting_ms": 0, "switching_ms": 0 }
  ],
  "segments": [
    { "segment_id": "stable hash plus case + start",
      "signature": "12-hex-chars",
      "app": "salesforce.exe",
      "case_id": "uuid or null",
      "start": "ISO 8601", "end": "ISO 8601",
      "elapsed_ms": 0,
      "interaction_count": 0,
      "step_ids": ["uuid"],
      "step_labels": ["Search", "Copy", "Paste"],
      "label": "salesforce — Search → Copy → Paste" }
  ],
  "automation_candidates": [
    { "segment_signature": "12-hex-chars",
      "label": "salesforce — Search → Copy → Paste",
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
    "mode": "markers | anchor | unsegmented",
    "case_count": 0,
    "coverage": 0.0,
    "tier2_unlocked": false,
    "anchor": { "field_property": "automation_id", "field_value": "customer-id-field" }
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
      "confidence_note": "how the number was measured / its limits" }
  ]
}
```

**Tier-1 measured blocks** (lab-phase spec §A1–§A3; computed by
`case_quality.py` / `facts.py` / `findings.py` + `motifs.py`, additive):

- **`case_quality`** — the Tier-2 gatekeeper. `mode` records how cases were
  derived (`markers` / `anchor` / `unsegmented` when there are none);
  `coverage` is the fraction of interaction events inside a case;
  `tier2_unlocked` = `mode != "unsegmented" AND coverage >= 0.7 AND
  case_count >= 2` (Phase G-3: one case has nothing to compare against,
  so a single marked case never unlocks the case-based surfaces). The
  `anchor` sub-object is present only in anchor mode. Case-based surfaces
  (cycle times, variants, per-case comparison) must not render with
  fact-level authority while `tier2_unlocked` is false.
- **`facts`** — direct measurements over the derived stream, no heuristics:
  foreground time, measured idle, top apps by share, switch cadence, longest
  unbroken same-app stretch, values re-keyed across 2+ apps (value equality
  on the derived stream — masked values compare by token), and the count of
  distinct (maximal) repeated step-label sequences. `app_time_source`
  (Phase G-2, additive) records where the app-time numbers came from:
  `activity` (measured foreground durations), `interactions` (estimated
  from interaction timestamps when the capture is too old to emit activity
  durations — capture v0.9.0), or `none` (no usable signal; consumers must
  render "not available from this recording", never a confident 0).
- **`findings[]`** — the detector library's claims feed (viewer Overview +
  the memo). Claims are comparative/factual; each carries its evidence
  (numbers plus `step_ids` / `event_ids` / `screenshot_refs` where the
  detector has them) and a `confidence_note` stating measurement limits.
  `tier` is 1 for case-free detectors, 2 for case-based ones
  (`repetition`). Ids are stable across re-runs (detector + content hash).

`waste_classification` has one entry per step; `time_study` has one entry per
*logical* step — instances are grouped by `step_group_key` =
`canonical_step_id → process_label → step_id`, so with **no Process Template**
repeated work still collapses to one entry with `instances = N`
([ADR-0013](../docs/adr/0013-value-free-grouping-and-map-readability.md)). `bnva_ms` is `0` by heuristic — the value-add vs.
business-required split needs analyst judgement — until the analyst sets it via
`analysis_overrides[]` in `annotations.json`.

`segments` and `automation_candidates` are **segment-grain** ([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)): the
unit is a coherent stretch of work — a contiguous run of same-app, same-case
interactions bounded by an app or case switch — not a single click. `segments`
lists every detected segment; `automation_candidates` pools them by
`segment_signature` (a stable hash of app + ordered `step_labels`), so the
same pattern repeated four times in one session is one row with
`instance_count: 4`. A pattern with one instance is reported with
`data_sufficiency: "single_instance"` — one observation cannot judge
repeatability. Candidates are ordered by **automation priority**:
`rank_score = instance_count × mean_elapsed_ms × automatable_fraction`, where
`automatable_fraction` is a flat `0.7` (`analysis_automation.AUTOMATABLE_FRACTION`):
the per-segment analyst overrides this used to read from `roi_inputs` are
gone with the ROI layer. `rank` is the 1-based position among multi-instance
candidates (single-instance rows get `rank: null`); the order feeds the PDD's
automation-candidates focus list. `rank_score` is `0` for single-instance
patterns (no repeatability signal). `automation_confirmed` carries the
analyst's verdict, written to `analysis_overrides[]` keyed by
`segment_signature`. `estimated_savings_ms` is always `null` now: it needed an
analyst-supplied instances-per-day and a labour rate, which the cut EUR-ROI
layer (`analysis_roi.py`) used to supply (see the legacy-keys table above);
the business-case formula now lives in the owner's QB app
([ADR-0029](../docs/adr/0029-ba-helper-refocus.md) D3). The previous per-step
shape (`step_id`, `scores.repetitiveness`, `scores.rule_based`,
`sequence_signature`) was retired in `meta.heuristic_version: 2`.

**`stage_errors`** (contract C12, RP-10): always present, empty when every
analysis stage ran. Each entry is `{ "stage": "facts", "error": "KeyError:
'duration_ms'" }`. When a stage fails, its own output key is written `null`
(never `[]` or a zero-filled shape, which would read as a measured "nothing
found"), and one entry here names it:

```json
"stage_errors": [ { "stage": "facts", "error": "KeyError: 'duration_ms'" } ]
```

The stages that can fail independently: `step_analysis` (the classic
waste/time-study/segments/automation/efficiency block, all five keys go
`null` together on failure), `case_quality`, `motifs` (the repeated-sequence
input to `facts`), `facts`, and `findings`, which does not even attempt to
run when `step_analysis`, `motifs`, `facts`, or the segment/automation stages
failed, since its detectors read all of them and a partial run would silently
under-report. Every renderer (Overview, PDD) must show a failed stage as
"this check could not run on this recording," never as a measured negative
("nothing stood out", zeros).

## Invariants

- Events are immutable once written. Corrections live in `annotations.json` (§9.3 -- the viewer writes notes, marker edits, and step split/merge edits here).
- `event_id` is unique within a session.
- `events.jsonl` is sorted by `timestamp` in practice (single-writer append); normalization sorts defensively by `(timestamp, _seq)` so a millisecond timestamp collision still resolves to true append order (§7.1 step 2).
- Adjacent identical activity events (same app, title, label, case_ids) are collapsed during normalization (§7.1 step 7).

## Post-normalization artifacts

The normalization layer writes the following alongside `events.jsonl`:

| File | Contents |
|---|---|
| `events.xes` | IEEE 1849-2016 event log, one trace per top-level case |
| `events.csv` | Flat CSV of activity events |
| `stats.json` | `{ activity_stats, case_stats, trace_variants, step_variants, step_stats, app_outliers, rework_loops, screenshot_hashes, meta }` |
| `process_map.bpmn` | Activity-level BPMN 2.0 XML from PM4Py inductive miner (with `--mine`) |
| `process_map_step.bpmn` | Observed-flow Step BPMN mined from the annotations, needing no Process Template (with `--mine`; [ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md)). No phase-level counterpart: phases are cut ([ADR-0029](../docs/adr/0029-ba-helper-refocus.md)). |
| `process_maps/<case_id>.bpmn` | Per-case BPMN maps (with `--mine`) |
| `dfg.json` | Directly-Follows Graph as `{ edges, start_activities, end_activities }` (with `--mine`) |
| `analysis.json` | Heuristic IE/CI findings: `{ meta, waste_classification, time_study, segments, automation_candidates, efficiency, stage_errors, case_quality, facts, findings }` (when the session has steps, ADR-0008; `case_quality` / `facts` / `findings` write even for a step-less session) |
| `annotations.json` | Analyst-authored notes + marker edits |
| `transcript.json` | A parsed, aligned meeting transcript (contract C8), when one was imported. See "Transcript (transcript.json)" below. |
| `obs/sync.json` | `{ tracker_session_start_ts, obs_recording_start_ts, offset_ms, recording_path }` |
| `normalize.log` | Rolling log of warnings and info from normalization (see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)) |
| `capture.log` | Per-session log written by the capture app for high-signal events |

As of this doc revision, `events.xes`, `events.csv`, the activity-level
`process_map.bpmn`, `dfg.json`, and the per-case maps are still produced
exactly as described above. [ADR-0029](../docs/adr/0029-ba-helper-refocus.md)'s
plan schedules their removal for a later phase, alongside the equivalent
CLI flags; check `normalization/normalize.py`'s argument parser (contract
C11, [NORMALIZATION.md](../docs/architecture/NORMALIZATION.md)) for whether
that has landed by the time you read this.

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
| 3 | A requested export (`--pdd-out`) failed; the analysis outputs (stats, analysis, mining) were already written, the export was not. |

Every error (codes 1 to 3) is reported as one stderr line starting
`[normalize] ERROR:`; an unexpected crash also exits 1, with a Python
traceback. The viewer treats any non-zero exit as a failure and never opens
a stale export file. Full CLI flag reference: contract C11,
[NORMALIZATION.md](../docs/architecture/NORMALIZATION.md).

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

## Anchor-based case detection (legacy, cut by ADR-0029)

Before [ADR-0029](../docs/adr/0029-ba-helper-refocus.md), normalization
could detect cases from a named `case_anchor` field firing (a serial-search
box) instead of, or alongside, markers ([ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md)).
`case_assignment.py` no longer has this code path at all: `--canonical` is
gone (contract C11), so there is no canonical YAML to carry a `case_anchor`
block, and `case_anchor_override` is a legacy annotations key (contract
C10, see the table above). Case detection is markers only now. The
`normalization/canonical/` directory this fed (canonical YAML sets,
including the worked anchor example) is deleted, not merely unreferenced.

## Step states — the lifecycle

Each step's `state` field describes how the step got into `annotations.json`:

| State | Set by | Survives re-normalization? |
|---|---|---|
| `auto_suggested` | The drafting rule ([step_suggest.py](../normalization/step_suggest.py) `auto_suggest_steps`, contract C1). One drafted step per screen visit, ending at its commit action. | No: replaced by the next run's drafts. |
| `confirmed` | The analyst confirmed the step's run as the pattern run without changing this step (contract C3, "Confirm run"). | Yes: preserved exactly like `edited`. |
| `manually_authored` | The analyst added a step by hand. | Yes: `_merge_steps()` preserves it across runs. |
| `edited` | The analyst modified a drafted step (renamed, merged, split, or otherwise changed it). | Yes, same. |
| `hidden` | The analyst hid the step. | Yes: a re-analyze does not resurrect a hidden step as a fresh draft. |

`auto_matched` (the canonical step matcher, `--canonical`) is gone with
canonical/Process Template matching ([ADR-0029](../docs/adr/0029-ba-helper-refocus.md)
AD-8). The merge order in [`_merge_steps`](../normalization/step_suggest.py)
is: `manually_authored + edited + confirmed + hidden`, then the fresh
`auto_suggested` drafts that do not overlap one of those. This is why
corrections, confirmations, and hides survive re-normalization without
re-doing work. `drift_markers[]`, which used to flag a canonical-assignment
change under a preserved step, is a legacy key (contract C10): canonical
matching is gone, so nothing can drift against it anymore.

## Interaction enrichment — when each field is present

UIA fields (`automation_id`, `name`, `class_name`, etc.) come from the recorder. App Vocabulary enrichment fields (`meaningful_name`, `screen_id`, `vocab_flags`, `vocab_source`) only appear when a vocabulary in `normalization/app_vocabularies/` matches the interaction. See [ADR-0002](../docs/adr/0002-app-vocabularies.md) for why this layer exists.

When both UIA `name` and App Vocab `meaningful_name` are present, the viewer prefers `meaningful_name` for display but exposes both. Downstream consumers should fall back to `name` when `meaningful_name` is absent.

The **recognition layer** ([ADR-0011](../docs/adr/0011-platform-recognition-layer.md)) classifies an interaction by documented platform/framework signatures in [`shared/recognition-patterns.json`](recognition-patterns.json) — shared verbatim by `viewer/recognition.js` and `normalization/recognition.py` so both engines classify identically. Each signature carries a `category` / `typeLabel` / `framework`; the optional **`richTextIf`** field refines a match — when the element's `class_name` *also* contains that substring, the interaction is reclassified `category: "rich_text"` (typeLabel "rich-text field") instead of the signature's default, i.e. the same control family captured as its rich-text variant.

## `stats.json` sub-objects

| Top-level key | Shape | What it's for |
|---|---|---|
| `activity_stats` | `[{ activity_label, frequency, total_duration_ms, median_ms, p90_ms, ... }]` | Per-activity rollups across all cases in this session. |
| `case_stats` | `[{ case_id, parent_case_id, label, started_at, ended_at, active_ms, ... }]` | One row per case. `parent_case_id` is null for top-level cases. |
| `trace_variants` | `[{ variant: ["A", "B", "C"], frequency, length }]` | Distinct activity sequences ranked by occurrence. |
| `step_variants` | `[{ variant: ["Step A", "Step B"], frequency, length }]` | Distinct *step-name* sequences per case — the step-level analogue of `trace_variants`. Each element is the value-free `process_label`, so identical step-type sequences across cases collapse to one variant ([ADR-0013](../docs/adr/0013-value-free-grouping-and-map-readability.md)). Empty until the session has steps. |
| `step_stats` | `[{ step_name, frequency, total_duration_ms, mean_ms, median_ms, p90_ms, p99_ms }]` | Per-step duration distribution — the step-level analogue of `activity_stats`. Keyed on the value-free `process_label`, so a step seen across N cases is one row with `frequency = N` rather than N rows. Empty until the session has steps. |
| `app_outliers` | `[{ app, frequency, share }]` | Apps that appear in < 5% of cases. |
| `rework_loops` | `[{ activity_label, case_id, revisits }]` | Same activity revisited within a single case. |
| `screenshot_hashes` | `[{ filename, hash }]` | Per-screenshot 64-bit average hash (16 hex chars). The viewer's gallery uses it to collapse runs of near-identical frames. Empty when Pillow is unavailable in the bundled runtime. |
| `meta` | See below | Normalization run metadata. |

### `stats.json.meta` fields

| Field | Meaning |
|---|---|
| `normalization_run_at` | When the pipeline ran. Use to detect stale derivatives vs `events.jsonl` mtime. |
| `taxonomy_version` / `taxonomy_path` | Which classification taxonomy was applied. Re-running with a newer version is non-destructive. |
| `raw_event_count` | Total lines successfully parsed from `events.jsonl`. |
| `dropped_jsonl_lines` | Lines that failed `json.loads`. Zero is the expected value. Non-zero is investigable; see [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md). |
| `collapsed_activity_count` | Activity events remaining after §7.1 step 7 collapse. |
| `interaction_count` | How many interaction events the session has. |
| `case_count` | Top-level + nested cases combined. |
| `marker_edits_applied` | Edits from `annotations.json.marker_edits` that took effect this run. |
| `step_count` / `step_state_breakdown` | Total steps and counts per state: `auto_suggested`, `manually_authored`, `edited`, `confirmed`, `hidden`. The breakdown is the cheapest health-check for analyst engagement, and `confirmed` / `hidden` are new in this cycle (`auto_matched` is gone with canonical matching). |
| `draft_summary` | The step-drafting rule's own structure-only numbers (contract C1's probe instrument), counted on the fresh drafts before the merge with the analyst's steps: `{ runs, steps_per_run, out_of_run_steps, end_reason: {commit, screen_change, run_end}, name_source: {remembered, draft}, commit_identity: {automation_id, name, class_name, "?"} }`. This is what the [P1 draft-probe runbook](../docs/To-Do/P1-DRAFT-PROBE-RUNBOOK.md) reads to report draft quality. New in this cycle; `null` on a session with no runs. |
| `app_vocabularies` / `app_vocabulary_matches` / `app_vocabulary_hits_by_id` | Vocabularies loaded, interactions matched, per-vocab hit counts. |
| `vocab_coverage` | Per-app `{ total_interactions, enriched, coverage_pct }` — how much of each app's interaction stream a loaded App Vocabulary could name. The session summary panel surfaces it. |
| `app_names` | `{ executable as recorded: readable name }` for every application in the recording (`normalization/app_names.py`, deliverable-audit gap 3), the most specific readable name the recording itself supports: an app vocabulary's name, else a window-title segment naming the executable as a word, else the capitalized executable name. Never a fabricated product name. The findings claims, the findings fact strip, and the PDD read display names through this map instead of a raw executable token. New in this cycle. |

`canonical_process_id`, `canonical_version`, `drift_count`, `phase_count`,
`matched_interactions`, and `match_rate` are gone: canonical / Process
Template matching and phases are both cut
([ADR-0029](../docs/adr/0029-ba-helper-refocus.md)).

## When the schema changes

The schema is versioned implicitly: every additive change is non-breaking; renamings or removals would be breaking. `annotations.json` has an explicit `version` field (currently `1`) — bump it on breaking changes. Raw `events.jsonl` does not version itself; the `manifest.json` is the place to put a future capture-schema version when needed.
