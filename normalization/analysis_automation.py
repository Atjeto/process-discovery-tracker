"""Automation candidacy at the coherent-segment level -- ADR-0016.

The earlier version of this module scored individual logical steps for
automation candidacy. That grain proved misleading: you do not
automate a single click ("Search button") if the form-fill before it
stays manual -- the resulting hybrid is worse than fully manual. The
unit of automation is the *stretch of work* a robot could realistically
take end-to-end: open the CRM, search the customer, copy three fields,
paste them into the booking screen, submit.

Segments (analysis_segments.detect_segments) capture that grain: a run
of contiguous same-app same-case interactions bounded by app/case
switches. This module pools segments across the session by
(app, step-label sequence) and scores each pattern: instance count,
total elapsed across instances, mean instance duration, and a
consistency score (modal-instance share / distinct-pattern count) that
mirrors the old per-step heuristic. The analyst confirms or dismisses
through `analysis_overrides[]` keyed by segment `signature`.

v1 honesty: a session with a single instance still produces no real
candidacy signal, so a pattern with `instance_count < 2` is reported
with null scores and `data_sufficiency = "single_instance"` rather
than a fabricated number. `estimated_savings_ms` needs an analyst-
supplied instances-per-day and stays null.
"""

from __future__ import annotations

from typing import Any

from analysis_segments import detect_segments, group_segments

# The share of a candidate's observed time a robot is assumed to take over,
# used in the automation priority. A flat default: the analyst inputs that used
# to override it per segment (roi_inputs) were removed with the ROI layer.
AUTOMATABLE_FRACTION = 0.7


def _override_for(annotations: dict | None, signature: str) -> dict | None:
    """Find the analyst `analysis_overrides[]` entry that targets this
    segment signature, if any. The new entry shape is keyed by
    `segment_signature` rather than `step_id`."""
    for ov in ((annotations or {}).get("analysis_overrides") or []):
        if (isinstance(ov, dict)
                and ov.get("segment_signature") == signature):
            return ov
    return None


def _confidence(modal_count: int, total: int, distinct: int) -> float | None:
    """A 0..1 score combining repetitiveness (modal / total) and rule-
    basedness (1 / distinct patterns) the same way the old per-step
    scorer did, lifted to the segment grain. Null when there is one
    instance -- one observation cannot judge consistency."""
    if total < 2:
        return None
    rep = modal_count / total
    rule = 1.0 / max(distinct, 1)
    return round((rep + rule) / 2.0, 3)


def score_automation(
    steps: list[dict[str, Any]],
    events: list[dict[str, Any]] | None = None,
    segments: dict | None = None,
    annotations: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return the segment-level automation candidates for this session.

    The `segments` argument is the per-step time segmentation produced
    by analysis_common.segment_steps -- accepted for signature
    compatibility with the rest of the analysis layer but not used
    here; segments in *this* module's sense are coherent automation
    units detected from the event stream. (The two have unfortunately
    similar names -- see ADR-0016.)
    """
    events = events or []
    segs = detect_segments(events, steps or [])
    groups = group_segments(segs)

    out: list[dict[str, Any]] = []
    for sig, g in groups.items():
        instances = g["instances"]
        n = len(instances)
        total_elapsed = sum(i["elapsed_ms"] for i in instances)
        mean_elapsed = round(total_elapsed / n) if n else 0
        # Each instance contributes the same signature here (that is
        # how groups are formed), so distinct-pattern count is 1 within
        # the group. Repetitiveness across instances is therefore 1.0
        # whenever n >= 2 -- the meaningful signal is `instance_count`
        # and `total_elapsed_ms`, not the consistency score, but we
        # keep the score for parity with the earlier per-step shape.
        confidence = _confidence(modal_count=n, total=n, distinct=1)
        sufficiency = "multi_instance" if n >= 2 else "single_instance"

        ov = _override_for(annotations, sig)
        confirmed = None
        if ov is not None and "automation_confirmed" in ov:
            confirmed = bool(ov["automation_confirmed"])

        apps = [g["app"]] if g["app"] else []
        case_ids = sorted({
            i.get("case_id") for i in instances if i.get("case_id")
        })
        # Automation priority (§11f): frequency × observed mean time ×
        # automatable fraction. This is the "how much manual time would a robot
        # actually remove per year of this pattern" proxy that feeds the PDD
        # focus order. Single-instance patterns have no repeatability signal,
        # so they get no rank_score (ranked last).
        fraction = AUTOMATABLE_FRACTION
        rank_score = (n * mean_elapsed * fraction) if n >= 2 else 0.0
        out.append({
            "segment_signature": sig,
            "label": g["label"],
            "app": g["app"],
            "apps": apps,
            "step_labels": list(g.get("step_labels") or []),
            "case_ids": case_ids,
            "instance_count": n,
            "total_elapsed_ms": total_elapsed,
            "mean_elapsed_ms": mean_elapsed,
            "instances": instances,
            "scores": {
                "confidence": confidence,
                "volume": total_elapsed,
            },
            "automatable_fraction": round(fraction, 4),
            "rank_score": round(rank_score, 2),
            "rank": None,  # 1-based, assigned after the sort below
            "estimated_savings_ms": None,
            "automation_confirmed": confirmed,
            "data_sufficiency": sufficiency,
        })

    # Rank by automation priority: multi-instance first, then by rank_score
    # (frequency × mean × automatable fraction), with total elapsed as a
    # stable tiebreak. The previous instance-count-first ordering buried a
    # rarely-but-very-long segment beneath a frequent-but-trivial one.
    out.sort(
        key=lambda r: (
            r["data_sufficiency"] == "multi_instance",
            r["rank_score"],
            r["total_elapsed_ms"],
        ),
        reverse=True,
    )
    # Stamp the 1-based rank onto the multi-instance candidates (the ones with
    # a real repeatability signal); single-instance rows keep rank=None.
    next_rank = 1
    for r in out:
        if r["data_sufficiency"] == "multi_instance":
            r["rank"] = next_rank
            next_rank += 1
    return out
