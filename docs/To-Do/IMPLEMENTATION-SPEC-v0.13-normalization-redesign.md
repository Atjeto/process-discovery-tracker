# Implementation Spec — v0.13 Normalization Redesign

**Version:** 0.13.0
**Status:** Draft
**Date:** 2026-05-19
**Scope:** the normalization pipeline (`normalization/`). One optional capture-side follow-up is noted in §10.

This is a self-contained build plan. It can be executed against the codebase without any
other document. It cites source files and line numbers directly; line numbers are
accurate as of the `viewer-refactor` branch — re-check them if the files have moved.
Event and annotation data shapes are defined in `shared/SCHEMA.md`, the contract every
phase below builds against.

---

## Overview

### What v0.13 is

Five general improvements to the normalization **engine**: keystroke coalescing, richer
canonical-match rules, span-based step boundaries, anchor-based case detection, and
better fallback step suggestion. Each is a capability of the tool — specified against the
data contract (`shared/SCHEMA.md`) and verified by synthetic unit tests. None is tied to
a particular recording.

The work was motivated by one real recording (ATM ticket handling, 1 h 33 m, ~2,363
events) on which the pipeline produced ~308 single-interaction steps under a single case
instead of a per-ticket breakdown. That recording is the **motivating example** and
serves later as an **end-to-end test fixture** (§8). It is not a design input: the engine
is built to the schema, and engagement-specific values (field ids, window titles) are
analyst-authored configuration (§7), never hard facts in the engine.

### The four mechanics being fixed

1. **Keystroke bursts are not collapsed.** The C# recorder debounces `value_changed`
   per element (`capture/recorder/UiaSubscriber.cs:44-50, 190-201`), keying on
   AutomationId → Name → UIA RuntimeId. For Chrome-hosted controls it cannot key
   stably, the burst is not collapsed, so a typed value reaches normalization as roughly
   one event per keystroke.
2. **Canonical matching is too rigid.** `canonical_match.py` compares interaction fields
   by equality only and emits one step per matched interaction (consecutive same-step
   matches are grouped — nothing else). It cannot match a partial value, match on
   `class_name`/`value`, or group a step that spans several applications.
3. **Cases come only from manual markers.** `case_assignment.py` derives cases purely by
   walking the Start/End marker stream — so a recording with one marker yields one case.
4. **Fallback step suggestion over-splits.** `auto_suggest_steps` (`step_suggest.py`)
   starts a new step on every window-title change, every process change, and after 12
   interactions — fragmenting interleaved multi-app work into many tiny steps.

### Definition of done

The five engine capabilities (§1–§5) implemented and passing the unit tests in §8. Each
unit test is built from synthetic events constructed to the `shared/SCHEMA.md` contract;
none requires a recording. Pipeline integration (§6) wires the stages in.

An end-to-end check (§8) then runs the pipeline on the sample recording with an example
engagement configuration (§7). That confirms the stages compose on real data — it is a
sanity check, not the definition of done.

---

## §1 — Phase 1: Typing-burst coalescing

The recorder's per-element debouncer does not reliably collapse Chrome-hosted cell-editor
bursts. Normalization adds its own coalescing stage so a burst is collapsed regardless of
recorder coverage.

### 1.1 New module — `normalization/coalesce.py`

Move `_coalesce_interactions` and `_coalesce_key` (`step_suggest.py:63-142`) into a new
module. Public entry point:

```python
def coalesce_typing_bursts(events, *, idle_ms=1500):
    """Collapse runs of consecutive value_changed/text_changed events on the
    same control into one final-value event (keep the last); collapse
    selection_changed re-fires (keep the first). Returns a new list.
    Runs as pipeline stage 1a — on the full event stream, before case assignment."""
```

### 1.2 Behaviour

Keep the existing run logic: same `_coalesce_key`, break the run on a different event
kind, a different control, or a gap > `idle_ms`. **Add a value-continuation guard** — a
`value_changed` run continues from one event to the next only while their `value`s are
prefix-compatible:

