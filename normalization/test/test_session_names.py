"""F1: the names the analyst gives travel with the session (contract C4).

Before this, a name given in the pattern run reached the other runs' drafts
only through the analyst's own remembered-names file (`--names`), outside
the session folder: the same session analyzed or exported on another machine
drafted runs 2 to N under their default names, and every count keyed on
names moved. Now a draft takes, in this order, the name the analyst gave to
a step with the same draft_key in this session, the remembered-names file's
name, then its drafted name.

The unit tests are stdlib only. The pipeline tests run the real normalize()
on a temp copy of the committed demo and need the full-deps gate (pandas,
pm4py, python-docx); they skip without it.

Run with:
    pytest normalization/test/test_session_names.py
"""

from __future__ import annotations

import importlib.util
import json
import logging
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

from step_suggest import auto_suggest_steps, session_names  # noqa: E402

T0 = datetime(2026, 9, 23, 9, 0, 0, tzinfo=timezone.utc)
FIND = "crm|CRM - Orders|Button:find"
SAVE = "crm|CRM - Orders|Button:save"
SEND = "mail|Mail - Compose|Button:send"


def _ts(sec):
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _step(case_id, name, sec, state, key=None, keys=None):
    s = {"step_id": f"{case_id}-{sec}", "case_id": case_id, "name": name, "state": state,
         "time_range": {"start": _ts(sec), "end": _ts(sec + 1)}}
    if key:
        s["draft_key"] = key
    if keys:
        s["draft_keys"] = keys
    return s


# ---- session_names: which analyst steps name which keys -----------------------

def test_confirmed_edited_and_added_steps_name_their_key_and_hidden_ones_do_not():
    anno = {"steps": [
        _step("r1", "Look up the order", 1, "edited", FIND),
        _step("r1", "CRM - Orders: Save", 5, "confirmed", SAVE),
        _step("r1", "Send it", 9, "hidden", SEND),
        _step("r2", "CRM - Orders: Find", 61, "auto_suggested", FIND),
        _step("r2", "Hand-added check", 70, "manually_authored", "crm|CRM - Orders|(visit)"),
    ]}
    assert session_names(anno) == {
        FIND: "Look up the order",
        SAVE: "CRM - Orders: Save",
        "crm|CRM - Orders|(visit)": "Hand-added check",
    }


def test_the_pattern_run_names_a_key_first_then_time_order():
    anno = {"pattern_run": {"case_id": "r2"}, "steps": [
        _step("r1", "Find (run 1)", 1, "edited", FIND),
        _step("r2", "Find (pattern)", 61, "edited", FIND),
        _step("r3", "Save (run 3)", 121, "edited", SAVE),
        _step("r4", "Save (run 4)", 181, "edited", SAVE),
    ]}
    names = session_names(anno)
    assert names[FIND] == "Find (pattern)"
    assert names[SAVE] == "Save (run 3)"


def test_a_typed_name_comes_before_a_confirmed_one_even_from_the_pattern_run():
    """The pattern run was confirmed under the drafted name; the analyst then
    renamed the same step in run 2, which the viewer carries to the other
    runs' drafts at once. Re-analysis must not take that back."""
    anno = {"pattern_run": {"case_id": "r1"}, "steps": [
        _step("r1", "Excel - Order Tracking.xlsx: Save workbook", 1, "confirmed", SAVE),
        _step("r2", "Update the order tracker", 61, "edited", SAVE),
        _step("r1", "CRM - Orders: Find", 3, "confirmed", FIND),
    ]}
    assert session_names(anno) == {SAVE: "Update the order tracker", FIND: "CRM - Orders: Find"}


def test_a_merged_step_names_its_keys_after_the_single_step_names():
    anno = {"steps": [
        _step("r1", "Look up and save the order", 1, "edited", keys=[FIND, SAVE]),
        _step("r1", "Save again", 20, "edited", SAVE),
    ]}
    assert session_names(anno) == {FIND: "Look up and save the order", SAVE: "Save again"}


def test_blank_names_odd_shapes_and_missing_steps_name_nothing():
    anno = {"steps": [
        _step("r1", "  ", 1, "edited", FIND),
        "not a step",
        {"state": "edited", "name": "No key"},
        _step("r1", "Bad keys", 3, "edited", keys=["", 7]),
    ]}
    assert session_names(anno) == {}
    assert session_names(None) == {} and session_names({"steps": None}) == {}


# ---- drafting: the precedence session, then remembered, then drafted ------------

def _ev(eid, sec, name, aid, case):
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "data": {"kind": "invoked", "control_type": "Button", "automation_id": aid,
                     "name": name, "window_title": "CRM - Orders",
                     "process_name": "crm.exe", "case_ids": [case]}}


def test_a_draft_takes_the_session_name_before_the_remembered_one():
    events = [_ev("e1", 1, "Find", "find", "r2"), _ev("e2", 5, "Save", "save", "r2"),
              _ev("e3", 9, "Print", "print", "r2")]
    drafts = auto_suggest_steps(
        events,
        session_names={FIND: "Look up the order"},
        remembered_names={FIND: "Older remembered name", SAVE: "Save the order"})
    by_key = {d["draft_key"]: d for d in drafts}
    assert by_key[FIND]["name"] == "Look up the order"
    assert by_key[SAVE]["name"] == "Save the order"
    assert by_key["crm|CRM - Orders|Button:print"]["name"] == "CRM - Orders: Print"
    assert [by_key[k]["name_source"] for k in (FIND, SAVE, "crm|CRM - Orders|Button:print")] \
        == ["remembered", "remembered", "draft"]


