"""The step BPMN's sub-processes (contract C19): every map of
sub_process_maps.map_tree is a plane of the one process_map_step.bpmn.

A sub-process node is a collapsed bpmn:subProcess in its parent's map, in
place of the task, named and documented like a task; it holds its own map,
drawn in a BPMNDiagram of its own whose plane's bpmnElement is the
sub-process. Ids inside a sub-plane carry a prefix unique in the file; the
main plane keeps its ids. A sub-process's start and main end are unnamed,
its early ends named from their `when`; notes, attachments and colours as
C18 on every plane, each plane with its own legend, a system keeping one
colour across the file; counts over the transactions that ran the
sub-process; a sub-process with no steps is a start joined to an end.

Run with: pytest normalization/test/test_bpmn_sub_processes.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

pytest.importorskip("pm4py")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bpmn_observed import write_observed_bpmn  # noqa: E402
from step_context import StepContext  # noqa: E402

_BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
_BPMNDI = "{http://www.omg.org/spec/BPMN/20100524/DI}"
_DC = "{http://www.omg.org/spec/DD/20100524/DC}"
_DI = "{http://www.omg.org/spec/DD/20100524/DI}"
_BIOC = "{http://bpmn.io/schema/bpmn/biocolor/1.0}"
_TASKS = ("task", "userTask", "manualTask", "subProcess")
_NOT_NODES = ("sequenceFlow", "dataObject", "dataObjectReference", "textAnnotation",
              "association")


def _ts(sec):
    return f"2026-09-24T09:{sec // 60:02d}:{sec % 60:02d}Z"


def _step(sid, case, name, sec, **extra):
    step = {"step_id": sid, "case_id": case, "name": name, "state": "confirmed",
            "time_range": {"start": _ts(sec), "end": _ts(sec + 4)},
            "evidence": {"interaction_event_ids": [sid], "screenshot_refs": []}}
    step.update(extra)
    return step


def _drafted(sid, case, name, sec, **extra):
    """A drafted sub-step (C19): its action_key, name_source "action", a draft."""
    return _step(sid, case, name, sec, state="auto_suggested", name_source="action",
                 action_key=f"crm|Orders|click:{name}", **extra)


def _check(case, base, nested=False):
    """The sub-steps of Check the order in one visit: Enter customer and
    Click Save in the CRM; with `nested`, Look up price between them, a
    sub-process of its own (Open the list, Read the price, which goes back
    to Open the list when the item is missing), and the flow: Enter customer
    ends the sub-process when the customer is blocked."""
    subs = [_drafted(f"{case}{base}-c1", case, "Enter customer", base + 1, system="CRM")]
    if nested:
        subs[0]["links"] = [{"to": "end", "when": "the customer is blocked"}]
        subs.append(_drafted(f"{case}{base}-c2", case, "Look up price", base + 2,
                             system="Price list", sub_steps=[
                                 _drafted(f"{case}{base}-p1", case, "Open the list", base + 3,
                                          system="Price list"),
                                 _drafted(f"{case}{base}-p2", case, "Read the price", base + 4,
                                          system="Price list",
                                          links=[{"to": f"{case}{base}-p1",
                                                  "when": "the item is missing"}])]))
    subs.append(_drafted(f"{case}{base}-c3", case, "Click Save", base + 5, system="CRM"))
    return subs


def _anno():
    """Transaction A (the reference): Receive the order (Outlook), Check the
    order (a sub-process with a nested one and the flow above), Send the
    confirmation (Outlook). Transaction B: the same, Check the order without
    the nested sub-process. A note on A's Click Save, a file on A's Open the
    list and one on A's Receive the order."""
    steps = []
    for case, base in (("A", 0), ("B", 600)):
        steps += [_step(f"{case}-r", case, "Receive the order", base + 1, system="Outlook"),
                  _step(f"{case}-c", case, "Check the order", base + 10, system="CRM",
                        sub_steps=_check(case, base + 10, nested=case == "A")),
                  _step(f"{case}-s", case, "Send the confirmation", base + 40, system="Outlook")]
    return {"steps": steps, "pattern_run": {"case_id": "A"},
            "document": {"trigger": "An order arrives", "result": "The order is confirmed"},
            "analyst_notes": [{"id": "n1", "text": "Save twice when the CRM is slow.",
                               "step_id": "A10-c3", "at": None, "added_at": _ts(0)}],
            "attachments": [{"id": "att1", "file": "prices.xlsx", "label": "Price list",
                             "step_id": "A10-p1", "added_at": _ts(0)},
                            {"id": "att2", "file": "order.msg", "label": "Order email",
                             "step_id": "A-r", "added_at": _ts(0)}]}


