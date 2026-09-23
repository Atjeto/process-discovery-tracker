"""Tests for memo_export (lab-phase spec §A4) -- the findings model the PDD's
§1 renders (build_memo_model) and its docx rendering (write_memo_into_docx).

The model tests are pure stdlib and run under any pytest; the docx tests need
python-docx and no-op without it (like test_pdd_export), so they execute under
the bundled python.
"""

from __future__ import annotations
import importlib.util
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memo_export import build_memo_model, write_memo_into_docx

_HAVE_DOCX = importlib.util.find_spec("docx") is not None


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


def _cells(model):
    return dict(model["fact_cells"])


def _docx_body(model, session_folder=None):
    """Render the memo body into a fresh Document, as pdd_export's §1 does."""
    from docx import Document
    doc = Document()
    write_memo_into_docx(doc, model, session_folder=session_folder)
    return [p.text for p in doc.paragraphs], doc


def test_model_names_the_session_and_capture_date():
    model = build_memo_model(_manifest(), _stats(), _analysis(), {})
    assert model["label"] == "sess-2026-0514-0900"
    assert model["captured"] == "2026-05-14"
    assert "900 events (460 interactions)" in model["coverage_line"]


def test_fact_cells_carry_measured_values():
    cells = _cells(build_memo_model(_manifest(), _stats(), _analysis(), {}))
    assert cells["Active time"] == "1h 15m"                     # active_ms
    # DA gap 3: no app_names map here, so the capitalized executable name.
    assert cells["Top app"] == "Chrome (31%)"                   # top app + share
    assert cells["App switches"] == "47 (11.2/h)"               # 90 min: rate shown
    # DA gap 8: two counts, two cells.
    assert cells["Values re-typed across apps"] == "3"
    assert cells["Repeated step sequences"] == "5"


def test_top_app_cell_uses_the_readable_app_name():
    stats = dict(_stats(), meta=dict(_stats()["meta"],
                                     app_names={"chrome.exe": "Google Chrome"}))
    cells = _cells(build_memo_model(_manifest(), stats, _analysis(), {}))
    assert cells["Top app"] == "Google Chrome (31%)"
    assert not any("chrome.exe" in v for v in cells.values())


def test_switch_rate_is_stated_only_for_a_recording_of_30_minutes_or_more():
    """DA gap 9: below 30 minutes the cell is the plain count, never a rate
    extrapolated from a few minutes."""
    short = _analysis()
    short["facts"]["session_span_ms"] = 29 * 60 * 1000
    assert _cells(build_memo_model(_manifest(), _stats(), short, {}))[
        "App switches"] == "47"
    edge = _analysis()
    edge["facts"]["session_span_ms"] = 30 * 60 * 1000
    assert _cells(build_memo_model(_manifest(), _stats(), edge, {}))[
        "App switches"] == "47 (11.2/h)"


def test_findings_carry_claim_numbers_and_starred_refs():
    model = build_memo_model(_manifest(), _stats(), _analysis(), {})
    first = model["findings"][0]
    assert first["claim"].startswith("chrome.exe accounts for 31%")
    assert first["screenshot_refs"] == ["screenshots/shot_02.png"]
    assert "share 31%" in first["evidence_line"]
    assert first["confidence_note"] == "Foreground-window time."


def test_tier2_section_renders_only_when_unlocked():
    lines = " ".join(build_memo_model(_manifest(), _stats(),
                                      _analysis(tier2=True), {})["tier2_lines"])
    assert "4 runs were marked" in lines
    # DA gap 7: the same metric name the PDD's timings table uses.
    assert ("Elapsed time per run (wall clock): mean 15m, fastest 10m, "
            "slowest 20m, across 2 timed runs.") in lines
    assert "2 different step sequences" in lines
    assert "No runs were marked" not in lines


