"""Tests for pdd_export -- the analysis-layer enrichment path (I78).

Deps-gated: write_pdd needs python-docx. When it is not installed the
tests no-op rather than fail, matching how the rest of the suite treats
optional dependencies.

Run with pytest:
    pytest normalization/test/test_pdd_export.py
or directly:
    python normalization/test/test_pdd_export.py
"""

from __future__ import annotations
import struct
import sys
import tempfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pdd_export

_HAVE_DOCX = pdd_export.Document is not None


def _sample():
    manifest = {
        "engagement_id": "ENG-1", "session_id": "s1",
        "started_at": "2026-05-17T10:00:00Z",
        "config": {"worker": {"id": "w1"}},
    }
    annotations = {
        "steps": [
            {"step_id": "st1", "name": "Enter customer data",
             "description": "", "flags": {}},
        ],
        "phases": [],
    }
    stats = {"activity_stats": []}
    analysis = {
        "case_quality": {"mode": "markers", "case_count": 2,
                         "coverage": 0.95, "tier2_unlocked": True},
        "findings": [
            {"id": "screen_time_sink-aaa", "detector": "screen_time_sink",
             "claim": "crm.exe accounts for 31% of measured foreground time.",
             "evidence": {"app": "crm.exe", "share": 0.31,
                          "screenshot_refs": []},
             "tier": 1, "confidence_note": "Foreground-window time."},
        ],
        "waste_classification": [
            {"step_id": "st1", "name": "Enter customer data",
             "elapsed_ms": 100000, "va_ms": 60000, "bnva_ms": 0,
             "nva_ms": 40000, "waste_types": ["waiting", "motion"]},
        ],
        # ADR-0016: segment-grain candidacy. One coherent stretch of
        # work seen four times across cases.
        "automation_candidates": [
            {"segment_signature": "abc123def456",
             "label": "crm — Search → Copy → Paste",
             "app": "crm.exe",
             "apps": ["crm.exe"],
             "step_labels": ["Search", "Copy", "Paste"],
             "case_ids": ["c1", "c2", "c3", "c4"],
             "instance_count": 4,
             "total_elapsed_ms": 134000,
             "mean_elapsed_ms": 33500,
             "instances": [],
             "scores": {"confidence": 1.0, "volume": 134000},
             "estimated_savings_ms": None,
             "automation_confirmed": None,
             "data_sufficiency": "multi_instance"},
        ],
        "efficiency": {"process_efficiency_ratio": 0.6, "total_va_ms": 60000,
                       "total_nva_ms": 40000, "total_elapsed_ms": 100000},
    }
    return manifest, annotations, stats, analysis


def test_write_pdd_with_analysis_produces_a_file():
    if not _HAVE_DOCX:
        return  # python-docx absent -- deps-gated, nothing to assert
    manifest, annotations, stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out,
            session_folder=Path(tmp),
            canonical=None,
            annotations=annotations,
            stats=stats,
            manifest=manifest,
            analysis=analysis,
        )
        assert out.exists()
        assert out.stat().st_size > 0


def test_write_pdd_without_analysis_still_works():
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, _ = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out,
            session_folder=Path(tmp),
            canonical=None,
            annotations=annotations,
            stats=stats,
            manifest=manifest,
        )
        assert out.exists()


