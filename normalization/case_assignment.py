"""Case-ID assignment from markers (§5.2).

Walks the marker stream and stamps every activity event with its
`case_ids` list: the open run's case id (runs never nest, see
assign_case_ids). Activity events captured outside any open marker get
an empty list.

Raw marker events carry no case_id at capture time -- the capture
layer writes start/end + label; case identity is fully derived here.

Case identity is deterministic (RP-01, contract C9): a run's case_id is
`uuid5(CASE_ID_NAMESPACE, "<session_id>:<start marker event_id>")`, so
re-analyzing the same recording yields the same case ids and the analyst's
confirmed steps stay attached to their run. A synthetic start marker inserted
through annotations.json marker_edits carries the event id
`insert-<edit_id>` (marker_edits.py), which is equally stable.

A session without a recording (manifest.source "video" or "blank", contract
C16) that has no start marker has one implicit run covering the whole
session (add_implicit_run), so the analyst can add steps at once. Its id is
`uuid5(CASE_ID_NAMESPACE, "<session_id>:implicit-run")`. Start markers
inserted by hand replace it, exactly as in a recording. A recording keeps
the marker rule: no start marker, no runs.
"""

from __future__ import annotations

import uuid
from typing import Any

# Public re-export: test_parse_ts_consistency pins every module's parse_ts
# copy to the shared _dt contract.
from _dt import parse_ts_or_epoch as _parse_ts  # noqa: F401

# Fixed namespace for marker-run case ids. Never change it: every case_id
# already written into an annotations.json derives from it.
CASE_ID_NAMESPACE = uuid.UUID("c35db218-e350-4efb-ae74-37c31a4f697a")


def marker_case_id(session_id: str, start_event_id: str) -> str:
    """The deterministic case_id of the run opened by one start marker."""
    return str(uuid.uuid5(CASE_ID_NAMESPACE, f"{session_id}:{start_event_id}"))


# The fixed name the implicit run's id is derived from (C16). No start
# marker can carry it: recorded markers have uuid event ids and inserted
# ones "insert-<edit_id>".
IMPLICIT_RUN_NAME = "implicit-run"


def implicit_case_id(session_id: str) -> str:
    """The deterministic case_id of a session's implicit run (C16)."""
    return marker_case_id(session_id, IMPLICIT_RUN_NAME)


def needs_implicit_run(events: list[dict[str, Any]], recorded: bool) -> bool:
    """C16: a session without a recording (manifest.source "video" or
    "blank", session_io.has_recording) gets an implicit run while its
    derived stream (the marker edits applied) has no start marker. A
    recording never does."""
    if recorded:
        return False
    return not any(ev.get("type") == "marker" and _event_data(ev).get("marker_type") == "start"
                   for ev in events or [])


