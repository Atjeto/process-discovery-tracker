# ADR-0009: Normalization Redesign (v0.13)

**Status:** Superseded in part / redirected (2026-05-22) — see the note below
**Date:** 2026-05-19
**Deciders:** Analyst (process-discovery lead)
**Input:** SPEC-v0.13-normalization-redesign.md

> **Redirect (2026-05-22).** A value-chain review
> ([VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md)) plus two facts
> about the real workload — *both* short and long sessions occur regularly, and
> processes are *mostly one-off* (rarely re-recorded) — change this ADR's
> conclusion. A persistent, hand-authored **canonical template** earns its keep
> only by matching future recordings of the same process; for one-off work it
> matches zero future sessions and is pure overhead. **The canonical-template
> matching mechanism (Issues 4, 5, 8) is therefore mis-targeted and shelved.**
>
> What **survives and is repurposed:** the gating AG Grid fact-find (Issue 1),
> the coalescing lift (Issue 2), anchor-based case detection (Issue 3 — it finds
> the repeating unit), the taxonomy-schema correction (Issue 6), and the
> fallback heuristic tuning (Issue 7). These feed the replacement design —
> **intra-session repetition alignment** (detect the repeating case, fuzzily
> align the instances, curate one and propagate to all), described under
> Decision 1 of the value-chain review. The Aggregate / Compare-Sessions view
> also demotes: cross-session pooling has little value for one-off processes.
> The original analysis below is kept as the audit of record.

## Context

The real ATM ticket-handling recording (1h33m, ~2,363 events) produces ~308
atomic steps instead of the expected ~60-84 (5-7 per ticket x ~12 tickets).
Root causes: (1) AG Grid typing bursts aren't coalesced, (2) canonical matching
lacks partial-value operators and span boundaries, (3) cases are only detected
from manual markers (the worker fired one for the whole session).

SPEC-v0.13 proposes three code changes plus taxonomy config and heuristic
tuning. This ADR evaluates each change against the codebase as it stands on the
`viewer-refactor` branch.

## Decision

Accept the spec's goals. The implementation plan requires nine corrections —
one gating prerequisite, two errors that would defeat the spec's own success
metrics, and six design improvements over what the spec proposes. Status is
**Needs revision** until the gating prerequisite (Issue 1) is resolved.

---

## Issue 1 (GATING): Verify real AG Grid capture data before building on it

The spec builds three features on AG Grid field assumptions: the "Classify
ticket" match rule (`class_name == "ag-cell-edit-input"`), the
`until_field_change` boundary, and the coalescing fix. All three rest on
unverified claims about what the recorder captures for Chrome-hosted AG Grid
controls.

**Three assumptions at risk:**

**a) `class_name` may not contain the CSS class.** The schema defines
`class_name` as the Win32 / UIA ClassName property. `ag-cell-edit-input` is a
CSS class — a different namespace. UIA for Chrome content may report an empty
or generic value. TAMBA AG-Grid is the recorder's known blind spot.

**b) Cross-cell events may not exist.** The recorder drops `focus_changed` in
default mode (`UiaSubscriber.cs:7-10`: "focus_changed events are dropped"). If
AG Grid cell navigation also doesn't emit `selection_changed` or `invoked`,
there is NO event between cell A's last keystroke and cell B's first. The
normalization coalescer's fallback key (`step_suggest.py:79`:
`pid|ct|control_type|window_title|process_name`) is identical for all AG Grid
cells — it would merge typing across cells. Real data loss.

The recorder-side coalescer distinguishes cells via RuntimeId
(`UiaSubscriber.cs:199`), which the normalization layer doesn't have. Whether
this fires correctly for AG Grid is also unverified.

**c) The browser process may not be `chrome.exe`.** The taxonomy rules in Issue
6 hardcode `app: "chrome.exe"` for TAMBA, SNFI, etc. If the work machine runs
Edge, the process is `msedge.exe` and the rules match nothing.

**Fix:** Before any implementation, inspect a real captured AG Grid event from
the ATM recording. Check: `class_name`, `automation_id`, `name`,
`framework_id`, `process_name`. Check whether a cell-to-cell navigation emits
any event at all. One inspection gates the taxonomy, the coalescing design, the
match rules, and the `until_field_change` boundary.

