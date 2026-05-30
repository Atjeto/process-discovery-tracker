"""Smoke tests for the step auto-suggestion pass.

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


def test_splits_on_idle_gap():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base),
        _make_inter(base + timedelta(milliseconds=200)),
        # 15s idle gap (> step_split_idle_ms=10000)
        _make_inter(base + timedelta(seconds=15)),
        _make_inter(base + timedelta(seconds=15, milliseconds=200)),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2


def test_multiple_apps_within_threshold_stay_one_step():
    """v0.13: app/process changes no longer split steps."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base, window="Window A"),
        _make_inter(base + timedelta(milliseconds=200), window="Window A"),
        _make_inter(base + timedelta(milliseconds=400), window="Window B"),
        _make_inter(base + timedelta(milliseconds=600), window="Window B"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1


def test_drops_singletons_below_min_threshold():
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert steps == []


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


# --- Suggestion reason (I5) --------------------------------------------

def test_auto_step_carries_a_suggestion_reason():
    """An auto-suggested step explains why its interactions were grouped."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [_make_inter(base + timedelta(milliseconds=i * 500)) for i in range(4)]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    reason = steps[0]["suggestion_reason"]
    assert "Grouped 4 interactions" in reason
    assert "threshold" in reason


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
    assert "Enter" in steps[0]["name"]


def test_typing_burst_keeps_the_final_value():
    """The coalesced event keeps the last (complete) typed value."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "C"),
        _make_value_changed(base + timedelta(milliseconds=200), "CE"),
        _make_value_changed(base + timedelta(milliseconds=400), "CE done"),
    ]
    coalesced = coalesce_typing_bursts(events)
    steps = auto_suggest_steps(coalesced, session_id="s1")
    assert len(steps) == 1
    assert "CE done" in steps[0]["name"]


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


# --- A4: element-boundary step splitting -------------------------------

def test_distinct_fields_split_into_separate_steps():
    """A4: typing into two DIFFERENT named fields yields two steps, not one
    glued blob -- the dominant over-grouping the element split fixes."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "SN12345", name="Serial Number"),
        _make_value_changed(base + timedelta(milliseconds=300), "Banking", name="Industry"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2


def test_element_split_can_be_disabled():
    """A4: step_split_on_element=False restores the pre-A4 grouping --
    the two fields collapse back into one step."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_value_changed(base, "SN12345", name="Serial Number"),
        _make_value_changed(base + timedelta(milliseconds=300), "Banking", name="Industry"),
    ]
    steps = auto_suggest_steps(events, session_id="s1", step_split_on_element=False)
    assert len(steps) == 1


def test_type_then_action_stays_one_step():
    """A4: a value->action transition is NOT split -- typing a serial then
    clicking Search in the same window stays one step (good naming/coupling)."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    typed = _make_value_changed(base, "SN12345", name="Serial", window="TAMBA")
    btn = _make_inter(base + timedelta(milliseconds=300), kind="invoked",
                      name="Search", window="TAMBA")
    steps = auto_suggest_steps([typed, btn], session_id="s1")
    assert len(steps) == 1


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
    returns to it. Identical re-selections collapse to one, and a lone
    tab switch is not substantial enough to be its own step."""
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
    assert steps == []


def test_completion_action_splits_step():
    """An invoked Button with a completion word in its name closes the step."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base, kind="invoked", name="Open form"),
        _make_inter(base + timedelta(seconds=1), kind="invoked", name="Fill field"),
        _make_inter(base + timedelta(seconds=2), kind="invoked", name="Search"),
        _make_inter(base + timedelta(seconds=3), kind="invoked", name="View result"),
        _make_inter(base + timedelta(seconds=4), kind="invoked", name="Copy data"),
    ]
    for ev in events:
        ev["data"]["control_type"] = "Button"
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3
    assert len(steps[1]["evidence"]["interaction_event_ids"]) == 2


def test_three_apps_within_5s_one_step():
    """v0.13 §8.1: 3 apps within 5s -> 1 step (no app split)."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base, window="App A", proc="a.exe"),
        _make_inter(base + timedelta(seconds=2), window="App B", proc="b.exe"),
        _make_inter(base + timedelta(seconds=4), window="App C", proc="c.exe"),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1


def test_15s_gap_splits_into_two_steps():
    """v0.13 §8.1: 15s gap -> 2 steps."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    events = [
        _make_inter(base),
        _make_inter(base + timedelta(milliseconds=200)),
        _make_inter(base + timedelta(seconds=15)),
        _make_inter(base + timedelta(seconds=15, milliseconds=200)),
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 2


def test_step_name_does_not_echo_app_prefix():
    """A step whose only nameable interaction is a tab switch must not be
    named 'TAMBA: TAMBA -  ' -- the tab title just echoes the app."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    tab = _make_inter(base, kind="selection_changed", window="TAMBA -  ",
                      name="TAMBA -  ")
    tab["data"]["control_type"] = "TabItem"
    tab["data"]["selected_value"] = "TAMBA -  "
    click = _make_inter(base + timedelta(milliseconds=300), kind="invoked",
                        window="TAMBA -  ", name="")
    steps = auto_suggest_steps([tab, click], session_id="s1")
    assert len(steps) == 1
    label = steps[0]["name"].split(": ", 1)[-1]
    assert "TAMBA" not in label


def test_volatile_window_title_suffix_does_not_split_steps():
    """v0.13: app/process changes no longer split -- volatile title
    suffixes are also safe since neither key splits on them now."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    titles = [
        "ES CALL MANAGEMENT - Memory usage - 95.2 MB - Work - Microsoft Edge",
        "ES CALL MANAGEMENT - Work - Microsoft Edge",
        "ES CALL MANAGEMENT - Memory usage - 96.4 MB - Work - Microsoft Edge",
    ]
    events = [
        _make_inter(base + timedelta(milliseconds=i * 300), kind="invoked",
                    window=t, proc="msedge.exe", name="Open")
        for i, t in enumerate(titles)
    ]
    steps = auto_suggest_steps(events, session_id="s1")
    assert len(steps) == 1
    assert len(steps[0]["evidence"]["interaction_event_ids"]) == 3


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


def test_step_name_includes_the_value_acted_on():
    """A step that types a value then clicks a button names both, so it
    is recognisable from the list without opening its interactions."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    typed = _make_value_changed(base, "SN12345", name="Serial")
    btn = _make_inter(base + timedelta(seconds=1), kind="invoked", name="Search")
    steps = auto_suggest_steps([typed, btn], session_id="s1")
    assert len(steps) == 1
    name = steps[0]["name"]
    assert "Search" in name
    assert "SN12345" in name


def test_step_name_for_one_field_shows_value_and_field():
    """Typing into a single named field names the value and the field."""
    base = datetime(2026, 5, 14, 9, 0, 0)
    ev = _make_value_changed(base, "SN12345", name="Serial Number")
    steps = auto_suggest_steps([ev], session_id="s1")
    assert len(steps) == 1
    name = steps[0]["name"]
    assert "SN12345" in name
    assert "Serial Number" in name


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
