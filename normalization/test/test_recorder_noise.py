"""What the recorder saw that the user did not do (recorder_noise, lane
LF-PIPE): each rule on a small synthetic stream, and the live recordings'
cases they come from (D:\\pdt-scratch\\live, LIVE-RECORDINGS-REPORT.md, the
finding's number with each), cut down to the fields the rule reads.

Pure stdlib, so this suite runs under a bare pytest too.

Run with:
    pytest normalization/test/test_recorder_noise.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from recorder_noise import clean_recorder_noise, is_blank_value, leave_out_not_the_users  # noqa: E402
from step_suggest import auto_suggest_steps  # noqa: E402

T0 = datetime(2026, 9, 25, 23, 30, 0, tzinfo=timezone.utc)
OBJ = "\ufffc"
SEP = " " + chr(45) + " "
CHROME_TITLE = "Customer lookup" + SEP + "Order Desk" + SEP + "Google Chrome"
ORDER_TITLE = "New order for Contoso Ltd" + SEP + "Order Desk" + SEP + "Google Chrome"


def _ts(ms: int) -> str:
    """A recorder timestamp: UTC with milliseconds."""
    return (T0 + timedelta(milliseconds=ms)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ev(eid, ms, kind, *, ct="Edit", aid="", name="", cls="", title=CHROME_TITLE,
        proc="chrome.exe", **extra):
    data = {"kind": kind, "control_type": ct, "automation_id": aid, "name": name,
            "class_name": cls, "window_title": title, "process_name": proc}
    data.update(extra)
    for key in [k for k, v in data.items() if v is None]:
        del data[key]
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(ms), "data": data}


def _marker(eid, ms, kind="start"):
    return {"event_id": eid, "type": "marker", "timestamp": _ts(ms),
            "data": {"marker_type": kind, "label": None}}


def _kept(events):
    out, report = clean_recorder_noise(events)
    return [e["event_id"] for e in out if e.get("type") == "interaction"], report


# ---- #4: an empty field is not a typed value ---------------------------------------

def test_a_value_made_only_of_the_object_character_or_blanks_is_empty():
    """#4 (rec01 _seq 13 to 15: Quantity, Delivery date and Notes read U+FFFC
    as the order form rendered): an empty field is no typed value, no field,
    no data. A value the recorder did not record (no value at all, a
    secret) is not an empty one."""
    assert is_blank_value(OBJ) and is_blank_value(" " + OBJ + " ") and is_blank_value("")
    assert not is_blank_value("2") and not is_blank_value(None) and not is_blank_value(OBJ + "x")
    events = [
        _ev("q", 0, "value_changed", aid="ord-qty", name="Quantity", value=OBJ),
        _ev("n", 2000, "value_changed", aid="ord-notes", name="Notes", value="  "),
        _ev("p", 4000, "value_changed", aid="pw", name="Password", value_redacted=True),
        _ev("u", 6000, "value_changed", aid="pin", name="Approval PIN"),
        _ev("t", 8000, "value_changed", aid="ord-qty", name="Quantity", value="2"),
    ]
    kept, report = _kept(events)
    assert kept == ["p", "u", "t"]
    assert report["dropped"] == {"empty_value": 2}


# ---- #2: a click without identity, and the window a click lost ----------------------

def test_a_click_without_identity_is_left_out_and_a_named_click_gets_its_window():
    """#2 (rec01 _seq 9 to 10 and 23): the "Select" click on a customer row
    arrived with no control type, name, id, window or program; the "Save
    order" click with its name and title but no program. The first says
    nothing and is left out; the second takes the program its title was
    recorded in."""
    events = [
        _marker("m1", 0),
        _ev("typed", 1000, "value_changed", aid="cust-query", name="Customer name or number",
            value="Contoso"),
        _ev("search", 1400, "invoked", ct="Button", aid="btn-search", name="Search"),
        _ev("anon", 3000, "invoked", ct=None, aid=None, name=None, cls=None, title=None, proc=None),
        _ev("qty", 8000, "value_changed", aid="ord-qty", name="Quantity", value="2", title=ORDER_TITLE),
        _ev("save", 9000, "invoked", ct="Button", aid="btn-save-order", name="Save order",
            title=ORDER_TITLE, proc=None),
    ]
    out, report = clean_recorder_noise(events)
    kept = {e["event_id"]: e["data"] for e in out if e["type"] == "interaction"}
    assert "anon" not in kept and report["dropped"] == {"no_identity": 1}
    assert kept["save"]["process_name"] == "chrome.exe" and report["filled"] == 1
    # The input stream is never changed (the raw events stay as recorded).
    assert "process_name" not in events[-1]["data"]


def test_a_click_without_window_takes_it_from_the_interaction_before_else_after_in_its_transaction():
    """#2 and #13 (rec08 _seq 61: Excel's pasted cell arrived with neither
    window nor program, after Excel's own events; rec11 _seq 63: "Back to
    queue", the first action after an idle end, took its page from the one
    after it)."""
    excel = "order-tracker.xlsx" + SEP + "Excel"
    events = [
        _marker("m1", 0),
        _ev("cell1", 1000, "value_changed", ct="DataItem", aid="E2", name="E2", value="Live Tester",
            title=excel, proc="EXCEL.exe"),
        _ev("paste", 2000, "value_changed", ct="DataItem", aid="A3", name=None, value="SO-48220",
            title=None, proc=None),
        _marker("m2", 3000, "end"),
        _ev("back", 4000, "invoked", ct="Button", aid="", name="Back to queue", title=None, proc=None),
        _ev("next", 5000, "value_changed", aid="search", name="Search tickets", value="Wi-Fi",
            title="Ticket queue" + SEP + "Service Desk" + SEP + "Google Chrome"),
    ]
    out, _report = clean_recorder_noise(events)
    got = {e["event_id"]: e["data"] for e in out if e["type"] == "interaction"}
    assert (got["paste"]["process_name"], got["paste"]["window_title"]) == ("EXCEL.exe", excel)
    assert got["back"]["process_name"] == "chrome.exe"
    assert got["back"]["window_title"].startswith("Ticket queue")


def test_a_page_changing_click_first_on_its_page_takes_the_window_the_capture_app_saw():
    """The live recording through the packaged app: "New order" on the saved
    order's page lost its window (the page was going), and the interaction
    before it was on the order form, and the address bar's value after Save
    read the order form's title. The capture app's foreground row, begun
    after the last interaction on the form, names the saved page. A row begun
    before the interaction before lends nothing: that interaction is newer."""
    saved = "Order SO-48213 saved" + SEP + "Order Desk" + SEP + "Google Chrome"
    bar = {"ct": "Edit", "aid": "view_1012", "name": "Address and search bar", "cls": "OmniboxViewViews"}

    def row(ms, dur, title):
        return {"event_id": "a" + str(ms), "type": "activity", "timestamp": _ts(ms),
                "data": {"app": "Google Chrome", "title": title, "pid": 7, "duration_ms": dur}}

    events = [
        _marker("m1", 0),
        row(100, 5000, ORDER_TITLE),
        _ev("notes", 2000, "value_changed", aid="notes", name="Notes", value="Dock 4",
            title=ORDER_TITLE, pid=7),
        _ev("save", 3000, "invoked", ct="Button", aid="btn-save", name="Save order",
            title=ORDER_TITLE, pid=7),
        row(5100, 4000, saved),
        _ev("url", 5500, "value_changed", value="127.0.0.1/orderdesk.html#saved",
            title=ORDER_TITLE, pid=7, **bar),
        _ev("new", 7000, "invoked", ct="Button", aid="btn-new", name="New order", title=None, pid=7),
        _ev("print", 8000, "invoked", ct="Hyperlink", aid="lnk-print", name="Print", title=None, pid=7),
    ]
    out, _report = clean_recorder_noise(events)
    got = {e["event_id"]: e["data"] for e in out if e["type"] == "interaction"}
    assert got["new"]["window_title"] == saved
    assert got["print"]["window_title"] == saved
    # Without a row of its own, the click takes the interaction before, as before.
    plain = [e for e in events if e["type"] != "activity"]
    out, _report = clean_recorder_noise(plain)
    got = {e["event_id"]: e["data"] for e in out if e["type"] == "interaction"}
    assert got["new"]["window_title"] == ORDER_TITLE


def test_drafting_a_click_without_identity_ends_no_step_and_no_step_is_named_app():
    """#2: no "(screen)" step in a made-up system "App". A click without
    identity never ends a step as a commit; a step's app is its program or
    "(app)", and a screen without a title is named by the program."""
    events = [
        _ev("typed", 1000, "value_changed", aid="q", name="Customer", value="C-1",
            case_ids=["run-1"]),
        _ev("anon", 2000, "invoked", ct="Button", aid="", name="", case_ids=["run-1"]),
        _ev("xl", 3000, "value_changed", ct="DataItem", aid="A2", name="A2", value="1",
            title=None, proc="EXCEL.exe", case_ids=["run-1"]),
        _ev("none", 4000, "value_changed", aid="f", name="Field", value="x", title=None,
            proc=None, case_ids=["run-1"]),
    ]
    steps = sorted(auto_suggest_steps(events), key=lambda s: s["time_range"]["start"])
    assert [s["end_reason"] for s in steps] == ["screen_change", "screen_change", "run_end"]
    assert steps[0]["draft_key"].endswith("|(visit)")
    assert steps[1]["name"] == "Excel" and steps[1]["grain_keys"]["app"] == "EXCEL"
    assert steps[2]["grain_keys"]["app"] == "(app)"
    assert all("App" not in (s["grain_keys"]["app"], s["name"]) for s in steps)


# ---- #6: what the screen did by itself ------------------------------------------------

def test_a_screen_rendering_is_not_the_users_the_burst_from_its_first_empty_field():
    """#6 (rec10 _seq 4 and 5: the sign-in page rendered its empty user name
    and its password field at the same millisecond): from the burst's first
    empty field on, the changes are the screen rendering. A change before
    it is the user's (rec06 _seq 65 and 66: "euro" typed in Search for,
    then Character Map cleared Go to Unicode)."""
    events = [
        _ev("user", 0, "value_changed", aid="username", name="User name", value=OBJ),
        _ev("pw", 0, "value_changed", aid="password", name="Password"),
        _ev("typed", 5000, "value_changed", aid="132", name="Search for :", value="euro",
            proc="charmap.exe", title="Character Map"),
        _ev("cleared", 5002, "value_changed", aid="701", name="Go to Unicode :", value="",
            proc="charmap.exe", title="Character Map"),
    ]
    kept, report = _kept(events)
    assert kept == ["typed"]
    assert report["dropped"] == {"empty_value": 2, "render": 1}


def test_a_change_within_50_ms_after_the_users_change_on_another_element_is_the_screens_reaction():
    """#6 (rec06 _seq 91 and 92: 50 typed into Paint's Horizontal, and 5 ms
    later Vertical followed, keeping the aspect ratio; _seq 94 and 95: the
    Pencil tool on, Brushes off): the user changes one element at a time."""
    paint = "Untitled" + SEP + "Paint"
    events = [
        _ev("h", 0, "value_changed", aid="HorizontalResizeTextBox", name="Horizontal", value="50",
            proc="mspaint.exe", title=paint),
        _ev("v", 5, "value_changed", aid="VerticalResizeTextBox", name="Vertical", value="50",
            proc="mspaint.exe", title=paint),
        _ev("pencil", 2000, "toggle_changed", ct="Button", aid="PencilTool", name="Pencil",
            toggle_state="1", proc="mspaint.exe", title=paint),
        _ev("brushes", 2007, "toggle_changed", ct="RadioButton", aid="BrushesSplitButton",
            name="Brushes", toggle_state="0", proc="mspaint.exe", title=paint),
        _ev("width", 2600, "value_changed", aid="W", name="Width", value="3",
            proc="mspaint.exe", title=paint),
    ]
    kept, report = _kept(events)
    assert kept == ["h", "pencil", "width"]
    assert report["dropped"] == {"reaction": 2}


def test_a_choice_or_toggle_within_150_ms_after_a_click_on_another_element_is_the_new_screens_default():
    """#6 (rec01 _seq 10 and 11: 34 ms after the row's click, the order
    form's product dropdown reported its default option; rec06 _seq 82 to
    84: Paint's Resize dialog set Percentage and Maintain aspect ratio)."""
    events = [
        _ev("click", 0, "invoked", ct=None, aid=None, name=None, cls=None, title=None, proc=None),
        _ev("default", 34, "selection_changed", ct="ListItem", name="Laptop stand LS-200",
            selected_value="Laptop stand LS-200"),
        _ev("later", 2000, "selection_changed", ct="ListItem", name="Office chair OC-7",
            selected_value="Office chair OC-7"),
    ]
    kept, report = _kept(events)
    assert kept == ["later"]
    assert report["dropped"] == {"no_identity": 1, "after_click": 1}


