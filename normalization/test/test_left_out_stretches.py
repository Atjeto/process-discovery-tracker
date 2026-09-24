"""A stretch left out of the analysis (annotations.excluded_ranges), end to end
on the demo recording (lane CC).

The viewer's Timeline draws each stretch and offers Include again; here, the
pipeline's half: the transaction with a stretch left out says so once in the
PDD's 4.1, and the reference steps done in the stretch are not printed as
Skipped (the rule shared with the viewer, shared/run-differences-golden.json);
and the findings stage reads the stream without the stretch, as the drafting
and the statistics do.

Runs the pipeline on a temp copy of the committed demo, so it needs pandas,
pm4py and python-docx: it skips where they are absent and runs under the
full-deps gate.
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


def _demo(folder: Path) -> Path:
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    return folder


def _leave_out(folder: Path, start: str, end: str) -> None:
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    anno.setdefault("excluded_ranges", []).append({"start": start, "end": end, "reason": "manual"})
    (folder / "annotations.json").write_text(json.dumps(anno, indent=2), encoding="utf-8")


def _section_4_1(docx: Path) -> list[str]:
    from docx import Document
    paras = [p.text for p in Document(str(docx)).paragraphs]
    i = paras.index("4.1 Differences between transactions")
    j = paras.index("4.2 Business rules")
    return paras[i + 1:j]


def _lines_of(section: list[str], transaction: str) -> list[str]:
    """The lines under one transaction's bold label in 4.1."""
    out, inside = [], False
    for line in section:
        if line.startswith("Transaction "):
            inside = line.startswith(transaction)
            continue
        if inside:
            out.append(line)
    return out


def test_a_transaction_with_a_stretch_left_out_says_so_once_and_skips_nothing_inside_it(tmp_path):
    import normalize as normalize_mod
    folder = _demo(tmp_path / "s")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True, pdd_out=str(tmp_path / "before.docx"))
    before = _lines_of(_section_4_1(tmp_path / "before.docx"), "Transaction 2")
    # Transaction 2 (09:01:46 to 09:02:39) loses its first steps: Search, Open
    # customer record, Save order and Check document.
    _leave_out(folder, "2026-05-14T09:01:45Z", "2026-05-14T09:02:07Z")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True, pdd_out=str(tmp_path / "after.docx"))
    after = _lines_of(_section_4_1(tmp_path / "after.docx"), "Transaction 2")
    assert not any(line.startswith("Part of this transaction") for line in before), "control: nothing left out before"
    assert after[0] == "Part of this transaction was left out of the analysis (1:46 to 2:07).", after
    assert sum(line.startswith("Part of this transaction") for line in after) == 1, "said once"
    skipped = [line for line in after if line.startswith("Skipped: ")]
    for name in ("Account lookup: Search", "Open customer record", "Save order"):
        assert not any(name in line for line in skipped), (name, skipped)
    # The other transactions are compared as before: no stretch, no line.
    for other in ("Transaction 3", "Transaction 4"):
        assert not any(line.startswith("Part of this") for line in _lines_of(_section_4_1(tmp_path / "after.docx"), other))
    # The drafts inside the stretch are gone; the others are there.
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    t2 = [s for s in anno["steps"] if s.get("state") != "hidden" and s.get("time_range")
          and "2026-05-14T09:01:45Z" <= s["time_range"]["start"] <= "2026-05-14T09:02:07Z"]
    assert t2 == [], "no draft is left inside the stretch"
    # The control: without the stretch, the same steps read as skipped.
    import pdd_export
    s = pdd_export._Session(folder, anno, json.loads((folder / "stats.json").read_text(encoding="utf-8")),
                            json.loads((folder / "manifest.json").read_text(encoding="utf-8")), [])
    unaware = pdd_export._differences(s.run_steps(s.pattern_index), s.run_steps(1))
    assert any("Account lookup: Search" in line for line in unaware if line.startswith("Skipped: ")), unaware


def test_the_findings_read_the_stream_without_the_stretch_left_out(tmp_path):
    """The Notepad lookup in Transaction 2 (09:02:10 to 09:02:14) is where the
    product code is typed a third time; left out, the re-keyed finding no
    longer counts Notepad among the applications it was typed into."""
    import normalize as normalize_mod
    folder = _demo(tmp_path / "s")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)

    def rekey_apps():
        a = json.loads((folder / "analysis.json").read_text(encoding="utf-8"))
        f = next(x for x in a["findings"] if x["detector"] == "rekey_transfer")
        return {app.lower() for v in f["evidence"]["values"] for app in v["apps"]}

    assert "notepad.exe" in rekey_apps(), "control: the lookup counts before"
    _leave_out(folder, "2026-05-14T09:02:09Z", "2026-05-14T09:02:15Z")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    assert "notepad.exe" not in rekey_apps()
