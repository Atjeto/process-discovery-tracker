"""Time study -- IMPROVEMENTS.md Cluster N, I75.

Per logical step (grouped by `canonical_step_id` when a process
template was matched; otherwise each step stands alone), cycle-time
statistics across instances plus the active / waiting / switching
breakdown.

A single-session recording usually has one instance per step, so the
distribution collapses (mean == min == max, stdev == 0). The statistics
become meaningful once a session holds repeated cases, or once Compare
Sessions aggregates several recordings of the same process.
"""

from __future__ import annotations

from statistics import pstdev
from typing import Any

from analysis_common import (
    percentile,
    segment_steps,
    step_group_key,
    step_group_label,
)


def compute_time_study(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]] | None = None,
    segments: dict | None = None,
) -> list[dict[str, Any]]:
    if segments is None:
        segments = segment_steps(steps, events or [])

    groups: dict[str, list[dict]] = {}
    for step in steps:
        groups.setdefault(step_group_key(step), []).append(step)

    out = []
    for group in groups.values():
        segs = [segments.get(s.get("step_id")) or {} for s in group]
        elapsed = [s.get("elapsed_ms", 0.0) for s in segs]
        rep = group[0]
        out.append({
            "step_id": rep.get("step_id"),
            "canonical_step_id": rep.get("canonical_step_id"),
            "name": step_group_label(rep),
            "instances": len(group),
            "cycle_ms": {
                "mean": round(sum(elapsed) / len(elapsed)) if elapsed else 0,
                "min": round(min(elapsed)) if elapsed else 0,
                "max": round(max(elapsed)) if elapsed else 0,
                "stdev": round(pstdev(elapsed)) if len(elapsed) > 1 else 0,
                "p25": round(percentile(elapsed, 25)),
                "p50": round(percentile(elapsed, 50)),
                "p75": round(percentile(elapsed, 75)),
                "p95": round(percentile(elapsed, 95)),
            },
            "active_ms": round(sum(s.get("active_ms", 0.0) for s in segs)),
            "waiting_ms": round(sum(s.get("waiting_ms", 0.0) for s in segs)),
            "switching_ms": round(sum(s.get("switching_ms", 0.0) for s in segs)),
        })
    out.sort(key=lambda r: -r["cycle_ms"]["mean"])
    return out
