"""Tests for observed-flow step BPMN (bpmn_observed).

Run with: pytest normalization/test/test_bpmn_observed.py
"""

from __future__ import annotations

import math
import os
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

# pm4py lives only in the viewer's bundled Python, not the bare dev Python.
# Skip cleanly there (mirrors how mining stays untested on bare Python);
# this runs under the bundled interpreter and CI where pm4py is present.
pytest.importorskip("pm4py")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bpmn_observed import (
    build_annotation_log, write_observed_bpmn, real_case_count, session_sequence,
)


def _step(case_id, name, start, *, state="edited"):
    return {
        "step_id": f"{name}-{case_id}-{start}",
        "case_id": case_id,
        "name": name,
        "state": state,
        "time_range": {"start": start, "end": start},
    }


def _two_case_anno():
    # Two cases that diverge in the middle and re-converge -> a branch.
    return {"steps": [
        _step("A", "Search",      "2026-05-18T09:00:00Z"),
        _step("A", "Open ticket", "2026-05-18T09:00:10Z"),
        _step("A", "Resolve",     "2026-05-18T09:00:20Z"),
        _step("B", "Search",      "2026-05-18T09:10:00Z"),
        _step("B", "Escalate",    "2026-05-18T09:10:10Z"),
        _step("B", "Resolve",     "2026-05-18T09:10:20Z"),
    ]}


def test_build_log_one_trace_per_case_collapses_consecutive_dups():
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step("A", "Search",  "2026-05-18T09:00:05Z"),   # consecutive dup -> collapsed
        _step("A", "Resolve", "2026-05-18T09:00:10Z"),
        _step("B", "Search",  "2026-05-18T09:10:00Z"),
        _step("B", "Resolve", "2026-05-18T09:10:05Z"),
    ]}
    log = build_annotation_log(anno)
    assert len(log) == 2
    a = next(t for t in log if t.attributes["case:id"] == "A")
    assert [e["concept:name"] for e in a] == ["Search", "Resolve"]


def test_build_log_excludes_hidden_steps():
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step("A", "Noise",   "2026-05-18T09:00:05Z", state="hidden"),
        _step("A", "Resolve", "2026-05-18T09:00:10Z"),
    ]}
    labels = [e["concept:name"] for t in build_annotation_log(anno) for e in t]
    assert labels == ["Search", "Resolve"]


def test_build_log_orders_by_start_time():
    # Out-of-order input is sorted by time_range.start.
    anno = {"steps": [
        _step("A", "Third",  "2026-05-18T09:00:20Z"),
        _step("A", "First",  "2026-05-18T09:00:00Z"),
        _step("A", "Second", "2026-05-18T09:00:10Z"),
    ]}
    a = next(iter(build_annotation_log(anno)))
    assert [e["concept:name"] for e in a] == ["First", "Second", "Third"]


def test_write_observed_step_bpmn_has_tasks_layout_and_branch():
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(_two_case_anno(), out) is True
        xml = Path(out).read_text(encoding="utf-8")
    # Every observed step is represented as a task.
    for name in ("Search", "Open ticket", "Escalate", "Resolve"):
        assert name in xml
    # Renderable in bpmn-js: a BPMNDI layout is present.
    assert "BPMNDiagram" in xml
    # Divergent cases are modelled as a branch (gateway), not a straight line.
    assert "Gateway" in xml


def test_write_returns_false_when_no_steps():
    assert write_observed_bpmn({"steps": []}, "unused.bpmn") is False


def test_layout_ranks_topologically_ignoring_loop_back_edges():
    """A loop/redo back-edge from the inductive miner must NOT smear the columns.

    Regression: ranking by longest-path over the RAW edge set let a single
    back-edge (e.g. ``SAP: Create sales order -> <upstream gateway>``) inflate the
    rank of everything past the loop, so the Process diagram rendered with steps
    out of execution order (``Outlook: Send`` left of ``Outlook: Enter To``) and
    ``end`` stranded mid-flow. _layout now ranks over the acyclic forward set, so
    the linear spine stays ordered left->right and the sink is rightmost.
    """
    import mining
    nodes = ["start", "a", "b", "c", "end"]
    # A clean spine start->a->b->c->end PLUS a redo back-edge c->a (a loop).
    edges = [("start", "a"), ("a", "b"), ("b", "c"), ("c", "end"), ("c", "a")]
    sizes = {n: (100, 60) for n in nodes}
    xs = {n: x for n, (x, *_rest) in mining._layout(nodes, edges, sizes).items()}
    assert xs["start"] < xs["a"] < xs["b"] < xs["c"] < xs["end"], xs
    # The back-edge alone must not be treated as a root either.
    assert min(xs.values()) == xs["start"]
    assert max(xs.values()) == xs["end"]