def _written(anno):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out, context=StepContext({}, {}, vocabs=[])) is True
        return ET.parse(out).getroot()


def _tag(el):
    return el.tag.split("}", 1)[-1]


def _main(root):
    return root.find(f"{_BPMN}process")


def _child(container, name, tag="subProcess"):
    """The element of `container` with this tag and name (exactly one)."""
    found = [el for el in container if _tag(el) == tag and el.get("name") == name]
    assert len(found) == 1, (tag, name, [(_tag(el), el.get("name")) for el in container])
    return found[0]


def _planes(root):
    """{bpmnElement: BPMNPlane} of every diagram of the file."""
    out = {}
    for diagram in root.findall(f"{_BPMNDI}BPMNDiagram"):
        plane = diagram.find(f"{_BPMNDI}BPMNPlane")
        assert plane.get("bpmnElement") not in out
        out[plane.get("bpmnElement")] = plane
    return out


def _drawn(plane):
    return {el.get("bpmnElement") for el in plane}


def _members(container):
    """The ids a container's plane must draw: its flow elements (the data
    objects aside) and artifacts, and the data input associations of its
    activities."""
    ids = set()
    for el in container:
        if _tag(el) in ("documentation", "incoming", "outgoing", "property",
                        "dataInputAssociation", "dataObject"):
            continue
        ids.add(el.get("id"))
        for dia in el.findall(f"{_BPMN}dataInputAssociation"):
            ids.add(dia.get("id"))
    return ids


def _text(el, child="text"):
    found = el.find(f"{_BPMN}{child}")
    return found.text if found is not None else None


def test_a_sub_process_is_a_collapsed_sub_process_holding_its_map_in_a_plane_of_its_own():
    root = _written(_anno())
    main = _main(root)
    assert not [el for el in main if _tag(el) != "subProcess" and el.get("name") == "Check the order"]
    check = _child(main, "Check the order")
    # Named by its node and documented like a task.
    assert _text(check, "documentation") == "CRM. In 2 of 2 transactions, 4s on average."
    planes = _planes(root)
    main_plane = planes["Process_1"]
    shape = next(sh for sh in main_plane if sh.get("bpmnElement") == check.get("id"))
    assert shape.get("isExpanded") == "false"
    bounds = shape.find(f"{_DC}Bounds")
    assert (bounds.get("width"), bounds.get("height")) == ("120", "72")      # task sized
    assert shape.get(f"{_BIOC}fill") is not None
    # Its map is drawn in a diagram of its own, whose plane is the sub-process,
    # and the main plane draws none of it.
    assert _drawn(planes[check.get("id")]) == _members(check)
    assert not _drawn(main_plane) & _members(check)
    assert _drawn(main_plane) == _members(main)
    # A sub-process of it, at the next depth, the same way.
    price = _child(check, "Look up price")
    assert _drawn(planes[price.get("id")]) == _members(price)
    assert len(planes) == 3


def test_ids_inside_a_sub_plane_carry_a_prefix_and_every_id_is_unique():
    root = _written(_anno())
    ids = [el.get("id") for el in root.iter() if el.get("id") is not None]
    assert len(ids) == len(set(ids))
    main = _main(root)
    check = _child(main, "Check the order")
    price = _child(check, "Look up price")
    # The main plane keeps today's ids; the sub-process's own id is one of them.
    assert check.get("id").startswith("node_")
    inside = [el.get("id") for el in check.iter() if el.get("id") and el is not check]
    assert inside and all(i.startswith("Sub1_") for i in inside if not i.startswith("Sub2_"))
    deeper = [el.get("id") for el in price.iter() if el.get("id") and el is not price]
    assert deeper and all(i.startswith("Sub2_") for i in deeper)
    planes = {p.get("bpmnElement"): p for p in root.iter(f"{_BPMNDI}BPMNPlane")}
    assert planes[check.get("id")].get("id") == "Sub1_BPMNPlane_1"
    assert planes[price.get("id")].get("id") == "Sub2_BPMNPlane_1"
    # The file's references all resolve.
    by_id = set(ids)
    for el in root.iter():
        for key in ("sourceRef", "targetRef", "bpmnElement", "dataObjectRef"):
            if el.get(key) is not None:
                assert el.get(key) in by_id, (key, el.get(key))
        if _tag(el) in ("incoming", "outgoing", "sourceRef", "targetRef") and el.text:
            assert el.text in by_id, el.text


