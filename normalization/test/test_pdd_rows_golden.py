"""The PDD half of the shared rows golden (lane CC, one source).

shared/pdd-rows-golden.json pins the rows of the PDD's section 5 (Data) and
section 6 (Applications and time): the pipeline computes them with
pdd_export.data_section and time_section, writes them into analysis.json as
`pdd_data` and `pdd_time` (pdd_rows), and prints the document from the same
functions; the viewer's Overview shows exactly those rows
(viewer/overview-observations.test.js reads the same golden). Here: pdd_rows
gives each case's rows, the exported PDD prints them cell by cell, and a
real analysis of the demo writes into analysis.json the rows its PDD prints.

python-docx and the pipeline's dependencies (pandas, pm4py) are needed for
the document and the demo; those tests skip where they are absent and run
under the full-deps gate.
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

import pdd_export  # noqa: E402

GOLDEN = json.loads((NORMALIZATION.parent / "shared" / "pdd-rows-golden.json").read_text(encoding="utf-8"))
DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"

_DOCX_OK = importlib.util.find_spec("docx") is not None
_PIPELINE_OK = _DOCX_OK and all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))


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


def _rows(fixture, folder="."):
    return pdd_export.pdd_rows(session_folder=Path(folder), annotations=json.loads(json.dumps(fixture["annotations"])),
                               stats=fixture["stats"], manifest=fixture["manifest"], events=fixture["events"])


def _tables(docx: Path) -> list[list[list[str]]]:
    """Every table of the document, as rows of cell texts."""
    from docx import Document
    return [[[c.text for c in row.cells] for row in t.rows] for t in Document(str(docx)).tables]


def _paragraphs(docx: Path) -> list[str]:
    from docx import Document
    return [p.text for p in Document(str(docx)).paragraphs]


def _printed(tables, header):
    """The rows under the table whose header row is `header`, or None."""
    for t in tables:
        if t and t[0] == list(header):
            return t[1:]
    return None


def test_the_golden_covers_the_tables_the_notes_and_the_re_keyed_data():
    assert GOLDEN["version"] == 1
    cases = [c["expected"] for c in GOLDEN["cases"]]
    assert any(c["pdd_data"]["rekeyed"] for c in cases), "a case re-keys a value"
    assert any(c["pdd_data"]["note"] for c in cases), "a case has no field entry"
    assert any(c["pdd_time"]["per_transaction"]["note"] for c in cases), "a case has no transaction marked"
    assert any(len(c["pdd_time"]["per_application"]["header"]) == 4 for c in cases), "a case has times"
    assert any(len(c["pdd_time"]["per_application"]["header"]) == 3 for c in cases), "a case has no step with a time"


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_pdd_rows_gives_the_golden_rows(case):
    assert _rows(case["fixture"]) == case["expected"]


@pytest.mark.skipif(not _DOCX_OK, reason="python-docx not installed")
@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_the_pdd_prints_the_golden_rows_cell_by_cell(case, tmp_path):
    fx, want = case["fixture"], case["expected"]
    out = tmp_path / "pdd.docx"
    pdd_export.write_pdd(out, session_folder=tmp_path, annotations=json.loads(json.dumps(fx["annotations"])),
                         stats=fx["stats"], manifest=fx["manifest"], events=fx["events"])
    tables, paras = _tables(out), _paragraphs(out)
    d = want["pdd_data"]
    assert "5. " + d["heading"] in paras
    if d["note"]:
        assert d["note"] in paras and _printed(tables, d["header"]) is None
    else:
        assert _printed(tables, d["header"]) == d["rows"]
        if d["rekeyed"]:
            i = paras.index("Re-keyed data")
            assert paras[i + 1:i + 1 + len(d["rekeyed"])] == d["rekeyed"]
    t = want["pdd_time"]
    assert "6. " + t["heading"] in paras
    tx, app = t["per_transaction"], t["per_application"]
    assert "6.1 " + tx["heading"] in paras and "6.2 " + app["heading"] in paras
    if tx["note"]:
        assert tx["note"] in paras and _printed(tables, tx["header"]) is None
    else:
        assert _printed(tables, tx["header"]) == tx["rows"]
        assert tx["after"] in paras
    if app["note"]:
        assert app["note"] in paras
    else:
        assert _printed(tables, app["header"]) == app["rows"]


@pytest.mark.skipif(not _PIPELINE_OK, reason="pipeline deps (pandas/pm4py/python-docx) not installed")
def test_an_analysis_writes_into_analysis_json_the_rows_its_pdd_prints(tmp_path):
    """The demo through the pipeline the way the viewer's export runs it: the
    rows in analysis.json are the tables and sentences of the PDD it wrote,
    and the format number says so (3 added the rows; 4, lane FX1, cut the
    analysis nobody read)."""
    import normalize as normalize_mod
    import pipeline_stages
    folder = tmp_path / "s"
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    out = tmp_path / "pdd.docx"
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True, pdd_out=str(out))
    analysis = json.loads((folder / "analysis.json").read_text(encoding="utf-8"))
    assert analysis["format"] == pipeline_stages.ANALYSIS_FORMAT == 4
    assert analysis["stage_errors"] == []
    d, t = analysis["pdd_data"], analysis["pdd_time"]
    tables, paras = _tables(out), _paragraphs(out)
    assert d["rows"] and _printed(tables, d["header"]) == d["rows"]
    assert d["rekeyed"] and all(line in paras for line in d["rekeyed"])
    assert _printed(tables, t["per_transaction"]["header"]) == t["per_transaction"]["rows"]
    assert _printed(tables, t["per_application"]["header"]) == t["per_application"]["rows"]
    # The same function on the same inputs: the viewer's numbers are the PDD's.
    assert t["per_application"]["header"][-1] == "Time per transaction"


def test_a_failed_rows_stage_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    """C12: when the rows cannot be computed, both keys are null and one
    stage_errors entry names the stage; the Overview says the check could not
    run."""
    import pipeline_stages

    def boom(**_k):
        raise RuntimeError("rows broke")
    monkeypatch.setattr(pdd_export, "pdd_rows", boom)
    result = pipeline_stages._run_analysis(tmp_path, [], {"steps": []}, {}, {"session_id": "x"}, cases={})
    assert result["pdd_data"] is None and result["pdd_time"] is None
    assert {"stage": "pdd_rows", "error": "RuntimeError: rows broke"} in result["stage_errors"]
