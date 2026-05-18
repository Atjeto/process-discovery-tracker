"""Automation candidate scorer -- IMPROVEMENTS.md Cluster N, I76.

Scores each logical step on repetitiveness and rule-basedness (both
need >= 2 instances to mean anything) plus a relative volume figure.

v1 honesty: a single-session recording rarely repeats a step, so
repetitiveness and rule-basedness are reported as null with
`data_sufficiency = "single_instance"` rather than a fabricated score.
`estimated_savings_ms` needs an analyst-supplied instances-per-day and
stays null.

The analyst confirms or dismisses a candidate through `analysis_overrides[]`
in annotations.json, surfaced here as `automation_confirmed`. Each entry
also carries `instances` and a `sequence_signature` -- a fingerprint of
how the step was performed -- so the Compare-Sessions view can pool the
same step across recordings (ANALYSIS-LAYER-FOLLOWUPS.md).
"""

from __future__ import annotations

import hashlib
from typing import Any

from analysis_common import overrides_by_step, segment_steps


def _interaction_sequence(step: dict, by_id: dict) -> tuple:
    ids = ((step.get("evidence") or {}).get("interaction_event_ids")) or []
    evs = [by_id[i] for i in ids if i in by_id]
    evs.sort(key=lambda e: e.get("timestamp") or "")
    return tuple((e.get("data") or {}).get("automation_id") or "" for e in evs)


def _group_key(step: dict) -> str:
    return step.get("canonical_step_id") or ("step:" + str(step.get("step_id")))


def _signature(seq: tuple) -> str | None:
    """A stable short hash of one interaction sequence, so the same step
    performed the same way across sessions compares equal. None when the
    step has no interaction events to fingerprint."""
    if not seq:
        return None
    return hashlib.sha1("\x1f".join(seq).encode("utf-8")).hexdigest()[:12]


def score_automation(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]] | None = None,
    segments: dict | None = None,
    annotations: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    events = events or []
    if segments is None:
        segments = segment_steps(steps, events)
    by_id = {e.get("event_id"): e for e in events if e.get("event_id")}
    ovr = overrides_by_step(annotations)

    groups: dict[str, list[dict]] = {}
    for step in steps:
        groups.setdefault(_group_key(step), []).append(step)

    out = []
    for group in groups.values():
        rep = group[0]
        instances = len(group)
        seqs = [_interaction_sequence(s, by_id) for s in group]
        seqs = [s for s in seqs if s]  # ignore steps with no interactions
        mean_elapsed = (
            sum((segments.get(s.get("step_id")) or {}).get("elapsed_ms", 0.0)
                for s in group) / instances
        ) if instances else 0.0

        modal = max(set(seqs), key=seqs.count) if seqs else ()
        if len(seqs) >= 2:
            repetitiveness = round(seqs.count(modal) / len(seqs), 3)
            rule_based = round(1.0 / len(set(seqs)), 3)
            sufficiency = "multi_instance"
        else:
            repetitiveness = None
            rule_based = None
            sufficiency = "single_instance"

        ov = ovr.get(rep.get("step_id"))
        confirmed = None
        if ov is not None and "automation_confirmed" in ov:
            confirmed = bool(ov["automation_confirmed"])

        out.append({
            "step_id": rep.get("step_id"),
            "canonical_step_id": rep.get("canonical_step_id"),
            "name": rep.get("name") or "",
            "instances": instances,
            "scores": {
                "repetitiveness": repetitiveness,
                "rule_based": rule_based,
                "volume": round(mean_elapsed * instances),
            },
            "sequence_signature": _signature(modal),
            "estimated_savings_ms": None,
            "automation_confirmed": confirmed,
            "data_sufficiency": sufficiency,
        })
    # Rank multi-instance, highly repetitive, high-volume steps first.
    out.sort(
        key=lambda r: (
            r["data_sufficiency"] == "multi_instance",
            r["scores"]["repetitiveness"] or 0,
            r["scores"]["volume"],
        ),
        reverse=True,
    )
    return out
