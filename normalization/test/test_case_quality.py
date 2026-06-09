"""Tests for case_quality (lab-phase spec §A1) -- the Tier-2 gatekeeper.

case_quality is pure stdlib, so this suite RUNS (not skips) under a bare
system pytest as well as the bundled python.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_quality import COVERAGE_THRESHOLD, compute_case_quality


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
    assert "anchor" not in cq


def test_unsegmented_when_no_cases():
    cq = compute_case_quality(_events(10, 0), {})
    assert cq["mode"] == "unsegmented"
    assert cq["case_count"] == 0
    # Coverage may be nonzero (stale stamps) but the mode alone locks Tier 2.
    assert cq["tier2_unlocked"] is False


def test_coverage_below_threshold_locks_tier2_even_with_cases():
    # 6 of 10 interactions in a case -> 0.6 < 0.7.
    cq = compute_case_quality(_events(6, 4), {"c1": {}})
    assert cq["mode"] == "markers"
    assert cq["coverage"] == 0.6
    assert cq["tier2_unlocked"] is False


def test_coverage_exactly_at_threshold_unlocks():
    cq = compute_case_quality(_events(7, 3), {"c1": {}})
    assert cq["coverage"] == COVERAGE_THRESHOLD == 0.7
    assert cq["tier2_unlocked"] is True


def test_anchor_mode_from_annotations_override():
    anno = {"case_anchor_override": {
        "field": "automation_id", "equals": "customer-id-field",
        "case_label_from": "value", "_accepted_signature": "abc123",
    }}
    cq = compute_case_quality(_events(9, 1), [{"case_id": "a"}, {"case_id": "b"}],
                              annotations=anno)
    assert cq["mode"] == "anchor"
    assert cq["case_count"] == 2
    assert cq["anchor"] == {"field_property": "automation_id",
                            "field_value": "customer-id-field"}
    assert cq["tier2_unlocked"] is True


def test_anchor_mode_from_canonical_template_wins():
    canonical = {"case_anchor": {"field": "name", "equals": "Order number"}}
    cq = compute_case_quality(_events(8, 2), [{}, {}, {}], canonical=canonical)
    assert cq["mode"] == "anchor"
    assert cq["anchor"]["field_property"] == "name"
    assert cq["anchor"]["field_value"] == "Order number"


def test_anchor_config_with_zero_cases_is_unsegmented():
    # An anchor that produced nothing must not claim anchor-segmentation.
    anno = {"case_anchor_override": {"field": "name", "equals": "x"}}
    cq = compute_case_quality(_events(0, 5), [], annotations=anno)
    assert cq["mode"] == "unsegmented"
    assert cq["tier2_unlocked"] is False


def test_recognized_anchor_display():
    anno = {"case_anchor_override": {"recognized": "invoice_number"}}
    cq = compute_case_quality(_events(5, 0), [{}, {}], annotations=anno)
    assert cq["mode"] == "anchor"
    assert cq["anchor"]["field_property"] == "recognized"
    assert cq["anchor"]["field_value"] == "invoice_number"


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


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
