"""Contract C26: the information a step uses or enters (`step.information`,
typed by the analyst, plus the fields recorded in a recorded step), as the
pipeline reads and prints it: the key as step_context reads it, a draft given
a line kept as the analyst's by the next analysis, the PDD's names (section 5
under each system, one "Information:" line under a step in 3.2, never an
example) and the Technical details' Information sheet (with the examples),
written for a project without a recording once it holds a row.

The four cases of the brief: a recording with recorded fields only, a
project made from a video with typed information only, both on one step, and
a step with no system. The PDD's cases need python-docx (the full-deps
gate); the rest is the standard library.
"""

from __future__ import annotations

import copy
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export
import tech_details as TD
import xlsx_writer as XW
from step_context import INFO_NAME_MAX, INFO_TEXT_MAX, declares_information, step_information

_HAVE_DOCX = pdd_export.Document is not None
needs_docx = pytest.mark.skipif(not _HAVE_DOCX, reason="python-docx not installed")

T0 = datetime(2026, 9, 1, 9, 0, 0, tzinfo=timezone.utc)
R1 = "run-1"
CRM = "Contoso CRM - Customers"
SAP = "SAP - Create Sales Order (VA01)"
NS = {"m": XW.MAIN_NS}


def _ts(sec):
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _inter(eid, sec, proc, title, kind, name, control_type="Edit", **data):
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "data": {"kind": kind, "process_name": proc, "window_title": title,
                     "name": name, "control_type": control_type, **data}}


def _step(sid, name, sec, eids, **extra):
    step = {"step_id": sid, "case_id": R1, "name": name, "state": "confirmed",
            "time_range": {"start": _ts(sec), "end": _ts(sec + 3)},
            "evidence": {"interaction_event_ids": eids, "screenshot_refs": []}}
    step.update(extra)
    return step


def _recording(typed=True):
    """(annotations, stats, manifest, events): one marked transaction. Step 1
    finds the customer in the CRM (a field recorded); step 2 enters the order
    in SAP (two fields recorded and, with `typed`, two lines typed, one of
    them the name of a recorded field in other letters); step 3, phoning the
    customer, was added by hand with no system (with `typed`, one line)."""
    events = [
        _inter("e1", 1, "crm.exe", CRM, "value_changed", "Customer number", value="10482"),
        _inter("e2", 2, "crm.exe", CRM, "invoked", "Find", "Button"),
        _inter("e3", 10, "saplogon.exe", SAP, "value_changed", "Material", value="M-100"),
        _inter("e4", 11, "saplogon.exe", SAP, "value_changed", "Quantity", value="3"),
        _inter("e5", 12, "saplogon.exe", SAP, "value_changed", "Material", value="M-200"),
        _inter("e6", 13, "saplogon.exe", SAP, "invoked", "Save", "Button"),
    ]
    steps = [
        _step("s1", "Find the customer", 1, ["e1", "e2"]),
        _step("s2", "Enter the order", 10, ["e3", "e4", "e5", "e6"]),
        {"step_id": "s3", "case_id": R1, "name": "Phone the customer", "state": "manually_authored",
         "time_range": None, "order": 1, "evidence": {"interaction_event_ids": [], "screenshot_refs": []}},
    ]
    if typed:
        steps[1]["information"] = [
            {"name": "Order lines", "example": "2 lines", "goes_to": "SAP, Items: Material"},
            {"name": "material", "example": "M-999"}]
        steps[2]["information"] = [{"name": "Phone number", "example": "+385 1 2345", "goes_to": "Phone"}]
    annotations = {"steps": steps, "pattern_run": {"case_id": R1, "confirmed_at": _ts(200)},
                   "document": {"title": "Order entry"}}
    stats = {"case_stats": [{"case_id": R1, "label": "Order 1", "parent_case_id": None, "start_ts": _ts(0),
                             "end_ts": _ts(50), "wall_clock_ms": 50000, "active_ms": 40000}],
             "meta": {"app_names": {"crm.exe": "Contoso CRM", "saplogon.exe": "SAP"}}}
    manifest = {"session_id": "sess-info", "started_at": _ts(0)}
    return annotations, stats, manifest, events


