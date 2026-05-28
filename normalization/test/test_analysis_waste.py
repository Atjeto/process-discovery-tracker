"""Tests for analysis_waste -- VA/NVA classification + waste types.

Run with pytest:
    pytest normalization/test/test_analysis_waste.py
or directly:
    python normalization/test/test_analysis_waste.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_waste import classify_waste, count_cross_app_transfers

_BASE = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _ts(sec):
    return (_BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(sid, start_s, end_s, interaction_ids=None, process_label=None):
    return {
        "step_id": sid,
        "name": "Step " + sid,
        "time_range": {"start": _ts(start_s), "end": _ts(end_s)},
        "evidence": {"interaction_event_ids": interaction_ids or []},
        "canonical_step_id": None,
        "state": "auto_suggested",
        "process_label": process_label or "",
    }


def _activity(sec, app, dur_ms, label=None):
    data = {"app": app, "duration_ms": dur_ms}
    if label:
        data["activity_label"] = label
    return {"type": "activity", "event_id": "a" + str(sec), "timestamp": _ts(sec), "data": data}


def _interaction(eid, sec, process, value):
    return {"type": "interaction", "event_id": eid, "timestamp": _ts(sec),
            "data": {"process_name": process, "value": value, "automation_id": ""}}


def _idle(start_s, end_s):
    return [
        {"type": "system", "timestamp": _ts(start_s), "data": {"kind": "idle_start"}},
        {"type": "system", "timestamp": _ts(end_s), "data": {"kind": "idle_end"}},
    ]


def test_idle_counts_as_nva():
    out = classify_waste([_step("s1", 0, 600)], _idle(100, 300), {})
    w = out[0]
    assert w["nva_ms"] == 200000
    assert w["va_ms"] == 400000
    assert w["bnva_ms"] == 0
    assert "waiting" in w["waste_types"]


def test_motion_flagged_on_app_switch():
    events = [_activity(10, "a.exe", 1000), _activity(20, "b.exe", 1000)]
    out = classify_waste([_step("s1", 0, 600)], events, {})
    assert "motion" in out[0]["waste_types"]


def test_clean_step_has_no_waste_types():
    events = [_activity(10, "a.exe", 1000), _activity(20, "a.exe", 1000)]
    out = classify_waste([_step("s1", 0, 600)], events, {})
    assert out[0]["waste_types"] == []


def test_cross_app_transfer_detected():
    step = _step("s1", 0, 600, interaction_ids=["i1", "i2"])
    events = [
        _interaction("i1", 100, "sap.exe", "Acme Corporation"),
        _interaction("i2", 120, "excel.exe", "Acme Corporation"),
    ]
    out = classify_waste([step], events, {})
    assert out[0]["cross_app_transfers"] == 1
    assert "overprocessing" in out[0]["waste_types"]


def test_no_transfer_within_same_app():
    step = _step("s1", 0, 600, interaction_ids=["i1", "i2"])
    events = [
        _interaction("i1", 100, "sap.exe", "Acme Corporation"),
        _interaction("i2", 120, "sap.exe", "Acme Corporation"),
    ]
    assert classify_waste([step], events, {})[0]["cross_app_transfers"] == 0


def test_transfer_ignores_short_values():
    assert count_cross_app_transfers([
        _interaction("i1", 1, "a.exe", "OK"),
        _interaction("i2", 2, "b.exe", "OK"),
    ]) == 0


def test_rework_flagged_from_stats():
    step = _step("s1", 0, 600)
    events = [_activity(100, "sap.exe", 1000, label="Order entry")]
    stats = {"rework_loops": [{"activity_label": "Order entry", "rework_count": 2}]}
    assert "rework" in classify_waste([step], events, stats)[0]["waste_types"]


def test_bnva_override_recomputes_va():
    # 600s step, idle 100-300 -> 200000ms nva, 400000ms va by heuristic.
    anno = {"analysis_overrides": [{"step_id": "s1", "bnva_ms": 120000}]}
    w = classify_waste([_step("s1", 0, 600)], _idle(100, 300), {},
                       annotations=anno)[0]
    assert w["bnva_ms"] == 120000
    assert w["nva_ms"] == 200000
    assert w["va_ms"] == 280000  # 600000 - 120000 - 200000
    assert w["va_ms"] + w["bnva_ms"] + w["nva_ms"] == w["elapsed_ms"]


def test_bnva_override_clamped_to_available_va():
    # bnva cannot exceed elapsed - nva (here 600000 - 200000 = 400000).
    anno = {"analysis_overrides": [{"step_id": "s1", "bnva_ms": 999999999}]}
    w = classify_waste([_step("s1", 0, 600)], _idle(100, 300), {},
                       annotations=anno)[0]
    assert w["bnva_ms"] == 400000
    assert w["va_ms"] == 0
    assert w["nva_ms"] == 200000


def test_waste_types_override_replaces_set():
    # Heuristic flags "waiting"; the analyst replaces the whole set.
    anno = {"analysis_overrides": [{"step_id": "s1", "waste_types": ["rework"]}]}
    w = classify_waste([_step("s1", 0, 600)], _idle(100, 300), {},
                       annotations=anno)[0]
    assert w["waste_types"] == ["rework"]


def test_override_for_other_step_ignored():
    anno = {"analysis_overrides": [{"step_id": "elsewhere", "bnva_ms": 50000}]}
    w = classify_waste([_step("s1", 0, 600)], _idle(100, 300), {},
                       annotations=anno)[0]
    assert w["bnva_ms"] == 0


def test_process_label_override_propagates_to_all_instances():
    # A grouped 'Waste by step' row writes an override keyed by
    # process_label; it must apply to every step with that label.
    steps = [
        _step("a", 0, 600, process_label="Search"),
        _step("b", 1000, 1600, process_label="Search"),
        _step("c", 2000, 2600, process_label="Search"),
    ]
    anno = {"analysis_overrides": [
        {"process_label": "Search", "bnva_ms": 60000,
         "waste_types": ["overprocessing"]},
    ]}
    out = classify_waste(steps, [], {}, annotations=anno)
    assert len(out) == 3
    for w in out:
        assert w["bnva_ms"] == 60000
        assert w["waste_types"] == ["overprocessing"]
        assert w["va_ms"] + w["bnva_ms"] + w["nva_ms"] == w["elapsed_ms"]


def test_step_id_override_wins_over_process_label_override():
    # A more-specific per-step_id override beats the group override on
    # the matching instance; the others still get the group override.
    steps = [
        _step("a", 0, 600, process_label="Search"),
        _step("b", 1000, 1600, process_label="Search"),
    ]
    anno = {"analysis_overrides": [
        {"process_label": "Search", "bnva_ms": 60000},
        {"step_id": "b", "bnva_ms": 120000},
    ]}
    out = classify_waste(steps, [], {}, annotations=anno)
    by_sid = {w["step_id"]: w for w in out}
    assert by_sid["a"]["bnva_ms"] == 60000   # group override
    assert by_sid["b"]["bnva_ms"] == 120000  # per-step override wins


def test_process_label_override_ignored_when_label_missing():
    # A step without a process_label cannot be matched by a group override.
    steps = [_step("a", 0, 600)]  # default process_label=""
    anno = {"analysis_overrides": [{"process_label": "Search", "bnva_ms": 60000}]}
    w = classify_waste(steps, [], {}, annotations=anno)[0]
    assert w["bnva_ms"] == 0


def test_waste_entry_carries_process_label():
    w = classify_waste([_step("a", 0, 600, process_label="Search")], [], {})[0]
    assert w["process_label"] == "Search"


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
