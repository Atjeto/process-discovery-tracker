"""Tests for observed-flow step BPMN (bpmn_observed).

Run with: pytest normalization/test/test_bpmn_observed.py
"""

from __future__ import annotations

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
