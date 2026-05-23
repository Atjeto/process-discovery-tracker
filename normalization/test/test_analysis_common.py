"""Tests for analysis_common -- per-step time segmentation.

Run with pytest:
    pytest normalization/test/test_analysis_common.py
or directly, with no pytest needed:
    python normalization/test/test_analysis_common.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_common import (
    parse_ts,
    percentile,
    segment_step,
    segment_steps,
    step_group_key,
    step_group_label,
)

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


def _activity(sec, app, dur_ms):
    return {"type": "activity", "event_id": "a" + str(sec), "timestamp": _ts(sec),
            "data": {"app": app, "duration_ms": dur_ms}}


def _idle(start_s, end_s):
    return [
        {"type": "system", "timestamp": _ts(start_s), "data": {"kind": "idle_start"}},
        {"type": "system", "timestamp": _ts(end_s), "data": {"kind": "idle_end"}},
    ]


def test_parse_ts_handles_z_suffix():
    assert parse_ts("2026-05-17T10:00:00Z") is not None
    assert parse_ts("not-a-date") is None
    assert parse_ts(None) is None


def test_percentile_interpolates():
    assert percentile([], 50) == 0.0
    assert percentile([10], 50) == 10.0
    assert percentile([0, 100], 50) == 50.0


def test_segment_elapsed_only_when_no_idle_or_switch():
    seg = segment_step(_step("s1", 0, 600), [])
    assert seg["elapsed_ms"] == 600000.0
    assert seg["waiting_ms"] == 0.0
    assert seg["active_ms"] == 600000.0


def test_segment_attributes_idle_to_waiting():
    seg = segment_step(_step("s1", 0, 600), _idle(120, 240))
    assert seg["waiting_ms"] == 120000.0
    assert seg["active_ms"] == 480000.0


def test_segment_clips_idle_to_window():
    # Idle runs from 150s to 400s but the step ends at 200s.
    seg = segment_step(_step("s1", 100, 200), _idle(150, 400))
    assert seg["waiting_ms"] == 50000.0


def test_segment_counts_app_switches_and_motion():
    events = [
        _activity(10, "sap.exe", 200000),
        _activity(60, "excel.exe", 3000),   # short detour -> motion
        _activity(70, "sap.exe", 200000),
    ]
    seg = segment_step(_step("s1", 0, 600), events)
    assert seg["app_switches"] == 2
    assert seg["switching_ms"] == 3000.0


def test_segment_bad_time_range_returns_empty():
    seg = segment_step({"step_id": "s1", "time_range": {"start": None, "end": None}}, [])
    assert seg["elapsed_ms"] == 0.0
    assert seg["active_ms"] == 0.0


def test_segment_steps_keys_by_id():
    segs = segment_steps([_step("s1", 0, 100), _step("s2", 100, 200)], [])
    assert set(segs.keys()) == {"s1", "s2"}


def test_step_group_key_prefers_canonical_then_process_label():
    # Template-matched -> canonical id wins.
    assert step_group_key({"canonical_step_id": "c1", "process_label": "Search",
                           "step_id": "s1"}) == "c1"
    # Auto step -> the value-free process_label, so repeated work collapses.
    assert step_group_key({"process_label": "Search", "step_id": "s1"}) == "Search"
    # Neither -> the unique step_id, so distinct one-offs stay separate.
    assert step_group_key({"step_id": "s1"}) == "step:s1"


def test_step_group_key_collapses_distinct_value_names():
    # Two instances with different case values but the same process_label
    # share a key -- the fix for the per-instance "endless list".
    a = step_group_key({"name": "Search — CUST-1", "process_label": "Search", "step_id": "s1"})
    b = step_group_key({"name": "Search — CUST-2", "process_label": "Search", "step_id": "s2"})
    assert a == b == "Search"


def test_step_group_label_strips_values_only_for_auto_steps():
    # Auto step: the value-laden name is replaced by the value-free label.
    assert step_group_label({"name": "Search — CUST-1",
                             "process_label": "Search"}) == "Search"
    # Template step: the canonical name is authoritative and kept verbatim,
    # never re-stripped (a legitimate "Review — Final" must survive).
    assert step_group_label({"canonical_step_id": "c1", "name": "Review — Final",
                             "process_label": "Review"}) == "Review — Final"
    # Nothing usable -> a readable placeholder, never a crash.
    assert step_group_label({"step_id": "s1"}) == "(unnamed step)"


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