def test_tier2_locked_renders_the_one_honest_line():
    model = build_memo_model(_manifest(), _stats(), _analysis(tier2=False), {})
    assert model["tier2_lines"] == [
        "No runs were marked in this recording; marking each repetition "
        "as a run would unlock the run-by-run numbers."]
    # No fabricated run numbers below the gate.
    assert not any("Elapsed time per run" in l for l in model["tier2_lines"])


def test_tier2_locked_ignores_legacy_anchor_candidates():
    """Anchor candidates were removed with their review UI: a legacy
    anchor_candidates block in an old annotations.json must not produce a
    'candidate fields awaiting review' line any more."""
    anno = {"anchor_candidates": [{"signature": "x"}, {"signature": "y"}]}
    plain = build_memo_model(_manifest(), _stats(), _analysis(tier2=False), {})
    legacy = build_memo_model(_manifest(), _stats(), _analysis(tier2=False), anno)
    assert legacy["tier2_lines"] == plain["tier2_lines"]
    assert legacy["to_say_more"] == plain["to_say_more"]
    text = " ".join(legacy["tier2_lines"] + legacy["to_say_more"])
    assert "candidate field" not in text


def test_tier2_locked_on_single_case_says_so_not_unsegmented():
    # G-3 (owner's real session): 1 marked case at near-full coverage is
    # locked, and the memo must say WHY -- not pretend no cases exist.
    a = _analysis(tier2=False)
    a["case_quality"] = {"mode": "markers", "case_count": 1,
                         "coverage": 0.999, "tier2_unlocked": False}
    model = build_memo_model(_manifest(), _stats(), a, {})
    text = " ".join(model["tier2_lines"] + model["to_say_more"])
    assert "1 run was marked" in text
    assert "needs at least 2 runs" in text
    assert "No runs were marked" not in text
    assert "Elapsed time per run" not in text


def test_fact_cells_say_not_available_when_no_app_signal():
    # G-2: app_time_source == "none" must never render a confident 0.
    a = _analysis()
    a["facts"].update({"active_ms": 0, "top_apps": [], "app_switches": 0,
                       "longest_focus_ms": 0, "app_time_source": "none"})
    values = list(_cells(build_memo_model(_manifest(), _stats(), a, {})).values())
    assert values.count("not available from this recording") >= 3
    assert "0 (0/h)" not in values


def test_fact_cells_label_interaction_derived_estimate():
    a = _analysis()
    a["facts"]["app_time_source"] = "interactions"
    values = _cells(build_memo_model(_manifest(), _stats(), a, {})).values()
    assert any("estimated from clicks and typing" in v for v in values)


def test_memo_selection_filters_the_findings():
    anno = {"memo_selection": ["fragmentation-bbb"]}
    claims = [f["claim"] for f in
              build_memo_model(_manifest(), _stats(), _analysis(), anno)["findings"]]
    assert claims == ["Focus moved between apps 47 times (11.2/h)."]


def test_unknown_selection_falls_back_to_top_findings():
    anno = {"memo_selection": ["does-not-exist"]}
    claims = [f["claim"] for f in
              build_memo_model(_manifest(), _stats(), _analysis(), anno)["findings"]]
    assert any(c.startswith("chrome.exe accounts for") for c in claims)


def test_to_say_more_enumerates_missing_inputs():
    more = " ".join(build_memo_model(
        _manifest(), _stats(), _analysis(tier2=False),
        {"anchor_candidates": [{"signature": "x"}]})["to_say_more"])
    assert "No runs were marked." in more
    assert "No idle time was measured" in more
    assert "judge each step type" in more
    # The ROI layer was removed: no labour-rate / savings-band request.
    assert "loaded labour rate" not in more


def test_to_say_more_drops_supplied_inputs():
    anno = {"analysis_overrides": [{"process_label": "Search", "bnva_ms": 1000}]}
    a = _analysis(tier2=True)
    a["facts"]["idle_ms"] = 60000
    more = " ".join(build_memo_model(_manifest(), _stats(), a, anno)["to_say_more"])
    assert "No idle time was measured" not in more
    assert "judge each step type" not in more


