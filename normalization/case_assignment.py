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
    """Detect cases by ACTIVE-CASE stamping (NEXT-SESSION §2, option C).

    interactions: COALESCED, timestamp-sorted interaction events.

    The anchor field (e.g. the serial-search box) names a case. A `case_id` is
    STABLE PER LABEL -- re-searching the same serial RESUMES that case rather
    than opening a new one. This is what stops a worker re-searching two
    serials from inflating into a dozen "cases". The *active* case is whichever
    anchor fired most recently, and every following interaction is attributed
    to it; because work interleaves (search A -> ... -> search B -> ... ->
    search A again), a case owns a list of disjoint active `segments` rather
    than one contiguous range.

    Supersedes the old open/close-by-gap model: `min_gap_ms` /
    `close_on_pause_ms` no longer split a same-label case (a pause is just a
    pause; the case resumes on the next anchor). Two new optional keys drive a
    degenerate-case guard that drops slivers (an accidental anchor fire):
    `min_case_interactions` (default 2) and `min_case_duration_ms` (default
    1000). A case below EITHER threshold is discarded.

    Returns a list (first-seen order) of
    {case_id, label, start_ts, end_ts, segments, interaction_count}.
    `segments` is a list of [start_ts, end_ts] half-open active intervals; the
    final segment of the last-active case has end_ts None (open to stream end).
    """
    label_field = anchor_cfg.get("case_label_from", "value")
    min_interactions = anchor_cfg.get("min_case_interactions", 2)
    min_duration_ms = anchor_cfg.get("min_case_duration_ms", 1000)

    cases: dict[str, dict[str, Any]] = {}   # case_id -> record
    order: list[str] = []                   # case_ids in first-seen order
    active_id: str | None = None

    def case_for(label: str) -> dict[str, Any]:
        cid = str(uuid.uuid5(_ANCHOR_NS, label))
        c = cases.get(cid)
        if c is None:
            c = {
                "case_id": cid, "label": label,
                "start_ts": None, "end_ts": None,
                "segments": [], "interaction_count": 0,
            }
            cases[cid] = c
            order.append(cid)
        return c

    for ev in interactions:
        ts_str = ev.get("timestamp", "")
        data = ev.get("data", {})

        if _anchor_field_matches(data, anchor_cfg):
            label = str(data.get(label_field) or "")
            # An empty serial box does not name a ticket: a focus/click on the
            # search field before anything is typed fires the anchor with no
            # value. Ignoring it keeps the work attributed to the ticket in
            # progress, instead of opening a throwaway empty-label case that the
            # degenerate guard later drops -- which would orphan every
            # interaction stamped to it.
            if label:
                c = case_for(label)
                if active_id != c["case_id"]:
                    # Switch of active case: close the prior segment at this ts
                    # (half-open) and open a fresh segment for the new active case.
                    if active_id is not None:
                        cases[active_id]["segments"][-1][1] = ts_str
                    c["segments"].append([ts_str, None])
                    active_id = c["case_id"]
                if c["start_ts"] is None:
                    c["start_ts"] = ts_str

        if active_id is not None:
            c = cases[active_id]
            c["end_ts"] = ts_str
            c["interaction_count"] += 1

    # Degenerate-case guard: drop slivers (an accidental anchor fire produces a
    # one-interaction / sub-second "case" that is noise, not a ticket).
    kept: list[dict[str, Any]] = []
    for cid in order:
        c = cases[cid]
        dur_ms = 0.0
        if c["start_ts"] and c["end_ts"]:
            dur_ms = (_parse_ts(c["end_ts"]) - _parse_ts(c["start_ts"])
                      ).total_seconds() * 1000
        if c["interaction_count"] < min_interactions or dur_ms < min_duration_ms:
            continue
        kept.append(c)
    return kept


def stamp_anchor_cases(
    events: list[dict[str, Any]],
    anchor_cases: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Stamp case_ids on events from ACTIVE-CASE segments.

    Each event is attributed to the case whose active segment contains its
    timestamp -- half-open [start, end); the final open segment (end None) runs
    to the end of the stream. This realises "stamp to the most-recent preceding
    anchor" and is correct when cases interleave, since one case can own
    several disjoint segments. Stamps both interaction AND activity events.

    Back-compat: a case dict carrying no `segments` is treated as one segment
    spanning [start_ts, end_ts]. Returns (stamped_events, cases_map) where
    cases_map has the same shape as collect_cases() output.
    """
    # Flatten every case's active segments into a single lookup, keeping case
    # identity. Segments are non-overlapping by construction.
    segments: list[tuple[datetime, datetime | None, str]] = []
    for c in anchor_cases:
        segs = c.get("segments") or [[c.get("start_ts"), c.get("end_ts")]]
        for s, e in segs:
            if not s:
                continue
            segments.append((
                _parse_ts(s),
                _parse_ts(e) if e else None,
                c["case_id"],
            ))

    cases_map: dict[str, dict[str, Any]] = {}
    for c in anchor_cases:
        cases_map[c["case_id"]] = {
            "case_id": c["case_id"],
            "label": c["label"],
            "parent_case_id": None,
            "start_ts": c.get("start_ts"),
            "end_ts": c.get("end_ts"),
            "end_reason": "anchor_boundary",
            "activity_event_ids": [],
        }

    def case_at(ts: datetime) -> str | None:
        for cs, ce, cid in segments:
            if cs <= ts and (ce is None or ts < ce):
                return cid
        return None

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

        matched_case = case_at(ts)
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
