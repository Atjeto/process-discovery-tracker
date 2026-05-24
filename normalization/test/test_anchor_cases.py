"""Tests for anchor-based case detection (v0.13 §4).

Run with:
    pytest normalization/test/test_anchor_cases.py
"""

from __future__ import annotations
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from case_assignment import detect_cases_from_anchors, stamp_anchor_cases


def _iso(t: datetime) -> str:
    return t.replace(tzinfo=timezone.utc).isoformat()


ANCHOR_CFG = {
    "field": "automation_id",
    "equals": "txtsr",
    "case_label_from": "value",
    "min_gap_ms": 10000,
    "close_on_pause_ms": 300000,
}


def _inter(ts, *, automation_id="", value="", name="", window="App",
           proc="chrome.exe", cls="", control_type="Edit"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "interaction",
        "timestamp": _iso(ts),
        "data": {
            "kind": "value_changed",
            "control_type": control_type,
            "automation_id": automation_id,
            "name": name,
            "class_name": cls,
            "window_title": window,
            "process_name": proc,
            "value": value,
        },
    }


def _activity(ts, *, app="chrome.exe", title="App"):
    return {
        "event_id": str(uuid.uuid4()),
        "type": "activity",
        "timestamp": _iso(ts),
        "data": {
            "app": app,
            "title": title,
            "duration_ms": 1000,
        },
    }


def _raw_inter(ts_str, automation_id="txtsr", value="SN1"):
    """An interaction with a RAW (possibly non-ISO) timestamp string, to probe
    the parse-robustness of the anchor path."""
    return {
        "event_id": str(uuid.uuid4()), "type": "interaction", "timestamp": ts_str,
        "data": {"kind": "value_changed", "control_type": "Edit",
                 "automation_id": automation_id, "value": value},
    }


def test_three_distinct_serials_produce_three_cases():
    base = datetime(2026, 5, 18, 9, 0, 0)
    # Each serial does some follow-up work so none is a degenerate sliver.
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="", value="x"),
        _inter(base + timedelta(seconds=30), automation_id="txtsr", value="SN002"),
        _inter(base + timedelta(seconds=35), automation_id="", value="y"),
        _inter(base + timedelta(minutes=2), automation_id="txtsr", value="SN003"),
        _inter(base + timedelta(minutes=2, seconds=5), automation_id="", value="z"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 3
    labels = [c["label"] for c in cases]
    assert labels == ["SN001", "SN002", "SN003"]


def test_re_hit_same_label_is_one_case():
    """Re-searching the same serial stays ONE case (stable per label)."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), automation_id="txtsr", value="SN001"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 1
    assert cases[0]["label"] == "SN001"


def test_pause_does_not_split_same_label_case():
    """Active-case stamping (option C) deliberately drops the old pause-split:
    a long idle gap within one serial's work no longer fragments it -- the
    case simply continues. (Was test_close_on_pause_splits_case.)"""
    cfg = {**ANCHOR_CFG, "close_on_pause_ms": 5000}
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=1)),
        _inter(base + timedelta(seconds=10)),   # 9s gap -- would have split before
        _inter(base + timedelta(seconds=11)),
    ]
    cases = detect_cases_from_anchors(interactions, cfg)
    assert len(cases) == 1
    assert cases[0]["label"] == "SN001"


def test_stamp_anchor_cases_stamps_interactions_and_activities():
    """stamp_anchor_cases stamps both interaction AND activity events."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    anchor_cases = [{
        "case_id": "case-1",
        "label": "SN001",
        "start_ts": _iso(base),
        "end_ts": _iso(base + timedelta(seconds=10)),
        "last_ts": _iso(base + timedelta(seconds=10)),
    }]
    events = [
        _inter(base + timedelta(seconds=1)),
        _activity(base + timedelta(seconds=2)),
        _inter(base + timedelta(seconds=20)),
    ]
    stamped, cases_map = stamp_anchor_cases(events, anchor_cases)
    assert len(stamped) == 3
    assert stamped[0]["data"]["case_ids"] == ["case-1"]
    assert stamped[1]["data"]["case_ids"] == ["case-1"]
    assert stamped[2]["data"]["case_ids"] == []
    assert "case-1" in cases_map
    assert len(cases_map["case-1"]["activity_event_ids"]) == 1


