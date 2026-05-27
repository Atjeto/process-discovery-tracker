"""Parity tests for the Python recognition port (ADR-0011).

These mirror viewer/recognition.test.js so both sides of the shared signature
table (shared/recognition-patterns.json) stay in lock-step. Cases use the REAL
class_name / control_type strings documented in ADR-0011.

Run with:
    pytest normalization/test/test_recognition.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from recognition import recognize, is_browser_chrome


def d(**kw):
    return dict(kw)


def test_non_string_fields_degrade_not_crash():
    """A corrupt/hand-edited log can carry a non-string class_name / control_type
    (the load boundary guarantees a dict `data`, not its value types). recognize
    must coerce and classify, not crash on .lower() / substring matching. Found
    by the step-segmenter fuzzer."""
    r = recognize(d(control_type=42, class_name=7))
    assert isinstance(r, dict) and "category" in r
    assert is_browser_chrome(d(control_type=42, class_name=7)) in (True, False)


# --- Chromium / Edge browser chrome ------------------------------------

def test_omnibox_is_browser_chrome():
    r = recognize(d(control_type="Edit", class_name="OmniboxViewViews",
                    framework_id="Chrome", automation_id="view_1012"))
    assert r["isChrome"] is True
    assert r["category"] == "browser_chrome"
    assert is_browser_chrome(d(class_name="OmniboxViewViews")) is True


def test_browser_tab_switch_is_chrome():
    assert recognize(d(control_type="TabItem", class_name="Tab"))["isChrome"] is True
    assert recognize(d(control_type="TabItem", class_name="EdgeTab"))["isChrome"] is True


def test_toolbar_buttons_are_chrome():
    for c in ("BackForwardButton", "ReloadButton", "AppMenuButton",
              "NewTabButton", "TabStripControlButton"):
        assert recognize(d(control_type="Button", class_name=c))["isChrome"] is True, c


# --- Web-app frameworks (NOT chrome) -----------------------------------

def test_ag_grid_cell():
    r = recognize(d(control_type="Edit", class_name="ag-cell-edit-input"))
    assert r["category"] == "grid_cell"
    assert r["framework"] == "ag-grid"
    assert r["isChrome"] is False


def test_bootstrap_form_and_primary_button():
    assert recognize(d(control_type="Edit", class_name="form-control"))["category"] == "form_field"
    # btn-primary must win over a co-present form-control-style class.
    btn = recognize(d(control_type="Button", class_name="btn btn-primary"))
    assert btn["category"] == "primary_action"


def test_validation_decorated_form_control_still_matches():
    r = recognize(d(control_type="Edit", class_name="input-validation-error form-control"))
    assert r["category"] == "form_field"


def test_sharepoint_plain_vs_richtext():
    plain = recognize(d(control_type="Edit",
                        class_name="ReactFieldEditor-core--display ReactFieldEditor-TextMultiLine"))
    assert plain["category"] == "form_field"
    rich = recognize(d(control_type="Edit",
                       class_name="ReactFieldEditor-core--display ReactFieldEditor-RichText"))
    assert rich["category"] == "rich_text"


def test_office365_search_and_comment():
    assert recognize(d(control_type="ComboBox",
                       class_name="abc o365sx-searchBoxActive"))["category"] == "search"
    assert recognize(d(control_type="Edit",
                       class_name="od-addNewCommentTextField-mentionableTextBox"))["category"] == "comment"


def test_win32_office():
    assert recognize(d(control_type="Edit", class_name="RichEdit20WPT",
                       framework_id="Win32"))["category"] == "rich_text"
    assert recognize(d(control_type="Pane", class_name="NetUIHWND"))["category"] == "office_ui"


# --- UIA ControlType base layer ----------------------------------------

def test_uia_base_layer():
    assert recognize(d(control_type="Edit"))["category"] == "text_entry"
    assert recognize(d(control_type="Button"))["category"] == "action"
    assert recognize(d(control_type="ComboBox"))["category"] == "selection"
    assert recognize(d(control_type="CheckBox"))["category"] == "toggle"
    assert recognize(d(control_type="TreeItem"))["category"] == "tree_nav"


def test_uia_base_is_not_chrome():
    # A plain control with no framework class is generic, never chrome.
    assert recognize(d(control_type="Edit", class_name="some-app-field"))["isChrome"] is False


def test_unknown_control_degrades_gracefully():
    r = recognize(d(control_type=""))
    assert r["category"] == "unknown"
    assert r["typeLabel"] == "control"


def test_none_data_is_safe():
    r = recognize(None)
    assert r["category"] == "unknown"
    assert is_browser_chrome(None) is False
