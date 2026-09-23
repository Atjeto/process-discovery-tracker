"""The drafting rule (contract C1) and the remembered-names read side (C4).

A drafted step is a stretch of consecutive interactions on one screen within a
run. It ends at a commit interaction (inclusive), at the first interaction on
a different screen (exclusive), or at the end of the run. Every draft carries
`draft_key`, `name_source` and `end_reason`; names and keys never carry a
typed value. stdlib only, so this module runs under a bare pytest too.

Run with:
    pytest normalization/test/test_step_drafting.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_suggest import (  # noqa: E402
    _merge_steps, auto_suggest_steps, draft_summary, load_remembered_names,
)

T0 = datetime(2026, 9, 23, 9, 0, 0, tzinfo=timezone.utc)


def _ts(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _ev(eid, sec, kind, *, ct="Edit", aid="", name="", cls="",
        window="CRM - Orders", proc="crm.exe", value=None, case="run-1", **extra):
    """One interaction event. `case=None` puts it outside any run."""
    data = {"kind": kind, "control_type": ct, "automation_id": aid,
            "name": name, "class_name": cls, "window_title": window,
            "process_name": proc, "case_ids": [case] if case else []}
    if value is not None:
        data["value"] = value
    data.update(extra)
    return {"event_id": eid, "type": "interaction", "timestamp": _ts(sec),
            "session_id": "s1", "data": data}


def _ids(step):
    return step["evidence"]["interaction_event_ids"]


def _by_start(steps):
    return sorted(steps, key=lambda s: s["time_range"]["start"])


# --- (a) commit, (b) screen change, (c) run end ------------------------------

def test_a_commit_ends_its_step_and_belongs_to_it():
    events = [
        _ev("e1", 1, "value_changed", aid="customer", name="Customer", value="C-1"),
        _ev("e2", 2, "invoked", ct="Button", aid="find", name="Find"),
        _ev("e3", 3, "value_changed", aid="note", name="Note", value="n"),
        _ev("e4", 4, "invoked", ct="MenuItem", aid="save", name="Save"),
    ]
    steps = _by_start(auto_suggest_steps(events, session_id="s1"))
    assert [_ids(s) for s in steps] == [["e1", "e2"], ["e3", "e4"]]
    assert [s["end_reason"] for s in steps] == ["commit", "commit"]


def test_every_commit_control_type_ends_a_step():
    for i, ct in enumerate(("Button", "SplitButton", "MenuItem", "Hyperlink")):
        events = [
            _ev("a", 1, "value_changed", aid="f", name="Field", value="x"),
            _ev("b", 2, "invoked", ct=ct, aid=f"c{i}", name="Go"),
            _ev("c", 3, "value_changed", aid="f", name="Field", value="y"),
        ]
        steps = _by_start(auto_suggest_steps(events))
        assert [_ids(s) for s in steps] == [["a", "b"], ["c"]], ct


def test_a_screen_change_ends_the_step_before_the_new_screen():
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        _ev("e2", 2, "selection_changed", ct="ComboBox", aid="b", name="B"),
        _ev("e3", 3, "value_changed", aid="c", name="C", value="2",
            window="CRM - Customers"),
        _ev("e4", 4, "value_changed", aid="d", name="D", value="3",
            window="CRM - Customers"),
    ]
    steps = _by_start(auto_suggest_steps(events))
    assert [_ids(s) for s in steps] == [["e1", "e2"], ["e3", "e4"]]
    assert [s["end_reason"] for s in steps] == ["screen_change", "run_end"]


def test_a_screen_belongs_to_its_app():
    """The same window title in another process is another screen."""
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1", proc="crm.exe"),
        _ev("e2", 2, "value_changed", aid="b", name="B", value="2", proc="erp.exe"),
    ]
    steps = _by_start(auto_suggest_steps(events))
    assert [_ids(s) for s in steps] == [["e1"], ["e2"]]


def test_the_end_of_the_run_closes_the_last_step():
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        _ev("e2", 2, "invoked", ct="ListItem", aid="row", name="Row"),
    ]
    steps = auto_suggest_steps(events)
    assert [_ids(s) for s in steps] == [["e1", "e2"]]
    assert steps[0]["end_reason"] == "run_end"


def test_the_suggestion_reason_says_why_the_draft_ended():
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        _ev("e2", 2, "invoked", ct="Button", aid="find", name="Find"),
        _ev("e3", 3, "value_changed", aid="a", name="A", value="2"),
        _ev("e4", 4, "value_changed", aid="b", name="B", value="3", window="CRM - Home"),
        _ev("o1", 5, "value_changed", aid="c", name="C", value="4", case=None),
    ]
    reasons = {tuple(_ids(s)): s["suggestion_reason"] for s in auto_suggest_steps(events)}
    assert reasons[("e1", "e2")] == (
        'Drafted from 2 interactions on CRM - Orders; ended at the commit "Find".')
    assert reasons[("e3",)] == ("Drafted from 1 interaction on CRM - Orders; "
                                "ended because the next interaction was on another screen.")
    assert reasons[("e4",)] == "Drafted from 1 interaction on CRM - Home; ended at the end of the run."
    assert reasons[("o1",)] == ("Drafted from 1 interaction on CRM - Orders; "
                                "ended at the last interaction outside a run.")


def test_a_single_interaction_is_a_step_and_nothing_is_dropped():
    """The old min-size rule is gone: every filtered interaction lands in
    exactly one draft."""
    events = [
        _ev("e1", 1, "invoked", ct="Button", aid="ok", name="OK"),
        _ev("e2", 2, "focus_changed", aid="x", name="X", window="CRM - Home"),
        _ev("e3", 3, "value_changed", aid="y", name="Y", value="v"),
    ]
    steps = auto_suggest_steps(events)
    landed = sorted(eid for s in steps for eid in _ids(s))
    assert landed == ["e1", "e2", "e3"]
    assert len(steps) == 3


# --- the vocab completion flag and the substring guard ----------------------

def test_the_vocab_completion_flag_ends_a_step_on_any_control():
    """`vocab_semantics.completion: true` ends the step even on a control that
    is not a commit type (here a typed field). Control: the same events
    without the flag stay one step."""
    flagged = [
        _ev("e1", 1, "value_changed", aid="amount", name="Amount", value="10",
            vocab_semantics={"completion": True}),
        _ev("e2", 2, "value_changed", aid="note", name="Note", value="n"),
    ]
    steps = _by_start(auto_suggest_steps(flagged))
    assert [_ids(s) for s in steps] == [["e1"], ["e2"]]
    assert steps[0]["end_reason"] == "commit"
    plain = [dict(e, data={k: v for k, v in e["data"].items()
                           if k != "vocab_semantics"}) for e in flagged]
    assert [_ids(s) for s in auto_suggest_steps(plain)] == [["e1", "e2"]]


def test_only_the_boolean_completion_flag_counts():
    for truthy in ("true", 1, "yes"):
        events = [
            _ev("e1", 1, "invoked", ct="Custom", aid="post", name="Post",
                vocab_semantics={"completion": truthy}),
            _ev("e2", 2, "value_changed", aid="n", name="N", value="v"),
        ]
        assert [_ids(s) for s in auto_suggest_steps(events)] == [["e1", "e2"]], truthy


def test_a_completion_word_inside_a_name_does_not_end_a_step():
    """The old rule matched words inside names, so "Lookup" and "Booking"
    ("ok") or "Save as draft" ended a step. Only the control type and the
    boolean flag count now; none of these is a commit-type control."""
    events = [
        _ev("e1", 1, "invoked", ct="ListItem", aid="l", name="Lookup"),
        _ev("e2", 2, "invoked", ct="TreeItem", aid="b", name="Booking"),
        _ev("e3", 3, "invoked", ct="Custom", aid="d", name="Save as draft",
            meaningful_name="Submit and close"),
        _ev("e4", 4, "selection_changed", ct="TabItem", aid="t", name="Done"),
        _ev("e5", 5, "toggle_changed", ct="CheckBox", aid="c", name="OK to send"),
        _ev("e6", 6, "value_changed", aid="s", name="Search", value="x"),
    ]
    steps = auto_suggest_steps(events)
    assert [_ids(s) for s in steps] == [["e1", "e2", "e3", "e4", "e5", "e6"]]
    assert steps[0]["end_reason"] == "run_end"


# --- runs and out-of-run interactions ---------------------------------------

def test_interactions_outside_any_run_are_drafted_with_case_id_none():
    events = [
        _ev("o1", 1, "value_changed", aid="a", name="A", value="1", case=None),
        _ev("o2", 2, "invoked", ct="Button", aid="go", name="Go", case=None),
        _ev("r1", 3, "value_changed", aid="a", name="A", value="2", case="run-1"),
        _ev("o3", 4, "value_changed", aid="a", name="A", value="3", case=None),
    ]
    steps = auto_suggest_steps(events)
    by_case = {}
    for s in steps:
        by_case.setdefault(s["case_id"], []).append(_ids(s))
    assert by_case == {None: [["o1", "o2"], ["o3"]], "run-1": [["r1"]]}
    out_of_run_end = [s for s in steps if s["case_id"] is None and _ids(s) == ["o3"]]
    assert out_of_run_end[0]["end_reason"] == "run_end"


def test_a_nested_run_is_drafted_under_its_outermost_run():
    events = [_ev("e1", 1, "value_changed", aid="a", name="A", value="1",
                  case=None, case_ids=["inner", "outer"])]
    assert auto_suggest_steps(events)[0]["case_id"] == "outer"


# --- draft_key, default names, name_source ----------------------------------

def test_draft_key_and_default_name_of_a_commit_step():
    events = [
        _ev("e1", 1, "value_changed", aid="c", name="Customer", value="C-1",
            window="Order #10900 - CRM", proc="CRM.EXE"),
        _ev("e2", 2, "invoked", ct="Button", aid="find-btn", name="Find",
            window="Order #10900 - CRM", proc="CRM.EXE"),
    ]
    step = auto_suggest_steps(events)[0]
    # app lowercased and .exe stripped; screen value-free; commit = type:aid
    assert step["draft_key"] == "crm|Order - CRM|Button:find-btn"
    assert step["name"] == "Order - CRM: Find"
    assert step["name_source"] == "draft"
    assert step["state"] == "auto_suggested"


def test_draft_key_of_a_visit_step():
    events = [_ev("e1", 1, "value_changed", aid="c", name="Customer", value="x")]
    step = auto_suggest_steps(events)[0]
    assert step["draft_key"] == "crm|CRM - Orders|(visit)"
    assert step["name"] == "CRM - Orders"


def test_commit_identity_falls_back_from_automation_id_to_name_to_class_name():
    def key_of(**fields):
        ev = _ev("e1", 1, "invoked", ct="Button", **fields)
        return auto_suggest_steps([ev])[0]["draft_key"]
    assert key_of(aid="save-btn", name="Save", cls="btn") == "crm|CRM - Orders|Button:save-btn"
    assert key_of(aid="", name="Save", cls="btn") == "crm|CRM - Orders|Button:Save"
    assert key_of(aid="", name="", cls="btn-primary") == "crm|CRM - Orders|Button:btn-primary"
    assert key_of(aid="", name="", cls="") == "crm|CRM - Orders|Button:?"


def test_the_vocab_screen_id_and_meaningful_name_win():
    events = [_ev("e1", 1, "invoked", ct="Button", aid="b1", name="Btn1",
                  window="SAP Easy Access (VA01)", proc="saplogon.exe",
                  screen_id="va01", meaningful_name="Create sales order")]
    step = auto_suggest_steps(events)[0]
    assert step["draft_key"] == "saplogon|va01|Button:b1"
    assert step["name"] == "va01: Create sales order"


def test_names_keys_and_reasons_never_carry_a_typed_value():
    """The old names embedded the value ("Find - <value>", "Enter <value> in
    Customer"). The typed value below reaches the step (its description
    narrates it, so the fixture is not vacuous) but never a name, a key, a
    reason or a process label."""
    secret = "Quux-4711-ZEBRA-typed"
    events = [
        _ev("e1", 1, "value_changed", aid="customer", name="Customer", value=secret),
        _ev("e2", 2, "invoked", ct="Button", aid="find", name="Find"),
        _ev("e3", 3, "value_changed", aid="note", name="Note", value=secret),
        _ev("e4", 4, "value_changed", aid="x", name="X", value=secret,
            window="CRM - Customers"),
    ]
    steps = _merge_steps([], auto_suggest_steps(events))
    assert len(steps) == 3
    assert any(secret in s["description"] for s in steps)
    for s in steps:
        for field in ("name", "draft_key", "suggestion_reason", "process_label"):
            assert secret not in s[field], f"typed value leaked into {field}"


def test_a_remembered_name_replaces_the_default_and_sets_name_source():
    events = [
        _ev("e1", 1, "value_changed", aid="customer", name="Customer", value="C-1"),
        _ev("e2", 2, "invoked", ct="Button", aid="find", name="Find"),
        _ev("e3", 3, "value_changed", aid="note", name="Note", value="n"),
    ]
    remembered = {"crm|CRM - Orders|Button:find": "Look up the customer"}
    steps = _by_start(auto_suggest_steps(events, remembered_names=remembered))
    assert [s["name"] for s in steps] == ["Look up the customer", "CRM - Orders"]
    assert [s["name_source"] for s in steps] == ["remembered", "draft"]
    assert steps[0]["draft_key"] == "crm|CRM - Orders|Button:find"


def test_a_draft_is_its_own_process_label_even_with_a_dash_in_the_screen():
    """The rule-based strip would cut "Salesforce - Order: Save order" at its
    " - " to "Salesforce"; a drafted or confirmed name is value-free already.
    An edited step keeps the rule-based strip."""
    events = [_ev("e1", 1, "invoked", ct="Button", aid="save", name="Save order",
                  window="Salesforce - Order #10900", proc="chrome.exe")]
    draft = _merge_steps([], auto_suggest_steps(events))[0]
    assert draft["name"] == "Salesforce - Order: Save order"
    assert draft["process_label"] == "Salesforce - Order: Save order"
    confirmed = dict(draft, state="confirmed")
    edited = dict(draft, state="edited", name="Save the order - ORD-1")
    out = {s["state"]: s for s in _merge_steps([confirmed, edited], [])}
    assert out["confirmed"]["process_label"] == "Salesforce - Order: Save order"
    assert out["edited"]["process_label"] == "Save the order"


def test_screenshots_inside_the_time_range_are_attached():
    def shot(eid, sec, path):
        return {"event_id": eid, "type": "system", "timestamp": _ts(sec),
                "data": {"kind": "screenshot", "path": path}}
    events = [
        shot("s0", 0.5, "screenshots/before.jpg"),
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        shot("s1", 1.5, "screenshots/inside.jpg"),
        _ev("e2", 2, "invoked", ct="Button", aid="go", name="Go"),
        shot("s2", 2.0, "screenshots/at-end.jpg"),
        shot("s3", 2.5, "screenshots/between.jpg"),
        _ev("e3", 3, "value_changed", aid="a", name="A", value="2"),
    ]
    steps = _by_start(auto_suggest_steps(events))
    assert steps[0]["evidence"]["screenshot_refs"] == [
        "screenshots/inside.jpg", "screenshots/at-end.jpg"]
    assert steps[1]["evidence"]["screenshot_refs"] == []


# --- remembered-names store (C4 read side) ----------------------------------

def _store(tmp_path, doc, name="remembered-names.json"):
    path = tmp_path / name
    path.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8")
    return path


def _warnings(capsys):
    return [ln for ln in capsys.readouterr().err.splitlines()
            if ln.startswith("[normalize] WARNING:")]


def test_the_names_store_is_read(tmp_path, capsys):
    path = _store(tmp_path, {"version": 1, "names": {
        "crm|CRM - Orders|Button:find": {"name": " Look up customer ",
                                         "updated_at": "2026-09-23T09:00:00Z"}}})
    assert load_remembered_names(path) == {
        "crm|CRM - Orders|Button:find": "Look up customer"}
    assert _warnings(capsys) == []


def test_no_names_flag_means_no_names_and_no_warning(capsys):
    assert load_remembered_names(None) == {}
    assert _warnings(capsys) == []


def test_a_missing_unreadable_or_malformed_store_warns_once_and_falls_back(tmp_path, capsys):
    cases = {
        "missing": tmp_path / "nope.json",
        "bad json": _store(tmp_path, "{not json", "bad.json"),
        "not utf-8": tmp_path / "latin.json",
        "wrong version": _store(tmp_path, {"version": 2, "names": {}}, "v2.json"),
        "names not an object": _store(tmp_path, {"version": 1, "names": []}, "list.json"),
        "not an object": _store(tmp_path, [1, 2], "array.json"),
    }
    cases["not utf-8"].write_bytes(b'{"version": 1, "names": {"k": {"name": "\xe9"}}}')
    for label, path in cases.items():
        assert load_remembered_names(path) == {}, label
        warnings = _warnings(capsys)
        assert len(warnings) == 1, (label, warnings)
        assert str(path) in warnings[0], label


def test_entries_without_a_name_are_skipped_with_one_warning(tmp_path, capsys):
    path = _store(tmp_path, {"version": 1, "names": {
        "good": {"name": "Keep"},
        "blank": {"name": "   "},
        "no-name": {"updated_at": "x"},
        "not-a-dict": "Name",
    }})
    assert load_remembered_names(path) == {"good": "Keep"}
    warnings = _warnings(capsys)
    assert len(warnings) == 1 and "skipped 3" in warnings[0]


# --- re-analysis: preserved one-interaction steps are not re-drafted ---------

def test_a_hidden_one_interaction_step_is_not_re_drafted():
    """A zero-length draft (one interaction) used to escape the overlap drop,
    so re-analysis put a fresh draft back next to the step the analyst hid
    or confirmed."""
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        _ev("e2", 2, "invoked", ct="Button", aid="find", name="Find"),
        _ev("e3", 3, "invoked", ct="Button", aid="save", name="Save"),
    ]
    first = _merge_steps([], auto_suggest_steps(events))
    save = next(s for s in first if _ids(s) == ["e3"])
    save["state"] = "hidden"
    again = _merge_steps(first, auto_suggest_steps(events))
    covering_e3 = [s for s in again if "e3" in _ids(s)]
    assert [s["state"] for s in covering_e3] == ["hidden"]
    assert len(again) == 2


def test_a_one_interaction_draft_touching_an_analyst_step_boundary_is_kept():
    """Only the analyst step's own interactions (or its interior) suppress a
    zero-length draft; a draft on the boundary timestamp with another
    interaction is a different step."""
    events = [
        _ev("e1", 1, "value_changed", aid="a", name="A", value="1"),
        _ev("e2", 2, "invoked", ct="MenuItem", aid="check", name="Check"),
        _ev("e3", 2, "invoked", ct="Button", aid="create", name="Create"),
    ]
    first = _merge_steps([], auto_suggest_steps(events))
    check = next(s for s in first if _ids(s) == ["e1", "e2"])
    check["state"] = "confirmed"
    again = _merge_steps(first, auto_suggest_steps(events))
    create = [s for s in again if _ids(s) == ["e3"]]
    assert len(create) == 1 and create[0]["state"] == "auto_suggested"
    assert len(again) == 2


# --- draft_summary: numbers only ---------------------------------------------

def test_draft_summary_is_numbers_only_in_run_order():
    events = [
        _ev("b1", 20, "value_changed", aid="a", name="Alpha field", value="VALUE-9", case="run-b"),
        _ev("b2", 21, "invoked", ct="Button", aid="", name="Send it", case="run-b"),
        _ev("a1", 1, "value_changed", aid="a", name="Alpha field", value="VALUE-9", case="run-a"),
        _ev("a2", 2, "invoked", ct="Button", aid="go", name="Go", case="run-a"),
        _ev("a3", 3, "invoked", ct="Hyperlink", aid="", name="", cls="lnk", case="run-a"),
        _ev("a4", 4, "value_changed", aid="n", name="N", value="x", case="run-a",
            window="CRM - Customers"),
        _ev("o1", 30, "invoked", ct="Button", aid="", name="", case=None),
    ]
    cases = {
        "run-b": {"case_id": "run-b", "parent_case_id": None, "start_ts": _ts(19)},
        "run-a": {"case_id": "run-a", "parent_case_id": None, "start_ts": _ts(0)},
        "child": {"case_id": "child", "parent_case_id": "run-a", "start_ts": _ts(1)},
        "run-c": {"case_id": "run-c", "parent_case_id": None, "start_ts": _ts(40)},
    }
    drafts = auto_suggest_steps(events, remembered_names={
        "crm|CRM - Orders|Button:go": "Go on"})
    by_id = {e["event_id"]: e for e in events}
    summary = draft_summary(drafts, cases, by_id)
    assert summary == {
        "runs": 3,
        "steps_per_run": [3, 1, 0],
        "out_of_run_steps": 1,
        "end_reason": {"commit": 4, "screen_change": 0, "run_end": 1},
        "name_source": {"remembered": 1, "draft": 4},
        "commit_identity": {"automation_id": 1, "name": 1, "class_name": 1, "?": 1},
    }

    def leaves(x):
        if isinstance(x, dict):
            for v in x.values():
                yield from leaves(v)
        elif isinstance(x, list):
            for v in x:
                yield from leaves(v)
        else:
            yield x
    assert all(type(v) is int for v in leaves(summary))
    text = json.dumps(summary)
    for word in ("Alpha", "VALUE-9", "Send", "Go on", "CRM", "run-a"):
        assert word not in text
