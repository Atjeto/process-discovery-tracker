"""Tests for classification.collapse_activity_occurrences.

This is the collapse that makes a directly-follows self-loop structurally
impossible: consecutive same-label activity events become one occurrence.

Run with pytest:
    pytest normalization/test/test_classification.py
or directly, with no pytest needed (e.g. the bundled embeddable Python):
    python normalization/test/test_classification.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from classification import (
    collapse_activity_occurrences, classify_events, upsert_taxonomy_rules,
    load_taxonomy,
)


def _activity(label, title, dur, case_ids=("c1",)):
    return {
        "type": "activity",
        "data": {
            "app": "chrome.exe",
            "title": title,
            "activity_label": label,
            "case_ids": list(case_ids),
            "duration_ms": dur,
        },
    }


def _other(kind):
    return {"type": kind, "data": {}}


def test_consecutive_same_label_merge_across_interactions():
    """Two same-label events with different titles, separated by interaction
    events, collapse into one occurrence with summed duration. This is the
    self-loop case -- it must not survive into the event log."""
    events = [
        _activity("CRM -- Salesforce", "Account lookup", 1000),
        _other("interaction"),
        _other("interaction"),
        _activity("CRM -- Salesforce", "Order entry", 2000),
    ]
    out = collapse_activity_occurrences(events)
    acts = [e for e in out if e["type"] == "activity"]
    assert len(acts) == 1, acts
    assert acts[0]["data"]["duration_ms"] == 3000
    assert sum(1 for e in out if e["type"] == "interaction") == 2


def test_marker_between_does_not_block_merge():
    """A marker between two same-label events must not block the merge --
    markers are stripped from the trace, so they would otherwise reappear
    as a self-loop."""
    events = [
        _activity("SAP -- Sales Order", "t1", 500),
        _other("marker"),
        _activity("SAP -- Sales Order", "t2", 500),
    ]
    acts = [e for e in collapse_activity_occurrences(events) if e["type"] == "activity"]
    assert len(acts) == 1
    assert acts[0]["data"]["duration_ms"] == 1000


def test_distinct_labels_not_merged():
    events = [
        _activity("CRM -- Salesforce", "x", 100),
        _activity("SAP -- Sales Order", "y", 100),
    ]
    acts = [e for e in collapse_activity_occurrences(events) if e["type"] == "activity"]
    assert len(acts) == 2


def test_genuine_cycle_preserved():
    """A, B, A is a real cycle through B -- it must stay three events so the
    DFG keeps the A->B and B->A edges. Only A->A self-loops are eliminated."""
    events = [
        _activity("A", "x", 100),
        _activity("B", "y", 100),
        _activity("A", "z", 100),
    ]
    acts = [e for e in collapse_activity_occurrences(events) if e["type"] == "activity"]
    assert [e["data"]["activity_label"] for e in acts] == ["A", "B", "A"]


def test_different_case_ids_not_merged():
    events = [
        _activity("CRM -- Salesforce", "x", 100, case_ids=("c1",)),
        _activity("CRM -- Salesforce", "y", 100, case_ids=("c2",)),
    ]
    acts = [e for e in collapse_activity_occurrences(events) if e["type"] == "activity"]
    assert len(acts) == 2


def test_input_not_mutated():
    """Must not mutate input event dicts -- collapse_adjacent runs on the
    same classified list to build events.csv."""
    events = [
        _activity("A", "x", 100),
        _activity("A", "y", 200),
    ]
    collapse_activity_occurrences(events)
    assert events[0]["data"]["duration_ms"] == 100
    assert events[1]["data"]["duration_ms"] == 200


def _taxonomy():
    return {
        "rules": [
            {"label": "CRM", "match": {"app": "chrome.exe", "title_regex": "Salesforce"}},
            {"label": "Mail", "match": {"app": "outlook.exe", "title_regex": "Inbox"}},
        ]
    }


def test_classify_events_returns_per_rule_report():
    """classify_events returns (events, report); the report counts how
    many activity events each taxonomy rule matched."""
    events = [
        {"type": "activity", "data": {"app": "chrome.exe", "title": "Salesforce - Home"}},
        {"type": "activity", "data": {"app": "chrome.exe", "title": "Salesforce - Account"}},
    ]
    out, report = classify_events(events, _taxonomy())
    assert out[0]["data"]["activity_label"] == "CRM"
    assert len(report) == 2
    assert report[0]["label"] == "CRM"
    assert report[0]["matches"] == 2
    assert report[0]["zero_match"] is False


def test_classify_events_flags_zero_match_rule():
    """A rule that fires on nothing -- typically a typo'd title_regex --
    is flagged zero_match so it doesn't fail silently (I67)."""
    events = [
        {"type": "activity", "data": {"app": "chrome.exe", "title": "Salesforce - Home"}},
    ]
    _out, report = classify_events(events, _taxonomy())
    mail = next(r for r in report if r["label"] == "Mail")
    assert mail["matches"] == 0
    assert mail["zero_match"] is True
    assert mail["title_regex"] == "Inbox"