If `class_name` is empty: the "Classify ticket" match rule and
`until_field_change` boundary need a different discriminator. If no cross-cell
event exists: the coalescer needs a new key dimension (RuntimeId or value
content) before it can be safely lifted to a pipeline stage.

---

## Issue 2: Coalescing must run before anchor detection — stage 1a, not 4a

The anchor rule is `automation_id == "txtsr"` with `case_id_from: "value"`.
Every keystroke into the serial field is a `value_changed` event on `txtsr`. If
coalescing runs AFTER anchor detection (as the previous pipeline draft had it
at stage 4a), the anchor detector sees every partial value.

Typing serial "AB123456" uncoalesced: values "A", "AB", "AB1"... each matches
the anchor, each partial string is a distinct `case_id_from` value. The §3
algorithm opens a new case for each, closing the previous. Result: ~8 garbage
cases per serial, ~96 total. The "10-14 cases" success metric is blown by ~8x.

`_coalesce_interactions` has zero dependency on markers, case assignment, or
vocab enrichment. It only needs timestamp-sorted interactions, which exist
right after load. Running it before enrichment also avoids wasting enrichment
work on events about to be discarded.

**Corrected pipeline:**

```
1.  Load & validate (sort by timestamp)
1a. Coalesce typing bursts (LIFTED from step_suggest.py to normalize.py)
2.  Apply marker edits
2a. Detect cases from anchors (NEW — if template has case_anchor)
3.  Case assignment (marker-based OR anchor-based — Issue 3)
4.  App vocabulary enrichment
5.  Step suggestion (fallback) OR Canonical matching (with --canonical)
6.  Step merge + drift detection
7.  Taxonomy classification + overrides
8.  Activity collapse (existing collapse_adjacent — unchanged)
9.  XES/CSV export
10. Statistics
11. Analysis layer
12. Mining
```

The internal call at `step_suggest.py:188` is deleted. Add `_coalesced_count`
to the kept event's data for diagnostics.

## Issue 3: Case anchor needs a mode switch, not marker suppression

**Spec says:** Inject synthetic Start/End markers before `assign_case_ids()`.

**The problem (identified in prior review):** The worker fired one
session-spanning marker. Synthetic anchor markers nest inside it. After
`assign_case_ids`, every interaction carries `case_ids = ["ticket_A",
"session"]`. Both step groupers key off `cids[-1]` (outermost) = "session".
All steps point at the session case. Per-ticket attribution fails.

The prior ADR revision proposed suppressing the worker's enclosing markers —
a heuristic filter it admitted was fragile ("may need refinement"). Normalization
deleting captured input based on a YAML key is a surprising side effect, and
the "which markers are enclosing?" question has no clean general answer.

**Fix:** Mode switch. When a template declares `case_anchor`, cases come from
anchors — full stop. Marker-based `assign_case_ids` is not consulted.

The anchor detector (`detect_cases_from_anchors`) returns a flat list of
`{case_label, start_ts, end_ts}`. A new `stamp_anchor_cases(events, cases)`
function walks events and stamps `case_ids` by time-range containment:
interactions within a case's time range get `case_ids = [case_uuid]` (one
element, no nesting). Interactions outside any case get `case_ids = []`.

```python
edited, edits_applied = apply_marker_edits(raw, annotations)
coalesced = coalesce_interactions(edited, idle_ms=COALESCE_WINDOW_MS)

if canonical_path:
    canonical = load_canonical(canonical_path)
    anchor_cfg = canonical.get("case_anchor")
    if anchor_cfg:
        interactions = [e for e in coalesced if e.get("type") == "interaction"]
        anchor_cases = detect_cases_from_anchors(interactions, anchor_cfg)
        with_cases = stamp_anchor_cases(coalesced, anchor_cases)
    else:
        with_cases = assign_case_ids(coalesced)
else:
    with_cases = assign_case_ids(coalesced)
```

Anchor cases are flat (a sequence of tickets, not a tree). Using them as
Start/End pairs in a stack-based nesting walker works but misuses the
abstraction. The mode switch avoids this mismatch.

