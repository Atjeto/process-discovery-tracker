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

Available `kind` values: `session_start`, `session_end`, `paused`, `resumed`, `idle_start`, `idle_end`, `auto_end_idle`, `screenshot`, `screenshot_manual`, `obs_recording_start`, `obs_recording_stop`, `sync_marker`, `recorder_start`, `recorder_stop`, `recorder_died`, `recorder_dead_permanent`, `recorder_health`, `uncaptured_app`.

Kind-specific payloads:

| Kind | Payload |
|---|---|
| `idle_start` | `{ idle_seconds, at_desk }` — `at_desk` is `true` when the recorder forwarded an interaction within the last 30 s, i.e. the worker was active even though the OS idle timer (mouse/keyboard) crossed the threshold |
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

### Recorder snapshot messages (transient — ADR-0025)

The recorder's `snapshot` stdio command (in-app vocabulary discovery) streams two
message types that are **never persisted to `events.jsonl`** — they are consumed
live by the viewer's App Library "Discover from window" flow and discarded. They
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
  "phases": [],
  "annotations": [],
  "marker_edits": [],
  "marker_suggestions": [],
  "marker_suggestions_dismissed": [],
  "anchor_candidates": [],
  "anchor_candidates_dismissed": [],
  "case_anchor_override": null,
  "classification_overrides": [],
  "analysis_overrides": [],
  "roi_inputs": null,
  "excluded_ranges": [],
  "notes": [],
  "drift_markers": [],
  "starred_screenshots": [],
  "matched_against": null,
  "last_modified": null,
  "last_modified_by": null,
  "calibration": null
}
```

`notes` and `marker_edits` retain the v0 shapes below. The new top-level keys (`steps`, `phases`, `annotations`, `matched_against`, `drift_markers`, `classification_overrides`, `analysis_overrides`, `excluded_ranges`, `marker_suggestions`, `marker_suggestions_dismissed`, `anchor_candidates`, `anchor_candidates_dismissed`, `case_anchor_override`, `roi_inputs`, `calibration`, `version`, `session_id`, `last_modified`, `last_modified_by`, `starred_screenshots`) are additive; missing files are treated as empty.

**`calibration`** *(optional object; absent = pipeline defaults)* — the segmentation-tuning surface a Process Template or analyst can set per session to control how the auto-suggester splits steps (the over-segmentation / "308-step" knobs). Read by `normalize.py` (`_calibration`); missing keys fall back to the prior hardcoded defaults, so an absent or empty block reproduces the default pipeline output exactly. Recognised keys: `coalesce_idle_ms` (1500), `step_split_idle_ms` (10000), `step_max_interactions` (60), `step_min_interactions` (2), `step_max_idle_ms` (5000), `step_split_on_element` (true), `filter_browser_chrome` (true). Unknown keys are ignored. `starred_screenshots` is an array of screenshot paths (the `data.path` of `screenshot` / `screenshot_manual` events) the analyst flagged for inclusion in the HTML findings report.

The viewer keeps up to four rotating backups of this file — `annotations.json.2` (most recent) through `annotations.json.5` (oldest); each save shifts the previous versions down one slot. It is a safety net against a regretted bulk edit or a corrupt write; recovery is a manual file copy of a `.N` file back over `annotations.json`.

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

### ROI inputs (`roi_inputs`)

*(Optional object; absent = time-savings only, monetary `needs_input`.)* The
analyst-supplied commercial assumptions that turn the detected automation
candidates into a €-ROI band (consumed by `analysis_roi.compute_roi`, surfaced
in `analysis.json` `roi` and the PDD §4.4). Every field is optional and has a
sensible default, so an absent or empty block still yields the hours-saved band
with monetary figures left null and `needs_input: true` — the methodology is
explicit that a labour rate is **never fabricated**.

```json
{
  "roi_inputs": {
    "currency": "EUR",
    "loaded_cost_per_hour": 36.0,
    "realism_factors": { "conservative": 0.5, "expected": 0.7, "optimistic": 0.9 },
    "automatable_fraction": 0.7,
    "annual_volume": 1000,
    "automation_cost": 15000,
    "amortization_years": 3.0,
    "annual_volume_overrides":       { "<segment_signature>": 2000 },
    "automation_cost_overrides":     { "<segment_signature>": 20000 },
    "automatable_fraction_overrides":{ "<segment_signature>": 0.9 }
  }
}
```

- **`currency`** — display currency code (default `"EUR"`).
- **`loaded_cost_per_hour`** — fully-loaded operator cost per hour. **Absent →
  monetary figures are null and `needs_input: true`.** Cost per ms =
  `loaded_cost_per_hour / 3_600_000`.
- **`realism_factors`** — the three band multipliers (defaults `0.5 / 0.7 /
  0.9`); a partial override keeps the other bands at default.
- **`automatable_fraction`** — share of a segment's manual time a robot
  realistically removes (default `0.7`).
- **`annual_volume`** — how many times the process runs per year, applied to
  every candidate. **Absent → each candidate falls back to its observed
  `instance_count` as a conservative floor**, flagged `volume_basis:
  "observed"` (one session is not a year).
- **`automation_cost`** — one-off build cost; amortized over
  **`amortization_years`** (default `3.0`) for `net_annual` and `payback_months`.
- **`*_overrides`** — per-segment maps keyed by `segment_signature` that win
  over the flat defaults for that one candidate.

Unknown keys are ignored; a malformed value falls back to its default rather
than failing the run. `roi_inputs` is read on every `normalize` run; raw
`events.jsonl` and `analysis.json` are never edited by hand.

### PII masking (`pii_masking` — auto, Python-owned)

*(Auto-regenerated every `normalize` run; do not hand-edit.)* The record of which
structural-PII-masking rule-set ran (`normalization/pii_masking.py`, §11f). Masking
redacts sensitive UIA field **values** (password, SSN, card, CVV, PIN, secret/token,
IBAN, routing/account number) in the **derived** stream only — raw `events.jsonl` is
never rewritten. This block is the audit trail, not a control.

```json
{
  "pii_masking": {
    "ruleset_id": "default",
    "ruleset_version": 1,
    "enabled": true,
    "applied": true,
    "scanned_interactions": 118,
    "masked_value_count": 3,
    "rules_fired": { "password": 2, "ssn": 1 },
    "custom_rule_count": 0
  }
}
```

`ruleset_version` bumps when the default rules change (same contract as
`marker_suggest.heuristic_version`). `scanned_interactions` is how many
interaction events had a `data` dict to inspect; `masked_value_count` is how many
had a value redacted; `rules_fired` is the per-category count.

### PII masking config (`pii_masking_config` — optional, analyst-owned)

*(Optional object; absent = mask with the default rule-set.)* The analyst's control
over masking — distinct from the auto `pii_masking` report so single-writer
ownership stays clean (Python owns the report; the analyst owns the config).

```json
{
  "pii_masking_config": {
    "enabled": true,
    "custom_rules": [ { "id": "badge", "pattern": "\\bbadge\\b" } ]
  }
}
```

- **`enabled`** — set `false` to turn masking off entirely (the report then carries
  `enabled: false`, `applied: false`). Default `true` (privacy by default).
- **`custom_rules`** — extra `{ id, pattern }` rules appended to the defaults; the
  `pattern` is a case-insensitive regex matched against the field's tokenized
  name / automation_id / control_type. A malformed regex is skipped, not fatal.

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

### Marker suggestion (`marker_suggestions[]`)

Candidate case-boundary markers produced by the change-point detector in `normalization/marker_suggest.py` ([ADR-0017](../docs/adr/0017-suggested-markers.md)). When a long passive capture lacks Start/End markers, `assign_case_ids` collapses everything into one default case and downstream analysis is meaningless. The detector scans the **uncased** stretches of the event stream (events with no `case_ids` stamped on them), scores four signals (idle gap, return to a "home" app, transaction-ID-like value typed, app-cluster boundary), and emits paired Start/End suggestions for any boundary above the score threshold. The viewer renders them as dashed `.tl-marker.tl-suggested` bars on the Flow timeline and offers Accept / Dismiss in the markers side-panel.

Suggestions are **regenerated on every normalize run** — the analyst owns the dismiss-set and the accepted-edits (both of which DO survive), not the suggestions themselves. The same posture `step_suggest._merge_steps` takes with `auto_suggested` steps.

```json
{
  "marker_suggestions": [
    {
      "suggestion_id": "uuid",
      "signature": "12-hex-chars",
      "marker_type": "start" | "end",
      "timestamp": "<ISO>",
      "label": "string or null",
      "score": 0.5..1.0,
      "reason": "idle_gap" | "home_app_return" | "transaction_id_typed" | "app_cluster_boundary",
      "evidence": {
        "near_event_ids": ["<event_id>", "..."],
        "before_app": "outlook.exe",
        "after_app": "salesforce.exe",
        "idle_ms_before": 0
      },
      "created_at": "<ISO>",
      "heuristic_version": 1
    }
  ]
}
```

- **`signature`** — stable 12-char blake2b hex over `(marker_type, ts bucketed to 5 s, before_app, after_app, reason)`. This is the identity that survives re-normalize even if `score` drifts slightly; it's the key the dismiss-set and the Accept path (`derived_from_signature` on the resulting `marker_edits[]` op:insert) match on. Mirrors the `segment_signature` pattern from [ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md).
- **`marker_type`** — `start` or `end`. Suggestions are emitted in pairs (one Start, one End), but each pair entry is independent so the analyst can accept one and reject the other.
- **`label`** — proposed name. Non-null for `reason == "transaction_id_typed"` (carries the typed value, e.g. `"ABC-12345"`); null otherwise.
- **`score`** — combined `[0.0, 1.0]` heuristic score. The viewer maps `score >= 0.75` to a slightly higher-opacity tier — the only confidence signal a 2 px dashed line can carry.
- **`reason`** — which signal dominated. Used to render the chip in the markers side-panel (e.g. `[idle gap]`, `[txn id: ABC-12345]`).
- **`heuristic_version`** — bumps when the detector algorithm changes meaningfully. The contract for breaking recalibration: a suggestion under v2 may legitimately re-surface a boundary that was dismissed under v1.

The detector's **guards** drop any suggestion whose timestamp would fall inside an `excluded_range`, inside an existing case's `(start_ts, end_ts)` window, within 5 s of a real Start (captured or `marker_edits[]` `op:"insert"`), or whose proposed case would contain fewer than `min_case_interactions=5` interactions. Ends pair to their Start and clear the excluded/inside-case guards; the 5 s guard does *not* apply to Ends — an End landing right before a real Start is a clean case-to-case handoff.

### Marker-suggestion dismissal (`marker_suggestions_dismissed[]`)

Signatures the analyst has Dismissed. The detector's merge consults this set on every re-normalize and drops any fresh suggestion whose signature matches — so a dismissed boundary stays dismissed across an arbitrary number of re-normalizes. A separate block (rather than a `state: "dismissed"` row in `marker_suggestions[]`) keeps the live "things to render" array trivially clean — every entry the viewer reads is actionable. Matches the `analysis_overrides[]` precedent at [§Analysis override](#analysis-override-analysis_overrides) which records analyst verdicts keyed by a stable identity.

```json
{
  "marker_suggestions_dismissed": [
    {
      "signature": "12-hex-chars",
      "dismissed_at": "<ISO>",
      "marker_type": "start" | "end",
      "approximate_timestamp": "<ISO>"
    }
  ]
}
```

The `signature` alone is what the merge matches; `marker_type` and `approximate_timestamp` are kept for human inspection of the JSON (debug / audit) and are not consulted by the merge.

### Anchor candidate (`anchor_candidates[]`)

Candidate case anchors produced by `normalization/anchor_suggest.py` ([ADR-0018](../docs/adr/0018-anchor-candidates.md)). For a session captured without markers or a Process Template, the detector pattern-mines `value_changed` / `text_changed` events to find fields whose typing would naturally segment the work into cases (a "customer ID" search box, a serial-number entry, an order-number cell). Each candidate is rendered in the viewer as a "Looks like a case anchor — `<field>` typed N distinct values, splits into M cases. Use this anchor?" row; the analyst Accepts to write a `case_anchor_override` (below) or Dismisses to suppress the signature on future re-normalizes.

The detector **simulates** what `detect_cases_from_anchors` would produce if each candidate field were the anchor, then scores the resulting case structure on four signals (coverage, balance, label diversity, focus). The top 5 are kept.

```json
{
  "anchor_candidates": [
    {
      "candidate_id": "uuid",
      "signature": "12-hex-chars",
      "anchor_config": {
        "field": "automation_id",
        "equals": "customer-id-field",
        "case_label_from": "value"
      },
      "display": {
        "field_property": "automation_id",
        "field_value": "customer-id-field",
        "window_title_hint": "Salesforce - Account lookup",
        "sample_values": ["CUST-11255", "CUST-11256", "CUST-11257"]
      },
      "metrics": {
        "fire_count": 3,
        "distinct_labels": 3,
        "case_count": 3,
        "mean_case_interactions": 27.67,
        "case_size_cv": 0.034,
        "coverage": 0.988
      },
      "score": 0.935,
      "created_at": "<ISO>",
      "heuristic_version": 1
    }
  ]
}
```

- **`signature`** — 12-char blake2b over `(field_property, field_value, window_title)`. Stable across re-runs; what the dismiss-set and `case_anchor_override._accepted_signature` match on.
- **`anchor_config`** — the **exact** `case_anchor` block `case_assignment.detect_cases_from_anchors` expects. On Accept the viewer copies this verbatim into `case_anchor_override` and adds the audit fields.
- **`display`** — UI-only fields the detector pre-computes so the viewer doesn't re-derive them. `window_title_hint` is the most common window-title across the fires (an "Order entry" / "Customer view" hint to disambiguate two fields with the same `name`).
- **`metrics`** — the four scoring inputs: `coverage` is the fraction of interactions caught by the simulated cases; `case_size_cv` is the coefficient of variation of case interaction counts (lower = more balanced); `distinct_labels` should match `case_count` for a good anchor (one unique label per case).
- **`score`** — `0..1` weighted blend of `coverage`, `1 - case_size_cv`, `distinct_labels / fire_count`, and `1 / log2(case_count + 1)`. Sorted descending; the viewer renders strongest-first.

Like `marker_suggestions[]`, `anchor_candidates[]` is regenerated wholesale every normalize. The analyst owns the dismiss-list and the override.

### Anchor-candidate dismissal (`anchor_candidates_dismissed[]`)

Signatures the analyst has Dismissed. Consulted by `anchor_suggest.merge_anchor_candidates` on every re-normalize; a dismissed candidate stays dismissed.

```json
{
  "anchor_candidates_dismissed": [
    { "signature": "12-hex-chars", "dismissed_at": "<ISO>" }
  ]
}
```

### Case-anchor override (`case_anchor_override`)

The session-level anchor the analyst Accepted. When set AND no Process Template `case_anchor` is in play (the template wins when both exist), `normalize.py` feeds this directly to `detect_cases_from_anchors` and `stamp_anchor_cases`, so the session gets case-stamped without needing a template.

```json
{
  "case_anchor_override": {
    "field": "automation_id",
    "equals": "customer-id-field",
    "case_label_from": "value",
    "_accepted_signature": "12-hex-chars",
    "_accepted_at": "<ISO>"
  }
}
```

The non-`_`-prefixed keys are the standard `case_anchor` shape (see `normalization/canonical/sample-anchor-based.yaml` for the full vocab — `field` + one of `equals`/`contains`/`starts_with`/`matches`, OR a `recognized` category). The `_accepted_*` audit fields are stripped by `anchor_suggest.coerce_anchor_override` before the config reaches `detect_cases_from_anchors`. `_accepted_signature` ties the override back to the candidate it came from so `merge_anchor_candidates` can drop the now-accepted candidate from the live list.

`null` (the default) means "no override set" — the pipeline falls back to marker mode.

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
  "grain_keys": {
    "element": "string -- the field/control the step acted on (automation_id|name)",
    "screen":  "string -- vocab screen_id, else window_title (the form/page). At view time the screen grain value-frees this (shared/screen-label-patterns.json -> screenType / screen_label) so one logical screen is one node across cases (ADR-0024 §6a/§6b)",
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
  "state": "auto_suggested|auto_matched|manually_authored|edited",
  "suggestion_reason": "string -- auto_suggested steps only",
  "canonical_step_id": "uuid or null",
  "flags": {
    "waste": false
  },
  "phase_id": "uuid or null"
}
```

