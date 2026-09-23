"""Re-analyze identity inheritance (_merge_steps / _inherit_step_identity).

Fresh auto steps are regenerated with new ids on every analyze: the fresh step
that re-covers the same interactions inherits the prior step's id, so anything
keyed on step_id keeps resolving. Legacy phase / template links on a prior
step (phases and canonical matching were removed) are no longer carried.

Run with:
    pytest normalization/test/test_step_identity.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import _merge_steps


def _step(step_id, state, event_ids, *, phase_id=None, canonical_step_id=None):
    s = {
        "step_id": step_id,
        "state": state,
        "evidence": {"interaction_event_ids": list(event_ids)},
        "time_range": {"start": "2026-05-18T09:00:00Z", "end": "2026-05-18T09:00:10Z"},
    }
    if phase_id is not None:
        s["phase_id"] = phase_id
    if canonical_step_id is not None:
        s["canonical_step_id"] = canonical_step_id
    return s


def test_fresh_auto_step_inherits_prior_id():
    """An auto_suggested step keeps its id when re-analyze regenerates it."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"])
    fresh = _step("NEW", "auto_suggested", ["e1", "e2", "e3"])
    merged = _merge_steps([prior], [fresh])
    assert len(merged) == 1
    assert merged[0]["step_id"] == "S1"


def test_legacy_phase_and_template_links_are_not_carried():
    """Phases and canonical matching were removed: a prior step's legacy
    phase_id / canonical_step_id no longer ride onto the fresh step (they used
    to), while the step id itself is still inherited."""
    prior = _step("S1", "auto_suggested", ["e1", "e2"],
                  phase_id="P1", canonical_step_id="C9")
    fresh = _step("NEW", "auto_suggested", ["e1", "e2"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "S1"
    assert merged[0].get("phase_id") is None
    assert merged[0].get("canonical_step_id") is None


def test_step_that_grew_by_one_event_still_inherits():
    """Segmentation drift (a step gains one trailing interaction) still counts
    as the same step -- majority of both sets overlap."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"])
    fresh = _step("NEW", "auto_suggested", ["e1", "e2", "e3", "e4"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "S1"


def test_no_overlap_keeps_new_id():
    """Disjoint events -> no inheritance (the prior behaviour; no false link)."""
    prior = _step("S1", "auto_suggested", ["e1", "e2"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["x1", "x2", "x3"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "NEW"


def test_weak_overlap_does_not_inherit():
    """A tiny shared slice is not enough -- a majority of BOTH sets is required,
    so a small fresh step does not steal a big prior step's identity."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3", "e4", "e5"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["e1"])
    merged = _merge_steps([prior], [fresh])
    assert merged[0]["step_id"] == "NEW"


def test_manual_step_preserved_and_overlapping_fresh_dropped():
    """A manually_authored prior is preserved verbatim; a fresh step overlapping
    its time range is dropped (existing I37 behaviour), not merged."""
    prior = _step("M1", "manually_authored", ["e1", "e2"], phase_id="P1")
    fresh = _step("NEW", "auto_suggested", ["e1", "e2"])
    merged = _merge_steps([prior], [fresh])
    assert len(merged) == 1
    assert merged[0]["step_id"] == "M1"
    assert merged[0]["state"] == "manually_authored"


def test_merge_stamps_value_free_process_label():
    """_merge_steps stamps a value-free process_label so the step-level map/flow
    collapses repeated work across cases instead of one node per instance."""
    fresh = _step("N1", "auto_suggested", ["e1", "e2"])
    fresh["name"] = "Salesforce: Search — CUST-10001"
    merged = _merge_steps([], [fresh])
    assert merged[0]["process_label"] == "Salesforce: Search"


def test_each_prior_claimed_at_most_once():
    """Two fresh steps cannot both inherit the same prior id."""
    prior = _step("S1", "auto_suggested", ["e1", "e2", "e3"], phase_id="P1")
    f1 = _step("N1", "auto_suggested", ["e1", "e2", "e3"])
    f2 = _step("N2", "auto_suggested", ["e1", "e2", "e3"])
    merged = _merge_steps([prior], [f1, f2])
    ids = [s["step_id"] for s in merged]
    assert "S1" in ids
    assert len(set(ids)) == 2  # no duplicate ids
