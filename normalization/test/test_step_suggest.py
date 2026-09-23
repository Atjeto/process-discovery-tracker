"""Smoke tests for the step pass: grain keys, excluded ranges, overlap,
coalescing, browser-chrome filtering, descriptions and value-free labels.
The drafting rule itself (contract C1) is tested in test_step_drafting.py.

Run with:
    pytest normalization/test/test_step_suggest.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from coalesce import coalesce_typing_bursts
from step_suggest import (
    auto_suggest_steps, drop_overlapping_auto_steps, steps_overlap_seconds,
    process_label, parse_ts, step_grain_keys, _merge_steps,
)


def test_parse_ts_normalizes_naive_to_aware():
    """A hand-edited timestamp without a zone parses naive; parse_ts must return
    it tz-aware so it compares/subtracts against the zone-aware timestamps in the
    same case instead of raising "can't subtract offset-naive and offset-aware".
    Found by the step-segmenter fuzzer."""
    naive = parse_ts("2026-05-18T09:00:00")        # no Z / offset
    aware = parse_ts("2026-05-18T09:00:05Z")
    assert naive.tzinfo is not None and aware.tzinfo is not None
    assert (aware - naive).total_seconds() == 5    # subtraction must not raise


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _make_inter(ts: datetime, kind: str = "invoked", window: str = "App", proc: str = "app.exe", name: str = "Button"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "session_id": "s1",
        "data": {
            "kind": kind,
            "window_title": window,
            "process_name": proc,
            "name": name,
            "case_ids": ["case-1"],
        },
    }


# --- ADR-0024: grain-roll-up containment keys --------------------------

def _inter_full(ts, *, kind, automation_id="", name="", value="",
                window="App", proc="app.exe", screen_id=None):
    """A richer interaction for grain-key tests (carries the fields the
    containment keys resolve from)."""
    data = {
        "kind": kind, "window_title": window, "process_name": proc,
        "automation_id": automation_id, "name": name, "value": value,
        "case_ids": ["case-1"],
    }
    if screen_id is not None:
        data["screen_id"] = screen_id
    return {"event_id": str(uuid.uuid4()), "type": "interaction",
            "timestamp": _iso(ts), "session_id": "s1", "data": data}


def test_step_grain_keys_resolves_element_screen_app():
    """element = the field TYPED into; screen = vocab screen_id when present;
    app = process_name with .exe stripped."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    evs = [
        _inter_full(base, kind="selection_changed", name="Message", proc="OUTLOOK.exe"),
        _inter_full(base + timedelta(seconds=1), kind="value_changed",
                    automation_id="4117", name="To", value="a@x.com",
                    proc="OUTLOOK.exe", screen_id="compose"),
        _inter_full(base + timedelta(seconds=2), kind="value_changed",
                    automation_id="4117", name="To", value="a@x.com",
                    proc="OUTLOOK.exe", screen_id="compose"),
    ]
    gk = step_grain_keys(evs)
    # prefers the typed field (4117) over the incidental Message tab
    assert gk["element"] == "4117"
    assert gk["screen"] == "compose"
    assert gk["app"] == "OUTLOOK"


def test_step_grain_keys_falls_back_to_window_title_then_placeholder():
    base = datetime(2026, 5, 14, 9, 0, 0)
    # No vocab screen_id, no process_name -> screen falls back to window_title.
    ev = _inter_full(base, kind="invoked", name="Save", window="Booking — Acme", proc="")
    gk = step_grain_keys([ev])
    assert gk["screen"] == "Booking — Acme"
    assert gk["element"] == "Save"
    # No interactions at all -> placeholders, never blank.
    assert step_grain_keys([]) == {"element": "(element)", "screen": "(screen)", "app": "(app)"}


def test_auto_suggest_stamps_grain_keys_on_every_step():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_inter_full(base + timedelta(milliseconds=i * 300),
                          kind="value_changed", automation_id="F" + str(i),
                          name="Field" + str(i), value="v" + str(i))
              for i in range(3)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert steps, "expected at least one step"
    for s in steps:
        assert "grain_keys" in s
        assert set(s["grain_keys"]) == {"element", "screen", "app"}


