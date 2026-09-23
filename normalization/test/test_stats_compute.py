"""Tests for the H10 step-variant computation and the H6 excluded-range
filter in stats_compute.

Run with:
    pytest normalization/test/test_stats_compute.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stats_compute import (
    activity_stats, case_stats, step_variants, step_stats, _filter_excluded, compute_all,
)


def _step(case_id, name, start):
    return {"case_id": case_id, "name": name,
            "time_range": {"start": start, "end": start}}


# --- Step variants (H10) -----------------------------------------------

def test_step_variants_groups_identical_step_sequences():
    steps = [
        _step("c1", "Open", "2026-05-14T09:00:00Z"),
        _step("c1", "Search", "2026-05-14T09:01:00Z"),
        _step("c2", "Open", "2026-05-14T10:00:00Z"),
        _step("c2", "Search", "2026-05-14T10:01:00Z"),
    ]
    variants = step_variants(steps)
    assert len(variants) == 1
    assert variants[0]["variant"] == ["Open", "Search"]
    assert variants[0]["frequency"] == 2
    assert variants[0]["length"] == 2


def test_step_variants_separates_divergent_sequences():
    steps = [
        _step("c1", "Open", "2026-05-14T09:00:00Z"),
        _step("c1", "Search", "2026-05-14T09:01:00Z"),
        _step("c2", "Open", "2026-05-14T10:00:00Z"),
    ]
    variants = step_variants(steps)
    assert len(variants) == 2


def test_step_variants_orders_by_start_time():
    """A case's variant is its steps in start-time order, not list order."""
    steps = [
        _step("c1", "Second", "2026-05-14T09:05:00Z"),
        _step("c1", "First", "2026-05-14T09:00:00Z"),
    ]
    variants = step_variants(steps)
    assert variants[0]["variant"] == ["First", "Second"]


def test_step_variants_skips_steps_without_a_case():
    steps = [_step(None, "Orphan", "2026-05-14T09:00:00Z")]
    assert step_variants(steps) == []


# --- Excluded ranges (H6) ----------------------------------------------

def _ev(ts):
    return {"type": "activity", "timestamp": ts, "data": {}}


def test_filter_excluded_drops_events_inside_a_range():
    events = [
        _ev("2026-05-14T09:00:00Z"),
        _ev("2026-05-14T09:30:00Z"),
        _ev("2026-05-14T10:00:00Z"),
    ]
    ranges = [{"start": "2026-05-14T09:15:00Z", "end": "2026-05-14T09:45:00Z"}]
    kept = _filter_excluded(events, ranges)
    assert [e["timestamp"] for e in kept] == [
        "2026-05-14T09:00:00Z", "2026-05-14T10:00:00Z"]


def test_filter_excluded_no_ranges_is_identity():
    events = [_ev("2026-05-14T09:00:00Z")]
    assert _filter_excluded(events, None) is events
    assert _filter_excluded(events, []) is events


def test_filter_excluded_ignores_malformed_range():
    events = [_ev("2026-05-14T09:00:00Z")]
    assert _filter_excluded(events, [{"start": "2026-05-14T09:00:00Z"}]) == events


def test_compute_all_includes_step_variants():
    summary = compute_all([], {}, steps=[_step("c1", "A", "2026-05-14T09:00:00Z")])
    assert summary["step_variants"] == [
        {"variant": ["A"], "frequency": 1, "length": 1}]


# --- Step stats: step-level duration distribution (split-brain fix) ----

def _step_dur(case_id, name, start, end):
    return {"case_id": case_id, "name": name,
            "time_range": {"start": start, "end": end}}


def test_step_stats_aggregates_duration_per_name():
    steps = [
        _step_dur("c1", "Search", "2026-05-14T09:00:00Z", "2026-05-14T09:00:10Z"),  # 10s
        _step_dur("c2", "Search", "2026-05-14T10:00:00Z", "2026-05-14T10:00:30Z"),  # 30s
        _step_dur("c1", "Save",   "2026-05-14T09:01:00Z", "2026-05-14T09:01:05Z"),  # 5s
    ]
    rows = step_stats(steps)
    by = {r["step_name"]: r for r in rows}
    assert by["Search"]["frequency"] == 2
    assert by["Search"]["total_duration_ms"] == 40000
    assert by["Search"]["mean_ms"] == 20000
    # rows are ranked by total duration desc -- Search (40s) before Save (5s)
    assert rows[0]["step_name"] == "Search"
    # same row shape as activity_stats
    assert set(rows[0]) == {"step_name", "frequency", "frequency_pct",
                            "total_duration_ms", "mean_ms", "median_ms",
                            "p90_ms", "p99_ms"}


def test_step_stats_handles_missing_range():
    rows = step_stats([{"case_id": "c1", "name": "X", "time_range": {}}])
    assert rows[0]["frequency"] == 1
    assert rows[0]["total_duration_ms"] == 0


