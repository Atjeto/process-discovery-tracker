"""The demo recording through the pipeline and into the PDD (lane LUX-P).

The document no longer prints the analysis findings (its former section 1 is
cut), whatever the analyst ticked. analysis.json keeps `pdd_findings` exactly
as before, because the viewer still reads it (its "include in PDD" boxes;
the viewer lane removes both). This runs the pipeline on a temp copy of the
committed demo recording the way the viewer's export does (the bundled
taxonomy, the PDD written by the same run) and reads the document back.

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


def test_the_pdd_prints_no_finding_and_pdd_findings_is_still_written(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    analysis = _analyze_and_export(folder, tmp_path / "pdd.docx")
    ticks = analysis["pdd_findings"]
    claims = {f["id"]: f["claim"] for f in analysis["findings"]}
    detector = {f["id"]: f["detector"] for f in analysis["findings"]}
    assert ticks["default"], "the demo has findings the viewer offers"
    # AD-20 still holds for the viewer's boxes: repeated sequences are not offered.
    assert "repetition" in detector.values()
    assert all(detector[i] != "repetition" for i in ticks["eligible"])
    text = _text(tmp_path / "pdd.docx")
    for fid in ticks["eligible"]:
        assert claims[fid] not in text, claims[fid]
    assert "Findings" not in text


def test_a_selection_neither_prints_findings_nor_moves_the_default(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    default = _analyze_and_export(folder, tmp_path / "first.docx")["pdd_findings"]["default"]
    assert len(default) >= 2
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    anno["memo_selection"] = default[1:]
    (folder / "annotations.json").write_text(json.dumps(anno, indent=2), encoding="utf-8")
    analysis = _analyze_and_export(folder, tmp_path / "second.docx")
    claims = {f["id"]: f["claim"] for f in analysis["findings"]}
    assert analysis["pdd_findings"]["default"] == default     # the selection does not move the default
    after = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    assert after["memo_selection"] == default[1:]             # C10: the key round-trips
    text = _text(tmp_path / "second.docx")
    assert not any(claims[i] in text for i in default)