```python
def _value_continues(prev_value, next_value):
    pv, nv = prev_value or "", next_value or ""
    if not pv or not nv:
        return True                        # empty value carries no signal
    return pv.startswith(nv) or nv.startswith(pv)   # append OR backspace
```

If `_value_continues` is false, break the run there. Within one control the typed value
only grows or shrinks; two different fields' contents are not prefix-compatible, so the
run breaks at the field boundary **without needing a per-element id or an intervening
focus event**. This is what makes the coalescer safe even when its fallback key
(`pid|ct|control_type|window|process`) is identical across sibling controls.

Limitation: if an application emits `value_changed` with an empty `value`, the guard
cannot act and the run breaks only on the coalesce key or a time gap — the general
fallback. That is the best achievable without a per-element identifier; §10 records the
optional `runtime_id` follow-up that would remove it.

### 1.3 Details

- The kept event keeps its own `event_id` and `timestamp`. Add `data._coalesced_count` —
  the number of raw events it replaced (diagnostic; no downstream reader).
- `idle_ms` default `1500`, well below `auto_suggest_steps`' step-gap threshold so a
  coalesce window never swallows a real step boundary.
- Delete the internal coalesce call at `step_suggest.py:188`; `auto_suggest_steps` now
  receives already-coalesced events.

### 1.4 Expected impact

A multi-event keystroke burst collapses to one final-value event; a recording's raw
event count drops substantially (on the order of ~2,363 → ~800–1,000 for the motivating
recording).

---

## §2 — Phase 2: Canonical match operators

The canonical template format is the `canonical_process:` document loaded by
`load_canonical` (`canonical_match.py:12-14`): a top-level `canonical_process` with
`id`, `version`, `phases[]` (each `{phase_id, name, step_ids}`), and `steps[]` (each
`{step_id, name, description, match[]}`). A `match` rule has optional `process_name`,
`window_title_regex`, an `interaction` sub-dict, and an optional `end_when`.

Today `_interaction_matches` (`canonical_match.py:17-31`) compares the `interaction`
fields `control_type / automation_id / name` by equality. Two changes:

1. An `interaction` field value may be a **scalar** (equality) or a **dict**
   `{op: operand}` with `op ∈ {equals, contains, starts_with, matches}`.
2. The checked field set extends to
   `control_type, automation_id, name, value, class_name, framework_id`.

```python
def _op_match(spec: dict, actual) -> bool:
    if actual is None:
        return False
    actual = str(actual)
    if "equals"      in spec: return actual == spec["equals"]
    if "contains"    in spec: return spec["contains"] in actual
    if "starts_with" in spec: return actual.startswith(spec["starts_with"])
    if "matches"     in spec: return re.search(spec["matches"], actual) is not None
    return False

INTERACTION_FIELDS = ("control_type", "automation_id", "name",
                      "value", "class_name", "framework_id")

# inside _interaction_matches, replacing the current three-field loop:
for k in INTERACTION_FIELDS:
    if k not in irule:
        continue
    expected, actual = irule[k], data.get(k)
    if isinstance(expected, dict):
        if not _op_match(expected, actual):
            return False
    elif actual != expected:
        return False
```

`process_name` and `window_title_regex` stay rule-level. `end_when` is unchanged. String
comparisons are case-sensitive; `matches` is a raw `re.search`. A scalar field value
keeps its current equality meaning, so existing templates and
`test/test_canonical_match.py` are unaffected.

---

## §3 — Phase 3: Span boundaries

`boundary` is an optional **step-level** field. Absent ⇒ default (`group_contiguous`).

### 3.1 Modes

