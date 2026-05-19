"""Case-ID assignment from markers (§5.2) and anchor-based detection (v0.13 §4).

Walks the marker stream, builds the case tree, and stamps every
activity event with its `case_ids` list (innermost first). Activity
events captured outside any open marker get an empty list.

Raw marker events carry no case_id at capture time -- the capture
layer writes start/end + label; case identity is fully derived here.

When the canonical template declares a `case_anchor`, cases are derived
from interaction patterns instead of markers -- see detect_cases_from_anchors
and stamp_anchor_cases.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any


def assign_case_ids(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a new event list with `case_ids` stamped on activity events.

    Markers and system events pass through untouched (markers also get
    `case_id` and `parent_case_id` for downstream reference).
    """
    stack: list[dict[str, Any]] = []  # entries: {case_id, label, parent_case_id, start_ts}
    out: list[dict[str, Any]] = []

    for ev in events:
        etype = ev.get("type")
        if etype == "marker":
            mtype = ev["data"].get("marker_type")
            label = ev["data"].get("label")
            if mtype == "start":
                case_id = str(uuid.uuid4())
                parent = stack[-1]["case_id"] if stack else None
                stack.append({
                    "case_id": case_id,
                    "label": label,
                    "parent_case_id": parent,
                    "start_ts": ev["timestamp"],
                })
                # Annotate the event itself with assigned IDs
                new_ev = dict(ev)
                new_ev["data"] = {
                    **ev["data"],
                    "case_id": case_id,
                    "parent_case_id": parent,
                }
                out.append(new_ev)
            elif mtype == "end":
                closed = stack.pop() if stack else None
                new_ev = dict(ev)
                new_ev["data"] = {
                    **ev["data"],
                    "case_id": closed["case_id"] if closed else None,
                    "parent_case_id": closed["parent_case_id"] if closed else None,
                }
                out.append(new_ev)
            else:
                out.append(ev)
        elif etype == "activity" or etype == "interaction":
            case_ids = [s["case_id"] for s in reversed(stack)]
            new_ev = dict(ev)
            new_ev["data"] = {**ev["data"], "case_ids": case_ids}
            out.append(new_ev)
        else:
            out.append(ev)

    # Any markers left open at end of stream remain unclosed -- the
    # normalization layer's caller decides policy (e.g. auto-close for
    # crash-recovered sessions). We do not invent end markers here.
    return out


