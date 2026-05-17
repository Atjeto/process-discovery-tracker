"""Tests for analysis_automation -- automation candidate scoring.

Run with pytest:
    pytest normalization/test/test_analysis_automation.py
or directly:
    python normalization/test/test_analysis_automation.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_automation import score_automation

_BASE = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _ts(sec):
    return (_BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, start_s, end_s, canonical=None, interaction_ids=None):
    return {
        "step_id": sid,
        "name": "Step " + sid,
        "time_range": {"start": _ts(start_s), "end": _ts(end_s)},
        "evidence": {"interaction_event_ids": interaction_ids or []},
        "canonical_step_id": canonical,
        "state": "auto_suggested",
    }


def _interaction(eid, sec, automation_id):
    return {"type": "interaction", "event_id": eid, "timestamp": _ts(sec),
            "data": {"process_name": "app.exe", "value": "", "automation_id": automation_id}}


def test_single_instance_reports_insufficient_data():
    steps = [_step("s1", 0, 300, interaction_ids=["i1"])]
    events = [_interaction("i1", 10, "field")]
    out = score_automation(steps, events)
    assert out[0]["data_sufficiency"] == "single_instance"
    assert out[0]["scores"]["repetitiveness"] is None
    assert out[0]["scores"]["rule_based"] is None
    assert out[0]["estimated_savings_ms"] is None


def test_multi_instance_identical_sequences_score_high():
    steps = [
        _step("s1", 0, 300, canonical="c1", interaction_ids=["i1", "i2"]),
        _step("s2", 400, 700, canonical="c1", interaction_ids=["i3", "i4"]),
    ]
    events = [
        _interaction("i1", 10, "name"), _interaction("i2", 20, "submit"),
        _interaction("i3", 410, "name"), _interaction("i4", 420, "submit"),
    ]
    out = score_automation(steps, events)
    assert out[0]["data_sufficiency"] == "multi_instance"
    assert out[0]["scores"]["repetitiveness"] == 1.0
    assert out[0]["scores"]["rule_based"] == 1.0


def test_multi_instance_varied_sequences_score_lower():
    steps = [
        _step("s1", 0, 300, canonical="c1", interaction_ids=["i1"]),
        _step("s2", 400, 700, canonical="c1", interaction_ids=["i2"]),
    ]
    events = [_interaction("i1", 10, "name"), _interaction("i2", 410, "other")]
    out = score_automation(steps, events)
    assert out[0]["scores"]["rule_based"] < 1.0


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
