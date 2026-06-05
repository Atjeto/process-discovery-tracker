"""Pattern Layer smoke tests — ADR-0029 / PDT-1.0-SPEC §3.1.

stdlib-only smoke; runs under bare system Python with pytest.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
if str(_NORM.parent) not in sys.path:
    sys.path.insert(0, str(_NORM.parent))

from normalization.patterns import detect_patterns  # noqa: E402


def _ts(seconds_offset: int) -> str:
    base = datetime(2026, 6, 5, 9, 0, 0, tzinfo=timezone.utc)
    return (base + timedelta(seconds=seconds_offset)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _step(step_id: str, label: str, case_id: str, offset_s: int, duration_s: int = 10):
    return {
        "step_id": step_id,
        "case_id": case_id,
        "name": label,
        "process_label": label,
        "time_range": {"start": _ts(offset_s), "end": _ts(offset_s + duration_s)},
        "grain_keys": {"element": "btn", "screen": "main", "app": "app.exe"},
        "evidence": {"interaction_event_ids": []},
        "state": "auto_suggested",
        "flags": {"waste": False},
    }


def test_detect_patterns_returns_expected_shape():
    """Smoke: orchestrator returns the full output shape."""
    steps = [
        _step("s1", "Open", "c1", 0),
        _step("s2", "Read", "c1", 11),
        _step("s3", "Submit", "c1", 22),
        _step("s4", "Open", "c2", 60),
        _step("s5", "Read", "c2", 71),
        _step("s6", "Submit", "c2", 82),
        _step("s7", "Open", "c3", 120),
        _step("s8", "Read", "c3", 131),
        _step("s9", "Submit", "c3", 142),
    ]
    out = detect_patterns(events=[], steps=steps, existing_anno={})
    assert out["version"] == 1
    assert "motifs" in out
    assert "activity_clusters" in out
    assert "anomalies" in out
    assert "case_inference" in out
    assert "heuristic_version" in out


def test_motifs_detect_repeated_subsequence():
    """The Open->Read->Submit subsequence appears in 3 cases — should surface."""
    steps = [
        _step("s1", "Open", "c1", 0),
        _step("s2", "Read", "c1", 11),
        _step("s3", "Submit", "c1", 22),
        _step("s4", "Open", "c2", 60),
        _step("s5", "Read", "c2", 71),
        _step("s6", "Submit", "c2", 82),
        _step("s7", "Open", "c3", 120),
        _step("s8", "Read", "c3", 131),
        _step("s9", "Submit", "c3", 142),
    ]
    out = detect_patterns(events=[], steps=steps, existing_anno={})
    motifs = out.get("motifs") or []
    # At least the 3-symbol motif Open->Read->Submit should be present.
    labels_lists = [m.get("labels") for m in motifs]
    assert any(labels == ["Open", "Read", "Submit"] for labels in labels_lists)


def test_clusters_have_confidence_in_unit_interval():
    steps = [
        _step("s1", "Search", "c1", 0),
        _step("s2", "Search", "c1", 11),
        _step("s3", "Search", "c2", 60),
    ]
    out = detect_patterns(events=[], steps=steps, existing_anno={})
    for c in out.get("activity_clusters") or []:
        assert 0.0 <= c.get("confidence", 0) <= 1.0


def test_case_inference_skipped_when_anchors_exist():
    """If case_anchor_override is present, case_inference must report it wasn't used."""
    steps = [_step("s1", "X", "c1", 0)]
    existing = {"case_anchor_override": {"field": "automation_id", "equals": "x"}}
    out = detect_patterns(events=[], steps=steps, existing_anno=existing)
    ci = out.get("case_inference") or {}
    assert ci.get("case_inference_used") is False


def test_handles_empty_inputs_gracefully():
    out = detect_patterns(events=[], steps=[], existing_anno={})
    assert isinstance(out, dict)
    assert out.get("motifs") == []
    assert out.get("activity_clusters") == []


def test_disagreement_caps_cluster_confidence():
    """PDT-1.0-SPEC §4.3: a saved disagreement on a step caps that step's
    cluster confidence at 0.5 on the next normalize pass."""
    steps = [_step("s1", "Submit", "c1", 0)] * 0 + [
        _step("s1", "Submit", "c1", 0),
        _step("s2", "Submit", "c2", 60),
        _step("s3", "Submit", "c3", 120),
    ]
    # Without disagreement: confidence should be high.
    out_no = detect_patterns(events=[], steps=steps, existing_anno={})
    clusters_no = out_no["activity_clusters"]
    assert clusters_no
    high_conf = max(c["confidence"] for c in clusters_no)

    # With a disagreement on s2: same cluster should now have confidence <= 0.5.
    existing = {"disagreements": [{
        "disagreement_id": "d1",
        "step_id": "s2",
        "field": "name",
        "rejected": "Submit",
        "proposed": "Send incident",
        "source": "glance",
        "ts": "2026-06-05T10:00:00Z",
    }]}
    out_yes = detect_patterns(events=[], steps=steps, existing_anno=existing)
    clusters_yes = out_yes["activity_clusters"]
    assert clusters_yes
    capped = [c for c in clusters_yes if c.get("disagreement_count", 0) > 0]
    assert capped, "at least one cluster should carry the disagreement flag"
    assert all(c["confidence"] <= 0.5 for c in capped), \
        "cluster with disagreement should be capped at 0.5"
    assert high_conf > 0.5, "baseline (no disagreement) should exceed 0.5"
