"""The apps the recorder saw with less detail (capture_detail.coverage_caveat), the
one check of the recording the Overview still shows. Ported from the
findings suite when the light version cut the findings feed.

Pure stdlib, so this suite runs under a bare system pytest as well as the
bundled python.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from capture_detail import coverage_caveat  # noqa: E402

T = "2026-05-14T09:{:02d}:00Z"


def _click(eid, minute, **data):
    return {"event_id": eid, "type": "interaction", "timestamp": T.format(minute),
            "data": {"kind": "click", **data}}


def test_the_caveat_names_the_apps_recorded_with_less_detail():
    events = [
        {"type": "activity", "timestamp": T.format(0), "data": {"app": "chrome.exe", "duration_ms": 1000}},
        _click("i1", 1, process_name="mstsc.exe", framework="remote",
               identity_source="none", confidence=0.1),
        _click("i2", 2, process_name="EXCEL.exe", framework="win32",
               identity_source="name", confidence=0.7, coverage_hint="basic"),
        _click("i3", 3, process_name="good.exe", framework="wpf",
               identity_source="automation_id", confidence=0.95, coverage_hint="rich"),
    ]
    cav = coverage_caveat(events)
    flagged = {a["app"]: a for a in cav["flagged_apps"]}
    assert set(flagged) == {"mstsc.exe", "EXCEL.exe"}
    assert flagged["mstsc.exe"]["trust"] == "wall"
    assert flagged["EXCEL.exe"]["trust"] == "basic"
    assert cav["total_apps"] == 3
    assert cav["claim"].startswith("The recorder saw less detail in 2 of 3 apps: ")
    # The claim says the plain-words reason, never the machine tier's name.
    assert "wall" not in cav["claim"] and "basic" not in cav["claim"]


def test_a_low_mean_confidence_alone_flags_an_app():
    events = [_click("i1", 1, process_name="legacy.exe", confidence=0.2),
              _click("i2", 2, process_name="legacy.exe", confidence=0.4)]
    cav = coverage_caveat(events)
    assert [a["trust"] for a in cav["flagged_apps"]] == ["low-confidence"]
    assert cav["flagged_apps"][0]["mean_confidence"] == 0.3
    assert "score 0.3 of 1" in cav["claim"]


def test_the_claim_uses_the_readable_app_names():
    events = [_click("i1", 1, process_name="mstsc.exe", framework="remote")]
    cav = coverage_caveat(events, {"mstsc.exe": "Remote Desktop"})
    assert "Remote Desktop (" in cav["claim"] and "mstsc" not in cav["claim"]


def test_no_caveat_without_the_coverage_fields_or_without_interactions():
    assert coverage_caveat([_click("i1", 1, process_name="chrome.exe")]) is None
    assert coverage_caveat([]) is None
    assert coverage_caveat(None) is None
    # Malformed events degrade: nothing to flag, no exception.
    junk = [None, {"type": "interaction", "data": None},
            {"type": "interaction", "data": {"process_name": 7, "confidence": "x"}}]
    assert coverage_caveat(junk) is None


def test_an_app_is_seen_with_less_detail_by_the_share_of_its_interactions_with_an_id():
    """#17 (rec06: "The recorder saw less detail in 1 of 2 apps: Mspaint",
    because Paint's first click, the one carrying the coverage hint, had no
    id, though most of its clicks had one): the share of an app's
    interactions that name their control by an automation id decides."""
    paint = [_click("p1", 1, process_name="mspaint.exe", identity_source="name",
                    confidence=0.7, coverage_hint="basic")]
    paint += [_click(f"p{i}", i, process_name="mspaint.exe", identity_source="automation_id",
                     confidence=0.95) for i in range(2, 6)]
    assert coverage_caveat(paint) is None
    named = [_click(f"n{i}", i, process_name="legacy.exe", identity_source="name",
                    confidence=0.7) for i in range(1, 4)]
    cav = coverage_caveat(named + [_click("n9", 9, process_name="legacy.exe",
                                          identity_source="automation_id", confidence=0.95)])
    assert [(a["app"], a["trust"]) for a in cav["flagged_apps"]] == [("legacy.exe", "basic")]
    bare = [_click(f"b{i}", i, process_name="bare.exe", identity_source="class_name",
                   confidence=0.6) for i in range(1, 4)]
    assert [a["trust"] for a in coverage_caveat(bare)["flagged_apps"]] == ["minimal"]