def test_a_sub_processs_start_and_end_are_unnamed_and_its_early_ends_are_named():
    check = _child(_main(_written(_anno())), "Check the order")
    starts = [el.get("name") for el in check if _tag(el) == "startEvent"]
    ends = sorted((el.get("name") or "") for el in check if _tag(el) == "endEvent")
    assert starts == [None]
    assert ends == ["", "the customer is blocked"]
    # The main map keeps its Trigger and Result.
    main = _main(_written(_anno()))
    assert [el.get("name") for el in main if _tag(el) == "startEvent"] == ["An order arrives"]
    assert [el.get("name") for el in main if _tag(el) == "endEvent"] == ["The order is confirmed"]


def test_the_flow_set_inside_a_sub_process_stays_on_its_plane():
    root = _written(_anno())
    check = _child(_main(root), "Check the order")
    price = _child(check, "Look up price")
    names = {f.get("name") for f in price.findall(f"{_BPMN}sequenceFlow") if f.get("name")}
    assert "the item is missing" in names
    assert any(_tag(el) == "exclusiveGateway" for el in price)
    # Nothing of it reaches the main process.
    assert not any(f.get("name") == "the item is missing"
                   for f in _main(root).findall(f"{_BPMN}sequenceFlow"))


def test_the_counts_of_a_sub_process_are_over_the_transactions_that_ran_it():
    """Transaction A visits Check the order twice, B once and C never opens
    it: its map counts A and B, each once, whatever the visits."""
    anno = {"steps": [], "pattern_run": {"case_id": "A"}}
    for case, base in (("A", 0), ("B", 600), ("C", 1200)):
        anno["steps"] += [_step(f"{case}-r", case, "Receive the order", base + 1),
                          _step(f"{case}-c", case, "Check the order", base + 10,
                                sub_steps=_check(case, base + 10)),
                          _step(f"{case}-s", case, "Send the confirmation", base + 40)]
    anno["steps"][-2].pop("sub_steps")                       # C did not open it
    anno["steps"].append(_step("A-c2", "A", "Check the order", 50,
                               sub_steps=[_drafted("A50-c3", "A", "Click Save", 51)]))
    root = _written(anno)
    check = _child(_main(root), "Check the order")
    tasks = {el.get("name"): el for el in check if _tag(el) in _TASKS}
    said = "CRM. In 2 of 2 transactions, 4s on average."
    assert _text(tasks["Click Save"], "documentation") == said
    assert _text(tasks["Enter customer"], "documentation") == said
    # The branch around Enter customer: A's second visit took it; A and B
    # took the other. Counted in transactions, out of the two that ran it.
    flows = {f.get("name") for f in check.iter(f"{_BPMN}sequenceFlow") if f.get("name")}
    assert flows <= {"1 of 2 transactions", "2 of 2 transactions"} and flows


def test_each_plane_has_its_legend_and_a_system_keeps_its_colour_across_the_file():
    root = _written(_anno())
    main = _main(root)
    check = _child(main, "Check the order")
    price = _child(check, "Look up price")

    def legend(container):
        found = [el for el in container if _tag(el) == "textAnnotation"
                 and el.get("id").endswith("TextAnnotation_legend")]
        assert len(found) == 1
        return _text(found[0])
    assert legend(main) == "Colour by system\nOutlook: blue\nCRM: orange"
    assert legend(check) == "Colour by system\nCRM: orange\nPrice list: green"
    assert legend(price) == "Colour by system\nPrice list: green"
    fills: dict[str, set] = {}
    by_id = {el.get("id"): el for el in root.iter() if el.get("id")}
    for shape in root.iter(f"{_BPMNDI}BPMNShape"):
        el = by_id[shape.get("bpmnElement")]
        if _tag(el) in _TASKS and shape.get(f"{_BIOC}fill"):
            fills.setdefault(shape.get(f"{_BIOC}fill"), set()).add(el.get("name"))
    assert fills == {"#bfdbfe": {"Receive the order", "Send the confirmation"},
                     "#fed7aa": {"Check the order", "Enter customer", "Click Save"},
                     "#bbf7d0": {"Look up price", "Open the list", "Read the price"}}


