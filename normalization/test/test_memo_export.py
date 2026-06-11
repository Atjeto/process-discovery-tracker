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
    assert "| Active time |" in md
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
    assert "No cases identified yet" not in md


def test_tier2_locked_renders_the_one_honest_line():
    anno = {"anchor_candidates": [{"signature": "x"}, {"signature": "y"}]}
    md = render_memo(_manifest(), _stats(), _analysis(tier2=False), anno)
    assert ("No cases identified yet in this recording; 2 candidate fields "
            "that could identify each case are awaiting review") in md
    # No fabricated case numbers below the gate.
    assert "Cycle time (wall clock)" not in md


def test_tier2_locked_without_candidates_points_at_markers():
    md = render_memo(_manifest(), _stats(), _analysis(tier2=False), {})
    assert "no candidate field was detected" in md


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
    assert "No cases identified yet" in md
    assert "loaded labour rate" in md          # roi_inputs absent
    assert "No idle time was measured" in md
    assert "judge each step type" in md


def test_to_say_more_drops_supplied_inputs():
    anno = {"roi_inputs": {"loaded_cost_per_hour": 36},
            "analysis_overrides": [{"process_label": "Search", "bnva_ms": 1000}]}
    a = _analysis(tier2=True)
    a["facts"]["idle_ms"] = 60000
    md = render_memo(_manifest(), _stats(), a, anno)
    assert "loaded labour rate" not in md
    assert "No idle time was measured" not in md
    assert "judge each step type" not in md


def test_no_findings_renders_an_honest_empty_line():
    md = render_memo(_manifest(), _stats(), _analysis(findings=[]), {})
    assert "Nothing stood out" in md


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


# ---- §B4: the docx variant (deps-gated like test_pdd_export) ----------------

import memo_export as _memo_mod  # noqa: E402

_HAVE_DOCX = _memo_mod.Document is not None


def _docx_texts(path):
    from docx import Document
    doc = Document(str(path))
    return [p.text for p in doc.paragraphs], doc


def _make_png():
    """A tiny but fully-valid PNG (correct CRCs), as in test_pdd_export."""
    import struct, zlib
    def chunk(typ, data):
        body = typ + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * 2 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def test_write_memo_docx_variant_with_inline_screenshots():
    """`--memo-out x.docx` writes the Word memo; the starred screenshot
    refs embed INLINE as evidence figures (lab-phase §B4)."""
    if not _HAVE_DOCX:
        return
    tmp = Path(tempfile.mkdtemp(prefix="pdt-memo-docx-"))
    (tmp / "screenshots").mkdir()
    (tmp / "screenshots" / "shot_02.png").write_bytes(_make_png())
    (tmp / "manifest.json").write_text(json.dumps(_manifest()), encoding="utf-8")
    (tmp / "stats.json").write_text(json.dumps(_stats()), encoding="utf-8")
    (tmp / "analysis.json").write_text(json.dumps(_analysis()), encoding="utf-8")
    (tmp / "annotations.json").write_text(json.dumps({}), encoding="utf-8")
    out = tmp / "memo.docx"
    write_memo(str(out), str(tmp))
    assert out.exists() and out.stat().st_size > 0
    texts, doc = _docx_texts(out)
    assert any(t.startswith("Findings memo — sess-2026-0514-0900") for t in texts)
    assert "What the recording measured" in texts
    assert any("chrome.exe accounts for 31%" in t for t in texts)
    assert len(doc.inline_shapes) >= 1            # the ★ screenshot embedded
    assert any("★ screenshots/shot_02.png" in t for t in texts)
    # The fact strip lands as a table with the shared 6 cells.
    cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]
    assert "Active time" in cells and "1h 15m" in cells


def test_memo_docx_skips_traversal_screenshot_refs():
    """The docx memo applies the same containment check as pdd_export: an
    absolute or out-of-folder ref is skipped, never embedded."""
    if not _HAVE_DOCX:
        return
    tmp = Path(tempfile.mkdtemp(prefix="pdt-memo-sec-"))
    evil = _analysis(findings=[
        {"id": "x", "detector": "screen_time_sink",
         "claim": "claim.", "tier": 1,
         "evidence": {"screenshot_refs": ["..\\..\\outside.png",
                                          "C:\\Windows\\notepad.png"]}},
    ])
    (tmp / "manifest.json").write_text(json.dumps(_manifest()), encoding="utf-8")
    (tmp / "stats.json").write_text(json.dumps(_stats()), encoding="utf-8")
    (tmp / "analysis.json").write_text(json.dumps(evil), encoding="utf-8")
    (tmp / "annotations.json").write_text(json.dumps({}), encoding="utf-8")
    out = tmp / "memo.docx"
    write_memo(str(out), str(tmp))
    _texts, doc = _docx_texts(out)
    assert len(doc.inline_shapes) == 0


def test_memo_model_and_md_agree_on_selection():
    """§B3 one-source-of-truth: build_memo_model returns exactly the findings
    the md render shows (the PDD §1 consumes the same model)."""
    from memo_export import build_memo_model
    anno = {"memo_selection": ["fragmentation-bbb"]}
    model = build_memo_model(_manifest(), _stats(), _analysis(), anno)
    assert [f["claim"] for f in model["findings"]] == [
        "Focus moved between apps 47 times (11.2/h)."]
    md = render_memo(_manifest(), _stats(), _analysis(), anno)
    assert "Focus moved between apps 47 times" in md
    assert "chrome.exe accounts for" not in md


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