def test_merge_steps_resolves_grain_keys_from_interaction_map():
    """A canonical/manual step lacking grain_keys gets them resolved from its
    evidence when _merge_steps is given the interaction map."""
    ev = _inter_full(datetime(2026, 5, 14, 9, 0, 0), kind="value_changed",
                     automation_id="9001", name="Serial", value="SN-1",
                     proc="crm.exe", screen_id="lookup")
    manual = {
        "step_id": "m1", "name": "Search serial", "state": "manually_authored",
        "case_id": "case-1", "evidence": {"interaction_event_ids": [ev["event_id"]]},
        "time_range": {"start": ev["timestamp"], "end": ev["timestamp"]},
    }
    merged = _merge_steps([manual], [], {ev["event_id"]: ev})
    assert len(merged) == 1
    assert merged[0]["grain_keys"] == {"element": "9001", "screen": "lookup", "app": "crm"}


def test_groups_contiguous_interactions_into_one_step():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert steps[0]["state"] == "auto_suggested"
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 4


# --- Excluded ranges (H6) ----------------------------------------------

def test_excluded_range_drops_events_before_suggestion():
    """Interactions inside an annotations excluded_range are dropped
    before step suggestion -- here the middle two of four."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    excluded = [{
        "start": _iso(base + timedelta(milliseconds=400)),
        "end": _iso(base + timedelta(milliseconds=1100)),
        "reason": "manual",
    }]
    steps = auto_suggest_steps(events, session_id="s1", excluded_ranges=excluded)
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 2


def test_excluded_range_can_remove_a_whole_step():
    """An excluded range covering every interaction yields no steps."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    excluded = [{
        "start": _iso(base - timedelta(seconds=1)),
        "end": _iso(base + timedelta(seconds=10)),
        "reason": "manual",
    }]
    steps = auto_suggest_steps(events, session_id="s1", excluded_ranges=excluded)
    assert steps == []


def test_malformed_excluded_range_is_ignored():
    """A range missing start/end must not crash or drop events."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(
        events, session_id="s1", excluded_ranges=[{"reason": "manual"}])
    assert len(steps) == 1


# --- Step overlap (I37) ------------------------------------------------

def _step(state, start, end):
    return {"step_id": str(uuid.uuid4()), "state": state,
            "time_range": {"start": start, "end": end}}


def test_steps_overlap_seconds_measures_intersection():
    a = _step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")
    b = _step("manually_authored", "2026-05-14T09:00:30Z", "2026-05-14T09:02:00Z")
    assert steps_overlap_seconds(a, b) == 30.0


def test_steps_overlap_seconds_zero_when_disjoint():
    a = _step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")
    c = _step("manually_authored", "2026-05-14T10:00:00Z", "2026-05-14T10:01:00Z")
    assert steps_overlap_seconds(a, c) == 0.0


def test_drop_overlapping_auto_steps_drops_heavy_overlap():
    """A fresh auto step >50% covered by an analyst-owned step is dropped."""
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T09:00:00Z", "2026-05-14T09:00:50Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(dropped) == 1
    assert kept == []


def test_drop_overlapping_auto_steps_keeps_light_overlap():
    """20s overlap on a 60s fresh step = 33% < 50% -- kept."""
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T09:00:40Z", "2026-05-14T09:05:00Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(kept) == 1
    assert dropped == []


def test_drop_overlapping_auto_steps_keeps_disjoint():
    fresh = [_step("auto_suggested", "2026-05-14T09:00:00Z", "2026-05-14T09:01:00Z")]
    preserved = [_step("manually_authored", "2026-05-14T11:00:00Z", "2026-05-14T11:01:00Z")]
    kept, dropped = drop_overlapping_auto_steps(fresh, preserved)
    assert len(kept) == 1
    assert dropped == []


# --- value_changed / selection coalescing (typing-noise fix) -----------

def _make_value_changed(ts, value, *, automation_id="", name="",
                        control_type="Edit", window="TAMBA",
                        proc="chrome.exe"):
    """A value_changed event. Defaults model a Chrome web-app field --
    empty automation_id AND empty name -- the case the recorder's own
    coalescer cannot key, so the keystroke flood reaches step suggestion."""
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "session_id": "s1",
        "data": {
            "kind": "value_changed",
            "control_type": control_type,
            "automation_id": automation_id,
            "name": name,
            "class_name": "",
            "window_title": window,
            "process_name": proc,
            "value": value,
            "case_ids": ["case-1"],
        },
    }


def test_typing_burst_on_identityless_control_coalesces_to_one_step():
    """A keystroke-by-keystroke value_changed flood into one Chrome field
    collapses to a single step via coalesce_typing_bursts + auto_suggest."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    text = "CE removed paper jam from receipt printer"
    events = [
        _make_value_changed(base + timedelta(milliseconds=i * 200), text[:i + 1])
        for i in range(len(text))
    ]
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 1
    # C1: a draft is named by its screen, never by the text typed into it.
    assert steps[0]["name"] == "TAMBA"
    assert text not in steps[0]["name"]


