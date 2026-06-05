"""Engagement workspace tests — PDT-1.0-SPEC §5 / ADR-0030.

stdlib-only; runs under bare system Python with pytest.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Make the parent package importable when pytest is invoked from repo root.
_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
if str(_NORM.parent) not in sys.path:
    sys.path.insert(0, str(_NORM.parent))

from normalization.engagement import (  # noqa: E402
    new_engagement,
    write_engagement,
    load_engagement,
    list_engagement_sessions,
    ENGAGEMENT_SCHEMA_VERSION,
)
from normalization.engagement.backlog import build_backlog  # noqa: E402
from normalization.engagement.backlog_export import export_csv, export_xlsx  # noqa: E402
from normalization.engagement.pdd_export import (  # noqa: E402
    write_pdd_markdown,
    write_pdd_pdf,
)


def test_new_engagement_shape():
    eng = new_engagement(name="ACME Finance Q3", client="ACME Corp")
    assert eng["version"] == ENGAGEMENT_SCHEMA_VERSION
    assert eng["name"] == "ACME Finance Q3"
    assert eng["client"] == "ACME Corp"
    assert eng["engagement_id"].startswith("acme-finance-q3-")
    assert "config" in eng
    assert eng["config"]["confidence_floor"] == 0.5
    assert eng["config"]["variant_suppression_threshold"] == 3
    assert eng["sessions"] == []
    assert eng["promoted_processes"] == []


def test_engagement_round_trip(tmp_path):
    eng = new_engagement(name="Test Engagement")
    write_engagement(tmp_path, eng)
    loaded = load_engagement(tmp_path)
    assert loaded["name"] == "Test Engagement"
    assert loaded["version"] == ENGAGEMENT_SCHEMA_VERSION
    assert (tmp_path / "engagement.json").exists()


def test_list_engagement_sessions_combines_declared_and_disk(tmp_path):
    # 1. Create an engagement with one session referenced declaratively
    eng = new_engagement(name="Test")
    declared_session = tmp_path / "external" / "sess1"
    declared_session.mkdir(parents=True)
    (declared_session / "events.jsonl").write_text("")
    eng["sessions"] = [str(declared_session)]
    write_engagement(tmp_path, eng)

    # 2. Drop a second session physically in sessions/
    on_disk = tmp_path / "sessions" / "sess2"
    on_disk.mkdir(parents=True)
    (on_disk / "manifest.json").write_text("{}")

    sessions = list_engagement_sessions(tmp_path)
    assert len(sessions) == 2
    assert any("sess1" in s for s in sessions)
    assert any("sess2" in s for s in sessions)


def test_build_backlog_aggregates_across_sessions(tmp_path):
    """Same signature in two sessions should aggregate into one row."""
    s1 = tmp_path / "s1"
    s2 = tmp_path / "s2"
    s1.mkdir()
    s2.mkdir()
    (s1 / "manifest.json").write_text(json.dumps({"session_id": "u-1"}))
    (s2 / "manifest.json").write_text(json.dumps({"session_id": "u-2"}))
    (s1 / "analysis.json").write_text(json.dumps({
        "automation_candidates": [
            {
                "segment_signature": "abc123",
                "label": "Review incident",
                "apps": ["servicenow.exe"],
                "instance_count": 3,
                "total_elapsed_ms": 60000,
                "scores": {"confidence": 0.7},
                "case_ids": ["c-1", "c-2", "c-3"],
            }
        ]
    }))
    (s2 / "analysis.json").write_text(json.dumps({
        "automation_candidates": [
            {
                "segment_signature": "abc123",
                "label": "Review incident",
                "apps": ["servicenow.exe"],
                "instance_count": 2,
                "total_elapsed_ms": 40000,
                "scores": {"confidence": 0.8},
                "case_ids": ["c-4", "c-5"],
            }
        ]
    }))
    backlog = build_backlog([str(s1), str(s2)])
    assert backlog["session_count"] == 2
    assert backlog["process_count"] == 1
    row = backlog["rows"][0]
    assert row["instance_count"] == 5
    assert row["case_count"] == 5
    assert row["session_count"] == 2
    assert row["variant_data_sufficient"] is True
    assert row["confidence"] == 0.75
    assert row["rank"] == 1


def test_backlog_confidence_floor():
    backlog = {
        "rows": [
            {"rank": 1, "label": "High", "confidence": 0.8, "below_confidence_floor": False,
             "instance_count": 3, "case_count": 3, "session_count": 1,
             "mean_elapsed_ms": 1000, "apps": ["x"], "rank_score": 2400},
            {"rank": 2, "label": "Low", "confidence": 0.3, "below_confidence_floor": True,
             "instance_count": 2, "case_count": 2, "session_count": 1,
             "mean_elapsed_ms": 500, "apps": ["y"], "rank_score": 300},
        ]
    }
    # Confidence-floor flag preserved end-to-end.
    assert backlog["rows"][0]["below_confidence_floor"] is False
    assert backlog["rows"][1]["below_confidence_floor"] is True


def test_export_csv_writes_file(tmp_path):
    backlog = {"rows": [
        {"rank": 1, "label": "Test process", "confidence": 0.8,
         "instance_count": 5, "case_count": 4, "session_count": 2,
         "mean_elapsed_ms": 60000, "apps": ["app.exe"], "rank_score": 240000}
    ]}
    path = export_csv(backlog, tmp_path / "backlog.csv")
    assert os.path.exists(path)
    text = Path(path).read_text(encoding="utf-8")
    assert "Process" in text
    assert "Test process" in text
    assert "80%" in text


def test_export_xlsx_writes_valid_zip(tmp_path):
    import zipfile
    backlog = {"rows": [
        {"rank": 1, "label": "Test process", "confidence": 0.8,
         "instance_count": 5, "case_count": 4, "session_count": 2,
         "mean_elapsed_ms": 60000, "apps": ["app.exe"], "rank_score": 240000}
    ]}
    path = export_xlsx(backlog, tmp_path / "backlog.xlsx")
    assert os.path.exists(path)
    # A valid XLSX is a zip with specific entries
    with zipfile.ZipFile(path, "r") as z:
        names = z.namelist()
        assert "xl/workbook.xml" in names
        assert "xl/worksheets/sheet1.xml" in names
        assert "[Content_Types].xml" in names


def test_pdd_markdown_includes_required_sections(tmp_path):
    process = {
        "rank": 1, "label": "Review incident", "signature": "abc123",
        "instance_count": 14, "case_count": 5, "session_count": 3,
        "mean_elapsed_ms": 360000, "confidence": 0.78, "apps": ["servicenow.exe"],
        "variant_data_sufficient": True, "total_elapsed_ms": 5040000,
    }
    engagement = {"name": "ACME Q3", "client": "ACME"}
    path = write_pdd_markdown(process, engagement, tmp_path / "pdd.md")
    text = Path(path).read_text(encoding="utf-8")
    assert "Review incident" in text
    assert "Process at a glance" in text
    assert "78%" in text
    assert "Recommended next steps" in text
    # Honesty disclaimer
    assert "no AI-generated" in text.lower() or "no ai-generated" in text.lower()


def test_pdd_pdf_writes_valid_pdf_header(tmp_path):
    process = {
        "rank": 1, "label": "Test process", "signature": "abc",
        "instance_count": 1, "case_count": 1, "session_count": 1,
        "mean_elapsed_ms": 1000, "confidence": 0.6, "apps": ["x"],
        "variant_data_sufficient": False, "total_elapsed_ms": 1000,
    }
    path = write_pdd_pdf(process, {"name": "E", "client": "C"}, tmp_path / "pdd.pdf")
    data = Path(path).read_bytes()
    assert data.startswith(b"%PDF-")
    assert data.endswith(b"%%EOF\n") or data.endswith(b"%%EOF")
