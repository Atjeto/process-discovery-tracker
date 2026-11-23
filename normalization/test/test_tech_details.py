"""The Technical details workbook (contract C20, lane HV): normalize.py
--tech-out <file.xlsx>, written with the standard library (xlsx_writer.py).

Read back here with zipfile and ElementTree only (no spreadsheet library):
the package's parts, the sheets in order, the bold and frozen header, and
each sheet's header and rows, on a synthetic fixture (identity fields, a
sub-process, a hidden sub-step, a password field, a remote window, re-keyed
data) and on a copy of the committed demo recording through the pipeline.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

import pdd_export
import tech_details as TD
import xlsx_writer as XW

NS = {"m": XW.MAIN_NS}
SHEETS = ["About", "Steps and controls", "Information", "Exceptions", "Data fields", "Re-keyed values",
          "Applications"]
DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"
_PIPELINE_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))

T0 = datetime(2026, 9, 1, 9, 0, 0, tzinfo=timezone.utc)
R1, R2 = "run-1", "run-2"
SF = "Salesforce - Accounts"
SAP = "SAP - Create Sales Order (VA01)"


def _ts(sec):
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _inter(eid, sec, proc, title, kind, name, control_type="Edit", **data):
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "data": {"kind": kind, "process_name": proc, "window_title": title,
                     "name": name, "control_type": control_type, **data}}


def _step(sid, case_id, name, sec, eids, key=None, state="confirmed", **extra):
    step = {"step_id": sid, "case_id": case_id, "name": name, "state": state,
            "time_range": {"start": _ts(sec), "end": _ts(sec + 3)},
            "evidence": {"interaction_event_ids": eids, "screenshot_refs": []}}
    if key:
        step["draft_key"] = key
    step.update(extra)
    return step


def _fixture():
    """(annotations, stats, manifest, events): two transactions; the
    reference one finds an account in Salesforce (Step 1), enters the order
    in SAP (Step 2, a sub-process of three visible sub-steps and a hidden
    one, a password among them), and ends in a remote window (Step 3); a
    hidden step is never listed. The account number is typed again in SAP."""
    events = [
        _inter("e1", 1, "chrome.exe", SF, "value_changed", "Account number", automation_id="acct-no",
               class_name="x-input", identity_source="automation_id", confidence=0.95,
               framework="chromium", coverage_hint="rich", value="ACC-100"),
        _inter("e2", 2, "chrome.exe", SF, "invoked", "Search", "Button", automation_id="btn-search",
               identity_source="automation_id", confidence=0.95, framework="chromium"),
        _inter("e3", 10, "saplogon.exe", SAP, "value_changed", "Customer", automation_id="",
               class_name="GuiCTextField", identity_source="name", confidence=0.7,
               framework="win32", coverage_hint="basic", value="ACC-100"),
        _inter("e4", 11, "saplogon.exe", SAP, "invoked", "Noise", "Button", identity_source="name",
               confidence=0.7, framework="win32"),
        _inter("e5", 12, "saplogon.exe", SAP, "value_changed", "Password", identity_source="name",
               confidence=0.7, framework="win32", value_redacted=True),
        _inter("e6", 13, "saplogon.exe", SAP, "invoked", "Save", "Button", identity_source="name",
               confidence=0.7, framework="win32"),
        _inter("e7", 20, "chrome.exe", SF, "invoked", "Hidden click", "Button"),
        _inter("e8", 30, "mstsc.exe", "Payments - Remote Desktop", "invoked", "", "Pane",
               identity_source="none", confidence=0.1, framework="remote", coverage_hint="minimal"),
        _inter("f1", 61, "chrome.exe", SF, "value_changed", "Account number", automation_id="acct-no",
               identity_source="automation_id", confidence=0.95, framework="chromium", value="ACC-200"),
        _inter("f2", 62, "chrome.exe", SF, "invoked", "Search", "Button", automation_id="btn-search",
               identity_source="automation_id", confidence=0.95, framework="chromium"),
        _inter("f3", 70, "saplogon.exe", SAP, "value_changed", "Customer", identity_source="name",
               confidence=0.7, framework="win32", value="ACC-200"),
        _inter("f6", 73, "saplogon.exe", SAP, "invoked", "Save", "Button", identity_source="name",
               confidence=0.7, framework="win32"),
    ]
    subs = [
        _step("ss1", R1, "Enter Customer", 10, ["e3"], action_key="sap|order|enter:Customer",
              state="auto_suggested"),
        _step("ss2", R1, "Click Noise", 11, ["e4"], state="hidden"),
        _step("ss3", R1, "Enter Password", 12, ["e5"], action_key="sap|order|enter:Password",
              state="auto_suggested"),
        _step("ss4", R1, "Click Save", 13, ["e6"], action_key="sap|order|click:Save",
              state="auto_suggested"),
    ]
    steps = [
        _step("s1", R1, "Find the account", 1, ["e1", "e2"], key="chrome|Accounts|Button:search"),
        _step("s2", R1, "Enter the order", 10, ["e3", "e4", "e5", "e6"], key="sap|order|Button:save",
              state="edited", sub_steps=subs),
        _step("h1", R1, "Hidden step", 20, ["e7"], key="chrome|Accounts|Button:hidden", state="hidden"),
        _step("s3", R1, "Approve the payment", 30, ["e8"], key="mstsc|Payments|Pane:?"),
        _step("t1", R2, "Find the account", 61, ["f1", "f2"], key="chrome|Accounts|Button:search",
              state="auto_suggested"),
        _step("t2", R2, "Enter the order", 70, ["f3", "f6"], key="sap|order|Button:save",
              state="auto_suggested"),
    ]
    annotations = {"steps": steps, "pattern_run": {"case_id": R1, "confirmed_at": _ts(200)},
                   "document": {"title": "Order entry"},
                   "handoffs": [{"version": 1, "handed_off_at": "2026-09-25T10:00:00Z",
                                 "by": "rasha", "note": "First hand-off"}]}
    stats = {"case_stats": [
        {"case_id": R1, "label": "Order 1", "parent_case_id": None, "start_ts": _ts(0),
         "end_ts": _ts(50), "wall_clock_ms": 50000, "active_ms": 40000},
        {"case_id": R2, "label": "Order 2", "parent_case_id": None, "start_ts": _ts(60),
         "end_ts": _ts(90), "wall_clock_ms": 30000, "active_ms": 25000}],
        "meta": {"app_names": {"chrome.exe": "Google Chrome", "saplogon.exe": "SAP",
                               "mstsc.exe": "Remote Desktop"}}}
    manifest = {"session_id": "sess-tech", "started_at": _ts(0)}
    return annotations, stats, manifest, events


def _write(tmp_path, handoff=None, fixture=None):
    annotations, stats, manifest, events = fixture or _fixture()
    out = tmp_path / "tech.xlsx"
    TD.write_tech_details(out, session_folder=tmp_path, annotations=annotations, stats=stats,
                          manifest=manifest, events=events, handoff=handoff)
    return out


def _cell_value(c):
    t = c.find("m:is/m:t", NS)
    if t is not None:
        return t.text or ""
    v = c.find("m:v", NS)
    return float(v.text) if v is not None else ""


def _col(ref):
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_workbook(path):
    """{sheet name: {"rows": [[value, ...]], "styles": {row: {style}}, "xml": root}}."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = [s.get("name") for s in wb.find("m:sheets", NS)]
        out = {"_parts": names, "_order": sheets,
               "_content_types": ET.fromstring(z.read("[Content_Types].xml")),
               "_styles": ET.fromstring(z.read("xl/styles.xml")),
               "_rels": ET.fromstring(z.read("xl/_rels/workbook.xml.rels")),
               "_root_rels": ET.fromstring(z.read("_rels/.rels"))}
        for i, name in enumerate(sheets, start=1):
            root = ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml"))
            rows, styles = [], {}
            for r in root.find("m:sheetData", NS):
                cells = {}
                for c in r:
                    cells[_col(c.get("r"))] = _cell_value(c)
                    styles.setdefault(len(rows), set()).add(c.get("s") or "0")
                rows.append([cells.get(k, "") for k in range(max(cells) + 1)] if cells else [])
            out[name] = {"rows": rows, "styles": styles, "xml": root}
    return out