def test_the_office_ribbon_mirrors_the_selection_its_clicks_stay():
    """#6 (rec05 _seq 5, 11 and 21: Excel's Bold and Bottom Align toggles and
    its Font box follow the selected cell; rec03 _seq 12 to 14: Word's zoom
    reported 100 on a window switch). The ribbon's Save click stays."""
    book = "orders-week40.xlsx" + SEP + "Excel"
    xl = {"proc": "EXCEL.exe", "title": book}
    events = [
        _ev("cell", 0, "value_changed", ct="DataItem", aid="A2", name="A2", value="SO-48213", **xl),
        _ev("bold", 400, "toggle_changed", ct="Button", aid="Bold", name="Bold",
            cls="NetUIRibbonButton", toggle_state="0", **xl),
        _ev("font", 900, "value_changed", ct="ComboBox", aid="Font", name="Font",
            cls="NetUIComboboxAnchor", value="Aptos Narrow", **xl),
        _ev("save", 3000, "invoked", ct="Button", aid="FileSave", name="Save",
            cls="NetUIRibbonButton", **xl),
    ]
    kept, report = _kept(events)
    assert kept == ["cell", "save"]
    assert report["dropped"] == {"office_ribbon": 2}


def test_a_ribbon_change_the_user_made_stays():
    """rec03 (Word): Transaction 1 was the Font Size typed (14) and Bold on
    and off (_seq 4 to 6), with nothing else of Word around them: the
    user's own clicks and keys, which the recording holds no event for.
    They stay, and the transaction gets its step back. The zoom saying 100
    as the next letter came to the front (_seq 12 to 14) is the ribbon's
    state and goes. A ribbon change a click on that control came just
    before stays even beside a cell's change; one that only follows the
    selected cell goes."""
    novak = {"proc": "WINWORD.exe", "title": "letter-novak.docx" + SEP + "Word"}
    horvat = {"proc": "WINWORD.exe", "title": "letter-horvat.docx" + SEP + "Word"}
    ribbon = {"ct": "Button", "cls": "NetUIRibbonButton"}
    t1, t2 = {"case_ids": ["run-1"]}, {"case_ids": ["run-2"]}
    events = [
        _ev("size", 557452, "value_changed", name="Font Size", cls="NetUITextbox", value="14",
            **novak, **t1),
        _ev("bold1", 566148, "toggle_changed", aid="Bold", name="Bold", toggle_state="1",
            **ribbon, **novak, **t1),
        _ev("bold0", 568678, "toggle_changed", aid="Bold", name="Bold", toggle_state="0",
            **ribbon, **novak, **t1),
        _ev("out", 582642, "value_changed", ct="Button", name="Zoom Out",
            cls="NetUIRepeatButton", value="100", **horvat, **t2),
        _ev("in", 582747, "value_changed", ct="Button", name="Zoom In",
            cls="NetUIRepeatButton", value="100", **horvat, **t2),
        _ev("zoom", 582825, "value_changed", ct="Slider", name="Zoom", cls="NetUISlider",
            value="100", **horvat, **t2),
        _ev("bold2", 588820, "toggle_changed", aid="Bold", name="Bold", toggle_state="1",
            **ribbon, **horvat, **t2),
        _ev("save", 597429, "invoked", aid="FileSave", name="Save", **ribbon, **horvat, **t2),
    ]
    kept, report = _kept(events)
    assert kept == ["size", "bold1", "bold0", "bold2", "save"]
    assert report["dropped"] == {"office_ribbon": 3}
    steps = auto_suggest_steps(clean_recorder_noise(events)[0])
    assert sorted(s["case_id"] for s in steps) == ["run-1", "run-2"]
    book = {"proc": "EXCEL.exe", "title": "orders-week40.xlsx" + SEP + "Excel"}
    events = [
        _ev("cell", 0, "value_changed", ct="DataItem", aid="A2", name="A2", value="SO-48213",
            **book),
        _ev("click", 300, "invoked", aid="Bold", name="Bold", **ribbon, **book),
        _ev("bold", 400, "toggle_changed", aid="Bold", name="Bold", toggle_state="1",
            **ribbon, **book),
        _ev("next", 3000, "value_changed", ct="DataItem", aid="B2", name="B2", value="4",
            **book),
        _ev("echo", 3300, "toggle_changed", aid="Bold", name="Bold", toggle_state="0",
            **ribbon, **book),
    ]
    kept, report = _kept(events)
    assert kept == ["cell", "click", "bold", "next"]
    assert report["dropped"] == {"office_ribbon": 1}


