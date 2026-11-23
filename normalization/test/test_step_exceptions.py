"""Contract C27: the exceptions of a step (`step.exceptions`, written by the
analyst: when something happens at the step, and what is done), as the
pipeline reads and prints them: the key as step_context reads it; the PDD's
line under the step in 3.2 and in a sub-process's chapter, and its
paragraphs in 4.x Exceptions after the document's field; the Technical
details' Exceptions sheet (written for a project without a recording once it
holds a row); and the step BPMN's text annotation under the task, after its
Done by label and before its notes, on the main plane and on a sub-process's.

The PDD's cases need python-docx and the map's pm4py (the full-deps gate);
the rest is the standard library.
"""

from __future__ import annotations

import copy
import importlib.util
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export
import tech_details as TD
import xlsx_writer as XW
from step_context import EXC_THEN_MAX, EXC_WHEN_MAX, declares_exceptions, step_exceptions

_HAVE_DOCX = pdd_export.Document is not None
needs_docx = pytest.mark.skipif(not _HAVE_DOCX, reason="python-docx not installed")
needs_pm4py = pytest.mark.skipif(importlib.util.find_spec("pm4py") is None, reason="pm4py not installed")

NS = {"m": XW.MAIN_NS}
_BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
_BPMNDI = "{http://www.omg.org/spec/BPMN/20100524/DI}"
_DC = "{http://www.omg.org/spec/DD/20100524/DC}"
_DI = "{http://www.omg.org/spec/DD/20100524/DI}"

NOT_FOUND = {"when": "The customer number is not found", "then": "Search the customer by name and create it first"}
NO_STOCK = {"when": "The stock is empty."}
NO_PRICE = {"when": "The unit price is missing", "then": "Ask the product manager."}


def _ts(sec):
    return f"2026-09-01T09:{sec // 60:02d}:{sec % 60:02d}Z"


def _video():
    """A project made from a video (C16): its one implicit run; Take the call
    (two exceptions), Enter the order (a sub-process: Type the lines, with an
    exception, and Save), Note the call (none), and a hidden step with one
    that never prints."""
    steps = [
        {"step_id": "v1", "case_id": "imp", "name": "Take the call", "state": "manually_authored",
         "time_range": {"start": _ts(5), "end": _ts(20)}, "system": "SAP", "done_by": "Sales assistant",
         "exceptions": [copy.deepcopy(NOT_FOUND), copy.deepcopy(NO_STOCK)]},
        {"step_id": "v2", "case_id": "imp", "name": "Enter the order", "state": "manually_authored",
         "time_range": {"start": _ts(20), "end": _ts(40)}, "system": "SAP",
         "sub_steps": [
             {"step_id": "u1", "case_id": "imp", "name": "Type the lines", "state": "manually_authored",
              "time_range": {"start": _ts(21), "end": _ts(30)}, "system": "SAP",
              "exceptions": [copy.deepcopy(NO_PRICE)]},
             {"step_id": "u2", "case_id": "imp", "name": "Save", "state": "manually_authored",
              "time_range": {"start": _ts(31), "end": _ts(39)}, "system": "SAP"}]},
        {"step_id": "v3", "case_id": "imp", "name": "Note the call", "state": "manually_authored",
         "time_range": {"start": _ts(40), "end": _ts(50)}},
        {"step_id": "v4", "case_id": "imp", "name": "Old check", "state": "hidden",
         "time_range": {"start": _ts(50), "end": _ts(55)}, "exceptions": [{"when": "Never shown"}]},
    ]
    annotations = {"steps": steps, "external_video": {"path": "video/call.mp4", "offset_ms": 0},
                   "document": {"title": "Order call"},
                   "analyst_notes": [{"id": "n1", "text": "Ask Ana about this.", "step_id": "v1",
                                      "at": None, "added_at": _ts(0)}]}
    stats = {"case_stats": [{"case_id": "imp", "label": None, "parent_case_id": None, "start_ts": _ts(0),
                             "end_ts": None, "wall_clock_ms": None, "active_ms": None, "implicit": True}],
             "meta": {}}
    manifest = {"session_id": "sess-exc", "source": "video", "started_at": _ts(0), "label": "Order call"}
    return annotations, stats, manifest, []


def _without_exceptions(fixture):
    annotations, stats, manifest, events = copy.deepcopy(fixture)

    def strip(steps):
        for st in steps:
            st.pop("exceptions", None)
            strip(st.get("sub_steps") or [])

    strip(annotations["steps"])
    return annotations, stats, manifest, events


# ---- the key -------------------------------------------------------------------------

