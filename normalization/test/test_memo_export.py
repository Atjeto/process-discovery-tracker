"""Tests for memo_export (lab-phase spec §A4) -- the consultant memo seed.

memo_export is pure stdlib, so this suite RUNS (not skips) under a bare
system pytest as well as the bundled python.
"""

from __future__ import annotations
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memo_export import render_memo, write_memo


def _analysis(tier2=True, findings=None):
    return {
        "case_quality": {
            "mode": "markers" if tier2 else "unsegmented",
            "case_count": 4 if tier2 else 0,
            "coverage": 0.95 if tier2 else 0.0,
            "tier2_unlocked": tier2,
        },
        "facts": {
            "active_ms": 4500000, "idle_ms": 0, "session_span_ms": 5400000,
            "top_apps": [{"app": "chrome.exe", "ms": 1395000, "share": 0.31}],
            "app_switches": 47, "switches_per_hour": 11.2,
            "longest_focus_ms": 1080000,
            "rekey_count": 3, "repeated_sequence_count": 5,
        },
        "findings": findings if findings is not None else [
            {"id": "screen_time_sink-aaa", "detector": "screen_time_sink",
             "claim": "chrome.exe accounts for 31% of measured foreground time "
                      "(23m 15s of 1h 15m).",
             "evidence": {"app": "chrome.exe", "ms": 1395000, "share": 0.31,
                          "screenshot_refs": ["screenshots/shot_02.png"]},
             "tier": 1, "confidence_note": "Foreground-window time."},
            {"id": "fragmentation-bbb", "detector": "fragmentation",
             "claim": "Focus moved between apps 47 times (11.2/h).",
             "evidence": {"app_switches": 47, "switches_per_hour": 11.2},
             "tier": 1, "confidence_note": "A switch is a window change."},
        ],
    }


def _stats():
    return {
        "meta": {"raw_event_count": 900, "interaction_count": 460,
                 "normalization_run_at": "2026-06-10T12:00:00+00:00"},
        "case_stats": [
            {"case_id": "c1", "wall_clock_ms": 600000},
            {"case_id": "c2", "wall_clock_ms": 1200000},
        ],
        "step_variants": [{"variant": ["A", "B"], "frequency": 3},
                          {"variant": ["A", "C"], "frequency": 1}],
    }


def _manifest():
    return {"session_id": "sess-2026-0514-0900",
            "started_at": "2026-05-14T09:00:00Z"}


def test_header_names_the_session_and_capture_date():
    md = render_memo(_manifest(), _stats(), _analysis(), {})
    assert md.startswith("# Findings memo — sess-2026-0514-0900")
    assert "Captured 2026-05-14" in md
    assert "900 events (460 interactions)" in md


def test_fact_strip_renders_measured_values():
    md = render_memo(_manifest(), _stats(), _analysis(), {})
    assert "| Active (foreground) |" in md
    assert "1h 15m" in md            # active_ms
    assert "chrome.exe (31%)" in md  # top app + share
    assert "47 (11.2/h)" in md       # switches
    assert "3 (5 repeated sequences)" in md


def test_findings_carry_claim_numbers_and_starred_refs():
    md = render_memo(_manifest(), _stats(), _analysis(), {})
    assert "**chrome.exe accounts for 31%" in md
    assert "★ `screenshots/shot_02.png`" in md
    assert "Evidence:" in md
    assert "_Foreground-window time._" in md


def test_tier2_section_renders_only_when_unlocked():
    md = render_memo(_manifest(), _stats(), _analysis(tier2=True), {})
    assert "4 cases" in md
    assert "Cycle time (wall clock): mean 15m" in md
    assert "2 distinct path variants" in md
    assert "not case-segmented" not in md


def test_tier2_locked_renders_the_one_honest_line():
    anno = {"anchor_candidates": [{"signature": "x"}, {"signature": "y"}]}
    md = render_memo(_manifest(), _stats(), _analysis(tier2=False), anno)
    assert "not case-segmented; 2 anchor candidates are awaiting review" in md
    # No fabricated case numbers below the gate.
    assert "Cycle time (wall clock)" not in md


def test_tier2_locked_without_candidates_points_at_markers():
    md = render_memo(_manifest(), _stats(), _analysis(tier2=False), {})
    assert "no anchor candidates were detected" in md


def test_memo_selection_filters_the_findings():
    anno = {"memo_selection": ["fragmentation-bbb"]}
    md = render_memo(_manifest(), _stats(), _analysis(), anno)
    assert "Focus moved between apps 47 times" in md
    assert "chrome.exe accounts for" not in md


def test_unknown_selection_falls_back_to_top_findings():
    anno = {"memo_selection": ["does-not-exist"]}
    md = render_memo(_manifest(), _stats(), _analysis(), anno)
    assert "chrome.exe accounts for" in md


def test_to_say_more_enumerates_missing_inputs():
    md = render_memo(_manifest(), _stats(), _analysis(tier2=False),
                     {"anchor_candidates": [{"signature": "x"}]})
    assert "## To say more" in md
    assert "Case segmentation" in md
    assert "loaded labour rate" in md          # roi_inputs absent
    assert "No idle events were measured" in md
    assert "value-add vs business-required" in md.lower()


def test_to_say_more_drops_supplied_inputs():
    anno = {"roi_inputs": {"loaded_cost_per_hour": 36},
            "analysis_overrides": [{"process_label": "Search", "bnva_ms": 1000}]}
    a = _analysis(tier2=True)
    a["facts"]["idle_ms"] = 60000
    md = render_memo(_manifest(), _stats(), a, anno)
    assert "loaded labour rate" not in md
    assert "No idle events" not in md
    assert "business-required split" not in md


def test_no_findings_renders_an_honest_empty_line():
    md = render_memo(_manifest(), _stats(), _analysis(findings=[]), {})
    assert "No findings fired" in md


def test_write_memo_reads_session_sidecars(tmp_path=None):
    tmp = Path(tempfile.mkdtemp(prefix="pdt-memo-test-")) if tmp_path is None else tmp_path
    (tmp / "manifest.json").write_text(json.dumps(_manifest()), encoding="utf-8")
    (tmp / "stats.json").write_text(json.dumps(_stats()), encoding="utf-8")
    (tmp / "analysis.json").write_text(json.dumps(_analysis()), encoding="utf-8")
    (tmp / "annotations.json").write_text(json.dumps({}), encoding="utf-8")
    out = tmp / "memo.md"
    write_memo(str(out), str(tmp))
    text = out.read_text(encoding="utf-8")
    assert text.startswith("# Findings memo — sess-2026-0514-0900")
    assert len(text) > 400


def test_render_tolerates_empty_inputs():
    md = render_memo(None, None, None, None)
    assert md.startswith("# Findings memo — session")
    assert "## To say more" in md


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
