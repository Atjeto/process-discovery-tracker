"""Tests for normalize.reconcile_phase_membership (CR M-4).

Phase membership is stored twice -- on ``phase.step_ids`` AND on
``step.phase_id``. A re-merge preserves edited phases' ``step_ids``
verbatim, so a step that was deleted or renamed away can linger in a
phase's ``step_ids`` (inflated count) and a step that carries a
``phase_id`` can be missing from that phase's list. The reconcile pass
makes the two readings agree.

Run with:
    pytest normalization/test/test_reconcile_phase_membership.py

normalize.py pulls in heavy pipeline deps at import time; where those
are absent the whole module skips cleanly rather than erroring.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from normalize import reconcile_phase_membership
except Exception as exc:  # pragma: no cover - optional heavy deps absent
    pytest.skip(f"normalize.py unavailable ({exc})", allow_module_level=True)


def _step(step_id, phase_id=None):
    return {"step_id": step_id, "phase_id": phase_id}


def _phase(phase_id, step_ids):
    return {"phase_id": phase_id, "step_ids": list(step_ids)}


def test_dropped_step_id_is_pruned_from_step_ids():
    """A step id that no longer names a regenerated step is removed from
    phase.step_ids (the deleted / renamed-away case)."""
    steps = [_step("s1", "p1")]  # s2 was deleted in the re-merge
    phases = [_phase("p1", ["s1", "s2"])]
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1"]


def test_step_with_phase_id_is_added_to_step_ids():
    """A step that carries a phase_id but is missing from that phase's
    step_ids gets forward-stamped into the list (the orphaned-half case)."""
    steps = [_step("s1", "p1"), _step("s2", "p1")]
    phases = [_phase("p1", ["s1"])]  # s2 has phase_id but is not listed
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1", "s2"]


def test_both_directions_at_once():
    """Prune a dangling id and add a missing-but-stamped id in one pass."""
    steps = [_step("s1", "p1"), _step("s2", "p1")]  # s3 deleted
    phases = [_phase("p1", ["s1", "s3"])]  # s3 dangling, s2 missing
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1", "s2"]


def test_phase_id_pointing_at_missing_phase_is_cleared():
    """A step whose phase_id names a phase that no longer exists has its
    phase_id cleared (reverse cleanup)."""
    steps = [_step("s1", "gone")]
    phases = [_phase("p1", [])]
    reconcile_phase_membership(steps, phases)
    assert steps[0]["phase_id"] is None
    assert phases[0]["step_ids"] == []


def test_no_phase_id_step_is_left_alone():
    """A free step (no phase_id) is never added to any phase."""
    steps = [_step("s1", None)]
    phases = [_phase("p1", [])]
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == []
    assert steps[0]["phase_id"] is None


def test_idempotent_on_already_consistent_data():
    """A run over already-consistent data changes nothing."""
    steps = [_step("s1", "p1"), _step("s2", None)]
    phases = [_phase("p1", ["s1"])]
    reconcile_phase_membership(steps, phases)
    assert phases[0]["step_ids"] == ["s1"]
    assert steps[0]["phase_id"] == "p1"
    assert steps[1]["phase_id"] is None


def test_handles_empty_inputs():
    reconcile_phase_membership([], [])
    reconcile_phase_membership(None, None)  # type: ignore[arg-type]