def test_the_key_reads_as_the_viewer_keeps_it():
    step = {"exceptions": [{"when": "  The customer\n number is not found ", "then": " Search by name "},
                           {"when": "  ", "then": "dropped"}, "text", None, {"then": "no when"},
                           {"when": "w" * 300, "then": "t" * 300}, {"when": "No then", "then": 7}]}
    got = step_exceptions(step)
    assert got[0] == {"when": "The customer number is not found", "then": "Search by name"}
    assert len(got) == 3, "an entry without a when, and anything but a mapping, is left out"
    assert (len(got[1]["when"]), len(got[1]["then"])) == (EXC_WHEN_MAX, EXC_THEN_MAX) == (120, 200)
    assert got[2] == {"when": "No then", "then": ""}
    assert step_exceptions({}) == [] and step_exceptions(None) == []
    assert step_exceptions({"exceptions": "x"}) == []
    assert declares_exceptions({"exceptions": [{"when": "X"}]})
    assert not declares_exceptions({"exceptions": [{"when": " "}]}) and not declares_exceptions({})


# ---- the PDD -------------------------------------------------------------------------

def _pdd_lines(fixture):
    """The PDD's non-empty paragraphs and table rows, in body order."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    annotations, stats, manifest, events = copy.deepcopy(fixture)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(out, session_folder=Path(tmp), annotations=annotations, stats=stats,
                             manifest=manifest, events=events)
        doc = Document(str(out))
        lines = []
        for child in doc.element.body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                text = Paragraph(child, doc).text
                if text.strip():
                    lines.append(text)
            elif tag == "tbl":
                for row in Table(child, doc).rows:
                    lines.append(" | ".join(c.text for c in row.cells))
        return lines


def _under(lines, heading, stop=("Step ", "3.", "4.", "5.")):
    i = lines.index(heading)
    out = []
    for t in lines[i + 1:]:
        if t.startswith(stop):
            break
        out.append(t)
    return out


@needs_docx
def test_the_pdd_prints_each_exception_under_its_step_after_the_information_line():
    annotations, stats, manifest, events = _video()
    annotations["steps"][0]["information"] = [{"name": "Customer number"}]
    lines = _pdd_lines((annotations, stats, manifest, events))
    under = _under(lines, "Step 1: Take the call")
    exc = ["Exception: The customer number is not found: Search the customer by name and create it first.",
           "Exception: The stock is empty."]
    assert [t for t in under if t.startswith("Exception:")] == exc
    assert under.index("Information: Customer number.") < under.index(exc[0]), "after the Information line"
    assert not any(t.startswith("Exception:") for t in _under(lines, "Step 3: Note the call"))
    # In the sub-process's chapter, under its step.
    assert "Exception: The unit price is missing: Ask the product manager." in _under(lines, "Step 2.1: Type the lines")
    assert "Never shown" not in "\n".join(lines), "a hidden step prints nothing"


@needs_docx
def test_the_exceptions_section_prints_the_field_then_one_paragraph_per_exception_in_process_order():
    annotations, stats, manifest, events = _video()
    annotations["document"]["exceptions"] = "A system outage stops the process."
    section = _under(_pdd_lines((annotations, stats, manifest, events)), "4.2 Exceptions", stop=("5.",))
    assert section == [
        "A system outage stops the process.",
        "Step 1, Take the call: when the customer number is not found, search the customer by name and create it first.",
        "Step 1, Take the call: when the stock is empty.",
        "Step 2.1, Type the lines: when the unit price is missing, ask the product manager."]


@needs_docx
def test_the_placeholder_shows_only_when_the_field_is_empty_and_no_step_has_an_exception():
    lines = _pdd_lines(_video())
    section = _under(lines, "4.2 Exceptions", stop=("5.",))
    assert not any(t.startswith("[To be completed") for t in section), "the steps' exceptions fill it"
    assert section[0] == "Step 1, Take the call: when the customer number is not found, search the customer by name and create it first."
    bare = _under(_pdd_lines(_without_exceptions(_video())), "4.2 Exceptions", stop=("5.",))
    assert len(bare) == 1 and bare[0].startswith("[To be completed: the business exceptions")
    assert not any(t.startswith("Exception:") for t in _pdd_lines(_without_exceptions(_video())))


# ---- the Technical details ----------------------------------------------------------------

def _cell(c):
    t = c.find("m:is/m:t", NS)
    if t is not None:
        return t.text or ""
    v = c.find("m:v", NS)
    return float(v.text) if v is not None else ""


def _sheet_rows(path, name):
    with zipfile.ZipFile(path) as z:
        names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS)]
        root = ET.fromstring(z.read(f"xl/worksheets/sheet{names.index(name) + 1}.xml"))
    rows = []
    for r in root.find("m:sheetData", NS):
        cells = {ord("".join(ch for ch in c.get("r") if ch.isalpha())) - 65: _cell(c) for c in r}
        rows.append([cells.get(k, "") for k in range(max(cells) + 1)] if cells else [])
    return names, rows


def _tech(tmp_path, fixture):
    annotations, stats, manifest, events = copy.deepcopy(fixture)
    out = tmp_path / "tech.xlsx"
    wrote = TD.write_tech_details(out, session_folder=tmp_path, annotations=annotations, stats=stats,
                                  manifest=manifest, events=events)
    return wrote, out


def test_the_exceptions_sheet_lists_each_exception_with_its_step(tmp_path):
    wrote, out = _tech(tmp_path, _video())
    assert wrote is True, "a project without a recording gets its workbook once a step has an exception"
    names, rows = _sheet_rows(out, "Exceptions")
    assert names.index("Exceptions") == names.index("Information") + 1
    assert rows[0] == ["Step", "When", "What is done"]
    assert rows[1:] == [
        ["Step 1: Take the call", "The customer number is not found", "Search the customer by name and create it first"],
        ["Step 1: Take the call", "The stock is empty."],
        ["Step 2.1: Type the lines", "The unit price is missing", "Ask the product manager."]]
    about = _sheet_rows(out, "About")[1]
    assert any(r[:1] == ["Exceptions"] for r in about), "the About sheet says what it lists"


def test_without_an_exception_a_project_without_a_recording_gets_no_workbook(tmp_path):
    wrote, out = _tech(tmp_path, _without_exceptions(_video()))
    assert wrote is False and not out.exists()


# ---- the step BPMN -------------------------------------------------------------------------

def _written(anno):
    from bpmn_observed import write_observed_bpmn
    from step_context import StepContext
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "process_map_step.bpmn")
        assert write_observed_bpmn(anno, out, context=StepContext({}, {}, vocabs=[])) is True
        return ET.parse(out).getroot()


def _bounds(el):
    b = el.find(f"{_DC}Bounds")
    return tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))


def _overlaps(p, q):
    return p[0] < q[0] + q[2] and q[0] < p[0] + p[2] and p[1] < q[1] + q[3] and q[1] < p[1] + p[3]


def _crosses(a, b, box):
    lo_x, hi_x, lo_y, hi_y = min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])
    x, y, w, h = box
    return lo_x < x + w and hi_x > x and lo_y < y + h and hi_y > y


def _plane_parts(root, container):
    """({id: element} of `container`, {element id: bounds}, {element id: points})."""
    by_id = {el.get("id"): el for el in container}
    shapes = {sh.get("bpmnElement"): _bounds(sh) for sh in root.iter(f"{_BPMNDI}BPMNShape")}
    edges = {e.get("bpmnElement"): [(float(w.get("x")), float(w.get("y"))) for w in e.findall(f"{_DI}waypoint")]
             for e in root.iter(f"{_BPMNDI}BPMNEdge")}
    return by_id, shapes, edges


def _assert_clear(root):
    """On each plane (the main map and each sub-process's, drawn apart): no
    two shapes overlap, and no association crosses a shape other than its
    two ends."""
    ends = {a.get("id"): (a.get("sourceRef"), a.get("targetRef")) for a in root.iter(f"{_BPMN}association")}
    planes = list(root.iter(f"{_BPMNDI}BPMNPlane"))
    assert planes
    for plane in planes:
        shapes = {sh.get("bpmnElement"): _bounds(sh) for sh in plane.findall(f"{_BPMNDI}BPMNShape")}
        ids = sorted(shapes)
        for i, p in enumerate(ids):
            for q in ids[i + 1:]:
                assert not _overlaps(shapes[p], shapes[q]), (p, q)
        for e in plane.findall(f"{_BPMNDI}BPMNEdge"):
            if e.get("bpmnElement") not in ends:
                continue
            pts = [(float(w.get("x")), float(w.get("y"))) for w in e.findall(f"{_DI}waypoint")]
            for a, b in zip(pts, pts[1:]):
                for nid, box in shapes.items():
                    if nid not in ends[e.get("bpmnElement")]:
                        assert not _crosses(a, b, box), (e.get("bpmnElement"), nid)


@needs_pm4py
def test_the_map_draws_one_annotation_under_the_task_after_done_by_and_before_the_notes():
    annotations, _stats, _manifest, _events = _video()
    annotations["steps"][2]["done_by"] = "Back office"      # two people: a Done by label under each task
    root = _written(annotations)
    process = root.find(f"{_BPMN}process")
    by_id, shapes, edges = _plane_parts(root, process)
    ann = by_id["TextAnnotation_exc_1"]
    assert ann.find(f"{_BPMN}text").text == ("Exception: The customer number is not found\n"
                                              "Exception: The stock is empty.")
    assert ann.find(f"{_BPMN}documentation").text == (
        "When The customer number is not found: Search the customer by name and create it first\n"
        "When The stock is empty.")
    assoc = by_id["Association_exc_1"]
    task = by_id[assoc.get("sourceRef")]
    assert task.get("name") == "Take the call" and assoc.get("targetRef") == "TextAnnotation_exc_1"
    assert not any(i.startswith("TextAnnotation_exc_") for i in by_id if i != "TextAnnotation_exc_1"), \
        "one annotation: the other tasks have no exception, the hidden step prints nothing"
    t, e = shapes[task.get("id")], shapes["TextAnnotation_exc_1"]
    done_by = next(by_id[a.get("targetRef")] for a in process.findall(f"{_BPMN}association")
                   if a.get("sourceRef") == task.get("id") and "doneby" in a.get("targetRef"))
    note = next(by_id[a.get("targetRef")] for a in process.findall(f"{_BPMN}association")
                if a.get("sourceRef") == task.get("id") and a.get("targetRef").startswith("TextAnnotation_")
                and a.get("targetRef")[len("TextAnnotation_"):].isdigit())
    d, n = shapes[done_by.get("id")], shapes[note.get("id")]
    assert d[1] + d[3] < e[1] < e[1] + e[3] < n[1], "under its Done by label, over its note"
    assert e[0] > t[0] and n[0] == t[0], "in from the task's left side, as the Done by label is"
    pts = edges["Association_exc_1"]
    assert pts[0][1] == t[1] + t[3] and pts[-1] == (e[0] + 10, e[1]), "from the task's bottom to the hook"
    _assert_clear(root)


@needs_pm4py
def test_a_sub_process_plane_draws_its_steps_exceptions_with_its_prefix():
    root = _written(_video()[0])
    found = [el for el in root.iter(f"{_BPMN}textAnnotation") if el.get("id").endswith("TextAnnotation_exc_1")]
    ids = sorted(el.get("id") for el in found)
    assert len(ids) == 2 and "TextAnnotation_exc_1" in ids, ids
    assert [i for i in ids if i != "TextAnnotation_exc_1"][0].startswith("Sub"), "the plane's prefix"
    sub = next(el for el in found if el.get("id") != "TextAnnotation_exc_1")
    prefix = sub.get("id")[: -len("TextAnnotation_exc_1")]
    assert sub.find(f"{_BPMN}text").text == "Exception: The unit price is missing"
    assert sub.find(f"{_BPMN}documentation").text == "When The unit price is missing: Ask the product manager."
    assoc = next(a for a in root.iter(f"{_BPMN}association") if a.get("id") == prefix + "Association_exc_1")
    holder = next(el for el in root.iter() if el.get("id") == assoc.get("sourceRef"))
    assert holder.get("name") == "Type the lines"
    shapes = {sh.get("bpmnElement") for sh in root.iter(f"{_BPMNDI}BPMNShape")}
    assert sub.get("id") in shapes
    _assert_clear(root)


@needs_pm4py
def test_a_map_without_exceptions_has_no_such_annotation():
    root = _written(_without_exceptions(_video())[0])
    assert not [el for el in root.iter(f"{_BPMN}textAnnotation") if "_exc_" in el.get("id")]

def test_a_draft_with_an_exception_is_kept_as_edited_by_a_re_analysis():
    # As a draft with information (C26): the pipeline never drops the analyst's
    # words, and never rewrites the key.
    from step_suggest import _merge_steps
    line = [{"when": "The stock is empty", "then": "Order from the supplier"}]
    drafts = [{"step_id": f"d{k}", "case_id": "c1", "name": "Save", "state": "auto_suggested",
               "time_range": {"start": f"2026-09-01T09:00:0{k}Z", "end": f"2026-09-01T09:00:0{k}Z"},
               "evidence": {"interaction_event_ids": []}, **extra}
              for k, extra in enumerate(({"exceptions": copy.deepcopy(line)}, {}))]
    kept = _merge_steps(drafts, [])
    assert [(s["step_id"], s["state"]) for s in kept] == [("d0", "edited")]
    assert kept[0]["exceptions"] == line
