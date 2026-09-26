"""Tests for step_context: where a step happened (its system and screen) and
where it is in the recording, in the reader's words.

Pure stdlib (the vocabularies are passed in), so this suite runs under any
pytest.
"""

from __future__ import annotations
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from step_context import (StepContext, clock, fmt_ms, has_video, screen_of,
                          step_ms, video_start)

SAP_VOCAB = {"id": "sap-gui", "name": "SAP GUI", "scope": {"process_name": "sapgui.exe"},
             "screens": [{"id": "va01", "name": "Create Sales Order (VA01)"}]}
EXCEL_VOCAB = {"id": "excel", "name": "Microsoft Excel", "scope": {"process_name": "excel.exe"},
               "screens": [{"id": "workbook", "name": "Workbook"}]}


def _ctx(interactions, names=None, vocabs=()):
    return StepContext(interactions, names or {}, vocabs=list(vocabs))


def _step(*eids, **extra):
    return {"evidence": {"interaction_event_ids": list(eids)}, **extra}


def test_the_demo_screens_drop_the_segments_that_name_the_system():
    ctx = _ctx({
        "sf": {"process_name": "chrome.exe", "window_title": "Salesforce - Account lookup"},
        "sfo": {"process_name": "chrome.exe", "window_title": "Salesforce - Order #10900"},
        "xl": {"process_name": "EXCEL.EXE", "window_title": "Excel - Order Tracking.xlsx"},
        "ol": {"process_name": "OUTLOOK.EXE", "window_title": "Outlook - Order #10900 confirmation"},
        "np": {"process_name": "notepad.exe", "window_title": "Notepad - Internal mappings.txt"},
    })
    assert ctx.where(_step("sf")) == ("Salesforce", "Account lookup")
    assert ctx.where(_step("sfo")) == ("Salesforce", "Order")           # value-free
    assert ctx.where(_step("xl")) == ("Excel", "Order Tracking.xlsx")
    assert ctx.where(_step("ol")) == ("Outlook", "Order confirmation")
    assert ctx.where(_step("np")) == ("Notepad", "Internal mappings.txt")


def test_a_browser_title_loses_the_browser_and_the_web_system():
    ctx = _ctx({"a": {"process_name": "chrome.exe",
                      "window_title": "Account Lookup | Salesforce - Google Chrome"}},
               {"chrome.exe": "Google Chrome"})
    assert ctx.where(_step("a")) == ("Salesforce", "Account Lookup")


def test_a_vocabulary_screen_name_keeps_what_the_value_rules_strip():
    data = {"process_name": "SAPGUI.exe", "window_title": "SAP - Create Sales Order (VA01)",
            "screen_id": "va01", "vocab_source": {"vocab_id": "sap-gui"}}
    assert _ctx({"s": data}).where(_step("s")) == ("SAP", "Create Sales Order")
    assert _ctx({"s": data}, vocabs=[SAP_VOCAB]).where(_step("s")) == (
        "SAP", "Create Sales Order (VA01)")


def test_a_generic_vocabulary_screen_does_not_replace_a_specific_title():
    data = {"process_name": "EXCEL.EXE", "window_title": "Order Tracking.xlsx - Excel",
            "screen_id": "workbook", "vocab_source": {"vocab_id": "excel"}}
    assert _ctx({"x": data}, vocabs=[EXCEL_VOCAB]).where(_step("x")) == (
        "Excel", "Order Tracking.xlsx")


def test_the_most_common_window_of_a_step_names_it():
    ctx = _ctx({
        "1": {"process_name": "crm.exe", "window_title": "CRM - Orders"},
        "2": {"process_name": "crm.exe", "window_title": "CRM - Orders"},
        "3": {"process_name": "crm.exe", "window_title": "CRM - Customers"},
    }, {"crm.exe": "Contoso CRM"})
    # "CRM" names the system ("Contoso CRM"), so the screen is "Orders".
    assert ctx.where(_step("1", "2", "3")) == ("Contoso CRM", "Orders")


def test_without_interactions_the_grain_keys_then_the_draft_key_are_read():
    ctx = _ctx({}, vocabs=[SAP_VOCAB])
    assert ctx.where(_step(grain_keys={"app": "SAPGUI", "screen": "va01"})) == (
        "SAP", "Create Sales Order (VA01)")
    assert ctx.where(_step(draft_key="excel|Excel - Order Tracking.xlsx|Button:save")) == (
        "Excel", "Order Tracking.xlsx")
    assert ctx.where(_step()) == ("", "")
    assert ctx.where(_step("missing")) == ("", "")


def test_screen_of_is_empty_when_every_segment_names_the_system():
    assert screen_of("Notepad", ["Notepad"]) == ""
    assert screen_of("", ["x"]) == ""
    assert screen_of("Book1 - Excel", ["Excel"]) == "Book1"


def test_clock_formats_positions():
    assert clock(19_400) == "0:19"
    assert clock(725_000) == "12:05"
    assert clock(3_723_000) == "1:02:03"
    for bad in (None, -1, "12", float("nan"), float("inf"), True):
        assert clock(bad) == ""


