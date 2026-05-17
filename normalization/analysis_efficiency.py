"""Process efficiency ratio -- IMPROVEMENTS.md Cluster N, I77.

The standard lean metric: value-add time over total elapsed time,
rolled up from the waste classifier's per-step VA / NVA split. The
ratio is over stepped time -- un-stepped stretches of the recording do
not count toward the denominator.
"""

from __future__ import annotations

from typing import Any


def compute_efficiency(
    waste_classification: list[dict[str, Any]],
) -> dict[str, Any]:
    total_va = sum(w.get("va_ms", 0) for w in waste_classification)
    total_bnva = sum(w.get("bnva_ms", 0) for w in waste_classification)
    total_nva = sum(w.get("nva_ms", 0) for w in waste_classification)
    total_elapsed = sum(w.get("elapsed_ms", 0) for w in waste_classification)
    ratio = (total_va / total_elapsed) if total_elapsed else 0.0

    per_step = []
    for w in waste_classification:
        el = w.get("elapsed_ms", 0)
        per_step.append({
            "step_id": w.get("step_id"),
            "ratio": round(w.get("va_ms", 0) / el, 4) if el else 0.0,
        })

    return {
        "process_efficiency_ratio": round(ratio, 4),
        "total_va_ms": total_va,
        "total_bnva_ms": total_bnva,
        "total_nva_ms": total_nva,
        "total_elapsed_ms": total_elapsed,
        "per_step": per_step,
    }
