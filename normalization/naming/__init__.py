"""Scoped Naming Layer — PDT-1.0-SPEC §3.2, ADR-0028.

Local-first LLM, scoped to exactly two uses:

  1. Activity naming — turn Pattern-Layer activity clusters into
     business-language names (the Cockpit's "Review incident" instead of
     "cluster_4_in_servicenow").
  2. PDD executive-summary prose — one paragraph per process, around the
     measured numbers, no LLM-produced numerical content.

Everything else (screen names, phase names, PDD §2–§5 body, self-
annotation questions) is deterministic templates with observed-value
substitution. Templates beat the LLM tax for short structural labels.

Hard rules (the integrity backbone, ADR-0028):
  - The LLM never sees raw events. Only the derived stream — recognised
    interactions, window titles, control captions, durations.
  - The LLM never produces numbers. All numerical content is templated
    from measured quantities.
  - Capture-confidence gates output. Below-threshold inputs return
    "insufficient signal", not confabulated names.
  - Every output carries confidence + provenance.
  - Local-first (Ollama default at http://localhost:11434). Cloud opt-in
    is behind an explicit consent gate (Phase 4+).
  - Graceful degrade: Ollama unreachable → no naming, structural outputs
    still display. The Pattern Layer's value survives even when the LLM
    is off.
"""

from __future__ import annotations

from .llm_client import (
    LlmBackend,
    OllamaBackend,
    NullBackend,
    get_default_backend,
    LlmRequest,
    LlmResponse,
)
from .activity_namer import name_activity_clusters, ActivityName
from .pdd_prose import draft_exec_summary
from .confidence import (
    CAPTURE_CONFIDENCE_FLOOR,
    INSUFFICIENT_SIGNAL,
    enough_signal,
)
from .embeddings import (
    embed,
    embed_batch,
    cosine_similarity,
    is_available as embeddings_available,
    DEFAULT_EMBED_MODEL,
)
from .equivalence_judge import (
    equivalence_pairs,
    judge_pair,
    JudgeResult,
)

__all__ = [
    # backends
    "LlmBackend",
    "OllamaBackend",
    "NullBackend",
    "get_default_backend",
    "LlmRequest",
    "LlmResponse",
    # high-level entry points
    "name_activity_clusters",
    "ActivityName",
    "draft_exec_summary",
    # gating
    "CAPTURE_CONFIDENCE_FLOOR",
    "INSUFFICIENT_SIGNAL",
    "enough_signal",
    # embeddings (semantic clustering)
    "embed",
    "embed_batch",
    "cosine_similarity",
    "embeddings_available",
    "DEFAULT_EMBED_MODEL",
]
