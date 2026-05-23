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
    # Each serial does some follow-up work so none is a degenerate sliver.
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="", value="x"),
        _inter(base + timedelta(seconds=30), automation_id="txtsr", value="SN002"),
        _inter(base + timedelta(seconds=35), automation_id="", value="y"),
        _inter(base + timedelta(minutes=2), automation_id="txtsr", value="SN003"),
        _inter(base + timedelta(minutes=2, seconds=5), automation_id="", value="z"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 3
    labels = [c["label"] for c in cases]
    assert labels == ["SN001", "SN002", "SN003"]


def test_re_hit_same_label_is_one_case():
    """Re-searching the same serial stays ONE case (stable per label)."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="txtsr", value="SN001"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 1
    assert cases[0]["label"] == "SN001"


def test_pause_does_not_split_same_label_case():
    """Active-case stamping (option C) deliberately drops the old pause-split:
    a long idle gap within one serial's work no longer fragments it -- the
    case simply continues. (Was test_close_on_pause_splits_case.)"""
    cfg = {**ANCHOR_CFG, "close_on_pause_ms": 5000}
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=1)),
        _inter(base + timedelta(seconds=10)),   # 9s gap -- would have split before
        _inter(base + timedelta(seconds=11)),
    ]
    cases = detect_cases_from_anchors(interactions, cfg)
    assert len(cases) == 1
    assert cases[0]["label"] == "SN001"


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
    """case_id is stable per label -- the same serial always resolves to the
    same id (across runs, and on a re-search later in the session)."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=2), automation_id="", value="x"),
    ]
    cases1 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    cases2 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert cases1[0]["case_id"] == cases2[0]["case_id"]


# --- Active-case stamping: interleaving + degenerate guard (option C) ---


def test_interleaved_serials_resume_same_case():
    """search A -> work -> search B -> work -> search A again: A's two bouts
    are ONE case (stable per label), so A owns two disjoint active segments."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                         automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=2),  value="a1"),
        _inter(base + timedelta(seconds=4),  automation_id="txtsr", value="SN-B"),
        _inter(base + timedelta(seconds=6),  value="b1"),
        _inter(base + timedelta(seconds=8),  automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=10), value="a2"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 2
    assert sorted(c["label"] for c in cases) == ["SN-A", "SN-B"]
    a = next(c for c in cases if c["label"] == "SN-A")
    assert len(a["segments"]) == 2   # two disjoint bouts of work on serial A


def test_stamp_interleaved_assigns_by_active_case():
    """Events between anchors stamp to the most-recent anchor's case, even
    when the same case resumes after an interleave."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                         automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=2),  value="a1"),
        _inter(base + timedelta(seconds=4),  automation_id="txtsr", value="SN-B"),
        _inter(base + timedelta(seconds=5),  value="b1"),
        _inter(base + timedelta(seconds=8),  automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=10), value="a2"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    a = next(c for c in cases if c["label"] == "SN-A")["case_id"]
    b = next(c for c in cases if c["label"] == "SN-B")["case_id"]
    events = sorted(
        interactions + [
            _activity(base + timedelta(seconds=6)),   # within B's window
            _activity(base + timedelta(seconds=9)),   # within A's resumed window
        ],
        key=lambda e: e["timestamp"],
    )
    stamped, _ = stamp_anchor_cases(events, cases)
    by_ts = {e["timestamp"]: e["data"]["case_ids"] for e in stamped}
    assert by_ts[_iso(base + timedelta(seconds=6))] == [b]
    assert by_ts[_iso(base + timedelta(seconds=9))] == [a]


def test_degenerate_guard_drops_lone_anchor():
    """A lone accidental anchor fire (1 interaction) is dropped; the real case
    beside it survives."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value="REAL"),
        _inter(base + timedelta(seconds=3), value="work"),
        _inter(base + timedelta(seconds=5), value="work2"),
        _inter(base + timedelta(seconds=6), automation_id="txtsr", value="SLIVER"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["REAL"]


def test_degenerate_guard_drops_subsecond_case():
    """A sub-second case (the 0.6s sliver) is dropped even with 2 interactions."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value="REAL"),
        _inter(base + timedelta(seconds=3), value="work"),
        _inter(base + timedelta(seconds=10), automation_id="txtsr", value="BLIP"),
        _inter(base + timedelta(seconds=10, milliseconds=600), value="b"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["REAL"]