def test_typing_burst_keeps_the_final_value():
    """The coalesced event keeps the last (complete) typed value; the step's
    description narrates it (names carry no typed value, C1)."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "C"),
        _make_value_changed(base + timedelta(milliseconds=200), "CE"),
        _make_value_changed(base + timedelta(milliseconds=400), "CE done"),
    ]
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    assert '"CE done"' in steps[0]["description"]


def test_two_identityless_fields_split_by_focus_stay_separate():
    """Coalescing folds a *run* -- a focus_changed between two field
    edits breaks it, so the two fields are not merged into one."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "first field"),
        _make_value_changed(base + timedelta(milliseconds=200), "first field x"),
        _make_inter(base + timedelta(milliseconds=400), kind="focus_changed",
                    window="TAMBA", proc="chrome.exe", name=""),
        _make_value_changed(base + timedelta(milliseconds=600), "second"),
        _make_value_changed(base + timedelta(milliseconds=800), "second field"),
    ]
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    # two coalesced typing events + the focus event = 3 interactions
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3


# --- Browser-chrome noise filter (ADR-0009 fact-find) ------------------

def test_browser_chrome_noise_is_filtered():
    """Address-bar typing and browser tab switches are dropped as navigation
    noise; web-app fields are kept."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    omni = _make_value_changed(base, "https://tamba", name="Address and search bar")
    omni["data"]["class_name"] = "OmniboxViewViews"
    tab = _make_inter(base + timedelta(milliseconds=200),
                      kind="selection_changed", name="TAMBA")
    tab["data"]["control_type"] = "TabItem"
    tab["data"]["class_name"] = "Tab"
    f1 = _make_value_changed(base + timedelta(milliseconds=400), "AB123", name="Serial")
    f1["data"]["class_name"] = "form-control"
    f2 = _make_value_changed(base + timedelta(milliseconds=600), "Done", name="Notes")
    f2["data"]["class_name"] = "form-control"
    steps = auto_suggest_steps([omni, tab, f1, f2], session_id="s1")
    all_ids = [i for s in steps for i in s["evidence"]["interaction_event_ids"]]
    assert omni["event_id"] not in all_ids
    assert tab["event_id"] not in all_ids
    assert f1["event_id"] in all_ids
    assert f2["event_id"] in all_ids


def test_browser_chrome_filter_can_be_disabled():
    """filter_browser_chrome=False keeps the browser-frame interactions."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    omni = _make_value_changed(base, "url", name="addr")
    omni["data"]["class_name"] = "OmniboxViewViews"
    field = _make_value_changed(base + timedelta(milliseconds=300), "x", name="Serial")
    field["data"]["class_name"] = "form-control"
    steps = auto_suggest_steps([omni, field], session_id="s1", filter_browser_chrome=False)
    all_ids = [i for s in steps for i in s["evidence"]["interaction_event_ids"]]
    assert omni["event_id"] in all_ids


def test_repeated_identical_tab_selection_collapses():
    """The OS re-fires selection_changed on a tab every time focus
    returns to it. Identical re-selections collapse to one; the drafting
    rule keeps that one interaction as a draft (nothing is dropped for
    being short)."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base + timedelta(milliseconds=i * 300),
                    kind="selection_changed", window="TAMBA -  ",
                    name="TAMBA -  ")
        for i in range(5)
    ]
    for ev in events:
        ev["data"]["control_type"] = "TabItem"
        ev["data"]["selected_value"] = "TAMBA -  "
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    assert steps[0]["evidence"]["interaction_event_ids"] == [events[0]["event_id"]]


# --- Step description (interaction summary) ----------------------------

def test_step_description_summarizes_typed_value():
    """An auto step's description names the value entered and the field."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _make_value_changed(base, "SN12345", name="Serial Number")
    steps = auto_suggest_steps([ev], session_id="s1")
    assert len(steps) == 1
    desc = steps[0]["description"]
    assert "SN12345" in desc
    assert "Serial Number" in desc


