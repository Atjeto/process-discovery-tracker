"""Tests for app_names: readable application names (deliverable audit gap 3).

Pure stdlib, so this suite runs under any pytest.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app_names import build_app_names, display_name


def _inter(proc, title):
    return {"type": "interaction", "data": {"process_name": proc, "window_title": title}}


def test_a_vocab_scoped_to_the_executable_names_it():
    vocabs = [{"id": "sap-gui", "name": "SAP GUI", "scope": {"process_name": "sapgui.exe"}},
              {"id": "salesforce", "name": "Salesforce (Lightning)",
               "scope": {"window_title_regex": ".*Salesforce.*"}}]
    names = build_app_names([_inter("SAPGUI.exe", "SAP - Create Sales Order (VA01)"),
                             _inter("chrome.exe", "Salesforce - Account lookup")], vocabs)
    assert names["SAPGUI.exe"] == "SAP GUI"
    # A vocab scoped by window title only names no executable.
    assert names["chrome.exe"] == "Chrome"


def test_a_window_title_segment_naming_the_executable_is_used():
    names = build_app_names([
        _inter("EXCEL.EXE", "Book1 - Excel"),
        _inter("EXCEL.EXE", "Excel export of orders.xlsx - Excel"),
        {"type": "activity", "data": {"app": "chrome.exe",
                                      "title": "Account lookup | Salesforce - Google Chrome"}},
    ])
    assert names == {"EXCEL.EXE": "Excel", "chrome.exe": "Google Chrome"}


def test_a_word_inside_another_word_does_not_name_the_app():
    names = build_app_names([_inter("code.exe", "Barcode scanner - notes")])
    assert names == {"code.exe": "Code"}


def test_without_a_vocab_or_a_title_the_executable_name_is_capitalized():
    names = build_app_names([_inter("SAPGUI.exe", "SAP - Create Sales Order (VA01)"),
                             _inter("notepad.exe", "")])
    assert names == {"SAPGUI.exe": "Sapgui", "notepad.exe": "Notepad"}


def test_display_name_finds_a_token_with_or_without_exe_in_any_case():
    names = {"SAPGUI.exe": "SAP GUI"}
    assert display_name("sapgui", names) == "SAP GUI"
    assert display_name("sapgui.exe", names) == "SAP GUI"
    assert display_name("mstsc.exe", names) == "Mstsc"
    assert display_name("Google Chrome") == "Google Chrome"
    assert display_name(None, names) == ""
