"""Tests for findings (lab-phase spec §A3) + the motifs port it consumes.

Both modules are pure stdlib, so this suite RUNS (not skips) under a
bare system pytest as well as the bundled python.
"""

from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from facts import compute_facts
from findings import detect_findings
from motifs import find_bounces, find_motifs, maximal_motifs


def _act(app, dur_ms, ts):
    return {"type": "activity", "timestamp": ts,
            "data": {"app": app, "duration_ms": dur_ms}}


def _typed(app, value, ts, eid):
    return {"event_id": eid, "type": "interaction", "timestamp": ts,
            "data": {"kind": "text_changed", "process_name": app, "value": value}}


def _step(label, case_id, start, sid):
    return {"step_id": sid, "case_id": case_id, "process_label": label,
            "name": label, "time_range": {"start": start, "end": start}}


T = "2026-05-14T09:{:02d}:00Z"


def _base_events():
    return [
        _act("chrome.exe", 90000, T.format(0)),
        _act("excel.exe", 30000, T.format(2)),
        _act("chrome.exe", 30000, T.format(3)),
        {"type": "system", "timestamp": T.format(1),
         "data": {"kind": "screenshot", "path": "screenshots/shot_01.png"}},
    ]


def _by_detector(findings):
    out = {}
    for f in findings:
        out.setdefault(f["detector"], []).append(f)
    return out


def _detect(events, steps=None, analysis_blocks=None, bounces=None):
    f = compute_facts(events)
    return detect_findings(events, steps or [], f,
                           analysis_blocks=analysis_blocks, bounces=bounces)


# ---- motifs port + bounces -------------------------------------------------

def test_find_motifs_ports_the_ml_branch_behavior():
    # The same 3-label sequence in 3 cases -> one motif at min_freq 3.
    steps = []
    for c in ("c1", "c2", "c3"):
        for i, lbl in enumerate(["Search", "Open", "Update"]):
            steps.append(_step(lbl, c, T.format(i), f"{c}-{i}"))
    motifs = find_motifs(steps)
    assert len(motifs) == 1
    assert motifs[0]["labels"] == ["Search", "Open", "Update"]
    assert motifs[0]["frequency"] == 3
    assert len(motifs[0]["motif_id"]) == 12
    assert len(motifs[0]["occurrences"]) == 3
    assert motifs[0]["occurrences"][0]["step_ids"] == ["c1-0", "c1-1", "c1-2"]


def test_find_motifs_below_frequency_returns_nothing():
    steps = [_step(l, "c1", T.format(i), f"s{i}")
             for i, l in enumerate(["A", "B", "C"])]
    assert find_motifs(steps) == []
    assert find_motifs([]) == []


def test_maximal_motifs_drops_overlapping_shadows():
    # One 5-label sequence repeated in 3 cases: the raw window count
    # includes every length-3/4 sub-window; the maximal filter keeps only
    # the full sequence (the honest "distinct repeated sequences" count).
    steps = []
    seq = ["Search", "Open", "Edit", "Check", "Save"]
    for c in ("c1", "c2", "c3"):
        for i, lbl in enumerate(seq):
            steps.append(_step(lbl, c, T.format(i), f"{c}-{i}"))
    raw = find_motifs(steps)
    assert len(raw) > 1                      # the shadows are there
    kept = maximal_motifs(raw)
    assert len(kept) == 1
    assert kept[0]["labels"] == seq
    assert maximal_motifs([]) == []


def test_find_bounces_detects_a_b_a():
    steps = [
        _step("Search", "c1", T.format(0), "s1"),
        _step("Update", "c1", T.format(1), "s2"),
        _step("Search", "c1", T.format(2), "s3"),
        _step("Submit", "c1", T.format(3), "s4"),
    ]
    bounces = find_bounces(steps)
    assert len(bounces) == 1
    b = bounces[0]
    assert b["labels"] == ["Search", "Update", "Search"]
    assert b["returned_to"] == "Search"
    assert b["via"] == "Update"
    assert b["count"] == 1
    assert b["occurrences"][0]["step_ids"] == ["s1", "s2", "s3"]


