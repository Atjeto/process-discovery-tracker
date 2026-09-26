"""Tests for app_names: readable application names (deliverable audit gap 3)
and the one vocabulary of systems (shared/system-names.json, AD-28).

Pure stdlib, so this suite runs under any pytest.
"""

from __future__ import annotations
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app_names
from app_names import build_app_names, display_name, system_name

SYSTEMS = Path(__file__).resolve().parent.parent.parent / "shared" / "system-names.json"


def _inter(proc, title):
    return {"type": "interaction", "data": {"process_name": proc, "window_title": title}}


# ---- the one vocabulary of systems ---------------------------------------------

def test_the_demo_five_applications_resolve_to_their_business_systems():
    """The committed demo's five applications, with their recorded window
    titles: the system is Salesforce (in Chrome), SAP, Excel, Outlook and
    Notepad; the browser is only where Salesforce ran."""
    cases = {
        ("chrome.exe", "Salesforce - Account lookup"): "Salesforce",
        ("chrome.exe", "Salesforce - Order #10900"): "Salesforce",
        ("SAPGUI.exe", "SAP - Create Sales Order (VA01)"): "SAP",
        ("EXCEL.EXE", "Excel - Order Tracking.xlsx"): "Excel",
        ("OUTLOOK.EXE", "Outlook - Order #10900 confirmation"): "Outlook",
        ("notepad.exe", "Notepad - Internal mappings.txt"): "Notepad",
    }
    for (app, title), system in cases.items():
        assert system_name(app, title) == system, (app, title)


def test_a_browser_window_without_a_listed_web_system_keeps_the_browser_name():
    assert system_name("chrome.exe", "Intranet - Google Chrome") == "Google Chrome"
    assert system_name("msedge.exe", "Account lookup | Salesforce - Microsoft Edge") == "Salesforce"
    assert system_name("msedge.exe", "Timesheets - Microsoft Edge") == "Microsoft Edge"
    # A title rule is for browsers only: an Excel file named after Salesforce is Excel.
    assert system_name("EXCEL.EXE", "Salesforce export.xlsx - Excel") == "Excel"


def test_an_unlisted_application_takes_its_readable_name():
    names = {"crm.exe": "Contoso CRM"}
    assert system_name("crm.exe", "Orders", names) == "Contoso CRM"
    assert system_name("erpclient.exe", "Orders") == "Erpclient"
    assert system_name("", "Orders") == "" and system_name(None) == ""


def test_the_file_is_ordered_rules_with_a_process_list_and_a_system():
    doc = json.loads(SYSTEMS.read_text(encoding="utf-8"))
    assert doc["version"] == 1 and isinstance(doc["_README"], str)
    sites = 0
    for rule in doc["rules"]:
        assert rule["process"] and all(p == p.lower() and not p.endswith(".exe")
                                       for p in rule["process"])
        if rule.get("site") is True:
            # 2.0.1: a site rule names a browser window by its site, and
            # drops the browser's own name from the title first.
            assert set(rule) <= {"process", "site", "drop"}, rule
            assert all(isinstance(d, str) and d.strip() for d in rule["drop"])
            sites += 1
            continue
        assert set(rule) <= {"process", "title", "system"}, rule
        assert rule["system"].strip()
        if "title" in rule:
            re.compile(rule["title"])
    assert sites == 1
    # 2.0.1: the names Windows gives a program, each with an application a
    # rule knows.
    known = {p for rule in doc["rules"] for p in rule["process"]}
    names = {k: v for k, v in doc["program_names"].items() if not k.startswith("_")}
    assert names and all(v in known for v in names.values()), names
    # No dash punctuation in the shared text the viewer may show.
    text = SYSTEMS.read_text(encoding="utf-8")
    assert chr(0x2013) not in text and chr(0x2014) not in text and " -- " not in text


def test_the_first_matching_rule_wins(tmp_path):
    path = tmp_path / "systems.json"
    path.write_text(json.dumps({"version": 1, "rules": [
        {"process": ["chrome"], "title": "Portal", "system": "Order Portal"},
        {"process": ["chrome"], "system": "Google Chrome"},
        {"process": ["chrome"], "title": "Portal", "system": "Never reached"},
        {"process": [], "system": "No process"},
        {"process": ["x"], "title": "(", "system": "Bad pattern"},
    ]}), encoding="utf-8")
    rules = app_names._load_system_rules(path)
    assert [system for _k, _rx, system, _site in rules] == ["Order Portal", "Google Chrome",
                                                             "Never reached"]


def test_a_browser_window_on_a_site_no_rule_names_is_named_by_its_site():
    """2.0.1: the site a browser window's title ends with names the web
    system (the site rule of shared/system-names.json), once the browser's
    own name is dropped; a title of one segment names a page, not a site,
    and a segment the value rules would change is a value, not a name. A
    rule above the site rule still wins, and the rule is for browsers."""
    cases = {
        ("chrome.exe", "Customer lookup - Order Desk - Google Chrome"): "Order Desk",
        ("chrome.exe", "New order for Contoso Ltd - Order Desk"): "Order Desk",
        ("msedge.exe", "Page - Order Desk and 3 more pages - Microsoft\u200b Edge"): "Order Desk",
        ("chrome.exe", "New Tab - Google Chrome"): "Google Chrome",
        ("chrome.exe", "Orders - SO12345"): "Google Chrome",
        ("chrome.exe", "Account lookup | Salesforce - Google Chrome"): "Salesforce",
        ("EXCEL.EXE", "Order Desk - Excel"): "Excel",
    }
    for (app, title), system in cases.items():
        assert system_name(app, title) == system, (app, title)
    assert app_names.site_name("Customer lookup - Order Desk", frozenset()) == "Order Desk"
    assert app_names.site_name("Order Desk", frozenset()) == ""
    assert app_names.site_name(None) == ""


