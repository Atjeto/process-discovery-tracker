"""Naming Layer tests — PDT-1.0-SPEC §3.2, ADR-0028.

Hard rules verified:
  - LLM never sees raw events (only the bounded derived input).
  - LLM-produced text is number-scrubbed.
  - Capture-confidence gates output (low input → insufficient signal).
  - Graceful degrade: NullBackend never raises, never confabulates.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
if str(_NORM.parent) not in sys.path:
    sys.path.insert(0, str(_NORM.parent))

from normalization.naming import (  # noqa: E402
    name_activity_clusters,
    draft_exec_summary,
    NullBackend,
    LlmRequest,
    LlmResponse,
    CAPTURE_CONFIDENCE_FLOOR,
    INSUFFICIENT_SIGNAL,
    enough_signal,
)
from normalization.naming.activity_namer import (  # noqa: E402
    _cluster_to_derived_input,
)


# ---- Confidence gating ----

def test_confidence_floor_is_load_bearing():
    assert CAPTURE_CONFIDENCE_FLOOR > 0
    assert CAPTURE_CONFIDENCE_FLOOR < 1


def test_enough_signal_uses_cluster_confidence():
    assert enough_signal(cluster={"confidence": 0.9}) is True
    assert enough_signal(cluster={"confidence": 0.2}) is False
    assert enough_signal(cluster={}) is False
    assert enough_signal() is False


def test_enough_signal_falls_back_to_interactions_mean():
    high = [{"confidence": 0.8}, {"confidence": 0.9}]
    low = [{"confidence": 0.1}, {"confidence": 0.2}]
    assert enough_signal(interactions=high) is True
    assert enough_signal(interactions=low) is False


# ---- Derived-input projection: no raw event leakage ----

def test_cluster_to_derived_input_strips_unbounded_fields():
    cluster = {
        "cluster_id": "abc",
        "process_label": "Search",
        "screen_label": "Salesforce",
        "app": "chrome.exe",
        "confidence": 0.7,
        # These MUST NOT appear in the LLM input:
        "event_ids": ["e1", "e2", "e3"],
        "raw_keystrokes": ["a", "b", "c"],
        "clipboard_contents": ["secret-token-xyz"],
        "value_changed_events": [{"value": "PASSWORD123"}],
    }
    di = _cluster_to_derived_input(cluster)
    # Only the allow-listed keys are present.
    assert set(di.keys()) <= {
        "process_label", "screen_label", "app",
        "interaction_types", "vocab_names", "confidence",
    }
    # And nothing raw leaked.
    serialised = repr(di)
    assert "PASSWORD123" not in serialised
    assert "secret-token-xyz" not in serialised
    assert "e1" not in serialised


# ---- NullBackend graceful degrade ----

def test_null_backend_never_raises():
    backend = NullBackend()
    response = backend.complete(LlmRequest(
        purpose="activity_name",
        derived_input={"process_label": "Search"},
    ))
    assert response.insufficient_signal
    assert response.text == INSUFFICIENT_SIGNAL


def test_null_backend_used_for_activity_naming():
    clusters = [
        {"cluster_id": "c1", "process_label": "Search", "confidence": 0.9},
        {"cluster_id": "c2", "process_label": "Review", "confidence": 0.8},
    ]
    out = name_activity_clusters(clusters, backend=NullBackend())
    assert len(out) == 2
    for a in out:
        assert a.insufficient_signal is True
        # Fallback display name uses the cluster's process_label.
        assert a.display_name() in ("Search", "Review")


def test_low_confidence_clusters_skipped_without_calling_llm():
    """Clusters below the capture-confidence floor return insufficient
    signal BEFORE the LLM is called. Verifies the gating actually runs."""
    backend = MagicMock()
    backend.complete = MagicMock()
    clusters = [{"cluster_id": "c1", "process_label": "Search", "confidence": 0.2}]
    out = name_activity_clusters(clusters, backend=backend)
    assert out[0].insufficient_signal is True
    backend.complete.assert_not_called()


# ---- Number-scrubbing rule ----

def test_response_scrub_numbers_strips_standalone_digits():
    resp = LlmResponse(text="Review incident with 42% confidence and 0.78 score.")
    scrubbed = resp.scrub_numbers()
    # The standalone numbers must be gone; the alpha tokens stay.
    assert "42" not in scrubbed.text
    assert "0.78" not in scrubbed.text
    assert "Review" in scrubbed.text


def test_response_scrub_numbers_preserves_in_word_digits():
    """'Office365' contains a digit but is a name, not a measurement.
    The scrubber must preserve it."""
    resp = LlmResponse(text="Reviewed in Office365 with care.")
    scrubbed = resp.scrub_numbers()
    assert "Office365" in scrubbed.text


# ---- PDD prose fallback path ----

def test_draft_exec_summary_falls_back_when_llm_refuses():
    process = {"label": "Review incident", "apps": ["servicenow.exe"]}
    result = draft_exec_summary(process, backend=NullBackend())
    assert result["insufficient_signal"] is True
    assert result["source"] == "template_fallback"
    assert "Review incident" in result["prose"]
    assert "servicenow.exe" in result["prose"]
    # Templated prose must not contain LLM-fabricated numbers.
    # (Our template doesn't include any.)
    assert "%" not in result["prose"]


# ---- Smoke: a mock LLM backend round-trips correctly ----

def test_activity_naming_with_mock_backend():
    """Verify a normal LLM round-trip: a mock backend returns a name,
    and the result wires through correctly with provenance."""
    class MockBackend:
        def complete(self, request):
            assert request.purpose == "activity_name"
            return LlmResponse(
                text="Review incident",
                confidence=0.78,
                provenance=["process_label", "screen_label"],
            )
    clusters = [{
        "cluster_id": "c1",
        "process_label": "Review",
        "screen_label": "ServiceNow incident",
        "app": "chrome.exe",
        "confidence": 0.7,
    }]
    out = name_activity_clusters(clusters, backend=MockBackend())
    assert out[0].name == "Review incident"
    assert out[0].display_name() == "Review incident"
    assert out[0].insufficient_signal is False
    assert "process_label" in out[0].provenance
