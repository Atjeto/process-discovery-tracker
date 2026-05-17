"""Tests for the H10 step-variant computation and the H6 excluded-range
filter in stats_compute.

Run with:
    pytest normalization/test/test_stats_compute.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stats_compute import step_variants, _filter_excluded, compute_all


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