def test_the_package_parts_parse_and_name_every_sheet(tmp_path):
    wb = read_workbook(_write(tmp_path))
    assert wb["_order"] == SHEETS
    for part in ("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                 "xl/styles.xml"):
        assert part in wb["_parts"], part
    overrides = {o.get("PartName") for o in wb["_content_types"]}
    for i in range(1, len(SHEETS) + 1):
        assert f"/xl/worksheets/sheet{i}.xml" in overrides
    assert "/xl/styles.xml" in overrides and "/xl/workbook.xml" in overrides
    targets = {r.get("Target") for r in wb["_rels"]}
    assert "styles.xml" in targets and "worksheets/sheet5.xml" in targets
    assert [r.get("Target") for r in wb["_root_rels"]] == ["xl/workbook.xml"]
    # The header style: a bold font on the second cell format.
    xfs = wb["_styles"].find("m:cellXfs", NS)
    fonts = wb["_styles"].find("m:fonts", NS)
    bold_font = int(list(xfs)[1].get("fontId"))
    assert list(fonts)[bold_font].find("m:b", NS) is not None


def test_each_data_sheet_has_a_bold_frozen_header(tmp_path):
    wb = read_workbook(_write(tmp_path))
    for name in SHEETS[1:]:
        sheet = wb[name]
        assert sheet["styles"][0] == {"1"}, name
        pane = sheet["xml"].find("m:sheetViews/m:sheetView/m:pane", NS)
        assert pane is not None and pane.get("state") == "frozen" and pane.get("ySplit") == "1", name
        cols = sheet["xml"].find("m:cols", NS)
        assert cols is not None and len(cols) >= len(sheet["rows"][0]), name


def test_steps_and_controls_lists_the_reference_transaction_in_step_order(tmp_path):
    rows = read_workbook(_write(tmp_path))["Steps and controls"]["rows"]
    assert rows[0] == list(TD.STEPS_HEADER)
    body = rows[1:]
    # Step 2 is a sub-process: its interactions carry the chapter's numbers;
    # the hidden sub-step's click and the hidden step are not listed.
    assert [(r[0], r[1], r[2]) for r in body] == [
        ("Step 1", "Find the account", "Type"),
        ("Step 1", "Find the account", "Click"),
        ("Step 2.1", "Enter Customer", "Type"),
        ("Step 2.2", "Enter Password", "Type"),
        ("Step 2.3", "Click Save", "Click"),
        ("Step 3", "Approve the payment", "Click"),
    ]
    first = dict(zip(TD.STEPS_HEADER, body[0]))
    assert first["Value"] == "ACC-100" and first["Automation id"] == "acct-no"
    assert first["Class name"] == "x-input" and first["Identity source"] == "automation_id"
    assert first["Confidence"] == 0.95 and first["Window title"] == SF
    assert first["Program"] == "chrome.exe" and first["System"] == "Salesforce"
    # Lane LF-PIPE: a redacted secret reads "typed (hidden)".
    assert dict(zip(TD.STEPS_HEADER, body[3]))["Value"] == "typed (hidden)"
    remote = dict(zip(TD.STEPS_HEADER, body[5]))
    assert remote["Identity source"] == "none" and remote["Confidence"] == 0.1
    assert all(r[4] != "Noise" and r[6] != "Hidden click" for r in body)


def test_steps_and_controls_say_who_does_each_step(tmp_path):
    """Contract C25: a Done by column (its own, else the recording's role)
    for the row's step (a sub-step its chapter prints is its own step). As
    amended 2026-11-13 there is no Automation column, and a stored
    `automation` writes nothing."""
    fixture = _fixture()
    annotations, _stats, manifest, _events = fixture
    manifest["config"] = {"worker": {"id": "w1", "role": "order clerk"}}
    steps = {s["step_id"]: s for s in annotations["steps"]}
    steps["s1"]["automation"] = "automated"
    steps["s3"]["automation"] = "person"
    steps["s3"]["done_by"] = "Payments team"
    subs = {s["step_id"]: s for s in steps["s2"]["sub_steps"]}
    subs["ss3"]["automation"] = "not_needed"
    rows = read_workbook(_write(tmp_path, fixture=fixture))["Steps and controls"]["rows"]
    assert rows[0][-3:] == ["Activity", "Code", "Done by"] and "Automation" not in rows[0]
    assert [(r[0], r[-1]) for r in rows[1:]] == [
        ("Step 1", "Order clerk"), ("Step 1", "Order clerk"), ("Step 2.1", "Order clerk"),
        ("Step 2.2", "Order clerk"), ("Step 2.3", "Order clerk"), ("Step 3", "Payments team"),
    ]
    flat = [cell for r in rows for cell in r]
    for words in ("The automation does it", "Stays with a person", "No longer needed", "Not decided yet"):
        assert words not in flat
    # Without a role and a Done by, nobody is named.
    manifest.pop("config")
    rows = read_workbook(_write(tmp_path, fixture=fixture))["Steps and controls"]["rows"]
    # An empty cell is not written, so a row ends at its last value.
    full = [r + [""] * (len(TD.STEPS_HEADER) - len(r)) for r in rows[1:]]
    assert [r[-1] for r in full] == ["", "", "", "", "", "Payments team"]


def test_data_fields_hold_one_column_per_transaction(tmp_path):
    rows = read_workbook(_write(tmp_path))["Data fields"]["rows"]
    header = rows[0]
    assert header[:5] == list(TD.DATA_HEADER)
    assert header[5:] == ["Transaction 1: Order 1", "Transaction 2: Order 2"]
    by_field = {r[0]: dict(zip(header, r)) for r in rows[1:]}
    assert by_field["Account number"]["Transaction 1: Order 1"] == "ACC-100"
    assert by_field["Account number"]["Transaction 2: Order 2"] == "ACC-200"
    assert by_field["Account number"]["Automation id"] == "acct-no"
    assert by_field["Account number"]["System and screen"].startswith("Salesforce")
    # A password stays as recorded: typed, its value hidden (lane LF-PIPE).
    assert by_field["Password"]["Transaction 1: Order 1"] == "typed (hidden)"
    assert by_field["Password"].get("Transaction 2: Order 2", "") == ""


def test_re_keyed_values_are_the_pdds_pairs_with_their_values(tmp_path):
    annotations, stats, manifest, events = _fixture()
    rows = read_workbook(_write(tmp_path))["Re-keyed values"]["rows"]
    assert rows[0] == list(TD.REKEYED_HEADER)
    s = pdd_export._Session(tmp_path, annotations, stats, manifest, events)
    pairs = pdd_export._rekeyed(s)
    assert [(r[0], r[1], r[2], r[3]) for r in rows[1:]] == [(a[1], a[0], b[1], b[0]) for a, b, _n in pairs]
    assert rows[1][1:] == ["Account number", "SAP", "Customer", "ACC-100; ACC-200", "2 of 2"]


def test_applications_name_the_coverage_and_the_remote_surface(tmp_path):
    rows = read_workbook(_write(tmp_path))["Applications"]["rows"]
    assert rows[0] == list(TD.APPS_HEADER)
    by_prog = {r[0]: dict(zip(TD.APPS_HEADER, r)) for r in rows[1:]}
    assert by_prog["chrome.exe"]["System"] == "Salesforce"
    assert by_prog["chrome.exe"]["Coverage"] == "rich" and by_prog["chrome.exe"]["Remote or terminal"] == "No"
    assert by_prog["chrome.exe"]["Steps"] == 1.0            # Find the account, in both transactions
    assert by_prog["saplogon.exe"]["Coverage"] == "basic"
    assert by_prog["mstsc.exe"]["Remote or terminal"] == "Yes"
    assert by_prog["mstsc.exe"]["Coverage"] == "minimal"


def test_the_about_sheet_says_the_version_in_its_three_states(tmp_path):
    about = read_workbook(_write(tmp_path, handoff=1))["About"]["rows"]
    assert about[0] == ["Technical details: Order entry"]
    assert about[1] == ["Version 1, handed off 2026-09-25 by rasha"]
    assert about[4] == ["Sheet", "What it lists"]
    assert [r[0] for r in about[5:11]] == SHEETS[1:]
    assert read_workbook(_write(tmp_path))["About"]["rows"][1] == ["Working copy after version 1"]
    annotations, stats, manifest, events = _fixture()
    annotations.pop("handoffs")
    about = read_workbook(_write(tmp_path, fixture=(annotations, stats, manifest, events)))["About"]["rows"]
    assert about[1] == ["Working copy, not handed off yet"]


def _blank_fixture():
    """(annotations, stats, manifest, events) of a blank project (C16): one
    step added by hand in the one implicit run, nothing recorded."""
    annotations = {"steps": [{"step_id": "m1", "case_id": "imp", "name": "Check the invoice",
                              "state": "manually_authored", "time_range": None, "order": 1, "system": "SAP",
                              "evidence": {"interaction_event_ids": [], "screenshot_refs": []}}]}
    stats = {"case_stats": [{"case_id": "imp", "label": None, "parent_case_id": None, "start_ts": _ts(0),
                             "end_ts": None, "wall_clock_ms": None, "active_ms": None, "implicit": True}],
             "meta": {}}
    manifest = {"session_id": "b", "source": "blank", "started_at": _ts(0), "label": "Invoice check"}
    return annotations, stats, manifest, []


def _sheets(tmp_path, fixture):
    annotations, stats, manifest, events = fixture
    return TD.tech_sheets(session_folder=tmp_path, annotations=annotations, stats=stats,
                          manifest=manifest, events=events)


def test_a_project_without_a_recording_has_its_sheets_and_no_transaction_column(tmp_path):
    """C16: a blank project's one implicit run is no marked transaction. Its
    sheets hold their headers alone, so no workbook is written (B7-P; the
    sheets were written header-only before)."""
    sheets = {sheet.name: sheet.rows for sheet in _sheets(tmp_path, _blank_fixture())}
    assert list(sheets) == SHEETS
    assert sheets["About"][0] == ["Technical details: Invoice check"]
    assert sheets["About"][2] == ["Transactions were not marked in this project, so every step is listed in order."]
    assert sheets["Data fields"][0] == list(TD.DATA_HEADER) + ["Value"]
    for name in SHEETS[1:]:
        assert len(sheets[name]) == 1, name      # the header alone: nothing was recorded


def test_a_workbook_holds_rows_only_with_a_row_below_a_header(tmp_path):
    """holds_rows: a row on any of the five sheets after About; a header is
    not a row and About does not count."""
    assert TD.holds_rows(_sheets(tmp_path, _blank_fixture())) is False
    assert TD.holds_rows(_sheets(tmp_path, _fixture())) is True
    # One recorded interaction and no step: only Applications has a row.
    annotations, stats, manifest, _events = _blank_fixture()
    manifest.pop("source")
    annotations["steps"] = []
    one = [_inter("e1", 1, "chrome.exe", SF, "invoked", "Search", "Button")]
    sheets = _sheets(tmp_path, (annotations, stats, manifest, one))
    assert [len(sheet.rows) for sheet in sheets[1:]] == [1, 1, 1, 1, 1, 2]
    assert TD.holds_rows(sheets) is True


def test_a_workbook_without_rows_is_not_written(tmp_path):
    """B7-P: write_tech_details writes nothing and says so (False) when no
    sheet would hold a row; a file already at the path is left as it was.
    A recorded project's workbook is written (True)."""
    out = tmp_path / "tech.xlsx"
    annotations, stats, manifest, events = _blank_fixture()
    kw = dict(session_folder=tmp_path, annotations=annotations, stats=stats, manifest=manifest,
              events=events)
    assert TD.write_tech_details(out, **kw) is False
    assert not out.exists() and not list(tmp_path.glob("*.partial"))
    out.write_bytes(b"an earlier workbook")
    assert TD.write_tech_details(out, **kw) is False
    assert out.read_bytes() == b"an earlier workbook"

    annotations, stats, manifest, events = _fixture()
    assert TD.write_tech_details(out, session_folder=tmp_path, annotations=annotations, stats=stats,
                                 manifest=manifest, events=events) is True
    assert read_workbook(out)["_order"] == SHEETS


def test_the_writer_keeps_text_excel_can_hold():
    assert XW.column_letter(0) == "A" and XW.column_letter(25) == "Z" and XW.column_letter(26) == "AA"
    assert XW.cell_text("a\x00b\x1fc\td") == "abc\td"
    assert len(XW.cell_text("x" * 40000)) == XW.MAX_CELL
    with pytest.raises(ValueError):
        XW.workbook_parts([XW.Sheet("bad/name")])
    with pytest.raises(ValueError):
        XW.workbook_parts([XW.Sheet("Same"), XW.Sheet("same")])
    parts = XW.workbook_parts([XW.Sheet("A", rows=[["  padded  ", 3, None, True]])])
    sheet = parts["xl/worksheets/sheet1.xml"]
    ET.fromstring(sheet)
    assert 'xml:space="preserve"' in sheet and "<v>3</v>" in sheet and ">True<" in sheet


def test_a_failed_write_leaves_no_file(tmp_path, monkeypatch):
    out = tmp_path / "x.xlsx"

    def boom(*_a, **_k):
        raise OSError("disk full")
    monkeypatch.setattr(XW.os, "replace", boom)
    with pytest.raises(OSError):
        XW.write_workbook(out, [XW.Sheet("A", rows=[["x"]])])
    assert not out.exists() and not list(tmp_path.glob("*.partial"))


# ---- Through the pipeline: the demo recording --------------------------------------

@pytest.fixture
def _restore_root_logging():
    root = logging.getLogger()
    before, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _demo(folder: Path) -> Path:
    folder.mkdir()
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, folder / name)
    return folder


