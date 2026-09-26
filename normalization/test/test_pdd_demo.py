"""The demo recording through the pipeline and into the PDD.

The document prints no analysis finding (its former section 1 was cut by
lane LUX-P), and since lane FX1 the pipeline computes none either: the
analysis layer nobody read (the facts, the findings, the step analysis and
the PDD's findings selection) is cut from analysis.json. A key the viewer of
the product edition wrote for it (`memo_selection`) still round-trips (C10).
This runs the pipeline on a temp copy of the committed demo recording the
way the viewer's export does (the bundled taxonomy, the PDD written by the
same run) and reads the document back.

The pipeline imports pandas and pm4py and the PDD needs python-docx, so this
module skips where they are absent and runs under the full-deps gate.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import shutil
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"

_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py", "docx"))
pytestmark = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py/python-docx) not installed")

# The analysis.json keys of the cut layer: none is written any more.
CUT_KEYS = ("facts", "findings", "pdd_findings", "waste_classification", "time_study",
            "segments", "automation_candidates", "efficiency")


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """normalize() attaches a file handler for <session>/normalize.log to the
    root logger; detach and close it so the temp folders are not held open."""
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _copy_demo(folder: Path) -> Path:
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    return folder


def _analyze_and_export(folder: Path, docx: Path) -> dict:
    import normalize as normalize_mod
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True, pdd_out=str(docx))
    return json.loads((folder / "analysis.json").read_text(encoding="utf-8"))


def _text(docx: Path) -> str:
    from docx import Document
    doc = Document(str(docx))
    rows = [" | ".join(c.text for c in r.cells) for t in doc.tables for r in t.rows]
    return "\n".join([p.text for p in doc.paragraphs] + rows)


def test_the_demo_pdd_prints_no_finding_and_the_analysis_writes_none(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    analysis = _analyze_and_export(folder, tmp_path / "pdd.docx")
    for key in CUT_KEYS:
        assert key not in analysis, key
    assert analysis["case_quality"]["case_count"] == 4
    assert "pdd_data" not in analysis and "pdd_time" not in analysis
    assert analysis["stage_errors"] == []
    text = _text(tmp_path / "pdd.docx")
    for word in ("Findings", "What the recording measured", "To say more"):
        assert word not in text, word


def test_a_legacy_memo_selection_round_trips_and_prints_nothing(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    anno["memo_selection"] = ["screen_time_sink-0123456789ab"]
    (folder / "annotations.json").write_text(json.dumps(anno, indent=2), encoding="utf-8")
    _analyze_and_export(folder, tmp_path / "pdd.docx")
    after = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    assert after["memo_selection"] == ["screen_time_sink-0123456789ab"]   # C10
    assert "screen_time_sink" not in _text(tmp_path / "pdd.docx")
