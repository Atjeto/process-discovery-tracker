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


def test_pdd_structure_mirrors_real_pdd():
    """The PDD follows a standard RPA-PDD outline (document control, introduction,
    an As-Is description, an automation assessment, exceptions) -- auto-filled
    where we have data, with explicit placeholders for the analyst-judgement
    sections rather than silently omitting them."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, _stats, analysis = _sample()
    stats = {
        "activity_stats": [
            {"activity_label": "Text entry -- app.exe", "frequency": 3,
             "total_duration_ms": 30000, "median_ms": 10000},
            {"activity_label": "Search -- app.exe", "frequency": 1,
             "total_duration_ms": 10000, "median_ms": 10000},
        ],
        "case_stats": [
            {"case_id": "c1", "active_ms": 40000},
            {"case_id": "c2", "active_ms": 60000},
        ],
        "meta": {"case_count": 2, "step_count": 5,
                 "step_state_breakdown": {"auto_suggested": 4, "edited": 1},
                 "phase_count": 0,
                 "vocab_coverage": {"app.exe": {"total_interactions": 12}}},
    }
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp),
            canonical={"name": "Order entry", "version": 2},
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        texts = [p.text for p in doc.paragraphs]
        cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]

        # The canonical section outline is present.
        for heading in ["1. Document control", "2. Introduction", "3. As-Is Process",
                        "3.2 Applications used", "3.4 Process statistics",
                        "3.5 Detailed process steps", "4. Automation assessment",
                        "4.3 Automation candidates", "5. Exceptions & variations"]:
            assert heading in texts, f"missing PDD section: {heading}"

        # Analyst-judgement gaps are explicit, not silently dropped.
        assert any(t.startswith("[To be completed:") for t in texts)

        # Auto-filled data lands in the right sections.
        assert any(c == "2 (avg 50.0s each)" for c in cells)            # 3.4 statistics
        assert any(c == "5 (4 auto-detected, 1 confirmed)" for c in cells)
        assert any(c == "app.exe" for c in cells)                       # 3.2 applications
        assert any("Where the time went" in t for t in texts)
        assert any(c == "Enter customer data" for c in cells)           # 4.3 candidates
        assert any(c == "90%" for c in cells)                           # repetitiveness 0.9
        assert any(t.startswith("Generated by the Process Discovery Viewer") for t in texts)


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
