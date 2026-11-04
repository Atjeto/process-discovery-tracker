"""The pipeline half of the shared step order golden (contract C22, 2.0.5).

shared/step-order-golden.json pins one order rule in two languages: the
viewer's (viewer/step-order.js processOrder and placeMoments) and the
pipeline's (step_context.process_order and place_starts, asserted here),
which the step BPMN, the PDD, the statistics and the Technical details read.

stdlib only (step_context needs no pm4py), so this runs under a bare pytest
too.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import step_context  # noqa: E402

GOLDEN_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "step-order-golden.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
BASE = datetime(2026, 5, 14, 9, 0, 0, tzinfo=timezone.utc)


def _iso(sec):
    return (BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(g):
    s = {"step_id": g["id"], "case_id": g.get("case"), "name": g["id"],
         "time_range": None if g.get("t") is None else {"start": _iso(g["t"]), "end": _iso(g["t"] + 1)},
         "state": g.get("state", "manually_authored")}
    if "order" in g:
        s["order"] = g["order"]
    if "after" in g:
        s["placed_after"] = g["after"]
    return s


def _moment(at):
    if at is None:
        return None
    if at == step_context.BEFORE_EVERY_STRETCH:
        return "first"
    return (at - BASE).total_seconds()


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    steps = [_step(g) for g in case["steps"]]
    assert [s["step_id"] for s in step_context.process_order(steps)] == case["expected"]
    at = step_context.place_starts(steps)
    got = {s["step_id"]: _moment(at.get(id(s))) for s in steps}
    want = {k: (float(v) if isinstance(v, (int, float)) else v) for k, v in case["moments"].items()}
    assert got == want


def test_the_order_reads_the_same_with_or_without_the_hidden_steps():
    case = next(c for c in GOLDEN["cases"] if "hidden step can be placed" in c["name"])
    steps = [_step(g) for g in case["steps"]]
    visible = [s for s in steps if s["state"] != "hidden"]
    full = [s["step_id"] for s in step_context.process_order(steps) if s["state"] != "hidden"]
    assert full == [s["step_id"] for s in step_context.process_order(visible)]


def test_declares_place():
    assert step_context.declares_place({"placed_after": "start"})
    assert step_context.declares_place({"placed_after": "abc"})
    assert not step_context.declares_place({"placed_after": ""})
    assert not step_context.declares_place({})
    assert not step_context.declares_place(None)


def test_a_draft_placed_elsewhere_is_the_analysts_and_survives_the_analysis():
    from step_suggest import _merge_steps
    draft = {"step_id": "d1", "case_id": "c1", "name": "Save", "state": "auto_suggested",
             "placed_after": "d0", "time_range": {"start": _iso(50), "end": _iso(51)},
             "evidence": {"interaction_event_ids": []}}
    kept = _merge_steps([draft], [])
    assert [(s["step_id"], s["state"], s["placed_after"]) for s in kept] == [("d1", "edited", "d0")]


def test_a_placed_step_follows_the_transaction_of_the_step_it_comes_after():
    from step_suggest import _follow_placement_case
    steps = [{"step_id": "a", "case_id": "T1", "state": "edited"},
             {"step_id": "h", "case_id": "T1", "state": "hidden"},
             {"step_id": "p", "case_id": "T2", "state": "edited", "placed_after": "a"},
             {"step_id": "q", "case_id": "T2", "state": "edited", "placed_after": "p"},
             {"step_id": "r", "case_id": "T2", "state": "edited", "placed_after": "h"},
             {"step_id": "s", "case_id": "T2", "state": "edited", "placed_after": "start"}]
    assert _follow_placement_case(steps) == 2
    assert [s["case_id"] for s in steps] == ["T1", "T1", "T1", "T1", "T2", "T2"]
