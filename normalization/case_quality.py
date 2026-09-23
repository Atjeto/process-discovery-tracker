"""Case-quality block for analysis.json (lab-phase spec §A1).

The honesty architecture's gatekeeper: every Tier-2 (case-based) surface
-- cycle times, variants, per-case comparison -- renders only when this
block says the case segmentation is trustworthy. Two modes:

  markers      -- cases came from worker-fired (or hand-added) Start/End
                  markers.
  unsegmented  -- no cases at all; downstream case analysis would be
                  one meaningless default bucket.

`coverage` is the fraction of interaction events inside a case (their
stamped `case_ids` is non-empty). `tier2_unlocked` is the single gate
consumers check: mode != unsegmented AND coverage >= 0.7 AND
case_count >= 2 (Phase G-3: one case makes cycle-time / variant /
across-case comparison meaningless -- the owner's real session unlocked
Tier 2 on a single marked case at 0.999 coverage).

Pure stdlib; computed from the case-stamped event stream the pipeline
already has, written into analysis.json by pipeline_stages._run_analysis
(additive key -- nothing existing changes shape).
"""
from __future__ import annotations

from typing import Any

# Tier-2 unlock threshold: below this, too much of the observed work sits
# outside any case for per-case statistics to describe the session honestly.
COVERAGE_THRESHOLD = 0.7

# Tier-2 also needs something to COMPARE: cycle times, variants and
# repetition-across-cases are all relative statements between cases, so a
# single case can never unlock them (G-3).
MIN_CASES = 2


def compute_case_quality(
    events: list[dict[str, Any]],
    cases: Any,
) -> dict[str, Any]:
    """Build the `analysis.case_quality` block.

    `events` is the case-stamped derived stream (interactions carry
    `data.case_ids`); `cases` is whatever the case-assignment stage
    produced (a dict keyed by case_id -- only its length is read here).
    """
    case_count = len(cases) if cases else 0

    interactions = [
        e for e in (events or [])
        if isinstance(e, dict) and e.get("type") == "interaction"
    ]
    total = len(interactions)
    in_case = 0
    for ev in interactions:
        data = ev.get("data")
        if isinstance(data, dict) and data.get("case_ids"):
            in_case += 1
    coverage = round(in_case / total, 3) if total else 0.0

    mode = "unsegmented" if case_count == 0 else "markers"

    return {
        "mode": mode,
        "case_count": case_count,
        "coverage": coverage,
        "tier2_unlocked": (mode != "unsegmented"
                           and coverage >= COVERAGE_THRESHOLD
                           and case_count >= MIN_CASES),
    }