def test_a_program_named_as_windows_names_it_is_its_executable():
    """2.0.1: the capture app records the window in front by the name
    Windows gives the program ("Google Chrome", "Microsoft Excel"), the
    recorder by its executable; both are one application, so the Timeline
    names a system as the steps do (system-names.json `program_names`)."""
    assert app_names.app_key("Google Chrome") == app_names.app_key("chrome.exe") == "chrome"
    assert app_names.app_key("Microsoft\u200b Edge") == "msedge"
    assert app_names.app_key("Microsoft Excel") == "excel"
    assert app_names.app_key("Erpclient.exe") == "erpclient"
    cases = {
        ("Google Chrome", "Customer lookup - Order Desk - Google Chrome"): "Order Desk",
        ("Google Chrome", "Account lookup | Salesforce - Google Chrome"): "Salesforce",
        ("Google Chrome", "New Tab - Google Chrome"): "Google Chrome",
        ("Microsoft Excel", "orders-week40.xlsx - Excel"): "Excel",
        ("Microsoft Outlook", "Inbox - Outlook"): "Outlook",
    }
    for (app, title), system in cases.items():
        assert system_name(app, title) == system, (app, title)


# ---- the per-application names (stats.json meta.app_names) -----------------------

def test_a_listed_application_is_named_by_the_system_list_before_a_vocab():
    vocabs = [{"id": "sap-gui", "name": "SAP GUI", "scope": {"process_name": "sapgui.exe"}},
              {"id": "salesforce", "name": "Salesforce (Lightning)",
               "scope": {"window_title_regex": ".*Salesforce.*"}}]
    names = build_app_names([_inter("SAPGUI.exe", "SAP - Create Sales Order (VA01)"),
                             _inter("chrome.exe", "Salesforce - Account lookup")], vocabs)
    assert names == {"SAPGUI.exe": "SAP", "chrome.exe": "Google Chrome"}


def test_a_vocab_scoped_to_an_unlisted_executable_names_it():
    vocabs = [{"id": "crm", "name": "Contoso CRM", "scope": {"process_name": "crm.exe"}}]
    names = build_app_names([_inter("CRM.exe", "Orders - Contoso")], vocabs)
    assert names == {"CRM.exe": "Contoso CRM"}


def test_a_window_title_segment_naming_the_executable_is_used():
    names = build_app_names([
        _inter("TIMESHEET.EXE", "Week 38 - Timesheet"),
        _inter("TIMESHEET.EXE", "Week 39 - Timesheet"),
        {"type": "activity", "data": {"app": "chrome.exe",
                                      "title": "Account lookup | Salesforce - Google Chrome"}},
    ])
    assert names == {"TIMESHEET.EXE": "Timesheet", "chrome.exe": "Google Chrome"}


def test_a_word_inside_another_word_does_not_name_the_app():
    names = build_app_names([_inter("code.exe", "Barcode scanner - notes")])
    assert names == {"code.exe": "Code"}


def test_without_a_rule_a_vocab_or_a_title_the_executable_name_is_capitalized():
    names = build_app_names([_inter("ERPCLIENT.exe", "Orders (VA01)"),
                             _inter("mstsc.exe", "")])
    assert names == {"ERPCLIENT.exe": "Erpclient", "mstsc.exe": "Mstsc"}


def test_display_name_finds_a_token_with_or_without_exe_in_any_case():
    names = {"SAPGUI.exe": "SAP GUI"}
    assert display_name("sapgui", names) == "SAP GUI"
    assert display_name("sapgui.exe", names) == "SAP GUI"
    assert display_name("mstsc.exe", names) == "Mstsc"
    assert display_name("Google Chrome") == "Google Chrome"
    assert display_name(None, names) == ""
    # Without a map, a listed application still gets its system name.
    assert display_name("EXCEL.EXE") == "Excel"


def test_lane_lf_pipe_the_windows_apps_read_by_their_names():
    """#17 (the live recordings: "CalculatorApp", "Charmap", "Mspaint"): the
    common Windows apps have readable names; a browser page's system is the
    site when the list knows it, else the browser."""
    cases = {
        ("CalculatorApp.exe", "Calculator"): "Calculator",
        ("charmap.exe", "Character Map"): "Character Map",
        ("mspaint.exe", "Untitled - Paint"): "Paint",
        ("explorer.exe", "Documents"): "File Explorer",
        ("WINWORD.EXE", "letter.docx - Word"): "Word",
        ("EXCEL.EXE", "orders.xlsx - Excel"): "Excel",
        ("OUTLOOK.EXE", "Inbox"): "Outlook",
        ("notepad.exe", "notes.txt - Notepad"): "Notepad",
        ("msedge.exe", "Order Desk"): "Microsoft Edge",
        ("chrome.exe", "Contoso | Account | Salesforce"): "Salesforce",
        ("chrome.exe", "Customer lookup - Order Desk"): "Order Desk",
    }
    for (app, title), system in cases.items():
        assert system_name(app, title) == system, (app, title)
    assert build_app_names([_inter("mspaint.exe", "Untitled - Paint")]) == {"mspaint.exe": "Paint"}