def add_implicit_run(
    events: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    session_id: str,
    start_ts: str | None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Add the implicit run of a session without a recording (C16): one run
    covering the whole session, open (no end), starting at `start_ts`
    (manifest.started_at). Every activity and interaction event is stamped
    with it, so anything the stream holds is inside the run. The case
    carries `implicit: True`. Returns (events, cases), both new."""
    cid = implicit_case_id(session_id)
    out: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("type") in ("activity", "interaction"):
            new_ev = dict(ev)
            new_ev["data"] = {**_event_data(ev), "case_ids": [cid]}
            out.append(new_ev)
        else:
            out.append(ev)
    run: dict[str, Any] = {
        "case_id": cid,
        "label": None,
        "parent_case_id": None,
        "start_ts": start_ts,
        "end_ts": None,
        "end_reason": None,
        "implicit": True,
    }
    activity_ids = [ev["event_id"] for ev in out if ev.get("type") == "activity"]
    if activity_ids:
        run["activity_event_ids"] = activity_ids
    return out, {**cases, cid: run}


def _event_data(ev: dict[str, Any]) -> dict[str, Any]:
    """The event's `data` payload, or `{}` if it is missing or not a dict.

    A truncated or hand-edited log can carry a null (or otherwise non-dict)
    `data` field; treating it as empty lets one bad record degrade to "uncased"
    instead of crashing the whole analysis run -- the same posture `_parse_ts`
    takes for a corrupt timestamp.
    """
    data = ev.get("data")
    return data if isinstance(data, dict) else {}


def assign_case_ids(
    events: list[dict[str, Any]],
    session_id: str = "",
) -> list[dict[str, Any]]:
    """Return a new event list with `case_ids` stamped on activity events.

    Markers and system events pass through untouched (markers also get
    `case_id` and `parent_case_id` for downstream reference; a start marker
    also gets `ends_case_id`, the run it ended, or None).

    `session_id` seeds the deterministic case ids (see marker_case_id). The
    start marker's event id alone is already unique within one recording, so
    callers without a session id (unit tests) still get stable, distinct ids.
    """
    stack: list[dict[str, Any]] = []  # entries: {case_id, label, parent_case_id, start_ts}
    out: list[dict[str, Any]] = []
    # A start marker's event id seeds its case id. A corrupt log can repeat a
    # line; the repeat is a second run, so it gets its own occurrence-suffixed
    # seed instead of silently merging into the first run's case.
    start_seen: dict[str, int] = {}

    for ev in events:
        etype = ev.get("type")
        data = _event_data(ev)
        if etype == "marker":
            mtype = data.get("marker_type")
            label = data.get("label")
            if mtype == "start":
                eid = ev.get("event_id")
                if not isinstance(eid, str) or not eid:
                    # load_events guarantees an event id on every event, so a
                    # missing one here is a caller bug, not a corrupt log.
                    raise ValueError(
                        "start marker at timestamp "
                        f"{ev.get('timestamp')!r} has no event_id; the case id "
                        "is derived from it")
                start_seen[eid] = start_seen.get(eid, 0) + 1
                seed = eid if start_seen[eid] == 1 else f"{eid}#{start_seen[eid]}"
                case_id = marker_case_id(session_id, seed)
                # Runs never nest. A Start that arrives while a run is open
                # ends that run first, as the capture app's one-key run hotkey
                # does (it writes an End with reason auto_close_for_sibling,
                # then the Start). Nesting is no longer supported because a run
                # is one pass through the process: a Start inserted in the
                # viewer while a run was open used to nest every later run
                # inside that run. No End marker is invented; the Start names
                # the run it ended (ends_case_id) and collect_cases ends it here.
                ended = stack.pop()["case_id"] if stack else None
                stack.append({
                    "case_id": case_id,
                    "label": label,
                    "parent_case_id": None,
                    "start_ts": ev["timestamp"],
                })
                # Annotate the event itself with assigned IDs
                new_ev = dict(ev)
                new_ev["data"] = {
                    **data,
                    "case_id": case_id,
                    "parent_case_id": None,
                    "ends_case_id": ended,
                }
                out.append(new_ev)
            elif mtype == "end":
                closed = stack.pop() if stack else None
                new_ev = dict(ev)
                new_ev["data"] = {
                    **data,
                    "case_id": closed["case_id"] if closed else None,
                    "parent_case_id": closed["parent_case_id"] if closed else None,
                }
                out.append(new_ev)
            else:
                out.append(ev)
        elif etype == "activity" or etype == "interaction":
            case_ids = [s["case_id"] for s in reversed(stack)]
            new_ev = dict(ev)
            new_ev["data"] = {**data, "case_ids": case_ids}
            out.append(new_ev)
        else:
            out.append(ev)

    # Any markers left open at end of stream remain unclosed -- the
    # normalization layer's caller decides policy (e.g. auto-close for
    # crash-recovered sessions). We do not invent end markers here.
    return out


def collect_cases(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build a case-id -> {label, parent_case_id, start_ts, end_ts, activities} map.
    A run that the next Start ended (runs never nest) ends at that Start, with
    the capture app's reason for it, auto_close_for_sibling."""
    cases: dict[str, dict[str, Any]] = {}
    for ev in events:
        if ev.get("type") != "marker":
            continue
        data = _event_data(ev)
        mtype = data.get("marker_type")
        case_id = data.get("case_id")
        if not case_id:
            continue
        if mtype == "start":
            ended = data.get("ends_case_id")
            if ended in cases and cases[ended]["end_ts"] is None:
                cases[ended]["end_ts"] = ev["timestamp"]
                cases[ended]["end_reason"] = "auto_close_for_sibling"
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
        cids = _event_data(ev).get("case_ids") or []
        if not cids:
            continue
        innermost = cids[0]
        if innermost in cases:
            cases[innermost].setdefault("activity_event_ids", []).append(ev["event_id"])
    return cases
