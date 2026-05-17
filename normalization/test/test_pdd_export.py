"""Tests for pdd_export -- the analysis-layer enrichment path (I78).

Deps-gated: write_pdd needs python-docx. When it is not installed the
tests no-op rather than fail, matching how the rest of the suite treats
optional dependencies.

Run with pytest:
    pytest normalization/test/test_pdd_export.py
or directly:
    python normalization/test/test_pdd_export.py
"""

from __future__ import annotations
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export

_HAVE_DOCX = pdd_export.Document is not None


def _sample():
    manifest = {
        "engagement_id": "ENG-1", "session_id": "s1",
        "started_at": "2026-05-17T10:00:00Z",
        "config": {"worker": {"id": "w1"}},
    }
    annotations = {
        "steps": [
            {"step_id": "st1", "name": "Enter customer data",
             "description": "", "flags": {}},
        ],
        "phases": [],
    }
    stats = {"activity_stats": []}
    analysis = {
        "waste_classification": [
            {"step_id": "st1", "name": "Enter customer data",
             "elapsed_ms": 100000, "va_ms": 60000, "bnva_ms": 0,
             "nva_ms": 40000, "waste_types": ["waiting", "motion"]},
        ],
        "automation_candidates": [
            {"step_id": "st1", "name": "Enter customer data",
             "scores": {"repetitiveness": 0.9, "rule_based": 1.0,
                        "volume": 100000},
             "data_sufficiency": "multi_instance"},
        ],
        "efficiency": {"process_efficiency_ratio": 0.6, "total_va_ms": 60000,
                       "total_nva_ms": 40000, "total_elapsed_ms": 100000},
    }
    return manifest, annotations, stats, analysis


def test_write_pdd_with_analysis_produces_a_file():
    if not _HAVE_DOCX:
        return  # python-docx absent -- deps-gated, nothing to assert
    manifest, annotations, stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out,
            session_folder=Path(tmp),
            canonical=None,
            annotations=annotations,
            stats=stats,
            manifest=manifest,
            analysis=analysis,
        )
        assert out.exists()
        assert out.stat().st_size > 0


def test_write_pdd_without_analysis_still_works():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, _ = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out,
            session_folder=Path(tmp),
            canonical=None,
            annotations=annotations,
            stats=stats,
            manifest=manifest,
        )
        assert out.exists()


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