| Mode | The step spans… |
|------|-----------------|
| `group_contiguous` *(default)* | the trigger plus consecutive interactions matching the **same** step. |
| `single` | the trigger interaction only. |
| `until_app_change` | …until `_short_app(window_title)` changes. |
| `until_pause` | …until a gap > `pause_ms` (default 5000). |
| `until_field_change` | …through consecutive interactions sharing `(window_title, automation_id, class_name)`. |
| `until_next_step` | …until **any other step's** trigger fires. |

The rule-level `end_when` clause still works and composes with any boundary as an
explicit early close.

### 3.2 Universal rules

- **Every boundary also closes at a `case_id` change.** A step never spans two cases.
  Case assignment (pipeline stage 3) runs before matching (stage 5), so interactions
  carry `case_ids` when the matcher runs.
- `until_next_step` has a catastrophe backstop `max_span_ms` (default `1800000` = 30 min).
  Case-boundary closure is the real bound; the backstop only fires on a degenerate
  template. It is intentionally large — `until_next_step` steps are legitimately
  multi-minute.
- A `until_next_step` step is named after the **span's purpose**, not its trigger
  interaction. The matcher annotates such steps with scope metadata — applications
  touched, interaction count — so an analyst sees what a step contains without opening it.

### 3.3 Implementation

`match_canonical` is already a single-pass walk with an `open_step` accumulator. Extend
it; a two-pass rewrite is unnecessary because every close decision is local: a gap, an
app change, a field-tuple change, a different step's trigger, a `case_id` change,
`end_when`, or `max_span_ms`. Store the open step's `boundary` and `start_ts` on the
`open_step` dict and evaluate the matching close condition on each incoming interaction
before deciding whether to absorb it. First-match-wins in template definition order is
unchanged.

---

## §4 — Phase 4: Anchor-based case detection

When a template declares a `case_anchor`, cases are derived from interaction patterns
instead of markers. This is a distinct mode: it replaces both `assign_case_ids` and
`collect_cases`.

### 4.1 Config — `case_anchor` block in the template

```yaml
case_anchor:
  field: "automation_id"      # the interaction field the anchor rule tests
  equals: "txtsr"             # example value; the §2 operators are also allowed here
  case_label_from: "value"    # the field whose value identifies the case
  min_gap_ms: 10000           # a re-hit of the same label within this window is the same case
  close_on_pause_ms: 300000   # an internal idle gap longer than this splits the case
```

`case_label_from` names the field whose value identifies a case. That value becomes the
case's `label`; the `case_id` is a generated UUID (see 4.3).

### 4.2 Two new functions in `case_assignment.py`

```python
def detect_cases_from_anchors(interactions, anchor_cfg) -> list[AnchorCase]:
    """interactions: COALESCED, timestamp-sorted interaction events.
    Returns AnchorCase = {case_id, label, start_ts, end_ts}."""

def stamp_anchor_cases(events, anchor_cases) -> tuple[list, dict]:
    """Stamps case_ids=[case_id] on every interaction AND activity event whose
    timestamp falls inside an anchor case's [start_ts, end_ts]; [] otherwise.
    Returns (stamped_events, cases_map), where cases_map has the same shape
    collect_cases() produces: {case_id: {case_id, label, parent_case_id: None,
    start_ts, end_ts, end_reason, activity_event_ids}}."""
```

`stamp_anchor_cases` **must stamp activity events as well as interactions** — activity
events drive XES traces and `stats.case_stats`. It **must return the `cases_map`** — in
this mode `collect_cases` is not called, and `collect_cases` is marker-driven, so without
the returned map every downstream consumer would see only the worker's single
marker-derived case.

### 4.3 Detection algorithm

Walk coalesced interactions in time order. An interaction matching the anchor rule
carries a `case_label` (the value of `case_label_from`):

- A **new** `case_label` ⇒ close the open case at its `last_ts`, open a new one.
- The **same** `case_label` within `min_gap_ms` of the open case's `last_ts` ⇒ a
  re-hit; extend `last_ts`, do not open a new case.
- A non-anchor interaction extends the open case's `last_ts`.
- After the walk, close the open case. Then split any case with an internal gap
  > `close_on_pause_ms` into two.
