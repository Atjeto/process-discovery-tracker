"""Consistency guard for the parse_ts family.

The eight per-module ``parse_ts`` / ``_parse_ts`` symbols are now thin
re-exports of three modes in :mod:`_dt` (``parse_ts`` / ``parse_ts_or_none`` /
``parse_ts_or_epoch``). This test still pins the family contract -- a valid
timestamp, INCLUDING a zone-less one, must come back tz-AWARE so events from
different sources (e.g. a hand-edited entry without a zone alongside the
recorder's zoned timestamps) can be compared / subtracted without
"can't subtract offset-naive and offset-aware datetimes". The step-segmenter
fuzzer originally surfaced this in ``step_suggest.parse_ts``; the test now
guards both the shared helper and every re-export so a future module can't
quietly reintroduce a naive-returning copy.

Run: pytest normalization/test/test_parse_ts_consistency.py
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# (module, function) for each parse_ts copy. Imported defensively so a copy in a
# module with an optional dependency (e.g. pm4py) is skipped where it is absent
# rather than erroring the whole file.
_SPECS = [
    ("_dt", "parse_ts"),
    ("_dt", "parse_ts_or_none"),
    ("_dt", "parse_ts_or_epoch"),
    ("analysis_common", "parse_ts"),
    ("bpmn_observed", "_parse_ts"),
    ("canonical_match", "_parse_ts"),
    ("case_assignment", "_parse_ts"),
    ("coalesce", "_parse_ts"),
    ("stats_compute", "_parse_ts"),
    ("step_suggest", "parse_ts"),
    ("xes_export", "_parse_ts"),
]
_PARSERS = []
for _mod, _fn in _SPECS:
    try:
        _PARSERS.append((f"{_mod}.{_fn}", getattr(importlib.import_module(_mod), _fn)))
    except Exception:  # noqa: BLE001 -- optional dep absent; just skip that copy
        pass


def test_family_is_non_empty():
    assert _PARSERS, "no parse_ts copies were importable"


def test_all_parse_ts_return_aware():
    for label, fn in _PARSERS:
        for ts in ("2026-05-18T09:00:00", "2026-05-18T09:00:00Z",
                   "2026-05-18T09:00:00+02:00"):
            dt = fn(ts)
            assert dt is not None and dt.tzinfo is not None, \
                f"{label}({ts!r}) -> {dt!r} is tz-naive"


def test_mixed_zone_subtraction_does_not_raise():
    # The exact crash the fuzzer found: one zone-less + one zoned timestamp.
    for label, fn in _PARSERS:
        a = fn("2026-05-18T09:00:00")        # zone-less -> must be tz-aware
        b = fn("2026-05-18T09:00:05Z")
        assert (b - a).total_seconds() == 5, f"{label}: mixed-zone subtraction failed"
