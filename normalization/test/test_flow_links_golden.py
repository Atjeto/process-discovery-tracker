"""The pipeline half of the shared step flow golden (contract C17).

shared/flow-links-golden.json pins one edge rule in two languages: the
viewer's live map (viewer/process-map-levels.js) and the pipeline's step
BPMN (step_flow.flow_edges, asserted here). A fixture step is named by its
map node; real data links by step_id, so each case is given step ids here
and a link's "to" (a name) becomes the id of the step with that name in the
same transaction, as the step pane's "Go to..." list offers them.

stdlib only (step_flow needs no pm4py), so this runs under a bare pytest too.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import step_flow  # noqa: E402

GOLDEN_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "flow-links-golden.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
_NAMES = {step_flow.START: "start", step_flow.END: "end"}


def _transactions(case):
    """The case's transactions as real steps: a step_id each, and every
    link's target turned from a name into a step id."""
    out = []
    for t, fixture in enumerate(case["transactions"]):
        steps = []
        for i, fx in enumerate(fixture):
            step = {k: v for k, v in fx.items() if k != "links"}
            step["step_id"] = f"t{t}s{i}"
            steps.append(step)
        ids = {}
        for step in steps:
            ids.setdefault(step["name"], step["step_id"])
        for step, fx in zip(steps, fixture):
            if "links" in fx:
                step["links"] = [dict(link, to=(link["to"] if link["to"] == "end"
                                                else ids.get(link["to"], link["to"])))
                                 for link in fx["links"]]
        out.append(steps)
    return out


def _projected(edges):
    return sorted(((_NAMES.get(e["from"], e["from"]), _NAMES.get(e["to"], e["to"]),
                    e["label"], e["observed"]) for e in edges), key=str)


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    edges = step_flow.flow_edges(_transactions(case))
    expected = sorted(((e["from"], e["to"], e["label"], e["observed"])
                       for e in case["expected_edges"]), key=str)
    assert _projected(edges) == expected
    # Rule 4: one edge per (from node, to node).
    pairs = [(e["from"], e["to"]) for e in edges]
    assert len(pairs) == len(set(pairs))


def test_the_golden_covers_every_declaration():
    steps = [s for c in GOLDEN["cases"] for t in c["transactions"] for s in t]
    edges = [e for c in GOLDEN["cases"] for e in c["expected_edges"]]
    assert any("only_when" in s for s in steps)
    targets = {link["to"] for s in steps for link in s.get("links", [])}
    assert "end" in targets and len(targets) >= 3
    assert any(e["label"] == "otherwise" and e["observed"] for e in edges)
    assert any(e["label"] == "otherwise" and not e["observed"] for e in edges)
    assert any(" or " in (e["label"] or "") for e in edges)
    assert any(any(s.get("state") == "hidden" for s in t)
               for c in GOLDEN["cases"] for t in c["transactions"])
    assert any(len(c["transactions"]) >= 2 for c in GOLDEN["cases"])


def test_each_edge_counts_the_transactions_that_took_it():
    t1 = [{"step_id": "a", "name": "A"}, {"step_id": "b", "name": "B"}]
    t2 = [{"step_id": "c", "name": "A"}, {"step_id": "d", "name": "C"},
          {"step_id": "e", "name": "B", "links": [{"to": "c", "when": "retry"}]}]
    edges = {(e["from"], e["to"]): e for e in step_flow.flow_edges([t1, t2])}
    assert edges[(step_flow.START, "A")]["transactions"] == 2
    assert edges[("A", "B")]["transactions"] == 1
    assert edges[("B", "A")]["transactions"] == 0          # declared only
    assert edges[("B", "A")]["label"] == "retry"


def test_the_order_of_a_transaction_is_time_then_order_then_neither():
    steps = [{"step_id": "late", "name": "Late", "time_range": None, "order": 2},
             {"step_id": "t2", "name": "Second", "time_range": {"start": "2026-09-24T09:00:10Z"}},
             {"step_id": "early", "name": "Early", "time_range": None, "order": 1},
             {"step_id": "t1", "name": "First", "time_range": {"start": "2026-09-24T09:00:00Z"}}]
    observed = [(e["from"], e["to"]) for e in step_flow.flow_edges([steps])]
    assert observed == [(step_flow.START, "First"), ("First", "Second"), ("Second", "Early"),
                        ("Early", "Late"), ("Late", step_flow.END)]


def test_a_link_to_its_own_step_or_to_no_step_draws_nothing():
    steps = [{"step_id": "a", "name": "A"},
             {"step_id": "b", "name": "B", "links": [{"to": "b", "when": "again"},
                                                     {"to": "gone", "when": "removed"},
                                                     {"to": "", "when": "empty"},
                                                     {"when": "no target"}, "not a link"]}]
    edges = step_flow.flow_edges([steps])
    assert all(e["observed"] and e["label"] is None for e in edges)
    assert len(edges) == 3


def test_blank_conditions_are_no_conditions_and_labels_are_one_line():
    steps = [{"step_id": "a", "name": "A", "only_when": "   "},
             {"step_id": "b", "name": "B", "only_when": "the order\n  is new "},
             {"step_id": "c", "name": "C"}]
    edges = {(e["from"], e["to"]): e["label"] for e in step_flow.flow_edges([steps])}
    assert edges[(step_flow.START, "A")] is None
    assert edges[("A", "B")] == "the order is new"
    assert edges[("A", "C")] == "otherwise"


def test_a_node_takes_the_process_label_before_the_name():
    steps = [{"step_id": "a", "name": "Search CUST-1", "process_label": "Search"},
             {"step_id": "b", "name": "Save"}]
    assert [e["to"] for e in step_flow.flow_edges([steps])][:2] == ["Search", "Save"]


def test_declares_flow_is_true_only_for_a_set_condition_or_a_link():
    assert step_flow.declares_flow({"only_when": "x"})
    assert step_flow.declares_flow({"links": [{"to": "end", "when": ""}]})
    assert not step_flow.declares_flow({"only_when": "  ", "links": []})
    assert not step_flow.declares_flow({})


def test_changes_map_says_whether_the_edges_differ_from_the_observed_map():
    plain = [[{"step_id": "a", "name": "A"}, {"step_id": "b", "name": "B"}]]
    assert not step_flow.changes_map(step_flow.flow_edges(plain))
    dangling = [[{"step_id": "a", "name": "A"},
                 {"step_id": "b", "name": "B", "links": [{"to": "gone", "when": "x"}]}]]
    assert not step_flow.changes_map(step_flow.flow_edges(dangling))
    looped = [[{"step_id": "a", "name": "A"},
               {"step_id": "b", "name": "B", "links": [{"to": "a", "when": "x"}]}]]
    assert step_flow.changes_map(step_flow.flow_edges(looped))