def test_step_description_reports_coalesced_keystroke_count():
    """A coalesced typing burst's description reports the keystroke count."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    text = "resolved"
    events = [
        _make_value_changed(base + timedelta(milliseconds=i * 150),
                            text[:i + 1], name="Notes")
        for i in range(len(text))
    ]
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    desc = steps[0]["description"]
    assert "keystrokes" in desc
    assert str(len(text)) in desc


def test_step_description_summarizes_clicks():
    """A step of button clicks reads as a list of clicked actions."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base, kind="invoked", name="Open form"),
        _make_inter(base + timedelta(seconds=1), kind="invoked", name="Add note"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    desc = steps[0]["description"]
    assert desc == "Clicked Open form. Clicked Add note."


def test_step_description_summarizes_a_toggle():
    """A toggle_changed interaction reads as 'turned X on/off'."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    toggle = _make_inter(base, kind="toggle_changed", name="Remember me")
    toggle["data"]["toggle_state"] = "on"
    click = _make_inter(base + timedelta(seconds=1), kind="invoked", name="Sign in")
    steps = auto_suggest_steps([toggle, click], session_id="s1")
    assert len(steps) == 1
    assert "Turned Remember me on" in steps[0]["description"]


def test_step_description_handles_text_changed_and_unknown_kinds():
    """text_changed reads as 'edited X'; an unrecognised future kind
    degrades to a generic phrase instead of being dropped."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    txt = _make_inter(base, kind="text_changed", name="Comments")
    unknown = _make_inter(base + timedelta(seconds=1),
                          kind="range_value_changed", name="Volume")
    steps = auto_suggest_steps([txt, unknown], session_id="s1")
    assert len(steps) == 1
    desc = steps[0]["description"]
    assert "Edited Comments." in desc
    assert "Range value changed on Volume." in desc


def test_step_description_caps_long_steps_with_a_tail():
    """A step with more actions than the cap ends with a 'Plus N more'
    sentence rather than an unbounded run-on."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base + timedelta(seconds=i), kind="invoked", name=f"Btn{i}")
        for i in range(10)
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    desc = steps[0]["description"]
    assert desc.endswith("Plus 4 more actions.")


# --- process_label: value-free step labels for the step-level map/flow -------

def test_process_label_strips_trailing_value_object():
    assert process_label("Salesforce: Search — CUST-10001") == "Salesforce: Search"
    assert process_label("iLost: Create sales order — Order #10080") == "iLost: Create sales order"
    assert process_label("Salesforce: Open customer record — SKU-4471") == "Salesforce: Open customer record"


def test_process_label_keeps_field_drops_typed_value():
    assert process_label("Salesforce: Enter 25 in Quantity") == "Salesforce: Enter Quantity"
    assert process_label("iLost: Enter 1035 in Sales organization") == "iLost: Enter Sales organization"
    assert process_label("Outlook: Enter Order #10087 confirmed in Subject") == "Outlook: Enter Subject"


def test_process_label_collapses_across_cases():
    """The whole point: different cases' value-laden names map to one label."""
    assert (process_label("Salesforce: Search — CUST-10001")
            == process_label("Salesforce: Search — CUST-10009")
            == "Salesforce: Search")


def test_process_label_leaves_value_free_names_untouched():
    assert process_label("Salesforce: Fill Customer ID field") == "Salesforce: Fill Customer ID field"
    assert process_label("Lookup customer") == "Lookup customer"   # analyst rename
    assert process_label("") == ""


# --- G-4: label hygiene on real-session shapes --------------------------------

def test_masked_value_renders_as_masked_value_in_names():
    """A PII redaction token («password#3f9a1c0e») must never show raw in a
    user-facing step name or description."""
    t0 = datetime(2026, 5, 18, 9, 0, 0)
    evs = [
        _inter_full(t0, kind="value_changed", name="Password",
                    value="«password#f02847ea»", window="ES CALL MANAGEMENT"),
        _inter_full(t0 + timedelta(seconds=2), kind="value_changed",
                    name="Password", value="«password#f02847ea»",
                    window="ES CALL MANAGEMENT"),
    ]
    steps = auto_suggest_steps(evs, session_id="s1")
    assert len(steps) == 1
    assert "«" not in steps[0]["name"]
    assert "«" not in steps[0]["description"]
    assert "masked value" in (steps[0]["name"] + steps[0]["description"])


def test_junk_null_value_does_not_leak_into_names():
    """The old capture (v0.9.0) emits the literal string 'null' as a typed
    value; it must not become 'App: Enter null'."""
    t0 = datetime(2026, 5, 18, 9, 0, 0)
    evs = [
        _inter_full(t0, kind="value_changed", value="null", window="TAMBA"),
        _inter_full(t0 + timedelta(seconds=2), kind="value_changed",
                    value="null", window="TAMBA"),
    ]
    steps = auto_suggest_steps(evs, session_id="s1")
    assert len(steps) == 1
    assert "null" not in steps[0]["name"].lower()
    assert '"null"' not in steps[0]["description"]
