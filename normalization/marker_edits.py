"""Replay annotation marker edits onto the derived event stream (§9.3 b).

Extracted from normalize.py (god-file decomposition, continues F4). This is the
marker-edit replay stage: it reads annotations.json.marker_edits and produces a
DERIVED event stream with renames / re-times / deletes / synthetic inserts
applied. Raw events.jsonl is never modified. normalize.py re-imports
apply_marker_edits, so `from normalize import apply_marker_edits` and the
internal call site keep resolving unchanged.
"""
from __future__ import annotations

import uuid as _uuid
from typing import Any


def apply_marker_edits(
    events: list[dict[str, Any]],
    annotations: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    """§9.3 option b: apply annotation overrides during normalization.

    Supported edit shapes (last-write-wins per event_id+field/op):
      { event_id, field: "label", value }       - rename
      { event_id, field: "timestamp", value }   - adjust marker timestamp
      { event_id, op: "delete" }                - drop the marker entirely
      { op: "insert", marker_type, label,
        timestamp, id }                          - insert synthetic marker

    Insert edits create a derived marker with event_id "insert-<id>" so
    downstream consumers can distinguish synthetic from captured markers.

    Returns (edited_events, applied_count). Raw events.jsonl never
    modified; this builds a derived stream that downstream stages walk.
    """
    edits = (annotations or {}).get("marker_edits") or []
    if not edits:
        return events, 0
    label_over: dict[str, Any] = {}
    ts_over: dict[str, Any] = {}
    deleted: set[str] = set()
    inserts: list[dict[str, Any]] = []
    session_id_hint = next((e.get("session_id") for e in events if e.get("session_id")), None)
    for e in edits:
        if e.get("op") == "insert":
            ts = e.get("timestamp")
            if not ts:
                continue
            edit_id = e.get("id") or str(_uuid.uuid4())
            inserts.append({
                "event_id": f"insert-{edit_id}",
                "type": "marker",
                "timestamp": ts,
                "session_id": session_id_hint or "",
                "data": {
                    "marker_type": e.get("marker_type", "start"),
                    "label": e.get("label"),
                    "synthetic": True,
                    "edit_id": edit_id,
                },
            })
            continue
        evid = e.get("event_id")
        if not evid:
            continue
        if e.get("op") == "delete":
            deleted.add(evid)
            continue
        field = e.get("field")
        if field == "label":
            label_over[evid] = e.get("value")
        elif field == "timestamp":
            ts_over[evid] = e.get("value")
    applied = 0
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "marker":
            out.append(ev)
            continue
        evid = ev.get("event_id")
        if evid in deleted:
            applied += 1
            continue
        new_label = label_over.get(evid)
        new_ts = ts_over.get(evid)
        if new_label is None and new_ts is None:
            out.append(ev)
            continue
        new_ev = dict(ev)
        new_data = dict(ev["data"])
        if new_label is not None:
            new_data["label"] = new_label
        new_ev["data"] = new_data
        if new_ts is not None:
            new_ev["timestamp"] = new_ts
        out.append(new_ev)
        applied += 1
    if inserts:
        out.extend(inserts)
        applied += len(inserts)
    # If we changed any timestamps OR inserted markers, sort again so downstream sees order
    if ts_over or inserts:
        out.sort(key=lambda e: (e.get("timestamp", ""), e.get("_seq", 0)))
    return out, applied