# ---- #7: one choice reported twice ----------------------------------------------------

def test_one_action_reported_twice_counts_once():
    """#7 (rec01 _seq 19 to 21: one click on the Standard radio button gave a
    toggle, a click and a choice, 9 and 8 ms apart; rec06 _seq 67 and 68:
    Reset reported twice 5 ms apart)."""
    events = [
        _ev("toggle", 0, "toggle_changed", ct="RadioButton", aid="pri-std", name="Standard",
            toggle_state="1"),
        _ev("click", 9, "invoked", ct="RadioButton", aid="pri-std", name="Standard"),
        _ev("choice", 17, "selection_changed", ct="RadioButton", aid="pri-std", name="Standard",
            selected_value="Standard"),
        _ev("again", 5000, "invoked", ct="Button", aid="btn-search", name="Search"),
    ]
    kept, report = _kept(events)
    assert kept == ["toggle", "again"]
    assert report["dropped"] == {"repeat": 2}


def test_a_dropdowns_list_item_repeating_its_value_is_the_same_choice():
    """#7 (rec01 _seq 42 and 43: the Product dropdown got "Office chair OC-7"
    and its list item reported the same option 190 ms later): the field is
    the dropdown's name, never the option's text."""
    events = [
        _ev("combo", 0, "value_changed", ct="ComboBox", aid="ord-product", name="Product",
            value="Office chair OC-7"),
        _ev("item", 190, "selection_changed", ct="ListItem", name="Office chair OC-7",
            selected_value="Office chair OC-7"),
        _ev("other", 3000, "selection_changed", ct="ListItem", name="Desk lamp DL-5",
            selected_value="Desk lamp DL-5"),
    ]
    kept, report = _kept(events)
    assert kept == ["combo", "other"]
    assert report["dropped"] == {"dropdown_echo": 1}