def test_find_bounces_ignores_aaa_and_abc():
    steps = [
        _step("A", "c1", T.format(0), "s1"),
        _step("A", "c1", T.format(1), "s2"),
        _step("A", "c1", T.format(2), "s3"),
        _step("B", "c1", T.format(3), "s4"),
        _step("C", "c1", T.format(4), "s5"),
    ]
    assert find_bounces(steps) == []


# ---- detectors -------------------------------------------------------------

def test_screen_time_sink_claims_the_top_app_share():
    fs = _by_detector(_detect(_base_events()))
    assert "screen_time_sink" in fs
    f = fs["screen_time_sink"][0]
    # DA gap 3: without an app_names map, the capitalized executable name.
    assert f["claim"].startswith("Chrome accounts for 80%")   # 120s of 150s
    assert "chrome.exe" not in f["claim"]
    assert f["evidence"]["app"] == "chrome.exe"     # the machine key stays in evidence
    assert f["tier"] == 1
    assert f["evidence"]["foreground_ms"] == 120000
    assert f["id"].startswith("screen_time_sink-")
    assert f["confidence_note"]


def test_screen_time_sink_attaches_screenshots_in_the_top_run():
    fs = _by_detector(_detect(_base_events()))
    refs = fs["screen_time_sink"][0]["evidence"]["screenshot_refs"]
    assert refs == ["screenshots/shot_01.png"]


def test_fragmentation_reports_switches_without_judging():
    fs = _by_detector(_detect(_base_events()))
    f = fs["fragmentation"][0]
    assert "2 times" in f["claim"]
    assert f["evidence"]["app_switches"] == 2
    assert f["tier"] == 1
    # Non-normative: the claim states numbers, not verdicts.
    assert "too" not in f["claim"].lower()


def test_fragmentation_states_a_rate_only_for_30_minutes_or_more():
    """DA gap 9: a 4-minute recording states the plain count; the per-hour
    rate appears (claim and evidence) only from a 30-minute span on."""
    short = _by_detector(_detect(_base_events()))["fragmentation"][0]
    assert short["claim"].startswith("Focus moved between apps 2 times; ")
    assert "/h" not in short["claim"]
    assert "switches_per_hour" not in short["evidence"]
    long_events = _base_events() + [
        {"type": "system", "timestamp": "2026-05-14T09:30:00Z",
         "data": {"kind": "session_end"}}]
    long = _by_detector(_detect(long_events))["fragmentation"][0]
    rate = compute_facts(long_events)["switches_per_hour"]
    assert long["claim"].startswith(f"Focus moved between apps 2 times ({rate}/h); ")
    assert long["evidence"]["switches_per_hour"] == rate


def test_claims_use_the_readable_app_names():
    """DA gap 3: with the pipeline's app_names map, no claim carries an
    executable token."""
    evs = _base_events() + [
        _typed("chrome.exe", "CUST-10900", T.format(1), "t1"),
        _typed("excel.exe", "CUST-10900", T.format(2), "t2"),
    ]
    names = {"chrome.exe": "Google Chrome", "excel.exe": "Microsoft Excel"}
    found = detect_findings(evs, [], compute_facts(evs), app_names=names)
    fs = _by_detector(found)
    assert fs["screen_time_sink"][0]["claim"].startswith("Google Chrome accounts for")
    assert "entered in Google Chrome, Microsoft Excel" in fs["rekey_transfer"][0]["claim"]
    assert not any(".exe" in f["claim"] for f in found)


def test_waiting_skips_when_nothing_measured():
    fs = _by_detector(_detect(_base_events()))
    assert "waiting" not in fs