`flags.waste` is the **only** per-step flag ([ADR-0027](../docs/adr/0027-retire-per-step-path-flags.md)).
The former `conditional` / `exception_path` / `automation_candidate` / `condition_text`
flags were retired: a single step is not a path or a segment, so exceptions/variations are
derived from the observed trace variants, automation candidacy from coherent segments
([ADR-0016](../docs/adr/0016-segment-level-automation-candidacy.md)), and conditionality
from the map's branch frequency. Older `annotations.json` may still carry the legacy keys;
they are ignored.

`grain_keys` are the **UI-containment keys** the view-time grain roll-up groups
on ([ADR-0024](../docs/adr/0024-step-grain-as-view-time-rollup.md)): a node/step
at a chosen notch is a run of consecutive steps within a case that share the
notch's key. The ladder is `element ⊂ screen ⊂ app ⊂ phase ⊂ case`; the
`phase`/`case` notches read the step's existing `phase_id` / `case_id`, so only
`element` / `screen` / `app` are stamped here. Recomputed every analyze (like
`process_label`) so they track the current evidence; a step with no interactions
(a hand-authored step) carries `(element)` / `(screen)` / `(app)` placeholders,
which the viewer's view-time resolver refines from the step's evidence. Raw
`events.jsonl` is untouched — segmentation stays at the finest grain and the
roll-up is a *view*, never a re-normalization. Absent on sessions analyzed before
this field existed; the viewer resolves them at view time.

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
  "engagement_name": "project name from setup (optional; null until set)",
  "started_at": "ISO 8601",
  "ended_at": "ISO 8601 or null",
  "status": "active" | "closed" | "recovered",
  "label": "analyst-given session name (optional; absent until set)",
  "purpose": "process" | "app_prep",
  "prep_app": "app name being curated (app_prep sessions only; null otherwise)",
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