def test_notes_and_files_on_sub_steps_are_drawn_on_their_plane():
    root = _written(_anno())
    main = _main(root)
    check = _child(main, "Check the order")
    price = _child(check, "Look up price")
    notes = [el for el in check if _tag(el) == "textAnnotation"
             and not el.get("id").endswith("legend")]
    assert [_text(n) for n in notes] == ["Save twice when the CRM is slow."]
    assoc = [el for el in check if _tag(el) == "association"]
    tasks = {el.get("id"): el.get("name") for el in check if _tag(el) in _TASKS}
    assert [(tasks[a.get("sourceRef")], a.get("targetRef")) for a in assoc] == [
        ("Click Save", notes[0].get("id"))]
    refs = [el for el in price if _tag(el) == "dataObjectReference"]
    assert [(r.get("id"), r.get("name"), _text(r, "documentation")) for r in refs] == [
        ("Sub2_DataObjectReference_att1", "Price list", "attachments/prices.xlsx")]
    holder = _child(price, "Open the list", "task")
    assert [d.find(f"{_BPMN}sourceRef").text
            for d in holder.findall(f"{_BPMN}dataInputAssociation")] == [refs[0].get("id")]
    # The file on the main level stays as C18 names it.
    assert [el.get("id") for el in main if _tag(el) == "dataObjectReference"] == [
        "DataObjectReference_att2"]
    # Drafted sub-steps are recorded work, done in a system: plain tasks.
    assert {_tag(el) for el in check if _tag(el) in _TASKS} == {"task", "subProcess"}


def test_a_sub_step_done_outside_the_systems_is_a_manual_task_on_its_plane():
    """C18 as lane CL amended it, on every plane: a sub-step added by hand
    with no system is a manual task, and its plane's legend ends saying what
    the hand means; the main plane, which has none, does not."""
    anno = _anno()
    check_a = next(s for s in anno["steps"] if s["step_id"] == "A-c")
    check_a["sub_steps"].append({"step_id": "A-hand", "case_id": "A", "name": "Phone the warehouse",
                                 "state": "manually_authored", "time_range": None, "order": 1,
                                 "evidence": {"interaction_event_ids": [], "screenshot_refs": []}})
    root = _written(anno)
    main = _main(root)
    check = _child(main, "Check the order")
    kinds = {el.get("name"): _tag(el) for el in check if _tag(el) in _TASKS}
    assert kinds == {"Enter customer": "task", "Look up price": "subProcess", "Click Save": "task",
                     "Phone the warehouse": "manualTask"}

    def legend(container):
        found = [el for el in container if _tag(el) == "textAnnotation"
                 and el.get("id").endswith("TextAnnotation_legend")]
        assert len(found) == 1
        return _text(found[0])
    assert legend(check) == "Colour by system\nCRM: orange\nPrice list: green\nHand icon: done outside the systems"
    assert legend(main) == "Colour by system\nOutlook: blue\nCRM: orange"


def test_a_sub_process_without_steps_is_a_start_joined_to_an_end():
    anno = {"steps": [_step("r", "A", "Receive the order", 1),
                      _step("c", "A", "Call the customer", 10, state="edited", sub_steps=[]),
                      _step("s", "A", "Send the confirmation", 20)]}
    root = _written(anno)
    call = _child(_main(root), "Call the customer")
    kinds = sorted(_tag(el) for el in call if _tag(el) not in (
        "documentation", "incoming", "outgoing"))
    assert kinds == ["endEvent", "sequenceFlow", "startEvent"]
    flow = call.find(f"{_BPMN}sequenceFlow")
    start = next(el for el in call if _tag(el) == "startEvent")
    end = next(el for el in call if _tag(el) == "endEvent")
    assert (flow.get("sourceRef"), flow.get("targetRef")) == (start.get("id"), end.get("id"))
    assert start.get("name") is None and end.get("name") is None
    assert _drawn(_planes(root)[call.get("id")]) == _members(call)


def test_a_step_on_several_tasks_holds_its_map_on_the_first():
    """One transaction comes back to Check the order: the chain draws two
    collapsed sub-processes with that name; the first holds the map (drawn
    from both visits), the second nothing."""
    anno = {"steps": [_step("r", "A", "Receive the order", 1),
                      _step("c1", "A", "Check the order", 10, sub_steps=_check("A", 10)),
                      _step("x", "A", "Ask the customer", 30),
                      _step("c2", "A", "Check the order", 40, sub_steps=_check("A", 40))]}
    root = _written(anno)
    subs = [el for el in _main(root) if _tag(el) == "subProcess"]
    assert [el.get("name") for el in subs] == ["Check the order", "Check the order"]
    holding = [el for el in subs if el.find(f"{_BPMN}startEvent") is not None]
    assert len(holding) == 1
    planes = _planes(root)
    assert set(planes) == {"Process_1", holding[0].get("id")}
    for el in subs:
        shape = next(sh for sh in planes["Process_1"] if sh.get("bpmnElement") == el.get("id"))
        assert shape.get("isExpanded") == "false"
    # Two visits, one transaction: a trace each, so the miner draws them.
    tasks = {el.get("name") for el in holding[0] if _tag(el) in _TASKS}
    assert tasks == {"Enter customer", "Click Save"}


