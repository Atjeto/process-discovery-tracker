"""Auto-suggest steps from interaction events when no canonical set
exists or no canonical match fires. See annotation-model.md §4.1.
"""

from __future__ import annotations
import uuid
from typing import Any
from datetime import datetime


def parse_ts(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def auto_suggest_steps(
    events: list[dict[str, Any]],
    *,
    step_split_idle_ms: int = 3000,
    step_max_interactions: int = 12,
    step_min_interactions: int = 2,
    step_max_idle_ms: int = 5000,
    session_id: str = "",
) -> list[dict[str, Any]]:
    """Walk interaction events in time order within each case. Produce
    auto_suggested steps per the algorithm in annotation-model.md §4.1.
    """
    # Group by top-level case (last case_id in case_ids list, or None)
    by_case: dict[str | None, list[dict[str, Any]]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        cids = ev.get("data", {}).get("case_ids") or []
        top = cids[-1] if cids else None
        by_case.setdefault(top, []).append(ev)

    steps: list[dict[str, Any]] = []
    for case_id, case_events in by_case.items():
        case_events.sort(key=lambda e: e["timestamp"])
        candidate: list[dict[str, Any]] = []
        last_ts: datetime | None = None
        last_window: str | None = None
        last_process: str | None = None

        def flush():
            if len(candidate) < step_min_interactions:
                candidate.clear()
                return
            steps.append({
                "step_id": str(uuid.uuid4()),
                "session_id": session_id,
                "case_id": case_id,
                "name": _default_step_name(candidate),
                "description": "",
                "time_range": {
                    "start": candidate[0]["timestamp"],
                    "end": candidate[-1]["timestamp"],
                },
                "evidence": {
                    "interaction_event_ids": [ev["event_id"] for ev in candidate],
                    "screenshot_refs": [],
                    "video_timecode_range": None,
                    "manual_notes": "",
                },
                "state": "auto_suggested",
                "canonical_step_id": None,
                "flags": {
                    "conditional": False, "condition_text": None,
                    "exception_path": False, "waste": False,
                    "automation_candidate": False,
                },
                "phase_id": None,
            })
            candidate.clear()

        for ev in case_events:
            data = ev["data"]
            ts = parse_ts(ev["timestamp"])
            window = data.get("window_title") or ""
            proc = data.get("process_name") or ""
            split = False
            if candidate:
                gap_ms = (ts - last_ts).total_seconds() * 1000
                if gap_ms > step_split_idle_ms: split = True
                elif window != last_window: split = True
                elif proc != last_process: split = True
                elif len(candidate) >= step_max_interactions: split = True
            if split:
                flush()
            candidate.append(ev)
            last_ts = ts
            last_window = window
            last_process = proc
        flush()

    return steps


def _default_step_name(interactions: list[dict[str, Any]]) -> str:
    last = interactions[-1]["data"]
    window = last.get("window_title") or ""
    if last.get("kind") == "invoked" and last.get("name"):
        return f"{window}: {last['name']}".strip(": ")
    # build a brief summary
    kinds = [i["data"].get("kind") for i in interactions]
    if all(k == "value_changed" for k in kinds):
        return f"{window}: Fill {len(interactions)} fields"
    return f"{window}: {len(interactions)} actions"
