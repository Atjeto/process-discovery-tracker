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

from step_suggest import (
    auto_suggest_steps, drop_overlapping_auto_steps, steps_overlap_seconds,
)


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


# --- Excluded ranges (H6) ----------------------------------------------

def test_excluded_range_drops_events_before_suggestion():
    """Interactions inside an annotations excluded_range are dropped
    before step suggestion -- here the middle two of four."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    excluded = [{
        "start": _iso(base + timedelta(milliseconds=400)),
        "end": _iso(base + timedelta(milliseconds=1100)),
        "reason": "manual",
    }]
    steps = auto_suggest_steps(events, session_id="s1", excluded_ranges=excluded)
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 2


def test_excluded_range_can_remove_a_whole_step():
    """An excluded range covering every interaction yields no steps."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    excluded = [{
        "start": _iso(base - timedelta(seconds=1)),
        "end": _iso(base + timedelta(seconds=10)),
        "reason": "manual",
    }]
    steps = auto_suggest_steps(events, session_id="s1", excluded_ranges=excluded)
    assert steps == []


def test_malformed_excluded_range_is_ignored():
    """A range missing start/end must not crash or drop events."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(
        events, session_id="s1", excluded_ranges=[{"reason": "manual"}])
    assert len(steps) == 1


# --- Step overlap (I37) ------------------------------------------------

def _step(state, start, end):
    return {"step_id": str(uuid.uuid4()), "state": state,
            "time_range": {"start": start, "end": end}}


def test_steps_overlap_seconds_measures_intersection():
    a = _step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")
    b = _step("manually_authored", "2026-05-14T09:00:30Z", "2026-05-14T09:02:00Z")
    assert steps_overlap_seconds(a, b) == 30.0


def test_steps_overlap_seconds_zero_when_disjoint():
    a = _step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")
    c = _step("manually_authored", "2026-05-14T10:00:00Z", "2026-05-14T10:01:00Z")
    assert steps_overlap_seconds(a, c) == 0.0


def test_drop_overlapping_auto_steps_drops_heavy_overlap():
    """A fresh auto step >50% covered by an analyst-owned step is dropped."""
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T09:00:00Z", "2026-05-14T09:00:50Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(dropped) == 1
    assert kept == []


def test_drop_overlapping_auto_steps_keeps_light_overlap():
    """20s overlap on a 60s fresh step = 33% < 50% -- kept."""
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T09:00:40Z", "2026-05-14T09:05:00Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(kept) == 1
    assert dropped == []


def test_drop_overlapping_auto_steps_keeps_disjoint():
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T11:00:00Z", "2026-05-14T11:01:00Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(kept) == 1
    assert dropped == []


# --- Suggestion reason (I5) --------------------------------------------

def test_auto_step_carries_a_suggestion_reason():
    """An auto-suggested step explains why its interactions were grouped."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    reason = steps[0]["suggestion_reason"]
    assert "Grouped 4 interactions" in reason
    assert "threshold" in reason
