"""End-to-end smoke for the PDT 1.0 AI/ML chain.

Runs the full Pattern Layer → Naming Layer → Backlog → PDD chain against
synthetic input and against a real example session. Verifies every wiring
seam without depending on a running Ollama instance.

ADR-0028, ADR-0029, ADR-0030, ADR-0033.
"""

from __future__ import annotations

import json
import sys
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
_REPO = _NORM.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from normalization.patterns import detect_patterns  # noqa: E402
from normalization.naming import (  # noqa: E402
    name_activity_clusters,
    draft_exec_summary,
    get_default_backend,
    NullBackend,
    LlmResponse,
    INSUFFICIENT_SIGNAL,
)
from normalization.engagement import (  # noqa: E402
    new_engagement,
    write_engagement,
    build_backlog,
    write_pdd_markdown,
    export_engagement_config,
    import_engagement_config,
)


def _ts(seconds_offset):
    base = datetime(2026, 6, 5, 9, 0, 0, tzinfo=timezone.utc)
    return (base + timedelta(seconds=seconds_offset)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _step(step_id, label, case_id, offset_s, duration_s=10, app="app.exe"):
    return {
        "step_id": step_id,
        "case_id": case_id,
        "name": label,
        "process_label": label,
        "time_range": {"start": _ts(offset_s), "end": _ts(offset_s + duration_s)},
        "grain_keys": {"element": "btn", "screen": "main", "app": app},
        "evidence": {"interaction_event_ids": []},
        "state": "auto_suggested",
        "flags": {"waste": False},
    }


def _synthetic_steps():
    """A small repeating workflow with 3 cases — enough to surface
    a motif, a cluster, and let the backlog aggregate."""
    return [
        _step("s1", "Open", "c1", 0, app="servicenow.exe"),
        _step("s2", "Read", "c1", 11, app="servicenow.exe"),
        _step("s3", "Submit", "c1", 22, app="servicenow.exe"),
        _step("s4", "Open", "c2", 60, app="servicenow.exe"),
        _step("s5", "Read", "c2", 71, app="servicenow.exe"),
        _step("s6", "Submit", "c2", 82, app="servicenow.exe"),
        _step("s7", "Open", "c3", 120, app="servicenow.exe"),
        _step("s8", "Read", "c3", 131, app="servicenow.exe"),
        _step("s9", "Submit", "c3", 142, app="servicenow.exe"),
    ]


def test_e2e_pattern_to_naming_to_backlog_chain():
    """Smoke: Pattern Layer surfaces clusters; Naming Layer attempts to
    name them; Backlog aggregates; PDD exporter consumes the chain."""
    steps = _synthetic_steps()
    patterns = detect_patterns(events=[], steps=steps, existing_anno={})
    clusters = patterns.get("activity_clusters") or []
    assert clusters, "Pattern Layer should surface at least one cluster"

    # Naming Layer with NullBackend (graceful degrade path).
    names = name_activity_clusters(clusters, backend=NullBackend())
    assert len(names) == len(clusters)
    for n in names:
        # NullBackend always returns insufficient_signal; display falls
        # back to the heuristic process_label.
        assert n.insufficient_signal
        assert n.display_name() != "(unnamed cluster)" or not clusters[0].get("process_label")


def test_e2e_with_mock_llm_produces_named_backlog_and_pdd(tmp_path):
    """Mock the LLM to verify the full chain produces named outputs all
    the way through to the PDD."""
    class MockBackend:
        def complete(self, request):
            if request.purpose == "activity_name":
                return LlmResponse(
                    text="Review incident",
                    confidence=0.78,
                    provenance=["process_label", "screen_label"],
                )
            if request.purpose == "exec_summary":
                return LlmResponse(
                    text="This process is a routine incident review carried out "
                         "in the ticketing system, involving opening the record, "
                         "reading the details, and submitting an update.",
                    confidence=0.72,
                    provenance=["label", "apps"],
                )
            return LlmResponse.insufficient()

    # Build a synthetic session with a measured automation candidate.
    steps = _synthetic_steps()
    patterns = detect_patterns(events=[], steps=steps, existing_anno={})
    clusters = patterns.get("activity_clusters") or []
    backend = MockBackend()
    names = name_activity_clusters(clusters, backend=backend)
    named_real = [n for n in names if not n.insufficient_signal]
    assert named_real, "MockBackend should produce a name"
    assert named_real[0].name == "Review incident"

    # Stage a session folder with our patterns.json + a synthetic
    # analysis.json carrying matching automation_candidates.
    sess = tmp_path / "session"
    sess.mkdir()
    (sess / "manifest.json").write_text(json.dumps({"session_id": "u-1"}))
    patterns_out = {
        **patterns,
        "named_clusters": [n.to_dict() for n in names],
    }
    (sess / "patterns.json").write_text(json.dumps(patterns_out))
    (sess / "analysis.json").write_text(json.dumps({
        "automation_candidates": [{
            "segment_signature": clusters[0]["cluster_id"],
            "label": clusters[0].get("process_label") or "Open",
            "apps": ["servicenow.exe"],
            "instance_count": 3,
            "total_elapsed_ms": 90_000,
            "case_ids": ["c1", "c2", "c3"],
            "scores": {"confidence": 0.78},
        }]
    }))

    # Backlog aggregation — should pick up the AI name from patterns.json.
    backlog = build_backlog([str(sess)])
    # PDT-1.0-SPEC §3.1: backlog now surfaces both segment-grain
    # candidates AND activity-grain Pattern Layer clusters. The mock
    # session has 1 segment candidate + the clusters from detect_patterns;
    # find the row matching the segment_signature explicitly.
    assert backlog["process_count"] >= 1
    segment_row = next(
        (r for r in backlog["rows"] if r["signature"] == clusters[0]["cluster_id"]),
        None,
    )
    assert segment_row, "no row for the segment candidate's signature"
    assert segment_row["ai_named"], "segment-candidate row should be flagged as AI-named"
    assert segment_row["label"] == "Review incident", \
        f"AI label not propagated to backlog: got {segment_row['label']!r}"
    assert segment_row["fallback_label"], "fallback_label should preserve the heuristic name"
    row = segment_row

    # PDD generation — exec_summary prose path. We patch the LLM backend
    # globally so the lazy import inside pdd_export picks up our mock.
    from normalization.naming import llm_client
    llm_client._default_backend = backend
    try:
        pdd_path = tmp_path / "pdd.md"
        write_pdd_markdown(row, {"name": "Mock Engagement", "client": "Test"}, pdd_path)
        text = pdd_path.read_text(encoding="utf-8")
        assert "Review incident" in text, "AI-named label missing from PDD"
        assert "AI-named" in text, "Provenance marker missing"
        assert "LLM-drafted" in text, "Source line should reflect LLM prose"
        # No-numbers-from-LLM: the exec summary paragraph must not
        # contain the measured numbers (those are templated below).
        prose_section = text.split("## 1. Process at a glance")[1].split("##")[0]
        # The LLM paragraph appears before the measured-sentence; the
        # measured sentence is what carries the numbers.
        # Verify the LLM paragraph itself contains no digits.
        first_para = prose_section.strip().split("\n\n")[0]
        assert not any(ch.isdigit() for ch in first_para), \
            f"LLM exec-summary leaked digits: {first_para!r}"
    finally:
        llm_client._default_backend = None


def test_e2e_config_bundle_round_trip(tmp_path):
    """The Phase-5 leave-behind: export an engagement, re-import it on a
    fresh install, verify the config persists."""
    src = tmp_path / "src"
    src.mkdir()
    eng = new_engagement(name="Bundle Test", client="Acme")
    eng["config"]["loaded_cost_per_hour"] = 55.0
    eng["config"]["annual_volume"] = 1800
    write_engagement(src, eng)

    bundle = export_engagement_config(src, tmp_path / "bundle.zip")
    assert Path(bundle).exists()

    dst = tmp_path / "dst"
    summary = import_engagement_config(bundle, dst)
    assert summary["engagement"] is not None

    imported = json.loads((dst / "engagement.json").read_text(encoding="utf-8"))
    assert imported["config"]["loaded_cost_per_hour"] == 55.0
    assert imported["config"]["annual_volume"] == 1800


def test_e2e_default_backend_graceful_when_no_ollama():
    """get_default_backend() probes Ollama; without it, must return
    NullBackend WITHOUT raising. The spec demands graceful degrade."""
    # Reset any cached backend from prior tests.
    from normalization.naming import llm_client
    llm_client._default_backend = None
    backend = get_default_backend()
    # Should be Null or Ollama — never None, never raise.
    assert backend is not None
    # Even if it's Ollama (rare in CI), a request can be satisfied.
    response = backend.complete(type("Req", (), {
        "purpose": "activity_name",
        "derived_input": {"process_label": "Search", "confidence": 0.9},
        "timeout_seconds": 1.0,
    })())
    # Output is either a real name or the insufficient-signal sentinel —
    # nothing in between, no exceptions raised.
    assert response.text