- `case_id = uuid5(NAMESPACE, label + "|" + start_ts.isoformat())` — deterministic, so a
  re-normalization run produces the same ids and analyst-authored steps' `case_id`
  references survive across runs.

### 4.4 Pipeline branch (`normalize.py`)

```python
coalesced = coalesce_typing_bursts(raw)                     # stage 1a
edited, n = apply_marker_edits(coalesced, annotations)      # stage 2

anchor_cfg = canonical.get("case_anchor") if canonical_path else None
if anchor_cfg:
    anchor_cases = detect_cases_from_anchors(
        [e for e in edited if e.get("type") == "interaction"], anchor_cfg)
    with_cases, cases = stamp_anchor_cases(edited, anchor_cases)   # stages 2a + 3
else:
    with_cases = assign_case_ids(edited)                          # stage 3
    cases = collect_cases(with_cases)
```

Anchor cases do not nest, so each event's `case_ids` has exactly one element — therefore
`cids[-1] == cids[0]`, and the existing step groupers (`step_suggest.py:182`,
`canonical_match.py:71`, both read `cids[-1]`) attribute steps to the correct case with
no change. Worker markers stay in the event stream — the viewer may still display them —
but are not consulted for case assignment in this mode.

---

## §5 — Phase 5: Fallback step-suggestion heuristics

`auto_suggest_steps` (`step_suggest.py`) now receives pre-coalesced events. Change the
split logic (currently `step_suggest.py:241-247`):

- **Remove both app-identity splits** — `app_key != last_app` and
  `proc != last_process`. Neither marks task completion; both fragment interleaved
  multi-app work.
- **Remove the hard 12-interaction cap.** Replace it with a high safety cap (60) that
  only guards against a runaway step.
- **Raise the gap threshold** from 3000 ms to 10000 ms.
- **Add a completion-action boundary:** after an `invoked` event on a Button or
  Hyperlink whose `name` contains a completion word
  (`search, submit, save, apply, ok, close, confirm, send, next, finish, done`),
  include that event in the current step and start a new one.

Both call sites (`normalize.py:380` — the unmatched remainder under `--canonical`;
`normalize.py:409` — the no-canonical path) use the same tuning.

**Unmatched-remainder reporting.** Under `--canonical`, add an `unmatched_interactions`
summary to `stats.json` meta — count, time spans, and applications involved — so an
analyst can extend the template. Do not add a new step `state`: remainder steps are
already `auto_suggested`, distinct from `auto_matched`, so the viewer already
distinguishes them.

---

## §6 — Pipeline integration (`normalize.py`)

Stage order ("new" = added by this work; "existing" = already in `normalize.py`):

```
1.   Load & sort by (timestamp, _seq)                         existing
1a.  Coalesce typing bursts                                   new — §1
2.   Apply marker edits                                       existing
2a.  Detect anchor cases (only if template has case_anchor)   new — §4
3.   Case assignment:  anchor mode  → stamp_anchor_cases (+ direct cases map)
                       marker mode  → assign_case_ids + collect_cases
4.   App vocabulary enrichment                                existing
5.   Canonical matching (--canonical) OR fallback suggestion  existing, modified §2/§3/§5
6.   Step merge + drift detection                             existing
7.   Taxonomy classification + overrides                      existing
8.   Activity collapse (collapse_adjacent)                    existing, position unchanged
9.   XES / CSV export                                         existing
10.  Statistics (+ unmatched-interaction summary, §5)         existing, modified
11.  Analysis layer                                           existing
12.  Mining                                                   existing
```

No new CLI flags. A `case_anchor` block in the `--canonical` template activates anchor
mode. Log at INFO: coalescing (`N bursts, M→K events`), anchor detection (`N cases`),
canonical matching (`N steps across M cases, match rate X%`).

---

## §7 — Example engagement configuration