`purpose` is `"process"` for an ordinary business-process capture (the default) or
`"app_prep"` for an App-Vocabulary curation session; `prep_app` names the app being
curated on an `app_prep` session (`null` otherwise). App-prep sessions are filed
under `engagement_id: "vocab-prep"` so they don't pollute a real engagement's
captures — see [CAPTURE.md](../docs/architecture/CAPTURE.md).

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
  "roi": {
    "currency": "EUR",
    "needs_input": false,
    "inputs_used": { "loaded_cost_per_hour": 36.0, "realism_factors": {...},
                     "automatable_fraction": 0.7, "annual_volume": 1000,
                     "automation_cost": null, "amortization_years": 3.0 },
    "candidates": [
      { "segment_signature": "12-hex-chars", "label": "string",
        "instance_count": 4, "mean_elapsed_ms": 33500,
        "automatable_fraction": 0.7, "annual_volume": 1000,
        "volume_basis": "annotated | default | observed",
        "automation_cost": null, "amortization_years": 3.0,
        "bands": {
          "conservative": { "realism_factor": 0.5, "saved_ms_per_instance": 0,
            "saved_hours_per_year": 0.0, "gross_annual": 0.0,
            "net_annual": 0.0, "payback_months": null },
          "expected":     { "...": "..." },
          "optimistic":   { "...": "..." }
        },
        "expected_saved_hours_per_year": 0.0,
        "expected_net_annual": 0.0,
        "expected_payback_months": null,
        "needs_input": false }
    ],
    "totals": { "saved_hours_per_year": 0.0, "net_annual": 0.0, "gross_annual": 0.0 }
  }
}
```

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
`rank_score = instance_count × mean_elapsed_ms × automatable_fraction`
(the same `automatable_fraction` the €-ROI layer resolves from `roi_inputs`,
per-segment override aware). `rank` is the 1-based position among
multi-instance candidates (single-instance rows get `rank: null`); the order
feeds both the `roi` band and the PDD §4.3 focus list. `rank_score` is `0`
for single-instance patterns (no repeatability signal). `automation_confirmed` carries the analyst's verdict, written
to `analysis_overrides[]` keyed by `segment_signature`. The previous per-step
shape (`step_id`, `scores.repetitiveness`, `scores.rule_based`,
`sequence_signature`) was retired in `meta.heuristic_version: 2`.

`roi` is the **€-ROI band** over the automation candidates
(`analysis_roi.compute_roi`). Per **multi-instance** candidate it projects the
observed `mean_elapsed_ms` to an annual saving: `T_saved = mean_elapsed_ms ×
automatable_fraction × realism`, `gross_annual = annual_volume × T_saved ×
(loaded_cost_per_hour / 3_600_000)`, `net_annual = gross_annual −
automation_cost / amortization_years`, `payback_months = automation_cost /
(net_annual / 12)` (null when `net_annual ≤ 0` or no automation cost). The
estimate is a **conservative / expected / optimistic** band driven by three
realism factors. The **hours-saved** band is always emitted; **monetary** fields
are null with `needs_input: true` when no `loaded_cost_per_hour` is supplied — a
labour rate is never fabricated. When no annual volume is given, `annual_volume`
falls back to the observed `instance_count` as a conservative floor with
`volume_basis: "observed"`. Single-instance candidates are skipped (no
repeatability). `roi` reads the optional `roi_inputs` annotations block (below)
and is regenerated on every `normalize` run; it also backfills each candidate's
`estimated_savings_ms` (long null) from the expected band, but only when a real
annual volume basis exists (not the observed floor).

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
| `process_map_step.bpmn` / `process_map_phase.bpmn` | Observed-flow Step/Phase BPMN mined from the annotations — no Process Template needed (with `--mine`; [ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md)) |
| `process_maps/<case_id>.bpmn` | Per-case BPMN maps (with `--mine`) |
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

## Anchor-based case detection ([ADR-0012](../docs/adr/0012-active-case-stamping-and-map-matrix.md))

When the canonical set names a `case_anchor` field (e.g. the serial-search box), normalization can detect cases from **anchor fires** instead of (or alongside) markers. The anchor field is matched either by a **recognised** platform category (`recognized`, [ADR-0011](../docs/adr/0011-platform-recognition-layer.md) — portable across engagements) or by an explicit `automation_id` / value rule (the per-engagement fallback; ADR-0012 #7). A case is named by its anchor value and is **stable per label** — `case_id = uuid5(label)`, so re-searching the same serial *resumes* that case rather than opening a new one. The most-recently-fired anchor is the **active case**, stamped onto every following interaction; because work interleaves (search A → … → search B → … → search A again), each case owns a list of *disjoint active segments* rather than one contiguous range. A degenerate-case guard drops slivers (below `min_case_interactions` / `min_case_duration_ms`) and an empty-label guard ignores a focus on an empty anchor box. This supersedes the older gap-based open/close-on-pause splitting: a pause is just a pause; the case resumes on the next anchor.

### `case_anchor` block — schema

The `case_anchor` block lives under `canonical_process` in the canonical YAML.

```yaml
canonical_process:
  id: "..."
  case_anchor:
    # === at least ONE of these matchers ===
    recognized: "search"            # ADR-0011 platform category (str or list); the portable matcher
    field: "automation_id"          # name of a property on the interaction's data
    equals: "txtSerialNumber"       # operator (one of equals / contains / starts_with / matches)

    # === optional refinements ===
    case_label_from: "value"        # which property on the anchor event names the case (default "value")
    min_case_interactions: 2        # discard cases below this (default 2)
    min_case_duration_ms: 1000      # discard cases shorter than this (default 1000)
