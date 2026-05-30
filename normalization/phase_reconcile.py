"""Reconcile regenerated annotations against existing curated ones.

Extracted from normalize.py (god-file decomposition, continues F4). On a
re-analyze the auto_* steps/phases are regenerated while manually_authored /
edited ones are preserved -- this module holds the three helpers that keep the
preserved and regenerated sets consistent:

  * _merge_phases -- keep curated phases, append the fresh auto phases;
  * reconcile_phase_membership -- make the dual phase<->step membership agree;
  * _compute_drift_markers -- flag curated steps whose canonical assignment
    would now resolve differently.

Pure (apart from reconcile_phase_membership's documented in-place mutation);
no I/O. normalize.py re-imports all three, so `from normalize import
reconcile_phase_membership` and the internal call sites resolve unchanged.
"""
from __future__ import annotations

import uuid as _uuid
from datetime import datetime, timezone


def _merge_phases(existing: list, fresh: list) -> list:
    """Preserve manually_authored and edited phases. Same semantics as
    _merge_steps."""
    by_state = {"manually_authored": [], "edited": []}
    for p in existing or []:
        st = p.get("state")
        if st in by_state:
            by_state[st].append(p)
    return by_state["manually_authored"] + by_state["edited"] + (fresh or [])


def reconcile_phase_membership(steps: list, phases: list) -> None:
    """Bidirectional reconcile of the dual phase-membership representation
    (CR M-4). Membership is stored twice -- on ``phase.step_ids`` AND on
    ``step.phase_id`` -- and ``_merge_phases`` preserves edited phases'
    ``step_ids`` verbatim with no check against the regenerated step set.
    A re-merge that deletes or renames a step id therefore leaves it
    dangling in ``step_ids`` (inflated count) and can drop a step that
    carries a ``phase_id`` from its phase's list.

    This pass makes the two readings agree, in place:
      * drop ids from every ``phase.step_ids`` that no longer name a step
        in ``steps`` (deleted / renamed away);
      * for every step that carries a ``phase_id`` naming a live phase,
        ensure it is listed in that phase's ``step_ids`` (forward stamp);
      * clear a step's ``phase_id`` when it points at a phase that no
        longer exists (reverse cleanup).

    Pure apart from the in-place mutation of the passed lists; no I/O.
    """
    phase_by_id = {p.get("phase_id"): p for p in (phases or []) if p.get("phase_id")}
    live_step_ids = {s.get("step_id") for s in (steps or []) if s.get("step_id")}

    # 1. Prune dangling ids from each phase's step_ids.
    for ph in phases or []:
        sids = ph.get("step_ids")
        if isinstance(sids, list):
            ph["step_ids"] = [sid for sid in sids if sid in live_step_ids]

    # 2. Reverse cleanup + forward stamp from step.phase_id.
    for s in steps or []:
        pid = s.get("phase_id")
        if pid is None:
            continue
        ph = phase_by_id.get(pid)
        if ph is None:
            # phase_id points at a phase that no longer exists.
            s["phase_id"] = None
            continue
        sids = ph.setdefault("step_ids", [])
        if not isinstance(sids, list):
            ph["step_ids"] = sids = []
        if s.get("step_id") not in sids:
            sids.append(s.get("step_id"))


def _compute_drift_markers(existing: list, fresh: list) -> list[dict]:
    """Compare existing (edited / manually_authored) steps against the
    fresh canonical match. Whenever an existing step that already had a
    canonical_step_id now lives inside a session whose canonical
    assignment for the same time-range names a different step, record a
    drift marker.
    """
    drift = []
    fresh_by_event = {}
    for fs in fresh or []:
        for evid in (fs.get("evidence", {}).get("interaction_event_ids") or []):
            fresh_by_event[evid] = fs.get("canonical_step_id")
    for s in existing or []:
        if s.get("state") not in ("manually_authored", "edited"):
            continue
        prev_cid = s.get("canonical_step_id")
        if not prev_cid:
            continue
        new_cid = None
        for evid in (s.get("evidence", {}).get("interaction_event_ids") or []):
            if evid in fresh_by_event:
                new_cid = fresh_by_event[evid]
                break
        if new_cid is not None and new_cid != prev_cid:
            drift.append({
                "marker_id": str(_uuid.uuid4()),
                "kind": "canonical_drift",
                "step_id": s.get("step_id"),
                "previous_canonical_step_id": prev_cid,
                "new_canonical_step_id": new_cid,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
    return drift