# ---- the pipeline: same names on every machine -----------------------------------

DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"
_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py", "docx"))
_needs_deps = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps not installed")

# The review's worked session: the pattern run's seven drafts renamed.
NAMES = {
    "chrome|Salesforce - Account lookup|Button:search": "Look up the customer",
    "chrome|Salesforce - Account lookup|Button:open-customer-record": "Open the customer record",
    "chrome|Salesforce - Order|Button:save-order": "Enter the order in Salesforce",
    "sapgui|va01|MenuItem:check-document": "Enter the sales order in SAP",
    "sapgui|va01|Button:create-sales-order": "Create the sales order in SAP",
    "excel|Excel - Order Tracking.xlsx|Button:save-workbook": "Log the order in the tracking sheet",
    "outlook|Outlook - Order confirmation|Button:send": "Send the order confirmation",
}


@pytest.fixture(autouse=True)
def _restore_root_logging():
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _copy_demo(folder: Path) -> Path:
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    return folder


def _read(folder):
    return json.loads((folder / "annotations.json").read_text(encoding="utf-8"))


def _work(folder):
    """The analyst renames the pattern run's drafts (state edited), as the
    viewer's rename does, and confirms the run."""
    anno = _read(folder)
    stats = json.loads((folder / "stats.json").read_text(encoding="utf-8"))
    runs = sorted((c for c in stats["case_stats"] if not c.get("parent_case_id")),
                  key=lambda c: c["start_ts"])
    run1 = runs[0]["case_id"]
    for s in anno["steps"]:
        if s.get("case_id") == run1:
            if s.get("draft_key") in NAMES:
                s["name"] = NAMES[s["draft_key"]]
                s["state"] = "edited"
            elif s.get("state") == "auto_suggested":
                s["state"] = "confirmed"
    anno["pattern_run"] = {"case_id": run1, "confirmed_at": _ts(0)}
    (folder / "annotations.json").write_text(json.dumps(anno, indent=2), encoding="utf-8")
    return [r["case_id"] for r in runs]


@_needs_deps
def test_the_other_runs_drafts_take_the_names_without_the_names_file(tmp_path):
    import normalize as normalize_mod
    folder = _copy_demo(tmp_path / "demo")
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)
    runs = _work(folder)
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True)   # no --names
    anno = _read(folder)
    drafts = [s for s in anno["steps"]
              if s.get("case_id") in runs[1:] and s.get("draft_key") in NAMES]
    assert len(drafts) >= 12
    wrong = [(s["draft_key"], s["name"]) for s in drafts if s["name"] != NAMES[s["draft_key"]]]
    assert wrong == []
    assert all(s["name_source"] == "remembered" and s["process_label"] == s["name"] for s in drafts)
    stats = json.loads((folder / "stats.json").read_text(encoding="utf-8"))
    assert stats["meta"]["draft_summary"]["name_source"]["remembered"] >= 12


def _doc_text(path: Path) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(str(path))
    out = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            out.append(Paragraph(child, doc).text)
        elif tag == "tbl":
            out.extend(" | ".join(c.text for c in row.cells) for row in Table(child, doc).rows)
    return "\n".join(t for t in out if t.strip())


@_needs_deps
def test_the_pdd_reads_the_same_with_and_without_the_names_file(tmp_path):
    """The review's proof of F1: the worked session exported with the
    analyst's remembered names and exported on a machine without them prints
    the same document, every section."""
    import normalize as normalize_mod
    first = _copy_demo(tmp_path / "with-names")
    normalize_mod.normalize(first, taxonomy_path=str(TAXONOMY), mine=True)
    _work(first)
    second = tmp_path / "without-names"
    shutil.copytree(first, second)
    store = tmp_path / "remembered-names.json"
    store.write_text(json.dumps({"version": 1, "names": {
        k: {"name": v, "updated_at": _ts(0)} for k, v in NAMES.items()}}), encoding="utf-8")
    normalize_mod.normalize(first, taxonomy_path=str(TAXONOMY), mine=True,
                            names_path=str(store), pdd_out=str(tmp_path / "with.docx"))
    normalize_mod.normalize(second, taxonomy_path=str(TAXONOMY), mine=True,
                            pdd_out=str(tmp_path / "without.docx"))
    with_names = _doc_text(tmp_path / "with.docx")
    without = _doc_text(tmp_path / "without.docx")
    # The folder name is the one line that differs by construction.
    with_names = with_names.replace("with-names", "FOLDER")
    without = without.replace("without-names", "FOLDER")
    assert with_names == without
    for drafted in ("Salesforce - Account lookup: Search", "va01: Check document",
                    "Outlook - Order confirmation: Send"):
        assert drafted not in without
    assert re.search(r"Enter the sales order in SAP", without)