def test_pdd_structure_mirrors_real_pdd():
    """The PDD follows a standard RPA-PDD outline (document control, introduction,
    an As-Is description, an automation assessment, exceptions) -- auto-filled
    where we have data, with explicit placeholders for the analyst-judgement
    sections rather than silently omitting them."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, _stats, analysis = _sample()
    stats = {
        "activity_stats": [
            {"activity_label": "Text entry -- app.exe", "frequency": 3,
             "total_duration_ms": 30000, "median_ms": 10000},
            {"activity_label": "Search -- app.exe", "frequency": 1,
             "total_duration_ms": 10000, "median_ms": 10000},
        ],
        "case_stats": [
            {"case_id": "c1", "active_ms": 40000},
            {"case_id": "c2", "active_ms": 60000},
        ],
        "meta": {"case_count": 2, "step_count": 5,
                 "step_state_breakdown": {"auto_suggested": 4, "edited": 1},
                 "phase_count": 0,
                 "vocab_coverage": {"app.exe": {"total_interactions": 12}}},
    }
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp),
            canonical={"name": "Order entry", "version": 2},
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        texts = [p.text for p in doc.paragraphs]
        cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]

        # The canonical section outline is present -- findings-first (§B3):
        # §1 is the memo content, the long-form body renumbered behind it.
        for heading in ["1. Findings", "2. Document control", "3. Introduction",
                        "4. As-Is Process", "4.2 Applications used",
                        "4.4 Process statistics", "4.5 Detailed process steps",
                        "5. Automation assessment", "5.3 Automation candidates",
                        "6. Exceptions & variations"]:
            assert heading in texts, f"missing PDD section: {heading}"

        # §1 renders the same findings model the memo uses (one source of truth).
        assert any("crm.exe accounts for 31%" in t for t in texts)
        assert "What the capture measured" in texts

        # Analyst-judgement gaps are explicit, not silently dropped.
        assert any(t.startswith("[To be completed:") for t in texts)

        # Auto-filled data lands in the right sections.
        assert any(c == "2 (avg 50.0s each)" for c in cells)            # 4.4 statistics
        assert any(c == "5 (4 auto-detected, 1 confirmed)" for c in cells)
        assert any(c == "app.exe" for c in cells)                       # 4.2 applications
        assert any("Where the time went" in t for t in texts)
        # 4.3 candidates: the segment label, application column, and
        # instance count from the sample analysis above.
        assert any("crm" in c.lower() and "Search" in c and "Paste" in c
                   for c in cells)
        assert any(c == "4" for c in cells)                             # instance_count
        # The narrative top-3 summary paragraph mentions the sequence.
        assert any("Search → Copy → Paste" in t for t in texts)
        assert any(t.startswith("Generated by the Process Discovery Viewer") for t in texts)


def _make_png(width=2, height=2):
    """Build a small but fully valid PNG (correct CRCs) to stand in for a
    rendered process map. A hand-rolled byte blob trips stricter docx versions,
    so construct a real one with stdlib struct + zlib."""
    def chunk(typ, data):
        body = typ + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)   # 8-bit RGB
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def test_pdd_embeds_process_map_when_provided():
    """When the viewer passes a rendered map image, section 3.3 embeds it
    instead of showing the 'not yet embedded' placeholder."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, _stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "map.png"
        png.write_bytes(_make_png())
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp), canonical=None,
            annotations=annotations, stats={"activity_stats": []},
            manifest=manifest, analysis=analysis, process_map_image=str(png),
        )
        from docx import Document
        doc = Document(str(out))
        assert len(doc.inline_shapes) >= 1   # the map image was embedded
        assert not any("not yet embedded" in p.text for p in doc.paragraphs)


def test_pdd_embeds_tobe_map_when_selected():
    """ADR-0019: a selected To-Be reference map is embedded under a labelled
    'Proposed to-be process' section, captioned as analyst-authored (not mined)."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, _stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "tobe.png"
        png.write_bytes(_make_png())
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp), canonical=None,
            annotations=annotations, stats={"activity_stats": []},
            manifest=manifest, analysis=analysis, tobe_map_image=str(png),
        )
        from docx import Document
        doc = Document(str(out))
        texts = [p.text for p in doc.paragraphs]
        assert any("5.5 Proposed to-be process" in t for t in texts)
        assert any("NOT mined" in t for t in texts)          # provenance caption
        assert len(doc.inline_shapes) >= 1


def test_pdd_omits_tobe_section_when_not_selected():
    """No To-Be map selected -> the 4.5 section is omitted entirely (no empty
    placeholder), so the document never implies a future-state that isn't there."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp), canonical=None,
            annotations=annotations, stats=stats, manifest=manifest, analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        assert not any("Proposed to-be process" in p.text for p in doc.paragraphs)


