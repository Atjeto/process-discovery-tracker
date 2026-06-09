"""Tests for facts (lab-phase spec §A2) -- the Tier-1 measured block.

facts is pure stdlib, so this suite RUNS (not skips) under a bare system
pytest as well as the bundled python.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from facts import compute_facts, rekey_details


def _act(app, dur_ms, ts):
    return {"type": "activity", "timestamp": ts,
            "data": {"app": app, "title": app, "duration_ms": dur_ms}}


def _typed(app, value, ts, eid):
    return {"event_id": eid, "type": "interaction", "timestamp": ts,
            "data": {"kind": "text_changed", "process_name": app,
                     "value": value}}


def _sys(kind, ts):
    return {"type": "system", "timestamp": ts, "data": {"kind": kind}}


BASE = "2026-05-14T09:{:02d}:00Z"


def _stream():
    return [
        _sys("session_start", BASE.format(0)),
        _act("chrome.exe", 60000, BASE.format(0)),
        _act("chrome.exe", 30000, BASE.format(1)),   # same app -> no switch
        _act("excel.exe", 45000, BASE.format(2)),    # switch 1
        _act("chrome.exe", 15000, BASE.format(3)),   # switch 2
        _sys("idle_start", BASE.format(4)),
        _sys("idle_end", BASE.format(6)),            # 2 min idle
        _act("outlook.exe", 10000, BASE.format(7)),  # switch 3
    ]


def test_active_ms_sums_activity_durations():
    f = compute_facts(_stream())
    assert f["active_ms"] == 60000 + 30000 + 45000 + 15000 + 10000


def test_idle_ms_pairs_idle_intervals():
    f = compute_facts(_stream())
    assert f["idle_ms"] == 120000


def test_top_apps_ranked_with_share():
    f = compute_facts(_stream())
    top = f["top_apps"]
    assert top[0]["app"] == "chrome.exe"
    assert top[0]["ms"] == 105000
    assert abs(top[0]["share"] - 105000 / 160000) < 0.001
    assert len(top) <= 5
    # Shares are fractions of measured active time, not of wall clock.
    assert abs(sum(a["share"] for a in top) - 1.0) < 0.01


def test_app_switches_and_rate():
    f = compute_facts(_stream())
    assert f["app_switches"] == 3
    # Span 09:00 -> 09:07 = 7 min; 3 switches in 7/60 h.
    assert f["session_span_ms"] == 7 * 60000
    assert abs(f["switches_per_hour"] - round(3 / (7 / 60), 1)) < 0.11


def test_longest_focus_is_the_longest_same_app_run():
    f = compute_facts(_stream())
    # chrome 60s + 30s contiguous = 90s, the longest unbroken run.
    assert f["longest_focus_ms"] == 90000


def test_rekey_counts_values_typed_in_two_apps():
    evs = _stream() + [
        _typed("chrome.exe", "CUST-10900", BASE.format(1), "t1"),
        _typed("excel.exe", "CUST-10900", BASE.format(2), "t2"),
        _typed("chrome.exe", "CUST-10901", BASE.format(3), "t3"),  # one app only
        _typed("excel.exe", "ok", BASE.format(3), "t4"),           # too short
        _typed("chrome.exe", "ok", BASE.format(3), "t5"),
    ]
    f = compute_facts(evs)
    assert f["rekey_count"] == 1
    rows = rekey_details(evs)
    assert rows[0]["value"] == "CUST-10900"
    assert rows[0]["apps"] == ["chrome.exe", "excel.exe"]
    assert set(rows[0]["event_ids"]) == {"t1", "t2"}
    assert rows[0]["entry_count"] == 2


def test_rekey_ignores_same_app_repeats():
    evs = [
        _typed("chrome.exe", "CUST-10900", BASE.format(1), "a"),
        _typed("chrome.exe", "CUST-10900", BASE.format(2), "b"),
    ]
    assert rekey_details(evs) == []


def test_repeated_sequence_count_reads_motif_list_length():
    f = compute_facts(_stream(), motifs=[{"motif_id": "m1"}, {"motif_id": "m2"}])
    assert f["repeated_sequence_count"] == 2
    assert compute_facts(_stream())["repeated_sequence_count"] == 0


def test_empty_and_malformed_streams_degrade_to_zeroes():
    for evs in ([], None, [None, {"type": "activity"}, {"type": "activity", "data": None}]):
        f = compute_facts(evs)
        assert f["active_ms"] == 0
        assert f["idle_ms"] == 0
        assert f["top_apps"] == []
        assert f["app_switches"] == 0
        assert f["switches_per_hour"] == 0.0
        assert f["longest_focus_ms"] == 0
        assert f["rekey_count"] == 0


def test_negative_and_bool_durations_count_zero():
    evs = [_act("a.exe", -500, BASE.format(0)),
           {"type": "activity", "timestamp": BASE.format(1),
            "data": {"app": "a.exe", "duration_ms": True}}]
    assert compute_facts(evs)["active_ms"] == 0


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