Worker markers remain in the event stream untouched — they're not deleted, just
not consulted for case assignment. If the viewer wants to display them (e.g.
showing when the worker started/stopped), they're still there.

**On `cids[-1]` vs `cids[0]`:** The codebase is inconsistent — `collect_cases`
uses `cids[0]` (innermost, `case_assignment.py:104`), step groupers use
`cids[-1]` (outermost). For anchor-mode cases there's no nesting, so the
index doesn't matter (`cids[0]` == `cids[-1]`). The inconsistency is real but
orthogonal to v0.13 — resolving it affects marker-based nested sessions, which
this change doesn't touch.

**Framing correction:** The spec says `case_id_from: "value"` — this is
misleading. The serial number is the case *label* / business key, not the
`case_id` (which is a UUID per the schema invariant, minted by
`case_assignment.py:33`). The anchor config should be named `case_label_from`
to avoid confusion. `assign_case_ids` / `stamp_anchor_cases` mints the UUID;
the serial goes in the marker/case `label` field.

## Issue 4: Synthetic marker injection point

**Spec says (Section 3):** "Convert the result to `marker_edits` (insert
operations) and prepend them to the marker-edit list."

**Code says:** `apply_marker_edits()` produces a derived event stream
(`edited`). Marker edits are already consumed by the time `assign_case_ids()`
runs. You can't prepend retroactively.

**Fix:** This issue is subsumed by the mode switch in Issue 3. In anchor mode,
`detect_cases_from_anchors` produces a flat case list, not marker events. No
injection into the event stream needed. In marker mode, the existing pipeline
is unchanged.

## Issue 5: Extend the existing canonical format — don't adopt v2

**Spec says:** New `match_rules: [{field, operator}]` format.

**Code says:** The existing format uses `match[].{process_name,
window_title_regex, interaction.{control_type, automation_id, name}}` with
`end_when` for span control.

The spec's v2 format is worse in design: v1's `interaction` block is structured
and readable; v2 flattens everything and (spec §2c) resorts to magic
key-suffix parsing (`window_title_contains`) to recover cross-field conditions
that v1 expresses naturally via `window_title_regex` at the rule level.

The only thing v2 actually adds is operators. Add those to v1:

```yaml
steps:
  - step_id: "write-resolution"
    name: "Write resolution"
    match:
      - window_title_regex: ".*TAMBA.*"
        interaction:
          value: { starts_with: "**Resolution**" }   # dict = operator
          automation_id: "txtsr"                      # scalar = equals
    boundary: "absorb_interleave"
```

Implementation: in `_interaction_matches`, extend the key list at
`canonical_match.py:28` beyond `(control_type, automation_id, name)` to include
`value`, `class_name`, `framework_id`, etc. When the value is a dict, dispatch
to the operator:

```python
for k in ("control_type", "automation_id", "name",
          "value", "class_name", "framework_id"):
    if k not in irule:
        continue
    expected = irule[k]
    actual = data.get(k)
    if isinstance(expected, dict):
        if not _op_match(expected, actual):
            return False
    elif actual != expected:
        return False
```

`boundary` goes on the step (additive). `case_anchor` and `phases` go
top-level (additive). Zero migration, zero breakage. The sample template and
test fixtures work unchanged. No format detection, no adapter, no dual matcher.

**On `end_when`:** The spec's five boundary modes cannot express "close when
Button 'Search' is clicked." The existing `end_when` can. Dropping it is a
capability regression. Keep `end_when` as-is — it naturally composes with
`boundary` (e.g. `boundary: "until_app_change"` as a fallback, `end_when` as
the precise close trigger).

**On default behavior:** The v1 default (no `end_when`, no `boundary`) groups
contiguous same-step matches via `canonical_match.py:120-122`. This is closest
to `absorb_interleave`, not `single`. When adding `boundary`, the default
should remain the current behavior (group contiguous), which means the implicit
default is `boundary: "group_contiguous"` (the existing behavior), not
`boundary: "single"`.

## Issue 6: Taxonomy schema in the spec is wrong