def test_unphased_manually_authored_step_appears_in_output():
    """H-2: once phases exist, steps in no phase -- including analyst
    manually-authored steps -- must still be rendered, under an
    'Unphased steps' subsection, not silently dropped."""
    if not _HAVE_DOCX:
        return
    manifest, _annotations, stats, analysis = _sample()
    annotations = {
        "steps": [
            {"step_id": "st1", "name": "Phased step",
             "description": "", "flags": {}, "state": "auto_matched"},
            {"step_id": "st2", "name": "Analyst-authored unphased step",
             "description": "", "flags": {}, "state": "manually_authored"},
        ],
        "phases": [
            {"phase_id": "ph1", "name": "Phase one", "step_ids": ["st1"]},
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp), canonical=None,
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        texts = [p.text for p in doc.paragraphs]
        assert any("Unphased steps" in t for t in texts)
        assert any("Analyst-authored unphased step" in t for t in texts)
        assert any("Phased step" in t for t in texts)


def test_hidden_step_is_not_rendered():
    """M-5: noise-suppressed (state == 'hidden') steps are filtered out of
    §3.5 and §5, consistent with the rest of the pipeline."""
    if not _HAVE_DOCX:
        return
    manifest, _annotations, stats, analysis = _sample()
    annotations = {
        "steps": [
            {"step_id": "st1", "name": "Visible step",
             "description": "", "flags": {}, "state": "auto_matched"},
            {"step_id": "st2", "name": "Hidden noise step",
             "description": "", "flags": {"exception_path": True},
             "state": "hidden"},
        ],
        "phases": [],
    }
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=Path(tmp), canonical=None,
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        texts = [p.text for p in doc.paragraphs]
        cells = [c.text for t in doc.tables for r in t.rows for c in r.cells]
        assert any("Visible step" in t for t in texts)
        # The hidden step appears in neither §3.5 nor the §5 exceptions table.
        assert not any("Hidden noise step" in t for t in texts)
        assert not any("Hidden noise step" in c for c in cells)


def _pdd_texts(tmp, manifest, annotations, stats, analysis):
    out = Path(tmp) / "pdd.docx"
    pdd_export.write_pdd(
        out, session_folder=Path(tmp), canonical=None,
        annotations=annotations, stats=stats, manifest=manifest,
        analysis=analysis)
    from docx import Document
    doc = Document(str(out))
    return ([p.text for p in doc.paragraphs],
            [c.text for t in doc.tables for r in t.rows for c in r.cells])


def test_pdd_findings_honour_memo_selection():
    """§B3 one-source-of-truth: when the analyst selected findings via
    annotations.memo_selection, PDD §1 renders exactly those -- the same
    selection memo_export uses."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis = _sample()
    analysis["findings"] = [
        {"id": "f-keep", "detector": "fragmentation",
         "claim": "KEEP-THIS-CLAIM appears.", "evidence": {}, "tier": 1},
        {"id": "f-drop", "detector": "waiting",
         "claim": "DROP-THIS-CLAIM does not.", "evidence": {}, "tier": 1},
    ]
    annotations = dict(annotations, memo_selection=["f-keep"])
    with tempfile.TemporaryDirectory() as tmp:
        texts, _cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        assert any("KEEP-THIS-CLAIM" in t for t in texts)
        assert not any("DROP-THIS-CLAIM" in t for t in texts)


def test_efficiency_ratio_gated_on_bnva_override():
    """§B3 honesty parity: the efficiency ratio is withheld (replaced by the
    call-to-action note) until an analyst bnva_ms override exists -- the same
    gate the viewer's Analysis level applies."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, stats, analysis = _sample()
    # No override -> withheld + the replace-pattern note.
    with tempfile.TemporaryDirectory() as tmp:
        texts, cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        assert not any("value-add (analyst-reviewed split)" in c for c in cells)
        assert any("process-efficiency ratio is withheld" in t for t in texts)
    # With an analyst override -> the ratio renders.
    annotations = dict(annotations,
                       analysis_overrides=[{"process_label": "Enter customer data",
                                            "bnva_ms": 5000}])
    with tempfile.TemporaryDirectory() as tmp:
        texts, cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        assert any("60% value-add (analyst-reviewed split)" in c for c in cells)
        assert not any("process-efficiency ratio is withheld" in t for t in texts)


def test_tier2_sections_gated_on_case_quality():
    """§B3: cycle times (4.4 'Cases observed') and path variants (6.1) are
    Tier-2 -- on an unsegmented session both are replaced by the one-line
    call to action, never rendered with fact authority."""
    if not _HAVE_DOCX:
        return
    manifest, annotations, _stats, analysis = _sample()
    stats = {
        "activity_stats": [],
        "case_stats": [{"case_id": "c1", "active_ms": 40000}],
        "trace_variants": [{"variant": ["A", "B"], "frequency": 3},
                           {"variant": ["A", "C"], "frequency": 1}],
        "meta": {"case_count": 1, "step_count": 1},
    }
    analysis["case_quality"] = {"mode": "unsegmented", "case_count": 0,
                                "coverage": 0.0, "tier2_unlocked": False}
    with tempfile.TemporaryDirectory() as tmp:
        texts, cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        assert not any("Cases observed" in c for c in cells)
        assert any("Case-based statistics" in t and "withheld" in t for t in texts)
        assert any("Path variants are case-based analysis" in t for t in texts)
        assert not any(c == "Variation 1" for c in cells)
    # Unlocked -> both render as before.
    analysis["case_quality"] = {"mode": "markers", "case_count": 1,
                                "coverage": 0.95, "tier2_unlocked": True}
    with tempfile.TemporaryDirectory() as tmp:
        texts, cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        assert any("Cases observed" in c for c in cells)
        assert any(c == "Variation 1" for c in cells)


def test_screenshot_ref_path_traversal_is_skipped():
    """SEC Vuln 2: a screenshot_ref with '..' or an absolute path must not
    cause an off-folder image read / embed."""
    if not _HAVE_DOCX:
        return
    manifest, _annotations, stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as outer:
        outer_p = Path(outer)
        # An image that lives OUTSIDE the session folder -- the target of the
        # traversal attack.
        secret = outer_p / "secret.png"
        secret.write_bytes(_make_png())

        session = outer_p / "session"
        session.mkdir()

        annotations = {
            "steps": [
                {"step_id": "st1", "name": "Step with hostile refs",
                 "description": "", "flags": {}, "state": "auto_matched",
                 "evidence": {"screenshot_refs": [
                     "../secret.png",                # traversal
                     str(secret),                    # absolute path
                 ]}},
            ],
            "phases": [],
        }
        out = session / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=session, canonical=None,
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        # No off-folder image was embedded.
        assert len(doc.inline_shapes) == 0


def test_screenshot_ref_within_folder_is_embedded():
    """Containment guard must not break the legitimate case: an in-folder
    screenshot_ref is still embedded."""
    if not _HAVE_DOCX:
        return
    manifest, _annotations, stats, analysis = _sample()
    with tempfile.TemporaryDirectory() as tmp:
        session = Path(tmp)
        shots = session / "shots"
        shots.mkdir()
        (shots / "s1.png").write_bytes(_make_png())
        annotations = {
            "steps": [
                {"step_id": "st1", "name": "Step with valid ref",
                 "description": "", "flags": {}, "state": "auto_matched",
                 "evidence": {"screenshot_refs": ["shots/s1.png"]}},
            ],
            "phases": [],
        }
        out = session / "pdd.docx"
        pdd_export.write_pdd(
            out, session_folder=session, canonical=None,
            annotations=annotations, stats=stats, manifest=manifest,
            analysis=analysis,
        )
        from docx import Document
        doc = Document(str(out))
        assert len(doc.inline_shapes) >= 1


# ---- ADR-0028 §4: work-item grain in §4.5 (detailed steps) ------------------

def _cased_step(step_id, case_id, screen, start):
    """A step carrying the fields the work-item grouping reads: case_id, the
    value-free screen grain key source, and a start time for ordering."""
    return {
        "step_id": step_id, "name": f"{screen}: {step_id}",
        "description": "", "flags": {}, "state": "auto_suggested",
        "case_id": case_id,
        "grain_keys": {"element": step_id, "screen": screen, "app": "app"},
        "time_range": {"start": start, "end": start},
    }


def _cased_annotations():
    """Two cases; case c1 has a Salesforce bounce (non-consecutive va01)."""
    steps = [
        _cased_step("s1", "c1", "Salesforce - Order #10900", "2026-05-14T09:00:00Z"),
        _cased_step("s2", "c1", "va01", "2026-05-14T09:00:05Z"),
        _cased_step("s3", "c1", "Salesforce - Order #10900", "2026-05-14T09:00:10Z"),
        _cased_step("s4", "c2", "va01", "2026-05-14T09:05:00Z"),
    ]
    return {"steps": steps, "phases": []}


def _cased_stats():
    return {"activity_stats": [],
            "case_stats": [{"case_id": "c1", "label": "Order #10900"},
                           {"case_id": "c2", "label": "Order #10901"}],
            "meta": {"case_count": 2, "step_count": 4}}


def test_pdd_steps_render_at_work_item_grain_with_group_names():
    """§4.5 groups the detailed steps by case -> work item -> fragments; a named
    work item shows the analyst's name (heading), its note, and a waste flag,
    with the member fragments preserved beneath."""
    if not _HAVE_DOCX:
        return
    manifest, _a, _s, analysis = _sample()
    annotations = _cased_annotations()
    annotations["group_annotations"] = [
        {"case_id": "c1", "screen_key": "scr:Salesforce - Order",
         "name": "Enter the order lines",
         "notes": "unit price is always 49.99", "manually_authored": True},
        {"case_id": "c1", "screen_key": "scr:va01",
         "waste": True, "manually_authored": True},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        texts, _cells = _pdd_texts(tmp, manifest, annotations, _cased_stats(), analysis)
        # Case headings use the friendly case_stats label, not raw ids.
        assert any(t == "Order #10900" for t in texts)
        assert any(t == "Order #10901" for t in texts)
        # A named work item shows its analyst name + note.
        assert any(t == "Enter the order lines" for t in texts)
        assert any("unit price is always 49.99" in t for t in texts)
        # A waste-flagged work item shows the flag; its label falls back to the
        # value-free screen (no name given).
        assert any(t == "Flags: Waste" for t in texts)
        assert any(t == "va01" for t in texts)
        # Member fragments are preserved beneath the work items.
        assert any("s1" in t for t in texts)


def test_pdd_unnamed_work_items_use_value_free_screen_label():
    """With cases but no group_annotations, §4.5 still groups by work item; each
    heading is the value-free screen label (record number stripped)."""
    if not _HAVE_DOCX:
        return
    manifest, _a, _s, analysis = _sample()
    annotations = _cased_annotations()   # no group_annotations
    with tempfile.TemporaryDirectory() as tmp:
        texts, _cells = _pdd_texts(tmp, manifest, annotations, _cased_stats(), analysis)
        assert any(t == "Salesforce - Order" for t in texts)   # "#10900" stripped
        assert any(t == "va01" for t in texts)
        assert not any("Flags: Waste" in t for t in texts)     # nothing flagged


def test_pdd_no_cases_keeps_flat_step_rendering():
    """The graceful fallback: an unsegmented session (no case_id) keeps the
    exact flat per-step rendering, not a work-item tree."""
    if not _HAVE_DOCX:
        return
    manifest, _a, stats, analysis = _sample()
    annotations = {"steps": [
        {"step_id": "st1", "name": "Enter customer data",
         "description": "", "flags": {}, "state": "auto_matched"},
    ], "phases": []}
    with tempfile.TemporaryDirectory() as tmp:
        texts, _cells = _pdd_texts(tmp, manifest, annotations, stats, analysis)
        # The step renders under its own name, flat -- no case heading.
        assert any(t == "Enter customer data" for t in texts)


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