@pytest.mark.skipif(not _PIPELINE_OK, reason="pipeline deps (pandas/pm4py) not installed")
def test_the_demo_through_the_pipeline(tmp_path, _restore_root_logging, capsys):
    import normalize as normalize_mod
    folder = _demo(tmp_path / "demo")
    out = tmp_path / "tech.xlsx"
    normalize_mod.normalize(folder, taxonomy_path=str(TAXONOMY), mine=True, tech_out=str(out))
    # A recording's workbook is written and said (B7-P control).
    assert f"[normalize] wrote Technical details: {out}" in capsys.readouterr().out.splitlines()
    wb = read_workbook(out)
    assert wb["_order"] == SHEETS
    assert wb["About"]["rows"][1] == ["Working copy, not handed off yet"]
    steps = wb["Steps and controls"]["rows"]
    assert steps[0] == list(TD.STEPS_HEADER) and len(steps) > 5
    assert steps[1][0] == "Step 1" and steps[1][11] == "chrome.exe" and steps[1][12] == "Salesforce"
    data = wb["Data fields"]["rows"]
    assert data[0][5:] == ["Transaction 1: Order #10900", "Transaction 2: Order #10901",
                           "Transaction 3: Order #10902", "Transaction 4: Order #10903"]
    product = next(r for r in data[1:] if r[0] == "Product code")
    assert product[5:] == ["SKU-4471"] * 4
    rekeyed = wb["Re-keyed values"]["rows"]
    assert rekeyed[1] == ["Salesforce", "Product code", "SAP", "Material number", "SKU-4471", "4 of 4"]
    apps = {r[0]: r for r in wb["Applications"]["rows"][1:]}
    assert apps["chrome.exe"][1] == "Salesforce" and apps["SAPGUI.exe"][1] == "SAP"
    # The analysis in the project is the one the run wrote with the workbook.
    assert json.loads((folder / "analysis.json").read_text(encoding="utf-8"))["stage_errors"] == []


@pytest.mark.skipif(not _PIPELINE_OK, reason="pipeline deps (pandas/pm4py) not installed")
def test_the_cli_refuses_a_bad_version_and_fails_a_bad_workbook_path(tmp_path):
    folder = _demo(tmp_path / "demo")
    anno_before = (folder / "annotations.json").read_bytes()
    run = lambda *args: subprocess.run(  # noqa: E731
        [sys.executable, str(NORMALIZATION / "normalize.py"), str(folder), *args],
        capture_output=True, text=True, cwd=str(NORMALIZATION))
    bad = run("--handoff", "0")
    assert bad.returncode == 1 and "[normalize] ERROR:" in bad.stderr
    missing = tmp_path / "no such folder" / "tech.xlsx"
    failed = run("--taxonomy", str(TAXONOMY), "--tech-out", str(missing))
    assert failed.returncode == 3, failed.stderr
    assert "Technical details export" in failed.stderr and "Nothing in the project was changed" in failed.stderr
    # C13: a failed export changes nothing in the project.
    assert (folder / "annotations.json").read_bytes() == anno_before
    assert not (folder / "analysis.json").exists()
