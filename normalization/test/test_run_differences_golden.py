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
from _dt import parse_ts_or_none as _parse_ts

GOLDEN_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "run-differences-golden.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_the_golden_covers_every_kind_of_difference_and_key():
    assert GOLDEN["version"] == 1
    # Six cases, two since the stretches left out of the analysis joined the
    # rule (lane CC), five since the Steps level and the PDD share it whole
    # (lane FX1).
    assert 8 <= len(GOLDEN["cases"]) <= 16
    lines = [line for c in GOLDEN["cases"] for line in c["expected"]]
    keys = [k for c in GOLDEN["cases"] for k in c["run_keys"]]
    for prefix in ("Extra step: ", "Skipped: ", "Different order: ", "Not done: ", "Repeated: ",
                   "Part of this run was left out of the analysis ("):
        assert any(line.startswith(prefix) for line in lines), prefix
    for prefix in ("draft:", "merge:", "label:"):
        assert any(k.startswith(prefix) for k in keys), prefix
    assert any(not c["expected"] for c in GOLDEN["cases"])


def _case_left_out(case):
    """A case's stretches left out (cut to its run's span) and when the
    recording started; none for a case without excluded ranges."""
    if "excluded_ranges" not in case:
        return None, None
    span = case["run_span"]
    stretches = pdd_export._left_out_stretches(
        case["excluded_ranges"], _parse_ts(span["start"]), _parse_ts(span.get("end")))
    return stretches, _parse_ts(case["origin"])


def _in_order(steps):
    """The steps in the PDD's order of a transaction (pdd_export._start_key):
    a start time first, then `order`, then neither; steps that start at one
    moment keep their list order."""
    return sorted(steps, key=pdd_export._start_key)


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    pattern, run = _in_order(case["pattern"]), _in_order(case["run"])
    units = pdd_export._collapse_merged(pattern, run)
    assert [pdd_export._align_key(u) for u in units] == case["run_keys"]
    stretches, origin = _case_left_out(case)
    assert pdd_export._differences(pattern, run, stretches, origin) == case["expected"]
    if "count" in case:
        assert pdd_export.difference_count(pattern, run, stretches) == case["count"]


@pytest.mark.parametrize("case", GOLDEN["reference_cases"],
                         ids=[c["name"] for c in GOLDEN["reference_cases"]])
def test_golden_reference_case(case, tmp_path):
    """The default reference transaction (lane FX1): the PDD's choice, as
    the viewer's runs-model.js patternRun makes it."""
    rows = [{"case_id": r["case_id"], "label": None, "parent_case_id": None,
             "start_ts": r["start"], "end_ts": None} for r in case["runs"]]
    steps = [{"step_id": f"{r['case_id']}-{i}", "case_id": r["case_id"], "name": f"Step {i}",
              "state": st["state"], "time_range": None, "order": i + 1}
             for r in case["runs"] for i, st in enumerate(r["steps"])]
    anno = {"steps": steps}
    if case["pattern_run"]:
        anno["pattern_run"] = {"case_id": case["pattern_run"]}
    s = pdd_export._Session(tmp_path, anno, {"case_stats": rows}, {}, [])
    got = s.runs[s.pattern_index]["case_id"] if s.pattern_index is not None else None
    assert got == case["expected"]


def test_the_left_out_line_in_the_documents_words_and_its_times():
    """The PDD words the line for its reader ("this transaction"); without a
    known start of the recording, or with a time before it, it has no times."""
    at = lambda hms: _parse_ts(f"2026-05-14T{hms}Z")
    stretches = [(at("09:01:10"), at("09:01:45"))]
    assert (pdd_export._left_out_text(stretches, at("09:00:00"), "transaction")
            == "Part of this transaction was left out of the analysis (1:10 to 1:45).")
    assert (pdd_export._left_out_text(stretches, None, "transaction")
            == "Part of this transaction was left out of the analysis.")
    assert (pdd_export._left_out_text(stretches, at("09:05:00"))
            == "Part of this run was left out of the analysis.")
    assert pdd_export._left_out_text([], at("09:00:00")) == ""
    three = [(at("09:00:10"), at("09:00:20")), (at("09:30:00"), at("09:31:00")), (at("10:00:00"), at("10:00:05"))]
    assert (pdd_export._left_out_text(three, at("09:00:00"), "transaction")
            == "Part of this transaction was left out of the analysis "
               "(0:10 to 0:20, 30:00 to 31:00 and 1:00:00 to 1:00:05).")


def test_left_out_stretches_cut_sort_and_join():
    at = lambda hms: _parse_ts(f"2026-05-14T{hms}Z")
    rng = lambda a, b: {"start": f"2026-05-14T{a}Z", "end": f"2026-05-14T{b}Z"}
    got = pdd_export._left_out_stretches(
        [rng("09:02:00", "09:02:30"), rng("09:00:30", "09:01:10"), rng("09:02:20", "09:04:00")],
        at("09:01:00"), at("09:03:00"))
    assert got == [(at("09:01:00"), at("09:01:10")), (at("09:02:00"), at("09:03:00"))]
    assert pdd_export._left_out_stretches([rng("08:00:00", "08:10:00"), rng("09:03:00", "09:04:00")],
                                          at("09:01:00"), at("09:03:00")) == []
    assert pdd_export._left_out_stretches([{"start": "x", "end": "y"}, {"start": "2026-05-14T09:02:00Z"},
                                           rng("09:02:30", "09:02:00"), "not a range"],
                                          at("09:01:00"), at("09:03:00")) == []
    assert pdd_export._left_out_stretches([rng("09:02:00", "09:02:30")], None, None) == []
    assert (pdd_export._left_out_stretches([rng("09:02:00", "09:09:30")], at("09:01:00"), None)
            == [(at("09:02:00"), at("09:09:30"))])
    # A hand-edited range without a zone is read as UTC, as the viewer reads it.
    assert (pdd_export._left_out_stretches([{"start": "2026-05-14T09:02:00", "end": "2026-05-14T09:02:30"}],
                                           at("09:01:00"), at("09:03:00"))
            == [(at("09:02:00"), at("09:02:30"))])


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
