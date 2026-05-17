"""Tests for classification_overrides.apply_classification_overrides.

Run with pytest:
    pytest normalization/test/test_classification_overrides.py
or directly, with no pytest needed:
    python normalization/test/test_classification_overrides.py
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from classification_overrides import apply_classification_overrides


def _activity(event_id, app, title, label):
    return {
        "type": "activity",
        "event_id": event_id,
        "data": {"app": app, "title": title, "activity_label": label},
    }


def test_no_overrides_returns_unchanged():
    events = [_activity("e1", "chrome.exe", "x", "Unclassified -- chrome.exe")]
    out, n = apply_classification_overrides(events, {})
    assert n == 0 and out is events
    out, n = apply_classification_overrides(events, None)
    assert n == 0


def test_instance_override():
    events = [_activity("e1", "chrome.exe", "x", "Unclassified -- chrome.exe")]
    anno = {"classification_overrides": [
        {"scope": "instance", "event_id": "e1", "label": "CRM -- Salesforce"},
    ]}
    out, n = apply_classification_overrides(events, anno)
    assert n == 1
    assert out[0]["data"]["activity_label"] == "CRM -- Salesforce"


def test_rule_override_by_title():
    events = [
        _activity("e1", "chrome.exe", "Salesforce - Account lookup", "Unclassified -- chrome.exe"),
        _activity("e2", "chrome.exe", "Random news site", "Unclassified -- chrome.exe"),
    ]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"app": "chrome.exe", "title_regex": ".*Salesforce.*"},
         "label": "CRM -- Salesforce"},
    ]}
    out, n = apply_classification_overrides(events, anno)
    assert n == 1
    assert out[0]["data"]["activity_label"] == "CRM -- Salesforce"
    assert out[1]["data"]["activity_label"] == "Unclassified -- chrome.exe"  # no match


def test_rule_app_constraint_excludes_other_apps():
    events = [_activity("e1", "EXCEL.EXE", "Salesforce notes.xlsx", "Spreadsheet -- Excel")]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"app": "chrome.exe", "title_regex": ".*Salesforce.*"},
         "label": "CRM -- Salesforce"},
    ]}
    out, n = apply_classification_overrides(events, anno)
    assert n == 0  # app differs -> not matched
    assert out[0]["data"]["activity_label"] == "Spreadsheet -- Excel"


def test_instance_wins_over_rule():
    events = [_activity("e1", "chrome.exe", "Salesforce - x", "Unclassified -- chrome.exe")]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"title_regex": ".*Salesforce.*"}, "label": "RULE"},
        {"scope": "instance", "event_id": "e1", "label": "INSTANCE"},
    ]}
    out, _ = apply_classification_overrides(events, anno)
    assert out[0]["data"]["activity_label"] == "INSTANCE"


def test_rule_first_match_wins():
    events = [_activity("e1", "chrome.exe", "Salesforce - x", "Unclassified -- chrome.exe")]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"title_regex": ".*Sales.*"}, "label": "FIRST"},
        {"scope": "rule", "match": {"title_regex": ".*Salesforce.*"}, "label": "SECOND"},
    ]}
    out, _ = apply_classification_overrides(events, anno)
    assert out[0]["data"]["activity_label"] == "FIRST"


def test_malformed_regex_is_skipped_not_fatal():
    events = [_activity("e1", "chrome.exe", "x", "Unclassified -- chrome.exe")]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"title_regex": "["}, "label": "BAD"},          # invalid regex
        {"scope": "instance", "event_id": "e1", "label": "CRM -- Salesforce"},     # still applies
    ]}
    out, n = apply_classification_overrides(events, anno)  # must not raise
    assert n == 1
    assert out[0]["data"]["activity_label"] == "CRM -- Salesforce"


def test_noop_override_not_counted():
    events = [_activity("e1", "chrome.exe", "x", "CRM -- Salesforce")]
    anno = {"classification_overrides": [
        {"scope": "instance", "event_id": "e1", "label": "CRM -- Salesforce"},
    ]}
    _, n = apply_classification_overrides(events, anno)
    assert n == 0  # label already correct -> nothing applied


def test_non_activity_events_passthrough():
    events = [
        {"type": "marker", "event_id": "m1", "data": {}},
        _activity("e1", "chrome.exe", "Salesforce - x", "Unclassified -- chrome.exe"),
    ]
    anno = {"classification_overrides": [
        {"scope": "rule", "match": {"title_regex": ".*Salesforce.*"}, "label": "CRM -- Salesforce"},
    ]}
    out, n = apply_classification_overrides(events, anno)
    assert n == 1
    assert out[0]["type"] == "marker"


def test_input_not_mutated():
    events = [_activity("e1", "chrome.exe", "Salesforce - x", "Unclassified -- chrome.exe")]
    anno = {"classification_overrides": [
        {"scope": "instance", "event_id": "e1", "label": "CRM -- Salesforce"},
    ]}
    apply_classification_overrides(events, anno)
    assert events[0]["data"]["activity_label"] == "Unclassified -- chrome.exe"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print(f"{len(tests)} passed")