def test_cases_map_has_expected_shape():
    """cases_map has the same shape as collect_cases() output."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    anchor_cases = [{
        "case_id": "case-1",
        "label": "SN001",
        "start_ts": _iso(base),
        "end_ts": _iso(base + timedelta(seconds=10)),
        "last_ts": _iso(base + timedelta(seconds=10)),
    }]
    _, cases_map = stamp_anchor_cases([], anchor_cases)
    c = cases_map["case-1"]
    assert c["case_id"] == "case-1"
    assert c["label"] == "SN001"
    assert c["parent_case_id"] is None
    assert c["start_ts"] is not None
    assert c["end_ts"] is not None
    assert c["end_reason"] == "anchor_boundary"
    assert "activity_event_ids" in c


def test_deterministic_case_ids():
    """case_id is stable per label -- the same serial always resolves to the
    same id (across runs, and on a re-search later in the session)."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=2), automation_id="", value="x"),
    ]
    cases1 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    cases2 = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert cases1[0]["case_id"] == cases2[0]["case_id"]


# --- Active-case stamping: interleaving + degenerate guard (option C) ---


def test_interleaved_serials_resume_same_case():
    """search A -> work -> search B -> work -> search A again: A's two bouts
    are ONE case (stable per label), so A owns two disjoint active segments."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                         automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=2),  value="a1"),
        _inter(base + timedelta(seconds=4),  automation_id="txtsr", value="SN-B"),
        _inter(base + timedelta(seconds=6),  value="b1"),
        _inter(base + timedelta(seconds=8),  automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=10), value="a2"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert len(cases) == 2
    assert sorted(c["label"] for c in cases) == ["SN-A", "SN-B"]
    a = next(c for c in cases if c["label"] == "SN-A")
    assert len(a["segments"]) == 2   # two disjoint bouts of work on serial A


def test_stamp_interleaved_assigns_by_active_case():
    """Events between anchors stamp to the most-recent anchor's case, even
    when the same case resumes after an interleave."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                         automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=2),  value="a1"),
        _inter(base + timedelta(seconds=4),  automation_id="txtsr", value="SN-B"),
        _inter(base + timedelta(seconds=5),  value="b1"),
        _inter(base + timedelta(seconds=8),  automation_id="txtsr", value="SN-A"),
        _inter(base + timedelta(seconds=10), value="a2"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    a = next(c for c in cases if c["label"] == "SN-A")["case_id"]
    b = next(c for c in cases if c["label"] == "SN-B")["case_id"]
    events = sorted(
        interactions + [
            _activity(base + timedelta(seconds=6)),   # within B's window
            _activity(base + timedelta(seconds=9)),   # within A's resumed window
        ],
        key=lambda e: e["timestamp"],
    )
    stamped, _ = stamp_anchor_cases(events, cases)
    by_ts = {e["timestamp"]: e["data"]["case_ids"] for e in stamped}
    assert by_ts[_iso(base + timedelta(seconds=6))] == [b]
    assert by_ts[_iso(base + timedelta(seconds=9))] == [a]


def test_degenerate_guard_drops_lone_anchor():
    """A lone accidental anchor fire (1 interaction) is dropped; the real case
    beside it survives."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value="REAL"),
        _inter(base + timedelta(seconds=3), value="work"),
        _inter(base + timedelta(seconds=5), value="work2"),
        _inter(base + timedelta(seconds=6), automation_id="txtsr", value="SLIVER"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["REAL"]


def test_degenerate_guard_drops_subsecond_case():
    """A sub-second case (the 0.6s sliver) is dropped even with 2 interactions."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value="REAL"),
        _inter(base + timedelta(seconds=3), value="work"),
        _inter(base + timedelta(seconds=10), automation_id="txtsr", value="BLIP"),
        _inter(base + timedelta(seconds=10, milliseconds=600), value="b"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["REAL"]


# --- Empty-value anchor fires (focus/click on the serial box before typing) ---


def test_empty_value_anchor_does_not_open_a_case():
    """A focus/click on the empty serial box fires the anchor with no value. It
    must NOT open an empty-label case (which the guard would later drop,
    orphaning the interactions stamped to it); the work stays with the active
    ticket. Mirrors the real ATM capture, where ~1/3 of anchor fires are empty."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=2), value="work1"),
        _inter(base + timedelta(seconds=4), automation_id="txtsr", value=""),  # empty box click
        _inter(base + timedelta(seconds=6), value="work2"),
        _inter(base + timedelta(seconds=8), value="work3"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["SN001"]
    # The empty-box click and all work after it stay attributed to SN001 -- none
    # orphaned to a dropped empty-label case.
    cid = cases[0]["case_id"]
    stamped, _ = stamp_anchor_cases(interactions, cases)
    assert all(e["data"]["case_ids"] == [cid] for e in stamped)


def test_leading_empty_anchor_creates_no_case():
    """An empty-box click BEFORE any serial is searched opens no case; those
    leading interactions are simply uncased until the first real serial."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base,                        automation_id="txtsr", value=""),   # empty, pre-serial
        _inter(base + timedelta(seconds=1), value="pre"),
        _inter(base + timedelta(seconds=3), automation_id="txtsr", value="SN001"),
        _inter(base + timedelta(seconds=5), value="work"),
        _inter(base + timedelta(seconds=7), value="work2"),
    ]
    cases = detect_cases_from_anchors(interactions, ANCHOR_CFG)
    assert [c["label"] for c in cases] == ["SN001"]
    cid = cases[0]["case_id"]
    stamped, _ = stamp_anchor_cases(interactions, cases)
    assert stamped[0]["data"]["case_ids"] == []   # empty fire, before any serial
    assert stamped[1]["data"]["case_ids"] == []   # leading work, still uncased
    assert stamped[2]["data"]["case_ids"] == [cid]
    assert stamped[3]["data"]["case_ids"] == [cid]
    assert stamped[4]["data"]["case_ids"] == [cid]


# --- Recognition-driven anchors (ADR-0012 #7): a portable case anchor keyed on
# a documented platform signature (ADR-0011) instead of an opaque automation_id.


RECOGNIZED_SEARCH_CFG = {
    "recognized": "search",
    "case_label_from": "value",
    "min_case_interactions": 2,
    "min_case_duration_ms": 1000,
}


def test_recognized_search_anchor_detects_cases():
    """Anchor on the RECOGNISED 'search' category instead of an automation_id:
    an Office 365 search box (class `o365sx-`) fires the anchor; the plain text
    fields around it do not. Generalises across engagements -- no per-app id."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, cls="o365sx-SearchBox", value="SN001"),         # search -> anchor
        _inter(base + timedelta(seconds=3), value="work"),           # plain Edit -> no
        _inter(base + timedelta(seconds=5), value="work2"),
        _inter(base + timedelta(seconds=30), cls="o365sx-SearchBox", value="SN002"),
        _inter(base + timedelta(seconds=33), value="more"),
        _inter(base + timedelta(seconds=35), value="more2"),
    ]
    cases = detect_cases_from_anchors(interactions, RECOGNIZED_SEARCH_CFG)
    assert [c["label"] for c in cases] == ["SN001", "SN002"]


def test_recognized_anchor_ignores_unrecognized_fields():
    """Plain Edits (text_entry) never fire a 'search'-category anchor, so
    ordinary typing forms no spurious cases."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    interactions = [
        _inter(base, value="typed"),
        _inter(base + timedelta(seconds=2), value="more"),
    ]
    cases = detect_cases_from_anchors(interactions, RECOGNIZED_SEARCH_CFG)
    assert cases == []


