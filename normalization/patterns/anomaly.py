"""Per-case anomaly detection (ADR-0029).

For each case, compute a feature vector — case duration, step count,
app-switch count, idle-gap total, distinct activity clusters — and flag
cases whose value on ANY feature lies more than 2 standard deviations from
the session mean. The anomaly_score is the largest sigma deviation
normalised into [0, 1]; the reasons list names every feature that tripped.

Pure stdlib (statistics.stdev for sample stdev).
"""
from __future__ import annotations

from statistics import mean, stdev
from typing import Any

# Anything beyond this many sigmas saturates the anomaly_score at 1.0. Two
# sigmas is the trigger; six is the practical upper bound (anything past that
# is degenerate data, not a meaningful score).
_SIGMA_TRIGGER = 2.0
_SIGMA_SATURATION = 6.0
# Idle-gap threshold (ms) for the per-case idle-gap accumulator. Same intent
# as the case_inference 3-minute threshold but applied at the feature level.
_IDLE_GAP_MS = 60_000


def _parse_ts_safe(ts: str | None):
    """Parse an ISO timestamp via the pipeline's own helper. Returns None on
    a malformed / missing input — the caller skips that step's contribution."""
    if not ts:
        return None
    try:
        from _dt import parse_ts_or_epoch as parse_ts
    except Exception:
        return None
    try:
        return parse_ts(ts)
    except Exception:
        return None


def _case_feature_vector(
    case_id: str,
    case_steps: list[dict[str, Any]],
    cluster_id_by_step: dict[str, str],
) -> dict[str, float]:
    """Build the 5-dimensional feature vector for one case. Robust to missing
    fields — a step with no time_range contributes nothing to the duration
    metric but still counts toward step_count."""
    case_steps = sorted(
        case_steps,
        key=lambda s: ((s.get("time_range") or {}).get("start") or ""),
    )
    step_count = float(len(case_steps))

    # Case duration: from the first step's start to the last step's end.
    duration_ms = 0.0
    if case_steps:
        first = _parse_ts_safe((case_steps[0].get("time_range") or {}).get("start"))
        last = _parse_ts_safe((case_steps[-1].get("time_range") or {}).get("end"))
        if first and last and last >= first:
            duration_ms = (last - first).total_seconds() * 1000.0

    # App switches: count adjacent step pairs where grain_keys.app differs.
    app_switches = 0
    for prev, curr in zip(case_steps, case_steps[1:]):
        a1 = (prev.get("grain_keys") or {}).get("app") or ""
        a2 = (curr.get("grain_keys") or {}).get("app") or ""
        if a1 and a2 and a1 != a2:
            app_switches += 1

    # Idle-gap total: sum of inter-step gaps that exceed the threshold.
    idle_total_ms = 0.0
    for prev, curr in zip(case_steps, case_steps[1:]):
        end_prev = _parse_ts_safe((prev.get("time_range") or {}).get("end"))
        start_curr = _parse_ts_safe((curr.get("time_range") or {}).get("start"))
        if end_prev and start_curr and start_curr >= end_prev:
            gap_ms = (start_curr - end_prev).total_seconds() * 1000.0
            if gap_ms >= _IDLE_GAP_MS:
                idle_total_ms += gap_ms

    distinct_clusters = float(len({
        cluster_id_by_step.get(s.get("step_id") or "")
        for s in case_steps
        if cluster_id_by_step.get(s.get("step_id") or "")
    }))

    return {
        "duration_ms": float(duration_ms),
        "step_count": step_count,
        "app_switches": float(app_switches),
        "idle_total_ms": float(idle_total_ms),
        "distinct_clusters": distinct_clusters,
    }


def _sigma_from_mean(value: float, mu: float, sd: float) -> float:
    """Two-sided sigma deviation of `value` from mean `mu` (stdev `sd`).
    Returns 0 when sd is 0 (no spread → nothing is anomalous)."""
    if sd <= 0.0:
        return 0.0
    return abs(value - mu) / sd


def _reason_label(feature: str, sigmas: float, direction: str) -> str:
    """Human-readable reason string: "duration_ms_2.4_sigma_above_mean"."""
    return f"{feature}_{round(sigmas, 1)}_sigma_{direction}_mean"


def detect_anomalies(
    steps: list[dict[str, Any]],
    cluster_id_by_step: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Flag cases whose feature vector lies > 2σ from the session mean on any
    of the five features. Returns one entry per anomalous case, sorted by
    descending anomaly_score then by case_id (stable tie-break).

    `cluster_id_by_step` is the optional map from step_id to the activity
    cluster the step belongs to (`distinct_clusters` feature) — absent, the
    feature degrades to 0 and never trips the threshold on its own.
    """
    if not steps:
        return []
    cluster_id_by_step = cluster_id_by_step or {}

    by_case: dict[str, list[dict[str, Any]]] = {}
    for s in steps:
        cid = s.get("case_id")
        if not cid:
            continue
        by_case.setdefault(cid, []).append(s)

    if len(by_case) < 2:
        # A single case has no peer distribution — sigma is undefined and the
        # "differs from peers" framing degenerates. Quietly return [].
        return []

    feature_vectors: dict[str, dict[str, float]] = {
        cid: _case_feature_vector(cid, case_steps, cluster_id_by_step)
        for cid, case_steps in by_case.items()
    }

    feature_names = ("duration_ms", "step_count", "app_switches",
                     "idle_total_ms", "distinct_clusters")
    stats_by_feature: dict[str, tuple[float, float]] = {}
    for feat in feature_names:
        values = [fv[feat] for fv in feature_vectors.values()]
        mu = mean(values) if values else 0.0
        try:
            sd = stdev(values) if len(values) > 1 else 0.0
        except Exception:
            sd = 0.0
        stats_by_feature[feat] = (mu, sd)

    anomalies: list[dict[str, Any]] = []
    for cid, fv in feature_vectors.items():
        reasons: list[str] = []
        max_sigma = 0.0
        for feat in feature_names:
            mu, sd = stats_by_feature[feat]
            sigmas = _sigma_from_mean(fv[feat], mu, sd)
            if sigmas >= _SIGMA_TRIGGER:
                direction = "above" if fv[feat] > mu else "below"
                reasons.append(_reason_label(feat, sigmas, direction))
            if sigmas > max_sigma:
                max_sigma = sigmas
        if reasons:
            # Map max sigma into [0, 1]: 2σ → 0.33, 6σ → 1.0.
            denom = (_SIGMA_SATURATION - _SIGMA_TRIGGER) or 1.0
            score = (max_sigma - _SIGMA_TRIGGER) / denom
            anomaly_score = max(0.0, min(1.0, 1.0 / 3.0 + (2.0 / 3.0) * score))
            anomalies.append({
                "case_id": cid,
                "anomaly_score": round(anomaly_score, 4),
                "reasons": reasons,
            })

    anomalies.sort(key=lambda a: (-a["anomaly_score"], a["case_id"]))
    return anomalies
