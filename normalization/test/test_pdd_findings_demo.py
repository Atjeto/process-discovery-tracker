"""F2 on the demo: the findings the viewer ticks for the PDD are the findings
the PDD prints.

The viewer ticks the ids analysis.json names in `pdd_findings` (its `default`
list while the analyst has ticked nothing, else the ticked ones). This runs the
pipeline on a temp copy of the committed demo recording the way the viewer's
export does (the bundled taxonomy, the PDD written by the same run) and reads
section 1 of the written document back.

The pipeline imports pandas and pm4py and the PDD needs python-docx, so this
module skips where they are absent and runs under the full-deps gate.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import re
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


def _printed_claims(docx: Path) -> list[str]:
    """The numbered findings of section 1, in order, without the number."""
    from docx import Document
    texts = [p.text for p in Document(str(docx)).paragraphs]
    start, end = texts.index("Findings"), texts.index("Run-by-run analysis")
    claims = []
    for t in texts[start + 1:end]:
        m = re.match(r"^\d+\. (?:Across runs: )?(.*)$", t)
        if m:
            claims.append(m.group(1))
    return claims


def test_the_default_ticks_are_the_findings_the_pdd_prints(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    analysis = _analyze_and_export(folder, tmp_path / "pdd.docx")
    ticks = analysis["pdd_findings"]
    claims = {f["id"]: f["claim"] for f in analysis["findings"]}
    detector = {f["id"]: f["detector"] for f in analysis["findings"]}
    assert ticks["default"], "the demo has findings to print"
    # AD-20 is real on the demo: it has repeated sequences, none printable.
    assert "repetition" in detector.values()
    assert all(detector[i] != "repetition" for i in ticks["eligible"])
    assert _printed_claims(tmp_path / "pdd.docx") == [claims[i] for i in ticks["default"]]


def test_after_one_untick_the_pdd_prints_the_rest(tmp_path):
    folder = _copy_demo(tmp_path / "demo")
    default = _analyze_and_export(folder, tmp_path / "first.docx")["pdd_findings"]["default"]
    assert len(default) >= 2
    # Unticking the first finding stores the others explicitly (the viewer's
    # write), and the next export prints exactly those.
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    anno["memo_selection"] = default[1:]
    (folder / "annotations.json").write_text(json.dumps(anno, indent=2), encoding="utf-8")
    analysis = _analyze_and_export(folder, tmp_path / "second.docx")
    claims = {f["id"]: f["claim"] for f in analysis["findings"]}
    assert analysis["pdd_findings"]["default"] == default     # the selection does not move the default
    assert _printed_claims(tmp_path / "second.docx") == [claims[i] for i in default[1:]]
