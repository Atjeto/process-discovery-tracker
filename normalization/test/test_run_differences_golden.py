"""The PDD half of the shared differences golden.

shared/run-differences-golden.json pins one algorithm in two languages: the
viewer's differences review (viewer/run-differences.js, asserted by
viewer/run-differences.test.js) and the PDD's section 6.1
(pdd_export._align_key, _collapse_merged, _differences, asserted here). Every
case gives the alignment keys of the run after folding and the difference
lines; both sides must produce them exactly.

Needs no python-docx: these functions build no document. Run with pytest:
    pytest normalization/test/test_run_differences_golden.py
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export

GOLDEN_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "run-differences-golden.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_the_golden_covers_every_kind_of_difference_and_key():
    assert GOLDEN["version"] == 1
    assert 4 <= len(GOLDEN["cases"]) <= 6
    lines = [line for c in GOLDEN["cases"] for line in c["expected"]]
    keys = [k for c in GOLDEN["cases"] for k in c["run_keys"]]
    for prefix in ("Extra step: ", "Skipped: ", "Different order: "):
        assert any(line.startswith(prefix) for line in lines), prefix
    for prefix in ("draft:", "merge:", "label:"):
        assert any(k.startswith(prefix) for k in keys), prefix
    assert any(not c["expected"] for c in GOLDEN["cases"])


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    units = pdd_export._collapse_merged(case["pattern"], case["run"])
    assert [pdd_export._align_key(u) for u in units] == case["run_keys"]
    assert pdd_export._differences(case["pattern"], case["run"]) == case["expected"]


def test_a_runs_own_merge_plus_the_next_draft_spells_a_merged_step_of_three():
    """Flattening, the same case as the viewer's unit test: a merged run step
    counts its draft_keys in place."""
    pattern = [{"name": "Find", "draft_key": "f"},
               {"name": "Check, create, print", "draft_keys": ["c", "k", "p"]}]
    run = [{"name": "Find", "draft_key": "f"},
           {"name": "Check + Create", "draft_keys": ["c", "k"]},
           {"name": "Print", "draft_key": "p"}]
    units = pdd_export._collapse_merged(pattern, run)
    assert [pdd_export._align_key(u) for u in units] == ["draft:f", 'merge:["c","k","p"]']
    assert units[1]["name"] == "Check, create, print"
    assert pdd_export._differences(pattern, run) == []


def test_one_step_is_never_folded_and_a_step_without_identity_breaks_a_stretch():
    pattern = [{"name": "Merged", "draft_keys": ["a", "b"]}]
    own = {"name": "Own merge", "draft_keys": ["a", "b"]}
    assert pdd_export._collapse_merged(pattern, [own])[0] is own
    broken = [{"name": "A", "draft_key": "a"}, {"name": "Added"}, {"name": "B", "draft_key": "b"}]
    assert pdd_export._collapse_merged(pattern, broken) == broken


def test_the_key_rule_precedence():
    assert pdd_export._align_key({"draft_key": "a|s|c", "draft_keys": ["x", "y"]}) == "draft:a|s|c"
    assert pdd_export._align_key({"draft_keys": ["x|1", "y|2"]}) == 'merge:["x|1","y|2"]'
    assert pdd_export._align_key({"draft_keys": ["x", ""], "name": "Look up"}) == "label:Look up"
    assert pdd_export._align_key({"name": "Order form: Enter 7 in Quantity"}) == "label:Order form: Enter Quantity"