```

| Field | Type | Meaning |
|---|---|---|
| `recognized` | string \| list[string] | Match by ADR-0011 category. The **portable** anchor: keys on a documented platform/framework signature (e.g. `search`, `grid_cell`), so the same template recognises the case-key field across engagements. |
| `field` | **string** (the property NAME) | Match by an explicit data property — for bespoke fields with no recognised category. **NOT a dict** — `field: "automation_id"`, then `equals: "txtSerialNumber"` (the operator is a sibling key, not a sub-key). |
| `equals` / `contains` / `starts_with` / `matches` | string | Operator applied to the value of `field`. Pick one. `matches` is a regex. |
| `case_label_from` | string | Which event-data property names the case (default `value`). A typed serial becomes the case label. |
| `min_case_interactions` | int | Drop cases with fewer interactions than this (degenerate guard). |
| `min_case_duration_ms` | int | Drop cases shorter than this in ms (degenerate guard). |

When both `recognized` and the explicit `field` rule are present they are **AND-ed** ("a recognised text/search field *whose name matches* /serial/i"), which generalises a bespoke field without naming its automation_id.

A common mistake is to write `field` as a dict, like a match spec:

```yaml
# WRONG -- field is the property NAME, not a match spec
case_anchor:
  field:
    process_name: "chrome.exe"
    name: "Customer name:"
