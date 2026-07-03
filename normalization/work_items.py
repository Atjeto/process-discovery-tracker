"""work_items.py -- the case-scoped screen visit for the export path (ADR-0028 §4).

The Python twin of viewer/work-items.js: fold a session's steps into
case-scoped screen visits (the analyst-facing "work item"). A worker handling
one ticket bounces Salesforce -> SAP -> Salesforce a dozen times; ADR-0024's
consecutive-run roll-up starts a NEW group at every bounce, so the export's
detailed-step list is one row per fragment. This module merges the fragments of
one screen-visit back together ACROSS bounces WITHIN a case (non-consecutive
merge), so the PDD/memo can render "what was done on that ticket, per screen"
under the analyst's own name.

Scope (ADR-0028 §4, the named export follow-up): this is a SMALL ADDITIVE READ
in the export path. It reads `annotations.group_annotations[]` (the viewer-
written names/notes/waste, keyed by the composite `(case_id, screen_key)`) and
the steps' persisted `grain_keys.screen`; it writes nothing and consumes no
pipeline model. The pipeline still round-trips `group_annotations` verbatim and
never regenerates it.

PURE / stdlib-only: no pandas, no pm4py, no docx -- so it imports (and its
tests run, not skip) under a bare system pytest. It reuses the single-source
value-free screen strip via `step_suggest.screen_label` (the JS `screenType`
twin, both driven by shared/screen-label-patterns.json) rather than
reimplementing the key, so the export's `screen_key` matches the viewer's
`grainKey(step,"screen")` byte-for-byte and lines up with the composite key the
viewer wrote into `group_annotations`.
"""
from __future__ import annotations

from typing import Any

from step_suggest import screen_label

# The pseudo-case that collects steps with no case_id. Mirrors work-items.js
# UNASSIGNED_CASE; it never merges across the real cases and always sorts last.
UNASSIGNED_CASE = "__unassigned__"


def screen_key(step: dict[str, Any]) -> str:
    """The value-free SCREEN grain key for a step -- the exact Python twin of
    viewer/process-map-levels.js `grainKey(step, "screen")`:

        "scr:" + (screenType(grain_keys.screen) or "(screen)")

    `grain_keys.screen` is the raw screen proxy the pipeline stamped (a vocab
    `screen_id` or the `window_title`); `screen_label` (== JS `screenType`)
    value-frees it at read time. A step lacking `grain_keys.screen` falls back
    to the "(screen)" placeholder, exactly as the viewer does when a step
    carries no persisted key and no live interaction resolver is available."""
    gk = step.get("grain_keys")
    raw = gk.get("screen") if isinstance(gk, dict) else None
    stripped = screen_label(raw) if raw else ""
    return "scr:" + (stripped or "(screen)")


def find_group_annotation(
    group_annos: list[dict[str, Any]] | None,
    case_id: str | None,
    key: str,
) -> dict[str, Any] | None:
    """The `group_annotations[]` entry for a `(case_id, screen_key)`, or None.
    Pure -- shared by callers and tests so the one lookup rule is not
    duplicated. A null `case_id` matches a null-or-absent `case_id` in the
    entry (the Unassigned pseudo-case). Mirrors work-items.js
    `findGroupAnnotation`."""
    if not isinstance(group_annos, list):
        return None
    cid = case_id if case_id else None
    for g in group_annos:
        if not isinstance(g, dict):
            continue
        gcid = g.get("case_id") if g.get("case_id") else None
        if gcid == cid and g.get("screen_key") == key:
            return g
    return None


def _group_name(group_annos: list[dict[str, Any]] | None,
                case_id: str | None, key: str) -> str:
    """The analyst's business name for a work item, or "" when there is no
    entry or no (non-blank) name -- so callers fall back to the value-free
    screen label. Mirrors work-items.js `groupNameResolver`."""
    g = find_group_annotation(group_annos, case_id, key)
    name = g.get("name") if isinstance(g, dict) else None
    return name.strip() if isinstance(name, str) and name.strip() else ""


