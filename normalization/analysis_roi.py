"""€-ROI layer: turn automation candidates into a savings band -- §10.

The analysis layer detects *which* coherent segments are worth scoping
to a robot (`analysis_automation.score_automation`) but stops at the
observed mean instance duration -- `estimated_savings_ms` has always
been `None` because savings cannot be derived from a single recording
without two analyst-supplied facts: how often the process runs per year
and what an hour of the operator's time costs loaded.

This module turns each candidate into a savings estimate using the
`roi_inputs` annotations block. The methodology is deliberately plain
arithmetic (no model, no fabricated numbers):

    T_manual   = observed mean_elapsed_ms                 (per instance)
    T_saved    = T_manual * automatable_fraction * realism (per instance)
    gross/yr   = annual_volume * T_saved * cost_per_ms
    net/yr     = gross/yr - amortized_automation_cost/yr
    payback    = automation_cost / (net/yr / 12)          (months; null if net<=0)

`cost_per_ms = loaded_cost_per_hour / 3_600_000`. The estimate is a
band -- conservative / expected / optimistic -- driven by three realism
factors, so the deliverable reads as a range rather than a false-
precision point.

Honesty rules (the assessment is explicit about not fabricating):
- The **time-savings** band (hours/yr) is always emitted, because it
  needs only the observed mean and a volume floor.
- **Monetary** figures are null with `needs_input: true` when
  `loaded_cost_per_hour` is absent -- we do not invent a labour rate.
- When no annual volume is supplied we fall back to the observed
  instance count as a conservative floor and flag it
  (`volume_basis: "observed"`) -- one session is not a year.

stdlib-only on purpose: the unit test must run under a bare Python
(no pandas), so this module imports nothing from the heavy pipeline.
"""

from __future__ import annotations

from typing import Any

_MS_PER_HOUR = 3_600_000
_MS_PER_YEAR_HOURS = 3_600_000  # cost_per_ms = loaded_cost_per_hour / this

DEFAULTS = {
    "currency": "EUR",
    "loaded_cost_per_hour": None,
    "realism_factors": {"conservative": 0.5, "expected": 0.7, "optimistic": 0.9},
    "automatable_fraction": 0.7,
    "automation_cost": None,
    "amortization_years": 3.0,
    # annual_volume basis: a flat default applied to every candidate, or a
    # per-segment override map keyed by segment_signature. Absent -> observed
    # instance count is used as a conservative floor.
    "annual_volume": None,
    "annual_volume_overrides": {},
    "automation_cost_overrides": {},
    "automatable_fraction_overrides": {},
}


def _resolve_inputs(roi_inputs: dict | None) -> dict[str, Any]:
    """Merge the analyst `roi_inputs` block on top of DEFAULTS, defensively
    (a hand-edited or partial block must not crash the computation)."""
    ri = roi_inputs if isinstance(roi_inputs, dict) else {}
    merged = dict(DEFAULTS)
    for k, v in ri.items():
        if k in merged:
            merged[k] = v
    # realism_factors: merge per-key so a partial override keeps the others.
    rf = dict(DEFAULTS["realism_factors"])
    if isinstance(ri.get("realism_factors"), dict):
        for band, val in ri["realism_factors"].items():
            try:
                rf[band] = float(val)
            except (TypeError, ValueError):
                pass
    merged["realism_factors"] = rf
    for mp in ("annual_volume_overrides", "automation_cost_overrides",
               "automatable_fraction_overrides"):
        if not isinstance(merged.get(mp), dict):
            merged[mp] = {}
    return merged


def _num(value, default=None):
    """Coerce to float or return default; tolerant of strings / None / junk."""
    if value is None:
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f


def _volume_for(sig: str, cfg: dict) -> tuple[float | None, str]:
    """Resolve the annual volume for one segment signature.

    Returns (volume, basis) where basis is "annotated" (per-segment override),
    "default" (flat annual_volume), or "" when neither is set (caller falls
    back to the observed instance count)."""
    ov = cfg["annual_volume_overrides"].get(sig)
    v = _num(ov)
    if v is not None and v > 0:
        return v, "annotated"
    v = _num(cfg["annual_volume"])
    if v is not None and v > 0:
        return v, "default"
    return None, ""