def test_waiting_fires_on_idle_and_reports_step_overlap():
    evs = _base_events() + [
        {"type": "system", "timestamp": T.format(4), "data": {"kind": "idle_start"}},
        {"type": "system", "timestamp": T.format(6), "data": {"kind": "idle_end"}},
    ]
    blocks = {"time_study": [{"waiting_ms": 60000}, {"waiting_ms": 0}]}
    fs = _by_detector(_detect(evs, analysis_blocks=blocks))
    f = fs["waiting"][0]
    assert f["evidence"]["idle_ms"] == 120000
    assert f["evidence"]["waiting_in_steps_ms"] == 60000
    assert "2m" in f["claim"]


def test_repetition_needs_multi_instance_candidates():
    blocks = {
        "automation_candidates": [
            {"segment_signature": "sigA", "label": "Lookup → Paste",
             "app": "excel.exe", "instance_count": 4,
             "total_elapsed_ms": 240000, "mean_elapsed_ms": 60000,
             "step_labels": ["Lookup", "Paste"],
             "data_sufficiency": "multi_instance"},
            {"segment_signature": "sigB", "label": "One-off",
             "app": "x.exe", "instance_count": 1,
             "data_sufficiency": "single_instance"},
        ],
        "segments": [
            {"signature": "sigA", "step_ids": ["s1", "s2"]},
            {"signature": "sigA", "step_ids": ["s3"]},
        ],
    }
    fs = _by_detector(_detect(_base_events(), analysis_blocks=blocks))
    reps = fs["repetition"]
    assert len(reps) == 1
    f = reps[0]
    assert "4 times" in f["claim"]
    assert f["tier"] == 2
    assert f["evidence"]["step_ids"] == ["s1", "s2", "s3"]
    # B4: the claim carries the short label (the steps only) and names the
    # application by its readable name (DA gap 3), never "excel".
    assert '"Lookup → Paste" in Excel was repeated 4 times' in f["claim"]
    assert f["evidence"]["short_label"] == "Lookup → Paste"


def test_repetition_claim_label_is_shortened():
    """B4: a long segment renders as 'first 2 steps … (+N more)' capped ~60
    chars in the claim; the FULL label stays in the evidence."""
    from findings import short_segment_label, SEGMENT_LABEL_MAX
    long_steps = ["Open customer record", "Copy account number",
                  "Switch to billing", "Paste account number",
                  "Validate", "Submit", "Confirm dialog"]
    full = "crm: " + " → ".join(long_steps[:5]) + " → … (+2 more)"
    blocks = {
        "automation_candidates": [
            {"segment_signature": "sigLong", "label": full,
             "app": "crm.exe", "instance_count": 3,
             "total_elapsed_ms": 300000, "mean_elapsed_ms": 100000,
             "step_labels": long_steps,
             "data_sufficiency": "multi_instance"},
        ],
        "segments": [],
    }
    fs = _by_detector(_detect(_base_events(), analysis_blocks=blocks))
    f = fs["repetition"][0]
    short = f["evidence"]["short_label"]
    assert f'"{short}" in Crm was repeated 3 times' in f["claim"]
    assert len(short) <= SEGMENT_LABEL_MAX
    assert short.startswith("Open customer record → Copy account number")
    assert "(+" in short and "more)" in short      # the elided-count tail
    assert f["evidence"]["label"] == full          # full label preserved
    # The helper holds the cap even on absurd names (hard truncation),
    # only ever exceeding it by the preserved "(+N more)" count tail.
    monster = short_segment_label(
        ["An extremely long step label that on its own overflows the cap, "
         "and then some more words", "Another"], 60)
    assert len(monster) <= 60 + len(" … (+1 more)")
    assert monster.endswith("… (+1 more)")


