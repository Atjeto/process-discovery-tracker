"""Marker-free case-boundary inference (ADR-0029).

Sessions with no analyst-supplied case anchor and no start/end markers are
the worst-case input — the rest of the pipeline still produces work-content
steps, but the case axis is missing. This module proposes candidate case
spans from three heuristic signals (idle gaps, app-return patterns, and
high-frequency motif starts) and returns a confidence band per inferred
case so the Cockpit can degrade honestly when the structure is shaky.

If the session already has real anchors (`case_anchor_override` in
`existing_anno`) or marker events (start/end), the layer reports
`case_inference_used: false` and skips inference — the real signal is
authoritative.

Pure stdlib.
"""
from __future__ import annotations

from typing import Any

# Heuristic thresholds. All in milliseconds.
_IDLE_GAP_MS = 3 * 60 * 1000  # 3 minutes — the spec's idle-gap threshold.


def _parse_ts_safe(ts: str | None):
    """Same defensive ISO parse used by anomaly + clustering; returns None on
    bad input rather than propagating an exception."""
    if not ts:
        return None
    try:
        from _dt import parse_ts_or_epoch as parse_ts
    except Exception:
        return None
    try:
        return parse_ts(ts)
    except Exception:
        return None


def _has_real_anchors(existing_anno: dict[str, Any] | None) -> bool:
    """True if the analyst has accepted a case anchor — the real signal is
    authoritative and inference must defer."""
    if not isinstance(existing_anno, dict):
        return False
    override = existing_anno.get("case_anchor_override")
    return isinstance(override, dict) and bool(override)


def _has_real_markers(events: list[dict[str, Any]]) -> bool:
    """True if the session has at least one start/end marker event."""
    for ev in events or []:
        if ev.get("type") != "marker":
            continue
        mtype = (ev.get("data") or {}).get("marker_type")
        if mtype in ("start", "end"):
            return True
    return False


def _interaction_app(ev: dict[str, Any]) -> str:
    """Best-available app key for an interaction event (process_name, .exe
    stripped, lowercased). Empty string when missing."""
    proc = ((ev.get("data") or {}).get("process_name") or "").strip().lower()
    if proc.endswith(".exe"):
        proc = proc[:-4]
    return proc


def _idle_gap_boundaries(events: list[dict[str, Any]]) -> list[str]:
    """ISO timestamps where an idle gap > 3 minutes opens between two adjacent
    interactions. The boundary is stamped at the START of the post-gap event
    (the start of the new candidate case)."""
    interactions = [
        e for e in events or []
        if e.get("type") == "interaction" and e.get("timestamp")
    ]
    interactions.sort(key=lambda e: e["timestamp"])
    boundaries: list[str] = []
    for prev, curr in zip(interactions, interactions[1:]):
        a = _parse_ts_safe(prev.get("timestamp"))
        b = _parse_ts_safe(curr.get("timestamp"))
        if not a or not b:
            continue
        gap_ms = (b - a).total_seconds() * 1000.0
        if gap_ms >= _IDLE_GAP_MS:
            boundaries.append(curr["timestamp"])
    return boundaries


def _app_return_boundaries(events: list[dict[str, Any]]) -> list[str]:
    """Boundaries where the user returns to an app they used earlier after
    visiting a different app in between (A → B → A). The boundary is stamped
    at the second occurrence of A."""
    interactions = [
        e for e in events or []
        if e.get("type") == "interaction" and e.get("timestamp")
    ]
    interactions.sort(key=lambda e: e["timestamp"])
    boundaries: list[str] = []
    last_seen: dict[str, int] = {}
    # Track the apps visited since each app's last occurrence.
    seen_since: dict[str, set[str]] = {}
    for idx, ev in enumerate(interactions):
        app = _interaction_app(ev)
        if not app:
            continue
        if app in last_seen:
            others = seen_since.get(app, set())
            if others:
                boundaries.append(ev["timestamp"])
        last_seen[app] = idx
        seen_since[app] = set()
        # Mark this app as seen-since-last for every OTHER known app.
        for other in list(seen_since.keys()):
            if other != app:
                seen_since[other].add(app)
    return boundaries


