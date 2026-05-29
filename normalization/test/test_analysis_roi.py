"""Tests for analysis_roi -- the €-ROI band over automation candidates (§10).

These are pure-function tests of `compute_roi` / `apply_estimated_savings`
with known inputs producing known €/hours. The module is stdlib-only (no
pandas), so this suite runs under a bare system Python with only pytest --
it imports analysis_roi directly, never the heavy pipeline.

Run with pytest:
    pytest normalization/test/test_analysis_roi.py
or directly:
    python normalization/test/test_analysis_roi.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_roi import apply_estimated_savings, compute_roi


def _cand(sig, mean_ms, n=4, sufficiency="multi_instance"):
    return {
        "segment_signature": sig,
        "label": f"seg {sig}",
        "instance_count": n,
        "mean_elapsed_ms": mean_ms,
        "estimated_savings_ms": None,
        "data_sufficiency": sufficiency,
    }


def test_known_money_and_hours():
    """Hand-computable case: mean 1h (3_600_000 ms), fraction 0.5, realism
    0.7 (expected), volume 1000/yr, rate €36/h.

    T_saved/instance = 3_600_000 * 0.5 * 0.7 = 1_260_000 ms.
    saved_ms/yr      = 1_260_000 * 1000 = 1_260_000_000 ms = 350 h.
    cost_per_ms      = 36 / 3_600_000 = 1e-5 €/ms.
    gross/yr         = 1_260_000_000 * 1e-5 = €12_600.
    """
    cands = [_cand("aaa", 3_600_000)]
    roi = compute_roi(cands, {"roi_inputs": {
        "loaded_cost_per_hour": 36,
        "automatable_fraction": 0.5,
        "annual_volume": 1000,
        "realism_factors": {"conservative": 0.5, "expected": 0.7, "optimistic": 0.9},
    }})
    assert roi["needs_input"] is False
    assert roi["currency"] == "EUR"
    r = roi["candidates"][0]
    exp = r["bands"]["expected"]
    assert exp["saved_hours_per_year"] == 350.0
    assert exp["gross_annual"] == 12600.0
    # No automation cost -> net == gross, payback null.
    assert exp["net_annual"] == 12600.0
    assert exp["payback_months"] is None


def test_band_ordering():
    """conservative <= expected <= optimistic on both hours and money."""
    roi = compute_roi([_cand("bbb", 1_000_000)], {"roi_inputs": {
        "loaded_cost_per_hour": 50,
        "annual_volume": 500,
    }})
    b = roi["candidates"][0]["bands"]
    assert (b["conservative"]["saved_hours_per_year"]
            <= b["expected"]["saved_hours_per_year"]
            <= b["optimistic"]["saved_hours_per_year"])
    assert (b["conservative"]["gross_annual"]
            <= b["expected"]["gross_annual"]
            <= b["optimistic"]["gross_annual"])


def test_no_loaded_cost_path():
    """Without a loaded labour rate: time-savings present, money null,
    needs_input flagged, but the candidate is still emitted."""
    roi = compute_roi([_cand("ccc", 600_000)], {"roi_inputs": {
        "annual_volume": 2000,
    }})
    assert roi["needs_input"] is True
    r = roi["candidates"][0]
    exp = r["bands"]["expected"]
    assert exp["saved_hours_per_year"] > 0
    assert exp["gross_annual"] is None
    assert exp["net_annual"] is None
    assert exp["payback_months"] is None
    assert r["needs_input"] is True
    assert roi["totals"]["saved_hours_per_year"] > 0
    assert roi["totals"]["net_annual"] is None


def test_empty_inputs_still_produces_hours_with_observed_floor():
    """Absent roi_inputs entirely: defaults apply, monetary null + needs_input,
    annual volume falls back to the observed instance count (flagged)."""
    roi = compute_roi([_cand("ddd", 120_000, n=4)], None)
    assert roi["needs_input"] is True
    r = roi["candidates"][0]
    assert r["volume_basis"] == "observed"
    assert r["annual_volume"] == 4.0
    # 120_000 * 0.7 (default fraction) * 0.7 (expected) * 4 / 3_600_000 h
    assert r["bands"]["expected"]["saved_hours_per_year"] > 0


def test_per_segment_overrides():
    """Per-segment volume / cost / fraction overrides win over the defaults."""
    cands = [_cand("seg1", 1_000_000), _cand("seg2", 1_000_000)]
    roi = compute_roi(cands, {"roi_inputs": {
        "loaded_cost_per_hour": 36,
        "automatable_fraction": 0.5,
        "annual_volume": 100,
        "annual_volume_overrides": {"seg1": 1000},
        "automatable_fraction_overrides": {"seg1": 1.0},
        "automation_cost_overrides": {"seg1": 10000},
    }})
    by_sig = {r["segment_signature"]: r for r in roi["candidates"]}
    s1, s2 = by_sig["seg1"], by_sig["seg2"]
    # seg1 used the overrides; seg2 the defaults -> seg1 saves far more.
    assert s1["annual_volume"] == 1000
    assert s1["automatable_fraction"] == 1.0
    assert s1["automation_cost"] == 10000
    assert (s1["bands"]["expected"]["gross_annual"]
            > s2["bands"]["expected"]["gross_annual"])
    # seg1 has a positive net and a defined automation cost -> payback set.
    assert s1["bands"]["expected"]["payback_months"] is not None


def test_payback_null_when_net_not_positive():
    """A huge automation cost drives net <= 0 -> payback is null."""
    roi = compute_roi([_cand("eee", 600_000)], {"roi_inputs": {
        "loaded_cost_per_hour": 30,
        "annual_volume": 50,
        "automation_cost": 5_000_000,   # dwarfs any realistic saving
        "amortization_years": 3,
    }})
    exp = roi["candidates"][0]["bands"]["expected"]
    assert exp["net_annual"] <= 0
    assert exp["payback_months"] is None


def test_single_instance_skipped():
    """Single-instance candidates carry no repeatability -> not projected."""
    cands = [_cand("multi", 100000, n=3),
             _cand("solo", 100000, n=1, sufficiency="single_instance")]
    roi = compute_roi(cands, {"roi_inputs": {"loaded_cost_per_hour": 40,
                                             "annual_volume": 100}})
    sigs = {r["segment_signature"] for r in roi["candidates"]}
    assert "multi" in sigs
    assert "solo" not in sigs


def test_apply_estimated_savings_backfills_with_annual_volume():
    """estimated_savings_ms is filled from the expected band when a real
    annual volume exists, and left null when the volume is the observed floor."""
    annual = [_cand("with_vol", 1_000_000)]
    roi = compute_roi(annual, {"roi_inputs": {"loaded_cost_per_hour": 40,
                                              "annual_volume": 200}})
    apply_estimated_savings(annual, roi)
    assert annual[0]["estimated_savings_ms"] is not None
    assert annual[0]["estimated_savings_ms"] > 0

    observed = [_cand("no_vol", 1_000_000)]
    roi2 = compute_roi(observed, None)   # observed-floor basis
    apply_estimated_savings(observed, roi2)
    assert observed[0]["estimated_savings_ms"] is None


def test_partial_realism_factors_merge():
    """A partial realism_factors override keeps the unspecified bands at default."""
    roi = compute_roi([_cand("fff", 1_000_000)], {"roi_inputs": {
        "loaded_cost_per_hour": 30,
        "annual_volume": 100,
        "realism_factors": {"expected": 0.8},
    }})
    factors = roi["inputs_used"]["realism_factors"]
    assert factors["expected"] == 0.8
    assert factors["conservative"] == 0.5   # default retained
    assert factors["optimistic"] == 0.9     # default retained


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
