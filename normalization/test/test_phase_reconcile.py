"""Tests for phase_reconcile -- the re-normalize reconciliation helpers
(review coverage gap #16). Pure, stdlib-only, so they run under a bare Python.

  _merge_phases             preserve curated phases, append fresh auto ones
  reconcile_phase_membership make phase.step_ids <-> step.phase_id agree
  _compute_drift_markers     flag a curated step whose canonical match moved
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phase_reconcile import (
    _merge_phases,
    reconcile_phase_membership,
    _compute_drift_markers,
)


# --- _merge_phases -----------------------------------------------------

def test_merge_phases_keeps_curated_drops_auto_appends_fresh():
    existing = [
        {"phase_id": "p-auth", "state": "manually_authored"},
        {"phase_id": "p-edit", "state": "edited"},
        {"phase_id": "p-auto", "state": "auto_suggested"},   # regenerated -> dropped
    ]
    fresh = [{"phase_id": "p-new", "state": "auto_suggested"}]
    out = _merge_phases(existing, fresh)
    ids = [p["phase_id"] for p in out]
    # manually_authored + edited (preserved, in that order) + fresh; auto dropped.
    assert ids == ["p-auth", "p-edit", "p-new"]


def test_merge_phases_handles_none_inputs():
    assert _merge_phases(None, None) == []
    assert [p["phase_id"] for p in _merge_phases(None, [{"phase_id": "x"}])] == ["x"]


# --- reconcile_phase_membership ---------------------------------------

def test_reconcile_prunes_dangling_step_ids():
    steps = [{"step_id": "s1", "phase_id": "p1"}]
    phases = [{"phase_id": "p1", "step_ids": ["s1", "s-deleted"]}]
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1"]   # s-deleted (no live step) pruned


def test_reconcile_forward_stamps_step_into_its_phase():
    steps = [{"step_id": "s1", "phase_id": "p1"}]
    phases = [{"phase_id": "p1", "step_ids": []}]   # step claims p1 but isn't listed
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1"]


def test_reconcile_clears_phase_id_pointing_at_missing_phase():
    steps = [{"step_id": "s1", "phase_id": "ghost"}]
    phases = [{"phase_id": "p1", "step_ids": []}]
    reconcile_phase_membership(steps, phases)
    assert steps[0]["phase_id"] is None


def test_reconcile_is_idempotent():
    steps = [{"step_id": "s1", "phase_id": "p1"}, {"step_id": "s2", "phase_id": "p1"}]
    phases = [{"phase_id": "p1", "step_ids": ["s1"]}]
    reconcile_phase_membership(steps, phases)
    once = [list(p["step_ids"]) for p in phases]
    reconcile_phase_membership(steps, phases)
    assert [list(p["step_ids"]) for p in phases] == once
    assert sorted(phases[0]["step_ids"]) == ["s1", "s2"]


# --- _compute_drift_markers -------------------------------------------

def _step(step_id, state, cid, event_ids):
    return {"step_id": step_id, "state": state, "canonical_step_id": cid,
            "evidence": {"interaction_event_ids": event_ids}}


def test_drift_marker_emitted_when_canonical_assignment_moves():
    existing = [_step("s1", "edited", "C1", ["e1", "e2"])]
    fresh = [_step("f1", "auto_matched", "C2", ["e1"])]   # same event now matches C2
    drift = _compute_drift_markers(existing, fresh)
    assert len(drift) == 1
    assert drift[0]["kind"] == "canonical_drift"
    assert drift[0]["step_id"] == "s1"
    assert drift[0]["previous_canonical_step_id"] == "C1"
    assert drift[0]["new_canonical_step_id"] == "C2"


def test_no_drift_when_assignment_unchanged():
    existing = [_step("s1", "edited", "C1", ["e1"])]
    fresh = [_step("f1", "auto_matched", "C1", ["e1"])]
    assert _compute_drift_markers(existing, fresh) == []


def test_drift_ignores_auto_steps_and_steps_without_prior_canonical():
    existing = [
        _step("s-auto", "auto_suggested", "C1", ["e1"]),   # not curated -> ignored
        _step("s-nocid", "edited", None, ["e2"]),           # no prior cid -> ignored
    ]
    fresh = [_step("f1", "auto_matched", "C9", ["e1", "e2"])]
    assert _compute_drift_markers(existing, fresh) == []


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
