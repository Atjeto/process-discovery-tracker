"""Analysis layer orchestrator -- IMPROVEMENTS.md Cluster N.

Runs the analytical modules over one normalized session and assembles
the `analysis.json` sidecar. `normalize.py` calls this after
`stats.json` is written and before the Phase E exports.

Each module runs in its own try/except: a failure in one (waste, time
study, automation, efficiency) must not lose the others -- analysis is
best-effort enrichment, never a hard pipeline dependency. A module that
fails leaves its output key null (never [] or {}) and adds one entry to
`stage_errors` (contract C12, RP-10), so no renderer can mistake the
failure for a measured "nothing found".

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
    stage_errors: list[dict[str, str]] = []

    def _stage(key: str, compute) -> None:
        try:
            result[key] = compute()
        except Exception as e:  # noqa: BLE001 -- recorded, never swallowed
            logger.warning("analysis: %s failed: %s", key, e)
            result[key] = None
            stage_errors.append({"stage": key, "error": f"{type(e).__name__}: {e}"})

    _stage("waste_classification",
           lambda: classify_waste(steps, events, stats or {}, seg, annotations))
    _stage("time_study", lambda: compute_time_study(steps, events, seg))
    _stage("segments", lambda: detect_segments(events, steps))
    _stage("automation_candidates",
           lambda: score_automation(steps, events, seg, annotations))
    if result["waste_classification"] is None:
        # The ratio is computed from the waste split; without it the check
        # cannot run at all.
        result["efficiency"] = None
        stage_errors.append({"stage": "efficiency",
                             "error": "not run: waste_classification failed"})
    else:
        _stage("efficiency",
               lambda: compute_efficiency(result["waste_classification"]))

    if stage_errors:
        result["stage_errors"] = stage_errors
    return result
