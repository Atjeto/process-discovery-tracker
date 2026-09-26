"""Seeded property-based fuzzer for pdd_export's docx-free pure helpers.

pdd_export is overwhelmingly python-docx rendering -- `write_pdd` and its
`_write_*` section writers all need a live `Document`, which the test runner's
system Python lacks (only the bundled embeddable ships python-docx, and that
can't run pytest). So this fuzzer covers the part that CAN run here: the pure,
docx-free helpers that shape analyst-editable annotations and measured times
into display values before rendering --

    step_context.clock, _align_key

A hand-edited annotations.json / odd analysis block can hand these a
non-numeric duration or an odd step; they must degrade rather than crash
the PDD export. The docx-rendering body stays out of scope here (documented
in tech-debt #16).

Run with:
    pytest normalization/test/test_pdd_export_fuzz.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export  # noqa: E402  (docx import is lazy/guarded -> loads without it)
import step_context  # noqa: E402


BASE = 0x9DD_F022
ITERS = 4000


def _scalar(rng: Random):
    return rng.choice([
        0, 1, -1, 500, 1000, 59999, 3600000, 12345678,
        0.0, 1.5, -2.5, 1e9, float("nan"), float("inf"),
        None, "", "abc", "123", [], {}, True, False, [1, 2], {"x": 1},
    ])


def test_fuzz_duration_formatters_are_total():
    """clock (the place of a step in the recording) and fmt_ms (a length,
    the step map's documentation) are total over any scalar and return a
    string."""
    for i in range(ITERS):
        rng = Random(BASE + i)
        v = _scalar(rng)
        for fn in (step_context.clock, step_context.fmt_ms):
            try:
                out = fn(v)
                assert isinstance(out, str), f"non-str for {v!r}: {out!r}"
            except Exception as e:  # noqa: BLE001 - a crash here is a finding
                raise AssertionError(
                    f"CRASH [iter {i}]: {fn.__name__}({v!r}) -> {type(e).__name__}: {e}") from e


def test_fuzz_align_key_is_total():
    """_align_key names every step-ish object, however it was hand-edited."""
    for i in range(ITERS):
        rng = Random(BASE + 3_000_000 + i)
        step = {}
        for key in ("draft_key", "draft_keys", "name"):
            if rng.random() < 0.6:
                step[key] = _scalar(rng)
        try:
            out = pdd_export._align_key(step)
            assert isinstance(out, str) and out.split(":", 1)[0] in ("draft", "merge", "label")
        except Exception as e:  # noqa: BLE001
            raise AssertionError(
                f"CRASH [iter {i}]: _align_key({step!r}) -> {type(e).__name__}: {e}") from e