def test_the_same_choice_twice_in_a_row_is_one():
    """#7 (rec06: typing a font name in Character Map reported each font
    again and again, 57 to 100 ms apart)."""
    cm = {"proc": "charmap.exe", "title": "Character Map"}
    events = [
        _ev("a", 0, "selection_changed", ct="ListItem", name="Segoe UI", selected_value="Segoe UI", **cm),
        _ev("b", 90, "selection_changed", ct="ListItem", name="Segoe UI", selected_value="Segoe UI", **cm),
        _ev("c", 400, "selection_changed", ct="ListItem", name="Segoe UI Symbol",
            selected_value="Segoe UI Symbol", **cm),
    ]
    kept, report = _kept(events)
    assert kept == ["a", "c"]
    assert report["dropped"] == {"repeat_choice": 1}


# ---- #11, #13, #25 -------------------------------------------------------------------

def test_a_desktop_choice_no_click_caused_is_left_out():
    """#11 (rec08 _seq 5, rec09 11, rec10 6, rec11 9: explorer.exe's
    "Program Manager" reported a desktop icon's selection while the desktop
    was hidden behind maximized windows)."""
    events = [
        _ev("icon", 0, "selection_changed", ct="ListItem", aid="ListViewItem-81", name="Some game",
            selected_value="Some game", proc="explorer.exe", title="Program Manager"),
        _ev("folder", 3000, "selection_changed", ct="ListItem", aid="row-2", name="Invoices",
            selected_value="Invoices", proc="explorer.exe", title="Documents"),
    ]
    kept, report = _kept(events)
    assert kept == ["folder"]
    assert report["dropped"] == {"desktop": 1}


