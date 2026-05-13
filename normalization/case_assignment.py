"""Case-ID assignment from the raw marker stream (§5.2).

Walks the marker stream, builds the case tree, and stamps every
activity event with its `case_ids` list (innermost first). Activity
events captured outside any open marker get an empty list.

Raw marker events carry no case_id at capture time -- the capture
layer writes start/end + label; case identity is fully derived here.
"""

from __future__ import annotations

import uuid
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
        elif etype == "activity":
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
