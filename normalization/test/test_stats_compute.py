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


def test_step_stats_leaves_out_a_step_without_a_time_range():
    """C16: a step added by hand may have no time; the step stats are timed
    statistics, so it is left out rather than counted as 0 ms. An inverted
    range is still a timed step and counts 0."""
    for missing in ({}, None, {"start": "2026-05-14T09:00:00Z", "end": None}, {"start": "bad"}):
        assert step_stats([{"case_id": "c1", "name": "X", "time_range": missing}]) == []
    rows = step_stats([
        {"case_id": "c1", "name": "X", "time_range": None, "order": 1},
        _step_dur("c1", "X", "2026-05-14T09:00:05Z", "2026-05-14T09:00:01Z"),   # inverted
    ])
    assert rows[0]["frequency"] == 1
    assert rows[0]["total_duration_ms"] == 0


def test_step_variants_order_steps_without_a_time_by_order_after_the_timed():
    """C16: in a run, the steps with a time in time order, then the steps
    added without one in their `order`."""
    steps = [
        {"case_id": "c1", "name": "Late", "time_range": None, "order": 2},
        {"case_id": "c1", "name": "Early", "time_range": None, "order": 1},
        _step_dur("c1", "Timed B", "2026-05-14T09:00:05Z", "2026-05-14T09:00:06Z"),
        {"case_id": "c1", "name": "No order", "time_range": None},
        _step_dur("c1", "Timed A", "2026-05-14T09:00:01Z", "2026-05-14T09:00:02Z"),
    ]
    assert step_variants(steps)[0]["variant"] == [
        "Timed A", "Timed B", "Early", "Late", "No order"]


def test_case_stats_of_a_session_without_a_recording_measure_no_active_time():
    """C16: nothing measured the foreground in a video or blank session, so
    a run's active time is None, never a measured 0; the implicit run is
    flagged."""
    cases = {"imp": {"label": None, "parent_case_id": None,
                     "start_ts": "2026-05-14T09:00:00Z", "end_ts": None,
                     "end_reason": None, "implicit": True}}
    row = case_stats([], cases, recorded=False)[0]
    assert row["active_ms"] is None and row["wall_clock_ms"] is None
    assert row["implicit"] is True
    plain = {"c1": {**cases["imp"], "implicit": False}}
    assert "implicit" not in case_stats([], plain)[0]


def test_a_recording_without_a_single_activity_row_measured_no_active_time():
    """The packaged capture app before 2.0.0 never saw the foreground window,
    so its recordings hold no activity row: their active time is None ("Not
    recorded" in the PDD), not 0s. One row is a measurement, even of 0."""
    cases = {"c1": {"label": None, "parent_case_id": None,
                    "start_ts": "2026-05-14T09:00:00Z", "end_ts": "2026-05-14T09:01:00Z",
                    "end_reason": None}}
    assert case_stats([], cases)[0]["active_ms"] is None
    elsewhere = {"type": "activity", "timestamp": "2026-05-14T08:00:00Z",
                 "data": {"app": "Excel", "duration_ms": 5000}}
    assert case_stats([elsewhere], cases)[0]["active_ms"] == 0
    inside = {"type": "activity", "timestamp": "2026-05-14T09:00:10Z",
              "data": {"app": "Excel", "duration_ms": 20000}}
    assert case_stats([inside], cases)[0]["active_ms"] == 20000


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
    assert rows[0]["active_ms"] is None        # no activity row: nothing measured
    filed = {"type": "activity", "timestamp": "2026-05-14T09:00:10Z",
             "data": {"duration_ms": 3000, "case_ids": ["c1"]}}
    assert case_stats([filed], cases)[0]["active_ms"] == 3000


# --- The group label (moved from the cut analysis layer) ----------------

def test_step_group_label_prefers_a_canonical_name_then_the_process_label():
    from stats_compute import step_group_label
    assert step_group_label({"name": "Search — CUST-1", "process_label": "Search"}) == "Search"
    assert step_group_label({"canonical_step_id": "c1", "name": "Review — Final",
                             "process_label": "Review"}) == "Review — Final"
    assert step_group_label({"name": "Plain"}) == "Plain"
    assert step_group_label({"step_id": "s1"}) == "(unnamed step)"


# --- Lane FX1: a transaction's active time is the overlap of the rows ------
# with its span (item 3), and a stretch left out takes out exactly its own
# time, cut out of the rows before they merge (item 4).

T = "2026-05-14T09:{}Z"


def _row(ts, ms, label="A", cids=None, app="crm.exe"):
    return {"type": "activity", "timestamp": ts,
            "data": {"activity_label": label, "app": app, "duration_ms": ms,
                     "case_ids": list(cids or [])}}