def test_compute_all_includes_step_stats():
    summary = compute_all([], {}, steps=[
        _step_dur("c1", "A", "2026-05-14T09:00:00Z", "2026-05-14T09:00:02Z")])
    assert summary["step_stats"][0]["step_name"] == "A"
    assert summary["step_stats"][0]["total_duration_ms"] == 2000


# --- process_label collapses value-laden instances (the "endless list") -

def test_step_stats_collapses_instances_by_process_label():
    # Auto step names embed case values; the value-free process_label
    # collapses them to ONE row instead of one row per instance.
    steps = [
        {"case_id": "c1", "name": "Search — CUST-1", "process_label": "Search",
         "time_range": {"start": "2026-05-14T09:00:00Z", "end": "2026-05-14T09:00:10Z"}},
        {"case_id": "c2", "name": "Search — CUST-2", "process_label": "Search",
         "time_range": {"start": "2026-05-14T10:00:00Z", "end": "2026-05-14T10:00:30Z"}},
    ]
    rows = step_stats(steps)
    assert len(rows) == 1
    assert rows[0]["step_name"] == "Search"
    assert rows[0]["frequency"] == 2


def test_step_variants_collapse_by_process_label():
    # Two cases ran the same step type with different case values -> one
    # variant, frequency 2 (the value-free label drives the sequence).
    steps = [
        {"case_id": "c1", "name": "Search — CUST-1", "process_label": "Search",
         "time_range": {"start": "2026-05-14T09:00:00Z", "end": "2026-05-14T09:00:00Z"}},
        {"case_id": "c2", "name": "Search — CUST-2", "process_label": "Search",
         "time_range": {"start": "2026-05-14T10:00:00Z", "end": "2026-05-14T10:00:00Z"}},
    ]
    variants = step_variants(steps)
    assert len(variants) == 1
    assert variants[0]["variant"] == ["Search"]
    assert variants[0]["frequency"] == 2


# --- Robustness: corrupt field values degrade, not crash (found by the stats
# fuzzer). _coerce_event_shape guarantees `data` is a dict but not that its
# values are numbers/ISO timestamps; stats interprets them, so it must tolerate.

def test_activity_stats_tolerates_non_numeric_duration():
    events = [
        {"type": "activity", "timestamp": "2026-05-14T09:00:00Z",
         "data": {"activity_label": "A", "duration_ms": "lots"}},   # hand-edited
        {"type": "activity", "timestamp": "2026-05-14T09:00:01Z",
         "data": {"activity_label": "A", "duration_ms": 1000}},
    ]
    rows = activity_stats(events)              # must not raise TypeError on sum
    a = next(r for r in rows if r["activity_label"] == "A")
    assert a["frequency"] == 2
    assert a["total_duration_ms"] == 1000      # the bad value counts as 0


def test_activity_stats_clamps_negative_duration():
    events = [{"type": "activity", "timestamp": "2026-05-14T09:00:00Z",
               "data": {"activity_label": "A", "duration_ms": -5}}]
    assert activity_stats(events)[0]["total_duration_ms"] == 0


def test_case_active_time_excludes_recorded_idle_and_stays_inside_the_run():
    """RP-07 for runs: a run's active time is its foreground time minus the
    idle time the recorder measured (the facts.active_ms basis), and it never
    counts foreground time after the run's end marker."""
    events = [
        {"type": "activity", "timestamp": "2026-05-14T09:00:00Z",
         "data": {"activity_label": "A", "duration_ms": 60000, "case_ids": ["c1"]}},
        {"type": "system", "timestamp": "2026-05-14T09:00:20Z",
         "data": {"kind": "idle_start"}},
        {"type": "system", "timestamp": "2026-05-14T09:00:35Z",
         "data": {"kind": "idle_end"}},
        # Runs 10s past the end marker at 09:01:20.
        {"type": "activity", "timestamp": "2026-05-14T09:01:00Z",
         "data": {"activity_label": "B", "duration_ms": 30000, "case_ids": ["c1"]}},
    ]
    cases = {"c1": {"label": "Run 1", "start_ts": "2026-05-14T09:00:00Z",
                    "end_ts": "2026-05-14T09:01:20Z"}}
    row = case_stats(events, cases)[0]
    assert row["wall_clock_ms"] == 80000
    # (60s - 15s idle) + the 20s of the second stretch inside the run.
    assert row["active_ms"] == 65000
    assert row["active_ms"] <= row["wall_clock_ms"]


def test_case_stats_tolerates_corrupt_timestamps():
    cases = {"c1": {"label": "C1", "start_ts": "not-a-date", "end_ts": "also-bad"}}
    rows = case_stats([], cases)               # must not raise ValueError on parse
    assert len(rows) == 1
    assert rows[0]["wall_clock_ms"] is None
    assert rows[0]["active_ms"] == 0