def test_recognized_plus_name_pattern_anchor():
    """Compose recognition with a label pattern -- a recognised text/search
    field WHOSE NAME looks like a case key. Generalises a bespoke field without
    naming its automation_id; only the matching field fires the anchor."""
    base = datetime(2026, 5, 18, 9, 0, 0)
    cfg = {
        "recognized": ["text_entry", "search"],
        "field": "name",
        "matches": "(?i)serial|ticket",
        "case_label_from": "value",
        "min_case_interactions": 2,
        "min_case_duration_ms": 1000,
    }
    interactions = [
        _inter(base, name="Serial Number", value="SN001"),            # text_entry + name match
        _inter(base + timedelta(seconds=3), name="Notes", value="x"),  # name no match
        _inter(base + timedelta(seconds=5), name="Notes", value="y"),
    ]
    cases = detect_cases_from_anchors(interactions, cfg)
    assert [c["label"] for c in cases] == ["SN001"]


# --- Robustness: a corrupt log / misconfigured template must degrade, not crash
# (found by the adversarial fuzz harness). ---


def test_non_iso_timestamp_degrades_not_crashes():
    """A corrupt or hand-edited log can carry a non-ISO timestamp on an anchor
    event. The anchor path's _parse_ts must fall back (to the epoch) rather than
    raise ValueError mid-run."""
    cfg = {**ANCHOR_CFG, "min_case_interactions": 1, "min_case_duration_ms": 0}
    interactions = [_raw_inter("not-a-date", value="SN1"), _raw_inter("also-bad", value="SN1")]
    cases = detect_cases_from_anchors(interactions, cfg)   # must not raise
    assert len(cases) == 1
    stamped, _ = stamp_anchor_cases(interactions, cases)   # must not raise on bad segment ts
    assert len(stamped) == 2


def test_invalid_regex_anchor_yields_no_cases_without_crashing():
    """A typo in the template's case_anchor `matches` regex must warn + match
    nothing, not crash the run with an opaque re.error."""
    cfg = {"field": "value", "matches": "[", "case_label_from": "value",
           "min_case_interactions": 1, "min_case_duration_ms": 0}
    interactions = [_raw_inter("2026-05-18T09:00:00Z", value="whatever")]
    cases = detect_cases_from_anchors(interactions, cfg)   # must not raise re.error
    assert cases == []
