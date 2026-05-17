"""Waste classifier -- IMPROVEMENTS.md Cluster N, I74 + I81.

Classifies each step's elapsed time as value-add / business-required
non-value-add / non-value-add (waste), and tags the DOWNTIME waste
types present.

v1 honesty: the VA vs BNVA distinction needs domain judgement the tool
does not have, so v1 puts all active-processing time in `va_ms` and
leaves `bnva_ms` at 0 -- the analyst reclassifies later. What the tool
*can* detect well is waste: idle waiting, app-switch motion, rework,
and cross-app overprocessing. `waste_types` is the qualitative signal;
`nva_ms` quantifies the cleanly measurable part (waiting + switching).
"""

from __future__ import annotations

from typing import Any

from analysis_common import (
    TRANSFER_MIN_LEN,
    TRANSFER_WINDOW_MS,
    norm_value,
    parse_ts,
    segment_steps,
)


def _step_interactions(step: dict, by_id: dict) -> list[dict]:
    ids = ((step.get("evidence") or {}).get("interaction_event_ids")) or []
    evs = [by_id[i] for i in ids if i in by_id]
    evs.sort(key=lambda e: e.get("timestamp") or "")
    return evs


def count_cross_app_transfers(interactions: list[dict[str, Any]]) -> int:
    """Count value-bearing interactions whose value reappears in a
    different app within TRANSFER_WINDOW_MS -- the copy-from-A,
    paste-into-B pattern (overprocessing / transport waste, I81)."""
    valued = []
    for ev in interactions:
        data = ev.get("data") or {}
        val = norm_value(data.get("value"))
        if len(val) < TRANSFER_MIN_LEN:
            continue
        ts = parse_ts(ev.get("timestamp"))
        if ts is None:
            continue
        valued.append((ts, data.get("process_name") or "", val))
    valued.sort(key=lambda t: t[0])
    transfers = 0
    for i, (ts_i, app_i, val_i) in enumerate(valued):
        for (ts_j, app_j, val_j) in valued[i + 1:]:
            gap = (ts_j - ts_i).total_seconds() * 1000.0
            if gap > TRANSFER_WINDOW_MS:
                break
            if app_i and app_j and app_i != app_j and val_i == val_j:
                transfers += 1
                break
    return transfers


def classify_waste(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]],
    stats: dict[str, Any],
    segments: dict | None = None,
) -> list[dict[str, Any]]:
    if segments is None:
        segments = segment_steps(steps, events)
    by_id = {e.get("event_id"): e for e in events if e.get("event_id")}

    # Activity labels stats_compute flagged as reworked within a case.
    rework_labels = {
        r.get("activity_label")
        for r in ((stats or {}).get("rework_loops") or [])
        if r.get("activity_label")
    }
    reworked_ts = []
    if rework_labels:
        for ev in events:
            if ev.get("type") != "activity":
                continue
            if (ev.get("data") or {}).get("activity_label") in rework_labels:
                t = parse_ts(ev.get("timestamp"))
                if t is not None:
                    reworked_ts.append(t)

    out = []
    for step in steps:
        sid = step.get("step_id")
        seg = segments.get(sid) or {}
        elapsed = seg.get("elapsed_ms", 0.0)
        waiting = seg.get("waiting_ms", 0.0)
        switching = seg.get("switching_ms", 0.0)
        active = seg.get("active_ms", 0.0)

        waste_types: list[str] = []
        if waiting > 0:
            waste_types.append("waiting")
        if switching > 0 or seg.get("app_switches", 0) > 0:
            waste_types.append("motion")

        transfers = count_cross_app_transfers(_step_interactions(step, by_id))
        if transfers > 0:
            waste_types.append("overprocessing")

        if reworked_ts:
            tr = step.get("time_range") or {}
            s0 = parse_ts(tr.get("start"))
            s1 = parse_ts(tr.get("end"))
            if s0 and s1 and any(s0 <= t <= s1 for t in reworked_ts):
                waste_types.append("rework")

        out.append({
            "step_id": sid,
            "name": step.get("name") or "",
            "elapsed_ms": round(elapsed),
            "va_ms": round(active),
            "bnva_ms": 0,
            "nva_ms": round(waiting + switching),
            "waste_types": waste_types,
            "cross_app_transfers": transfers,
        })
    return out
