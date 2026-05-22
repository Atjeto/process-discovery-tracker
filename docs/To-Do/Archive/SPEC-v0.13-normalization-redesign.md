# v0.13.0 — Normalization Redesign Spec

**Version:** 0.13.0
**Scope:** normalization pipeline only — no capture or viewer changes.
**Goal:** the real recording (1h33m, ~2,363 events, ATM ticket-handling) produces
~5–7 steps per ticket, detected cases per ticket, and a real process map.

---

## Overview — three changes, in order

| # | Change | File(s) | Risk |
|---|--------|---------|------|
| 1 | Fix keystroke coalescing for AG Grid | `step_suggest.py` | Low — reduces event noise; no schema change |
| 2 | Extend canonical matching with new matchers and span boundaries | `canonical_match.py` | Med — new matching logic; existing tests must still pass |
| 3 | Add interaction-anchor case detection | `case_assignment.py`, `normalize.py` | Med — new case source alongside markers |

Plus one config-only change (taxonomy) with zero code.

---

## 0. Taxonomy configuration (zero code — do first)

Add rules to `normalization/sample-taxonomy.yaml` (or the user's taxonomy file)
for the six applications in this engagement. The taxonomy drives activity
classification and the process map node labels.

```yaml
# --- ATM Field Service engagement ---
- label: "TAMBA"
  match:
    title_contains: "TAMBA"

- label: "SNFI"
  match:
    title_contains: "SNFI"

- label: "ES Call Management"
  match:
    title_contains: "ES CALL MANAGEMENT"

- label: "SharePoint — Contract Lookup"
  match:
    title_contains: "ncratleos.sharepoint.com"

- label: "Excel — Account View"
  match:
    process: "EXCEL.EXE"

- label: "File Explorer"
  match:
    process: "explorer.exe"
```

**Verify:** run normalization with `--mine` on the real session. The process map
should show 4–6 named nodes instead of 2 "Unclassified" nodes.

---

## 1. Fix keystroke coalescing for AG Grid

### Problem

The recorder emits one `value_changed` event per keystroke when the user types
into an AG Grid cell editor. The v0.12.1 fix coalesces consecutive keystrokes
in the recorder sidecar, but AG Grid's cell editors fire `value_changed` events
that bypass the existing coalescing logic. Result: typing "auto-generated"
produces 26 events (seq 574–599 in the sample).

### Where

`normalization/step_suggest.py` — the step-suggestion stage already walks the
interaction stream. Add a pre-pass that coalesces before grouping.

### Spec

Add a function `coalesce_typing_bursts(interactions)` called at the top of the
step-suggestion stage (before any grouping logic runs). It returns a new list
with typing bursts collapsed.

**Algorithm:**

```
Input:  list of interaction events, sorted by timestamp
Output: list with consecutive typing bursts collapsed to one event each

For each event:
  If event.data.kind == "value_changed":
    key = (event.data.window_title,
           event.data.automation_id,
           event.data.class_name,
           event.data.control_type)
    If previous event had the same key
       AND (this timestamp - previous timestamp) < COALESCE_WINDOW_MS:
      Drop the previous event; keep this one (it has the later, more complete value).
    Else:
      Start a new burst.
  Else:
    Emit any pending burst event, then emit this event.

After loop: emit any pending burst event.
```

**Constants:**

```python
COALESCE_WINDOW_MS = 2000  # 2 seconds between keystrokes = same burst
```

**Key behaviour:**

- The *last* event in a burst is kept (it has the final typed value).
- Non-`value_changed` events break a burst and are emitted as-is.
- The coalesced event keeps its original `event_id` and `timestamp` (the last
  keystroke's timestamp).
- A `_coalesced_count` field is added to the kept event's data for diagnostics
  (how many raw events this one replaced). This field is informational only —
  no downstream code reads it.

**Expected impact on the sample data:**

- Seq 574–599 (typing "auto-generated"): 26 events → 1 event with
  `value: "auto-generated"`, `_coalesced_count: 26`.
- Seq 651–687 (typing "CE reseated depository cash bin..."): 37 events → 1
  event with the final value, `_coalesced_count: 37`.
- Overall: ~2,363 events → est. ~800–1,000 after coalescing.

**Test:** unit test with a synthetic burst of 10 `value_changed` events on the
same key within 2s, followed by a `selection_changed` event. Assert output is
2 events (the last `value_changed` and the `selection_changed`).

---

## 2. Extend canonical matching

### Problem

`canonical_match.py` currently matches individual interactions one-to-one against
canonical step definitions. The match rules support `equals` on interaction
fields. This is insufficient for:

- Matching on partial values (`value` starts with `"**Resolution**"`).
- Matching on the `class_name` field (AG Grid's `ag-cell-edit-input`).
- Grouping a *span* of consecutive interactions into one step (e.g. a typing
  burst in a grid cell is one "Classify ticket" step, not 1 event = 1 step).

### Where

`normalization/canonical_match.py` — extend the match-rule evaluation and add
span-based step construction.

### 2a. New match operators

The existing match rule format (from the Process Template YAML) currently
supports field-level `equals`. Add three new operators:

| Operator | Meaning | Example |
|----------|---------|---------|
| `contains` | `field_value in interaction.data[field]` (substring) | `value contains "**Resolution**"` |
| `starts_with` | `interaction.data[field].startswith(value)` | `value starts_with "**Resolution**"` |
| `matches` | `re.search(pattern, interaction.data[field])` | `value matches "[A-Z]{2}\\d{6}"` |

All string comparisons are case-sensitive. A `None` / missing field never matches.

**YAML syntax in the Process Template:**

```yaml
steps:
  - name: "Write resolution"
    match_rules:
      - field: "value"
        starts_with: "**Resolution**"
```

A rule with multiple entries in `match_rules` is an AND — all must match the
same interaction. Multiple rules under the same step are OR — any matching rule
triggers the step.

**Implementation:** in the function that evaluates a single match rule against
an interaction, add branches:

```python
def rule_matches(rule, interaction_data):
    field = rule["field"]
    val = interaction_data.get(field)
    if val is None:
        return False
    val = str(val)

    if "equals" in rule:
        return val == rule["equals"]
    if "contains" in rule:
        return rule["contains"] in val
    if "starts_with" in rule:
        return val.startswith(rule["starts_with"])
    if "matches" in rule:
        return bool(re.search(rule["matches"], val))
    return False
```

### 2b. Span-based step boundaries

Currently, canonical matching produces one step per matched interaction. For
multi-app interleaved work, a step may span many interactions (e.g. "Look up
serial number" spans: tab to SNFI → enter serial → click Search → tab back).

Add a `boundary` field to each step definition in the Process Template. It
controls how the matcher decides where the step ends once the trigger
interaction is found.

| Boundary mode | Meaning |
|---------------|---------|
| `single` (default) | The step contains only the triggering interaction. |
| `until_app_change` | The step spans from the trigger through all subsequent interactions in the same `window_title` prefix, ending when a different app's interaction appears. |
| `until_pause` | The step spans from the trigger until a gap of `pause_ms` (default 5000) between consecutive interactions. |
| `until_field_change` | The step spans from the trigger through consecutive interactions with the same `(window_title, class_name, automation_id)` tuple — i.e., the same field. Typing bursts. |
| `absorb_interleave` | The step spans from the trigger through all interactions until a different *canonical step trigger* fires, even if the user switches apps in between. This handles the SNFI-TAMBA-SNFI interleave pattern. |

**YAML syntax:**

```yaml
steps:
  - name: "Look up serial number"
    match_rules:
      - field: "automation_id"
        equals: "txtsr"
    boundary: "absorb_interleave"

  - name: "Classify ticket"
    match_rules:
      - field: "class_name"
        equals: "ag-cell-edit-input"
    boundary: "until_field_change"
```

**Implementation — the span matcher:**

The canonical matcher currently walks interactions and tries to match each one.
Replace the walk with a two-pass approach:

**Pass 1 — tag triggers.** Walk interactions in order. For each, check all step
definitions. If a rule matches, tag the interaction with the step name. An
interaction can only trigger one step (first match wins, in template definition
order — the template author controls priority by ordering steps).

**Pass 2 — expand spans.** Walk the tagged interactions. When a trigger is found:

- Look at its `boundary` mode.
- Absorb subsequent interactions according to the boundary rule.
- All absorbed interactions (including the trigger) become the step's
  `interaction_ids`.
- The step's `start_time` = trigger's timestamp. `end_time` = last absorbed
  interaction's timestamp.
- Continue the walk from the first interaction *after* the span.

Interactions that are absorbed into a span are consumed — they cannot trigger
or be absorbed into another step.

**Unmatched interactions:** interactions that don't trigger any step and aren't
absorbed into a span get no step. They remain in the event stream but produce
no step in `annotations.json`. The match rate reports what fraction of
interactions were assigned to a step.

**Constants:**

```python
DEFAULT_PAUSE_MS = 5000  # for until_pause boundary
```

### 2c. Multi-field match rules

Allow a single match rule entry to specify multiple field conditions (AND):

```yaml
match_rules:
  - field: "class_name"
    equals: "ag-cell-edit-input"
    window_title_contains: "TAMBA"
```

**Implementation:** if a rule dict has more than one field-matching key, all
must match. Add a helper:

```python
def rule_matches(rule, interaction_data):
    checks = []
    for key, value in rule.items():
        if key == "field":
            continue  # just the target field name
        if key == "boundary":
            continue  # step-level, not rule-level
        # For simple field rules
        if key in ("equals", "contains", "starts_with", "matches"):
            field_val = str(interaction_data.get(rule["field"], ""))
            if key == "equals":
                checks.append(field_val == value)
            elif key == "contains":
                checks.append(value in field_val)
            elif key == "starts_with":
                checks.append(field_val.startswith(value))
            elif key == "matches":
                checks.append(bool(re.search(value, field_val)))
        # For cross-field conditions (e.g. window_title_contains)
        elif key.endswith("_contains"):
            cross_field = key.replace("_contains", "")
            cross_val = str(interaction_data.get(cross_field, ""))
            checks.append(value in cross_val)
        elif key.endswith("_equals"):
            cross_field = key.replace("_equals", "")
            cross_val = str(interaction_data.get(cross_field, ""))
            checks.append(cross_val == value)
    return all(checks) if checks else False
```

---

## 3. Interaction-anchor case detection

### Problem

Cases are currently derived only from manual Start/End markers. The worker fired
one marker for the whole session → one case → no per-ticket breakdown.

### Where

`normalization/case_assignment.py` and `normalize.py` (orchestration).

### Spec

Add a new case-detection mode activated by a `case_anchor` section in the
Process Template YAML:

```yaml
case_anchor:
  field: "automation_id"
  equals: "txtsr"                  # SNFI serial-number field
  case_id_from: "value"            # the serial number IS the case ID
  min_gap_ms: 10000                # ignore re-lookups of the same serial within 10s
  close_on_pause_ms: 300000        # close a case after 5 min of no interaction
```

**Algorithm (new function `detect_cases_from_anchors`):**

```
Input:  list of interaction events (sorted by timestamp), case_anchor config
Output: list of synthetic marker pairs (Start + End) to inject

seen_cases = {}          # case_id → { start_ts, last_ts }
closed_cases = []        # completed (case_id, start_ts, end_ts)

For each interaction event:
  If the event matches the anchor rule (field + operator):
    case_id = event.data[case_id_from]
    If case_id in seen_cases AND (event.ts - seen_cases[case_id].last_ts) < min_gap_ms:
      # Re-lookup of the same serial within 10s — update last_ts, don't start new case
      seen_cases[case_id].last_ts = event.ts
    Else:
      # New case (or same serial after a long gap = revisit)
      # Close any currently open case
      for open_id, open_case in seen_cases.items():
        closed_cases.append((open_id, open_case.start_ts, open_case.last_ts))
      seen_cases.clear()
      seen_cases[case_id] = { start_ts: event.ts, last_ts: event.ts }
  Else:
    # Non-anchor event — update last_ts of any open case
    for open_id in seen_cases:
      seen_cases[open_id].last_ts = event.ts

# Close any still-open case at end
for open_id, open_case in seen_cases.items():
  closed_cases.append((open_id, open_case.start_ts, open_case.last_ts))

# Apply close_on_pause_ms: walk closed_cases and split any case that has
# an internal gap > close_on_pause_ms (the 5-min idle in the sample)

Return closed_cases as synthetic marker_edits (insert Start at start_ts,
insert End at end_ts, label = case_id)
```

**Integration with the pipeline:**

In `normalize.py`, after stage 2 (apply marker edits) and before stage 3 (case
assignment):

1. If a `--canonical` file is provided and it contains a `case_anchor` section:
2. Run `detect_cases_from_anchors(interactions, case_anchor_config)`.
3. Convert the result to `marker_edits` (insert operations) and prepend them to
   the marker-edit list.
4. Stage 3 (case assignment) then processes all markers — both the worker's
   original markers and the synthetic anchor-derived ones — through the existing
   case-tree builder.

**This means:** anchor-detected cases and manual markers coexist. If the worker
fires markers AND the template has a case anchor, both contribute cases. The
case-tree builder handles nesting — anchor cases nest inside manual markers if
the timestamps overlap.

**The synthetic markers** use `marker_type: "start"` / `"end"` with
`reason: "case_anchor"` so they're distinguishable from worker-fired markers in
the viewer.

---

## 4. Process Template for the ATM ticket-handling engagement

This is the YAML file the analyst loads via `--canonical`. It defines the steps,
phases, and case anchor for this specific process.

```yaml
# atm-ticket-handling.yaml — Process Template
# For: ATM field-service engineer handling TAMBA tickets

name: "ATM Ticket Handling"
version: 1

case_anchor:
  field: "automation_id"
  equals: "txtsr"
  case_id_from: "value"
  min_gap_ms: 10000
  close_on_pause_ms: 300000

phases:
  - name: "Investigation"
    step_names:
      - "Look up serial number"
      - "Check call management"
      - "Check contract coverage"

  - name: "Resolution"
    step_names:
      - "Write resolution"
      - "Classify ticket"
      - "Update status fields"

steps:
  - name: "Look up serial number"
    description: "Search the serial number in SNFI and cross-reference in TAMBA"
    match_rules:
      - field: "automation_id"
        equals: "txtsr"
    boundary: "absorb_interleave"

  - name: "Check call management"
    description: "Load the task in ES Call Management and review notes"
    match_rules:
      - field: "name"
        contains: "Load Task#"
    boundary: "until_app_change"

  - name: "Check contract coverage"
    description: "Look up coverage in SharePoint or Excel"
    match_rules:
      - field: "window_title"
        contains: "sharepoint.com"
    boundary: "until_app_change"

  - name: "Write resolution"
    description: "Edit the resolution text field in TAMBA"
    match_rules:
      - field: "value"
        starts_with: "**Resolution**"
    boundary: "single"

  - name: "Classify ticket"
    description: "Type classification code in the TAMBA grid cell"
    match_rules:
      - field: "class_name"
        equals: "ag-cell-edit-input"
        window_title_contains: "TAMBA"
    boundary: "until_field_change"

  - name: "Update status fields"
    description: "Fill in status fields (FLM, related tickets, etc.)"
    match_rules:
      - field: "value"
        equals: "No FLM"
      - field: "value"
        equals: "No related tickets in 14 days"
      - field: "value"
        equals: "auto-generated"
    boundary: "single"
```

---

## 5. Changes to `step_suggest.py` heuristics (fallback mode)

When no `--canonical` template is provided, `step_suggest.py` runs as the
fallback. Apply the two changes from the problem review:

### 5a. Remove the window-change trigger

In the function that decides whether to start a new step, remove the condition
that fires on application/window change. A step may now span multiple
applications.

**Before (pseudocode):**
```python
if app_changed or gap > GAP_THRESHOLD or process_changed or count >= MAX_EVENTS:
    start_new_step()
```

**After:**
```python
if gap > GAP_THRESHOLD_MS or process_changed:
    start_new_step()
```

### 5b. Remove the 12-event cap

Delete the `count >= MAX_EVENTS` condition. A step can contain any number of
events. The coalescing from Change 1 already reduces the per-step event count
substantially.

### 5c. Increase the gap threshold

Change the pause threshold from 3 seconds to 10 seconds.

```python
GAP_THRESHOLD_MS = 10000  # was 3000
```

### 5d. Add completion-action boundaries

Start a new step after an `invoked` event on a Button or Hyperlink whose `name`
contains a completion-like word:

```python
COMPLETION_NAMES = {"search", "submit", "save", "apply", "ok", "close",
                    "confirm", "send", "next", "finish", "done"}

def is_completion_action(event):
    if event["data"].get("kind") != "invoked":
        return False
    name = (event["data"].get("name") or "").lower()
    return any(word in name for word in COMPLETION_NAMES)
```

When `is_completion_action(event)` is true, include the event in the current
step and then start a new step.

---

## 6. Pipeline orchestration changes in `normalize.py`

### Stage ordering

The pipeline stages become:

```
1.  Load & validate
2.  Apply marker edits
2a. Detect cases from anchors (NEW — if --canonical has case_anchor)
3.  Case assignment (existing — now processes anchor markers too)
4.  Collapse
5.  Interaction enrichment
5a. Coalesce typing bursts (NEW — Change 1)
6.  Step suggestion (existing, with 5a–5d changes — runs only if no --canonical)
7.  Canonical matching (existing, with 2a–2c changes — runs with --canonical)
8.  Step merge
9.  Drift detection
10. Statistics
11. Export
12. Analysis layer
13. Mining
```

### CLI

No new flags. The `--canonical` flag already exists. The `case_anchor` section
in the canonical YAML activates anchor-based case detection automatically.

### Logging

Each new stage logs at INFO:

- Coalescing: `"Coalesced N typing bursts (M events → K events)"`
- Anchor case detection: `"Detected N cases from anchor field 'automation_id:txtsr'"`
- Span matching: `"Canonical matching: N steps across M cases (match rate: X%)"`

---

## 7. Backward compatibility

- **No `--canonical` provided:** pipeline runs as before, except for the
  coalescing pre-pass (Change 1) and the `step_suggest.py` heuristic changes
  (Change 5). These are improvements to the existing fallback path.
- **`--canonical` without `case_anchor`:** canonical matching runs with the new
  operators and span boundaries. Case detection still relies on manual markers.
- **`--canonical` with `case_anchor`:** full new behaviour — anchor case detection
  + span-based canonical matching.
- **Existing Process Templates** that use only `equals` match rules and no
  `boundary` field: work unchanged. `boundary` defaults to `single`. New
  operators are additive.

---

## 8. Test plan

| Test | Input | Expected |
|------|-------|----------|
| Typing coalesce — basic | 10 `value_changed` events, same key, 100ms apart | 1 event with last value |
| Typing coalesce — burst break | 5 events, 100ms gap; then 3s gap; then 5 events | 2 events |
| Typing coalesce — interleaved kinds | `value_changed`, `invoked`, `value_changed` | 3 events (no coalescing across kinds) |
| Match operator — `contains` | Rule `value contains "Resolution"`, event value `"**Resolution** text..."` | Match |
| Match operator — `starts_with` | Rule `value starts_with "**Resolution**"`, event value `"**Resolution** text..."` | Match |
| Match operator — `matches` | Rule `value matches "[A-Z]{2}\\d{6}"`, event value `"AB123456"` | Match |
| Match operator — missing field | Rule on `automation_id`, event has no `automation_id` | No match |
| Span — `single` | Trigger on event 5 | Step contains only event 5 |
| Span — `until_app_change` | Trigger at SNFI event, 3 more SNFI events, then TAMBA event | Step contains 4 SNFI events |
| Span — `until_field_change` | Trigger on `ag-cell-edit-input`, 20 keystrokes same field, then `ListItem` | Step contains 21 events |
| Span — `absorb_interleave` | Trigger at SNFI, then TAMBA tab, then SNFI tab, then next trigger | Step absorbs all until next trigger |
| Case anchor — basic | 3 distinct serial numbers in sequence | 3 cases |
| Case anchor — re-lookup | Same serial within 5s | Still 1 case |
| Case anchor — pause split | One serial, then 6 min gap, then activity | Case closed at the gap |
| Fallback step_suggest — no window cut | Events across 3 apps within 5s | 1 step (not 3) |
| Fallback step_suggest — pause cut | Events, then 15s gap, then events | 2 steps |
| Fallback step_suggest — completion cut | Events, then Search button click, then events | 2 steps (button in first) |
| Full integration | Real recording + atm-ticket-handling.yaml | ~60–84 steps, ~10–14 cases, 4–6 map nodes |

---

## 9. What this does NOT change

- **Capture / recorder** — no changes. The recorder continues capturing the same
  events.
- **Viewer** — no changes. Steps, phases, cases, and the process map render
  through existing infrastructure.
- **annotations.json schema** — no changes. Steps are `auto_matched` (canonical)
  or `auto_suggested` (fallback). Cases come from markers (original + synthetic).
- **`_merge_steps()`** — no changes. Manually-authored and edited steps still
  survive re-normalization.
- **Exports** — no changes. XES, CSV, BPMN, DFG, PDD all work against the
  existing step/case model.

---

## 10. Measurement — how to know it worked

Run normalization on the real 1h33m recording with the
`atm-ticket-handling.yaml` template:

```
python normalize.py <session_folder> \
  --taxonomy taxonomy-atm.yaml \
  --canonical atm-ticket-handling.yaml \
  --mine
```

**Success criteria:**

| Metric | Before (v0.12.2) | Target |
|--------|-------------------|--------|
| Step count | ~308 | ~60–84 (5–7 per ticket × ~12 tickets) |
| Case count | 1 | ~10–14 (one per ticket) |
| Process map nodes | 2 | 4–6 (TAMBA, SNFI, ES Call Mgmt, SharePoint, Excel) |
| Match rate | n/a | >70% of interactions assigned to a named step |

**If the step count is still too high:** the boundary modes aren't absorbing
enough. Check the unmatched interactions — they'll show which patterns need
additional step definitions in the template.

**If the case count is wrong:** check `stats.json` for the detected serial
numbers. Adjust `min_gap_ms` or `close_on_pause_ms` in the template.
