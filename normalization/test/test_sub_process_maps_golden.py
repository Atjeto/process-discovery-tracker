"""The pipeline half of the shared sub-process maps golden (contract C19).

shared/sub-process-maps-golden.json pins one rule in two languages: which
maps a project holds and what each is drawn from, for the viewer
(viewer/sub-process-maps.js mapTree) and the pipeline
(sub_process_maps.map_tree, asserted here, which feeds the step BPMN's
planes and the PDD's chapters). A fixture step is named by its map node;
real data links by step_id, so each fixture step is given a step id here and
a link's "to" (a name) becomes the id of the step with that name in the same
sub_steps list (or the same transaction at the main level), as the step
pane's "Go to..." list offers them. Each map's edges are
step_flow.flow_edges on its traces, the contract C17 rule.

stdlib only (no pm4py), so this runs under a bare pytest too.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import step_flow  # noqa: E402
import sub_process_maps  # noqa: E402

GOLDEN_PATH = (Path(__file__).resolve().parent.parent.parent / "shared"
               / "sub-process-maps-golden.json")
GOLDEN = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
_NAMES = {step_flow.START: "start", step_flow.END: "end"}


def _steps(fixture, prefix):
    """One level of fixture steps as real steps: a step_id each (unique in
    the case), sub_steps turned the same way, and each link's target turned
    from a name into the id of the step with that name in this list."""
    steps = []
    for i, fx in enumerate(fixture):
        step = {k: v for k, v in fx.items() if k not in ("links", "sub_steps")}
        step["step_id"] = f"{prefix}s{i}"
        if "sub_steps" in fx:
            step["sub_steps"] = _steps(fx["sub_steps"], f"{prefix}s{i}.")
        steps.append(step)
    ids = {}
    for step in steps:
        ids.setdefault(step["name"], step["step_id"])
    for step, fx in zip(steps, fixture):
        if "links" in fx:
            step["links"] = [dict(link, to=(link["to"] if link["to"] == "end"
                                            else ids.get(link["to"], link["to"])))
                             for link in fx["links"]]
    return steps


def _transactions(case):
    return [_steps(fixture, f"t{t}") for t, fixture in enumerate(case["transactions"])]


def _projected(edges):
    return sorted(((_NAMES.get(e["from"], e["from"]), _NAMES.get(e["to"], e["to"]),
                   e["label"], e["observed"]) for e in edges), key=str)


def _expected_edges(edges):
    return sorted(((e["from"], e["to"], e["label"], e["observed"]) for e in edges), key=str)


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_golden_case(case):
    maps = sub_process_maps.map_tree(_transactions(case), case.get("reference", 0))
    got = [(m["path"], m["number"], [[step_flow.node_of(s) for s in t] for t in m["traces"]])
           for m in maps]
    want = [(m["path"], m["number"], m["traces"]) for m in case["expected_maps"]]
    assert got == want
    for m, expected in zip(maps, case["expected_maps"]):
        edges = step_flow.flow_edges(m["traces"])
        assert _projected(edges) == _expected_edges(expected["edges"]), m["path"]
        # One transaction index per trace, in transaction order.
        assert len(m["transactions"]) == len(m["traces"])
        assert m["transactions"] == sorted(m["transactions"])


def test_the_golden_covers_every_rule():
    """Positive control: the cases hold every situation the rule decides."""
    cases = GOLDEN["cases"]
    maps = [m for c in cases for m in c["expected_maps"]]
    assert any(len(m["path"]) >= 2 for m in maps)                    # nested
    assert any(m["path"] and m["number"] is None for m in maps)      # no chapter
    assert any(m["path"] and not m["traces"] for m in maps)          # empty sub-process
    assert any(len(m["traces"]) >= 2 for m in maps if m["path"])     # several visits
    assert any(c.get("reference", 0) != 0 for c in cases)
    assert any(any(e["label"] for e in m["edges"]) for m in maps if m["path"])

    def walk(steps):
        for s in steps:
            yield s
            yield from walk(s.get("sub_steps") or [])
    steps = [s for c in cases for t in c["transactions"] for s in walk(t)]
    assert any(s.get("state") == "hidden" and "sub_steps" in s for s in steps)
    assert any(s.get("sub_steps") == [] for s in steps)
    assert any("links" in s for s in steps) and any("only_when" in s for s in steps)


def test_the_traces_are_the_step_dicts_in_their_order():
    """map_tree hands back the steps themselves (the BPMN and the PDD read
    their ids, times and evidence), each trace sorted by time, then `order`,
    then the list's order."""
    sub = [{"step_id": "late", "name": "Late", "time_range": None, "order": 2},
           {"step_id": "t2", "name": "Second", "time_range": {"start": "2026-09-24T09:00:10Z"}},
           {"step_id": "early", "name": "Early", "time_range": None, "order": 1},
           {"step_id": "t1", "name": "First", "time_range": {"start": "2026-09-24T09:00:00Z"}}]
    parent = {"step_id": "p", "name": "Parent", "sub_steps": sub}
    maps = sub_process_maps.map_tree([[parent]])
    assert [m["path"] for m in maps] == [[], ["Parent"]]
    trace = maps[1]["traces"][0]
    assert [s["step_id"] for s in trace] == ["t1", "t2", "early", "late"]
    assert trace[0] is sub[3]


def test_a_drafted_sub_step_is_its_name_on_the_map():
    """C19: a drafted sub-step (action_key) is its own name, as a drafted
    step (draft_key) is, even where the shared value rules would cut its
    name or a stale process_label says otherwise; any other step keeps the
    rule's label."""
    name = "Enter Ship to - Street"
    drafted = {"name": name, "action_key": "crm|Orders|enter:Ship to - Street",
               "process_label": "Enter Ship to"}
    assert step_flow.node_of(drafted) == name
    assert step_flow.node_of({"name": name, "draft_key": "crm|Orders|(visit)",
                              "process_label": "stale"}) == name
    assert step_flow.node_of({"name": name, "process_label": "Enter Ship to"}) == "Enter Ship to"
    # A blank name falls back to the rule's label.
    assert step_flow.node_of({"name": "  ", "action_key": "k", "process_label": "X"}) == "X"


def test_the_node_rule_stamps_a_drafted_sub_step_with_its_name():
    """The pipeline stamps process_label on sub-steps by the main level's
    rule, with action_key counting like draft_key."""
    from step_suggest import _merge_steps, process_label
    name = "Enter Ship to - Street"
    assert process_label(name) == "Enter Ship to"          # the value rule would cut it
    parent = {"step_id": "p", "name": "Book the order", "state": "edited",
              "sub_steps": [{"step_id": "a1", "name": name, "state": "auto_suggested",
                             "action_key": "crm|Orders|enter:Ship to - Street",
                             "name_source": "action"},
                            {"step_id": "h1", "name": name, "state": "manually_authored",
                             "sub_steps": [{"step_id": "h2", "name": "Call - Anna"}]}]}
    merged = _merge_steps([parent], [])
    subs = merged[0]["sub_steps"]
    assert subs[0]["process_label"] == name
    assert subs[1]["process_label"] == "Enter Ship to"
    assert subs[1]["sub_steps"][0]["process_label"] == "Call"
    maps = sub_process_maps.map_tree([merged])
    assert maps[1]["path"] == ["Book the order"]
    assert [step_flow.node_of(s) for s in maps[1]["traces"][0]] == [name, "Enter Ship to"]
