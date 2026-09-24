"""Tests for case_quality (lab-phase spec §A1) -- the Tier-2 gatekeeper.

case_quality is pure stdlib, so this suite RUNS (not skips) under a bare
system pytest as well as the bundled python.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_quality import COVERAGE_THRESHOLD, MIN_CASES, compute_case_quality


def _interaction(case_ids=None, eid="e1"):
    return {"event_id": eid, "type": "interaction",
            "timestamp": "2026-05-14T09:00:00Z",
            "data": {"kind": "click", "case_ids": case_ids or []}}


def _events(in_case: int, uncased: int):
    evs = []
    for i in range(in_case):
        evs.append(_interaction(case_ids=["c1"], eid=f"in{i}"))
    for i in range(uncased):
        evs.append(_interaction(case_ids=[], eid=f"out{i}"))
    return evs


def test_marker_mode_with_full_coverage_unlocks_tier2():
    cq = compute_case_quality(_events(10, 0), {"c1": {}, "c2": {}})
    assert cq["mode"] == "markers"
    assert cq["case_count"] == 2
    assert cq["coverage"] == 1.0
    assert cq["tier2_unlocked"] is True


def test_unsegmented_when_no_cases():
    cq = compute_case_quality(_events(10, 0), {})
    assert cq["mode"] == "unsegmented"
    assert cq["case_count"] == 0
    # Coverage may be nonzero (stale stamps) but the mode alone locks Tier 2.
    assert cq["tier2_unlocked"] is False


def test_coverage_below_threshold_locks_tier2_even_with_cases():
    # 6 of 10 interactions in a case -> 0.6 < 0.7 (2 cases, so coverage
    # alone is the lock reason).
    cq = compute_case_quality(_events(6, 4), {"c1": {}, "c2": {}})
    assert cq["mode"] == "markers"
    assert cq["coverage"] == 0.6
    assert cq["tier2_unlocked"] is False


def test_coverage_exactly_at_threshold_unlocks():
    cq = compute_case_quality(_events(7, 3), {"c1": {}, "c2": {}})
    assert cq["coverage"] == COVERAGE_THRESHOLD == 0.7
    assert cq["tier2_unlocked"] is True


def test_single_case_locks_tier2_even_at_full_coverage():
    # G-3 (owner's real session): markers mode, ONE case, coverage 0.999 ->
    # cycle-time / variant / across-case comparison is meaningless with
    # nothing to compare against, so Tier 2 must stay locked.
    cq = compute_case_quality(_events(10, 0), {"c1": {}})
    assert cq["mode"] == "markers"
    assert cq["case_count"] == 1
    assert cq["coverage"] == 1.0
    assert cq["tier2_unlocked"] is False
    assert MIN_CASES == 2


def test_no_interactions_yields_zero_coverage():
    activity_only = [{"type": "activity", "timestamp": "2026-05-14T09:00:00Z",
                      "data": {"app": "x.exe", "duration_ms": 100}}]
    cq = compute_case_quality(activity_only, {"c1": {}})
    assert cq["coverage"] == 0.0
    assert cq["tier2_unlocked"] is False


def test_malformed_events_do_not_crash():
    evs = [None, {"type": "interaction"}, {"type": "interaction", "data": None},
           {"type": "interaction", "data": {"case_ids": ["c"]}}]
    cq = compute_case_quality(evs, {"c": {}})
    assert cq["case_count"] == 1
    assert 0.0 <= cq["coverage"] <= 1.0


def test_the_implicit_run_of_a_session_without_a_recording():
    """C16: the one implicit run of a video or blank session: mode
    `implicit`, one run, and no coverage to measure (None, never 0)."""
    cq = compute_case_quality([], {"imp": {"implicit": True}}, recorded=False)
    assert cq == {"mode": "implicit", "case_count": 1, "coverage": None,
                  "tier2_unlocked": False}
    # Runs marked by hand in such a session are markers, still unmeasured.
    cq = compute_case_quality([], {"c1": {}, "c2": {}}, recorded=False)
    assert cq["mode"] == "markers" and cq["coverage"] is None
    assert cq["tier2_unlocked"] is False


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