def _fraction_for(sig: str, cfg: dict) -> float:
    ov = _num(cfg["automatable_fraction_overrides"].get(sig))
    if ov is not None:
        return max(0.0, min(1.0, ov))
    base = _num(cfg["automatable_fraction"], DEFAULTS["automatable_fraction"])
    return max(0.0, min(1.0, base))


def _cost_for(sig: str, cfg: dict) -> float | None:
    ov = _num(cfg["automation_cost_overrides"].get(sig))
    if ov is not None:
        return ov
    return _num(cfg["automation_cost"])


def _candidate_roi(cand: dict, cfg: dict) -> dict[str, Any]:
    """Compute the ROI block for one automation candidate.

    Always emits the time-savings band. Monetary fields are populated only
    when a loaded labour rate is available; otherwise they are null and
    `needs_input` is true."""
    sig = cand.get("segment_signature") or ""
    mean_ms = _num(cand.get("mean_elapsed_ms"), 0.0) or 0.0
    instance_count = int(cand.get("instance_count") or 0)

    fraction = _fraction_for(sig, cfg)
    factors = cfg["realism_factors"]

    volume, volume_basis = _volume_for(sig, cfg)
    if volume is None:
        # No annual basis supplied -- use the observed instances as a floor.
        volume = float(instance_count)
        volume_basis = "observed"

    loaded_cost_per_hour = _num(cfg["loaded_cost_per_hour"])
    cost_per_ms = (loaded_cost_per_hour / _MS_PER_HOUR
                   if loaded_cost_per_hour is not None else None)
    automation_cost = _cost_for(sig, cfg)
    amort_years = _num(cfg["amortization_years"],
                       DEFAULTS["amortization_years"]) or DEFAULTS["amortization_years"]

    bands: dict[str, dict[str, Any]] = {}
    for band in ("conservative", "expected", "optimistic"):
        realism = _num(factors.get(band), DEFAULTS["realism_factors"][band])
        # Per-instance time saved, then annualised hours.
        t_saved_ms = mean_ms * fraction * realism
        saved_ms_per_year = t_saved_ms * volume
        saved_hours_per_year = round(saved_ms_per_year / _MS_PER_HOUR, 2)

        entry: dict[str, Any] = {
            "realism_factor": round(realism, 4),
            "saved_ms_per_instance": round(t_saved_ms),
            "saved_hours_per_year": saved_hours_per_year,
            "gross_annual": None,
            "net_annual": None,
            "payback_months": None,
        }
        if cost_per_ms is not None:
            gross_annual = saved_ms_per_year * cost_per_ms
            amortized = (automation_cost / amort_years
                         if (automation_cost is not None and amort_years > 0)
                         else 0.0)
            net_annual = gross_annual - amortized
            entry["gross_annual"] = round(gross_annual, 2)
            entry["net_annual"] = round(net_annual, 2)
            if automation_cost is not None and net_annual > 0:
                monthly_net = net_annual / 12.0
                entry["payback_months"] = round(automation_cost / monthly_net, 1)
            # else: net <= 0 or no automation cost -> payback stays null.
        bands[band] = entry

    needs_input = cost_per_ms is None
    expected = bands["expected"]

    return {
        "segment_signature": sig,
        "label": cand.get("label"),
        "instance_count": instance_count,
        "mean_elapsed_ms": round(mean_ms),
        "automatable_fraction": round(fraction, 4),
        "annual_volume": volume,
        "volume_basis": volume_basis,
        "automation_cost": automation_cost,
        "amortization_years": amort_years,
        "bands": bands,
        # Convenience top-level mirror of the expected band's money/hours.
        "expected_saved_hours_per_year": expected["saved_hours_per_year"],
        "expected_net_annual": expected["net_annual"],
        "expected_payback_months": expected["payback_months"],
        "needs_input": needs_input,
    }