def test_single_case_repeated_label_renders_without_gateways():
    # The live-session regression: one case is one observed path. A step label
    # that recurs (Open ... Open) must NOT be mined into optional/loop gateways
    # -- a single trace can't justify them. It renders as a straight chain.
    anno = {"steps": [
        _step("A", "Open",    "2026-05-18T09:00:00Z"),
        _step("A", "Enter",   "2026-05-18T09:00:10Z"),
        _step("A", "Open",    "2026-05-18T09:00:20Z"),   # label recurs
        _step("A", "Approve", "2026-05-18T09:00:30Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        assert write_observed_bpmn(anno, out) is True
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml          # no invented branches from one path
    assert "BPMNDiagram" in xml          # still laid out for bpmn-js
    for name in ("Open", "Enter", "Approve"):
        assert name in xml


def test_single_case_linear_renders_without_gateways():
    anno = {"steps": [
        _step("A", "One",   "2026-05-18T09:00:00Z"),
        _step("A", "Two",   "2026-05-18T09:00:10Z"),
        _step("A", "Three", "2026-05-18T09:00:20Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        write_observed_bpmn(anno, out)
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml


def test_real_case_count_ignores_the_nocase_orphan_bucket():
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step(None, "Orphan", "2026-05-18T09:00:10Z"),   # no case_id: outside every run
        _step("", "Blank",    "2026-05-18T09:00:20Z"),   # empty case_id: outside too
    ]}
    assert real_case_count(anno) == 1                    # only "A" is a real case
    # session_sequence is the one run's chain; the steps outside every run are
    # left out, as in the viewer's map, which shows the runs only.
    assert session_sequence(anno) == ["Search"]


def test_single_real_case_with_orphans_renders_linear_not_a_flower():
    """The live-session regression: a '1 case' session whose orphan steps (no
    case_id -- out-of-window work / self-capture noise) pooled into a synthetic
    __nocase__ trace, making len(log)==2 so the inductive miner ran and smeared a
    gateway 'flower model' across the map. With one REAL case it must render as a
    single linear chain of that run; the orphans are left out, as in the
    viewer's map, which shows the runs only."""
    anno = {"steps": [
        _step("A", "Search",  "2026-05-18T09:00:00Z"),
        _step("A", "Open",    "2026-05-18T09:00:10Z"),
        _step("A", "Resolve", "2026-05-18T09:00:20Z"),
        _step(None, "Stray 1", "2026-05-18T09:00:30Z"),  # orphans (the old flower trigger)
        _step(None, "Stray 2", "2026-05-18T09:00:40Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        assert write_observed_bpmn(anno, out) is True
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml                          # no flower model
    for name in ("Search", "Open", "Resolve"):
        assert name in xml
    for name in ("Stray 1", "Stray 2"):
        assert name not in xml                           # outside every run: left out


def test_steps_outside_every_run_are_left_out_of_the_mined_map():
    """The step BPMN is the source the viewer forks, and the viewer's map shows
    the runs only. With two runs the model is mined; steps outside every run
    (no case_id) must neither form a trace of their own nor reach the model."""
    anno = _two_case_anno()
    anno["steps"] += [
        _step(None, "Stray", "2026-05-18T09:20:00Z"),
        _step("", "Blank",   "2026-05-18T09:20:10Z"),
    ]
    assert sorted(t.attributes["case:id"] for t in build_annotation_log(anno)) == ["A", "B"]
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out) is True
        xml = Path(out).read_text(encoding="utf-8")
    for name in ("Search", "Open ticket", "Escalate", "Resolve"):
        assert name in xml
    assert "Stray" not in xml and "Blank" not in xml


def test_no_step_bpmn_when_no_step_is_in_a_run():
    """Without a run the viewer's map has nothing to show, so no step BPMN is
    written; the steps outside the runs are not chained into one."""
    anno = {"steps": [
        _step(None, "Search", "2026-05-18T09:00:00Z"),
        _step("", "Resolve",  "2026-05-18T09:00:10Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out) is False
        assert not os.path.exists(out)


_BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


def _process_elements(path):
    """(tag, name) of every element of the file's process, flows excluded."""
    process = ET.parse(path).getroot().find(f"{_BPMN}process")
    return [(el.tag.split("}", 1)[-1], el.get("name")) for el in process
            if el.tag != f"{_BPMN}sequenceFlow"]


def test_a_mined_step_bpmn_ends_in_an_end_event_not_a_task():
    """With two runs the model is mined, and pm4py ends it with a
    NormalEndEvent, a subclass of EndEvent that the tag map did not list: the
    end was written as a task box named "end", which the analyst saw in the
    forked map editor. It must be a real end event."""
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(_two_case_anno(), out) is True
        elements = _process_elements(out)
    assert any(tag.endswith("Gateway") for tag, _name in elements)   # it was mined
    assert [tag for tag, _name in elements].count("endEvent") == 1
    assert [tag for tag, _name in elements].count("startEvent") == 1
    assert ("task", "end") not in elements and ("task", "start") not in elements


def test_every_pm4py_start_and_end_event_variant_gets_its_event_element():
    """pm4py also has NormalStartEvent and other subclasses of StartEvent and
    EndEvent; each is written as its base class's element, never as a task."""
    import mining
    from pm4py.objects.bpmn.obj import BPMN
    bpmn = BPMN()
    start = BPMN.NormalStartEvent(name="start")
    task = BPMN.Task(name="Search")
    end = BPMN.MessageEndEvent(name="end")
    for node in (start, task, end):
        bpmn.add_node(node)
    bpmn.add_flow(BPMN.Flow(start, task))
    bpmn.add_flow(BPMN.Flow(task, end))
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "variants.bpmn")
        mining.export_bpmn(bpmn, out)
        elements = _process_elements(out)
    assert sorted(elements) == [("endEvent", "end"), ("startEvent", "start"),
                                ("task", "Search")]


# ---- lane LUX-P: what a process manager moving the map into a BPMN tool gets ----

_DI = "{http://www.omg.org/spec/DD/20100524/DI}"      # di:waypoint (mining._DI_NS)
_DC = "{http://www.omg.org/spec/DD/20100524/DC}"
_BPMNDI = "{http://www.omg.org/spec/BPMN/20100524/DI}"


def _written(anno, **kwargs):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out, **kwargs) is True
        return ET.parse(out).getroot()


def _by_name(root, tag):
    process = root.find(f"{_BPMN}process")
    return {el.get("name"): el for el in process if el.tag == f"{_BPMN}{tag}"}


# Contract C25: a task's kind follows what the automation does with its step
# (a plain task, the gear of a service task, the hand of a manual task; a user
# task is the kind every recorded step had before C18 as lane CL amended it;
# the helpers read tasks of any kind).
_TASK_TAGS = ("task", "userTask", "manualTask", "serviceTask")


def _tasks(root):
    """{name: element} of the process's tasks, whatever their kind."""
    process = root.find(f"{_BPMN}process")
    return {el.get("name"): el for el in process if _tag(el) in _TASK_TAGS}


def _steps_with_evidence():
    """Two runs of Search, Open ticket or Escalate, Resolve, with the
    interactions a StepContext reads."""
    anno = _two_case_anno()
    for s in anno["steps"]:
        s["evidence"] = {"interaction_event_ids": [s["step_id"]]}
    anno["steps"][0]["description"] = "Search by the ticket number."
    anno["pattern_run"] = {"case_id": "A"}
    return anno


def _context(anno):
    from step_context import StepContext
    inter = {s["step_id"]: {"process_name": "chrome.exe", "kind": "invoked",
                            "window_title": "Incident | ServiceNow - Google Chrome",
                            "name": "Go", "control_type": "Button"}
             for s in anno["steps"]}
    return StepContext(inter, {}, vocabs=[])


def test_each_task_documents_its_description_system_screen_runs_and_time():
    anno = _steps_with_evidence()
    root = _written(anno, context=_context(anno))
    tasks = _tasks(root)
    doc = lambda name: tasks[name].find(f"{_BPMN}documentation").text  # noqa: E731
    assert doc("Search") == ("Search by the ticket number.\n"
                             "ServiceNow, Incident. In 2 of 2 transactions, under 1s on average.")
    assert doc("Escalate") == (
        "ServiceNow, Incident. In 1 of 2 transactions, under 1s on average.")
    # BPMN 2.0 order: the documentation comes before the task's flow references.
    first = list(tasks["Search"])[0]
    assert first.tag == f"{_BPMN}documentation"


def test_a_drafted_narration_is_not_documented_as_a_description():
    anno = _steps_with_evidence()
    anno["steps"][0]["description"] = "Clicked Go."       # what the drafting writes
    root = _written(anno, context=_context(anno))
    text = _tasks(root)["Search"].find(f"{_BPMN}documentation").text
    assert text == "ServiceNow, Incident. In 2 of 2 transactions, under 1s on average."


def test_the_start_takes_the_trigger_and_the_end_the_result_else_end():
    """C15, then C18: the start event is unnamed while the Trigger is empty;
    the end event is named by the outcome, the Result's first line, else
    "End"."""
    anno = _two_case_anno()
    root = _written(anno)
    assert _by_name(root, "startEvent").keys() == {None}
    assert _by_name(root, "endEvent").keys() == {"End"}
    anno["document"] = {"trigger": "A ticket arrives in the queue.\nFrom any channel.",
                        "result": "The ticket is resolved and closed."}
    root = _written(anno)
    assert _by_name(root, "startEvent").keys() == {"A ticket arrives in the queue."}
    assert _by_name(root, "endEvent").keys() == {"The ticket is resolved and closed."}


def test_each_branch_says_in_how_many_runs_it_was_taken():
    anno = _two_case_anno()
    anno["steps"] += [
        _step("C", "Search", "2026-05-18T09:20:00Z"),
        _step("C", "Open ticket", "2026-05-18T09:20:10Z"),
        _step("C", "Resolve", "2026-05-18T09:20:20Z"),
    ]
    root = _written(anno)
    process = root.find(f"{_BPMN}process")
    ids = {el.get("id"): el for el in process}
    names = {}
    for flow in process.findall(f"{_BPMN}sequenceFlow"):
        if flow.get("name"):
            names[ids[flow.get("targetRef")].get("name")] = flow.get("name")
    assert names == {"Open ticket": "2 of 3 transactions", "Escalate": "1 of 3 transactions"}
    # Every named flow carries its label's place on the diagram: a box two
    # lines tall (bpmn-js wraps "2 of 3 transactions" at 90 px of 11 px text
    # and draws it from the box's top) that does not reach the line it names.
    edges = {e.get("bpmnElement"): e for e in root.iter(f"{_BPMNDI}BPMNEdge")}
    for flow in process.findall(f"{_BPMN}sequenceFlow"):
        if flow.get("name"):
            bounds = edges[flow.get("id")].find(f"{_BPMNDI}BPMNLabel/{_DC}Bounds")
            assert bounds is not None
            box = tuple(float(bounds.get(k)) for k in ("x", "y", "width", "height"))
            assert box[3] >= 2 * 11 * 1.2, box
            pts = [(float(w.get("x")), float(w.get("y")))
                   for w in edges[flow.get("id")].findall(f"{_DI}waypoint")]
            assert len(pts) >= 2, pts
            for seg in zip(pts, pts[1:]):
                assert not _crosses(seg, box), (flow.get("name"), seg, box)


def _connections(root):
    """{id: (source id, target id)} of every connection of the process: the
    sequence flows, the associations (a note to its task) and the data input
    associations (inside a task: from a data object to that task)."""
    process = root.find(f"{_BPMN}process")
    out = {}
    for el in process:
        if _tag(el) in ("sequenceFlow", "association"):
            out[el.get("id")] = (el.get("sourceRef"), el.get("targetRef"))
        for dia in el.findall(f"{_BPMN}dataInputAssociation"):
            out[dia.get("id")] = (dia.find(f"{_BPMN}sourceRef").text, el.get("id"))
    return out


def _boxes_and_segments(root):
    shapes = {}
    for sh in root.iter(f"{_BPMNDI}BPMNShape"):
        b = sh.find(f"{_DC}Bounds")
        shapes[sh.get("bpmnElement")] = tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))
    connections = _connections(root)
    segments = []
    for edge in root.iter(f"{_BPMNDI}BPMNEdge"):
        pts = [(float(w.get("x")), float(w.get("y"))) for w in edge.findall(f"{_DI}waypoint")]
        source, target = connections[edge.get("bpmnElement")]
        for a, b in zip(pts, pts[1:]):
            segments.append((a, b, source, target))
    return shapes, segments


def _crosses(seg, box):
    (x1, y1), (x2, y2) = seg
    bx, by, bw, bh = box
    lo_x, hi_x, lo_y, hi_y = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
    return lo_x < bx + bw and hi_x > bx and lo_y < by + bh and hi_y > by


def test_a_long_flow_wraps_into_rows_that_print_legibly_and_no_line_crosses_a_box():
    names = [f"Step number {i}" for i in range(14)]
    anno = {"steps": []}
    for run, offset in (("A", 0), ("B", 600)):
        for i, name in enumerate(names):
            if run == "B" and i == 6:
                continue                                  # run B skips a step: a branch
            anno["steps"].append(_step(run, name, f"2026-05-18T09:{(offset // 60 + i):02d}:00Z"))
    root = _written(anno)
    shapes, segments = _boxes_and_segments(root)
    process = root.find(f"{_BPMN}process")
    nodes = [el.get("id") for el in process if el.tag != f"{_BPMN}sequenceFlow"]
    assert set(nodes) == set(shapes)                      # every node has a shape
    assert {f.get("id") for f in process.findall(f"{_BPMN}sequenceFlow")} == {
        e.get("bpmnElement") for e in root.iter(f"{_BPMNDI}BPMNEdge")}
    rows = {y for (_x, y, _w, _h) in shapes.values()}
    assert len({round(y / 100) for y in rows}) >= 2      # wrapped
    for (a, b, src, tgt) in segments:
        for nid, box in shapes.items():
            if nid not in (src, tgt):
                assert not _crosses((a, b), box), (src, tgt, nid)
    xs = [x for (x, _y, w, _h) in shapes.values()] + [x + w for (x, _y, w, _h) in shapes.values()]
    ys = [y for (_x, y, _w, h) in shapes.values()] + [y + h for (_x, y, _w, h) in shapes.values()]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    # A landscape page's printable area (684 x 425 pt): 12 px labels print at 8 pt or more.
    assert 12 * min(684 / width, 425 / height) >= 8.0


def test_a_short_flow_stays_one_row():
    anno = {"steps": [_step("A", n, f"2026-05-18T09:00:{i:02d}Z")
                      for i, n in enumerate(("One", "Two", "Three"))]}
    shapes, _segments = _boxes_and_segments(_written(anno))
    centres = {round(y + h / 2) for (_x, y, _w, h) in shapes.values()}
    assert len(centres) == 1


def _untimed(case_id, name, order, **extra):
    return {"step_id": f"{name}-{case_id}", "case_id": case_id, "name": name,
            "state": "manually_authored", "time_range": None, "order": order, **extra}


def test_steps_without_a_time_follow_the_timed_ones_in_their_order():
    """C16: a run's steps in time order, then the steps added without a time
    (time_range null) by their `order`, in the log and the one-run chain."""
    anno = {"steps": [
        _untimed("A", "Late", 2),
        _step("A", "Second", "2026-05-18T09:00:10Z"),
        _untimed("A", "Early", 1),
        _step("A", "First", "2026-05-18T09:00:00Z"),
    ]}
    trace = next(iter(build_annotation_log(anno)))
    assert [e["concept:name"] for e in trace] == ["First", "Second", "Early", "Late"]
    assert "time:timestamp" not in trace[2]
    assert session_sequence(anno) == ["First", "Second", "Early", "Late"]


def test_the_documentation_says_no_time_for_steps_without_one():
    """C16: the average leaves out the steps without a time; a label no timed
    step has says no time (never "under 1s"), and the implicit run of a
    session without a recording is not counted in runs."""
    anno = {"steps": [_untimed("imp", "Log it", 1, system="SAP"),
                      _untimed("imp", "Reply", 2),
                      _step("imp", "Check", "2026-05-18T09:00:10Z")]}
    anno["steps"][2]["time_range"]["end"] = "2026-05-18T09:00:40Z"
    from step_context import StepContext
    ctx = StepContext({}, {}, vocabs=[])
    tasks = _tasks(_written(anno, context=ctx, implicit_runs=["imp"]))
    assert tasks["Log it"].find(f"{_BPMN}documentation").text == "SAP."
    assert tasks["Reply"].find(f"{_BPMN}documentation") is None
    assert tasks["Check"].find(f"{_BPMN}documentation").text == "30s on average."
    # The same run, marked: the runs are counted.
    tasks = _tasks(_written(anno, context=ctx))
    assert tasks["Log it"].find(f"{_BPMN}documentation").text == "SAP. In 1 of 1 transaction."
    assert tasks["Check"].find(f"{_BPMN}documentation").text == (
        "In 1 of 1 transaction, 30s on average.")


# ---- contract C17: the flow the analyst sets on steps ------------------------------

_FLOW_STEPS = ("Receive the order", "Check the customer", "Book the order",
               "Confirm the lines", "Send the confirmation")


def _flow_anno():
    """One transaction of five steps. Check the customer happens only when the
    customer is new; Book the order ends the process when the credit check
    fails; Confirm the lines goes back to Check the customer when a line is
    missing."""
    steps = [_step("A", name, f"2026-05-18T09:00:{10 * i:02d}Z")
             for i, name in enumerate(_FLOW_STEPS)]
    steps[1]["only_when"] = "the customer is new"
    steps[2]["links"] = [{"to": "end", "when": "the credit check fails"}]
    steps[3]["links"] = [{"to": steps[1]["step_id"], "when": "a line is missing"}]
    return {"steps": steps}


def _tag(el):
    return el.tag.split("}", 1)[-1]


# The process's children that are not flow nodes: the flows, and (C18) the
# data objects and the text annotations with their associations.
_NOT_NODES = ("sequenceFlow", "dataObject", "dataObjectReference", "textAnnotation",
              "association")


def _graph(root):
    """(flow nodes by id, flows as (id, source, target, name)) of the process."""
    process = root.find(f"{_BPMN}process")
    elements = {el.get("id"): el for el in process if _tag(el) not in _NOT_NODES}
    flows = [(f.get("id"), f.get("sourceRef"), f.get("targetRef"), f.get("name"))
             for f in process.findall(f"{_BPMN}sequenceFlow")]
    return elements, flows


def _reach(start, adjacency):
    seen, todo = {start}, [start]
    while todo:
        for nxt in adjacency.get(todo.pop(), []):
            if nxt not in seen:
                seen.add(nxt)
                todo.append(nxt)
    return seen


def _well_formed(root):
    """Assert the model a BPMN tool reads: one start event and one end event
    per outcome (C18: the main end and one per early end), plain or manual
    tasks and exclusive gateways only, each task one flow in and one out,
    each end event one flow in, each gateway a real split or join, every
    node reachable from the start and able to reach an end, and each node
    listing its flows. Returns _graph(root)."""
    elements, flows = _graph(root)
    tags = [_tag(el) for el in elements.values()]
    assert tags.count("startEvent") == 1 and tags.count("endEvent") >= 1, tags
    assert set(tags) <= {"startEvent", "endEvent", "task", "manualTask", "serviceTask",
                         "exclusiveGateway"}, tags
    out, inc = {}, {}
    for _fid, s, t, _name in flows:
        out.setdefault(s, []).append(t)
        inc.setdefault(t, []).append(s)
    start = next(i for i, el in elements.items() if _tag(el) == "startEvent")
    ends = [i for i, el in elements.items() if _tag(el) == "endEvent"]
    assert _reach(start, out) == set(elements)
    assert set().union(*(_reach(end, inc) for end in ends)) == set(elements)
    for i, el in elements.items():
        if _tag(el) in _TASK_TAGS:
            assert len(out.get(i, [])) == 1 and len(inc.get(i, [])) == 1, el.get("name")
        elif _tag(el) == "endEvent":
            assert len(inc.get(i, [])) == 1 and not out.get(i), el.get("name")
        elif _tag(el) == "exclusiveGateway":
            assert len(out.get(i, [])) > 1 or len(inc.get(i, [])) > 1, i
        assert sorted(x.text for x in el.findall(f"{_BPMN}incoming")) == sorted(
            f for f, _s, t, _n in flows if t == i)
        assert sorted(x.text for x in el.findall(f"{_BPMN}outgoing")) == sorted(
            f for f, s, _t, _n in flows if s == i)
    return elements, flows


def _ends(root, main="End"):
    """{flow name: [(what it comes from, what it leads to)]}: past the
    gateways, each end named by its task, or "start" and "end" (the main
    end, named `main`: "End" while the Result is empty), or "end: <name>"
    for an early end (C18)."""
    elements, flows = _graph(root)
    out = {s: t for _f, s, t, _n in flows}
    inc = {t: s for _f, s, t, _n in flows}

    def name(i, step):
        while _tag(elements[i]) == "exclusiveGateway":
            i = step[i]
        if _tag(elements[i]) == "endEvent" and elements[i].get("name") != main:
            return f"end: {elements[i].get('name')}"
        return {"startEvent": "start", "endEvent": "end"}.get(_tag(elements[i]),
                                                             elements[i].get("name"))
    named = {}
    for _f, s, t, n in flows:
        if n:
            named.setdefault(n, []).append((name(s, inc), name(t, out)))
    return {n: sorted(pairs) for n, pairs in named.items()}


def _early_ends(root, main="End"):
    """{early end's name: (the task it follows, the name and the
    documentation of the flow into it)} for each end event but the main one
    (C18), past the gateway in between."""
    elements, flows = _graph(root)
    by_id = {el.get("id"): el for el in root.find(f"{_BPMN}process")}
    inc = {t: s for _f, s, t, _n in flows}
    out = {}
    for fid, s, t, name in flows:
        end = elements[t]
        if _tag(end) != "endEvent" or end.get("name") == main:
            continue
        while _tag(elements[s]) == "exclusiveGateway":
            s = inc[s]
        doc = by_id[fid].find(f"{_BPMN}documentation")
        out[end.get("name")] = (elements[s].get("name"), name,
                                doc.text if doc is not None else None)
    return out


def test_the_flow_set_on_steps_draws_a_condition_a_skip_a_loop_and_an_early_end():
    root = _written(_flow_anno())
    elements, _flows = _well_formed(root)
    assert sorted(el.get("name") for el in elements.values() if _tag(el) in _TASK_TAGS) == sorted(
        _FLOW_STEPS)
    assert _ends(root) == {
        "the customer is new": [("Receive the order", "Check the customer")],
        "otherwise": [("Receive the order", "Book the order")],
        "a line is missing": [("Confirm the lines", "Check the customer")],
        # The branches the transaction took, where no label was declared.
        "1 of 1 transaction": [("Book the order", "Confirm the lines"),
                               ("Confirm the lines", "Send the confirmation")],
    }
    # C18: the early end is an end event of its own, named by its when; the
    # flow into it carries no name.
    assert _early_ends(root) == {"the credit check fails": ("Book the order", None, None)}


def _label_boxes(root):
    """{flow id: (x, y, w, h)} of every named flow's label."""
    out = {}
    for edge in root.iter(f"{_BPMNDI}BPMNEdge"):
        b = edge.find(f"{_BPMNDI}BPMNLabel/{_DC}Bounds")
        if b is not None:
            out[edge.get("bpmnElement")] = tuple(float(b.get(k))
                                                 for k in ("x", "y", "width", "height"))
    return out


def _overlaps(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def _event_names(root, shapes):
    """{event id: box} of each named event's name, where bpmn-js draws it
    when the file places none: under the event, centred in 90 px, a line of
    13.2 px for every 90 px of text at a generous 7 px a character."""
    out = {}
    for el in root.find(f"{_BPMN}process"):
        if _tag(el) in ("startEvent", "endEvent") and el.get("name"):
            x, y, w, h = shapes[el.get("id")]
            lines = max(1, math.ceil(len(el.get("name")) * 7 / 90))
            out[el.get("id")] = (x + w / 2 - 45, y + h, 90, lines * 13.2)
    return out


def _shape_labels(root):
    """{element id: (x, y, w, h)} of the names the file places under shapes
    (C18: the events' names and the data objects' names)."""
    out = {}
    for shape in root.iter(f"{_BPMNDI}BPMNShape"):
        b = shape.find(f"{_BPMNDI}BPMNLabel/{_DC}Bounds")
        if b is not None:
            out[shape.get("bpmnElement")] = tuple(float(b.get(k))
                                                  for k in ("x", "y", "width", "height"))
    return out


def _assert_readable(root, min_label_w=90):
    """No line crosses a box it does not join and no two boxes overlap
    (tasks, events, gateways and, C18, the notes, the data objects and the
    legend); every named flow has a label box at least `min_label_w` wide
    (bpmn-js wraps its text at 90 px); no flow label and no name placed
    under a shape (an event's, a data object's) covers a box other than its
    own, a line or another name, and no flow label covers an event's name."""
    shapes, segments = _boxes_and_segments(root)
    _elements, flows = _graph(root)
    named = {f for f, _s, _t, n in flows if n}
    for (a, b, src, tgt) in segments:
        for nid, box in shapes.items():
            if nid not in (src, tgt):
                assert not _crosses((a, b), box), (src, tgt, nid)
            else:
                # A line meets its own ends at their edge, never inside them.
                x, y, w, h = box
                assert not _crosses((a, b), (x + 1, y + 1, w - 2, h - 2)), (src, tgt, nid, a, b)
    ids = sorted(shapes)
    for i, p in enumerate(ids):
        for q in ids[i + 1:]:
            assert not _overlaps(shapes[p], shapes[q]), (p, q)
    labels = _label_boxes(root)
    assert set(labels) == named
    for fid, box in labels.items():
        assert box[2] >= min_label_w and box[3] >= 11 * 1.2, (fid, box)
    placed = {**labels, **_shape_labels(root)}
    events = _event_names(root, shapes)
    for fid, box in placed.items():
        for nid, shape in shapes.items():
            assert nid == fid or not _overlaps(box, shape), (fid, nid)
        for (a, b, src, tgt) in segments:
            assert not _crosses((a, b), box), (fid, a, b, src, tgt)
        others = list(placed.items()) + (list(events.items()) if fid in labels else [])
        for other, obox in others:
            assert other == fid or not _overlaps(box, obox), (fid, other)


def test_the_flow_labels_sit_clear_of_every_box_line_and_other_label():
    anno = _flow_anno()
    anno["document"] = {"trigger": "An order arrives by email",
                        "result": "The customer has the confirmation"}
    root = _written(anno)
    # Five named flows: the flow into the early end carries no name (C18).
    assert len(_label_boxes(root)) == 5
    # The start, the main end and (C18) the early end are named.
    assert len(_event_names(root, _boxes_and_segments(root)[0])) == 3
    _assert_readable(root)


def test_a_declared_condition_names_its_branch_and_the_observed_ones_count():
    """Three transactions: one escalates, only when the ticket is urgent.
    The declared label names its branch; the branch no label was declared
    for keeps its "N of M transactions"."""
    anno = _two_case_anno()
    anno["steps"] += [_step("C", "Search", "2026-05-18T09:20:00Z"),
                      _step("C", "Open ticket", "2026-05-18T09:20:10Z"),
                      _step("C", "Resolve", "2026-05-18T09:20:20Z")]
    next(s for s in anno["steps"] if s["name"] == "Escalate")["only_when"] = "the ticket is urgent"
    root = _written(anno)
    _well_formed(root)
    assert _ends(root) == {
        "2 of 3 transactions": [("Search", "Open ticket")],
        "the ticket is urgent": [("Search", "Escalate")],
        "otherwise": [("Search", "Resolve")],
    }
    _assert_readable(root)


def test_the_implicit_run_counts_no_transactions_on_its_branches():
    """C16: a session without a recording has one implicit run, not a marked
    transaction, so its observed branches carry no count; the declared
    labels stay."""
    root = _written(_flow_anno(), implicit_runs=["A"])
    assert set(_ends(root)) == {"the customer is new", "otherwise", "a line is missing"}
    assert set(_early_ends(root)) == {"the credit check fails"}


def test_a_declaration_that_changes_nothing_keeps_the_recorded_map():
    """A link to a hidden step draws nothing, so the one transaction is
    still drawn as its plain sequence."""
    anno = _flow_anno()
    for s in anno["steps"]:
        s.pop("only_when", None)
        s.pop("links", None)
    anno["steps"][1]["state"] = "hidden"
    anno["steps"][3]["links"] = [{"to": anno["steps"][1]["step_id"], "when": "never drawn"}]
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "step.bpmn")
        assert write_observed_bpmn(anno, out) is True
        xml = Path(out).read_text(encoding="utf-8")
    assert "Gateway" not in xml and "never drawn" not in xml


def test_a_long_condition_is_cut_on_the_map_and_kept_whole_in_its_flow():
    """The map names a flow with the words of a long condition that fit in
    48 characters, so its label stays about three lines tall and finds a
    clear place; the whole condition is the flow's documentation (the PDD
    prints it whole too)."""
    anno = _flow_anno()
    long = ("the customer is new and the order value is above the credit limit "
            "that was set for the customer's region last year")
    anno["steps"][1]["only_when"] = long
    root = _written(anno)
    flows = [f for f in root.find(f"{_BPMN}process").findall(f"{_BPMN}sequenceFlow")
             if (f.get("name") or "").startswith("the customer")]
    assert [f.get("name") for f in flows] == ["the customer is new and the order value is…"]
    assert flows[0].find(f"{_BPMN}documentation").text == long
    # A label that fits whole is not repeated as documentation.
    assert all(f.find(f"{_BPMN}documentation") is None
               for f in root.find(f"{_BPMN}process").findall(f"{_BPMN}sequenceFlow")
               if f not in flows)
    _assert_readable(root)


def test_the_flow_map_is_written_the_same_way_every_time():
    with tempfile.TemporaryDirectory() as d:
        paths = [os.path.join(d, f"step{i}.bpmn") for i in range(2)]
        for p in paths:
            assert write_observed_bpmn(_flow_anno(), p) is True
        first, second = (Path(p).read_text(encoding="utf-8") for p in paths)
    assert first == second


def test_a_long_flow_with_declarations_wraps_and_stays_readable():
    """Twelve steps of one transaction with a condition, a skip, a loop and
    an early end, long enough to wrap into rows: still well formed, every
    label clear, and printed legibly on a landscape page."""
    names = [f"Step number {i}" for i in range(12)]
    steps = [_step("A", n, f"2026-05-18T09:{i:02d}:00Z") for i, n in enumerate(names)]
    steps[2]["only_when"] = "the amount is over the limit"
    steps[3]["links"] = [{"to": steps[7]["step_id"], "when": "the customer is known"}]
    steps[9]["links"] = [{"to": steps[4]["step_id"], "when": "a check fails"},
                         {"to": "end", "when": "the order is cancelled"}]
    root = _written({"steps": steps})
    _well_formed(root)
    assert {"the amount is over the limit", "otherwise", "the customer is known",
            "a check fails"} <= set(_ends(root))
    assert set(_early_ends(root)) == {"the order is cancelled"}
    _assert_readable(root)
    shapes, _segments = _boxes_and_segments(root)
    boxes = list(shapes.values()) + list(_label_boxes(root).values())
    xs = [x for (x, _y, _w, _h) in boxes] + [x + w for (x, _y, w, _h) in boxes]
    ys = [y for (_x, y, _w, _h) in boxes] + [y + h for (_x, y, _w, h) in boxes]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    assert 12 * min(684 / width, 425 / height) >= 7.0


# ---- contract C18: richer maps from what the session already holds -----------------

_BIOC = "{http://bpmn.io/schema/bpmn/biocolor/1.0}"
_LONG_NOTE = ("The account team keeps a second list of blocked customers in a shared "
              "mailbox; check it before booking when the customer is new.")


def _rich_anno():
    """_flow_anno's five steps in three systems (the analyst's `system`),
    with two notes on Check the customer, one on Confirm the lines and one on
    a moment; an attachment on Receive the order, one without a label on
    Confirm the lines and one on the session; and a step added by hand at the
    end of the transaction, without a system."""
    anno = _flow_anno()
    steps = anno["steps"]
    for s, system in zip(steps, ("Outlook", "Salesforce", "SAP", "SAP", "Outlook")):
        s["system"] = system
    steps.append({"step_id": "hand-1", "case_id": "A", "name": "Phone the customer",
                  "state": "manually_authored", "time_range": None, "order": 1,
                  "evidence": {"interaction_event_ids": [], "screenshot_refs": []}})
    added = "2026-09-24T10:00:00Z"
    anno["analyst_notes"] = [
        {"id": "n1", "text": "Ask Ana about the credit block.", "step_id": steps[1]["step_id"],
         "at": None, "added_at": added},
        {"id": "n2", "text": _LONG_NOTE, "step_id": steps[1]["step_id"], "at": None,
         "added_at": added},
        {"id": "n3", "text": "Confirm the date  with the warehouse.",
         "step_id": steps[3]["step_id"], "at": None, "added_at": added},
        {"id": "n4", "text": "A note on a moment.", "step_id": None,
         "at": "2026-05-18T09:00:05Z", "added_at": added},
    ]
    anno["attachments"] = [
        {"id": "a1", "file": "order-email.msg", "label": "Example order email",
         "step_id": steps[0]["step_id"], "added_at": added},
        {"id": "a2", "file": "price-list.xlsx", "label": "", "step_id": steps[3]["step_id"],
         "added_at": added},
        {"id": "a3", "file": "brief.docx", "label": "Project brief", "step_id": None,
         "added_at": added},
    ]
    return anno


def _plain_context():
    """A StepContext without interactions: a step's system is the one the
    analyst set (C16)."""
    from step_context import StepContext
    return StepContext({}, {}, vocabs=[])


def _process(root):
    return root.find(f"{_BPMN}process")


def _di_shapes(root):
    return {sh.get("bpmnElement"): sh for sh in root.iter(f"{_BPMNDI}BPMNShape")}


def _di_edges(root):
    return {e.get("bpmnElement"): e for e in root.iter(f"{_BPMNDI}BPMNEdge")}


def _bounds(el):
    b = el.find(f"{_DC}Bounds")
    return tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))


def _points(edge):
    return [(float(w.get("x")), float(w.get("y"))) for w in edge.findall(f"{_DI}waypoint")]


def _annotations(root):
    """(notes, map label): the steps' notes (TextAnnotation_<n>) joined to a
    task by an association, as {task name: annotation}, and the one text
    annotation no association joins (a map's one system, 2.0.1), or None."""
    process = _process(root)
    by_id = {el.get("id"): el for el in process}
    notes, joined = {}, set()
    for assoc in process.findall(f"{_BPMN}association"):
        task, note = by_id[assoc.get("sourceRef")], by_id[assoc.get("targetRef")]
        assert _tag(task) in _TASK_TAGS and _tag(note) == "textAnnotation"
        joined.add(note.get("id"))
        if re.match(r"^TextAnnotation_\d+$", note.get("id")):
            notes[task.get("name")] = note
    free = [el for el in process.findall(f"{_BPMN}textAnnotation")
            if el.get("id") not in joined and el.get("id") != "TextAnnotation_doneby"]
    assert len(free) <= 1
    return notes, (free[0] if free else None)


def _system_labels(root):
    """{task name: (label text, association)} of the system labels joined
    to the tasks (2.0.1: TextAnnotation_system_<k>)."""
    process = _process(root)
    by_id = {el.get("id"): el for el in process}
    out = {}
    for assoc in process.findall(f"{_BPMN}association"):
        label = by_id[assoc.get("targetRef")]
        if label.get("id").startswith("TextAnnotation_system_"):
            out[by_id[assoc.get("sourceRef")].get("name")] = (_text(label), assoc)
    return out


def _text(el, child="text"):
    found = el.find(f"{_BPMN}{child}")
    return found.text if found is not None else None


def test_a_tasks_kind_follows_what_the_automation_does_with_its_step():
    """Contract C25: the gear (a service task) for "The automation does it",
    the hand (a manual task) for "Stays with a person", a plain task for "Not
    decided yet" (or no choice), "No longer needed" and an older waste flag.
    A step added by hand without a system is a plain task now: the hand
    means only "stays with a person". A task done in a system keeps its
    system label whatever its kind."""
    anno = _rich_anno()
    anno["steps"].append({"step_id": "hand-2", "case_id": "A", "name": "Log the call in SAP",
                          "state": "manually_authored", "time_range": None, "order": 2,
                          "system": "SAP",
                          "evidence": {"interaction_event_ids": [], "screenshot_refs": []}})
    steps = anno["steps"]
    steps[0]["automation"] = "automated"                 # Receive the order
    steps[1]["automation"] = "person"                    # Check the customer
    steps[2]["automation"] = "not_needed"                # Book the order
    steps[2]["flags"] = {"waste": True}
    steps[3]["automation"] = "undecided"                 # Confirm the lines
    steps[4]["flags"] = {"waste": True}                  # an older project's waste flag
    root = _written(anno, context=_plain_context())
    kinds = {name: _tag(el) for name, el in _tasks(root).items()}
    assert kinds == {**{name: "task" for name in _FLOW_STEPS},
                     "Receive the order": "serviceTask", "Check the customer": "manualTask",
                     "Phone the customer": "task", "Log the call in SAP": "task"}
    labels = _system_labels(root)
    assert labels["Check the customer"][0] == "Salesforce" and labels["Receive the order"][0] == "Outlook"
    assert "Phone the customer" not in labels and labels["Log the call in SAP"][0] == "SAP"
    _well_formed(root)


def test_an_unknown_automation_value_is_a_plain_task():
    anno = _rich_anno()
    anno["steps"][0]["automation"] = "robot"
    anno["steps"][0]["flags"] = {"waste": True}
    kinds = {name: _tag(el) for name, el in _tasks(_written(anno, context=_plain_context())).items()}
    assert kinds["Receive the order"] == "task"


def test_a_step_added_by_hand_with_its_system_set_is_a_plain_task_labelled_with_it():
    anno = _rich_anno()
    anno["steps"][-1]["system"] = "Phone"
    root = _written(anno, context=_plain_context())
    assert "manualTask" not in {_tag(el) for el in _tasks(root).values()}
    assert _system_labels(root)["Phone the customer"][0] == "Phone"


def test_a_map_of_steps_outside_the_systems_has_no_system_label():
    anno = {"steps": [_untimed("A", "Receive the letter", 1), _untimed("A", "File it", 2)]}
    root = _written(anno, context=_plain_context())
    assert {_tag(el) for el in _tasks(root).values()} == {"task"}
    assert _system_labels(root) == {} and _annotations(root)[1] is None
    assert not any(k.startswith(_BIOC) for sh in _di_shapes(root).values() for k in sh.attrib)


def test_a_task_of_several_steps_takes_the_first_choice_made_on_them():
    """Contract C25 on a node several transactions did: the choice of the
    first of its steps that has one (the reference transaction's first), so
    a choice made on another transaction's copy counts; a step added by
    hand without a choice is a plain task."""
    anno = _two_case_anno()
    for s in anno["steps"]:
        if s["case_id"] == "B" and s["name"] == "Resolve":
            s["automation"] = "person"
        if s["case_id"] == "A" and s["name"] == "Search":
            s["automation"] = "automated"
        if s["case_id"] == "B" and s["name"] == "Search":
            s["automation"] = "person"
    anno["steps"].append(_untimed("B", "Call back", 1))
    kinds = {name: _tag(el) for name, el in _tasks(_written(anno)).items()}
    assert kinds == {"Search": "serviceTask", "Open ticket": "task", "Escalate": "task",
                     "Resolve": "manualTask", "Call back": "task"}


def test_each_link_to_end_ends_at_an_end_event_named_by_its_when():
    anno = _flow_anno()
    long = ("the credit check fails and the customer does not want to pay in advance "
            "by card")
    anno["steps"][3]["links"].append({"to": "end", "when": long})
    root = _written(anno)
    _well_formed(root)
    ends = {el.get("name"): el for el in _process(root).findall(f"{_BPMN}endEvent")}
    cut = "the credit check fails and the customer does…"
    assert set(ends) == {"End", "the credit check fails", cut}
    # A name cut for the map keeps the analyst's words whole in its documentation.
    assert _text(ends[cut], "documentation") == long
    assert _text(ends["the credit check fails"], "documentation") is None
    # The end event says the when once: the flow into it carries no name and
    # no documentation (the live map keeps the label on its line into End).
    assert _early_ends(root) == {"the credit check fails": ("Book the order", None, None),
                                 cut: ("Confirm the lines", None, None)}
    assert "the credit check fails" not in _ends(root) and cut not in _ends(root)
    # The transaction's last step ends at the main end.
    elements, flows = _graph(root)
    main = next(i for i, el in elements.items() if el.get("name") == "End")
    into_main = [s for _f, s, t, _n in flows if t == main]
    assert [elements[s].get("name") for s in into_main] == ["Send the confirmation"]
    # With a Result, the main end takes its first line; the early ends keep their words.
    anno["document"] = {"result": "The customer has the confirmation\nand the invoice."}
    names = {el.get("name") for el in _process(_written(anno)).findall(f"{_BPMN}endEvent")}
    assert names == {"The customer has the confirmation", "the credit check fails", cut}


def test_a_line_never_turns_back_through_its_own_gateway():
    """Three ways out of one step stacked in the next column (the next step
    of each transaction and an early end): the flow to the step whose middle
    sits just below the gateway's leaves by the gateway's side, not from its
    bottom corner back up through it."""
    steps = [_step("A", "Receive", "2026-05-18T09:00:00Z"),
             _step("A", "Book", "2026-05-18T09:00:10Z"),
             _step("B", "Receive", "2026-05-18T10:00:00Z"),
             _step("B", "Escalate", "2026-05-18T10:00:10Z")]
    steps[0]["links"] = [{"to": "end", "when": "the order is rejected"}]
    root = _written({"steps": steps})
    _well_formed(root)
    _assert_readable(root)


def test_each_named_event_has_its_name_placed_under_it():
    """The file places each event's name (bpmn-js and other tools draw it
    there): centred under the event, a little below it, since an end
    event's thick circle reaches past its box."""
    anno = _flow_anno()
    anno["document"] = {"trigger": "An order arrives by email"}
    root = _written(anno)
    shapes, names = _di_shapes(root), _shape_labels(root)
    events = [el for el in _process(root) if _tag(el) in ("startEvent", "endEvent")]
    assert len(events) == 3 and all(el.get("id") in names for el in events)
    for el in events:
        ex, ey, ew, eh = _bounds(shapes[el.get("id")])
        lx, ly, lw, _lh = names[el.get("id")]
        assert ly >= ey + eh + 3 and abs((lx + lw / 2) - (ex + ew / 2)) <= 1


def test_an_observed_end_and_a_skip_to_the_end_stay_on_the_main_end():
    """Only a link to End makes an end event of its own: the "otherwise" path
    around a last step that happens only under a condition, and a link to End
    on the step a transaction ended with, end at the main end."""
    steps = [_step("A", name, f"2026-05-18T09:00:{10 * i:02d}Z")
             for i, name in enumerate(("Receive", "Book", "Confirm"))]
    steps[2]["only_when"] = "the customer asks for it"
    t2 = [_step("B", "Receive", "2026-05-18T10:00:00Z"),
          _step("B", "Book", "2026-05-18T10:00:10Z")]
    t2[1]["links"] = [{"to": "end", "when": "the order is on hold"}]
    root = _written({"steps": steps + t2})
    _well_formed(root)
    names = sorted(el.get("name") for el in _process(root).findall(f"{_BPMN}endEvent"))
    assert names == ["End"]
    assert _ends(root)["otherwise or the order is on hold"] == [("Book", "end")]


def test_a_steps_notes_become_one_text_annotation_joined_to_its_task():
    root = _written(_rich_anno(), context=_plain_context())
    notes, _legend = _annotations(root)
    assert set(notes) == {"Check the customer", "Confirm the lines"}
    shown = "Ask Ana about the credit block.\nThe account team keeps a second list of blocked…"
    assert _text(notes["Check the customer"]) == shown
    # Cut for the map; the notes stay whole in the annotation's documentation.
    assert _text(notes["Check the customer"], "documentation") == (
        "Ask Ana about the credit block.\n" + _LONG_NOTE)
    assert _text(notes["Confirm the lines"]) == "Confirm the date with the warehouse."
    assert _text(notes["Confirm the lines"], "documentation") is None
    # A note on a moment is on no task.
    assert "A note on a moment." not in ET.tostring(root, encoding="unicode")
    # 2.0.1: each note sits under its task (the system label is above it),
    # over its width, the association falling straight from the task's
    # bottom into the note's top; both have a place on the diagram.
    shapes, edges = _di_shapes(root), _di_edges(root)
    for note in notes.values():
        assoc = next(a for a in _process(root).findall(f"{_BPMN}association")
                     if a.get("targetRef") == note.get("id"))
        assert assoc.get("associationDirection") == "None"
        tx, ty, tw, th = _bounds(shapes[assoc.get("sourceRef")])
        nx, ny, nw, nh = _bounds(shapes[note.get("id")])
        assert ny > ty + th and nx < tx + tw and tx < nx + nw
        (x1, y1), (x2, y2) = _points(edges[assoc.get("id")])
        assert (y1, y2) == (ty + th, ny) and x1 == x2
        assert tx < x1 < tx + tw and nx < x1 < nx + nw
    # Tall enough for its lines: 12 px text, 14.4 px a line, 7 px padding.
    _x, _y, w, h = _bounds(shapes[notes["Check the customer"].get("id")])
    assert w >= 140 and h >= 4 * 14.4 + 14


def test_attachments_on_a_step_become_data_objects_joined_to_its_task():
    root = _written(_rich_anno(), context=_plain_context())
    process = _process(root)
    refs = {el.get("id"): el for el in process.findall(f"{_BPMN}dataObjectReference")}
    objects = {el.get("id") for el in process.findall(f"{_BPMN}dataObject")}
    # Named by the label, else by the file name; an attachment on the session is on no task.
    assert sorted(el.get("name") for el in refs.values()) == [
        "Example order email", "price-list.xlsx"]
    assert all(el.get("dataObjectRef") in objects for el in refs.values())
    assert {_text(el, "documentation") for el in refs.values()} == {
        "attachments/order-email.msg", "attachments/price-list.xlsx"}
    # The id carries the attachment's id, so the viewer can open the file.
    assert set(refs) == {"DataObjectReference_a1", "DataObjectReference_a2"}
    joined = {}
    shapes, edges = _di_shapes(root), _di_edges(root)
    for name, task in _tasks(root).items():
        props = {p.get("id") for p in task.findall(f"{_BPMN}property")}
        for dia in task.findall(f"{_BPMN}dataInputAssociation"):
            source = dia.find(f"{_BPMN}sourceRef").text
            assert dia.find(f"{_BPMN}targetRef").text in props
            joined[refs[source].get("name")] = name
            # The object sits under its task; the line runs from its top to the task's bottom.
            tx, ty, tw, th = _bounds(shapes[task.get("id")])
            ox, oy, ow, oh = _bounds(shapes[source])
            assert (ow, oh) == (36, 50) and oy > ty + th
            (x1, y1), (x2, y2) = _points(edges[dia.get("id")])
            assert (y1, y2) == (oy, ty + th) and tx < x2 < tx + tw
            # Its name has a place under it.
            lx, ly, lw, _lh = _bounds(shapes[source].find(f"{_BPMNDI}BPMNLabel"))
            assert ly >= oy + oh and lx < ox + ow / 2 < lx + lw
    assert joined == {"Example order email": "Receive the order",
                      "price-list.xlsx": "Confirm the lines"}
    # BPMN 2.0 order inside a task: documentation, flows, properties, associations.
    rank = ["documentation", "incoming", "outgoing", "property", "dataInputAssociation"]
    for task in _tasks(root).values():
        order = [_tag(c) for c in task]
        assert order == sorted(order, key=rank.index)


def test_each_task_is_labelled_with_the_system_it_is_done_in():
    """2.0.1: the system a task is done in is a short text annotation above
    it, level with its left side, joined by an association (a process
    manager changes it by typing in any BPMN tool; a colour could be
    changed in none): no colour and no legend. A manual task carries its
    hand and no label."""
    root = _written(_rich_anno(), context=_plain_context())
    labels = _system_labels(root)
    assert {name: text for name, (text, _a) in labels.items()} == {
        "Receive the order": "Outlook", "Check the customer": "Salesforce",
        "Book the order": "SAP", "Confirm the lines": "SAP", "Send the confirmation": "Outlook"}
    assert _annotations(root)[1] is None
    assert not any(k.startswith(_BIOC) for sh in _di_shapes(root).values() for k in sh.attrib)
    shapes, edges = _di_shapes(root), _di_edges(root)
    for _name, (_label, assoc) in labels.items():
        assert assoc.get("associationDirection") == "None"
        tx, ty, tw, _th = _bounds(shapes[assoc.get("sourceRef")])
        lx, ly, _lw, lh = _bounds(shapes[assoc.get("targetRef")])
        assert ly + lh < ty and lx == tx
        (x1, y1), (x2, y2) = _points(edges[assoc.get("id")])
        assert (y1, y2) == (ty, ly + lh) and x1 == x2 and tx < x1 < tx + tw


def test_a_map_done_in_one_system_says_it_once():
    """When every task of a map that is done in a system is done in the
    same one, the map says it once, in a text annotation joined to nothing
    ("System: SAP"), and no task carries a label."""
    anno = _rich_anno()
    for s in anno["steps"]:
        if s.get("system"):
            s["system"] = "SAP"
    root = _written(anno, context=_plain_context())
    assert _system_labels(root) == {}
    label = _annotations(root)[1]
    assert label.get("id") == "TextAnnotation_system" and _text(label) == "System: SAP"
    assert label.get("id") in _di_shapes(root)


def test_attachment_ids_become_unique_xml_ids():
    anno = _flow_anno()
    step = anno["steps"][0]["step_id"]
    anno["attachments"] = [
        {"id": "a.1", "file": "one.pdf", "label": "One", "step_id": step},
        {"id": "a_1", "file": "two.pdf", "label": "Two", "step_id": step},
        {"id": None, "file": "../three.pdf", "label": "", "step_id": step},
    ]
    refs = {el.get("name"): el.get("id")
            for el in _process(_written(anno)).findall(f"{_BPMN}dataObjectReference")}
    assert refs == {"One": "DataObjectReference_a_1", "Two": "DataObjectReference_a_1_2",
                    "three.pdf": "DataObjectReference_file"}


def test_without_systems_there_are_no_labels_and_no_colours():
    root = _written(_flow_anno(), context=_plain_context())
    assert not any(k.startswith(_BIOC) for sh in _di_shapes(root).values() for k in sh.attrib)
    assert _annotations(root) == ({}, None) and _system_labels(root) == {}


def _mined_rich_anno():
    """Two transactions (mined into branches) in two systems, a note and an
    attachment on the reference transaction's steps, and a step added by
    hand in the second."""
    anno = _two_case_anno()
    for s in anno["steps"]:
        s["system"] = "ServiceNow" if s["name"] in ("Search", "Resolve") else "Jira"
    anno["steps"].append(_untimed("B", "Call the customer back", 1))
    anno["analyst_notes"] = [{"id": "n1", "text": "Search by the ticket number, never by name.",
                              "step_id": anno["steps"][0]["step_id"], "at": None,
                              "added_at": "2026-09-24T10:00:00Z"}]
    anno["attachments"] = [{"id": "a1", "file": "sop.pdf", "label": "Escalation SOP",
                            "step_id": anno["steps"][4]["step_id"],
                            "added_at": "2026-09-24T10:00:00Z"}]
    anno["pattern_run"] = {"case_id": "A"}
    return anno


def _assert_valid_bpmn(root):
    """The file is BPMN 2.0 a tool imports: every id unique; every reference
    names an element of the right kind; the process lists its flow elements
    before its artifacts; every element but the data objects has its place
    on the diagram, and every diagram element names one."""
    ids = [el.get("id") for el in root.iter() if el.get("id") is not None]
    assert len(ids) == len(set(ids))
    process = _process(root)
    by_id = {el.get("id"): el for el in root.iter() if el.get("id") is not None}
    kinds = [_tag(el) for el in process]
    artifacts = [i for i, k in enumerate(kinds) if k in ("textAnnotation", "association")]
    assert not artifacts or min(artifacts) > max(
        i for i, k in enumerate(kinds) if k not in ("textAnnotation", "association"))
    flow_nodes = {el.get("id") for el in process if _tag(el) not in _NOT_NODES}
    for el in process:
        if _tag(el) == "sequenceFlow":
            assert el.get("sourceRef") in flow_nodes and el.get("targetRef") in flow_nodes
        elif _tag(el) == "association":
            assert _tag(by_id[el.get("sourceRef")]) in _TASK_TAGS
            assert _tag(by_id[el.get("targetRef")]) == "textAnnotation"
        elif _tag(el) == "dataObjectReference":
            assert _tag(by_id[el.get("dataObjectRef")]) == "dataObject"
        for dia in el.findall(f"{_BPMN}dataInputAssociation"):
            assert _tag(by_id[dia.find(f"{_BPMN}sourceRef").text]) == "dataObjectReference"
            assert _tag(by_id[dia.find(f"{_BPMN}targetRef").text]) == "property"
    shapes, edges = _di_shapes(root), _di_edges(root)
    for el in process:
        if _tag(el) in ("sequenceFlow", "association"):
            assert el.get("id") in edges, el.get("id")
        elif _tag(el) != "dataObject":
            assert el.get("id") in shapes, el.get("id")
        for dia in el.findall(f"{_BPMN}dataInputAssociation"):
            assert dia.get("id") in edges
    assert set(shapes) | set(edges) <= set(by_id)


@pytest.mark.parametrize("case", ["flow", "mined", "one transaction"])
def test_a_rich_map_is_valid_bpmn_and_nothing_overlaps(case):
    if case == "flow":
        anno = _rich_anno()
        anno["document"] = {"trigger": "An order arrives by email",
                            "result": "The customer has the confirmation"}
    elif case == "mined":
        anno = _mined_rich_anno()
    else:
        anno = _rich_anno()
        for s in anno["steps"]:
            s.pop("only_when", None)
            s.pop("links", None)
    root = _written(anno, context=_plain_context())
    _assert_valid_bpmn(root)
    _well_formed(root)
    assert _system_labels(root)                  # 2.0.1: each task's system above it
    assert _process(root).findall(f"{_BPMN}dataObjectReference")
    _assert_readable(root, min_label_w=84 if case == "mined" else 90)


def test_a_long_note_and_files_under_one_task_keep_clear_of_each_other():
    """2.0.1: a task's note sits under it and its files right of the note, so
    a note five lines tall and two files with long names on one task leave
    every box, line and name clear."""
    anno = _rich_anno()
    step = anno["steps"][0]["step_id"]
    anno["analyst_notes"].append({"id": "n5", "text": _LONG_NOTE + " " + _LONG_NOTE, "step_id": step,
                                  "at": None, "added_at": "2026-09-24T10:00:00Z"})
    anno["attachments"].append({"id": "a4", "file": "a-very-long-file-name-for-the-order.pdf",
                                "label": "The customer's signed order form, scanned", "step_id": step,
                                "added_at": "2026-09-24T10:00:00Z"})
    root = _written(anno, context=_plain_context())
    _assert_valid_bpmn(root)
    _assert_readable(root)


def test_the_rich_map_is_written_the_same_way_every_time():
    with tempfile.TemporaryDirectory() as d:
        paths = [os.path.join(d, f"step{i}.bpmn") for i in range(2)]
        for p in paths:
            assert write_observed_bpmn(_rich_anno(), p, context=_plain_context()) is True
        first, second = (Path(p).read_text(encoding="utf-8") for p in paths)
    assert first == second


# ---- lane FX3: the waste flag on the step map ---------------------------------------

_WASTE_DOC = "Flagged as waste: this step should not be needed."


def _waste_marks(root):
    """{task name: (mark, association)} of the Waste marks joined to a task."""
    process = _process(root)
    by_id = {el.get("id"): el for el in process}
    out = {}
    for assoc in process.findall(f"{_BPMN}association"):
        mark = by_id[assoc.get("targetRef")]
        if mark.get("id").startswith("TextAnnotation_waste_"):
            out[by_id[assoc.get("sourceRef")].get("name")] = (mark, assoc)
    return out


def test_a_step_flagged_as_waste_marks_its_task():
    """Lane FX3, the live map's rule (process-map-levels.wasteNodes): a task a
    visible step of which is flagged as waste carries a small text
    annotation "Waste" (its documentation says what it means), joined by an
    association, right of the task's system label. A hidden step marks
    nothing."""
    anno = _rich_anno()
    anno["steps"][2]["flags"] = {"waste": True}          # Book the order
    root = _written(anno, context=_plain_context())
    _assert_valid_bpmn(root)
    marks = _waste_marks(root)
    assert set(marks) == {"Book the order"}
    mark, assoc = marks["Book the order"]
    assert (mark.get("id"), assoc.get("id")) == ("TextAnnotation_waste_1", "Association_waste_1")
    assert (_text(mark), _text(mark, "documentation")) == ("Waste", _WASTE_DOC)
    assert assoc.get("associationDirection") == "None"
    # The mark sits above its task, the association rising from the task's
    # top into the mark's lower hook; both have a place on the diagram.
    shapes, edges = _di_shapes(root), _di_edges(root)
    tx, ty, tw, _th = _bounds(shapes[assoc.get("sourceRef")])
    mx, my, mw, mh = _bounds(shapes[mark.get("id")])
    assert my + mh < ty and mx < tx + tw
    (x1, y1), (x2, y2) = _points(edges[assoc.get("id")])
    assert (y1, y2) == (ty, my + mh) and tx < x1 < tx + tw and mx < x2 < mx + mw
    # A hidden step marks nothing; without a flag, no mark.
    anno["steps"][2]["state"] = "hidden"
    anno["steps"][2]["flags"] = {"waste": True}
    anno["steps"][3]["flags"] = {"waste": False}
    root = _written(anno, context=_plain_context())
    assert _waste_marks(root) == {}


def test_a_waste_mark_beside_a_system_label_keeps_the_map_valid_and_nothing_overlaps():
    """The Waste mark of a task with a system label sits right of the
    label, level with its bottom: the rich maps stay valid BPMN, and no line
    crosses a box, no two boxes overlap and every label stays clear (lane
    FX3; 2.0.1 put the system label where the note was)."""
    for anno in (_rich_anno(), _mined_rich_anno()):
        for s in anno["steps"]:
            if s["name"] in ("Check the customer", "Search", "Escalate"):
                s["flags"] = {"waste": True}
        root = _written(anno, context=_plain_context())
        _assert_valid_bpmn(root)
        _well_formed(root)
        marks = _waste_marks(root)
        assert marks
        shapes = _di_shapes(root)
        notes = {_text(n): n for n in _process(root).findall(f"{_BPMN}textAnnotation")
                 if re.match(r"^TextAnnotation_\d+$", n.get("id"))}
        for name, (mark, assoc) in marks.items():
            joined = [a for a in _process(root).findall(f"{_BPMN}association")
                      if a.get("sourceRef") == assoc.get("sourceRef") and a is not assoc
                      and a.get("targetRef").startswith("TextAnnotation_system_")]
            if joined:
                label_box = _bounds(shapes[joined[0].get("targetRef")])
                mark_box = _bounds(shapes[mark.get("id")])
                assert mark_box[0] >= label_box[0] + label_box[2]
                assert mark_box[1] + mark_box[3] == label_box[1] + label_box[3]
        assert notes
        _assert_readable(root, min_label_w=84)


def test_the_waste_mark_is_written_the_same_way_every_time():
    anno = _rich_anno()
    anno["steps"][1]["flags"] = {"waste": True}
    with tempfile.TemporaryDirectory() as d:
        paths = [os.path.join(d, f"step{i}.bpmn") for i in range(2)]
        for p in paths:
            assert write_observed_bpmn(json_copy(anno), p, context=_plain_context()) is True
        first, second = (Path(p).read_text(encoding="utf-8") for p in paths)
    assert first == second and "TextAnnotation_waste_1" in first


def json_copy(value):
    import json
    return json.loads(json.dumps(value))


def test_steps_done_in_another_order_are_never_drawn_as_parallel_work():
    """Lane LF-PIPE (#9): 7 of the 10 live recordings' step maps drew
    parallel gateways, for transactions done one step after another (rec01's
    three orders; rec04, rec11). The inductive miner read the steps' varying
    order between transactions as concurrency. The map comes from the step
    flow edges: sequence flows and exclusive gateways, each branch saying in
    how many transactions it was taken."""
    anno = {"steps": [
        _step("A", "Search",      "2026-05-18T09:00:00Z"),
        _step("A", "Enter items", "2026-05-18T09:00:10Z"),
        _step("A", "Set address", "2026-05-18T09:00:20Z"),
        _step("A", "Save",        "2026-05-18T09:00:30Z"),
        _step("B", "Search",      "2026-05-18T09:10:00Z"),
        _step("B", "Set address", "2026-05-18T09:10:10Z"),
        _step("B", "Enter items", "2026-05-18T09:10:20Z"),
        _step("B", "Save",        "2026-05-18T09:10:30Z"),
        _step("C", "Search",      "2026-05-18T09:20:00Z"),
        _step("C", "Enter items", "2026-05-18T09:20:10Z"),
        _step("C", "Set address", "2026-05-18T09:20:20Z"),
        _step("C", "Save",        "2026-05-18T09:20:30Z"),
    ]}
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out) is True
        xml = Path(out).read_text(encoding="utf-8")
        elements = _process_elements(out)
    assert "parallelGateway" not in xml
    tags = [tag for tag, _name in elements]
    assert set(tags) <= {"startEvent", "endEvent", "task", "exclusiveGateway", "textAnnotation"}
    assert tags.count("startEvent") == 1 and tags.count("endEvent") == 1
    assert sorted(name for tag, name in elements if tag == "task") == [
        "Enter items", "Save", "Search", "Set address"]
    # A branch says in how many of the transactions it was taken.
    assert "2 of 3 transactions" in xml and "1 of 3 transactions" in xml


# ---- contract C25: who does each step, a label under its task ----------------------

def _role_context(role):
    from step_context import StepContext
    return StepContext({}, {}, vocabs=[], role=role)


def _done_by_labels(root, plane=None):
    """{task name: (label text, association)} of the Done by labels joined to
    the tasks (TextAnnotation_doneby_<k>), and the map's one Done by label
    (TextAnnotation_doneby, joined to nothing) or None."""
    container = plane if plane is not None else _process(root)
    by_id = {el.get("id"): el for el in container}
    out = {}
    for assoc in container.findall(f"{_BPMN}association"):
        label = by_id[assoc.get("targetRef")]
        if re.search(r"TextAnnotation_doneby_\d+$", label.get("id")):
            out[by_id[assoc.get("sourceRef")].get("name")] = (_text(label), assoc)
    once = [el for el in container.findall(f"{_BPMN}textAnnotation")
            if re.search(r"TextAnnotation_doneby$", el.get("id"))]
    assert len(once) <= 1
    return out, (_text(once[0]) if once else None)


def test_every_task_done_by_the_same_role_says_it_once_for_the_map():
    """The recording's role, with no step's own: "Done by: <role>" once,
    joined to nothing, and no task is labelled (the system label's rule)."""
    root = _written(_rich_anno(), context=_role_context("Sales assistant"))
    labels, once = _done_by_labels(root)
    assert labels == {} and once == "Done by: Sales assistant"
    assert _bounds(_di_shapes(root)["TextAnnotation_doneby"])
    _assert_valid_bpmn(root)
    _assert_readable(root)


def test_two_different_done_bys_label_each_task_under_it():
    """A step's own Done by wins over the role: two different ones label
    every task under it, the association falling from the task's bottom;
    the step's notes sit under its Done by label."""
    anno = _rich_anno()
    anno["steps"][1]["done_by"] = "Credit control"         # Check the customer: notes too
    anno["steps"][3]["done_by"] = "  Warehouse   clerk "   # Confirm the lines
    root = _written(anno, context=_role_context("Sales assistant"))
    labels, once = _done_by_labels(root)
    assert once is None
    assert {name: text for name, (text, _a) in labels.items()} == {
        **{name: "Sales assistant" for name in _FLOW_STEPS}, "Phone the customer": "Sales assistant",
        "Check the customer": "Credit control", "Confirm the lines": "Warehouse clerk"}
    shapes, edges = _di_shapes(root), _di_edges(root)
    tasks = _tasks(root)
    notes, _map = _annotations(root)
    for name, (_text_, assoc) in labels.items():
        task = _bounds(shapes[tasks[name].get("id")])
        label = _bounds(shapes[assoc.get("targetRef")])
        # Under the task, in from its left side; the line falls from its bottom.
        assert label[1] == task[1] + task[3] + 16 and label[0] > task[0]
        a, b = _points(edges[assoc.get("id")])
        assert a[1] == task[1] + task[3] and b[1] == label[1] and a[0] == b[0]
        if name in notes:
            note = _bounds(shapes[notes[name].get("id")])
            assert note[1] >= label[1] + label[3] + 16 and note[0] == task[0]
    assert "Check the customer" in notes and "Confirm the lines" in notes
    _assert_valid_bpmn(root)
    _well_formed(root)
    _assert_readable(root)


def test_without_a_role_or_a_done_by_no_task_is_labelled():
    root = _written(_rich_anno(), context=_plain_context())
    assert _done_by_labels(root) == ({}, None)
    # Only the steps that name someone are labelled: the others stay bare.
    anno = _rich_anno()
    anno["steps"][0]["done_by"] = "Ana"
    anno["steps"][2]["done_by"] = "Bo"
    labels, once = _done_by_labels(_written(anno, context=_plain_context()))
    assert once is None and {n: t for n, (t, _a) in labels.items()} == {
        "Receive the order": "Ana", "Book the order": "Bo"}
    # One person on some tasks and nobody on the others: said once (the rule
    # the system labels follow).
    anno["steps"][2]["done_by"] = "Ana"
    assert _done_by_labels(_written(anno, context=_plain_context())) == ({}, "Done by: Ana")


def test_a_map_label_for_the_system_and_one_for_who_does_it_never_overlap():
    anno = _rich_anno()
    for s in anno["steps"]:
        s["system"] = "SAP"
    root = _written(anno, context=_role_context("Order processor"))
    shapes = _di_shapes(root)
    assert _done_by_labels(root) == ({}, "Done by: Order processor")
    assert _text(next(el for el in _process(root).findall(f"{_BPMN}textAnnotation")
                      if el.get("id") == "TextAnnotation_system")) == "System: SAP"
    assert not _overlaps(_bounds(shapes["TextAnnotation_system"]), _bounds(shapes["TextAnnotation_doneby"]))
    _assert_readable(root)


def test_done_by_labels_on_a_mined_map_with_files_stay_clear():
    """Two transactions (branches), a note and a file: the files sit right
    of the Done by label, and nothing overlaps or is crossed."""
    anno = _mined_rich_anno()
    for s in anno["steps"]:
        s["done_by"] = "Agent" if s["case_id"] == "A" else "Supervisor"
    root = _written(anno, context=_plain_context())
    labels, once = _done_by_labels(root)
    assert once is None and labels["Search"][0] == "Agent" and labels["Call the customer back"][0] == "Supervisor"
    _assert_valid_bpmn(root)
    _well_formed(root)
    _assert_readable(root, min_label_w=84)