def test_no_findings_renders_an_honest_empty_line():
    model = build_memo_model(_manifest(), _stats(), _analysis(findings=[]), {})
    assert model["findings"] == []
    if not _HAVE_DOCX:
        return
    texts, _doc = _docx_body(model)
    assert any("Nothing stood out" in t for t in texts)


def test_model_tolerates_empty_inputs():
    model = build_memo_model(None, None, None, None)
    assert model["label"] == "session"
    assert isinstance(model["to_say_more"], list) and model["to_say_more"]


# ---- §B4: the docx rendering (deps-gated like test_pdd_export) --------------

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


def test_memo_body_docx_embeds_starred_screenshots_inline():
    """The starred screenshot refs embed INLINE as evidence figures
    (lab-phase §B4) when the memo body is written into a docx."""
    if not _HAVE_DOCX:
        return
    with tempfile.TemporaryDirectory(prefix="pdt-memo-docx-") as tmp:
        (Path(tmp) / "screenshots").mkdir()
        (Path(tmp) / "screenshots" / "shot_02.png").write_bytes(_make_png())
        model = build_memo_model(_manifest(), _stats(), _analysis(), {})
        texts, doc = _docx_body(model, session_folder=tmp)
    assert "What the recording measured" in texts
    assert any("chrome.exe accounts for 31%" in t for t in texts)
    assert len(doc.inline_shapes) >= 1            # the ★ screenshot embedded
    assert any("★ screenshots/shot_02.png" in t for t in texts)
    # The fact strip lands as a table with the shared 6 cells.
    cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]
    assert "Active time" in cells and "1h 15m" in cells


def test_memo_docx_skips_traversal_screenshot_refs():
    """The docx memo body applies the same containment check as pdd_export:
    an absolute or out-of-folder ref is skipped, never embedded."""
    if not _HAVE_DOCX:
        return
    evil = _analysis(findings=[
        {"id": "x", "detector": "screen_time_sink",
         "claim": "claim.", "tier": 1,
         "evidence": {"screenshot_refs": ["..\\..\\outside.png",
                                          "C:\\Windows\\notepad.png"]}},
    ])
    with tempfile.TemporaryDirectory(prefix="pdt-memo-sec-") as tmp:
        model = build_memo_model(_manifest(), _stats(), evil, {})
        _texts, doc = _docx_body(model, session_folder=tmp)
    assert len(doc.inline_shapes) == 0


# ---- case-based findings: labeled, and only when runs exist -----------------

def _repetition_finding():
    return {"id": "repetition-ccc", "detector": "repetition", "tier": 2,
            "claim": "The step sequence \"Lookup → Paste\" in Excel was "
                     "repeated 4 times, totalling 4m (average 1m per repeat).",
            "evidence": {"segment_signature": "sigA", "instance_count": 4},
            "confidence_note": "Counts exact repeats."}


def test_a_case_based_finding_is_labeled_across_runs():
    a = _analysis(findings=_analysis()["findings"] + [_repetition_finding()])
    model = build_memo_model(_manifest(), _stats(), a, {})
    flags = {f["claim"][:20]: f["case_based"] for f in model["findings"]}
    assert flags["The step sequence \"L"] is True
    assert flags["chrome.exe accounts "] is False
    if not _HAVE_DOCX:
        return
    texts, _doc = _docx_body(model)
    assert "3. Across runs: The step sequence \"Lookup → Paste\" in Excel was " \
           "repeated 4 times, totalling 4m (average 1m per repeat)." in texts
    assert "1. chrome.exe accounts for 31% of measured foreground time " \
           "(23m 15s of 1h 15m)." in texts