**Spec says (Section 0):**

```yaml
- label: "TAMBA"
  match:
    title_contains: "TAMBA"
```

**Code says (`sample-taxonomy.yaml`):**

```yaml
rules:
  - match:
      app: "chrome.exe"
      title_regex: ".*Salesforce.*"
    label: "CRM -- Salesforce"
```

Three mismatches: no `rules:` wrapper, `title_contains` doesn't exist (it's
`title_regex`), `process` doesn't exist (it's `app`).

**Fix:** Correct the taxonomy rules to use the real schema. Note that the
`app` value for TAMBA, SNFI, etc. depends on the browser — must be verified
from real data (Issue 1c). Preliminary rules assuming Chrome:

```yaml
rules:
  - match:
      app: "chrome.exe"       # verify against real capture
      title_regex: ".*TAMBA.*"
    label: "TAMBA"

  - match:
      app: "chrome.exe"
      title_regex: ".*SNFI.*"
    label: "SNFI"

  - match:
      app: "chrome.exe"
      title_regex: ".*ES CALL MANAGEMENT.*"
    label: "ES Call Management"

  - match:
      app: "chrome.exe"
      title_regex: ".*ncratleos\\.sharepoint\\.com.*"
    label: "SharePoint - Contract Lookup"

  - match:
      app: "EXCEL.EXE"
      title_regex: ".*"
    label: "Excel - Account View"

  - match:
      app: "explorer.exe"
      title_regex: ".*"
    label: "File Explorer"
```

## Issue 7: Fallback heuristic tuning — question the mechanism, not the knob

**Spec says (Section 5):** Remove app-change split, remove 12-event cap,
increase gap from 3s to 10s, add completion-action boundaries.

Two call sites exist:
- `normalize.py:380` — canonical path, unmatched remainder
- `normalize.py:409` — no-canonical path, all interactions

**Under `--canonical` (`:380`): question whether auto-suggestion should run.**
The unmatched ~30% produces opaque `auto_suggested` steps mixed with clean
`auto_matched` canonical steps. For a good template, unmatched interactions are
either noise (filter via `ignored_processes`) or template gaps (fix the
template). Manufacturing monster steps from them is a data-quality problem.

Better alternative: report unmatched interactions as a cluster summary in
`stats.json` (count, time ranges, apps involved) rather than creating steps.
The analyst sees "47 unmatched interactions around TAMBA 14:22-14:25" and
knows to update the template. If step creation is kept, use a distinct state
(`auto_suggested_unmatched`) so the viewer can treat them differently.

**Without `--canonical` (`:409`): completion-action + gap are the real
boundaries.** Both app-change (`app_key != last_app`) and process-change
(`proc != last_process`) are app-identity signals, not task-completion signals.
Keeping one while dropping the other is inconsistent — Chrome→Excel→Chrome
during one investigative step still fragments on process-change. If
completion-actions (Search, Submit, Save, etc.) are the principled boundary,
both app-identity splits should go. The high runaway cap (50-80) is the safety
net for sessions where no completion actions fire.

## Issue 8: `absorb_interleave` — span closure rules and naming

**a) Spans must close at case boundaries.** Case detection (stage 2a) runs
before matching (stage 5), so interactions carry `case_ids` when the span
expander runs. An `absorb_interleave` span crossing a ticket boundary is
always wrong. Pass 2 expansion stops on a `case_id` change. This is the
primary bound.

**b) Same-step re-trigger: absorbed.** Within one ticket, if the same step's
trigger fires again during an active `absorb_interleave` span, it's absorbed
(one step). If the template author wanted re-triggers to split, they'd use a
different boundary mode. Case boundaries always override.

**c) `max_span_ms` is a last-resort net.** With case-boundary closure and
tickets averaging ~7.75 min, a 10-min cap almost never fires first. Right-size
to ~120s (reasonable max for a single step within a ticket) or keep it as a
pure backstop and accept it rarely activates.

**d) Step names are systematically misleading.** "Look up serial number"
(triggered by `txtsr`) absorbs everything until the next trigger fires —
potentially minutes of three-app cross-referencing. The step is named after its
trigger, but its content is "the entire investigation prefix of the ticket."
An analyst opening a step labeled "Look up serial number" and finding 4 minutes
of SNFI + TAMBA + Excel activity will be confused.