def test_a_choice_in_a_window_without_a_title_is_a_transient_popup():
    """#13 (rec05 _seq 15, 27 to 32: Excel's formula AutoComplete reported
    EDATE, DATE, SUM from a window without a title; the cells stay)."""
    book = "orders-week40.xlsx" + SEP + "Excel"
    events = [
        _ev("d2", 0, "value_changed", ct="DataItem", aid="D2", name="D2", value="2",
            proc="EXCEL.exe", title=book),
        _ev("edate", 400, "selection_changed", ct="ListItem", name="EDATE", selected_value="EDATE",
            proc="EXCEL.exe", title=""),
        _ev("e2", 600, "value_changed", ct="DataItem", aid="E2", name="E2", value="49,9",
            proc="EXCEL.exe", title=book),
    ]
    kept, report = _kept(events)
    assert kept == ["d2", "e2"]
    assert report["dropped"] == {"popup": 1}


def test_a_typed_address_and_the_page_it_opened_are_one_navigation():
    """#25: the address bar's values on the way to a page count as one
    navigation (the last); it is never a step (the drafting's browser
    filter) nor a field (pdd_export._entered)."""
    bar = {"ct": "Edit", "aid": "view_1012", "name": "Address and search bar", "cls": "OmniboxViewViews"}
    events = [
        _ev("typed", 0, "value_changed", value="salesforce.com", **bar),
        _ev("page", 1200, "value_changed", value="https://login.salesforce.com/", **bar),
        _ev("field", 6000, "value_changed", aid="user", name="Username", value="a@b.c"),
    ]
    kept, report = _kept(events)
    assert kept == ["page", "field"]
    assert report["dropped"] == {"navigation": 1}


