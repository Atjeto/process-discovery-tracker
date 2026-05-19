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


# --- value_changed / selection coalescing (typing-noise fix) -----------

def _make_value_changed(ts, value, *, automation_id="", name="",
                        control_type="Edit", window="TAMBA",
                        proc="chrome.exe"):
    """A value_changed event. Defaults model a Chrome web-app field --
    empty automation_id AND empty name -- the case the recorder's own
    coalescer cannot key, so the keystroke flood reaches step suggestion."""
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "session_id": "s1",
        "data": {
            "kind": "value_changed",
            "control_type": control_type,
            "automation_id": automation_id,
            "name": name,
            "class_name": "",
            "window_title": window,
            "process_name": proc,
            "value": value,
            "case_ids": ["case-1"],
        },
    }


def test_typing_burst_on_identityless_control_coalesces_to_one_step():
    """A keystroke-by-keystroke value_changed flood into one Chrome field
    collapses to a single step -- not the pre-fix explosion of
    12-interaction fragments."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    text = "CE removed paper jam from receipt printer"
    events = [
        _make_value_changed(base + timedelta(milliseconds=i * 200), text[:i + 1])
        for i in range(len(text))
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 1
    assert "Enter" in steps[0]["name"]


def test_typing_burst_keeps_the_final_value():
    """The coalesced event keeps the last (complete) typed value."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "C"),
        _make_value_changed(base + timedelta(milliseconds=200), "CE"),
        _make_value_changed(base + timedelta(milliseconds=400), "CE done"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert "CE done" in steps[0]["name"]


def test_two_identityless_fields_split_by_focus_stay_separate():
    """Coalescing folds a *run* -- a focus_changed between two field
    edits breaks it, so the two fields are not merged into one."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "first field"),
        _make_value_changed(base + timedelta(milliseconds=200), "first field x"),
        _make_inter(base + timedelta(milliseconds=400), kind="focus_changed",
                    window="TAMBA", proc="chrome.exe", name=""),
        _make_value_changed(base + timedelta(milliseconds=600), "second"),
        _make_value_changed(base + timedelta(milliseconds=800), "second field"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    # two coalesced typing events + the focus event = 3 interactions
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3


def test_repeated_identical_tab_selection_collapses():
    """The OS re-fires selection_changed on a tab every time focus
    returns to it. Identical re-selections collapse to one, and a lone
    tab switch is not substantial enough to be its own step."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base + timedelta(milliseconds=i * 300),
                    kind="selection_changed", window="TAMBA -  ",
                    name="TAMBA -  ")
        for i in range(5)
    ]
    for ev in events:
        ev["data"]["control_type"] = "TabItem"
        ev["data"]["selected_value"] = "TAMBA -  "
    steps = auto_suggest_steps(events, session_id="s1")
    assert steps == []


def test_step_name_does_not_echo_app_prefix():
    """A step whose only nameable interaction is a tab switch must not be
    named 'TAMBA: TAMBA -  ' -- the tab title just echoes the app."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    tab = _make_inter(base, kind="selection_changed", window="TAMBA -  ",
                      name="TAMBA -  ")
    tab["data"]["control_type"] = "TabItem"
    tab["data"]["selected_value"] = "TAMBA -  "
    click = _make_inter(base + timedelta(milliseconds=300), kind="invoked",
                        window="TAMBA -  ", name="")
    steps = auto_suggest_steps([tab, click], session_id="s1")
    assert len(steps) == 1
    label = steps[0]["name"].split(": ", 1)[-1]
    assert "TAMBA" not in label


def test_volatile_window_title_suffix_does_not_split_steps():
    """A window-title change that is only a volatile suffix (a memory
    counter, the browser-name tail) must not start a new step -- the
    segmenter keys on the stable app prefix, not the raw title."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    titles = [
        "ES CALL MANAGEMENT - Memory usage - 95.2 MB - Work - Microsoft Edge",
        "ES CALL MANAGEMENT - Work - Microsoft Edge",
        "ES CALL MANAGEMENT - Memory usage - 96.4 MB - Work - Microsoft Edge",
    ]
    events = [
        _make_inter(base + timedelta(milliseconds=i * 300), kind="invoked",
                    window=t, proc="msedge.exe", name="Open")
        for i, t in enumerate(titles)
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3
