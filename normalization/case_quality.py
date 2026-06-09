"""Case-quality block for analysis.json (lab-phase spec §A1).

The honesty architecture's gatekeeper: every Tier-2 (case-based) surface
-- cycle times, variants, per-case comparison -- renders only when this
block says the case segmentation is trustworthy. Three modes:

  markers      -- cases came from worker-fired Start/End markers.
  anchor       -- cases were stamped by a case anchor (a Process
                  Template `case_anchor` or an accepted
                  `case_anchor_override`, ADR-0018).
  unsegmented  -- no cases at all; downstream case analysis would be
                  one meaningless default bucket.

`coverage` is the fraction of interaction events inside a case (their
stamped `case_ids` is non-empty). `tier2_unlocked` is the single gate
consumers check: mode != unsegmented AND coverage >= 0.7.

Pure stdlib; computed from the case-stamped event stream the pipeline
already has, written into analysis.json by pipeline_stages._run_analysis
(additive key -- nothing existing changes shape).
"""
from __future__ import annotations

from typing import Any

# Tier-2 unlock threshold: below this, too much of the observed work sits
# outside any case for per-case statistics to describe the session honestly.
COVERAGE_THRESHOLD = 0.7


def _has_anchor_config(annotations: dict | None, canonical: dict | None) -> bool:
    """Mirror the pipeline's anchor precedence (pipeline_stages
    ._run_case_assignment): a template `case_anchor` wins, else an
    analyst-accepted `case_anchor_override`. Either one means the cases
    (if any) were anchor-stamped, not marker-derived."""
    if isinstance(canonical, dict) and canonical.get("case_anchor"):
        return True
    if isinstance(annotations, dict):
        override = annotations.get("case_anchor_override")
        if isinstance(override, dict):
            # The same validity bar coerce_anchor_override applies.
            if isinstance(override.get("field"), str) or override.get("recognized"):
                return True
    return False


def _anchor_display(annotations: dict | None, canonical: dict | None) -> dict[str, Any]:
    """The {field_property, field_value} pair the viewer badge shows.
    For a field/equals config that is (property, value); a template
    `recognized` anchor has no literal value, so field_value carries the
    recognized kind."""
    cfg = None
    if isinstance(canonical, dict) and isinstance(canonical.get("case_anchor"), dict):
        cfg = canonical["case_anchor"]
    elif isinstance(annotations, dict) and isinstance(annotations.get("case_anchor_override"), dict):
        cfg = annotations["case_anchor_override"]
    cfg = cfg or {}
    return {
        "field_property": cfg.get("field") or ("recognized" if cfg.get("recognized") else ""),
        "field_value": cfg.get("equals") or cfg.get("recognized") or "",
    }


def compute_case_quality(
    events: list[dict[str, Any]],
    cases: Any,
    annotations: dict | None = None,
    canonical: dict | None = None,
) -> dict[str, Any]:
    """Build the `analysis.case_quality` block.

    `events` is the case-stamped derived stream (interactions carry
    `data.case_ids`); `cases` is whatever the case-assignment stage
    produced (a dict keyed by case_id in marker mode, a list in anchor
    mode -- only its length is read here).
    """
    case_count = len(cases) if cases else 0

    interactions = [
        e for e in (events or [])
        if isinstance(e, dict) and e.get("type") == "interaction"
    ]
    total = len(interactions)
    in_case = 0
    for ev in interactions:
        data = ev.get("data")
        if isinstance(data, dict) and data.get("case_ids"):
            in_case += 1
    coverage = round(in_case / total, 3) if total else 0.0

    if case_count == 0:
        mode = "unsegmented"
    elif _has_anchor_config(annotations, canonical):
        mode = "anchor"
    else:
        mode = "markers"

    block: dict[str, Any] = {
        "mode": mode,
        "case_count": case_count,
        "coverage": coverage,
        "tier2_unlocked": mode != "unsegmented" and coverage >= COVERAGE_THRESHOLD,
    }
    if mode == "anchor":
        block["anchor"] = _anchor_display(annotations, canonical)
    return block