def collect_cases(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build a case-id -> {label, parent_case_id, start_ts, end_ts, activities} map."""
    cases: dict[str, dict[str, Any]] = {}
    for ev in events:
        if ev.get("type") != "marker":
            continue
        data = ev.get("data", {})
        mtype = data.get("marker_type")
        case_id = data.get("case_id")
        if not case_id:
            continue
        if mtype == "start":
            cases[case_id] = {
                "case_id": case_id,
                "label": data.get("label"),
                "parent_case_id": data.get("parent_case_id"),
                "start_ts": ev["timestamp"],
                "end_ts": None,
                "end_reason": None,
            }
        elif mtype == "end" and case_id in cases:
            cases[case_id]["end_ts"] = ev["timestamp"]
            cases[case_id]["end_reason"] = data.get("reason")

    # Stamp activities into their innermost case
    for ev in events:
        if ev.get("type") != "activity":
            continue
        cids = ev["data"].get("case_ids") or []
        if not cids:
            continue
        innermost = cids[0]
        if innermost in cases:
            cases[innermost].setdefault("activity_event_ids", []).append(ev["event_id"])
    return cases


# --- Anchor-based case detection (v0.13 §4) ---

_ANCHOR_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def _parse_ts(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _anchor_field_matches(data: dict, anchor_cfg: dict) -> bool:
    """Check if an interaction matches the anchor field rule."""
    from canonical_match import _op_match
    field = anchor_cfg.get("field", "")
    actual = data.get(field)
    if actual is None:
        return False
    equals = anchor_cfg.get("equals")
    if equals is not None:
        if isinstance(equals, dict):
            return _op_match(equals, actual)
        return str(actual) == str(equals)
    contains = anchor_cfg.get("contains")
    if contains is not None:
        return contains in str(actual)
    starts_with = anchor_cfg.get("starts_with")
    if starts_with is not None:
        return str(actual).startswith(starts_with)
    matches = anchor_cfg.get("matches")
    if matches is not None:
        import re
        return re.search(matches, str(actual)) is not None
    return False


def detect_cases_from_anchors(
    interactions: list[dict[str, Any]],
    anchor_cfg: dict[str, Any],
) -> list[dict[str, Any]]:
    """Detect case boundaries from anchor-field interactions.

    interactions: COALESCED, timestamp-sorted interaction events.
    Returns list of {case_id, label, start_ts, end_ts}.
    """
    label_field = anchor_cfg.get("case_label_from", "value")
    min_gap_ms = anchor_cfg.get("min_gap_ms", 10000)
    close_on_pause_ms = anchor_cfg.get("close_on_pause_ms", 300000)

    cases: list[dict[str, Any]] = []
    open_case: dict[str, Any] | None = None

    for ev in interactions:
        data = ev.get("data", {})
        ts_str = ev.get("timestamp", "")
        ts = _parse_ts(ts_str)

        if _anchor_field_matches(data, anchor_cfg):
            case_label = str(data.get(label_field) or "")

            if open_case is not None:
                if case_label == open_case["label"]:
                    gap = (ts - _parse_ts(open_case["last_ts"])
                           ).total_seconds() * 1000
                    if gap <= min_gap_ms:
                        open_case["last_ts"] = ts_str
                        continue
                open_case["end_ts"] = open_case["last_ts"]
                cases.append(open_case)

            case_id = str(uuid.uuid5(_ANCHOR_NS, case_label + "|" + ts_str))
            open_case = {
                "case_id": case_id,
                "label": case_label,
                "start_ts": ts_str,
                "end_ts": ts_str,
                "last_ts": ts_str,
            }
        elif open_case is not None:
            open_case["last_ts"] = ts_str

    if open_case is not None:
        open_case["end_ts"] = open_case["last_ts"]
        cases.append(open_case)

    # Split cases with internal gaps > close_on_pause_ms
    if close_on_pause_ms and len(interactions) > 1:
        split_cases: list[dict[str, Any]] = []
        events_by_case: dict[str, list[dict]] = {}
        for c in cases:
            events_by_case[c["case_id"]] = []
        for ev in interactions:
            ts_str = ev.get("timestamp", "")
            ts = _parse_ts(ts_str)
            for c in cases:
                if _parse_ts(c["start_ts"]) <= ts <= _parse_ts(c["end_ts"]):
                    events_by_case[c["case_id"]].append(ev)
                    break

        for c in cases:
            case_evs = events_by_case.get(c["case_id"], [])
            if len(case_evs) < 2:
                split_cases.append(c)
                continue
            segments: list[list[dict]] = [[case_evs[0]]]
            for i in range(1, len(case_evs)):
                gap = (_parse_ts(case_evs[i]["timestamp"])
                       - _parse_ts(case_evs[i - 1]["timestamp"])
                       ).total_seconds() * 1000
                if gap > close_on_pause_ms:
                    segments.append([case_evs[i]])
                else:
                    segments[-1].append(case_evs[i])
            if len(segments) == 1:
                split_cases.append(c)
            else:
                for seg in segments:
                    seg_start = seg[0]["timestamp"]
                    seg_end = seg[-1]["timestamp"]
                    seg_id = str(uuid.uuid5(
                        _ANCHOR_NS, c["label"] + "|" + seg_start))
                    split_cases.append({
                        "case_id": seg_id,
                        "label": c["label"],
                        "start_ts": seg_start,
                        "end_ts": seg_end,
                        "last_ts": seg_end,
                    })
        cases = split_cases

    return cases


def stamp_anchor_cases(
    events: list[dict[str, Any]],
    anchor_cases: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Stamp case_ids on events using anchor-detected case boundaries.

    Stamps both interaction AND activity events.  Returns
    (stamped_events, cases_map) where cases_map has the same shape as
    collect_cases() output.
    """
    parsed_cases = []
    for c in anchor_cases:
        parsed_cases.append((
            _parse_ts(c["start_ts"]),
            _parse_ts(c["end_ts"]),
            c["case_id"],
        ))

    cases_map: dict[str, dict[str, Any]] = {}
    for c in anchor_cases:
        cases_map[c["case_id"]] = {
            "case_id": c["case_id"],
            "label": c["label"],
            "parent_case_id": None,
            "start_ts": c["start_ts"],
            "end_ts": c["end_ts"],
            "end_reason": "anchor_boundary",
            "activity_event_ids": [],
        }

    out: list[dict[str, Any]] = []
    for ev in events:
        etype = ev.get("type")
        if etype not in ("interaction", "activity"):
            out.append(ev)
            continue

        ts_str = ev.get("timestamp", "")
        try:
            ts = _parse_ts(ts_str)
        except (ValueError, TypeError):
            out.append(ev)
            continue

        matched_case = None
        for cs, ce, cid in parsed_cases:
            if cs <= ts <= ce:
                matched_case = cid
                break

        new_ev = dict(ev)
        new_ev["data"] = {
            **ev["data"],
            "case_ids": [matched_case] if matched_case else [],
        }
        out.append(new_ev)

        if etype == "activity" and matched_case and matched_case in cases_map:
            cases_map[matched_case]["activity_event_ids"].append(
                ev.get("event_id"))

    return out, cases_map
