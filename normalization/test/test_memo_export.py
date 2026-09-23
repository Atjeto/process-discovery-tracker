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
    assert cells["Top app"] == "chrome.exe (31%)"               # top app + share
    assert cells["App switches"] == "47 (11.2/h)"               # switches
    assert cells["Values re-typed across apps"] == "3 (5 repeated sequences)"


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
    assert "4 cases" in lines
    assert "Cycle time (wall clock): mean 15m" in lines
    assert "2 distinct path variants" in lines
    assert "No cases identified yet" not in lines


def test_tier2_locked_renders_the_one_honest_line():
    model = build_memo_model(_manifest(), _stats(), _analysis(tier2=False), {})
    assert model["tier2_lines"] == [
        "No cases identified yet in this recording; recording Start/End "
        "markers would unlock the case-by-case numbers."]
    # No fabricated case numbers below the gate.
    assert not any("Cycle time (wall clock)" in l for l in model["tier2_lines"])


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
    assert "1 case was marked" in text
    assert "need at least 2" in text
    assert "No cases identified yet" not in text
    assert "Cycle time (wall clock)" not in text


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
    assert "No cases identified yet" in more
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


# ---- ADR-0028 §4: named work items in the Case-by-case section --------------

def _wi_step(step_id, case_id, screen, start):
    return {"step_id": step_id, "name": f"{screen}: {step_id}",
            "case_id": case_id, "state": "auto_suggested",
            "grain_keys": {"element": step_id, "screen": screen, "app": "app"},
            "time_range": {"start": start, "end": start}}


def _wi_annotations():
    return {
        "steps": [
            _wi_step("s1", "c1", "Salesforce - Order #10900", "2026-05-14T09:00:00Z"),
            _wi_step("s2", "c1", "va01", "2026-05-14T09:00:05Z"),
        ],
        "group_annotations": [
            {"case_id": "c1", "screen_key": "scr:Salesforce - Order",
             "name": "Enter the order lines", "notes": "unit price is always 49.99",
             "manually_authored": True},
            {"case_id": "c1", "screen_key": "scr:va01",
             "name": "Re-key order into SAP", "waste": True,
             "manually_authored": True},
        ],
    }


def _wi_stats():
    return {"meta": {"raw_event_count": 900, "interaction_count": 460},
            "case_stats": [{"case_id": "c1", "label": "Order #10900",
                            "wall_clock_ms": 60000}]}


def test_named_work_items_carry_ticket_note_and_waste_flag():
    model = build_memo_model(_manifest(), _wi_stats(), _analysis(tier2=True),
                             _wi_annotations())
    by_name = {wi["name"]: wi for wi in model["named_work_items"]}
    # The analyst name against its ticket, and its note.
    assert by_name["Enter the order lines"]["case_label"] == "Order #10900"
    assert by_name["Enter the order lines"]["notes"] == "unit price is always 49.99"
    # The waste-flagged item carries the waste flag.
    assert by_name["Re-key order into SAP"]["case_label"] == "Order #10900"
    assert by_name["Re-key order into SAP"]["waste"] is True


def test_memo_without_group_annotations_is_unchanged():
    """Additive no-op: a session with no group_annotations gets NO named work
    items -- the memo is exactly as before (the demo-session posture)."""
    model = build_memo_model(_manifest(), _stats(), _analysis(tier2=True), {})
    assert model["named_work_items"] == []


def test_memo_model_carries_named_work_items():
    model = build_memo_model(_manifest(), _wi_stats(), _analysis(tier2=True),
                             _wi_annotations())
    names = [wi["name"] for wi in model["named_work_items"]]
    assert "Enter the order lines" in names
    assert "Re-key order into SAP" in names
    # Only annotated visits reach the memo (both here carry a name).
    assert all(wi["case_label"] == "Order #10900" for wi in model["named_work_items"])


def test_named_work_items_in_docx_memo():
    if not _HAVE_DOCX:
        return
    model = build_memo_model(_manifest(), _wi_stats(), _analysis(tier2=True),
                             _wi_annotations())
    texts, _doc = _docx_body(model)
    assert any("Enter the order lines" in t for t in texts)
    assert any("Re-key order into SAP" in t for t in texts)


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


# ---- RP-06 hidden work items, RP-10 failed stages (lane L4) ----------------

def test_a_hidden_work_item_stays_out_of_the_memo_lines():
    """RP-06: a work item the analyst hid never reaches the deliverable."""
    anno = _wi_annotations()
    anno["group_annotations"][1]["hidden"] = True
    model = build_memo_model(_manifest(), _wi_stats(), _analysis(tier2=True), anno)
    names = [wi["name"] for wi in model["named_work_items"]]
    assert "Enter the order lines" in names            # the visible item stays
    assert "Re-key order into SAP" not in names


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
    assert "could not run on this recording" in lines
    assert "No cases identified" not in lines


def test_the_less_detail_caveat_names_no_removed_feature():
    """The coverage caveat line used to send the reader to App Library
    discovery, which was removed with the BA-helper refocus."""
    a = _analysis(findings=[
        {"id": "coverage_caveat-x", "detector": "coverage_caveat",
         "claim": "claim.", "tier": 1,
         "evidence": {"flagged_apps": [{"app": "mstsc.exe"}]}},
    ])
    more = " ".join(build_memo_model(_manifest(), _stats(), a, {})["to_say_more"])
    assert ("The recorder saw less detail in mstsc.exe, so the numbers "
            "measured inside that app are less precise.") in more
    assert "App Library" not in more


def test_a_failed_motif_stage_says_so_for_the_repeated_sequences():
    a = _analysis()
    a["facts"]["repeated_sequence_count"] = None     # written null when motifs fail
    cell = _cells(build_memo_model(_manifest(), _stats(), a, {}))["Values re-typed across apps"]
    assert cell == "3 (repeated sequences: could not run on this recording)"


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