This section is **not engine code.** It is how an analyst configures the tool for a
specific engagement, shown as a worked example for the ATM engagement. The field values
below (automation_ids, class names, window titles) belong to one engagement's
applications; an analyst authoring a real template identifies them from their own
capture — using the viewer (which shows captured interactions and their fields), the
recorder's per-process `coverage_hint`, and `normalize.py --bootstrap-vocab-out`. Values
shown as `<...>` or commented as examples are placeholders.

### 7.1 Process template — `normalization/canonical/atm-ticket-handling.yaml`

A worked example of the v0.13 template format (operators §2, boundaries §3,
`case_anchor` §4):

```yaml
canonical_process:
  id: "atm-ticket-handling"
  name: "ATM Ticket Handling"
  version: 1

  case_anchor:
    field: "automation_id"
    equals: "txtsr"                 # example: the SNFI serial field
    case_label_from: "value"
    min_gap_ms: 10000
    close_on_pause_ms: 300000

  phases:
    - phase_id: "investigation"
      name: "Investigation"
      step_ids: ["investigate-serial", "check-call-mgmt", "check-contract"]
    - phase_id: "resolution"
      name: "Resolution"
      step_ids: ["write-resolution", "classify-ticket", "update-status"]

  steps:
    - step_id: "investigate-serial"
      name: "Investigate serial"          # named for the span, not the trigger
      description: "Look up the serial in SNFI and cross-reference in TAMBA."
      match:
        - interaction: { automation_id: "txtsr" }
      boundary: "until_next_step"

    - step_id: "check-call-mgmt"
      name: "Check call management"
      match:
        - interaction: { name: { contains: "Load Task#" } }
      boundary: "until_app_change"

    - step_id: "check-contract"
      name: "Check contract coverage"
      match:
        - window_title_regex: ".*<SharePoint page title>.*"   # placeholder
      boundary: "until_app_change"

    - step_id: "write-resolution"
      name: "Write resolution"
      match:
        - window_title_regex: ".*TAMBA.*"
          interaction: { value: { starts_with: "**Resolution**" } }
      boundary: "single"

    - step_id: "classify-ticket"
      name: "Classify ticket"
      match:
        - window_title_regex: ".*TAMBA.*"
          interaction: { class_name: "ag-cell-edit-input" }   # placeholder — verify per capture
      boundary: "until_field_change"

    - step_id: "update-status"
      name: "Update status fields"
      match:
        - interaction: { value: { equals: "No FLM" } }
        - interaction: { value: { equals: "No related tickets in 14 days" } }
      boundary: "single"
```

Rule ordering matters — the matcher uses first-match-wins in definition order. Keep
`classify-ticket` defined before any value-based rule that could also match an AG Grid
cell's contents.

### 7.2 Taxonomy — `normalization/taxonomy-atm.yaml`

The taxonomy format (consumed unchanged by `classification.py`) is a top-level `rules:`
list; each rule is `match: {app, title_regex}` plus `label`. `title_regex` is compiled
with `re.IGNORECASE` (`classification.py:33`); `app` is optional — a rule with only
`title_regex` skips the application check (`classification.py:67`).

```yaml
rules:
  - match: { app: "chrome.exe", title_regex: ".*TAMBA.*" }
    label: "TAMBA"
  - match: { app: "chrome.exe", title_regex: ".*SNFI.*" }
    label: "SNFI"
  - match: { app: "chrome.exe", title_regex: ".*ES CALL MANAGEMENT.*" }
    label: "ES Call Management"
  - match: { app: "chrome.exe", title_regex: ".*<SharePoint page title>.*" }
    label: "SharePoint — Contract Lookup"
  - match: { app: "EXCEL.EXE", title_regex: ".*" }
    label: "Excel — Account View"
  - match: { app: "explorer.exe", title_regex: ".*" }
    label: "File Explorer"
```

Two authoring notes for whoever writes a taxonomy:

- A browser window title is the **page title**, not the URL — match the page-title text,
  never a host/URL substring.
- `app` for browser-hosted applications depends on the browser in use. Set it from the
  capture, or omit `app` entirely (robust to the browser choice, at the cost of a
  possible title false-positive).

---

## §8 — Test plan

### 8.1 Unit tests — the definition of done

Python unit tests, `pytest`, in the existing `normalization/test/` suite. Each builds
synthetic events to the `shared/SCHEMA.md` contract; none requires a recording.

| Area | Test |
|------|------|
| Coalesce | 10 same-key `value_changed` 100 ms apart → 1 event, last value, `_coalesced_count` = 10. |
| Coalesce | Two fields, same coalesce key, no event between, values not prefix-compatible → 2 events. |
| Coalesce | `value_changed`, `invoked`, `value_changed` → 3 events (kind change breaks the run). |
| Match operators | `starts_with`, `contains`, `matches` — match / no-match / missing-field each. |
| Boundary | `single`, `until_app_change`, `until_pause`, `until_field_change`, `until_next_step` — one each. |
| Boundary | A span closes at a `case_id` change even when its own mode would continue. |
| Boundary | `until_next_step` absorbs a same-step re-trigger; a different step's trigger closes it. |
| Anchor | 3 distinct labels → 3 cases; re-hit within `min_gap_ms` → still 1; gap > `close_on_pause_ms` → split. |
| Anchor | `stamp_anchor_cases` stamps interaction AND activity events; `cases_map` lists every case. |
| Fallback | 3 apps within 5 s → 1 step; 15 s gap → 2 steps; a Search-button click → 2 steps. |
| Regression | `test_canonical_match.py` passes with no edits (the operator extension is additive). |

### 8.2 Integration check

Run the pipeline on the sample ATM recording with the §7 example template and taxonomy.
This confirms the stages compose on real data; it is a sanity check, **not** a pass/fail
gate, and the numbers below are one fixture's ballpark — the meaningful assertion is
qualitative: cases align to tickets, each case carries a small set of named steps, and
the process map has named nodes.

| Observation | Before | Expected ballpark after |
|-------------|--------|--------------------------|
| Step count | ~308 | ~60–84 |
| Case count | 1 | ~10–14 (one per ticket) |
| Process-map nodes | 2 ("Unclassified") | 4–6 (named applications) |
| Canonical match rate | n/a | > 70 % of interactions assigned to a named step |

If the step count is high, read the `unmatched_interactions` summary (§5) — it shows
which patterns need step definitions. If the case count looks wrong, check the detected
labels and tune `min_gap_ms` / `close_on_pause_ms`.

---

## §9 — Work order & dependencies

```
Phase 1 (coalescing)        ┐
Phase 2 (match operators)   │  independent — parallelisable
Phase 5 (fallback)          ┘
Phase 3 (span boundaries)    — needs Phase 2
Phase 4 (anchor cases)       — needs Phase 1
  │
Pipeline integration (§6)    — needs Phases 1–5
Example configuration (§7)   — needs Phases 2, 3, 4 (uses operators, boundaries, case_anchor)
  │
Integration check (§8.2)     — needs pipeline integration + example configuration
```

The definition of done (§8.1 unit tests) depends only on Phases 1–5; it does not depend
on the example configuration or the recording.

---

## §10 — Out of scope / follow-ups

- **Recorder `runtime_id` emission.** The recorder computes a UIA RuntimeId
  (`UiaSubscriber.cs:199`) and discards it. Emitting it as an interaction field would let
  the coalescer key on element identity directly and remove the empty-`value` limitation
  noted in §1.2. Not required for v0.13 — a capture-side change; track it separately.
- **`case_ids` inner/outer index.** `collect_cases` reads the innermost case, the step
  groupers read the outermost. This is irrelevant in anchor mode (single-element
  `case_ids`) and is not touched here; resolve it when nested marker sessions are next
  exercised.
