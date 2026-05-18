"""Analysis layer orchestrator -- IMPROVEMENTS.md Cluster N.

Runs the four analytical modules over one normalized session and
assembles the `analysis.json` sidecar. `normalize.py` calls this after
`stats.json` is written and before the Phase E exports.

Each module runs in its own try/except: a failure in one (waste, time
study, automation, efficiency) must not lose the others -- analysis is
best-effort enrichment, never a hard pipeline dependency.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from analysis_automation import score_automation
from analysis_common import segment_steps
from analysis_efficiency import compute_efficiency
from analysis_time_study import compute_time_study
from analysis_waste import classify_waste

logger = logging.getLogger(__name__)

# Bump whenever the heuristics or their thresholds change, so consumers
# can tell analysis.json files apart across recalibrations. See ADR-0008.
HEURISTIC_VERSION = 1


def run_analysis(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    phases: list[dict[str, Any]] | None = None,
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
        "automation_candidates": [],
        "efficiency": {},
    }
    if not steps:
        return result

    segments = segment_steps(steps, events)

    try:
        result["waste_classification"] = classify_waste(
            steps, events, stats or {}, segments, annotations)
    except Exception as e:  # noqa: BLE001 -- best-effort, log and continue
        logger.warning("analysis: waste classifier failed: %s", e)
    try:
        result["time_study"] = compute_time_study(steps, events, segments)
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: time study failed: %s", e)
    try:
        result["automation_candidates"] = score_automation(
            steps, events, segments, annotations)
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: automation scorer failed: %s", e)
    try:
        result["efficiency"] = compute_efficiency(
            result["waste_classification"])
    except Exception as e:  # noqa: BLE001
        logger.warning("analysis: efficiency failed: %s", e)

    return result
