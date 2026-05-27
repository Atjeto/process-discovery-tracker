"""Consistency guard for the parse_ts family.

There are several near-duplicate `parse_ts` / `_parse_ts` copies across the
pipeline (one per module). Every one MUST return a tz-AWARE datetime for a valid
timestamp -- including a zone-LESS one -- so timestamps from different events
(some hand-edited without a zone) can be compared / subtracted without
"can't subtract offset-naive and offset-aware datetimes". The step-segmenter
fuzzer surfaced this in step_suggest.parse_ts; this pins the WHOLE family so a
copy can't quietly drift back. (Consolidating the copies into one shared helper
is a separate refactor -- they have different fallback semantics: raise vs None
vs epoch.)

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