This is inherent to `absorb_interleave` — the name describes the trigger, not
the span. Two mitigations:

- **Template-level:** Authors should name `absorb_interleave` steps after the
  span's purpose, not the trigger action. "Investigate serial" instead of
  "Look up serial number."
- **Matcher-level:** Annotate `absorb_interleave` steps with scope metadata
  (apps touched, interaction count, duration) so the analyst can see what the
  step contains without opening it.

---

## Consequences

### What becomes easier

- Real multi-app processes get meaningful step boundaries via span matching
- Cases are detected automatically from interaction patterns
- AG Grid typing noise is suppressed at the normalization layer
- The Process Template format gains expressive power (operators, boundaries)
  without breaking existing templates

### What becomes harder

- Two case-assignment modes (marker-based vs anchor-based) with different
  stamping semantics. Must be cleanly separated.
- `absorb_interleave` steps are hard to debug (no local reason for
  containment) and hard to name (trigger ≠ content).
- Five+ boundary modes are a significant testing surface, especially in
  combination with case-boundary closure and coalescing.

### What to revisit

- `close_on_pause_ms` in case anchors overlaps with the analysis layer's
  "waiting" waste detection. These should share a threshold or cross-reference.
- The `cids[-1]` / `cids[0]` inconsistency between `collect_cases` and the
  step groupers. Orthogonal to v0.13 but exposed by this work — should be
  resolved in a follow-up when nested marker sessions are tested.

---

## Action Items

Ordered by dependency — gating items first.

1. [ ] **GATE:** Inspect real AG Grid events from the ATM recording. Check:
       `class_name`, `automation_id`, `name`, `framework_id`, `process_name`,
       and whether cell-to-cell navigation emits any event. This gates the
       taxonomy rules, coalescing safety, match rules, and `until_field_change`
       boundary. (Issue 1)
2. [ ] Lift `_coalesce_interactions` to a shared pipeline stage at 1a in
       `normalize.py`. Delete the internal call at `step_suggest.py:188`. Add
       `_coalesced_count`. If Issue 1 reveals no cross-cell event, add a key
       dimension (value content or RuntimeId) before lifting. (Issue 2)
3. [ ] Implement `detect_cases_from_anchors()` and `stamp_anchor_cases()` in
       `case_assignment.py`. Mode switch: when `case_anchor` is configured,
       use anchor-based case stamping instead of `assign_case_ids()`. Rename
       `case_id_from` to `case_label_from` in the config schema. (Issue 3)
4. [ ] Extend `_interaction_matches` with operators (scalar = equals, dict =
       `{contains, starts_with, matches}`). Extend the field key list beyond
       `(control_type, automation_id, name)`. Keep `end_when`. Add `boundary`
       as an additive step-level field. (Issue 5)
5. [ ] Implement span boundary modes in a two-pass matcher. Spans close at
       case-id boundaries (always). `absorb_interleave` absorbs same-step
       re-triggers but closes on case change. `max_span_ms` as secondary net,
       right-sized to ~120s. (Issue 8)
6. [ ] Correct the spec's taxonomy rules to use the real schema (`rules:` /
       `app` / `title_regex`). Verify `app` values from real capture data
       (chrome.exe vs msedge.exe). (Issue 6)
7. [ ] Fallback heuristic tuning: under `--canonical`, consider replacing
       auto-suggest with an unmatched-cluster report. Without `--canonical`,
       drop both app-identity splits, keep completion-action + gap boundaries,
       cap as guard (50-80). (Issue 7)
8. [ ] Create `atm-ticket-handling.yaml` in extended-v1 format. Name
       `absorb_interleave` steps after span purpose, not trigger action. May
       need redesign pending Issue 1 outcome for AG Grid rules. (Spec §4)
9. [ ] Unit tests per spec §8, plus: case-boundary closure, same-step
       re-trigger, anchor-mode case stamping, taxonomy schema validation.
10. [ ] Integration test against the real 1h33m recording.
