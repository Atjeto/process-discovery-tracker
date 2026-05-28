"""Waste classifier -- IMPROVEMENTS.md Cluster N, I74 + I81.

Classifies each step's elapsed time as value-add / business-required
non-value-add / non-value-add (waste), and tags the DOWNTIME waste
types present.

v1 honesty: the VA vs BNVA distinction needs domain judgement the tool
does not have, so the heuristic puts all active-processing time in
`va_ms` and leaves `bnva_ms` at 0 -- the analyst reclassifies it through
`analysis_overrides[]` in annotations.json. What the tool
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
    overrides_by_process_label,
    overrides_by_step,
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


def _apply_waste_override(entry: dict[str, Any], ov: dict[str, Any]) -> None:
    """Apply one analyst `analysis_overrides[]` entry onto a waste row,
    in place. The analyst value wins; `va_ms` is recomputed so the
    va/bnva/nva split still sums to `elapsed_ms`."""
    wt = ov.get("waste_types")
    if isinstance(wt, list):
        entry["waste_types"] = [str(t) for t in wt]
    if "bnva_ms" in ov:
        try:
            bnva = round(float(ov["bnva_ms"]))
        except (TypeError, ValueError):
            return
        elapsed = entry["elapsed_ms"]
        nva = entry["nva_ms"]
        bnva = max(0, min(bnva, max(0, elapsed - nva)))
        entry["bnva_ms"] = bnva
        entry["va_ms"] = max(0, elapsed - bnva - nva)


def classify_waste(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]],
    stats: dict[str, Any],
    segments: dict | None = None,
    annotations: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if segments is None:
        segments = segment_steps(steps, events)
    by_id = {e.get("event_id"): e for e in events if e.get("event_id")}
    ovr = overrides_by_step(annotations)
    # Grouped 'Waste by step' rows in the Analysis view write overrides keyed
    # by process_label (the value-free step-type key); they propagate to every
    # instance of that step type, while a per-step_id override (more specific)
    # still wins.
    ovr_pl = overrides_by_process_label(annotations)

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

        pl = step.get("process_label") or ""
        entry = {
            "step_id": sid,
            "name": step.get("name") or "",
            "process_label": pl,
            "elapsed_ms": round(elapsed),
            "va_ms": round(active),
            "bnva_ms": 0,
            "nva_ms": round(waiting + switching),
            "waste_types": waste_types,
            "cross_app_transfers": transfers,
        }
        # Per-step_id override wins; otherwise the process_label-scoped override
        # propagates to this instance.
        ov = ovr.get(sid)
        if ov is None and pl:
            ov = ovr_pl.get(pl)
        if ov is not None:
            _apply_waste_override(entry, ov)
        out.append(entry)
    return out