def test_a_log_without_milliseconds_keeps_its_close_events():
    """The rules measured in milliseconds leave a log without them alone (a
    hand-made demo stamps whole seconds: two fields typed in one second are
    not a reaction)."""
    events = [
        {"event_id": "a", "type": "interaction", "timestamp": "2026-05-12T08:52:03Z",
         "data": {"kind": "value_changed", "name": "Unit price", "value": "49.99",
                  "process_name": "chrome.exe", "window_title": "Salesforce"}},
        {"event_id": "b", "type": "interaction", "timestamp": "2026-05-12T08:52:03Z",
         "data": {"kind": "value_changed", "name": "Shipping address", "value": "144 Maple Ave",
                  "process_name": "chrome.exe", "window_title": "Salesforce"}},
    ]
    kept, report = _kept(events)
    assert kept == ["a", "b"] and report["dropped_total"] == 0


# ---- The recorder marks a program's own change; the pipeline leaves it out ----

def test_a_change_the_recorder_marked_as_the_programs_own_is_left_out_and_counted():
    """The recorder writes a change no user act explains with "user_acted":
    false instead of dropping it (the owner, 2026-09-26: nothing a misjudged
    program does is lost from the raw recording); the pipeline leaves it out
    of the steps and counts it."""
    events = [
        _ev("typed", 0, "value_changed", aid="qty", name="Quantity", value="2"),
        _ev("filled", 800, "value_changed", aid="date", name="Delivery date", value="01.10.2026",
            user_acted=False),
        _ev("save", 3000, "invoked", ct="Button", aid="btn-save", name="Save order"),
    ]
    kept, report = _kept(events)
    assert kept == ["typed", "save"]
    assert report["dropped"] == {"not_the_users": 1}
    assert report["dropped_total"] == 1
    rest, n = leave_out_not_the_users(events)
    assert [e["event_id"] for e in rest] == ["typed", "save"] and n == 1


def test_a_programs_own_change_never_takes_the_place_of_the_users_value_of_that_field():
    """The marked change leaves before the typing bursts are coalesced: the
    coalescing keeps the last value of a run on one field, and a program's
    change right after the user's typing would otherwise replace it."""
    from pipeline_stages import _run_coalesce
    events = [
        _marker("m1", 0),
        _ev("c", 1000, "value_changed", aid="cust", name="Customer", value="Con"),
        _ev("contoso", 1400, "value_changed", aid="cust", name="Customer", value="Contoso"),
        _ev("program", 1700, "value_changed", aid="cust", name="Customer", value="Contoso Ltd",
            user_acted=False),
    ]
    _coalesced, edited, _edits, noise = _run_coalesce(events, {}, {"coalesce_idle_ms": 1500})
    values = [e["data"].get("value") for e in edited if e["type"] == "interaction"]
    assert values == ["Contoso"]
    assert noise["dropped"].get("not_the_users") == 1
