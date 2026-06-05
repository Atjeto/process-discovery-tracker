"""Capture-confidence gating for the Naming Layer — ADR-0023, ADR-0028.

If the underlying interaction events have low capture confidence, the
LLM is told to return "insufficient signal" rather than fabricate a
name. Higher-quality data, better names; honest absence over false
precision.
"""

from __future__ import annotations

from typing import Any

# Below this average input confidence, the Naming Layer refuses to name.
# Matches the spirit of ADR-0023 (capture-confidence is load-bearing) +
# ADR-0028 (knowing-when-to-say-IDK is a first-class output).
CAPTURE_CONFIDENCE_FLOOR = 0.4

INSUFFICIENT_SIGNAL = "insufficient signal"


def _mean(values: list[float]) -> float:
    """Stdlib-only mean; returns 0.0 on empty."""
    n = 0
    s = 0.0
    for v in values:
        if isinstance(v, (int, float)):
            s += float(v)
            n += 1
    return s / n if n else 0.0


def enough_signal(
    *,
    interactions: list[dict[str, Any]] | None = None,
    cluster: dict[str, Any] | None = None,
    floor: float = CAPTURE_CONFIDENCE_FLOOR,
) -> bool:
    """True iff the input data has enough capture confidence to defensibly
    produce an LLM-generated name. Returns False on empty input — the
    floor is fail-closed.

    Inputs can be either:
      - `interactions`: a list of recognised interaction dicts (per the
        SCHEMA.md interaction shape, with optional `confidence` field), OR
      - `cluster`: the activity-cluster dict (with `confidence` field
        already aggregated by the Pattern Layer).
    """
    if cluster is not None:
        c = cluster.get("confidence")
        if isinstance(c, (int, float)):
            return c >= floor
        return False
    if interactions:
        confidences = [
            i.get("confidence") for i in interactions
            if isinstance(i, dict)
        ]
        return _mean(confidences) >= floor
    return False
