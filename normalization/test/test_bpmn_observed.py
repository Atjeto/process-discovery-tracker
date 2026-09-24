"""Tests for observed-flow step BPMN (bpmn_observed).

Run with: pytest normalization/test/test_bpmn_observed.py
"""

from __future__ import annotations

import math
import os
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
    tasks = _by_name(root, "task")
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
    text = _by_name(root, "task")["Search"].find(f"{_BPMN}documentation").text
    assert text == "ServiceNow, Incident. In 2 of 2 transactions, under 1s on average."


def test_the_events_take_the_trigger_and_the_result_and_are_unnamed_without():
    anno = _two_case_anno()
    root = _written(anno)
    process = root.find(f"{_BPMN}process")
    events = [el for el in process if el.tag in (f"{_BPMN}startEvent", f"{_BPMN}endEvent")]
    assert len(events) == 2 and all(el.get("name") is None for el in events)
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


def _boxes_and_segments(root):
    shapes = {}
    for sh in root.iter(f"{_BPMNDI}BPMNShape"):
        b = sh.find(f"{_DC}Bounds")
        shapes[sh.get("bpmnElement")] = tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))
    flows = {f.get("id"): f for f in root.find(f"{_BPMN}process").findall(f"{_BPMN}sequenceFlow")}
    segments = []
    for edge in root.iter(f"{_BPMNDI}BPMNEdge"):
        pts = [(float(w.get("x")), float(w.get("y"))) for w in edge.findall(f"{_DI}waypoint")]
        flow = flows[edge.get("bpmnElement")]
        for a, b in zip(pts, pts[1:]):
            segments.append((a, b, flow.get("sourceRef"), flow.get("targetRef")))
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
    tasks = _by_name(_written(anno, context=ctx, implicit_runs=["imp"]), "task")
    assert tasks["Log it"].find(f"{_BPMN}documentation").text == "SAP."
    assert tasks["Reply"].find(f"{_BPMN}documentation") is None
    assert tasks["Check"].find(f"{_BPMN}documentation").text == "30s on average."
    # The same run, marked: the runs are counted.
    tasks = _by_name(_written(anno, context=ctx), "task")
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


def _graph(root):
    """(elements by id, flows as (id, source, target, name)) of the process."""
    process = root.find(f"{_BPMN}process")
    elements = {el.get("id"): el for el in process if el.tag != f"{_BPMN}sequenceFlow"}
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
    """Assert the model a BPMN tool reads: one start and one end event, only
    exclusive gateways, each task one flow in and one out, each gateway a
    real split or join, every node reachable from the start and able to
    reach the end, and each node listing its flows. Returns _graph(root)."""
    elements, flows = _graph(root)
    tags = [_tag(el) for el in elements.values()]
    assert tags.count("startEvent") == 1 and tags.count("endEvent") == 1, tags
    assert set(tags) <= {"startEvent", "endEvent", "task", "exclusiveGateway"}, tags
    out, inc = {}, {}
    for _fid, s, t, _name in flows:
        out.setdefault(s, []).append(t)
        inc.setdefault(t, []).append(s)
    start = next(i for i, el in elements.items() if _tag(el) == "startEvent")
    end = next(i for i, el in elements.items() if _tag(el) == "endEvent")
    assert _reach(start, out) == set(elements)
    assert _reach(end, inc) == set(elements)
    for i, el in elements.items():
        if _tag(el) == "task":
            assert len(out.get(i, [])) == 1 and len(inc.get(i, [])) == 1, el.get("name")
        elif _tag(el) == "exclusiveGateway":
            assert len(out.get(i, [])) > 1 or len(inc.get(i, [])) > 1, i
        assert sorted(x.text for x in el.findall(f"{_BPMN}incoming")) == sorted(
            f for f, _s, t, _n in flows if t == i)
        assert sorted(x.text for x in el.findall(f"{_BPMN}outgoing")) == sorted(
            f for f, s, _t, _n in flows if s == i)
    return elements, flows


def _ends(root):
    """{flow name: [(what it comes from, what it leads to)]}: past the
    gateways, each end named by its task, or "start" and "end"."""
    elements, flows = _graph(root)
    out = {s: t for _f, s, t, _n in flows}
    inc = {t: s for _f, s, t, _n in flows}

    def name(i, step):
        while _tag(elements[i]) == "exclusiveGateway":
            i = step[i]
        return {"startEvent": "start", "endEvent": "end"}.get(_tag(elements[i]),
                                                             elements[i].get("name"))
    named = {}
    for _f, s, t, n in flows:
        if n:
            named.setdefault(n, []).append((name(s, inc), name(t, out)))
    return {n: sorted(pairs) for n, pairs in named.items()}


def test_the_flow_set_on_steps_draws_a_condition_a_skip_a_loop_and_an_early_end():
    root = _written(_flow_anno())
    elements, _flows = _well_formed(root)
    assert sorted(el.get("name") for el in elements.values() if _tag(el) == "task") == sorted(
        _FLOW_STEPS)
    assert _ends(root) == {
        "the customer is new": [("Receive the order", "Check the customer")],
        "otherwise": [("Receive the order", "Book the order")],
        "the credit check fails": [("Book the order", "end")],
        "a line is missing": [("Confirm the lines", "Check the customer")],
        # The branches the transaction took, where no label was declared.
        "1 of 1 transaction": [("Book the order", "Confirm the lines"),
                               ("Confirm the lines", "Send the confirmation")],
    }


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


def _assert_readable(root):
    """No line crosses a box it does not join; every named flow has a label
    box at least as wide as bpmn-js wraps its text (90 px) that covers no
    box, no line, no other label and no event's name."""
    shapes, segments = _boxes_and_segments(root)
    _elements, flows = _graph(root)
    named = {f for f, _s, _t, n in flows if n}
    for (a, b, src, tgt) in segments:
        for nid, box in shapes.items():
            if nid not in (src, tgt):
                assert not _crosses((a, b), box), (src, tgt, nid)
    labels = _label_boxes(root)
    assert set(labels) == named
    events = _event_names(root, shapes)
    for fid, box in labels.items():
        assert box[2] >= 90 and box[3] >= 11 * 1.2, (fid, box)
        for nid, shape in shapes.items():
            assert not _overlaps(box, shape), (fid, nid)
        for (a, b, src, tgt) in segments:
            assert not _crosses((a, b), box), (fid, a, b, src, tgt)
        for other, obox in list(labels.items()) + list(events.items()):
            assert other == fid or not _overlaps(box, obox), (fid, other)


def test_the_flow_labels_sit_clear_of_every_box_line_and_other_label():
    anno = _flow_anno()
    anno["document"] = {"trigger": "An order arrives by email",
                        "result": "The customer has the confirmation"}
    root = _written(anno)
    assert len(_label_boxes(root)) == 6
    assert len(_event_names(root, _boxes_and_segments(root)[0])) == 2
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
    assert set(_ends(root)) == {"the customer is new", "otherwise",
                                "the credit check fails", "a line is missing"}


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
            "a check fails", "the order is cancelled"} <= set(_ends(root))
    _assert_readable(root)
    shapes, _segments = _boxes_and_segments(root)
    boxes = list(shapes.values()) + list(_label_boxes(root).values())
    xs = [x for (x, _y, _w, _h) in boxes] + [x + w for (x, _y, w, _h) in boxes]
    ys = [y for (_x, y, _w, _h) in boxes] + [y + h for (_x, y, _w, h) in boxes]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    assert 12 * min(684 / width, 425 / height) >= 7.0
