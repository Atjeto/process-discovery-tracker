"""Pattern Layer orchestrator (ADR-0029).

`detect_patterns()` runs the four detectors — motif mining, activity
clustering, per-case anomaly detection, marker-free case inference — over the
session's events + steps + existing annotations, and assembles a single JSON-
serialisable result dict.

The pipeline-stage wrapper writes the result to ``<session>/patterns.json``;
this function itself never touches disk. Pure stdlib (each detector module is
stdlib-only on its own).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import anomaly, case_inference, clustering, motif_mining

# Bumped only when the output shape changes. Downstream consumers (Phase 2
# Cockpit, analysis_roi) pin against this to refuse a stale schema.
HEURISTIC_VERSION = 1
PATTERNS_SCHEMA_VERSION = 1


def _cluster_id_by_step(clusters: list[dict[str, Any]]) -> dict[str, str]:
    """Invert the cluster list into a step_id -> cluster_id map for the
    anomaly detector's `distinct_clusters` feature."""
    out: dict[str, str] = {}
    for c in clusters:
        cid = c.get("cluster_id")
        if not cid:
            continue
        for sid in c.get("step_ids") or []:
            if sid:
                out[sid] = cid
    return out


def detect_patterns(
    events: list[dict[str, Any]] | None,
    steps: list[dict[str, Any]] | None,
    existing_anno: dict[str, Any] | None,
) -> dict[str, Any]:
    """Run every Pattern Layer detector in order and assemble the result.

    Order matters once: activity clustering runs before anomaly detection so
    the anomaly module can use cluster ids for its `distinct_clusters`
    feature. Motif mining and case inference are independent and can run in
    any order; we run motifs first only because the spec lists them first.

    All four detectors handle empty inputs gracefully (each returns []), so
    calling this on a 0-event session is safe.
    """
    events = events or []
    steps = steps or []
    existing_anno = existing_anno if isinstance(existing_anno, dict) else {}

    motifs = motif_mining.find_motifs(steps)
    # PDT-1.0-SPEC §4.3 / ADR-0029: feed annotations.disagreements[] to the
    # clustering pass so user-rejected names penalise the cluster's
    # confidence on the next normalize. No live retraining — re-mining
    # constrained by saved disagreements is the constraint loop.
    disagreements = existing_anno.get("disagreements") if isinstance(existing_anno, dict) else None
    clusters = clustering.find_activity_clusters(steps, events, disagreements=disagreements)
    anomalies = anomaly.detect_anomalies(
        steps, cluster_id_by_step=_cluster_id_by_step(clusters)
    )
    case_inf = case_inference.infer_cases(events, steps, existing_anno)

    return {
        "version": PATTERNS_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "motifs": motifs,
        "activity_clusters": clusters,
        "anomalies": anomalies,
        "case_inference": case_inf,
        "heuristic_version": HEURISTIC_VERSION,
    }