def test_classify_events_empty_taxonomy_empty_report():
    events = [{"type": "activity", "data": {"app": "x.exe", "title": "t"}}]
    out, report = classify_events(events, {"rules": []})
    assert report == []
    assert out[0]["data"]["activity_label"] == "Unclassified -- x.exe"


# --- Recognition-led fallback for unmatched activities (ADR-0011 follow-up 3) ---

def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


def _act_at(ts: datetime, dur_ms: int, app: str = "chrome.exe", title: str = "App"):
    return {"type": "activity", "timestamp": _iso(ts),
            "data": {"app": app, "title": title, "duration_ms": dur_ms}}


def _inter_at(ts: datetime, *, control_type: str = "", class_name: str = ""):
    return {"type": "interaction", "timestamp": _iso(ts),
            "data": {"kind": "value_changed", "control_type": control_type,
                     "class_name": class_name}}


def test_recognition_fallback_labels_form_entry():
    """An activity the taxonomy can't match gets a semantic label from the
    framework recognition of the interactions in its window."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _act_at(base, 5000, title="Some web app"),
        _inter_at(base + timedelta(seconds=1), control_type="Edit", class_name="form-control"),
        _inter_at(base + timedelta(seconds=2), control_type="Edit", class_name="form-control"),
    ]
    out, _ = classify_events(events, {"rules": []})
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "Form entry -- chrome.exe"


def test_recognition_fallback_labels_data_grid():
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _act_at(base, 5000),
        _inter_at(base + timedelta(seconds=1), control_type="Edit", class_name="ag-cell-edit-input"),
    ]
    out, _ = classify_events(events, {"rules": []})
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "Data grid -- chrome.exe"


def test_taxonomy_match_wins_over_recognition():
    """A business label from the taxonomy beats the recognition fallback."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _act_at(base, 5000, title="Salesforce - Home"),
        _inter_at(base + timedelta(seconds=1), control_type="Edit", class_name="form-control"),
    ]
    out, _ = classify_events(events, _taxonomy())
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "CRM"


def test_generic_interactions_keep_unclassified():
    """A bare button (generic 'action') and browser chrome carry no activity
    meaning, so they don't dislodge the Unclassified fallback."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _act_at(base, 5000),
        _inter_at(base + timedelta(seconds=1), control_type="Button"),
        _inter_at(base + timedelta(seconds=2), control_type="Edit", class_name="OmniboxViewViews"),
    ]
    out, _ = classify_events(events, {"rules": []})
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "Unclassified -- chrome.exe"


def test_interaction_outside_window_ignored():
    """Only interactions inside [start, start+duration) inform the label."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    events = [
        _act_at(base, 2000),  # window is [0s, 2s)
        _inter_at(base + timedelta(seconds=5), control_type="Edit", class_name="form-control"),
    ]
    out, _ = classify_events(events, {"rules": []})
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "Unclassified -- chrome.exe"


def test_timestampless_activity_keeps_unclassified():
    """A timestamp-less activity (no window to join on) keeps the fallback."""
    events = [
        {"type": "activity", "data": {"app": "x.exe", "title": "t"}},
        _inter_at(datetime(2026, 5, 18, 9, 0, 1), control_type="Edit", class_name="form-control"),
    ]
    out, _ = classify_events(events, {"rules": []})
    act = next(e for e in out if e["type"] == "activity")
    assert act["data"]["activity_label"] == "Unclassified -- x.exe"


# --- Team-wide taxonomy promotion (direct write to taxonomy.yaml) ------

def test_upsert_taxonomy_rules_adds_and_dedupes():
    import os
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".yaml")
    os.close(fd)
    try:
        added = upsert_taxonomy_rules(path, [
            {"label": "CRM", "match": {"app": "chrome.exe", "title_regex": "Salesforce"}},
            {"label": "Mail", "match": {"title_regex": "Inbox"}},
        ])
        assert added == 2
        # Re-promoting the same rule is a no-op (no duplicate rows).
        again = upsert_taxonomy_rules(path, [
            {"label": "CRM", "match": {"app": "chrome.exe", "title_regex": "Salesforce"}},
        ])
        assert again == 0
        doc = load_taxonomy(path)
        assert [r["label"] for r in doc["rules"]] == ["CRM", "Mail"]
        # The promoted rule classifies a future session's matching activity.
        out, _ = classify_events(
            [{"type": "activity", "data": {"app": "chrome.exe", "title": "Salesforce - Home"}}],
            doc,
        )
        assert out[0]["data"]["activity_label"] == "CRM"
    finally:
        os.remove(path)


def test_upsert_taxonomy_rules_creates_missing_file():
    import os
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    path = os.path.join(d, "team-taxonomy.yaml")
    try:
        added = upsert_taxonomy_rules(path, [{"label": "X", "match": {"app": "x.exe"}}])
        assert added == 1
        assert load_taxonomy(path)["rules"][0]["label"] == "X"
    finally:
        shutil.rmtree(d)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print(f"{len(tests)} passed")
