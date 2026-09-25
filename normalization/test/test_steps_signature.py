"""The pipeline half of the shared steps signature golden (lane CC).

shared/steps-signature-golden.json pins the signature of the steps the
Overview's rows were measured from: normalization/steps_signature.py (the
pipeline writes it into analysis.json as `steps_signature`) and
viewer/rows-freshness.js (asserted by viewer/rows-freshness.test.js) must give
every case its signature. Here: the golden, and a real analysis of the demo,
whose recorded signature is the one of the steps it wrote into
annotations.json (the steps the viewer loads), so a project just analyzed
never reads as changed.

The demo test needs the pipeline's dependencies (pandas, pm4py) and skips
without them; it runs under the full-deps gate.
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

from steps_signature import signature_text, steps_signature  # noqa: E402

GOLDEN = json.loads((NORMALIZATION.parent / "shared" / "steps-signature-golden.json").read_text(encoding="utf-8"))
DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"
_PIPELINE_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))


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


def test_the_golden_covers_a_rename_what_the_rows_do_not_read_and_odd_values():
    assert GOLDEN["version"] == 1
    by_name = {c["name"]: c for c in GOLDEN["cases"]}
    assert by_name["a rename changes it"]["signature"] != by_name["a project"]["signature"]
    assert any(c.get("same_as") for c in GOLDEN["cases"])
    assert len({c["signature"] for c in GOLDEN["cases"]}) == len(GOLDEN["cases"]) - 1


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    assert steps_signature(case["annotations"]) == case["signature"]
    if case.get("same_as"):
        other = next(c for c in GOLDEN["cases"] if c["name"] == case["same_as"])
        assert case["signature"] == other["signature"]


def test_the_text_is_the_one_json_stringify_writes():
    """Whole floats read as integers, no spaces, a lone surrogate escaped:
    the text JSON.stringify builds from the same projection."""
    text = signature_text({"pattern_run": {"case_id": "c"}, "steps": [
        {"step_id": "a", "name": "x\ud800y", "order": 2.0, "state": "confirmed"}]})
    assert text == ('["c",[["a",null,"x\\ud800y","confirmed",null,null,2,null,null,null,null,null]]]')


@pytest.mark.skipif(not _PIPELINE_OK, reason="pipeline deps (pandas/pm4py) not installed")
def test_an_analysis_records_the_signature_of_the_steps_it_wrote(tmp_path):
    import normalize as normalize_mod
    folder = tmp_path / "s"
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    analysis = json.loads((folder / "analysis.json").read_text(encoding="utf-8"))
    written = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    assert analysis["stage_errors"] == []
    assert analysis["steps_signature"] == steps_signature(written)
    # A rename after the analysis is a change the Overview sees.
    written["steps"][0]["name"] = "Renamed after the analysis"
    assert steps_signature(written) != analysis["steps_signature"]


def test_a_failed_signature_is_null_and_named_in_stage_errors(tmp_path, monkeypatch):
    """C12: a signature that cannot be taken is null with one stage_errors
    entry; the Overview then reads the rows as older than the steps."""
    import pipeline_stages
    import steps_signature as sig_mod

    def boom(_anno):
        raise RuntimeError("signature broke")
    monkeypatch.setattr(sig_mod, "steps_signature", boom)
    result = pipeline_stages._run_analysis(tmp_path, [], {"steps": []}, {}, {"session_id": "x"}, cases={})
    assert result["steps_signature"] is None
    assert {"stage": "steps_signature", "error": "RuntimeError: signature broke"} in result["stage_errors"]