def test_backtracking_uses_bounces_and_needs_steps():
    steps = [
        _step("Search", "c1", T.format(0), "s1"),
        _step("Update", "c1", T.format(1), "s2"),
        _step("Search", "c1", T.format(2), "s3"),
    ]
    bounces = find_bounces(steps)
    fs = _by_detector(_detect(_base_events(), steps=steps, bounces=bounces))
    f = fs["backtracking"][0]
    assert 'went back to "Search"' in f["claim"]
    assert f["evidence"]["count"] == 1
    assert f["evidence"]["step_ids"] == ["s1", "s2", "s3"]
    # No steps -> precondition unmet even with bounces supplied.
    assert "backtracking" not in _by_detector(
        _detect(_base_events(), steps=[], bounces=bounces))


def test_rekey_transfer_names_the_value_and_apps():
    evs = _base_events() + [
        _typed("chrome.exe", "CUST-10900", T.format(1), "t1"),
        _typed("excel.exe", "CUST-10900", T.format(2), "t2"),
    ]
    fs = _by_detector(_detect(evs))
    f = fs["rekey_transfer"][0]
    assert "CUST-10900" in f["claim"]
    assert f["evidence"]["rekey_count"] == 1
    assert set(f["evidence"]["event_ids"]) == {"t1", "t2"}


def test_coverage_caveat_fires_on_reduced_capture_tiers():
    evs = _base_events() + [
        {"event_id": "i1", "type": "interaction", "timestamp": T.format(1),
         "data": {"kind": "click", "process_name": "mstsc.exe",
                  "framework": "remote", "identity_source": "none",
                  "confidence": 0.1}},
        {"event_id": "i2", "type": "interaction", "timestamp": T.format(2),
         "data": {"kind": "click", "process_name": "EXCEL.exe",
                  "framework": "win32", "identity_source": "name",
                  "confidence": 0.7, "coverage_hint": "basic"}},
        {"event_id": "i3", "type": "interaction", "timestamp": T.format(3),
         "data": {"kind": "click", "process_name": "good.exe",
                  "framework": "wpf", "identity_source": "automation_id",
                  "confidence": 0.95, "coverage_hint": "rich"}},
    ]
    fs = _by_detector(_detect(evs))
    f = fs["coverage_caveat"][0]
    flagged = {a["app"]: a for a in f["evidence"]["flagged_apps"]}
    assert set(flagged) == {"mstsc.exe", "EXCEL.exe"}
    assert flagged["mstsc.exe"]["trust"] == "wall"
    assert flagged["EXCEL.exe"]["trust"] == "basic"
    assert f["evidence"]["total_apps"] == 3
    assert "2 of 3" in f["claim"]


def test_coverage_caveat_silent_without_11e_fields():
    evs = _base_events() + [
        {"event_id": "i1", "type": "interaction", "timestamp": T.format(1),
         "data": {"kind": "click", "process_name": "chrome.exe"}},
    ]
    assert "coverage_caveat" not in _by_detector(_detect(evs))


def test_detect_findings_never_raises_on_garbage():
    assert detect_findings(None, None, None) == []
    junk = [None, {"type": "activity"}, {"type": "interaction", "data": None}]
    out = detect_findings(junk, [{"bad": "step"}], {"active_ms": "NaN"},
                          analysis_blocks={"automation_candidates": [None]},
                          bounces=[{"broken": True}])
    assert isinstance(out, list)


def test_finding_ids_are_stable_across_runs():
    a = _detect(_base_events())
    b = _detect(_base_events())
    assert [f["id"] for f in a] == [f["id"] for f in b]


def test_every_finding_carries_the_contract_fields():
    evs = _base_events() + [
        _typed("chrome.exe", "CUST-10900", T.format(1), "t1"),
        _typed("excel.exe", "CUST-10900", T.format(2), "t2"),
    ]
    for f in _detect(evs):
        assert f["id"] and f["detector"] and f["claim"]
        assert isinstance(f["evidence"], dict)
        assert f["tier"] in (1, 2)
        assert f["confidence_note"]


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
