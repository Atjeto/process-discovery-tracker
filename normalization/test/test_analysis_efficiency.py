"""Tests for analysis_efficiency -- process efficiency ratio.

Run with pytest:
    pytest normalization/test/test_analysis_efficiency.py
or directly:
    python normalization/test/test_analysis_efficiency.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_efficiency import compute_efficiency


def _w(sid, elapsed, va, nva):
    return {"step_id": sid, "elapsed_ms": elapsed, "va_ms": va, "bnva_ms": 0, "nva_ms": nva}


def test_ratio_and_totals():
    eff = compute_efficiency([_w("s1", 1000, 600, 400), _w("s2", 1000, 800, 200)])
    assert eff["total_elapsed_ms"] == 2000
    assert eff["total_va_ms"] == 1400
    assert eff["total_nva_ms"] == 600
    assert eff["process_efficiency_ratio"] == 0.7


def test_per_step_ratios():
    eff = compute_efficiency([_w("s1", 1000, 250, 750)])
    assert eff["per_step"][0]["step_id"] == "s1"
    assert eff["per_step"][0]["ratio"] == 0.25


def test_empty_input_is_zero():
    eff = compute_efficiency([])
    assert eff["process_efficiency_ratio"] == 0.0
    assert eff["total_elapsed_ms"] == 0
    assert eff["per_step"] == []


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