def test_a_case_based_finding_is_left_out_when_there_are_no_runs():
    a = _analysis(tier2=False,
                  findings=_analysis()["findings"] + [_repetition_finding()])
    no_runs = {"meta": _stats()["meta"], "case_stats": []}
    claims = [f["claim"] for f in build_memo_model(_manifest(), no_runs, a, {})["findings"]]
    assert len(claims) == 2 and not any("step sequence" in c for c in claims)
    # Positive control: the same finding renders once the recording has runs.
    claims = [f["claim"] for f in build_memo_model(_manifest(), _stats(), a, {})["findings"]]
    assert any("step sequence" in c for c in claims)


def test_memo_model_and_docx_agree_on_selection():
    """§B3 one-source-of-truth: build_memo_model returns exactly the findings
    the docx body shows (the PDD §1 renders the same model)."""
    anno = {"memo_selection": ["fragmentation-bbb"]}
    model = build_memo_model(_manifest(), _stats(), _analysis(), anno)
    assert [f["claim"] for f in model["findings"]] == [
        "Focus moved between apps 47 times (11.2/h)."]
    if not _HAVE_DOCX:
        return
    texts, _doc = _docx_body(model)
    assert any("Focus moved between apps 47 times" in t for t in texts)
    assert not any("chrome.exe accounts for" in t for t in texts)


# ---- RP-10 failed stages (lane L4) -------------------------------------------

def _with_failed(analysis, *stages):
    """C12 shape: each failed stage's output key is null and named once."""
    for stage in stages:
        analysis[stage] = None
    analysis["stage_errors"] = [{"stage": s, "error": "KeyError: 'x'"} for s in stages]
    return analysis


def test_a_failed_facts_stage_renders_could_not_run_not_zeros():
    """RP-10: a failed facts stage used to render zeros ("0s", "0 (0/h)")."""
    model = build_memo_model(_manifest(), _stats(), _with_failed(_analysis(), "facts"), {})
    assert set(_cells(model).values()) == {"could not run on this recording"}
    assert "No idle time was measured" not in " ".join(model["to_say_more"])


def test_a_failed_findings_stage_is_not_nothing_stood_out():
    model = build_memo_model(_manifest(), _stats(), _with_failed(_analysis(), "findings"), {})
    assert model["findings"] == [] and model.get("findings_failed") is True
    if not _HAVE_DOCX:
        return
    texts, _doc = _docx_body(model)
    assert any("could not run on this recording" in t for t in texts)
    assert not any("Nothing stood out" in t for t in texts)


def test_a_failed_case_check_is_not_no_cases_identified():
    model = build_memo_model(_manifest(), _stats(),
                             _with_failed(_analysis(tier2=False), "case_quality"), {})
    lines = " ".join(model["tier2_lines"] + model["to_say_more"])
    assert "The run check could not run on this recording" in lines
    assert "No runs were marked" not in lines


def test_the_less_detail_caveat_names_no_removed_feature():
    """The coverage caveat line used to send the reader to App Library
    discovery, which was removed with the BA-helper refocus."""
    a = _analysis(findings=[
        {"id": "coverage_caveat-x", "detector": "coverage_caveat",
         "claim": "claim.", "tier": 1,
         "evidence": {"flagged_apps": [{"app": "mstsc.exe"}]}},
    ])
    more = " ".join(build_memo_model(_manifest(), _stats(), a, {})["to_say_more"])
    # DA gap 3: the capitalized executable name, not the token "mstsc.exe".
    assert ("The recorder saw less detail in Mstsc, so the numbers "
            "measured inside that app are less precise.") in more
    assert "App Library" not in more


def test_a_failed_motif_stage_says_so_for_the_repeated_sequences():
    a = _analysis()
    a["facts"]["repeated_sequence_count"] = None     # written null when motifs fail
    cells = _cells(build_memo_model(_manifest(), _stats(), a, {}))
    assert cells["Repeated step sequences"] == "could not run on this recording"
    assert cells["Values re-typed across apps"] == "3"     # still measured


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
