"""Seeded property-based fuzzer for pdd_export's docx-free pure helpers.

pdd_export is overwhelmingly python-docx rendering -- `write_pdd` and its
`_write_*` section writers all need a live `Document`, which the test runner's
system Python lacks (only the bundled embeddable ships python-docx, and that
can't run pytest). So this fuzzer covers the part that CAN run here: the pure,
docx-free helpers that shape analyst-editable annotations / derived analysis
into display values before rendering --

    _fmt_ms, _analysis_maps, _has_bnva_override

A hand-edited annotations.json / odd analysis block can hand these a non-dict
annotations, a non-numeric duration, or a non-list classification; they
must degrade rather than crash the PDD export. The docx-rendering body stays
out of scope here (documented in tech-debt #16).

Run with:
    pytest normalization/test/test_pdd_export_fuzz.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export  # noqa: E402  (docx import is lazy/guarded -> loads without it)


BASE = 0x9DD_F022
ITERS = 4000


def _scalar(rng: Random):
    return rng.choice([
        0, 1, -1, 500, 1000, 59999, 3600000, 12345678,
        0.0, 1.5, -2.5, 1e9,
        None, "", "abc", "123", [], {}, True, False, [1, 2], {"x": 1},
    ])


def _corrupt(rng: Random, value):
    return rng.choice([value, value, None, "", 42, [], {}, True, "str", [1]])


def _annotations(rng: Random):
    """A random annotations-ish object, sometimes well-formed, sometimes the
    kind of hand-edited shape that reaches _has_bnva_override."""
    shape = rng.random()
    if shape < 0.5:
        n = rng.randint(0, 4)
        ovs = []
        for _ in range(n):
            ov = {}
            if rng.random() < 0.7:
                ov["step_id"] = "s" + str(rng.randint(0, 5))
            if rng.random() < 0.6:
                ov["bnva_ms"] = _corrupt(rng, rng.choice([0, 1000, None]))
            ovs.append(_corrupt(rng, ov) if rng.random() < 0.2 else ov)
        return {"analysis_overrides": _corrupt(rng, ovs) if rng.random() < 0.2 else ovs}
    return _corrupt(rng, {"analysis_overrides": []})


def _analysis(rng: Random):
    shape = rng.random()
    if shape < 0.5:
        n = rng.randint(0, 4)
        rows = []
        for _ in range(n):
            row = {}
            if rng.random() < 0.7:
                row["step_id"] = "s" + str(rng.randint(0, 5))
            if rng.random() < 0.5:
                row["waste_ms"] = _corrupt(rng, 1000)
            rows.append(_corrupt(rng, row) if rng.random() < 0.2 else row)
        return {"waste_classification": _corrupt(rng, rows) if rng.random() < 0.2 else rows}
    return _corrupt(rng, {"waste_classification": []})


def test_fuzz_fmt_ms_total():
    """_fmt_ms is total over any scalar and returns a string."""
    for i in range(ITERS):
        rng = Random(BASE + i)
        v = _scalar(rng)
        try:
            out = pdd_export._fmt_ms(v)
            assert isinstance(out, str), f"non-str for {v!r}: {out!r}"
        except Exception as e:  # noqa: BLE001 - a crash here is a finding
            raise AssertionError(f"CRASH [iter {i}]: _fmt_ms({v!r}) -> {type(e).__name__}: {e}") from e


def test_fuzz_analysis_maps_total():
    """_analysis_maps never crashes on a corrupt analysis block; returns a dict."""
    for i in range(ITERS):
        rng = Random(BASE + 2_000_000 + i)
        a = _analysis(rng)
        try:
            out = pdd_export._analysis_maps(a)
            assert isinstance(out, dict), f"non-dict: {out!r}"
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"CRASH [iter {i}]: _analysis_maps({a!r}) -> {type(e).__name__}: {e}") from e


def test_fuzz_has_bnva_override_total():
    """_has_bnva_override never crashes on hand-edited annotations; returns bool."""
    for i in range(ITERS):
        rng = Random(BASE + 3_000_000 + i)
        anno = _annotations(rng)
        try:
            out = pdd_export._has_bnva_override(anno)
            assert isinstance(out, bool), f"non-bool: {out!r}"
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}]: _has_bnva_override({anno!r}) -> {type(e).__name__}: {e}") from e