def _motif_start_boundaries(steps: list[dict[str, Any]]) -> list[str]:
    """High-frequency motif STARTS as boundaries. A motif start is the first
    occurrence of a step whose `process_label` is one of the top-3 most common
    labels in the session and that follows a step with a different label —
    i.e. the start of a "new run" of the repeated pattern."""
    if not steps:
        return []
    label_counts: dict[str, int] = {}
    for s in steps:
        lbl = (s.get("process_label") or "").strip()
        if lbl:
            label_counts[lbl] = label_counts.get(lbl, 0) + 1
    if not label_counts:
        return []
    top_labels = {
        lbl for lbl, _ in sorted(label_counts.items(), key=lambda kv: -kv[1])[:3]
    }
    ordered = sorted(steps, key=lambda s: ((s.get("time_range") or {}).get("start") or ""))
    boundaries: list[str] = []
    prev_label: str | None = None
    for s in ordered:
        lbl = (s.get("process_label") or "").strip()
        if lbl and lbl in top_labels and lbl != prev_label:
            start = (s.get("time_range") or {}).get("start")
            if start:
                boundaries.append(start)
        prev_label = lbl
    return boundaries


def _merge_boundaries(
    idle: list[str],
    app_return: list[str],
    motif: list[str],
) -> tuple[list[str], dict[str, list[str]]]:
    """Combine the three boundary streams, return a sorted unique list and a
    map from each boundary timestamp to the list of reasons it fired."""
    reasons_by_ts: dict[str, list[str]] = {}
    for ts in idle:
        reasons_by_ts.setdefault(ts, []).append("idle_gap")
    for ts in app_return:
        reasons_by_ts.setdefault(ts, []).append("app_return")
    for ts in motif:
        reasons_by_ts.setdefault(ts, []).append("motif_start")
    return sorted(reasons_by_ts.keys()), reasons_by_ts


def _session_bounds(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]],
) -> tuple[str | None, str | None]:
    """First and last ISO timestamp anywhere in the session — used to bookend
    the inferred case spans when no explicit start/end is otherwise known."""
    timestamps: list[str] = []
    for ev in events or []:
        ts = ev.get("timestamp")
        if ts:
            timestamps.append(ts)
    for s in steps or []:
        tr = s.get("time_range") or {}
        if tr.get("start"):
            timestamps.append(tr["start"])
        if tr.get("end"):
            timestamps.append(tr["end"])
    if not timestamps:
        return None, None
    timestamps.sort()
    return timestamps[0], timestamps[-1]


def _confidence_for_reasons(reasons: list[str]) -> float:
    """A case span supported by all three signals deserves higher confidence
    than one supported by just one. Caps at 0.85 — no inference is certain."""
    distinct = set(reasons)
    if len(distinct) >= 3:
        return 0.85
    if len(distinct) == 2:
        return 0.7
    return 0.5


def infer_cases(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    existing_anno: dict[str, Any] | None,
) -> dict[str, Any]:
    """Propose case spans for a marker-and-anchor-free session. Returns the
    full block dict described in the spec — empty `inferred_cases` and
    `case_inference_used: false` whenever a real signal already exists.
    """
    used = not (_has_real_anchors(existing_anno) or _has_real_markers(events))
    if not used:
        return {
            "inferred_cases": [],
            "case_inference_used": False,
            "confidence": 0.0,
        }

    idle = _idle_gap_boundaries(events)
    app_return = _app_return_boundaries(events)
    motif = _motif_start_boundaries(steps)
    if not (idle or app_return or motif):
        return {
            "inferred_cases": [],
            "case_inference_used": True,
            "confidence": 0.0,
        }

    boundaries, reasons_by_ts = _merge_boundaries(idle, app_return, motif)
    session_start, session_end = _session_bounds(events, steps)
    if not session_start or not session_end:
        return {
            "inferred_cases": [],
            "case_inference_used": True,
            "confidence": 0.0,
        }

    # Slice the session into case spans at the boundaries. Each span runs from
    # one boundary to the next; the first span starts at the session start,
    # the last ends at the session end.
    bounded = [session_start] + boundaries + [session_end]
    # De-dup adjacent equal timestamps so a boundary exactly on the session
    # start doesn't create a zero-length lead span.
    deduped: list[str] = []
    for ts in bounded:
        if not deduped or deduped[-1] != ts:
            deduped.append(ts)

    inferred: list[dict[str, Any]] = []
    confidences: list[float] = []
    for start, end in zip(deduped, deduped[1:]):
        # A span's reason set is whatever fired AT its starting boundary;
        # the session-start anchor itself carries no reason — it inherits the
        # next boundary's reasons when one exists, else falls back to a label.
        reason_list = reasons_by_ts.get(start, []) or ["session_start"]
        reason = "_plus_".join(sorted(set(reason_list)))
        conf = _confidence_for_reasons(reason_list)
        confidences.append(conf)
        inferred.append({
            "start_ts": start,
            "end_ts": end,
            "confidence": round(conf, 4),
            "reason": reason,
        })

    overall = (sum(confidences) / len(confidences)) if confidences else 0.0
    return {
        "inferred_cases": inferred,
        "case_inference_used": True,
        "confidence": round(overall, 4),
    }
