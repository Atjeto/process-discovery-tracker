"""Tests for anchor-based case detection (v0.13 §4).

Run with:
    pytest normalization/test/test_anchor_cases.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_assignment import detect_cases_from_anchors, stamp_anchor_cases


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


ANCHOR_CFG = {
    "field": "automation_id",
    "equals": "txtsr",
    "case_label_from": "value",
    "min_gap_ms": 10000,
    "close_on_pause_ms": 300000,
}


def _inter(ts, *, automation_id="", value="", name="", window="App",
           proc="chrome.exe"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "value_changed",
            "control_type": "Edit",
            "automation_id": automation_id,
            "name": name,
            "window_title": window,
            "process_name": proc,
            "value": value,
        },
    }


def _activity(ts, *, app="chrome.exe", title="App"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "activity",
        "timestamp": _iso(ts),
        "data": {
            "app": app,
            "title": title,
            "duration_ms": 1000,
        },
    }


def test_three_distinct_serials_produce_three_cases():
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="", value="x"),
        _inter(base + timedelta(seconds=30), automation_id="txtsr", value="SN002"),
        _inter(base + timedelta(seconds=35), automation_id="", value="y"),
        _inter(base + timedelta(minutes=2), automation_id="txtsr", value="SN003"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 3
    labels = [c["label"] for c in cases]
    assert labels == ["SN001", "SN002", "SN003"]


def test_re_hit_within_min_gap_extends_case():
    """Same label within min_gap_ms -> still 1 case."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="txtsr", value="SN001"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 1
    assert cases[0]["label"] == "SN001"


def test_close_on_pause_splits_case():
    """A gap > close_on_pause_ms within one case splits it."""
    cfg = {**ANCHOR_CFG, "close_on_pause_ms": 5000}
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=1)),
        _inter(base + timedelta(seconds=10)),
        _inter(base + timedelta(seconds=11)),
    ]
    cases = detect_cases_from_anchors(interactions, cfg)
    assert len(cases) == 2
    assert cases[0]["label"] == "SN001"
    assert cases[1]["label"] == "SN001"


def test_stamp_anchor_cases_stamps_interactions_and_activities():
    """stamp_anchor_cases stamps both interaction AND activity events."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    anchor_cases = [{
        "case_id": "case-1",
        "label": "SN001",
        "start_ts": _iso(base),
        "end_ts": _iso(base + timedelta(seconds=10)),
        "last_ts": _iso(base + timedelta(seconds=10)),
    }]
    events = [
        _inter(base + timedelta(seconds=1)),
        _activity(base + timedelta(seconds=2)),
        _inter(base + timedelta(seconds=20)),
    ]
    stamped, cases_map = stamp_anchor_cases(events, anchor_cases)
    assert len(stamped) == 3
    assert stamped[0]["data"]["case_ids"] == ["case-1"]
    assert stamped[1]["data"]["case_ids"] == ["case-1"]
    assert stamped[2]["data"]["case_ids"] == []
    assert "case-1" in cases_map
    assert len(cases_map["case-1"]["activity_event_ids"]) == 1


def test_cases_map_has_expected_shape():
    """cases_map has the same shape as collect_cases() output."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    anchor_cases = [{
        "case_id": "case-1",
        "label": "SN001",
        "start_ts": _iso(base),
        "end_ts": _iso(base + timedelta(seconds=10)),
        "last_ts": _iso(base + timedelta(seconds=10)),
    }]
    _, cases_map = stamp_anchor_cases([], anchor_cases)
    c = cases_map["case-1"]
    assert c["case_id"] == "case-1"
    assert c["label"] == "SN001"
    assert c["parent_case_id"] is None
    assert c["start_ts"] is not None
    assert c["end_ts"] is not None
    assert c["end_reason"] == "anchor_boundary"
    assert "activity_event_ids" in c


def test_deterministic_case_ids():
    """Same label + start_ts produces the same case_id."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
    ]
    cases1 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    cases2 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert cases1[0]["case_id"] == cases2[0]["case_id"]
