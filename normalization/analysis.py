"""Analysis layer orchestrator -- IMPROVEMENTS.md Cluster N.

Runs the analytical modules over one normalized session and assembles
the `analysis.json` sidecar. `normalize.py` calls this after
`stats.json` is written and before the Phase E exports.

Each module runs in its own try/except: a failure in one (waste, time
study, automation, efficiency) must not lose the others -- analysis is
best-effort enrichment, never a hard pipeline dependency.

ADR-0016 bumped the heuristic version: automation candidacy moved from
the atomic-step grain (one click per row) to coherent segments (a
contiguous same-app same-case run of interactions). `automation_candidates`
in analysis.json now carries segment-shaped entries, and a new
`segments` key lists every detected segment for the viewer's drill-in.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from analysis_automation import score_automation
from analysis_common import segment_steps
from analysis_efficiency import compute_efficiency
from analysis_segments import detect_segments
from analysis_time_study import compute_time_study
from analysis_waste import classify_waste

logger = logging.getLogger(__name__)

# Bump whenever the heuristics or their thresholds change, so consumers
# can tell analysis.json files apart across recalibrations. See ADR-0008
# (original) and ADR-0016 (segment-level automation candidacy).
HEURISTIC_VERSION = 2


def run_analysis(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    stats: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
    annotations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Produce the analysis.json payload for one session."""
    steps = steps or []
    events = events or []
    result: dict[str, Any] = {
        "meta": {
            "heuristic_version": HEURISTIC_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "session_id": (manifest or {}).get("session_id", ""),
            "step_count": len(steps),
            "provisional": True,
        },
        "waste_classification": [],
        "time_study": [],
        "segments": [],
        "automation_candidates": [],
        "efficiency": {},
    }
    if not steps:
        return result

    seg = segment_steps(steps, events)

    try:
        result["waste_classification"] = classify_waste(
            steps, events, stats or {}, seg, annotations)
    except Exception as e:  # noqa: BLE001 -- best-effort, log and continue
        logger.warning("analysis: waste classifier failed: %s", e)
    try:
        result["time_study"] = compute_time_study(steps, events, seg)
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: time study failed: %s", e)
    try:
        result["segments"] = detect_segments(events, steps)
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: segment detection failed: %s", e)
    try:
        result["automation_candidates"] = score_automation(
            steps, events, seg, annotations)
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: automation scorer failed: %s", e)
    try:
        result["efficiency"] = compute_efficiency(
            result["waste_classification"])
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: efficiency failed: %s", e)

    return result