def _screen_label_of(step: dict[str, Any]) -> str:
    """The value-free display label for a step's screen (no `scr:` prefix) --
    what `grainLabel(step,"screen")` shows when no group name wins."""
    gk = step.get("grain_keys")
    raw = gk.get("screen") if isinstance(gk, dict) else None
    return (screen_label(raw) if raw else "") or "(screen)"


def _start(step: dict[str, Any]) -> str:
    """The ISO start timestamp (string-sortable, the motifs.py convention)."""
    return ((step.get("time_range") or {}).get("start") or "")


def build_work_items(
    steps: list[dict[str, Any]] | None,
    group_annotations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fold a session's steps into case-scoped screen-visit work items.

    Returns ``{"cases": [...], "has_cases": bool}``:

      * ``has_cases`` is False when NO step carries a ``case_id`` -- the
        no-cases signal (ADR-0028 §5): a caller keeps its exact current
        rendering rather than one giant "Unassigned" bucket.
      * each ``cases[]`` entry is ``{case_id, work_items: [...]}`` where a work
        item is ``{screen_key, label, case_id, step_ids, steps, waste, hidden,
        notes, group_annotation}``. ``label`` is the group-annotation name when
        one exists, else the value-free screen label. The Unassigned
        pseudo-case (``case_id`` None) sorts LAST.

    Non-consecutive merge (ADR-0028 §1): one work item per distinct screen key
    within a case, however many separate runs the work bounced into it -- the
    Python twin of work-items.js `buildWorkItems`. Hidden steps (``state ==
    "hidden"``) are excluded, as everywhere else in the pipeline. Ordering is by
    each item's / case's first-appearing step."""
    group_annos = group_annotations or []
    valid = [s for s in (steps or []) if isinstance(s, dict) and s.get("state") != "hidden"]

    saw_real_case = False
    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in valid:
        cid_raw = s.get("case_id")
        has_cid = bool(cid_raw)
        if has_cid:
            saw_real_case = True
        cid = cid_raw if has_cid else UNASSIGNED_CASE
        by_case.setdefault(cid, []).append(s)

    cases: list[dict[str, Any]] = []
    for cid, case_steps in by_case.items():
        case_steps.sort(key=_start)
        real_cid = None if cid == UNASSIGNED_CASE else cid

        # Accumulate one work item per distinct screen key, preserving the
        # first-seen order of the keys within the case.
        items: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        for s in case_steps:
            key = screen_key(s)
            if key not in items:
                items[key] = {"screen_key": key, "steps": [], "step_ids": []}
                order.append(key)
            items[key]["steps"].append(s)
            items[key]["step_ids"].append(s.get("step_id"))

        work_items = []
        for key in order:
            it = items[key]
            first = it["steps"][0]
            ga = find_group_annotation(group_annos, real_cid, key)
            name = _group_name(group_annos, real_cid, key)
            notes = ""
            waste = False
            hidden = False
            if isinstance(ga, dict):
                n = ga.get("notes")
                notes = n.strip() if isinstance(n, str) else ""
                waste = bool(ga.get("waste"))
                hidden = bool(ga.get("hidden"))
            work_items.append({
                "screen_key": key,
                "label": name or _screen_label_of(first),
                "case_id": real_cid,
                "step_ids": it["step_ids"],
                "steps": it["steps"],
                "waste": waste,
                "hidden": hidden,
                "notes": notes,
                "group_annotation": ga,
            })

        cases.append({
            "case_id": real_cid,
            "work_items": work_items,
            "_first": _start(case_steps[0]) if case_steps else "",
        })

    # Real cases in first-appearance order; the Unassigned pseudo-case last.
    cases.sort(key=lambda c: (c["case_id"] is None, c["_first"]))
    for c in cases:
        del c["_first"]

    return {"cases": cases, "has_cases": saw_real_case}
