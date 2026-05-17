"""Tests for analysis_time_study -- per-step cycle-time statistics.

Run with pytest:
    pytest normalization/test/test_analysis_time_study.py
or directly:
    python normalization/test/test_analysis_time_study.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_time_study import compute_time_study

_BASE = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _ts(sec):
    return (_BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, start_s, end_s, canonical=None):
    return {
        "step_id": sid,
        "name": "Step " + sid,
        "time_range": {"start": _ts(start_s), "end": _ts(end_s)},
        "evidence": {"interaction_event_ids": []},
        "canonical_step_id": canonical,
        "state": "auto_suggested",
    }


def test_single_instance_collapses_distribution():
    out = compute_time_study([_step("s1", 0, 300)], [])
    assert len(out) == 1
    assert out[0]["instances"] == 1
    assert out[0]["cycle_ms"]["mean"] == 300000
    assert out[0]["cycle_ms"]["min"] == out[0]["cycle_ms"]["max"] == 300000
    assert out[0]["cycle_ms"]["stdev"] == 0


def test_groups_instances_by_canonical_id():
    steps = [
        _step("s1", 0, 300, canonical="c1"),
        _step("s2", 400, 1000, canonical="c1"),
    ]
    out = compute_time_study(steps, [])
    assert len(out) == 1
    assert out[0]["instances"] == 2
    assert out[0]["cycle_ms"]["min"] == 300000
    assert out[0]["cycle_ms"]["max"] == 600000
    assert out[0]["cycle_ms"]["stdev"] > 0


def test_steps_without_canonical_stay_separate():
    out = compute_time_study([_step("s1", 0, 300), _step("s2", 400, 700)], [])
    assert len(out) == 2


def test_sorted_by_mean_cycle_descending():
    steps = [_step("s1", 0, 100), _step("s2", 200, 900)]
    out = compute_time_study(steps, [])
    assert out[0]["cycle_ms"]["mean"] >= out[1]["cycle_ms"]["mean"]


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