def _video():
    """A project made from a video (C16): its one implicit run, three steps
    added by hand (two in SAP, one with no system), lines typed on two of
    them, nothing recorded."""
    steps = [
        {"step_id": "v1", "case_id": "imp", "name": "Take the call", "state": "manually_authored",
         "time_range": {"start": _ts(5), "end": _ts(20)}, "system": "SAP",
         "information": [{"name": "Customer number", "example": "10482", "goes_to": "SAP, Sold-to party"},
                         {"name": "Order lines", "example": "2"}]},
        {"step_id": "v2", "case_id": "imp", "name": "Enter the order", "state": "manually_authored",
         "time_range": {"start": _ts(20), "end": _ts(40)}, "system": "SAP"},
        {"step_id": "v3", "case_id": "imp", "name": "Note the call", "state": "manually_authored",
         "time_range": {"start": _ts(40), "end": _ts(50)},
         "information": [{"name": "Call reason", "goes_to": "the notes"}]},
    ]
    annotations = {"steps": steps, "external_video": {"path": "video/call.mp4", "offset_ms": 0},
                   "document": {"title": "Order call"}}
    stats = {"case_stats": [{"case_id": "imp", "label": None, "parent_case_id": None, "start_ts": _ts(0),
                             "end_ts": None, "wall_clock_ms": None, "active_ms": None, "implicit": True}],
             "meta": {}}
    manifest = {"session_id": "sess-video", "source": "video", "started_at": _ts(0), "label": "Order call"}
    return annotations, stats, manifest, []


# ---- reading the documents -----------------------------------------------------