def test_a_duration_reads_one_way_as_the_viewer_says_it():
    """2.0.1: fmt_ms and the viewer's dom.js formatDuration are one rule:
    never "0s", half a second up, "" for no value."""
    assert fmt_ms(0) == "under 1s"
    assert fmt_ms(999) == "under 1s"
    assert fmt_ms(1000) == "1s"
    assert fmt_ms(2500) == "3s"
    assert fmt_ms(28900) == "29s"
    assert fmt_ms(137000) == "2m 17s"
    assert fmt_ms(180000) == "3m"
    assert fmt_ms(3840000) == "1h 04m"
    for none in (None, -1, float("nan"), float("inf"), True, "12"):
        assert fmt_ms(none) == ""


def test_step_ms_is_the_time_range():
    assert step_ms({"time_range": {"start": "2026-05-14T09:00:01Z",
                                   "end": "2026-05-14T09:00:04.500Z"}}) == 3500
    assert step_ms({"time_range": {"start": "2026-05-14T09:00:05Z",
                                   "end": "2026-05-14T09:00:04Z"}}) == 0
    assert step_ms({}) == 0


def test_the_video_start_prefers_the_synced_attached_video():
    manifest = {"started_at": "2026-05-14T09:00:00Z",
                "obs": {"recording_path": "C:/v.mkv", "recording_start_ts": "2026-05-14T08:59:50Z"}}
    synced = {"external_video": {"path": "D:/call.mp4", "offset_ms": -30000}}
    assert video_start(manifest, synced) == datetime(2026, 5, 14, 8, 59, 30, tzinfo=timezone.utc)
    unsynced = {"external_video": {"path": "D:/call.mp4", "offset_ms": None}}
    assert video_start(manifest, unsynced) == datetime(2026, 5, 14, 8, 59, 50, tzinfo=timezone.utc)
    assert video_start({"started_at": "2026-05-14T09:00:00Z"}, {}) is None
    # A hand-edited offset that is not a usable number falls back to OBS.
    for bad in (float("inf"), float("nan"), 1e20, True, "5"):
        odd = {"external_video": {"path": "D:/call.mp4", "offset_ms": bad}}
        assert video_start(manifest, odd) == datetime(2026, 5, 14, 8, 59, 50, tzinfo=timezone.utc)
    assert has_video(manifest, {}) and has_video({}, synced)
    assert not has_video({}, {}) and not has_video({"obs": {"recording_path": " "}}, {})


def test_a_system_the_analyst_set_on_the_step_wins():
    """C16: `step.system` names the system of a step added by hand, and wins
    over the system derived from a recorded step's interactions; the screen
    stays derived."""
    ctx = _ctx({"xl": {"process_name": "EXCEL.EXE", "window_title": "Excel | Order Tracking.xlsx"}})
    assert ctx.where(_step("xl", system="Finance workbook")) == (
        "Finance workbook", "Order Tracking.xlsx")
    assert ctx.where(_step(system="  SAP  ")) == ("SAP", "")
    assert ctx.where(_step("xl", system="  ")) == ("Excel", "Order Tracking.xlsx")
    assert ctx.where(_step("xl", system=42)) == ("Excel", "Order Tracking.xlsx")


def test_a_step_without_a_time_has_no_duration_and_sorts_by_order_after_the_timed():
    from step_context import step_duration_ms, step_sort_key
    timed = lambda s, e: {"time_range": {"start": s, "end": e}}  # noqa: E731
    assert step_duration_ms(timed("2026-05-14T09:00:01Z", "2026-05-14T09:00:04Z")) == 3000
    assert step_duration_ms(timed("2026-05-14T09:00:05Z", "2026-05-14T09:00:04Z")) == 0
    for untimed in ({}, {"time_range": None}, {"time_range": {}}, {"time_range": "x"},
                    timed("2026-05-14T09:00:01Z", None), timed("bad", "2026-05-14T09:00:01Z")):
        assert step_duration_ms(untimed) is None, untimed
        assert step_ms(untimed) == 0
    steps = [{"n": "b", "time_range": None, "order": 2},
             {"n": "none", "time_range": None},
             {"n": "t2", **timed("2026-05-14T09:00:05Z", "2026-05-14T09:00:06Z")},
             {"n": "a", "time_range": None, "order": 1},
             {"n": "bool", "time_range": None, "order": True},
             {"n": "t1", **timed("2026-05-14T09:00:01Z", "2026-05-14T09:00:02Z")}]
    assert [s["n"] for s in sorted(steps, key=step_sort_key)] == [
        "t1", "t2", "a", "b", "none", "bool"]


def test_a_draft_whose_screen_the_drafting_made_value_free_says_that_screen():
    """Lane LF-PIPE (#8): a customer's name in the order form's title is left
    out of the draft's screen across the transactions (the draft_key's
    screen holds an ellipsis); the PDD's context line, its Data section and
    Applications and time then say that screen, not this transaction's
    title. Any other step keeps the screen of its title."""
    title = "New order for Contoso Ltd - Order Desk - Google Chrome"
    ctx = _ctx({"q": {"process_name": "chrome.exe", "window_title": title}})
    drafted = _step("q", draft_key="chrome|New order for \u2026 - Order Desk|Button:btn-save-order")
    # 2.0.1: the site the title ends with is the system, so the screen
    # leaves it out.
    assert ctx.where(drafted) == ("Order Desk", "New order for \u2026")
    assert ctx.value_free_screen(drafted, "Order Desk") == "New order for \u2026"
    plain = _step("q", draft_key="chrome|New order for Contoso Ltd - Order Desk|(visit)")
    assert ctx.where(plain) == ("Order Desk", "New order for Contoso Ltd")
    assert ctx.value_free_screen(_step("q"), "Google Chrome") == ""