def _case(start, end=None, label="Transaction 1"):
    return {"label": label, "parent_case_id": None, "start_ts": start, "end_ts": end,
            "end_reason": None}


def test_a_stretch_that_starts_before_the_first_marker_counts_from_the_marker():
    """F2: the capture app writes the first foreground stretch with a start a
    moment before its Transaction 1 marker, so the case assignment files it
    under no transaction. Its overlap with the transaction still counts."""
    events = [_row(T.format("00:00.000"), 18829)]          # stamped to no case
    cases = {"t1": _case(T.format("00:00.070"), T.format("00:20.000"))}
    row = case_stats(events, cases)[0]
    assert row["active_ms"] == 18759                         # clipped at the marker
    assert row["active_ms"] <= row["wall_clock_ms"]


def test_a_stretch_across_two_transactions_counts_in_each_for_its_part():
    events = [_row(T.format("00:00"), 30000, cids=["t1"])]
    cases = {"t1": _case(T.format("00:00"), T.format("00:10")),
             "t2": _case(T.format("00:10"), T.format("00:40"), label="Transaction 2")}
    rows = {r["case_id"]: r["active_ms"] for r in case_stats(events, cases)}
    assert rows == {"t1": 10000, "t2": 20000}


def test_an_open_transaction_runs_to_the_end_and_idle_time_is_left_out():
    events = [
        _row(T.format("01:00"), 60000),
        {"type": "system", "timestamp": T.format("01:10"), "data": {"kind": "idle_start"}},
        {"type": "system", "timestamp": T.format("01:25"), "data": {"kind": "idle_end"}},
    ]
    cases = {"t1": _case(T.format("01:05"))}                 # no end marker
    assert case_stats(events, cases)[0]["active_ms"] == 55000 - 15000


def test_a_row_whose_time_cannot_be_read_counts_where_it_was_filed():
    events = [{"type": "activity", "timestamp": "not a time",
               "data": {"activity_label": "A", "duration_ms": 4000, "case_ids": ["t1"]}}]
    cases = {"t1": _case(T.format("00:00"), T.format("00:10")),
             "t2": _case(T.format("00:10"), T.format("00:20"), label="Transaction 2")}
    rows = {r["case_id"]: r["active_ms"] for r in case_stats(events, cases)}
    assert rows == {"t1": 4000, "t2": 0}


def test_clip_excluded_cuts_the_stretch_out_of_each_row():
    from stats_compute import clip_excluded
    rows = [_row(T.format("00:00"), 10000),                  # across the start: shortened
            _row(T.format("00:12"), 2000),                   # inside: dropped
            _row(T.format("00:18"), 10000),                  # across the end: moved and shortened
            _row(T.format("01:00"), 60000)]                  # around a second stretch: split
    marker = {"type": "marker", "timestamp": T.format("00:15"), "data": {"marker_type": "end"}}
    ranges = [{"start": T.format("00:05"), "end": T.format("00:20")},
              {"start": T.format("01:20"), "end": T.format("01:30")}]
    out = clip_excluded(rows + [marker], ranges)
    acts = [(e["timestamp"], e["data"]["duration_ms"]) for e in out if e["type"] == "activity"]
    assert acts == [(T.format("00:00"), 5000.0),
                    ("2026-05-14T09:00:20Z", 8000.0),
                    (T.format("01:00"), 20000.0),
                    ("2026-05-14T09:01:30Z", 30000.0)]
    assert marker in out                                     # other events pass through
    assert clip_excluded(rows, None) is rows


def test_a_stretch_left_out_takes_out_its_own_time_not_a_merged_occurrence():
    """Report 2, item 4: two rows of one application, 8 s and 11.5 s, merge
    into one occurrence stamped at the first; a stretch of 7.9 s from just
    before the first row used to drop the whole occurrence (19.5 s)."""
    events = [_row("2026-05-14T09:03:23Z", 8000, cids=["t3"]),
              _row("2026-05-14T09:03:31Z", 11500, cids=["t3"]),
              _row("2026-05-14T09:03:45Z", 20400, cids=["t3"])]
    cases = {"t3": _case("2026-05-14T09:03:22Z", "2026-05-14T09:04:10Z", label="Transaction 3")}
    whole = compute_all(events, cases)["case_stats"][0]["active_ms"]
    assert whole == 39900
    left = [{"start": "2026-05-14T09:03:22.200Z", "end": "2026-05-14T09:03:30.100Z"}]
    cut = compute_all(events, cases, excluded_ranges=left)["case_stats"][0]["active_ms"]
    assert whole - cut == 7100            # the stretch's overlap with the rows, and no more
    # The occurrences are merged after the cut: the remaining part of the
    # first row and the next rows still read as one occurrence of A.
    assert compute_all(events, cases, excluded_ranges=left)["activity_stats"][0]["frequency"] == 1