def test_a_drafted_sub_step_is_named_by_its_name_on_its_plane():
    """C19: a drafted sub-step (action_key) is its name on the map, as a
    drafted step is, where the shared value rules would cut it."""
    name = "Enter Ship to - Street"
    anno = {"steps": [_step("c", "A", "Check the order", 10, sub_steps=[
        _drafted("d1", "A", name, 11), _drafted("d2", "A", "Click Save", 12)])]}
    check = _child(_main(_written(anno)), "Check the order")
    assert sorted(el.get("name") for el in check if _tag(el) in _TASKS) == [
        "Click Save", name]


def _plane_boxes(root, plane):
    """(shapes {element id: box}, segments [(a, b, source, target)]) of one plane."""
    by_id = {el.get("id"): el for el in root.iter() if el.get("id")}
    shapes, segments = {}, []
    for el in plane:
        b = el.find(f"{_DC}Bounds")
        if _tag(el) == "BPMNShape":
            shapes[el.get("bpmnElement")] = tuple(float(b.get(k)) for k in
                                                  ("x", "y", "width", "height"))
    for el in plane:
        if _tag(el) != "BPMNEdge":
            continue
        pts = [(float(w.get("x")), float(w.get("y"))) for w in el.findall(f"{_DI}waypoint")]
        conn = by_id[el.get("bpmnElement")]
        if _tag(conn) == "dataInputAssociation":
            source = conn.find(f"{_BPMN}sourceRef").text
            target = next(p.get("id") for p in root.iter()
                          if conn in list(p))
        else:
            source, target = conn.get("sourceRef"), conn.get("targetRef")
        segments += [(a, b, source, target) for a, b in zip(pts, pts[1:])]
    return shapes, segments


def _crosses(seg, box):
    (x1, y1), (x2, y2) = seg
    bx, by, bw, bh = box
    return (min(x1, x2) < bx + bw and max(x1, x2) > bx
            and min(y1, y2) < by + bh and max(y1, y2) > by)


def test_every_plane_is_laid_out_on_its_own_without_a_line_through_a_box():
    root = _written(_anno())
    for plane in root.iter(f"{_BPMNDI}BPMNPlane"):
        shapes, segments = _plane_boxes(root, plane)
        assert shapes
        for a, b, source, target in segments:
            for nid, box in shapes.items():
                if nid not in (source, target):
                    assert not _crosses((a, b), box), (plane.get("id"), source, target, nid)
        ids = sorted(shapes)
        for i, p in enumerate(ids):
            for q in ids[i + 1:]:
                pb, qb = shapes[p], shapes[q]
                assert not (pb[0] < qb[0] + qb[2] and qb[0] < pb[0] + pb[2]
                            and pb[1] < qb[1] + qb[3] and qb[1] < pb[1] + pb[3]), (p, q)


def test_without_a_sub_process_the_file_has_one_plane():
    anno = _anno()
    for s in anno["steps"]:
        s.pop("sub_steps", None)
    root = _written(anno)
    assert len(root.findall(f"{_BPMNDI}BPMNDiagram")) == 1
    assert not list(root.iter(f"{_BPMN}subProcess"))
    assert not any(sh.get("isExpanded") for sh in root.iter(f"{_BPMNDI}BPMNShape"))


def test_a_hidden_sub_process_has_no_plane_and_hidden_sub_steps_are_not_drawn():
    anno = _anno()
    for s in anno["steps"]:
        if s["step_id"] == "A-c":
            s["sub_steps"][1]["state"] = "hidden"               # Look up price
        if s["step_id"] == "B-c":
            s["state"] = "hidden"
    root = _written(anno)
    check = _child(_main(root), "Check the order")
    assert {el.get("name") for el in check if _tag(el) in _TASKS} == {"Enter customer",
                                                                      "Click Save"}
    assert len(_planes(root)) == 2
    assert _text(check, "documentation").startswith("CRM. In 1 of 2 transactions")
