"""A stretch left out of the analysis (annotations.excluded_ranges), end to end
on the demo recording (lane CC).

The viewer's Timeline draws each stretch and offers Include again; here, the
pipeline's half: the transaction with a stretch left out says so once in the
PDD's 4.1, and the reference steps done in the stretch are not printed as
Skipped (the rule shared with the viewer, shared/run-differences-golden.json);
the time tables lose the stretch's own time (lane FX1), and the step map
cuts the transaction's trace at the stretch (lane FX1, step_flow).

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


def _stats(folder: Path) -> dict:
    return json.loads((folder / "stats.json").read_text(encoding="utf-8"))


def test_a_stretch_left_out_takes_its_own_time_out_of_the_transaction(tmp_path):
    """Report 2, item 4 (lane FX1): the time tables lose the stretch's time,
    not the whole rows that start in it. Transaction 2 (09:01:46 to
    09:02:39) has its first rows at 09:01:46 (5.8 s), 09:01:52 (9.1 s) and
    09:02:01 (8.9 s); a stretch from 09:01:45 to 09:02:07 covers 20.9 s of
    them (the third row keeps its last 2.9 s). The whole rows would be 23.8 s."""
    import normalize as normalize_mod
    folder = _demo(tmp_path / "s")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    run2 = lambda stats: next(r for r in stats["case_stats"] if r["label"] == "Order #10901")  # noqa: E731
    before = run2(_stats(folder))["active_ms"]
    _leave_out(folder, "2026-05-14T09:01:45Z", "2026-05-14T09:02:07Z")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    after = run2(_stats(folder))["active_ms"]
    assert before - after == 20900, (before, after)
    # The wall clock is the transaction's, whatever is left out of it.
    assert run2(_stats(folder))["wall_clock_ms"] == 53000


def _first_tasks(bpmn: Path) -> set[str]:
    """The tasks the step map's start event leads to, through gateways."""
    import xml.etree.ElementTree as ET
    ns = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
    process = ET.parse(bpmn).getroot().find(f"{ns}process")
    kinds = {el.get("id"): el.tag.split("}", 1)[-1] for el in process}
    names = {el.get("id"): el.get("name") for el in process}
    out: dict[str, list[str]] = {}
    for el in process:
        if el.tag == f"{ns}sequenceFlow":
            out.setdefault(el.get("sourceRef"), []).append(el.get("targetRef"))
    start = next(i for i, k in kinds.items() if k == "startEvent")
    todo, seen, tasks = list(out.get(start, [])), set(), set()
    while todo:
        node = todo.pop()
        if node in seen:
            continue
        seen.add(node)
        if kinds.get(node, "").endswith("Gateway"):
            todo.extend(out.get(node, []))
        elif kinds.get(node) in ("task", "userTask", "manualTask", "subProcess"):
            tasks.add(names[node])
    return tasks


def test_a_stretch_left_out_at_a_transactions_start_draws_no_path_from_the_start(tmp_path):
    """Report 2, item 3 (lane FX1): with the first steps of transaction 2 left
    out, its trace is cut at the stretch, so the step map draws no path from
    the start straight into the step after the stretch: every transaction
    that starts does so at the same first step, as before."""
    import normalize as normalize_mod
    folder = _demo(tmp_path / "s")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    first_before = _first_tasks(folder / "process_map_step.bpmn")
    assert len(first_before) == 1, first_before                    # control
    _leave_out(folder, "2026-05-14T09:01:45Z", "2026-05-14T09:02:07Z")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    anno = json.loads((folder / "annotations.json").read_text(encoding="utf-8"))
    stats = _stats(folder)
    run2 = next(r["case_id"] for r in stats["case_stats"] if r["label"] == "Order #10901")
    after_stretch = min((s for s in anno["steps"] if s.get("case_id") == run2
                         and s.get("state") != "hidden"),
                        key=lambda s: s["time_range"]["start"])["name"]
    assert after_stretch not in first_before, "control: the step after the stretch is not a first step"
    assert _first_tasks(folder / "process_map_step.bpmn") == first_before
    # The PDD's table of the map (3.1 without a picture) cuts it too.
    import pdd_export
    events, _ = normalize_mod.load_events(folder / "events.jsonl")
    s = pdd_export._Session(folder, anno, stats,
                            json.loads((folder / "manifest.json").read_text(encoding="utf-8")), events)
    start_row = dict(pdd_export._flow_rows(s))["Start"]
    assert after_stretch not in start_row, start_row