def _pdd_blocks(fixture):
    """(kind, text) of the PDD in body order: a heading's style, "p" for a
    paragraph, "t" for a table row (cells joined " | ")."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    annotations, stats, manifest, events = copy.deepcopy(fixture)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(out, session_folder=Path(tmp), annotations=annotations, stats=stats,
                             manifest=manifest, events=events)
        doc = Document(str(out))
        blocks = []
        for child in doc.element.body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                p = Paragraph(child, doc)
                if p.text.strip():
                    style = p.style.name if p.style is not None else ""
                    blocks.append((style if style.startswith("Heading") or style == "Title" else "p", p.text))
            elif tag == "tbl":
                for row in Table(child, doc).rows:
                    blocks.append(("t", " | ".join(c.text for c in row.cells)))
        return blocks


def _section(blocks, heading):
    start = next(i for i, (k, t) in enumerate(blocks) if t == heading and k != "p")
    out = []
    for k, t in blocks[start + 1:]:
        if k in ("Heading 1", "Heading 2") and t[:1].isdigit():
            break
        out.append(t)
    return out


def _after(lines, heading):
    """The lines under a step's heading in 3.2, up to the next step's."""
    i = lines.index(heading)
    out = []
    for t in lines[i + 1:]:
        if t.startswith("Step "):
            break
        out.append(t)
    return out


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
        # An empty cell is not written: place each by its column letter.
        cells = {ord("".join(ch for ch in c.get("r") if ch.isalpha())) - 65: _cell(c) for c in r}
        rows.append([cells.get(k, "") for k in range(max(cells) + 1)] if cells else [])
    return names, rows


def _tech(tmp_path, fixture):
    annotations, stats, manifest, events = copy.deepcopy(fixture)
    out = tmp_path / "tech.xlsx"
    wrote = TD.write_tech_details(out, session_folder=tmp_path, annotations=annotations, stats=stats,
                                  manifest=manifest, events=events)
    return wrote, out


# ---- the key ---------------------------------------------------------------------

def test_the_key_reads_as_the_viewer_keeps_it():
    step = {"information": [{"name": "  Customer\n number ", "example": " 10482 ", "goes_to": 7},
                            {"name": "  "}, "text", None, {"example": "no name"},
                            {"name": "n" * 200, "example": "e" * 200, "goes_to": "g" * 200}]}
    got = step_information(step)
    assert got[0] == {"name": "Customer number", "example": "10482", "goes_to": ""}
    assert len(got) == 2, "a line without a name, and anything but a mapping, is left out"
    assert (len(got[1]["name"]), len(got[1]["example"]), len(got[1]["goes_to"])) == (
        INFO_NAME_MAX, INFO_TEXT_MAX, INFO_TEXT_MAX) == (80, 120, 120)
    assert step_information({}) == [] and step_information(None) == []
    assert step_information({"information": "x"}) == []


def test_a_draft_given_a_line_is_the_analysts_and_the_key_survives_the_analysis_untouched():
    from step_suggest import _merge_steps
    assert declares_information({"information": [{"name": "Customer number"}]})
    assert not declares_information({"information": [{"name": " "}]}) and not declares_information({})
    line = [{"name": "Customer number", "example": "10482", "goes_to": "SAP", "extra": "kept"}]
    drafts = [{"step_id": f"d{k}", "case_id": "c1", "name": "Save", "state": "auto_suggested",
               "time_range": {"start": f"2026-09-01T09:00:0{k}Z", "end": f"2026-09-01T09:00:0{k}Z"},
               "evidence": {"interaction_event_ids": []}, **extra}
              for k, extra in enumerate(({"information": copy.deepcopy(line)}, {}))]
    kept = _merge_steps(drafts, [])
    assert [(s["step_id"], s["state"]) for s in kept] == [("d0", "edited")]
    assert kept[0]["information"] == line, "the pipeline never rewrites the key"


# ---- the PDD -------------------------------------------------------------------------

@needs_docx
def test_a_recording_with_recorded_fields_only_names_them_and_no_value():
    blocks = _pdd_blocks(_recording(typed=False))
    steps = _section(blocks, "3.2 Process steps")
    assert "Information: Customer number." in _after(steps, "Step 1: Find the customer")
    assert "Information: Material, Quantity." in _after(steps, "Step 2: Enter the order")
    assert not any(t.startswith("Information:") for t in _after(steps, "Step 3: Phone the customer"))
    assert not any(t.startswith("Fields:") for _k, t in blocks), "the line is Information now"
    five = _section(blocks, "5. Systems and information used")
    assert five[0] == "System | Information entered"
    assert "Contoso CRM | Customer number" in five and "SAP | Material, Quantity" in five
    assert five[-1] == "Not in a system | none", "the step with no system, nothing entered"
    text = "\n".join(t for _k, t in blocks)
    for value in ("10482", "M-100", "M-200"):
        assert value not in text


@needs_docx
def test_a_video_project_with_typed_information_only_names_it_under_its_systems():
    blocks = _pdd_blocks(_video())
    steps = _section(blocks, "3.2 Process steps")
    assert "Information: Customer number, Order lines." in _after(steps, "Step 1: Take the call")
    assert not any(t.startswith("Information:") for t in _after(steps, "Step 2: Enter the order"))
    assert "Information: Call reason." in _after(steps, "Step 3: Note the call")
    assert _section(blocks, "5. Systems and information used") == [
        "System | Information entered", "SAP | Customer number, Order lines",
        "Not in a system | Call reason"]
    text = "\n".join(t for _k, t in blocks)
    for example in ("10482", "Sold-to party", "the notes"):
        assert example not in text, "no example and no Where it goes in the PDD"


@needs_docx
def test_both_on_one_step_name_the_recorded_then_the_typed_once_each_and_a_step_with_no_system():
    blocks = _pdd_blocks(_recording(typed=True))
    steps = _section(blocks, "3.2 Process steps")
    # "material", typed, is the recorded field Material: said once.
    assert "Information: Material, Quantity, Order lines." in _after(steps, "Step 2: Enter the order")
    assert "Information: Phone number." in _after(steps, "Step 3: Phone the customer")
    five = _section(blocks, "5. Systems and information used")
    assert "SAP | Material, Quantity, Order lines" in five
    assert five[-1] == "Not in a system | Phone number"
    text = "\n".join(t for _k, t in blocks)
    for example in ("2 lines", "M-999", "+385", "SAP, Items"):
        assert example not in text


@needs_docx
def test_a_video_project_without_typed_information_still_names_its_steps():
    """The control: no line typed, section 5 reads as before C26."""
    annotations, stats, manifest, events = _video()
    for st in annotations["steps"]:
        st.pop("information", None)
    blocks = _pdd_blocks((annotations, stats, manifest, events))
    assert _section(blocks, "5. Systems and information used") == [
        "System | Steps", "SAP | Take the call, Enter the order", "Not in a system | Note the call"]
    assert not any(t.startswith("Information:") for _k, t in blocks)


# ---- the Technical details --------------------------------------------------------------

def test_the_information_sheet_of_a_recording_lists_the_recorded_fields_with_their_examples(tmp_path):
    wrote, out = _tech(tmp_path, _recording(typed=False))
    assert wrote is True
    names, rows = _sheet_rows(out, "Information")
    assert names == ["About", "Steps and controls", "Information", "Data fields", "Re-keyed values",
                     "Applications"]
    assert rows[0] == ["Step", "Information", "Example", "Where it goes", "From"]
    assert [r[:3] + [r[4]] for r in rows[1:]] == [
        ["Step 1: Find the customer", "Customer number", "10482", "Recorded"],
        ["Step 2: Enter the order", "Material", "M-100", "Recorded"],
        ["Step 2: Enter the order", "Quantity", "3", "Recorded"]], "a field once, its first value"
    assert rows[1][3].startswith("Contoso CRM") and rows[2][3].startswith("SAP")


def test_both_on_one_step_the_recorded_rows_then_the_typed_and_a_step_with_no_system(tmp_path):
    wrote, out = _tech(tmp_path, _recording(typed=True))
    assert wrote is True
    _names, rows = _sheet_rows(out, "Information")
    two = [r for r in rows[1:] if r[0] == "Step 2: Enter the order"]
    assert [(r[1], r[4]) for r in two] == [("Material", "Recorded"), ("Quantity", "Recorded"),
                                          ("Order lines", "Typed by the analyst"),
                                          ("material", "Typed by the analyst")], "one row per entry"
    assert two[2][2:4] == ["2 lines", "SAP, Items: Material"]
    three = [r for r in rows[1:] if r[0] == "Step 3: Phone the customer"]
    assert three == [["Step 3: Phone the customer", "Phone number", "+385 1 2345", "Phone", "Typed by the analyst"]]


def test_a_video_project_with_typed_information_gets_its_workbook(tmp_path):
    wrote, out = _tech(tmp_path, _video())
    assert wrote is True, "C26: written once it holds a row (plan B7's done when)"
    _names, rows = _sheet_rows(out, "Information")
    assert rows[1:] == [
        ["Step 1: Take the call", "Customer number", "10482", "SAP, Sold-to party", "Typed by the analyst"],
        ["Step 1: Take the call", "Order lines", "2", "", "Typed by the analyst"],
        ["Step 3: Note the call", "Call reason", "", "the notes", "Typed by the analyst"]]
    for other in ("Steps and controls", "Data fields", "Re-keyed values", "Applications"):
        assert len(_sheet_rows(out, other)[1]) == 1, other     # nothing recorded: the header alone
    about = _sheet_rows(out, "About")[1]
    assert any(r[:1] == ["Information"] for r in about), "the About sheet says what it lists"


def test_a_video_project_without_typed_information_gets_no_workbook(tmp_path):
    """The control: the same project with no line typed writes nothing."""
    annotations, stats, manifest, events = _video()
    for st in annotations["steps"]:
        st.pop("information", None)
    wrote, out = _tech(tmp_path, (annotations, stats, manifest, events))
    assert wrote is False and not out.exists()


def test_a_hidden_step_and_a_hidden_sub_step_print_nothing(tmp_path):
    annotations, stats, manifest, events = _video()
    annotations["steps"][2]["state"] = "hidden"
    annotations["steps"][1]["sub_steps"] = [
        {"step_id": "u1", "name": "Type the lines", "state": "manually_authored", "time_range": None, "order": 1,
         "information": [{"name": "Unit price", "example": "12.50"}]},
        {"step_id": "u2", "name": "Skip", "state": "hidden", "time_range": None, "order": 2,
         "information": [{"name": "Never shown"}]}]
    wrote, out = _tech(tmp_path, (annotations, stats, manifest, events))
    assert wrote is True
    _names, rows = _sheet_rows(out, "Information")
    got = [r[1] for r in rows[1:]]
    assert "Call reason" not in got and "Never shown" not in got
    assert "Unit price" in got, "a visible sub-step's line is listed"
