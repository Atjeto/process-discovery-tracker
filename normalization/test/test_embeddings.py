"""Embeddings client + semantic-merge tests — PDT-1.0-SPEC §3.1.

The HTTP-touching tests skip when no Ollama is reachable, so this suite
is safe on a fresh checkout (CI runner without the bundled model).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
if str(_NORM.parent) not in sys.path:
    sys.path.insert(0, str(_NORM.parent))

from normalization.naming import embeddings  # noqa: E402
from normalization.naming.embeddings import (  # noqa: E402
    cosine_similarity,
    embed,
    embed_batch,
    is_available,
)


def test_cosine_similarity_basic():
    assert cosine_similarity([1, 0], [1, 0]) == pytest.approx(1.0)
    assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1.0)


def test_cosine_similarity_handles_none_and_mismatched():
    assert cosine_similarity(None, [1, 2]) == 0.0
    assert cosine_similarity([1, 2], None) == 0.0
    assert cosine_similarity([1, 2], [1, 2, 3]) == 0.0
    assert cosine_similarity([0, 0], [1, 1]) == 0.0


def test_embed_returns_none_on_empty_input():
    assert embed("") is None
    assert embed(None) is None  # type: ignore[arg-type]


def test_embed_returns_none_when_ollama_unreachable(monkeypatch):
    monkeypatch.setenv("PDT_OLLAMA_URL", "http://127.0.0.1:1")
    with patch.object(embeddings, "_ollama_url",
                       return_value="http://127.0.0.1:1/api/embed"):
        assert embed("hello", timeout=0.5) is None


def test_embed_batch_empty_returns_empty():
    assert embed_batch([]) == []


def test_embed_batch_handles_unreachable(monkeypatch):
    monkeypatch.setenv("PDT_OLLAMA_URL", "http://127.0.0.1:1")
    with patch.object(embeddings, "_ollama_url",
                       return_value="http://127.0.0.1:1/api/embed"):
        out = embed_batch(["a", "b", "c"], timeout=0.5)
        assert out == [None, None, None]


# ---- Live (skip when no Ollama) ----

LIVE = is_available()


@pytest.mark.skipif(not LIVE, reason="Ollama not reachable")
def test_live_embed_returns_384_dim_vector():
    v = embed("Submit incident")
    assert v is not None
    assert isinstance(v, list)
    assert len(v) == 384
    assert all(isinstance(x, float) for x in v)


@pytest.mark.skipif(not LIVE, reason="Ollama not reachable")
def test_live_batch_preserves_order_and_count():
    inputs = ["Submit incident", "Save workbook", "Review incident"]
    out = embed_batch(inputs)
    assert len(out) == 3
    for v in out:
        assert v is not None
        assert len(v) == 384


def _bundled_model_available() -> bool:
    """Check the bundled qwen2.5:1.5b-instruct is loaded — the judge
    test depends on it. Skip when running pytest without the bundle."""
    if not LIVE:
        return False
    import json, urllib.request
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2.0) as r:
            data = json.loads(r.read().decode("utf-8"))
        return any("qwen2.5:1.5b" in (m.get("name") or "") for m in (data.get("models") or []))
    except Exception:
        return False


JUDGE_LIVE = _bundled_model_available()


@pytest.mark.skipif(not JUDGE_LIVE, reason="bundled qwen2.5:1.5b-instruct not loaded")
def test_live_judge_merges_same_keeps_different(monkeypatch):
    """LLM-as-judge end-to-end check on realistic labels — replaces the
    cosine-only threshold test now that the merge is judge-driven."""
    monkeypatch.setenv("PDT_OLLAMA_MODEL", "qwen2.5:1.5b-instruct")
    from normalization.naming import llm_client
    llm_client._default_backend = None  # force re-probe with the env var
    from normalization.naming.equivalence_judge import judge_pair
    pairs_should_merge = [
        ("Submit form", "Send form", "chrome.exe"),
        ("Triage incident", "Review incident", "chrome.exe"),
    ]
    pairs_should_keep = [
        ("Save record", "Save workbook", "chrome.exe"),
        ("Open record", "Save record", "chrome.exe"),
        ("Search", "Open record", "chrome.exe"),
        ("Submit form", "Save record", "chrome.exe"),
    ]
    for a, b, app in pairs_should_merge:
        r = judge_pair(a, b, app)
        assert r.same, f"expected SAME: {a} vs {b}, got {r.source}/{r.raw[:80]}"
    for a, b, app in pairs_should_keep:
        r = judge_pair(a, b, app)
        assert not r.same, f"expected DIFFERENT: {a} vs {b}, got {r.source}/{r.raw[:80]}"


@pytest.mark.skipif(not LIVE, reason="Ollama not reachable")
def test_live_clustering_merges_synonymous_clusters():
    """Two same-app clusters with same-meaning labels should collapse
    into one with the higher occurrence count + semantic_merge metadata."""
    from normalization.patterns.clustering import find_activity_clusters
    steps = []
    base_ts = "2026-06-05T10:00:00Z"
    # Make two same-app clusters that semantically mean "fill form field":
    # 4 entering To, 3 entering Subject — same activity (fill form field).
    for i in range(4):
        steps.append({
            "step_id": f"to-{i}",
            "case_id": f"c{i}",
            "process_label": "Outlook: Enter To",
            "name": "Outlook: Enter To",
            "grain_keys": {"app": "OUTLOOK.EXE", "screen": "Compose"},
            "time_range": {"start": base_ts, "end": base_ts},
            "evidence": {"interaction_event_ids": []},
            "state": "auto_suggested",
            "flags": {"waste": False},
        })
    for i in range(3):
        steps.append({
            "step_id": f"subj-{i}",
            "case_id": f"c{i}",
            "process_label": "Outlook: Enter Subject",
            "name": "Outlook: Enter Subject",
            "grain_keys": {"app": "OUTLOOK.EXE", "screen": "Compose"},
            "time_range": {"start": base_ts, "end": base_ts},
            "evidence": {"interaction_event_ids": []},
            "state": "auto_suggested",
            "flags": {"waste": False},
        })

    clusters = find_activity_clusters(steps)
    merged = [c for c in clusters if c.get("semantic_merge")]
    assert merged, "expected at least one semantic-merged cluster"
    head = merged[0]
    assert head["occurrence_count"] == 7
    # Variants set should contain both labels.
    variants = head["semantic_merge"]["merged_label_variants"]
    assert "Outlook: Enter To" in variants
    assert "Outlook: Enter Subject" in variants