def compute_roi(
    automation_candidates: list[dict[str, Any]] | None,
    annotations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute the €-ROI band for every automation candidate.

    Consumes the `automation_candidates` already produced by
    `analysis_automation.score_automation` (it reads `segment_signature`,
    `instance_count`, and `mean_elapsed_ms` off each candidate) plus the
    optional `roi_inputs` annotations block. Returns the `roi` block for
    analysis.json.

    Only multi-instance candidates carry a meaningful per-instance mean, so
    single-instance patterns are skipped (no repeatability signal). The
    returned shape:

        {
          "currency": "EUR",
          "needs_input": bool,          # true if no loaded labour rate
          "inputs_used": {...},         # the resolved (defaulted) inputs
          "candidates": [ <per-candidate ROI>, ... ],
          "totals": {                   # summed expected band across candidates
            "saved_hours_per_year": float,
            "net_annual": float | null,
            "gross_annual": float | null
          }
        }
    """
    cands = automation_candidates or []
    cfg = _resolve_inputs((annotations or {}).get("roi_inputs"))

    rows: list[dict[str, Any]] = []
    for cand in cands:
        if not isinstance(cand, dict):
            continue
        # Single-instance candidates have no repeatability -> skip (their
        # mean is one observation; an annual projection would be noise).
        if cand.get("data_sufficiency") == "single_instance":
            continue
        rows.append(_candidate_roi(cand, cfg))

    has_money = any(not r["needs_input"] for r in rows)
    total_hours = round(sum(
        r["bands"]["expected"]["saved_hours_per_year"] or 0.0 for r in rows), 2)
    total_net = None
    total_gross = None
    if has_money:
        total_net = round(sum(
            (r["bands"]["expected"]["net_annual"] or 0.0)
            for r in rows if r["bands"]["expected"]["net_annual"] is not None), 2)
        total_gross = round(sum(
            (r["bands"]["expected"]["gross_annual"] or 0.0)
            for r in rows if r["bands"]["expected"]["gross_annual"] is not None), 2)

    return {
        "currency": cfg["currency"] or "EUR",
        "needs_input": not has_money,
        "inputs_used": {
            "loaded_cost_per_hour": _num(cfg["loaded_cost_per_hour"]),
            "realism_factors": cfg["realism_factors"],
            "automatable_fraction": _num(
                cfg["automatable_fraction"], DEFAULTS["automatable_fraction"]),
            "annual_volume": _num(cfg["annual_volume"]),
            "automation_cost": _num(cfg["automation_cost"]),
            "amortization_years": _num(
                cfg["amortization_years"], DEFAULTS["amortization_years"]),
        },
        "candidates": rows,
        "totals": {
            "saved_hours_per_year": total_hours,
            "net_annual": total_net,
            "gross_annual": total_gross,
        },
    }


def apply_estimated_savings(
    automation_candidates: list[dict[str, Any]] | None,
    roi: dict[str, Any] | None,
) -> None:
    """Backfill each candidate's long-null `estimated_savings_ms` from the
    computed *expected* band, in place. Only set when monetary/volume inputs
    let us project a real annual saving (i.e. not the observed-floor + no-rate
    case): we set the **annualised** saved-ms for the expected band. Leaves
    it null when the candidate was skipped or inputs were absent."""
    if not automation_candidates or not roi:
        return
    by_sig = {r["segment_signature"]: r for r in (roi.get("candidates") or [])}
    for cand in automation_candidates:
        if not isinstance(cand, dict):
            continue
        r = by_sig.get(cand.get("segment_signature"))
        if r is None:
            continue
        # Only fill when we have a real annual volume basis -- the observed
        # floor is not an annual savings figure, so we leave the long-standing
        # null in place there rather than fabricate one.
        if r.get("volume_basis") == "observed":
            continue
        expected = r["bands"]["expected"]
        saved_ms = expected["saved_ms_per_instance"] * r["annual_volume"]
        cand["estimated_savings_ms"] = round(saved_ms)
