"""Tests for the typing-burst coalescer (v0.13 §1).

Run with:
    pytest normalization/test/test_coalesce.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coalesce import coalesce_typing_bursts


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _make_vc(ts, value, *, automation_id="", name="", control_type="Edit",
             window="App", proc="chrome.exe", pid=1234):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "value_changed",
            "control_type": control_type,
            "automation_id": automation_id,
            "name": name,
            "class_name": "",
            "window_title": window,
            "process_name": proc,
            "pid": pid,
            "value": value,
        },
    }


def _make_invoked(ts, *, name="Button", window="App", proc="chrome.exe", pid=1234):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "invoked",
            "control_type": "Button",
            "automation_id": "",
            "name": name,
            "class_name": "",
            "window_title": window,
            "process_name": proc,
            "pid": pid,
        },
    }


def test_typing_burst_collapses_to_one_event():
    """10 same-key value_changed 100ms apart -> 1 event with last value."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _make_vc(base + timedelta(milliseconds=i * 100), f"text{i}")
        for i in range(10)
    ]
    # Make values prefix-compatible (simulating typing)
    text = "abcdefghij"
    for i, ev in enumerate(events):
        ev["data"]["value"] = text[:i + 1]

    result = coalesce_typing_bursts(events)
    assert len(result) == 1
    assert result[0]["data"]["value"] == "abcdefghij"
    assert result[0]["data"]["_coalesced_count"] == 10


def test_two_fields_same_key_values_not_prefix_compatible_break():
    """Two fields with same coalesce key, no event between, values not
    prefix-compatible -> 2 events."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _make_vc(base, "Alpha"),
        _make_vc(base + timedelta(milliseconds=100), "Alpha B"),
        _make_vc(base + timedelta(milliseconds=200), "Zulu"),
        _make_vc(base + timedelta(milliseconds=300), "Zulu X"),
    ]
    result = coalesce_typing_bursts(events)
    assert len(result) == 2
    assert result[0]["data"]["value"] == "Alpha B"
    assert result[1]["data"]["value"] == "Zulu X"


def test_kind_change_breaks_run():
    """value_changed, invoked, value_changed -> 3 events."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _make_vc(base, "A"),
        _make_invoked(base + timedelta(milliseconds=100)),
        _make_vc(base + timedelta(milliseconds=200), "B"),
    ]
    result = coalesce_typing_bursts(events)
    assert len(result) == 3


def test_idle_gap_breaks_run():
    """A gap > idle_ms breaks the coalesce run."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _make_vc(base, "A"),
        _make_vc(base + timedelta(milliseconds=100), "AB"),
        _make_vc(base + timedelta(seconds=5), "ABC"),
    ]
    result = coalesce_typing_bursts(events, idle_ms=1500)
    assert len(result) == 2


def test_non_interaction_events_pass_through():
    """System events are not coalesced and break runs."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    system_ev = {
        "event_id": str(uuid.uuid4()),
        "type": "system",
        "timestamp": _iso(base + timedelta(milliseconds=100)),
        "data": {"kind": "recorder_health"},
    }
    events = [
        _make_vc(base, "A"),
        system_ev,
        _make_vc(base + timedelta(milliseconds=200), "B"),
    ]
    result = coalesce_typing_bursts(events)
    assert len(result) == 3
    assert result[1]["type"] == "system"


def test_selection_changed_refire_collapses():
    """Identical selection_changed re-fires collapse to the first."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = []
    for i in range(5):
        events.append({
            "event_id": str(uuid.uuid4()),
            "type": "interaction",
            "timestamp": _iso(base + timedelta(milliseconds=i * 100)),
            "data": {
                "kind": "selection_changed",
                "control_type": "TabItem",
                "automation_id": "tab1",
                "name": "Tab",
                "class_name": "",
                "window_title": "App",
                "process_name": "app.exe",
                "pid": 1234,
                "selected_value": "same_value",
            },
        })
    result = coalesce_typing_bursts(events)
    assert len(result) == 1
    assert result[0]["timestamp"] == events[0]["timestamp"]
