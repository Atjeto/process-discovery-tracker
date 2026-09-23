"""Tests for analysis_segments -- coherent-segment detection (ADR-0016).

A segment is a contiguous run of interactions inside one case that
share the same app, bounded by app-switch, case-switch, or a long
idle gap. Two segments are "the same pattern" when they share (app,
ordered step_labels).

Run with pytest:
    pytest normalization/test/test_analysis_segments.py
or directly:
    python normalization/test/test_analysis_segments.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analysis_segments import detect_segments, group_segments

_BASE = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _ts(sec):
    return (_BASE + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def _interaction(eid, sec, app, case_id=None, automation_id="x"):
    data = {
        "process_name": app,
        "window_title": app + " — main",
        "automation_id": automation_id,
        "value": "",
    }
    if case_id is not None:
        data["case_ids"] = [case_id]
    return {"type": "interaction", "event_id": eid,
            "timestamp": _ts(sec), "data": data}


def _step(sid, label, eids, canonical=None, start=0, end=0):
    return {
        "step_id": sid,
        "name": label,
        "process_label": label,
        "canonical_step_id": canonical,
        "time_range": {"start": _ts(start), "end": _ts(end)},
        "evidence": {"interaction_event_ids": list(eids)},
    }


def test_app_switch_ends_a_segment():
    # Each side of the switch is long enough (>5s) and one-step, so the
    # drop filter keeps it -- the assertion is on the boundary itself.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 8, "crm.exe", "c1"),
        _interaction("i3", 9, "excel.exe", "c1"),
        _interaction("i4", 17, "excel.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1", "i2"]),
        _step("s2", "Lookup", ["i3", "i4"]),
    ]
    segs = detect_segments(events, steps)
    assert len(segs) == 2
    assert segs[0]["app"] == "crm.exe"
    assert segs[1]["app"] == "excel.exe"


def test_case_switch_ends_a_segment():
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 8, "crm.exe", "c1"),
        _interaction("i3", 9, "crm.exe", "c2"),
        _interaction("i4", 17, "crm.exe", "c2"),
    ]
    steps = [
        _step("s1", "Search", ["i1", "i2"]),
        _step("s2", "Search", ["i3", "i4"]),
    ]
    segs = detect_segments(events, steps)
    cases = sorted(s["case_id"] for s in segs)
    assert cases == ["c1", "c2"]


def test_long_idle_gap_ends_a_segment():
    # 60s gap > SEGMENT_SPLIT_IDLE_MS (30s) -- two segments. Each side
    # spans 8s so the drop filter keeps both.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 8, "crm.exe", "c1"),
        _interaction("i3", 70, "crm.exe", "c1"),
        _interaction("i4", 78, "crm.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1", "i2"]),
        _step("s2", "Search", ["i3", "i4"]),
    ]
    segs = detect_segments(events, steps)
    assert len(segs) == 2


def test_single_step_short_segment_is_dropped():
    # One step, < 5s elapsed -- not actionable, not surfaced.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
    ]
    steps = [_step("s1", "Open", ["i1", "i2"])]
    segs = detect_segments(events, steps)
    assert segs == []


def test_multi_step_segment_is_kept_even_when_short():
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    segs = detect_segments(events, steps)
    assert len(segs) == 1
    assert segs[0]["step_labels"] == ["Search", "Copy", "Paste"]


def test_segments_with_same_pattern_share_signature():
    # Same app + same step-label sequence across two cases -> the same
    # signature, so the grouping pool can find it as one pattern.
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
        _interaction("i4", 100, "crm.exe", "c2"),
        _interaction("i5", 101, "crm.exe", "c2"),
        _interaction("i6", 102, "crm.exe", "c2"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
        _step("s4", "Search", ["i4"]),
        _step("s5", "Copy", ["i5"]),
        _step("s6", "Paste", ["i6"]),
    ]
    segs = detect_segments(events, steps)
    assert len(segs) == 2
    assert segs[0]["signature"] == segs[1]["signature"]
    groups = group_segments(segs)
    assert len(groups) == 1
    g = next(iter(groups.values()))
    assert len(g["instances"]) == 2


def test_segment_label_renders_the_step_chain_and_the_app():
    """Without a readable-name map the app is the executable name,
    capitalized (app_names.display_name)."""
    events = [
        _interaction("i1", 0, "salesforce.exe", "c1"),
        _interaction("i2", 1, "salesforce.exe", "c1"),
        _interaction("i3", 2, "salesforce.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    segs = detect_segments(events, steps)
    assert segs[0]["label"] == "Search → Copy → Paste in Salesforce"


def test_candidate_labels_use_the_readable_app_name_and_no_dash():
    """The labels opened with the raw process token and an em dash ("sapgui",
    the dash, then the step chain). They now name the application the way
    the rest of the deliverable does (stats.json meta.app_names), after the
    step chain, with no em or en dash, in the segments, their groups, the
    scored candidates and the analysis.json the pipeline writes."""
    from analysis import run_analysis
    from analysis_automation import score_automation
    events, steps = [], []
    for case, t0 in (("c1", 0), ("c2", 100)):
        for n, label in enumerate(("va01: Check document", "va01: Create sales order")):
            eid = f"{case}-i{n}"
            events.append(_interaction(eid, t0 + n, "SAPGUI.exe", case))
            steps.append(_step(f"{case}-s{n}", label, [eid], start=t0 + n, end=t0 + n))
    names = {"SAPGUI.exe": "SAP GUI"}
    want = "va01: Check document → va01: Create sales order in SAP GUI"
    segs = detect_segments(events, steps, app_names=names)
    assert [s["label"] for s in segs] == [want, want]
    assert [g["label"] for g in group_segments(segs).values()] == [want]
    assert [c["label"] for c in score_automation(steps, events, app_names=names)] == [want]
    result = run_analysis(events, steps, stats={"meta": {"app_names": names}})
    assert [c["label"] for c in result["automation_candidates"]] == [want]
    assert [s["label"] for s in result["segments"]] == [want, want]
    for text in (want, *(s["label"] for s in result["segments"])):
        assert chr(0x2014) not in text and chr(0x2013) not in text


def test_a_long_step_chain_is_cut_after_five_steps():
    events = [_interaction(f"i{n}", n, "crm.exe", "c1") for n in range(7)]
    steps = [_step(f"s{n}", f"Step {n}", [f"i{n}"]) for n in range(7)]
    segs = detect_segments(events, steps, app_names={"crm.exe": "Contoso CRM"})
    assert segs[0]["label"] == (
        "Step 0 → Step 1 → Step 2 → Step 3 → Step 4 → … (+2 more) in Contoso CRM")


def test_no_case_id_segments_are_still_detected():
    # A capture without anchor-based case detection still produces
    # segments -- they just have case_id=None.
    events = [
        _interaction("i1", 0, "crm.exe"),
        _interaction("i2", 1, "crm.exe"),
        _interaction("i3", 2, "crm.exe"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    segs = detect_segments(events, steps)
    assert len(segs) == 1
    assert segs[0]["case_id"] is None


def test_signature_is_stable_across_runs():
    events = [
        _interaction("i1", 0, "crm.exe", "c1"),
        _interaction("i2", 1, "crm.exe", "c1"),
        _interaction("i3", 2, "crm.exe", "c1"),
    ]
    steps = [
        _step("s1", "Search", ["i1"]),
        _step("s2", "Copy", ["i2"]),
        _step("s3", "Paste", ["i3"]),
    ]
    sig1 = detect_segments(events, steps)[0]["signature"]
    sig2 = detect_segments(events, steps)[0]["signature"]
    assert sig1 == sig2
    assert len(sig1) == 12


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
