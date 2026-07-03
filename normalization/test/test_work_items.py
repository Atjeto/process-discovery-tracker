"""Tests for work_items -- the case-scoped screen visit for the export path
(ADR-0028 §4). Pure stdlib (no docx, no pandas), so this suite RUNS under a
bare system pytest as well as the bundled python -- it is the deps-free
coverage of the grouping logic behind the (docx-gated) PDD export tests.

Run: python -m pytest normalization/test/test_work_items.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from work_items import (
    build_work_items, screen_key, find_group_annotation, UNASSIGNED_CASE,
)


def _step(step_id, case_id, screen, start):
    """A minimal analyzed step: the fields the grouping reads (case_id,
    grain_keys.screen, time_range.start, state)."""
    return {
        "step_id": step_id,
        "case_id": case_id,
        "grain_keys": {"element": step_id, "screen": screen, "app": "app"},
        "time_range": {"start": start, "end": start},
        "state": "auto_suggested",
    }


def test_screen_key_matches_grainkey_screen_format():
    # "scr:" + value-free screen label -- the exact grainKey(step,"screen").
    # A record number in the window title is stripped (Order #10900 -> Order).
    assert screen_key(_step("s", "c", "Salesforce - Order #10900", "t")) == "scr:Salesforce - Order"
    assert screen_key(_step("s", "c", "va01", "t")) == "scr:va01"


def test_screen_key_missing_grain_keys_falls_back_to_placeholder():
    assert screen_key({"step_id": "s"}) == "scr:(screen)"
    assert screen_key({"step_id": "s", "grain_keys": {}}) == "scr:(screen)"


def test_non_consecutive_merge_folds_bounces_within_a_case():
    """The whole point of ADR-0028: fragments of one screen-visit merge back
    together across an app bounce WITHIN a case (SAP -> Excel -> SAP -> one SAP
    work item), unlike ADR-0024's consecutive roll-up."""
    steps = [
        _step("a", "c1", "va01", "2026-05-14T09:00:00Z"),                # SAP
        _step("b", "c1", "Excel - Order Tracking.xlsx", "2026-05-14T09:00:05Z"),  # bounce away
        _step("c", "c1", "va01", "2026-05-14T09:00:10Z"),                # back to SAP
    ]
    res = build_work_items(steps, [])
    assert res["has_cases"] is True
    assert len(res["cases"]) == 1
    items = res["cases"][0]["work_items"]
    # Two distinct screens -> two work items; the SAP visit folds BOTH SAP
    # fragments though they were not consecutive.
    by_key = {wi["screen_key"]: wi for wi in items}
    assert set(by_key) == {"scr:va01", "scr:Excel - Order Tracking.xlsx"}
    assert by_key["scr:va01"]["step_ids"] == ["a", "c"]
    assert by_key["scr:Excel - Order Tracking.xlsx"]["step_ids"] == ["b"]
    # Order is by first appearance: SAP first.
    assert items[0]["screen_key"] == "scr:va01"


def test_group_annotation_name_note_waste_flow_in():
    steps = [_step("a", "c1", "va01", "2026-05-14T09:00:00Z")]
    ga = [{"case_id": "c1", "screen_key": "scr:va01",
           "name": "Re-key order into SAP", "notes": "half of this is re-keying",
           "waste": True, "manually_authored": True}]
    res = build_work_items(steps, ga)
    wi = res["cases"][0]["work_items"][0]
    assert wi["label"] == "Re-key order into SAP"      # name wins over screen label
    assert wi["notes"] == "half of this is re-keying"
    assert wi["waste"] is True
    assert wi["group_annotation"] is ga[0]


def test_unnamed_work_item_falls_back_to_screen_label():
    steps = [_step("a", "c1", "Salesforce - Order #10900", "2026-05-14T09:00:00Z")]
    res = build_work_items(steps, [])
    wi = res["cases"][0]["work_items"][0]
    assert wi["label"] == "Salesforce - Order"         # value-free screen label
    assert wi["waste"] is False
    assert wi["notes"] == ""
    assert wi["group_annotation"] is None


def test_no_cases_signals_fallback():
    """Every step case_id null -> has_cases False (the caller keeps its current
    rendering rather than one giant Unassigned bucket)."""
    steps = [
        {"step_id": "a", "grain_keys": {"screen": "va01"},
         "time_range": {"start": "2026-05-14T09:00:00Z"}, "state": "auto_suggested"},
    ]
    res = build_work_items(steps, [])
    assert res["has_cases"] is False
    # It still groups them under the Unassigned pseudo-case (never dropped).
    assert len(res["cases"]) == 1
    assert res["cases"][0]["case_id"] is None


def test_hidden_steps_excluded():
    steps = [
        _step("a", "c1", "va01", "2026-05-14T09:00:00Z"),
        dict(_step("b", "c1", "va01", "2026-05-14T09:00:05Z"), state="hidden"),
    ]
    res = build_work_items(steps, [])
    wi = res["cases"][0]["work_items"][0]
    assert wi["step_ids"] == ["a"]                      # the hidden fragment is gone


def test_unassigned_case_sorts_last():
    steps = [
        {"step_id": "u", "case_id": None, "grain_keys": {"screen": "va01"},
         "time_range": {"start": "2026-05-14T08:00:00Z"}, "state": "auto_suggested"},
        _step("a", "c1", "va01", "2026-05-14T09:00:00Z"),
    ]
    res = build_work_items(steps, [])
    assert [c["case_id"] for c in res["cases"]] == ["c1", None]


def test_find_group_annotation_null_case_matches_unassigned():
    ga = [{"case_id": None, "screen_key": "scr:va01", "name": "x"}]
    assert find_group_annotation(ga, None, "scr:va01") is ga[0]
    assert find_group_annotation(ga, "c1", "scr:va01") is None
    # Absent case_id in the entry also treated as null.
    ga2 = [{"screen_key": "scr:va01", "name": "y"}]
    assert find_group_annotation(ga2, None, "scr:va01") is ga2[0]


def test_empty_and_none_inputs_are_safe():
    assert build_work_items(None, None) == {"cases": [], "has_cases": False}
    assert build_work_items([], []) == {"cases": [], "has_cases": False}


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
