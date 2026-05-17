"""Shared primitives for the analysis layer (IMPROVEMENTS.md Cluster N).

The analysis modules -- waste, time study, automation, efficiency --
share one piece of pre-computation the normalization pipeline does not
otherwise produce: per-step time segmentation. Given a step's
`time_range`, partition the elapsed wall-clock time into active
processing, waiting (idle), and switching (app churn).

Every threshold here is a provisional heuristic, tuned against
synthetic fixtures rather than a real 8-hour recording. Recalibrate --
and bump `HEURISTIC_VERSION` in analysis.py -- once real recording data
exists. See ADR-0008.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

# --- Tunable heuristic thresholds -------------------------------------
# An activity segment shorter than this, opening in an app different
# from the previous one, reads as motion waste -- a brief detour (a
# lookup, a copy-paste) rather than sustained work in that app.
MOTION_MS = 8000
# Two value-bearing interactions in different apps, within this window
# and carrying matching content, read as a cross-app data transfer
# (overprocessing waste -- I81).
TRANSFER_WINDOW_MS = 30000
# Shortest interaction value considered for transfer matching. Below
# this, equal values are noise (single digits, "OK", blanks).
TRANSFER_MIN_LEN = 4


def parse_ts(ts: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp, tolerating a trailing Z. None on failure."""
    if not ts:
        return None
    s = str(ts).rstrip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolated percentile over an unsorted numeric list."""
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return float(s[0])
    k = (len(s) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return float(s[f])
    return float(s[f] + (s[c] - s[f]) * (k - f))


def norm_value(v: Any) -> str:
    """Collapse whitespace and lowercase, for loose value comparison."""
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip().lower()


def _idle_intervals(events: list[dict]) -> list[tuple[datetime, datetime]]:
    """Pair idle_start / idle_end system events into [start, end] intervals."""
    intervals: list[tuple[datetime, datetime]] = []
    open_start: datetime | None = None
    for ev in events:
        if ev.get("type") != "system":
            continue
        kind = (ev.get("data") or {}).get("kind")
        if kind == "idle_start":
            open_start = parse_ts(ev.get("timestamp"))
        elif kind == "idle_end":
            end = parse_ts(ev.get("timestamp"))
            if open_start is not None and end is not None and end > open_start:
                intervals.append((open_start, end))
            open_start = None
    return intervals


def _overlap_ms(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> float:
    lo = max(a0, b0)
    hi = min(a1, b1)
    if hi <= lo:
        return 0.0
    return (hi - lo).total_seconds() * 1000.0


def empty_segment(step_id: Any) -> dict[str, Any]:
    return {
        "step_id": step_id,
        "elapsed_ms": 0.0,
        "active_ms": 0.0,
        "waiting_ms": 0.0,
        "switching_ms": 0.0,
        "app_switches": 0,
        "interaction_count": 0,
    }


def segment_step(
    step: dict[str, Any],
    events: list[dict[str, Any]],
    idle_intervals: list[tuple[datetime, datetime]] | None = None,
) -> dict[str, Any]:
    """Partition one step's elapsed time into active / waiting / switching.

    waiting   -- idle-event time intersecting the step window.
    switching -- duration of short activity segments that open a new app
                 (motion waste).
    active    -- whatever elapsed time is left.
    """
    seg = empty_segment(step.get("step_id"))
    tr = step.get("time_range") or {}
    start = parse_ts(tr.get("start"))
    end = parse_ts(tr.get("end"))
    if start is None or end is None or end <= start:
        return seg
    elapsed = (end - start).total_seconds() * 1000.0
    seg["elapsed_ms"] = elapsed

    if idle_intervals is None:
        idle_intervals = _idle_intervals(events)
    waiting = 0.0
    for (i0, i1) in idle_intervals:
        waiting += _overlap_ms(start, end, i0, i1)

    acts: list[dict[str, Any]] = []
    interactions = 0
    for ev in events:
        ts = parse_ts(ev.get("timestamp"))
        if ts is None or ts < start or ts > end:
            continue
        etype = ev.get("type")
        if etype == "activity":
            acts.append(ev)
        elif etype == "interaction":
            interactions += 1

    prev_app = None
    app_switches = 0
    switching = 0.0
    for ev in acts:
        data = ev.get("data") or {}
        app = data.get("app")
        dur = data.get("duration_ms") or 0
        if prev_app is not None and app != prev_app:
            app_switches += 1
            if 0 < dur < MOTION_MS:
                switching += dur
        prev_app = app

    waiting = min(waiting, elapsed)
    switching = min(switching, max(0.0, elapsed - waiting))
    seg["waiting_ms"] = waiting
    seg["switching_ms"] = switching
    seg["active_ms"] = max(0.0, elapsed - waiting - switching)
    seg["app_switches"] = app_switches
    seg["interaction_count"] = interactions
    return seg


def segment_steps(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> dict[Any, dict[str, Any]]:
    """`segment_step` for every step, keyed by step_id. Idle intervals
    are computed once and shared across steps."""
    idle = _idle_intervals(events)
    out: dict[Any, dict[str, Any]] = {}
    for step in steps:
        sid = step.get("step_id")
        if sid is None:
            continue
        out[sid] = segment_step(step, events, idle)
    return out
