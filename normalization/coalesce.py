"""Typing-burst coalescing (v0.13 §1).

Collapses runs of consecutive value_changed/text_changed events on the same
control into one final-value event, and collapses selection_changed re-fires
into one.  Runs as pipeline stage 1a on the full event stream, before case
assignment.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from _dt import parse_ts as _parse_ts  # public re-export


def _coalesce_key(data: dict) -> str:
    """A stable-ish identity for a control, used to decide whether two
    consecutive events touched the same element.  Mirrors the recorder's
    CoalesceKey but always returns a key: identity-less web controls
    (empty automation_id *and* empty name) fall back to
    control_type + window + process, which is enough to recognise a
    keystroke run into one field."""
    pid = data.get("pid")
    aid = (data.get("automation_id") or "").strip()
    if aid:
        return f"{pid}|aid|{aid}"
    name = (data.get("name") or "").strip()
    if name:
        cls = (data.get("class_name") or "").strip()
        return f"{pid}|n|{name}|{cls}"
    ct = (data.get("control_type") or "").strip()
    win = (data.get("window_title") or "").strip()
    proc = (data.get("process_name") or "").strip()
    return f"{pid}|ct|{ct}|{win}|{proc}"


def _value_continues(prev_value, next_value) -> bool:
    """True when two consecutive value_changed values are prefix-compatible,
    meaning they represent typing (append) or backspace (shrink) within the
    same field.  Two different fields' contents are not prefix-compatible,
    so the run breaks at the field boundary without needing a per-element id."""
    pv, nv = prev_value or "", next_value or ""
    if not pv or not nv:
        return True
    return pv.startswith(nv) or nv.startswith(pv)


def coalesce_typing_bursts(
    events: list[dict[str, Any]], *, idle_ms: int = 1500,
) -> list[dict[str, Any]]:
    """Collapse runs of consecutive same-control noise events.

    Two run types are collapsed:
      * consecutive value_changed / text_changed on one control ->
        the LAST event (it carries the final, complete value);
      * consecutive selection_changed on one control reporting the
        SAME selected_value -> the FIRST event.

    A run breaks on a different event kind, a different control, a gap
    longer than idle_ms, or (for typing runs) when values are not
    prefix-compatible — meaning the user moved to a different field.

    Non-interaction events pass through and break any open run.
    """
    if len(events) < 2:
        return list(events)

    typing = ("value_changed", "text_changed")
    out: list[dict[str, Any]] = []
    run_start = 0
    run_type: str | None = None
    run_key: str | None = None
    run_count = 0

    def _flush_run(end_exclusive: int):
        nonlocal run_type, run_key, run_count
        if run_type is None:
            return
        if run_type == "typing":
            kept = events[end_exclusive - 1]
        else:
            kept = events[run_start]
        count = end_exclusive - run_start
        if count > 1:
            kept = dict(kept)
            kept["data"] = {**kept["data"], "_coalesced_count": count}
        out.append(kept)
        run_type = None
        run_key = None
        run_count = 0

    i = 0
    n = len(events)
    while i < n:
        ev = events[i]
        if ev.get("type") != "interaction":
            _flush_run(i)
            out.append(ev)
            i += 1
            continue

        data = ev.get("data", {})
        kind = data.get("kind")

        if kind in typing:
            this_run = "typing"
        elif kind == "selection_changed":
            this_run = "selection"
        else:
            _flush_run(i)
            out.append(ev)
            i += 1
            continue

        key = _coalesce_key(data)

        if run_type is not None:
            same_run = (this_run == run_type and key == run_key)
            if same_run:
                gap_ms = (_parse_ts(ev["timestamp"])
                          - _parse_ts(events[i - 1]["timestamp"])
                          ).total_seconds() * 1000
                if gap_ms > idle_ms:
                    same_run = False
                elif this_run == "typing":
                    prev_val = events[i - 1].get("data", {}).get("value")
                    cur_val = data.get("value")
                    if not _value_continues(prev_val, cur_val):
                        same_run = False
                elif this_run == "selection":
                    if ((data.get("selected_value") or "")
                            != (events[run_start].get("data", {}).get("selected_value") or "")):
                        same_run = False
            if not same_run:
                _flush_run(i)

        if run_type is None:
            run_start = i
            run_type = this_run
            run_key = key
            run_count = 1
        else:
            run_count += 1

        i += 1

    _flush_run(n)
    return out
