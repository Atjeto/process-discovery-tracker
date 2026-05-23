"""Tests for the H10 step-variant computation and the H6 excluded-range
filter in stats_compute.

Run with:
    pytest normalization/test/test_stats_compute.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stats_compute import step_variants, step_stats, _filter_excluded, compute_all


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
