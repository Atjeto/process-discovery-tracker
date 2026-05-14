"""Smoke tests for the step auto-suggestion pass.

Run with:
    pytest normalization/test/test_step_suggest.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import auto_suggest_steps


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _make_inter(ts: datetime, kind: str = "invoked", window: str = "App", proc: str = "app.exe", name: str = "Button"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "session_id": "s1",
        "data": {
            "kind": kind,
            "window_title": window,
            "process_name": proc,
            "name": name,
            "case_ids": ["case-1"],
        },
    }


def test_groups_contiguous_interactions_into_one_step():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert steps[0]["state"] == "auto_suggested"
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 4


def test_splits_on_idle_gap():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base),
        _make_inter(base + timedelta(milliseconds=200)),
        # 5s idle gap (> step_split_idle_ms=3000)
        _make_inter(base + timedelta(seconds=10)),
        _make_inter(base + timedelta(seconds=10, milliseconds=200)),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2


def test_splits_on_window_change():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base, window="Window A"),
        _make_inter(base + timedelta(milliseconds=200), window="Window A"),
        _make_inter(base + timedelta(milliseconds=400), window="Window B"),
        _make_inter(base + timedelta(milliseconds=600), window="Window B"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2


def test_drops_singletons_below_min_threshold():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert steps == []