```

The pipeline now warns on this (`case_anchor.field must be a string ... -- treating as no-match`) and continues with zero anchor cases rather than crashing. The correct shape is:

```yaml
# RIGHT -- field is the name, operator is a sibling key
case_anchor:
  field: "name"
  equals: "Customer name:"
```

A worked example is in [`normalization/canonical/sample-anchor-based.yaml`](../normalization/canonical/sample-anchor-based.yaml).

## Step states — the lifecycle

Each step's `state` field describes how the step got into `annotations.json`:

| State | Set by | Survives re-normalization? |
|---|---|---|
| `auto_suggested` | The rule-based step suggester ([step_suggest.py](../normalization/step_suggest.py)). Best-guess grouping of adjacent interactions. | No — replaced by the next run's suggestions. |
| `auto_matched` | The canonical step matcher ([canonical_match.py](../normalization/canonical_match.py)) when a canonical step set is provided via `--canonical`. | No — replaced when re-matched. |
| `manually_authored` | The analyst clicked "New step" in the viewer's step editor. | Yes — `_merge_steps()` preserves it across runs. |
| `edited` | The analyst modified an `auto_suggested` or `auto_matched` step. | Yes — same. |

The merge order in [`_merge_steps`](../normalization/step_suggest.py) is: `manually_authored + edited + fresh_auto_*`. This is why corrections survive re-normalization without re-doing work.

`drift_markers[]` record when a previously `edited`/`manually_authored` step's `canonical_step_id` would now resolve differently against the current canonical version — a signal that the canonical set has shifted under the analyst's prior assignment. Recorded automatically; reviewed manually.

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
| `interaction_count` / `matched_interactions` / `match_rate` | How many interactions did we have, how many did the canonical matcher claim, what's the ratio. |
| `case_count` | Top-level + nested cases combined. |
| `marker_edits_applied` | Edits from `annotations.json.marker_edits` that took effect this run. |
| `step_count` / `step_state_breakdown` | Total steps and counts per state (`auto_suggested`, `auto_matched`, `manually_authored`, `edited`). The breakdown is the cheapest health-check for analyst engagement. |
| `canonical_process_id` / `canonical_version` | Pinned canonical set, if `--canonical` was used. |
| `drift_count` / `phase_count` | Total drift markers and phases in `annotations.json` after this run. |
| `app_vocabularies` / `app_vocabulary_matches` / `app_vocabulary_hits_by_id` | Vocabularies loaded, interactions matched, per-vocab hit counts. |
| `vocab_coverage` | Per-app `{ total_interactions, enriched, coverage_pct }` — how much of each app's interaction stream a loaded App Vocabulary could name. The session summary panel surfaces it. |

## When the schema changes

The schema is versioned implicitly: every additive change is non-breaking; renamings or removals would be breaking. `annotations.json` has an explicit `version` field (currently `1`) — bump it on breaking changes. Raw `events.jsonl` does not version itself; the `manifest.json` is the place to put a future capture-schema version when needed.
